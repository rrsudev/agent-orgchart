/**
 * VS Code glue for the research capture (Phase 3).
 *
 *  - setupStudyStorage(): reads settings and returns a ready StudyStorage
 *    (or null when disabled or no workspace is open).
 *  - revealStudyFolder(): open this workspace's capture folder in the OS file explorer.
 *  - packageStudyData(): rebuild the index, then zip the capture home for the
 *    participant to send (best-effort native zip; falls back to reveal).
 *
 * Informed consent is collected out-of-band at study enrollment (a separate
 * interface), so the extension never prompts for it — by installing this build
 * the participant has already accepted recording. Capture is ON by default so
 * no session is ever lost, and each workspace is written to its own subfolder
 * under a central capture home (STUDY_STORAGE_BASE), so data stays split by
 * workspace and is easy to find for later analysis. Nothing ever leaves the
 * machine automatically.
 */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { StudyStorage } from './study-storage'
import { buildIndex, isSqliteAvailable } from './study-index'
import { createLogger } from './logger'

const log = createLogger('StudyStorage')
const execFileAsync = promisify(execFile)

/** Central, per-user home for study captures — deliberately OUTSIDE the
 *  workspace (so it never lands in the participant's git repo) and OUTSIDE
 *  ~/.claude/agent-flow (which `vscode:uninstall` wipes), so uninstalling the
 *  extension can never destroy recorded data. */
const STUDY_STORAGE_BASE = path.join(os.homedir(), '.agent-flow-study')

/** Filesystem-safe, collision-resistant folder name for a workspace: a readable
 *  basename plus a short hash of the absolute path (dedupes same-named projects
 *  in different locations). */
function workspaceFolderKey(workspaceRoot: string): string {
  const base = path.basename(workspaceRoot).replace(/[^A-Za-z0-9._-]+/g, '_') || 'workspace'
  const hash = crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 8)
  return `${base}-${hash}`
}

/** Build the capture sink from settings. Returns null when disabled. */
export async function setupStudyStorage(context: vscode.ExtensionContext): Promise<StudyStorage | null> {
  const cfg = vscode.workspace.getConfiguration('agentFlowStudy')
  if (!cfg.get<boolean>('studyStorage.enabled', true)) return null

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace) {
    log.info('Study capture enabled but no workspace folder — skipping (capture is per-project).')
    return null
  }

  // Default layout: one central capture home, split into a per-workspace
  // subfolder so every project's data is preserved and easy to find for later
  // analysis. A configured `studyStorage.path` (relative to the workspace)
  // overrides this with an exact folder for custom setups.
  const configuredPath = cfg.get<string>('studyStorage.path', '').trim()
  const packagingRoot = configuredPath ? path.resolve(workspace, configuredPath) : STUDY_STORAGE_BASE
  const storageRoot = configuredPath ? packagingRoot : path.join(packagingRoot, workspaceFolderKey(workspace))

  // Visible, persistent signal if capture ever fails — a study can't afford a
  // silent no-op that looks healthy. Shown only once a failure actually occurs.
  const captureStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  context.subscriptions.push(captureStatus)
  let captureAlerted = false

  const storage = new StudyStorage({
    storageRoot,
    packagingRoot,
    workspaceRoot: workspace,
    participantId: cfg.get<string>('studyStorage.participantId', '') || undefined,
    toolVersion: context.extension?.packageJSON?.version,
    onError: (summary) => {
      captureStatus.text = '$(error) Study capture failing'
      captureStatus.tooltip = `A study-capture write failed (${summary}). See capture-errors.log in the storage folder — recorded data may be incomplete.`
      captureStatus.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
      captureStatus.show()
      if (!captureAlerted) {
        captureAlerted = true
        void vscode.window.showErrorMessage(
          `Agent Fruitstand: study capture is failing (${summary}). Recorded data may be incomplete — check capture-errors.log in the storage folder.`,
        )
      }
    },
  })
  storage.init()
  log.info(`Study capture enabled → ${storageRoot}`)
  return storage
}

/** Reveal the capture folder in the OS file explorer. */
export function revealStudyFolder(storage: StudyStorage | null): void {
  if (!storage) {
    void vscode.window.showWarningMessage('Agent Fruitstand: study capture is not enabled for this workspace.')
    return
  }
  void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(storage.getStorageRoot()))
}

/**
 * Rebuild the index, then package the folder into a .zip the participant can
 * send. Uses a platform-native compressor; if none succeeds, reveals the folder
 * with instructions to compress it manually.
 */
export async function packageStudyData(storage: StudyStorage | null): Promise<void> {
  if (!storage) {
    void vscode.window.showWarningMessage('Agent Fruitstand: study capture is not enabled for this workspace.')
    return
  }
  // Index the current workspace's capture root, but zip the packaging root —
  // the shared capture home — so every workspace's data ships in one archive
  // (nothing is lost if the participant worked across several projects).
  const captureRoot = storage.getStorageRoot()
  const packageRoot = storage.getPackagingRoot()

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Agent Fruitstand: packaging study data…' },
    async () => {
      // Flush live capture to disk and rebuild the index so the zip is current.
      // Deliberately NOT dispose() — the participant keeps working after
      // packaging, so ending/finalizing their live sessions here would corrupt
      // the ongoing capture (mislabeled sessions + a truncated study slice).
      storage.flushForPackaging()
      // Refresh the derived SQLite index when this Node build supports it
      // (node:sqlite, >= 22.5). The VS Code extension host ships an older Node,
      // so this is normally skipped — the raw JSONL is the authoritative source
      // of truth and the index can be rebuilt from it. When we CAN'T refresh it,
      // strip any pre-existing (now-stale) index so the zip never ships
      // misleading derived data next to the fresh raw capture.
      if (isSqliteAvailable()) {
        try {
          buildIndex(captureRoot)
        } catch (err) {
          // A failed rebuild can leave a freshly-created but empty/partial
          // study.sqlite on disk; strip it (and any other workspace's stale
          // index under the packaging root) so the zip never ships misleading
          // derived data. Raw JSONL remains the source of truth.
          log.debug('index rebuild failed; stripping stale index:', err)
          removeStaleIndexes(packageRoot)
        }
      } else {
        removeStaleIndexes(packageRoot)
      }

      const defaultZip = vscode.Uri.file(path.join(path.dirname(packageRoot), 'agent-flow-study-data.zip'))
      const dest = await vscode.window.showSaveDialog({ defaultUri: defaultZip, filters: { Zip: ['zip'] } })
      if (!dest) return

      const zipped = await zipFolder(packageRoot, dest.fsPath)
      if (zipped) {
        const pick = await vscode.window.showInformationMessage(
          `Study data packaged: ${dest.fsPath}\nSend this zip to the researchers.`,
          'Reveal in Finder',
        )
        if (pick) void vscode.commands.executeCommand('revealFileInOS', dest)
      } else {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(packageRoot))
        void vscode.window.showInformationMessage(
          'Agent Fruitstand: could not auto-zip. Please compress the revealed capture folder and send the zip to the researchers.',
        )
      }
    },
  )
}

/**
 * Delete any derived `study.sqlite` (and its -wal/-shm siblings) under the
 * packaging root when we can't rebuild it this run. buildIndex writes the index
 * into each per-workspace storage root (a subfolder of the packaging home), so
 * sweep the home and its immediate children. Best-effort; the raw JSONL is the
 * source of truth, so a missing index is always safe.
 */
function removeStaleIndexes(packageRoot: string): void {
  const roots = [packageRoot]
  try {
    for (const e of fs.readdirSync(packageRoot, { withFileTypes: true })) {
      if (e.isDirectory()) roots.push(path.join(packageRoot, e.name))
    }
  } catch { /* home not readable — nothing to sweep */ }
  for (const root of roots) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(path.join(root, 'study.sqlite' + suffix)) } catch { /* not present */ }
    }
  }
}

/** Best-effort cross-platform folder → zip. Returns false if it couldn't. */
async function zipFolder(srcDir: string, destZip: string): Promise<boolean> {
  const parent = path.dirname(srcDir)
  const base = path.basename(srcDir)
  // Overwrite any existing archive at this path. Info-ZIP `zip` (Linux) ADDS into
  // an existing archive instead of replacing it, so re-packaging after a
  // participant deleted a session for redaction would still ship the deleted
  // data. Removing the destination first makes every platform produce a clean,
  // current archive that reflects exactly what's on disk now.
  try { fs.rmSync(destZip, { force: true }) } catch { /* nothing to remove */ }
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', srcDir, destZip])
    } else if (process.platform === 'win32') {
      // Pass the paths as environment variables rather than interpolating them
      // into the -Command string, so a path containing a quote or other
      // PowerShell metacharacter can't break (or inject into) the command.
      // -LiteralPath (not -Path): -Path treats the source as a wildcard pattern,
      // so a capture path containing PowerShell glob metacharacters ([ ] * ?) —
      // legal in Windows dir names — would match nothing and fail the zip.
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Compress-Archive -LiteralPath $env:AFS_SRC -DestinationPath $env:AFS_DEST -Force',
      ], { env: { ...process.env, AFS_SRC: srcDir, AFS_DEST: destZip } })
    } else {
      // Linux and friends: zip the folder relative to its parent so the archive
      // contains study-storage/ as its top-level entry.
      await execFileAsync('zip', ['-r', '-q', destZip, base], { cwd: parent })
    }
    return true
  } catch (err) {
    log.debug('native zip failed:', err)
    return false
  }
}

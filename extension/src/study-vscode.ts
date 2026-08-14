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
      // Flush the live sessions and rebuild the index so the zip is current.
      storage.dispose()
      if (isSqliteAvailable()) {
        try { buildIndex(captureRoot) } catch (err) { log.debug('index rebuild failed:', err) }
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

/** Best-effort cross-platform folder → zip. Returns false if it couldn't. */
async function zipFolder(srcDir: string, destZip: string): Promise<boolean> {
  const parent = path.dirname(srcDir)
  const base = path.basename(srcDir)
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', srcDir, destZip])
    } else if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-Command',
        `Compress-Archive -Path "${srcDir}" -DestinationPath "${destZip}" -Force`,
      ])
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

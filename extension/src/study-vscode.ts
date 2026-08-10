/**
 * VS Code glue for the research capture (Phase 3).
 *
 *  - setupStudyStorage(): reads settings, gates on informed consent, and returns
 *    a ready StudyStorage (or null when disabled/declined/no-workspace).
 *  - revealStudyFolder(): open the capture folder in the OS file explorer.
 *  - packageStudyData(): rebuild the index, then zip the folder for the
 *    participant to send (best-effort native zip; falls back to reveal).
 *
 * Capture is off unless `agentVisualizer.studyStorage.enabled` is true AND the
 * participant has consented. Nothing ever leaves the machine automatically.
 */
import * as vscode from 'vscode'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

import { StudyStorage } from './study-storage'
import { buildIndex, isSqliteAvailable } from './study-index'
import { createLogger } from './logger'

const log = createLogger('StudyStorage')
const execFileAsync = promisify(execFile)

const CONSENT_KEY = 'studyStorage.consent'

/** Build the capture sink from settings + consent. Returns null when disabled. */
export async function setupStudyStorage(context: vscode.ExtensionContext): Promise<StudyStorage | null> {
  const cfg = vscode.workspace.getConfiguration('agentVisualizer')
  if (!cfg.get<boolean>('studyStorage.enabled', false)) return null

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace) {
    log.info('Study capture enabled but no workspace folder — skipping (capture is per-project).')
    return null
  }

  // Informed consent, scoped to this workspace (per-project capture).
  const consent = context.workspaceState.get<string>(CONSENT_KEY)
  if (consent !== 'granted') {
    if (consent === 'declined') return null // don't re-nag; use the command to enable later
    const choice = await vscode.window.showInformationMessage(
      'Agent Flow — research capture',
      {
        modal: true,
        detail:
          'This research build saves full local copies of your Claude Code sessions for this project — including your prompts, the model\'s output, file contents, and command output — under a "study-storage/" folder, so you can share them with the study researchers.\n\nNothing is uploaded anywhere automatically. You choose when to package and send. You can review or delete any session before sharing.',
      },
      'Enable capture', "Don't capture",
    )
    if (choice === 'Enable capture') {
      await context.workspaceState.update(CONSENT_KEY, 'granted')
    } else {
      await context.workspaceState.update(CONSENT_KEY, 'declined')
      return null
    }
  }

  const configuredPath = cfg.get<string>('studyStorage.path', '')
  const storageRoot = configuredPath
    ? path.resolve(workspace, configuredPath)
    : path.join(workspace, 'study-storage')

  const storage = new StudyStorage({
    storageRoot,
    workspaceRoot: workspace,
    participantId: cfg.get<string>('studyStorage.participantId', '') || undefined,
    toolVersion: context.extension?.packageJSON?.version,
  })
  storage.init()
  log.info(`Study capture enabled → ${storageRoot}`)
  return storage
}

/** Reveal the capture folder in the OS file explorer. */
export function revealStudyFolder(storage: StudyStorage | null): void {
  if (!storage) {
    void vscode.window.showWarningMessage('Agent Flow: study capture is not enabled for this workspace.')
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
    void vscode.window.showWarningMessage('Agent Flow: study capture is not enabled for this workspace.')
    return
  }
  const root = storage.getStorageRoot()

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Agent Flow: packaging study data…' },
    async () => {
      // Flush the live sessions and rebuild the index so the zip is current.
      storage.dispose()
      if (isSqliteAvailable()) {
        try { buildIndex(root) } catch (err) { log.debug('index rebuild failed:', err) }
      }

      const defaultZip = vscode.Uri.file(path.join(path.dirname(root), 'study-storage.zip'))
      const dest = await vscode.window.showSaveDialog({ defaultUri: defaultZip, filters: { Zip: ['zip'] } })
      if (!dest) return

      const zipped = await zipFolder(root, dest.fsPath)
      if (zipped) {
        const pick = await vscode.window.showInformationMessage(
          `Study data packaged: ${dest.fsPath}\nSend this zip to the researchers.`,
          'Reveal in Finder',
        )
        if (pick) void vscode.commands.executeCommand('revealFileInOS', dest)
      } else {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(root))
        void vscode.window.showInformationMessage(
          'Agent Flow: could not auto-zip. Please compress the revealed "study-storage" folder and send the zip to the researchers.',
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

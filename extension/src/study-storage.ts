/**
 * StudyStorage — Phase 1 of the research logging system.
 *
 * Captures the MAXIMUM amount of non-ephemeral, per-session ("per-tab") data into
 * a single local folder that a study participant can zip and hand to researchers.
 * Full design: docs/logging-system-scope.md · format: docs/study-storage-format.md
 *
 * Phase 1 scope (this file):
 *   - One folder per session under  <root>/live/sessions/<runtime>-<sessionId>/
 *   - transcript.jsonl        verbatim byte-for-byte copy of the source JSONL
 *   - subagents/, tool-results/  verbatim copies of the session's sidecar files
 *   - hooks.jsonl             raw Claude Code hook payloads (live-only signal)
 *   - events.jsonl            the normalized AgentEvent stream (as rendered)
 *   - session.json            per-session metadata
 *   - environment.json        host/runtime snapshot
 *   - plus top-level MANIFEST.json, README.md, and a .gitignore entry
 *
 * Deferred to later phases: study.sqlite index, backfill importer, extension UX.
 *
 * Design rules:
 *   - Source of truth is the raw byte-for-byte copies; everything else is derived.
 *   - NEVER throw into the caller. Capture is a passive sink on top of the
 *     visualizer's data flow; a failure here must not disturb the live view.
 *   - Append-only writes + idempotent file mirroring so a crash loses at most the
 *     last unflushed line and re-syncing never corrupts the copy.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

import type { AgentEvent } from './protocol'

export type StudyRuntime = 'claude' | 'codex'

export interface StudyStorageOptions {
  /** Root of the capture folder, e.g. <workspace>/study-storage */
  storageRoot: string
  /** The project/workspace this capture belongs to */
  workspaceRoot: string
  /** Study-assigned participant id (not PII). Defaults to 'anonymous'. */
  participantId?: string
  /** agent-flow version string, recorded in the manifest. */
  toolVersion?: string
  /** Emit warnings to the console on capture errors. */
  verbose?: boolean
}

/** The current on-disk schema version for study-storage. */
const SCHEMA_VERSION = 1

interface SyncedFile { hash: string }

interface SessionRec {
  runtime: StudyRuntime
  dir: string
  /** Source main transcript file (Claude only). undefined for events/hooks-only. */
  mainFilePath?: string
  /** Source sidecar dir (`<projectDir>/<sessionId>/`), holds subagents/ + tool-results/. */
  sourceSidecarDir?: string
  /** Per-source-file content-hash cache so mirroring only copies changed files. */
  synced: Map<string, SyncedFile>
  startedAt: string
  /** True once finalized (status=completed); a resume flips this back to active. */
  finalized?: boolean
}

export class StudyStorage {
  private readonly root: string
  private readonly workspaceRoot: string
  private readonly participantId: string
  private readonly toolVersion: string
  private readonly verbose: boolean

  private readonly liveSessionsDir: string
  private readonly backfillSessionsDir: string
  private readonly manifestPath: string

  private readonly sessions = new Map<string, SessionRec>()
  private initialized = false

  constructor(opts: StudyStorageOptions) {
    this.root = opts.storageRoot
    this.workspaceRoot = opts.workspaceRoot
    this.participantId = opts.participantId || 'anonymous'
    this.toolVersion = opts.toolVersion || '0.0.0'
    this.verbose = opts.verbose ?? false
    this.liveSessionsDir = path.join(this.root, 'live', 'sessions')
    this.backfillSessionsDir = path.join(this.root, 'backfill', 'sessions')
    this.manifestPath = path.join(this.root, 'MANIFEST.json')
  }

  private warn(...args: unknown[]) {
    if (this.verbose) console.warn('[study-storage]', ...args)
  }

  /** Absolute path to the capture root (for the indexer). */
  getStorageRoot(): string {
    return this.root
  }

  /** Create the folder skeleton, README, MANIFEST, and .gitignore entry. Idempotent. */
  init(): void {
    if (this.initialized) return
    try {
      fs.mkdirSync(this.liveSessionsDir, { recursive: true })
      this.writeReadme()
      this.writeManifest()
      this.ensureGitignored()
      this.initialized = true
      this.warn(`initialized at ${this.root}`)
    } catch (e) {
      this.warn('init failed:', e)
    }
  }

  // ─── Session registration ───────────────────────────────────────────────

  /**
   * Ensure a session folder exists (creating metadata files on first sight).
   * Safe to call repeatedly and from any tap; returns the session record.
   */
  private ensureSession(sessionId: string, runtime: StudyRuntime): SessionRec | null {
    if (!this.initialized) this.init()
    let rec = this.sessions.get(sessionId)
    if (rec) return rec
    try {
      const dir = path.join(this.liveSessionsDir, `${runtime}-${sessionId}`)
      fs.mkdirSync(dir, { recursive: true })
      rec = { runtime, dir, synced: new Map(), startedAt: new Date().toISOString() }
      this.sessions.set(sessionId, rec)
      this.writeEnvironment(rec)
      this.writeSessionMeta(sessionId, rec, 'active')
      this.writeManifest()
      this.warn(`session ${sessionId.slice(0, 8)} (${runtime}) → ${dir}`)
      return rec
    } catch (e) {
      this.warn('ensureSession failed:', e)
      return null
    }
  }

  /**
   * Register a live Claude session with its source files and do an initial raw
   * mirror. Call from the watcher as soon as a session is picked up.
   */
  registerClaudeSession(sessionId: string, mainFilePath: string): void {
    const rec = this.ensureSession(sessionId, 'claude')
    if (!rec) return
    this.reactivateIfFinalized(sessionId, rec)
    rec.mainFilePath = mainFilePath
    // The sidecar dir sits next to the main file, named after the session id.
    rec.sourceSidecarDir = path.join(path.dirname(mainFilePath), sessionId)
    this.syncClaudeSession(sessionId)
  }

  /** Register a Codex session (events-only in Phase 1; raw rollout mirror is deferred). */
  registerCodexSession(sessionId: string): void {
    const rec = this.ensureSession(sessionId, 'codex')
    if (rec) this.reactivateIfFinalized(sessionId, rec)
  }

  /**
   * If a resumed session was previously finalized, flip its metadata back to
   * active and clear endedAt. Registration is the deliberate "live again" signal
   * (stray taps must not reactivate), so this only runs from the register paths.
   */
  private reactivateIfFinalized(sessionId: string, rec: SessionRec): void {
    if (!rec.finalized) return
    rec.finalized = false
    this.writeSessionMeta(sessionId, rec, 'active')
    this.warn(`session ${sessionId.slice(0, 8)} resumed → active`)
  }

  // ─── Backfill (historical import) ────────────────────────────────────────

  /**
   * One-shot import of a historical Claude session into the backfill/ tree.
   * Copies the raw transcript + sidecar files verbatim; does NOT create
   * hooks.jsonl or events.jsonl (both are live-only signals). Idempotent:
   * skipped if the session was already captured live or previously imported.
   * Returns true if it imported, false if skipped.
   */
  backfillClaudeSession(sessionId: string, mainFilePath: string): boolean {
    if (!this.initialized) this.init()
    try {
      // Never shadow a live capture, and don't re-import.
      if (fs.existsSync(path.join(this.liveSessionsDir, `claude-${sessionId}`))) return false
      const dir = path.join(this.backfillSessionsDir, `claude-${sessionId}`)
      if (fs.existsSync(path.join(dir, 'transcript.jsonl'))) return false

      let stat: fs.Stats
      try { stat = fs.statSync(mainFilePath) } catch { return false }
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(mainFilePath, path.join(dir, 'transcript.jsonl'))

      const sidecar = path.join(path.dirname(mainFilePath), sessionId)
      if (fs.existsSync(sidecar)) this.copyTree(sidecar, dir, sidecar)

      const startedAt = new Date(stat.birthtimeMs || stat.ctimeMs).toISOString()
      const endedAt = new Date(stat.mtimeMs).toISOString()
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
        id: sessionId, source: 'backfill', runtime: 'claude', projectPath: this.workspaceRoot,
        startedAt, endedAt, status: 'completed', schemaVersion: SCHEMA_VERSION,
      }, null, 2) + '\n')
      fs.writeFileSync(path.join(dir, 'environment.json'), JSON.stringify({
        os: os.platform(), arch: os.arch(), nodeVersion: process.version,
        toolVersion: this.toolVersion, runtime: 'claude', importedAt: new Date().toISOString(),
        note: 'backfill import — transcript timings reflect file birth/modify times',
      }, null, 2) + '\n')
      this.warn(`backfilled ${sessionId.slice(0, 8)} → ${dir}`)
      return true
    } catch (e) {
      this.warn('backfillClaudeSession failed:', e)
      return false
    }
  }

  /** Recursively copy a directory tree verbatim (used by backfill). */
  private copyTree(srcDir: string, destBase: string, srcRoot: string): void {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(srcDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name)
      if (entry.isDirectory()) {
        this.copyTree(src, destBase, srcRoot)
      } else if (entry.isFile()) {
        const dest = path.join(destBase, path.relative(srcRoot, src))
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      }
    }
  }

  // ─── Raw file mirroring (Claude) ─────────────────────────────────────────

  /**
   * Copy any changed source files for a Claude session into its folder:
   *   transcript.jsonl  ← <projectDir>/<sessionId>.jsonl
   *   subagents/**      ← <projectDir>/<sessionId>/subagents/**
   *   tool-results/**   ← <projectDir>/<sessionId>/tool-results/**
   * Idempotent: only files whose contents changed (by hash) are re-copied.
   */
  syncClaudeSession(sessionId: string): void {
    const rec = this.sessions.get(sessionId)
    if (!rec || !rec.mainFilePath) return
    try {
      this.mirrorFile(rec, rec.mainFilePath, path.join(rec.dir, 'transcript.jsonl'))
      if (rec.sourceSidecarDir && fs.existsSync(rec.sourceSidecarDir)) {
        this.mirrorTree(rec, rec.sourceSidecarDir, rec.dir)
      }
    } catch (e) {
      this.warn('syncClaudeSession failed:', e)
    }
  }

  /**
   * Copy one file if its contents changed since last sync (keyed by source path).
   * Uses a full content hash rather than size+mtime: this is a research capture
   * where fidelity beats throughput, so we accept re-reading each file every tick
   * in exchange for never missing an in-place, same-length rewrite. Reading the
   * buffer once (and writing that exact buffer) also avoids a stat/copy race.
   */
  private mirrorFile(rec: SessionRec, src: string, dest: string): void {
    let buf: Buffer
    try { buf = fs.readFileSync(src) } catch { return }
    const hash = crypto.createHash('sha1').update(buf).digest('hex')
    const prev = rec.synced.get(src)
    if (prev && prev.hash === hash) return
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    rec.synced.set(src, { hash })
  }

  /** Recursively mirror a directory tree (subagents/, tool-results/, …). */
  private mirrorTree(rec: SessionRec, srcDir: string, destBase: string): void {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(srcDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name)
      const rel = path.relative(rec.sourceSidecarDir!, src)
      const dest = path.join(destBase, rel)
      if (entry.isDirectory()) {
        this.mirrorTree(rec, src, destBase)
      } else if (entry.isFile()) {
        this.mirrorFile(rec, src, dest)
      }
    }
  }

  // ─── Event & hook taps ───────────────────────────────────────────────────

  /**
   * Append a normalized AgentEvent to the session's events.jsonl.
   * By default this only writes for already-registered sessions (so a stray
   * event can't create a mislabeled folder); pass ensureRuntime to create the
   * folder lazily for a source whose runtime is known (e.g. hook events).
   */
  appendEvent(event: AgentEvent, ensureRuntime?: StudyRuntime): void {
    const sessionId = event.sessionId
    if (!sessionId) return
    let rec = this.sessions.get(sessionId)
    if (!rec && ensureRuntime) rec = this.ensureSession(sessionId, ensureRuntime) || undefined
    if (!rec) return
    this.appendJsonl(path.join(rec.dir, 'events.jsonl'), event)
  }

  /** Append a raw Claude Code hook payload to the session's hooks.jsonl. */
  appendRawHook(payload: Record<string, unknown>): void {
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : undefined
    if (!sessionId) return
    const rec = this.ensureSession(sessionId, 'claude')
    if (!rec) return
    // Stamp an arrival wall-clock time; hooks carry no timestamp of their own.
    const line = { capturedAt: new Date().toISOString(), ...payload }
    this.appendJsonl(path.join(rec.dir, 'hooks.jsonl'), line)
  }

  private appendJsonl(file: string, obj: unknown): void {
    try {
      fs.appendFileSync(file, JSON.stringify(obj) + '\n')
    } catch (e) {
      this.warn('append failed:', file, e)
    }
  }

  // ─── Finalization ──────────────────────────────────────────────────────

  /** Mark a session complete: final raw sync + update session.json. */
  finalizeSession(sessionId: string): void {
    const rec = this.sessions.get(sessionId)
    if (!rec) return
    this.syncClaudeSession(sessionId)
    this.writeSessionMeta(sessionId, rec, 'completed')
    rec.finalized = true
  }

  dispose(): void {
    // Best-effort final sync of every live session so nothing is left behind.
    for (const [sessionId, rec] of this.sessions) {
      try {
        this.syncClaudeSession(sessionId)
        this.writeSessionMeta(sessionId, rec, 'completed')
        rec.finalized = true
      } catch { /* ignore on shutdown */ }
    }
  }

  // ─── Metadata files ──────────────────────────────────────────────────────

  private writeSessionMeta(sessionId: string, rec: SessionRec, status: 'active' | 'completed'): void {
    const meta = {
      id: sessionId,
      source: 'live' as const,
      runtime: rec.runtime,
      projectPath: this.workspaceRoot,
      startedAt: rec.startedAt,
      endedAt: status === 'completed' ? new Date().toISOString() : null,
      status,
      schemaVersion: SCHEMA_VERSION,
    }
    try {
      fs.writeFileSync(path.join(rec.dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n')
    } catch (e) {
      this.warn('writeSessionMeta failed:', e)
    }
  }

  private writeEnvironment(rec: SessionRec): void {
    const env = {
      os: os.platform(),
      arch: os.arch(),
      release: os.release(),
      nodeVersion: process.version,
      toolVersion: this.toolVersion,
      runtime: rec.runtime,
      codexHome: process.env.CODEX_HOME || null,
      capturedAt: rec.startedAt,
    }
    try {
      fs.writeFileSync(path.join(rec.dir, 'environment.json'), JSON.stringify(env, null, 2) + '\n')
    } catch (e) {
      this.warn('writeEnvironment failed:', e)
    }
  }

  private writeManifest(): void {
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      tool: 'agent-flow',
      toolVersion: this.toolVersion,
      participantId: this.participantId,
      consent: true,
      machineId: crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16),
      os: os.platform(),
      arch: os.arch(),
      captureStartedAt: this.captureStartedAt(),
      sessionCount: this.sessions.size,
    }
    try {
      fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    } catch (e) {
      this.warn('writeManifest failed:', e)
    }
  }

  /** Preserve the original capture start time across manifest rewrites. */
  private captureStartedAt(): string {
    try {
      const prev = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
      if (typeof prev.captureStartedAt === 'string') return prev.captureStartedAt
    } catch { /* first write */ }
    return new Date().toISOString()
  }

  private writeReadme(): void {
    const readmePath = path.join(this.root, 'README.md')
    if (fs.existsSync(readmePath)) return
    fs.writeFileSync(readmePath, README_TEMPLATE)
  }

  /** Add `study-storage/` to the workspace .gitignore if not already present. */
  private ensureGitignored(): void {
    try {
      const rel = path.relative(this.workspaceRoot, this.root)
      // Only manage the ignore rule when the folder is inside the workspace.
      if (rel.startsWith('..') || path.isAbsolute(rel)) return
      const entry = rel.split(path.sep).join('/') + '/'
      const giPath = path.join(this.workspaceRoot, '.gitignore')
      let current = ''
      try { current = fs.readFileSync(giPath, 'utf-8') } catch { /* no .gitignore yet */ }
      const has = current.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ''))
      if (has) return
      const prefix = current.length && !current.endsWith('\n') ? '\n' : ''
      fs.appendFileSync(giPath, `${prefix}\n# Agent Flow study capture (local research data — do not commit)\n${entry}\n`)
    } catch (e) {
      this.warn('ensureGitignored failed:', e)
    }
  }
}

const README_TEMPLATE = `# Agent Flow — study-storage

This folder is a local, self-contained capture of your Claude Code / Codex agent
sessions, produced by the Agent Flow research build. Each session (each visualizer
"tab") is stored under \`live/sessions/<runtime>-<session-id>/\`.

## What's inside a session folder

- \`transcript.jsonl\`  — verbatim copy of the raw agent transcript (source of truth)
- \`subagents/\`        — verbatim subagent transcripts + \`.meta.json\` sidecars
- \`tool-results/\`     — verbatim large tool outputs referenced by the transcript
- \`hooks.jsonl\`       — raw Claude Code hook payloads (permission prompts, failures, timing)
- \`events.jsonl\`      — the normalized event stream the visualizer rendered
- \`session.json\`      — session metadata
- \`environment.json\`  — OS / runtime snapshot

\`MANIFEST.json\` at the top records the participant id, tool version, and capture window.

## How to send your data to the researchers

1. Zip this entire \`study-storage/\` folder.
2. Send the zip through the channel the researchers gave you.

Everything needed to read the data is inside the zip — no server or account.

> Note: these files contain the full content of your sessions (your prompts, the
> model's output, file contents, command output). Review before sending; you can
> delete any session folder you don't want to share.
`

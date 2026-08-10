/**
 * StudyIndex — Phase 2 of the research logging system.
 *
 * Builds `study.sqlite`, a single-file SQLite index over every captured session
 * (live/ + backfill/), so researchers can query with plain SQL / pandas without
 * walking the raw JSONL. The raw files remain the source of truth; this index is
 * a derived convenience and is rebuilt from scratch on every run (idempotent).
 *
 * Full design + schema: docs/logging-system-scope.md · docs/study-storage-format.md
 *
 * Deliberately DECOUPLED from live capture:
 *   - Uses Node's built-in `node:sqlite` (Node >= 22.5), so no native dependency
 *     and the output is a standard, portable SQLite file.
 *   - Never runs on the live-capture hot path; call buildIndex() on demand
 *     (CLI, or best-effort at relay shutdown). Phase 1 capture keeps working on
 *     older Node even when indexing is unavailable.
 *
 * Scope note: Claude sessions only (Codex is intentionally out of scope for now).
 */
import * as fs from 'fs'
import * as path from 'path'

// node:sqlite is a Node builtin (>=22.5) not yet in @types/node@20, so we load it
// via require with a minimal local interface rather than depend on ambient types.
type SqlParam = string | number | bigint | null | Uint8Array
interface SqlStatement { run(...params: SqlParam[]): unknown }
interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}
interface SqliteModule { DatabaseSync: new (filename: string) => SqlDatabase }

/** True when this Node build exposes node:sqlite (>= 22.5). */
export function isSqliteAvailable(): boolean {
  try { require('node:sqlite'); return true } catch { return false }
}

function loadSqlite(): SqliteModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:sqlite') as SqliteModule
}

export interface IndexResult {
  dbPath: string
  sessions: number
  agents: number
  turns: number
  toolCalls: number
  hookEvents: number
  events: number
  files: number
}

const SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT,               -- 'live' | 'backfill'
  runtime TEXT,
  project_path TEXT,
  git_branch TEXT,
  cc_version TEXT,
  ai_title TEXT,
  started_at TEXT,
  ended_at TEXT,
  status TEXT,
  folder_path TEXT,
  turn_count INTEGER,
  tool_call_count INTEGER,
  subagent_count INTEGER,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cache_read_tokens INTEGER,
  total_cache_creation_tokens INTEGER
);
CREATE TABLE agents (
  session_id TEXT,
  id TEXT,                   -- 'orchestrator' | 'agent-<id>'
  parent_agent_id TEXT,
  agent_type TEXT,
  description TEXT,
  spawn_depth INTEGER,
  model TEXT,
  PRIMARY KEY (session_id, id)
);
CREATE TABLE turns (
  session_id TEXT,
  uuid TEXT,
  agent_id TEXT,
  parent_uuid TEXT,
  role TEXT,
  model TEXT,
  timestamp TEXT,
  stop_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  text_content TEXT,
  thinking_content TEXT,
  raw_json TEXT,
  PRIMARY KEY (session_id, uuid)
);
CREATE TABLE tool_calls (
  session_id TEXT,
  tool_use_id TEXT,
  agent_id TEXT,
  turn_uuid TEXT,
  tool_name TEXT,
  input_json TEXT,
  result_text TEXT,
  is_error INTEGER,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (session_id, tool_use_id)
);
CREATE TABLE hook_events (
  session_id TEXT,
  seq INTEGER,
  hook_event_name TEXT,
  timestamp TEXT,
  payload_json TEXT
);
CREATE TABLE events (
  session_id TEXT,
  seq INTEGER,
  time REAL,
  type TEXT,
  payload_json TEXT
);
CREATE TABLE files (
  session_id TEXT,
  path TEXT,
  operation TEXT,
  agent_id TEXT,
  turn_uuid TEXT,
  timestamp TEXT
);
CREATE INDEX idx_turns_session ON turns(session_id);
CREATE INDEX idx_turns_ts ON turns(timestamp);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX idx_hook_events_session ON hook_events(session_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_files_session ON files(session_id);
`

// ─── Parsing helpers ────────────────────────────────────────────────────────

type Json = Record<string, any>

function readJsonlLines(file: string): Json[] {
  let raw: string
  try { raw = fs.readFileSync(file, 'utf-8') } catch { return [] }
  const out: Json[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* skip malformed */ }
  }
  return out
}

/** Map a tool name to a coarse file operation for the `files` table. */
function fileOperation(toolName: string): string | null {
  switch (toolName) {
    case 'Read': case 'NotebookRead': return 'read'
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit'
    case 'Write': return 'write'
    default: return null
  }
}

interface ParsedSession {
  id: string
  source: string
  runtime: string
  status: string
  folderPath: string
  startedAt: string | null
  endedAt: string | null
  projectPath: string | null
  gitBranch: string | null
  ccVersion: string | null
  aiTitle: string | null
  agents: Array<{ id: string; parent: string | null; type: string | null; description: string | null; spawnDepth: number | null; model: string | null }>
  turns: Array<any>
  toolCalls: Map<string, any>
  files: Array<any>
  hookEvents: Json[]
  events: Json[]
  totals: { input: number; output: number; cacheRead: number; cacheCreate: number }
}

function blockText(content: any, kind: 'text' | 'thinking'): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b && b.type === kind && typeof b[kind] === 'string') parts.push(b[kind])
    if (b && b.type === 'text' && kind === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

/** Parse one Claude transcript file, attributing rows to a given agent id. */
function parseTranscript(lines: Json[], sess: ParsedSession, agentId: string) {
  const seenTurns = new Set<string>()
  let turnSeq = 0
  for (const entry of lines) {
    const type = entry.type
    // Session-level metadata harvested opportunistically.
    if (type === 'ai-title' && typeof entry.aiTitle === 'string') sess.aiTitle = entry.aiTitle
    if (typeof entry.cwd === 'string' && !sess.projectPath) sess.projectPath = entry.cwd
    if (typeof entry.gitBranch === 'string' && !sess.gitBranch) sess.gitBranch = entry.gitBranch
    if (typeof entry.version === 'string' && !sess.ccVersion) sess.ccVersion = entry.version

    if (type !== 'user' && type !== 'assistant') continue
    const msg = entry.message
    if (!msg || typeof msg !== 'object') continue

    const ts: string | null = typeof entry.timestamp === 'string' ? entry.timestamp : null
    if (ts) {
      if (!sess.startedAt || ts < sess.startedAt) sess.startedAt = ts
      if (!sess.endedAt || ts > sess.endedAt) sess.endedAt = ts
    }

    const uuid: string = typeof entry.uuid === 'string' ? entry.uuid : `${agentId}:${turnSeq++}`
    const usage = msg.usage || {}
    const inTok = Number(usage.input_tokens) || 0
    const outTok = Number(usage.output_tokens) || 0
    const cacheRead = Number(usage.cache_read_input_tokens) || 0
    const cacheCreate = Number(usage.cache_creation_input_tokens) || 0
    sess.totals.input += inTok
    sess.totals.output += outTok
    sess.totals.cacheRead += cacheRead
    sess.totals.cacheCreate += cacheCreate

    if (!seenTurns.has(uuid)) {
      seenTurns.add(uuid)
      sess.turns.push({
        session_id: sess.id, uuid, agent_id: agentId,
        parent_uuid: typeof entry.parentUuid === 'string' ? entry.parentUuid : null,
        role: msg.role || type,
        model: typeof msg.model === 'string' ? msg.model : null,
        timestamp: ts,
        stop_reason: typeof msg.stop_reason === 'string' ? msg.stop_reason : null,
        input_tokens: inTok, output_tokens: outTok,
        cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate,
        text_content: blockText(msg.content, 'text') || (typeof msg.content === 'string' ? msg.content : ''),
        thinking_content: blockText(msg.content, 'thinking'),
        raw_json: JSON.stringify(entry),
      })
    }

    // Tool calls (starts) and their file touches.
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'tool_use' && typeof b.id === 'string') {
          const existing = sess.toolCalls.get(b.id)
          sess.toolCalls.set(b.id, {
            session_id: sess.id, tool_use_id: b.id, agent_id: agentId, turn_uuid: uuid,
            tool_name: typeof b.name === 'string' ? b.name : 'unknown',
            input_json: JSON.stringify(b.input ?? null),
            result_text: existing?.result_text ?? null,
            is_error: existing?.is_error ?? 0,
            started_at: ts, ended_at: existing?.ended_at ?? null,
          })
          const op = fileOperation(typeof b.name === 'string' ? b.name : '')
          const fp = b.input && typeof b.input.file_path === 'string' ? b.input.file_path
            : b.input && typeof b.input.notebook_path === 'string' ? b.input.notebook_path : null
          if (op && fp) {
            sess.files.push({ session_id: sess.id, path: fp, operation: op, agent_id: agentId, turn_uuid: uuid, timestamp: ts })
          }
        }
        // Tool results (arrive on later user turns) resolve the pending call.
        if (b && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const prev = sess.toolCalls.get(b.tool_use_id) || {
            session_id: sess.id, tool_use_id: b.tool_use_id, agent_id: agentId, turn_uuid: null,
            tool_name: 'unknown', input_json: null, started_at: null,
          }
          let text = ''
          if (typeof b.content === 'string') text = b.content
          else if (Array.isArray(b.content)) text = b.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          prev.result_text = text.slice(0, 100000)
          prev.is_error = b.is_error ? 1 : 0
          prev.ended_at = ts
          sess.toolCalls.set(b.tool_use_id, prev)
        }
      }
    }
  }
}

function parseSessionFolder(folder: string): ParsedSession | null {
  let meta: Json = {}
  try { meta = JSON.parse(fs.readFileSync(path.join(folder, 'session.json'), 'utf-8')) } catch { /* infer below */ }
  const id = typeof meta.id === 'string' ? meta.id : path.basename(folder).replace(/^claude-/, '')

  const sess: ParsedSession = {
    id,
    source: typeof meta.source === 'string' ? meta.source : (folder.includes(`${path.sep}backfill${path.sep}`) ? 'backfill' : 'live'),
    runtime: typeof meta.runtime === 'string' ? meta.runtime : 'claude',
    status: typeof meta.status === 'string' ? meta.status : 'completed',
    folderPath: folder,
    startedAt: null, endedAt: null,
    projectPath: typeof meta.projectPath === 'string' ? meta.projectPath : null,
    gitBranch: null, ccVersion: null, aiTitle: null,
    agents: [{ id: 'orchestrator', parent: null, type: 'orchestrator', description: null, spawnDepth: 0, model: null }],
    turns: [], toolCalls: new Map(), files: [], hookEvents: [], events: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  }

  // Main transcript → orchestrator.
  parseTranscript(readJsonlLines(path.join(folder, 'transcript.jsonl')), sess, 'orchestrator')

  // Subagents → one agent per file, named by its meta sidecar.
  const subDir = path.join(folder, 'subagents')
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir)) {
      if (!f.endsWith('.jsonl')) continue
      const agentId = path.basename(f, '.jsonl')
      let sidecar: Json = {}
      try { sidecar = JSON.parse(fs.readFileSync(path.join(subDir, `${agentId}.meta.json`), 'utf-8')) } catch { /* none */ }
      sess.agents.push({
        id: agentId, parent: 'orchestrator',
        type: typeof sidecar.agentType === 'string' ? sidecar.agentType : null,
        description: typeof sidecar.description === 'string' ? sidecar.description : null,
        spawnDepth: typeof sidecar.spawnDepth === 'number' ? sidecar.spawnDepth : 1,
        model: null,
      })
      parseTranscript(readJsonlLines(path.join(subDir, f)), sess, agentId)
    }
  }

  // Model per agent: first model seen on that agent's turns.
  for (const agent of sess.agents) {
    const t = sess.turns.find((x) => x.agent_id === agent.id && x.model)
    if (t) agent.model = t.model
  }

  sess.hookEvents = readJsonlLines(path.join(folder, 'hooks.jsonl'))
  sess.events = readJsonlLines(path.join(folder, 'events.jsonl'))
  return sess
}

// ─── Public entry point ───────────────────────────────────────────────────

/** List every session folder under live/ and backfill/. */
function listSessionFolders(storageRoot: string): string[] {
  const out: string[] = []
  for (const source of ['live', 'backfill']) {
    const dir = path.join(storageRoot, source, 'sessions')
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      try { if (fs.statSync(p).isDirectory()) out.push(p) } catch { /* skip */ }
    }
  }
  return out
}

/**
 * Rebuild `study.sqlite` from every captured session under `storageRoot`.
 * Throws if node:sqlite is unavailable (Node < 22.5).
 */
export function buildIndex(storageRoot: string, opts: { verbose?: boolean } = {}): IndexResult {
  if (!isSqliteAvailable()) {
    throw new Error('node:sqlite is unavailable — indexing requires Node >= 22.5. Raw capture is unaffected.')
  }
  const { DatabaseSync } = loadSqlite()
  const dbPath = path.join(storageRoot, 'study.sqlite')

  // Rebuild from scratch for a deterministic, consistent index.
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix) } catch { /* not present */ }
  }
  fs.mkdirSync(storageRoot, { recursive: true })

  const db = new DatabaseSync(dbPath)
  const result: IndexResult = { dbPath, sessions: 0, agents: 0, turns: 0, toolCalls: 0, hookEvents: 0, events: 0, files: 0 }
  try {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(SCHEMA)

    const insSession = db.prepare(`INSERT OR REPLACE INTO sessions
      (id, source, runtime, project_path, git_branch, cc_version, ai_title, started_at, ended_at, status, folder_path,
       turn_count, tool_call_count, subagent_count,
       total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const insAgent = db.prepare(`INSERT OR REPLACE INTO agents (session_id, id, parent_agent_id, agent_type, description, spawn_depth, model) VALUES (?,?,?,?,?,?,?)`)
    const insTurn = db.prepare(`INSERT OR REPLACE INTO turns
      (session_id, uuid, agent_id, parent_uuid, role, model, timestamp, stop_reason,
       input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
       text_content, thinking_content, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const insTool = db.prepare(`INSERT OR REPLACE INTO tool_calls
      (session_id, tool_use_id, agent_id, turn_uuid, tool_name, input_json, result_text, is_error, started_at, ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    const insHook = db.prepare(`INSERT INTO hook_events (session_id, seq, hook_event_name, timestamp, payload_json) VALUES (?,?,?,?,?)`)
    const insEvent = db.prepare(`INSERT INTO events (session_id, seq, time, type, payload_json) VALUES (?,?,?,?,?)`)
    const insFile = db.prepare(`INSERT INTO files (session_id, path, operation, agent_id, turn_uuid, timestamp) VALUES (?,?,?,?,?,?)`)

    db.exec('BEGIN')
    // live/ folders are listed before backfill/; dedupe by id so a live capture
    // always wins over a same-id backfill copy left over from a prior run.
    const seenIds = new Set<string>()
    for (const folder of listSessionFolders(storageRoot)) {
      const s = parseSessionFolder(folder)
      if (!s) continue
      if (seenIds.has(s.id)) continue
      seenIds.add(s.id)
      const toolCalls = [...s.toolCalls.values()]
      insSession.run(
        s.id, s.source, s.runtime, s.projectPath, s.gitBranch, s.ccVersion, s.aiTitle,
        s.startedAt, s.endedAt, s.status, s.folderPath,
        s.turns.length, toolCalls.length, s.agents.length - 1,
        s.totals.input, s.totals.output, s.totals.cacheRead, s.totals.cacheCreate,
      )
      result.sessions++
      for (const a of s.agents) { insAgent.run(s.id, a.id, a.parent, a.type, a.description, a.spawnDepth, a.model); result.agents++ }
      for (const t of s.turns) {
        insTurn.run(t.session_id, t.uuid, t.agent_id, t.parent_uuid, t.role, t.model, t.timestamp, t.stop_reason,
          t.input_tokens, t.output_tokens, t.cache_read_input_tokens, t.cache_creation_input_tokens,
          t.text_content, t.thinking_content, t.raw_json)
        result.turns++
      }
      for (const c of toolCalls) {
        insTool.run(c.session_id, c.tool_use_id, c.agent_id, c.turn_uuid, c.tool_name, c.input_json, c.result_text, c.is_error, c.started_at, c.ended_at)
        result.toolCalls++
      }
      let seq = 0
      for (const h of s.hookEvents) {
        insHook.run(s.id, seq++, typeof h.hook_event_name === 'string' ? h.hook_event_name : null,
          typeof h.capturedAt === 'string' ? h.capturedAt : null, JSON.stringify(h))
        result.hookEvents++
      }
      seq = 0
      for (const e of s.events) {
        insEvent.run(s.id, seq++, typeof e.time === 'number' ? e.time : null, typeof e.type === 'string' ? e.type : null, JSON.stringify(e))
        result.events++
      }
      for (const f of s.files) { insFile.run(f.session_id, f.path, f.operation, f.agent_id, f.turn_uuid, f.timestamp); result.files++ }
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    db.close()
    throw e
  }
  db.close()
  if (opts.verbose) {
    console.log(`[study-index] ${dbPath}: ${result.sessions} sessions, ${result.turns} turns, ${result.toolCalls} tool calls, ${result.hookEvents} hooks, ${result.events} events, ${result.files} file ops`)
  }
  return result
}

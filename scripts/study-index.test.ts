import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { buildIndex, isSqliteAvailable } from '../extension/src/study-index'
import { StudyStorage } from '../extension/src/study-storage'

const skip = !isSqliteAvailable()

/** Write a study-storage folder with one realistic live session. */
function scaffoldStorage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'study-index-test-'))
  const sessionId = '11111111-2222-3333-4444-555555555555'
  const dir = path.join(root, 'live', 'sessions', `claude-${sessionId}`)
  fs.mkdirSync(path.join(dir, 'subagents'), { recursive: true })

  const transcript = [
    { type: 'user', uuid: 'u1', timestamp: '2026-08-10T10:00:00Z', cwd: '/proj', gitBranch: 'main', version: '2.1.0', message: { role: 'user', content: 'do the thing' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-08-10T10:00:05Z', message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }, content: [{ type: 'text', text: 'ok' }, { type: 'thinking', thinking: 'hmm' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/proj/a.ts' } }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-08-10T10:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents', is_error: false }] } },
    { type: 'ai-title', aiTitle: 'Do the thing', sessionId },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n'
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), transcript)

  fs.writeFileSync(path.join(dir, 'subagents', 'agent-xyz.jsonl'),
    JSON.stringify({ type: 'assistant', uuid: 'sa1', timestamp: '2026-08-10T10:00:07Z', message: { role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 3, output_tokens: 4 }, content: [{ type: 'text', text: 'sub work' }] } }) + '\n')
  fs.writeFileSync(path.join(dir, 'subagents', 'agent-xyz.meta.json'),
    JSON.stringify({ agentType: 'Explore', description: 'search', toolUseId: 't0', spawnDepth: 1 }))

  fs.writeFileSync(path.join(dir, 'hooks.jsonl'),
    [{ capturedAt: '2026-08-10T10:00:04Z', session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'Read' },
     { capturedAt: '2026-08-10T10:00:04Z', session_id: sessionId, hook_event_name: 'Notification', notification_type: 'permission_prompt' }].map((o) => JSON.stringify(o)).join('\n') + '\n')

  fs.writeFileSync(path.join(dir, 'events.jsonl'),
    [{ time: 0, type: 'agent_spawn', payload: {}, sessionId },
     { time: 5, type: 'tool_call_start', payload: { tool: 'Read' }, sessionId }].map((o) => JSON.stringify(o)).join('\n') + '\n')

  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id: sessionId, source: 'live', runtime: 'claude', status: 'completed' }))
  return { root, sessionId }
}

test('buildIndex produces a queryable SQLite index with correct rollups', { skip }, () => {
  const { root, sessionId } = scaffoldStorage()
  const res = buildIndex(root)
  assert.equal(res.sessions, 1)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(root, 'study.sqlite'))

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)
  assert.equal(session.source, 'live')
  assert.equal(session.project_path, '/proj')
  assert.equal(session.git_branch, 'main')
  assert.equal(session.cc_version, '2.1.0')
  assert.equal(session.ai_title, 'Do the thing')
  assert.equal(session.total_input_tokens, 13)   // 10 (main) + 3 (subagent)
  assert.equal(session.total_output_tokens, 24)  // 20 + 4
  assert.equal(session.subagent_count, 1)
  assert.equal(session.started_at, '2026-08-10T10:00:00Z')
  assert.equal(session.ended_at, '2026-08-10T10:00:07Z')

  const agents = db.prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY id').all(sessionId)
  assert.equal(agents.length, 2)
  const sub = agents.find((a: any) => a.id === 'agent-xyz')
  assert.equal(sub.agent_type, 'Explore')
  assert.equal(sub.spawn_depth, 1)
  assert.equal(sub.model, 'claude-sonnet-5')
  assert.equal(sub.parent_agent_id, 'orchestrator')

  const turns = db.prepare('SELECT * FROM turns WHERE session_id = ?').all(sessionId)
  assert.equal(turns.length, 4) // u1, a1, u2, sa1
  const a1 = turns.find((t: any) => t.uuid === 'a1')
  assert.equal(a1.input_tokens, 10)
  assert.equal(a1.thinking_content, 'hmm')
  assert.equal(a1.agent_id, 'orchestrator')

  const tool = db.prepare('SELECT * FROM tool_calls WHERE tool_use_id = ?').get('t1')
  assert.equal(tool.tool_name, 'Read')
  assert.equal(tool.is_error, 0)
  assert.equal(tool.result_text, 'file contents')
  assert.equal(tool.ended_at, '2026-08-10T10:00:06Z')

  const files = db.prepare('SELECT * FROM files WHERE session_id = ?').all(sessionId)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, '/proj/a.ts')
  assert.equal(files[0].operation, 'read')

  assert.equal(db.prepare('SELECT COUNT(*) n FROM hook_events').get().n, 2)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 2)
  db.close()
})

test('buildIndex is idempotent (rebuild from scratch)', { skip }, () => {
  const { root } = scaffoldStorage()
  buildIndex(root)
  const res = buildIndex(root) // second run must not double rows
  assert.equal(res.sessions, 1)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(root, 'study.sqlite'))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM turns').get().n, 4)
  db.close()
})

test('buildIndex dedupes a session present in both live and backfill (live wins)', { skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'study-dedupe-test-'))
  const id = 'dupe-session'
  for (const [source, tokens] of [['live', 100], ['backfill', 999]] as const) {
    const dir = path.join(root, source, 'sessions', `claude-${id}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'transcript.jsonl'),
      JSON.stringify({ type: 'assistant', uuid: 'x1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'assistant', usage: { input_tokens: tokens, output_tokens: 0 }, content: [] } }) + '\n')
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id, source, runtime: 'claude', status: 'completed' }))
  }
  buildIndex(root)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(root, 'study.sqlite'))
  const rows = db.prepare('SELECT * FROM sessions WHERE id = ?').all(id)
  assert.equal(rows.length, 1, 'exactly one session row')
  assert.equal(rows[0].source, 'live', 'live copy wins')
  assert.equal(rows[0].total_input_tokens, 100, 'live tokens, not backfill')
  db.close()
})

test('backfillClaudeSession imports into backfill/ and skips live + repeats', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'study-backfill-test-'))
  const workspace = path.join(base, 'workspace')
  const projectDir = path.join(base, 'claude-project')
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })

  const storage = new StudyStorage({ storageRoot: path.join(workspace, 'study-storage'), workspaceRoot: workspace, toolVersion: '1.0.0' })

  const sessionId = 'aaaa-bbbb-cccc'
  const src = path.join(projectDir, `${sessionId}.jsonl`)
  fs.writeFileSync(src, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n')
  // sidecar with a subagent, to confirm the tree is copied
  fs.mkdirSync(path.join(projectDir, sessionId, 'subagents'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, sessionId, 'subagents', 'agent-1.jsonl'), '{"type":"assistant"}\n')

  const bdir = path.join(workspace, 'study-storage', 'backfill', 'sessions', `claude-${sessionId}`)
  assert.equal(storage.backfillClaudeSession(sessionId, src), true, 'first import succeeds')
  assert.ok(fs.existsSync(path.join(bdir, 'transcript.jsonl')), 'transcript copied')
  assert.ok(fs.existsSync(path.join(bdir, 'subagents', 'agent-1.jsonl')), 'subagent copied')
  const meta = JSON.parse(fs.readFileSync(path.join(bdir, 'session.json'), 'utf-8'))
  assert.equal(meta.source, 'backfill')
  assert.equal(meta.status, 'completed')

  assert.equal(storage.backfillClaudeSession(sessionId, src), false, 'second import is a no-op')

  // A session already captured live must not be shadowed by a backfill copy.
  const liveId = 'live-only-id'
  fs.mkdirSync(path.join(workspace, 'study-storage', 'live', 'sessions', `claude-${liveId}`), { recursive: true })
  const liveSrc = path.join(projectDir, `${liveId}.jsonl`)
  fs.writeFileSync(liveSrc, '{}\n')
  assert.equal(storage.backfillClaudeSession(liveId, liveSrc), false, 'live session not re-imported')
})

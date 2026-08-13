import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { StudyStorage } from '../extension/src/study-storage'
import type { AgentEvent } from '../extension/src/protocol'

/** Build an isolated temp workspace + fake Claude project dir. */
function scaffold() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'study-storage-test-'))
  const workspace = path.join(base, 'workspace')
  const projectDir = path.join(base, 'claude-project')
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })

  const sessionId = '447ffde1-bfe9-4f00-bf08-cbf6d335d377'
  const mainFile = path.join(projectDir, `${sessionId}.jsonl`)
  fs.writeFileSync(mainFile, JSON.stringify({ type: 'user', sessionId }) + '\n')

  // Sidecar dir: subagents + tool-results
  const sidecar = path.join(projectDir, sessionId)
  fs.mkdirSync(path.join(sidecar, 'subagents'), { recursive: true })
  fs.mkdirSync(path.join(sidecar, 'tool-results'), { recursive: true })
  fs.writeFileSync(path.join(sidecar, 'subagents', 'agent-abc.jsonl'), '{"type":"assistant"}\n')
  fs.writeFileSync(path.join(sidecar, 'subagents', 'agent-abc.meta.json'), '{"agentType":"Explore"}')
  fs.writeFileSync(path.join(sidecar, 'tool-results', 'xyz.txt'), 'big tool output')

  const storage = new StudyStorage({
    storageRoot: path.join(workspace, 'study-storage'),
    workspaceRoot: workspace,
    participantId: 'P01',
    toolVersion: '9.9.9',
  })
  return { base, workspace, projectDir, sessionId, mainFile, storage }
}

const sessionDir = (workspace: string, sessionId: string) =>
  path.join(workspace, 'study-storage', 'live', 'sessions', `claude-${sessionId}`)

test('init creates skeleton, manifest, readme, and gitignore entry', () => {
  const { workspace, storage } = scaffold()
  storage.init()

  const root = path.join(workspace, 'study-storage')
  assert.ok(fs.existsSync(path.join(root, 'README.md')), 'README.md exists')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf-8'))
  assert.equal(manifest.participantId, 'P01')
  assert.equal(manifest.toolVersion, '9.9.9')
  assert.equal(manifest.consent, true)

  const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf-8')
  assert.match(gitignore, /study-storage\//)
})

test('registerClaudeSession mirrors transcript + sidecar files and writes metadata', () => {
  const { workspace, sessionId, mainFile, storage } = scaffold()
  storage.registerClaudeSession(sessionId, mainFile)

  const dir = sessionDir(workspace, sessionId)
  assert.ok(fs.existsSync(path.join(dir, 'transcript.jsonl')), 'transcript copied')
  assert.ok(fs.existsSync(path.join(dir, 'subagents', 'agent-abc.jsonl')), 'subagent copied')
  assert.ok(fs.existsSync(path.join(dir, 'subagents', 'agent-abc.meta.json')), 'meta copied')
  assert.ok(fs.existsSync(path.join(dir, 'tool-results', 'xyz.txt')), 'tool-result copied')
  assert.ok(fs.existsSync(path.join(dir, 'environment.json')), 'environment.json written')

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'))
  assert.equal(meta.id, sessionId)
  assert.equal(meta.runtime, 'claude')
  assert.equal(meta.source, 'live')
  assert.equal(meta.status, 'active')
  assert.equal(meta.endedAt, null)
})

test('syncClaudeSession copies only changed content (append-only growth)', () => {
  const { workspace, sessionId, mainFile, storage } = scaffold()
  storage.registerClaudeSession(sessionId, mainFile)

  fs.appendFileSync(mainFile, JSON.stringify({ type: 'assistant', sessionId }) + '\n')
  storage.syncClaudeSession(sessionId)

  const copied = fs.readFileSync(path.join(sessionDir(workspace, sessionId), 'transcript.jsonl'), 'utf-8')
  assert.equal(copied.trim().split('\n').length, 2, 'both lines mirrored')
})

test('syncClaudeSession re-mirrors a same-length in-place rewrite (content hash, not size+mtime)', () => {
  const { workspace, projectDir, sessionId, mainFile, storage } = scaffold()
  storage.registerClaudeSession(sessionId, mainFile)
  storage.syncClaudeSession(sessionId)

  const srcToolResult = path.join(projectDir, sessionId, 'tool-results', 'xyz.txt')
  const destToolResult = path.join(sessionDir(workspace, sessionId), 'tool-results', 'xyz.txt')
  const before = fs.statSync(srcToolResult)
  assert.equal(fs.readFileSync(destToolResult, 'utf-8'), 'big tool output', 'initial content mirrored')

  // Rewrite in place to a DIFFERENT string of the SAME byte length. A size-based
  // guard would treat this as unchanged; the content hash must still catch it.
  fs.writeFileSync(srcToolResult, 'new tool output') // same 15-byte length
  assert.equal(fs.statSync(srcToolResult).size, before.size, 'size unchanged by rewrite')

  storage.syncClaudeSession(sessionId)
  assert.equal(fs.readFileSync(destToolResult, 'utf-8'), 'new tool output', 'changed content re-mirrored')
})

test('appendEvent writes for registered sessions and skips unknown ones', () => {
  const { workspace, sessionId, mainFile, storage } = scaffold()
  storage.registerClaudeSession(sessionId, mainFile)

  const event: AgentEvent = { time: 1, type: 'tool_call_start', payload: { tool: 'Read' }, sessionId }
  storage.appendEvent(event)

  const eventsFile = path.join(sessionDir(workspace, sessionId), 'events.jsonl')
  const parsed = JSON.parse(fs.readFileSync(eventsFile, 'utf-8').trim())
  assert.equal(parsed.type, 'tool_call_start')

  // Unknown session, no ensureRuntime → no folder created.
  storage.appendEvent({ time: 0, type: 'message', payload: {}, sessionId: 'unknown-session' })
  assert.ok(!fs.existsSync(sessionDir(workspace, 'unknown-session')), 'no folder for stray event')
})

test('appendRawHook lazily creates the folder and stamps capturedAt', () => {
  const { workspace, storage } = scaffold()
  const hookSession = 'hook-only-session'
  storage.appendRawHook({ session_id: hookSession, hook_event_name: 'Notification', notification_type: 'permission_prompt' })

  const hooksFile = path.join(sessionDir(workspace, hookSession), 'hooks.jsonl')
  assert.ok(fs.existsSync(hooksFile), 'folder + hooks.jsonl created from a hook')
  const parsed = JSON.parse(fs.readFileSync(hooksFile, 'utf-8').trim())
  assert.equal(parsed.hook_event_name, 'Notification')
  assert.ok(typeof parsed.capturedAt === 'string', 'capturedAt stamped')
})

test('finalizeSession marks completed with an endedAt', () => {
  const { workspace, sessionId, mainFile, storage } = scaffold()
  storage.registerClaudeSession(sessionId, mainFile)
  storage.finalizeSession(sessionId)

  const meta = JSON.parse(fs.readFileSync(path.join(sessionDir(workspace, sessionId), 'session.json'), 'utf-8'))
  assert.equal(meta.status, 'completed')
  assert.ok(typeof meta.endedAt === 'string', 'endedAt set')
})

test('study session lifecycle: markers, discrete folder, event tee, and end boundary', () => {
  const { workspace, storage } = scaffold()
  const root = path.join(workspace, 'study-storage')
  const id = 'ss-abc123'
  const iso = () => new Date().toISOString()

  storage.recordStudySessionLifecycle({ action: 'started', studySessionId: id, sessionNumber: 1, at: iso(), elapsedMs: 0, protocolMinimumMs: 900000 })

  // One discrete per-session folder, marked active with the protocol minimum.
  const ssDir = path.join(root, 'study-sessions')
  const folders = fs.readdirSync(ssDir)
  assert.equal(folders.length, 1, 'one study-session folder')
  const dir = path.join(ssDir, folders[0])
  let meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'))
  assert.equal(meta.status, 'active')
  assert.equal(meta.sessionNumber, 1)
  assert.equal(meta.protocolMinimumMs, 900000)

  // Events while active are teed into the discrete slice.
  storage.appendEvent({ time: 1, type: 'message', payload: { role: 'user', content: 'hi' }, sessionId: 'agent-1' })
  storage.appendEvent({ time: 2, type: 'tool_call_start', payload: { tool: 'Read' }, sessionId: 'agent-1' })
  let events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf-8').trim().split('\n')
  assert.equal(events.length, 2, 'two events teed into the active session')

  // End boundary: distinctive marker + folder finalized with rollups.
  storage.recordStudySessionLifecycle({ action: 'ended', studySessionId: id, sessionNumber: 1, at: iso(), elapsedMs: 123456, reason: 'user-ended' })
  meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8'))
  assert.equal(meta.status, 'ended')
  assert.ok(typeof meta.endedAt === 'string', 'endedAt set on end')
  assert.equal(meta.endReason, 'user-ended')
  assert.ok(meta.agentSessionIds.includes('agent-1'), 'tab id captured')

  // Beyond the session's end, further events are no longer teed here (they stay
  // recoverable in the per-transcript folders + the top-level marker log).
  storage.appendEvent({ time: 3, type: 'message', payload: {}, sessionId: 'agent-1' })
  events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf-8').trim().split('\n')
  assert.equal(events.length, 2, 'post-end events not teed into the ended session')

  // The always-present marker log records every action, stamped on arrival.
  const markers = fs.readFileSync(path.join(root, 'study-sessions.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(markers.map(m => m.action), ['started', 'ended'])
  assert.ok(markers.every(m => typeof m.capturedAt === 'string'))
})

test('resuming a finalized session flips status back to active and clears endedAt', () => {
  const { workspace, sessionId, mainFile, storage } = scaffold()
  const metaPath = path.join(sessionDir(workspace, sessionId), 'session.json')

  storage.registerClaudeSession(sessionId, mainFile)
  const started = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).startedAt

  storage.finalizeSession(sessionId)
  assert.equal(JSON.parse(fs.readFileSync(metaPath, 'utf-8')).status, 'completed')

  // Watcher re-registers the same session on resume.
  storage.registerClaudeSession(sessionId, mainFile)

  const resumed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  assert.equal(resumed.status, 'active', 'status flipped back to active')
  assert.equal(resumed.endedAt, null, 'endedAt cleared')
  assert.equal(resumed.startedAt, started, 'original startedAt preserved')
})

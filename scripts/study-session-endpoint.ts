/**
 * Shared HTTP handler for the study-session lifecycle POST endpoint.
 *
 * The web UI owns the study-session clock; when it is NOT running inside a VS
 * Code webview (no postMessage back-channel) it POSTs each lifecycle action
 * here so the relay's StudyStorage can log it on disk. Used by both the
 * standalone app server (app/src/server.ts) and the dev relay (dev-relay.ts).
 *
 * Best-effort and defensive: a malformed body or capture-disabled relay is a
 * harmless 204 — this must never disturb the participant's session.
 */
import type * as http from 'http'
import type { Relay } from './relay'
import type { StudySessionLifecycle, InteractionRecord } from '../extension/src/protocol'

const MAX_BODY_BYTES = 1_000_000

const ACTIONS = new Set(['started', 'paused', 'resumed', 'ended', 'protocol-reached'])

const INTERACTION_KINDS = new Set(['agent-rename', 'session-rename', 'session-resume'])

/** Narrow an untrusted parsed body to a StudySessionLifecycle (or null). */
function coerceLifecycle(body: unknown): StudySessionLifecycle | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.action !== 'string' || !ACTIONS.has(b.action)) return null
  if (typeof b.studySessionId !== 'string') return null
  if (typeof b.sessionNumber !== 'number') return null
  return {
    action: b.action as StudySessionLifecycle['action'],
    studySessionId: b.studySessionId,
    sessionNumber: b.sessionNumber,
    at: typeof b.at === 'string' ? b.at : new Date().toISOString(),
    elapsedMs: typeof b.elapsedMs === 'number' ? b.elapsedMs : 0,
    reason: typeof b.reason === 'string' ? b.reason : undefined,
    agentSessionIds: Array.isArray(b.agentSessionIds)
      ? b.agentSessionIds.filter((s): s is string => typeof s === 'string')
      : undefined,
    protocolMinimumMs: typeof b.protocolMinimumMs === 'number' ? b.protocolMinimumMs : undefined,
  }
}

/** Narrow an untrusted parsed body to an InteractionRecord (or null). */
function coerceInteraction(body: unknown): InteractionRecord | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.kind !== 'string' || !INTERACTION_KINDS.has(b.kind)) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    kind: b.kind as InteractionRecord['kind'],
    at: typeof b.at === 'string' ? b.at : new Date().toISOString(),
    agentId: str(b.agentId),
    sessionId: str(b.sessionId),
    studySessionId: str(b.studySessionId),
    previous: str(b.previous),
    next: str(b.next),
  }
}

/** Read, size-cap, parse the body, then hand the parsed value to `forward`.
 *  Always responds 204 (best-effort logging must never disturb the participant). */
function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  forward: (parsed: unknown) => void,
): void {
  const chunks: Buffer[] = []
  let size = 0
  let aborted = false
  req.on('data', (chunk: Buffer) => {
    if (aborted) return
    size += chunk.length
    if (size > MAX_BODY_BYTES) { aborted = true; req.destroy(); return }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (aborted) return
    try {
      forward(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
    } catch { /* malformed — ignore, still 204 below */ }
    res.writeHead(204)
    res.end()
  })
  req.on('error', () => {
    try { res.writeHead(204); res.end() } catch { /* already closed */ }
  })
}

/** Read, size-cap, parse, validate, and forward a study-session POST. Always 204s. */
export function handleStudySessionPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  relay: Relay,
): void {
  handlePost(req, res, (parsed) => {
    const lifecycle = coerceLifecycle(parsed)
    if (lifecycle) relay.recordStudySession(lifecycle)
  })
}

/** Read, size-cap, parse, validate, and forward a UI-interaction POST. Always 204s. */
export function handleInteractionPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  relay: Relay,
): void {
  handlePost(req, res, (parsed) => {
    const interaction = coerceInteraction(parsed)
    if (interaction) relay.recordInteraction(interaction)
  })
}

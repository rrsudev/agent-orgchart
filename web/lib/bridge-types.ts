/**
 * Shared types for the VS Code bridge protocol.
 *
 * These types mirror extension/src/protocol.ts and are kept separate
 * to avoid cross-project imports. When updating these, also update
 * the canonical definitions in extension/src/protocol.ts.
 */

export interface AgentEvent {
  time: number
  type: string
  payload: Record<string, unknown>
  sessionId?: string
}

export interface SessionInfo {
  id: string
  /** Goal summary — tab-name fallback / short contexts. No longer 2-word-capped;
   *  mirrors the fuller `goal` below. */
  label: string
  /** Fuller goal text (untruncated summary, capped) — node subtitle preview +
   *  full-goal hover. Optional (older hosts / codex may not send it). */
  goal?: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'watching'

/**
 * Study-session lifecycle record — a wall-clock "work period" the participant
 * runs, pauses, and ends, independent of the agent/transcript sessions (tabs).
 * Emitted from the web UI and logged distinctively by StudyStorage so that
 * researchers can reconstruct exactly when a session started, paused, and ended
 * — and recover the participant's actions during AND beyond that window.
 *
 * Mirrors StudySessionLifecycle in extension/src/protocol.ts — keep in sync.
 */
export type StudySessionAction = 'started' | 'paused' | 'resumed' | 'ended' | 'protocol-reached'

export interface StudySessionLifecycle {
  action: StudySessionAction
  /** Client-generated id, stable for the lifetime of one study session. */
  studySessionId: string
  /** 1-based, monotonic across the whole study (survives reloads). */
  sessionNumber: number
  /** ISO wall-clock time this record was produced. */
  at: string
  /** Accumulated *running* time (ms) at this moment — excludes paused spans. */
  elapsedMs: number
  /** Why the record fired (e.g. 'user-ended', 'ended-and-restarted'). */
  reason?: string
  /** Agent/transcript session ids open during this study session (correlation). */
  agentSessionIds?: string[]
  /** Protocol minimum (ms) — sent on 'started' so the log is self-describing. */
  protocolMinimumMs?: number
}

/**
 * Sentinel "session id" for the parallel view — a pseudo-tab that combines every
 * session and renders all agents at once. When this is the active filter, the
 * simulation applies no per-session filtering and the bridge delivers events
 * from all sessions.
 */
export const PARALLEL_VIEW_ID = '__all__'

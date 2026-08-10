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
  label: string
  status: 'active' | 'completed'
  startTime: number
  lastActivityTime: number
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'watching'

/**
 * Sentinel "session id" for the parallel view — a pseudo-tab that combines every
 * session and renders all agents at once. When this is the active filter, the
 * simulation applies no per-session filtering and the bridge delivers events
 * from all sessions.
 */
export const PARALLEL_VIEW_ID = '__all__'

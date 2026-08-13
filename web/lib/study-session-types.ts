/**
 * Study-session model (client side).
 *
 * A "study session" is a participant work period with a wall clock that only
 * advances while the session is *running* — pausing freezes it. It is distinct
 * from the agent/transcript sessions (the tabs) and from the playback timeline.
 * This module holds the client-facing types + tunables; the lifecycle record
 * sent to the host for on-disk logging lives in bridge-types.ts.
 */
export type { StudySessionLifecycle, StudySessionAction } from './bridge-types'

// ─────────────────────────────────────────────────────────────────────────────
// STUDY WEBSITE URL — paste your study site here. This ONE constant is the
// fallback the 15-minute protocol popup opens ("record your steps"). It is
// overridden at runtime by the `agentVisualizer.studyWebsiteUrl` VS Code
// setting when that is set, so you can also configure it per-machine.
// ─────────────────────────────────────────────────────────────────────────────
export const STUDY_WEBSITE_URL = 'https://gamejam-progress.vercel.app/'

/** Study protocol: each session should run at least 15 minutes of active time. */
export const PROTOCOL_MINIMUM_MS = 15 * 60 * 1000

/**
 * Cap on events retained per session for client-side replay. Matches the
 * simulation's own live event-log cap (MAX_EVENT_LOG) so a replay reproduces
 * what the live view would have shown; when exceeded, the OLDEST are dropped
 * and the count is surfaced (never silently truncated).
 */
export const MAX_RECORDED_EVENTS = 5000

/** Max "key action" summary rows kept per session (for the archive read-out). */
export const MAX_SUMMARY_ACTIONS = 300

export const STUDY_STORAGE_KEYS = {
  current: 'agent-orgchart:study-session:current',
  archive: 'agent-orgchart:study-session:archive',
  counter: 'agent-orgchart:study-session:counter',
  /** Per-session recorded events, keyed `${eventsPrefix}${id}`. */
  eventsPrefix: 'agent-orgchart:study-session:events:',
} as const

export type StudySessionStatus = 'running' | 'paused'

/** One recorded event, timestamped on the shared study-session clock (seconds). */
export interface RecordedSimEvent {
  time: number
  type: string
  payload: Record<string, unknown>
  sessionId?: string
}

/** A notable action captured for the archive's "retrace your steps" read-out. */
export interface SummaryAction {
  /** Seconds on the study-session clock. */
  at: number
  kind: 'prompt' | 'spawn' | 'tool' | 'permission' | 'error'
  label: string
}

export interface StudySessionSummary {
  /** Distinct agent/transcript session ids (tabs) touched during the session. */
  agentSessionIds: string[]
  eventCount: number
  droppedEvents: number
  actions: SummaryAction[]
}

/** The live, in-progress session (persisted so a reload continues the clock). */
export interface CurrentStudySession {
  id: string
  number: number
  startedAtISO: string
  startedAtEpoch: number
  /** Accumulated running time (ms), excludes paused spans. */
  accumulatedMs: number
  /** Epoch ms of the last resume/start; null while paused. */
  runningSince: number | null
  status: StudySessionStatus
  protocolReached: boolean
}

/** A finished session shown in the archive (with replay when a recording exists). */
export interface ArchivedStudySession {
  id: string
  number: number
  startedAtISO: string
  endedAtISO: string
  /** Accumulated running time (ms). */
  durationMs: number
  protocolReached: boolean
  endedReason: string
  summary: StudySessionSummary
  hasRecording: boolean
}

/** Elapsed running ms for a session at wall-clock `now` (frozen while paused). */
export function elapsedMsAt(session: CurrentStudySession, now: number): number {
  return session.accumulatedMs + (session.runningSince != null ? Math.max(0, now - session.runningSince) : 0)
}

/** m:ss / h:mm:ss formatting for the session clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

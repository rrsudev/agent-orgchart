'use client'

/**
 * useStudySession — owns the participant's study-session wall clock and its
 * lifecycle, independent of the agent tabs and the playback timeline.
 *
 *   • The clock only advances while the session is *running*; pausing freezes it
 *     (time is not recorded while paused).
 *   • Each lifecycle action (start / pause / resume / end / 15-min protocol) is
 *     forwarded to the host for distinctive on-disk logging — via the VS Code
 *     bridge when embedded, or a relay POST when standalone.
 *   • Every agent event that arrives during a session is recorded (capped, with
 *     drops surfaced) so an ended session can be re-watched from the archive.
 *   • Timer/clock state is persisted so a reload continues the same session
 *     (offline time is never counted).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { vscodeBridge, type AgentEvent } from '@/lib/vscode-bridge'
import {
  PROTOCOL_MINIMUM_MS, MAX_RECORDED_EVENTS, MAX_SUMMARY_ACTIONS, STUDY_STORAGE_KEYS,
  STUDY_WEBSITE_URL, elapsedMsAt,
  type CurrentStudySession, type ArchivedStudySession, type RecordedSimEvent,
  type SummaryAction, type StudySessionLifecycle, type StudySessionAction,
} from '@/lib/study-session-types'

interface UseStudySessionOptions {
  /** Turn the controller on (live data connected). Off = demo/idle: no clock. */
  enabled: boolean
  /** URL override from the host setting; falls back to STUDY_WEBSITE_URL. */
  studyWebsiteUrl?: string
}

// ─── storage helpers (all best-effort; never throw into React) ───────────────

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}
function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true }
  catch { return false }
}
function removeKey(key: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(key) } catch { /* ignore */ }
}
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`
}

export interface UseStudySessionResult {
  /** The live session (null only before enable / during the first mount tick). */
  current: CurrentStudySession | null
  /** Ended sessions, newest-first, for the archive UI. */
  archive: ArchivedStudySession[]
  pause: () => void
  resume: () => void
  /** Finalize the current session and start a fresh one (resets the clock). */
  endSession: (reason?: string) => void
  /** True once the 15-minute protocol popup should be shown. */
  protocolPromptOpen: boolean
  dismissProtocolPrompt: () => void
  openStudyWebsite: () => void
  /** Recorded event stream for an archived session (null if none/evicted). */
  getRecording: (id: string) => RecordedSimEvent[] | null
  deleteArchived: (id: string) => void
}

export function useStudySession(options: UseStudySessionOptions): UseStudySessionResult {
  const { enabled, studyWebsiteUrl } = options

  const [current, setCurrentState] = useState<CurrentStudySession | null>(null)
  const currentRef = useRef<CurrentStudySession | null>(null)
  const [archive, setArchive] = useState<ArchivedStudySession[]>([])
  const [protocolPromptOpen, setProtocolPromptOpen] = useState(false)

  // Recording buffers for the in-progress session (kept out of React state).
  const recordingRef = useRef<RecordedSimEvent[]>([])
  const actionsRef = useRef<SummaryAction[]>([])
  const agentIdsRef = useRef<Set<string>>(new Set())
  const droppedRef = useRef(0)

  // ── canonical setter: ref + state + persist ────────────────────────────────
  const setCurrent = useCallback((next: CurrentStudySession | null) => {
    currentRef.current = next
    setCurrentState(next)
    if (next) writeJson(STUDY_STORAGE_KEYS.current, next)
    else removeKey(STUDY_STORAGE_KEYS.current)
  }, [])

  // ── lifecycle dispatch to the host (VS Code bridge OR relay POST) ───────────
  const dispatch = useCallback((action: StudySessionAction, extra?: { reason?: string }) => {
    const sess = currentRef.current
    if (!sess) return
    const now = Date.now()
    const payload: StudySessionLifecycle = {
      action,
      studySessionId: sess.id,
      sessionNumber: sess.number,
      at: new Date(now).toISOString(),
      elapsedMs: Math.round(elapsedMsAt(sess, now)),
      reason: extra?.reason,
      agentSessionIds: [...agentIdsRef.current],
      ...(action === 'started' ? { protocolMinimumMs: PROTOCOL_MINIMUM_MS } : {}),
    }
    // In VS Code, only the bridge path runs (no relay). Standalone POSTs instead.
    if (vscodeBridge?.isVSCode) {
      vscodeBridge.sendStudySession(payload)
    } else if (typeof window !== 'undefined') {
      const port = process.env.NEXT_PUBLIC_RELAY_PORT || ''
      const url = port ? `http://127.0.0.1:${port}/study-session` : '/study-session'
      try {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true, // survive an unload for the final 'ended'/'paused'
        }).catch(() => {})
      } catch { /* ignore */ }
    }
  }, [])

  // ── start a brand-new session (bumps the monotonic counter) ─────────────────
  const startSession = useCallback((restore?: CurrentStudySession) => {
    let sess: CurrentStudySession
    if (restore) {
      sess = restore
    } else {
      const counter = (readJson<number>(STUDY_STORAGE_KEYS.counter) ?? 0) + 1
      writeJson(STUDY_STORAGE_KEYS.counter, counter)
      const now = Date.now()
      sess = {
        id: newId(),
        number: counter,
        startedAtISO: new Date(now).toISOString(),
        startedAtEpoch: now,
        accumulatedMs: 0,
        runningSince: now,
        status: 'running',
        protocolReached: false,
      }
    }
    recordingRef.current = []
    actionsRef.current = []
    agentIdsRef.current = new Set()
    droppedRef.current = 0
    setProtocolPromptOpen(false)
    setCurrent(sess)
    if (!restore) dispatch('started')
  }, [setCurrent, dispatch])

  // ── auto-start / restore once live ──────────────────────────────────────────
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (!enabled || bootstrappedRef.current) return
    bootstrappedRef.current = true
    const saved = readJson<CurrentStudySession>(STUDY_STORAGE_KEYS.current)
    if (saved && (saved.status === 'running' || saved.status === 'paused')) {
      // Continue the same session, but DON'T count time spent away: a running
      // session resumes its clock from now (accumulated is preserved).
      const restored: CurrentStudySession = saved.status === 'running'
        ? { ...saved, runningSince: Date.now() }
        : { ...saved, runningSince: null }
      startSession(restored)
      // Re-open the on-disk slice so post-reload activity is captured there too.
      dispatch(saved.status === 'running' ? 'resumed' : 'paused', { reason: 'reload' })
    } else {
      startSession()
    }
  }, [enabled, startSession, dispatch])

  // ── load the archive once (after mount, to avoid SSR hydration mismatch) ─────
  useEffect(() => {
    const saved = readJson<ArchivedStudySession[]>(STUDY_STORAGE_KEYS.archive)
    if (saved && saved.length > 0) setArchive(saved)
  }, [])

  // ── record every agent event that arrives during a session ──────────────────
  useEffect(() => {
    if (!vscodeBridge) return
    const unsub = vscodeBridge.onEvent((event: AgentEvent) => {
      const sess = currentRef.current
      if (!sess) return
      const t = elapsedMsAt(sess, Date.now()) / 1000
      // Replay stream (capped like the live event log — drop OLDEST, count it).
      recordingRef.current.push({ time: t, type: event.type, payload: event.payload, sessionId: event.sessionId })
      if (recordingRef.current.length > MAX_RECORDED_EVENTS) {
        recordingRef.current.shift()
        droppedRef.current++
      }
      if (event.sessionId) agentIdsRef.current.add(event.sessionId)
      // Lightweight "retrace your steps" summary of notable actions.
      const action = summarize(event, t)
      if (action && actionsRef.current.length < MAX_SUMMARY_ACTIONS) actionsRef.current.push(action)
    })
    return unsub
  }, [])

  // ── the session clock: tick while running (no per-second React re-render) ────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => {
      const sess = currentRef.current
      if (!sess || sess.status !== 'running') return
      const now = Date.now()
      const elapsed = elapsedMsAt(sess, now)
      // Persist a folded snapshot each tick (≤1s reload resolution) WITHOUT a
      // state change — the visible clock re-renders in StudySessionBar instead.
      writeJson(STUDY_STORAGE_KEYS.current, { ...sess, accumulatedMs: Math.round(elapsed), runningSince: now })
      // 15-minute protocol: fire once, then let them keep working.
      if (!sess.protocolReached && elapsed >= PROTOCOL_MINIMUM_MS) {
        const reached = { ...sess, protocolReached: true }
        setCurrent(reached)
        dispatch('protocol-reached')
        setProtocolPromptOpen(true)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [setCurrent, dispatch])

  // ── commit the running span on unload so a reload doesn't lose it ────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const commit = () => {
      const sess = currentRef.current
      if (!sess || sess.status !== 'running') return
      const now = Date.now()
      writeJson(STUDY_STORAGE_KEYS.current, { ...sess, accumulatedMs: Math.round(elapsedMsAt(sess, now)), runningSince: now })
    }
    window.addEventListener('pagehide', commit)
    return () => window.removeEventListener('pagehide', commit)
  }, [])

  // ── controls ────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    const sess = currentRef.current
    if (!sess || sess.status !== 'running') return
    const now = Date.now()
    setCurrent({ ...sess, accumulatedMs: Math.round(elapsedMsAt(sess, now)), runningSince: null, status: 'paused' })
    dispatch('paused')
  }, [setCurrent, dispatch])

  const resume = useCallback(() => {
    const sess = currentRef.current
    if (!sess || sess.status !== 'paused') return
    setCurrent({ ...sess, runningSince: Date.now(), status: 'running' })
    dispatch('resumed')
  }, [setCurrent, dispatch])

  const persistArchive = useCallback((next: ArchivedStudySession[]) => {
    setArchive(next)
    writeJson(STUDY_STORAGE_KEYS.archive, next)
  }, [])

  const endSession = useCallback((reason = 'user-ended') => {
    const sess = currentRef.current
    if (!sess) return
    const now = Date.now()
    const durationMs = Math.round(elapsedMsAt(sess, now))
    dispatch('ended', { reason })

    // Persist the recording for replay (best-effort; evict oldest on quota).
    const events = recordingRef.current
    let hasRecording = false
    if (events.length > 0) {
      hasRecording = writeJson(STUDY_STORAGE_KEYS.eventsPrefix + sess.id, events)
      if (!hasRecording) hasRecording = evictAndRetryRecording(sess.id, events, archive)
    }

    const archived: ArchivedStudySession = {
      id: sess.id,
      number: sess.number,
      startedAtISO: sess.startedAtISO,
      endedAtISO: new Date(now).toISOString(),
      durationMs,
      protocolReached: sess.protocolReached || durationMs >= PROTOCOL_MINIMUM_MS,
      endedReason: reason,
      summary: {
        agentSessionIds: [...agentIdsRef.current],
        eventCount: events.length,
        droppedEvents: droppedRef.current,
        actions: actionsRef.current.slice(),
      },
      hasRecording,
    }
    persistArchive([archived, ...archive]) // newest-first
    startSession() // fresh session, clock back to 0:00
  }, [dispatch, archive, persistArchive, startSession])

  // ── archive accessors ────────────────────────────────────────────────────────
  const getRecording = useCallback((id: string): RecordedSimEvent[] | null => {
    return readJson<RecordedSimEvent[]>(STUDY_STORAGE_KEYS.eventsPrefix + id)
  }, [])

  const deleteArchived = useCallback((id: string) => {
    removeKey(STUDY_STORAGE_KEYS.eventsPrefix + id)
    persistArchive(archive.filter(a => a.id !== id))
  }, [archive, persistArchive])

  // ── 15-minute popup actions ───────────────────────────────────────────────────
  const dismissProtocolPrompt = useCallback(() => setProtocolPromptOpen(false), [])
  const openStudyWebsite = useCallback(() => {
    const url = (studyWebsiteUrl && studyWebsiteUrl.trim()) || STUDY_WEBSITE_URL
    if (vscodeBridge?.isVSCode) vscodeBridge.openExternal(url)
    else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  }, [studyWebsiteUrl])

  return {
    current, archive, pause, resume, endSession,
    protocolPromptOpen, dismissProtocolPrompt, openStudyWebsite,
    getRecording, deleteArchived,
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Map an event to a compact "retrace" summary row, or null to skip it. */
function summarize(event: AgentEvent, t: number): SummaryAction | null {
  const p = event.payload || {}
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (event.type) {
    case 'message':
      if (str(p.role) !== 'user') return null
      return { at: t, kind: 'prompt', label: truncate(str(p.content), 90) }
    case 'agent_spawn': {
      const name = str(p.displayName) || str(p.name)
      if (!name) return null
      return { at: t, kind: 'spawn', label: `spawned ${truncate(name, 60)}` }
    }
    case 'permission_requested':
      return { at: t, kind: 'permission', label: `permission: ${truncate(str(p.tool) || str(p.name), 50)}` }
    case 'error':
      return { at: t, kind: 'error', label: truncate(str(p.message) || 'error', 80) }
    default:
      return null
  }
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** On a localStorage quota failure, drop older recordings and retry once. */
function evictAndRetryRecording(id: string, events: RecordedSimEvent[], archive: ArchivedStudySession[]): boolean {
  // Oldest archived sessions first (archive is newest-first).
  for (let i = archive.length - 1; i >= 0; i--) {
    removeKey(STUDY_STORAGE_KEYS.eventsPrefix + archive[i].id)
    if (writeJson(STUDY_STORAGE_KEYS.eventsPrefix + id, events)) return true
  }
  return false
}

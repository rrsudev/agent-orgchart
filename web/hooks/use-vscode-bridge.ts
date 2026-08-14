'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { vscodeBridge, type ConnectionStatus, type AgentEvent, type SessionInfo } from '@/lib/vscode-bridge'
import { PARALLEL_VIEW_ID } from '@/lib/bridge-types'
import { SimulationEvent } from '@/lib/agent-types'

/** Payload fields that identify a graph node (agent/parent/child references). */
const IDENTITY_FIELDS = ['name', 'parent', 'agent', 'child'] as const
const SESSION_SEP = '␞' // record-separator glyph — never appears in real names

/** Hard cap on per-session buffered events (a replay backstop). A study session
 *  virtually never reaches this; it bounds heap for a pathological multi-hour
 *  runaway so the tab can't OOM. On overflow we trim the OLDEST events (a later
 *  cold-start replay then begins mid-session) and remember how many were dropped
 *  so save/restore indices stay absolute. */
const MAX_SESSION_BUFFER = 50_000

/** Golden angle — spreads N points evenly with no two sharing a direction. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** Radial seed spacing between session orchestrators in the parallel view.
 *  Placement is a Vogel/phyllotaxis spiral (radius = STEP·√index) purely for the
 *  INITIAL seed — orchestrators start in a tight cluster NEAR THE ORIGIN and the
 *  force sim (inward gravity + collide) spreads them into a compact, centered
 *  constellation. A small step is deliberate: it keeps every session seeding near
 *  the center instead of ever-farther out on the periphery (radius grew with √N),
 *  which used to make auto-fit zoom way out to frame near-empty space before
 *  gravity pulled everything back in. The golden angle only gives each seed a
 *  distinct direction so charge has a well-defined way to separate coincident
 *  starts; final spacing is owned by forceCollide (nodes) + findToolSlot
 *  (tool cards), so a small seed can't cause real overlap. */
const ORCH_RING_STEP = 70

/** Per-session context used to place + badge orchestrators in the parallel view. */
interface ParallelMeta { index: number; label: string }

/** Compact session tag appended to an orchestrator's label in the parallel view. */
function shortSessionTag(label: string): string {
  const t = label.trim()
  return t.length > 16 ? t.slice(0, 15) + '…' : t
}

/**
 * Rewrite an event's identity fields so they are unique per session. Used only
 * for the parallel view: without this, agents that share a name across sessions
 * (e.g. each session's main agent) would collapse into a single node. The
 * original name is preserved as `displayName` so node labels stay clean.
 *
 * When `meta` is supplied, the session's orchestrator (a parentless root spawn)
 * is also given a near-origin seed position with a distinct direction (so the
 * force sim can separate them into a compact, centered constellation) and a
 * session tag on its label (so they're distinguishable).
 */
function namespaceEvent(evt: SimulationEvent, meta?: ParallelMeta): SimulationEvent {
  if (!evt.sessionId) return evt
  const prefix = evt.sessionId + SESSION_SEP
  const payload: Record<string, unknown> = { ...evt.payload }
  if (evt.type === 'agent_spawn' && typeof payload.name === 'string') {
    // Preserve the original name for clean node labels before namespacing.
    if (payload.displayName === undefined) payload.displayName = payload.name
    // A parentless root spawn is the session's orchestrator: badge it with a
    // session tag and seed it near the origin (distinct direction per session)
    // so the force sim spreads them into a compact, centered constellation.
    if (meta && typeof payload.parent !== 'string') {
      payload.displayName = `${payload.displayName} · ${shortSessionTag(meta.label)}`
      const radius = ORCH_RING_STEP * Math.sqrt(meta.index)
      payload.spawnX = Math.cos(GOLDEN_ANGLE * meta.index) * radius
      payload.spawnY = Math.sin(GOLDEN_ANGLE * meta.index) * radius
    }
  }
  for (const field of IDENTITY_FIELDS) {
    if (typeof payload[field] === 'string') payload[field] = prefix + (payload[field] as string)
  }
  return { ...evt, payload }
}

interface BridgeHookResult {
  isVSCode: boolean
  connectionStatus: ConnectionStatus
  /** Events received from VS Code extension, converted to SimulationEvent format */
  pendingEvents: readonly SimulationEvent[]
  /** Call after consuming events to clear the queue */
  consumeEvents: () => void
  /** Whether to show mock data (standalone mode or explicit config) */
  useMockData: boolean
  /** Whether CLAUDE_CODE_DISABLE_1M_CONTEXT=1 is set — caps context window to 200k */
  disable1MContext: boolean
  /** Study-website URL (host setting) for the 15-min protocol popup; undefined = use app default. */
  studyWebsiteUrl?: string
  /** Open a file in the VS Code editor */
  bridgeOpenFile: (filePath: string, line?: number) => void
  /** Known sessions from the extension */
  sessions: SessionInfo[]
  /** Currently selected session ID */
  selectedSessionId: string | null
  /** Select a session to view (does not flush events — call flushSessionEvents after state swap). */
  selectSession: (sessionId: string | null) => void
  /** Flush buffered events for a session into pending. Call from useLayoutEffect after state swap. */
  flushSessionEvents: (sessionId: string, fromIndex?: number) => void
  /** Get the current event count for a session (for save/restore) */
  getSessionEventCount: (sessionId: string) => number
  /** Ref to the currently selected session ID — updated synchronously, not via React state */
  selectedSessionIdRef: React.RefObject<string | null>
  /** Session IDs that have received events while not selected */
  sessionsWithActivity: Set<string>
  /** Remove (archive) a session from the list */
  removeSession: (sessionId: string) => void
  /** Reorder open tabs by moving `fromId` to `toId`'s slot (drag-to-reorder). Persisted. */
  reorderSessions: (fromId: string, toId: string) => void
  /** Rename a session tab (persists locally; blank name reverts to call-sign) */
  renameSession: (sessionId: string, label: string) => void
  /** User tab renames (id → custom name) — an overlay applied over the call-sign. */
  sessionRenames: Map<string, string>
  /** Archived (closed) sessions, oldest→newest, for the reopen/undo UI */
  archivedSessions: SessionInfo[]
  /** Reopen a previously archived session (undo a close) */
  unarchiveSession: (sessionId: string) => void
  /** Ask the host to resume the underlying Claude Code chat in a terminal. */
  resumeSession: (sessionId: string) => void
}

/**
 * Connects the VS Code bridge to the React app.
 * When running standalone, returns useMockData=true and no events.
 * When inside VS Code, receives events and forwards control commands.
 *
 * Supports multi-session: events are buffered per-session so switching
 * sessions replays the correct event history.
 */
export function useVSCodeBridge(): BridgeHookResult {
  const [isVSCode, setIsVSCode] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [useMockData, setUseMockData] = useState(
    process.env.NEXT_PUBLIC_DEMO !== '0'
  )
  const [disable1MContext, setDisable1MContext] = useState(false)
  /** Study-website URL for the 15-min protocol popup, from the host setting. */
  const [studyWebsiteUrl, setStudyWebsiteUrl] = useState<string | undefined>(undefined)
  const pendingEventsRef = useRef<SimulationEvent[]>([])
  const [, setEventVersion] = useState(0) // trigger re-render on new events

  // Session state
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const sessionEventsRef = useRef<Map<string, SimulationEvent[]>>(new Map())
  // Per-session count of events trimmed off the FRONT of the buffer (see
  // MAX_SESSION_BUFFER). Keeps getSessionEventCount an absolute, monotonic count
  // so a saved fromIndex still resolves correctly after a trim.
  const sessionDroppedRef = useRef<Map<string, number>>(new Map())
  // Mirror of `sessions` for synchronous label lookups from event transforms.
  const sessionsRef = useRef<SessionInfo[]>([])
  sessionsRef.current = sessions
  // Stable, first-seen index per session — drives orchestrator placement in the
  // parallel view so each session lands in a distinct spot. Uses a monotonic
  // counter (not map size) so removing a session never causes a later session
  // to reuse a live index (which would overlap orchestrators).
  const sessionOrderRef = useRef<Map<string, number>>(new Map())
  const sessionOrderNextRef = useRef(0)
  const parallelMetaOf = useCallback((sessionId: string): ParallelMeta => {
    let index = sessionOrderRef.current.get(sessionId)
    if (index === undefined) {
      index = sessionOrderNextRef.current++
      sessionOrderRef.current.set(sessionId, index)
    }
    const label = sessionsRef.current.find(s => s.id === sessionId)?.label ?? sessionId
    return { index, label }
  }, [])
  /** True while a session switch is pending (between auto-select and useLayoutEffect).
   *  Prevents the animation frame from processing events in the wrong simulation context. */
  const sessionSwitchPendingRef = useRef(false)
  const [sessionsWithActivity, setSessionsWithActivity] = useState<Set<string>>(new Set())

  // User-defined tab names. These override the bridge-provided label and persist
  // across reloads (and survive bridge 'updated'/'list' events, which would
  // otherwise clobber a rename).
  const CUSTOM_LABELS_KEY = 'agent-orgchart:session-labels'
  const customLabelsRef = useRef<Map<string, string>>(new Map())
  const customLabelsLoadedRef = useRef(false)
  if (!customLabelsLoadedRef.current) {
    customLabelsLoadedRef.current = true
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(CUSTOM_LABELS_KEY)
        if (raw) customLabelsRef.current = new Map(Object.entries(JSON.parse(raw)))
      } catch { /* ignore malformed storage */ }
    }
  }
  // State mirror of the renames (the ref is for synchronous reads; state drives
  // the tab/node display via resolveSessionName). Populated post-mount to match
  // the archived-sessions pattern and avoid an SSR/hydration mismatch.
  const [sessionRenames, setSessionRenames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (customLabelsRef.current.size > 0) setSessionRenames(new Map(customLabelsRef.current))
  }, [])

  // Archived (closed) sessions, keyed by id in archive order (insertion order of
  // a Map is preserved). Persisted so a closed tab stays closed across reloads,
  // and stored with full SessionInfo so it can be reopened (undo). Their event
  // buffers are intentionally KEPT so a reopened tab restores its full state.
  const ARCHIVED_KEY = 'agent-orgchart:archived-sessions'
  const archivedRef = useRef<Map<string, SessionInfo>>(new Map())
  const archivedLoadedRef = useRef(false)
  if (!archivedLoadedRef.current) {
    archivedLoadedRef.current = true
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(ARCHIVED_KEY)
        if (raw) archivedRef.current = new Map((JSON.parse(raw) as SessionInfo[]).map(s => [s.id, s]))
      } catch { /* ignore malformed storage */ }
    }
  }
  // State mirror of the archive (ref is for synchronous reads inside event
  // handlers; state drives the "reopen" UI). Kept in sync via syncArchived().
  // NOTE: starts empty on both server and first client render — populating it
  // from localStorage happens AFTER mount (below) to avoid an SSR/client
  // hydration mismatch (the ref, which is not rendered, can load synchronously).
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([])
  useEffect(() => {
    if (archivedRef.current.size > 0) setArchivedSessions([...archivedRef.current.values()])
  }, [])
  const syncArchived = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...archivedRef.current.values()]))
      } catch { /* ignore quota/availability errors */ }
    }
    setArchivedSessions([...archivedRef.current.values()])
  }, [])

  // Persisted OPEN-tab order (array of session ids, left→right). Together with
  // the archived map this is the two-bucket persistence model: on reload a
  // session is restored as an open tab or hidden purely by whether it sits in
  // the archive, and open tabs come back in the exact order the user left them
  // (including any drag-reordering) rather than in the bridge's list order.
  const TAB_ORDER_KEY = 'agent-orgchart:tab-order'
  const tabOrderRef = useRef<string[]>([])
  const tabOrderLoadedRef = useRef(false)
  if (!tabOrderLoadedRef.current) {
    tabOrderLoadedRef.current = true
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(TAB_ORDER_KEY)
        if (raw) tabOrderRef.current = JSON.parse(raw) as string[]
      } catch { /* ignore malformed storage */ }
    }
  }
  const persistTabOrder = useCallback((ids: string[]) => {
    tabOrderRef.current = ids
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
    }
  }, [])
  /** Sort a session list by the persisted open-tab order (known ids first, in
   *  saved order; never-seen sessions keep their incoming order, appended), then
   *  persist the resolved order so it round-trips on the next reload. */
  const applyTabOrder = useCallback((list: SessionInfo[]): SessionInfo[] => {
    const rank = new Map(tabOrderRef.current.map((id, i) => [id, i]))
    const ordered = [...list].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return ra - rb // Array.sort is stable → unknowns keep incoming order
    })
    persistTabOrder(ordered.map(s => s.id))
    return ordered
  }, [persistTabOrder])

  // A tab rename no longer rewrites `label` — it's an OVERLAY (sessionRenames)
  // applied at display time (resolveSessionName). This keeps `label` == the
  // extension's goal summary, so the goal stays available as subtitle/tooltip
  // context even after a rename, and clearing a rename cleanly reveals the goal
  // again (no "lost original label" problem).

  // Connect to standalone dev relay server via SSE when not in VS Code
  useEffect(() => {
    if (typeof window === 'undefined') return
    const bridge = vscodeBridge
    if (!bridge) return

    // Skip in VS Code — extension handles events via postMessage
    if (bridge.isVSCode) return

    // Connect to relay in dev mode or standalone CLI mode
    const isStandalone = process.env.AGENT_FLOW_STANDALONE === '1'
    if (!isStandalone && (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_DEMO !== '0')) return

    const relayPort = process.env.NEXT_PUBLIC_RELAY_PORT || ''
    const es = new EventSource(relayPort ? `http://127.0.0.1:${relayPort}/events` : '/events')

    es.onopen = () => {
      setConnectionStatus('connected')
      setUseMockData(false)
    }
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        window.postMessage(data, '*')
      } catch {}
    }
    es.onerror = () => {
      setConnectionStatus('disconnected')
    }

    return () => {
      es.close()
    }
  }, [])

  useEffect(() => {
    const bridge = vscodeBridge
    if (!bridge) { return }

    // Listen for bridge initialization (event-driven, no polling)
    const unsubInit = bridge.onInit(() => {
      setIsVSCode(true)
      setUseMockData(false)
    })

    // Listen for events — buffer by session, deliver to pending if session matches.
    // selectedSessionIdRef is updated synchronously (not via React state) so it's
    // always current even before React re-renders.
    const unsubEvent = bridge.onEvent((event: AgentEvent) => {
      const simEvent: SimulationEvent = {
        time: event.time,
        type: event.type as SimulationEvent['type'],
        payload: event.payload,
        sessionId: event.sessionId,
      }

      // Always buffer by session (for replay on session switch — and so an
      // archived session can be fully restored when reopened).
      if (event.sessionId) {
        const buf = sessionEventsRef.current.get(event.sessionId) || []
        buf.push(simEvent)
        // Backstop against unbounded growth over a multi-hour session: trim the
        // oldest events and remember how many, so absolute indices still line up.
        if (buf.length > MAX_SESSION_BUFFER) {
          const drop = buf.length - MAX_SESSION_BUFFER
          buf.splice(0, drop)
          const prev = sessionDroppedRef.current.get(event.sessionId) ?? 0
          if (prev === 0) console.warn(`[bridge] session ${event.sessionId} exceeded ${MAX_SESSION_BUFFER} buffered events — trimming oldest (cold-start replay will begin mid-session)`)
          sessionDroppedRef.current.set(event.sessionId, prev + drop)
        }
        sessionEventsRef.current.set(event.sessionId, buf)
      }

      // Archived (closed) sessions are buffered above but otherwise hidden: no
      // delivery, no activity dot, no re-add. They stay closed until reopened.
      if (event.sessionId && archivedRef.current.has(event.sessionId)) return

      // Deliver to pending if session matches (ref is always current).
      // In parallel view (sentinel) every session's events are delivered.
      // Skip if a session switch is pending — useLayoutEffect will flush
      // from the session buffer once the simulation state is swapped.
      const selected = selectedSessionIdRef.current
      const isParallel = selected === PARALLEL_VIEW_ID
      if (selected && !sessionSwitchPendingRef.current && (isParallel || event.sessionId === selected)) {
        // In parallel view, namespace ids so same-named agents from different
        // sessions render as distinct nodes, and place/badge each orchestrator
        // (matching the merged-flush path exactly).
        pendingEventsRef.current.push(
          isParallel && event.sessionId ? namespaceEvent(simEvent, parallelMetaOf(event.sessionId)) : simEvent,
        )
        setEventVersion(v => v + 1)
      } else if (!isParallel && event.sessionId && event.sessionId !== selected) {
        // Track background activity for unselected sessions
        setSessionsWithActivity(prev => {
          if (prev.has(event.sessionId!)) return prev
          const next = new Set(prev)
          next.add(event.sessionId!)
          return next
        })
      }

      // Re-add dismissed sessions when new events arrive
      if (event.sessionId && dismissedSessionsRef.current.has(event.sessionId)) {
        const saved = dismissedSessionsRef.current.get(event.sessionId)
        dismissedSessionsRef.current.delete(event.sessionId)
        if (saved) {
          setSessions(prev => {
            if (prev.find(s => s.id === saved.id)) return prev
            const next = [...prev, { ...saved, status: 'active' as const, lastActivityTime: Date.now() }]
            persistTabOrder(next.map(s => s.id))
            return next
          })
        }
      }
    })

    const unsubStatus = bridge.onStatus((status) => {
      setConnectionStatus(status)
    })

    const unsubConfig = bridge.onConfig((config) => {
      if (config.showMockData !== undefined) { setUseMockData(config.showMockData) }
      if (config.disable1MContext !== undefined) { setDisable1MContext(config.disable1MContext) }
      if (config.studyWebsiteUrl !== undefined) { setStudyWebsiteUrl(config.studyWebsiteUrl) }
    })

    // Session lifecycle tracking
    // Note: these handlers only update session list + selection state.
    // Event flushing is handled by the consumer (index.tsx effect) to avoid
    // races between auto-flush here and save/restore logic there.
    const unsubSession = bridge.onSession((type, data) => {
      if (type === 'reset') {
        // Panel was reopened — clear all stale state
        setSessions([])
        setSelectedSessionId(null)
        selectedSessionIdRef.current = null
        pendingEventsRef.current.length = 0
        sessionEventsRef.current.clear()
        sessionDroppedRef.current.clear()
        sessionOrderRef.current.clear()
        sessionOrderNextRef.current = 0
        setSessionsWithActivity(new Set())
        dismissedSessionsRef.current.clear()
        setEventVersion(v => v + 1)
        return
      }
      if (type === 'list') {
        // Drop archived (closed) sessions so they don't reappear on reload, then
        // restore the user's saved left→right tab order (new sessions appended).
        const sessionList = applyTabOrder(
          (data as SessionInfo[])
            .filter(s => !archivedRef.current.has(s.id))
        )
        setSessions(sessionList)
        // Auto-select: prefer active sessions, then most recently active.
        // Only set selection — useLayoutEffect handles flushing events.
        if (!selectedSessionIdRef.current && sessionList.length > 0) {
          const sorted = [...sessionList].sort((a, b) => {
            const aActive = a.status === 'active' ? 1 : 0
            const bActive = b.status === 'active' ? 1 : 0
            if (aActive !== bActive) return bActive - aActive
            return b.lastActivityTime - a.lastActivityTime
          })
          const autoId = sorted[0].id
          sessionSwitchPendingRef.current = true
          pendingEventsRef.current.length = 0
          selectedSessionIdRef.current = autoId
          setSelectedSessionId(autoId)
        }
      } else if (type === 'started') {
        const session = data as SessionInfo
        // A user archived (closed) this session — keep it hidden even if it
        // starts/resumes again.
        if (archivedRef.current.has(session.id)) return
        setSessions(prev => {
          const existing = prev.find(s => s.id === session.id)
          if (existing) {
            // Session resumed after inactivity — mark active again
            return prev.map(s => s.id === session.id
              ? { ...s, status: 'active' as const, lastActivityTime: Date.now() }
              : s)
          }
          const next = [...prev, session]
          persistTabOrder(next.map(s => s.id))
          return next
        })
        // Don't switch when there's nothing to switch to:
        //  - Parallel view: the new/resumed session's events already flow into
        //    the merged canvas via the parallel delivery path.
        //  - The started session is already selected (a resume-after-inactivity
        //    'started' for the current tab).
        // In both cases, setting the switch-pending gate would freeze live
        // delivery (no selection change ⇒ no flush ever clears the gate), and in
        // the parallel case would also yank the user to a single, often
        // just-started, empty session ("waiting for an agent session").
        const activeSel = selectedSessionIdRef.current
        if (activeSel === PARALLEL_VIEW_ID || activeSel === session.id) return
        // Auto-select newly started session.
        // Set switch-pending flag to prevent the animation frame from processing
        // events in the wrong simulation state before useLayoutEffect swaps it.
        sessionSwitchPendingRef.current = true
        pendingEventsRef.current.length = 0
        selectedSessionIdRef.current = session.id
        setSelectedSessionId(session.id)
      } else if (type === 'updated') {
        const { sessionId, label, goal } = data as { sessionId: string; label: string; goal?: string }
        // `label`/`goal` are the extension's summaries; a user rename is a
        // separate overlay (sessionRenames), so it is not merged in here.
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, label, goal: goal ?? s.goal } : s
        ))
      } else if (type === 'ended') {
        const sessionId = data as string
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, status: 'completed' as const } : s
        ))
      }
    })

    return () => {
      unsubInit()
      unsubEvent()
      unsubStatus()
      unsubConfig()
      unsubSession()
    }
  }, [])

  const consumeEvents = useCallback(() => {
    // Clear in-place so stale closures in animation callbacks
    // also see the cleared array (prevents multi-frame reprocessing)
    pendingEventsRef.current.length = 0
  }, [])

  /** Switch session selection. Does NOT flush events — call flushSessionEvents
   *  from useLayoutEffect after the simulation state has been saved/swapped. */
  const selectSession = useCallback((sessionId: string | null) => {
    // Re-selecting the session that's already showing is a no-op. Falling
    // through would set sessionSwitchPendingRef=true, but the identical
    // setSelectedSessionId value bails out of React's update, so the
    // index.tsx useLayoutEffect (which clears the flag via flushSessionEvents)
    // never runs — stranding live delivery off until a reload. This is exactly
    // what happens when the user clicks the active tab or the "All agents"
    // segment while already in the parallel view.
    if (sessionId === selectedSessionIdRef.current) return
    // Block event delivery to pending until the simulation state is swapped
    sessionSwitchPendingRef.current = true
    pendingEventsRef.current.length = 0
    selectedSessionIdRef.current = sessionId
    setSelectedSessionId(sessionId)
    if (sessionId) {
      setSessionsWithActivity(prev => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }, [])

  /** All buffered events across every session, merged in chronological order.
   *  Backs the parallel view, which replays every session at once. */
  const mergedAllEvents = useCallback((): SimulationEvent[] => {
    // Namespace + augment each session's events, preserving that session's
    // original receive order (the same order its individual-tab view replays).
    const lists: SimulationEvent[][] = []
    for (const [sessionId, buf] of sessionEventsRef.current) {
      // Archived sessions are buffered (for reopen) but excluded from the view.
      if (archivedRef.current.has(sessionId)) continue
      const meta = parallelMetaOf(sessionId)
      lists.push(buf.map(evt => namespaceEvent(evt, meta)))
    }
    // Stable k-way merge by time: interleaves sessions chronologically while
    // NEVER reordering within a session (we only ever consume list heads). This
    // keeps the parallel view's per-session sequence identical to the single-tab
    // view, so both show the same tool calls and sub-agents.
    const ptrs = new Array(lists.length).fill(0)
    const total = lists.reduce((n, l) => n + l.length, 0)
    const merged: SimulationEvent[] = []
    for (let k = 0; k < total; k++) {
      let best = -1
      for (let i = 0; i < lists.length; i++) {
        if (ptrs[i] >= lists[i].length) continue
        if (best === -1 || lists[i][ptrs[i]].time < lists[best][ptrs[best]].time) best = i
      }
      merged.push(lists[best][ptrs[best]++])
    }
    return merged
  }, [parallelMetaOf])

  /** Flush buffered events for the selected session into pending.
   *  Must be called from useLayoutEffect AFTER simulation state is saved/swapped. */
  const flushSessionEvents = useCallback((sessionId: string, fromIndex = 0) => {
    sessionSwitchPendingRef.current = false
    const buffered = sessionId === PARALLEL_VIEW_ID
      ? mergedAllEvents()
      : (sessionEventsRef.current.get(sessionId) || [])
    // fromIndex is an ABSOLUTE processed-count; subtract events already trimmed
    // off the front (buffer cap) so we resume at the right place, not too late.
    let dropped = 0
    if (sessionId === PARALLEL_VIEW_ID) {
      for (const [sid, d] of sessionDroppedRef.current) {
        if (!archivedRef.current.has(sid)) dropped += d
      }
    } else {
      dropped = sessionDroppedRef.current.get(sessionId) ?? 0
    }
    pendingEventsRef.current.length = 0
    pendingEventsRef.current.push(...buffered.slice(Math.max(0, fromIndex - dropped)))
    setEventVersion(v => v + 1)
  }, [mergedAllEvents])

  const getSessionEventCount = useCallback((sessionId: string): number => {
    // ABSOLUTE count (includes events already trimmed off the front) so it stays
    // monotonic across a buffer cap — flushSessionEvents subtracts the drop.
    if (sessionId === PARALLEL_VIEW_ID) {
      let total = 0
      for (const [sid, buf] of sessionEventsRef.current) {
        total += buf.length + (sessionDroppedRef.current.get(sid) ?? 0)
      }
      return total
    }
    return (sessionEventsRef.current.get(sessionId)?.length ?? 0)
      + (sessionDroppedRef.current.get(sessionId) ?? 0)
  }, [])

  const dismissedSessionsRef = useRef<Map<string, SessionInfo>>(new Map())

  const removeSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === sessionId)
      // Archive persistently (with full info, in archive order) so the closed
      // tab stays closed across reloads, is ignored if the bridge re-lists or
      // the session resumes, and can be reopened later. Its event buffer is
      // KEPT so a reopened tab restores its full state.
      if (session) {
        dismissedSessionsRef.current.set(sessionId, session)
        archivedRef.current.set(sessionId, session)
        syncArchived()
      }
      const next = prev.filter(s => s.id !== sessionId)
      persistTabOrder(next.map(s => s.id))
      return next
    })
    setSessionsWithActivity(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [syncArchived, persistTabOrder])

  /** Reorder open tabs: move `fromId` into `toId`'s slot. Persisted so the new
   *  left→right order survives reload (drag-to-reorder in the tab bar). */
  const reorderSessions = useCallback((fromId: string, toId: string) => {
    setSessions(prev => {
      const from = prev.findIndex(s => s.id === fromId)
      const to = prev.findIndex(s => s.id === toId)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      persistTabOrder(next.map(s => s.id))
      return next
    })
  }, [persistTabOrder])

  /** Reopen a previously archived (closed) session. Un-archives it, restores its
   *  tab, and selects it — its kept buffer cold-starts to restore full state.
   *  Any archived session can be reopened directly (no LIFO undo). */
  const unarchiveSession = useCallback((sessionId: string) => {
    const info = archivedRef.current.get(sessionId)
    if (!info) return
    archivedRef.current.delete(sessionId)
    syncArchived()
    setSessions(prev => {
      if (prev.some(s => s.id === sessionId)) return prev
      const next = [...prev, info]
      persistTabOrder(next.map(s => s.id))
      return next
    })
    selectSession(sessionId)
  }, [syncArchived, selectSession, persistTabOrder])

  /** Rename a session tab. The rename is an OVERLAY (persisted) applied over the
   *  call-sign at display time — it does NOT rewrite the session's goal `label`.
   *  An empty/blank name clears the override, reverting to the call-sign. */
  const renameSession = useCallback((sessionId: string, label: string) => {
    const trimmed = label.trim()
    const next = new Map(customLabelsRef.current)
    if (trimmed) next.set(sessionId, trimmed)
    else next.delete(sessionId)
    customLabelsRef.current = next
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(CUSTOM_LABELS_KEY, JSON.stringify(Object.fromEntries(next)))
      } catch { /* ignore quota/availability errors */ }
    }
    setSessionRenames(next) // reflect immediately in tabs + nodes
  }, [])

  const bridgeOpenFile = useCallback((filePath: string, line?: number) => {
    vscodeBridge?.openFile(filePath, line)
  }, [])

  const resumeSession = useCallback((sessionId: string) => {
    vscodeBridge?.resumeSession(sessionId)
  }, [])

  return {
    isVSCode,
    connectionStatus,
    pendingEvents: pendingEventsRef.current,
    consumeEvents,
    useMockData,
    disable1MContext,
    studyWebsiteUrl,
    bridgeOpenFile,
    sessions,
    selectedSessionId,
    selectedSessionIdRef,
    selectSession,
    flushSessionEvents,
    getSessionEventCount,
    sessionsWithActivity,
    removeSession,
    reorderSessions,
    renameSession,
    sessionRenames,
    archivedSessions,
    unarchiveSession,
    resumeSession,
  }
}

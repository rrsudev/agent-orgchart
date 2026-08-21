"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { vscodeBridge } from "@/lib/vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useAgentColors, agentColorKey, AGENT_KEY_SEP } from "@/hooks/use-agent-colors"
import { useAgentNames } from "@/hooks/use-agent-names"
import { logInteraction } from "@/lib/interaction-log"
import { useSessionCallSigns } from "@/hooks/use-session-callsigns"
import { resolveSessionName, type SessionName } from "@/lib/callsigns"
import { AgentCanvas } from "./canvas"
import { ControlBar } from "./control-bar"
import { AgentDetailCard } from "./agent-detail-card"
import { AgentHoverTooltip } from "./agent-hover-tooltip"
import { GlassContextMenu } from "./glass-context-menu"
import { AgentColorSwatches } from "./agent-color-swatches"
// AgentChatPanel was merged into MessageFeedPanel (Global / Active sub-tabs).
import { ToolDetailPopup } from "./tool-detail-popup"
import { DiscoveryDetailPopup } from "./discovery-detail-popup"
import { FileAttentionPanel } from "./file-attention-panel"
import { OpenFileProvider } from "./tool-content-renderer"
import { stopPropagationHandlers } from "./shared-ui"
import { TimelineEvent, SimulationEvent, TIMING, Z } from "@/lib/agent-types"
import { PARALLEL_VIEW_ID } from "@/lib/bridge-types"
import { COLORS } from "@/lib/colors"
import { LayoutProvider, useLayout } from "@/lib/layout"

import { MessageFeedPanel } from "./message-feed-panel"
import { LegendLauncher, LegendPanel } from "./legend-panel"
import { ExportLauncher } from "./export-launcher"
import { BottomDock } from "./bottom-dock"
import { RailGuard } from "./rail-guard"
import { RailSlot, SideRail } from "./side-rail"
import { ChromeButton, Icon } from "./chrome"
import { TopBar } from "./top-bar"
import { useStudySession } from "@/hooks/use-study-session"
import { SessionTimerBar } from "./session-timer-bar"
import { StudySessionArchive } from "./study-session-archive"
import { ConfirmDialog, ProtocolPrompt } from "./study-session-dialogs"
import type { RecordedSimEvent } from "@/lib/study-session-types"

/** Stable empty event list so the simulation gets a constant identity while a
 *  study-session replay is active (stops live events from being consumed). */
const NO_EVENTS: SimulationEvent[] = []

// Namespacing for study-session replay: prefix identity fields by their source
// agent session so multiple tabs' agents render as distinct nodes (mirrors the
// parallel view). Times are already on the shared study-session clock.
const REPLAY_SEP = '␞'
const REPLAY_IDENTITY = ['name', 'parent', 'agent', 'child'] as const

/** Plain-English fallback for the status line when no live activity clause exists
 *  yet — a short, wrappable phrase so the "<call-sign> is …" line always reads as
 *  a sentence instead of a raw session slug. */
function friendlyStatus(state: string): string {
  switch (state) {
    case 'thinking': return 'thinking'
    case 'tool_calling': return 'working'
    case 'waiting_permission': return 'waiting for approval'
    case 'complete': return 'done'
    case 'error': return 'hit a snag'
    case 'paused': return 'paused'
    default: return 'getting started' // idle / unknown
  }
}
function toSimReplayEvent(r: RecordedSimEvent): SimulationEvent {
  const payload: Record<string, unknown> = { ...r.payload }
  if (r.sessionId) {
    if (r.type === 'agent_spawn' && typeof payload.name === 'string' && payload.displayName === undefined) {
      payload.displayName = payload.name
    }
    const prefix = r.sessionId + REPLAY_SEP
    for (const f of REPLAY_IDENTITY) {
      if (typeof payload[f] === 'string') payload[f] = prefix + (payload[f] as string)
    }
  }
  return { time: r.time, type: r.type as SimulationEvent['type'], payload, sessionId: r.sessionId }
}

/** Read-only replay notice. Sits on the top rail (below the bar) rather than at
 *  a fixed `top-4`, where it used to land on top of the session tabs. */
function ReplayBanner({ number, onExit }: { number: number; onExit: () => void }) {
  const layout = useLayout()
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 font-mono"
      style={{ top: layout.railTop, zIndex: Z.info, pointerEvents: 'auto', maxWidth: layout.panelWidth(420) }}
    >
      <div className="glass-card is-dense flex items-center gap-2.5" style={{ paddingInline: 12 }}>
        <Icon name="play" />
        <span className="ui-sm font-semibold truncate" style={{ color: COLORS.holoBright }}>
          Replaying session {number}
        </span>
        {!layout.compact && (
          <span className="ui-xs shrink-0" style={{ color: COLORS.textMuted }}>recorded · read-only</span>
        )}
        <ChromeButton
          size="sm"
          onClick={onExit}
          title="Leave replay and return to the live session"
          style={{ background: COLORS.liveResumeBg, borderColor: COLORS.liveResumeBorder, color: COLORS.liveText }}
        >
          Exit replay
        </ChromeButton>
      </div>
    </div>
  )
}

export function AgentVisualizer() {
  const bridge = useVSCodeBridge()

  // Study-session replay: when set, the simulation is showing a recorded past
  // session (not live), so live events are withheld from it.
  const [replaying, setReplaying] = useState<{ id: string; number: number } | null>(null)

  const {
    frameRef,
    agents,
    toolCalls,
    particles,
    edges,
    discoveries,
    fileAttention,
    currentTime,
    isPlaying,
    speed,
    maxTimeReached,
    conversations,
    play,
    pause,
    restart,
    setSpeed,
    seekToTime,
    updateAgentPosition,
    saveSnapshot,
    restoreSnapshot,
    beginColdLoad,
    loadReplay,
  } = useAgentSimulation({
    useMockData: bridge.useMockData,
    externalEvents: replaying ? NO_EVENTS : bridge.pendingEvents,
    onExternalEventsConsumed: bridge.consumeEvents,
    sessionFilter: bridge.selectedSessionId,
    // Pass the ref that's updated synchronously in session-started handler,
    // so the animation frame never uses a stale filter value.
    sessionFilterRef: bridge.selectedSessionIdRef,
    disable1MContext: bridge.disable1MContext,
  })

  // ─── Study session (participant work-period clock + logging) ───────────────
  const studyEnabled = !bridge.useMockData
  const study = useStudySession({ enabled: studyEnabled, studyWebsiteUrl: bridge.studyWebsiteUrl })
  const [showSessionArchive, setShowSessionArchive] = useState(false)
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  // User identity colors (persisted). Build a per-view map keyed by the canvas
  // agent id so drawAgents can look colors up directly. Resolution: an agent's
  // OWN color always wins; a subagent with no color of its own inherits its
  // orchestrator's color, so a session reads as one color group unless the user
  // deliberately recolors a child.
  const { colors: agentColorStore, setAgentColor } = useAgentColors()
  const agentColors = useMemo(() => {
    const sessionOf = (id: string) =>
      id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : (bridge.selectedSessionId ?? '')

    // First pass: each session's main-agent (orchestrator) explicit color.
    const orchestratorColorBySession = new Map<string, string>()
    for (const [id, agent] of agents) {
      if (!agent.isMain) continue
      const own = agentColorStore.get(agentColorKey(bridge.selectedSessionId, id))
      if (own) orchestratorColorBySession.set(sessionOf(id), own)
    }

    // Second pass: resolve every agent (own color, else inherited for subagents).
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      const own = agentColorStore.get(agentColorKey(bridge.selectedSessionId, id))
      if (own) { m.set(id, own); continue }
      if (!agent.isMain) {
        const inherited = orchestratorColorBySession.get(sessionOf(id))
        if (inherited) m.set(id, inherited)
      }
    }
    return m
  }, [agents, agentColorStore, bridge.selectedSessionId])

  // Per-session tab accent: ONLY the orchestrator's user-assigned identity color
  // (so a colored tab ties to its nodes on canvas). Sessions the user hasn't
  // colored are omitted — their tabs stay plain white with no accent.
  const sessionAccentColors = useMemo(() => {
    const sessionOf = (id: string) =>
      id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : (bridge.selectedSessionId ?? '')
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      if (!agent.isMain) continue
      const own = agentColorStore.get(agentColorKey(bridge.selectedSessionId, id))
      if (own) m.set(sessionOf(id), own)
    }
    return m
  }, [agents, agentColorStore, bridge.selectedSessionId])

  // Effective display names: a per-agent (node) rename wins; else the main agent
  // shows its session CALL-SIGN (or the tab rename); subagents fall through to
  // the extension-provided name (Type · description).
  const { names: agentNameStore, setAgentName } = useAgentNames()
  // Neutral call-signs (Apple, Mango, …), auto-assigned + persisted per session.
  const callSigns = useSessionCallSigns(bridge.sessions)
  // Per-session display: call-sign as the NAME (tab + main node), goal summary as
  // secondary context (node subtitle + tab tooltip). A tab rename overrides the
  // call-sign — see resolveSessionName.
  const sessionDisplay = useMemo(() => {
    const m = new Map<string, SessionName>()
    for (const s of bridge.sessions) {
      const base = resolveSessionName(s.label, callSigns.get(s.id), bridge.sessionRenames.get(s.id))
      // Prefer the fuller goal text from the host over the compact label-derived
      // one, so the node subtitle + hover show more than the ~2-word summary.
      const full = s.goal?.trim()
      const goal = full && full !== base.name ? full : base.goal
      m.set(s.id, { name: base.name, goal })
    }
    return m
  }, [bridge.sessions, callSigns, bridge.sessionRenames])
  // Same resolution for ARCHIVED (closed) sessions so the reopen menu shows the
  // call-sign / rename, not the bare goal or "Session <id>" placeholder. Archived
  // sessions have no live call-sign (pruned on close), so this yields the rename
  // if any, else the goal label.
  const archivedDisplay = useMemo(() => {
    const m = new Map<string, SessionName>()
    for (const s of bridge.archivedSessions) {
      m.set(s.id, resolveSessionName(s.label, callSigns.get(s.id), bridge.sessionRenames.get(s.id)))
    }
    return m
  }, [bridge.archivedSessions, callSigns, bridge.sessionRenames])
  const nameOverrides = useMemo(() => {
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      const custom = agentNameStore.get(agentColorKey(bridge.selectedSessionId, id))
      if (custom) { m.set(id, custom); continue }
      if (agent.isMain) {
        const sid = id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : bridge.selectedSessionId
        const disp = sid ? sessionDisplay.get(sid) : undefined
        if (disp) m.set(id, disp.name)
      }
    }
    return m
  }, [agents, agentNameStore, bridge.selectedSessionId, sessionDisplay])

  // Session goals per MAIN agent — the full goal text, used by the hover tooltip
  // and the detail-card task fallback. Not shown directly on the canvas.
  const agentGoals = useMemo(() => {
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      if (!agent.isMain) continue
      const sid = id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : bridge.selectedSessionId
      const disp = sid ? sessionDisplay.get(sid) : undefined
      if (disp?.goal) m.set(id, disp.goal)
    }
    return m
  }, [agents, bridge.selectedSessionId, sessionDisplay])

  // Dim second line under each node on the CANVAS — the "status layer". The node's
  // name is drawn directly above, so the status starts at "is …" rather than
  // repeating the call-sign ("Apple" / "is coding…"). Uses the live activity clause
  // when one exists ("is debugging server-side issues"), otherwise a plain-English
  // default from the agent's state ("is thinking"). The animated trailing ellipsis
  // is added at draw time. Never shows the raw session title/slug — that stays on
  // the hover + detail card. Gated at draw time by the sublabels toggle.
  const agentSubtitles = useMemo(() => {
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      const activity = agent.statusLine || friendlyStatus(agent.state)
      m.set(id, `is ${activity}`)
    }
    return m
  }, [agents])

  // Full goal / task text shown in a cursor-following tooltip on hover — a
  // "read it all" fallback since the node subtitle is only a 2-line preview.
  // Main agents surface their session goal; subagents surface their full task.
  const hoverText = useMemo(() => {
    const id = selection.hoveredAgentId
    if (!id) return null
    const agent = agents.get(id)
    if (!agent) return null
    return (agent.isMain ? agentGoals.get(id) : agent.task) ?? null
  }, [selection.hoveredAgentId, agents, agentGoals])

  // Agents with names overlaid — used by the React panels (canvas gets the map).
  const displayAgents = useMemo(() => {
    if (nameOverrides.size === 0) return agents
    const m = new Map(agents)
    for (const [id, name] of nameOverrides) {
      const a = m.get(id)
      if (a) m.set(id, { ...a, name })
    }
    return m
  }, [agents, nameOverrides])

  // Inline rename overlay (double-click a node, or the context-menu item).
  const [renaming, setRenaming] = useState<{ agentId: string; x: number; y: number } | null>(null)
  const commitRename = useCallback((value: string) => {
    setRenaming(r => {
      if (r) {
        const key = agentColorKey(bridge.selectedSessionId, r.agentId)
        const previous = agentNameStore.get(key) ?? ''
        const next = value.trim()
        setAgentName(key, value)
        // Log every rename (incl. clears) for the study, tied to the session.
        if (next !== previous) {
          logInteraction({
            kind: 'agent-rename', agentId: r.agentId,
            sessionId: bridge.selectedSessionId ?? undefined,
            studySessionId: study.current?.id, previous, next,
          })
        }
      }
      return null
    })
  }, [setAgentName, bridge.selectedSessionId, agentNameStore, study])

  const [showStats, setShowStats] = useState(false)
  // Token bar visibility — a user preference, persisted across reloads. Defaults
  // on; loaded from localStorage after mount to avoid an SSR/hydration mismatch.
  const [showTokens, setShowTokens] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('agent-orgchart:show-tokens')
    if (v != null) setShowTokens(v === '1')
  }, [])
  const toggleTokens = useCallback(() => {
    setShowTokens(prev => {
      const next = !prev
      try { window.localStorage.setItem('agent-orgchart:show-tokens', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  // Inline goal sublabel under nodes — OFF by default; the hover tooltip is the
  // usual way to read a node's goal. Persisted across reloads (loaded post-mount
  // to avoid an SSR/hydration mismatch).
  const [showSubtitles, setShowSubtitles] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('agent-orgchart:show-subtitles')
    if (v != null) setShowSubtitles(v === '1')
  }, [])
  const toggleSubtitles = useCallback(() => {
    setShowSubtitles(prev => {
      const next = !prev
      try { window.localStorage.setItem('agent-orgchart:show-subtitles', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  // Tell the host whether the status line is visible so it only spends OpenRouter
  // credits while the toggle is on. Re-sent when the bridge (re)connects.
  useEffect(() => {
    vscodeBridge?.setStatusVisible(showSubtitles)
  }, [showSubtitles, bridge.isVSCode])

  // Full-text vs. bubbles for the conversation feed. Off by default → messages
  // render as short truncated bubbles; on → the complete message text. Persisted.
  const [showFullText, setShowFullText] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('agent-orgchart:show-fulltext')
    if (v != null) setShowFullText(v === '1')
  }, [])
  const toggleFullText = useCallback(() => {
    setShowFullText(prev => {
      const next = !prev
      try { window.localStorage.setItem('agent-orgchart:show-fulltext', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const [showHexGrid, setShowHexGrid] = useState(false)
  const [showFileAttention, setShowFileAttention] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

  // Unified conversation panel: Global (full session transcript) / Active thread.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMode, setChatMode] = useState<'global' | 'active'>('global')
  const toggleFiles = useCallback(() => setShowFileAttention(prev => !prev), [])
  const toggleChat = useCallback(() => { setChatOpen(o => !o); setChatMode('global') }, [])
  // Stable identity so RailGuard's effect isn't re-run every render.
  const railClosers = useMemo(() => ({
    files: () => setShowFileAttention(false),
    chat: () => setChatOpen(false),
    legend: () => setShowLegend(false),
  }), [])
  const closeFileAttention = railClosers.files
  const closeLegend = railClosers.legend

  // Selecting an agent node opens the conversation panel on that agent's thread.
  useEffect(() => {
    if (selection.selectedAgentId) { setChatOpen(true); setChatMode('active') }
  }, [selection.selectedAgentId])
  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0)

  const [isReviewing, setIsReviewing] = useState(false)

  // Auto-play on mount
  useEffect(() => {
    const timer = setTimeout(() => play(), TIMING.autoPlayDelayMs)
    return () => clearTimeout(timer)
  }, [play])

  // Per-session state cache: save/restore simulation state on tab switch
  // so sessions stay up to date and switching is instant.
  // useLayoutEffect ensures restart happens synchronously before any animation
  // frame can consume and discard events from pendingEventsRef.
  const sessionCacheRef = useRef<Map<string, { snapshot: ReturnType<typeof saveSnapshot>; eventCount: number }>>(new Map())
  const prevSelectedRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    // Selection cleared (e.g. panel reset, or last session closed): drop the
    // per-session cache and the prev marker so a subsequently re-selected id —
    // even the same one that was selected before — still cold-starts instead of
    // being skipped by the `!== prevSelectedRef.current` guard.
    if (bridge.selectedSessionId === null) {
      sessionCacheRef.current.clear()
      prevSelectedRef.current = null
      return
    }
    if (bridge.selectedSessionId && bridge.selectedSessionId !== prevSelectedRef.current) {
      // Save outgoing session state (if any). The parallel view is not cached.
      if (prevSelectedRef.current !== null && prevSelectedRef.current !== PARALLEL_VIEW_ID) {
        sessionCacheRef.current.set(prevSelectedRef.current, {
          snapshot: saveSnapshot(),
          eventCount: bridge.getSessionEventCount(prevSelectedRef.current),
        })
      }

      // Restore or cold-start the incoming session, then flush events.
      // Flushing happens HERE (after state swap) to prevent the animation
      // frame from processing events in the wrong simulation context.
      // The parallel view is never cached — its merged event set grows as
      // sessions receive events, so it always cold-starts from all buffers.
      const cached = bridge.selectedSessionId === PARALLEL_VIEW_ID
        ? undefined
        : sessionCacheRef.current.get(bridge.selectedSessionId)
      if (cached) {
        // Restore the exact saved layout + camera (per-session camera memory in
        // the canvas). Don't re-frame — the whole point is that switching back
        // shows the session precisely as the user left it, hand-dragged nodes
        // and all — so we DON'T bump the zoom-to-fit trigger here.
        restoreSnapshot(cached.snapshot)
        bridge.flushSessionEvents(bridge.selectedSessionId, cached.eventCount)
      } else {
        // Cold start: snap the flushed history to settled visuals (no replayed
        // spawn animations) and re-frame the freshly-built layout.
        restart()
        beginColdLoad()
        bridge.flushSessionEvents(bridge.selectedSessionId)
        // Re-frame the incoming session. This resets the camera's userHasNavigated
        // flag so continuous auto-fit re-engages and pulls the new nodes into view.
        setZoomToFitTrigger(n => n + 1)
      }

      // The incoming session cold-starts/restores as live (isPlaying: true), so
      // clear Review mode — otherwise the control bar would keep showing the
      // paused review scrubber while the new session is actually playing.
      setIsReviewing(false)

      prevSelectedRef.current = bridge.selectedSessionId
    }
  }, [bridge.selectedSessionId, restart, beginColdLoad, bridge.flushSessionEvents, saveSnapshot, restoreSnapshot, bridge.getSessionEventCount])

  // Timeline events — incremental: only processes new conversation messages
  const timelineCacheRef = useRef<{
    counts: Map<string, number>
    events: TimelineEvent[]
    idCounter: number
  }>({ counts: new Map(), events: [], idCounter: 0 })

  const timelineEvents = useMemo((): TimelineEvent[] => {
    const cache = timelineCacheRef.current
    let appended = false
    for (const [agentId, msgs] of conversations) {
      const prevLen = cache.counts.get(agentId) ?? 0
      if (msgs.length > prevLen) {
        for (let i = prevLen; i < msgs.length; i++) {
          const msg = msgs[i]
          cache.events.push({
            id: `event-${cache.idCounter++}`,
            type: msg.type === 'tool_call' ? 'tool_call' : msg.type === 'tool_result' ? 'tool_result' : 'message',
            label: msg.content.slice(0, 20),
            timestamp: msg.timestamp,
            nodeId: agentId,
          })
        }
        cache.counts.set(agentId, msgs.length)
        appended = true
      }
    }
    if (appended) cache.events.sort((a, b) => a.timestamp - b.timestamp)
    return cache.events
  }, [conversations])

  // Review mode: when in live mode and user pauses to scrub through history

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
      setIsReviewing(true)
    } else {
      play()
    }
  }, [isPlaying, play, pause])

  // Root element for the container-measured layout system (drives responsive
  // panel sizing/placement — see @/lib/layout).
  const rootRef = useRef<HTMLDivElement>(null)

  // The replay scrubber's seek schedules a resume; keep the ref + its cleanup.
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  // ─── Study-session controls ────────────────────────────────────────────────
  const hasRunningAgents = useMemo(() => {
    for (const a of agents.values()) {
      if (a.state === 'thinking' || a.state === 'tool_calling' || a.state === 'waiting_permission') return true
    }
    return false
  }, [agents])

  // Pausing the clock is confirmed while agents are still working (the clock
  // stops, but the agents keep running) — otherwise it pauses immediately.
  const handleSessionPauseClick = useCallback(() => {
    if (hasRunningAgents) setPauseConfirmOpen(true)
    else study.pause()
  }, [hasRunningAgents, study])

  const confirmSessionPause = useCallback(() => {
    setPauseConfirmOpen(false)
    study.pause()
  }, [study])

  const confirmSessionEnd = useCallback(() => {
    setEndConfirmOpen(false)
    study.endSession()
  }, [study])

  const openEndConfirm = useCallback(() => setEndConfirmOpen(true), [])
  const openSessionArchive = useCallback(() => setShowSessionArchive(true), [])

  // Replay a recorded past session (parked at 0:00 — scrub/play via the Review
  // control bar). Live events are withheld until replay is exited.
  const handleReplaySession = useCallback((id: string) => {
    const rec = study.getRecording(id)
    if (!rec || rec.length === 0) return
    const info = study.archive.find(a => a.id === id)
    pause()
    setReplaying({ id, number: info?.number ?? 0 })
    setIsReviewing(true)
    setShowSessionArchive(false)
    selection.clearAllSelections()
    loadReplay(rec.map(toSimReplayEvent))
    setZoomToFitTrigger(n => n + 1)
  }, [study, pause, loadReplay, selection])

  // Leave replay and rebuild the live view of the selected session (mirrors a
  // cold-start tab switch: restart, then flush that session's buffer).
  const exitReplay = useCallback(() => {
    if (!replaying) return
    setReplaying(null)
    setIsReviewing(false)
    restart()
    if (bridge.selectedSessionId) {
      beginColdLoad()
      bridge.flushSessionEvents(bridge.selectedSessionId)
    }
    setZoomToFitTrigger(n => n + 1)
  }, [replaying, restart, beginColdLoad, bridge])

  // Tab actions must leave replay first, or the switched-in session would render
  // empty (live events are withheld while replaying).
  const handleSelectSession = useCallback((id: string) => {
    if (replaying) exitReplay()
    bridge.selectSession(id)
  }, [replaying, exitReplay, bridge])
  const handleReopenSession = useCallback((id: string) => {
    if (replaying) exitReplay()
    bridge.unarchiveSession(id)
  }, [replaying, exitReplay, bridge])

  // Resume a closed session's underlying Claude chat in a terminal. Logged as a
  // study interaction (reopening a closed session is meaningful behavior).
  const handleResumeSession = useCallback((id: string) => {
    bridge.resumeSession(id)
    logInteraction({ kind: 'session-resume', sessionId: id, studySessionId: study.current?.id })
  }, [bridge, study])

  // Tab rename — apply, then log it for the study (tied to the agent session).
  const handleRenameSession = useCallback((id: string, label: string) => {
    const previous = bridge.sessionRenames.get(id) ?? ''
    const next = label.trim()
    bridge.renameSession(id, label)
    if (next !== previous) {
      logInteraction({
        kind: 'session-rename', sessionId: id,
        studySessionId: study.current?.id, previous, next,
      })
    }
  }, [bridge, study])

  // Keyboard shortcuts
  const keyboardActions = useMemo(() => ({
    // Play/pause only applies to the replay scrubber now — live view has no
    // transport, so space is a no-op there (avoids pausing with no way back).
    togglePlayPause: () => { if (replaying) handlePlayPause() },
    toggleFilePanel: toggleFiles,
    toggleChat,
    toggleHexGrid: () => { setShowHexGrid(prev => !prev) },
    toggleStats: () => { setShowStats(prev => !prev) },
    zoomToFit: () => { setZoomToFitTrigger(n => n + 1) },
    clearSelection: () => { selection.clearAllSelections() },
    deselectAgent: () => { selection.clearAgent() },
    closeChat: () => { setChatOpen(false) },
    setSpeed,
    selectedAgentId: selection.selectedAgentId,
  }), [replaying, handlePlayPause, selection.clearAllSelections, selection.clearAgent, selection.selectedAgentId, setSpeed, toggleFiles, toggleChat])

  useKeyboardShortcuts(keyboardActions)


  const selectedAgent = selection.selectedAgentId ? displayAgents.get(selection.selectedAgentId) : null

  // Session runtime — drives the assistant label (CLAUDE vs CODEX) in transcript panels
  const sessionRuntime = useMemo(() => {
    for (const a of agents.values()) {
      if (a.runtime === 'codex') return 'codex' as const
    }
    return 'claude' as const
  }, [agents])

  // Context menu items
  const contextMenuItems = selection.contextMenu ? (
    selection.contextMenu.agentId ? [
      {
        node: (
          <AgentColorSwatches
            selected={agentColorStore.get(agentColorKey(bridge.selectedSessionId, selection.contextMenu.agentId))}
            onPick={(hex) => {
              setAgentColor(agentColorKey(bridge.selectedSessionId, selection.contextMenu!.agentId!), hex)
              selection.setContextMenu(null)
            }}
          />
        ),
      },
      { separator: true },
      {
        label: 'Rename',
        icon: 'pencil' as const,
        onClick: () => {
          const cm = selection.contextMenu
          if (cm?.agentId) setRenaming({ agentId: cm.agentId, x: cm.x, y: cm.y })
        },
      },
      { label: 'Toggle stats', icon: 'stats' as const, onClick: () => setShowStats(prev => !prev) },
      { label: 'Toggle token bar', icon: 'tokens' as const, onClick: toggleTokens },
      { label: 'Toggle sublabels', icon: 'label' as const, onClick: toggleSubtitles },
    ] : [
      { label: 'Zoom to fit', icon: 'fit' as const, onClick: () => setZoomToFitTrigger(n => n + 1) },
      { label: 'Toggle stats', icon: 'stats' as const, onClick: () => setShowStats(prev => !prev) },
      { label: 'Toggle token bar', icon: 'tokens' as const, onClick: toggleTokens },
      { label: 'Toggle sublabels', icon: 'label' as const, onClick: toggleSubtitles },
      { label: 'Toggle grid', icon: 'grid' as const, onClick: () => setShowHexGrid(prev => !prev) },
      { label: 'Toggle legend', icon: 'info' as const, onClick: () => setShowLegend(prev => !prev) },
      { label: '', onClick: () => {}, separator: true },
      { label: 'Restart', icon: 'restart' as const, onClick: restart },
    ]
  ) : []

  const handleCloseSession = useCallback((id: string) => {
    const remaining = bridge.sessions.filter(s => s.id !== id)
    bridge.removeSession(id)
    sessionCacheRef.current.delete(id)

    if (bridge.selectedSessionId === PARALLEL_VIEW_ID) {
      // The tab bar (which hosts the "All agents" segment) hides at ≤1 session,
      // so a parallel view of ≤1 session would strand the user with no way out.
      // Drop back to a concrete session in that case; otherwise stay in parallel
      // but re-flush so the closed session's nodes leave the merged canvas.
      if (remaining.length <= 1) {
        bridge.selectSession(remaining.length === 1 ? remaining[0].id : null)
        if (remaining.length === 0) restart()
      } else {
        restart()
        beginColdLoad()
        bridge.flushSessionEvents(PARALLEL_VIEW_ID)
      }
    } else if (bridge.selectedSessionId === id) {
      if (remaining.length > 0) {
        // Switching to the neighbour is a cold start via the layout effect if it
        // isn't cached; the effect's own beginColdLoad handles that path.
        bridge.selectSession(remaining[remaining.length - 1].id)
      } else {
        // Last session closed: deselect FIRST (mirrors the parallel branch above).
        // Without this, selectedSessionIdRef stays pinned to the just-closed id, so
        // reopening it hits selectSession's same-id early-return and the canvas never
        // cold-starts — a permanent blank, unrecoverable without a reload since the
        // tab bar is hidden at ≤1 session.
        bridge.selectSession(null)
        restart()
      }
    }
  }, [bridge, restart, beginColdLoad])

  const openFile = useCallback((filePath: string, line?: number) => {
    bridge.bridgeOpenFile(filePath, line)
  }, [bridge])

  // "Waiting for an agent session" should only show when there truly is no
  // session — not during the brief window after entering the parallel view / a
  // cold-start tab switch, where agents.size is momentarily 0 while flushed
  // events repopulate over the next animation frames.
  const isEmpty = agents.size === 0 && !bridge.useMockData && bridge.sessions.length === 0 && !replaying

  return (
    <OpenFileProvider value={bridge.isVSCode ? openFile : null}>
    <div ref={rootRef} className="h-screen w-full max-w-full relative overflow-hidden" style={{ background: COLORS.void }}>
      <LayoutProvider containerRef={rootRef} isVSCode={bridge.isVSCode}>
      {/* Empty state when no demo and no live data */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div
            className="glass-card relative flex flex-col items-center text-center font-mono"
            style={{ padding: '28px 40px', maxWidth: 340 }}
          >
            {/* Idle status dot — echoes the LIVE indicator's visual language */}
            <span
              className="w-2.5 h-2.5 rounded-full animate-pulse"
              style={{ background: COLORS.idle, boxShadow: `0 0 8px ${COLORS.idle}` }}
              aria-hidden="true"
            />
            <div className="mt-3.5 text-[14px] font-medium" style={{ color: COLORS.textDim }}>Waiting for an agent session</div>
            <div className="mt-1.5 text-[12px]" style={{ color: COLORS.textMuted }}>Start a Claude Code session to see activity</div>
          </div>
        </div>
      )}

      {/* Canvas fills everything */}
      <AgentCanvas
        simulationRef={frameRef}
        viewKey={bridge.selectedSessionId}
        selectedAgentId={selection.selectedAgentId}
        hoveredAgentId={selection.hoveredAgentId}
        showStats={showStats}
        showTokens={showTokens}
        showSubtitles={showSubtitles}
        showHexGrid={showHexGrid}
        zoomToFitTrigger={zoomToFitTrigger}
        pauseAutoFit={selection.contextMenu !== null}
        rightPanelOpen={showFileAttention || chatOpen}
        showFullText={showFullText}
        onAgentClick={selection.handleAgentClick}
        onAgentHover={selection.setHoveredAgentId}
        onAgentDrag={updateAgentPosition}
        onContextMenu={selection.handleContextMenu}
        onToolCallClick={selection.handleToolCallClick}
        selectedToolCallId={selection.selectedToolCallId}
        onDiscoveryClick={selection.handleDiscoveryClick}
        selectedDiscoveryId={selection.selectedDiscoveryId}
        agentColors={agentColors}
        agentNames={nameOverrides}
        agentSubtitles={agentSubtitles}
        onAgentDoubleClick={(agentId, x, y) => setRenaming({ agentId, x, y })}
        onAgentNameClick={(agentId, x, y) => setRenaming({ agentId, x, y })}
      />

      {/* Keeps panels off each other when the surface can't hold them all. */}
      <RailGuard files={showFileAttention} chat={chatOpen} legend={showLegend} close={railClosers} />

      {/* Cursor-following full-goal / full-task tooltip on node hover. */}
      <AgentHoverTooltip text={hoverText} />

      {/* Left rail: what the agents are touching, and what the visuals mean. */}
      <SideRail side="left">
        <RailSlot>
          <FileAttentionPanel
            visible={showFileAttention}
            fileAttention={fileAttention}
            onClose={closeFileAttention}
            onOpenFile={bridge.isVSCode ? openFile : undefined}
          />
        </RailSlot>
        <RailSlot pin="bottom">
          <LegendPanel visible={showLegend} onClose={closeLegend} />
        </RailSlot>
      </SideRail>

      {/* Right rail: the selected agent, then what it has been saying. */}
      <SideRail side="right">
        <RailSlot>
          {selectedAgent && selection.selectedAgentWorldPos && (
            <div {...stopPropagationHandlers} className="flex flex-col min-h-0">
              <AgentDetailCard
                agent={{
                  ...selectedAgent,
                  // Show the full task; main agents fall back to the session goal.
                  task: selectedAgent.task ?? agentGoals.get(selectedAgent.id),
                }}
                onRename={(name) => {
                  const key = agentColorKey(bridge.selectedSessionId, selectedAgent.id)
                  const previous = agentNameStore.get(key) ?? ''
                  const next = (name ?? '').trim()
                  setAgentName(key, name || null)
                  if (next !== previous) {
                    logInteraction({
                      kind: 'agent-rename', agentId: selectedAgent.id,
                      sessionId: bridge.selectedSessionId ?? undefined,
                      studySessionId: study.current?.id, previous, next,
                    })
                  }
                }}
                onClose={selection.clearAgent}
              />
            </div>
          )}
        </RailSlot>
        <RailSlot>
          <MessageFeedPanel
            conversations={conversations}
            agents={displayAgents}
            onAgentClick={selection.handleAgentClick}
            selectedAgentId={selection.selectedAgentId}
            runtime={sessionRuntime}
            open={chatOpen}
            onOpenChange={setChatOpen}
            mode={chatMode}
            onModeChange={setChatMode}
            fullText={showFullText}
          />
        </RailSlot>
      </SideRail>

      {/* Tool call detail popup */}
      {selection.selectedToolData && selection.selectedToolScreenPos && (
        <div {...stopPropagationHandlers}>
          <ToolDetailPopup
            tool={selection.selectedToolData}
            position={selection.selectedToolScreenPos}
            onClose={selection.clearTool}
          />
        </div>
      )}

      {/* Discovery detail popup */}
      {selection.selectedDiscoveryData && selection.selectedDiscoveryScreenPos && (
        <div {...stopPropagationHandlers}>
          <DiscoveryDetailPopup
            discovery={selection.selectedDiscoveryData}
            position={selection.selectedDiscoveryScreenPos}
            onClose={selection.clearDiscovery}
          />
        </div>
      )}

      {/* Context menu */}
      {selection.contextMenu && (
        <GlassContextMenu
          position={selection.contextMenu}
          items={contextMenuItems}
          onClose={() => selection.setContextMenu(null)}
        />
      )}

      {/* Inline agent rename (double-click a node, or context-menu → Rename) */}
      {renaming && (
        <div
          {...stopPropagationHandlers}
          style={{ position: 'fixed', left: renaming.x, top: renaming.y, zIndex: Z.contextMenu }}
        >
          <input
            autoFocus
            defaultValue={nameOverrides.get(renaming.agentId) ?? displayAgents.get(renaming.agentId)?.name ?? ''}
            placeholder="Agent name"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(e.currentTarget.value)
              else if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            className="rounded-md px-2 py-1 text-[12px] outline-none"
            style={{
              minWidth: 160,
              background: COLORS.glassBg,
              border: `1px solid ${COLORS.tabSelectedBorder}`,
              color: COLORS.textPrimary,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          />
        </div>
      )}

      {/* The bottom edge, as one row: the legend launcher on the left and, in
          the center, either the replay scrubber (while replaying a recorded
          session) or the live study-session clock. They share one slot because
          they never coexist, and the dock reports its height so every side
          panel's bottom rail follows it. */}
      <BottomDock
        left={
          <div className="flex items-center" style={{ gap: 8 }}>
            <LegendLauncher active={showLegend} onOpen={() => setShowLegend(true)} />
            <ExportLauncher
              isVSCode={bridge.isVSCode}
              onExport={bridge.isVSCode ? (() => vscodeBridge?.packageStudyData()) : undefined}
              onRevealFolder={bridge.isVSCode ? (() => vscodeBridge?.revealStudyData()) : undefined}
            />
          </div>
        }
        center={replaying ? (
          <ControlBar
            isPlaying={isPlaying}
            speed={speed}
            currentTime={currentTime}
            totalDuration={Math.max(maxTimeReached, currentTime)}
            onPlayPause={handlePlayPause}
            onRestart={() => { setIsReviewing(true); seekToTime(0) }}
            onSpeedChange={setSpeed}
            onSeek={(time) => {
              pause()
              seekToTime(time)
              setZoomToFitTrigger(n => n + 1)
              if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
            }}
            timelineEvents={timelineEvents}
            isReviewing={isReviewing}
            eventCount={timelineEvents.length}
            onResumeLive={exitReplay}
          />
        ) : studyEnabled && study.current ? (
          <SessionTimerBar
            session={study.current}
            onPause={handleSessionPauseClick}
            onResume={study.resume}
            onEnd={openEndConfirm}
            onOpenArchive={openSessionArchive}
            archiveCount={study.archive.length}
          />
        ) : null}
      />

      {/* Top bar: session tabs + info/controls */}
      <TopBar
        sessions={bridge.sessions}
        sessionDisplay={sessionDisplay}
        selectedSessionId={bridge.selectedSessionId}
        sessionsWithActivity={bridge.sessionsWithActivity}
        accentColors={sessionAccentColors}
        onSelectSession={handleSelectSession}
        onCloseSession={handleCloseSession}
        onRenameSession={handleRenameSession}
        onReorderSession={bridge.reorderSessions}
        archivedSessions={bridge.archivedSessions}
        archivedDisplay={archivedDisplay}
        onReopenSession={handleReopenSession}
        onResumeSession={bridge.isVSCode ? handleResumeSession : undefined}
        isVSCode={bridge.isVSCode}
        connectionStatus={bridge.connectionStatus}
        agentCount={agents.size}
        showFileAttention={showFileAttention}
        showFullText={showFullText}
        showSubtitles={showSubtitles}
        onToggleFiles={toggleFiles}
        onToggleFullText={toggleFullText}
        onToggleSubtitles={toggleSubtitles}
        onReturnToStudy={study.openStudyWebsite}
        onRevealStudyData={bridge.isVSCode ? (() => vscodeBridge?.revealStudyData()) : undefined}
        onExportStudyData={bridge.isVSCode ? (() => vscodeBridge?.packageStudyData()) : undefined}
      />

      {/* Replay banner while reviewing a recorded past session */}
      {replaying && <ReplayBanner number={replaying.number} onExit={exitReplay} />}

      {/* Study session archive — past sessions, replay to retrace steps */}
      <StudySessionArchive
        open={showSessionArchive}
        onClose={() => setShowSessionArchive(false)}
        archive={study.archive}
        onReplay={handleReplaySession}
        onDelete={study.deleteArchived}
      />

      {/* 15-minute protocol popup (dismissable — keeps the session going) */}
      {study.protocolPromptOpen && (
        <ProtocolPrompt
          onOpenWebsite={study.openStudyWebsite}
          onDismiss={study.dismissProtocolPrompt}
        />
      )}

      {/* Pause confirmation — agents still running */}
      {pauseConfirmOpen && (
        <ConfirmDialog
          title="Agents are still running"
          body="Pausing stops your session clock, but any running agents keep working. Pause anyway?"
          confirmLabel="Pause anyway"
          cancelLabel="Keep going"
          onConfirm={confirmSessionPause}
          onCancel={() => setPauseConfirmOpen(false)}
        />
      )}

      {/* End-session confirmation */}
      {endConfirmOpen && (
        <ConfirmDialog
          title="End this session?"
          body={hasRunningAgents
            ? 'This finalizes the current session in the logs and starts a new one at 0:00. Agents that are still running will keep working.'
            : 'This finalizes the current session in the logs and starts a new one at 0:00.'}
          confirmLabel="End session"
          cancelLabel="Cancel"
          tone="danger"
          onConfirm={confirmSessionEnd}
          onCancel={() => setEndConfirmOpen(false)}
        />
      )}
      </LayoutProvider>
    </div>
    </OpenFileProvider>
  )
}

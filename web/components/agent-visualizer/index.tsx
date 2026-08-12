"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useAgentColors, agentColorKey, AGENT_KEY_SEP } from "@/hooks/use-agent-colors"
import { useAgentNames } from "@/hooks/use-agent-names"
import { AgentCanvas } from "./canvas"
import { ControlBar } from "./control-bar"
import { AgentDetailCard } from "./agent-detail-card"
import { GlassContextMenu } from "./glass-context-menu"
import { AgentColorSwatches } from "./agent-color-swatches"
// AgentChatPanel was merged into MessageFeedPanel (Global / Active sub-tabs).
import { ToolDetailPopup } from "./tool-detail-popup"
import { DiscoveryDetailPopup } from "./discovery-detail-popup"
import { FileAttentionPanel } from "./file-attention-panel"
import { TimelinePanel } from "./timeline-panel"
import { OpenFileProvider } from "./tool-content-renderer"
import { stopPropagationHandlers } from "./shared-ui"
import { TimelineEvent, TIMING, Z } from "@/lib/agent-types"
import { PARALLEL_VIEW_ID } from "@/lib/bridge-types"
import { COLORS } from "@/lib/colors"

import { MOCK_DURATION } from "@/lib/mock-scenario"
import { MessageFeedPanel } from "./message-feed-panel"
import { LegendPanel } from "./legend-panel"
import { TopBar } from "./top-bar"
import { PromptComposerPanel } from "./prompt-composer-panel"

export function AgentVisualizer() {
  const bridge = useVSCodeBridge()

  const {
    frameRef,
    agents,
    toolCalls,
    particles,
    edges,
    discoveries,
    fileAttention,
    timelineEntries,
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
  } = useAgentSimulation({
    useMockData: bridge.useMockData,
    externalEvents: bridge.pendingEvents,
    onExternalEventsConsumed: bridge.consumeEvents,
    sessionFilter: bridge.selectedSessionId,
    // Pass the ref that's updated synchronously in session-started handler,
    // so the animation frame never uses a stale filter value.
    sessionFilterRef: bridge.selectedSessionIdRef,
    disable1MContext: bridge.disable1MContext,
  })

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

  // Effective display names: custom rename wins; else the main agent shows its
  // session label (which the extension derives from ai-title / cleaned prompt);
  // subagents fall through to the extension-provided name (Type · description).
  const { names: agentNameStore, setAgentName } = useAgentNames()
  const sessionLabelById = useMemo(
    () => new Map(bridge.sessions.map(s => [s.id, s.label] as const)),
    [bridge.sessions],
  )
  const nameOverrides = useMemo(() => {
    const m = new Map<string, string>()
    for (const [id, agent] of agents) {
      const custom = agentNameStore.get(agentColorKey(bridge.selectedSessionId, id))
      if (custom) { m.set(id, custom); continue }
      if (agent.isMain) {
        const sid = id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : bridge.selectedSessionId
        const label = sid ? sessionLabelById.get(sid) : undefined
        if (label) m.set(id, label)
      }
    }
    return m
  }, [agents, agentNameStore, bridge.selectedSessionId, sessionLabelById])

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
      if (r) setAgentName(agentColorKey(bridge.selectedSessionId, r.agentId), value)
      return null
    })
  }, [setAgentName, bridge.selectedSessionId])

  const [showStats, setShowStats] = useState(false)
  const [showHexGrid, setShowHexGrid] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showFileAttention, setShowFileAttention] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const [showComposer, setShowComposer] = useState(false)

  // Unified conversation panel: Global (full session transcript) / Active thread.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMode, setChatMode] = useState<'global' | 'active'>('global')
  const toggleFiles = useCallback(() => setShowFileAttention(prev => !prev), [])
  const toggleChat = useCallback(() => { setChatOpen(o => !o); setChatMode('global') }, [])

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
        restoreSnapshot(cached.snapshot)
        bridge.flushSessionEvents(bridge.selectedSessionId, cached.eventCount)
      } else {
        restart()
        bridge.flushSessionEvents(bridge.selectedSessionId)
      }

      // The incoming session cold-starts/restores as live (isPlaying: true), so
      // clear Review mode — otherwise the control bar would keep showing the
      // paused review scrubber while the new session is actually playing.
      setIsReviewing(false)

      prevSelectedRef.current = bridge.selectedSessionId
    }
  }, [bridge.selectedSessionId, restart, bridge.flushSessionEvents, saveSnapshot, restoreSnapshot, bridge.getSessionEventCount])

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

  const handleEnterReview = useCallback(() => {
    pause()
    setIsReviewing(true)
  }, [pause])

  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResumeLive = useCallback(() => {
    setIsReviewing(false)
    seekToTime(maxTimeReached)
    setZoomToFitTrigger(n => n + 1)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { resumeTimerRef.current = null; play() }, TIMING.resumeLiveDelayMs)
  }, [seekToTime, maxTimeReached, play])
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  const handleRestart = useCallback(() => {
    setIsReviewing(false)
    restart(true)
  }, [restart])

  // Keyboard shortcuts
  const keyboardActions = useMemo(() => ({
    togglePlayPause: handlePlayPause,
    toggleFilePanel: toggleFiles,
    toggleChat,
    toggleTimeline: () => { setShowTimeline(prev => !prev) },
    toggleHexGrid: () => { setShowHexGrid(prev => !prev) },
    toggleStats: () => { setShowStats(prev => !prev) },
    zoomToFit: () => { setZoomToFitTrigger(n => n + 1) },
    clearSelection: () => { selection.clearAllSelections() },
    deselectAgent: () => { selection.clearAgent() },
    closeChat: () => { setChatOpen(false) },
    setSpeed,
    selectedAgentId: selection.selectedAgentId,
  }), [handlePlayPause, selection.clearAllSelections, selection.clearAgent, selection.selectedAgentId, setSpeed, toggleFiles, toggleChat])

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
        label: '✎  Rename',
        onClick: () => {
          const cm = selection.contextMenu
          if (cm?.agentId) setRenaming({ agentId: cm.agentId, x: cm.x, y: cm.y })
        },
      },
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
    ] : [
      { label: '🔍  Zoom to Fit', onClick: () => setZoomToFitTrigger(n => n + 1) },
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
      { label: '⬡  Toggle Grid', onClick: () => setShowHexGrid(prev => !prev) },
      { label: 'ⓘ  Toggle Legend', onClick: () => setShowLegend(prev => !prev) },
      { label: '', onClick: () => {}, separator: true },
      { label: '⟲  Restart', onClick: restart },
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
        bridge.flushSessionEvents(PARALLEL_VIEW_ID)
      }
    } else if (bridge.selectedSessionId === id) {
      if (remaining.length > 0) {
        bridge.selectSession(remaining[remaining.length - 1].id)
      } else {
        restart()
      }
    }
  }, [bridge, restart])

  const openFile = useCallback((filePath: string, line?: number) => {
    bridge.bridgeOpenFile(filePath, line)
  }, [bridge])

  // "Waiting for an agent session" should only show when there truly is no
  // session — not during the brief window after entering the parallel view / a
  // cold-start tab switch, where agents.size is momentarily 0 while flushed
  // events repopulate over the next animation frames.
  const isEmpty = agents.size === 0 && !bridge.useMockData && bridge.sessions.length === 0

  return (
    <OpenFileProvider value={bridge.isVSCode ? openFile : null}>
    <div className="h-screen w-screen relative overflow-hidden" style={{ background: COLORS.void }}>
      {/* Empty state when no demo and no live data */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <div className="text-base font-medium" style={{ color: COLORS.textDim, letterSpacing: '-0.01em' }}>Waiting for an agent session</div>
            <div className="mt-1.5 text-sm" style={{ color: COLORS.textMuted }}>Start a Claude Code session to see activity</div>
          </div>
        </div>
      )}

      {/* Canvas fills everything */}
      <AgentCanvas
        simulationRef={frameRef}
        selectedAgentId={selection.selectedAgentId}
        hoveredAgentId={selection.hoveredAgentId}
        showStats={showStats}
        showHexGrid={showHexGrid}
        zoomToFitTrigger={zoomToFitTrigger}
        pauseAutoFit={selection.contextMenu !== null}
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
        onAgentDoubleClick={(agentId, x, y) => setRenaming({ agentId, x, y })}
      />

      {/* Legend (bottom-left) — documents the visual language */}
      <LegendPanel visible={showLegend} onClose={() => setShowLegend(false)} onOpen={() => setShowLegend(true)} />

      {/* Unified conversation panel (top-right): Global transcript / Active thread */}
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
      />

      {/* Agent detail card (floating, tethered to node) */}
      {selectedAgent && selection.selectedAgentWorldPos && (
        <div {...stopPropagationHandlers}>
          <AgentDetailCard
            agent={selectedAgent}
            onClose={selection.clearAgent}
          />
        </div>
      )}

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

      {/* Floating control strip */}
      <ControlBar
        isPlaying={isPlaying}
        speed={speed}
        currentTime={currentTime}
        totalDuration={bridge.useMockData
          ? (isReviewing ? Math.max(maxTimeReached, currentTime) : MOCK_DURATION)
          : Math.max(maxTimeReached, currentTime)
        }
        onPlayPause={handlePlayPause}
        onRestart={handleRestart}
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
        onEnterReview={handleEnterReview}
        onResumeLive={handleResumeLive}
      />

      {/* File attention panel (slide-in from right) */}
      <FileAttentionPanel
        visible={showFileAttention}
        fileAttention={fileAttention}
        onClose={() => setShowFileAttention(false)}
        onOpenFile={bridge.isVSCode ? openFile : undefined}
      />

      {/* Timeline panel (slide-in from bottom) */}
      <TimelinePanel
        visible={showTimeline}
        timelineEntries={timelineEntries}
        currentTime={currentTime}
        onClose={() => setShowTimeline(false)}
      />

      {/* Top bar: session tabs + info/controls */}
      <TopBar
        sessions={bridge.sessions}
        selectedSessionId={bridge.selectedSessionId}
        sessionsWithActivity={bridge.sessionsWithActivity}
        onSelectSession={bridge.selectSession}
        onCloseSession={handleCloseSession}
        onRenameSession={bridge.renameSession}
        archivedSessions={bridge.archivedSessions}
        onReopenSession={bridge.unarchiveSession}
        isVSCode={bridge.isVSCode}
        connectionStatus={bridge.connectionStatus}
        agentCount={agents.size}
        showFileAttention={showFileAttention}
        showChat={chatOpen}
        showTimeline={showTimeline}
        onToggleFiles={toggleFiles}
        onToggleChat={toggleChat}
        onToggleTimeline={() => setShowTimeline(prev => !prev)}
        onNewAgent={() => setShowComposer(true)}
      />

      {/* Prompt composer: build a `claude` command to launch a new agent */}
      <PromptComposerPanel
        visible={showComposer}
        onClose={() => setShowComposer(false)}
      />
    </div>
    </OpenFileProvider>
  )
}

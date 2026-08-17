'use client'

import { useState, useRef, useMemo } from 'react'
import { Agent } from '@/lib/agent-types'
import { COLORS, ROLE_COLORS } from '@/lib/colors'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useVirtualList } from '@/hooks/use-virtual-list'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { TranscriptMessage } from './transcript-message'
import { Icon, ChromeButton } from './chrome'
import { useLayout } from '@/lib/layout'

// Only text messages count toward the collapsed "latest message" pill.
const TEXT_TYPES = new Set(['assistant', 'user', 'thinking'])
const COLLAPSED_AGENT_NAME_MAX = 14
const PREVIEW_MAX = 40
const GAP = 8

/** Tallest the feed may grow, so it never swallows the canvas it annotates.
 *  A short surface (a bottom-docked panel) gets the tighter cap. */
const MAX_H = 460
const MAX_H_SHORT = 260

type Mode = 'global' | 'active'

interface MessageFeedPanelProps {
  conversations: Map<string, ConversationMessage[]>
  agents: Map<string, Agent>
  onAgentClick: (agentId: string | null) => void
  selectedAgentId: string | null
  /** Runtime of the current session — picks the assistant label (CLAUDE/CODEX). */
  runtime?: 'claude' | 'codex'
  /** Controlled open/collapsed state (driven by the top bar + `c` shortcut). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Controlled sub-tab: Global (full session transcript) vs Active (one agent). */
  mode: Mode
  onModeChange: (mode: Mode) => void
}

/**
 * The single conversation surface. One sub-tab toggle switches between:
 *   • Global — the full session transcript: every agent's messages AND tool
 *     calls merged chronologically, searchable (this replaces the old separate
 *     Transcript panel).
 *   • Active — the selected agent's own thread.
 * Collapsed, it shows a one-line pill with the latest message.
 */
export function MessageFeedPanel({
  conversations,
  agents,
  onAgentClick,
  selectedAgentId,
  runtime,
  open,
  onOpenChange,
  mode,
  onModeChange,
}: MessageFeedPanelProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  // ── Sizing ────────────────────────────────────────────────────────────────
  // The right rail owns placement and width (see side-rail.tsx); this panel only
  // caps its own height.
  const layout = useLayout()
  // A cap, not the budget: the rail shrinks the card further when the column is
  // crowded, and the transcript below scrolls.
  const panelMaxH = Math.min(layout.short ? MAX_H_SHORT : MAX_H, layout.panelHeight())

  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const multiAgent = agents.size > 1

  // Stable key that only changes when agent set membership or names change
  const agentKey = useMemo(() => {
    const parts: string[] = []
    for (const [id, a] of agents) parts.push(`${id}:${a.name}:${a.isMain}`)
    return parts.sort().join('|')
  }, [agents])

  // ── Latest message across all agents (collapsed pill) ──
  const latestMessage = useMemo(() => {
    const currentAgents = agentsRef.current
    let latest: (ConversationMessage & { agentId: string }) | null = null
    for (const [agentId, msgs] of conversations) {
      if (!currentAgents.has(agentId)) continue
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (!TEXT_TYPES.has(msgs[i].type)) continue
        if (!latest || msgs[i].timestamp > latest.timestamp) latest = { ...msgs[i], agentId }
        break
      }
    }
    return latest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, agentKey])

  // ── Global: full session transcript (all message types, merged) ──
  const sessionMessages = useMemo(() => {
    if (!open || mode !== 'global') return []
    const currentAgents = agentsRef.current
    const all: (ConversationMessage & { agentId: string })[] = []
    for (const [agentId, msgs] of conversations) {
      if (!currentAgents.has(agentId)) continue
      for (const m of msgs) all.push({ ...m, agentId })
    }
    all.sort((a, b) => a.timestamp - b.timestamp)
    if (!searchQuery.trim()) return all
    const q = searchQuery.toLowerCase()
    return all.filter(m => m.content.toLowerCase().includes(q) || (m.toolName || '').toLowerCase().includes(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, conversations, agentKey, searchQuery])

  const { visibleItems, totalHeight, offsetTop, handleScroll, measureRef } =
    useVirtualList(sessionMessages, logRef, { gap: GAP, autoScroll: true })

  // ── Tab: the current tab's thread — the selected agent, or (when nothing is
  // selected) the session's main agent, so it's never empty. ──
  const mainAgentId = useMemo(() => {
    for (const [id, a] of agents) if (a.isMain) return id
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey])
  const threadAgentId = selectedAgentId ?? mainAgentId
  const threadAgent = threadAgentId ? agents.get(threadAgentId) : null
  const activeConversation = useMemo(
    () => (mode === 'active' && threadAgentId ? conversations.get(threadAgentId) ?? [] : []),
    [mode, threadAgentId, conversations],
  )
  const { ref: activeLogRef } = useAutoScroll(activeConversation.length, open && mode === 'active')

  const labelFor = (a?: Agent | null) => ((a?.runtime ?? runtime) === 'codex' ? 'CODEX' : 'CLAUDE')

  if (!latestMessage && agents.size === 0) return null

  // ── Collapsed pill ──
  if (!open) {
    if (!latestMessage) return null
    const agent = agents.get(latestMessage.agentId)
    const agentName = agent?.name ?? latestMessage.agentId
    const role = ROLE_COLORS[latestMessage.type] ?? ROLE_COLORS.assistant
    const preview = latestMessage.content.replace(/\n/g, ' ').slice(0, PREVIEW_MAX)

    return (
      <div
        className="cursor-pointer transition-transform hover:scale-[1.01]"
        onClick={() => onOpenChange(true)}
        // The pill has always been a clickable div; now that it announces itself
        // as a button it has to be reachable and operable from the keyboard too.
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChange(true) }
        }}
        aria-label="Expand the conversation panel"
        title="Show the conversation panel"
      >
        {/* Deliberately slighter than the expanded panel: collapsed, this is a
            peek at the last thing said, not a reading surface — so it runs a
            step down the type scale and on tighter padding than a `is-dense`
            card, and sits as a thin strip at the head of the rail. */}
        <div
          className="glass-card flex items-center gap-2"
          style={{ maxWidth: '100%', padding: '5px 9px' }}
        >
          <div className="rounded-full shrink-0" style={{ width: 5, height: 5, background: role.text }} />
          <span className="ui-2xs font-semibold shrink-0" style={{ color: COLORS.textPrimary }}>
            {agentName.length > COLLAPSED_AGENT_NAME_MAX ? agentName.slice(0, COLLAPSED_AGENT_NAME_MAX) + '…' : agentName}
          </span>
          <span className="ui-2xs truncate" style={{ color: role.text + 'cc' }}>
            {preview}{latestMessage.content.length > PREVIEW_MAX ? '…' : ''}
          </span>
          <span className="shrink-0" style={{ color: COLORS.textMuted }}>
            <Icon name="chevronDown" size={10} />
          </span>
        </div>
      </div>
    )
  }

  // ── Expanded: Global (transcript) / Tab (current tab's thread) ──
  return (
    // A flex COLUMN, not a row: as a row the card became a horizontally
    // content-sized flex item, so it floated inboard and left a gap between
    // itself and the surface edge instead of filling its rail.
    <div className="flex flex-col min-h-0" onClick={(e) => e.stopPropagation()}>
      {/* The card owns the height budget and the body flexes inside it, so the
          list is whatever is left over rather than a hand-tuned subtraction. */}
      <div className="glass-card is-dense flex flex-col min-h-0" style={{ maxHeight: panelMaxH }}>
        {/* Header: sub-tabs + (global) search + collapse */}
        <div className="flex items-center justify-between pb-1.5 gap-2 shrink-0">
          <SubTabs mode={mode} onModeChange={onModeChange} threadEnabled={!!threadAgentId} />
          <div className="flex items-center gap-1 shrink-0">
            {mode === 'global' && (
              <ChromeButton
                onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery('') }}
                tone={showSearch ? 'accent' : 'ghost'}
                size="sm"
                icon="search"
                iconOnly
                aria-pressed={showSearch}
                aria-label="Search the transcript"
                title="Search the transcript"
              />
            )}
            <ChromeButton
              onClick={() => onOpenChange(false)}
              tone="ghost"
              size="sm"
              aria-label="Collapse the conversation panel"
              title="Collapse the conversation panel"
            >
              {/* No "chevron up" in the icon set — the down chevron flipped keeps
                  the same stroke weight as every other glyph in the chrome. */}
              <Icon name="chevronDown" className="rotate-180" />
            </ChromeButton>
          </div>
        </div>

        {/* Global search bar */}
        {mode === 'global' && showSearch && (
          <div className="pb-1.5 shrink-0" style={{ borderBottom: `1px solid ${COLORS.holoBorder06}` }}>
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery('') } e.stopPropagation() }}
              placeholder="Filter transcript…"
              aria-label="Filter transcript"
              className="w-full px-2 ui-xs outline-none"
              style={{
                height: 'var(--ctl-h-sm)',
                borderRadius: 'var(--ctl-radius)',
                background: COLORS.holoBg05,
                border: `1px solid ${COLORS.holoBorder12}`,
                color: COLORS.assistantText,
              }}
            />
          </div>
        )}

        {/* Body */}
        {mode === 'global' ? (
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="panel-scroll flex-auto min-h-0 pt-2"
          >
            {sessionMessages.length === 0 ? (
              <EmptyHint text={searchQuery ? 'No matching messages' : 'Waiting for session activity…'} />
            ) : (
              <div style={{ height: totalHeight, position: 'relative' }}>
                <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
                  {visibleItems.map((msg) => {
                    const agent = agents.get(msg.agentId)
                    return (
                      <div key={msg.id} ref={(el) => measureRef(msg.id, el)} style={{ marginBottom: GAP }}>
                        {multiAgent && (
                          <button
                            onClick={() => onAgentClick(msg.agentId)}
                            className="ui-2xs mb-0.5 px-1 rounded transition-colors hover:underline max-w-full truncate"
                            style={{ color: COLORS.textMuted }}
                            title={`Select ${agent?.name ?? msg.agentId}`}
                          >
                            {agent?.name ?? msg.agentId}
                          </button>
                        )}
                        <TranscriptMessage message={msg} searchQuery={searchQuery} assistantLabel={labelFor(agent)} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={activeLogRef}
            className="panel-scroll flex-auto min-h-0 space-y-1.5 pt-2"
          >
            {!threadAgent ? (
              <EmptyHint text="No messages yet" />
            ) : activeConversation.length === 0 ? (
              <EmptyHint text="No messages yet" />
            ) : (
              activeConversation.map((msg) => (
                <TranscriptMessage key={msg.id} message={msg} assistantLabel={labelFor(threadAgent)} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The Global/Tab switch, as one segmented control.
 *
 * The two used to be independent buttons that changed shape with their state —
 * an accent-filled pill when selected, bare text when not, and a heavier font
 * weight on the active one. Since "Global" and "Tab" are different lengths to
 * begin with, every switch resized both segments and shifted the row. Here the
 * segments share a track, hold one width, and keep one font weight; only the
 * capsule moves. It is the same raised-white-on-grey language the session tabs
 * above it already use, so the two tab strips read as the same control.
 */
const SEGMENT_MIN_W = 62
const SEGMENT_SHADOW = '0 1px 2px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)'

function SubTabs({ mode, onModeChange, threadEnabled }: {
  mode: Mode
  onModeChange: (mode: Mode) => void
  /** The Tab view needs an agent thread to show. */
  threadEnabled: boolean
}) {
  const segments: { id: Mode; label: string; title: string; disabled?: boolean }[] = [
    { id: 'global', label: 'Global', title: 'Every agent’s messages and tool calls, merged' },
    { id: 'active', label: 'Tab', title: 'The selected agent’s own thread', disabled: !threadEnabled },
  ]
  return (
    <div
      role="tablist"
      aria-label="Conversation view"
      className="flex items-center shrink-0"
      style={{
        padding: 2,
        borderRadius: 9,
        background: 'rgba(0, 0, 0, 0.045)',
        border: `1px solid ${COLORS.holoBorder08}`,
      }}
    >
      {segments.map(({ id, label, title, disabled }) => {
        const active = mode === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => !disabled && onModeChange(id)}
            title={title}
            className="inline-flex items-center justify-center transition-colors"
            style={{
              minWidth: SEGMENT_MIN_W,
              height: 'var(--ctl-h-sm)',
              paddingInline: 8,
              borderRadius: 7,
              // Weight is constant across states — a bolder active label would
              // resize the segment and nudge everything beside it.
              fontSize: 'var(--ui-sm)',
              fontWeight: 600,
              background: active ? '#ffffff' : 'transparent',
              boxShadow: active ? SEGMENT_SHADOW : 'none',
              color: disabled ? COLORS.textMuted + '80' : active ? COLORS.textPrimary : COLORS.textDim,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-6">
      <span className="ui-xs" style={{ color: COLORS.textMuted }}>{text}</span>
    </div>
  )
}

'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { Agent, Z } from '@/lib/agent-types'
import { COLORS, ROLE_COLORS } from '@/lib/colors'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useVirtualList } from '@/hooks/use-virtual-list'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { TranscriptMessage } from './transcript-message'

// Only text messages count toward the collapsed "latest message" pill.
const TEXT_TYPES = new Set(['assistant', 'user', 'thinking'])
const COLLAPSED_AGENT_NAME_MAX = 16
const PREVIEW_MAX = 50
const GAP = 8

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

  // ── Active: selected agent's own thread ──
  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : null
  const activeConversation = useMemo(
    () => (mode === 'active' && selectedAgentId ? conversations.get(selectedAgentId) ?? [] : []),
    [mode, selectedAgentId, conversations],
  )
  const { ref: activeLogRef } = useAutoScroll(activeConversation.length, open && mode === 'active')

  const panelRef = useRef<HTMLDivElement>(null)
  const collapse = useCallback(() => onOpenChange(false), [onOpenChange])
  useClickOutside(panelRef, collapse)

  const labelFor = (a?: Agent) => ((a?.runtime ?? runtime) === 'codex' ? 'CODEX' : 'CLAUDE')

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
        className="absolute cursor-pointer transition-all hover:scale-[1.02] flex justify-end"
        style={{ top: 66, right: 12, zIndex: Z.info, pointerEvents: 'auto' }}
        onClick={() => onOpenChange(true)}
      >
        <div className="glass-card px-3 py-2 flex items-center gap-2" style={{ maxWidth: 320 }}>
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: role.text }} />
          <span className="text-[9px] font-mono font-semibold shrink-0" style={{ color: COLORS.textPrimary }}>
            {agentName.length > COLLAPSED_AGENT_NAME_MAX ? agentName.slice(0, COLLAPSED_AGENT_NAME_MAX) + '…' : agentName}
          </span>
          <span className="text-[9px] font-mono truncate" style={{ color: role.text + 'cc' }}>
            {preview}{latestMessage.content.length > PREVIEW_MAX ? '…' : ''}
          </span>
          <span className="text-[9px] shrink-0" style={{ color: COLORS.textMuted }}>▾</span>
        </div>
      </div>
    )
  }

  // ── Expanded: Global (transcript) / Active (thread) ──
  return (
    <div
      ref={panelRef}
      className="absolute"
      style={{ top: 66, right: 12, zIndex: Z.info, pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="glass-card flex flex-col" style={{ width: 340, maxHeight: 460 }}>
        {/* Header: sub-tabs + (global) search + collapse */}
        <div className="flex items-center justify-between px-2 pt-2 pb-1.5 gap-2">
          <div className="flex gap-0.5 min-w-0">
            <SubTab label="Global" active={mode === 'global'} onClick={() => onModeChange('global')} />
            <SubTab
              label={selectedAgent ? `Active · ${selectedAgent.name}` : 'Active'}
              active={mode === 'active'}
              disabled={!selectedAgentId}
              onClick={() => selectedAgentId && onModeChange('active')}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {mode === 'global' && (
              <button
                onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery('') }}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-all"
                style={{ background: showSearch ? COLORS.toggleActive : 'transparent', color: showSearch ? COLORS.assistantText : COLORS.textMuted }}
                title="Search the transcript"
              >
                /
              </button>
            )}
            <button onClick={() => onOpenChange(false)} className="text-[9px] px-1 transition-colors" style={{ color: COLORS.textMuted }}>▴</button>
          </div>
        </div>

        {/* Global search bar */}
        {mode === 'global' && showSearch && (
          <div className="px-2 pb-1.5" style={{ borderBottom: `1px solid ${COLORS.holoBorder06}` }}>
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery('') } e.stopPropagation() }}
              placeholder="Filter transcript…"
              className="w-full px-2 py-1 rounded text-[10px] font-mono outline-none"
              style={{ background: COLORS.holoBg05, border: `1px solid ${COLORS.holoBorder12}`, color: COLORS.assistantText }}
            />
          </div>
        )}

        {/* Body */}
        {mode === 'global' ? (
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-2 py-2"
            style={{ maxHeight: 380, scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}
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
                            className="text-[8px] font-mono mb-0.5 px-1 rounded transition-colors hover:underline"
                            style={{ color: COLORS.textMuted }}
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
            className="flex-1 overflow-y-auto space-y-1.5 px-2 py-2"
            style={{ maxHeight: 380, scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}
          >
            {!selectedAgent ? (
              <EmptyHint text="Select an agent to view its thread" />
            ) : activeConversation.length === 0 ? (
              <EmptyHint text="No messages yet" />
            ) : (
              activeConversation.map((msg) => (
                <TranscriptMessage key={msg.id} message={msg} assistantLabel={labelFor(selectedAgent)} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SubTab({ label, active, onClick, disabled }: {
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider transition-all shrink-0 max-w-[180px] truncate"
      style={{
        background: active ? COLORS.holoBase + '20' : 'transparent',
        color: disabled ? COLORS.textMuted + '80' : active ? COLORS.holoBase : COLORS.textMuted,
        border: active ? `1px solid ${COLORS.holoBase}30` : '1px solid transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label.toUpperCase()}
    </button>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-6">
      <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>{text}</span>
    </div>
  )
}

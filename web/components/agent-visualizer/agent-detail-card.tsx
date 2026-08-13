'use client'

import { useEffect, useRef, useState } from 'react'
import { CARD, Z, type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { formatTokens, formatModelName } from '@/lib/utils'
import { GlassCard } from './glass-card'
import { PanelHeader, ProgressBar } from './shared-ui'

interface AgentDetailCardProps {
  agent: {
    id: string
    name: string
    state: AgentState
    model?: string
    tokensUsed: number
    tokensMax: number
    toolCalls: number
    timeAlive: number
    currentTool?: string
    /** Full task / goal text for this agent (untruncated). */
    task?: string
  }
  /** Persist a custom name for this agent. Empty string clears it (restores the
   *  default call-sign / label). */
  onRename: (name: string) => void
  onClose: () => void
}

export function AgentDetailCard({
  agent,
  onRename,
  onClose,
}: AgentDetailCardProps) {
  const contextPercent = Math.round((agent.tokensUsed / agent.tokensMax) * 100)
  const stateColor = getStateColor(agent.state)

  // Inline rename — click the name (or the ✎) to edit; Enter/blur commits,
  // Escape cancels. An empty commit clears the override back to the default.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.name)
  const inputRef = useRef<HTMLInputElement>(null)

  // Leaving edit mode when the selected agent changes avoids carrying one
  // agent's draft onto another.
  useEffect(() => { setEditing(false) }, [agent.id])
  useEffect(() => {
    if (editing) { setDraft(agent.name); inputRef.current?.focus(); inputRef.current?.select() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the draft only when entering edit mode
  }, [editing])

  const commit = () => { onRename(draft.trim()); setEditing(false) }

  // Fixed position: middle-left of the screen (below message feed panel)
  const left = CARD.margin
  const top = typeof window !== 'undefined' ? Math.max(100, (window.innerHeight - CARD.detail.height) / 2) : 300

  return (
    <GlassCard
      visible={true}
      className="agent-detail-card"
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD.detail.width,
        zIndex: Z.detailCard,
      }}
    >
      <PanelHeader onClose={onClose} className="mb-3">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: stateColor, boxShadow: `0 0 8px ${stateColor}` }}
        />
        <div className="flex flex-col min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commit}
              placeholder="Agent name"
              className="bg-transparent outline-none border-0 p-0 m-0 text-xs font-mono"
              style={{ color: COLORS.textPrimary, minWidth: 0, width: '100%' }}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              title="Rename this agent"
              className="group flex items-center gap-1 text-left"
              style={{ minWidth: 0 }}
            >
              <span className="text-xs font-mono truncate" style={{ color: COLORS.textPrimary }}>
                {agent.name}
              </span>
              <span
                className="text-[9px] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                style={{ color: COLORS.textMuted }}
                aria-hidden="true"
              >
                ✎
              </span>
            </button>
          )}
          {agent.model && (
            <span className="text-[9px] font-mono" style={{ color: COLORS.textDim }}>
              {formatModelName(agent.model)}
            </span>
          )}
        </div>
      </PanelHeader>

      {/* Context bar */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-[10px]" style={{ color: COLORS.textMuted }}>Context</span>
          <span className="text-[10px] font-mono" style={{ color: COLORS.textDim }}>
            {formatTokens(agent.tokensUsed)} / {formatTokens(agent.tokensMax)} ({contextPercent}%)
          </span>
        </div>
        <ProgressBar percent={contextPercent} color={stateColor} />
      </div>

      {/* Stats row */}
      <div className="flex gap-3 mb-3 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
        <span>{agent.toolCalls} tools</span>
        <span>{agent.timeAlive.toFixed(1)}s alive</span>
        <span className="capitalize" style={{ color: stateColor }}>{agent.state}</span>
      </div>

      {/* Full task / goal — the node label only shows a 1-2 word fragment, so the
          complete text lives here (wrapped + scrollable for long tasks). */}
      {agent.task && (
        <div className="mb-3">
          <div className="text-[10px] mb-1" style={{ color: COLORS.textMuted }}>Task</div>
          <div
            className="text-[11px] leading-snug rounded px-2 py-1.5 overflow-y-auto whitespace-pre-wrap break-words"
            style={{
              color: COLORS.textDim,
              background: COLORS.toolIndicatorBg,
              border: `1px solid ${COLORS.toolIndicatorBorder}`,
              maxHeight: 160,
            }}
          >
            {agent.task}
          </div>
        </div>
      )}

      {/* Current tool */}
      {agent.currentTool && (
        <div
          className="mb-3 px-2 py-1.5 rounded text-[10px] font-mono flex items-center gap-2"
          style={{
            background: COLORS.toolIndicatorBg,
            border: `1px solid ${COLORS.toolIndicatorBorder}`,
            color: COLORS.toolIndicatorText,
          }}
        >
          <span className="animate-spin inline-block">⚙</span>
          {agent.currentTool}
        </div>
      )}

    </GlassCard>
  )
}

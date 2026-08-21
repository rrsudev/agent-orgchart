'use client'

import { useEffect, useRef, useState } from 'react'
import { CARD, type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { Markdown } from '@/lib/markdown'
import { formatTokens, formatModelName } from '@/lib/utils'
import { GlassCard } from './glass-card'
import { PanelHeader, ProgressBar } from './shared-ui'
import { Icon } from './chrome'
import { useLayout } from '@/lib/layout'

/** How tall the task box may grow before it scrolls. A short surface keeps it
 *  small so the stats and the current-tool row stay above the fold. */
const TASK_MAX_H = 160
const TASK_MAX_H_SHORT = 96

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
    /** Live activity clause ("debugging server-side auth errors"). */
    statusLine?: string
    /** Internal harness agent type ("Explore", "General Purpose", …). */
    agentType?: string
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

  // Inline rename — click the name (or the pencil) to edit; Enter/blur commits,
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

  // ── Sizing ────────────────────────────────────────────────────────────────
  // The card sits above the conversation feed in the right rail: selecting a
  // node opens that agent's thread, so "who this is" and "what they said" read
  // as one column. The rail owns placement — this used to centre itself against
  // `window.innerHeight`, which inside a webview iframe is a different box than
  // the visualizer root, so the card drifted under the bottom dock whenever the
  // two disagreed.
  const layout = useLayout()
  // A cap, not the budget: the rail shrinks the card when the column is crowded
  // and the body below scrolls.
  const maxHeight = Math.min(CARD.detail.height * 1.6, layout.panelHeight())

  return (
    <GlassCard
      visible={true}
      className="agent-detail-card is-dense flex flex-col min-h-0"
      style={{ maxHeight }}
    >
      <PanelHeader onClose={onClose} className="mb-3 shrink-0">
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
              aria-label="Agent name"
              className="bg-transparent outline-none border-0 p-0 m-0 ui-sm"
              style={{ color: COLORS.textPrimary, minWidth: 0, width: '100%' }}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              title="Rename this agent"
              className="group flex items-center gap-1 text-left"
              style={{ minWidth: 0 }}
            >
              <span className="ui-sm truncate" style={{ color: COLORS.textPrimary }}>
                {agent.name}
              </span>
              <span
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                style={{ color: COLORS.textMuted }}
              >
                <Icon name="pencil" size={10} />
              </span>
            </button>
          )}
          {agent.model && (
            <span className="ui-2xs truncate" style={{ color: COLORS.textDim }}>
              {formatModelName(agent.model)}
            </span>
          )}
          {agent.statusLine && (
            <span className="ui-2xs truncate" style={{ color: COLORS.textMuted }}>
              {agent.statusLine}
            </span>
          )}
        </div>
      </PanelHeader>

      {/* Everything below the header scrolls, so a long task or a tall stack of
          rows can never push the card past the surface. */}
      <div className="panel-scroll flex-auto min-h-0">
        {/* Context bar */}
        <div className="mb-3">
          <div className="flex justify-between gap-2 mb-1">
            <span className="ui-2xs shrink-0" style={{ color: COLORS.textMuted }}>Context</span>
            <span className="ui-2xs ui-num truncate" style={{ color: COLORS.textDim }}>
              {formatTokens(agent.tokensUsed)} / {formatTokens(agent.tokensMax)} ({contextPercent}%)
            </span>
          </div>
          <ProgressBar percent={contextPercent} color={stateColor} />
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 ui-2xs" style={{ color: COLORS.textDim }}>
          <span className="ui-num">{agent.toolCalls} tools</span>
          <span className="ui-num">{agent.timeAlive.toFixed(1)}s alive</span>
          <span className="capitalize" style={{ color: stateColor }}>{agent.state}</span>
          {agent.agentType && <span style={{ color: COLORS.textMuted }}>{agent.agentType}</span>}
        </div>

        {/* Full task / goal — the node label only shows a 1-2 word fragment, so the
            complete text lives here (wrapped + scrollable for long tasks). */}
        {agent.task && (
          <div className="mb-3">
            <div className="ui-2xs mb-1" style={{ color: COLORS.textMuted }}>Task</div>
            <div
              className="panel-scroll ui-xs leading-snug rounded px-2 py-1.5 break-words"
              style={{
                color: COLORS.textDim,
                background: COLORS.toolIndicatorBg,
                border: `1px solid ${COLORS.toolIndicatorBorder}`,
                maxHeight: layout.short ? TASK_MAX_H_SHORT : TASK_MAX_H,
              }}
            >
              <Markdown text={agent.task} />
            </div>
          </div>
        )}

        {/* Current tool */}
        {agent.currentTool && (
          <div
            className="px-2 py-1.5 rounded ui-2xs flex items-center gap-2"
            style={{
              background: COLORS.toolIndicatorBg,
              border: `1px solid ${COLORS.toolIndicatorBorder}`,
              color: COLORS.toolIndicatorText,
            }}
          >
            <Icon name="restart" className="animate-spin" size={10} />
            <span className="truncate">{agent.currentTool}</span>
          </div>
        )}
      </div>
    </GlassCard>
  )
}

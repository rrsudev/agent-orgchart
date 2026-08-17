'use client'

import { useState } from 'react'
import { COLORS } from '@/lib/colors'
import { ToolContentRenderer } from './tool-content-renderer'
import { Icon } from './chrome'
import type { ConversationMessage } from '@/hooks/simulation/types'

// ─── Shared message rendering utilities ──────────────────────────────────────
//
// Type sizing follows the shared scale: `ui-xs` for message bodies (the thing
// you actually read) and `ui-2xs` for the role labels and metadata above them.
// The old literal 9/10px values sat below the legibility floor and, because the
// label and the body were only 1px apart, flattened the hierarchy at any size.

export function HighlightText({ text, query }: { text: string; query?: string }) {
  if (!query || !query.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: COLORS.searchHighlightBg, color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
          : part
      )}
    </>
  )
}

export function TranscriptMessage({ message, compact = false, searchQuery, assistantLabel = 'CLAUDE' }: { message: ConversationMessage; compact?: boolean; searchQuery?: string; assistantLabel?: string }) {
  const [expanded, setExpanded] = useState(false)

  switch (message.type) {
    case 'user':
      return (
        <div
          className="rounded px-2.5 py-2 ui-xs leading-relaxed"
          style={{
            background: COLORS.userMsgBg,
            border: `1px solid ${COLORS.userMsgBorder}`,
          }}
        >
          <div className="ui-2xs mb-1 font-semibold tracking-wider" style={{ color: COLORS.userLabel }}>USER</div>
          <div style={{ color: COLORS.userText }} className="whitespace-pre-wrap break-words">
            <HighlightText text={message.content} query={searchQuery} />
          </div>
        </div>
      )

    case 'assistant':
      return (
        <div
          className="rounded px-2.5 py-2 ui-xs leading-relaxed"
          style={{
            background: COLORS.panelSeparator,
            border: `1px solid ${COLORS.holoBorder08}`,
          }}
        >
          <div className="ui-2xs mb-1 font-semibold tracking-wider" style={{ color: COLORS.assistantLabel }}>{assistantLabel}</div>
          <div style={{ color: COLORS.assistantText }} className="whitespace-pre-wrap break-words">
            <HighlightText text={compact ? message.content.slice(0, 200) + (message.content.length > 200 ? '...' : '') : message.content} query={searchQuery} />
          </div>
        </div>
      )

    case 'thinking':
      return (
        <div
          className="rounded px-2.5 py-1.5 cursor-pointer transition-all"
          style={{
            background: expanded ? COLORS.thinkingBgExpanded : COLORS.thinkingBgCollapsed,
            border: `1px solid ${COLORS.thinkingBorder}`,
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-1.5">
            <span className="ui-2xs font-semibold tracking-wider" style={{ color: COLORS.thinkingLabel }}>THINKING</span>
            <span className="shrink-0" style={{ color: COLORS.thinkingArrow }}>
              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={10} />
            </span>
            {!expanded && (
              <span className="ui-2xs truncate opacity-50" style={{ color: COLORS.thinkingPreview }}>
                {message.content.slice(0, 60)}...
              </span>
            )}
          </div>
          {expanded && (
            <div
              className="mt-1.5 ui-2xs leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: COLORS.thinkingTextExpanded, borderLeft: `2px solid ${COLORS.thinkingBorderLeft}`, paddingLeft: 8 }}
            >
              {compact ? message.content.slice(0, 500) : message.content}
            </div>
          )}
        </div>
      )

    case 'tool_call':
      return (
        <div
          className="rounded px-2.5 py-1.5"
          style={{
            background: COLORS.toolCallBg,
            border: `1px solid ${COLORS.toolCallBorder}`,
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {/* Line glyph instead of "⚙" — the emoji rendered at its own size and
                color, so the tool name never sat on the label's baseline. */}
            <span className="shrink-0" style={{ color: COLORS.userLabel }}>
              <Icon name="terminal" size={10} />
            </span>
            <span className="ui-2xs font-semibold truncate" style={{ color: COLORS.tool_calling }}>
              {message.toolName || 'Tool'}
            </span>
          </div>
          {message.inputData ? (
            <ToolContentRenderer
              toolName={message.toolName || ''}
              inputData={message.inputData}
              args={message.content}
              compact={compact}
            />
          ) : (
            <div className="ui-2xs opacity-60 break-words" style={{ color: COLORS.assistantText }}>
              {message.content}
            </div>
          )}
        </div>
      )

    case 'tool_result': {
      const resultText = message.content.replace(/^< /, '')
      const isBash = message.toolName === 'Bash'
      return (
        <div
          className="rounded px-2.5 py-1 ui-2xs"
          style={{
            background: isBash ? COLORS.bashResultBg : COLORS.toolResultBg,
            border: `1px solid ${isBash ? COLORS.bashResultBorder : COLORS.toolResultBorder}`,
            color: isBash ? COLORS.bashResultText : COLORS.toolResultText,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {/* "$" for shell output, an arrow for everything else — both drawn
                on the icon grid so a result header keeps one height. */}
            <span className="opacity-50 shrink-0">
              <Icon name={isBash ? 'terminal' : 'chevronRight'} size={10} />
            </span>
            {message.toolName && (
              <span className="opacity-60 truncate">{message.toolName}</span>
            )}
          </div>
          <div className={isBash ? 'whitespace-pre-wrap leading-relaxed break-words' : 'break-words'}>
            <HighlightText text={resultText.slice(0, compact ? 80 : 400)} query={searchQuery} />
          </div>
        </div>
      )
    }

    default:
      return (
        <div className="rounded px-2.5 py-1.5 ui-xs break-words" style={{ color: COLORS.textFaint }}>
          {message.content}
        </div>
      )
  }
}

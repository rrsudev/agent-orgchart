'use client'

import { POPUP } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { ToolContentRenderer } from './tool-content-renderer'
import { PanelHeader, DetailPopup } from './shared-ui'
import { StatusDot } from './chrome'

interface ToolDetailPopupProps {
  tool: {
    id: string
    toolName: string
    state: 'running' | 'complete' | 'error'
    args: string
    result?: string
    tokenCost?: number
    inputData?: Record<string, unknown>
  }
  position: { x: number; y: number }
  onClose: () => void
}

export function ToolDetailPopup({ tool, position, onClose }: ToolDetailPopupProps) {
  const stateColor = tool.state === 'running' ? COLORS.tool_calling : COLORS.complete

  return (
    <DetailPopup position={position} width={POPUP.tool.width} estimatedHeight={POPUP.tool.estimatedHeight} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        {/* A status dot rather than a ⚙/✓ glyph: those two codepoints rendered at
            different sizes (and, on some platforms, in their own colors), so the
            header baseline shifted between a running and a finished tool. The dot
            is the same state vocabulary the LIVE/idle indicators use. */}
        <StatusDot color={stateColor} pulse={tool.state === 'running'} size={6} />
        <span className="ui-xs font-semibold truncate" style={{ color: COLORS.tool_calling }}>
          {tool.toolName}
        </span>
        <span className="ui-2xs capitalize shrink-0" style={{ color: stateColor + '90' }}>
          {tool.state}
        </span>
      </PanelHeader>

      {/* Rich content */}
      {tool.inputData ? (
        <ToolContentRenderer
          toolName={tool.toolName}
          inputData={tool.inputData}
          args={tool.args}
          compact={false}
        />
      ) : (
        <div className="ui-xs break-words" style={{ color: COLORS.textPrimary + '90' }}>
          {tool.args}
        </div>
      )}

      {/* Result */}
      {tool.result && (
        <div
          className="mt-2 rounded px-2 py-1 ui-2xs break-words"
          style={{
            background: COLORS.resultBg,
            border: `1px solid ${COLORS.resultBorder}`,
            color: COLORS.complete + '90',
          }}
        >
          <span className="opacity-50 mr-1">Result:</span>
          {tool.result}
        </div>
      )}

      {/* Token cost */}
      {tool.tokenCost != null && tool.tokenCost > 0 && (
        <div className="mt-1.5 ui-2xs ui-num" style={{ color: COLORS.textMuted }}>
          {tool.tokenCost} tokens
        </div>
      )}
    </DetailPopup>
  )
}

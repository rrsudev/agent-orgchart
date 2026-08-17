'use client'

import { FileAttention } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { formatTokens, truncatePath } from '@/lib/utils'
import { PanelHeader, ProgressBar } from './shared-ui'
import { Icon } from './chrome'
import { useLayout } from '@/lib/layout'

/** Cap so the list never fills a tall surface end to end; a short surface (a
 *  bottom-docked panel) gets the tighter one. */
const MAX_H = 420
const MAX_H_SHORT = 260

interface FileAttentionPanelProps {
  visible: boolean
  fileAttention: Map<string, FileAttention>
  onClose: () => void
  onOpenFile?: (filePath: string) => void
}

export function FileAttentionPanel({ visible, fileAttention, onClose, onOpenFile }: FileAttentionPanelProps) {
  const layout = useLayout()

  if (!visible) return null

  const files = Array.from(fileAttention.values())
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const maxTokens = Math.max(...files.map(f => f.totalTokens), 1)

  // The rail owns placement and width; this panel only caps its own height.
  // A cap, not the budget: the rail shrinks the card further when the column is
  // crowded, and the list below scrolls.
  const panelMaxH = Math.min(layout.short ? MAX_H_SHORT : MAX_H, layout.panelHeight())

  return (
    <div className="glass-card is-dense flex flex-col" style={{ maxHeight: panelMaxH }}>
      <PanelHeader onClose={onClose} className="mb-2 shrink-0">
        <span style={{ color: COLORS.textMuted }}><Icon name="files" /></span>
        <span className="ui-xs font-semibold tracking-wider truncate" style={{ color: COLORS.textPrimary }}>
          FILE ATTENTION
        </span>
      </PanelHeader>

      {/* File list — flexes into whatever the card's height budget leaves. */}
      <div className="panel-scroll flex-auto min-h-0 space-y-1">
        {files.length === 0 && (
          <div className="ui-xs py-2 text-center" style={{ color: COLORS.textMuted }}>
            No files accessed yet
          </div>
        )}
        {files.map((file) => {
          const heatRatio = file.totalTokens / maxTokens
          const heatColor = heatRatio > 0.7 ? COLORS.error :
            heatRatio > 0.4 ? COLORS.tool :
              COLORS.holoBase
          const canOpen = onOpenFile && file.path.startsWith('/')
          const displayPath = truncatePath(file.path)

          return (
            <div
              key={file.path}
              className={`rounded px-2 py-1.5 transition-colors ${canOpen ? 'hover:brightness-[0.97]' : ''}`}
              style={{
                background: `rgba(0, 0, 0, 0.035)`,
                border: `1px solid ${canOpen ? heatColor + '30' : heatColor + '15'}`,
                cursor: canOpen ? 'pointer' : undefined,
              }}
              onClick={canOpen ? () => onOpenFile(file.path) : undefined}
              // A row that opens a file in the editor is a control, so it is
              // announced and operable as one rather than being mouse-only.
              role={canOpen ? 'button' : undefined}
              tabIndex={canOpen ? 0 : undefined}
              onKeyDown={canOpen ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenFile(file.path) }
              } : undefined}
              title={canOpen ? file.path : undefined}
            >
              {/* Filename — flex-based truncation. The old fixed 160px cap was
                  picked for a smaller type size and cut paths mid-word once the
                  scale went up, even when the panel had room to spare. */}
              <div className="flex items-center justify-between gap-2">
                <span className="ui-2xs truncate min-w-0 flex-1" style={{ color: heatColor }}>
                  {displayPath}
                </span>
                <span className="ui-2xs ui-num shrink-0" style={{ color: COLORS.textMuted }}>
                  {file.totalTokens > 0 ? formatTokens(file.totalTokens) : '—'}
                </span>
              </div>

              <div className="mt-1">
                <ProgressBar percent={heatRatio * 100} color={heatColor} trackColor={COLORS.holoBg05} />
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-2 mt-1 ui-2xs">
                {file.reads > 0 && (
                  <span style={{ color: COLORS.holoBase + '80' }}>
                    {file.reads} read{file.reads > 1 ? 's' : ''}
                  </span>
                )}
                {file.edits > 0 && (
                  <span style={{ color: COLORS.tool + '80' }}>
                    {file.edits} edit{file.edits > 1 ? 's' : ''}
                  </span>
                )}
                {file.agents.length > 0 && (
                  <span style={{ color: COLORS.textMuted }} title={file.agents.join(', ')}>
                    {file.agents.length} agent{file.agents.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {files.length > 0 && (
        <div className="mt-2 pt-2 flex justify-between gap-2 ui-2xs shrink-0" style={{
          borderTop: `1px solid ${COLORS.holoBorder08}`,
          color: COLORS.textMuted,
        }}>
          <span className="ui-num shrink-0">{files.length} files</span>
          {/* Shortened from "tokens in file reads": at the new type scale the
              long form truncated inside the 260px rail. The full phrasing
              survives as the tooltip. */}
          <span className="ui-num truncate" title="Tokens spent on file reads">
            {formatTokens(files.reduce((s, f) => s + f.totalTokens, 0))} tokens read
          </span>
        </div>
      )}
    </div>
  )
}

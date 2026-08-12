'use client'

import { AGENT_PALETTE, COLORS } from '@/lib/colors'

/** A compact row of identity-color swatches + a clear button, for the agent
 *  context menu. Picking a color (or clearing) fires onPick. */
export function AgentColorSwatches({
  selected,
  onPick,
}: {
  selected?: string
  onPick: (hex: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {AGENT_PALETTE.map(c => (
        <button
          key={c.hex}
          title={c.name}
          aria-label={`Color ${c.name}`}
          onClick={() => onPick(c.hex)}
          className="h-4 w-4 rounded-full transition-transform hover:scale-110"
          style={{
            background: c.hex,
            outline: selected === c.hex ? `2px solid ${COLORS.textPrimary}` : 'none',
            outlineOffset: 1,
          }}
        />
      ))}
      <button
        title="Clear color"
        aria-label="Clear color"
        onClick={() => onPick(null)}
        className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none transition-colors hover:bg-white/10"
        style={{ border: `1px solid ${COLORS.holoBorder12}`, color: COLORS.textMuted }}
      >
        ×
      </button>
    </div>
  )
}

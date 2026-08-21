'use client'

import { Children, type ReactNode } from 'react'
import { Z } from '@/lib/agent-types'
import { useLayout, type LayoutInfo } from '@/lib/layout'

/**
 * How wide each rail wants to be. The rail — not each panel — owns the width, so
 * a column of panels shares one edge instead of ending raggedly, and the right
 * rail is wider because it carries running prose (the transcript).
 *
 * The width scales with the surface between a floor and the design width, rather
 * than sitting at a constant: a fixed 344px rail is a comfortable sidebar on a
 * 1440px surface and half the width of a 700px docked column.
 */
const RAIL_W = {
  left: { min: 224, max: 264, fraction: 0.26 },
  right: { min: 288, max: 344, fraction: 0.32 },
} as const

export function railWidth(layout: LayoutInfo, side: 'left' | 'right'): number {
  // With the rails merged there is one column and it takes the full width.
  if (!layout.sideBySide) return layout.panelWidth(9999)
  const { min, max, fraction } = RAIL_W[side]
  return layout.panelWidth(Math.round(Math.min(max, Math.max(min, layout.width * fraction))))
}

/**
 * Screen-space point where a rail's first panel begins — the canvas draws its
 * tether to the agent detail card here. Deriving it from the same numbers the
 * rail lays out with is what keeps the line pointing at the card instead of at
 * wherever the card used to live.
 */
export function railAnchor(layout: LayoutInfo, side: 'left' | 'right'): { x: number; y: number } {
  const anchorLeft = side === 'left' || !layout.sideBySide
  const width = railWidth(layout, side)
  return {
    x: anchorLeft ? layout.gutter + width : layout.width - layout.gutter - width,
    // A little below the top edge, so the line meets the card's body rather
    // than grazing its corner.
    y: layout.railTop + 32,
  }
}

/**
 * The left and right rails, as containers rather than a convention.
 *
 * Each floating panel used to position itself: one at `top: 66, right: 12`,
 * another at `top: RAIL_TOP, left: GUTTER`, the detail card at a `window
 * .innerHeight`-derived offset, the legend pinned to the bottom-left corner.
 * They agreed on the edges but not on each other, so any two that grew at once
 * — a long file list above an expanded legend, say — simply overlapped, and
 * every new panel had to re-derive the same offsets.
 *
 * A rail is one absolutely positioned column spanning the space between the
 * measured top bar and bottom dock. Panels are flex children of it, so they
 * push on each other instead of stacking, and a column that runs out of room
 * shrinks its panels (each scrolls internally) rather than overflowing. A panel
 * inside a rail decides only its own width and its content — never its position.
 *
 * Below `sideBySide` width both rails resolve to the same left-anchored column;
 * `RailGuard` keeps a single panel open at that size, so they cannot collide.
 */
export function SideRail({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const layout = useLayout()
  const anchorLeft = side === 'left' || !layout.sideBySide
  const width = railWidth(layout, side)

  return (
    <div
      className="absolute flex flex-col"
      style={{
        top: layout.railTop,
        bottom: layout.railBottom,
        left: anchorLeft ? layout.gutter : undefined,
        right: anchorLeft ? undefined : layout.gutter,
        width,
        alignItems: 'stretch',
        gap: layout.gutter,
        zIndex: Z.sidePanel,
        // The rail spans the full column height, most of which is empty canvas —
        // only the slots that actually hold a panel take pointer events.
        pointerEvents: 'none',
      }}
    >
      {Children.toArray(children)}
    </div>
  )
}

/**
 * One panel's place in a rail. An empty slot (its panel returned `null`) removes
 * itself via `.rail-slot:empty`, so a closed panel leaves no gap behind.
 */
export function RailSlot({ pin, children }: {
  /** `bottom` pushes this slot to the foot of the rail (the legend). */
  pin?: 'bottom'
  children: ReactNode
}) {
  return <div className={`rail-slot${pin === 'bottom' ? ' is-bottom' : ''}`}>{children}</div>
}

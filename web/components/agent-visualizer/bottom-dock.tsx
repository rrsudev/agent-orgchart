'use client'

import type { ReactNode } from 'react'
import { Z } from '@/lib/agent-types'
import { useLayout } from '@/lib/layout'

/**
 * The bottom edge, as one layout instead of three.
 *
 * Previously each thing that wanted to sit at the bottom positioned itself
 * absolutely and independently: the legend launcher at `bottom-left`, the study
 * timer centered via `left-1/2 -translate-x-1/2` with no width bound, the replay
 * scrubber as a third `bottom-4 left-4 right-4` bar. Nothing knew about anything
 * else, so on a narrow surface the timer overhung both edges (its clock was
 * clipped) and on a short one the expanded legend sat straight on top of it.
 *
 * The dock owns the bottom edge and hands out three slots. A single flex row
 * means the pieces push on each other instead of overlapping, and because the
 * dock reports its measured height to the layout context, every side panel's
 * bottom rail follows it — including when it wraps to two rows on a side bar.
 */
export function BottomDock({ left, center, right }: {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
}) {
  const { gutter, narrow, registerChrome } = useLayout()

  return (
    <div
      ref={registerChrome('bottom')}
      className="absolute bottom-0 left-0 right-0 flex items-end justify-between"
      style={{
        padding: gutter,
        gap: narrow ? 6 : 10,
        zIndex: Z.controlBar,
        // Only the slots themselves take pointer events — the gaps between them
        // stay transparent so the canvas underneath can still be dragged.
        pointerEvents: 'none',
        // On a side bar the row runs out of width; wrapping keeps every control
        // reachable (and the rail follows, because the height is measured).
        flexWrap: narrow ? 'wrap' : 'nowrap',
      }}
    >
      <div className="flex items-center shrink-0" style={{ pointerEvents: 'auto' }}>{left}</div>
      {/* The center slot is the one that may grow; `min-w-0` lets it give way
          rather than pushing the side slots off the surface. The inner wrapper
          is `w-full` so a bar that wants to fill the slot measures itself
          against the space this row actually has left — not against the whole
          surface, which is how the replay scrubber ended up running off the
          right edge whenever the left slot was occupied. */}
      <div className="flex-1 min-w-0 flex items-end justify-center" style={{ pointerEvents: 'none' }}>
        <div className="w-full min-w-0 flex justify-center" style={{ pointerEvents: 'auto' }}>{center}</div>
      </div>
      <div className="flex items-center shrink-0" style={{ pointerEvents: 'auto' }}>{right}</div>
    </div>
  )
}

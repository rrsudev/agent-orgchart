'use client'

import { useEffect, useRef } from 'react'
import { useLayout } from '@/lib/layout'

export type RailPanel = 'files' | 'chat' | 'legend'

/** Closed last when a resize (rather than a click) forces a panel out: the
 *  legend is reference material, the file list is a summary, the conversation
 *  is what the user is usually reading. */
const YIELD_ORDER: RailPanel[] = ['legend', 'files', 'chat']

/**
 * Keeps the floating panels from stacking on each other when the surface can't
 * hold them all. Two constraints, both derived from the measured size:
 *
 *  • Below `sideBySide` width the left and right rails are the same rail, so at
 *    most one panel may be open at all.
 *  • On a `short` surface the left column can hold either the file list or the
 *    legend, but not both — the conversation feed is unaffected (it is on the
 *    other rail).
 *
 * Whichever panel the user just reached for wins; the ones it collides with
 * close. Nothing is ever hidden without being closed, so a toggle's on/off state
 * always matches what is actually on screen.
 *
 * This is a component rather than a hook in the visualizer because the layout
 * context is provided *by* the visualizer, so the visualizer cannot read it.
 */
export function RailGuard({ files, chat, legend, close }: {
  files: boolean
  chat: boolean
  legend: boolean
  close: Record<RailPanel, () => void>
}) {
  const { sideBySide, short } = useLayout()
  const prev = useRef<Record<RailPanel, boolean>>({ files, chat, legend })

  useEffect(() => {
    const open: Record<RailPanel, boolean> = { files, chat, legend }
    const justOpened = YIELD_ORDER.filter(p => open[p] && !prev.current[p])
    prev.current = open

    const openPanels = YIELD_ORDER.filter(p => open[p])
    if (openPanels.length < 2) return

    // The left column holds `files` and `legend`; `chat` sits on the other rail,
    // so those two only collide once the rails have merged.
    const collides = (a: RailPanel, b: RailPanel) =>
      !sideBySide || (short && a !== 'chat' && b !== 'chat')

    // The panel that keeps its place: the one just opened, else the last to
    // yield under YIELD_ORDER (which is what a resize should preserve).
    const keeper = justOpened[0] ?? [...openPanels].sort(
      (a, b) => YIELD_ORDER.indexOf(b) - YIELD_ORDER.indexOf(a),
    )[0]

    for (const p of openPanels) {
      if (p !== keeper && collides(p, keeper)) close[p]()
    }
  }, [files, chat, legend, close, sideBySide, short])

  return null
}

'use client'

import { useEffect, useRef } from 'react'
import { COLORS } from '@/lib/colors'
import { Z } from '@/lib/agent-types'

/**
 * Cursor-following tooltip that shows an agent's full goal / task on hover — a
 * "read the whole thing" fallback for the node subtitle, which only shows a
 * wrapped 2-line preview. Positions itself directly via a ref on every pointer
 * move so it never triggers a React re-render of the visualizer; the parent only
 * re-renders when the hovered text itself changes.
 */
export function AgentHoverTooltip({ text }: { text: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const posRef = useRef({ x: 0, y: 0 })

  const place = () => {
    const el = ref.current
    if (!el) return
    const pad = 14
    const w = el.offsetWidth
    const h = el.offsetHeight
    // Prefer below-right of the cursor; flip to stay inside the viewport.
    let x = posRef.current.x + pad
    let y = posRef.current.y + pad
    if (x + w > window.innerWidth - 8) x = posRef.current.x - w - pad
    if (y + h > window.innerHeight - 8) y = posRef.current.y - h - pad
    el.style.left = `${Math.max(8, x)}px`
    el.style.top = `${Math.max(8, y)}px`
  }

  // Persistent pointer tracking — records the cursor and repositions a visible
  // tooltip. Cheap when hidden (ref is null → early return).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      posRef.current = { x: e.clientX, y: e.clientY }
      place()
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Place immediately when the text appears, using the last known cursor point
  // (so it shows in the right spot even if the pointer is momentarily still).
  useEffect(() => { if (text) place() }, [text])

  if (!text) return null
  return (
    <div
      ref={ref}
      role="tooltip"
      style={{
        position: 'fixed',
        left: -9999,
        top: -9999,
        zIndex: Z.tooltip,
        pointerEvents: 'none',
        maxWidth: 340,
        padding: '7px 10px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.4,
        color: COLORS.textPrimary,
        background: COLORS.glassBg,
        border: `1px solid ${COLORS.glassBorder}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
        backdropFilter: 'blur(8px)',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </div>
  )
}

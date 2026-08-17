'use client'

import { useRef, type ReactNode } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { useClickOutside } from '@/hooks/use-click-outside'
import { clampPopupPosition } from '@/lib/clamp-popup-position'
import { useLayout } from '@/lib/layout'
import { GlassCard } from './glass-card'
import { ChromeButton } from './chrome'

// ─── Stop Propagation Handlers ──────────────────────────────────────────────
// Prevents canvas drag/click events from firing when interacting with panels

export const stopPropagationHandlers = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onMouseUp: (e: React.MouseEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
} as const

// ─── Close Button ───────────────────────────────────────────────────────────

interface CloseButtonProps {
  onClick: () => void
  className?: string
}

export function CloseButton({ onClick, className = '' }: CloseButtonProps) {
  // A line glyph rather than the "✕" character: the emoji-adjacent codepoint
  // rendered at a different size and weight on every platform, so the dismiss
  // affordance never matched the controls beside it.
  return (
    <ChromeButton
      onClick={onClick}
      tone="ghost"
      size="sm"
      icon="close"
      iconOnly
      aria-label="Close"
      title="Close"
      className={className}
    />
  )
}

// ─── Panel Header ───────────────────────────────────────────────────────────

interface PanelHeaderProps {
  children: ReactNode
  onClose: () => void
  className?: string
  actions?: ReactNode
}

export function PanelHeader({ children, onClose, className = 'mb-2', actions }: PanelHeaderProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {children}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        <CloseButton onClick={onClose} />
      </div>
    </div>
  )
}

// ─── Detail Popup ──────────────────────────────────────────────────────────
// Shared wrapper for popup detail cards (tool detail, discovery detail, etc.)

interface DetailPopupProps {
  position: { x: number; y: number }
  width: number
  estimatedHeight: number
  onClose: () => void
  children: ReactNode
}

/** Padding `.glass-card` applies on each side — subtracted when working out how
 *  much room the popup body actually has. */
const CARD_PADDING = 12

export function DetailPopup({ position, width, estimatedHeight, onClose, children }: DetailPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const layout = useLayout()

  // Popups are absolutely positioned inside the visualizer root, so they clamp
  // against the measured surface and the rails — not the window, which inside a
  // webview is a different (larger) box and let popups sit under the top bar or
  // behind the bottom dock.
  const w = layout.panelWidth(width)
  const { left, top } = clampPopupPosition(position, w, estimatedHeight, 20, {
    width: layout.width,
    height: layout.height,
    margin: layout.gutter,
    insetTop: layout.railTop,
    insetBottom: layout.railBottom,
  })

  // `estimatedHeight` is only a positioning hint — real content is routinely
  // taller. Whatever room is left below the clamped top is the hard ceiling, so
  // an overlong tool result scrolls inside the card instead of running off the
  // bottom of the surface.
  const maxBodyH = Math.max(96, layout.height - top - layout.railBottom - CARD_PADDING * 2)

  useClickOutside(ref, onClose)

  return (
    <div
      ref={ref}
      {...stopPropagationHandlers}
      style={{ position: 'absolute', left, top, width: w, zIndex: Z.detailCard }}
    >
      <GlassCard visible={true}>
        <div className="panel-scroll" style={{ maxHeight: maxBodyH }}>
          {children}
        </div>
      </GlassCard>
    </div>
  )
}

// ─── Sliding Panel ──────────────────────────────────────────────────────────
// Shared wrapper for panels that slide in/out with a visibility transition.

interface SlidingPanelProps {
  visible: boolean
  /** CSS positioning — e.g. { top: 12, right: 3 } */
  position: React.CSSProperties
  /** Slide direction: 'X' slides horizontally, 'Y' slides vertically */
  axis?: 'X' | 'Y'
  /** Pixel offset when hidden (default 20) */
  offset?: number
  zIndex: number
  width?: number | string
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

export function SlidingPanel({
  visible, position, axis = 'X', offset = 20,
  zIndex, width, className = '', style, children,
}: SlidingPanelProps) {
  return (
    <div
      className={`absolute transition-all duration-300 ${className}`}
      style={{
        ...position,
        opacity: visible ? 1 : 0,
        transform: `translate${axis}(${visible ? 0 : offset}px)`,
        pointerEvents: visible ? 'auto' : 'none',
        zIndex,
        width,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

interface ProgressBarProps {
  percent: number
  color: string
  trackColor?: string
}

export function ProgressBar({ percent, color, trackColor = COLORS.holoBg10 }: ProgressBarProps) {
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ background: trackColor }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${percent}%`,
          background: color,
          boxShadow: `0 0 6px ${color}40`,
        }}
      />
    </div>
  )
}

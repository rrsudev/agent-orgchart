'use client'

/**
 * Chrome primitives — the shared vocabulary for every control that lives in the
 * bars and panels around the canvas.
 *
 * Before this existed, each bar hand-rolled its buttons: one used `px-2.5 py-1`,
 * the next `px-3 py-1.5`, a third `px-3.5 py-1.5`, and each picked its own font
 * size and border color. Rows of them never shared a baseline, and the same
 * action looked different depending on which bar you found it in. Here every
 * control resolves to one of two heights (`--ctl-h` / `--ctl-h-sm`) and one of
 * four tones, so a mixed row lines up by construction and a control can move
 * between bars without being restyled.
 *
 * Icons are inline SVG line glyphs rather than emoji. Emoji in chrome render at
 * an unpredictable size, carry their own color, and differ per platform — which
 * is what made the bottom bar read as clunky.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { COLORS } from '@/lib/colors'

// ─── Icons ──────────────────────────────────────────────────────────────────
// One 12×12 grid, one stroke weight. `currentColor` so a glyph always matches
// the label beside it.

export type IconName =
  | 'plus' | 'external' | 'grid' | 'undo' | 'close' | 'search' | 'info'
  | 'files' | 'chat' | 'tokens' | 'play' | 'pause' | 'stop' | 'archive'
  | 'restart' | 'chevronDown' | 'chevronRight' | 'chevronLeft' | 'more'
  | 'pencil' | 'terminal' | 'stats' | 'label' | 'fit' | 'download'

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M6 2.4V9.6M2.4 6h7.2" />,
  external: <><path d="M9.6 6.6v2.4a.9.9 0 0 1-.9.9H3a.9.9 0 0 1-.9-.9V3.3a.9.9 0 0 1 .9-.9h2.4" /><path d="M7.5 2.1h2.4v2.4M9.9 2.1 5.7 6.3" /></>,
  grid: <><rect x="2.1" y="2.1" width="3.2" height="3.2" rx=".7" /><rect x="6.7" y="2.1" width="3.2" height="3.2" rx=".7" /><rect x="2.1" y="6.7" width="3.2" height="3.2" rx=".7" /><rect x="6.7" y="6.7" width="3.2" height="3.2" rx=".7" /></>,
  undo: <><path d="M2.4 5.4h5.1a2.1 2.1 0 0 1 0 4.2H5.1" /><path d="M4.2 3.3 2.1 5.4l2.1 2.1" /></>,
  close: <path d="M3 3l6 6M9 3l-6 6" />,
  search: <><circle cx="5.4" cy="5.4" r="3" /><path d="M7.7 7.7 10 10" /></>,
  info: <><circle cx="6" cy="6" r="4.2" /><path d="M6 5.4v2.7" /><circle cx="6" cy="3.7" r=".55" fill="currentColor" stroke="none" /></>,
  files: <><path d="M3.3 1.8h3.3l2.1 2.1v6.3H3.3z" /><path d="M6.3 1.8v2.4h2.4" /></>,
  chat: <path d="M10.2 6.3c0 1.9-1.9 3.4-4.2 3.4a5 5 0 0 1-1.4-.2L2.1 10.2l.8-1.9A3.2 3.2 0 0 1 1.8 6.3c0-1.9 1.9-3.4 4.2-3.4s4.2 1.5 4.2 3.4Z" />,
  tokens: <><rect x="1.8" y="4.5" width="8.4" height="3" rx="1.2" /><path d="M4.5 4.5v3M7.2 4.5v3" /></>,
  play: <path d="M3.9 2.7 9.3 6l-5.4 3.3z" fill="currentColor" stroke="none" />,
  pause: <><rect x="3.4" y="2.8" width="1.7" height="6.4" rx=".6" fill="currentColor" stroke="none" /><rect x="6.9" y="2.8" width="1.7" height="6.4" rx=".6" fill="currentColor" stroke="none" /></>,
  stop: <rect x="3.2" y="3.2" width="5.6" height="5.6" rx="1.2" fill="currentColor" stroke="none" />,
  archive: <><rect x="1.8" y="2.4" width="8.4" height="2.1" rx=".7" /><path d="M2.7 4.5v4.2a.9.9 0 0 0 .9.9h4.8a.9.9 0 0 0 .9-.9V4.5" /><path d="M5.1 6.6h1.8" /></>,
  restart: <><path d="M9.6 6a3.6 3.6 0 1 1-1.1-2.6" /><path d="M9.9 1.8v2.4H7.5" /></>,
  chevronDown: <path d="M3.3 4.8 6 7.5l2.7-2.7" />,
  chevronRight: <path d="M4.8 3.3 7.5 6l-2.7 2.7" />,
  chevronLeft: <path d="M7.2 3.3 4.5 6l2.7 2.7" />,
  more: <><circle cx="2.7" cy="6" r=".8" fill="currentColor" stroke="none" /><circle cx="6" cy="6" r=".8" fill="currentColor" stroke="none" /><circle cx="9.3" cy="6" r=".8" fill="currentColor" stroke="none" /></>,
  pencil: <><path d="M8.4 1.9 10.1 3.6 4.4 9.3 2.1 9.9l.6-2.3z" /><path d="M7.5 2.8 9.2 4.5" /></>,
  terminal: <><path d="M2.4 3.3 4.8 6l-2.4 2.7" /><path d="M6.3 8.7h3.3" /></>,
  stats: <><path d="M2.4 9.6V6.3M6 9.6V2.4M9.6 9.6V4.8" /></>,
  label: <><path d="M2.4 2.4h4.2l3 3.6-3 3.6H2.4z" /><circle cx="4.2" cy="6" r=".55" fill="currentColor" stroke="none" /></>,
  fit: <><path d="M2.1 4.5V2.4h2.1M7.8 2.1h2.1v2.1M9.9 7.5v2.1H7.8M4.2 9.9H2.1V7.8" /></>,
  download: <><path d="M6 1.8v5.1" /><path d="M3.9 4.8 6 6.9l2.1-2.1" /><path d="M2.4 9.6h7.2" /></>,
}

export function Icon({ name, size = 12, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      {PATHS[name]}
    </svg>
  )
}

// ─── Button ─────────────────────────────────────────────────────────────────

export type ChromeTone = 'neutral' | 'accent' | 'danger' | 'ghost'

const TONES: Record<ChromeTone, { bg: string; border: string; color: string }> = {
  neutral: { bg: COLORS.toggleInactive, border: COLORS.toggleBorder, color: COLORS.textDim },
  accent: { bg: COLORS.toggleActive, border: COLORS.holoBright, color: COLORS.holoBright },
  danger: { bg: COLORS.cardBgError, border: COLORS.error, color: COLORS.error },
  ghost: { bg: 'transparent', border: 'transparent', color: COLORS.textMuted },
}

interface ChromeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChromeTone
  size?: 'md' | 'sm'
  icon?: IconName
  /** Hide the text label (keeping it as the accessible name) — used when the
   *  surface is too narrow for a full row of labelled controls. */
  iconOnly?: boolean
  children?: ReactNode
}

export const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(function ChromeButton(
  { tone = 'neutral', size = 'md', icon, iconOnly, children, style, className = '', disabled, ...rest },
  ref,
) {
  const t = TONES[tone]
  const h = size === 'sm' ? 'var(--ctl-h-sm)' : 'var(--ctl-h)'
  const padX = iconOnly ? 0 : size === 'sm' ? 'var(--ctl-pad-x-sm)' : 'var(--ctl-pad-x)'
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors ${className}`}
      style={{
        height: h,
        minWidth: iconOnly ? h : undefined,
        paddingInline: padX,
        borderRadius: 'var(--ctl-radius)',
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        fontSize: 'var(--ui-sm)',
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && children}
    </button>
  )
})

// ─── Toggle chip ────────────────────────────────────────────────────────────
// A segmented on/off switch. State is legible three ways: a leading status dot
// (filled + glow when on, hollow ring when off — echoing the LIVE/idle dots), an
// accent fill when on, and `role="switch"` so it is announced as a toggle.

export function ToggleChip({ active, onClick, label, icon, showLabel = true, showDot = true, children }: {
  active: boolean
  onClick: () => void
  /** Human name of what this toggles, for the tooltip + screen-reader label. */
  label: string
  icon?: IconName
  /** false collapses to the glyph alone (side-bar widths). */
  showLabel?: boolean
  /** Dropping the dot buys back the width for the label on a tight surface — a
   *  labelled chip is worth more than a second state cue, and `aria-checked`
   *  still carries the state for assistive tech. */
  showDot?: boolean
  children?: ReactNode
}) {
  const accent = COLORS.holoBright
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={active}
      aria-label={label}
      title={`${label}: ${active ? 'on' : 'off'} — click to ${active ? 'hide' : 'show'}`}
      className="inline-flex items-center gap-1.5 shrink-0 transition-colors"
      style={{
        height: 'var(--ctl-h-sm)',
        paddingInline: showLabel ? 'var(--ctl-pad-x-sm)' : 6,
        borderRadius: 6,
        background: active ? COLORS.toggleActive : 'transparent',
        color: active ? accent : COLORS.textMuted,
        fontSize: 'var(--ui-sm)',
        fontWeight: active ? 600 : 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className="inline-block rounded-full transition-all"
          style={{
            width: 6,
            height: 6,
            flexShrink: 0,
            background: active ? accent : 'transparent',
            border: `1.5px solid ${active ? accent : COLORS.textMuted}`,
            boxShadow: active ? `0 0 6px ${accent}` : 'none',
          }}
        />
      )}
      {icon && (!showLabel || !showDot) && <Icon name={icon} />}
      {showLabel && children}
    </button>
  )
}

// ─── Grouping ───────────────────────────────────────────────────────────────

/** Hairline rule between clusters in a bar. Sized to the control height so it
 *  reads as a divider rather than a stray tick. */
export function BarDivider() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0"
      style={{ width: 1, height: 16, background: COLORS.holoBorder12 }}
    />
  )
}

/** Track that houses a set of related toggles/segments. */
export function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 shrink-0"
      style={{
        padding: 2,
        borderRadius: 10,
        background: COLORS.holoBg03,
        border: `1px solid ${COLORS.holoBorder06}`,
      }}
    >
      {children}
    </div>
  )
}

/** Status dot used by the LIVE/idle/paused indicators. */
export function StatusDot({ color, pulse, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${color}` }}
    />
  )
}

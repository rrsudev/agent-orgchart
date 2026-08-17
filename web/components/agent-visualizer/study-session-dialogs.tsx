'use client'

import { useEffect } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { CloseButton } from './shared-ui'
import { ChromeButton, type ChromeTone, type IconName } from './chrome'
import { useLayout } from '@/lib/layout'

// ─── Reusable centered modal ─────────────────────────────────────────────────

/**
 * Centred over the visualizer — not over the window.
 *
 * This used to be `position: fixed` at `width: 90%`. Inside a VS Code webview
 * the fixed viewport is the whole iframe, so the modal centred against a box
 * that is not the panel it belongs to, and a percentage width gave it no
 * relationship to the surface's height at all: on a short surface the card ran
 * off the bottom. Absolute positioning inside the (relative) visualizer root
 * plus the measured surface keeps it inside the panel at every size.
 *
 * Dismissal is unchanged: Escape, backdrop click, and whatever control the
 * caller renders.
 */
export function CenteredModal({ onClose, children, maxWidth = 440, dim = true }: {
  onClose: () => void
  children: React.ReactNode
  maxWidth?: number
  /** Dim + block the page behind the modal (confirmations). */
  dim?: boolean
}) {
  const layout = useLayout()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        zIndex: Z.contextMenu + 10,
        background: dim ? 'rgba(0,0,0,0.45)' : 'transparent',
        pointerEvents: 'auto',
        // The gutter lives on the backdrop so the card can be `width: 100%` and
        // still never touch the surface edge.
        padding: layout.gutter,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="glass-card flex flex-col"
        style={{
          width: '100%',
          maxWidth: layout.panelWidth(maxWidth),
          maxHeight: Math.max(160, layout.height - layout.gutter * 2),
          // `overflow: hidden` (rather than a scroll on the card itself) keeps
          // the top highlight pinned; each dialog scrolls its own body region.
          overflow: 'hidden',
          padding: layout.narrow ? '16px' : '20px 22px',
        }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function ActionButton({ onClick, children, variant, icon }: {
  onClick: () => void
  children: React.ReactNode
  variant: 'primary' | 'danger' | 'neutral'
  icon?: IconName
}) {
  // Dialog actions share the chrome's height/radius/tone vocabulary so they line
  // up with the buttons in the bars behind them.
  const tone: ChromeTone = variant === 'primary' ? 'accent' : variant === 'danger' ? 'danger' : 'neutral'
  return (
    <ChromeButton onClick={onClick} tone={tone} icon={icon} className="hover:brightness-95">
      {children}
    </ChromeButton>
  )
}

// ─── Confirm dialog (pause-with-agents, end-session) ─────────────────────────

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', onConfirm, onCancel }: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <CenteredModal onClose={onCancel}>
      <div className="ui-md font-semibold mb-2 shrink-0" style={{ color: COLORS.textPrimary }}>{title}</div>
      <div className="panel-scroll ui-sm leading-relaxed mb-4 flex-auto min-h-0" style={{ color: COLORS.textDim }}>{body}</div>
      <div className="flex items-center justify-end gap-2 shrink-0">
        <ActionButton onClick={onCancel} variant="neutral">{cancelLabel}</ActionButton>
        <ActionButton onClick={onConfirm} variant={tone}>{confirmLabel}</ActionButton>
      </div>
    </CenteredModal>
  )
}

// ─── 15-minute study-protocol popup ──────────────────────────────────────────
// Dismissable in every way (X, backdrop, Escape, "Keep working") so it never
// traps the participant — they can always continue the session and keep using
// the tool, per protocol.

export function ProtocolPrompt({ onOpenWebsite, onDismiss }: {
  onOpenWebsite: () => void
  onDismiss: () => void
}) {
  return (
    <CenteredModal onClose={onDismiss}>
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div className="ui-md font-semibold" style={{ color: COLORS.textPrimary }}>
          15-minute session mark reached
        </div>
        <CloseButton onClick={onDismiss} />
      </div>
      <div className="panel-scroll ui-sm leading-relaxed mb-4 flex-auto min-h-0" style={{ color: COLORS.textDim }}>
        You&apos;ve reached the 15-minute minimum for this session. Would you like to
        record your steps on the study website now? You can also keep working. Closing
        this message lets you continue the session and use the tool as usual.
      </div>
      <div className="flex items-center justify-end gap-2 shrink-0">
        <ActionButton onClick={onDismiss} variant="neutral">Keep working</ActionButton>
        {/* The trailing "→" became an `external` glyph: the action leaves the
            editor for the study website, and the icon says so at a fixed size. */}
        <ActionButton onClick={onOpenWebsite} variant="primary" icon="external">Record my steps</ActionButton>
      </div>
    </CenteredModal>
  )
}

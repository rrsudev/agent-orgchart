'use client'

import { useEffect } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { CloseButton } from './shared-ui'

// ─── Reusable centered modal ─────────────────────────────────────────────────

export function CenteredModal({ onClose, children, maxWidth = 440, dim = true }: {
  onClose: () => void
  children: React.ReactNode
  maxWidth?: number
  /** Dim + block the page behind the modal (confirmations). */
  dim?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z.contextMenu + 10, background: dim ? 'rgba(0,0,0,0.45)' : 'transparent', pointerEvents: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="glass-card font-mono"
        style={{ maxWidth, width: '90%', padding: '20px 22px' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function ActionButton({ onClick, children, variant }: {
  onClick: () => void
  children: React.ReactNode
  variant: 'primary' | 'danger' | 'neutral'
}) {
  const style =
    variant === 'primary' ? { background: COLORS.toggleActive, border: `1px solid ${COLORS.holoBright}`, color: COLORS.holoBright }
    : variant === 'danger' ? { background: COLORS.cardBgError, border: `1px solid ${COLORS.error}`, color: COLORS.error }
    : { background: COLORS.toggleInactive, border: `1px solid ${COLORS.toggleBorder}`, color: COLORS.textDim }
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-1.5 rounded text-[13px] font-medium transition-all hover:scale-[1.03]"
      style={style}
    >
      {children}
    </button>
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
      <div className="text-[15px] font-semibold mb-2" style={{ color: COLORS.textPrimary }}>{title}</div>
      <div className="text-[13px] leading-relaxed mb-4" style={{ color: COLORS.textDim }}>{body}</div>
      <div className="flex items-center justify-end gap-2">
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
      <div className="flex items-start justify-between mb-2">
        <div className="text-[15px] font-semibold" style={{ color: COLORS.textPrimary }}>
          15-minute session mark reached
        </div>
        <CloseButton onClick={onDismiss} />
      </div>
      <div className="text-[13px] leading-relaxed mb-4" style={{ color: COLORS.textDim }}>
        You&apos;ve reached the 15-minute minimum for this session. Would you like to
        record your steps on the study website now? You can also keep working. Closing
        this message lets you continue the session and use the tool as usual.
      </div>
      <div className="flex items-center justify-end gap-2">
        <ActionButton onClick={onDismiss} variant="neutral">Keep working</ActionButton>
        <ActionButton onClick={onOpenWebsite} variant="primary">Record my steps →</ActionButton>
      </div>
    </CenteredModal>
  )
}

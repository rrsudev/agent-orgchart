"use client"

import { memo, useEffect, useRef, useState } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { SessionTabs } from "./session-tabs"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"
import type { SessionName } from "@/lib/callsigns"
import { useLayout } from "@/lib/layout"

// ─── Toggle Button ──────────────────────────────────────────────────────────
// A segmented on/off switch. The state is legible three ways at once: a leading
// status dot (filled + glow when on, hollow ring when off — echoing the app's
// LIVE/idle dots), an accent fill + bold label when on, and `role="switch"` so
// screen readers announce it as a toggle rather than a plain button.

function ToggleButton({ active, onClick, children, label, activeColor }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  /** Human name of what this toggles, for the tooltip + screen-reader label. */
  label: string
  activeColor?: { bg: string; text: string }
}) {
  const accent = activeColor?.text ?? COLORS.holoBright
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={active}
      aria-label={label}
      title={`${label}: ${active ? 'on' : 'off'} — click to ${active ? 'hide' : 'show'}`}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded transition-all"
      style={{
        background: active ? (activeColor?.bg ?? COLORS.toggleActive) : 'transparent',
        color: active ? accent : COLORS.textMuted,
        fontWeight: active ? 600 : undefined,
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block rounded-full transition-all"
        style={{
          width: 7,
          height: 7,
          background: active ? accent : 'transparent',
          border: `1.5px solid ${active ? accent : COLORS.textMuted}`,
          boxShadow: active ? `0 0 6px ${accent}` : 'none',
        }}
      />
      {children}
    </button>
  )
}

// ─── Closed-tabs menu ─────────────────────────────────────────────────────────
// Lists every archived (closed) session so any one can be reopened directly —
// selection, not a LIFO undo. Newest-closed first.

function ClosedTabsMenu({ archived, display, onReopen, onResume }: {
  archived: SessionInfo[]
  display: Map<string, SessionName>
  onReopen: (id: string) => void
  /** Reopen the underlying Claude chat in a terminal. Only set inside VS Code. */
  onResume?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (archived.length === 0) return null
  // Newest-closed first (archive is stored oldest→newest).
  const items = [...archived].reverse()

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2.5 py-1 rounded transition-all flex items-center gap-1.5"
        style={{
          background: COLORS.toggleInactive,
          border: `1px solid ${COLORS.toggleBorder}`,
          color: COLORS.textDim,
        }}
        title="Reopen a closed tab"
      >
        <span aria-hidden="true">⤺</span>
        Closed ({archived.length})
      </button>
      {open && (
        <div
          className="glass-card absolute right-0 mt-1.5 p-1 flex flex-col gap-0.5"
          style={{ minWidth: 180, maxWidth: 260, maxHeight: 320, overflowY: 'auto', zIndex: Z.contextMenu }}
        >
          {items.map(s => {
            const disp = display.get(s.id) ?? { name: s.label }
            return (
            <div key={s.id} className="flex items-center gap-0.5">
              <button
                onClick={() => { onReopen(s.id); setOpen(false) }}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-left transition-colors hover:bg-black/5 truncate"
                style={{ color: COLORS.textDim }}
                title={disp.goal ? `Reopen "${disp.name}" — ${disp.goal}` : `Reopen "${disp.name}"`}
              >
                {disp.name}
              </button>
              {onResume && (
                <button
                  onClick={() => { onResume(s.id); setOpen(false) }}
                  className="shrink-0 px-1.5 py-1.5 rounded transition-colors hover:bg-black/5"
                  style={{ color: COLORS.textMuted }}
                  aria-label={`Resume "${disp.name}" in a terminal`}
                  title="Resume this chat in a terminal (claude --resume)"
                >
                  <span aria-hidden="true" className="text-[11px]">▷_</span>
                </button>
              )}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

// ─── Connection Status Indicator ────────────────────────────────────────────

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const color = status === 'watching' ? COLORS.complete
    : status === 'connected' ? COLORS.idle : COLORS.error
  const label = status === 'watching' ? 'LIVE'
    : status === 'connected' ? 'CONNECTED' : 'OFFLINE'

  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      {label}
    </span>
  )
}

// ─── Top Bar ────────────────────────────────────────────────────────────────

export interface TopBarProps {
  // Session tabs
  sessions: SessionInfo[]
  /** Per-session display: call-sign name + optional goal subtitle, keyed by id. */
  sessionDisplay: Map<string, SessionName>
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  /** Per-session accent color, keyed by session id (identity color or fallback hue). */
  accentColors: Map<string, string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession: (id: string, label: string) => void
  onReorderSession: (fromId: string, toId: string) => void
  // Archived (closed) sessions + reopen (undo)
  archivedSessions: SessionInfo[]
  /** Display resolution (call-sign / rename + goal) for archived sessions. */
  archivedDisplay: Map<string, SessionName>
  onReopenSession: (id: string) => void
  /** Resume a closed session's Claude chat in a terminal (VS Code only). */
  onResumeSession?: (id: string) => void
  // Connection
  isVSCode: boolean
  connectionStatus: ConnectionStatus
  // Stats
  agentCount: number
  // Panel toggles
  showFileAttention: boolean
  showChat: boolean
  /** Whether the per-node token bar is shown (user preference). */
  showTokens: boolean
  onToggleFiles: () => void
  onToggleChat: () => void
  onToggleTokens: () => void
  // New agent composer
  onNewAgent: () => void
  /** Return to the study platform (opens gamejam-progress in the browser). */
  onReturnToStudy: () => void
}

export const TopBar = memo(function TopBar({
  sessions, sessionDisplay, selectedSessionId, sessionsWithActivity, accentColors,
  onSelectSession, onCloseSession, onRenameSession, onReorderSession,
  archivedSessions, archivedDisplay, onReopenSession, onResumeSession,
  isVSCode, connectionStatus,
  agentCount,
  showFileAttention, showChat, showTokens,
  onToggleFiles, onToggleChat, onToggleTokens,
  onNewAgent,
  onReturnToStudy,
}: TopBarProps) {
  const { compact, narrow } = useLayout()
  // Tighten insets + spacing as the surface narrows so the control cluster stays
  // on one row instead of overflowing a docked VS Code column.
  const inset = narrow ? "left-2 right-2" : compact ? "left-3 right-3" : "left-4 right-4"
  const gap = narrow ? "gap-2" : compact ? "gap-3" : "gap-5"
  return (
    <div className={`absolute top-4 ${inset} flex items-center ${gap} font-mono text-[14px] font-medium`} style={{ zIndex: Z.info }}>
      {/* Session tabs — scrollable, takes available space */}
      {sessions.length > 1 && (
        <div className="min-w-0 flex-shrink">
          <SessionTabs
            sessions={sessions}
            sessionDisplay={sessionDisplay}
            selectedSessionId={selectedSessionId}
            sessionsWithActivity={sessionsWithActivity}
            accentColors={accentColors}
            onSelectSession={onSelectSession}
            onCloseSession={onCloseSession}
            onRenameSession={onRenameSession}
            onReorderSession={onReorderSession}
          />
        </div>
      )}

      {/* Spacer pushes info to the right */}
      <div className="flex-1" />

      {/* Right-side info/controls */}
      <div className={`flex items-center ${gap} flex-shrink-0`} style={{ color: COLORS.textMuted }}>
        <ClosedTabsMenu archived={archivedSessions} display={archivedDisplay} onReopen={onReopenSession} onResume={onResumeSession} />
        <button
          onClick={onNewAgent}
          className="px-2.5 py-1 rounded transition-all"
          style={{
            background: COLORS.toggleActive,
            border: `1px solid ${COLORS.holoBright}`,
            color: COLORS.holoBright,
          }}
          title="Compose a command to launch a new agent"
        >
          + New agent
        </button>
        {isVSCode && <ConnectionIndicator status={connectionStatus} />}
        <span>{agentCount} agents</span>

        {/* View toggles — a segmented group of on/off switches for the panels +
            the per-node token bar. */}
        <div
          role="group"
          aria-label="View toggles"
          className="flex items-center gap-1 px-1 py-1 rounded-lg"
          style={{
            background: COLORS.holoBg03,
            border: `1px solid ${COLORS.holoBorder06}`,
          }}
        >
          <ToggleButton active={showFileAttention} onClick={onToggleFiles} label="File-attention panel">Files</ToggleButton>
          <ToggleButton active={showChat} onClick={onToggleChat} label="Conversation panel">Chat</ToggleButton>
          <ToggleButton active={showTokens} onClick={onToggleTokens} label="Per-node token bar">Tokens</ToggleButton>
        </div>

        {/* Return to the study platform — corner of the tool */}
        <button
          onClick={onReturnToStudy}
          className="px-2.5 py-1 rounded transition-all flex items-center gap-1.5 hover:scale-[1.03]"
          style={{
            background: COLORS.holoBg05,
            border: `1px solid ${COLORS.holoBorder10}`,
            color: COLORS.holoBright,
          }}
          title="Return to the study platform (opens in your browser)"
        >
          <span aria-hidden="true">↗</span>
          Study platform
        </button>
      </div>
    </div>
  )
})

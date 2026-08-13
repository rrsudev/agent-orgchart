"use client"

import { memo, useEffect, useRef, useState } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { SessionTabs } from "./session-tabs"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"
import type { SessionName } from "@/lib/callsigns"

// ─── Toggle Button ──────────────────────────────────────────────────────────

function ToggleButton({ active, onClick, children, style, activeColor }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  style?: React.CSSProperties
  activeColor?: { bg: string; text: string }
}) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded transition-all"
      style={{
        background: active ? (activeColor?.bg ?? COLORS.toggleActive) : COLORS.toggleInactive,
        border: `1px solid ${COLORS.toggleBorder}`,
        color: active ? (activeColor?.text ?? COLORS.holoBright) : COLORS.textMuted,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ─── Closed-tabs menu ─────────────────────────────────────────────────────────
// Lists every archived (closed) session so any one can be reopened directly —
// selection, not a LIFO undo. Newest-closed first.

function ClosedTabsMenu({ archived, display, onReopen }: {
  archived: SessionInfo[]
  display: Map<string, SessionName>
  onReopen: (id: string) => void
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
            <button
              key={s.id}
              onClick={() => { onReopen(s.id); setOpen(false) }}
              className="px-2.5 py-1.5 rounded text-left transition-colors hover:bg-black/5 truncate"
              style={{ color: COLORS.textDim }}
              title={disp.goal ? `Reopen "${disp.name}" — ${disp.goal}` : `Reopen "${disp.name}"`}
            >
              {disp.name}
            </button>
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
  archivedSessions, archivedDisplay, onReopenSession,
  isVSCode, connectionStatus,
  agentCount,
  showFileAttention, showChat, showTokens,
  onToggleFiles, onToggleChat, onToggleTokens,
  onNewAgent,
  onReturnToStudy,
}: TopBarProps) {
  return (
    <div className="absolute top-4 left-4 right-4 flex items-center gap-5 font-mono text-[14px] font-medium" style={{ zIndex: Z.info }}>
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
      <div className="flex items-center gap-5 flex-shrink-0" style={{ color: COLORS.textMuted }}>
        <ClosedTabsMenu archived={archivedSessions} display={archivedDisplay} onReopen={onReopenSession} />
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

        {/* View toggles — panels + the per-node token bar */}
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{
          background: COLORS.holoBg03,
          border: `1px solid ${COLORS.holoBorder06}`,
        }}>
          <ToggleButton active={showFileAttention} onClick={onToggleFiles} style={{ background: showFileAttention ? undefined : 'transparent', border: 'none' }}>Files</ToggleButton>
          <ToggleButton active={showChat} onClick={onToggleChat} style={{ background: showChat ? undefined : 'transparent', border: 'none' }}>Chat</ToggleButton>
          <ToggleButton active={showTokens} onClick={onToggleTokens} style={{ background: showTokens ? undefined : 'transparent', border: 'none' }}>Tokens</ToggleButton>
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

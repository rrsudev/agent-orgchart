"use client"

import { memo } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { SessionTabs } from "./session-tabs"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"

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
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession: (id: string, label: string) => void
  // Archived (closed) sessions + reopen (undo)
  archivedSessions: SessionInfo[]
  onReopenSession: (id: string) => void
  // Connection
  isVSCode: boolean
  connectionStatus: ConnectionStatus
  // Stats
  agentCount: number
  // Panel toggles
  showFileAttention: boolean
  showChat: boolean
  showTimeline: boolean
  onToggleFiles: () => void
  onToggleChat: () => void
  onToggleTimeline: () => void
  // New agent composer
  onNewAgent: () => void
}

export const TopBar = memo(function TopBar({
  sessions, selectedSessionId, sessionsWithActivity,
  onSelectSession, onCloseSession, onRenameSession,
  archivedSessions, onReopenSession,
  isVSCode, connectionStatus,
  agentCount,
  showFileAttention, showChat, showTimeline,
  onToggleFiles, onToggleChat, onToggleTimeline,
  onNewAgent,
}: TopBarProps) {
  // Most-recently archived session — clicking "Reopen" undoes closes one by one.
  const lastArchived = archivedSessions.length > 0 ? archivedSessions[archivedSessions.length - 1] : null
  return (
    <div className="absolute top-4 left-4 right-4 flex items-center gap-5 font-mono text-[14px] font-medium" style={{ zIndex: Z.info }}>
      {/* Session tabs — scrollable, takes available space */}
      {sessions.length > 1 && (
        <div className="min-w-0 flex-shrink">
          <SessionTabs
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            sessionsWithActivity={sessionsWithActivity}
            onSelectSession={onSelectSession}
            onCloseSession={onCloseSession}
            onRenameSession={onRenameSession}
          />
        </div>
      )}

      {/* Spacer pushes info to the right */}
      <div className="flex-1" />

      {/* Right-side info/controls */}
      <div className="flex items-center gap-5 flex-shrink-0" style={{ color: COLORS.textMuted }}>
        {lastArchived && (
          <button
            onClick={() => onReopenSession(lastArchived.id)}
            className="px-2.5 py-1 rounded transition-all flex items-center gap-1.5"
            style={{
              background: COLORS.toggleInactive,
              border: `1px solid ${COLORS.toggleBorder}`,
              color: COLORS.textDim,
            }}
            title={`Reopen "${lastArchived.label}"${archivedSessions.length > 1 ? ` (${archivedSessions.length} closed)` : ''}`}
          >
            <span aria-hidden="true">⤺</span>
            Reopen{archivedSessions.length > 1 ? ` (${archivedSessions.length})` : ''}
          </button>
        )}
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

        {/* Mutually exclusive panel group */}
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{
          background: COLORS.holoBg03,
          border: `1px solid ${COLORS.holoBorder06}`,
        }}>
          <ToggleButton active={showFileAttention} onClick={onToggleFiles} style={{ background: showFileAttention ? undefined : 'transparent', border: 'none' }}>Files</ToggleButton>
          <ToggleButton active={showChat} onClick={onToggleChat} style={{ background: showChat ? undefined : 'transparent', border: 'none' }}>Chat</ToggleButton>
        </div>

        {/* Independent toggles */}
        <ToggleButton active={showTimeline} onClick={onToggleTimeline}>Timeline</ToggleButton>
      </div>
    </div>
  )
})

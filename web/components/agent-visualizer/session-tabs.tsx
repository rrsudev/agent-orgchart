'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { PARALLEL_VIEW_ID } from '@/lib/bridge-types'
import type { SessionInfo } from '@/lib/vscode-bridge'

interface SessionTabsProps {
  sessions: SessionInfo[]
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession: (id: string, label: string) => void
}

// macOS-style raised capsule for the active tab; flat, muted tabs otherwise.
const SELECTED_SHADOW = '0 1px 2px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)'

export function SessionTabs({
  sessions,
  selectedSessionId,
  sessionsWithActivity,
  onSelectSession,
  onCloseSession,
  onRenameSession,
}: SessionTabsProps) {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)

  // Inline-rename state: which tab is being edited and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const setButtonRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(id, el)
    else buttonRefs.current.delete(id)
  }, [])

  // Scroll selected tab into view whenever it changes
  useEffect(() => {
    if (!selectedSessionId) return
    const el = buttonRefs.current.get(selectedSessionId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [selectedSessionId])

  // Focus + select the input when a rename starts.
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startRename = useCallback((session: SessionInfo) => {
    setEditingId(session.id)
    setDraft(session.label)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId) onRenameSession(editingId, draft)
    setEditingId(null)
  }, [editingId, draft, onRenameSession])

  const cancelRename = useCallback(() => setEditingId(null), [])

  return (
    // Segmented "track" that houses the tabs — mirrors macOS/Safari tab bars.
    // The track (and the pinned "All agents" segment) keep a fixed shape; only
    // the per-session tabs scroll horizontally inside, so the rounded frame is
    // never cut off no matter how many tabs there are.
    <div
      className="flex items-center gap-0.5 p-1 rounded-[11px] max-w-full"
      style={{
        background: 'rgba(0, 0, 0, 0.045)',
        border: `1px solid ${COLORS.holoBorder08}`,
      }}
    >
      {/* Parallel view — combines every session and shows all agents at once. */}
      {(() => {
        const isSelected = selectedSessionId === PARALLEL_VIEW_ID
        return (
          <button
            onClick={() => onSelectSession(PARALLEL_VIEW_ID)}
            title="Parallel view — all agents from every session"
            className="px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              background: isSelected ? '#ffffff' : 'transparent',
              boxShadow: isSelected ? SELECTED_SHADOW : 'none',
              color: isSelected ? COLORS.holoBright : COLORS.textDim,
              fontWeight: isSelected ? 600 : 500,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>▦</span>
            All agents
          </button>
        )
      })()}

      {/* Divider between the parallel-view segment and the per-session tabs. */}
      <span
        aria-hidden="true"
        className="self-center mx-0.5 shrink-0"
        style={{ width: 1, height: 16, background: COLORS.holoBorder12 }}
      />

      {/* Scrollable region — only the session tabs scroll; the frame stays put. */}
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
      {sessions.map(session => {
        const isSelected = session.id === selectedSessionId
        const isActive = session.status === 'active'
        const hasActivity = sessionsWithActivity.has(session.id)
        // Green dot: session is active, OR has unseen background activity
        const showGreen = isActive || hasActivity
        const isEditing = editingId === session.id
        return (
          <button
            key={session.id}
            ref={(el) => setButtonRef(session.id, el)}
            onClick={() => onSelectSession(session.id)}
            onDoubleClick={() => startRename(session)}
            title="Double-click to rename"
            className="group px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              background: isSelected ? '#ffffff' : 'transparent',
              boxShadow: isSelected ? SELECTED_SHADOW : 'none',
              color: isSelected ? COLORS.textPrimary : COLORS.textDim,
              fontWeight: isSelected ? 600 : 500,
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: showGreen ? COLORS.complete : COLORS.idle + '40',
                boxShadow: showGreen ? `0 0 4px ${COLORS.complete}` : 'none',
                animation: hasActivity && !isSelected ? 'pulse 1.5s infinite' : 'none',
              }}
            />
            {isEditing ? (
              <input
                ref={inputRef}
                value={draft}
                size={Math.max(draft.length, 4)}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                }}
                className="bg-transparent outline-none border-0 p-0 m-0"
                style={{ color: COLORS.textPrimary, font: 'inherit', minWidth: 32 }}
              />
            ) : (
              session.label
            )}
            <span
              className="ml-0.5 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-black/10"
              style={{ color: COLORS.tabClose, width: 16, height: 16, fontSize: 10, lineHeight: '16px' }}
              onClick={(e) => {
                e.stopPropagation()
                onCloseSession(session.id)
              }}
            >
              ✕
            </span>
          </button>
        )
      })}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { PARALLEL_VIEW_ID } from '@/lib/bridge-types'
import type { SessionInfo } from '@/lib/vscode-bridge'
import type { SessionName } from '@/lib/callsigns'

interface SessionTabsProps {
  sessions: SessionInfo[]
  /** Per-session display: call-sign name + optional goal subtitle, keyed by id. */
  sessionDisplay: Map<string, SessionName>
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  /** Per-session accent color, keyed by session id. */
  accentColors: Map<string, string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRenameSession: (id: string, label: string) => void
  /** Move tab `fromId` into `toId`'s slot (drag-to-reorder). */
  onReorderSession: (fromId: string, toId: string) => void
}

// macOS-style raised capsule for the active tab; flat, muted tabs otherwise.
const SELECTED_SHADOW = '0 1px 2px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)'

/** Geometry of the sliding active-tab pill, in scroll-content coordinates. */
interface PillRect { left: number; top: number; width: number; height: number }

export function SessionTabs({
  sessions,
  sessionDisplay,
  selectedSessionId,
  sessionsWithActivity,
  accentColors,
  onSelectSession,
  onCloseSession,
  onRenameSession,
  onReorderSession,
}: SessionTabsProps) {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

  // Inline-rename state: which tab is being edited and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Drag-to-reorder state: the tab currently being dragged (null when idle).
  const [dragId, setDragId] = useState<string | null>(null)

  // Sliding active-tab pill. Measured in scroll-content coordinates (offsetLeft
  // is scroll-independent), so the pill scrolls with the tabs for free and we
  // only remeasure when the layout — not the scroll position — changes. `null`
  // when the parallel "All agents" segment is active (it lives in a separate
  // region and gets its own highlight).
  const [pill, setPill] = useState<PillRect | null>(null)
  // Suppress the glide on the very first placement (and when jumping in from the
  // All-agents segment) so the pill fades in instead of flying from 0,0.
  const [pillReady, setPillReady] = useState(false)

  const setButtonRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(id, el)
    else buttonRefs.current.delete(id)
  }, [])

  const measurePill = useCallback(() => {
    const el = selectedSessionId ? buttonRefs.current.get(selectedSessionId) : null
    if (!el) { setPill(null); setPillReady(false); return }
    setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
  }, [selectedSessionId])

  // Remeasure the pill whenever the selected tab, tab set/order, or an in-flight
  // rename (which resizes a tab) changes. useLayoutEffect keeps it in step with
  // paint so the glide starts from the correct prior position.
  useLayoutEffect(() => { measurePill() }, [measurePill, sessions, editingId, draft])

  // Enable the glide transition one frame after the first measurement so the
  // initial placement doesn't animate from the origin.
  useEffect(() => {
    if (!pill) return
    const raf = requestAnimationFrame(() => setPillReady(true))
    return () => cancelAnimationFrame(raf)
  }, [pill])

  // Keep the pill aligned when the container resizes (font load, window resize,
  // panels opening) — layout shifts change offsets without a prop change.
  useEffect(() => {
    const node = scrollContentRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measurePill())
    ro.observe(node)
    return () => ro.disconnect()
  }, [measurePill])

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

  // Seed the rename draft with the current display NAME (call-sign, or an
  // existing rename) — that's what the user sees on the tab, not the goal label.
  const startRename = useCallback((id: string, name: string) => {
    setEditingId(id)
    setDraft(name)
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

      {/* Scrollable region — only the session tabs scroll; the frame stays put.
          `relative` anchors the sliding active-tab pill in scroll-content
          coordinates, so it tracks horizontal scroll for free. */}
      <div ref={scrollContentRef} className="relative flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
      {/* Sliding active-tab pill — glides between tabs on switch (macOS-style
          raised capsule). Sits behind the tabs; each tab's fill is transparent. */}
      {pill && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: pill.left,
            top: pill.top,
            width: pill.width,
            height: pill.height,
            background: '#ffffff',
            boxShadow: SELECTED_SHADOW,
            borderRadius: 8,
            zIndex: 0,
            pointerEvents: 'none',
            // Glide only once placed (pillReady) so the first paint doesn't fly
            // in from the origin.
            transition: pillReady
              ? 'left 260ms cubic-bezier(0.22,1,0.36,1), top 260ms cubic-bezier(0.22,1,0.36,1), width 260ms cubic-bezier(0.22,1,0.36,1), height 260ms cubic-bezier(0.22,1,0.36,1)'
              : 'none',
          }}
        />
      )}
      {sessions.map(session => {
        const isSelected = session.id === selectedSessionId
        const isActive = session.status === 'active'
        const hasActivity = sessionsWithActivity.has(session.id)
        // Green dot: session is active, OR has unseen background activity
        const showGreen = isActive || hasActivity
        const isEditing = editingId === session.id
        // Per-session identity accent — only present once the user picks a color.
        const accent = accentColors.get(session.id)
        // Call-sign name + optional goal. The goal rides in the tooltip here (the
        // canvas node shows it as a subtitle). Fall back to the raw label for the
        // brief moment before a call-sign is assigned.
        const disp = sessionDisplay.get(session.id) ?? { name: session.label }
        const tabTitle = disp.goal
          ? `${disp.goal} · double-click to rename`
          : 'Double-click to rename · drag to reorder'
        return (
          <button
            key={session.id}
            ref={(el) => setButtonRef(session.id, el)}
            onClick={() => onSelectSession(session.id)}
            onDoubleClick={() => startRename(session.id, disp.name)}
            title={tabTitle}
            // Drag-to-reorder. Reordering live on dragover (the standard tab-bar
            // pattern) keeps the dragged tab under the cursor as slots swap.
            // Disabled while renaming so text selection in the input still works.
            draggable={!isEditing}
            onDragStart={(e) => {
              setDragId(session.id)
              e.dataTransfer.effectAllowed = 'move'
              // Firefox requires data to be set for a drag to start.
              try { e.dataTransfer.setData('text/plain', session.id) } catch {}
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === session.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              onReorderSession(dragId, session.id)
            }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => setDragId(null)}
            // `relative` + zIndex lifts the tab content above the sliding pill.
            // Fill is transparent — the pill provides the active capsule.
            className="group relative px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              zIndex: 1,
              background: 'transparent',
              color: isSelected ? COLORS.textPrimary : COLORS.textDim,
              fontWeight: isSelected ? 600 : 500,
              opacity: dragId === session.id ? 0.5 : 1,
              cursor: dragId ? 'grabbing' : undefined,
            }}
          >
            {/* Identity accent bar — shown only when the user has colored this
                session; dims when the tab is inactive. */}
            {accent && (
              <span
                aria-hidden="true"
                className="rounded-full flex-shrink-0"
                style={{
                  width: 3,
                  height: 13,
                  background: accent,
                  opacity: isSelected ? 1 : 0.5,
                  transition: 'opacity 150ms ease',
                }}
              />
            )}
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
              disp.name
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

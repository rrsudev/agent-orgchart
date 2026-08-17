'use client'

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { PARALLEL_VIEW_ID } from '@/lib/bridge-types'
import { useLayout } from '@/lib/layout'
import { Icon } from './chrome'
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

/** Widest a single tab may grow before its name truncates. Without a cap, one
 *  long call-sign pushes every other tab out of the scroll window. */
const TAB_MAX_W = 176
/** Narrowest a tab may be compressed to before the strip scrolls instead. Fits
 *  the status dot, a few characters of the call-sign, and the close control. */
const TAB_MIN_W = 84
/** The selected tab holds more of its name than the rest — it is the one you
 *  are reading, and "Ap…" is a poor label for where you currently are. */
const TAB_MIN_W_SELECTED = 116
/** Floor for the scrolling region, so the strip stays usable in a side bar. */
const STRIP_MIN_W = 96

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
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const { narrow } = useLayout()

  // Inline-rename state: which tab is being edited and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Drag-to-reorder state: the tab currently being dragged (null when idle).
  const [dragId, setDragId] = useState<string | null>(null)

  // Which edges have tabs hidden past them. Drives the fade mask so a clipped
  // strip reads as scrollable rather than as a tab that got cut in half — the
  // failure the old fixed-width strip showed even on a 1440px surface.
  const [overflow, setOverflow] = useState<{ start: boolean; end: boolean }>({ start: false, end: false })

  // Sliding active-tab pill. Measured in scroll-content coordinates (offsetLeft
  // is scroll-independent), so the pill scrolls with the tabs for free and we
  // only remeasure when the layout — not the scroll position — changes. `null`
  // when the parallel "All agents" segment is active (it lives in a separate
  // region and gets its own highlight).
  const [pill, setPill] = useState<PillRect | null>(null)
  // Suppress the glide on the very first placement (and when jumping in from the
  // All-agents segment) so the pill fades in instead of flying from 0,0.
  const [pillReady, setPillReady] = useState(false)

  const setTabRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) tabRefs.current.set(id, el)
    else tabRefs.current.delete(id)
  }, [])

  const measurePill = useCallback(() => {
    const el = selectedSessionId ? tabRefs.current.get(selectedSessionId) : null
    if (!el) { setPill(null); setPillReady(false); return }
    setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
  }, [selectedSessionId])

  const measureOverflow = useCallback(() => {
    const node = scrollContentRef.current
    if (!node) return
    const max = node.scrollWidth - node.clientWidth
    const next = { start: node.scrollLeft > 1, end: max > 1 && node.scrollLeft < max - 1 }
    setOverflow(prev => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [])

  // Remeasure the pill whenever the selected tab, tab set/order, or an in-flight
  // rename (which resizes a tab) changes. useLayoutEffect keeps it in step with
  // paint so the glide starts from the correct prior position.
  useLayoutEffect(() => { measurePill(); measureOverflow() }, [measurePill, measureOverflow, sessions, editingId, draft])

  // Enable the glide transition one frame after the first measurement so the
  // initial placement doesn't animate from the origin.
  useEffect(() => {
    if (!pill) return
    const raf = requestAnimationFrame(() => setPillReady(true))
    return () => cancelAnimationFrame(raf)
  }, [pill])

  // Keep the pill and the overflow fades aligned when the container resizes
  // (font load, window resize, panels opening) — layout shifts change offsets
  // without a prop change.
  useEffect(() => {
    const node = scrollContentRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { measurePill(); measureOverflow() })
    ro.observe(node)
    for (const child of Array.from(node.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [measurePill, measureOverflow, sessions])

  // Scroll selected tab into view whenever it changes
  useEffect(() => {
    if (!selectedSessionId) return
    const el = tabRefs.current.get(selectedSessionId)
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

  const allAgentsSelected = selectedSessionId === PARALLEL_VIEW_ID

  // Fade whichever edge has hidden tabs behind it. A mask (rather than an
  // overlay) keeps the fade transparent to pointer events.
  const fadeMask = overflow.start || overflow.end
    ? `linear-gradient(to right, transparent 0, #000 ${overflow.start ? '16px' : '0'}, #000 calc(100% - ${overflow.end ? '16px' : '0px'}), transparent 100%)`
    : undefined

  return (
    // Segmented "track" that houses the tabs — mirrors macOS/Safari tab bars.
    // The track (and the pinned "All agents" segment) keep a fixed shape; only
    // the per-session tabs scroll horizontally inside, so the rounded frame is
    // never cut off no matter how many tabs there are. `min-w-0` lets the whole
    // track give way when the bar runs out of room.
    <div
      className="flex items-center gap-0.5 min-w-0 max-w-full"
      style={{
        padding: 2,
        borderRadius: 10,
        background: 'rgba(0, 0, 0, 0.045)',
        border: `1px solid ${COLORS.holoBorder08}`,
      }}
    >
      {/* Parallel view — combines every session and shows all agents at once.
          Pinned (never scrolls away) because it is a view mode, not a session;
          on a side bar it keeps only its glyph. */}
      <button
        onClick={() => onSelectSession(PARALLEL_VIEW_ID)}
        title="Parallel view — all agents from every session"
        aria-label="Parallel view — all agents from every session"
        aria-pressed={allAgentsSelected}
        className="inline-flex items-center gap-1.5 shrink-0 transition-colors"
        style={{
          height: 'var(--ctl-h-sm)',
          paddingInline: narrow ? 6 : 10,
          borderRadius: 7,
          whiteSpace: 'nowrap',
          background: allAgentsSelected ? '#ffffff' : 'transparent',
          boxShadow: allAgentsSelected ? SELECTED_SHADOW : 'none',
          color: allAgentsSelected ? COLORS.holoBright : COLORS.textDim,
          fontSize: 'var(--ui-sm)',
          fontWeight: allAgentsSelected ? 600 : 500,
        }}
      >
        <Icon name="grid" />
        {!narrow && 'All agents'}
      </button>

      {/* Divider between the parallel-view segment and the per-session tabs. */}
      <span
        aria-hidden="true"
        className="self-center mx-0.5 shrink-0"
        style={{ width: 1, height: 16, background: COLORS.holoBorder12 }}
      />

      {/* Scrollable region — only the session tabs scroll; the frame stays put.
          `relative` anchors the sliding active-tab pill in scroll-content
          coordinates, so it tracks horizontal scroll for free. */}
      <div
        ref={scrollContentRef}
        onScroll={measureOverflow}
        role="tablist"
        aria-label="Agent sessions"
        className="relative flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0 flex-1"
        style={{
          minWidth: STRIP_MIN_W,
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
        }}
      >
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
              borderRadius: 7,
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
            // The tab is a container, not a button: the close affordance is a
            // real button and cannot be nested inside another one. `relative` +
            // zIndex lifts the tab content above the sliding pill, whose white
            // capsule provides the selected fill.
            <div
              key={session.id}
              ref={(el) => setTabRef(session.id, el)}
              className="group relative flex items-center"
              style={{
                height: 'var(--ctl-h-sm)',
                // Tabs share the strip the way browser tabs do: they compress
                // toward TAB_MIN_W as more open, and only once they are all at
                // that floor does the strip start scrolling. Holding a fixed
                // width instead meant four tabs on a docked column scrolled
                // while each one still had slack to give.
                flex: `0 1 auto`,
                minWidth: isSelected ? TAB_MIN_W_SELECTED : TAB_MIN_W,
                maxWidth: TAB_MAX_W,
                borderRadius: 7,
                zIndex: 1,
                opacity: dragId === session.id ? 0.5 : 1,
                cursor: dragId ? 'grabbing' : undefined,
              }}
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
            >
              <button
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectSession(session.id)}
                onDoubleClick={() => startRename(session.id, disp.name)}
                title={tabTitle}
                className="flex items-center gap-1.5 min-w-0 h-full transition-colors"
                style={{
                  paddingLeft: 8,
                  paddingRight: 4,
                  borderRadius: 7,
                  background: 'transparent',
                  color: isSelected ? COLORS.textPrimary : COLORS.textDim,
                  fontSize: 'var(--ui-sm)',
                  fontWeight: isSelected ? 600 : 500,
                }}
              >
                {/* Identity accent bar — shown only when the user has colored this
                    session; dims when the tab is inactive. */}
                {accent && (
                  <span
                    aria-hidden="true"
                    className="rounded-full shrink-0"
                    style={{
                      width: 3,
                      height: 12,
                      background: accent,
                      opacity: isSelected ? 1 : 0.5,
                      transition: 'opacity 150ms ease',
                    }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
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
                    className="bg-transparent outline-none border-0 p-0 m-0 min-w-0"
                    style={{ color: COLORS.textPrimary, font: 'inherit', width: `${Math.max(draft.length, 4)}ch` }}
                  />
                ) : (
                  <span className="min-w-0 truncate">{disp.name}</span>
                )}
              </button>
              {/* Close. Always visible on the selected tab (where it is the one
                  affordance you reach for) and on hover elsewhere, so it never
                  reflows the strip by appearing and disappearing — it holds its
                  slot either way. */}
              <button
                onClick={(e) => { e.stopPropagation(); onCloseSession(session.id) }}
                aria-label={`Close ${disp.name}`}
                title={`Close ${disp.name}`}
                className={`shrink-0 mr-1 flex items-center justify-center rounded-full transition-opacity hover:bg-black/10 ${
                  isSelected ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
                style={{ color: COLORS.tabClose, width: 16, height: 16 }}
              >
                <Icon name="close" size={8} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

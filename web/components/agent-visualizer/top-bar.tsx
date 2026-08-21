"use client"

import { memo, useEffect, useRef, useState, type ReactNode } from "react"
import { Z } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"
import { SessionTabs } from "./session-tabs"
import { BarDivider, ChromeButton, ControlGroup, Icon, StatusDot, ToggleChip, type IconName } from "./chrome"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"
import type { SessionName } from "@/lib/callsigns"
import { useLayout } from "@/lib/layout"

// ─── Dismissable menu ───────────────────────────────────────────────────────
// Shared by the closed-tabs list and the narrow-surface overflow menu: opens on
// click, dismisses on outside click or Escape, and clamps its own height to the
// surface so a long list can never run off the bottom.

interface MenuTriggerProps {
  onClick: () => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-label': string
  title: string
}

function MenuSurface({ trigger, label, children, align = 'right' }: {
  /** Renders the button. Spread the supplied props onto it so the menu keeps
   *  its open/close wiring and announces itself correctly. */
  trigger: (props: MenuTriggerProps, open: boolean) => ReactNode
  label: string
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const layout = useLayout()

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

  return (
    <div ref={rootRef} className="relative shrink-0">
      {trigger({
        onClick: () => setOpen(o => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': label,
        title: label,
      }, open)}
      {open && (
        <div
          role="menu"
          className="glass-card is-dense absolute mt-1.5 flex flex-col gap-0.5 panel-scroll"
          style={{
            [align]: 0,
            minWidth: 190,
            maxWidth: Math.min(280, layout.width - layout.gutter * 2),
            maxHeight: layout.panelHeight(0, 0),
            zIndex: Z.contextMenu,
            padding: 4,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** One row in a MenuSurface. */
function MenuItem({ icon, children, onClick, title, trailing }: {
  icon?: IconName
  children: ReactNode
  onClick: () => void
  title?: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        role="menuitem"
        onClick={onClick}
        title={title}
        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors hover:bg-black/5 ui-sm"
        style={{ color: COLORS.textDim }}
      >
        {icon && <Icon name={icon} />}
        <span className="min-w-0 truncate">{children}</span>
      </button>
      {trailing}
    </div>
  )
}

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-2 pt-1.5 pb-1 ui-2xs uppercase tracking-wide"
      style={{ color: COLORS.textMuted, borderTop: `1px solid ${COLORS.holoBorder06}` }}
    >
      {children}
    </div>
  )
}

/** Rough width one tab wants before it starts compressing, and the pinned
 *  "All agents" segment beside them. Used only to budget the bar — the strip
 *  itself lays out for real. Past six tabs the strip is expected to scroll, so
 *  budgeting more would starve the controls for no gain. */
const TAB_BUDGET_W = 96
const PARALLEL_SEGMENT_W = 130
const MAX_TABS_BUDGETED = 6

// ─── Connection status ──────────────────────────────────────────────────────

function ConnectionIndicator({ status, showLabel }: { status: ConnectionStatus; showLabel: boolean }) {
  const color = status === 'watching' ? COLORS.complete
    : status === 'connected' ? COLORS.idle : COLORS.error
  const label = status === 'watching' ? 'LIVE'
    : status === 'connected' ? 'CONNECTED' : 'OFFLINE'

  return (
    <span
      className="flex items-center gap-1.5 shrink-0 ui-sm"
      // The dot alone carries the state on narrow surfaces, so the accessible
      // name has to say what the dot means.
      title={`Connection: ${label.toLowerCase()}`}
      aria-label={`Connection: ${label.toLowerCase()}`}
    >
      <StatusDot color={color} size={7} />
      {showLabel && label}
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
  /** Whether the conversation feed shows full message text (vs short bubbles). */
  showFullText: boolean
  /** Whether the per-agent status / sublabel line is shown (user preference). */
  showSubtitles: boolean
  onToggleFiles: () => void
  onToggleFullText: () => void
  onToggleSubtitles: () => void
  /** Return to the study platform (opens gamejam-progress in the browser). */
  onReturnToStudy: () => void
  /** Reveal the local study-capture folder in the OS file explorer (VS Code
   *  only — omitted when not running in the extension host). */
  onRevealStudyData?: () => void
  /** Package the captured study data into a zip to send to researchers (VS Code
   *  only). */
  onExportStudyData?: () => void
}

export const TopBar = memo(function TopBar({
  sessions, sessionDisplay, selectedSessionId, sessionsWithActivity, accentColors,
  onSelectSession, onCloseSession, onRenameSession, onReorderSession,
  archivedSessions, archivedDisplay, onReopenSession, onResumeSession,
  isVSCode, connectionStatus,
  agentCount,
  showFileAttention, showFullText, showSubtitles,
  onToggleFiles, onToggleFullText, onToggleSubtitles,
  onReturnToStudy, onRevealStudyData, onExportStudyData,
}: TopBarProps) {
  const layout = useLayout()
  const { narrow, compact, gutter, registerChrome } = layout

  // What survives at each width. The bar never scrolls and never wraps; instead
  // controls shed their decoration, then their labels, then fold into the
  // overflow menu — so the row has a hard lower bound (~200px) well under the
  // narrowest side bar. Anything folded away is still reachable, never dropped.
  //
  // Density is driven by the room left over AFTER the tabs have taken a fair
  // share, not by the surface width alone. The tab strip is the primary
  // navigation: with six sessions open on a 900px column, keying off width
  // alone left the controls comfortably labelled while the tabs were crushed
  // into a scroller. Now the controls give way first, and the tabs only scroll
  // once they have actually run out of room.
  const tabDemand = sessions.length > 1
    ? PARALLEL_SEGMENT_W + Math.min(sessions.length, MAX_TABS_BUDGETED) * TAB_BUDGET_W
    : 0
  const controlRoom = layout.width - tabDemand
  // Labels never go: a squeezed toggle keeps its word and trades away the status
  // dot instead, because "Files" with an accent fill reads faster than an
  // unlabelled glyph with a dot beside it.
  const showToggleDots = !compact && controlRoom > 620
  const showStatusLabel = !compact && controlRoom > 520
  const showAgentCount = !narrow && controlRoom > 400
  const studyIconOnly = compact || controlRoom < 660
  const foldIntoMenu = narrow

  const tabs = sessions.length > 1 && (
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
  )

  const closedMenu = archivedSessions.length > 0 && (
    <MenuSurface
      label="Reopen a closed tab"
      trigger={(props) => (
        <ChromeButton icon="undo" {...props}>
          {!compact && 'Closed'}
          <span className="ui-num">{archivedSessions.length}</span>
        </ChromeButton>
      )}
    >
      {(close) => (
        // Newest-closed first (the archive is stored oldest→newest).
        [...archivedSessions].reverse().map(s => {
          const disp = archivedDisplay.get(s.id) ?? { name: s.label }
          return (
            <MenuItem
              key={s.id}
              onClick={() => { onReopenSession(s.id); close() }}
              title={disp.goal ? `Reopen "${disp.name}" — ${disp.goal}` : `Reopen "${disp.name}"`}
              trailing={onResumeSession ? (
                <button
                  onClick={() => { onResumeSession(s.id); close() }}
                  className="shrink-0 p-1.5 rounded transition-colors hover:bg-black/5"
                  style={{ color: COLORS.textMuted }}
                  aria-label={`Resume "${disp.name}" in a terminal`}
                  title="Resume this chat in a terminal (claude --resume)"
                >
                  <Icon name="terminal" />
                </button>
              ) : undefined}
            >
              {disp.name}
            </MenuItem>
          )
        })
      )}
    </MenuSurface>
  )

  // `dots` is passed rather than read from the density flags because the same
  // group renders in two places: squeezed into the bar, and roomy inside the
  // overflow menu (where the dot fits again).
  const renderToggles = (dots: boolean) => (
    <ControlGroup label="View toggles">
      <ToggleChip active={showFileAttention} onClick={onToggleFiles} label="File-attention panel" icon="files" showDot={dots}>Files</ToggleChip>
      <ToggleChip active={showFullText} onClick={onToggleFullText} label="Show full message text in the conversation feed (off = short bubbles)" icon="chat" showDot={dots}>Full text</ToggleChip>
      <ToggleChip active={showSubtitles} onClick={onToggleSubtitles} label="Per-agent status line (e.g. “guava is …”)" icon="label" showDot={dots}>Status</ToggleChip>
    </ControlGroup>
  )

  // Study-data actions (VS Code only). Wrapped in a small menu so locating and
  // exporting the local capture is always one click away, without hunting the
  // command palette. Only rendered when the host wired the handlers.
  const hasStudyData = !!(onRevealStudyData || onExportStudyData)
  const renderStudyDataItems = (close: () => void) => (
    <>
      {onRevealStudyData && (
        <MenuItem icon="files" onClick={() => { onRevealStudyData(); close() }} title="Open the local study-capture folder in your file explorer">
          Reveal data folder
        </MenuItem>
      )}
      {onExportStudyData && (
        <MenuItem icon="archive" onClick={() => { onExportStudyData(); close() }} title="Package the captured study data into a zip to send to the researchers">
          Export data (zip)
        </MenuItem>
      )}
    </>
  )
  const studyDataMenu = hasStudyData && (
    <MenuSurface
      label="Study data"
      trigger={(props) => (
        <ChromeButton icon="archive" iconOnly={studyIconOnly} {...props}>
          Study data
        </ChromeButton>
      )}
    >
      {(close) => renderStudyDataItems(close)}
    </MenuSurface>
  )

  return (
    // The bar spans the surface but must not swallow clicks meant for the canvas
    // in the empty space between its clusters — only the clusters take pointer
    // events. `registerChrome` feeds the measured height back to the layout
    // context so every panel's top rail follows this bar instead of a constant.
    <div
      ref={registerChrome('top')}
      className="absolute top-0 left-0 right-0 flex items-center font-mono"
      style={{
        padding: gutter,
        gap: narrow ? 6 : 10,
        zIndex: Z.info,
        pointerEvents: 'none',
      }}
    >
      {/* Session tabs — take the free space and scroll internally. `min-w-0` is
          what actually lets them shrink; without it the flex row overflows the
          surface and the tab strip prints on top of the right-hand controls. */}
      <div className="min-w-0 flex-1 flex items-center" style={{ pointerEvents: 'auto' }}>
        {tabs}
      </div>

      {/* Right cluster — fixed content, progressively folded. */}
      <div
        className="flex items-center shrink-0"
        style={{ gap: narrow ? 6 : 8, color: COLORS.textMuted, pointerEvents: 'auto' }}
      >
        {foldIntoMenu ? (
          <>
            <MenuSurface
              label="More controls"
              trigger={(props) => <ChromeButton icon="more" iconOnly {...props} />}
            >
              {(close) => (
                <>
                  {/* Status + count read as one summary line at the top of the
                      menu, since neither fits in the bar at this width. */}
                  <div className="flex items-center gap-2 px-2 py-1.5 ui-xs" style={{ color: COLORS.textMuted }}>
                    {isVSCode && <ConnectionIndicator status={connectionStatus} showLabel />}
                    <span className="ui-num">{agentCount} {agentCount === 1 ? 'agent' : 'agents'}</span>
                  </div>
                  <div className="px-2 pb-1.5">{renderToggles(true)}</div>
                  {archivedSessions.length > 0 && (
                    <>
                      <MenuSectionLabel>Closed tabs</MenuSectionLabel>
                      {[...archivedSessions].reverse().map(s => {
                        const disp = archivedDisplay.get(s.id) ?? { name: s.label }
                        return (
                          <MenuItem
                            key={s.id}
                            icon="undo"
                            onClick={() => { onReopenSession(s.id); close() }}
                            title={disp.goal ? `Reopen "${disp.name}" — ${disp.goal}` : `Reopen "${disp.name}"`}
                          >
                            {disp.name}
                          </MenuItem>
                        )
                      })}
                    </>
                  )}
                  {hasStudyData && (
                    <>
                      <MenuSectionLabel>Study data</MenuSectionLabel>
                      {renderStudyDataItems(close)}
                    </>
                  )}
                  <MenuItem icon="external" onClick={() => { onReturnToStudy(); close() }} title="Return to the study platform (opens in your browser)">
                    Study platform
                  </MenuItem>
                </>
              )}
            </MenuSurface>
          </>
        ) : (
          <>
            {closedMenu}
            {closedMenu && <BarDivider />}
            {isVSCode && <ConnectionIndicator status={connectionStatus} showLabel={showStatusLabel} />}
            {showAgentCount && (
              <span className="ui-sm ui-num shrink-0">
                {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
              </span>
            )}
            {renderToggles(showToggleDots)}
            {studyDataMenu}
            <ChromeButton
              icon="external"
              onClick={onReturnToStudy}
              title="Return to the study platform (opens in your browser)"
              iconOnly={studyIconOnly}
              aria-label="Study platform"
            >
              Study platform
            </ChromeButton>
          </>
        )}
      </div>
    </div>
  )
})

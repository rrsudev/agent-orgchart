'use client'

import { useState } from 'react'
import { COLORS } from '@/lib/colors'
import { CloseButton } from './shared-ui'
import { ChromeButton } from './chrome'
import { CenteredModal } from './study-session-dialogs'
import { formatClock, type ArchivedStudySession, type SummaryAction } from '@/lib/study-session-types'

interface StudySessionArchiveProps {
  open: boolean
  onClose: () => void
  /** Newest-first. */
  archive: ArchivedStudySession[]
  onReplay: (id: string) => void
  onDelete: (id: string) => void
}

function timeOfDay(iso: string): string {
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

const ACTION_COLOR: Record<SummaryAction['kind'], string> = {
  prompt: COLORS.roleUserText,
  spawn: COLORS.holoBright,
  tool: COLORS.tool,
  permission: COLORS.paused,
  error: COLORS.error,
}

function ActionRow({ action }: { action: SummaryAction }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      {/* The two leading columns are sized in `em`, not pixels: they hold a
          clock and a fixed vocabulary of kinds, so they have to grow with the
          type scale instead of clipping "PERMISSION" at a magic 64px. */}
      <span className="ui-num shrink-0" style={{ color: COLORS.textFaint, minWidth: '3.6em' }}>
        {formatClock(action.at * 1000)}
      </span>
      <span className="shrink-0 uppercase ui-2xs mt-0.5" style={{ color: ACTION_COLOR[action.kind], minWidth: '6.5em' }}>
        {action.kind}
      </span>
      <span className="min-w-0 break-words" style={{ color: COLORS.textDim }}>{action.label}</span>
    </div>
  )
}

function SessionCard({ session, onReplay, onDelete }: {
  session: ArchivedStudySession
  onReplay: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { summary } = session
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: COLORS.holoBg03, border: `1px solid ${COLORS.holoBorder06}` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold ui-sm" style={{ color: COLORS.textPrimary }}>
          Session {session.number}
        </span>
        <span className="ui-num ui-sm" style={{ color: COLORS.holoBright }}>
          {formatClock(session.durationMs)}
        </span>
        <span
          className="ui-2xs px-1.5 py-0.5 rounded whitespace-nowrap"
          title={session.protocolReached ? 'Met the 15-minute minimum' : 'Under the 15-minute minimum'}
          style={{ color: session.protocolReached ? COLORS.complete : COLORS.textMuted, border: `1px solid ${COLORS.holoBorder06}` }}
        >
          {/* Was "15m ✓" — the check codepoint rendered at its own size/color.
              The state reads from the word and the color instead. */}
          {session.protocolReached ? '15m met' : '< 15m'}
        </span>
        <span className="flex-1" />
        <span className="ui-2xs ui-num" style={{ color: COLORS.textMuted }}>{timeOfDay(session.startedAtISO)}</span>
      </div>

      <div className="mt-1.5 ui-xs flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: COLORS.textMuted }}>
        <span>{summary.agentSessionIds.length} tab{summary.agentSessionIds.length === 1 ? '' : 's'}</span>
        <span>{summary.eventCount} event{summary.eventCount === 1 ? '' : 's'}{summary.droppedEvents > 0 ? ` (+${summary.droppedEvents} older dropped)` : ''}</span>
        {session.endedReason && session.endedReason !== 'user-ended' && (
          <span style={{ color: COLORS.textFaint }}>· {session.endedReason}</span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <ChromeButton
          onClick={() => onReplay(session.id)}
          disabled={!session.hasRecording}
          title={session.hasRecording ? 'Replay this session in the visualizer' : 'No recording was kept for this session'}
          tone={session.hasRecording ? 'accent' : 'neutral'}
          size="sm"
          icon="play"
        >
          Replay
        </ChromeButton>
        {summary.actions.length > 0 && (
          <ChromeButton
            onClick={() => setExpanded(e => !e)}
            tone="neutral"
            size="sm"
            icon={expanded ? 'chevronDown' : 'chevronRight'}
            aria-expanded={expanded}
            title={expanded ? 'Hide the recorded steps' : 'Show the recorded steps'}
          >
            {expanded ? 'Hide steps' : `Steps (${summary.actions.length})`}
          </ChromeButton>
        )}
        <span className="flex-1" />
        <ChromeButton
          onClick={() => onDelete(session.id)}
          title="Remove this session from the archive"
          tone="ghost"
          size="sm"
        >
          Delete
        </ChromeButton>
      </div>

      {expanded && summary.actions.length > 0 && (
        <div
          className="panel-scroll mt-2 pt-2 ui-2xs"
          style={{ borderTop: `1px solid ${COLORS.holoBorder06}`, maxHeight: 220 }}
        >
          {summary.actions.map((a, i) => <ActionRow key={i} action={a} />)}
        </div>
      )}
    </div>
  )
}

export function StudySessionArchive({ open, onClose, archive, onReplay, onDelete }: StudySessionArchiveProps) {
  if (!open) return null
  return (
    <CenteredModal onClose={onClose} maxWidth={660}>
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="ui-md font-semibold truncate" style={{ color: COLORS.textPrimary }}>
          Study sessions
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="ui-xs mb-3 shrink-0" style={{ color: COLORS.textMuted }}>
        Sessions you&apos;ve ended, newest first. Replay one to retrace your steps.
      </div>

      {archive.length === 0 ? (
        <div className="ui-sm py-8 text-center shrink-0" style={{ color: COLORS.textFaint }}>
          No ended sessions yet. End a session to archive it here.
        </div>
      ) : (
        // The list takes whatever the modal's measured height budget leaves.
        // `60vh` was the wrong unit inside a webview — the viewport is the
        // iframe, not the surface, so the list ran past the card on a short one.
        <div className="panel-scroll flex flex-col gap-2 flex-auto min-h-0">
          {archive.map(s => (
            <SessionCard key={s.id} session={s} onReplay={onReplay} onDelete={onDelete} />
          ))}
        </div>
      )}
    </CenteredModal>
  )
}

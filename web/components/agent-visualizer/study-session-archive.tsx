'use client'

import { useState } from 'react'
import { COLORS } from '@/lib/colors'
import { CloseButton } from './shared-ui'
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
      <span className="tabular-nums shrink-0" style={{ color: COLORS.textFaint, width: 44 }}>
        {formatClock(action.at * 1000)}
      </span>
      <span className="shrink-0 uppercase text-[9px] mt-0.5" style={{ color: ACTION_COLOR[action.kind], width: 64 }}>
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
        <span className="font-semibold text-[13px]" style={{ color: COLORS.textPrimary }}>
          Session {session.number}
        </span>
        <span className="tabular-nums text-[13px]" style={{ color: COLORS.holoBright }}>
          {formatClock(session.durationMs)}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          title={session.protocolReached ? 'Met the 15-minute minimum' : 'Under the 15-minute minimum'}
          style={{ color: session.protocolReached ? COLORS.complete : COLORS.textMuted, border: `1px solid ${COLORS.holoBorder06}` }}
        >
          {session.protocolReached ? '15m ✓' : '< 15m'}
        </span>
        <span className="flex-1" />
        <span className="text-[11px]" style={{ color: COLORS.textMuted }}>{timeOfDay(session.startedAtISO)}</span>
      </div>

      <div className="mt-1.5 text-[11px] flex items-center gap-3" style={{ color: COLORS.textMuted }}>
        <span>{summary.agentSessionIds.length} tab{summary.agentSessionIds.length === 1 ? '' : 's'}</span>
        <span>{summary.eventCount} event{summary.eventCount === 1 ? '' : 's'}{summary.droppedEvents > 0 ? ` (+${summary.droppedEvents} older dropped)` : ''}</span>
        {session.endedReason && session.endedReason !== 'user-ended' && (
          <span style={{ color: COLORS.textFaint }}>· {session.endedReason}</span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => onReplay(session.id)}
          disabled={!session.hasRecording}
          title={session.hasRecording ? 'Replay this session in the visualizer' : 'No recording was kept for this session'}
          className="px-2.5 py-1 rounded text-[12px] transition-all"
          style={{
            background: session.hasRecording ? COLORS.toggleActive : COLORS.toggleInactive,
            border: `1px solid ${session.hasRecording ? COLORS.holoBright : COLORS.toggleBorder}`,
            color: session.hasRecording ? COLORS.holoBright : COLORS.textFaint,
            cursor: session.hasRecording ? 'pointer' : 'not-allowed',
            opacity: session.hasRecording ? 1 : 0.6,
          }}
        >
          ▶ Replay
        </button>
        {summary.actions.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="px-2.5 py-1 rounded text-[12px] transition-all"
            style={{ background: COLORS.toggleInactive, border: `1px solid ${COLORS.toggleBorder}`, color: COLORS.textDim }}
          >
            {expanded ? '▾ Hide steps' : `▸ Steps (${summary.actions.length})`}
          </button>
        )}
        <span className="flex-1" />
        <button
          onClick={() => onDelete(session.id)}
          title="Remove this session from the archive"
          className="px-2 py-1 rounded text-[12px] transition-colors hover:opacity-100"
          style={{ color: COLORS.textFaint, opacity: 0.7 }}
        >
          Delete
        </button>
      </div>

      {expanded && summary.actions.length > 0 && (
        <div
          className="mt-2 pt-2 text-[11px] font-mono overflow-auto"
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
      <div className="flex items-center justify-between mb-1">
        <div className="text-[15px] font-semibold font-mono" style={{ color: COLORS.textPrimary }}>
          Study sessions
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="text-[12px] font-mono mb-3" style={{ color: COLORS.textMuted }}>
        Sessions you&apos;ve ended, newest first. Replay one to retrace your steps.
      </div>

      {archive.length === 0 ? (
        <div className="text-[13px] font-mono py-8 text-center" style={{ color: COLORS.textFaint }}>
          No ended sessions yet. End a session to archive it here.
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto" style={{ maxHeight: '60vh' }}>
          {archive.map(s => (
            <SessionCard key={s.id} session={s} onReplay={onReplay} onDelete={onDelete} />
          ))}
        </div>
      )}
    </CenteredModal>
  )
}

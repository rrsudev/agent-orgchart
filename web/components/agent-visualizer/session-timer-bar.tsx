'use client'

import { useEffect, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { useLayout } from '@/lib/layout'
import { ChromeButton, StatusDot } from './chrome'
import {
  formatClock, elapsedMsAt, PROTOCOL_MINIMUM_MS,
  type CurrentStudySession,
} from '@/lib/study-session-types'

/**
 * The participant's session clock + controls, as one pill in the bottom dock's
 * center slot. Owns its own 1s tick so only this pill re-renders each second.
 * Shown in live view only; the replay scrubber takes the same slot during replay
 * (they never coexist).
 *
 * The clock is the anchor — it is the largest thing in the pill and the only
 * element that never collapses. Everything to its right sheds, in order: the
 * session ordinal, then the protocol label, then the button labels. That keeps
 * the pill inside a 360px side bar, where the old fixed row of three emoji
 * buttons overhung both edges and clipped the clock itself.
 */
export function SessionTimerBar({ session, onPause, onResume, onEnd, onOpenArchive, archiveCount }: {
  session: CurrentStudySession
  onPause: () => void
  onResume: () => void
  onEnd: () => void
  onOpenArchive: () => void
  archiveCount: number
}) {
  const { narrow, compact } = useLayout()
  const running = session.status === 'running'
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick(t => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [running, session.id])

  const elapsedMs = elapsedMsAt(session, Date.now())
  const protocolMet = session.protocolReached || elapsedMs >= PROTOCOL_MINIMUM_MS
  const dotColor = running ? COLORS.complete : COLORS.paused
  const iconOnly = compact

  return (
    <div
      className="glass-card is-dense flex items-center"
      style={{ gap: narrow ? 6 : 10, color: COLORS.textMuted, paddingInline: 12 }}
    >
      <StatusDot color={dotColor} pulse={running} size={8} />

      <span
        className="ui-md ui-num font-semibold tracking-tight"
        style={{ color: running ? COLORS.textPrimary : COLORS.paused }}
        title={running ? 'Session time (recording)' : 'Session paused — the clock is stopped'}
      >
        {formatClock(elapsedMs)}
      </span>

      {/* Session ordinal + protocol status read as one dim meta group beside the
          clock rather than as two more chips competing with it. */}
      {!narrow && (
        <span className="ui-xs flex items-center gap-1.5 shrink-0" style={{ color: COLORS.textMuted }}>
          <span>Session {session.number}</span>
          <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
          <span
            style={{ color: protocolMet ? COLORS.complete : COLORS.textFaint }}
            title={protocolMet
              ? 'You have met the 15-minute session minimum.'
              : 'Study protocol: each session should run at least 15 minutes of active time.'}
          >
            {protocolMet ? '15m met' : '15m min'}
          </span>
        </span>
      )}

      {!running && (
        <span className="ui-2xs uppercase tracking-wide shrink-0" style={{ color: COLORS.paused }}>Paused</span>
      )}

      <span aria-hidden="true" className="shrink-0" style={{ width: 1, height: 16, background: COLORS.panelSeparator }} />

      {running
        ? (
          <ChromeButton size="sm" icon="pause" iconOnly={iconOnly} onClick={onPause}
            aria-label="Pause the session clock"
            title="Pause the session clock (agents keep working)">
            Pause
          </ChromeButton>
        ) : (
          <ChromeButton size="sm" tone="accent" icon="play" iconOnly={iconOnly} onClick={onResume}
            aria-label="Resume the session clock"
            title="Resume the session clock">
            Resume
          </ChromeButton>
        )}

      <ChromeButton size="sm" icon="stop" iconOnly={iconOnly} onClick={onEnd}
        aria-label="End this session"
        title="End this session and start a new one (resets the clock)">
        End
      </ChromeButton>

      <ChromeButton size="sm" icon="archive" iconOnly={iconOnly && archiveCount === 0} onClick={onOpenArchive}
        aria-label={`Past sessions${archiveCount > 0 ? ` (${archiveCount})` : ''}`}
        title="View past sessions (retrace your steps)">
        {iconOnly
          ? (archiveCount > 0 ? <span className="ui-num">{archiveCount}</span> : null)
          : <>Sessions{archiveCount > 0 ? <span className="ui-num"> ({archiveCount})</span> : null}</>}
      </ChromeButton>
    </div>
  )
}

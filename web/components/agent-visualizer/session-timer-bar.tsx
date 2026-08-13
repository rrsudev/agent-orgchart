'use client'

import { useEffect, useState } from 'react'
import { Z } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import {
  formatClock, elapsedMsAt, PROTOCOL_MINIMUM_MS,
  type CurrentStudySession,
} from '@/lib/study-session-types'

// The participant's session clock + controls, as a refined glass pill centered
// at the bottom of the screen. Owns its own 1s tick so only this pill re-renders
// each second. Shown in live view only; the replay scrubber takes the same spot
// during replay (they never coexist).

function SessionBtn({ onClick, title, children, accent }: {
  onClick: () => void
  title: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 rounded text-[13px] transition-all hover:scale-[1.03]"
      style={{
        background: accent ? COLORS.toggleActive : COLORS.toggleInactive,
        border: `1px solid ${accent ? COLORS.holoBright : COLORS.toggleBorder}`,
        color: accent ? COLORS.holoBright : COLORS.textDim,
      }}
    >
      {children}
    </button>
  )
}

export function SessionTimerBar({ session, onPause, onResume, onEnd, onOpenArchive, archiveCount }: {
  session: CurrentStudySession
  onPause: () => void
  onResume: () => void
  onEnd: () => void
  onOpenArchive: () => void
  archiveCount: number
}) {
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

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[13px]"
      style={{ zIndex: Z.controlBar, pointerEvents: 'auto' }}
    >
      <div className="glass-card flex items-center gap-3 px-4 py-2" style={{ color: COLORS.textMuted }}>
        {/* status dot + session clock */}
        <span
          className={`w-2.5 h-2.5 rounded-full ${running ? 'animate-pulse' : ''}`}
          style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
          aria-hidden="true"
        />
        <span
          className="tabular-nums font-semibold tracking-wide"
          style={{ color: running ? COLORS.textPrimary : COLORS.paused, minWidth: 48 }}
          title={running ? 'Session time (recording)' : 'Session paused — the clock is stopped'}
        >
          {formatClock(elapsedMs)}
        </span>
        <span style={{ color: COLORS.textMuted }}>Session {session.number}</span>
        {!running && <span className="text-[11px]" style={{ color: COLORS.paused }}>PAUSED</span>}

        {/* 15-minute protocol status */}
        <span
          className="text-[11px] px-1.5 py-0.5 rounded"
          title={protocolMet
            ? 'You have met the 15-minute session minimum.'
            : 'Study protocol: each session should run at least 15 minutes of active time.'}
          style={{
            color: protocolMet ? COLORS.complete : COLORS.textFaint,
            background: protocolMet ? COLORS.holoBg05 : 'transparent',
            border: `1px solid ${protocolMet ? COLORS.holoBorder08 : 'transparent'}`,
          }}
        >
          {protocolMet ? '15m ✓' : '15m min'}
        </span>

        <span className="w-px self-stretch" style={{ background: COLORS.panelSeparator }} />

        {/* controls */}
        {running
          ? <SessionBtn onClick={onPause} title="Pause the session clock (agents keep working)">⏸ Pause</SessionBtn>
          : <SessionBtn onClick={onResume} title="Resume the session clock" accent>▶ Resume</SessionBtn>}
        <SessionBtn onClick={onEnd} title="End this session and start a new one (resets the clock)">⏹ End</SessionBtn>
        <SessionBtn onClick={onOpenArchive} title="View past sessions (retrace your steps)">
          🗂 Sessions{archiveCount > 0 ? ` (${archiveCount})` : ''}
        </SessionBtn>
      </div>
    </div>
  )
}

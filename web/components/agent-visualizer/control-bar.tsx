'use client'

import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { TimelineEvent, POPUP, TIMING } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { useLayout } from '@/lib/layout'
import { ChromeButton, Icon, StatusDot } from './chrome'

interface ControlBarProps {
  isPlaying: boolean
  speed: number
  currentTime: number
  totalDuration: number
  onPlayPause: () => void
  onRestart: () => void
  onSpeedChange: (speed: number) => void
  onSeek?: (time: number) => void
  timelineEvents: TimelineEvent[]
  isReviewing?: boolean
  eventCount?: number
  onResumeLive?: () => void
  onEnterReview?: () => void
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getEventColor(type: TimelineEvent['type']): string {
  switch (type) {
    case 'thinking': return COLORS.thinking
    case 'tool_call': return COLORS.tool
    case 'tool_result': return COLORS.return
    case 'message': return COLORS.message
    case 'error': return COLORS.error
    default: return COLORS.idle
  }
}

/** Max event marker dots rendered on the scrubber (prevents DOM bloat) */
const MAX_SCRUBBER_DOTS = 120

/** Shared event marker dots on the scrubber track.
 *  Memoized to avoid re-rendering every frame when only currentTime changes in the parent. */
const EventMarkers = memo(function EventMarkers({ events, totalDuration, className = '' }: {
  events: TimelineEvent[]
  totalDuration: number
  className?: string
  /** Pass events.length to bust memo when array is mutated in place */
  eventCount?: number
}) {
  // Down-sample to MAX_SCRUBBER_DOTS evenly spaced events when list is large
  const visible = events.length > MAX_SCRUBBER_DOTS
    ? Array.from({ length: MAX_SCRUBBER_DOTS }, (_, i) => events[Math.floor(i * events.length / MAX_SCRUBBER_DOTS)])
    : events
  // Position dots relative to the last event so they always span the full bar,
  // rather than compressing into a fraction when currentTime runs ahead of events
  const lastEventTime = events.length > 0 ? events[events.length - 1].timestamp : 0
  const effectiveDuration = lastEventTime > 0 ? lastEventTime : totalDuration
  return (
    <>
      {visible.map((event) => {
        const pos = effectiveDuration > 0 ? (event.timestamp / effectiveDuration) * 100 : 0
        if (pos < 0 || pos > 100) return null
        return (
          <div
            key={event.id}
            className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${className}`}
            style={{ left: `${pos}%`, background: getEventColor(event.type) }}
          />
        )
      })}
    </>
  )
})

/** Hook to cache the full set of timeline events (dots don't disappear when seeking backward) */
function useScrubberEvents(timelineEvents: TimelineEvent[], totalDuration: number) {
  const fullEventsRef = useRef<TimelineEvent[]>([])
  if (timelineEvents.length === 0 && totalDuration < 0.1) {
    fullEventsRef.current = []
  } else if (timelineEvents.length >= fullEventsRef.current.length) {
    fullEventsRef.current = timelineEvents
  }
  return fullEventsRef.current
}

/**
 * The transport bar. It no longer positions itself — the bottom dock places it
 * in the same center slot the live session timer uses (the two never coexist),
 * which is what keeps them from stacking on a narrow surface. It only decides
 * how wide it wants to be, clamped to the measured surface.
 */
export function ControlBar(props: ControlBarProps) {
  const { isReviewing = false } = props
  return isReviewing ? <ReviewControlBar {...props} /> : <LiveControlBar {...props} />
}

/** Shared shell: one dense glass card that fills the dock's centre slot.
 *
 *  `width: 100%` of the slot rather than a width derived from the surface — the
 *  dock's left slot (the legend launcher) and its gaps have already taken their
 *  share by the time this renders, so sizing against the full surface made the
 *  bar overhang the right edge on every mid-width window. */
function BarShell({ children }: { children: React.ReactNode }) {
  const layout = useLayout()
  return (
    <div
      className="glass-card is-dense flex items-center min-w-0"
      style={{
        width: '100%',
        maxWidth: layout.panelWidth(POPUP.controlBarMaxWidth),
        gap: layout.narrow ? 6 : 10,
        paddingInline: 12,
      }}
    >
      {children}
    </div>
  )
}

// ─── Live Mode Control Bar ───────────────────────────────────────────────────

function LiveControlBar({
  currentTime, totalDuration, timelineEvents,
  eventCount = 0, onEnterReview, isReviewing,
}: ControlBarProps) {
  const { compact } = useLayout()
  const [pulseOn, setPulseOn] = useState(true)
  const scrubberEvents = useScrubberEvents(timelineEvents, totalDuration)

  useEffect(() => {
    if (isReviewing) return
    const interval = setInterval(() => setPulseOn(p => !p), TIMING.livePulseMs)
    return () => clearInterval(interval)
  }, [isReviewing])

  return (
    <BarShell>
      {/* LIVE badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="w-2 h-2 rounded-full transition-opacity duration-500"
          style={{
            background: COLORS.liveDot,
            boxShadow: pulseOn ? `0 0 10px ${COLORS.liveDot}` : `0 0 5px ${COLORS.liveDot}80`,
            opacity: pulseOn ? 1 : 0.6,
          }}
        />
        {!compact && (
          <span className="ui-xs font-semibold tracking-wider" style={{ color: COLORS.liveText }}>LIVE</span>
        )}
      </div>

      <span className="ui-sm ui-num shrink-0" style={{ color: COLORS.textPrimary }}>
        {formatTime(currentTime)}
      </span>

      {/* Read-only event track */}
      <div className="flex-1 min-w-0 relative h-5 flex items-center">
        <div className="w-full rounded-full relative" style={{ height: 3, background: COLORS.holoBg10 }}>
          <EventMarkers events={scrubberEvents} totalDuration={totalDuration} eventCount={scrubberEvents.length} className="opacity-80" />
        </div>
      </div>

      <span className="ui-xs ui-num shrink-0" style={{ color: COLORS.textMuted }} title={`${eventCount} events`}>
        {eventCount}
      </span>

      <ChromeButton size="sm" icon="pause" iconOnly={compact} onClick={onEnterReview} aria-label="Review" title="Pause and scrub back through this session">
        Review
      </ChromeButton>
    </BarShell>
  )
}

// ─── Review Mode Control Bar ─────────────────────────────────────────────────

const SPEEDS = [0.5, 1, 2, 4] as const

function ReviewControlBar({
  isPlaying, speed, currentTime, totalDuration,
  onPlayPause, onRestart, onSpeedChange, onSeek,
  timelineEvents, isReviewing, onResumeLive,
}: ControlBarProps) {
  const { compact, narrow } = useLayout()
  const scrubberRef = useRef<HTMLDivElement>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const scrubberEvents = useScrubberEvents(timelineEvents, totalDuration)
  const progress = totalDuration > 0 ? currentTime / totalDuration : 0

  const scrubToClientX = useCallback((clientX: number) => {
    const rect = scrubberRef.current?.getBoundingClientRect()
    if (!rect || !onSeek) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onSeek(ratio * totalDuration)
  }, [onSeek, totalDuration])

  useEffect(() => {
    if (!isScrubbing) return
    const handleMove = (e: MouseEvent) => scrubToClientX(e.clientX)
    const handleUp = () => setIsScrubbing(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isScrubbing, scrubToClientX])

  return (
    <BarShell>
      {/* Play/Pause — sized to the standard control height so it sits on the
          same baseline as the buttons beside it instead of towering over them. */}
      <button
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Pause playback' : 'Play'}
        title={isPlaying ? 'Pause playback' : 'Play'}
        className="rounded-full flex items-center justify-center transition-transform shrink-0 hover:scale-105"
        style={{
          width: 'var(--ctl-h)',
          height: 'var(--ctl-h)',
          background: isPlaying ? COLORS.playBtnActiveBg : COLORS.playBtnBg,
          border: `1px solid ${COLORS.playBtnBorder}`,
          color: COLORS.textPrimary,
        }}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} size={13} />
      </button>

      <span className="ui-sm ui-num shrink-0" style={{ color: COLORS.textPrimary }}>
        {formatTime(currentTime)}
      </span>

      {/* Timeline scrubber */}
      <div
        ref={scrubberRef}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDuration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTime(currentTime)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!onSeek) return
          const step = e.shiftKey ? 10 : 1
          if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentTime - step)) }
          else if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(totalDuration, currentTime + step)) }
          else if (e.key === 'Home') { e.preventDefault(); onSeek(0) }
          else if (e.key === 'End') { e.preventDefault(); onSeek(totalDuration) }
        }}
        className="flex-1 min-w-0 relative h-6 flex items-center group cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault()
          setIsScrubbing(true)
          scrubToClientX(e.clientX)
        }}
      >
        <div
          className="w-full rounded-full relative transition-all duration-150 group-hover:h-2"
          style={{ height: isScrubbing ? 8 : 4, background: COLORS.glassBorder }}
        >
          {/* Progress fill */}
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${progress * 100}%`, background: COLORS.scrubberFill }}
          />
          <EventMarkers
            events={scrubberEvents}
            totalDuration={totalDuration}
            eventCount={scrubberEvents.length}
            className="opacity-60 group-hover:opacity-100 transition-opacity"
          />
        </div>

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-150"
          style={{
            left: `${progress * 100}%`,
            width: isScrubbing ? 14 : 11,
            height: isScrubbing ? 14 : 11,
            marginLeft: isScrubbing ? -7 : -5.5,
            background: COLORS.textPrimary,
            boxShadow: COLORS.scrubberHeadGlow,
          }}
        />
      </div>

      <span className="ui-xs ui-num shrink-0" style={{ color: COLORS.textMuted }}>
        {formatTime(totalDuration)}
      </span>

      {/* Speed — the first thing to go when the surface can't hold the row. */}
      {!narrow && (
        <div
          role="group"
          aria-label="Playback speed"
          className="flex items-center shrink-0"
          style={{ padding: 2, borderRadius: 8, background: COLORS.holoBg03 }}
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              aria-pressed={speed === s}
              title={`${s}× playback speed`}
              className="ui-2xs ui-num transition-colors"
              style={{
                height: 20,
                paddingInline: 6,
                borderRadius: 6,
                background: speed === s ? COLORS.playBtnActiveBg : 'transparent',
                color: speed === s ? COLORS.textPrimary : COLORS.textMuted,
                fontWeight: speed === s ? 600 : 500,
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      )}

      {isReviewing && (
        <>
          <ChromeButton
            size="sm"
            icon="play"
            iconOnly={compact}
            onClick={onResumeLive}
            aria-label="Return to live"
            title="Leave replay and return to the live session"
            style={{ background: COLORS.liveResumeBg, borderColor: COLORS.liveResumeBorder, color: COLORS.liveText }}
          >
            Live
          </ChromeButton>
          <ChromeButton size="sm" icon="restart" iconOnly onClick={onRestart} aria-label="Restart from the beginning" title="Restart from the beginning" />
        </>
      )}
    </BarShell>
  )
}

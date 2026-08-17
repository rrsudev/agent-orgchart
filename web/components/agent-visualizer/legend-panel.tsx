'use client'

import { type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { useLayout } from '@/lib/layout'
import { ChromeButton } from './chrome'
import { PanelHeader, stopPropagationHandlers } from './shared-ui'

interface LegendPanelProps {
  visible: boolean
  onClose: () => void
}

/** SF-Symbols-style white line glyph — mirrors the canvas state badge so the
 *  legend documents shape as well as color (state is never color-alone). */
function StateGlyph({ state }: { state: AgentState }) {
  const common = { fill: 'none', stroke: '#fff', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (state) {
    case 'complete':
      return <path d="M3 6.3 L5.2 8.5 L9 4" {...common} />
    case 'error':
      return <><path d="M6 3 V6.8" {...common} /><circle cx={6} cy={8.9} r={0.95} fill="#fff" /></>
    case 'waiting_permission':
      return <><rect x={3.2} y={5.7} width={5.6} height={4.1} rx={1.1} {...common} /><path d="M4.3 5.7 V4.9 a1.7 1.7 0 0 1 3.4 0 V5.7" {...common} /></>
    case 'tool_calling':
      return <path d="M9 6 A3 3 0 1 0 8.1 8.1" {...common} />
    case 'thinking':
      return <>{[-1, 0, 1].map(i => <circle key={i} cx={6 + i * 2.5} cy={6} r={0.95} fill="#fff" />)}</>
    case 'paused':
      return <><rect x={3.6} y={3.4} width={1.5} height={5.2} rx={0.5} fill="#fff" /><rect x={6.9} y={3.4} width={1.5} height={5.2} rx={0.5} fill="#fff" /></>
    default: // idle — ready dot
      return <circle cx={6} cy={6} r={1.7} fill="#fff" />
  }
}

/** Colored squircle chip carrying the state color + white glyph. */
function StateChip({ state }: { state: AgentState }) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: 18, height: 18, borderRadius: 6, background: getStateColor(state) }}
    >
      <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true"><StateGlyph state={state} /></svg>
    </span>
  )
}

// Driven entirely off getStateColor/COLORS so swatches can never drift from the
// live render.
const STATES: { state: AgentState; label: string; shape: string }[] = [
  { state: 'idle', label: 'Idle', shape: 'ready' },
  { state: 'thinking', label: 'Thinking', shape: 'reasoning' },
  { state: 'tool_calling', label: 'Tool call', shape: 'running' },
  { state: 'waiting_permission', label: 'Awaiting permission', shape: 'blocked' },
  { state: 'complete', label: 'Complete', shape: 'dashed border' },
  { state: 'error', label: 'Error', shape: 'heavier border' },
  { state: 'paused', label: 'Paused', shape: 'held' },
]

const EDGES: { color: string; label: string }[] = [
  { color: COLORS.dispatch, label: 'Dispatch (parent → child)' },
  { color: COLORS.return, label: 'Return (child → parent)' },
  { color: COLORS.tool, label: 'Tool call' },
  { color: COLORS.message, label: 'Message' },
]

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 py-0.5">{children}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-xs font-semibold mt-2 mb-1" style={{ color: COLORS.panelLabel, letterSpacing: '-0.01em' }}>
      {children}
    </div>
  )
}

/** The dock button that opens the legend. Lives in the bottom dock's left slot
 *  rather than positioning itself, so it can never land on top of the timer. */
export function LegendLauncher({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  const { narrow } = useLayout()
  return (
    <ChromeButton
      icon="info"
      onClick={onOpen}
      iconOnly={narrow}
      aria-label="Show legend"
      aria-expanded={active}
      title="Show the legend — what each node shape, color, and edge means"
      style={{ visibility: active ? 'hidden' : 'visible' }}
    >
      Legend
    </ChromeButton>
  )
}

/**
 * The legend itself. It sits at the foot of the left rail, which owns placement
 * and shrinks the card when the file panel above it is also open — the old
 * version pinned itself to the bottom-left corner at its natural height and, on
 * a short surface, ran straight up over whatever was above it.
 */
export function LegendPanel({ visible, onClose }: LegendPanelProps) {
  const layout = useLayout()
  if (!visible) return null

  return (
    <div
      {...stopPropagationHandlers}
      className="flex flex-col min-h-0"
      style={{ maxHeight: layout.panelHeight() }}
    >
      <div className="glass-card is-dense flex flex-col min-h-0">
        <PanelHeader onClose={onClose}>
          <span className="ui-sm font-semibold" style={{ color: COLORS.textPrimary, letterSpacing: '-0.01em' }}>
            Legend
          </span>
        </PanelHeader>

        <div className="panel-scroll min-h-0 ui-xs" style={{ color: COLORS.textDim }}>
          <SectionLabel>Agent state</SectionLabel>
          {STATES.map(({ state, label, shape }) => (
            <Row key={state}>
              <StateChip state={state} />
              <span className="flex-1 min-w-0" style={{ color: COLORS.textPrimary }}>{label}</span>
              <span className="ui-2xs shrink-0" style={{ color: COLORS.textMuted }}>{shape}</span>
            </Row>
          ))}

          <SectionLabel>Node</SectionLabel>
          <Row>
            <span className="inline-flex shrink-0 items-center justify-center" style={{ width: 18, height: 18 }}>
              <span style={{ width: 15, height: 15, borderRadius: 6, background: '#fff', border: `1.25px solid ${COLORS.idle}` }} />
            </span>
            <span style={{ color: COLORS.textPrimary }}>Main agent (square, branded)</span>
          </Row>
          <Row>
            <span className="inline-flex shrink-0 items-center justify-center" style={{ width: 18, height: 18 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', border: `1.25px solid ${COLORS.idle}` }} />
            </span>
            <span style={{ color: COLORS.textPrimary }}>Sub-agent (round, color-coded)</span>
          </Row>

          <SectionLabel>Connections</SectionLabel>
          {EDGES.map(({ color, label }) => (
            <Row key={label}>
              <span className="inline-flex shrink-0 items-center justify-center" style={{ width: 18, height: 18 }}>
                <span style={{ width: 16, height: 0, borderTop: `2px solid ${color}`, borderRadius: 2 }} />
              </span>
              <span style={{ color: COLORS.textPrimary }}>{label}</span>
            </Row>
          ))}
        </div>
      </div>
    </div>
  )
}

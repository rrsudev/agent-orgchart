import {
  type Agent,
  type TimelineEntry,
  emptyContextBreakdown,
} from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { AGENT_SPAWN_DISTANCE } from '@/lib/canvas-constants'
import { subagentCallSign } from '@/lib/callsigns'
import { AGENT_KEY_SEP } from '@/hooks/use-agent-colors'
import { pushTimelineBlock, type ProcessEventContext, type MutableEventState } from './process-event'
import { edgeId, asString, asBoolean } from './types'

/** Session prefix of a namespaced agent id (parallel view), or null in a
 *  single-session view where ids aren't namespaced. */
function sessionPrefix(id: string): string | null {
  return id.includes(AGENT_KEY_SEP) ? id.split(AGENT_KEY_SEP)[0] : null
}

/** Neutral, non-prescriptive node label for a subagent: a per-session call-sign
 *  folded with a fixed "Subagent" role — "Guava · Subagent". The internal agent
 *  type ("Explore", "General Purpose", …) is intentionally NOT shown here (it read
 *  as prescriptive and leaked harness terms); it's still carried on `agent.task` /
 *  the detail card. The index is this subagent's spawn order within its session
 *  (count of subagents already present), so names stay distinct and replay-stable.
 *  The live activity ("guava is …") rides the status line under this label. */
function subagentNodeName(id: string, agents: MutableEventState['agents']): string {
  const sid = sessionPrefix(id)
  let index = 0
  for (const a of agents.values()) {
    if (!a.isMain && sessionPrefix(a.id) === sid) index++
  }
  const callSign = subagentCallSign(index)
  return `${callSign} · Subagent`
}

export function handleAgentSpawn(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const name = asString(payload.name)
  // Identity (`name`) may be session-namespaced in the parallel view. Main agents
  // read from `displayName`; subagents get a neutral call-sign label built below.
  const displayName = asString(payload.displayName, name)
  const parentId = typeof payload.parent === 'string' ? payload.parent : undefined
  const isMain = asBoolean(payload.isMain)
  const agentType = typeof payload.agentType === 'string' ? payload.agentType : undefined
  const task = typeof payload.task === 'string' ? payload.task : undefined
  const model = typeof payload.model === 'string' ? payload.model : undefined
  const runtime = payload.runtime === 'codex' ? 'codex' as const : undefined

  // If the agent already exists (e.g. session resuming after inactivity),
  // reactivate it instead of replacing — preserves accumulated stats.
  const existing = state.agents.get(name)
  if (existing) {
    state.agents.set(name, {
      ...existing,
      state: 'idle',
      ...(task ? { task } : {}),
      ...(model ? { model, tokensMax: ctx.getContextWindowSize(model) } : {}),
      ...(runtime ? { runtime } : {}),
    })
    return
  }

  let x = 0, y = 0
  if (!parentId) {
    // Parentless root (orchestrator). The parallel view injects a distinct
    // spawn position so orchestrators from different sessions don't overlap;
    // in single-session views these are absent and it stays centered at 0,0.
    if (typeof payload.spawnX === 'number') x = payload.spawnX
    if (typeof payload.spawnY === 'number') y = payload.spawnY
  }
  if (parentId) {
    const parent = state.agents.get(parentId)
    if (parent) {
      // Collect angles of existing siblings so we can avoid spawning too close
      const siblingAngles: number[] = []
      for (const a of state.agents.values()) {
        if (a.parentId === parentId && a.id !== name) {
          siblingAngles.push(Math.atan2(a.y - parent.y, a.x - parent.x))
        }
      }

      let angle: number
      if (siblingAngles.length === 0) {
        // First child: use hash-based angle
        const hash = name.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
        angle = (Math.abs(hash) % 360) * (Math.PI / 180)
      } else {
        // Find the largest angular gap between existing siblings and place in the middle
        siblingAngles.sort((a, b) => a - b)
        let bestGap = 0
        let bestMid = 0
        for (let i = 0; i < siblingAngles.length; i++) {
          const next = i + 1 < siblingAngles.length ? siblingAngles[i + 1] : siblingAngles[0] + Math.PI * 2
          const gap = next - siblingAngles[i]
          if (gap > bestGap) {
            bestGap = gap
            bestMid = siblingAngles[i] + gap / 2
          }
        }
        angle = bestMid
      }

      x = parent.x + Math.cos(angle) * AGENT_SPAWN_DISTANCE
      y = parent.y + Math.sin(angle) * AGENT_SPAWN_DISTANCE
    }
  }

  // Main agents keep the extension label (a session call-sign is layered on in
  // index.tsx); subagents get a neutral call-sign node label here at the source,
  // so every surface that reads `agent.name` (canvas, panels, feed) stays consistent.
  const resolvedName = isMain ? displayName : subagentNodeName(name, state.agents)

  const agent: Agent = {
    id: name, name: resolvedName, state: 'idle',
    parentId: parentId || null,
    tokensUsed: 0, tokensMax: ctx.getContextWindowSize(model),
    contextBreakdown: emptyContextBreakdown(),
    toolCalls: 0, timeAlive: 0,
    x, y, vx: 0, vy: 0,
    pinned: false, isMain,
    ...(runtime ? { runtime } : {}),
    ...(model ? { model } : {}),
    ...(agentType ? { agentType } : {}),
    task,
    spawnTime: currentTime,
    opacity: 0, scale: 0.3,
    messageBubbles: [],
  }
  state.agents.set(name, agent)

  if (parentId) {
    state.edges.push({ id: edgeId(parentId, name), from: parentId, to: name, type: 'parent-child', opacity: 0 })
  }

  const timelineEntry: TimelineEntry = {
    id: `timeline-${name}`,
    agentId: name,
    agentName: resolvedName,
    startTime: currentTime,
    blocks: [],
  }
  pushTimelineBlock(timelineEntry, currentTime, { type: 'idle', label: 'Starting', color: COLORS.idle }, ctx)
  state.timelineEntries.set(name, timelineEntry)

  state.conversations.set(name, [])

  if (!ctx.skipForceSync) {
    setTimeout(() => ctx.syncForceSimulation(state.agents, state.edges), 0)
  }
}

export function handleAgentComplete(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const name = asString(payload.name)
  const agent = state.agents.get(name)
  if (agent && agent.state !== 'complete') {
    state.agents.set(name, { ...agent, state: 'complete', completeTime: currentTime })

    const entry = state.timelineEntries.get(name)
    if (entry) {
      pushTimelineBlock(entry, currentTime, { type: 'complete', label: 'Done', color: COLORS.complete, endTime: currentTime }, ctx)
      entry.endTime = currentTime
    }

    const agentsToComplete = [name]
    for (const [childId, childAgent] of state.agents) {
      if (childAgent.parentId === name && childAgent.state !== 'complete') {
        state.agents.set(childId, { ...childAgent, state: 'complete', completeTime: currentTime })
        agentsToComplete.push(childId)
        const childEntry = state.timelineEntries.get(childId)
        if (childEntry) {
          pushTimelineBlock(childEntry, currentTime, { type: 'complete', label: 'Done', color: COLORS.complete, endTime: currentTime }, ctx)
          childEntry.endTime = currentTime
        }
      }
    }

    for (const [tcId, tc] of state.toolCalls) {
      if (agentsToComplete.includes(tc.agentId) && tc.state === 'running') {
        state.toolCalls.set(tcId, { ...tc, state: 'complete', completeTime: currentTime })
      }
    }
  }
}

export function handlePermissionRequested(
  payload: Record<string, unknown>,
  currentTime: number,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const agentName = asString(payload.agent, 'Orchestrator')
  const agent = state.agents.get(agentName)
  if (agent && agent.state !== 'complete') {
    state.agents.set(agentName, {
      ...agent,
      state: 'waiting_permission',
    })

    const entry = state.timelineEntries.get(agentName)
    if (entry) {
      pushTimelineBlock(entry, currentTime, { type: 'idle', label: 'Permission', color: COLORS.waiting_permission }, ctx)
    }
  }
}

export function handleAgentIdle(
  payload: Record<string, unknown>,
  state: MutableEventState,
): void {
  const idleName = asString(payload.name)
  const idleAgent = state.agents.get(idleName)
  if (idleAgent && (idleAgent.state === 'tool_calling' || idleAgent.state === 'waiting_permission')) {
    state.agents.set(idleName, { ...idleAgent, state: 'thinking', currentTool: undefined })
  }
}

export function handleModelDetected(
  payload: Record<string, unknown>,
  state: MutableEventState,
  ctx: ProcessEventContext,
): void {
  const agentName = asString(payload.agent)
  const model = asString(payload.model)
  const agent = state.agents.get(agentName)
  if (agent) {
    state.agents.set(agentName, {
      ...agent,
      model,
      tokensMax: ctx.getContextWindowSize(model),
    })
  }
}

/** Live, human-readable activity clause for an agent — the "guava is …" status
 *  line under the node label. The extension produces a short lowercase clause
 *  ("debugging server-side auth errors"); the call-sign prefix is added at render
 *  time (index.tsx) since only the web side knows the assigned call-sign. */
export function handleAgentStatus(
  payload: Record<string, unknown>,
  state: MutableEventState,
): void {
  const agentName = asString(payload.agent)
  const status = asString(payload.status).trim()
  const agent = state.agents.get(agentName)
  if (agent && agent.state !== 'complete') {
    state.agents.set(agentName, {
      ...agent,
      statusLine: status || undefined,
    })
  }
}

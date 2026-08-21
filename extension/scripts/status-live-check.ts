/**
 * Live smoke-test for the status summarizer.
 *
 *   pnpm run test:status-live                      # deterministic (offline) path
 *   OPENROUTER_API_KEY=sk-or-... pnpm run test:status-live   # real OpenRouter call
 *   OPENROUTER_API_KEY=sk-or-... STATUS_MODEL=google/gemini-2.5-flash-lite pnpm run test:status-live
 *
 * Runs the REAL StatusSummarizer over a realistic event stream and prints the
 * status clause each agent gets — so you can confirm your key, model, endpoint,
 * and prompt all produce sensible phrasing WITHOUT launching VS Code.
 */
import {
  StatusSummarizer,
  deterministicStatus,
  DEFAULT_STATUS_MODEL,
} from '../src/status-summarizer'
import type { AgentEvent } from '../src/protocol'
import { subagentCallSign } from '../../web/lib/callsigns'

const STREAM: AgentEvent[] = [
  { time: 0, type: 'agent_spawn', payload: { name: 'orchestrator', isMain: true, task: 'Refactor the payment system to add Stripe + PayPal' } },
  { time: 1, type: 'tool_call_start', payload: { agent: 'orchestrator', tool: 'Read', args: 'services/payment.ts' } },
  { time: 2, type: 'tool_call_start', payload: { agent: 'orchestrator', tool: 'TodoWrite', args: 'Researching Stripe & PayPal APIs (1/8)' } },
  { time: 3, type: 'agent_spawn', payload: { name: 'explore-agent', parent: 'orchestrator', agentType: 'Explore', task: 'analyze payment flow' } },
  { time: 4, type: 'tool_call_start', payload: { agent: 'explore-agent', tool: 'Grep', args: 'catch|error|throw' } },
  { time: 5, type: 'agent_spawn', payload: { name: 'build-agent', parent: 'orchestrator', agentType: 'General Purpose', task: 'implement adapters' } },
  { time: 6, type: 'tool_call_start', payload: { agent: 'build-agent', tool: 'Edit', args: 'services/stripe-adapter.ts — edit' } },
  { time: 7, type: 'tool_call_start', payload: { agent: 'build-agent', tool: 'Bash', args: 'npm test -- payments' } },
]

async function main() {
  const key = process.env.OPENROUTER_API_KEY
  const model = process.env.STATUS_MODEL || DEFAULT_STATUS_MODEL

  const perAgent = new Map<string, { tool: string; summary: string }[]>()
  const tasks = new Map<string, string>()
  for (const e of STREAM) {
    if (e.type === 'agent_spawn') tasks.set(String(e.payload.name), String(e.payload.task ?? ''))
    if (e.type === 'tool_call_start') {
      const id = String(e.payload.agent)
      const arr = perAgent.get(id) ?? []
      arr.push({ tool: String(e.payload.tool), summary: String(e.payload.args) })
      perAgent.set(id, arr)
    }
  }

  console.log(`\nmodel: ${model}`)
  console.log(key ? 'mode : LIVE OpenRouter call\n' : 'mode : deterministic fallback (set OPENROUTER_API_KEY for a live call)\n')

  console.log('=== deterministic (offline) status ===')
  for (const [id, items] of perAgent) {
    console.log(`  ${id.padEnd(16)} → "${deterministicStatus({ items, task: tasks.get(id) })}"`)
  }

  console.log('\n=== StatusSummarizer emissions ===')
  const emitted: string[] = []
  const summ = new StatusSummarizer(
    { enabled: true, active: true, apiKey: key, model, now: () => 0 },
    (agent, status) => { emitted.push(`  ${agent.padEnd(16)} → "${status}"`) },
  )
  for (const e of STREAM) summ.observe(e)
  for (const id of perAgent.keys()) await summ.generateAndEmit(id)
  summ.dispose()
  for (const line of emitted) console.log(line)

  console.log('\n=== subagent labels (rename) ===')
  let idx = 0
  for (const e of STREAM) {
    if (e.type === 'agent_spawn' && !e.payload.isMain) {
      console.log(`  ${String(e.payload.name).padEnd(16)} (type "${e.payload.agentType}") → "${subagentCallSign(idx)} · Subagent"`)
      idx++
    }
  }
  console.log()
}

void main()

/**
 * Unit tests for the live status summarizer: deterministic fallback, clause
 * normalization, request-body privacy shape, and the throttle/emit behavior with
 * an injected fetch + clock.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  deterministicStatus,
  normalizeClause,
  buildRequestBody,
  eventAgentId,
  StatusSummarizer,
} from '../src/status-summarizer'
import type { AgentEvent } from '../src/protocol'

describe('deterministicStatus', () => {
  it('maps a file edit to an editing clause with a basename', () => {
    const s = deterministicStatus({ items: [{ tool: 'Edit', summary: 'src/canvas/draw-agents.ts — edit' }] })
    assert.equal(s, 'editing draw-agents.ts')
  })

  it('maps a Read to a reading clause', () => {
    assert.equal(deterministicStatus({ items: [{ tool: 'Read', summary: 'a/b/transcript-parser.ts' }] }), 'reading transcript-parser.ts')
  })

  it('uses the TodoWrite active step verbatim (count stripped, lowercased)', () => {
    const s = deterministicStatus({ items: [{ tool: 'TodoWrite', summary: 'Researching Stripe & PayPal APIs (2/8)' }] })
    assert.equal(s, 'researching Stripe & PayPal APIs')
  })

  it('trims a Bash command to a short running clause (no flags/paths/operators)', () => {
    const s = deterministicStatus({ items: [{ tool: 'Bash', summary: 'npm test -- --run some/long/path' }] })
    assert.equal(s, 'running npm test')
  })

  it('keeps deterministic status generic — no regex/pattern noise', () => {
    assert.equal(deterministicStatus({ items: [{ tool: 'Grep', summary: 'catch|error|throw' }] }), 'searching the code')
    assert.equal(deterministicStatus({ items: [{ tool: 'WebSearch', summary: 'Stripe PaymentIntents TypeScript 2026' }] }), 'searching the web')
  })

  it('caps deterministic status to the word budget', () => {
    const s = deterministicStatus({ items: [{ tool: 'TodoWrite', summary: 'Wiring up the OpenRouter status summarizer end to end (2/8)' }] })
    assert.ok(s !== null && s.split(' ').length <= 5, `expected <=5 words, got "${s}"`)
  })

  it('falls back to "starting up" with only a task and no actions', () => {
    assert.equal(deterministicStatus({ items: [], task: 'do a thing' }), 'starting up')
  })

  it('returns null with no activity at all', () => {
    assert.equal(deterministicStatus({ items: [] }), null)
  })
})

describe('normalizeClause', () => {
  it('takes the first line, strips quotes/period, lowercases the first char', () => {
    assert.equal(normalizeClause('"Debugging server-side auth errors."\nextra'), 'debugging server-side auth errors')
  })
  it('caps overly long output', () => {
    const long = 'x'.repeat(200)
    assert.ok(normalizeClause(long).length <= 60)
  })

  it('caps to the word budget (very short format)', () => {
    assert.equal(normalizeClause('writing integration tests for the payment gateway module'), 'writing integration tests for the')
  })

  it('strips a generic subject prefix but never mangles a legit "<word> is" clause', () => {
    assert.equal(normalizeClause('the agent is debugging the api'), 'debugging the api')
    assert.equal(normalizeClause('it is crafting sprites'), 'crafting sprites')
    assert.equal(normalizeClause('is crafting sprites'), 'crafting sprites')
    // Must NOT delete the subject of a real status whose 2nd word is "is".
    assert.equal(normalizeClause('server is unresponsive'), 'server is unresponsive')
  })

  it('strips trailing operators/punctuation', () => {
    assert.equal(normalizeClause('running npm test --'), 'running npm test')
  })
})

describe('eventAgentId', () => {
  it('reads name from agent_spawn and agent from tool/message events', () => {
    assert.equal(eventAgentId({ time: 0, type: 'agent_spawn', payload: { name: 'a' } }), 'a')
    assert.equal(eventAgentId({ time: 0, type: 'tool_call_start', payload: { agent: 'b' } }), 'b')
    assert.equal(eventAgentId({ time: 0, type: 'agent_status', payload: { agent: 'c' } }), null)
  })
})

describe('buildRequestBody (privacy)', () => {
  it('metadata-only by default: no raw thinking text in the body', () => {
    const body = buildRequestBody('m', {
      items: [{ tool: 'Edit', summary: 'draw-agents.ts — edit' }],
      task: 'refactor the canvas',
      lastText: 'SECRET internal reasoning about the private code',
      dirty: false,
    }, false) as { messages: Array<{ content: string }> }
    const serialized = JSON.stringify(body)
    assert.ok(!serialized.includes('SECRET'), 'raw thinking text must not be sent when sendRawText is false')
    assert.ok(serialized.includes('draw-agents.ts'))
  })

  it('includes the snippet only when sendRawText is enabled', () => {
    const body = buildRequestBody('m', {
      items: [], lastText: 'INCLUDED snippet', dirty: false,
    }, true)
    assert.ok(JSON.stringify(body).includes('INCLUDED snippet'))
  })
})

function ev(type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent {
  return { time: 0, type, payload }
}

describe('StatusSummarizer', () => {
  it('is inert when disabled', async () => {
    const emitted: string[] = []
    const s = new StatusSummarizer({ enabled: false }, (_a, st) => emitted.push(st))
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Read', args: 'a/b.ts' }))
    await s.generateAndEmit('x')
    assert.deepEqual(emitted, [])
    s.dispose()
  })

  it('emits the deterministic clause when no API key is set', async () => {
    const emitted: Array<{ id: string; st: string }> = []
    const s = new StatusSummarizer(
      { enabled: true, now: () => 0 },
      (id, st) => emitted.push({ id, st }),
    )
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Edit', args: 'foo/bar.ts — edit' }))
    await s.generateAndEmit('x')
    assert.deepEqual(emitted, [{ id: 'x', st: 'editing bar.ts' }])
    s.dispose()
  })

  it('uses the model clause when a key + fetch are provided, and sends no raw text', async () => {
    let sentBody = ''
    const fakeFetch = (async (_url: string, init: { body: string }) => {
      sentBody = init.body
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Debugging server-side auth errors.' } }] }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const emitted: string[] = []
    const s = new StatusSummarizer(
      { enabled: true, apiKey: 'k', now: () => 0, fetch: fakeFetch },
      (_id, st) => emitted.push(st),
    )
    s.observe(ev('agent_spawn', { name: 'x', task: 'fix auth' }))
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Read', args: 'auth/session.ts' }))
    s.observe(ev('message', { agent: 'x', role: 'thinking', content: 'PRIVATE reasoning' }))
    await s.generateAndEmit('x')
    // First update shows the instant deterministic status, then upgrades to the model's.
    assert.equal(emitted[0], 'reading session.ts')
    assert.equal(emitted.at(-1), 'debugging server-side auth errors')
    assert.ok(!sentBody.includes('PRIVATE'), 'raw thinking must not be sent by default')
    s.dispose()
  })

  it('falls back to deterministic when the model call fails', async () => {
    const failFetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const emitted: string[] = []
    const s = new StatusSummarizer(
      { enabled: true, apiKey: 'k', now: () => 0, fetch: failFetch },
      (_id, st) => emitted.push(st),
    )
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Grep', args: 'callsign' }))
    await s.generateAndEmit('x')
    assert.deepEqual(emitted, ['searching the code'])
    s.dispose()
  })

  it('shows a basic status without blocking when the router hangs (timeout → fallback)', async () => {
    // A fetch that never resolves until aborted — simulates an unreachable router.
    const hangFetch = ((_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
    const emitted: string[] = []
    const s = new StatusSummarizer(
      { enabled: true, apiKey: 'k', timeoutMs: 20, now: () => 0, fetch: hangFetch },
      (_id, st) => emitted.push(st),
    )
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Edit', args: 'foo/bar.ts — edit' }))
    await s.generateAndEmit('x') // resolves within ~20ms via the abort, not hung
    assert.deepEqual(emitted, ['editing bar.ts'])
    s.dispose()
  })

  it('does not re-emit when nothing changed (dirty flag cleared)', async () => {
    const emitted: string[] = []
    const s = new StatusSummarizer({ enabled: true, now: () => 0 }, (_id, st) => emitted.push(st))
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Read', args: 'a.ts' }))
    await s.generateAndEmit('x')
    await s.generateAndEmit('x') // no new activity → no second emit
    assert.equal(emitted.length, 1)
    s.dispose()
  })

  it('makes NO calls while inactive (toggle off), even with a key + fetch', async () => {
    let calls = 0
    const fakeFetch = (async () => {
      calls++
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } as unknown as Response
    }) as unknown as typeof fetch
    const emitted: string[] = []
    const s = new StatusSummarizer(
      { enabled: true, active: false, apiKey: 'k', now: () => 0, fetch: fakeFetch },
      (_id, st) => emitted.push(st),
    )
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Read', args: 'a.ts' }))
    await s.generateAndEmit('x') // guarded — inactive
    assert.equal(calls, 0, 'no OpenRouter calls while the status toggle is off')
    assert.deepEqual(emitted, [])
    s.dispose()
  })

  it('buffers while inactive and flushes on setActive(true)', async () => {
    const emitted: string[] = []
    const s = new StatusSummarizer(
      { enabled: true, active: false, now: () => 0 },
      (_id, st) => emitted.push(st),
    )
    // activity accumulates while hidden (free), no emission yet
    s.observe(ev('tool_call_start', { agent: 'x', tool: 'Edit', args: 'foo/bar.ts — edit' }))
    await s.generateAndEmit('x')
    assert.deepEqual(emitted, [])
    // turning the toggle on makes the buffered activity available immediately
    s.setActive(true)
    await s.generateAndEmit('x')
    assert.deepEqual(emitted, ['editing bar.ts'])
    s.dispose()
  })
})

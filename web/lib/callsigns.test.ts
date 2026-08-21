import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { assignCallSigns, resolveSessionName, CALLSIGNS, subagentCallSign, SUBAGENT_CALLSIGNS } from './callsigns'

// ─── the fruit pools: unique, disjoint, ~50 total ─────────────────────────────

test('each pool has no duplicate fruits', () => {
  assert.equal(new Set(CALLSIGNS).size, CALLSIGNS.length)
  assert.equal(new Set(SUBAGENT_CALLSIGNS).size, SUBAGENT_CALLSIGNS.length)
})

test('the session and subagent pools are disjoint', () => {
  const subagent = new Set<string>(SUBAGENT_CALLSIGNS)
  const shared = CALLSIGNS.filter((c) => subagent.has(c))
  assert.deepEqual(shared, [])
})

test('the two pools together provide ~50 fruit presets', () => {
  const total = CALLSIGNS.length + SUBAGENT_CALLSIGNS.length
  assert.ok(total >= 45 && total <= 55, `expected ~50 presets, got ${total}`)
})

test('no colour-word fruits leak into either pool', () => {
  // A call-sign that reads as a colour would clash with the per-agent identity
  // colour, so these are intentionally excluded from both pools.
  const colourFruits = ['Cherry', 'Orange', 'Lime', 'Lemon', 'Plum', 'Peach', 'Apricot', 'Tangerine']
  const all: readonly string[] = [...CALLSIGNS, ...SUBAGENT_CALLSIGNS]
  for (const c of colourFruits) assert.ok(!all.includes(c), `${c} is a colour word and must not be a call-sign`)
})

// ─── assignCallSigns: distinctness ───────────────────────────────────────────

test('assigns a distinct call-sign to each open session', () => {
  const m = assignCallSigns(['a', 'b', 'c'], new Map())
  assert.equal(m.size, 3)
  assert.equal(new Set(m.values()).size, 3)
})

test('first sessions take the list in order', () => {
  const m = assignCallSigns(['a', 'b'], new Map())
  assert.equal(m.get('a'), CALLSIGNS[0])
  assert.equal(m.get('b'), CALLSIGNS[1])
})

// ─── assignCallSigns: stability ───────────────────────────────────────────────

test('a session keeps its call-sign when tabs are reordered', () => {
  const m = assignCallSigns(['a', 'b', 'c'], new Map())
  const reordered = assignCallSigns(['c', 'b', 'a'], m)
  assert.equal(reordered.get('a'), m.get('a'))
  assert.equal(reordered.get('b'), m.get('b'))
  assert.equal(reordered.get('c'), m.get('c'))
})

test('surviving sessions keep their call-sign when a neighbour closes', () => {
  const m = assignCallSigns(['a', 'b', 'c'], new Map())
  const afterClose = assignCallSigns(['a', 'c'], m) // b closed
  assert.equal(afterClose.get('a'), m.get('a'))
  assert.equal(afterClose.get('c'), m.get('c'))
})

test('same ids + prior map is idempotent (survives reload)', () => {
  const m = assignCallSigns(['a', 'b', 'c'], new Map())
  assert.deepEqual([...assignCallSigns(['a', 'b', 'c'], m)], [...m])
})

// ─── assignCallSigns: recycling + overflow ────────────────────────────────────

test('a freed call-sign is reused by a later session', () => {
  const m = assignCallSigns(['a', 'b'], new Map())
  const freed = m.get('a')
  const afterSwap = assignCallSigns(['b', 'c'], m) // a closed, c opened
  assert.equal(afterSwap.get('c'), freed) // c reuses a's freed call-sign
})

test('more sessions than call-signs stay distinct via suffixes', () => {
  const ids = Array.from({ length: CALLSIGNS.length + 3 }, (_, i) => `s${i}`)
  const m = assignCallSigns(ids, new Map())
  assert.equal(m.size, ids.length)
  assert.equal(new Set(m.values()).size, ids.length)
})

// ─── subagentCallSign: ordered, distinct, wraps past the pool ─────────────────

test('subagent call-signs are the pool words in spawn order', () => {
  assert.equal(subagentCallSign(0), 'Guava')
  assert.equal(subagentCallSign(0), SUBAGENT_CALLSIGNS[0])
  assert.equal(subagentCallSign(1), SUBAGENT_CALLSIGNS[1])
})

test('subagent call-signs wrap with a numeric suffix past the pool', () => {
  const n = SUBAGENT_CALLSIGNS.length
  assert.equal(subagentCallSign(n), `${SUBAGENT_CALLSIGNS[0]} 2`)
  assert.equal(subagentCallSign(n + 1), `${SUBAGENT_CALLSIGNS[1]} 2`)
  assert.equal(subagentCallSign(2 * n), `${SUBAGENT_CALLSIGNS[0]} 3`)
})

test('subagent call-signs are distinct across the whole pool', () => {
  const names = Array.from({ length: SUBAGENT_CALLSIGNS.length }, (_, i) => subagentCallSign(i))
  assert.equal(new Set(names).size, SUBAGENT_CALLSIGNS.length)
})

// ─── resolveSessionName: name precedence + goal context ───────────────────────

test('call-sign is the name, goal is secondary context', () => {
  assert.deepEqual(resolveSessionName('add colors', 'Apple', undefined), {
    name: 'Apple',
    goal: 'add colors',
  })
})

test('a user rename overrides the call-sign but keeps the goal', () => {
  assert.deepEqual(resolveSessionName('add colors', 'Apple', 'My Session'), {
    name: 'My Session',
    goal: 'add colors',
  })
})

test('the "Session <id>" placeholder is never shown as a goal', () => {
  assert.deepEqual(resolveSessionName('Session a1b2c3d4', 'Apple', undefined), { name: 'Apple' })
})

test('goal is dropped when it equals the name (nothing to add)', () => {
  assert.deepEqual(resolveSessionName('Apple', 'Apple', undefined), { name: 'Apple' })
})

test('falls back to the raw label before a call-sign exists', () => {
  assert.deepEqual(resolveSessionName('add colors', undefined, undefined), { name: 'add colors' })
})

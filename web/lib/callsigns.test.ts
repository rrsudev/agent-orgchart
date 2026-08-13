import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { assignCallSigns, resolveSessionName, CALLSIGNS } from './callsigns'

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

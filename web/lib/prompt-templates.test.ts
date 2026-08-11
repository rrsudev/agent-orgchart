import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildClaudeCommand, MODEL_OPTIONS } from './prompt-templates'

// ─── buildClaudeCommand: empty / trimming ────────────────────────────────────

test('empty prompt yields empty command', () => {
  assert.equal(buildClaudeCommand({ prompt: '', model: '' }), '')
})

test('whitespace-only prompt yields empty command', () => {
  assert.equal(buildClaudeCommand({ prompt: '   \n\t ', model: '' }), '')
})

test('prompt is trimmed before quoting', () => {
  assert.equal(buildClaudeCommand({ prompt: '  hi  ', model: '' }), "claude 'hi'")
})

// ─── model ────────────────────────────────────────────────────────────────────

test('default (empty) model omits --model', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: '' }), "claude 'hi'")
})

test('selectable model is included', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'opus' }), "claude --model opus 'hi'")
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'sonnet' }), "claude --model sonnet 'hi'")
})

test('excluded models (fable/mythos) are dropped', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'fable' }), "claude 'hi'")
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'mythos' }), "claude 'hi'")
})

test('excluded models are dropped case-insensitively and after trimming', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'Fable' }), "claude 'hi'")
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'MYTHOS' }), "claude 'hi'")
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: '  fable  ' }), "claude 'hi'")
})

test('unknown model passes through (no allow-list validation)', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: 'gpt-5' }), "claude --model gpt-5 'hi'")
})

// ─── plan mode ──────────────────────────────────────────────────────────────

test('planMode adds --permission-mode plan', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', planMode: true }),
    "claude --permission-mode plan 'hi'",
  )
})

test('planMode false adds nothing', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: '', planMode: false }), "claude 'hi'")
})

// ─── context (--append-system-prompt) ─────────────────────────────────────────

test('non-empty context adds --append-system-prompt', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', context: 'be terse' }),
    "claude --append-system-prompt 'be terse' 'hi'",
  )
})

test('whitespace-only context is omitted', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: '', context: '   ' }), "claude 'hi'")
})

test('context is trimmed', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', context: '  trim me  ' }),
    "claude --append-system-prompt 'trim me' 'hi'",
  )
})

// ─── cwd prefix ───────────────────────────────────────────────────────────────

test('cwd prefixes with cd', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', cwd: '/tmp/proj' }),
    "cd '/tmp/proj' && claude 'hi'",
  )
})

test('cwd with spaces is quoted', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', cwd: '/tmp/my proj' }),
    "cd '/tmp/my proj' && claude 'hi'",
  )
})

test('whitespace-only cwd adds no prefix', () => {
  assert.equal(buildClaudeCommand({ prompt: 'hi', model: '', cwd: '   ' }), "claude 'hi'")
})

// ─── ordering: cwd → model → plan → context → prompt ──────────────────────────

test('all options combine in the expected order', () => {
  assert.equal(
    buildClaudeCommand({
      prompt: 'do it',
      model: 'sonnet',
      context: 'ctx',
      cwd: '/a',
      planMode: true,
    }),
    "cd '/a' && claude --model sonnet --permission-mode plan --append-system-prompt 'ctx' 'do it'",
  )
})

// ─── shq: POSIX single-quote escaping / injection safety ──────────────────────

test('single quotes are escaped as the POSIX close-escape-reopen sequence', () => {
  assert.equal(buildClaudeCommand({ prompt: "it's fine", model: '' }), "claude 'it'\\''s fine'")
})

test('double quotes are inert inside single quotes', () => {
  assert.equal(buildClaudeCommand({ prompt: 'say "hi"', model: '' }), 'claude \'say "hi"\'')
})

test('backticks are not command-substituted', () => {
  assert.equal(buildClaudeCommand({ prompt: 'echo `whoami`', model: '' }), "claude 'echo `whoami`'")
})

test('$() is not expanded', () => {
  assert.equal(buildClaudeCommand({ prompt: '$(rm -rf /)', model: '' }), "claude '$(rm -rf /)'")
})

test('backslashes are preserved literally', () => {
  assert.equal(buildClaudeCommand({ prompt: 'a\\b', model: '' }), "claude 'a\\b'")
})

test('single quotes in cwd are escaped', () => {
  assert.equal(
    buildClaudeCommand({ prompt: 'hi', model: '', cwd: "/a'b" }),
    "cd '/a'\\''b' && claude 'hi'",
  )
})

// ─── MODEL_OPTIONS shape ──────────────────────────────────────────────────────

test('MODEL_OPTIONS leads with Default and excludes fable/mythos', () => {
  assert.deepEqual(
    MODEL_OPTIONS.map((m) => m.value),
    ['', 'opus', 'sonnet', 'haiku'],
  )
  assert.deepEqual(
    MODEL_OPTIONS.map((m) => m.label),
    ['Default', 'Opus', 'Sonnet', 'Haiku'],
  )
})

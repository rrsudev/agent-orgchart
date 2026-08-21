/**
 * Unit tests for the default-naming helpers (feature 2).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { truncateWords, titleCaseAgentType, formatSubagentDisplayName } from '../src/constants'

describe('truncateWords', () => {
  it('returns text unchanged when within the word budget', () => {
    assert.equal(truncateWords('hello world', 3), 'hello world')
  })

  it('collapses whitespace/newlines', () => {
    assert.equal(truncateWords('  hello   world\nagain ', 3), 'hello world again')
  })

  it('keeps the first N words with a single ellipsis (never mid-word, never "..")', () => {
    const out = truncateWords('design a logging system with database integration', 3)
    assert.equal(out, 'design a logging…')
    assert.ok(!out.includes('..'), 'no double-dot')
  })

  it('leaves a single long word intact (word-count based, no mid-word cut)', () => {
    assert.equal(truncateWords('supercalifragilisticexpialidocious', 3), 'supercalifragilisticexpialidocious')
  })
})

describe('titleCaseAgentType', () => {
  it('title-cases hyphen/underscore slugs', () => {
    assert.equal(titleCaseAgentType('general-purpose'), 'General Purpose')
    assert.equal(titleCaseAgentType('code_reviewer'), 'Code Reviewer')
    assert.equal(titleCaseAgentType('Explore'), 'Explore')
  })
})

describe('formatSubagentDisplayName', () => {
  it('combines type and the FULL description (no word truncation)', () => {
    assert.equal(
      formatSubagentDisplayName('general-purpose', 'review diff for bugs'),
      'General Purpose · review diff for bugs',
    )
    assert.equal(
      formatSubagentDisplayName('Explore', 'map the event flow'),
      'Explore · map the event flow',
    )
  })
  it('collapses whitespace/newlines in the description', () => {
    assert.equal(
      formatSubagentDisplayName('Explore', '  map   the\nevent flow '),
      'Explore · map the event flow',
    )
  })
  it('type only', () => {
    assert.equal(formatSubagentDisplayName('Explore', undefined), 'Explore')
  })
  it('description only', () => {
    assert.equal(formatSubagentDisplayName(undefined, 'map the event flow'), 'map the event flow')
  })
  it('falls back to "subagent" when nothing is available', () => {
    assert.equal(formatSubagentDisplayName(undefined, undefined), 'subagent')
  })
})

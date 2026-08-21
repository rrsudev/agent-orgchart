import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './markdown'

const html = (text: string, query?: string) => renderToStaticMarkup(<Markdown text={text} query={query} />)

// ─── inline emphasis ──────────────────────────────────────────────────────────

test('bold renders <strong> and drops the asterisks', () => {
  const h = html('a **bold** b')
  assert.match(h, /<strong>bold<\/strong>/)
  assert.doesNotMatch(h, /\*\*/)
})

test('italic renders <em>', () => {
  assert.match(html('an *italic* word'), /<em>italic<\/em>/)
})

test('bold-italic renders nested strong>em', () => {
  assert.match(html('***both***'), /<strong><em>both<\/em><\/strong>/)
})

test('strikethrough renders line-through', () => {
  assert.match(html('~~gone~~'), /line-through/)
})

test('underline via <u> is preserved', () => {
  assert.match(html('keep <u>this</u>'), /<u>this<\/u>/)
})

test('inline code renders <code> without the backticks', () => {
  const h = html('call `foo()` now')
  assert.match(h, /<code[^>]*>foo\(\)<\/code>/)
  assert.doesNotMatch(h, /`/)
})

test('link renders an anchor to its href', () => {
  const h = html('see [docs](https://x.dev)')
  assert.match(h, /<a[^>]+href="https:\/\/x\.dev"[^>]*>docs<\/a>/)
})

// ─── the snake_case / identifier guard ────────────────────────────────────────

test('intraword underscores do NOT italicize', () => {
  const h = html('use read_page and __init__ here')
  assert.doesNotMatch(h, /<em>/)
  assert.match(h, /read_page/)
  assert.match(h, /__init__/)
})

test('underscore emphasis works at word boundaries', () => {
  assert.match(html('an _italic_ word'), /<em>italic<\/em>/)
})

// ─── headings: bolded, never enlarged ─────────────────────────────────────────

test('heading is bolded but not a heading tag or larger font', () => {
  const h = html('## Title here')
  assert.doesNotMatch(h, /<h[1-6]/)        // not an <h2>
  assert.doesNotMatch(h, /font-size/i)     // no size bump
  assert.match(h, /font-weight:\s*700/)    // just bold
  assert.match(h, /Title here/)
  assert.doesNotMatch(h, /##/)
})

// ─── blocks ───────────────────────────────────────────────────────────────────

test('bullet list renders <ul>/<li>', () => {
  const h = html('- one\n- two')
  assert.match(h, /<ul[^>]*>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<\/ul>/)
})

test('ordered list renders <ol>/<li>', () => {
  const h = html('1. first\n2. second')
  assert.match(h, /<ol[^>]*>[\s\S]*<li[^>]*>first<\/li>[\s\S]*<li[^>]*>second<\/li>[\s\S]*<\/ol>/)
})

test('fenced code block renders <pre><code> verbatim', () => {
  const h = html('```\nconst x = **not bold**\n```')
  assert.match(h, /<pre[^>]*><code>const x = \*\*not bold\*\*<\/code><\/pre>/)
})

test('blockquote renders with a left border', () => {
  assert.match(html('> quoted'), /border-left/)
})

test('horizontal rule renders <hr>', () => {
  assert.match(html('---'), /<hr/)
})

test('single newline inside a paragraph becomes a hard break', () => {
  assert.match(html('line one\nline two'), /<br\/?>/)
})

// ─── escaping ──────────────────────────────────────────────────────────────────

test('backslash-escaped asterisks stay literal', () => {
  const h = html('literal \\*stars\\*')
  assert.doesNotMatch(h, /<em>|<strong>/)
  assert.match(h, /\*stars\*/)
})

// ─── search highlight composes with formatting ─────────────────────────────────

test('query match inside bold text is wrapped in <mark>', () => {
  const h = html('**find me here**', 'me')
  assert.match(h, /<strong>[\s\S]*<mark[^>]*>me<\/mark>[\s\S]*<\/strong>/)
})

test('plain text with no markdown renders the text', () => {
  assert.match(html('just words'), /just words/)
})

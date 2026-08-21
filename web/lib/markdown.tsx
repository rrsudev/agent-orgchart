import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { COLORS } from './colors'

// ─── Minimal markdown renderer ────────────────────────────────────────────────
//
// Prompt / message text arrives with markdown syntax in it (**bold**, `code`,
// `- lists`, `## headings`, …). Rendered as a plain string those symbols show
// literally, so this turns the common subset into styled React nodes. It is
// intentionally dependency-free — the web bundle carries only four runtime deps
// and a full parser (react-markdown + remark + rehype) is far more weight than a
// chat-prompt surface needs.
//
// One deliberate deviation from real markdown: headings are NOT scaled up. In
// these dense side panels a larger heading line would blow out the layout, so a
// `#`-prefixed line is emitted at the surrounding font size and only made bold.
//
// Search highlighting composes with formatting because it happens at the leaf:
// every literal text run is passed through `emitText`, which wraps `query`
// matches in <mark> after emphasis/code/etc. have already been peeled off.

// ─── Inline formatting ────────────────────────────────────────────────────────

// Wrap query matches in the same <mark> the transcript search used before, so a
// search inside bold/italic text still highlights. Also unescapes backslashed
// punctuation (`\*` → `*`) since that never reached an inline matcher.
function emitText(text: string, query: string | undefined, key: string): ReactNode {
  const clean = text.replace(/\\([\\*_~`[\]()<>#-])/g, '$1')
  if (!query || !query.trim()) return <Fragment key={key}>{clean}</Fragment>
  const parts = clean.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <Fragment key={key}>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: COLORS.searchHighlightBg, color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </Fragment>
  )
}

// Each matcher finds its earliest occurrence in the remaining text. The scanner
// picks whichever starts first (ties broken by array order → longer/greedier
// delimiters listed before their prefixes) so `***x***` beats `**x**` beats `*x*`.
type Matcher = { re: RegExp; render: (m: RegExpMatchArray, inner: ReactNode) => ReactNode; nested: boolean }

// True only for hrefs that are safe to render as a live link. An explicit scheme
// must be http/https/mailto; a URL with no scheme (relative or protocol-relative)
// can't carry executable script, so it's allowed. Everything else — notably
// `javascript:`, `data:`, `vbscript:` — is rejected and rendered as plain text.
export function isSafeHref(href: string): boolean {
  // Strip ASCII control chars and spaces before testing the scheme: browsers
  // ignore tabs/newlines inside a URL, so "java\tscript:" resolves to
  // "javascript:" — collapse them first so that bypass can't slip through.
  const s = href.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)
  if (!scheme) return true // relative / protocol-relative — no scheme to abuse
  const name = scheme[1].toLowerCase()
  return name === 'http' || name === 'https' || name === 'mailto'
}

const MATCHERS: Matcher[] = [
  // Code spans first — nothing inside them is interpreted.
  { re: /`([^`]+?)`/, nested: false, render: (_m, inner) => (
    <code style={{ background: COLORS.toolIndicatorBg, border: `1px solid ${COLORS.toolIndicatorBorder}`, borderRadius: 3, padding: '0 3px', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.9em' }}>{inner}</code>
  ) },
  { re: /\[([^\]]+?)\]\(([^)\s]+?)\)/, nested: true, render: (m, inner) => {
    // Only render an anchor for a safe scheme. Transcript text is untrusted (an
    // agent may echo a page or file it read), and React does NOT sanitize href —
    // a `javascript:`/`data:`/`vbscript:` URL would execute on click. Anything
    // that isn't clearly http/https/mailto renders as plain text instead.
    return isSafeHref(m[2])
      ? <a href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.holoBase, textDecoration: 'underline' }}>{inner}</a>
      : <Fragment>{inner}</Fragment>
  } },
  { re: /<u>([\s\S]+?)<\/u>/i, nested: true, render: (_m, inner) => <u>{inner}</u> },
  { re: /\*\*\*([\s\S]+?)\*\*\*/, nested: true, render: (_m, inner) => <strong><em>{inner}</em></strong> },
  { re: /\*\*([\s\S]+?)\*\*/, nested: true, render: (_m, inner) => <strong>{inner}</strong> },
  { re: /~~([\s\S]+?)~~/, nested: true, render: (_m, inner) => <span style={{ textDecoration: 'line-through' }}>{inner}</span> },
  { re: /\*([^\s*][\s\S]*?)\*/, nested: true, render: (_m, inner) => <em>{inner}</em> },
  // Underscore emphasis only via a SINGLE underscore at word boundaries. The
  // `__…__` bold form is deliberately omitted: in these code-heavy prompts a
  // double underscore almost always means a dunder identifier (`__init__`,
  // `__name__`), and Claude writes real bold as `**…**` anyway. The boundary
  // guard also leaves snake_case tool names (`read_page`) untouched.
  { re: /(?<![A-Za-z0-9_])_([^\s_][\s\S]*?)_(?![A-Za-z0-9_])/, nested: true, render: (_m, inner) => <em>{inner}</em> },
]

function renderInline(text: string, query: string | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let cursor = 0
  let guard = 0

  while (rest.length > 0 && guard++ < 10000) {
    let best: { m: RegExpMatchArray; matcher: Matcher } | null = null
    for (const matcher of MATCHERS) {
      const m = rest.match(matcher.re)
      if (!m || m.index === undefined) continue
      // Skip a delimiter escaped by an odd run of backslashes before it.
      let bs = 0
      for (let j = m.index - 1; j >= 0 && rest[j] === '\\'; j--) bs++
      if (bs % 2 === 1) continue
      if (best === null || m.index < best.m.index!) best = { m, matcher }
    }

    if (!best) {
      out.push(emitText(rest, query, `${keyBase}-t${cursor}`))
      break
    }

    const { m, matcher } = best
    const at = m.index!
    if (at > 0) out.push(emitText(rest.slice(0, at), query, `${keyBase}-t${cursor}`))
    const inner = matcher.nested
      ? <Fragment>{renderInline(m[1], query, `${keyBase}-n${cursor}`)}</Fragment>
      : emitText(m[1], query, `${keyBase}-c${cursor}`)
    out.push(<Fragment key={`${keyBase}-m${cursor}`}>{matcher.render(m, inner)}</Fragment>)
    rest = rest.slice(at + m[0].length)
    cursor++
  }

  return out
}

// ─── Block structure ──────────────────────────────────────────────────────────

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: { num: string; text: string }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }

const RE_FENCE = /^\s*```/
const RE_HEADING = /^\s*(#{1,6})\s+(.*)$/
const RE_HR = /^\s*([-*_])\1{2,}\s*$/
const RE_QUOTE = /^\s*>\s?(.*)$/
const RE_UL = /^\s*[-*+]\s+(.*)$/
const RE_OL = /^\s*(\d+)[.)]\s+(.*)$/

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (RE_FENCE.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !RE_FENCE.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // consume closing fence
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (RE_HR.test(line)) { blocks.push({ kind: 'hr' }); i++; continue }
    const h = line.match(RE_HEADING)
    if (h) { blocks.push({ kind: 'heading', text: h[2] }); i++; continue }
    if (RE_QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && RE_QUOTE.test(lines[i])) body.push(lines[i++].match(RE_QUOTE)![1])
      blocks.push({ kind: 'quote', lines: body })
      continue
    }
    if (RE_UL.test(line)) {
      const items: string[] = []
      while (i < lines.length && RE_UL.test(lines[i])) items.push(lines[i++].match(RE_UL)![1])
      blocks.push({ kind: 'ul', items })
      continue
    }
    if (RE_OL.test(line)) {
      const items: { num: string; text: string }[] = []
      while (i < lines.length && RE_OL.test(lines[i])) {
        const m = lines[i++].match(RE_OL)!
        items.push({ num: m[1], text: m[2] })
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    if (line.trim() === '') { i++; continue }

    // Paragraph: consecutive plain lines until a blank line or a block starter.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !RE_FENCE.test(lines[i]) && !RE_HR.test(lines[i]) && !RE_HEADING.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) && !RE_UL.test(lines[i]) && !RE_OL.test(lines[i])
    ) para.push(lines[i++])
    blocks.push({ kind: 'para', lines: para })
  }

  return blocks
}

// Join a paragraph/quote's lines, preserving hard breaks (single newlines are
// meaningful in chat prompts, unlike CommonMark where they fold to a space).
function withBreaks(lines: string[], query: string | undefined, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  lines.forEach((ln, i) => {
    if (i > 0) out.push(<br key={`${keyBase}-br${i}`} />)
    out.push(...renderInline(ln, query, `${keyBase}-l${i}`))
  })
  return out
}

// ─── Public component ─────────────────────────────────────────────────────────

/**
 * Render a markdown string as styled React nodes. Handles bold, italic,
 * strikethrough, inline code, links, `<u>` underline, headings (bolded, not
 * enlarged), bullet / numbered lists, blockquotes, fenced code, and rules.
 * `query`, when set, highlights matches inside the rendered text.
 */
export function Markdown({ text, query, className, style }: { text: string; query?: string; className?: string; style?: CSSProperties }) {
  const blocks = parseBlocks(text)
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.5em', ...style }}>
      {blocks.map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'heading':
            return <div key={key} style={{ fontWeight: 700 }}>{renderInline(b.text, query, key)}</div>
          case 'para':
            return <div key={key} style={{ whiteSpace: 'normal' }}>{withBreaks(b.lines, query, key)}</div>
          case 'ul':
            return (
              <ul key={key} style={{ margin: 0, paddingLeft: '1.2em', listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
                {b.items.map((it, j) => <li key={j}>{renderInline(it, query, `${key}-i${j}`)}</li>)}
              </ul>
            )
          case 'ol':
            return (
              <ol key={key} start={Number(b.items[0]?.num) || 1} style={{ margin: 0, paddingLeft: '1.4em', listStyle: 'decimal', display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
                {b.items.map((it, j) => <li key={j} value={Number(it.num) || undefined}>{renderInline(it.text, query, `${key}-i${j}`)}</li>)}
              </ol>
            )
          case 'quote':
            return (
              <div key={key} style={{ borderLeft: `2px solid ${COLORS.holoBorder12}`, paddingLeft: '0.6em', opacity: 0.85 }}>
                {withBreaks(b.lines, query, key)}
              </div>
            )
          case 'code':
            return (
              <pre key={key} style={{ margin: 0, background: COLORS.toolIndicatorBg, border: `1px solid ${COLORS.toolIndicatorBorder}`, borderRadius: 5, padding: '6px 8px', overflowX: 'auto', whiteSpace: 'pre', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.9em' }}>
                <code>{b.text}</code>
              </pre>
            )
          case 'hr':
            return <hr key={key} style={{ border: 'none', borderTop: `1px solid ${COLORS.holoBorder12}`, margin: '0.2em 0' }} />
        }
      })}
    </div>
  )
}

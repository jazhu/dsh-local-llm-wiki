// Wiki page parsing: turn a harvested `<wiki>/` markdown file into a WikiPage.
//
// Pages produced by the llm-wiki skill carry YAML frontmatter (title / tags /
// sources / updated / confidence / aliases / related). This module is a strict
// subset parser — it deliberately does NOT depend on a YAML library: the fields
// we read are scalars and simple flow/block lists, and the harvest must never
// fail the whole project because one page has exotic frontmatter. Anything the
// parser cannot understand degrades to sensible defaults; the raw body is
// always preserved for retrieval and reading.

import type { WikiPage, WikiPageKind } from './types.ts'

/** Extract the leading `--- ... ---` frontmatter block, if present. */
export function splitFrontmatter(md: string): { front: string | null; body: string } {
  const norm = md.replace(/\r\n/g, '\n')
  if (!norm.startsWith('---\n')) return { front: null, body: norm }
  const end = norm.indexOf('\n---', 4)
  if (end < 0) return { front: null, body: norm }
  const front = norm.slice(4, end + 1) // up to the closing fence line
  let body = norm.slice(end + 1)
  // Drop the closing fence and one optional newline after it.
  body = body.replace(/^\n---\n?/, '')
  return { front, body }
}

/** Very small YAML-subset scalar parser: handles `key: value` and `key: [a, b]` and `- item` blocks. */
export function parseFrontmatter(front: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const lines = front.split('\n')
  let currentListKey: string | null = null
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    // block list item: "  - foo"
    const itemMatch = /^\s+-\s+(.*)$/.exec(line)
    if (itemMatch && currentListKey) {
      const arr = out[currentListKey]
      if (Array.isArray(arr)) arr.push(stripQuotes(itemMatch[1].trim()))
      continue
    }
    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]
    const val = kv[2]
    if (!val) {
      // possibly a block list starting next line
      out[key] = []
      currentListKey = key
      continue
    }
    currentListKey = null
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean)
    } else {
      out[key] = stripQuotes(val)
    }
  }
  return out
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return []
  if (Array.isArray(v)) return v
  // A scalar that looks like a comma list is split; otherwise single element.
  if (/[,，]/.test(v)) return v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  return v ? [v] : []
}

function asString(v: string | string[] | undefined): string {
  if (v === undefined) return ''
  return Array.isArray(v) ? v.join(', ') : v
}

/** Derive the page kind from its relative path inside the wiki dir. */
export function kindFromPath(relPath: string): WikiPageKind {
  const norm = '/' + relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (norm.includes('/entities/')) return 'entities'
  if (norm.includes('/concepts/')) return 'concepts'
  if (norm.includes('/comparisons/')) return 'comparisons'
  if (norm.includes('/queries/')) return 'queries'
  const base = norm.split('/').pop() ?? ''
  if (/^index\.md$/i.test(base)) return 'index'
  if (/^schema\.md$/i.test(base)) return 'other'
  return 'other'
}

/** Pull a one-paragraph summary out of the body (first non-heading, non-empty block). */
export function gist(body: string): string {
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  for (const b of blocks) {
    if (b.startsWith('#')) continue
    const one = b.replace(/\n/g, ' ').trim()
    if (one.length < 8) continue
    return one.length > 220 ? one.slice(0, 220) + '…' : one
  }
  return ''
}

/** First markdown ATX heading, if any (fallback title when frontmatter lacks one). */
function firstHeading(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body)
  return m ? m[1].trim() : ''
}

export function confidenceOf(v: string | string[] | undefined): number {
  const s = asString(v)
  if (!s) return 1
  const n = Number(s)
  if (Number.isFinite(n)) return n <= 1 ? Math.max(0, n) : Math.max(0, Math.min(1, n / 100))
  const lower = s.toLowerCase()
  if (lower === 'high' || lower === '高') return 0.9
  if (lower === 'medium' || lower === 'mid' || lower === '中') return 0.6
  if (lower === 'low' || lower === '低') return 0.3
  return 1
}

/** Parse one wiki page file into a WikiPage (never throws). */
export function parseWikiPage(args: {
  id: string
  path: string
  relPath: string
  markdown: string
}): WikiPage {
  const { front, body } = splitFrontmatter(args.markdown)
  const fm = front ? parseFrontmatter(front) : {}
  const kind = kindFromPath(args.relPath)
  const fmTitle = asString(fm.title)
  const title = fmTitle || firstHeading(body) || (args.relPath.split('/').pop() ?? args.id)
  return {
    id: args.id,
    path: args.path,
    kind,
    title,
    tags: asArray(fm.tags),
    sources: asArray(fm.sources),
    confidence: confidenceOf(fm.confidence),
    updated: asString(fm.updated),
    text: body.trim(),
    summary: gist(body),
  }
}

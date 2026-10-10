// Page-level BM25 retrieval over harvested wiki pages.
//
// Reuses the tokenisation + scoring approach proven in dsh-knowledge-base's
// retrieve.ts (CJK unigram+bigram, Latin words kept whole, Okapi BM25), but
// indexes *wiki pages* rather than document chunks: a page is one atomic unit,
// so its whole text is the field (no 400-token prefix truncation — pages are
// short by nature).

import type { WikiPage } from './types.ts'

const K1 = 1.2
const B = 0.75

/** Title is the strongest signal; repeat it. */
const TITLE_REPEAT = 3
const MAX_TEXT_TOKENS = 600
const MAX_TAG_TOKENS = 16

export const DEFAULT_TOP_K = 5
export const MAX_TOP_K = 12
export const SNIPPET_CHARS = 700

export interface WikiHit {
  projectId: string
  projectName: string
  page: WikiPage
  score: number
  matchedTerms: string[]
  snippet: string
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/
function isCjk(ch: string): boolean {
  return CJK.test(ch)
}

export function tokenize(text: string): string[] {
  const out: string[] = []
  const src = text.toLowerCase()
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (isCjk(ch)) {
      let j = i
      while (j < src.length && isCjk(src[j])) j++
      const run = src.slice(i, j)
      for (let k = 0; k < run.length; k++) {
        out.push(run[k])
        if (k + 1 < run.length) out.push(run.slice(k, k + 2))
      }
      i = j
      continue
    }
    if (/[a-z0-9]/.test(ch)) {
      let j = i
      while (j < src.length && /[a-z0-9._+-]/.test(src[j])) j++
      const word = src.slice(i, j).replace(/^[._+-]+|[._+-]+$/g, '')
      if (word) out.push(word)
      i = j
      continue
    }
    i++
  }
  return out
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

/** Token stream of one page, field-weighted by repetition. */
export function pageTokens(p: WikiPage): string[] {
  const out: string[] = []
  for (let i = 0; i < TITLE_REPEAT; i++) out.push(...tokenize(p.title))
  out.push(...tokenize(p.text).slice(0, MAX_TEXT_TOKENS))
  for (const t of p.tags.slice(0, MAX_TAG_TOKENS)) out.push(...tokenize(t))
  return out
}

interface Posting {
  page: WikiPage
  projectId: string
  projectName: string
  tf: Map<string, number>
  length: number
}

export class WikiIndex {
  /** term -> postings carrying it. */
  private postings = new Map<string, Posting[]>()
  /** projectId -> set of page ids currently indexed. */
  private byProject = new Map<string, Set<string>>()
  /** pageId -> the posting we stored (single copy per page). */
  private byPage = new Map<string, Posting>()
  private avgLength = 0
  private version = 0

  get revision(): number {
    return this.version
  }

  get size(): number {
    let n = 0
    for (const set of this.byProject.values()) n += set.size
    return n
  }

  /** Replace all pages of one project. */
  addProject(projectId: string, projectName: string, pages: WikiPage[]): void {
    this.removeProject(projectId)
    const set = new Set<string>()
    for (const page of pages) {
      set.add(page.id)
      const tokens = pageTokens(page)
      const posting: Posting = {
        page,
        projectId,
        projectName,
        tf: termFreq(tokens),
        length: tokens.length,
      }
      this.byPage.set(page.id, posting)
      for (const term of posting.tf.keys()) {
        const list = this.postings.get(term)
        if (list) list.push(posting)
        else this.postings.set(term, [posting])
      }
    }
    this.byProject.set(projectId, set)
    this.recomputeAverage()
    this.version++
  }

  removeProject(projectId: string): void {
    const set = this.byProject.get(projectId)
    if (!set) return
    for (const pageId of set) {
      const posting = this.byPage.get(pageId)
      if (!posting) continue
      for (const term of posting.tf.keys()) {
        const list = this.postings.get(term)
        if (!list) continue
        const next = list.filter((p) => p.page.id !== pageId)
        if (next.length) this.postings.set(term, next)
        else this.postings.delete(term)
      }
      this.byPage.delete(pageId)
    }
    this.byProject.delete(projectId)
    this.recomputeAverage()
    this.version++
  }

  clear(): void {
    this.postings = new Map()
    this.byProject = new Map()
    this.avgLength = 0
    this.version++
  }

  private recomputeAverage(): void {
    let total = 0
    let n = 0
    for (const list of this.postings.values()) {
      for (const p of list) {
        total += p.length
        n++
      }
    }
    this.avgLength = n > 0 ? total / n : 0
  }

  search(query: string, opts: { projectId?: string; topK?: number } = {}): WikiHit[] {
    const qTokens = [...new Set(tokenize(query))]
    if (!qTokens.length) return []
    const topK = Math.max(1, Math.min(opts.topK ?? DEFAULT_TOP_K, MAX_TOP_K))
    const N = Math.max(1, this.size)
    const scope = opts.projectId ? this.byProject.get(opts.projectId) : null

    const scores = new Map<string, { p: Posting; score: number; terms: string[] }>()
    for (const term of qTokens) {
      const list = this.postings.get(term)
      if (!list || !list.length) continue
      const df = list.length
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      if (idf <= 0) continue
      for (const p of list) {
        if (scope && !scope.has(p.page.id)) continue
        const f = p.tf.get(term)!
        const norm = 1 - B + B * (this.avgLength > 0 ? p.length / this.avgLength : 1)
        const contribution = idf * ((f * (K1 + 1)) / (f + K1 * norm))
        let hit = scores.get(p.page.id)
        if (!hit) {
          hit = { p, score: 0, terms: [] }
          scores.set(p.page.id, hit)
        }
        hit.score += contribution
        hit.terms.push(term)
      }
    }
    if (!scores.size) return []
    const ranked = [...scores.values()]
      .sort((a, b) => b.score - a.score || a.p.page.title.localeCompare(b.p.page.title))
      .slice(0, topK)
    const best = ranked.length ? ranked[0].score : 1
    return ranked.map((h) => ({
      projectId: h.p.projectId,
      projectName: h.p.projectName,
      page: h.p.page,
      score: best > 0 ? h.score / best : 0,
      matchedTerms: [...new Set(h.terms)].slice(0, 8),
      snippet: snippetOf(h.p.page, [...new Set(h.terms)]),
    }))
  }
}

// Helper: re-derive a page's tokens during removal without holding the page
// reference separately. We keep a per-term cache keyed by page id lazily; but
// simpler: scan the postings for the page and record its terms there.
export function snippetOf(page: WikiPage, terms: string[] = []): string {
  const text = page.text ?? ''
  if (text.length <= SNIPPET_CHARS) return text
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) {
    if (t.length < 2) continue
    const i = lower.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) at = 0
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3))
  const end = Math.min(text.length, start + SNIPPET_CHARS)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

export function formatHits(query: string, hits: WikiHit[]): string {
  if (!hits.length) {
    return `知识库中没有找到与「${query}」相关的 wiki 页面。`
  }
  const lines: string[] = [`wiki 检索「${query}」，命中 ${hits.length} 个页面：`, '']
  hits.forEach((h, i) => {
    const c = h.page
    lines.push(`${i + 1}. **${c.title}**（${h.projectName} · ${c.kind}${c.tags.length ? ' · 标签：' + c.tags.join('、') : ''}）`)
    lines.push(`   - 路径：${c.path}`)
    if (c.summary) lines.push(`   - 摘要：${c.summary}`)
    const body = h.snippet.trim()
    if (body) {
      for (const line of body.split('\n').slice(0, 6)) lines.push(`   > ${line}`)
    }
    lines.push('')
  })
  lines.push('_只依据 wiki 页面作答；知识库没有的内容请直接说明，不要编造。_')
  return lines.join('\n')
}

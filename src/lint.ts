// Offline structural lint for harvested wiki pages (v0.4.6 — expanded per
// IMPROVEMENTS.md P0-6 after the firewall-library build burned ~2h reworking
// structurally-nonconforming pages that lint never flagged).
//
// The full llm-wiki lint/evaluate ships as Python scripts the session runs;
// this is the zero-dependency UI signal checked at harvest time:
//
//   R1  a page with no title (frontmatter `title` missing AND no heading)
//   R2  a broken internal link: `[text](foo.md)` whose target page was not harvested
//   R3  an orphan page: nothing links to it and it is not index.md
//   R4  frontmatter missing required keys (title/tags/sources/updated;
//       confidence/aliases/related warn-only)
//   R5  type-specific structure assertions: entity pages follow the template
//       H2 sections in order (定位/核心能力/架构/关系/场景/部署配置/参见) with
//       >=2 scenarios, >=1 two-column and >=1 three-column table; comparison
//       pages need >=4 H2 sections and the `> **简单规则**` blockquote; concept
//       pages need >=3 H2 sections
//   Y1  page too long (>800 lines or >30000 chars)
//   Y3  frontmatter `updated` not a valid YYYY-MM-DD date
//   Y4  too few cross-references (entity <3 outbound links, other pages <2)
//   Y5  no `type:` tag in frontmatter tags
//
// Every issue carries a ruleCode so the UI and the lint-fix prompt can name
// the violated rule. R5/Y* are warn-level on purpose: page templates differ
// across domains, and a false error that blocks would be worse than a hint.

import path from 'node:path'
import type { WikiLintReport, WikiPage } from './types.ts'

const MD_LINK = /\[[^\]]*\]\(([^)]+\.md)(#[^)]*)?\)/g

/** Entity-page template H2 sections, in required order (llm-wiki templates.md). */
const ENTITY_SECTIONS = ['定位', '核心能力', '架构', '关系', '场景', '部署配置', '参见']

const REQUIRED_FM_KEYS = ['title', 'tags', 'sources', 'updated']
const OPTIONAL_FM_KEYS = ['confidence', 'aliases', 'related']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Extract H2 heading texts (order preserved) from a page body. */
function h2Sections(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(.+)$/.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** Count `###` subsections and list items under a given H2 section. */
function scenarioCountUnder(text: string, sectionTitle: string): number {
  const lines = text.split(/\r?\n/)
  let inside = false
  let count = 0
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inside = line.slice(3).trim().includes(sectionTitle)
      continue
    }
    if (!inside) continue
    if (/^###\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) count++
  }
  return count
}

/** Column counts of every markdown table's header row (pipe-delimited lines
 *  followed by a |---| separator). */
function tableColumnCounts(text: string): number[] {
  const lines = text.split(/\r?\n/)
  const cols: number[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]
    const sep = lines[i + 1]
    if (!header.includes('|') || !/^\s*\|?[\s:|-]+\|/.test(sep)) continue
    if (!/^[\s|:-]+$/.test(sep)) continue
    cols.push(header.split('|').filter((c) => c.trim() !== '').length)
  }
  return cols
}

export function lintPages(pages: WikiPage[]): WikiLintReport {
  const issues: WikiLintReport['issues'] = []
  const push = (severity: 'error' | 'warn', ruleCode: string, message: string, page: string) =>
    issues.push({ severity, ruleCode, message, page })
  const present = new Set<string>()
  for (const p of pages) {
    present.add(normalize(p.path))
  }

  const inbound = new Map<string, number>()
  for (const p of pages) {
    const text = p.text ?? ''
    // R1: title
    if (!p.title || p.title.trim() === '' || /\.(md|markdown)$/i.test(p.title)) {
      push('warn', 'R1', '页面缺少标题', p.path)
    }
    // R4: frontmatter required keys
    const keys = new Set(p.frontKeys ?? [])
    const missingReq = REQUIRED_FM_KEYS.filter((k) => !keys.has(k))
    if (missingReq.length) {
      push('warn', 'R4', `frontmatter 缺必填字段: ${missingReq.join(', ')}`, p.path)
    }
    const missingOpt = OPTIONAL_FM_KEYS.filter((k) => !keys.has(k))
    if (missingOpt.length) {
      push('warn', 'R4', `frontmatter 缺建议字段: ${missingOpt.join(', ')}`, p.path)
    }
    // Y3: updated must be YYYY-MM-DD when present
    if (p.updated && !DATE_RE.test(p.updated)) {
      push('warn', 'Y3', `updated 不是 YYYY-MM-DD 格式: "${p.updated}"`, p.path)
    }
    // Y5: a type: tag
    if (!(p.tags ?? []).some((t) => t.startsWith('type:'))) {
      push('warn', 'Y5', 'frontmatter tags 缺少 type: 类型标签', p.path)
    }
    // Y1: oversized page
    {
      const lineCount = text.split(/\r?\n/).length
      if (lineCount > 800 || text.length > 30000) {
        push('warn', 'Y1', `页面超长（${lineCount} 行 / ${text.length} 字符），建议拆分`, p.path)
      }
    }
    // R2: broken links + record inbound targets
    let m: RegExpExecArray | null
    let outbound = 0
    MD_LINK.lastIndex = 0
    while ((m = MD_LINK.exec(text))) {
      const target = resolveLink(p.path, m[1])
      if (target && !present.has(target)) {
        push('error', 'R2', `链接指向不存在的页面 ${m[1]}`, p.path)
      } else if (target) {
        outbound++
        inbound.set(target, (inbound.get(target) ?? 0) + 1)
      }
    }
    // Y4: cross-reference density
    const minY4 = p.kind === 'entities' ? 3 : 2
    if (p.kind !== 'index' && outbound < minY4) {
      push('warn', 'Y4', `交叉引用不足（${p.kind} 页至少 ${minY4} 条出链，当前 ${outbound}）`, p.path)
    }
    // R5: type-specific structure
    if (p.kind === 'entities') {
      const h2 = h2Sections(text)
      const found = ENTITY_SECTIONS.filter((s) => h2.some((x) => x.includes(s)))
      if (found.length === 0) {
        push('warn', 'R5', `实体页未按模板组织 H2 小节（应为：${ENTITY_SECTIONS.join(' → ')}）`, p.path)
      } else {
        const missing = ENTITY_SECTIONS.filter((s) => !found.includes(s))
        if (missing.length) {
          push('warn', 'R5', `实体页缺 H2 小节: ${missing.join('、')}`, p.path)
        }
        const idx = found.map((s) => h2.findIndex((x) => x.includes(s)))
        for (let i = 1; i < idx.length; i++) {
          if (idx[i] < idx[i - 1]) {
            push('warn', 'R5', `实体页 H2 顺序与模板不符（应为：${ENTITY_SECTIONS.join(' → ')}）`, p.path)
            break
          }
        }
      }
      const sc = scenarioCountUnder(text, '场景')
      if (sc < 2) {
        push('warn', 'R5', `场景小节内容不足（子项 ${sc} 个，至少 2 个）`, p.path)
      }
      const cols = tableColumnCounts(text)
      if (!cols.some((c) => c >= 3)) {
        push('warn', 'R5', '缺少至少一个三列及以上表格（关系/配置类信息必须表格化）', p.path)
      }
      if (!cols.some((c) => c === 2)) {
        push('warn', 'R5', '缺少至少一个两列表格（如参数/取值对照）', p.path)
      }
    } else if (p.kind === 'comparisons') {
      const h2 = h2Sections(text)
      if (h2.length < 4) {
        push('warn', 'R5', `对比页 H2 小节不足（${h2.length} 个，应 ≥4）`, p.path)
      }
      if (!/>\s*\*\*简单规则\*\*/.test(text)) {
        push('warn', 'R5', '对比页缺「> **简单规则**」结论引用块', p.path)
      }
    } else if (p.kind === 'concepts') {
      const h2 = h2Sections(text)
      if (h2.length < 3) {
        push('warn', 'R5', `概念页 H2 小节不足（${h2.length} 个，应 ≥4 键）`, p.path)
      }
    }
  }

  // R3: orphans (index is exempt; a page with no inbound links)
  for (const p of pages) {
    if (p.kind === 'index') continue
    const count = inbound.get(normalize(p.path)) ?? 0
    if (count === 0) {
      issues.push({ severity: 'warn', ruleCode: 'R3', message: '孤立页面（没有任何页面链接到它）', page: p.path })
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
    issues,
  }
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/** Resolve a relative markdown link against the linking page's directory. */
function resolveLink(fromPath: string, link: string): string | null {
  if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('/')) return null
  const cleaned = link.replace(/^\.\//, '')
  const dir = path.posix.dirname(normalize(fromPath))
  const abs = path.posix.normalize(path.posix.join(dir, cleaned))
  return abs
}

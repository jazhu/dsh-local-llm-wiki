// Offline structural lint for harvested wiki pages (the v1 subset).
//
// The full llm-wiki lint/evaluate ships as Python scripts the user runs inside a
// session. Here we only want enough signal to flag a half-built wiki in the UI
// without any Python dependency, checked at harvest time:
//
//   R1  a page with no title (frontmatter `title` missing AND no heading)
//   R2  a broken internal link: `[text](foo.md)` whose target page was not harvested
//   R3  an orphan page: nothing links to it and it is not index.md
//
// All three are cheap over the already-parsed pages (path + body text), so this
// runs synchronously against the harvest result.

import path from 'node:path'
import type { WikiLintReport, WikiPage } from './types.ts'

const MD_LINK = /\[[^\]]*\]\(([^)]+\.md)(#[^)]*)?\)/g

export function lintPages(pages: WikiPage[]): WikiLintReport {
  const issues: WikiLintReport['issues'] = []
  const present = new Set<string>()
  for (const p of pages) {
    present.add(normalize(p.path))
  }

  const inbound = new Map<string, number>()
  for (const p of pages) {
    // R1: title
    if (!p.title || p.title.trim() === '' || /\.(md|markdown)$/i.test(p.title)) {
      issues.push({ severity: 'warn', message: `页面缺少标题`, page: p.path })
    }
    // R2: broken links + record inbound targets
    let m: RegExpExecArray | null
    MD_LINK.lastIndex = 0
    const text = p.text ?? ''
    while ((m = MD_LINK.exec(text))) {
      const target = resolveLink(p.path, m[1])
      if (target && !present.has(target)) {
        issues.push({ severity: 'error', message: `链接指向不存在的页面 ${m[1]}`, page: p.path })
      } else if (target) {
        inbound.set(target, (inbound.get(target) ?? 0) + 1)
      }
    }
  }

  // R3: orphans (index is exempt; a page with no inbound links)
  for (const p of pages) {
    if (p.kind === 'index') continue
    const count = inbound.get(normalize(p.path)) ?? 0
    if (count === 0) {
      issues.push({ severity: 'warn', message: `孤立页面（没有任何页面链接到它）`, page: p.path })
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

// dsh-local-llm-wiki structure test: no framework, node 22 strip-types, self-written
// harness (same style as dsh-knowledge-base/test/structure.test.ts).
//
// Run: node test/structure.test.ts

let checks = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail?: string): void {
  checks++
  if (!ok) {
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`  ok    ${name}`)
  }
}

// ---------------------------------------------------------------------------
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ProjectStore } from '../src/store.ts'
import { lintPages } from '../src/lint.ts'
import {
  DEFAULT_TOP_K,
  MAX_TOP_K,
  WikiIndex,
  formatHits,
  pageTokens,
  tokenize,
} from '../src/retrieve.ts'
import { parseWikiPage, splitFrontmatter, kindFromPath } from '../src/wiki-parse.ts'
import {
  WIKI_TOOL_NAMES,
  WIKI_PROJECTS_TOOL,
  WIKI_DONE_TOOL,
  defineWikiTools,
  type ToolDefinitionLike,
} from '../src/wiki-tools.ts'
import { resolveConfig, DEFAULT_CONFIG } from '../src/index.ts'
import type { WikiPage } from '../src/types.ts'

// ---- helpers ---------------------------------------------------------------

async function tmpStore(): Promise<{ store: ProjectStore; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-local-llm-wiki-test-'))
  return { store: new ProjectStore(dir), dir }
}

function page(p: Partial<WikiPage>): WikiPage {
  return {
    id: 'p',
    path: 'entities/x.md',
    kind: 'entities',
    title: 'X',
    tags: [],
    sources: [],
    confidence: 0.9,
    updated: '2026-01-01',
    text: '',
    summary: '',
    ...p,
  }
}

// ---- 1. resolveConfig -------------------------------------------------------

console.log('# resolveConfig')
{
  const cfg = resolveConfig(undefined, undefined)
  check('default apiPort 18781', cfg.apiPort === 18781)
  check('dataDir falls back to homedir', cfg.dataDir === path.join(os.homedir(), '.dsh', 'dsh-local-llm-wiki'))
  const cfg2 = resolveConfig({ dataDir: 'F:\\x', apiPort: 0 }, 'F:\\profile')
  check('explicit dataDir wins', cfg2.dataDir === 'F:\\x')
  check('bad apiPort falls back', cfg2.apiPort === DEFAULT_CONFIG.apiPort)
  const cfg3 = resolveConfig({ dataDir: '' }, 'F:\\profile')
  check('profile dir used when dataDir empty', cfg3.dataDir === path.join('F:\\profile', 'dsh-local-llm-wiki'))
}

// ---- 2. ProjectStore lifecycle ---------------------------------------------

console.log('# ProjectStore')
{
  const { store, dir } = await tmpStore()
  const p = await store.createProject({ name: '防火墙知识库', domain: '网络安全' })
  check('createProject returns metadata', !!p.id && p.name === '防火墙知识库' && p.status === 'empty')

  // upload
  const raw = Buffer.from('# 手册\n设备默认账号 admin。', 'utf8')
  const doc = await store.addUpload(p.id, { name: 'manual.md', mime: 'text/markdown', data: raw })
  check('addUpload writes raw file', !!(await store.scanRaw(p.id)).find((r) => r.name.endsWith('manual.md')))
  check('addUpload records RawDoc', !!doc.id && doc.sha256.length === 64)
  check('addUpload sets status uploaded', (await store.get(p.id))?.status === 'uploaded')
  const sha1 = doc.sha256

  // same name does not collide
  await store.addUpload(p.id, { name: 'manual.md', mime: 'text/markdown', data: Buffer.from('other', 'utf8') })
  const raws = await store.scanRaw(p.id)
  check('scanRaw sees 2 files (deterministic manifest)', raws.length === 2)

  // re-upload same content → same sha (manifest key for incremental ingest)
  const again = await store.addUpload(p.id, { name: 'm2.md', mime: 'text/markdown', data: raw })
  check('identical content → identical sha256', again.sha256 === sha1)

  // schema
  await store.writeSchema(p.id, '# SCHEMA\n- entities')
  check('writeSchema/readSchema roundtrip', (await store.readSchema(p.id))?.includes('SCHEMA') === true)

  // harvest: write wiki pages on disk then harvest
  const wikiDir = store.wikiDir(p.id)
  await fs.mkdir(path.join(wikiDir, 'entities'), { recursive: true })
  await fs.writeFile(
    path.join(wikiDir, 'entities', 'admin.md'),
    '---\ntitle: admin 账号\ntags: [账号]\nconfidence: high\n---\n\n# admin 账号\n\n默认账号 admin。',
    'utf8',
  )
  await fs.writeFile(path.join(wikiDir, 'index.md'), '# 索引\n- [admin 账号](entities/admin.md)', 'utf8')
  // stray file outside whitelist must NOT enter the index
  await fs.writeFile(path.join(wikiDir, 'stray.md'), '# 走私页', 'utf8')
  const pages = await store.harvest(p.id)
  check('harvest finds whitelisted pages only', pages.length === 2, `got ${pages.length}`)
  check('harvest sets pageCount', (await store.get(p.id))?.pageCount === 2)
  // status ready is set by ingestDone (host layer), not by harvest itself
  check('harvest keeps non-midflight status', (await store.get(p.id))?.status === 'uploaded')

  // readPage path traversal guard
  const ok = await store.readPage(p.id, 'entities/admin.md')
  check('readPage returns content', (ok ?? '').includes('admin'))
  const evil = await store.readPage(p.id, '..\\..\\registry.json')
  check('readPage blocks traversal', evil === null)

  // persistence across reload
  const store2 = new ProjectStore(dir)
  await store2.load()
  check('registry persists', store2.list().length === 1)
  check('registry keeps pageCount', store2.get(p.id)?.pageCount === 2)

  // markStalled: pages live on disk (harvest succeeds) → recovered to ready,
  // NOT wrongly condemned as failed (v0.4.6 boot-recovery fix).
  await store2.updateProject(p.id, { status: 'ingesting' })
  const { stalled, recovered } = await store2.markStalled()
  check(
    'markStalled recovers mid-flight projects with pages on disk',
    stalled.length === 0 && recovered.length === 1 && store2.get(p.id)?.status === 'ready' && store2.get(p.id)?.error === undefined,
  )
  check(
    'markStalled flags mid-flight projects without content',
    await (async () => {
      await store2.updateProject(p.id, { status: 'ingesting' })
      // wipe the harvested pages so recovery finds no content
      const { rm } = await import('node:fs/promises')
      await rm(store2.wikiDir(p.id), { recursive: true, force: true })
      const r = await store2.markStalled()
      return r.stalled.length === 1 && store2.get(p.id)?.status === 'failed' && !!store2.get(p.id)?.error
    })(),
  )

  // delete
  check('deleteProject removes', await store2.deleteProject(p.id) === true)
  check('registry empty after delete', store2.list().length === 0)
}

// ---- 3. wiki-parse ----------------------------------------------------------

console.log('# wiki-parse')
{
  const md = '---\ntitle: 会话保持\ntags: [负载均衡, 会话]\nsources: [lb.pdf]\nconfidence: 0.8\nupdated: 2026-06-01\n---\n\n# 会话保持\n\n会话保持把同一客户端固定到同一后端。'
  const { front, body } = splitFrontmatter(md)
  check('splitFrontmatter isolates yaml', !!front && front.includes('title:') && body.includes('会话保持'))
  const parsed = parseWikiPage({ id: 'a', path: 'concepts/session.md', relPath: 'concepts/session.md', markdown: md })
  check('kindFromPath concepts', kindFromPath('concepts/session.md') === 'concepts' || kindFromPath('wiki/concepts/session.md') === 'concepts')
  check('kindFromPath unknown → other', kindFromPath('notes/x.md') === 'other')
  check('parseWikiPage kind', parsed.kind === 'concepts')
  check('parseWikiPage title from frontmatter', parsed.title === '会话保持')
  check('parseWikiPage tags list', parsed.tags.join(',') === '负载均衡,会话')
  check('parseWikiPage confidence normalized', Math.abs(parsed.confidence - 0.8) < 1e-9)
  check('parseWikiPage gist from body', parsed.summary.includes('同一客户端'))
}

// ---- 4. lint ----------------------------------------------------------------

console.log('# lint')
{
  const pages = [
    page({ id: 'i', path: 'index.md', kind: 'index', text: '# 索引\n- [A](entities/a.md)\n- [幽灵](entities/ghost.md)' }),
    page({ id: 'a', path: 'entities/a.md', kind: 'entities', text: '# A\n内容' }),
    page({ id: 'o', path: 'concepts/orphan.md', kind: 'concepts', text: '# 孤儿' }),
    page({ id: 'nt', path: 'entities/notitle.md', kind: 'entities', text: '正文没有标题' }),
  ]
  const report = lintPages(pages)
  check('R2 broken link flagged', report.issues.some((i) => i.message.includes('entities/ghost.md')))
  check('R3 orphan flagged', report.issues.some((i) => i.page === 'concepts/orphan.md'))
  check('R1 missing title flagged', report.issues.some((i) => i.page === 'entities/notitle.md'))
  check('missing title is an error', report.errorCount >= 1)
}

// ---- 5. retrieve ------------------------------------------------------------

console.log('# retrieve')
{
  check('topK defaults', DEFAULT_TOP_K === 5 && MAX_TOP_K === 12)
  const idx = new WikiIndex()
  const mk = (id: string, title: string, text: string): WikiPage =>
    page({ id, title, text, path: `entities/${id}.md` })
  idx.addProject('p1', '防火墙', [
    mk('a', 'NAT 配置', 'NAT 源地址转换 配置 命令 nat 命令'),
    mk('b', 'VPN 配置', 'IPSec VPN 隧道 配置 加密 提议'),
  ])
  idx.addProject('p2', '交换机', [mk('c', 'VLAN 划分', 'VLAN 划分 命令 trunk')])

  check('tokenize CJK unigram+bigram', tokenize('NAT配置').includes('配置') && tokenize('NAT配置').includes('nat'))
  check('pageTokens repeats title (TITLE_REPEAT)', pageTokens(mk('a', 'NAT', 'nat 正文')).filter((t) => t === 'nat').length > 1)

  const hits = idx.search('NAT 配置', { projectId: 'p1' })
  check('search returns ranked hits', hits.length >= 1 && hits[0].page.id === 'a')
  check('snippet contains query terms', (hits[0].snippet ?? '').length > 0)

  const cross = idx.search('VLAN')
  check('cross-project search hits p2', cross.length >= 1 && cross[0].projectId === 'p2')

  idx.removeProject('p2')
  check('removeProject clears pages', idx.search('VLAN').length === 0)

  const rendered = formatHits('NAT', hits)
  check('formatHits renders markdown', rendered.includes('NAT'))

  idx.clear()
  check('clear empties index', idx.size === 0)
}

// ---- 6. tools ---------------------------------------------------------------

console.log('# wiki-tools')
{
  const registered: ToolDefinitionLike[] = []
  let doneCalled = false
  const tools = defineWikiTools({
    listProjects: () => [{ id: 'p1', name: '防火墙', status: 'ready', pageCount: 2, domain: '', updatedAt: '' }],
    getProject: (id) => (id === 'p1' ? { id: 'p1', name: '防火墙', status: 'ready', pageCount: 2, lint: { errorCount: 0, warnCount: 1 } } : undefined),
    search: () => [
      {
        projectId: 'p1',
        projectName: '防火墙',
        page: { id: 'a', path: 'entities/a.md', kind: 'entities', title: 'NAT', tags: [] },
        score: 3.2,
        snippet: 'NAT 配置命令',
      },
    ],
    readPage: async () => '# NAT\n命令',
    ingestDone: async () => {
      doneCalled = true
      return { ok: true, pages: 2 }
    },
  })
  for (const t of tools) registered.push(t)

  check('five tools defined', tools.length === 5)
  check('tool names match constants', JSON.stringify(registered.map((t) => t.name)) === JSON.stringify(WIKI_TOOL_NAMES))

  const schema = (registered[0].parameters as unknown) as Record<string, unknown>
  check('parameters are FULL JSON Schema', schema.type === 'object' && typeof schema.properties === 'object' && Array.isArray(schema.required))

  const searchTool = registered.find((t) => t.name === 'wiki_search')!
  const raw = await searchTool.execute({ query: 'NAT', projectId: 'p1' })
  const out = JSON.parse(raw) as { ok: boolean; count: number; text?: string; hits?: unknown[] }
  check('wiki_search executes', out.ok === true && out.count >= 1 && typeof out.text === 'string')
  check('output.render returns text blocks', (searchTool as unknown as { output?: { render?: unknown } }).output !== undefined)

  const doneTool = registered.find((t) => t.name === WIKI_DONE_TOOL)!
  const doneRaw = await doneTool.execute({ projectId: 'p1', wikiDir: 'wiki' })
  check('wiki_done calls ingestDone', doneCalled && JSON.parse(doneRaw).ok === true)
  check('read tools concurrency-safe, wiki_done not', registered.filter((t) => t.name !== WIKI_DONE_TOOL).every((t) => t.isConcurrencySafe() === true) && registered.find((t) => t.name === WIKI_DONE_TOOL)!.isConcurrencySafe() === false)
}

console.log('')
if (failures.length) {
  console.error(`FAIL ${failures.length}/${checks} checks`)
  process.exit(1)
} else {
  console.log(`PASS ${checks}/${checks} checks`)
  process.exit(0)
}

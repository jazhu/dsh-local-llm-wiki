// The model-facing tools of dsh-local-llm-wiki.
//
// Five tools, split along the lines a wiki knowledge base actually needs:
//
//   wiki_projects  what knowledge bases exist at all
//   wiki_status    one project's build state (+ lint counts)
//   wiki_search    passages across the harvested wiki pages
//   wiki_read      one page, whole
//   wiki_done      back-channel from a DSH session that just built the wiki
//
// Parameter shape note (the reason this differs from dsh-knowledge-base):
// the host profile that runs a stricter tool-registry (dsh-syslog-alert proved
// it) requires `parameters` to be a FULL JSON Schema object
// (`{ type:'object', properties:{...}, required:[...] }`), not the flat
// per-property DSL. dsh-local-llm-wiki follows the stricter contract so it registers on
// every profile. `execute` returns the `output.schema`-shaped JSON string; the
// host validates it.

export const WIKI_PROJECTS_TOOL = 'wiki_projects'
export const WIKI_STATUS_TOOL = 'wiki_status'
export const WIKI_SEARCH_TOOL = 'wiki_search'
export const WIKI_READ_TOOL = 'wiki_read'
export const WIKI_DONE_TOOL = 'wiki_done'
export const WIKI_TOOL_NAMES = [
  WIKI_PROJECTS_TOOL,
  WIKI_STATUS_TOOL,
  WIKI_SEARCH_TOOL,
  WIKI_READ_TOOL,
  WIKI_DONE_TOOL,
] as const

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
  additionalProperties?: boolean
}

export interface ToolDefinitionLike {
  name: string
  description: string
  parameters: JsonSchema
  output: { schema: unknown; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
  isConcurrencySafe(): boolean
  execute(args: Record<string, unknown>, exec?: { signal?: AbortSignal }): Promise<string>
}

export interface WikiToolsDeps {
  listProjects(): { id: string; name: string; status: string; pageCount: number; domain: string; updatedAt: string }[]
  getProject(id: string): { id: string; name: string; status: string; pageCount: number; lint?: { errorCount: number; warnCount: number } | null; error?: string } | undefined
  /** Run BM25 across all (or one) project's pages. */
  search(query: string, opts: { projectId?: string; topK?: number }): {
    projectId: string
    projectName: string
    page: { id: string; path: string; kind: string; title: string; tags: string[] }
    score: number
    snippet: string
  }[]
  readPage(projectId: string, pagePath: string): Promise<string | null>
  /** The authoritative completion callback: harvest + index one project. */
  ingestDone(projectId: string, wikiDir: string): Promise<{ ok: boolean; pages?: number; error?: string }>
}

/** Minimal local `defineTool` shim: an identity-ish constructor that keeps the shape readable. */
function defineTool(def: ToolDefinitionLike): ToolDefinitionLike {
  return def
}

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

export function defineWikiTools(deps: WikiToolsDeps): ToolDefinitionLike[] {
  const tools: ToolDefinitionLike[] = []

  tools.push(
    defineTool({
      name: WIKI_PROJECTS_TOOL,
      description: '列出 dsh-local-llm-wiki 里所有知识库项目（名称、状态、页面数、更新时间）。回答"我有哪些知识库/某个库叫什么"时先用它。',
      parameters: obj({}),
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v ?? '') }],
      },
      isConcurrencySafe: () => true,
      execute: async () => {
        const list = deps.listProjects()
        if (!list.length) return JSON.stringify({ ok: true, projects: [], message: '还没有任何知识库项目。' })
        const lines = [`共 ${list.length} 个知识库项目：`, '']
        for (const p of list) {
          lines.push(`- ${p.name}（id=${p.id}，状态=${p.status}，页面=${p.pageCount}${p.domain ? '，领域：' + p.domain : ''}，更新=${p.updatedAt.slice(0, 10)}）`)
        }
        return JSON.stringify({ ok: true, count: list.length, text: lines.join('\n') })
      },
    }),
  )

  tools.push(
    defineTool({
      name: WIKI_STATUS_TOOL,
      description: '查询某个知识库项目的构建状态与质量计数（页面数、lint 错误/告警数、错误信息）。',
      parameters: obj({ projectId: { type: 'string', description: '项目 id（来自 wiki_projects）' } }, ['projectId']),
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v ?? '') }],
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const id = String(args.projectId || '')
        if (!id) return JSON.stringify({ ok: false, error: '需要 projectId。' })
        const p = deps.getProject(id)
        if (!p) return JSON.stringify({ ok: false, error: `找不到项目 ${id}` })
        return JSON.stringify({
          ok: true,
          projectId: p.id,
          name: p.name,
          status: p.status,
          pageCount: p.pageCount,
          lint: p.lint ?? null,
          error: p.error ?? null,
        })
      },
    }),
  )

  tools.push(
    defineTool({
      name: WIKI_SEARCH_TOOL,
      description: '在所有（或指定）知识库的 wiki 页面里做全文检索，返回命中的页面与片段。问知识库相关问题时优先用它定位页面，再用 wiki_read 读全文。',
      parameters: obj({
        query: { type: 'string', description: '自然语言查询' },
        projectId: { type: 'string', description: '可选：限定某个项目 id' },
        topK: { type: 'number', description: '返回条数，默认 5，最多 12' },
      }, ['query']),
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v ?? '') }],
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const query = String(args.query || '').trim()
        if (!query) return JSON.stringify({ ok: false, error: '需要 query。' })
        const hits = deps.search(query, {
          projectId: args.projectId ? String(args.projectId) : undefined,
          topK: typeof args.topK === 'number' ? args.topK : undefined,
        })
        if (!hits.length) return JSON.stringify({ ok: true, count: 0, message: `没有与「${query}」相关的 wiki 页面。` })
        const lines = [`检索「${query}」命中 ${hits.length} 个页面：`, '']
        hits.forEach((h, i) => {
          lines.push(`${i + 1}. ${h.page.title}（${h.projectName} · ${h.page.kind}）`)
          lines.push(`   - 读取路径：projectId="${h.projectId}", path="${h.page.path}"`)
          if (h.page.tags.length) lines.push(`   - 标签：${h.page.tags.join('、')}`)
          const body = (h.snippet || '').trim()
          if (body) for (const line of body.split('\n').slice(0, 4)) lines.push(`   > ${line}`)
          lines.push('')
        })
        lines.push('_只依据 wiki 页面作答；没有的内容请明说，不要编造。需要全文请用 wiki_read。_')
        return JSON.stringify({ ok: true, count: hits.length, text: lines.join('\n') })
      },
    }),
  )

  tools.push(
    defineTool({
      name: WIKI_READ_TOOL,
      description: '按 projectId + 页面相对路径读取某个 wiki 页面的完整 Markdown（检索命中后用它的 path）。',
      parameters: obj({
        projectId: { type: 'string', description: '项目 id' },
        path: { type: 'string', description: '页面相对路径（来自 wiki_search 的 path，如 entities/foo.md）' },
      }, ['projectId', 'path']),
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v ?? '') }],
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const projectId = String(args.projectId || '')
        const pagePath = String(args.path || '')
        if (!projectId || !pagePath) return JSON.stringify({ ok: false, error: '需要 projectId 与 path。' })
        const md = await deps.readPage(projectId, pagePath)
        if (md === null) return JSON.stringify({ ok: false, error: `找不到页面 ${projectId}/${pagePath}` })
        return JSON.stringify({ ok: true, projectId, path: pagePath, markdown: md })
      },
    }),
  )

  // Back-channel from the ingest session. ALWAYS registered (never behind a
  // sessionController gate — the lesson from dsh-knowledge-base's 17:32
  // "create returned no session id": the controller arrives later than the
  // effect, so a ternary gate would leave this tool permanently undefined).
  tools.push(
    defineTool({
      name: WIKI_DONE_TOOL,
      description: '由构建 wiki 的 DSH 会话在完成后调用，把 <wiki>/ 目录收割进知识库并建索引。参数为 projectId 与 wikiDir。',
      parameters: obj({
        projectId: { type: 'string', description: '项目 id（务必与提交时一致）' },
        wikiDir: { type: 'string', description: '刚写入页面的 wiki 目录绝对路径' },
      }, ['projectId', 'wikiDir']),
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v ?? '') }],
      },
      isConcurrencySafe: () => false,
      execute: async (args) => {
        const projectId = String(args.projectId || '')
        const wikiDir = String(args.wikiDir || '')
        if (!projectId || !wikiDir) {
          return JSON.stringify({ ok: false, error: 'wiki_done 需要 projectId 与 wikiDir 两个参数。' })
        }
        try {
          const result = await deps.ingestDone(projectId, wikiDir)
          if (!result.ok) return JSON.stringify({ ok: false, error: result.error ?? 'harvest 失败' })
          return JSON.stringify({ ok: true, pages: result.pages ?? 0, message: '知识库已更新，现在可以检索了。' })
        } catch (err) {
          return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      },
    }),
  )

  return tools
}

// dsh-local-llm-wiki host half.
//
// Responsibilities:
//   * own the on-disk store (ProjectStore) + in-memory BM25 index (WikiIndex)
//   * run every model/UI tool (wiki_projects / wiki_status / wiki_search /
//     wiki_read / wiki_done) in-process
//   * self-host a loopback HTTP API at 127.0.0.1:<apiPort>/wiki-api for the
//     browser client (upload, design, confirm, ingest, status, search, read)
//   * drive DSH sessions for design + ingest and harvest their output
//
// The API is intentionally unauthenticated: it binds 127.0.0.1 only and the
// browser client is same-origin-ish (a fixed loopback port). The tools, by
// contrast, stay in-process and never touch the socket.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { ProjectStore } from './store.ts'
import { WikiIndex, type WikiHit } from './retrieve.ts'
import { defineWikiTools } from './wiki-tools.ts'
import {
  acquireSessionController,
  setPermissionPresetsSink,
  submitBuild,
  submitDesign,
  submitIngest,
  submitLintFix,
  type SessionControllerLike,
} from './session-ingest.ts'
import { lintPages } from './lint.ts'

export const name = 'dsh-local-llm-wiki'

export const inject = [] as const

export interface Config {
  dataDir: string
  ingestAgentPreset: string
  /** Permission preset applied to new design/ingest sessions, e.g. 'auto' (Auto review). Empty = host default. */
  ingestPermissionPreset: string
  /** Host workspace id new build sessions are created in. Empty = host default workspace. */
  ingestWorkspaceId: string
  /** Model pool selection applied to new build sessions ("provider/model"). Empty = host default model. */
  ingestModel: string
  apiPort: number
}

export const DEFAULT_CONFIG: Config = {
  dataDir: '',
  ingestAgentPreset: '',
  ingestPermissionPreset: 'auto',
  ingestWorkspaceId: '',
  ingestModel: '',
  apiPort: 18781,
}

export function resolveConfig(config?: Partial<Config>, profileDataDir?: string): Config {
  const apiPort = Number(config?.apiPort ?? DEFAULT_CONFIG.apiPort)
  const ingestAgentPreset = (config?.ingestAgentPreset ?? DEFAULT_CONFIG.ingestAgentPreset) || ''
  const ingestPermissionPreset = (config?.ingestPermissionPreset ?? DEFAULT_CONFIG.ingestPermissionPreset) || ''
  const ingestWorkspaceId = (config?.ingestWorkspaceId ?? DEFAULT_CONFIG.ingestWorkspaceId) || ''
  const ingestModel = (config?.ingestModel ?? DEFAULT_CONFIG.ingestModel) || ''
  let dataDir = ((config?.dataDir ?? DEFAULT_CONFIG.dataDir) || '').trim()
  if (!dataDir) {
    if (profileDataDir && profileDataDir.trim()) {
      dataDir = path.join(profileDataDir.trim(), 'dsh-local-llm-wiki')
    } else {
      dataDir = path.join(os.homedir(), '.dsh', 'dsh-local-llm-wiki')
    }
  }
  return {
    dataDir,
    ingestAgentPreset,
    ingestPermissionPreset,
    ingestWorkspaceId,
    ingestModel,
    apiPort: Number.isFinite(apiPort) && apiPort > 0 ? apiPort : DEFAULT_CONFIG.apiPort,
  }
}

/** Parse the settings-page model selection "provider/model" into its parts. */
function parseModelSelection(s: string): { provider: string; model: string } | undefined {
  const idx = s.indexOf('/')
  if (idx <= 0 || idx === s.length - 1) return undefined
  return { provider: s.slice(0, idx), model: s.slice(idx + 1) }
}

/** The slice of the host context this plugin uses. */
export interface ContextLike {
  inject: (deps: string[], cb: (sctx: any) => void, label?: string) => void
  logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void }
  getConfigPath?: () => string
  webServer?: {
    register?: (route: { kind: 'prefix' | 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => void
  }
}

const API_PREFIX = '/wiki-api'

// Trace file for activation debugging (2026-10-09): the host swallows apply()
// failures, so write every milestone to a file the model can read. Remove once
// the plugin is confirmed to start on every profile.
const TRACE_FILE = path.join(os.homedir(), '.dsh', 'dsh-local-llm-wiki-activation.log')
function trace(msg: string, error?: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}${
      error ? ` | ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)}` : ''
    }\n`
    appendFileSync(TRACE_FILE, line)
  } catch {
    /* tracing must never break activation */
  }
}

export function apply(ctx: ContextLike, config?: Partial<Config>): void {
  // apply throwing marks the whole fiber FAILED (guide 3.2): no tools, no
  // server, and the client panel reports "Failed to fetch". A degraded wiki
  // that logs a warning is strictly better - wrap everything (the
  // dsh-knowledge-base lesson, 2026-10-09).
  trace(`apply called; config=${JSON.stringify(config ?? null)}`)
  try {
    activate(ctx, config)
    trace('activate returned')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    trace(`activation degraded: ${message}`, error)
    try {
      ctx.logger?.warn?.(`[dsh-local-llm-wiki] activation degraded: ${message}`)
    } catch {
      /* logger itself unavailable - nothing more we can do */
    }
  }
}

function activate(ctx: ContextLike, config?: Partial<Config>): void {
  // Profile data dir is read defensively: a bare ctx property read can throw
  // "cannot get property without inject" on the cordis proxy, so wrap + fall back.
  let profileDataDir: string | undefined
  try {
    const p = ctx.getConfigPath?.()
    if (typeof p === 'string' && p.trim()) profileDataDir = p.trim()
  } catch {
    profileDataDir = undefined
  }

  const resolved = resolveConfig(config, profileDataDir)
  trace(`activate start; resolved=${JSON.stringify(resolved)}`)
  const logger = ctx.logger ?? undefined
  const logInfo = (m: string) => logger?.info?.(`[dsh-local-llm-wiki] ${m}`)
  const logWarn = (m: string) => logger?.warn?.(`[dsh-local-llm-wiki] ${m}`)
  const logErr = (m: string) => logger?.error?.(`[dsh-local-llm-wiki] ${m}`)

  const store = new ProjectStore(resolved.dataDir)
  const index = new WikiIndex()
  let sessionController: SessionControllerLike | undefined
  // Host services captured lazily for the settings page (model pool + workspaces).
  let llmService: any
  let workspaceRegistry: any

  // ---- bootstrap: load store, rebuild index, recover drafts, mark stalled ----------------
  void (async () => {
    await store.load()
    // Settings persistence (2026-10-11): overlay the saved settings-page values
    // onto the runtime config so they survive restarts (the "settings revert"
    // bug — runtime config was previously the only copy).
    try {
      await store.loadSettingsInto(resolved)
      const s = await store.readSettings()
      if (s.ingestWorkspaceId !== undefined || s.ingestModel !== undefined) {
        logInfo(`已恢复持久化设置: workspace=${s.ingestWorkspaceId ?? '(默认)'} model=${s.ingestModel ?? '(默认)'}`)
      }
    } catch (e) {
      logWarn(`恢复持久化设置失败（使用宿主配置）: ${e instanceof Error ? e.message : String(e)}`)
    }
    // A project stuck in `designing` whose SCHEMA.md already landed (session
    // finished the design just before a restart) must NOT be marked failed —
    // recover it to `awaiting-schema-confirm` first, then mark the rest stalled.
    for (const p of store.list()) {
      if (p.status === 'designing') {
        try {
          const schema = await store.readSchema(p.id)
          if (schema) {
            await store.updateProject(p.id, { status: 'awaiting-schema-confirm', schemaDraft: schema })
            continue
          }
        } catch { /* fall through to markStalled */ }
      }
    }
    const stalled = await store.markStalled()
    if (stalled.length) logWarn(`已标记 ${stalled.length} 个中断的项目为 failed`)
    // Re-index every project that has harvested pages on disk.
    for (const p of store.list()) {
      if (p.pageCount > 0) {
        try {
          const pages = await store.harvest(p.id)
          const docs = await store.scanRaw(p.id)
          void docs
          index.addProject(p.id, p.name, pages)
          store.setLint(p.id, lintPages(pages))
        } catch (err) {
          logErr(`reindex ${p.id} 失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    logInfo(`已就绪，数据目录 ${resolved.dataDir}`)
  })()

  // ---- session controller (for design + ingest) --------------------------
  acquireSessionController(ctx, (ctrl) => {
    sessionController = ctrl
    trace(`sessionController assigned; create=${typeof ctrl.create} prompt=${typeof ctrl.prompt}`)
    logInfo('已接入 sessionController，可提交 design / ingest 会话')
  })
  // Capture the host permissionPresets service so submit() can switch new
  // ingest sessions to the Auto review preset when the auto-review layer is on.
  setPermissionPresetsSink((presets) => {
    logInfo('已接入 permissionPresets（Auto review 会话预设可用）')
  })
  // Host llm (model pool for the settings page) + workspaceRegistry (workspace
  // list). Both optional: a headless profile simply hides those dropdowns.
  try {
    ctx.inject(['llm'], (sctx: any) => {
      const l = sctx?.llm
      if (l && typeof l.listProviders === 'function') llmService = l
    })
  } catch { /* no llm service */ }
  try {
    ctx.inject(['workspaceRegistry'], (sctx: any) => {
      const w = sctx?.workspaceRegistry
      if (w && typeof w.list === 'function') workspaceRegistry = w
    })
  } catch { /* no workspace registry */ }

  // Built-in llm-wiki skill (requirement ③): bundled at dist/skills/llm-wiki.md
  // and injected into every build-session prompt, so the session never depends
  // on an external skill directory being installed. ESM has no __dirname —
  // derive the bundle dir from import.meta.url.
  let builtinSkill = ''
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    builtinSkill = readFileSync(path.join(here, 'skills', 'llm-wiki.md'), 'utf-8')
    logInfo(`已内置 llm-wiki 技能（${builtinSkill.length} 字符，将注入构建会话）`)

    // Auto-register the bundled skill into the host global skill dir
    // (user-requested 2026-10-11): installing the plugin makes llm-wiki
    // available to every DSH session, not only plugin-driven build sessions.
    // The skill dir is <home>/.dsh/skills/<name>/SKILL.md; we write only when
    // the content differs (version upgrades flow through on restart) and all
    // writes are best-effort — a failure never blocks plugin activation.
    try {
      const skillsRoot = path.join(os.homedir(), '.dsh', 'skills', 'llm-wiki')
      const skillFile = path.join(skillsRoot, 'SKILL.md')
      let existing = ''
      try { existing = readFileSync(skillFile, 'utf-8') } catch { /* first install */ }
      if (existing !== builtinSkill) {
        mkdirSync(skillsRoot, { recursive: true })
        writeFileSync(skillFile, builtinSkill, 'utf-8')
        logInfo(`已将内置 llm-wiki 技能注册到宿主技能目录: ${skillFile}`)
      }
    } catch (e) {
      logWarn(`llm-wiki 技能注册到宿主技能目录失败（不影响插件功能）: ${e instanceof Error ? e.message : String(e)}`)
    }
  } catch (e) {
    logWarn(`内置 llm-wiki 技能读取失败，会话将回退为提示词自述: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ---- tools: registered UNCONDITIONALLY (the kb_ingest_done lesson) ------
  const tools = defineWikiTools({
    listProjects: () =>
      store.list().map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        pageCount: p.pageCount,
        domain: p.domain,
        updatedAt: p.updatedAt,
      })),
    getProject: (id) => {
      const p = store.get(id)
      if (!p) return undefined
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        pageCount: p.pageCount,
        lint: p.lint ? { errorCount: p.lint.errorCount, warnCount: p.lint.warnCount } : null,
        error: p.error,
      }
    },
    search: (query, opts) => {
      const hits = index.search(query, { projectId: opts.projectId, topK: opts.topK })
      return hits.map((h: WikiHit) => ({
        projectId: h.projectId,
        projectName: h.projectName,
        page: {
          id: h.page.id,
          path: h.page.path,
          kind: h.page.kind,
          title: h.page.title,
          tags: h.page.tags,
        },
        score: h.score,
        snippet: h.snippet,
      }))
    },
    readPage: (projectId, pagePath) => store.readPage(projectId, pagePath),
    ingestDone: async (projectId, wikiDir) => {
      try {
        const pages = await store.harvest(projectId, wikiDir)
        const p = store.get(projectId)
        if (!p) return { ok: false, error: `找不到项目 ${projectId}` }
        index.addProject(projectId, p.name, pages)
        store.setLint(projectId, lintPages(pages))
        await store.updateProject(projectId, { status: 'ready', error: undefined })
        return { ok: true, pages: pages.length }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await store.updateProject(projectId, { status: 'failed', error: msg })
        return { ok: false, error: msg }
      }
    },
  })

  // Tools must be acquired through ctx.inject(['tools']): a bare `ctx.tools`
  // read trips the cordis context proxy ("cannot get property without
  // inject"), which is the prime suspect for the 2026-10-09 FAILED activation.
  try {
    trace('injecting [tools]')
    ctx.inject(['tools'], (tctx: any) => {
      try {
        const registry = tctx?.tools
        if (!registry || typeof registry.register !== 'function') return
        for (const t of tools) registry.register(t)
        trace(`registered ${tools.length} tools`)
        logInfo('wiki_* 工具已注册')
      } catch (e) {
        logWarn(`wiki_* 工具注册失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  } catch (e) {
    trace('ctx.inject(["tools"]) failed', e)
    logWarn('ctx.inject(["tools"]) 不可用，wiki_* 工具未注册（仅 API 可用）')
  }

  // ---- loopback server ---------------------------------------------------
  const deps = {
    store,
    index,
    resolved,
    getSession: () => sessionController,
    getLlm: () => llmService,
    getWorkspaces: () => workspaceRegistry,
    // Settings-page writes mutate the module-level runtime config so every
    // later submit picks them up without restarting DSH (persistence in the
    // profile config file is a host-owned concern; the runtime copy is the
    // source of truth within this process).
    saveSettings: (patch: { ingestWorkspaceId?: string; ingestModel?: string }) => {
      if (patch.ingestWorkspaceId !== undefined) resolved.ingestWorkspaceId = patch.ingestWorkspaceId.trim()
      if (patch.ingestModel !== undefined) resolved.ingestModel = patch.ingestModel.trim()
      // Persist immediately (2026-10-11): fire-and-forget — the runtime copy is
      // updated synchronously, the disk copy lands in <dataDir>/settings.json.
      void store.saveSettings({
        ingestWorkspaceId: patch.ingestWorkspaceId?.trim(),
        ingestModel: patch.ingestModel?.trim(),
      })
      return resolved
    },
    logInfo,
    logWarn,
    logErr,
    submitDesign: async (projectId: string) => {
      const ctrl = sessionController
      if (!ctrl) throw new Error('本 profile 无 sessionController，design 不可用')
      const p = store.get(projectId)
      if (!p) throw new Error('project not found')
      const rawDocs = await store.scanRaw(projectId)
      const r = await submitDesign({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || undefined,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
      })
      await store.updateProject(projectId, { status: 'designing', dshSessionId: r.sessionId })
      return r.sessionId
    },
    submitIngest: async (projectId: string) => {
      const ctrl = sessionController
      if (!ctrl) throw new Error('本 profile 无 sessionController，ingest 不可用')
      const p = store.get(projectId)
      if (!p) throw new Error('project not found')
      if (!p.schemaConfirmed) throw new Error('请先确认 SCHEMA 后再构建')
      const rawDocs = await store.scanRaw(projectId)
      const r = await submitIngest({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || undefined,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: 'wiki_done',
      })
      await store.updateProject(projectId, { status: 'ingesting', dshSessionId: r.sessionId })
      return r.sessionId
    },
    submitBuild: async (projectId: string) => {
      const ctrl = sessionController
      if (!ctrl) throw new Error('本 profile 无 sessionController，构建不可用')
      const p = store.get(projectId)
      if (!p) throw new Error('project not found')
      const rawDocs = await store.scanRaw(projectId)
      if (!rawDocs.length) throw new Error('项目还没有上传任何文档，请先上传')
      const r = await submitBuild({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || undefined,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: 'wiki_done',
      })
      await store.updateProject(projectId, { status: 'ingesting', dshSessionId: r.sessionId, schemaConfirmed: false })
      return r.sessionId
    },
    submitLintFix: async (projectId: string) => {
      const ctrl = sessionController
      if (!ctrl) throw new Error('本 profile 无 sessionController，lint 修复不可用')
      const p = store.get(projectId)
      if (!p) throw new Error('project not found')
      const report = p.lint
      if (!report || (!report.errorCount && !report.warnCount)) throw new Error('当前没有需要修复的 lint 问题')
      const rawDocs = await store.scanRaw(projectId)
      const reportText = report.issues
        .map((i) => `- [${i.severity === 'error' ? 'error' : 'warn'}] ${i.page}: ${i.message}`)
        .join('\n')
      const r = await submitLintFix({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || undefined,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: 'wiki_done',
        lintReport: reportText || '（无详细条目）',
      })
      await store.updateProject(projectId, { status: 'ingesting', dshSessionId: r.sessionId })
      return r.sessionId
    },
    // Design completion is detected by the presence of SCHEMA.md on disk.
    // Also recovers a project that markStalled() failed after a restart: the
    // session is gone but the draft may already be sitting in the wiki dir.
    advanceDesign: async (projectId: string) => {
      const p = store.get(projectId)
      if (!p) return undefined
      if (p.status === 'designing' || p.status === 'failed') {
        const schema = await store.readSchema(projectId)
        if (schema && !p.schemaConfirmed) {
          await store.updateProject(projectId, {
            status: 'awaiting-schema-confirm',
            schemaDraft: schema,
            error: undefined,
          })
        }
      }
      return store.get(projectId)
    },
  }

  const server = createServer(async (req, res) => {
    setCors(res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    try {
      await handleApiRequest(req, res, deps)
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err)
      writeError(res, 'internal', msg, 500)
    }
  })

  server.once('error', (e: Error) => {
    trace(`loopback server error on :${resolved.apiPort}`, e)
    logWarn(`loopback server :${resolved.apiPort} 启动失败: ${e.message}`)
  })
  trace(`calling server.listen(${resolved.apiPort}, 127.0.0.1)`)
  server.listen(resolved.apiPort, '127.0.0.1', () => {
    trace(`listening on ${resolved.apiPort}`)
    logInfo(`Wiki loopback API 监听 http://127.0.0.1:${resolved.apiPort}${API_PREFIX}`)
  })

  // effect read must survive the cordis proxy: use the eff.call form from the
  // kb blueprint instead of a bare ctx.effect.
  //
  // CRITICAL SHAPE (learned 2026-10-10, the "Failed to fetch" root cause):
  // the host effect runs `body` IMMEDIATELY and stores its RETURN VALUE as the
  // disposer. Passing `() => { server.close() }` therefore closes the server
  // during activation, milliseconds after listen() — tools register fine but
  // nothing is ever listening, and the panel reports "Failed to fetch". The
  // two working reference plugins (dsh-knowledge-base/index.ts:731,
  // dsh-syslog-alert/index.ts:721) both pass `() => () => { ...cleanup... }`.
  try {
    const eff = (ctx as any).effect
    if (typeof eff === 'function') {
      eff.call(
        ctx,
        () => () => {
          try {
            server.close()
          } catch {
            /* already closed */
          }
          try {
            store.dispose()
          } catch {
            /* ignore */
          }
          logInfo('Wiki 插件已卸载，释放 loopback 端口并关闭 SQLite')
        },
        'dsh-local-llm-wiki: loopback server',
      )
    }
  } catch {
    /* no effect service: server leaks only on uninstall, acceptable */
  }
}

// ---- HTTP helpers ----------------------------------------------------------

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '300')
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(body)
}

function writeError(res: ServerResponse, code: string, message: string, httpStatus: number): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, error: code, message }))
}

function writeMarkdown(res: ServerResponse, md: string): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  res.end(md)
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseBoundary(header: string | undefined): string | null {
  if (!header) return null
  const m = /boundary=("?)([^";]+)\1/i.exec(header)
  return m ? m[2] : null
}

interface UploadedFile {
  filename: string
  contentType: string
  data: Buffer
}
interface ScanResult {
  files: UploadedFile[]
  fields: Record<string, string>
}

function scanParts(buf: Buffer, boundary: string): ScanResult {
  const files: UploadedFile[] = []
  const fields: Record<string, string> = {}
  const delim = Buffer.from(`--${boundary}`)
  let start = buf.indexOf(delim)
  if (start < 0) return { files, fields }
  while (true) {
    const scan = start + delim.length
    if (buf[scan] === 0x2d && buf[scan + 1] === 0x2d) {
      // closing boundary
      return { files, fields }
    }
    const headerIdx = buf.indexOf('\r\n\r\n', scan)
    const he = headerIdx < 0 ? scan : headerIdx
    const headerText = buf.slice(scan + 2, he).toString('utf-8')
    const isFile = /name="file"/i.test(headerText)
    const filenameMatch = /filename\*=utf-8''([^;\r\n]+)/i.exec(headerText) ||
      /filename="([^"]*)"/i.exec(headerText)
    const nameMatch = /name="([^"]*)"/i.exec(headerText)
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)
    const contentStart = he + 4
    const next = buf.indexOf(delim, contentStart)
    if (next < 0) return { files, fields }
    const data = buf.slice(contentStart, next - 2)
    if (isFile) {
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : 'upload'
      files.push({
        filename,
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        data,
      })
    } else if (nameMatch && data.length <= 200) {
      fields[nameMatch[1]] = data.toString('utf-8')
    }
    start = next
  }
}

// ---- route dispatch --------------------------------------------------------

interface Deps {
  store: ProjectStore
  index: WikiIndex
  resolved: Config
  getSession: () => SessionControllerLike | undefined
  getLlm: () => unknown
  getWorkspaces: () => unknown
  submitDesign: (id: string) => Promise<string>
  submitIngest: (id: string) => Promise<string>
  submitBuild: (id: string) => Promise<string>
  submitLintFix: (id: string) => Promise<string>
  advanceDesign: (id: string) => Promise<ReturnType<ProjectStore['get']>>
  saveSettings: (patch: { ingestWorkspaceId?: string; ingestModel?: string }) => Config
  logInfo: (m: string) => void
  logWarn: (m: string) => void
  logErr: (m: string) => void
}

async function handleApiRequest(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  const url = new URL(req.url || '/', 'http://dsh.internal')
  // url.pathname keeps percent-encoding; project ids may contain CJK/space, so
  // decode once here before route matching (query params stay in url.searchParams).
  const pathname = decodeURIComponent(url.pathname)
  const rest = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : pathname
  const method = (req.method || 'GET').toUpperCase()

  // GET /projects
  if (method === 'GET' && rest === '/projects') {
    // Advance any in-flight design: SCHEMA.md may have landed since the last
    // poll. Without this the designing→awaiting-schema-confirm transition only
    // happens on GET /project/:id, which the client never calls while it still
    // sees `designing` — a chicken-and-egg that left the confirm button dead.
    for (const p of deps.store.list()) {
      if (p.status === 'designing' || p.status === 'failed') await deps.advanceDesign(p.id)
    }
    const projects = deps.store.list().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      pageCount: p.pageCount,
      domain: p.domain,
      wikiName: p.wikiName,
      schemaConfirmed: p.schemaConfirmed,
      updatedAt: p.updatedAt,
      error: p.error,
      lint: p.lint ? { errorCount: p.lint.errorCount, warnCount: p.lint.warnCount } : null,
    }))
    writeJson(res, 200, { ok: true, projects })
    return
  }

  // POST /project  { name, domain?, wikiName?, importDir? }
  if (method === 'POST' && rest === '/project') {
    const body = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
    const name = String(body.name || '').trim()
    if (!name) {
      writeJson(res, 400, { ok: false, error: '需要 name' })
      return
    }
    const proj = await deps.store.createProject({ name, domain: body.domain, wikiName: body.wikiName })
    // Optional: import an already-built wiki directory at creation time
    // (user-requested 2026-10-11: avoid rebuilding knowledge bases that
    // already exist on disk). On failure the project is removed again so no
    // empty shell is left behind; the error text goes back to the panel.
    const importDir = typeof body.importDir === 'string' ? body.importDir.trim() : ''
    if (importDir) {
      try {
        const n = await deps.store.importWikiDir(proj.id, importDir)
        const pages = deps.store.getPages(proj.id)
        deps.index.addProject(proj.id, proj.name, pages)
        deps.store.setLint(proj.id, lintPages(pages))
        await deps.store.updateProject(proj.id, { status: 'ready', error: undefined })
        writeJson(res, 200, { ok: true, project: proj, importedPages: n })
      } catch (err) {
        await deps.store.deleteProject(proj.id)
        writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    writeJson(res, 200, { ok: true, project: proj })
    return
  }

  // DELETE /project/:id
  const delMatch = /^\/project\/([^/]+)$/.exec(rest)
  if (method === 'DELETE' && delMatch) {
    const ok = await deps.store.deleteProject(delMatch[1])
    writeJson(res, ok ? 200 : 404, { ok, id: delMatch[1] })
    return
  }

  // GET /project/:id  (detail: uploads + schema + lint)
  const projMatch = /^\/project\/([^/]+)$/.exec(rest)
  if (method === 'GET' && projMatch) {
    const p = await deps.advanceDesign(projMatch[1])
    if (!p) {
      writeJson(res, 404, { ok: false, error: 'project not found' })
      return
    }
    const uploads = await deps.store.scanRaw(p.id)
    const schema = await deps.store.readSchema(p.id)
    // Pages list for the panel. getPages is the in-memory cache; if empty but the
    // project reports pages (e.g. harvested in a previous process), re-harvest from disk.
    let pages = deps.store.getPages(p.id)
    if (!pages.length && p.pageCount > 0) pages = await deps.store.harvest(p.id)
    // Group pages by cited source file so each uploaded doc row can offer a
    // "view its built pages" jump. Matching is fuzzy: the frontmatter `sources`
    // entry usually carries a `#chapter` suffix and may drop the 8-char upload id.
    const sourceGroups = uploads.map((u) => {
      const bare = u.name.replace(/^[0-9a-f]{8}-/, '')
      const stem = bare.replace(/\.[^.]+$/, '').toLowerCase()
      const related = pages
        .filter((pg) => pg.sources.some((s) => {
          const ls = s.toLowerCase()
          const file = ls.split('#')[0].trim()
          const fStem = file.replace(/\.[^.]+$/, '')
          // match on filename stem, or either side containing the other (pdf names
          // often get re-typed slightly differently in the frontmatter)
          return (fStem && (stem.includes(fStem) || fStem.includes(stem))) || (file && ls.includes(stem))
        }))
        .map((pg) => ({ path: pg.path, kind: pg.kind, title: pg.title, tags: pg.tags, updated: pg.updated }))
      return { name: bare, sha256: u.sha256, pages: related }
    })
    writeJson(res, 200, {
      ok: true,
      project: p,
      uploads: uploads.map((u) => ({ name: u.name.replace(/^[0-9a-f]{8}-/, ''), size: u.size, sha256: u.sha256, mtime: u.mtime })),
      sourceGroups,
      schema: p.schemaConfirmed ? schema : p.schemaDraft ?? schema,
      schemaConfirmed: p.schemaConfirmed,
      pages: pages.map((pg) => ({ path: pg.path, kind: pg.kind, title: pg.title, tags: pg.tags, updated: pg.updated })),
    })
    return
  }

  // POST /upload  (multipart: projectId + files[])
  if (method === 'POST' && rest === '/upload') {
    const ct = req.headers['content-type']
    const boundary = parseBoundary(ct)
    if (!boundary) {
      writeJson(res, 400, { ok: false, error: '非 multipart 上传' })
      return
    }
    const buf = await readBody(req)
    const { files, fields } = scanParts(buf, boundary)
    const projectId = fields.projectId
    if (!projectId || !deps.store.get(projectId)) {
      writeJson(res, 400, { ok: false, error: 'projectId 无效' })
      return
    }
    const added = []
    for (const f of files) {
      if (!f.filename) continue
      const doc = await deps.store.addUpload(projectId, { name: f.filename, mime: f.contentType, data: f.data })
      added.push({ name: doc.name, size: doc.size })
    }
    writeJson(res, 200, { ok: true, added })
    return
  }

  // POST /design/:id
  const designMatch = /^\/design\/([^/]+)$/.exec(rest)
  if (method === 'POST' && designMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: '本 profile 无 sessionController，design 不可用' })
      return
    }
    try {
      const sessionId = await deps.submitDesign(designMatch[1])
      writeJson(res, 200, { ok: true, sessionId, status: 'designing' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      writeJson(res, 400, { ok: false, error: msg })
    }
    return
  }

  // POST /schema/:id  { schema }  (confirm draft)
  const schemaMatch = /^\/schema\/([^/]+)$/.exec(rest)
  if (method === 'POST' && schemaMatch) {
    const body = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
    const schema = String(body.schema ?? '')
    if (!schema) {
      writeJson(res, 400, { ok: false, error: '需要 schema 内容' })
      return
    }
    await deps.store.writeSchema(schemaMatch[1], schema)
    const p = await deps.store.updateProject(schemaMatch[1], { schemaConfirmed: true, status: 'uploaded', schemaDraft: undefined })
    writeJson(res, 200, { ok: true, project: p, schemaConfirmed: true })
    return
  }

  // POST /ingest/:id
  const ingestMatch = /^\/ingest\/([^/]+)$/.exec(rest)
  if (method === 'POST' && ingestMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: '本 profile 无 sessionController，ingest 不可用' })
      return
    }
    try {
      const sessionId = await deps.submitIngest(ingestMatch[1])
      writeJson(res, 200, { ok: true, sessionId, status: 'ingesting' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await deps.store.updateProject(ingestMatch[1], { status: 'failed', error: msg })
      writeJson(res, 400, { ok: false, error: msg })
    }
    return
  }

  // POST /build/:id  — single-session full build (requirement ②): the session
  // runs wiki-design → SCHEMA.md → wiki-init → wiki-ingest → wiki_done in one
  // go. Replaces the old import-wiki path as the "no-confirm" build route.
  const buildMatch = /^\/build\/([^/]+)$/.exec(rest)
  let lintFixMatch: RegExpMatchArray | null
  if (method === 'POST' && buildMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: '本 profile 无 sessionController，构建不可用' })
      return
    }
    try {
      const sessionId = await deps.submitBuild(buildMatch[1])
      writeJson(res, 200, { ok: true, sessionId, status: 'ingesting' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await deps.store.updateProject(buildMatch[1], { status: 'failed', error: msg })
      writeJson(res, 400, { ok: false, error: msg })
    }
    return
  }

  // POST /lintfix/:id — send the current lint report into a repair session.
  if (method === 'POST' && (lintFixMatch = rest.match(/^\/lintfix\/(.+)$/))) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: '本 profile 无 sessionController，lint 修复不可用' })
      return
    }
    try {
      const sessionId = await deps.submitLintFix(lintFixMatch[1])
      writeJson(res, 200, { ok: true, sessionId, status: 'ingesting' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      writeJson(res, 400, { ok: false, error: msg })
    }
    return
  }

  // GET /settings — current build-session settings (workspace + model).
  if (method === 'GET' && rest === '/settings') {
    writeJson(res, 200, {
      ok: true,
      settings: {
        ingestWorkspaceId: deps.resolved.ingestWorkspaceId,
        ingestModel: deps.resolved.ingestModel,
        ingestAgentPreset: deps.resolved.ingestAgentPreset,
        ingestPermissionPreset: deps.resolved.ingestPermissionPreset,
      },
    })
    return
  }

  // PUT /settings  { ingestWorkspaceId?, ingestModel? } — persist the
  // settings-page choices into the plugin config (module-level runtime copy).
  if (method === 'PUT' && rest === '/settings') {
    let body: { ingestWorkspaceId?: string; ingestModel?: string }
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
    } catch {
      writeJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
      return
    }
    const next = deps.saveSettings({
      ingestWorkspaceId: typeof body.ingestWorkspaceId === 'string' ? body.ingestWorkspaceId : undefined,
      ingestModel: typeof body.ingestModel === 'string' ? body.ingestModel : undefined,
    })
    writeJson(res, 200, {
      ok: true,
      settings: {
        ingestWorkspaceId: next.ingestWorkspaceId,
        ingestModel: next.ingestModel,
        ingestAgentPreset: next.ingestAgentPreset,
        ingestPermissionPreset: next.ingestPermissionPreset,
      },
    })
    return
  }

  // GET /catalog — the model pool: every provider route with its models
  // (mirrors buildModelCatalog in the host session controller).
  if (method === 'GET' && rest === '/catalog') {
    const llm = deps.getLlm() as any
    if (!llm || typeof llm.listProviders !== 'function') {
      writeJson(res, 200, { ok: true, groups: [] })
      return
    }
    try {
      const providers: { id: string; name?: string }[] = await llm.listProviders()
      const groups = await Promise.all(providers.map(async (prov) => {
        try {
          const models: { id: string; name?: string }[] = await llm.listModels(prov.id)
          return { id: prov.id, name: prov.name || prov.id, models: models.map((m) => ({ id: m.id, name: m.name || m.id })) }
        } catch {
          return { id: prov.id, name: prov.name || prov.id, models: [] as { id: string; name: string }[], error: '模型列表不可用' }
        }
      }))
      writeJson(res, 200, { ok: true, groups: groups.filter((g) => g.models.length > 0) })
    } catch (err) {
      writeJson(res, 200, { ok: true, groups: [], error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  // GET /workspaces — host workspace list for the settings page.
  if (method === 'GET' && rest === '/workspaces') {
    const reg = deps.getWorkspaces() as any
    if (!reg || typeof reg.list !== 'function') {
      writeJson(res, 200, { ok: true, workspaces: [] })
      return
    }
    try {
      const items = reg.list().map((w: any) => ({ id: String(w.id), path: w.path, sessions: Array.isArray(w.sessionIds) ? w.sessionIds.length : 0 }))
      writeJson(res, 200, { ok: true, workspaces: items })
    } catch (err) {
      writeJson(res, 200, { ok: true, workspaces: [], error: err instanceof Error ? err.message : String(err) })
    }
    return
  }

  // POST /delete-upload  { projectId, sha256 }  — delete one uploaded file and
  // every built page whose frontmatter sources cite it; re-index what remains.
  if (method === 'POST' && rest === '/delete-upload') {
    let body: { projectId?: string; sha256?: string }
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8') || '{}')
    } catch {
      writeJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
      return
    }
    const projectId = String(body.projectId ?? '')
    const sha256 = String(body.sha256 ?? '').trim()
    if (!projectId || !deps.store.get(projectId)) {
      writeJson(res, 400, { ok: false, error: 'projectId 无效' })
      return
    }
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      writeJson(res, 400, { ok: false, error: '需要 sha256（上传文件的哈希）' })
      return
    }
    try {
      const removedPages = await deps.store.deleteUpload(projectId, sha256)
      const p = deps.store.get(projectId)
      const pages = deps.store.getPages(projectId)
      deps.index.addProject(projectId, p?.name ?? projectId, pages)
      deps.store.setLint(projectId, lintPages(pages))
      writeJson(res, 200, { ok: true, removedPages, pages: pages.length })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      writeJson(res, 400, { ok: false, error: msg })
    }
    return
  }

  // GET /search?q=&projectId=&topK=
  if (method === 'GET' && rest === '/search') {
    const q = url.searchParams.get('q') || ''
    const projectId = url.searchParams.get('projectId') || undefined
    const topK = Number(url.searchParams.get('topK') || '5')
    if (!q.trim()) {
      writeJson(res, 400, { ok: false, error: '需要 q' })
      return
    }
    const hits = deps.index.search(q, { projectId, topK: Number.isFinite(topK) ? topK : 5 })
    writeJson(res, 200, {
      ok: true,
      count: hits.length,
      hits: hits.map((h) => ({
        projectId: h.projectId,
        projectName: h.projectName,
        path: h.page.path,
        kind: h.page.kind,
        title: h.page.title,
        tags: h.page.tags,
        score: h.score,
        snippet: h.snippet,
      })),
    })
    return
  }

  // GET /page/:id?path=
  const pageMatch = /^\/page\/([^/]+)$/.exec(rest)
  if (method === 'GET' && pageMatch) {
    const pagePath = url.searchParams.get('path') || ''
    const md = await deps.store.readPage(pageMatch[1], pagePath)
    if (md === null) {
      writeJson(res, 404, { ok: false, error: 'page not found' })
      return
    }
    writeMarkdown(res, md)
    return
  }

  // GET /status
  if (method === 'GET' && rest === '/status') {
    writeJson(res, 200, {
      ok: true,
      api: 'dsh-local-llm-wiki',
      apiPort: deps.resolved.apiPort,
      dataDir: deps.resolved.dataDir,
      projects: deps.store.list().length,
      pages: deps.index.size,
      hasSession: !!deps.getSession(),
    })
    return
  }

  writeJson(res, 404, { ok: false, error: 'not found', path: rest })
}

// ---- default export shape the harness expects ------------------------------
export default { name, inject, apply, resolveConfig, DEFAULT_CONFIG }

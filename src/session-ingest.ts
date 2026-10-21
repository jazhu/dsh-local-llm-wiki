// DSH-session-driven build for dsh-local-llm-wiki: two project-level submissions.
//
//  1. design  — ask a session to run the llm-wiki `wiki-design` method against
//     the project's raw/ docs and write a SCHEMA.md draft into the wiki dir.
//     The plugin then reads that draft and parks the project in
//     `awaiting-schema-confirm`; the human confirms in the UI before anything
//     is built. This is the quality gate the design insists on.
//  2. ingest  — after SCHEMA confirmation, ask a session to run `wiki-init` +
//     `wiki-ingest`, compiling every raw/ doc into structured pages, then call
//     the `wiki_done(projectId, wikiDir)` tool — the single, well-defined
//     hand-off that triggers the harvest.
//
// Why a session + tool round-trip instead of invoking the skill in-process:
//   * the host owns the session and agent runtime — the plugin gets a normal,
//     inspectable conversation, the llm-wiki skill, and the file system for free;
//   * `prompt(mode:'queue')` is fire-and-forget, so the upload thread never
//     blocks on a long multi-page wiki build;
//   * the only channel back is a tool call, so `wiki_done` is the authoritative
//     completion point (exactly the pattern proven by dsh-knowledge-base's
//     kb_ingest_done — including the lesson that the callback tool must be
//     registered UNCONDITIONALLY, never behind a sessionController gate).

import { promises as fs } from 'node:fs'
import { appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SkillInjection } from './types.ts'

/** The slice of the host `sessionController` this module uses (mirrors auto-session.ts:373). */
export interface SessionControllerLike {
  create(request: { workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId?: string; id?: string; [k: string]: unknown }>
  rename(request: { sessionId: string; title: string }): Promise<unknown>
  prompt(
    request: {
      requestId: string
      sessionId: string
      mode: 'queue' | 'steer'
      content: { type: 'text'; text: string }[]
      clientTimeZone?: string
    },
    signal: AbortSignal,
  ): Promise<unknown>
  /** Optional: install a session-local model selection (Remote method `selectModel`). */
  selectModel?(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<unknown>
}

/**
 * Acquire the host `sessionController` service. `ctx.inject(['sessionController'], cb)`
 * is the only route that survives the host fiber boundary (a bare `ctx.sessionController`
 * read throws "cannot get property without inject"). The callback may fire after
 * activation, so the caller stores the resolved controller and reads it lazily.
 */
export function acquireSessionController(ctx: any, onReady: (controller: SessionControllerLike) => void): void {
  // Diagnostic trace (2026-10-10): write every acquisition milestone to the same
  // activation log the host-side trace uses, so a restart pinpoints which route
  // (reflect / inject callback) actually fires.
  const trace = (msg: string): void => {
    try {
      appendFileSync(path.join(os.homedir(), '.dsh', 'dsh-local-llm-wiki-activation.log'), `[${new Date().toISOString()}] [sessionController] ${msg}\n`)
    } catch { /* never break activation */ }
  }
  trace(`acquire called; ctxKeys=${ctx ? Object.getOwnPropertyNames(ctx).slice(0, 20).join(',') : 'null'}`)
  // Resolve a ready controller synchronously when the host already exposes the
  // service slice via `reflect.get` (the same two-path route dsh-syslog-alert
  // uses). The reactive ctx.inject callback below still fires for late-bound or
  // fiber-crossing service provisioning, so both routes converge on onReady.
  const settle = (candidate: unknown): void => {
    const ctrl = candidate as SessionControllerLike | undefined
    if (ctrl && typeof ctrl.create === 'function' && typeof ctrl.prompt === 'function') {
      onReady(ctrl)
    } else {
      trace(`settle candidate invalid: ${candidate === undefined ? 'undefined' : typeof candidate}${ctrl ? ` create=${typeof (ctrl as any).create} prompt=${typeof (ctrl as any).prompt}` : ''}`)
    }
  }
  try {
    const reflect = ctx?.reflect
    if (reflect && typeof reflect.get === 'function') {
      let r1: unknown, r2: unknown
      try { r1 = reflect.get('sessionController') } catch (e) { trace(`reflect.get threw: ${e instanceof Error ? e.message : String(e)}`) }
      try { r2 = reflect.get('sessionController', false) } catch (e) { trace(`reflect.get(false) threw: ${e instanceof Error ? e.message : String(e)}`) }
      trace(`reflect.get r1=${r1 === undefined ? 'undefined' : typeof r1} r2=${r2 === undefined ? 'undefined' : typeof r2}`)
      settle(r1)
      settle(r2)
    } else {
      trace('reflect.get unavailable')
    }
  } catch {
    /* ignore: reflect not available on this host */
  }
  if (!ctx?.inject) {
    trace('ctx.inject missing — abort')
    return
  }
  try {
    trace('ctx.inject(["sessionController"], cb) registering')
    ctx.inject(['sessionController'], (sctx: any) => {
      trace(`inject callback fired; sctxType=${sctx === undefined ? 'undefined' : typeof sctx}`)
      try {
        const ctrl = sctx?.sessionController
        trace(`sctx.sessionController=${ctrl === undefined ? 'undefined' : typeof ctrl} create=${typeof (ctrl as any)?.create} prompt=${typeof (ctrl as any)?.prompt}`)
        if (ctrl && typeof ctrl.create === 'function' && typeof ctrl.prompt === 'function') {
          // Deliver the controller FIRST — any later failure must not prevent
          // onReady. (2026-10-10 root cause of "本 profile 无 sessionController":
          // the permissionPresets read below throws on the cordis proxy when the
          // property is not injected, and the surrounding catch swallowed the
          // exception AFTER skipping onReady.)
          onReady(ctrl)
          // Same fiber may also expose permissionPresets (only when the
          // permission presets plugin is composed). Isolated try/catch: an
          // uninjected property read throws on the cordis proxy and must never
          // take the controller delivery down with it.
          try {
            const presets = sctx?.permissionPresets
            if (presets && typeof presets.set === 'function') {
              permissionPresetsRef = presets
              onPermissionPresets?.(presets)
            }
          } catch (e) {
            trace(`permissionPresets read failed (expected when not injected): ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      } catch {
        /* service not available on this profile */
      }
    })
    trace('ctx.inject registered without throwing')
  } catch (e) {
    trace(`ctx.inject threw synchronously: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

/** Optional sink for the host permissionPresets service (set once on ready). */
let permissionPresetsRef: any
let onPermissionPresets: ((presets: any) => void) | undefined
export function setPermissionPresetsSink(fn: (presets: any) => void): void {
  onPermissionPresets = fn
}

export interface ProjectSubmitArgs {
  controller: SessionControllerLike
  /** The project workspace dir (cwd for the session): <dataDir>/projects/<id>. */
  projectDir: string
  /** Absolute wiki output dir: <projectDir>/<wikiName>. */
  wikiDir: string
  projectId: string
  projectName: string
  domain: string
  agentPreset: string
  /** Host workspace to create the session in (from the settings page). Empty = host default. */
  workspaceId?: string
  /** Model selection applied right after create via selectModel (provider/model from the model pool). */
  modelSelection?: { provider: string; model: string }
  /** When the host exposes permissionPresets, new sessions are switched to this preset (e.g. 'auto' review). */
  permissionPreset?: string
  signal: AbortSignal
  /** Names (relative to raw/) of the docs to process; for ingest this is the incremental diff. */
  rawDocs: { name: string; sha256: string }[]
  /** The callback tool the session must call when done (ingest only). */
  doneTool?: string
  /**
   * Full text of the bundled llm-wiki skill. When present it is prepended to
   * the prompt so the session follows the skill without loading it from disk
   * (requirement ③: the plugin carries its own skill). Only used when
   * `skillInjection` is `inline`.
   */
  skillText?: string
  /**
   * How the llm-wiki skill reaches the session (user-requested 2026-10-20):
   * inline = prepend skillText; tool = name the host skill tool only;
   * auto = tool + a compact core-protocol digest fallback.
   */
  skillInjection?: SkillInjection
}

export interface SubmitResult {
  sessionId: string
}

/**
 * List the raw/ files present so the session prompt can name them explicitly.
 * Adds the byte size (helps the session decide sampling vs full reads) and
 * flags files that are missing on disk so a stale listing never silently
 * becomes a hallucination source.
 */
async function stageSourceIndex(rawDir: string, docs: { name: string; sha256: string; size?: number }[]): Promise<string> {
  const lines: string[] = []
  for (const d of docs) {
    try {
      await fs.stat(path.join(rawDir, d.name))
      const size = d.size !== undefined ? ` · ${(d.size / 1024).toFixed(1)} KB` : ''
      lines.push(`- raw/${d.name}${size}`)
    } catch {
      lines.push(`- raw/${d.name}（缺失，请跳过）`)
    }
  }
  return lines.join('\n')
}

/**
 * Compact digest of the llm-wiki skill's hard protocol numbers, used as a
 * fallback when the session is asked to load the skill through the host
 * `skill` tool (skillInjection = 'auto'). The five-section task prompt already
 * carries these numbers; this digest only exists so a session that fails to
 * load the skill still follows the workflow instead of improvising.
 */
const SKILL_CORE_DIGEST = `核心协议要点（未能加载技能全文时按此执行）：
- 目录结构：raw/（不可变）+ <wiki>/（SCHEMA.md / index.md / log.md / entities / concepts / comparisons / queries）；项目根目录只允许 raw/ 与 <wiki>/。
- ingest 四阶段：Phase1 规划（SCHEMA.md 页面清单 + manifest.json SHA256 增量）→ Phase2 分批并行提取（MAX_CONCURRENT_AGENTS=5，子 Agent 只输出 JSON，必须写 <wiki>/.ingest-cache/<slug>.json，超时 300s、失败重试 1 次）→ Phase3 按页面模板组装 Markdown（frontmatter：title/tags/sources/updated/confidence/aliases/related）→ Phase4 覆盖率验证 + 更新 manifest + 递归清理。
- SCHEMA.md 至少覆盖：领域定义、目录约定、frontmatter 必填字段、标签体系、页面模板选择、交叉引用规则、index.md / log.md 规范。
- 不从记忆回答领域内容，一切信息来自源文档；页面正文与源文档语言一致，slug 用英文短横线命名。`

/**
 * Wrap a task prompt according to the skill-injection mode:
 * - inline: the full skill text goes first under a clear header, then the task.
 * - tool:   the task leads with a Step 0 that requires loading llm-wiki through
 *           the host `skill` tool; nothing else is prepended (the skill was
 *           registered on activation, so the prompt carries no skill text).
 * - auto:   same as tool, plus the compact protocol digest so the session still
 *           follows the hard numbers when the skill call fails.
 */
function withSkill(skillText: string | undefined, task: string, mode: SkillInjection = 'tool'): string {
  if (mode === 'inline') {
    if (!skillText || !skillText.trim()) return task
    return [
      `<llm-wiki-skill>`,
      skillText.trim(),
      `</llm-wiki-skill>`,
      ``,
      `> 阅读指引：上面是 llm-wiki 技能全文（含标准目录结构、7 大方法、核心约束与按需加载规则）。`,
      `> 技能正文中要求「读取 references/<file>.md」或「读取 scripts/<file>」时，请在上方全文末尾的`,
      `> <llm-wiki-skill-attachment> 块内按同名 \`BUNDLED: <path>\` 标记定位对应内容（schema-guide.md /`,
      `> templates.md / ingest-workflow.md / lint-rules.md / lint.py / evaluate.py 已全文内联，无需访问磁盘）。`,
      ``,
      `---`,
      ``,
      task,
    ].join('\n')
  }
  if (mode === 'auto') {
    return [
      `## 步骤 0：加载 llm-wiki 技能`,
      `本任务依赖 llm-wiki 技能（插件激活时已自动注册）。请立即调用工具 \`skill\`，参数 \`{"name":"llm-wiki"}\`，加载其全文并严格遵循。`,
      `若该工具不可用或调用失败，不得放弃任务——按下述核心协议要点继续执行：`,
      ``,
      SKILL_CORE_DIGEST,
      ``,
      `---`,
      ``,
      task,
    ].join('\n')
  }
  // tool (default, user-requested 2026-10-21): no skill text in the prompt at
  // all — the skill is a host capability registered at activation time.
  return [
    `## 步骤 0：加载 llm-wiki 技能`,
    `本任务依赖 llm-wiki 技能（插件激活时已自动注册到宿主技能目录）。请立即调用工具 \`skill\`，参数 \`{"name":"llm-wiki"}\`，加载其全文并严格遵循；`,
    `技能全文是任务方法论的唯一来源，本提示词不再重复其内容。`,
    ``,
    `---`,
    ``,
    task,
  ].join('\n')
}

/** Submit a design (SCHEMA draft) session for one project. */
export async function submitDesign(args: ProjectSubmitArgs): Promise<SubmitResult> {
  const rawDir = path.join(args.projectDir, 'raw')
  const listing = await stageSourceIndex(rawDir, args.rawDocs)
  const prompt = withSkill(args.skillText, buildDesignPrompt(args, listing), args.skillInjection)
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki 设计 · ${args.projectName}`,
    prompt,
    signal: args.signal,
  })
}

/** Submit an ingest (full wiki build) session for one project. */
export async function submitIngest(args: ProjectSubmitArgs): Promise<SubmitResult> {
  const rawDir = path.join(args.projectDir, 'raw')
  const listing = await stageSourceIndex(rawDir, args.rawDocs)
  const doneTool = args.doneTool ?? 'wiki_done'
  const prompt = withSkill(args.skillText, buildIngestPrompt(args, listing, doneTool), args.skillInjection)
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki 构建 · ${args.projectName}`,
    prompt,
    signal: args.signal,
  })
}

/**
 * One-session full build (design → confirm is skipped by trusting the session's
 * own schema, per the "single-session build" requirement): the session runs
 * wiki-design, writes SCHEMA.md, immediately runs wiki-init + wiki-ingest on
 * the strength of it, and calls `wiki_done` when every raw doc is compiled.
 *
 * Lint-fix sibling (2026-10-10): submitLintFix sends the current lint report
 * into a session and has it repair the wiki in place (create missing target
 * pages, or rewrite dead links; clean temporary files per the skill's workspace
 * rules). The session calls `wiki_done` when done so the plugin re-harvests and
 * re-lints.
 */
export async function submitLintFix(args: ProjectSubmitArgs & { lintReport: string }): Promise<SubmitResult> {
  const doneTool = args.doneTool ?? 'wiki_done'
  const prompt = withSkill(args.skillText, buildLintFixPrompt(args, args.lintReport, doneTool), args.skillInjection)
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki lint 修复 · ${args.projectName}`,
    prompt,
    signal: args.signal,
  })
}

function buildLintFixPrompt(args: ProjectSubmitArgs, lintReport: string, doneTool: string): string {
  return [
    `你是知识库维护助手。请按上述 llm-wiki 技能的 wiki-lint / wiki-update 方法修复下面报告中的所有 error 级问题（warn 级尽力处理）。`,
    ``,
    `## 项目事实`,
    `- 项目名：${args.projectName}`,
    `- 工作目录（cwd）：${args.projectDir}`,
    `- wiki 目录：${args.wikiDir}`,
    `- SCHEMA.md：${path.join(args.wikiDir, 'SCHEMA.md')}（先完整读它，修复不得违反其中规范）`,
    `- 源文档目录：${path.join(args.projectDir, 'raw')}（只读，补建页面时的事实来源）`,
    ``,
    `## lint 报告`,
    lintReport,
    ``,
    `## 可参照的源文档（raw/ 下，共 ${args.rawDocs.length} 篇）`,
    args.rawDocs.map((d) => `- raw/${d.name}`).join('\n') || '（无）',
    ``,
    `## 修复要求`,
    `1. 「链接指向不存在的页面」：优先补建缺失的目标页面（按技能中 BUNDLED: references/templates.md 的页面模板，带 YAML frontmatter，内容基于 raw/ 源文档撰写；若该主题在源文档中不存在，则把引用页的链接改为指向已有页面或去掉链接）；`,
    `2. 「页面缺少标题」「孤立页面」：补 frontmatter title，或在 index.md 中为孤立页面建立入口链接；`,
    `3. 「frontmatter 缺字段」：按 SCHEMA.md 的必填字段补齐（title/tags/sources/updated/confidence/aliases/related）；`,
    `4. 「工作区清洁度」：删除临时脚本/报告（*.py *.js *.sh *.html）、entities/、output/、raw/_temp_*.json、.ingest-cache/，项目根目录只允许 raw/ 与 <wiki>/；`,
    `5. 不要改动与问题无关的页面；不要删除或改写 SCHEMA.md / log.md / index.md（index.md 仅允许补链接）；`,
    `6. 修复完成后自查一遍链接完整性与 frontmatter 必填字段，log.md 追加本次修复记录（含耗时）。`,
    ``,
    `## 完成回执`,
    `完成后必须调用工具 ${doneTool} 回写结果，参数为：`,
    `- projectId: "${args.projectId}"`,
    `- wikiDir: "${args.wikiDir}"`,
    `只有调用该工具后，修复才算完成。`,
  ]
    .filter(Boolean)
    .join('\n')
}
export async function submitBuild(args: ProjectSubmitArgs): Promise<SubmitResult> {
  const rawDir = path.join(args.projectDir, 'raw')
  const listing = await stageSourceIndex(rawDir, args.rawDocs)
  const doneTool = args.doneTool ?? 'wiki_done'
  const prompt = withSkill(args.skillText, buildFullBuildPrompt(args, listing, doneTool), args.skillInjection)
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki 构建 · ${args.projectName}`,
    prompt,
    signal: args.signal,
  })
}

async function submit(
  controller: SessionControllerLike,
  opts: { cwd: string; agentPreset: string; workspaceId?: string; modelSelection?: { provider: string; model: string }; permissionPreset?: string; title: string; prompt: string; signal: AbortSignal },
): Promise<SubmitResult> {
  // Host contract (learned 2026-10-10): session.create accepts workspaceId OR
  // cwd, not both. Prefer workspaceId when set; the session cwd then defaults
  // to that workspace's directory. Only fall back to cwd when no workspace
  // was selected (the project dir keeps the session's file operations local).
  const createReq: { cwd?: string; agentPreset?: string; workspaceId?: string } = {}
  if (opts.agentPreset) createReq.agentPreset = opts.agentPreset
  if (opts.workspaceId) createReq.workspaceId = opts.workspaceId
  else createReq.cwd = opts.cwd
  const session = await controller.create(createReq)
  const sessionId = String((session as any)?.sessionId ?? (session as any)?.id ?? '')
  if (!sessionId) throw new Error('sessionController.create returned no session id')
  // Install the settings-page model selection for this session (best-effort;
  // the remote method only exists when the host composes the session
  // controller with selectModel — otherwise the host default model applies).
  if (opts.modelSelection?.provider && opts.modelSelection?.model) {
    try {
      await (controller as any).selectModel?.({
        sessionId,
        provider: opts.modelSelection.provider,
        model: opts.modelSelection.model,
      })
    } catch {
      /* model selection is an enhancement; fall back to the host default */
    }
  }
  // Switch the session to the requested permission preset (e.g. Auto review)
  // right after creation, before the first prompt. Best-effort: the preset
  // service may be absent (auto-review layer off) or the name unknown.
  if (opts.permissionPreset) {
    try {
      const presets = (controller as any)?.permissionPresets ?? permissionPresetsRef
      const target = (session as any)?.session ?? (session as any)?.agent?.session ?? (session as any)
      if (presets && typeof presets.set === 'function' && target) presets.set(target, opts.permissionPreset)
    } catch {
      /* preset switching is an enhancement, never abort the build */
    }
  }
  try {
    await controller.rename({ sessionId, title: opts.title })
  } catch {
    /* rename is cosmetic; a failure here must not abort the build */
  }
  await controller.prompt(
    {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: opts.prompt }],
      clientTimeZone: tz(),
    },
    opts.signal,
  )
  return { sessionId }
}

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function buildDesignPrompt(args: ProjectSubmitArgs, listing: string): string {
  const schemaPath = path.join(args.wikiDir, 'SCHEMA.md')
  return [
    `你是知识库架构师。请严格按上述 llm-wiki 技能的 wiki-design 方法，为下面这个项目产出 SCHEMA.md 草稿（只做设计，不构建页面）。`,
    ``,
    `## 项目事实`,
    `- 项目名：${args.projectName}`,
    args.domain ? `- 领域说明：${args.domain}` : ``,
    `- 工作目录（cwd）：${args.projectDir}`,
    `- wiki 输出目录：${args.wikiDir}`,
    `- SCHEMA.md 目标路径：${schemaPath}`,
    ``,
    `## 源文档（raw/，只读，共 ${args.rawDocs.length} 篇）`,
    listing,
    ``,
    `## 执行步骤（按 wiki-design 六步）`,
    `1. 通读源文档清单并抽样阅读内容（大文档只读关键章节，不要全文粘贴进上下文）；`,
    `2. 确定用户画像与高频查询；按体系 A 规划 entities/ + concepts/ + comparisons/ + queries/ 四类页面；`,
    `3. 产出实体清单、跨实体概念清单、对比组清单（含每个页面的 slug 命名）；`,
    `4. 写 SCHEMA.md 前必须先读技能中 BUNDLED: references/schema-guide.md 块，SCHEMA 至少覆盖：领域定义、目录约定、Frontmatter 必填字段（title/tags/sources/updated/confidence/aliases/related）、标签体系、页面模板选择、交叉引用规则、index.md 规范、log.md 规范；`,
    `5. 写 SCHEMA.md 到 ${schemaPath}。`,
    ``,
    `## 硬性约束`,
    `- 只写 SCHEMA.md 这一个文件；不得生成任何页面、不得运行 ingest；`,
    `- SCHEMA.md 中定义的 slug 将是后续 ingest 的页面清单，必须覆盖源文档中的关键主题；`,
    `- 完成后用一段话汇报：写入的路径、实体/概念/对比页面数量、设计取舍。`,
    `- 本次不调用任何"构建完成"类工具——草稿会交回人工确认。`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildIngestPrompt(args: ProjectSubmitArgs, listing: string, doneTool: string): string {
  return [
    `你是知识库构建助手。请严格按上述 llm-wiki 技能的 wiki-init + wiki-ingest 方法，把 raw/ 里的源文档编译成结构化 wiki 页面。`,
    ``,
    `## 项目事实`,
    `- 项目名：${args.projectName}`,
    `- 工作目录（cwd）：${args.projectDir}`,
    `- wiki 输出目录：${args.wikiDir}`,
    `- SCHEMA.md：${path.join(args.wikiDir, 'SCHEMA.md')}（已由人工确认，是唯一配置源，先完整读它，不得改写）`,
    `- manifest：${path.join(args.projectDir, 'raw', '.cache', 'manifest.json')}（SHA256 增量账本）`,
    ``,
    `## 本次待处理源文档（raw/ 下，共 ${args.rawDocs.length} 篇）`,
    listing,
    ``,
    `## 执行步骤（严格按 ingest-workflow）`,
    `1. wiki-init：若 ${args.wikiDir} 下尚无 index.md / log.md，按 SCHEMA.md 建骨架（index.md 已存在则跳过 init）；`,
    `2. Phase 1 规划：读 SCHEMA.md 得到页面清单（实体/概念/对比/查询）；读 manifest.json，把本次 ${args.rawDocs.length} 篇源文档按 SHA256 标为 added/modified/unchanged，映射到受影响的页面，得到 pending 页面清单；`,
    `3. Phase 2 分批并行提取（核心）：先创建 ${args.wikiDir}/.ingest-cache/ 目录；按 MAX_CONCURRENT_AGENTS=5 启动子 Agent 批次，每个子 Agent 只输出结构化 JSON（frontmatter + 各章节要点，不生成 Markdown），`,
    `   JSON 必须写到 ${args.wikiDir}/.ingest-cache/<slug>.json；子 Agent 超时 300s、失败重试 1 次（缩到最核心 3 篇源文档），仍失败由你兜底；`,
    `   每个子 Agent 的 prompt 必须显式给出输出路径，禁止写入 raw/、entities/、output/ 或项目根目录；JSON 字符串值内禁用中文引号；JSON 中不得包含独立的参见字段，跨页引用由你在 Phase 3 统一生成；`,
    `   ⚠ 禁止跳过剩余批次直接进入 Phase 3；每批完成后在 log.md 记录批次编号、页面列表、成功/失败数、累计进度；`,
    `4. Phase 3 合并组装：把每个 JSON 组装成正式 Markdown 页面（用技能中 BUNDLED: references/templates.md 的页面模板），带 YAML frontmatter（title/tags/sources/updated/confidence/aliases/related），落到 entities/ concepts/ comparisons/ queries/；交叉引用只指向 SCHEMA.md 已定义的 slug；在 index.md 建立总览与链接；`,
    `5. Phase 4 收尾：覆盖率验证——本次每篇源文档都必须出现在至少一个页面的 sources 里，缺一篇就补；更新 manifest.json（last_updated、每个文档 assigned_to）；递归清理：删除 .ingest-cache/ 及项目根目录所有临时脚本/报告（*.py *.js *.sh *.html），项目根目录只允许 raw/ 与 <wiki>/ 存在；`,
    `6. log.md 追加本次操作记录（含耗时与页面清单）。`,
    ``,
    `## 硬性约束`,
    `- 所有产出必须落在 ${args.wikiDir} 内；不得修改 raw/ 下任何文件；`,
    `- 不从记忆回答领域内容，一切信息来自源文档；`,
    `- 页面正文用中文（与源文档语言一致）， slugs 用英文短横线命名。`,
    ``,
    `## 完成回执`,
    `全部完成后必须调用工具 ${doneTool} 回写结果，参数：`,
    `- projectId: "${args.projectId}"`,
    `- wikiDir: "${args.wikiDir}"`,
    `只有调用该工具后知识库才算构建完成，不得在不调用的情况下结束。`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Single-session full build (requirement ②, 2026-10-10): the same session runs
 * wiki-design → SCHEMA.md → wiki-init → wiki-ingest → wiki_done. No human
 * SCHEMA confirm gate; the session trusts its own design.
 */
function buildFullBuildPrompt(args: ProjectSubmitArgs, listing: string, doneTool: string): string {
  const schemaPath = path.join(args.wikiDir, 'SCHEMA.md')
  return [
    `你是知识库构建助手。请严格按上述 llm-wiki 技能，在一个会话内连续完成 设计（wiki-design）与 构建（wiki-init + wiki-ingest）两个阶段，中间不暂停、不等待人工确认。`,
    ``,
    `## 项目事实`,
    `- 项目名：${args.projectName}`,
    args.domain ? `- 领域说明：${args.domain}` : ``,
    `- 工作目录（cwd）：${args.projectDir}`,
    `- wiki 输出目录：${args.wikiDir}`,
    `- SCHEMA.md 目标路径：${schemaPath}`,
    `- manifest：${path.join(args.projectDir, 'raw', '.cache', 'manifest.json')}`,
    ``,
    `## 源文档（raw/，只读，共 ${args.rawDocs.length} 篇）`,
    listing,
    ``,
    `## 第一阶段（设计，产出 SCHEMA.md）`,
    `1. 通读源文档清单并抽样阅读（大文档只读关键章节）；`,
    `2. 按体系 A 规划 entities/ + concepts/ + comparisons/ + queries/，产出实体清单、跨实体概念清单、对比组清单（含每个页面 slug）；`,
    `3. 写 SCHEMA.md 前必须先读技能中 BUNDLED: references/schema-guide.md 块，SCHEMA 覆盖：领域定义、目录约定、Frontmatter 必填字段、标签体系、页面模板、交叉引用规则、index.md/log.md 规范；`,
    `4. 写入 ${schemaPath}。`,
    ``,
    `## 第二阶段（构建，紧接第一阶段，无需任何确认）`,
    `1. wiki-init：按你刚写的 SCHEMA.md 建骨架（index.md / log.md / 子目录 + .gitignore）；`,
    `2. Phase 1 规划：从 SCHEMA.md 取页面清单，结合本次 ${args.rawDocs.length} 篇源文档得到 pending 页面清单；`,
    `3. Phase 2 分批并行提取（核心）：先创建 ${args.wikiDir}/.ingest-cache/ 目录；按 MAX_CONCURRENT_AGENTS=5 启动子 Agent 批次，子 Agent 只输出结构化 JSON（frontmatter + 章节要点，不生成 Markdown），JSON 必须写到 ${args.wikiDir}/.ingest-cache/<slug>.json；子 Agent 超时 300s、失败重试 1 次（缩到最核心 3 篇源文档），仍失败由你兜底；`,
    `   每个子 Agent 的 prompt 必须显式给出输出路径，禁止写入 raw/、entities/、output/ 或项目根目录；JSON 字符串值内禁用中文引号；JSON 不含独立参见字段，跨页引用由你在 Phase 3 统一生成；`,
    `   ⚠ 禁止跳过剩余批次直接进入 Phase 3；每批完成后在 log.md 记录批次编号、页面列表、成功/失败数、累计进度；`,
    `4. Phase 3 合并组装：按技能中 BUNDLED: references/templates.md 的页面模板把 JSON 组装成正式 Markdown 页面，带 YAML frontmatter（title/tags/sources/updated/confidence/aliases/related），落到 entities/ concepts/ comparisons/ queries/；交叉引用只指向 SCHEMA.md 已定义 slug；在 index.md 建立总览与链接；`,
    `5. Phase 4 收尾：覆盖率验证（每篇源文档都出现在至少一个页面 sources 里）；更新 manifest.json；递归清理 .ingest-cache/ 与项目根目录临时文件，项目根目录只允许 raw/ 与 <wiki>/；`,
    `6. log.md 追加本次操作记录（含耗时与页面清单）。`,
    ``,
    `## 硬性约束`,
    `- 所有产出必须落在 ${args.wikiDir} 内；不得修改 raw/ 下任何文件；`,
    `- 不从记忆回答领域内容，一切信息来自源文档；`,
    `- 页面正文用中文（与源文档语言一致），slugs 用英文短横线命名。`,
    ``,
    `## 完成回执`,
    `全部完成后必须调用工具 ${doneTool} 回写结果，参数：`,
    `- projectId: "${args.projectId}"`,
    `- wikiDir: "${args.wikiDir}"`,
    `只有调用该工具后知识库才算构建完成，不得在不调用的情况下结束。`,
  ]
    .filter(Boolean)
    .join('\n')
}

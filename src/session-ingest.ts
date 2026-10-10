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
   * (requirement ③: the plugin carries its own skill).
   */
  skillText?: string
}

export interface SubmitResult {
  sessionId: string
}

/** List the raw/ files present so the session prompt can name them explicitly. */
async function stageSourceIndex(rawDir: string, docs: { name: string }[]): Promise<string> {
  const lines: string[] = []
  for (const d of docs) {
    try {
      await fs.stat(path.join(rawDir, d.name))
      lines.push(`- raw/${d.name}`)
    } catch {
      lines.push(`- raw/${d.name}（缺失，请跳过）`)
    }
  }
  return lines.join('\n')
}

/**
 * Wrap a task prompt with the bundled llm-wiki skill (when available): the
 * skill text goes first under a clear header, then the task instructions.
 */
function withSkill(skillText: string | undefined, task: string): string {
  if (!skillText || !skillText.trim()) return task
  return [
    `以下是你必须完整遵循的 llm-wiki 技能说明（内置，勿依赖外部技能目录）：`,
    ``,
    `<llm-wiki-skill>`,
    skillText.trim(),
    `</llm-wiki-skill>`,
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
  const prompt = withSkill(args.skillText, buildDesignPrompt(args, listing))
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
  const prompt = withSkill(args.skillText, buildIngestPrompt(args, listing, doneTool))
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
 */
export async function submitBuild(args: ProjectSubmitArgs): Promise<SubmitResult> {
  const rawDir = path.join(args.projectDir, 'raw')
  const listing = await stageSourceIndex(rawDir, args.rawDocs)
  const doneTool = args.doneTool ?? 'wiki_done'
  const prompt = withSkill(args.skillText, buildFullBuildPrompt(args, listing, doneTool))
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
  return [
    `你是知识库构建助手。请加载并使用 llm-wiki 技能，为下面这个项目执行 wiki-design 方法（只做设计，不要构建页面）。`,
    ``,
    `项目名：${args.projectName}`,
    args.domain ? `领域说明：${args.domain}` : ``,
    `工作目录（cwd）：${args.projectDir}`,
    `wiki 输出目录：${args.wikiDir}`,
    ``,
    `原始文档位于 raw/ 下：`,
    listing,
    ``,
    `任务：`,
    `1. 阅读 raw/ 文档清单与抽样内容，按 llm-wiki 的 wiki-design 思维框架确定用户画像 / 实体边界 / 交叉概念 / 高频查询；`,
    `2. 选定目录结构（推荐体系 A：entities/ + concepts/ + comparisons/ + queries/）；`,
    `3. 把设计结果写成一份 SCHEMA.md 草稿，路径：${path.join(args.wikiDir, 'SCHEMA.md')}。`,
    ``,
    `严格要求：`,
    `- 只在 wiki 输出目录内写 SCHEMA.md，不要生成任何页面、不要运行 ingest；`,
    `- SCHEMA.md 是该知识库唯一的配置来源；`,
    `- 不要调用任何"构建完成"类工具——本次只是设计，草稿会交回人工确认。`,
    `完成后用一句话说明你写入的 SCHEMA.md 路径与设计要点即可。`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildIngestPrompt(args: ProjectSubmitArgs, listing: string, doneTool: string): string {
  return [
    `你是知识库构建助手。请加载并使用 llm-wiki 技能，为下面这个项目执行 wiki-init + wiki-ingest，把 raw/ 里的源文档编译成结构化 wiki 页面。`,
    ``,
    `项目名：${args.projectName}`,
    `wiki 输出目录：${args.wikiDir}`,
    `（该目录下已有确认过的 SCHEMA.md，请以它为准，不要改写它。）`,
    ``,
    `本次要处理的原始文档（raw/ 下）：`,
    listing,
    ``,
    `任务（严格按 llm-wiki 的 ingest-workflow 执行）：`,
    `1. 若尚无骨架，按 SCHEMA.md 运行 wiki-init，建立 index.md / log.md 与子目录；`,
    `2. 运行 wiki-ingest，把上面每篇源文档编译进：`,
    `   - entities/  实体页（概念、组件、人物、产品等）`,
    `   - concepts/  概念页（定义与方法）`,
    `   - comparisons/ 对比页（如有可对比对象）`,
    `   - queries/   常见检索问题页（可选）`,
    `   并在 index.md 建立总览与链接；`,
    `3. 每个页面都带 YAML frontmatter（title / tags / sources / updated / confidence / aliases / related），正文用 Markdown；`,
    `4. 所有产出必须落在 wiki 输出目录内，任何缓存/中间文件写进该目录的 .ingest-cache/，根目录不得留下临时脚本或游离文件。`,
    ``,
    `完成后，必须调用工具 ${doneTool} 回写结果，参数为：`,
    `- projectId: "${args.projectId}"（务必与上面一致）`,
    `- wikiDir: "${args.wikiDir}"（你刚刚写入页面的目录）`,
    `只有在调用该工具后，知识库才算构建完成。不要在不调用该工具的情况下结束。`,
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
  return [
    `你是知识库构建助手。请加载并使用 llm-wiki 技能，为下面这个项目在一个会话内连续完成 设计（wiki-design）与 构建（wiki-init + wiki-ingest）两个阶段。`,
    ``,
    `项目名：${args.projectName}`,
    args.domain ? `领域说明：${args.domain}` : ``,
    `工作目录（cwd）：${args.projectDir}`,
    `wiki 输出目录：${args.wikiDir}`,
    ``,
    `原始文档位于 raw/ 下：`,
    listing,
    ``,
    `第一阶段（设计）：`,
    `1. 阅读 raw/ 文档清单与抽样内容，按 llm-wiki 的 wiki-design 思维框架确定用户画像 / 实体边界 / 交叉概念 / 高频查询；`,
    `2. 把设计结果写成 SCHEMA.md 草稿，路径：${path.join(args.wikiDir, 'SCHEMA.md')}。`,
    ``,
    `第二阶段（构建，紧接第一阶段，不要等待任何确认）：`,
    `1. 以你刚写入的 SCHEMA.md 为准运行 wiki-init，建立 index.md / log.md 与子目录；`,
    `2. 运行 wiki-ingest，把 raw/ 里每篇源文档编译进 entities/ concepts/ comparisons/ queries/，并在 index.md 建立总览与链接；`,
    `3. 每个页面都带 YAML frontmatter（title / tags / sources / updated / confidence / aliases / related），正文用 Markdown；`,
    `4. 所有产出必须落在 wiki 输出目录内，任何缓存/中间文件写进该目录的 .ingest-cache/，根目录不得留下临时脚本或游离文件。`,
    ``,
    `完成后，必须调用工具 ${doneTool} 回写结果，参数为：`,
    `- projectId: "${args.projectId}"（务必与上面一致）`,
    `- wikiDir: "${args.wikiDir}"（你刚刚写入页面的目录）`,
    `只有在调用该工具后，知识库才算构建完成。不要在不调用该工具的情况下结束。`,
  ]
    .filter(Boolean)
    .join('\n')
}

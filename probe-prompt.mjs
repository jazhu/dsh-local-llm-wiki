// Smoke probe for the optimized build prompts (session-ingest.ts).
// Renders each prompt through the real submit* functions (esbuild-compiled on
// the fly) with a capture-stub controller, then asserts:
//  - core: plugin-contract anchors (paths, done tool, receipts) present in EVERY mode;
//  - protocol: llm-wiki methodology restatements (phase numbers, concurrency,
//    BUNDLED pointers) present ONLY in inline/auto — in tool mode the skill
//    loaded via Step 0 is the sole methodology source (user ruling m08925:
//    the prompt must not carry skill content), and the NOT: assertions below
//    prove it;
//  - withSkill banner checks per mode.
// Run: node probe-prompt.mjs
import { render, cleanup } from './_probe-import.mjs'

// Core contract: must hold in every mode.
const core = {
  design: [
    ['schema target path', 'SCHEMA.md'],
    ['project facts section', '## 项目事实'],
    ['no-build constraint', '不构建页面'],
    ['no done tool', '不调用任何"构建完成"类工具'],
  ],
  ingest: [
    ['done tool', 'wiki_done'],
    ['projectId echo', '"proj-1"'],
    ['wikiDir echo', '"/tmp/wiki-proj/hillstone-wiki"'],
  ],
  build: [
    ['two phases', '第一阶段（设计，产出 SCHEMA.md）'],
    ['no pause', '无需任何确认'],
    ['batch logging', '累计进度'],
    ['done tool', 'wiki_done'],
  ],
  lintfix: [
    ['schema source', 'SCHEMA.md'],
    ['rule handling', 'error 级问题'],
    ['cleanliness', '清洁度'],
    ['done tool', 'wiki_done'],
  ],
}

// Protocol restatements: inline/auto only.
const protocol = {
  design: [['schema-guide pointer', 'BUNDLED: references/schema-guide.md']],
  ingest: [
    ['concurrency limit', 'MAX_CONCURRENT_AGENTS=5'],
    ['timeout', '300s'],
    ['retry once', '重试 1 次'],
    ['no chinese quotes in json', '禁用中文引号'],
    ['no see_also field', '不得包含独立的参见字段'],
    ['no batch skipping', '禁止跳过剩余批次直接进入 Phase 3'],
    ['coverage check', '覆盖率验证'],
    ['manifest update', 'last_updated'],
    ['assigned_to', 'assigned_to'],
    ['cleanup', '递归清理'],
    ['root whitelist', '项目根目录只允许 raw/ 与 <wiki>/'],
  ],
  build: [
    ['concurrency limit', 'MAX_CONCURRENT_AGENTS=5'],
    ['no batch skipping', '禁止跳过剩余批次直接进入 Phase 3'],
    ['coverage check', '覆盖率验证'],
    ['cleanup', '递归清理'],
    ['root whitelist', '项目根目录只允许 raw/ 与 <wiki>/'],
  ],
  lintfix: [
    ['templates reference', 'BUNDLED: references/templates.md'],
    ['missing pages', '补建缺失的目标页面'],
    ['frontmatter fields', 'title/tags/sources/updated/confidence/aliases/related'],
  ],
}

// Mode-specific checks.
const inlineOnly = {
  withSkill: [
    ['attachment pointer', '<llm-wiki-skill-attachment>'],
    ['BUNDLED marker hint', 'BUNDLED: <path>'],
    ['task after banner', '## 项目事实'],
    ['skill body present', '<skill-body>'],
  ],
}
// tool / auto: must reference the host skill tool. Only auto embeds the digest.
const toolMode = {
  design: [
    ['skill tool call', 'skill'],
    ['skill name', 'llm-wiki'],
  ],
  withSkill: [
    ['skill tool call', 'skill'],
    ['skill name', 'llm-wiki'],
    ['step 0', '步骤 0'],
  ],
}
// tool only: the leanest mode must NOT carry the digest NOR any skill
// methodology restatement — the loaded skill is the sole protocol source.
const toolOnly = {
  withSkill: [['no digest in tool mode', 'NOT:核心协议要点']],
  design: [['no schema-guide pointer', 'NOT:BUNDLED: references/schema-guide.md']],
  ingest: [
    ['no concurrency number', 'NOT:MAX_CONCURRENT_AGENTS'],
    ['no timeout number', 'NOT:300s'],
    ['no templates pointer', 'NOT:BUNDLED: references/templates.md'],
    ['points at skill instead', '以技能全文'],
  ],
  build: [
    ['no concurrency number', 'NOT:MAX_CONCURRENT_AGENTS'],
    ['no batch-skipping rule text', 'NOT:禁止跳过剩余批次直接进入'],
    ['points at skill instead', '以技能全文'],
  ],
  lintfix: [
    ['no templates pointer', 'NOT:BUNDLED: references/templates.md'],
    ['no frontmatter field list', 'NOT:confidence/aliases/related'],
  ],
}
// auto only: the fallback digest must be embedded.
const autoOnly = {
  withSkill: [['core digest', '核心协议要点']],
}

const results = []
const runChecks = async (kind, list, mode, text) => {
  for (const [label, needle] of list) {
    const variants = Array.isArray(needle) ? needle : [needle]
    const hit = variants.some((n) =>
      n.startsWith('NOT:') ? !text.includes(n.slice(4)) : text.includes(n),
    )
    results.push({ kind, label, needle, hit, mode })
    console.log(`${hit ? 'PASS' : 'FAIL'}  [${kind}/${mode}] ${label}${hit ? '' : ` — missing: ${needle}`}`)
  }
}
// core: every mode; protocol: inline/auto only.
for (const kind of Object.keys(core)) {
  for (const mode of ['inline', 'tool', 'auto']) {
    const text = await render(kind, mode)
    await runChecks(kind, core[kind], mode, text)
    if (mode !== 'tool' && protocol[kind]) await runChecks(kind, protocol[kind], mode, text)
  }
}
for (const [kind, list] of Object.entries(inlineOnly)) {
  const text = await render(kind, 'inline')
  await runChecks(kind, list, 'inline', text)
}
for (const mode of ['tool', 'auto']) {
  for (const [kind, list] of Object.entries(toolMode)) {
    const text = await render(kind, mode)
    await runChecks(kind, list, mode, text)
  }
}
for (const [kind, list] of Object.entries(toolOnly)) {
  const text = await render(kind, 'tool')
  await runChecks(kind, list, 'tool', text)
}
for (const [kind, list] of Object.entries(autoOnly)) {
  const text = await render(kind, 'auto')
  await runChecks(kind, list, 'auto', text)
}
const failed = results.filter((r) => !r.hit)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => `[${f.kind}] ${f.label}`).join(' | '))
  process.exitCode = 1
}
cleanup()

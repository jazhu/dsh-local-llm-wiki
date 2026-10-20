// Smoke probe for the optimized build prompts (session-ingest.ts).
// Renders each prompt through the real submit* functions (esbuild-compiled on
// the fly) with a capture-stub controller, then asserts the protocol anchors
// that make the session follow llm-wiki's ingest-workflow instead of
// improvising: agent fan-out limits, .ingest-cache output path contract,
// coverage check, manifest bookkeeping, batch logging, cleanup, done-tool.
// Run: node probe-prompt.mjs
import { render, cleanup } from './_probe-import.mjs'

const checks = {
  design: [
    ['schema-guide reference', 'BUNDLED: references/schema-guide.md'],
    ['schema target path', ['SCHEMA.md']],
    ['no-build constraint', '不构建页面'],
    ['no done tool', '不调用任何"构建完成"类工具'],
  ],
  ingest: [
    ['concurrency limit', 'MAX_CONCURRENT_AGENTS=5'],
    ['timeout', '300s'],
    ['retry once', '重试 1 次'],
    ['cache output path', '/tmp/wiki-proj/hillstone-wiki/.ingest-cache/<slug>.json'],
    ['forbidden output paths', '禁止写入 raw/'],
    ['no chinese quotes in json', '禁用中文引号'],
    ['no see_also field', '不得包含独立的参见字段'],
    ['no batch skipping', '禁止跳过剩余批次直接进入 Phase 3'],
    ['batch logging', '累计进度'],
    ['coverage check', '覆盖率验证'],
    ['manifest update', 'last_updated'],
    ['assigned_to', 'assigned_to'],
    ['cleanup', '递归清理'],
    ['root whitelist', '项目根目录只允许 raw/ 与 <wiki>/'],
    ['done tool', 'wiki_done'],
    ['projectId echo', '"proj-1"'],
    ['wikiDir echo', '"/tmp/wiki-proj/hillstone-wiki"'],
  ],
  build: [
    ['two phases', '第一阶段（设计，产出 SCHEMA.md）'],
    ['no pause', '无需任何确认'],
    ['concurrency limit', 'MAX_CONCURRENT_AGENTS=5'],
    ['cache output path', '/tmp/wiki-proj/hillstone-wiki/.ingest-cache/<slug>.json'],
    ['no batch skipping', '禁止跳过剩余批次直接进入 Phase 3'],
    ['coverage check', '覆盖率验证'],
    ['cleanup', '递归清理'],
    ['done tool', 'wiki_done'],
  ],
  lintfix: [
    ['schema source', 'SCHEMA.md'],
    ['templates reference', 'BUNDLED: references/templates.md'],
    ['missing pages', '补建缺失的目标页面'],
    ['frontmatter fields', 'title/tags/sources/updated/confidence/aliases/related'],
    ['cleanliness', '清洁度'],
    ['done tool', 'wiki_done'],
  ],
  withSkill: [
    ['attachment pointer', '<llm-wiki-skill-attachment>'],
    ['BUNDLED marker hint', 'BUNDLED: <path>'],
    ['task after banner', '## 项目事实'],
    ['skill body present', '<skill-body>'],
  ],
}

const results = []
for (const [kind, list] of Object.entries(checks)) {
  const text = await render(kind)
  for (const [label, needle] of list) {
    const variants = Array.isArray(needle) ? needle : [needle]
    const hit = variants.some((n) => text.includes(n))
    results.push({ kind, label, needle, hit })
    console.log(`${hit ? 'PASS' : 'FAIL'}  [${kind}] ${label}${hit ? '' : ` — missing: ${needle}`}`)
  }
}
const failed = results.filter((r) => !r.hit)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => `[${f.kind}] ${f.label}`).join(' | '))
  process.exitCode = 1
}
cleanup()

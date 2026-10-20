// Verify the protocol anchors are present in the built dist/index.mjs.
// esbuild escapes non-ASCII inside JS string literals as \uXXXX; this script
// decodes those sequences before probing so Chinese anchors can be matched.
// Run: node probe-dist.mjs
import fs from 'node:fs'

const raw = fs.readFileSync('dist/index.mjs', 'utf8')
const re = new RegExp('\\\\u([0-9a-fA-F]{4})', 'g')
const dec = raw.replace(re, (_m, h) => String.fromCharCode(parseInt(h, 16)))

const probes = [
  'MAX_CONCURRENT_AGENTS=5',
  '超时 300s',
  '重试 1 次',
  '覆盖率验证',
  '禁止跳过剩余批次',
  '禁用中文引号',
  '不得包含独立的参见字段',
  '递归清理',
  '项目根目录只允许 raw/ 与 <wiki>/',
  'manifest.json',
  'assigned_to',
  '孤立页面',
  'BUNDLED: references/schema-guide.md',
  'BUNDLED: references/templates.md',
  '<llm-wiki-skill-attachment>',
  'BUNDLED: <path>',
]

let ok = true
for (const p of probes) {
  const hit = dec.includes(p)
  if (!hit) ok = false
  console.log(`${hit ? 'OK  ' : 'MISS'} ${p}`)
}
console.log(`\ndist/index.mjs: ${ok ? 'ALL PRESENT' : 'GAPS REMAIN'} (${probes.length} anchors)`)
process.exitCode = ok ? 0 : 1

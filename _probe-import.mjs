// Smoke probe helper: renders the four build prompts from session-ingest.ts.
// The builders are module-private, so prompts are observed by importing the
// source compiled on the fly with esbuild and calling submit* against a
// capture-stub controller that records what would be sent to the session.
//
// Windows note: path.join produces backslashes, so probes must accept both
// separators when asserting on path-shaped needles.

import fs from 'node:fs'
import { build } from 'esbuild'
await build({
  entryPoints: ['src/session-ingest.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: 'dist/.probe-session-ingest.mjs',
  logLevel: 'error',
})
const si = await import('./dist/.probe-session-ingest.mjs')

const captured = []
const controller = {
  create: async () => ({ sessionId: 'sess-probe' }),
  rename: async () => {},
  selectModel: async () => {},
  prompt: async (req) => {
    captured.push(req.content[0].text)
  },
}

const args = {
  controller,
  projectDir: '/tmp/wiki-proj',
  wikiDir: '/tmp/wiki-proj/hillstone-wiki',
  projectId: 'proj-1',
  projectName: '山石网科 StoneOS',
  domain: '防火墙 CLI',
  agentPreset: '',
  signal: new AbortController().signal,
  rawDocs: [
    { name: 'a1b2c3d4_StoneOS手册.md', sha256: 'ff'.repeat(32), size: 204800 },
    { name: 'e5f6a7b8_接口配置.md', sha256: 'ab'.repeat(32), size: 51200 },
  ],
  skillText: '<skill-body>',
}

export async function render(kind) {
  captured.length = 0
  if (kind === 'design') await si.submitDesign(args)
  else if (kind === 'ingest') await si.submitIngest({ ...args, doneTool: 'wiki_done' })
  else if (kind === 'build') await si.submitBuild({ ...args, doneTool: 'wiki_done' })
  else if (kind === 'lintfix') await si.submitLintFix({ ...args, lintReport: '- [error] entities/a.md: 链接指向不存在的页面 b.md', doneTool: 'wiki_done' })
  else if (kind === 'withSkill') {
    // withSkill is private; the design prompt is wrapped by it, so render the
    // design prompt (skillText non-empty) and inspect the banner portion.
    await si.submitDesign(args)
  }
  return captured[0] ?? ''
}

export function cleanup() {
  try { fs.unlinkSync('dist/.probe-session-ingest.mjs') } catch {}
}

/**
 * dsh-local-llm-wiki build.
 *
 * Produces two bundles (mirrors the official dsh-plugin layout used by
 * dsh-knowledge-base):
 *   - dist/index.mjs  host plugin (ESM)     — Node half, mounts /wiki-api routes
 *   - dist/client.js  client plugin (CJS)   — browser half, sidebar entry + panel
 *
 * `react`, `react-dom`, and `react/jsx-runtime` are externalized: the harness
 * provides them at runtime as baseline module-table entries.
 *
 * Usage:  pnpm install && pnpm run build
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

mkdirIfMissing('dist')

// Type-check gate. esbuild bundles without type-checking, so a rename that
// slips the bundler would otherwise ship and crash at runtime. Fail loudly.
const tscCmd = (() => {
  try {
    require.resolve('typescript')
    return ['node', require.resolve('typescript/bin/tsc'), '--noEmit']
  } catch {
    return null
  }
})()

if (tscCmd) {
  try {
    execFileSync(tscCmd[0], tscCmd.slice(1), { stdio: 'inherit' })
    console.log('[build] tsc type-check: OK')
  } catch (err) {
    const code = err && err.status
    if (code === 2) {
      console.error('[build] tsc type-check FAILED — aborting build')
      process.exit(2)
    }
    console.warn('[build] tsc run failed, skipping type-check gate:', err && err.message)
  }
} else {
  console.warn('[build] typescript not found, skipping type-check gate')
}

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']
const nativeExternal = ['@firecrawl/anydoc']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: [...dshExternal, ...nativeExternal],
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [
    ...dshExternal,
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'scheduler',
  ],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-local-llm-wiki', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

function mkdirIfMissing(dir) {
  try {
    require('node:fs').mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
}

// Bundle the built-in llm-wiki skill (requirement ③, 2026-10-10): copy the
// skill markdown into dist/skills/ so the host half can inject it into every
// build session prompt without depending on any external skill directory.
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
try {
  mkdirSync('dist/skills', { recursive: true })
  copyFileSync('resources/llm-wiki-SKILL.md', 'dist/skills/llm-wiki.md')
  // Mirror the source locale/ into dist/ defensively: some installers/loader
  // paths stat <bundleRoot>/locale even when package exports point at the
  // package root, and a fresh clone without a full dist tree would otherwise
  // fail metadata loading with ENOENT scandir .../locale.
  cpSync('locale', 'dist/locale', { recursive: true })
  console.log('[build] bundled llm-wiki skill → dist/skills/llm-wiki.md; locale mirrored → dist/locale/')
} catch (err) {
  console.warn('[build] skill copy skipped:', err && err.message)
}

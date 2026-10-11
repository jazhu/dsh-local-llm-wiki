// ProjectStore: the on-disk truth for dsh-local-llm-wiki.
//
// Layout (under the plugin data dir):
//   registry.json                         — every WikiProject's metadata
//   projects/<projectId>/raw/             — immutable uploaded source docs
//   projects/<projectId>/raw/.cache/manifest.json — SHA256 snapshot for incremental ingest
//   projects/<projectId>/<wikiName>/      — the llm-wiki output layer (harvested)
//
// The registry is written atomically (tmp + rename). Pages are harvested from
// the wiki dir by walking only the whitelisted subdirs so a stray file the
// session dropped outside the wiki never enters the index.

import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { PluginSettings, RawDoc, WikiLintReport, WikiPage, WikiProject } from './types.ts'
import { parseWikiPage } from './wiki-parse.ts'

const REGISTRY_FILE = 'registry.json'
const MANIFEST_FILE = 'manifest.json'
const SETTINGS_FILE = 'settings.json'

interface Registry {
  version: number
  projects: WikiProject[]
}

const HARVEST_KINDS = ['entities', 'concepts', 'comparisons', 'queries'] as const

export class ProjectStore {
  readonly dataDir: string
  private registry: Registry = { version: 1, projects: [] }
  /** projectId -> harvested pages (also what the index is built from). */
  private pages = new Map<string, WikiPage[]>()
  private loaded = false

  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  private get projectsDir(): string {
    return path.join(this.dataDir, 'projects')
  }

  private projectDir(id: string): string {
    return path.join(this.projectsDir, id)
  }

  rawDir(id: string): string {
    return path.join(this.projectDir(id), 'raw')
  }

  /** Absolute project workspace dir (cwd handed to the DSH session). */
  projectAbs(id: string): string {
    return this.projectDir(id)
  }

  wikiDir(id: string): string {
    const p = this.get(id)
    return path.join(this.projectDir(id), p?.wikiName || 'wiki')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      await fs.mkdir(this.projectsDir, { recursive: true })
    } catch {
      /* ignore */
    }
    try {
      const txt = await fs.readFile(path.join(this.dataDir, REGISTRY_FILE), 'utf-8')
      const parsed = JSON.parse(txt) as Registry
      if (Array.isArray(parsed.projects)) this.registry = parsed
    } catch {
      /* first boot: no registry yet */
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
      const target = path.join(this.dataDir, REGISTRY_FILE)
      const tmp = target + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(this.registry, null, 2), 'utf-8')
      await fs.rename(tmp, target)
    } catch {
      /* best-effort; a lost write resets defaults next boot */
    }
  }

  list(): WikiProject[] {
    return [...this.registry.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): WikiProject | undefined {
    return this.registry.projects.find((p) => p.id === id)
  }

  private touch(p: WikiProject): void {
    p.updatedAt = new Date().toISOString()
  }

  async createProject(args: { name: string; domain?: string; wikiName?: string }): Promise<WikiProject> {
    await this.load()
    const base = slugify(args.name || 'project')
    // Ensure a unique id even if two projects share a slug.
    let id = base
    let n = 1
    while (this.get(id)) {
      id = `${base}-${n++}`
    }
    const now = new Date().toISOString()
    const project: WikiProject = {
      id,
      name: args.name.trim() || base,
      domain: (args.domain ?? '').trim(),
      wikiName: slugify(args.wikiName || 'wiki') || 'wiki',
      status: 'empty',
      createdAt: now,
      updatedAt: now,
      schemaConfirmed: false,
      pageCount: 0,
    }
    await fs.mkdir(this.rawDir(id), { recursive: true })
    this.registry.projects.push(project)
    await this.persist()
    return project
  }

  async updateProject(id: string, patch: Partial<Pick<WikiProject, 'name' | 'domain' | 'status' | 'schemaConfirmed' | 'schemaDraft' | 'dshSessionId' | 'error'>>): Promise<WikiProject | undefined> {
    await this.load()
    const p = this.get(id)
    if (!p) return undefined
    if (patch.name !== undefined) p.name = patch.name
    if (patch.domain !== undefined) p.domain = patch.domain
    if (patch.status !== undefined) p.status = patch.status
    if (patch.schemaConfirmed !== undefined) p.schemaConfirmed = patch.schemaConfirmed
    if (patch.schemaDraft !== undefined) p.schemaDraft = patch.schemaDraft
    if (patch.dshSessionId !== undefined) p.dshSessionId = patch.dshSessionId
    if (patch.error !== undefined) p.error = patch.error
    this.touch(p)
    await this.persist()
    return p
  }

  async deleteProject(id: string): Promise<boolean> {
    await this.load()
    const before = this.registry.projects.length
    this.registry.projects = this.registry.projects.filter((p) => p.id !== id)
    this.pages.delete(id)
    if (this.registry.projects.length === before) return false
    try {
      await fs.rm(this.projectDir(id), { recursive: true, force: true })
    } catch {
      /* dir may already be gone */
    }
    await this.persist()
    return true
  }

  /** Write an uploaded file into raw/, record it, update manifest + status. */
  async addUpload(id: string, file: { name: string; mime: string; data: Buffer }): Promise<RawDoc> {
    await this.load()
    const p = this.get(id)
    if (!p) throw new Error('project not found')
    const safeName = sanitizeName(file.name)
    const docId = randomUUID()
    const dir = this.rawDir(id)
    await fs.mkdir(dir, { recursive: true })
    // Prefix with a short id so two same-named uploads never collide on disk.
    const diskName = `${docId.slice(0, 8)}-${safeName}`
    const abs = path.join(dir, diskName)
    await fs.writeFile(abs, file.data)
    const sha256 = createHash('sha256').update(file.data).digest('hex')
    const doc: RawDoc = {
      id: docId,
      name: safeName,
      mime: file.mime || guessMime(safeName),
      size: file.data.length,
      uploadedAt: new Date().toISOString(),
      sha256,
    }
    await this.writeManifestEntry(id, diskName, sha256)
    // A new upload changes what needs to be built. Don't disturb a project that
    // is mid-flight (designing/ingesting/harvesting); otherwise drop it back to
    // 'uploaded' so the UI re-offers design (no schema yet) or rebuild (schema
    // already confirmed).
    const midflight = p.status === 'designing' || p.status === 'ingesting' || p.status === 'harvesting'
    if (!midflight) {
      p.status = 'uploaded'
    }
    this.touch(p)
    await this.persist()
    return doc
  }

  /** Snapshot of raw/ file names + hashes currently on disk (for incremental diff + listing). */
  async scanRaw(id: string): Promise<{ name: string; sha256: string; size: number; mtime: string }[]> {
    const dir = this.rawDir(id)
    const out: { name: string; sha256: string; size: number; mtime: string }[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile()) continue
        if (e.name.startsWith('.')) continue
        const abs = path.join(dir, e.name)
        try {
          const buf = await fs.readFile(abs)
          const mtime = (await fs.stat(abs)).mtime.toISOString()
          out.push({ name: e.name, sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length, mtime })
        } catch {
          /* unreadable file — skip */
        }
      }
    } catch {
      /* no raw dir yet */
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async writeManifestEntry(id: string, fileName: string, sha256: string): Promise<void> {
    const cacheDir = path.join(this.rawDir(id), '.cache')
    await fs.mkdir(cacheDir, { recursive: true })
    const mf = path.join(cacheDir, MANIFEST_FILE)
    let manifest: Record<string, string> = {}
    try {
      manifest = JSON.parse(await fs.readFile(mf, 'utf-8'))
    } catch {
      /* new */
    }
    manifest[fileName] = sha256
    await fs.writeFile(mf, JSON.stringify(manifest, null, 2), 'utf-8')
  }

  /** Read the raw/.cache/manifest.json snapshot. */
  async readManifest(id: string): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.rawDir(id), '.cache', MANIFEST_FILE), 'utf-8'))
    } catch {
      return {}
    }
  }

  /**
   * Delete one uploaded raw file (by sha256 match) and every built page whose
   * frontmatter `sources` cites that file. Returns the removed page count.
   */
  async deleteUpload(id: string, sha256: string): Promise<number> {
    const dir = this.rawDir(id)
    // 1. locate the raw file by content hash
    let targetName: string | null = null
    for (const f of await this.scanRaw(id)) {
      if (f.sha256 === sha256) { targetName = f.name; break }
    }
    if (!targetName) throw new Error('未找到该上传文件（SHA256 不匹配）')
    const bare = targetName.replace(/^[0-9a-f]{8}-/, '')
    const stem = bare.replace(/\.[^.]+$/, '').toLowerCase()
    // 2. remove built pages that cite this file (same fuzzy match as /project/:id sourceGroups)
    const pages = this.getPages(id).length ? this.getPages(id) : await this.harvest(id)
    let removedPages = 0
    for (const pg of pages) {
      const cited = pg.sources.some((s) => {
        const ls = s.toLowerCase()
        const file = ls.split('#')[0].trim()
        const fStem = file.replace(/\.[^.]+$/, '')
        return (fStem && (stem.includes(fStem) || fStem.includes(stem))) || (file && ls.includes(stem))
      })
      if (!cited) continue
      // page path is wiki-relative; guard against traversal
      const abs = path.join(this.wikiDir(id), pg.path.replace(/\\/g, '/'))
      const root = path.resolve(this.wikiDir(id))
      if (path.resolve(abs).startsWith(root)) {
        try { await fs.unlink(path.resolve(abs)); removedPages++ } catch { /* already gone */ }
      }
    }
    // 3. remove the raw file itself + manifest entry
    await fs.unlink(path.join(dir, targetName))
    try {
      const mf = path.join(dir, '.cache', MANIFEST_FILE)
      const manifest = JSON.parse(await fs.readFile(mf, 'utf-8'))
      delete manifest[targetName]
      await fs.writeFile(mf, JSON.stringify(manifest, null, 2), 'utf-8')
    } catch { /* manifest optional */ }
    // 4. re-harvest to refresh page cache; update pageCount
    const remaining = await this.harvest(id)
    const proj = this.get(id)
    if (proj) {
      proj.pageCount = remaining.length
      proj.updatedAt = new Date().toISOString()
      await this.persist()
    }
    return removedPages
  }

  /**
   * Harvest every markdown page under the wiki dir's whitelisted subdirs plus
   * index.md. Returns the parsed pages and refreshes the in-memory cache.
   */
  async harvest(id: string, wikiDirAbs?: string): Promise<WikiPage[]> {
    await this.load()
    const p = this.get(id)
    if (!p) throw new Error('project not found')
    const root = wikiDirAbs || this.wikiDir(id)
    const pages: WikiPage[] = []
    for (const kind of HARVEST_KINDS) {
      const sub = path.join(root, kind)
      const found = await this.walkMarkdown(sub, root, id)
      pages.push(...found)
    }
    // index.md at the wiki root is a page too.
    const indexAbs = path.join(root, 'index.md')
    try {
      const md = await fs.readFile(indexAbs, 'utf-8')
      pages.push(parseWikiPage({ id: `${id}:index`, path: relPath(root, indexAbs), relPath: 'index.md', markdown: md }))
    } catch {
      /* no index yet */
    }
    this.pages.set(id, pages)
    p.pageCount = pages.length
    p.harvestedAt = new Date().toISOString()
    this.touch(p)
    await this.persist()
    return pages
  }

  getPages(id: string): WikiPage[] {
    return this.pages.get(id) ?? []
  }

  private async walkMarkdown(dir: string, root: string, projectId: string): Promise<WikiPage[]> {
    const out: WikiPage[] = []
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        out.push(...(await this.walkMarkdown(abs, root, projectId)))
      } else if (/\.(md|markdown)$/i.test(e.name)) {
        try {
          const md = await fs.readFile(abs, 'utf-8')
          const rel = relPath(root, abs)
          out.push(parseWikiPage({ id: `${projectId}:${rel}`, path: rel, relPath: rel, markdown: md }))
        } catch {
          /* unreadable page — skip, don't fail the harvest */
        }
      }
    }
    return out
  }

  /**
   * Import an already-built wiki directory into the project: recursively copy
   * it over the project's wiki dir (merging; existing files are overwritten),
   * then harvest. Returns the harvested page count. Refuses to import from a
   * directory inside the project's own data dir (it is already there).
   */
  async importWikiDir(id: string, sourceDir: string): Promise<number> {
    await this.load()
    const p = this.get(id)
    if (!p) throw new Error('project not found')
    const src = path.resolve(sourceDir)
    let stat
    try {
      stat = await fs.stat(src)
    } catch {
      throw new Error(`源目录不存在: ${src}`)
    }
    if (!stat.isDirectory()) throw new Error(`源路径不是目录: ${src}`)
    const dest = this.wikiDir(id)
    if (src === path.resolve(dest) || path.resolve(dest).startsWith(src + path.sep) || src.startsWith(path.resolve(this.dataDir) + path.sep)) {
      throw new Error('源目录不能位于插件数据目录内')
    }
    await copyDir(src, dest)
    const pages = await this.harvest(id)
    if (!pages.length) throw new Error('导入完成但未收割到任何页面（需要 entities/concepts/comparisons/queries 子目录或 index.md）')
    return pages.length
  }

  /** Store a SCHEMA.md draft into the wiki dir (after user confirmation). */
  async writeSchema(id: string, schema: string): Promise<void> {
    const root = this.wikiDir(id)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'SCHEMA.md'), schema, 'utf-8')
  }

  async readSchema(id: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.wikiDir(id), 'SCHEMA.md'), 'utf-8')
    } catch {
      return null
    }
  }

  /** Read one page's full markdown from disk by its relative path. */
  async readPage(id: string, pageRelPath: string): Promise<string | null> {
    const root = this.wikiDir(id)
    const abs = path.join(root, ...pageRelPath.split(/[\\/]/))
    // guard against traversal
    if (!abs.startsWith(root)) return null
    try {
      return await fs.readFile(abs, 'utf-8')
    } catch {
      return null
    }
  }

  /** Apply a lint report onto a project record. */
  setLint(id: string, report: WikiLintReport): void {
    const p = this.get(id)
    if (!p) return
    p.lint = report
    this.touch(p)
    void this.persist()
  }

  /**
   * On boot, any project stuck mid-flight (designing/ingesting/harvesting) can
   * no longer be trusted — its DSH session is gone. Mark it `failed` with a
   * resume hint so the UI offers a rebuild instead of a spinner forever.
   */
  async markStalled(): Promise<string[]> {
    await this.load()
    const stalled: string[] = []
    for (const p of this.registry.projects) {
      if (p.status === 'designing' || p.status === 'ingesting' || p.status === 'harvesting') {
        p.status = 'failed'
        p.error = '会话在插件重启时中断，需要重新构建'
        p.dshSessionId = undefined
        this.touch(p)
        stalled.push(p.id)
      }
    }
    if (stalled.length) await this.persist()
    return stalled
  }

  /** Re-load harvested pages from disk after a restart (index rebuild). */

  // ---- settings persistence (2026-10-11) ----------------------------------
  // The settings page previously mutated only the in-memory runtime config, so
  // every restart (or host re-activation) silently reset workspace/model to
  // defaults — the "settings revert themselves" bug. Persist to
  // <dataDir>/settings.json and overlay on top of the resolved config.

  /** Overlay persisted settings onto a resolved config (mutates and returns it). */
  async loadSettingsInto<T extends { ingestWorkspaceId: string; ingestModel: string; ingestAgentPreset: string; ingestPermissionPreset: string }>(resolved: T): Promise<T> {
    const saved = await this.readSettings()
    if (saved.ingestWorkspaceId !== undefined) resolved.ingestWorkspaceId = saved.ingestWorkspaceId
    if (saved.ingestModel !== undefined) resolved.ingestModel = saved.ingestModel
    if (saved.ingestAgentPreset !== undefined) resolved.ingestAgentPreset = saved.ingestAgentPreset
    if (saved.ingestPermissionPreset !== undefined) resolved.ingestPermissionPreset = saved.ingestPermissionPreset
    return resolved
  }

  async readSettings(): Promise<PluginSettings> {
    try {
      const txt = await fs.readFile(path.join(this.dataDir, SETTINGS_FILE), 'utf-8')
      const parsed = JSON.parse(txt) as PluginSettings
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  async saveSettings(patch: PluginSettings): Promise<PluginSettings> {
    const merged = { ...(await this.readSettings()) }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      ;(merged as Record<string, unknown>)[k] = v
    }
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
      const target = path.join(this.dataDir, SETTINGS_FILE)
      const tmp = target + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf-8')
      await fs.rename(tmp, target)
    } catch {
      /* best-effort */
    }
    return merged
  }
  async reloadPages(id: string): Promise<WikiPage[]> {
    try {
      return await this.harvest(id)
    } catch {
      return []
    }
  }
}

// ---- helpers --------------------------------------------------------------

function relPath(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/')
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(s, d)
    } else if (e.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}

export function slugify(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return cleaned || ''
}

function sanitizeName(name: string): string {
  const cleaned = String(name || 'document')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 160)
  return cleaned || 'document'
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    case 'csv':
      return 'text/csv'
    case 'html':
    case 'htm':
      return 'text/html'
    case 'json':
      return 'application/json'
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    default:
      return 'application/octet-stream'
  }
}

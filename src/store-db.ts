// dsh-local-llm-wiki — SQLite durable storage for the registry and settings.
//
// registry.json and settings.json were whole-file JSON documents rewritten on
// every mutation. SQLite (node:sqlite, ships with Node 22.19+/24) replaces
// them with a transactional store — zero new dependencies. Raw documents and
// wiki pages stay as files (they are the DSH session's working material).
//
// Contract (mirrors dsh-hillstone-cli-ops OpsDb):
//   - the in-memory registry object stays authoritative for the live view;
//     the DB is written through on every persist() and read back only at load;
//   - every write is synchronous best-effort: a storage failure is swallowed
//     so the plugin keeps working with in-memory data;
//   - a one-time migration imports registry.json / settings.json when the DB
//     is empty and the legacy files exist; the files are renamed *.imported
//     so a later empty-DB state never re-imports stale data.

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import type { PluginSettings, WikiProject } from './types.ts'

export interface SqliteLogger {
  warn?(message: string): void
  info?(message: string): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export class WikiDb {
  private db: DatabaseSync | undefined
  private readonly dbPath: string
  private readonly log: SqliteLogger

  constructor(dataDir: string, log: SqliteLogger = {}) {
    this.dbPath = join(dataDir, 'wiki.db')
    this.log = log
    try {
      mkdirSync(dataDir, { recursive: true })
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec(SCHEMA)
      this.db.exec('PRAGMA journal_mode = WAL;')
    } catch (e) {
      // The plugin must survive a broken db the way it survived a corrupt JSON
      // file: warn, keep the in-memory registry authoritative, skip all writes.
      this.log.warn?.(`[dsh-local-llm-wiki] SQLite 初始化失败，数据仅保存在内存：${(e as Error).message}`)
      this.db = undefined
    }
  }

  get usable(): boolean {
    return this.db !== undefined
  }

  putProjects(projects: WikiProject[]): void {
    if (!this.db) return
    try {
      this.db.exec('BEGIN')
      this.db.prepare('DELETE FROM projects').run()
      const ins = this.db.prepare(
        'INSERT INTO projects (id, name, status, updated_at, json) VALUES (?, ?, ?, ?, ?)',
      )
      for (const p of projects) {
        ins.run(p.id, p.name, p.status, p.updatedAt, JSON.stringify(p))
      }
      this.db.exec('COMMIT')
    } catch (e) {
      try { this.db?.exec('ROLLBACK') } catch { /* ignore */ }
      this.log.warn?.(`[dsh-local-llm-wiki] 项目写入 SQLite 失败（内存数据不受影响）：${(e as Error).message}`)
    }
  }

  projectRows(): WikiProject[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare('SELECT json FROM projects').all() as { json: string }[]
      return rows
        .map((r) => { try { return JSON.parse(r.json) as WikiProject } catch { return null } })
        .filter((p): p is WikiProject => !!p && typeof p.id === 'string')
    } catch {
      return []
    }
  }

  putSettings(settings: PluginSettings): void {
    if (!this.db) return
    try {
      this.db.exec('BEGIN')
      this.db.prepare('DELETE FROM settings').run()
      const ins = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      for (const [k, v] of Object.entries(settings)) {
        if (v === undefined) continue
        ins.run(k, JSON.stringify(v))
      }
      this.db.exec('COMMIT')
    } catch (e) {
      try { this.db?.exec('ROLLBACK') } catch { /* ignore */ }
      this.log.warn?.(`[dsh-local-llm-wiki] 设置写入 SQLite 失败：${(e as Error).message}`)
    }
  }

  settingRows(): PluginSettings {
    if (!this.db) return {}
    try {
      const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
      const out: PluginSettings = {}
      for (const r of rows) {
        try { (out as Record<string, unknown>)[r.key] = JSON.parse(r.value) } catch { /* skip bad row */ }
      }
      return out
    } catch {
      return {}
    }
  }

  isEmpty(): boolean {
    return this.projectRows().length === 0 && Object.keys(this.settingRows()).length === 0
  }

  dispose(): void {
    try { this.db?.close() } catch { /* ignore */ }
    this.db = undefined
  }
}

/**
 * One-time import of the legacy JSON files. Only runs when the DB holds
 * nothing; afterwards the files are renamed *.imported so they can never be
 * imported twice (a second import would resurrect deleted projects).
 */
export function migrateLegacyJson(
  db: WikiDb,
  dataDir: string,
): { projects: number; settings: number } {
  const regFile = join(dataDir, 'registry.json')
  const setFile = join(dataDir, 'settings.json')
  if (!existsSync(regFile) && !existsSync(setFile)) return { projects: 0, settings: 0 }
  let projects: WikiProject[] = []
  let settings: PluginSettings = {}
  try {
    if (existsSync(regFile)) {
      const parsed = JSON.parse(readFileSync(regFile, 'utf-8')) as { projects?: unknown }
      projects = Array.isArray(parsed?.projects)
        ? parsed.projects.filter((p: any): p is WikiProject => p && typeof p.id === 'string')
        : []
    }
    if (existsSync(setFile)) {
      settings = JSON.parse(readFileSync(setFile, 'utf-8')) as PluginSettings
      if (!settings || typeof settings !== 'object') settings = {}
    }
  } catch {
    return { projects: 0, settings: 0 } // corrupt legacy file — start fresh, as before
  }
  db.putProjects(projects)
  db.putSettings(settings)
  for (const f of [regFile, setFile]) {
    try {
      if (existsSync(f)) renameSync(f, f + '.imported')
    } catch { /* ignore */ }
  }
  return { projects: projects.length, settings: Object.keys(settings).length }
}

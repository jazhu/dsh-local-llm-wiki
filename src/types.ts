// Shared types for the dsh-local-llm-wiki plugin.

/** A wiki page harvested from a project's <wiki>/ directory. */
export interface WikiPage {
  /** Stable page id (project-scoped): the relative path without extension. */
  id: string
  /** Relative path inside the project dir, e.g. "my-wiki/entities/foo.md". */
  path: string
  /** Page kind derived from its directory: entities|concepts|comparisons|queries|index|other. */
  kind: WikiPageKind
  title: string
  /** YAML frontmatter tags. */
  tags: string[]
  /** Source documents this page cites (from frontmatter `sources`). */
  sources: string[]
  /** 0..1 confidence from frontmatter, default 1. */
  confidence: number
  updated: string
  /** Plain-text body (frontmatter stripped). */
  text: string
  /** First paragraph / gist, for snippets. */
  summary: string
}

export type WikiPageKind = 'entities' | 'concepts' | 'comparisons' | 'queries' | 'index' | 'other'

/** One project (a self-contained llm-wiki layout). */
export interface WikiProject {
  id: string
  name: string
  /** One-line domain description. */
  domain: string
  wikiName: string
  status: WikiProjectStatus
  createdAt: string
  updatedAt: string
  /** DSH session id of the in-flight ingest, if any. */
  dshSessionId?: string
  /** Schema draft awaiting user confirmation (SCHEMA.md content). */
  schemaDraft?: string
  schemaConfirmed: boolean
  /** Harvest summary: page counts by kind. */
  pageCount: number
  /** Last harvest timestamp. */
  harvestedAt?: string
  /** Last lint report (subset we can run offline). */
  lint?: WikiLintReport
  /** Last error, if status === 'failed'. */
  error?: string
}

/**
 * How the llm-wiki skill reaches a build session (user-requested 2026-10-20).
 * - `inline`: prepend the full ~75 KB skill text to the prompt (v0.4.4 default).
 * - `tool`:   name the host `skill` tool and require the session to load
 *             llm-wiki through it; the prompt carries only the task.
 * - `auto`:   same as `tool`, plus a compact core-protocol digest so the session
 *             still follows the hard numbers when the skill call fails.
 */
export type SkillInjection = 'inline' | 'tool' | 'auto'

/** Settings-page persisted values (2026-10-11): survive restarts. */
export interface PluginSettings {
  ingestWorkspaceId?: string
  ingestModel?: string
  ingestAgentPreset?: string
  ingestPermissionPreset?: string
  skillInjection?: SkillInjection
}

export type WikiProjectStatus =
  | 'empty' // created, no uploads yet
  | 'uploaded' // raw docs present, not yet designed
  | 'designing' // design session submitted
  | 'awaiting-schema-confirm' // schema draft ready
  | 'ingesting' // ingest session submitted
  | 'harvesting' // wiki_done received, harvesting
  | 'ready' // harvested + indexed
  | 'failed'

export interface WikiLintReport {
  checkedAt: string
  errorCount: number
  warnCount: number
  issues: { severity: 'error' | 'warn'; message: string; page?: string }[]
}

/** A raw uploaded document. */
export interface RawDoc {
  id: string
  name: string
  mime: string
  size: number
  uploadedAt: string
  sha256: string
}

/** Incremental ingest classification (matches llm-wiki's three modes). */
export type IngestMode = 'added' | 'modified' | 'unchanged' | 'removed'

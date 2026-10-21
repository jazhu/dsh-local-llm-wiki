// dsh-local-llm-wiki client half: the browser panel.
//
// A sidebar entry "知识库" opens a single-page panel with three concerns:
//   * 项目   — create a knowledge base, upload source docs (drag-drop), design
//              (SCHEMA draft), confirm the schema, then build the wiki
//   * 检索   — search across harvested pages; open a page to read it whole
//   * 状态   — global + per-project build status and lint counts
//
// All calls go to the host's loopback API at a fixed 127.0.0.1:<port>/wiki-api.

import { createElement as h, Component, useState, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const PANEL_ID = 'dsh-local-llm-wiki'
const API_BASE = 'http://127.0.0.1:18781'
const API = `${API_BASE}/wiki-api`

// ---- tiny fetch helpers ----------------------------------------------------

async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' } })
  const data = await r.json().catch(() => ({ ok: false, error: 'bad json' }))
  if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as T
}
async function apiPostJson<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({ ok: false, error: 'bad json' }))
  if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data as T
}
async function apiText(path: string): Promise<string> {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.text()
}
async function apiUpload(projectId: string, files: File[]): Promise<void> {
  const form = new FormData()
  form.append('projectId', projectId)
  for (const f of files) form.append('file', f, f.name)
  const r = await fetch(API + '/upload', { method: 'POST', body: form })
  const data = await r.json().catch(() => ({ ok: false }))
  if (!data.ok) throw new Error(data.error || 'upload 失败')
}

// ---- styles ----------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById('dsh-local-llm-wiki-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-local-llm-wiki-style'
  style.textContent = `
.dsw-root { --dsw-pad: 14px; padding: var(--dsw-pad); color: var(--dsw-text-color, #1f2328);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  max-height: calc(100vh - 90px); overflow-y: auto; overscroll-behavior: contain; }
.dsw-root h3 { margin: 0 0 8px; font-size: 15px; }
.dsw-tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--dsw-border-color, #d0d7de); }
.dsw-tab { padding: 6px 12px; cursor: pointer; border: 1px solid transparent; border-bottom: none; opacity: .7; font-size: 13px; }
.dsw-tab.dsw-active { opacity: 1; border-color: var(--dsw-border-color, #d0d7de); border-radius: 6px 6px 0 0; background: var(--dsw-bg-color, #fff); }
.dsw-card { border: 1px solid var(--dsw-border-color, #d0d7de); border-radius: var(--dsw-radius-sm, 8px); padding: 12px; margin-bottom: 12px; background: var(--dsw-bg-color, #fff); }
.dsw-drop { border: 2px dashed var(--dsw-border-color, #d0d7de); border-radius: var(--dsw-radius-md, 10px);
  padding: 22px; text-align: center; color: var(--dsw-text-muted-color, #6b7280); cursor: pointer; }
.dsw-drop.dsw-over { border-color: var(--dsw-accent-color, #3b82f6); background: var(--dsw-accent-soft-color, #eff6ff); }
.dsw-btn { display: inline-block; padding: 6px 12px; border-radius: var(--dsw-radius-sm, 8px); border: 1px solid var(--dsw-border-color, #d0d7de);
  background: var(--dsw-accent-color, #3b82f6); color: #fff; cursor: pointer; font-size: 13px; margin: 2px 4px 2px 0; }
.dsw-btn.dsw-ghost { background: transparent; color: var(--dsw-text-color, #1f2328); }
.dsw-btn:disabled { opacity: .5; cursor: default; }
.dsw-input, .dsw-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-border-color, #d0d7de); background: var(--dsw-bg-color, #fff); color: var(--dsw-text-color, #1f2328); font-size: 13px; }
.dsw-textarea { min-height: 180px; font-family: ui-monospace, monospace; font-size: 12px; }
.dsw-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsw-muted { color: var(--dsw-text-muted-color, #6b7280); font-size: 12px; }
.dsw-err { color: #b91c1c; font-size: 12px; margin: 6px 0; }
.dsw-badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-border-color, #d0d7de); }
.dsw-badge.dsw-warn { color: #b45309; border-color: #fcd34d; }
.dsw-badge.dsw-err { color: #b91c1c; border-color: #fca5a5; }
.dsw-badge.dsw-ok { color: #047857; border-color: #6ee7b7; }
.dsw-hit { border-left: 3px solid var(--dsw-accent-color, #3b82f6); padding: 6px 10px; margin: 8px 0; background: var(--dsw-bg-soft-color, #f8fafc); border-radius: 0 6px 6px 0; }
.dsw-page { white-space: pre-wrap; font-size: 13px; line-height: 1.6; max-height: 60vh; overflow: auto;
  font-family: ui-monospace, monospace; background: var(--dsw-bg-soft-color, #f8fafc); padding: 10px; border-radius: 8px; }
.dsw-list { list-style: none; padding: 0; margin: 0; }
.dsw-list li { padding: 8px 0; border-bottom: 1px solid var(--dsw-border-soft-color, #eef2f6); }
.dsw-scroll { max-height: 46vh; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
.dsw-chip { display: inline-block; padding: 3px 10px; margin: 3px 6px 3px 0; border-radius: 999px; font-size: 12px;
  border: 1px solid var(--dsw-border-color, #d0d7de); background: var(--dsw-bg-soft-color, #f8fafc);
  color: var(--dsw-text-color, #1f2328); cursor: pointer; }
.dsw-chip:hover { border-color: var(--dsw-accent-color, #3b82f6); color: var(--dsw-accent-color, #3b82f6); }
.dsw-file { font-size: 12px; padding: 5px 0; border-bottom: 1px solid var(--dsw-border-soft-color, #eef2f6);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
`
  document.head.appendChild(style)
}

// ---- error boundary --------------------------------------------------------

interface EBState { hasError: boolean; msg: string }
class PageErrorBoundary extends Component<{ children?: ReactNode }, EBState> {
  state: EBState = { hasError: false, msg: '' }
  static getDerivedStateFromError(err: Error): EBState {
    return { hasError: true, msg: err?.message || String(err) }
  }
  render(): ReactNode {
    if (this.state.hasError) {
      return h('div', { className: 'dsw-root' }, h('div', { className: 'dsw-err' }, '知识库面板出错：', this.state.msg))
    }
    return this.props.children
  }
}

// ---- main component --------------------------------------------------------

type ProjectStatus =
  | 'empty' | 'uploaded' | 'designing' | 'awaiting-schema-confirm'
  | 'ingesting' | 'harvesting' | 'ready' | 'failed'

interface Project {
  id: string
  name: string
  status: ProjectStatus
  pageCount: number
  domain: string
  wikiName: string
  schemaConfirmed: boolean
  updatedAt: string
  error?: string
  lint?: { errorCount: number; warnCount: number } | null
}

interface Hit {
  projectId: string
  projectName: string
  path: string
  kind: string
  title: string
  tags: string[]
  score: number
  snippet: string
}

interface UploadInfo { name: string; size: number; sha256: string; mtime?: string }
interface PageInfo { path: string; kind: string; title: string; tags: string[]; updated: string }
interface SourceGroup { name: string; sha256: string; pages: PageInfo[] }

function statusBadgeClass(s: ProjectStatus): string {
  if (s === 'ready') return 'dsw-badge dsw-ok'
  if (s === 'failed') return 'dsw-badge dsw-err'
  if (s === 'designing' || s === 'ingesting' || s === 'harvesting') return 'dsw-badge dsw-warn'
  return 'dsw-badge'
}

// ---- toast (user-requested 2026-10-11) --------------------------------------
// Transient error/success notification: floats above the panel and fades away
// on its own after a few seconds instead of occupying a permanent row.

const TOAST_MS = 5000

function useToast(): { toast: { text: string; kind: 'err' | 'ok' } | null; showToast: (text: string, kind?: 'err' | 'ok') => void; clearToast: () => void } {
  const [toast, setToast] = useState<{ text: string; kind: 'err' | 'ok' } | null>(null)
  const showToast = useCallback((text: string, kind: 'err' | 'ok' = 'err') => {
    setToast({ text, kind })
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])
  return { toast, showToast, clearToast: () => setToast(null) }
}

function ToastView(props: { toast: { text: string; kind: 'err' | 'ok' } | null; onClose: () => void }): ReactNode {
  const { toast, onClose } = props
  if (!toast) return null
  return h(
    'div',
    {
      style: {
        position: 'fixed',
        top: '40%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 99999,
        maxWidth: 420,
        minWidth: 220,
        textAlign: 'center',
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.5,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        background: toast.kind === 'err' ? '#fef2f2' : '#f0fdf4',
        color: toast.kind === 'err' ? '#b91c1c' : '#15803d',
        border: toast.kind === 'err' ? '1px solid #fca5a5' : '1px solid #86efac',
        cursor: 'pointer',
      },
      onClick: onClose,
      title: '点击关闭',
    },
    toast.text,
  )
}

const POLL_MS = 2000

function Panel(): ReactNode {
  const [tab, setTab] = useState<'projects' | 'search' | 'status' | 'settings'>('projects')
  const [projects, setProjects] = useState<Project[]>([])
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const { toast, showToast, clearToast } = useToast()

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<{ projects: Project[] }>('/projects')
      setProjects(data.projects)
      setErr('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
      showToast('API 错误：' + msg, 'err')
    }
  }, [showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll while any project is mid-flight.
  useEffect(() => {
    const midflight = projects.some((p) => ['designing', 'ingesting', 'harvesting'].includes(p.status))
    if (!midflight) return
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [projects, refresh])

  return h(
    'div',
    { className: 'dsw-root' },
    h('h3', null, '知识库 (dsh-local-llm-wiki)'),
    h(
      'div',
      { className: 'dsw-tabs' },
      h('div', { className: 'dsw-tab' + (tab === 'projects' ? ' dsw-active' : ''), onClick: () => setTab('projects') }, '项目'),
      h('div', { className: 'dsw-tab' + (tab === 'search' ? ' dsw-active' : ''), onClick: () => setTab('search') }, '检索'),
      h('div', { className: 'dsw-tab' + (tab === 'status' ? ' dsw-active' : ''), onClick: () => setTab('status') }, '状态'),
      h('div', { className: 'dsw-tab' + (tab === 'settings' ? ' dsw-active' : ''), onClick: () => setTab('settings') }, '设置'),
    ),
    err ? h('div', { className: 'dsw-err' }, 'API 错误：', err) : null,
    tab === 'projects' && h(ProjectsTab, { projects, refresh, creating, setCreating, showToast }),
    tab === 'search' && h(SearchTab, {}),
    tab === 'status' && h(StatusTab, { projects }),
    tab === 'settings' && h(SettingsTab, { showToast }),
    h(ToastView, { toast, onClose: clearToast }),
  )
}

// ---- projects tab ----------------------------------------------------------

function ProjectsTab(props: { projects: Project[]; refresh: () => void; creating: boolean; setCreating: (b: boolean) => void; showToast: (t: string, k?: 'err' | 'ok') => void }): ReactNode {
  const { projects, refresh, creating, setCreating, showToast } = props
  const [newName, setNewName] = useState('')
  const [newDomain, setNewDomain] = useState('')
  // Optional import of an already-built wiki dir at creation time
  // (user-requested 2026-10-11: skip re-building existing knowledge bases).
  const [importDir, setImportDir] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const create = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const r = await apiPostJson<{ ok: boolean; error?: string; importedPages?: number }>('/project', {
        name: newName.trim(),
        domain: newDomain.trim(),
        ...(importDir.trim() ? { importDir: importDir.trim() } : {}),
      })
      if (!r.ok) throw new Error(r.error || '创建失败')
      if (r.importedPages !== undefined) showToast(`已导入「${newName.trim()}」（${r.importedPages} 页）——跳过构建`, 'ok')
      setNewName('')
      setNewDomain('')
      setImportDir('')
      await refresh()
    } catch (e) {
      showToast(String((e as Error)?.message || e), 'err')
    } finally {
      setCreating(false)
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsw-card' },
      h('div', { className: 'dsw-muted' }, '新建知识库'),
      h('div', { className: 'dsw-row' },
        h('input', { className: 'dsw-input', placeholder: '知识库名称', value: newName, onChange: (e: any) => setNewName(e.target.value), style: { maxWidth: 220 } }),
        h('input', { className: 'dsw-input', placeholder: '领域说明（可选）', value: newDomain, onChange: (e: any) => setNewDomain(e.target.value), style: { maxWidth: 260 } }),
        h('button', { className: 'dsw-btn', disabled: creating, onClick: create }, '创建'),
      ),
      h('div', { className: 'dsw-row', style: { marginTop: 6 } },
        h('input', { className: 'dsw-input', placeholder: '已有 wiki 目录绝对路径（可选，填了即导入该已构建知识库，免重复构建）', value: importDir, onChange: (e: any) => setImportDir(e.target.value), style: { flex: 1 } }),
        h('button', { className: 'dsw-btn dsw-ghost', onClick: () => setPickerOpen(true), title: '弹窗浏览选择已构建的知识库目录' }, '📁 选择文件夹'),
      ),
      importDir.trim()
        ? h('div', { className: 'dsw-muted', style: { marginTop: 4 } }, '⚠ 导入要求目录是标准 wiki 结构（含 index.md/SCHEMA.md 或 entities/concepts 等子目录）；结构不符会在创建时报错并自动回退。')
        : null,
      pickerOpen
        ? h(DirPickerModal, {
            initialPath: importDir.trim() || undefined,
            onPick: (p2: string) => { setImportDir(p2); setPickerOpen(false) },
            onClose: () => setPickerOpen(false),
          })
        : null,
    ),
    projects.length === 0
      ? h('div', { className: 'dsw-muted' }, '还没有知识库，先创建一个再上传文档。')
      : h('div', { className: 'dsw-list' }, projects.map((p) => h(ProjectCard, { key: p.id, project: p, refresh, showToast }))),
  )
}

function ProjectCard(props: { project: Project; refresh: () => void; showToast: (t: string, k?: 'err' | 'ok') => void }): ReactNode {
  const { project: p, refresh, showToast } = props
  const [drag, setDrag] = useState(false)
  const [localErr, setLocalErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Transient project errors (user-requested 2026-10-11): action failures and
  // build errors pop as a floating toast that fades after TOAST_MS instead of
  // a permanent inline row. The v0.2.1 dismissedErr mechanism is retired —
  // toasts auto-vanish, so no dismissed-state tracking is needed. Persisted
  // p.error still marks the badge/project status; it just no longer renders
  // as an always-visible banner.
  useEffect(() => {
    if (p.error) showToast('错误：' + p.error, 'err')
  }, [p.error, showToast])
  const [schemaDraft, setSchemaDraft] = useState('')
  const [uploads, setUploads] = useState<UploadInfo[]>([])
  const [pages, setPages] = useState<PageInfo[]>([])
  const [expanded, setExpanded] = useState(true)
  const [openPage, setOpenPage] = useState<{ path: string; md: string } | null>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [sourceGroups, setSourceGroups] = useState<SourceGroup[]>([])
  const [groupOpen, setGroupOpen] = useState<SourceGroup | null>(null)

  const loadDetail = useCallback(async () => {
    try {
      const data = await apiGet<{ project: Project; schema: string | null; schemaConfirmed: boolean; uploads?: UploadInfo[]; pages?: PageInfo[]; sourceGroups?: SourceGroup[] }>(`/project/${p.id}`)
      setSchemaDraft(data.schema ?? '')
      setUploads(data.uploads ?? [])
      setPages(data.pages ?? [])
      setSourceGroups(data.sourceGroups ?? [])
    } catch {
      /* ignore */
    }
  }, [p.id])

  // Fetch detail whenever the project is in flight, awaiting confirmation, or
  // already built (ready/failed) — the built-page list must be persistently
  // visible for ready projects, not only while a build is running.
  useEffect(() => {
    if (p.status !== 'empty' && p.status !== 'uploaded') void loadDetail()
  }, [p.status, p.pageCount, p.updatedAt, loadDetail])

  const onFiles = async (files: FileList | File[]) => {
    setLocalErr('')
    setBusy(true)
    try {
      await apiUpload(p.id, Array.from(files))
      await refresh()
      await loadDetail()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  const design = async () => {
    setBusy(true); setLocalErr('')
    try {
      await apiPostJson(`/design/${p.id}`, {})
      await refresh()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  const confirmSchema = async () => {
    setBusy(true); setLocalErr('')
    try {
      await apiPostJson(`/schema/${p.id}`, { schema: schemaDraft })
      await refresh()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  const ingest = async () => {
    setBusy(true); setLocalErr('')
    try {
      await apiPostJson(`/ingest/${p.id}`, {})
      await refresh()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!confirm('删除该知识库？此操作不可恢复。')) return
    setBusy(true)
    try {
      await fetch(API + `/project/${p.id}`, { method: 'DELETE' })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const canDesign = (p.status === 'empty' || p.status === 'uploaded') && p.schemaConfirmed === false
  const canConfirm = p.status === 'awaiting-schema-confirm'
  const canIngest = p.schemaConfirmed && p.status !== 'ingesting' && p.status !== 'designing' && p.status !== 'harvesting'
  // Single-session build (requirement ②): available whenever the project has
  // files and nothing is in flight; it skips the SCHEMA confirm gate entirely.
  const canBuild = uploads.length > 0 && p.status !== 'ingesting' && p.status !== 'designing' && p.status !== 'harvesting'

  const buildAll = async () => {
    setBusy(true); setLocalErr('')
    try {
      await apiPostJson(`/build/${p.id}`, {})
      await refresh()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  // Lint-fix (2026-10-10): one session repairs all current lint issues.
  const lintBad = !!p.lint && (p.lint.errorCount > 0 || p.lint.warnCount > 0)
  const canLintFix = lintBad && p.status !== 'ingesting' && p.status !== 'designing' && p.status !== 'harvesting'
  const fixLint = async () => {
    setBusy(true); setLocalErr('')
    try {
      await apiPostJson(`/lintfix/${p.id}`, {})
      await refresh()
    } catch (e) {
      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
    } finally {
      setBusy(false)
    }
  }

  return h(
    'li',
    null,
    h('div', { className: 'dsw-row' },
      h('strong', null, p.name),
      h('span', { className: statusBadgeClass(p.status) }, p.status),
      p.pageCount ? h('span', { className: 'dsw-muted' }, `${p.pageCount} 页`) : null,
      p.lint && (p.lint.errorCount || p.lint.warnCount)
        ? h('span', { className: 'dsw-badge ' + (p.lint.errorCount ? 'dsw-err' : 'dsw-warn') }, `lint ${p.lint.errorCount}错/${p.lint.warnCount}警`)
        : null,
      h('button', { className: 'dsw-btn dsw-ghost', style: { marginLeft: 'auto' }, disabled: busy, onClick: del }, '删除'),
    ),
    p.domain ? h('div', { className: 'dsw-muted' }, p.domain) : null,

    // Upload zone
    h(
      'div',
      {
        className: 'dsw-drop' + (drag ? ' dsw-over' : ''),
        style: { marginTop: 8 },
        onClick: () => {
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.onchange = () => input.files && onFiles(input.files)
          input.click()
        },
        onDragOver: (e: any) => { e.preventDefault(); setDrag(true) },
        onDragLeave: () => setDrag(false),
        onDrop: (e: any) => { e.preventDefault(); setDrag(false); e.dataTransfer?.files && onFiles(e.dataTransfer.files) },
      },
      busy ? '处理中…' : '点击或拖拽上传文档（支持多文件）',
    ),

    h(
      'div',
      { className: 'dsw-row', style: { marginTop: 8 } },
      h('button', { className: 'dsw-btn', disabled: busy || !canBuild, onClick: buildAll, title: '一个会话内完成：SCHEMA 设计 → 构建 → 回收入库（无需人工确认 SCHEMA）' }, '⚡ 一键构建'),
      h('button', { className: 'dsw-btn dsw-ghost', disabled: busy || !canDesign, onClick: design, title: '只生成 SCHEMA 草稿，构建前人工确认' }, '① 生成 SCHEMA 草稿'),
      h('button', { className: 'dsw-btn dsw-ghost', disabled: busy || !canConfirm, onClick: confirmSchema }, '② 确认 SCHEMA'),
      h('button', { className: 'dsw-btn dsw-ghost', disabled: busy || !canIngest, onClick: ingest }, '③ 按确认的 SCHEMA 构建'),
      lintBad ? h('button', { className: 'dsw-btn dsw-ghost', disabled: busy || !canLintFix, onClick: fixLint, title: `发起一个修复会话，按 lint 报告自动修复全部 ${p.lint!.errorCount} 错 / ${p.lint!.warnCount} 警` }, `🩹 lint 修复（${p.lint!.errorCount}错/${p.lint!.warnCount}警）`) : null,
    ),

    canConfirm && schemaDraft
      ? h(
          'div',
          { className: 'dsw-card', style: { marginTop: 8 } },
          h('div', { className: 'dsw-muted' }, 'SCHEMA 草稿（可编辑后确认；确认后 llm-wiki 会话将按此构建）'),
          h('textarea', { className: 'dsw-textarea', value: schemaDraft, onChange: (e: any) => setSchemaDraft(e.target.value) }),
        )
      : null,

    // Built pages — one button on the card; the list opens in a modal.
    pages.length
      ? h('button', {
          className: 'dsw-btn dsw-ghost',
          disabled: busy,
          onClick: () => setPagesOpen(true),
        }, `📄 已构建页面（${pages.length}）`)
      : null,

    // Source docs — collapsible.
    uploads.length
      ? h(
          'div',
          { className: 'dsw-card', style: { marginTop: 8 } },
          h('div',
            { className: 'dsw-row', style: { cursor: 'pointer', userSelect: 'none' }, onClick: () => setExpanded(!expanded) },
            h('strong', null, '已上传文件'),
            h('span', { className: 'dsw-muted' }, ` ${uploads.length} 个`),
            h('span', { className: 'dsw-muted', style: { marginLeft: 'auto' } }, expanded ? '收起 ▲' : '展开 ▼'),
          ),
          expanded ? h('div', { className: 'dsw-scroll', style: { marginTop: 4 } },
            uploads.map((u) => {
              const ext = (u.name.match(/\.([^.]+)$/) || [])[1]?.toUpperCase() || '—'
              const when = u.mtime ? new Date(u.mtime).toLocaleString('zh-CN', { hour12: false }) : ''
              const grp = sourceGroups.find((g) => g.sha256 === u.sha256)
              return h('div', {
                key: u.sha256,
                className: 'dsw-file',
                title: `SHA256: ${u.sha256}`,
              },
                h('span', { style: { fontWeight: 500, color: 'var(--dsw-text-color, inherit)' } }, u.name),
                h('span', { className: 'dsw-muted' }, ext),
                h('span', { className: 'dsw-muted' }, `${(u.size / 1024).toFixed(1)} KB`),
                when ? h('span', { className: 'dsw-muted' }, when) : null,
                h('span', { className: 'dsw-muted', style: { fontFamily: 'monospace', fontSize: 11 } }, u.sha256.slice(0, 8)),
                grp && grp.pages.length
                  ? h('button', { className: 'dsw-btn dsw-ghost', style: { padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }, onClick: () => setGroupOpen(grp) },
                      `查看构建页面（${grp.pages.length}）`)
                  : h('span', { className: 'dsw-muted', style: { marginLeft: 'auto', fontSize: 11 } }, '暂无关联页面'),
                h('button', {
                  className: 'dsw-btn dsw-ghost',
                  style: { padding: '2px 8px', fontSize: 11, color: '#d03050' },
                  disabled: busy,
                  title: '删除该文件及其关联的构建页面',
                  onClick: async () => {
                    const n = grp?.pages.length ?? 0
                    if (!confirm(`删除「${u.name}」及其关联的 ${n} 个构建页面？此操作不可撤销。`)) return
                    setBusy(true)
                    setLocalErr('')
                    try {
                      const r = await apiPostJson<{ ok: boolean; removedPages?: number; error?: string }>('/delete-upload', { projectId: p.id, sha256: u.sha256 })
                      if (!r.ok) throw new Error(r.error || '删除失败')
                      await loadDetail()
                    } catch (e) {
                      setLocalErr(String((e as Error)?.message || e)); showToast(String((e as Error)?.message || e), "err")
                    } finally {
                      setBusy(false)
                    }
                  },
                }, '删除'),
              )
            }),
          ) : null,
        )
      : null,

    openPage ? h(PageModal, { open: { path: openPage.path, projectId: p.id, md: openPage.md }, onClose: () => setOpenPage(null) }) : null,

    pagesOpen
      ? createPortal(
          h(
            'div',
            { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: () => setPagesOpen(false) },
            h(
              'div',
              { onClick: (e: any) => e.stopPropagation(), style: { width: 'min(640px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dsw-bg-color,#fff)', borderRadius: 10, padding: 18 } },
              h('div', { className: 'dsw-row', style: { marginBottom: 8 } },
                h('strong', null, `已构建页面 · ${p.name}（${pages.length}）`),
                h('button', { className: 'dsw-btn dsw-ghost', style: { marginLeft: 'auto' }, onClick: () => setPagesOpen(false) }, '关闭'),
              ),
              pages.map((pg) =>
                h('button', {
                  key: pg.path,
                  className: 'dsw-chip',
                  title: pg.path,
                  onClick: async () => {
                    try {
                      const md = await apiText(`/page/${p.id}?path=${encodeURIComponent(pg.path)}`)
                      setOpenPage({ path: pg.path, md })
                    } catch { /* ignore */ }
                  },
                },
                  `${pg.title || pg.path} · ${pg.kind}`,
                ),
              ),
            ),
          ),
          document.body,
        )
      : null,

    groupOpen
      ? createPortal(
          h(
            'div',
            { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: () => setGroupOpen(null) },
            h(
              'div',
              { onClick: (e: any) => e.stopPropagation(), style: { width: 'min(640px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dsw-bg-color,#fff)', borderRadius: 10, padding: 18 } },
              h('div', { className: 'dsw-row', style: { marginBottom: 8 } },
                h('strong', null, `${groupOpen.name} 的构建页面（${groupOpen.pages.length}）`),
                h('button', { className: 'dsw-btn dsw-ghost', style: { marginLeft: 'auto' }, onClick: () => setGroupOpen(null) }, '关闭'),
              ),
              groupOpen.pages.length
                ? groupOpen.pages.map((pg) =>
                    h('button', {
                      key: pg.path,
                      className: 'dsw-chip',
                      title: pg.path,
                      onClick: async () => {
                        try {
                          const md = await apiText(`/page/${p.id}?path=${encodeURIComponent(pg.path)}`)
                          setOpenPage({ path: pg.path, md })
                        } catch { /* ignore */ }
                      },
                    },
                      `${pg.title || pg.path} · ${pg.kind}`,
                    ),
                  )
                : h('div', { className: 'dsw-muted' }, '该文件没有关联到任何构建页面（页面 frontmatter 的 sources 未引用它）'),
            ),
          ),
          document.body,
        )
      : null,

    localErr ? h('div', { className: 'dsw-err' }, localErr) : null,
  )
}

// ---- search tab ------------------------------------------------------------

function SearchTab(_props: {}): ReactNode {
  const [q, setQ] = useState('')
  const [projectId, setProjectId] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<{ path: string; projectId: string; md: string } | null>(null)
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    apiGet<{ projects: Project[] }>('/projects').then((d) => setProjects(d.projects)).catch(() => {})
  }, [])

  const doSearch = async () => {
    if (!q.trim()) return
    setErr('')
    try {
      const params = new URLSearchParams({ q })
      if (projectId) params.set('projectId', projectId)
      const data = await apiGet<{ hits: Hit[] }>(`/search?${params.toString()}`)
      setHits(data.hits)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const openPage = async (h: Hit) => {
    try {
      const md = await apiText(`/page/${h.projectId}?path=${encodeURIComponent(h.path)}`)
      setOpen({ path: h.path, projectId: h.projectId, md })
    } catch {
      setErr('读取页面失败')
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsw-row' },
      h('input', { className: 'dsw-input', placeholder: '检索知识库…', value: q, onChange: (e: any) => setQ(e.target.value), style: { flex: 1 } }),
      h(
        'select',
        { className: 'dsw-input', style: { maxWidth: 180 }, value: projectId, onChange: (e: any) => setProjectId(e.target.value) },
        h('option', { value: '' }, '全部项目'),
        ...projects.map((p) => h('option', { key: p.id, value: p.id }, p.name)),
      ),
      h('button', { className: 'dsw-btn', onClick: doSearch }, '检索'),
    ),
    err ? h('div', { className: 'dsw-err' }, err) : null,
    hits.length === 0 ? null : h('div', { style: { marginTop: 10 } },
      hits.map((h0) => h('div', { key: h0.projectId + h0.path, className: 'dsw-hit', onClick: () => openPage(h0), style: { cursor: 'pointer' } },
        h('div', null, h('strong', null, h0.title), ' ', h('span', { className: 'dsw-muted' }, `（${h0.projectName} · ${h0.kind}）`)),
        h('div', { className: 'dsw-muted' }, h0.snippet.slice(0, 200)),
      )),
    ),
    open ? h(PageModal, { open, onClose: () => setOpen(null) }) : null,
  )
}

function PageModal(props: { open: { path: string; projectId: string; md: string }; onClose: () => void }): ReactNode {
  return createPortal(
    h(
      'div',
      { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: props.onClose },
      h(
        'div',
        { onClick: (e: any) => e.stopPropagation(), style: { width: 'min(760px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dsw-bg-color,#fff)', borderRadius: 10, padding: 18 } },
        h('div', { className: 'dsw-row' }, h('strong', null, props.open.path), h('button', { className: 'dsw-btn dsw-ghost', style: { marginLeft: 'auto' }, onClick: props.onClose }, '关闭')),
        h('pre', { className: 'dsw-page' }, props.open.md),
      ),
    ),
    document.body,
  )
}

// ---- directory picker modal (wiki import, user-requested 2026-10-11) -------

interface BrowseResult {
  path: string
  parent: string | null
  isWikiRoot: boolean
  dirs: { name: string; path: string }[]
  roots: { name: string; path: string }[]
}

function DirPickerModal(props: { initialPath?: string; onPick: (p: string) => void; onClose: () => void }): ReactNode {
  const { onPick, onClose } = props
  const [cur, setCur] = useState(props.initialPath || '')
  const [data, setData] = useState<BrowseResult | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (p: string) => {
    setBusy(true); setErr('')
    try {
      const r = await apiGet<BrowseResult>(`/browse?path=${encodeURIComponent(p)}`)
      setData(r)
      setCur(r.path)
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load(props.initialPath || '') }, [load, props.initialPath])

  return createPortal(
    h(
      'div',
      { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: onClose },
      h(
        'div',
        { onClick: (e: any) => e.stopPropagation(), style: { width: 'min(680px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dsw-bg-color,#fff)', borderRadius: 10, padding: 18 } },
        h('div', { className: 'dsw-row' },
          h('strong', null, '选择已构建的知识库目录'),
          h('button', { className: 'dsw-btn dsw-ghost', style: { marginLeft: 'auto' }, onClick: onClose }, '✕'),
        ),
        h('div', { className: 'dsw-muted', style: { marginTop: 4 } }, '导航到含 index.md / SCHEMA.md 或 entities / concepts 子目录的 wiki 根目录后点「选择此目录」。'),
        h('div', { className: 'dsw-row', style: { marginTop: 8 } },
          data?.parent ? h('button', { className: 'dsw-btn dsw-ghost', disabled: busy, onClick: () => void load(data.parent!) }, '⬅ 上级') : null,
          h('code', { style: { flex: 1, fontSize: 12, wordBreak: 'break-all' } }, cur || '（加载中…）'),
          data?.isWikiRoot ? h('span', { className: 'dsw-badge' }, '✓ wiki 根目录') : null,
        ),
        err ? h('div', { className: 'dsw-err', style: { marginTop: 8 } }, err) : null,
        h(
          'div',
          { className: 'dsw-scroll', style: { marginTop: 8 } },
          data?.roots.length
            ? h('div', { className: 'dsw-muted', style: { margin: '6px 0' } }, '★ 检测到疑似 wiki 根目录：')
            : null,
          ...(data?.roots || []).map((r) =>
            h('div', { key: 'r:' + r.path, className: 'dsw-row', style: { padding: '4px 0' } },
              h('button', { className: 'dsw-btn dsw-ghost', onClick: () => onPick(r.path) }, `★ ${r.name}`),
              h('button', { className: 'dsw-btn dsw-ghost', onClick: () => void load(r.path) }, '进入'),
            ),
          ),
          data?.roots.length ? h('div', { className: 'dsw-muted', style: { margin: '6px 0' } }, '子目录：') : null,
          ...(data?.dirs || []).map((d) =>
            h('div', { key: d.path, className: 'dsw-row', style: { padding: '4px 0' } },
              h('button', { className: 'dsw-btn dsw-ghost', disabled: busy, onClick: () => void load(d.path) }, '📂 ' + d.name),
            ),
          ),
          data && !data.dirs.length ? h('div', { className: 'dsw-muted' }, '（无子目录）') : null,
        ),
        h('div', { className: 'dsw-row', style: { marginTop: 10, justifyContent: 'flex-end' } },
          h('button', { className: 'dsw-btn', disabled: !data || !data.isWikiRoot, title: data?.isWikiRoot ? '' : '当前目录不是标准 wiki 结构', onClick: () => data && onPick(data.path) }, '选择此目录'),
        ),
      ),
    ),
    document.body,
  )
}

// ---- status tab ------------------------------------------------------------

function StatusTab(props: { projects: Project[] }): ReactNode {
  const [global, setGlobal] = useState<any>(null)
  useEffect(() => {
    apiGet('/status').then(setGlobal).catch(() => setGlobal(null))
  }, [])
  return h(
    'div',
    null,
    global ? h('div', { className: 'dsw-card' },
      h('div', { className: 'dsw-muted' }, `API 端口 ${global.apiPort} · 数据目录 ${global.dataDir}`),
      h('div', { className: 'dsw-muted' }, `项目 ${global.projects} · 索引页面 ${global.pages} · 会话驱动 ${global.hasSession ? '可用' : '不可用'}`),
    ) : null,
    h('div', { className: 'dsw-muted', style: { marginTop: 8 } }, '项目状态：'),
    props.projects.length === 0
      ? h('div', { className: 'dsw-muted' }, '无')
      : h('div', { className: 'dsw-list' }, props.projects.map((p) =>
          h('li', { key: p.id, className: 'dsw-row' },
            h('span', null, p.name),
            h('span', { className: statusBadgeClass(p.status) }, p.status),
            h('span', { className: 'dsw-muted' }, `${p.pageCount} 页`),
            p.lint && (p.lint.errorCount || p.lint.warnCount) ? h('span', { className: 'dsw-badge ' + (p.lint.errorCount ? 'dsw-err' : 'dsw-warn') }, `${p.lint.errorCount}/${p.lint.warnCount}`) : null,
          ),
        )),
  )
}

// ---- settings tab (requirement ①) ------------------------------------------

interface CatalogGroup { id: string; name: string; models: { id: string; name: string }[] }
interface WorkspaceItem { id: string; path: string; sessions: number }

function SettingsTab(props: { showToast: (t: string, k?: 'err' | 'ok') => void }): ReactNode {
  const { showToast } = props
  const [groups, setGroups] = useState<CatalogGroup[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [model, setModel] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [agentPreset, setAgentPreset] = useState('')
  const [permPreset, setPermPreset] = useState('')
  const [skillInjection, setSkillInjection] = useState<'inline' | 'tool' | 'auto'>('tool')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<{ groups: CatalogGroup[] }>('/catalog').then((d) => setGroups(d.groups ?? [])).catch((e) => setErr(String(e)))
    apiGet<{ workspaces: WorkspaceItem[] }>('/workspaces').then((d) => setWorkspaces(d.workspaces ?? [])).catch(() => {})
    apiGet<{ settings: { ingestWorkspaceId: string; ingestModel: string; ingestAgentPreset: string; ingestPermissionPreset: string; skillInjection: 'inline' | 'tool' | 'auto' } }>('/settings')
      .then((d) => {
        setModel(d.settings.ingestModel || '')
        setWorkspaceId(d.settings.ingestWorkspaceId || '')
        setAgentPreset(d.settings.ingestAgentPreset || '')
        setPermPreset(d.settings.ingestPermissionPreset || '')
        if (d.settings.skillInjection) setSkillInjection(d.settings.skillInjection)
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(API + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestModel: model, ingestWorkspaceId: workspaceId, skillInjection }),
      })
      const j = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }))
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setSaved(true)
      showToast('设置已保存（持久化，重启后仍生效）', 'ok')
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
      showToast('保存设置失败：' + msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  const totalModels = groups.reduce((n, g) => n + g.models.length, 0)
  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsw-card' },
      h('div', { className: 'dsw-muted' }, '构建会话设置（新会话的工作区与使用的模型，从模型池选择）'),
      h('div', { className: 'dsw-row', style: { marginTop: 8 } },
        h('span', { className: 'dsw-muted' }, '工作区：'),
        h(
          'select',
          { className: 'dsw-input', style: { maxWidth: 300 }, value: workspaceId, onChange: (e: any) => setWorkspaceId(e.target.value) },
          h('option', { value: '' }, '宿主默认工作区'),
          ...workspaces.map((w) => h('option', { key: w.id, value: w.id }, `${w.path}（${w.sessions} 会话）`)),
        ),
      ),
      h('div', { className: 'dsw-row', style: { marginTop: 8 } },
        h('span', { className: 'dsw-muted' }, '模型：'),
        h(
          'select',
          { className: 'dsw-input', style: { maxWidth: 340 }, value: model, onChange: (e: any) => setModel(e.target.value) },
          h('option', { value: '' }, '宿主默认模型'),
          ...groups.map((g) =>
            g.models.map((m) => h('option', { key: `${g.id}/${m.id}`, value: `${g.id}/${m.id}` }, `${g.name} · ${m.name}`)),
          ).flat(),
        ),
      ),
      h('div', { className: 'dsw-row', style: { marginTop: 8 } },
        h('span', { className: 'dsw-muted' }, '技能注入方式：'),
        h(
          'select',
          { className: 'dsw-input', style: { maxWidth: 340 }, value: skillInjection, onChange: (e: any) => setSkillInjection(e.target.value) },
          h('option', { value: 'inline' }, 'inline（完整内联 75KB 技能全文）'),
          h('option', { value: 'tool' }, 'tool（直接调用 skill 工具，提示词无技能原文，默认）'),
          h('option', { value: 'auto' }, 'auto（调用 skill 工具 + 核心要点兜底）'),
        ),
      ),
      h('div', { className: 'dsw-muted', style: { marginTop: 4 } },
        skillInjection === 'inline'
          ? '每次构建会话都把 75KB 技能全文注入提示词，最稳健但体积大。'
          : skillInjection === 'tool'
            ? '提示词不含技能原文，仅要求会话第一步调用 skill("llm-wiki") 加载插件激活时已注册的 llm-wiki 技能，最精简。'
            : '提示词要求调用 skill 工具，同时内联约 1.5KB 核心协议要点；模型不调用也有底线。',
      ),
      h('div', { className: 'dsw-row', style: { marginTop: 10 } },
        h('button', { className: 'dsw-btn', disabled: busy, onClick: save }, '保存设置'),
        saved ? h('span', { className: 'dsw-muted' }, '✓ 已保存（对本进程内的新构建会话即时生效）') : null,
        err ? h('span', { className: 'dsw-err' }, err) : null,
      ),
      h('div', { className: 'dsw-muted', style: { marginTop: 8 } },
        totalModels === 0
          ? '未接收到模型池（需宿主 llm 服务）。'
          : `模型池：${groups.length} 个供应商 / ${totalModels} 个模型。`,
        workspaces.length === 0 ? ' 未接收到工作区列表（使用宿主默认）。' : '',
      ),
      agentPreset || permPreset
        ? h('div', { className: 'dsw-muted', style: { marginTop: 4 } },
            `会话预设：agentPreset=${agentPreset || '（默认）'} · 权限预设=${permPreset || '（默认）'}（在插件配置中设置，此处只读）`)
        : null,
    ),
  )
}

// ---- plugin entry ----------------------------------------------------------

export const name = 'dsh-local-llm-wiki-client'
export const inject = ['slots'] as const

export function apply(ctx: any): void {
  injectStyles()
  const slots = ctx.slots
  if (!slots?.inject) return
  // register into the main panel area + sidebar list
  const PanelEntry = () => h(PageErrorBoundary, null, h(Panel))
  slots.inject('main', () => {
    slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ onBack: () => ctx.get?.('layout')?.selectPanel(null) }),
      },
      PanelEntry,
    )
  })
  slots.inject('sidebar.panellist', () => {
    // label 由宿主的行按钮渲染；组件只给图标，避免同一行出现两份名称
    slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 21, label: 'Wiki 知识库' }, () =>
      h('span', { style: { fontSize: 17, lineHeight: 1, display: 'inline-flex' } }, '📚'),
    )
  })
}

export default { name, inject, apply }

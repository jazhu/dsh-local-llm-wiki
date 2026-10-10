window.__ModuleLoader__.load({ id: 'dsh-local-llm-wiki', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  default: () => client_default,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_react_dom = require("react-dom");
var PANEL_ID = "dsh-local-llm-wiki";
var API_BASE = "http://127.0.0.1:18781";
var API = `${API_BASE}/wiki-api`;
async function apiGet(path) {
  const r = await fetch(API + path, { headers: { "Content-Type": "application/json" } });
  const data = await r.json().catch(() => ({ ok: false, error: "bad json" }));
  if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
async function apiPostJson(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({ ok: false, error: "bad json" }));
  if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
async function apiText(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
async function apiUpload(projectId, files) {
  const form = new FormData();
  form.append("projectId", projectId);
  for (const f of files) form.append("file", f, f.name);
  const r = await fetch(API + "/upload", { method: "POST", body: form });
  const data = await r.json().catch(() => ({ ok: false }));
  if (!data.ok) throw new Error(data.error || "upload \u5931\u8D25");
}
function injectStyles() {
  if (document.getElementById("dsh-local-llm-wiki-style")) return;
  const style = document.createElement("style");
  style.id = "dsh-local-llm-wiki-style";
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
`;
  document.head.appendChild(style);
}
var PageErrorBoundary = class extends import_react.Component {
  state = { hasError: false, msg: "" };
  static getDerivedStateFromError(err) {
    return { hasError: true, msg: err?.message || String(err) };
  }
  render() {
    if (this.state.hasError) {
      return (0, import_react.createElement)("div", { className: "dsw-root" }, (0, import_react.createElement)("div", { className: "dsw-err" }, "\u77E5\u8BC6\u5E93\u9762\u677F\u51FA\u9519\uFF1A", this.state.msg));
    }
    return this.props.children;
  }
};
function statusBadgeClass(s) {
  if (s === "ready") return "dsw-badge dsw-ok";
  if (s === "failed") return "dsw-badge dsw-err";
  if (s === "designing" || s === "ingesting" || s === "harvesting") return "dsw-badge dsw-warn";
  return "dsw-badge";
}
var POLL_MS = 2e3;
function Panel() {
  const [tab, setTab] = (0, import_react.useState)("projects");
  const [projects, setProjects] = (0, import_react.useState)([]);
  const [err, setErr] = (0, import_react.useState)("");
  const [creating, setCreating] = (0, import_react.useState)(false);
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const data = await apiGet("/projects");
      setProjects(data.projects);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  (0, import_react.useEffect)(() => {
    refresh();
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    const midflight = projects.some((p) => ["designing", "ingesting", "harvesting"].includes(p.status));
    if (!midflight) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [projects, refresh]);
  return (0, import_react.createElement)(
    "div",
    { className: "dsw-root" },
    (0, import_react.createElement)("h3", null, "\u77E5\u8BC6\u5E93 (dsh-local-llm-wiki)"),
    (0, import_react.createElement)(
      "div",
      { className: "dsw-tabs" },
      (0, import_react.createElement)("div", { className: "dsw-tab" + (tab === "projects" ? " dsw-active" : ""), onClick: () => setTab("projects") }, "\u9879\u76EE"),
      (0, import_react.createElement)("div", { className: "dsw-tab" + (tab === "search" ? " dsw-active" : ""), onClick: () => setTab("search") }, "\u68C0\u7D22"),
      (0, import_react.createElement)("div", { className: "dsw-tab" + (tab === "status" ? " dsw-active" : ""), onClick: () => setTab("status") }, "\u72B6\u6001"),
      (0, import_react.createElement)("div", { className: "dsw-tab" + (tab === "settings" ? " dsw-active" : ""), onClick: () => setTab("settings") }, "\u8BBE\u7F6E")
    ),
    err ? (0, import_react.createElement)("div", { className: "dsw-err" }, "API \u9519\u8BEF\uFF1A", err) : null,
    tab === "projects" && (0, import_react.createElement)(ProjectsTab, { projects, refresh, creating, setCreating }),
    tab === "search" && (0, import_react.createElement)(SearchTab, {}),
    tab === "status" && (0, import_react.createElement)(StatusTab, { projects }),
    tab === "settings" && (0, import_react.createElement)(SettingsTab, {})
  );
}
function ProjectsTab(props) {
  const { projects, refresh, creating, setCreating } = props;
  const [newName, setNewName] = (0, import_react.useState)("");
  const [newDomain, setNewDomain] = (0, import_react.useState)("");
  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiPostJson("/project", { name: newName.trim(), domain: newDomain.trim() });
      setNewName("");
      setNewDomain("");
      await refresh();
    } finally {
      setCreating(false);
    }
  };
  return (0, import_react.createElement)(
    "div",
    null,
    (0, import_react.createElement)(
      "div",
      { className: "dsw-card" },
      (0, import_react.createElement)("div", { className: "dsw-muted" }, "\u65B0\u5EFA\u77E5\u8BC6\u5E93"),
      (0, import_react.createElement)(
        "div",
        { className: "dsw-row" },
        (0, import_react.createElement)("input", { className: "dsw-input", placeholder: "\u77E5\u8BC6\u5E93\u540D\u79F0", value: newName, onChange: (e) => setNewName(e.target.value), style: { maxWidth: 220 } }),
        (0, import_react.createElement)("input", { className: "dsw-input", placeholder: "\u9886\u57DF\u8BF4\u660E\uFF08\u53EF\u9009\uFF09", value: newDomain, onChange: (e) => setNewDomain(e.target.value), style: { maxWidth: 260 } }),
        (0, import_react.createElement)("button", { className: "dsw-btn", disabled: creating, onClick: create }, "\u521B\u5EFA")
      )
    ),
    projects.length === 0 ? (0, import_react.createElement)("div", { className: "dsw-muted" }, "\u8FD8\u6CA1\u6709\u77E5\u8BC6\u5E93\uFF0C\u5148\u521B\u5EFA\u4E00\u4E2A\u518D\u4E0A\u4F20\u6587\u6863\u3002") : (0, import_react.createElement)("div", { className: "dsw-list" }, projects.map((p) => (0, import_react.createElement)(ProjectCard, { key: p.id, project: p, refresh })))
  );
}
function ProjectCard(props) {
  const { project: p, refresh } = props;
  const [drag, setDrag] = (0, import_react.useState)(false);
  const [localErr, setLocalErr] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [schemaDraft, setSchemaDraft] = (0, import_react.useState)("");
  const [uploads, setUploads] = (0, import_react.useState)([]);
  const [pages, setPages] = (0, import_react.useState)([]);
  const [expanded, setExpanded] = (0, import_react.useState)(true);
  const [openPage, setOpenPage] = (0, import_react.useState)(null);
  const [pagesOpen, setPagesOpen] = (0, import_react.useState)(false);
  const [sourceGroups, setSourceGroups] = (0, import_react.useState)([]);
  const [groupOpen, setGroupOpen] = (0, import_react.useState)(null);
  const loadDetail = (0, import_react.useCallback)(async () => {
    try {
      const data = await apiGet(`/project/${p.id}`);
      setSchemaDraft(data.schema ?? "");
      setUploads(data.uploads ?? []);
      setPages(data.pages ?? []);
      setSourceGroups(data.sourceGroups ?? []);
    } catch {
    }
  }, [p.id]);
  (0, import_react.useEffect)(() => {
    if (p.status !== "empty" && p.status !== "uploaded") void loadDetail();
  }, [p.status, p.pageCount, p.updatedAt, loadDetail]);
  const onFiles = async (files) => {
    setLocalErr("");
    setBusy(true);
    try {
      await apiUpload(p.id, Array.from(files));
      await refresh();
      await loadDetail();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const design = async () => {
    setBusy(true);
    setLocalErr("");
    try {
      await apiPostJson(`/design/${p.id}`, {});
      await refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmSchema = async () => {
    setBusy(true);
    setLocalErr("");
    try {
      await apiPostJson(`/schema/${p.id}`, { schema: schemaDraft });
      await refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const ingest = async () => {
    setBusy(true);
    setLocalErr("");
    try {
      await apiPostJson(`/ingest/${p.id}`, {});
      await refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!confirm("\u5220\u9664\u8BE5\u77E5\u8BC6\u5E93\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002")) return;
    setBusy(true);
    try {
      await fetch(API + `/project/${p.id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const canDesign = (p.status === "empty" || p.status === "uploaded") && p.schemaConfirmed === false;
  const canConfirm = p.status === "awaiting-schema-confirm";
  const canIngest = p.schemaConfirmed && p.status !== "ingesting" && p.status !== "designing" && p.status !== "harvesting";
  const canBuild = uploads.length > 0 && p.status !== "ingesting" && p.status !== "designing" && p.status !== "harvesting";
  const buildAll = async () => {
    setBusy(true);
    setLocalErr("");
    try {
      await apiPostJson(`/build/${p.id}`, {});
      await refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const lintBad = !!p.lint && (p.lint.errorCount > 0 || p.lint.warnCount > 0);
  const canLintFix = lintBad && p.status !== "ingesting" && p.status !== "designing" && p.status !== "harvesting";
  const fixLint = async () => {
    setBusy(true);
    setLocalErr("");
    try {
      await apiPostJson(`/lintfix/${p.id}`, {});
      await refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (0, import_react.createElement)(
    "li",
    null,
    (0, import_react.createElement)(
      "div",
      { className: "dsw-row" },
      (0, import_react.createElement)("strong", null, p.name),
      (0, import_react.createElement)("span", { className: statusBadgeClass(p.status) }, p.status),
      p.pageCount ? (0, import_react.createElement)("span", { className: "dsw-muted" }, `${p.pageCount} \u9875`) : null,
      p.lint && (p.lint.errorCount || p.lint.warnCount) ? (0, import_react.createElement)("span", { className: "dsw-badge " + (p.lint.errorCount ? "dsw-err" : "dsw-warn") }, `lint ${p.lint.errorCount}\u9519/${p.lint.warnCount}\u8B66`) : null,
      (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", style: { marginLeft: "auto" }, disabled: busy, onClick: del }, "\u5220\u9664")
    ),
    p.domain ? (0, import_react.createElement)("div", { className: "dsw-muted" }, p.domain) : null,
    p.error ? (0, import_react.createElement)("div", { className: "dsw-err" }, "\u9519\u8BEF\uFF1A", p.error) : null,
    // Upload zone
    (0, import_react.createElement)(
      "div",
      {
        className: "dsw-drop" + (drag ? " dsw-over" : ""),
        style: { marginTop: 8 },
        onClick: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.onchange = () => input.files && onFiles(input.files);
          input.click();
        },
        onDragOver: (e) => {
          e.preventDefault();
          setDrag(true);
        },
        onDragLeave: () => setDrag(false),
        onDrop: (e) => {
          e.preventDefault();
          setDrag(false);
          e.dataTransfer?.files && onFiles(e.dataTransfer.files);
        }
      },
      busy ? "\u5904\u7406\u4E2D\u2026" : "\u70B9\u51FB\u6216\u62D6\u62FD\u4E0A\u4F20\u6587\u6863\uFF08\u652F\u6301\u591A\u6587\u4EF6\uFF09"
    ),
    (0, import_react.createElement)(
      "div",
      { className: "dsw-row", style: { marginTop: 8 } },
      (0, import_react.createElement)("button", { className: "dsw-btn", disabled: busy || !canBuild, onClick: buildAll, title: "\u4E00\u4E2A\u4F1A\u8BDD\u5185\u5B8C\u6210\uFF1ASCHEMA \u8BBE\u8BA1 \u2192 \u6784\u5EFA \u2192 \u56DE\u6536\u5165\u5E93\uFF08\u65E0\u9700\u4EBA\u5DE5\u786E\u8BA4 SCHEMA\uFF09" }, "\u26A1 \u4E00\u952E\u6784\u5EFA"),
      (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", disabled: busy || !canDesign, onClick: design, title: "\u53EA\u751F\u6210 SCHEMA \u8349\u7A3F\uFF0C\u6784\u5EFA\u524D\u4EBA\u5DE5\u786E\u8BA4" }, "\u2460 \u751F\u6210 SCHEMA \u8349\u7A3F"),
      (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", disabled: busy || !canConfirm, onClick: confirmSchema }, "\u2461 \u786E\u8BA4 SCHEMA"),
      (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", disabled: busy || !canIngest, onClick: ingest }, "\u2462 \u6309\u786E\u8BA4\u7684 SCHEMA \u6784\u5EFA"),
      lintBad ? (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", disabled: busy || !canLintFix, onClick: fixLint, title: `\u53D1\u8D77\u4E00\u4E2A\u4FEE\u590D\u4F1A\u8BDD\uFF0C\u6309 lint \u62A5\u544A\u81EA\u52A8\u4FEE\u590D\u5168\u90E8 ${p.lint.errorCount} \u9519 / ${p.lint.warnCount} \u8B66` }, `\u{1FA79} lint \u4FEE\u590D\uFF08${p.lint.errorCount}\u9519/${p.lint.warnCount}\u8B66\uFF09`) : null
    ),
    canConfirm && schemaDraft ? (0, import_react.createElement)(
      "div",
      { className: "dsw-card", style: { marginTop: 8 } },
      (0, import_react.createElement)("div", { className: "dsw-muted" }, "SCHEMA \u8349\u7A3F\uFF08\u53EF\u7F16\u8F91\u540E\u786E\u8BA4\uFF1B\u786E\u8BA4\u540E llm-wiki \u4F1A\u8BDD\u5C06\u6309\u6B64\u6784\u5EFA\uFF09"),
      (0, import_react.createElement)("textarea", { className: "dsw-textarea", value: schemaDraft, onChange: (e) => setSchemaDraft(e.target.value) })
    ) : null,
    // Built pages — one button on the card; the list opens in a modal.
    pages.length ? (0, import_react.createElement)("button", {
      className: "dsw-btn dsw-ghost",
      disabled: busy,
      onClick: () => setPagesOpen(true)
    }, `\u{1F4C4} \u5DF2\u6784\u5EFA\u9875\u9762\uFF08${pages.length}\uFF09`) : null,
    // Source docs — collapsible.
    uploads.length ? (0, import_react.createElement)(
      "div",
      { className: "dsw-card", style: { marginTop: 8 } },
      (0, import_react.createElement)(
        "div",
        { className: "dsw-row", style: { cursor: "pointer", userSelect: "none" }, onClick: () => setExpanded(!expanded) },
        (0, import_react.createElement)("strong", null, "\u5DF2\u4E0A\u4F20\u6587\u4EF6"),
        (0, import_react.createElement)("span", { className: "dsw-muted" }, ` ${uploads.length} \u4E2A`),
        (0, import_react.createElement)("span", { className: "dsw-muted", style: { marginLeft: "auto" } }, expanded ? "\u6536\u8D77 \u25B2" : "\u5C55\u5F00 \u25BC")
      ),
      expanded ? (0, import_react.createElement)(
        "div",
        { className: "dsw-scroll", style: { marginTop: 4 } },
        uploads.map((u) => {
          const ext = (u.name.match(/\.([^.]+)$/) || [])[1]?.toUpperCase() || "\u2014";
          const when = u.mtime ? new Date(u.mtime).toLocaleString("zh-CN", { hour12: false }) : "";
          const grp = sourceGroups.find((g) => g.sha256 === u.sha256);
          return (0, import_react.createElement)(
            "div",
            {
              key: u.sha256,
              className: "dsw-file",
              title: `SHA256: ${u.sha256}`
            },
            (0, import_react.createElement)("span", { style: { fontWeight: 500, color: "var(--dsw-text-color, inherit)" } }, u.name),
            (0, import_react.createElement)("span", { className: "dsw-muted" }, ext),
            (0, import_react.createElement)("span", { className: "dsw-muted" }, `${(u.size / 1024).toFixed(1)} KB`),
            when ? (0, import_react.createElement)("span", { className: "dsw-muted" }, when) : null,
            (0, import_react.createElement)("span", { className: "dsw-muted", style: { fontFamily: "monospace", fontSize: 11 } }, u.sha256.slice(0, 8)),
            grp && grp.pages.length ? (0, import_react.createElement)(
              "button",
              { className: "dsw-btn dsw-ghost", style: { padding: "2px 8px", fontSize: 11, marginLeft: "auto" }, onClick: () => setGroupOpen(grp) },
              `\u67E5\u770B\u6784\u5EFA\u9875\u9762\uFF08${grp.pages.length}\uFF09`
            ) : (0, import_react.createElement)("span", { className: "dsw-muted", style: { marginLeft: "auto", fontSize: 11 } }, "\u6682\u65E0\u5173\u8054\u9875\u9762"),
            (0, import_react.createElement)("button", {
              className: "dsw-btn dsw-ghost",
              style: { padding: "2px 8px", fontSize: 11, color: "#d03050" },
              disabled: busy,
              title: "\u5220\u9664\u8BE5\u6587\u4EF6\u53CA\u5176\u5173\u8054\u7684\u6784\u5EFA\u9875\u9762",
              onClick: async () => {
                const n = grp?.pages.length ?? 0;
                if (!confirm(`\u5220\u9664\u300C${u.name}\u300D\u53CA\u5176\u5173\u8054\u7684 ${n} \u4E2A\u6784\u5EFA\u9875\u9762\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`)) return;
                setBusy(true);
                setLocalErr("");
                try {
                  const r = await apiPostJson("/delete-upload", { projectId: p.id, sha256: u.sha256 });
                  if (!r.ok) throw new Error(r.error || "\u5220\u9664\u5931\u8D25");
                  await loadDetail();
                } catch (e) {
                  setLocalErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }
            }, "\u5220\u9664")
          );
        })
      ) : null
    ) : null,
    openPage ? (0, import_react.createElement)(PageModal, { open: { path: openPage.path, projectId: p.id, md: openPage.md }, onClose: () => setOpenPage(null) }) : null,
    pagesOpen ? (0, import_react_dom.createPortal)(
      (0, import_react.createElement)(
        "div",
        { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 }, onClick: () => setPagesOpen(false) },
        (0, import_react.createElement)(
          "div",
          { onClick: (e) => e.stopPropagation(), style: { width: "min(640px, 92vw)", maxHeight: "86vh", overflow: "auto", background: "var(--dsw-bg-color,#fff)", borderRadius: 10, padding: 18 } },
          (0, import_react.createElement)(
            "div",
            { className: "dsw-row", style: { marginBottom: 8 } },
            (0, import_react.createElement)("strong", null, `\u5DF2\u6784\u5EFA\u9875\u9762 \xB7 ${p.name}\uFF08${pages.length}\uFF09`),
            (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", style: { marginLeft: "auto" }, onClick: () => setPagesOpen(false) }, "\u5173\u95ED")
          ),
          pages.map(
            (pg) => (0, import_react.createElement)(
              "button",
              {
                key: pg.path,
                className: "dsw-chip",
                title: pg.path,
                onClick: async () => {
                  try {
                    const md = await apiText(`/page/${p.id}?path=${encodeURIComponent(pg.path)}`);
                    setOpenPage({ path: pg.path, md });
                  } catch {
                  }
                }
              },
              `${pg.title || pg.path} \xB7 ${pg.kind}`
            )
          )
        )
      ),
      document.body
    ) : null,
    groupOpen ? (0, import_react_dom.createPortal)(
      (0, import_react.createElement)(
        "div",
        { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 }, onClick: () => setGroupOpen(null) },
        (0, import_react.createElement)(
          "div",
          { onClick: (e) => e.stopPropagation(), style: { width: "min(640px, 92vw)", maxHeight: "86vh", overflow: "auto", background: "var(--dsw-bg-color,#fff)", borderRadius: 10, padding: 18 } },
          (0, import_react.createElement)(
            "div",
            { className: "dsw-row", style: { marginBottom: 8 } },
            (0, import_react.createElement)("strong", null, `${groupOpen.name} \u7684\u6784\u5EFA\u9875\u9762\uFF08${groupOpen.pages.length}\uFF09`),
            (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", style: { marginLeft: "auto" }, onClick: () => setGroupOpen(null) }, "\u5173\u95ED")
          ),
          groupOpen.pages.length ? groupOpen.pages.map(
            (pg) => (0, import_react.createElement)(
              "button",
              {
                key: pg.path,
                className: "dsw-chip",
                title: pg.path,
                onClick: async () => {
                  try {
                    const md = await apiText(`/page/${p.id}?path=${encodeURIComponent(pg.path)}`);
                    setOpenPage({ path: pg.path, md });
                  } catch {
                  }
                }
              },
              `${pg.title || pg.path} \xB7 ${pg.kind}`
            )
          ) : (0, import_react.createElement)("div", { className: "dsw-muted" }, "\u8BE5\u6587\u4EF6\u6CA1\u6709\u5173\u8054\u5230\u4EFB\u4F55\u6784\u5EFA\u9875\u9762\uFF08\u9875\u9762 frontmatter \u7684 sources \u672A\u5F15\u7528\u5B83\uFF09")
        )
      ),
      document.body
    ) : null,
    localErr ? (0, import_react.createElement)("div", { className: "dsw-err" }, localErr) : null
  );
}
function SearchTab(_props) {
  const [q, setQ] = (0, import_react.useState)("");
  const [projectId, setProjectId] = (0, import_react.useState)("");
  const [hits, setHits] = (0, import_react.useState)([]);
  const [err, setErr] = (0, import_react.useState)("");
  const [open, setOpen] = (0, import_react.useState)(null);
  const [projects, setProjects] = (0, import_react.useState)([]);
  (0, import_react.useEffect)(() => {
    apiGet("/projects").then((d) => setProjects(d.projects)).catch(() => {
    });
  }, []);
  const doSearch = async () => {
    if (!q.trim()) return;
    setErr("");
    try {
      const params = new URLSearchParams({ q });
      if (projectId) params.set("projectId", projectId);
      const data = await apiGet(`/search?${params.toString()}`);
      setHits(data.hits);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const openPage = async (h2) => {
    try {
      const md = await apiText(`/page/${h2.projectId}?path=${encodeURIComponent(h2.path)}`);
      setOpen({ path: h2.path, projectId: h2.projectId, md });
    } catch {
      setErr("\u8BFB\u53D6\u9875\u9762\u5931\u8D25");
    }
  };
  return (0, import_react.createElement)(
    "div",
    null,
    (0, import_react.createElement)(
      "div",
      { className: "dsw-row" },
      (0, import_react.createElement)("input", { className: "dsw-input", placeholder: "\u68C0\u7D22\u77E5\u8BC6\u5E93\u2026", value: q, onChange: (e) => setQ(e.target.value), style: { flex: 1 } }),
      (0, import_react.createElement)(
        "select",
        { className: "dsw-input", style: { maxWidth: 180 }, value: projectId, onChange: (e) => setProjectId(e.target.value) },
        (0, import_react.createElement)("option", { value: "" }, "\u5168\u90E8\u9879\u76EE"),
        ...projects.map((p) => (0, import_react.createElement)("option", { key: p.id, value: p.id }, p.name))
      ),
      (0, import_react.createElement)("button", { className: "dsw-btn", onClick: doSearch }, "\u68C0\u7D22")
    ),
    err ? (0, import_react.createElement)("div", { className: "dsw-err" }, err) : null,
    hits.length === 0 ? null : (0, import_react.createElement)(
      "div",
      { style: { marginTop: 10 } },
      hits.map((h0) => (0, import_react.createElement)(
        "div",
        { key: h0.projectId + h0.path, className: "dsw-hit", onClick: () => openPage(h0), style: { cursor: "pointer" } },
        (0, import_react.createElement)("div", null, (0, import_react.createElement)("strong", null, h0.title), " ", (0, import_react.createElement)("span", { className: "dsw-muted" }, `\uFF08${h0.projectName} \xB7 ${h0.kind}\uFF09`)),
        (0, import_react.createElement)("div", { className: "dsw-muted" }, h0.snippet.slice(0, 200))
      ))
    ),
    open ? (0, import_react.createElement)(PageModal, { open, onClose: () => setOpen(null) }) : null
  );
}
function PageModal(props) {
  return (0, import_react_dom.createPortal)(
    (0, import_react.createElement)(
      "div",
      { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 }, onClick: props.onClose },
      (0, import_react.createElement)(
        "div",
        { onClick: (e) => e.stopPropagation(), style: { width: "min(760px, 92vw)", maxHeight: "86vh", overflow: "auto", background: "var(--dsw-bg-color,#fff)", borderRadius: 10, padding: 18 } },
        (0, import_react.createElement)("div", { className: "dsw-row" }, (0, import_react.createElement)("strong", null, props.open.path), (0, import_react.createElement)("button", { className: "dsw-btn dsw-ghost", style: { marginLeft: "auto" }, onClick: props.onClose }, "\u5173\u95ED")),
        (0, import_react.createElement)("pre", { className: "dsw-page" }, props.open.md)
      )
    ),
    document.body
  );
}
function StatusTab(props) {
  const [global, setGlobal] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    apiGet("/status").then(setGlobal).catch(() => setGlobal(null));
  }, []);
  return (0, import_react.createElement)(
    "div",
    null,
    global ? (0, import_react.createElement)(
      "div",
      { className: "dsw-card" },
      (0, import_react.createElement)("div", { className: "dsw-muted" }, `API \u7AEF\u53E3 ${global.apiPort} \xB7 \u6570\u636E\u76EE\u5F55 ${global.dataDir}`),
      (0, import_react.createElement)("div", { className: "dsw-muted" }, `\u9879\u76EE ${global.projects} \xB7 \u7D22\u5F15\u9875\u9762 ${global.pages} \xB7 \u4F1A\u8BDD\u9A71\u52A8 ${global.hasSession ? "\u53EF\u7528" : "\u4E0D\u53EF\u7528"}`)
    ) : null,
    (0, import_react.createElement)("div", { className: "dsw-muted", style: { marginTop: 8 } }, "\u9879\u76EE\u72B6\u6001\uFF1A"),
    props.projects.length === 0 ? (0, import_react.createElement)("div", { className: "dsw-muted" }, "\u65E0") : (0, import_react.createElement)("div", { className: "dsw-list" }, props.projects.map(
      (p) => (0, import_react.createElement)(
        "li",
        { key: p.id, className: "dsw-row" },
        (0, import_react.createElement)("span", null, p.name),
        (0, import_react.createElement)("span", { className: statusBadgeClass(p.status) }, p.status),
        (0, import_react.createElement)("span", { className: "dsw-muted" }, `${p.pageCount} \u9875`),
        p.lint && (p.lint.errorCount || p.lint.warnCount) ? (0, import_react.createElement)("span", { className: "dsw-badge " + (p.lint.errorCount ? "dsw-err" : "dsw-warn") }, `${p.lint.errorCount}/${p.lint.warnCount}`) : null
      )
    ))
  );
}
function SettingsTab(_props) {
  const [groups, setGroups] = (0, import_react.useState)([]);
  const [workspaces, setWorkspaces] = (0, import_react.useState)([]);
  const [model, setModel] = (0, import_react.useState)("");
  const [workspaceId, setWorkspaceId] = (0, import_react.useState)("");
  const [agentPreset, setAgentPreset] = (0, import_react.useState)("");
  const [permPreset, setPermPreset] = (0, import_react.useState)("");
  const [err, setErr] = (0, import_react.useState)("");
  const [saved, setSaved] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    apiGet("/catalog").then((d) => setGroups(d.groups ?? [])).catch((e) => setErr(String(e)));
    apiGet("/workspaces").then((d) => setWorkspaces(d.workspaces ?? [])).catch(() => {
    });
    apiGet("/settings").then((d) => {
      setModel(d.settings.ingestModel || "");
      setWorkspaceId(d.settings.ingestWorkspaceId || "");
      setAgentPreset(d.settings.ingestAgentPreset || "");
      setPermPreset(d.settings.ingestPermissionPreset || "");
    }).catch(() => {
    });
  }, []);
  const save = async () => {
    setBusy(true);
    setErr("");
    setSaved(false);
    try {
      await fetch(API + "/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingestModel: model, ingestWorkspaceId: workspaceId })
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const totalModels = groups.reduce((n, g) => n + g.models.length, 0);
  return (0, import_react.createElement)(
    "div",
    null,
    (0, import_react.createElement)(
      "div",
      { className: "dsw-card" },
      (0, import_react.createElement)("div", { className: "dsw-muted" }, "\u6784\u5EFA\u4F1A\u8BDD\u8BBE\u7F6E\uFF08\u65B0\u4F1A\u8BDD\u7684\u5DE5\u4F5C\u533A\u4E0E\u4F7F\u7528\u7684\u6A21\u578B\uFF0C\u4ECE\u6A21\u578B\u6C60\u9009\u62E9\uFF09"),
      (0, import_react.createElement)(
        "div",
        { className: "dsw-row", style: { marginTop: 8 } },
        (0, import_react.createElement)("span", { className: "dsw-muted" }, "\u5DE5\u4F5C\u533A\uFF1A"),
        (0, import_react.createElement)(
          "select",
          { className: "dsw-input", style: { maxWidth: 300 }, value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value) },
          (0, import_react.createElement)("option", { value: "" }, "\u5BBF\u4E3B\u9ED8\u8BA4\u5DE5\u4F5C\u533A"),
          ...workspaces.map((w) => (0, import_react.createElement)("option", { key: w.id, value: w.id }, `${w.path}\uFF08${w.sessions} \u4F1A\u8BDD\uFF09`))
        )
      ),
      (0, import_react.createElement)(
        "div",
        { className: "dsw-row", style: { marginTop: 8 } },
        (0, import_react.createElement)("span", { className: "dsw-muted" }, "\u6A21\u578B\uFF1A"),
        (0, import_react.createElement)(
          "select",
          { className: "dsw-input", style: { maxWidth: 340 }, value: model, onChange: (e) => setModel(e.target.value) },
          (0, import_react.createElement)("option", { value: "" }, "\u5BBF\u4E3B\u9ED8\u8BA4\u6A21\u578B"),
          ...groups.map(
            (g) => g.models.map((m) => (0, import_react.createElement)("option", { key: `${g.id}/${m.id}`, value: `${g.id}/${m.id}` }, `${g.name} \xB7 ${m.name}`))
          ).flat()
        )
      ),
      (0, import_react.createElement)(
        "div",
        { className: "dsw-row", style: { marginTop: 10 } },
        (0, import_react.createElement)("button", { className: "dsw-btn", disabled: busy, onClick: save }, "\u4FDD\u5B58\u8BBE\u7F6E"),
        saved ? (0, import_react.createElement)("span", { className: "dsw-muted" }, "\u2713 \u5DF2\u4FDD\u5B58\uFF08\u5BF9\u672C\u8FDB\u7A0B\u5185\u7684\u65B0\u6784\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF09") : null,
        err ? (0, import_react.createElement)("span", { className: "dsw-err" }, err) : null
      ),
      (0, import_react.createElement)(
        "div",
        { className: "dsw-muted", style: { marginTop: 8 } },
        totalModels === 0 ? "\u672A\u63A5\u6536\u5230\u6A21\u578B\u6C60\uFF08\u9700\u5BBF\u4E3B llm \u670D\u52A1\uFF09\u3002" : `\u6A21\u578B\u6C60\uFF1A${groups.length} \u4E2A\u4F9B\u5E94\u5546 / ${totalModels} \u4E2A\u6A21\u578B\u3002`,
        workspaces.length === 0 ? " \u672A\u63A5\u6536\u5230\u5DE5\u4F5C\u533A\u5217\u8868\uFF08\u4F7F\u7528\u5BBF\u4E3B\u9ED8\u8BA4\uFF09\u3002" : ""
      ),
      agentPreset || permPreset ? (0, import_react.createElement)(
        "div",
        { className: "dsw-muted", style: { marginTop: 4 } },
        `\u4F1A\u8BDD\u9884\u8BBE\uFF1AagentPreset=${agentPreset || "\uFF08\u9ED8\u8BA4\uFF09"} \xB7 \u6743\u9650\u9884\u8BBE=${permPreset || "\uFF08\u9ED8\u8BA4\uFF09"}\uFF08\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u8BBE\u7F6E\uFF0C\u6B64\u5904\u53EA\u8BFB\uFF09`
      ) : null
    )
  );
}
var name = "dsh-local-llm-wiki-client";
var inject = ["slots"];
function apply(ctx) {
  injectStyles();
  const slots = ctx.slots;
  if (!slots?.inject) return;
  const PanelEntry = () => (0, import_react.createElement)(PageErrorBoundary, null, (0, import_react.createElement)(Panel));
  slots.inject("main", () => {
    slots.register(
      {
        name: "main",
        key: PANEL_ID,
        inject: () => ({ onBack: () => ctx.get?.("layout")?.selectPanel(null) })
      },
      PanelEntry
    );
  });
  slots.inject("sidebar.panellist", () => {
    slots.register(
      { name: "sidebar.panellist", id: PANEL_ID, order: 21, label: "Wiki \u77E5\u8BC6\u5E93" },
      () => (0, import_react.createElement)("span", { style: { fontSize: 17, lineHeight: 1, display: "inline-flex" } }, "\u{1F4DA}")
    );
  });
}
var client_default = { name, inject, apply };
return module.exports; } });
//# sourceMappingURL=client.js.map

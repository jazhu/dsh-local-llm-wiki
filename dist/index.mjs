// src/index.ts
import { createServer } from "node:http";
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path4 from "node:path";
import os2 from "node:os";

// src/store.ts
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

// src/wiki-parse.ts
function splitFrontmatter(md) {
  const norm = md.replace(/\r\n/g, "\n");
  if (!norm.startsWith("---\n")) return { front: null, body: norm };
  const end = norm.indexOf("\n---", 4);
  if (end < 0) return { front: null, body: norm };
  const front = norm.slice(4, end + 1);
  let body = norm.slice(end + 1);
  body = body.replace(/^\n---\n?/, "");
  return { front, body };
}
function parseFrontmatter(front) {
  const out = {};
  const lines = front.split("\n");
  let currentListKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const itemMatch = /^\s+-\s+(.*)$/.exec(line);
    if (itemMatch && currentListKey) {
      const arr = out[currentListKey];
      if (Array.isArray(arr)) arr.push(stripQuotes(itemMatch[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];
    if (!val) {
      out[key] = [];
      currentListKey = key;
      continue;
    }
    currentListKey = null;
    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
    } else {
      out[key] = stripQuotes(val);
    }
  }
  return out;
}
function stripQuotes(s) {
  if (s.length >= 2 && (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
function asArray(v) {
  if (v === void 0) return [];
  if (Array.isArray(v)) return v;
  if (/[,，]/.test(v)) return v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  return v ? [v] : [];
}
function asString(v) {
  if (v === void 0) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}
function kindFromPath(relPath2) {
  const norm = "/" + relPath2.replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm.includes("/entities/")) return "entities";
  if (norm.includes("/concepts/")) return "concepts";
  if (norm.includes("/comparisons/")) return "comparisons";
  if (norm.includes("/queries/")) return "queries";
  const base = norm.split("/").pop() ?? "";
  if (/^index\.md$/i.test(base)) return "index";
  if (/^schema\.md$/i.test(base)) return "other";
  return "other";
}
function gist(body) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    if (b.startsWith("#")) continue;
    const one = b.replace(/\n/g, " ").trim();
    if (one.length < 8) continue;
    return one.length > 220 ? one.slice(0, 220) + "\u2026" : one;
  }
  return "";
}
function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : "";
}
function confidenceOf(v) {
  const s = asString(v);
  if (!s) return 1;
  const n = Number(s);
  if (Number.isFinite(n)) return n <= 1 ? Math.max(0, n) : Math.max(0, Math.min(1, n / 100));
  const lower = s.toLowerCase();
  if (lower === "high" || lower === "\u9AD8") return 0.9;
  if (lower === "medium" || lower === "mid" || lower === "\u4E2D") return 0.6;
  if (lower === "low" || lower === "\u4F4E") return 0.3;
  return 1;
}
function parseWikiPage(args) {
  const { front, body } = splitFrontmatter(args.markdown);
  const fm = front ? parseFrontmatter(front) : {};
  const kind = kindFromPath(args.relPath);
  const fmTitle = asString(fm.title);
  const title = fmTitle || firstHeading(body) || (args.relPath.split("/").pop() ?? args.id);
  return {
    id: args.id,
    path: args.path,
    kind,
    title,
    tags: asArray(fm.tags),
    sources: asArray(fm.sources),
    confidence: confidenceOf(fm.confidence),
    updated: asString(fm.updated),
    text: body.trim(),
    summary: gist(body)
  };
}

// src/store-db.ts
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
var SCHEMA = `
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
`;
var WikiDb = class {
  db;
  dbPath;
  log;
  constructor(dataDir, log = {}) {
    this.dbPath = join(dataDir, "wiki.db");
    this.log = log;
    try {
      mkdirSync(dataDir, { recursive: true });
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(SCHEMA);
      this.db.exec("PRAGMA journal_mode = WAL;");
    } catch (e) {
      this.log.warn?.(`[dsh-local-llm-wiki] SQLite \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u6570\u636E\u4EC5\u4FDD\u5B58\u5728\u5185\u5B58\uFF1A${e.message}`);
      this.db = void 0;
    }
  }
  get usable() {
    return this.db !== void 0;
  }
  putProjects(projects) {
    if (!this.db) return;
    try {
      this.db.exec("BEGIN");
      this.db.prepare("DELETE FROM projects").run();
      const ins = this.db.prepare(
        "INSERT INTO projects (id, name, status, updated_at, json) VALUES (?, ?, ?, ?, ?)"
      );
      for (const p of projects) {
        ins.run(p.id, p.name, p.status, p.updatedAt, JSON.stringify(p));
      }
      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db?.exec("ROLLBACK");
      } catch {
      }
      this.log.warn?.(`[dsh-local-llm-wiki] \u9879\u76EE\u5199\u5165 SQLite \u5931\u8D25\uFF08\u5185\u5B58\u6570\u636E\u4E0D\u53D7\u5F71\u54CD\uFF09\uFF1A${e.message}`);
    }
  }
  projectRows() {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare("SELECT json FROM projects").all();
      return rows.map((r) => {
        try {
          return JSON.parse(r.json);
        } catch {
          return null;
        }
      }).filter((p) => !!p && typeof p.id === "string");
    } catch {
      return [];
    }
  }
  putSettings(settings) {
    if (!this.db) return;
    try {
      this.db.exec("BEGIN");
      this.db.prepare("DELETE FROM settings").run();
      const ins = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
      for (const [k, v] of Object.entries(settings)) {
        if (v === void 0) continue;
        ins.run(k, JSON.stringify(v));
      }
      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db?.exec("ROLLBACK");
      } catch {
      }
      this.log.warn?.(`[dsh-local-llm-wiki] \u8BBE\u7F6E\u5199\u5165 SQLite \u5931\u8D25\uFF1A${e.message}`);
    }
  }
  settingRows() {
    if (!this.db) return {};
    try {
      const rows = this.db.prepare("SELECT key, value FROM settings").all();
      const out = {};
      for (const r of rows) {
        try {
          out[r.key] = JSON.parse(r.value);
        } catch {
        }
      }
      return out;
    } catch {
      return {};
    }
  }
  isEmpty() {
    return this.projectRows().length === 0 && Object.keys(this.settingRows()).length === 0;
  }
  dispose() {
    try {
      this.db?.close();
    } catch {
    }
    this.db = void 0;
  }
};
function migrateLegacyJson(db, dataDir) {
  const regFile = join(dataDir, "registry.json");
  const setFile = join(dataDir, "settings.json");
  if (!existsSync(regFile) && !existsSync(setFile)) return { projects: 0, settings: 0 };
  let projects = [];
  let settings = {};
  try {
    if (existsSync(regFile)) {
      const parsed = JSON.parse(readFileSync(regFile, "utf-8"));
      projects = Array.isArray(parsed?.projects) ? parsed.projects.filter((p) => p && typeof p.id === "string") : [];
    }
    if (existsSync(setFile)) {
      settings = JSON.parse(readFileSync(setFile, "utf-8"));
      if (!settings || typeof settings !== "object") settings = {};
    }
  } catch {
    return { projects: 0, settings: 0 };
  }
  db.putProjects(projects);
  db.putSettings(settings);
  for (const f of [regFile, setFile]) {
    try {
      if (existsSync(f)) renameSync(f, f + ".imported");
    } catch {
    }
  }
  return { projects: projects.length, settings: Object.keys(settings).length };
}

// src/store.ts
var REGISTRY_FILE = "registry.json";
var MANIFEST_FILE = "manifest.json";
var SETTINGS_FILE = "settings.json";
var HARVEST_KINDS = ["entities", "concepts", "comparisons", "queries"];
var ProjectStore = class {
  dataDir;
  registry = { version: 1, projects: [] };
  /** projectId -> harvested pages (also what the index is built from). */
  pages = /* @__PURE__ */ new Map();
  loaded = false;
  db;
  constructor(dataDir, log) {
    this.dataDir = dataDir;
    this.db = new WikiDb(dataDir, log);
  }
  get projectsDir() {
    return path.join(this.dataDir, "projects");
  }
  projectDir(id) {
    return path.join(this.projectsDir, id);
  }
  rawDir(id) {
    return path.join(this.projectDir(id), "raw");
  }
  /** Absolute project workspace dir (cwd handed to the DSH session). */
  projectAbs(id) {
    return this.projectDir(id);
  }
  wikiDir(id) {
    const p = this.get(id);
    return path.join(this.projectDir(id), p?.wikiName || "wiki");
  }
  async load() {
    if (this.loaded) return;
    try {
      await fs.mkdir(this.projectsDir, { recursive: true });
    } catch {
    }
    if (this.db.usable && this.db.isEmpty()) {
      const mig = migrateLegacyJson(this.db, this.dataDir);
      if (mig.projects || mig.settings) {
        this.registry.projects = this.db.projectRows();
      }
    }
    if (this.db.usable) {
      this.registry.projects = this.db.projectRows();
    } else {
      try {
        const txt = await fs.readFile(path.join(this.dataDir, REGISTRY_FILE), "utf-8");
        const parsed = JSON.parse(txt);
        if (Array.isArray(parsed.projects)) this.registry = parsed;
      } catch {
      }
    }
    this.loaded = true;
  }
  async persist() {
    if (this.db.usable) {
      this.db.putProjects(this.registry.projects);
      return;
    }
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const target = path.join(this.dataDir, REGISTRY_FILE);
      const tmp = target + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(this.registry, null, 2), "utf-8");
      await fs.rename(tmp, target);
    } catch {
    }
  }
  list() {
    return [...this.registry.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id) {
    return this.registry.projects.find((p) => p.id === id);
  }
  touch(p) {
    p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  async createProject(args) {
    await this.load();
    const base = slugify(args.name || "project");
    let id = base;
    let n = 1;
    while (this.get(id)) {
      id = `${base}-${n++}`;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const project = {
      id,
      name: args.name.trim() || base,
      domain: (args.domain ?? "").trim(),
      wikiName: slugify(args.wikiName || "wiki") || "wiki",
      status: "empty",
      createdAt: now,
      updatedAt: now,
      schemaConfirmed: false,
      pageCount: 0
    };
    await fs.mkdir(this.rawDir(id), { recursive: true });
    this.registry.projects.push(project);
    await this.persist();
    return project;
  }
  async updateProject(id, patch) {
    await this.load();
    const p = this.get(id);
    if (!p) return void 0;
    if (patch.name !== void 0) p.name = patch.name;
    if (patch.domain !== void 0) p.domain = patch.domain;
    if (patch.status !== void 0) p.status = patch.status;
    if (patch.schemaConfirmed !== void 0) p.schemaConfirmed = patch.schemaConfirmed;
    if (patch.schemaDraft !== void 0) p.schemaDraft = patch.schemaDraft;
    if (patch.dshSessionId !== void 0) p.dshSessionId = patch.dshSessionId;
    if (patch.error !== void 0) p.error = patch.error;
    this.touch(p);
    await this.persist();
    return p;
  }
  async deleteProject(id) {
    await this.load();
    const before = this.registry.projects.length;
    this.registry.projects = this.registry.projects.filter((p) => p.id !== id);
    this.pages.delete(id);
    if (this.registry.projects.length === before) return false;
    try {
      await fs.rm(this.projectDir(id), { recursive: true, force: true });
    } catch {
    }
    await this.persist();
    return true;
  }
  /** Write an uploaded file into raw/, record it, update manifest + status. */
  async addUpload(id, file) {
    await this.load();
    const p = this.get(id);
    if (!p) throw new Error("project not found");
    const safeName = sanitizeName(file.name);
    const docId = randomUUID();
    const dir = this.rawDir(id);
    await fs.mkdir(dir, { recursive: true });
    const diskName = `${docId.slice(0, 8)}-${safeName}`;
    const abs = path.join(dir, diskName);
    await fs.writeFile(abs, file.data);
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    const doc = {
      id: docId,
      name: safeName,
      mime: file.mime || guessMime(safeName),
      size: file.data.length,
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sha256
    };
    await this.writeManifestEntry(id, diskName, sha256);
    const midflight = p.status === "designing" || p.status === "ingesting" || p.status === "harvesting";
    if (!midflight) {
      p.status = "uploaded";
    }
    this.touch(p);
    await this.persist();
    return doc;
  }
  /** Snapshot of raw/ file names + hashes currently on disk (for incremental diff + listing). */
  async scanRaw(id) {
    const dir = this.rawDir(id);
    const out = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (e.name.startsWith(".")) continue;
        const abs = path.join(dir, e.name);
        try {
          const buf = await fs.readFile(abs);
          const mtime = (await fs.stat(abs)).mtime.toISOString();
          out.push({ name: e.name, sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length, mtime });
        } catch {
        }
      }
    } catch {
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async writeManifestEntry(id, fileName, sha256) {
    const cacheDir = path.join(this.rawDir(id), ".cache");
    await fs.mkdir(cacheDir, { recursive: true });
    const mf = path.join(cacheDir, MANIFEST_FILE);
    let manifest = {};
    try {
      manifest = JSON.parse(await fs.readFile(mf, "utf-8"));
    } catch {
    }
    manifest[fileName] = sha256;
    await fs.writeFile(mf, JSON.stringify(manifest, null, 2), "utf-8");
  }
  /** Read the raw/.cache/manifest.json snapshot. */
  async readManifest(id) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.rawDir(id), ".cache", MANIFEST_FILE), "utf-8"));
    } catch {
      return {};
    }
  }
  /**
   * Delete one uploaded raw file (by sha256 match) and every built page whose
   * frontmatter `sources` cites that file. Returns the removed page count.
   */
  async deleteUpload(id, sha256) {
    const dir = this.rawDir(id);
    let targetName = null;
    for (const f of await this.scanRaw(id)) {
      if (f.sha256 === sha256) {
        targetName = f.name;
        break;
      }
    }
    if (!targetName) throw new Error("\u672A\u627E\u5230\u8BE5\u4E0A\u4F20\u6587\u4EF6\uFF08SHA256 \u4E0D\u5339\u914D\uFF09");
    const bare = targetName.replace(/^[0-9a-f]{8}-/, "");
    const stem = bare.replace(/\.[^.]+$/, "").toLowerCase();
    const pages = this.getPages(id).length ? this.getPages(id) : await this.harvest(id);
    let removedPages = 0;
    for (const pg of pages) {
      const cited = pg.sources.some((s) => {
        const ls = s.toLowerCase();
        const file = ls.split("#")[0].trim();
        const fStem = file.replace(/\.[^.]+$/, "");
        return fStem && (stem.includes(fStem) || fStem.includes(stem)) || file && ls.includes(stem);
      });
      if (!cited) continue;
      const abs = path.join(this.wikiDir(id), pg.path.replace(/\\/g, "/"));
      const root = path.resolve(this.wikiDir(id));
      if (path.resolve(abs).startsWith(root)) {
        try {
          await fs.unlink(path.resolve(abs));
          removedPages++;
        } catch {
        }
      }
    }
    await fs.unlink(path.join(dir, targetName));
    try {
      const mf = path.join(dir, ".cache", MANIFEST_FILE);
      const manifest = JSON.parse(await fs.readFile(mf, "utf-8"));
      delete manifest[targetName];
      await fs.writeFile(mf, JSON.stringify(manifest, null, 2), "utf-8");
    } catch {
    }
    const remaining = await this.harvest(id);
    const proj = this.get(id);
    if (proj) {
      proj.pageCount = remaining.length;
      proj.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.persist();
    }
    return removedPages;
  }
  /**
   * Harvest every markdown page under the wiki dir's whitelisted subdirs plus
   * index.md. Returns the parsed pages and refreshes the in-memory cache.
   */
  async harvest(id, wikiDirAbs) {
    await this.load();
    const p = this.get(id);
    if (!p) throw new Error("project not found");
    const root = wikiDirAbs || this.wikiDir(id);
    const pages = [];
    for (const kind of HARVEST_KINDS) {
      const sub = path.join(root, kind);
      const found = await this.walkMarkdown(sub, root, id);
      pages.push(...found);
    }
    const indexAbs = path.join(root, "index.md");
    try {
      const md = await fs.readFile(indexAbs, "utf-8");
      pages.push(parseWikiPage({ id: `${id}:index`, path: relPath(root, indexAbs), relPath: "index.md", markdown: md }));
    } catch {
    }
    this.pages.set(id, pages);
    p.pageCount = pages.length;
    p.harvestedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.touch(p);
    await this.persist();
    return pages;
  }
  getPages(id) {
    return this.pages.get(id) ?? [];
  }
  async walkMarkdown(dir, root, projectId) {
    const out = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...await this.walkMarkdown(abs, root, projectId));
      } else if (/\.(md|markdown)$/i.test(e.name)) {
        try {
          const md = await fs.readFile(abs, "utf-8");
          const rel = relPath(root, abs);
          out.push(parseWikiPage({ id: `${projectId}:${rel}`, path: rel, relPath: rel, markdown: md }));
        } catch {
        }
      }
    }
    return out;
  }
  /**
   * Browse a filesystem directory for the wiki-import folder picker
   * (user-requested 2026-10-11). Returns subdirectories of `dir` (sorted,
   * hidden dirs skipped) plus a flag telling whether `dir` itself looks like
   * a built wiki root (index.md / SCHEMA.md present or any of the harvest
   * kinds exists) so the panel can hint the user. Best-effort and read-only.
   */
  async browseDir(dir) {
    const target = path.resolve(dir);
    let entries;
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      throw new Error(`\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB: ${target}`);
    }
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => ({ name: e.name, path: path.join(target, e.name) })).sort((a, b) => a.name.localeCompare(b.name));
    const markers = ["index.md", "SCHEMA.md", ...HARVEST_KINDS];
    const isWikiRoot = await (async () => {
      for (const m of markers) {
        try {
          if ((await fs.stat(path.join(target, m))).isDirectory() || m.endsWith(".md")) return true;
        } catch {
        }
      }
      return false;
    })();
    const roots = [];
    for (const d of dirs) {
      try {
        const sub = await fs.readdir(d.path, { withFileTypes: true });
        const has = await (async () => {
          for (const m of markers) {
            try {
              if (sub.some((s) => s.name === m)) return true;
            } catch {
            }
          }
          return false;
        })();
        if (has) roots.push(d);
      } catch {
      }
    }
    let parent = path.dirname(target);
    if (parent === target) parent = null;
    return { path: target, parent, isWikiRoot, dirs, roots };
  }
  /**
   * Import an already-built wiki directory into the project: recursively copy
   * it over the project's wiki dir (merging; existing files are overwritten),
   * then harvest. Returns the harvested page count. Refuses to import from a
   * directory inside the project's own data dir (it is already there).
   */
  async importWikiDir(id, sourceDir) {
    await this.load();
    const p = this.get(id);
    if (!p) throw new Error("project not found");
    const src = path.resolve(sourceDir);
    let stat;
    try {
      stat = await fs.stat(src);
    } catch {
      throw new Error(`\u6E90\u76EE\u5F55\u4E0D\u5B58\u5728: ${src}`);
    }
    if (!stat.isDirectory()) throw new Error(`\u6E90\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55: ${src}`);
    const dest = this.wikiDir(id);
    if (src === path.resolve(dest) || path.resolve(dest).startsWith(src + path.sep) || src.startsWith(path.resolve(this.dataDir) + path.sep)) {
      throw new Error("\u6E90\u76EE\u5F55\u4E0D\u80FD\u4F4D\u4E8E\u63D2\u4EF6\u6570\u636E\u76EE\u5F55\u5185");
    }
    await copyDir(src, dest);
    const pages = await this.harvest(id);
    if (!pages.length) throw new Error("\u5BFC\u5165\u5B8C\u6210\u4F46\u672A\u6536\u5272\u5230\u4EFB\u4F55\u9875\u9762\uFF08\u9700\u8981 entities/concepts/comparisons/queries \u5B50\u76EE\u5F55\u6216 index.md\uFF09");
    return pages.length;
  }
  /** Store a SCHEMA.md draft into the wiki dir (after user confirmation). */
  async writeSchema(id, schema) {
    const root = this.wikiDir(id);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "SCHEMA.md"), schema, "utf-8");
  }
  async readSchema(id) {
    try {
      return await fs.readFile(path.join(this.wikiDir(id), "SCHEMA.md"), "utf-8");
    } catch {
      return null;
    }
  }
  /** Read one page's full markdown from disk by its relative path. */
  async readPage(id, pageRelPath) {
    const root = this.wikiDir(id);
    const abs = path.join(root, ...pageRelPath.split(/[\\/]/));
    if (!abs.startsWith(root)) return null;
    try {
      return await fs.readFile(abs, "utf-8");
    } catch {
      return null;
    }
  }
  /** Apply a lint report onto a project record. */
  setLint(id, report) {
    const p = this.get(id);
    if (!p) return;
    p.lint = report;
    this.touch(p);
    void this.persist();
  }
  /**
   * On boot, any project stuck mid-flight (designing/ingesting/harvesting) can
   * no longer be trusted — its DSH session is gone. Mark it `failed` with a
   * resume hint so the UI offers a rebuild instead of a spinner forever.
   */
  async markStalled() {
    await this.load();
    const stalled = [];
    for (const p of this.registry.projects) {
      if (p.status === "designing" || p.status === "ingesting" || p.status === "harvesting") {
        p.status = "failed";
        p.error = "\u4F1A\u8BDD\u5728\u63D2\u4EF6\u91CD\u542F\u65F6\u4E2D\u65AD\uFF0C\u9700\u8981\u91CD\u65B0\u6784\u5EFA";
        p.dshSessionId = void 0;
        this.touch(p);
        stalled.push(p.id);
      }
    }
    if (stalled.length) await this.persist();
    return stalled;
  }
  /** Re-load harvested pages from disk after a restart (index rebuild). */
  // ---- settings persistence (2026-10-11) ----------------------------------
  // The settings page previously mutated only the in-memory runtime config, so
  // every restart (or host re-activation) silently reset workspace/model to
  // defaults — the "settings revert themselves" bug. Persist to
  // <dataDir>/settings.json and overlay on top of the resolved config.
  /** Overlay persisted settings onto a resolved config (mutates and returns it). */
  async loadSettingsInto(resolved) {
    const saved = await this.readSettings();
    if (saved.ingestWorkspaceId !== void 0) resolved.ingestWorkspaceId = saved.ingestWorkspaceId;
    if (saved.ingestModel !== void 0) resolved.ingestModel = saved.ingestModel;
    if (saved.ingestAgentPreset !== void 0) resolved.ingestAgentPreset = saved.ingestAgentPreset;
    if (saved.ingestPermissionPreset !== void 0) resolved.ingestPermissionPreset = saved.ingestPermissionPreset;
    return resolved;
  }
  async readSettings() {
    if (this.db.usable) return this.db.settingRows();
    try {
      const txt = await fs.readFile(path.join(this.dataDir, SETTINGS_FILE), "utf-8");
      const parsed = JSON.parse(txt);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  async saveSettings(patch) {
    const merged = { ...await this.readSettings() };
    for (const [k, v] of Object.entries(patch)) {
      if (v === void 0) continue;
      merged[k] = v;
    }
    if (this.db.usable) {
      this.db.putSettings(merged);
      return merged;
    }
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const target = path.join(this.dataDir, SETTINGS_FILE);
      const tmp = target + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(merged, null, 2), "utf-8");
      await fs.rename(tmp, target);
    } catch {
    }
    return merged;
  }
  /** Close the SQLite handle (plugin deactivate). */
  dispose() {
    this.db.dispose();
  }
  async reloadPages(id) {
    try {
      return await this.harvest(id);
    } catch {
      return [];
    }
  }
};
function relPath(root, abs) {
  return path.relative(root, abs).replace(/\\/g, "/");
}
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}
function slugify(name2) {
  const cleaned = String(name2 || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return cleaned || "";
}
function sanitizeName(name2) {
  const cleaned = String(name2 || "document").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 160);
  return cleaned || "document";
}
function guessMime(name2) {
  const ext = name2.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

// src/retrieve.ts
var K1 = 1.2;
var B = 0.75;
var TITLE_REPEAT = 3;
var MAX_TEXT_TOKENS = 600;
var MAX_TAG_TOKENS = 16;
var DEFAULT_TOP_K = 5;
var MAX_TOP_K = 12;
var SNIPPET_CHARS = 700;
var CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/;
function isCjk(ch) {
  return CJK.test(ch);
}
function tokenize(text) {
  const out = [];
  const src = text.toLowerCase();
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (isCjk(ch)) {
      let j = i;
      while (j < src.length && isCjk(src[j])) j++;
      const run = src.slice(i, j);
      for (let k = 0; k < run.length; k++) {
        out.push(run[k]);
        if (k + 1 < run.length) out.push(run.slice(k, k + 2));
      }
      i = j;
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z0-9._+-]/.test(src[j])) j++;
      const word = src.slice(i, j).replace(/^[._+-]+|[._+-]+$/g, "");
      if (word) out.push(word);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}
function termFreq(tokens) {
  const tf = /* @__PURE__ */ new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}
function pageTokens(p) {
  const out = [];
  for (let i = 0; i < TITLE_REPEAT; i++) out.push(...tokenize(p.title));
  out.push(...tokenize(p.text).slice(0, MAX_TEXT_TOKENS));
  for (const t of p.tags.slice(0, MAX_TAG_TOKENS)) out.push(...tokenize(t));
  return out;
}
var WikiIndex = class {
  /** term -> postings carrying it. */
  postings = /* @__PURE__ */ new Map();
  /** projectId -> set of page ids currently indexed. */
  byProject = /* @__PURE__ */ new Map();
  /** pageId -> the posting we stored (single copy per page). */
  byPage = /* @__PURE__ */ new Map();
  avgLength = 0;
  version = 0;
  get revision() {
    return this.version;
  }
  get size() {
    let n = 0;
    for (const set of this.byProject.values()) n += set.size;
    return n;
  }
  /** Replace all pages of one project. */
  addProject(projectId, projectName, pages) {
    this.removeProject(projectId);
    const set = /* @__PURE__ */ new Set();
    for (const page of pages) {
      set.add(page.id);
      const tokens = pageTokens(page);
      const posting = {
        page,
        projectId,
        projectName,
        tf: termFreq(tokens),
        length: tokens.length
      };
      this.byPage.set(page.id, posting);
      for (const term of posting.tf.keys()) {
        const list = this.postings.get(term);
        if (list) list.push(posting);
        else this.postings.set(term, [posting]);
      }
    }
    this.byProject.set(projectId, set);
    this.recomputeAverage();
    this.version++;
  }
  removeProject(projectId) {
    const set = this.byProject.get(projectId);
    if (!set) return;
    for (const pageId of set) {
      const posting = this.byPage.get(pageId);
      if (!posting) continue;
      for (const term of posting.tf.keys()) {
        const list = this.postings.get(term);
        if (!list) continue;
        const next = list.filter((p) => p.page.id !== pageId);
        if (next.length) this.postings.set(term, next);
        else this.postings.delete(term);
      }
      this.byPage.delete(pageId);
    }
    this.byProject.delete(projectId);
    this.recomputeAverage();
    this.version++;
  }
  clear() {
    this.postings = /* @__PURE__ */ new Map();
    this.byProject = /* @__PURE__ */ new Map();
    this.avgLength = 0;
    this.version++;
  }
  recomputeAverage() {
    let total = 0;
    let n = 0;
    for (const list of this.postings.values()) {
      for (const p of list) {
        total += p.length;
        n++;
      }
    }
    this.avgLength = n > 0 ? total / n : 0;
  }
  search(query, opts = {}) {
    const qTokens = [...new Set(tokenize(query))];
    if (!qTokens.length) return [];
    const topK = Math.max(1, Math.min(opts.topK ?? DEFAULT_TOP_K, MAX_TOP_K));
    const N = Math.max(1, this.size);
    const scope = opts.projectId ? this.byProject.get(opts.projectId) : null;
    const scores = /* @__PURE__ */ new Map();
    for (const term of qTokens) {
      const list = this.postings.get(term);
      if (!list || !list.length) continue;
      const df = list.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      if (idf <= 0) continue;
      for (const p of list) {
        if (scope && !scope.has(p.page.id)) continue;
        const f = p.tf.get(term);
        const norm = 1 - B + B * (this.avgLength > 0 ? p.length / this.avgLength : 1);
        const contribution = idf * (f * (K1 + 1) / (f + K1 * norm));
        let hit = scores.get(p.page.id);
        if (!hit) {
          hit = { p, score: 0, terms: [] };
          scores.set(p.page.id, hit);
        }
        hit.score += contribution;
        hit.terms.push(term);
      }
    }
    if (!scores.size) return [];
    const ranked = [...scores.values()].sort((a, b) => b.score - a.score || a.p.page.title.localeCompare(b.p.page.title)).slice(0, topK);
    const best = ranked.length ? ranked[0].score : 1;
    return ranked.map((h) => ({
      projectId: h.p.projectId,
      projectName: h.p.projectName,
      page: h.p.page,
      score: best > 0 ? h.score / best : 0,
      matchedTerms: [...new Set(h.terms)].slice(0, 8),
      snippet: snippetOf(h.p.page, [...new Set(h.terms)])
    }));
  }
};
function snippetOf(page, terms = []) {
  const text = page.text ?? "";
  if (text.length <= SNIPPET_CHARS) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    if (t.length < 2) continue;
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  return (start > 0 ? "\u2026" : "") + text.slice(start, end).trim() + (end < text.length ? "\u2026" : "");
}

// src/wiki-tools.ts
var WIKI_PROJECTS_TOOL = "wiki_projects";
var WIKI_STATUS_TOOL = "wiki_status";
var WIKI_SEARCH_TOOL = "wiki_search";
var WIKI_READ_TOOL = "wiki_read";
var WIKI_DONE_TOOL = "wiki_done";
function defineTool(def) {
  return def;
}
var obj = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});
function defineWikiTools(deps) {
  const tools = [];
  tools.push(
    defineTool({
      name: WIKI_PROJECTS_TOOL,
      description: '\u5217\u51FA dsh-local-llm-wiki \u91CC\u6240\u6709\u77E5\u8BC6\u5E93\u9879\u76EE\uFF08\u540D\u79F0\u3001\u72B6\u6001\u3001\u9875\u9762\u6570\u3001\u66F4\u65B0\u65F6\u95F4\uFF09\u3002\u56DE\u7B54"\u6211\u6709\u54EA\u4E9B\u77E5\u8BC6\u5E93/\u67D0\u4E2A\u5E93\u53EB\u4EC0\u4E48"\u65F6\u5148\u7528\u5B83\u3002',
      parameters: obj({}),
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v ?? "") }]
      },
      isConcurrencySafe: () => true,
      execute: async () => {
        const list = deps.listProjects();
        if (!list.length) return JSON.stringify({ ok: true, projects: [], message: "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u77E5\u8BC6\u5E93\u9879\u76EE\u3002" });
        const lines = [`\u5171 ${list.length} \u4E2A\u77E5\u8BC6\u5E93\u9879\u76EE\uFF1A`, ""];
        for (const p of list) {
          lines.push(`- ${p.name}\uFF08id=${p.id}\uFF0C\u72B6\u6001=${p.status}\uFF0C\u9875\u9762=${p.pageCount}${p.domain ? "\uFF0C\u9886\u57DF\uFF1A" + p.domain : ""}\uFF0C\u66F4\u65B0=${p.updatedAt.slice(0, 10)}\uFF09`);
        }
        return JSON.stringify({ ok: true, count: list.length, text: lines.join("\n") });
      }
    })
  );
  tools.push(
    defineTool({
      name: WIKI_STATUS_TOOL,
      description: "\u67E5\u8BE2\u67D0\u4E2A\u77E5\u8BC6\u5E93\u9879\u76EE\u7684\u6784\u5EFA\u72B6\u6001\u4E0E\u8D28\u91CF\u8BA1\u6570\uFF08\u9875\u9762\u6570\u3001lint \u9519\u8BEF/\u544A\u8B66\u6570\u3001\u9519\u8BEF\u4FE1\u606F\uFF09\u3002",
      parameters: obj({ projectId: { type: "string", description: "\u9879\u76EE id\uFF08\u6765\u81EA wiki_projects\uFF09" } }, ["projectId"]),
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v ?? "") }]
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const id = String(args.projectId || "");
        if (!id) return JSON.stringify({ ok: false, error: "\u9700\u8981 projectId\u3002" });
        const p = deps.getProject(id);
        if (!p) return JSON.stringify({ ok: false, error: `\u627E\u4E0D\u5230\u9879\u76EE ${id}` });
        return JSON.stringify({
          ok: true,
          projectId: p.id,
          name: p.name,
          status: p.status,
          pageCount: p.pageCount,
          lint: p.lint ?? null,
          error: p.error ?? null
        });
      }
    })
  );
  tools.push(
    defineTool({
      name: WIKI_SEARCH_TOOL,
      description: "\u5728\u6240\u6709\uFF08\u6216\u6307\u5B9A\uFF09\u77E5\u8BC6\u5E93\u7684 wiki \u9875\u9762\u91CC\u505A\u5168\u6587\u68C0\u7D22\uFF0C\u8FD4\u56DE\u547D\u4E2D\u7684\u9875\u9762\u4E0E\u7247\u6BB5\u3002\u95EE\u77E5\u8BC6\u5E93\u76F8\u5173\u95EE\u9898\u65F6\u4F18\u5148\u7528\u5B83\u5B9A\u4F4D\u9875\u9762\uFF0C\u518D\u7528 wiki_read \u8BFB\u5168\u6587\u3002",
      parameters: obj({
        query: { type: "string", description: "\u81EA\u7136\u8BED\u8A00\u67E5\u8BE2" },
        projectId: { type: "string", description: "\u53EF\u9009\uFF1A\u9650\u5B9A\u67D0\u4E2A\u9879\u76EE id" },
        topK: { type: "number", description: "\u8FD4\u56DE\u6761\u6570\uFF0C\u9ED8\u8BA4 5\uFF0C\u6700\u591A 12" }
      }, ["query"]),
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v ?? "") }]
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const query = String(args.query || "").trim();
        if (!query) return JSON.stringify({ ok: false, error: "\u9700\u8981 query\u3002" });
        const hits = deps.search(query, {
          projectId: args.projectId ? String(args.projectId) : void 0,
          topK: typeof args.topK === "number" ? args.topK : void 0
        });
        if (!hits.length) return JSON.stringify({ ok: true, count: 0, message: `\u6CA1\u6709\u4E0E\u300C${query}\u300D\u76F8\u5173\u7684 wiki \u9875\u9762\u3002` });
        const lines = [`\u68C0\u7D22\u300C${query}\u300D\u547D\u4E2D ${hits.length} \u4E2A\u9875\u9762\uFF1A`, ""];
        hits.forEach((h, i) => {
          lines.push(`${i + 1}. ${h.page.title}\uFF08${h.projectName} \xB7 ${h.page.kind}\uFF09`);
          lines.push(`   - \u8BFB\u53D6\u8DEF\u5F84\uFF1AprojectId="${h.projectId}", path="${h.page.path}"`);
          if (h.page.tags.length) lines.push(`   - \u6807\u7B7E\uFF1A${h.page.tags.join("\u3001")}`);
          const body = (h.snippet || "").trim();
          if (body) for (const line of body.split("\n").slice(0, 4)) lines.push(`   > ${line}`);
          lines.push("");
        });
        lines.push("_\u53EA\u4F9D\u636E wiki \u9875\u9762\u4F5C\u7B54\uFF1B\u6CA1\u6709\u7684\u5185\u5BB9\u8BF7\u660E\u8BF4\uFF0C\u4E0D\u8981\u7F16\u9020\u3002\u9700\u8981\u5168\u6587\u8BF7\u7528 wiki_read\u3002_");
        return JSON.stringify({ ok: true, count: hits.length, text: lines.join("\n") });
      }
    })
  );
  tools.push(
    defineTool({
      name: WIKI_READ_TOOL,
      description: "\u6309 projectId + \u9875\u9762\u76F8\u5BF9\u8DEF\u5F84\u8BFB\u53D6\u67D0\u4E2A wiki \u9875\u9762\u7684\u5B8C\u6574 Markdown\uFF08\u68C0\u7D22\u547D\u4E2D\u540E\u7528\u5B83\u7684 path\uFF09\u3002",
      parameters: obj({
        projectId: { type: "string", description: "\u9879\u76EE id" },
        path: { type: "string", description: "\u9875\u9762\u76F8\u5BF9\u8DEF\u5F84\uFF08\u6765\u81EA wiki_search \u7684 path\uFF0C\u5982 entities/foo.md\uFF09" }
      }, ["projectId", "path"]),
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v ?? "") }]
      },
      isConcurrencySafe: () => true,
      execute: async (args) => {
        const projectId = String(args.projectId || "");
        const pagePath = String(args.path || "");
        if (!projectId || !pagePath) return JSON.stringify({ ok: false, error: "\u9700\u8981 projectId \u4E0E path\u3002" });
        const md = await deps.readPage(projectId, pagePath);
        if (md === null) return JSON.stringify({ ok: false, error: `\u627E\u4E0D\u5230\u9875\u9762 ${projectId}/${pagePath}` });
        return JSON.stringify({ ok: true, projectId, path: pagePath, markdown: md });
      }
    })
  );
  tools.push(
    defineTool({
      name: WIKI_DONE_TOOL,
      description: "\u7531\u6784\u5EFA wiki \u7684 DSH \u4F1A\u8BDD\u5728\u5B8C\u6210\u540E\u8C03\u7528\uFF0C\u628A <wiki>/ \u76EE\u5F55\u6536\u5272\u8FDB\u77E5\u8BC6\u5E93\u5E76\u5EFA\u7D22\u5F15\u3002\u53C2\u6570\u4E3A projectId \u4E0E wikiDir\u3002",
      parameters: obj({
        projectId: { type: "string", description: "\u9879\u76EE id\uFF08\u52A1\u5FC5\u4E0E\u63D0\u4EA4\u65F6\u4E00\u81F4\uFF09" },
        wikiDir: { type: "string", description: "\u521A\u5199\u5165\u9875\u9762\u7684 wiki \u76EE\u5F55\u7EDD\u5BF9\u8DEF\u5F84" }
      }, ["projectId", "wikiDir"]),
      output: {
        schema: { type: "string" },
        render: (_a, v) => [{ type: "text", text: String(v ?? "") }]
      },
      isConcurrencySafe: () => false,
      execute: async (args) => {
        const projectId = String(args.projectId || "");
        const wikiDir = String(args.wikiDir || "");
        if (!projectId || !wikiDir) {
          return JSON.stringify({ ok: false, error: "wiki_done \u9700\u8981 projectId \u4E0E wikiDir \u4E24\u4E2A\u53C2\u6570\u3002" });
        }
        try {
          const result = await deps.ingestDone(projectId, wikiDir);
          if (!result.ok) return JSON.stringify({ ok: false, error: result.error ?? "harvest \u5931\u8D25" });
          return JSON.stringify({ ok: true, pages: result.pages ?? 0, message: "\u77E5\u8BC6\u5E93\u5DF2\u66F4\u65B0\uFF0C\u73B0\u5728\u53EF\u4EE5\u68C0\u7D22\u4E86\u3002" });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    })
  );
  return tools;
}

// src/session-ingest.ts
import { promises as fs2 } from "node:fs";
import { appendFileSync } from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
function acquireSessionController(ctx, onReady) {
  const trace2 = (msg) => {
    try {
      appendFileSync(path2.join(os.homedir(), ".dsh", "dsh-local-llm-wiki-activation.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] [sessionController] ${msg}
`);
    } catch {
    }
  };
  trace2(`acquire called; ctxKeys=${ctx ? Object.getOwnPropertyNames(ctx).slice(0, 20).join(",") : "null"}`);
  const settle = (candidate) => {
    const ctrl = candidate;
    if (ctrl && typeof ctrl.create === "function" && typeof ctrl.prompt === "function") {
      onReady(ctrl);
    } else {
      trace2(`settle candidate invalid: ${candidate === void 0 ? "undefined" : typeof candidate}${ctrl ? ` create=${typeof ctrl.create} prompt=${typeof ctrl.prompt}` : ""}`);
    }
  };
  try {
    const reflect = ctx?.reflect;
    if (reflect && typeof reflect.get === "function") {
      let r1, r2;
      try {
        r1 = reflect.get("sessionController");
      } catch (e) {
        trace2(`reflect.get threw: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        r2 = reflect.get("sessionController", false);
      } catch (e) {
        trace2(`reflect.get(false) threw: ${e instanceof Error ? e.message : String(e)}`);
      }
      trace2(`reflect.get r1=${r1 === void 0 ? "undefined" : typeof r1} r2=${r2 === void 0 ? "undefined" : typeof r2}`);
      settle(r1);
      settle(r2);
    } else {
      trace2("reflect.get unavailable");
    }
  } catch {
  }
  if (!ctx?.inject) {
    trace2("ctx.inject missing \u2014 abort");
    return;
  }
  try {
    trace2('ctx.inject(["sessionController"], cb) registering');
    ctx.inject(["sessionController"], (sctx) => {
      trace2(`inject callback fired; sctxType=${sctx === void 0 ? "undefined" : typeof sctx}`);
      try {
        const ctrl = sctx?.sessionController;
        trace2(`sctx.sessionController=${ctrl === void 0 ? "undefined" : typeof ctrl} create=${typeof ctrl?.create} prompt=${typeof ctrl?.prompt}`);
        if (ctrl && typeof ctrl.create === "function" && typeof ctrl.prompt === "function") {
          onReady(ctrl);
          try {
            const presets = sctx?.permissionPresets;
            if (presets && typeof presets.set === "function") {
              permissionPresetsRef = presets;
              onPermissionPresets?.(presets);
            }
          } catch (e) {
            trace2(`permissionPresets read failed (expected when not injected): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch {
      }
    });
    trace2("ctx.inject registered without throwing");
  } catch (e) {
    trace2(`ctx.inject threw synchronously: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
}
var permissionPresetsRef;
var onPermissionPresets;
function setPermissionPresetsSink(fn) {
  onPermissionPresets = fn;
}
async function stageSourceIndex(rawDir, docs) {
  const lines = [];
  for (const d of docs) {
    try {
      await fs2.stat(path2.join(rawDir, d.name));
      lines.push(`- raw/${d.name}`);
    } catch {
      lines.push(`- raw/${d.name}\uFF08\u7F3A\u5931\uFF0C\u8BF7\u8DF3\u8FC7\uFF09`);
    }
  }
  return lines.join("\n");
}
function withSkill(skillText, task) {
  if (!skillText || !skillText.trim()) return task;
  return [
    `\u4EE5\u4E0B\u662F\u4F60\u5FC5\u987B\u5B8C\u6574\u9075\u5FAA\u7684 llm-wiki \u6280\u80FD\u8BF4\u660E\uFF08\u5185\u7F6E\uFF0C\u52FF\u4F9D\u8D56\u5916\u90E8\u6280\u80FD\u76EE\u5F55\uFF09\uFF1A`,
    ``,
    `<llm-wiki-skill>`,
    skillText.trim(),
    `</llm-wiki-skill>`,
    ``,
    `---`,
    ``,
    task
  ].join("\n");
}
async function submitDesign(args) {
  const rawDir = path2.join(args.projectDir, "raw");
  const listing = await stageSourceIndex(rawDir, args.rawDocs);
  const prompt = withSkill(args.skillText, buildDesignPrompt(args, listing));
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki \u8BBE\u8BA1 \xB7 ${args.projectName}`,
    prompt,
    signal: args.signal
  });
}
async function submitIngest(args) {
  const rawDir = path2.join(args.projectDir, "raw");
  const listing = await stageSourceIndex(rawDir, args.rawDocs);
  const doneTool = args.doneTool ?? "wiki_done";
  const prompt = withSkill(args.skillText, buildIngestPrompt(args, listing, doneTool));
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki \u6784\u5EFA \xB7 ${args.projectName}`,
    prompt,
    signal: args.signal
  });
}
async function submitLintFix(args) {
  const doneTool = args.doneTool ?? "wiki_done";
  const prompt = withSkill(args.skillText, buildLintFixPrompt(args, args.lintReport, doneTool));
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki lint \u4FEE\u590D \xB7 ${args.projectName}`,
    prompt,
    signal: args.signal
  });
}
function buildLintFixPrompt(args, lintReport, doneTool) {
  return [
    `\u4F60\u662F\u77E5\u8BC6\u5E93\u7EF4\u62A4\u52A9\u624B\u3002\u4E0B\u9762\u662F\u5BF9\u8BE5\u9879\u76EE wiki \u76EE\u5F55\u7684 lint \u68C0\u67E5\u62A5\u544A\uFF0C\u8BF7\u6309 llm-wiki \u6280\u80FD\u7684 wiki-lint / wiki-update \u65B9\u6CD5\u4FEE\u590D\u6240\u6709 error \u7EA7\u95EE\u9898\uFF08warn \u7EA7\u5C3D\u529B\u5904\u7406\uFF09\u3002`,
    ``,
    `\u9879\u76EE\u540D\uFF1A${args.projectName}`,
    `wiki \u76EE\u5F55\uFF1A${args.wikiDir}`,
    ``,
    `lint \u62A5\u544A\uFF1A`,
    lintReport,
    ``,
    `\u4FEE\u590D\u8981\u6C42\uFF1A`,
    `1. \u300C\u94FE\u63A5\u6307\u5411\u4E0D\u5B58\u5728\u7684\u9875\u9762\u300D\uFF1A\u4F18\u5148\u8865\u5EFA\u7F3A\u5931\u7684\u76EE\u6807\u9875\u9762\uFF08\u6309 llm-wiki \u9875\u9762\u89C4\u8303\uFF0C\u5E26 YAML frontmatter\uFF0C\u5185\u5BB9\u57FA\u4E8E raw/ \u6E90\u6587\u6863\u64B0\u5199\uFF1B\u82E5\u8BE5\u4E3B\u9898\u5728\u6E90\u6587\u6863\u4E2D\u4E0D\u5B58\u5728\uFF0C\u5219\u628A\u5F15\u7528\u9875\u7684\u94FE\u63A5\u6539\u4E3A\u6307\u5411\u5DF2\u6709\u9875\u9762\u6216\u53BB\u6389\u94FE\u63A5\uFF09\uFF1B`,
    `2. \u300C\u9875\u9762\u7F3A\u5C11\u6807\u9898\u300D\u300C\u5B64\u7ACB\u9875\u9762\u300D\uFF1A\u8865 frontmatter title\uFF0C\u6216\u5728 index.md \u4E2D\u4E3A\u5B64\u7ACB\u9875\u9762\u5EFA\u7ACB\u5165\u53E3\u94FE\u63A5\uFF1B`,
    `3. \u4E0D\u8981\u6539\u52A8\u4E0E\u95EE\u9898\u65E0\u5173\u7684\u9875\u9762\uFF1B\u4E0D\u8981\u5220\u9664 SCHEMA.md / log.md / index.md\uFF1B`,
    `4. \u4FEE\u590D\u5B8C\u6210\u540E\u81EA\u67E5\u4E00\u904D\u94FE\u63A5\u5B8C\u6574\u6027\uFF0C\u7136\u540E\u8C03\u7528\u5DE5\u5177 ${doneTool} \u56DE\u5199\u7ED3\u679C\uFF0C\u53C2\u6570\u4E3A\uFF1A`,
    `- projectId: "${args.projectId}"`,
    `- wikiDir: "${args.wikiDir}"`,
    `\u53EA\u6709\u5728\u8C03\u7528\u8BE5\u5DE5\u5177\u540E\uFF0C\u4FEE\u590D\u624D\u7B97\u5B8C\u6210\u3002`
  ].filter(Boolean).join("\n");
}
async function submitBuild(args) {
  const rawDir = path2.join(args.projectDir, "raw");
  const listing = await stageSourceIndex(rawDir, args.rawDocs);
  const doneTool = args.doneTool ?? "wiki_done";
  const prompt = withSkill(args.skillText, buildFullBuildPrompt(args, listing, doneTool));
  return submit(args.controller, {
    cwd: args.projectDir,
    agentPreset: args.agentPreset,
    workspaceId: args.workspaceId,
    modelSelection: args.modelSelection,
    permissionPreset: args.permissionPreset,
    title: `dsh-local-llm-wiki \u6784\u5EFA \xB7 ${args.projectName}`,
    prompt,
    signal: args.signal
  });
}
async function submit(controller, opts) {
  const createReq = {};
  if (opts.agentPreset) createReq.agentPreset = opts.agentPreset;
  if (opts.workspaceId) createReq.workspaceId = opts.workspaceId;
  else createReq.cwd = opts.cwd;
  const session = await controller.create(createReq);
  const sessionId = String(session?.sessionId ?? session?.id ?? "");
  if (!sessionId) throw new Error("sessionController.create returned no session id");
  if (opts.modelSelection?.provider && opts.modelSelection?.model) {
    try {
      await controller.selectModel?.({
        sessionId,
        provider: opts.modelSelection.provider,
        model: opts.modelSelection.model
      });
    } catch {
    }
  }
  if (opts.permissionPreset) {
    try {
      const presets = controller?.permissionPresets ?? permissionPresetsRef;
      const target = session?.session ?? session?.agent?.session ?? session;
      if (presets && typeof presets.set === "function" && target) presets.set(target, opts.permissionPreset);
    } catch {
    }
  }
  try {
    await controller.rename({ sessionId, title: opts.title });
  } catch {
  }
  await controller.prompt(
    {
      requestId: randomUUID2(),
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: opts.prompt }],
      clientTimeZone: tz()
    },
    opts.signal
  );
  return { sessionId };
}
function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function buildDesignPrompt(args, listing) {
  return [
    `\u4F60\u662F\u77E5\u8BC6\u5E93\u6784\u5EFA\u52A9\u624B\u3002\u8BF7\u52A0\u8F7D\u5E76\u4F7F\u7528 llm-wiki \u6280\u80FD\uFF0C\u4E3A\u4E0B\u9762\u8FD9\u4E2A\u9879\u76EE\u6267\u884C wiki-design \u65B9\u6CD5\uFF08\u53EA\u505A\u8BBE\u8BA1\uFF0C\u4E0D\u8981\u6784\u5EFA\u9875\u9762\uFF09\u3002`,
    ``,
    `\u9879\u76EE\u540D\uFF1A${args.projectName}`,
    args.domain ? `\u9886\u57DF\u8BF4\u660E\uFF1A${args.domain}` : ``,
    `\u5DE5\u4F5C\u76EE\u5F55\uFF08cwd\uFF09\uFF1A${args.projectDir}`,
    `wiki \u8F93\u51FA\u76EE\u5F55\uFF1A${args.wikiDir}`,
    ``,
    `\u539F\u59CB\u6587\u6863\u4F4D\u4E8E raw/ \u4E0B\uFF1A`,
    listing,
    ``,
    `\u4EFB\u52A1\uFF1A`,
    `1. \u9605\u8BFB raw/ \u6587\u6863\u6E05\u5355\u4E0E\u62BD\u6837\u5185\u5BB9\uFF0C\u6309 llm-wiki \u7684 wiki-design \u601D\u7EF4\u6846\u67B6\u786E\u5B9A\u7528\u6237\u753B\u50CF / \u5B9E\u4F53\u8FB9\u754C / \u4EA4\u53C9\u6982\u5FF5 / \u9AD8\u9891\u67E5\u8BE2\uFF1B`,
    `2. \u9009\u5B9A\u76EE\u5F55\u7ED3\u6784\uFF08\u63A8\u8350\u4F53\u7CFB A\uFF1Aentities/ + concepts/ + comparisons/ + queries/\uFF09\uFF1B`,
    `3. \u628A\u8BBE\u8BA1\u7ED3\u679C\u5199\u6210\u4E00\u4EFD SCHEMA.md \u8349\u7A3F\uFF0C\u8DEF\u5F84\uFF1A${path2.join(args.wikiDir, "SCHEMA.md")}\u3002`,
    ``,
    `\u4E25\u683C\u8981\u6C42\uFF1A`,
    `- \u53EA\u5728 wiki \u8F93\u51FA\u76EE\u5F55\u5185\u5199 SCHEMA.md\uFF0C\u4E0D\u8981\u751F\u6210\u4EFB\u4F55\u9875\u9762\u3001\u4E0D\u8981\u8FD0\u884C ingest\uFF1B`,
    `- SCHEMA.md \u662F\u8BE5\u77E5\u8BC6\u5E93\u552F\u4E00\u7684\u914D\u7F6E\u6765\u6E90\uFF1B`,
    `- \u4E0D\u8981\u8C03\u7528\u4EFB\u4F55"\u6784\u5EFA\u5B8C\u6210"\u7C7B\u5DE5\u5177\u2014\u2014\u672C\u6B21\u53EA\u662F\u8BBE\u8BA1\uFF0C\u8349\u7A3F\u4F1A\u4EA4\u56DE\u4EBA\u5DE5\u786E\u8BA4\u3002`,
    `\u5B8C\u6210\u540E\u7528\u4E00\u53E5\u8BDD\u8BF4\u660E\u4F60\u5199\u5165\u7684 SCHEMA.md \u8DEF\u5F84\u4E0E\u8BBE\u8BA1\u8981\u70B9\u5373\u53EF\u3002`
  ].filter(Boolean).join("\n");
}
function buildIngestPrompt(args, listing, doneTool) {
  return [
    `\u4F60\u662F\u77E5\u8BC6\u5E93\u6784\u5EFA\u52A9\u624B\u3002\u8BF7\u52A0\u8F7D\u5E76\u4F7F\u7528 llm-wiki \u6280\u80FD\uFF0C\u4E3A\u4E0B\u9762\u8FD9\u4E2A\u9879\u76EE\u6267\u884C wiki-init + wiki-ingest\uFF0C\u628A raw/ \u91CC\u7684\u6E90\u6587\u6863\u7F16\u8BD1\u6210\u7ED3\u6784\u5316 wiki \u9875\u9762\u3002`,
    ``,
    `\u9879\u76EE\u540D\uFF1A${args.projectName}`,
    `wiki \u8F93\u51FA\u76EE\u5F55\uFF1A${args.wikiDir}`,
    `\uFF08\u8BE5\u76EE\u5F55\u4E0B\u5DF2\u6709\u786E\u8BA4\u8FC7\u7684 SCHEMA.md\uFF0C\u8BF7\u4EE5\u5B83\u4E3A\u51C6\uFF0C\u4E0D\u8981\u6539\u5199\u5B83\u3002\uFF09`,
    ``,
    `\u672C\u6B21\u8981\u5904\u7406\u7684\u539F\u59CB\u6587\u6863\uFF08raw/ \u4E0B\uFF09\uFF1A`,
    listing,
    ``,
    `\u4EFB\u52A1\uFF08\u4E25\u683C\u6309 llm-wiki \u7684 ingest-workflow \u6267\u884C\uFF09\uFF1A`,
    `1. \u82E5\u5C1A\u65E0\u9AA8\u67B6\uFF0C\u6309 SCHEMA.md \u8FD0\u884C wiki-init\uFF0C\u5EFA\u7ACB index.md / log.md \u4E0E\u5B50\u76EE\u5F55\uFF1B`,
    `2. \u8FD0\u884C wiki-ingest\uFF0C\u628A\u4E0A\u9762\u6BCF\u7BC7\u6E90\u6587\u6863\u7F16\u8BD1\u8FDB\uFF1A`,
    `   - entities/  \u5B9E\u4F53\u9875\uFF08\u6982\u5FF5\u3001\u7EC4\u4EF6\u3001\u4EBA\u7269\u3001\u4EA7\u54C1\u7B49\uFF09`,
    `   - concepts/  \u6982\u5FF5\u9875\uFF08\u5B9A\u4E49\u4E0E\u65B9\u6CD5\uFF09`,
    `   - comparisons/ \u5BF9\u6BD4\u9875\uFF08\u5982\u6709\u53EF\u5BF9\u6BD4\u5BF9\u8C61\uFF09`,
    `   - queries/   \u5E38\u89C1\u68C0\u7D22\u95EE\u9898\u9875\uFF08\u53EF\u9009\uFF09`,
    `   \u5E76\u5728 index.md \u5EFA\u7ACB\u603B\u89C8\u4E0E\u94FE\u63A5\uFF1B`,
    `3. \u6BCF\u4E2A\u9875\u9762\u90FD\u5E26 YAML frontmatter\uFF08title / tags / sources / updated / confidence / aliases / related\uFF09\uFF0C\u6B63\u6587\u7528 Markdown\uFF1B`,
    `4. \u6240\u6709\u4EA7\u51FA\u5FC5\u987B\u843D\u5728 wiki \u8F93\u51FA\u76EE\u5F55\u5185\uFF0C\u4EFB\u4F55\u7F13\u5B58/\u4E2D\u95F4\u6587\u4EF6\u5199\u8FDB\u8BE5\u76EE\u5F55\u7684 .ingest-cache/\uFF0C\u6839\u76EE\u5F55\u4E0D\u5F97\u7559\u4E0B\u4E34\u65F6\u811A\u672C\u6216\u6E38\u79BB\u6587\u4EF6\u3002`,
    ``,
    `\u5B8C\u6210\u540E\uFF0C\u5FC5\u987B\u8C03\u7528\u5DE5\u5177 ${doneTool} \u56DE\u5199\u7ED3\u679C\uFF0C\u53C2\u6570\u4E3A\uFF1A`,
    `- projectId: "${args.projectId}"\uFF08\u52A1\u5FC5\u4E0E\u4E0A\u9762\u4E00\u81F4\uFF09`,
    `- wikiDir: "${args.wikiDir}"\uFF08\u4F60\u521A\u521A\u5199\u5165\u9875\u9762\u7684\u76EE\u5F55\uFF09`,
    `\u53EA\u6709\u5728\u8C03\u7528\u8BE5\u5DE5\u5177\u540E\uFF0C\u77E5\u8BC6\u5E93\u624D\u7B97\u6784\u5EFA\u5B8C\u6210\u3002\u4E0D\u8981\u5728\u4E0D\u8C03\u7528\u8BE5\u5DE5\u5177\u7684\u60C5\u51B5\u4E0B\u7ED3\u675F\u3002`
  ].filter(Boolean).join("\n");
}
function buildFullBuildPrompt(args, listing, doneTool) {
  return [
    `\u4F60\u662F\u77E5\u8BC6\u5E93\u6784\u5EFA\u52A9\u624B\u3002\u8BF7\u52A0\u8F7D\u5E76\u4F7F\u7528 llm-wiki \u6280\u80FD\uFF0C\u4E3A\u4E0B\u9762\u8FD9\u4E2A\u9879\u76EE\u5728\u4E00\u4E2A\u4F1A\u8BDD\u5185\u8FDE\u7EED\u5B8C\u6210 \u8BBE\u8BA1\uFF08wiki-design\uFF09\u4E0E \u6784\u5EFA\uFF08wiki-init + wiki-ingest\uFF09\u4E24\u4E2A\u9636\u6BB5\u3002`,
    ``,
    `\u9879\u76EE\u540D\uFF1A${args.projectName}`,
    args.domain ? `\u9886\u57DF\u8BF4\u660E\uFF1A${args.domain}` : ``,
    `\u5DE5\u4F5C\u76EE\u5F55\uFF08cwd\uFF09\uFF1A${args.projectDir}`,
    `wiki \u8F93\u51FA\u76EE\u5F55\uFF1A${args.wikiDir}`,
    ``,
    `\u539F\u59CB\u6587\u6863\u4F4D\u4E8E raw/ \u4E0B\uFF1A`,
    listing,
    ``,
    `\u7B2C\u4E00\u9636\u6BB5\uFF08\u8BBE\u8BA1\uFF09\uFF1A`,
    `1. \u9605\u8BFB raw/ \u6587\u6863\u6E05\u5355\u4E0E\u62BD\u6837\u5185\u5BB9\uFF0C\u6309 llm-wiki \u7684 wiki-design \u601D\u7EF4\u6846\u67B6\u786E\u5B9A\u7528\u6237\u753B\u50CF / \u5B9E\u4F53\u8FB9\u754C / \u4EA4\u53C9\u6982\u5FF5 / \u9AD8\u9891\u67E5\u8BE2\uFF1B`,
    `2. \u628A\u8BBE\u8BA1\u7ED3\u679C\u5199\u6210 SCHEMA.md \u8349\u7A3F\uFF0C\u8DEF\u5F84\uFF1A${path2.join(args.wikiDir, "SCHEMA.md")}\u3002`,
    ``,
    `\u7B2C\u4E8C\u9636\u6BB5\uFF08\u6784\u5EFA\uFF0C\u7D27\u63A5\u7B2C\u4E00\u9636\u6BB5\uFF0C\u4E0D\u8981\u7B49\u5F85\u4EFB\u4F55\u786E\u8BA4\uFF09\uFF1A`,
    `1. \u4EE5\u4F60\u521A\u5199\u5165\u7684 SCHEMA.md \u4E3A\u51C6\u8FD0\u884C wiki-init\uFF0C\u5EFA\u7ACB index.md / log.md \u4E0E\u5B50\u76EE\u5F55\uFF1B`,
    `2. \u8FD0\u884C wiki-ingest\uFF0C\u628A raw/ \u91CC\u6BCF\u7BC7\u6E90\u6587\u6863\u7F16\u8BD1\u8FDB entities/ concepts/ comparisons/ queries/\uFF0C\u5E76\u5728 index.md \u5EFA\u7ACB\u603B\u89C8\u4E0E\u94FE\u63A5\uFF1B`,
    `3. \u6BCF\u4E2A\u9875\u9762\u90FD\u5E26 YAML frontmatter\uFF08title / tags / sources / updated / confidence / aliases / related\uFF09\uFF0C\u6B63\u6587\u7528 Markdown\uFF1B`,
    `4. \u6240\u6709\u4EA7\u51FA\u5FC5\u987B\u843D\u5728 wiki \u8F93\u51FA\u76EE\u5F55\u5185\uFF0C\u4EFB\u4F55\u7F13\u5B58/\u4E2D\u95F4\u6587\u4EF6\u5199\u8FDB\u8BE5\u76EE\u5F55\u7684 .ingest-cache/\uFF0C\u6839\u76EE\u5F55\u4E0D\u5F97\u7559\u4E0B\u4E34\u65F6\u811A\u672C\u6216\u6E38\u79BB\u6587\u4EF6\u3002`,
    ``,
    `\u5B8C\u6210\u540E\uFF0C\u5FC5\u987B\u8C03\u7528\u5DE5\u5177 ${doneTool} \u56DE\u5199\u7ED3\u679C\uFF0C\u53C2\u6570\u4E3A\uFF1A`,
    `- projectId: "${args.projectId}"\uFF08\u52A1\u5FC5\u4E0E\u4E0A\u9762\u4E00\u81F4\uFF09`,
    `- wikiDir: "${args.wikiDir}"\uFF08\u4F60\u521A\u521A\u5199\u5165\u9875\u9762\u7684\u76EE\u5F55\uFF09`,
    `\u53EA\u6709\u5728\u8C03\u7528\u8BE5\u5DE5\u5177\u540E\uFF0C\u77E5\u8BC6\u5E93\u624D\u7B97\u6784\u5EFA\u5B8C\u6210\u3002\u4E0D\u8981\u5728\u4E0D\u8C03\u7528\u8BE5\u5DE5\u5177\u7684\u60C5\u51B5\u4E0B\u7ED3\u675F\u3002`
  ].filter(Boolean).join("\n");
}

// src/lint.ts
import path3 from "node:path";
var MD_LINK = /\[[^\]]*\]\(([^)]+\.md)(#[^)]*)?\)/g;
function lintPages(pages) {
  const issues = [];
  const present = /* @__PURE__ */ new Set();
  for (const p of pages) {
    present.add(normalize(p.path));
  }
  const inbound = /* @__PURE__ */ new Map();
  for (const p of pages) {
    if (!p.title || p.title.trim() === "" || /\.(md|markdown)$/i.test(p.title)) {
      issues.push({ severity: "warn", message: `\u9875\u9762\u7F3A\u5C11\u6807\u9898`, page: p.path });
    }
    let m;
    MD_LINK.lastIndex = 0;
    const text = p.text ?? "";
    while (m = MD_LINK.exec(text)) {
      const target = resolveLink(p.path, m[1]);
      if (target && !present.has(target)) {
        issues.push({ severity: "error", message: `\u94FE\u63A5\u6307\u5411\u4E0D\u5B58\u5728\u7684\u9875\u9762 ${m[1]}`, page: p.path });
      } else if (target) {
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
      }
    }
  }
  for (const p of pages) {
    if (p.kind === "index") continue;
    const count = inbound.get(normalize(p.path)) ?? 0;
    if (count === 0) {
      issues.push({ severity: "warn", message: `\u5B64\u7ACB\u9875\u9762\uFF08\u6CA1\u6709\u4EFB\u4F55\u9875\u9762\u94FE\u63A5\u5230\u5B83\uFF09`, page: p.path });
    }
  }
  return {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    errorCount: issues.filter((i) => i.severity === "error").length,
    warnCount: issues.filter((i) => i.severity === "warn").length,
    issues
  };
}
function normalize(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
function resolveLink(fromPath, link) {
  if (link.startsWith("http://") || link.startsWith("https://") || link.startsWith("/")) return null;
  const cleaned = link.replace(/^\.\//, "");
  const dir = path3.posix.dirname(normalize(fromPath));
  const abs = path3.posix.normalize(path3.posix.join(dir, cleaned));
  return abs;
}

// src/index.ts
var name = "dsh-local-llm-wiki";
var inject = [];
var DEFAULT_CONFIG = {
  dataDir: "",
  ingestAgentPreset: "",
  ingestPermissionPreset: "auto",
  ingestWorkspaceId: "",
  ingestModel: "",
  apiPort: 18781
};
function resolveConfig(config, profileDataDir) {
  const apiPort = Number(config?.apiPort ?? DEFAULT_CONFIG.apiPort);
  const ingestAgentPreset = (config?.ingestAgentPreset ?? DEFAULT_CONFIG.ingestAgentPreset) || "";
  const ingestPermissionPreset = (config?.ingestPermissionPreset ?? DEFAULT_CONFIG.ingestPermissionPreset) || "";
  const ingestWorkspaceId = (config?.ingestWorkspaceId ?? DEFAULT_CONFIG.ingestWorkspaceId) || "";
  const ingestModel = (config?.ingestModel ?? DEFAULT_CONFIG.ingestModel) || "";
  let dataDir = ((config?.dataDir ?? DEFAULT_CONFIG.dataDir) || "").trim();
  if (!dataDir) {
    if (profileDataDir && profileDataDir.trim()) {
      dataDir = path4.join(profileDataDir.trim(), "dsh-local-llm-wiki");
    } else {
      dataDir = path4.join(os2.homedir(), ".dsh", "dsh-local-llm-wiki");
    }
  }
  return {
    dataDir,
    ingestAgentPreset,
    ingestPermissionPreset,
    ingestWorkspaceId,
    ingestModel,
    apiPort: Number.isFinite(apiPort) && apiPort > 0 ? apiPort : DEFAULT_CONFIG.apiPort
  };
}
function parseModelSelection(s) {
  const idx = s.indexOf("/");
  if (idx <= 0 || idx === s.length - 1) return void 0;
  return { provider: s.slice(0, idx), model: s.slice(idx + 1) };
}
var API_PREFIX = "/wiki-api";
var TRACE_FILE = path4.join(os2.homedir(), ".dsh", "dsh-local-llm-wiki-activation.log");
function trace(msg, error) {
  try {
    const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}${error ? ` | ${error instanceof Error ? `${error.name}: ${error.message}
${error.stack ?? ""}` : String(error)}` : ""}
`;
    appendFileSync2(TRACE_FILE, line);
  } catch {
  }
}
function apply(ctx, config) {
  trace(`apply called; config=${JSON.stringify(config ?? null)}`);
  try {
    activate(ctx, config);
    trace("activate returned");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace(`activation degraded: ${message}`, error);
    try {
      ctx.logger?.warn?.(`[dsh-local-llm-wiki] activation degraded: ${message}`);
    } catch {
    }
  }
}
function activate(ctx, config) {
  let profileDataDir;
  try {
    const p = ctx.getConfigPath?.();
    if (typeof p === "string" && p.trim()) profileDataDir = p.trim();
  } catch {
    profileDataDir = void 0;
  }
  const resolved = resolveConfig(config, profileDataDir);
  trace(`activate start; resolved=${JSON.stringify(resolved)}`);
  const logger = ctx.logger ?? void 0;
  const logInfo = (m) => logger?.info?.(`[dsh-local-llm-wiki] ${m}`);
  const logWarn = (m) => logger?.warn?.(`[dsh-local-llm-wiki] ${m}`);
  const logErr = (m) => logger?.error?.(`[dsh-local-llm-wiki] ${m}`);
  const store = new ProjectStore(resolved.dataDir);
  const index = new WikiIndex();
  let sessionController;
  let llmService;
  let workspaceRegistry;
  void (async () => {
    await store.load();
    try {
      await store.loadSettingsInto(resolved);
      const s = await store.readSettings();
      if (s.ingestWorkspaceId !== void 0 || s.ingestModel !== void 0) {
        logInfo(`\u5DF2\u6062\u590D\u6301\u4E45\u5316\u8BBE\u7F6E: workspace=${s.ingestWorkspaceId ?? "(\u9ED8\u8BA4)"} model=${s.ingestModel ?? "(\u9ED8\u8BA4)"}`);
      }
    } catch (e) {
      logWarn(`\u6062\u590D\u6301\u4E45\u5316\u8BBE\u7F6E\u5931\u8D25\uFF08\u4F7F\u7528\u5BBF\u4E3B\u914D\u7F6E\uFF09: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const p of store.list()) {
      if (p.status === "designing") {
        try {
          const schema = await store.readSchema(p.id);
          if (schema) {
            await store.updateProject(p.id, { status: "awaiting-schema-confirm", schemaDraft: schema });
            continue;
          }
        } catch {
        }
      }
    }
    const stalled = await store.markStalled();
    if (stalled.length) logWarn(`\u5DF2\u6807\u8BB0 ${stalled.length} \u4E2A\u4E2D\u65AD\u7684\u9879\u76EE\u4E3A failed`);
    for (const p of store.list()) {
      if (p.pageCount > 0) {
        try {
          const pages = await store.harvest(p.id);
          const docs = await store.scanRaw(p.id);
          void docs;
          index.addProject(p.id, p.name, pages);
          store.setLint(p.id, lintPages(pages));
        } catch (err) {
          logErr(`reindex ${p.id} \u5931\u8D25: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    logInfo(`\u5DF2\u5C31\u7EEA\uFF0C\u6570\u636E\u76EE\u5F55 ${resolved.dataDir}`);
  })();
  acquireSessionController(ctx, (ctrl) => {
    sessionController = ctrl;
    trace(`sessionController assigned; create=${typeof ctrl.create} prompt=${typeof ctrl.prompt}`);
    logInfo("\u5DF2\u63A5\u5165 sessionController\uFF0C\u53EF\u63D0\u4EA4 design / ingest \u4F1A\u8BDD");
  });
  setPermissionPresetsSink((presets) => {
    logInfo("\u5DF2\u63A5\u5165 permissionPresets\uFF08Auto review \u4F1A\u8BDD\u9884\u8BBE\u53EF\u7528\uFF09");
  });
  try {
    ctx.inject(["llm"], (sctx) => {
      const l = sctx?.llm;
      if (l && typeof l.listProviders === "function") llmService = l;
    });
  } catch {
  }
  try {
    ctx.inject(["workspaceRegistry"], (sctx) => {
      const w = sctx?.workspaceRegistry;
      if (w && typeof w.list === "function") workspaceRegistry = w;
    });
  } catch {
  }
  let builtinSkill = "";
  try {
    const here = path4.dirname(fileURLToPath(import.meta.url));
    builtinSkill = readFileSync2(path4.join(here, "skills", "llm-wiki.md"), "utf-8");
    logInfo(`\u5DF2\u5185\u7F6E llm-wiki \u6280\u80FD\uFF08${builtinSkill.length} \u5B57\u7B26\uFF0C\u5C06\u6CE8\u5165\u6784\u5EFA\u4F1A\u8BDD\uFF09`);
    try {
      const skillsRoot = path4.join(os2.homedir(), ".dsh", "skills", "llm-wiki");
      const skillFile = path4.join(skillsRoot, "SKILL.md");
      let existing = "";
      try {
        existing = readFileSync2(skillFile, "utf-8");
      } catch {
      }
      if (existing !== builtinSkill) {
        mkdirSync2(skillsRoot, { recursive: true });
        writeFileSync(skillFile, builtinSkill, "utf-8");
        logInfo(`\u5DF2\u5C06\u5185\u7F6E llm-wiki \u6280\u80FD\u6CE8\u518C\u5230\u5BBF\u4E3B\u6280\u80FD\u76EE\u5F55: ${skillFile}`);
      }
    } catch (e) {
      logWarn(`llm-wiki \u6280\u80FD\u6CE8\u518C\u5230\u5BBF\u4E3B\u6280\u80FD\u76EE\u5F55\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u63D2\u4EF6\u529F\u80FD\uFF09: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    logWarn(`\u5185\u7F6E llm-wiki \u6280\u80FD\u8BFB\u53D6\u5931\u8D25\uFF0C\u4F1A\u8BDD\u5C06\u56DE\u9000\u4E3A\u63D0\u793A\u8BCD\u81EA\u8FF0: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tools = defineWikiTools({
    listProjects: () => store.list().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      pageCount: p.pageCount,
      domain: p.domain,
      updatedAt: p.updatedAt
    })),
    getProject: (id) => {
      const p = store.get(id);
      if (!p) return void 0;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        pageCount: p.pageCount,
        lint: p.lint ? { errorCount: p.lint.errorCount, warnCount: p.lint.warnCount } : null,
        error: p.error
      };
    },
    search: (query, opts) => {
      const hits = index.search(query, { projectId: opts.projectId, topK: opts.topK });
      return hits.map((h) => ({
        projectId: h.projectId,
        projectName: h.projectName,
        page: {
          id: h.page.id,
          path: h.page.path,
          kind: h.page.kind,
          title: h.page.title,
          tags: h.page.tags
        },
        score: h.score,
        snippet: h.snippet
      }));
    },
    readPage: (projectId, pagePath) => store.readPage(projectId, pagePath),
    ingestDone: async (projectId, wikiDir) => {
      try {
        const pages = await store.harvest(projectId, wikiDir);
        const p = store.get(projectId);
        if (!p) return { ok: false, error: `\u627E\u4E0D\u5230\u9879\u76EE ${projectId}` };
        index.addProject(projectId, p.name, pages);
        store.setLint(projectId, lintPages(pages));
        await store.updateProject(projectId, { status: "ready", error: void 0 });
        return { ok: true, pages: pages.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await store.updateProject(projectId, { status: "failed", error: msg });
        return { ok: false, error: msg };
      }
    }
  });
  try {
    trace("injecting [tools]");
    ctx.inject(["tools"], (tctx) => {
      try {
        const registry = tctx?.tools;
        if (!registry || typeof registry.register !== "function") return;
        for (const t of tools) registry.register(t);
        trace(`registered ${tools.length} tools`);
        logInfo("wiki_* \u5DE5\u5177\u5DF2\u6CE8\u518C");
      } catch (e) {
        logWarn(`wiki_* \u5DE5\u5177\u6CE8\u518C\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  } catch (e) {
    trace('ctx.inject(["tools"]) failed', e);
    logWarn('ctx.inject(["tools"]) \u4E0D\u53EF\u7528\uFF0Cwiki_* \u5DE5\u5177\u672A\u6CE8\u518C\uFF08\u4EC5 API \u53EF\u7528\uFF09');
  }
  const deps = {
    store,
    index,
    resolved,
    getSession: () => sessionController,
    getLlm: () => llmService,
    getWorkspaces: () => workspaceRegistry,
    // Settings-page writes mutate the module-level runtime config so every
    // later submit picks them up without restarting DSH (persistence in the
    // profile config file is a host-owned concern; the runtime copy is the
    // source of truth within this process).
    saveSettings: (patch) => {
      if (patch.ingestWorkspaceId !== void 0) resolved.ingestWorkspaceId = patch.ingestWorkspaceId.trim();
      if (patch.ingestModel !== void 0) resolved.ingestModel = patch.ingestModel.trim();
      void store.saveSettings({
        ingestWorkspaceId: patch.ingestWorkspaceId?.trim(),
        ingestModel: patch.ingestModel?.trim()
      });
      return resolved;
    },
    logInfo,
    logWarn,
    logErr,
    submitDesign: async (projectId) => {
      const ctrl = sessionController;
      if (!ctrl) throw new Error("\u672C profile \u65E0 sessionController\uFF0Cdesign \u4E0D\u53EF\u7528");
      const p = store.get(projectId);
      if (!p) throw new Error("project not found");
      const rawDocs = await store.scanRaw(projectId);
      const r = await submitDesign({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || void 0,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs
      });
      await store.updateProject(projectId, { status: "designing", dshSessionId: r.sessionId });
      return r.sessionId;
    },
    submitIngest: async (projectId) => {
      const ctrl = sessionController;
      if (!ctrl) throw new Error("\u672C profile \u65E0 sessionController\uFF0Cingest \u4E0D\u53EF\u7528");
      const p = store.get(projectId);
      if (!p) throw new Error("project not found");
      if (!p.schemaConfirmed) throw new Error("\u8BF7\u5148\u786E\u8BA4 SCHEMA \u540E\u518D\u6784\u5EFA");
      const rawDocs = await store.scanRaw(projectId);
      const r = await submitIngest({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || void 0,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: "wiki_done"
      });
      await store.updateProject(projectId, { status: "ingesting", dshSessionId: r.sessionId });
      return r.sessionId;
    },
    submitBuild: async (projectId) => {
      const ctrl = sessionController;
      if (!ctrl) throw new Error("\u672C profile \u65E0 sessionController\uFF0C\u6784\u5EFA\u4E0D\u53EF\u7528");
      const p = store.get(projectId);
      if (!p) throw new Error("project not found");
      const rawDocs = await store.scanRaw(projectId);
      if (!rawDocs.length) throw new Error("\u9879\u76EE\u8FD8\u6CA1\u6709\u4E0A\u4F20\u4EFB\u4F55\u6587\u6863\uFF0C\u8BF7\u5148\u4E0A\u4F20");
      const r = await submitBuild({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || void 0,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: "wiki_done"
      });
      await store.updateProject(projectId, { status: "ingesting", dshSessionId: r.sessionId, schemaConfirmed: false });
      return r.sessionId;
    },
    submitLintFix: async (projectId) => {
      const ctrl = sessionController;
      if (!ctrl) throw new Error("\u672C profile \u65E0 sessionController\uFF0Clint \u4FEE\u590D\u4E0D\u53EF\u7528");
      const p = store.get(projectId);
      if (!p) throw new Error("project not found");
      const report = p.lint;
      if (!report || !report.errorCount && !report.warnCount) throw new Error("\u5F53\u524D\u6CA1\u6709\u9700\u8981\u4FEE\u590D\u7684 lint \u95EE\u9898");
      const rawDocs = await store.scanRaw(projectId);
      const reportText = report.issues.map((i) => `- [${i.severity === "error" ? "error" : "warn"}] ${i.page}: ${i.message}`).join("\n");
      const r = await submitLintFix({
        controller: ctrl,
        projectDir: store.projectAbs(projectId),
        wikiDir: store.wikiDir(projectId),
        projectId,
        projectName: p.name,
        domain: p.domain,
        agentPreset: resolved.ingestAgentPreset,
        workspaceId: resolved.ingestWorkspaceId || void 0,
        modelSelection: parseModelSelection(resolved.ingestModel),
        permissionPreset: resolved.ingestPermissionPreset,
        skillText: builtinSkill,
        signal: new AbortController().signal,
        rawDocs,
        doneTool: "wiki_done",
        lintReport: reportText || "\uFF08\u65E0\u8BE6\u7EC6\u6761\u76EE\uFF09"
      });
      await store.updateProject(projectId, { status: "ingesting", dshSessionId: r.sessionId });
      return r.sessionId;
    },
    // Design completion is detected by the presence of SCHEMA.md on disk.
    // Also recovers a project that markStalled() failed after a restart: the
    // session is gone but the draft may already be sitting in the wiki dir.
    advanceDesign: async (projectId) => {
      const p = store.get(projectId);
      if (!p) return void 0;
      if (p.status === "designing" || p.status === "failed") {
        const schema = await store.readSchema(projectId);
        if (schema && !p.schemaConfirmed) {
          await store.updateProject(projectId, {
            status: "awaiting-schema-confirm",
            schemaDraft: schema,
            error: void 0
          });
        }
      }
      return store.get(projectId);
    }
  };
  const server = createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      await handleApiRequest(req, res, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      writeError(res, "internal", msg, 500);
    }
  });
  server.once("error", (e) => {
    trace(`loopback server error on :${resolved.apiPort}`, e);
    logWarn(`loopback server :${resolved.apiPort} \u542F\u52A8\u5931\u8D25: ${e.message}`);
  });
  trace(`calling server.listen(${resolved.apiPort}, 127.0.0.1)`);
  server.listen(resolved.apiPort, "127.0.0.1", () => {
    trace(`listening on ${resolved.apiPort}`);
    logInfo(`Wiki loopback API \u76D1\u542C http://127.0.0.1:${resolved.apiPort}${API_PREFIX}`);
  });
  try {
    const eff = ctx.effect;
    if (typeof eff === "function") {
      eff.call(
        ctx,
        () => () => {
          try {
            server.close();
          } catch {
          }
          try {
            store.dispose();
          } catch {
          }
          logInfo("Wiki \u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u91CA\u653E loopback \u7AEF\u53E3\u5E76\u5173\u95ED SQLite");
        },
        "dsh-local-llm-wiki: loopback server"
      );
    }
  } catch {
  }
}
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "300");
}
function writeJson(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}
function writeError(res, code, message, httpStatus) {
  res.statusCode = httpStatus;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: code, message }));
}
function writeMarkdown(res, md) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.end(md);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function parseBoundary(header) {
  if (!header) return null;
  const m = /boundary=("?)([^";]+)\1/i.exec(header);
  return m ? m[2] : null;
}
function scanParts(buf, boundary) {
  const files = [];
  const fields = {};
  const delim = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(delim);
  if (start < 0) return { files, fields };
  while (true) {
    const scan = start + delim.length;
    if (buf[scan] === 45 && buf[scan + 1] === 45) {
      return { files, fields };
    }
    const headerIdx = buf.indexOf("\r\n\r\n", scan);
    const he = headerIdx < 0 ? scan : headerIdx;
    const headerText = buf.slice(scan + 2, he).toString("utf-8");
    const isFile = /name="file"/i.test(headerText);
    const filenameMatch = /filename\*=utf-8''([^;\r\n]+)/i.exec(headerText) || /filename="([^"]*)"/i.exec(headerText);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const contentStart = he + 4;
    const next = buf.indexOf(delim, contentStart);
    if (next < 0) return { files, fields };
    const data = buf.slice(contentStart, next - 2);
    if (isFile) {
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : "upload";
      files.push({
        filename,
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream",
        data
      });
    } else if (nameMatch && data.length <= 200) {
      fields[nameMatch[1]] = data.toString("utf-8");
    }
    start = next;
  }
}
async function handleApiRequest(req, res, deps) {
  const url = new URL(req.url || "/", "http://dsh.internal");
  const pathname = decodeURIComponent(url.pathname);
  const rest = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : pathname;
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" && rest === "/projects") {
    for (const p of deps.store.list()) {
      if (p.status === "designing" || p.status === "failed") await deps.advanceDesign(p.id);
    }
    const projects = deps.store.list().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      pageCount: p.pageCount,
      domain: p.domain,
      wikiName: p.wikiName,
      schemaConfirmed: p.schemaConfirmed,
      updatedAt: p.updatedAt,
      error: p.error,
      lint: p.lint ? { errorCount: p.lint.errorCount, warnCount: p.lint.warnCount } : null
    }));
    writeJson(res, 200, { ok: true, projects });
    return;
  }
  if (method === "GET" && rest === "/browse") {
    const target = url.searchParams.get("path") || os2.homedir();
    try {
      writeJson(res, 200, { ok: true, ...await deps.store.browseDir(target) });
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (method === "POST" && rest === "/project") {
    const body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    const name2 = String(body.name || "").trim();
    if (!name2) {
      writeJson(res, 400, { ok: false, error: "\u9700\u8981 name" });
      return;
    }
    const proj = await deps.store.createProject({ name: name2, domain: body.domain, wikiName: body.wikiName });
    const importDir = typeof body.importDir === "string" ? body.importDir.trim() : "";
    if (importDir) {
      try {
        const n = await deps.store.importWikiDir(proj.id, importDir);
        const pages = deps.store.getPages(proj.id);
        deps.index.addProject(proj.id, proj.name, pages);
        deps.store.setLint(proj.id, lintPages(pages));
        await deps.store.updateProject(proj.id, { status: "ready", error: void 0 });
        writeJson(res, 200, { ok: true, project: proj, importedPages: n });
      } catch (err) {
        await deps.store.deleteProject(proj.id);
        writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    writeJson(res, 200, { ok: true, project: proj });
    return;
  }
  const delMatch = /^\/project\/([^/]+)$/.exec(rest);
  if (method === "DELETE" && delMatch) {
    const ok = await deps.store.deleteProject(delMatch[1]);
    writeJson(res, ok ? 200 : 404, { ok, id: delMatch[1] });
    return;
  }
  const projMatch = /^\/project\/([^/]+)$/.exec(rest);
  if (method === "GET" && projMatch) {
    const p = await deps.advanceDesign(projMatch[1]);
    if (!p) {
      writeJson(res, 404, { ok: false, error: "project not found" });
      return;
    }
    const uploads = await deps.store.scanRaw(p.id);
    const schema = await deps.store.readSchema(p.id);
    let pages = deps.store.getPages(p.id);
    if (!pages.length && p.pageCount > 0) pages = await deps.store.harvest(p.id);
    const sourceGroups = uploads.map((u) => {
      const bare = u.name.replace(/^[0-9a-f]{8}-/, "");
      const stem = bare.replace(/\.[^.]+$/, "").toLowerCase();
      const related = pages.filter((pg) => pg.sources.some((s) => {
        const ls = s.toLowerCase();
        const file = ls.split("#")[0].trim();
        const fStem = file.replace(/\.[^.]+$/, "");
        return fStem && (stem.includes(fStem) || fStem.includes(stem)) || file && ls.includes(stem);
      })).map((pg) => ({ path: pg.path, kind: pg.kind, title: pg.title, tags: pg.tags, updated: pg.updated }));
      return { name: bare, sha256: u.sha256, pages: related };
    });
    writeJson(res, 200, {
      ok: true,
      project: p,
      uploads: uploads.map((u) => ({ name: u.name.replace(/^[0-9a-f]{8}-/, ""), size: u.size, sha256: u.sha256, mtime: u.mtime })),
      sourceGroups,
      schema: p.schemaConfirmed ? schema : p.schemaDraft ?? schema,
      schemaConfirmed: p.schemaConfirmed,
      pages: pages.map((pg) => ({ path: pg.path, kind: pg.kind, title: pg.title, tags: pg.tags, updated: pg.updated }))
    });
    return;
  }
  if (method === "POST" && rest === "/upload") {
    const ct = req.headers["content-type"];
    const boundary = parseBoundary(ct);
    if (!boundary) {
      writeJson(res, 400, { ok: false, error: "\u975E multipart \u4E0A\u4F20" });
      return;
    }
    const buf = await readBody(req);
    const { files, fields } = scanParts(buf, boundary);
    const projectId = fields.projectId;
    if (!projectId || !deps.store.get(projectId)) {
      writeJson(res, 400, { ok: false, error: "projectId \u65E0\u6548" });
      return;
    }
    const added = [];
    for (const f of files) {
      if (!f.filename) continue;
      const doc = await deps.store.addUpload(projectId, { name: f.filename, mime: f.contentType, data: f.data });
      added.push({ name: doc.name, size: doc.size });
    }
    writeJson(res, 200, { ok: true, added });
    return;
  }
  const designMatch = /^\/design\/([^/]+)$/.exec(rest);
  if (method === "POST" && designMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: "\u672C profile \u65E0 sessionController\uFF0Cdesign \u4E0D\u53EF\u7528" });
      return;
    }
    try {
      const sessionId = await deps.submitDesign(designMatch[1]);
      writeJson(res, 200, { ok: true, sessionId, status: "designing" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeJson(res, 400, { ok: false, error: msg });
    }
    return;
  }
  const schemaMatch = /^\/schema\/([^/]+)$/.exec(rest);
  if (method === "POST" && schemaMatch) {
    const body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    const schema = String(body.schema ?? "");
    if (!schema) {
      writeJson(res, 400, { ok: false, error: "\u9700\u8981 schema \u5185\u5BB9" });
      return;
    }
    await deps.store.writeSchema(schemaMatch[1], schema);
    const p = await deps.store.updateProject(schemaMatch[1], { schemaConfirmed: true, status: "uploaded", schemaDraft: void 0 });
    writeJson(res, 200, { ok: true, project: p, schemaConfirmed: true });
    return;
  }
  const ingestMatch = /^\/ingest\/([^/]+)$/.exec(rest);
  if (method === "POST" && ingestMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: "\u672C profile \u65E0 sessionController\uFF0Cingest \u4E0D\u53EF\u7528" });
      return;
    }
    try {
      const sessionId = await deps.submitIngest(ingestMatch[1]);
      writeJson(res, 200, { ok: true, sessionId, status: "ingesting" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await deps.store.updateProject(ingestMatch[1], { status: "failed", error: msg });
      writeJson(res, 400, { ok: false, error: msg });
    }
    return;
  }
  const buildMatch = /^\/build\/([^/]+)$/.exec(rest);
  let lintFixMatch;
  if (method === "POST" && buildMatch) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: "\u672C profile \u65E0 sessionController\uFF0C\u6784\u5EFA\u4E0D\u53EF\u7528" });
      return;
    }
    try {
      const sessionId = await deps.submitBuild(buildMatch[1]);
      writeJson(res, 200, { ok: true, sessionId, status: "ingesting" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await deps.store.updateProject(buildMatch[1], { status: "failed", error: msg });
      writeJson(res, 400, { ok: false, error: msg });
    }
    return;
  }
  if (method === "POST" && (lintFixMatch = rest.match(/^\/lintfix\/(.+)$/))) {
    if (!deps.getSession()) {
      writeJson(res, 503, { ok: false, error: "\u672C profile \u65E0 sessionController\uFF0Clint \u4FEE\u590D\u4E0D\u53EF\u7528" });
      return;
    }
    try {
      const sessionId = await deps.submitLintFix(lintFixMatch[1]);
      writeJson(res, 200, { ok: true, sessionId, status: "ingesting" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeJson(res, 400, { ok: false, error: msg });
    }
    return;
  }
  if (method === "GET" && rest === "/settings") {
    writeJson(res, 200, {
      ok: true,
      settings: {
        ingestWorkspaceId: deps.resolved.ingestWorkspaceId,
        ingestModel: deps.resolved.ingestModel,
        ingestAgentPreset: deps.resolved.ingestAgentPreset,
        ingestPermissionPreset: deps.resolved.ingestPermissionPreset
      }
    });
    return;
  }
  if (method === "PUT" && rest === "/settings") {
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    } catch {
      writeJson(res, 400, { ok: false, error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
      return;
    }
    const next = deps.saveSettings({
      ingestWorkspaceId: typeof body.ingestWorkspaceId === "string" ? body.ingestWorkspaceId : void 0,
      ingestModel: typeof body.ingestModel === "string" ? body.ingestModel : void 0
    });
    writeJson(res, 200, {
      ok: true,
      settings: {
        ingestWorkspaceId: next.ingestWorkspaceId,
        ingestModel: next.ingestModel,
        ingestAgentPreset: next.ingestAgentPreset,
        ingestPermissionPreset: next.ingestPermissionPreset
      }
    });
    return;
  }
  if (method === "GET" && rest === "/catalog") {
    const llm = deps.getLlm();
    if (!llm || typeof llm.listProviders !== "function") {
      writeJson(res, 200, { ok: true, groups: [] });
      return;
    }
    try {
      const providers = await llm.listProviders();
      const groups = await Promise.all(providers.map(async (prov) => {
        try {
          const models = await llm.listModels(prov.id);
          return { id: prov.id, name: prov.name || prov.id, models: models.map((m) => ({ id: m.id, name: m.name || m.id })) };
        } catch {
          return { id: prov.id, name: prov.name || prov.id, models: [], error: "\u6A21\u578B\u5217\u8868\u4E0D\u53EF\u7528" };
        }
      }));
      writeJson(res, 200, { ok: true, groups: groups.filter((g) => g.models.length > 0) });
    } catch (err) {
      writeJson(res, 200, { ok: true, groups: [], error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (method === "GET" && rest === "/workspaces") {
    const reg = deps.getWorkspaces();
    if (!reg || typeof reg.list !== "function") {
      writeJson(res, 200, { ok: true, workspaces: [] });
      return;
    }
    try {
      const items = reg.list().map((w) => ({ id: String(w.id), path: w.path, sessions: Array.isArray(w.sessionIds) ? w.sessionIds.length : 0 }));
      writeJson(res, 200, { ok: true, workspaces: items });
    } catch (err) {
      writeJson(res, 200, { ok: true, workspaces: [], error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (method === "POST" && rest === "/delete-upload") {
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString("utf-8") || "{}");
    } catch {
      writeJson(res, 400, { ok: false, error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
      return;
    }
    const projectId = String(body.projectId ?? "");
    const sha256 = String(body.sha256 ?? "").trim();
    if (!projectId || !deps.store.get(projectId)) {
      writeJson(res, 400, { ok: false, error: "projectId \u65E0\u6548" });
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      writeJson(res, 400, { ok: false, error: "\u9700\u8981 sha256\uFF08\u4E0A\u4F20\u6587\u4EF6\u7684\u54C8\u5E0C\uFF09" });
      return;
    }
    try {
      const removedPages = await deps.store.deleteUpload(projectId, sha256);
      const p = deps.store.get(projectId);
      const pages = deps.store.getPages(projectId);
      deps.index.addProject(projectId, p?.name ?? projectId, pages);
      deps.store.setLint(projectId, lintPages(pages));
      writeJson(res, 200, { ok: true, removedPages, pages: pages.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeJson(res, 400, { ok: false, error: msg });
    }
    return;
  }
  if (method === "GET" && rest === "/search") {
    const q = url.searchParams.get("q") || "";
    const projectId = url.searchParams.get("projectId") || void 0;
    const topK = Number(url.searchParams.get("topK") || "5");
    if (!q.trim()) {
      writeJson(res, 400, { ok: false, error: "\u9700\u8981 q" });
      return;
    }
    const hits = deps.index.search(q, { projectId, topK: Number.isFinite(topK) ? topK : 5 });
    writeJson(res, 200, {
      ok: true,
      count: hits.length,
      hits: hits.map((h) => ({
        projectId: h.projectId,
        projectName: h.projectName,
        path: h.page.path,
        kind: h.page.kind,
        title: h.page.title,
        tags: h.page.tags,
        score: h.score,
        snippet: h.snippet
      }))
    });
    return;
  }
  const pageMatch = /^\/page\/([^/]+)$/.exec(rest);
  if (method === "GET" && pageMatch) {
    const pagePath = url.searchParams.get("path") || "";
    const md = await deps.store.readPage(pageMatch[1], pagePath);
    if (md === null) {
      writeJson(res, 404, { ok: false, error: "page not found" });
      return;
    }
    writeMarkdown(res, md);
    return;
  }
  if (method === "GET" && rest === "/status") {
    writeJson(res, 200, {
      ok: true,
      api: "dsh-local-llm-wiki",
      apiPort: deps.resolved.apiPort,
      dataDir: deps.resolved.dataDir,
      projects: deps.store.list().length,
      pages: deps.index.size,
      hasSession: !!deps.getSession()
    });
    return;
  }
  writeJson(res, 404, { ok: false, error: "not found", path: rest });
}
var index_default = { name, inject, apply, resolveConfig, DEFAULT_CONFIG };
export {
  DEFAULT_CONFIG,
  apply,
  index_default as default,
  inject,
  name,
  resolveConfig
};
//# sourceMappingURL=index.mjs.map

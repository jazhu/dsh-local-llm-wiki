# dsh-wiki — 全新 llm-wiki 知识库插件 设计方案（v0.1 草案）

> 状态：待用户评审。实现目录：`F:\DSH-WorkSpace\dsh_plugin\dsh-wiki\`
> 定位：与现有 `dsh-knowledge-base`（dsh-llm-wiki-knowledge）**并存、互不依赖**的新插件——现有插件做「文档切片 + BM25 检索」，本插件做「llm-wiki 技能原生的多项目知识库」。

## 1. 目标与非目标

**目标**
1. 把 `llm-wiki` 技能（SKILL.md v3.5：design → init → ingest → query/lint/update/evaluate）做成插件产品形态，用户无需手动驱动技能流程。
2. 提供 **Web UI 上传入口**（slot 卡片，拖拽上传 PDF/Word/Markdown/HTML）。
3. 多项目（multi-project）知识库：每个项目 = 一个标准 llm-wiki 目录（`raw/` + `<wiki-name>/` + SCHEMA.md），支持多知识库并列。
4. agent 可通过工具查询/检索/读取 wiki 页面（对话内直接引用知识库回答）。
5. 全流程可视化：上传 → 设计 SCHEMA → 会话编译 ingest → lint/evaluate 状态 → 查询。

**非目标（v1 明确不做）**
- 不做向量库/语义检索（llm-wiki 理念是页面级全文，先 BM25 + 页面索引）。
- 不改 agent-loop、不加新 SessionEvent type（插件状态一律由既有事件或自有存储推导）。
- 不迁移现有 dsh-knowledge-base 数据。

## 2. 总体架构

```
┌─ Web UI (client.tsx, slot: sidebar / panel) ──────────────┐
│  项目列表 · 拖拽上传 · SCHEMA 确认 · ingest 进度 · lint 报告 │
└──────────────┬───────────────────────────────────────────┘
               │ same-origin /wiki-api/*（自起 loopback http server，
               │ 127.0.0.1 绑定，沿用 kb-api 的无鉴权回环决策）
┌─ Host 插件 (index.ts, apply(ctx, config)) ───────────────┐
│ ProjectStore   项目/wiki 页面/manifest 元数据与落盘        │
│ UploadService  接收文件 → raw/<project>/（不可变层）       │
│ DesignRunner   起草 SCHEMA.md（读 raw 文档清单 → 交给会话） │
│ IngestRunner   sessionController.create 建会话，prompt     │
│                要求加载 llm-wiki 技能按 ingest-workflow 编译│
│ HarvestHooks   wiki_done 回调收割 <wiki>/ 页面 → 索引      │
│ WikiIndex      页面级 BM25（复用 retrieve.ts 引擎思路）     │
│ Tools          wiki_projects / wiki_search / wiki_read /   │
│                wiki_status / wiki_done                    │
└───────────────────────────────────────────────────────────┘
```

## 3. 数据模型与落盘布局

默认根：`<profileDataDir>/dsh-wiki/`（可配 `dataDir`），每个知识库项目一个子目录，**目录即 llm-wiki 标准布局**：

```
<dataDir>/
└── projects/<projectId>/          ← projectId = kebab-case slug
    ├── raw/                       ← 上传的原始文档（不可变层）
    │   └── .cache/manifest.json   ← SHA256 快照（增量 ingest 判定，格式与技能一致）
    └── <wiki-name>/               ← 会话产出的知识层（收割对象）
        ├── SCHEMA.md · index.md · log.md
        ├── entities/ · concepts/ · comparisons/ · queries/
        └── pages/（体系 B 时）
```

插件自有元数据（不入 wiki 目录，避免污染技能的工作区白名单）：`<dataDir>/registry.json` 记录项目清单、每文档上传状态、ingest 会话 id、收割时间、lint/evaluate 最近报告摘要。

## 4. 核心流程

### 4.1 上传（Web UI 入口）
- UI 卡片（`dsh.client.inject: ["slots"]`，React 组件只渲染 slot 内容、只用 `--dsw-alias-*` token）。
- `POST /wiki-api/project` 建项目（名称、领域一句话）；`POST /wiki-api/upload`（multipart: projectId + files）→ 落 `raw/`，计算 SHA256 写 manifest。
- 状态机：`uploaded → designing → awaiting-schema-confirm → ingesting → harvesting → ready`（失败态 `failed` + 原因）。

### 4.2 SCHEMA 设计（wiki-design 产品化）
- `POST /wiki-api/design/:projectId`：插件读取 raw/ 文档清单与抽样内容，交给一次 DSH 会话（llm）生成 SCHEMA.md 草稿（复用技能 `references/schema-guide.md` 的规范，把该文件打包进插件 resources 供 prompt 引用）。
- 用户在 UI 上确认/编辑 SCHEMA → 写入 `<wiki>/SCHEMA.md` → 执行 wiki-init 等价动作（建骨架 index.md/log.md/子目录）。

### 4.3 摄入（wiki-ingest 产品化）——复用已验证的会话回流链路
- `IngestRunner` 调 `sessionController.create`（signal 必填）+ rename + prompt，prompt 指明：工作目录 = 该项目目录、按 llm-wiki 技能 ingest-workflow 执行、输出限定在 `<wiki>/` 内、子 Agent 输出路径写入 `<wiki>/.ingest-cache/`。
- 会话完成后调 `wiki_done(projectId, wikiDir)` 工具（回流唯一权威点，等价现有 kb_ingest_done 模式；工具**无条件注册**，避免现有插件踩过的 sessionController 三元门槛 bug）。
- `HarvestHooks` 收割：逐页解析 frontmatter（slug/type/tags/sources/confidence/updated）→ 入 WikiIndex → 更新 registry；`resumeInterrupted` 跳过 ingesting 中项目（防重启误排）。
- 增量：上传新文件 → manifest diff（added/modified）→ 再次提交会话，prompt 注入增量清单（对应技能自动检测三模式）。

### 4.4 查询
- agent 工具 `wiki_search`（BM25 页面级检索，返回页面路径+命中段）与 `wiki_read`（按页读取页面全文）；prompt 约束与技能一致：**只从 wiki 页面回答，不引用即明说无此信息**。
- UI 查询框：走 `/wiki-api/search` 同引擎。

### 4.5 质量闭环（v1 简化版）
- lint/evaluate 的 Python 脚本不进插件（避免 Python 依赖）；v1 在收割时做结构 lint 子集（断链、frontmatter 必填、孤立页面、目录白名单），结果写 registry 并在 UI 显示红/黄计数；完整 lint/evaluate 留给用户在会话里驱动技能执行。

## 5. 宿主注册面（契约核对清单）

| 项 | 做法 | 依据 |
|---|---|---|
| 插件形态 | `export const name='dsh-wiki'` + `apply(ctx, config)`，`inject: []`（webServer 可缺席） | 官方插件契约 |
| 工具注册 | 宿主 profile 用完整 JSON Schema `{type:'object',properties,required}`；`execute` 只返回 `output.schema` 声明的规范 JSON | dsh-syslog-alert 实测 + 官方 tool.md |
| 会话创建 | `sessionController.create/prompt(request, signal)`，signal 必填 | 已验证宿主契约 |
| 配置 | Schemastery `Schema<Config>`（禁止普通对象）；可调项：dataDir/apiPort/ingestAgentPreset/llmProvider/llmModel | 红线 |
| UI | slot 内 React、无 iframe、无 `require` client 包、`dsh.client.inject` 静态数组 | UI 红线 |
| 事件 | 不新增 SessionEvent type；ingest 进度由插件自有轮询 `/wiki-api/status`（UI 轮询自身 API，非 agent/status） | 会话事件红线 |
| 元数据 | `locale/*.json` meta.title/description + `./icon`（≤256KiB） | 交付红线 |
| 依赖 | dsh 包只进 peerDependencies + devDependencies；解析器沿用 `@firecrawl/anydoc`/`mupdf` 等（dependencies 随 npm 包发布） | peer 红线 |
| 打包 | bundle patch `cordis.patch.yml`，安装走 `plugin_manager install_bundle`（绝对目录），禁手写 profile 文件 | 发布契约 |

## 6. 与现有插件的关系
- 各自独立安装/启用；数据目录不同（`<dataDir>/dsh-wiki/` vs `~/.dsh/dsh-knowledge-base`）。
- 工具名空间不冲突（wiki_* vs kb_*）。
- 可复用（复制后改造，不做共享包）：`retrieve.ts`（BM25）、`anydoc-extract.ts`（各格式抽文本）、`session-ingest.ts` 的 submit 模式；SCHEMA/页面解析新写。
- llm-wiki 技能本体仍是依赖：ingest 会话需该技能已安装（配置项 `ingestAgentPreset` 可指向预载技能的 preset，prompt 兜底触发）。

## 7. 里程碑
1. **M1 骨架**：`dsh-plugin-dev new dsh-wiki` 生成骨架；ProjectStore + 上传 API + UI 上传卡片；上传落 raw/。
2. **M2 编译链路**：DesignRunner（SCHEMA 草稿）→ UI 确认 → IngestRunner 会话提交 → wiki_done 收割 → 页面索引。
3. **M3 检索**：wiki_search/wiki_read/wiki_projects/wiki_status 工具 + UI 查询框 + 状态展示。
4. **M4 质量**：收割期结构 lint 子集 + 增量 ingest + 断点续传（重启跳过、重传入口）。
5. **M5 验收**：tsc 0 错、`dsh-plugin-dev verify` 干净 profile 冒烟、headless 端到端（真实 DSH 会话建一个 2-3 文档小库并检索命中）。

## 8. 已知风险与对策
| 风险 | 对策 |
|---|---|
| 会话中断/宿主重启后文档停在「构建中」（现有插件遗留问题） | registry 记会话 id；重启扫描 ingesting 项标记 `stalled`，UI 提供「重新构建」按钮（重提交会话，manifest 不变） |
| 会话输出越出 `<wiki>/`（技能已知痛点） | prompt 显式指定输出路径与缓存目录；收割器只认 `<wiki>/` 白名单目录 |
| 无 sessionController 的 headless profile | 上传/SCHEMA 仍可用，ingest 入口禁用并提示；不静默回退本地解析（与本插件定位不符，明确报错） |
| SCHEMA 草稿质量不稳 | UI 必须人工确认后才落 SCHEMA.md，未确认不进 ingest |

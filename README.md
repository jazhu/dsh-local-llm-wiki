# dsh-local-llm-wiki

本地 llm-wiki 知识库插件（DeepSeek Harness / DSH 桌面版）。在 Web 面板拖拽上传源文档，由真实 DSH 会话按内置的 llm-wiki 技能自动完成知识库设计与编译，产出结构化 Wiki 页面（实体 / 概念 / 对比 / 查询 / 索引），并向助手注册检索工具，实现「上传 → 构建 → 检索」的完整闭环。

## 功能特性

- **多项目管理**：每个知识库项目独立数据目录 `<dataDir>/projects/<projectId>/{raw/, <wikiName>/}`，registry.json 记录元数据；支持中文项目名。
- **拖拽上传入口**：Web 面板直接拖拽上传 pdf / md / docx 等文档，落 `raw/`（不可变原始层），SHA256 清单管理。
- **一键构建**：由插件发起真实 DSH 会话，按**内置 llm-wiki 技能**（随插件打包，无需额外安装）在一个会话内完成 SCHEMA 设计 → 确认 → 编译 → 调用 `wiki_done` 回收入库；也可分步执行以便人工把关。
- **增量构建**：基于 `raw/.cache/manifest.json` 的 SHA256 做 added / modified / unchanged / removed 判定，重复上传只重建变化部分。
- **页面级 BM25 检索**：收割后的页面在插件进程内建立 BM25 索引（CJK 单字+二元分词），支持跨项目 / 单项目检索。
- **链接完整性检查**：构建完成后自动 lint，报告页面间引用的断链。
- **源文件 ↔ 页面关联**：页面 frontmatter 的 `sources` 与上传文件自动匹配，文件列表可直接查看「该文件构建出的页面」。
- **文件管理**：查看已上传文件（大小 / 时间 / SHA256），删除文件时自动删除其关联页面并重建索引。
- **构建会话可配置**：设置页选择构建会话使用的**工作区**、**模型**（来自宿主模型池）与权限预设（默认 Auto review）。
- **面板阅读**：已构建页面以按钮 + 弹窗方式浏览，支持单页 Markdown 阅读。

## 提供给助手的工具

| 工具 | 说明 |
|---|---|
| `wiki_projects` | 列出所有知识库项目（名称、状态、页面数、更新时间） |
| `wiki_status` | 查看某项目构建状态与 lint 结果 |
| `wiki_search` | 页面级 BM25 检索（可限定项目、topK） |
| `wiki_read` | 按路径读取某页面完整 Markdown |
| `wiki_done` | 构建会话完成后的收割入口（会话侧调用） |

## 安装（DSH 桌面版 profile）

1. 克隆本仓库到本地，然后构建（`dist/` 不入库，必须先构建）：

   ```bash
   pnpm install
   pnpm run build
   ```

   > 构建后 `dist/` 必须包含：`index.mjs`、`client.js`、`skills/llm-wiki.md`、
   > `locale/zh.json`、`locale/en.json`。若在别的机器上安装时提示
   > 「no such file or directory, scandir ...\\locale」，说明 `dist/` 缺失或
   > 不完整——在本机重新执行 `pnpm run build` 即可。

2. 在 DSH profile（`~/.dsh/profiles/desktop`）的 `package.json` 中注册：

   ```json
   {
     "dependencies": { "dsh-local-llm-wiki": "link:<本仓库路径>" },
     "dsh.profile.bundles": ["dsh-local-llm-wiki"]
   }
   ```

3. 在 profile 的 `cordis.patch.yml` 层栈中追加：

   ```yaml
   - insert:
       - id: dsh-local-llm-wiki
         name: dsh-local-llm-wiki
   ```

   （本仓库根目录的 `cordis.patch.yml` 已含完整条目与默认配置，可直接拷贝内容。）

4. 执行 `pnpm install` 后**重启 DSH**，侧栏出现「📚 Wiki 知识库」面板。

## 使用流程

1. 新建项目（支持中文名）。
2. 拖拽上传源文档到项目。
3. 点击「⚡ 一键构建」：DSH 会话自动完成 SCHEMA 设计与页面编译并回收（或按 ①生成设计 → ②确认 SCHEMA → ③构建 分步执行）。
4. 构建完成后：面板浏览页面 / 让助手调用 `wiki_search`、`wiki_read` 检索。
5. 「设置」tab 可切换构建会话的工作区与模型。

## 配置项（cordis.patch.yml）

| 配置 | 默认 | 说明 |
|---|---|---|
| `dataDir` | `~/.dsh/dsh-local-llm-wiki` | 知识库数据目录 |
| `ingestAgentPreset` | 空 | 构建会话使用的 agent preset |
| `ingestPermissionPreset` | `auto` | 构建会话权限预设（需宿主加载 auto-review 层） |
| `apiPort` | `18781` | 自建回环 API 端口（`/wiki-api/*`，仅绑定 127.0.0.1） |

## 架构

- `src/index.ts` — 宿主半：插件激活、回环 HTTP API、工具注册。
- `src/client.tsx` — Web 面板（注入 sidebar/panel，ESM CJS 双构建）。
- `src/store.ts` — registry.json + 项目目录的磁盘事实层。
- `src/session-ingest.ts` — DSH 会话驱动的构建（sessionController + 内置技能注入）。
- `src/retrieve.ts` — 页面级 BM25 索引。
- `src/wiki-tools.ts` — 五个 `wiki_*` 工具定义。
- `resources/llm-wiki-SKILL.md` — 内置 llm-wiki 技能（构建时拷贝到 `dist/skills/`）。

## 开发

```bash
pnpm run check   # tsc --noEmit 类型门
pnpm run build   # esbuild host ESM + client CJS
node --experimental-strip-types test/structure.test.ts   # 结构测试 50 断言
```

## License

MIT

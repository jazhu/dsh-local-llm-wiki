---
name: llm-wiki
description: 通用 LLM Wiki 知识库构建与维护技能。基于"LLM writes, human reads"理念，将原始文档编译为结构化知识库，通过 7 大方法（design → init → ingest → query → lint → update → evaluate）完成知识库全生命周期管理。适用场景：(1) 从零搭建领域知识库（产品文档、技术文档、业务知识等），(2) 将原始文档批量摄入为结构化 Wiki 页面，(3) 基于知识库查询回答领域问题，(4) 检查并修复知识库质量问题，(5) 增量更新已有页面，(6) 评估知识库整体健康度。当用户提到"wiki""知识库""LLM Wiki""知识摄入""知识查询""init wiki""ingest""lint""evaluate"等关键词时触发。
version: '3.5'
publisher: 虞安虎
woicrew_hub_slug: llm-wiki
woicrew_publisher: 虞安虎
---
# LLM Wiki — 知识库构建与维护

> **理念**：LLM writes, human reads — AI 负责编译和维护知识库，人类只读审核。

## 标准目录结构

每个知识库项目遵循统一的目录布局：

```
<project>/
├── raw/            ← 原始素材层（不可变，AI 只读）
│   ├── *.md        ← 源文档
│   └── .cache/     ← ingest 预提取缓存（自动生成，不手动编辑）
│
├── <wiki-name>/    ← Wiki 知识层（核心产出物，人类审核此目录即可）
│   ├── SCHEMA.md   ← 结构规范（design 产出，全库唯一配置源）
│   ├── index.md    ← 全库索引
│   ├── log.md      ← 操作日志
│   ├── entities/   ← 实体页面
│   ├── concepts/   ← 概念页面
│   ├── comparisons/← 对比页面
│   ├── queries/    ← 查询存档
│   └── .gitignore  ← 版本控制排除规则（自动生成）
│
└── <临时文件>      ← 禁止残留！每次操作结束后必须清理
```

### 路径约定

- **`<wiki>`** 指代 `<project>/<wiki-name>/`，即知识库根目录
- **SCHEMA.md 始终位于 `<wiki>/SCHEMA.md`**，与 index.md、log.md 同级
- **`<wiki>/` 是唯一的知识产出目录**，所有 Wiki 页面必须在此目录内

### 工作区清洁度规则

**每次操作（design/init/ingest/lint/update/evaluate）结束后，Agent 必须检查并清理项目目录：**

**根目录白名单**（仅允许以下内容存在于项目根目录）：

| 允许 | 说明 |
|------|------|
| `raw/` | 源文档目录（不可变层） |
| `<wiki-name>/` | 知识库目录（核心产出物） |
| 平台运行时缓存（如 `.cowork-temp/`） | **不要删除**——属于平台内部文件 |

**禁止残留**（操作结束后必须清除）：

| 类型 | 示例 | 来源 |
|------|------|------|
| 临时脚本 | `*.py`、`*.js`、`*.sh` | Phase 3/4 的构建脚本、调试脚本 |
| 构建报告 | `*.html`、`*_report.md` | 过程产物 |
| 子Agent中间输出 | `entities/`、`output/`、`raw/_temp_*.json` | Phase 2 子Agent写入的非预期路径 |
| 知识库外JSON | 项目根目录下的 `*.json` | 子Agent输出的结构化提取结果 |
| 预提取缓存 | `<wiki>/.ingest-cache/` | Phase 2 的JSON中间文件（Phase 4 清理时删除） |

> wiki-lint 的 R5 规则会自动检测工作区清洁度。
>
> **原因**：子Agent在未指定输出路径时，会将JSON写入多种非预期路径，
> 导致 Phase 4 清理不彻底。解决方案：Phase 2 prompt 中显式指定输出路径到 `<wiki>/.ingest-cache/`，
> Phase 4 使用递归删除 + 根目录白名单校验。

---

## 方法总览

| 方法 | 阶段 | 触发场景 | 产出 |
|------|------|----------|------|
| **wiki-design** | 规划 | 首次搭建知识库，需确定目录结构与规范 | `<wiki>/SCHEMA.md` |
| **wiki-init** | 初始化 | SCHEMA.md 已就绪，创建知识库骨架 | `index.md` + `log.md` + `.gitignore` + 目录 |
| **wiki-ingest** | 摄入 | 首次建库、新增源文档、全量重建 | 结构化知识页面 |
| **wiki-query** | 查询 | 用户提出领域相关问题 | 答案 / 查询存档 |
| **wiki-lint** | 检查 | 检测知识库质量问题 | 问题报告（红/黄/蓝/清洁度） |
| **wiki-update** | 更新 | 已有页面需修正或级联修改 | 更新后的页面 + diff |
| **wiki-evaluate** | 评估 | 定期或大批量变更后评估整体健康 | 量化评分报告 |

执行顺序：**design → init → ingest → (query / lint / update / evaluate 循环)**

---

## wiki-design — 知识库结构设计

> 与用户交互，设计符合领域特征的最佳知识库组织方案。产出物写入 `<wiki>/SCHEMA.md`。

### 设计思维框架

开始设计前，先问自己：
- **用户画像**：这个知识库的核心用户是谁？他们需要什么粒度的信息？
- **实体边界**：领域内实体之间最自然的区分维度是什么？（功能？层级？场景？）
- **交叉概念**：哪些抽象概念会跨多个实体重复出现？
- **高频查询**：用户最可能提出的问题类型是什么？（选型对比？能力速查？概念解释？）

### 触发条件

用户说"设计知识库""创建 wiki""搭建知识库"等，且目标 wiki 目录下尚无 `SCHEMA.md`。

### 执行步骤

**Step 1：确定知识库名称与位置**

向用户确认以下信息（可在一次提问中合并）：

1. **知识库名称**（必填）：这个知识库叫什么？用于创建 wiki 目录名（建议使用英文 kebab-case slug）
2. **知识库位置**：wiki 目录放在哪里？（默认当前工作目录）
3. **领域范围**：要覆盖哪些实体/产品/模块？总共有多少个？
4. **服务对象**：知识库给谁用？（方案生成、内部参考、对外文档等）
5. **源文档位置**：原始文档放在哪个目录？（默认 `raw/`）

> **交互约束**：使用 AskUserQuestion 时，每个问题的选项数**不超过 4 个**。若选项天然超过 4 个（如领域选择），需合并归类到 4 个以内。

> **命名规范**：wiki 目录名使用英文 kebab-case（如 `my-knowledge-base`），SCHEMA.md 中的知识库名称可使用中文。

**Step 2：选择目录结构**

基于领域特征，推荐目录结构：

| 类型 | 适用场景 | 目录 |
|------|----------|------|
| **体系 A（按知识类型）** | 实体边界清晰、类型区分明显 | `entities/` + `concepts/` + `comparisons/` + `queries/` |
| **体系 B（扁平 pages）** | 实体数量少、知识类型交织 | `pages/`（所有页面同级，通过标签区分） |

> **默认推荐体系 A**——大多数领域知识都有"实体 → 概念 → 对比"的天然分层。

目录命名可按领域自定义，如 `products/`（产品类）、`services/`（服务类）、`components/`（组件类）等。

**Step 3：确定实体清单**

扫描源文档目录，列出所有应创建实体页面的对象：

1. 遍历源文档目录结构，识别核心实体（通常是每个子目录 = 一个实体）
2. 跳过空占位符目录（仅有空的 index.md）
3. 列出清单交用户确认

**Step 4：识别跨实体概念**

分析源文档中的高频关键词，识别跨 2+ 实体共享的抽象概念：

- 搜索跨多个实体目录出现的关键词
- 提取排名靠前的共性主题
- 确定概念清单交用户确认

**Step 5：确定对比组**

识别容易混淆或需要选型决策的实体对：

- 同层级的相似实体（如两个执行层产品）
- 功能有交叉的实体
- 用户常问"X 和 Y 有什么区别"的组合

**Step 6：生成 SCHEMA.md**

综合以上信息，写入 `<wiki>/SCHEMA.md`，包含：

- 领域定义（名称、范围、服务对象）
- 目录约定（目录结构 + 实体/概念/对比清单）
- Frontmatter 规范
- 标签体系（分类标签、属性标签、类型标签）
- 页面模板
- 交叉引用规则
- Lint 规则（引用 `references/lint-rules.md`）
- 术语表

> **MANDATORY — READ ENTIRE FILE**：在 Step 6 生成 SCHEMA.md 前，必须完整读取 [`references/schema-guide.md`](references/schema-guide.md) 获取编写指南。
> **Do NOT load** `references/templates.md` — 该文件仅用于 wiki-ingest 阶段。

### 产出

```
<project>/<wiki-name>/
└── SCHEMA.md    ← 唯一产出，后续 init 以此为输入
```

---

## wiki-init — 初始化知识库

### 触发条件

`<wiki>/SCHEMA.md` 已存在，但 wiki 目录下缺少骨架文件。

### 执行步骤

1. **检查状态**：若 `<wiki>/index.md` 已存在 → 提示"已初始化"，停止
2. **创建目录**：按 SCHEMA.md 定义的目录结构创建所有子目录
3. **创建 `<wiki>/index.md`**：全库索引（实体/概念/对比清单 + 统计数据）
4. **创建 `<wiki>/log.md`**：操作日志（首条记录）
5. **创建 `<wiki>/.gitignore`**：排除规则模板（见下方）

### .gitignore 模板

```gitignore
# LLM Wiki 知识库 — 版本控制排除规则

# 运行时缓存
.cowork-temp/
__pycache__/

# 预提取缓存（raw/.cache/ 由 ingest 自动生成）
raw/.cache/

# 临时文件与构建报告
*.tmp
*_report.html
check_*.py

# 编辑器
.vscode/
.idea/
*.swp
```

### 产出

```
<wiki>/
├── SCHEMA.md    ← 已存在（design 产出）
├── index.md     ← 实体清单 + 概念清单 + 对比清单 + 统计
├── log.md       ← 首条操作记录
├── .gitignore   ← 版本控制排除规则
├── entities/    ← (空)
├── concepts/    ← (空)
├── comparisons/ ← (空)
└── queries/     ← (空)
```

---

## wiki-ingest — 知识摄入

### 触发条件

用户说"摄入""ingest""编译知识库""导入文档"等。

### 前置条件

- `<wiki>/SCHEMA.md` 已存在（否则先执行 wiki-design + wiki-init）

### 并发控制参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CONCURRENT_AGENTS` | 5 | 单批次最大并行 Agent 数 |
| `AGENT_TIMEOUT` | 300s | 单个 Agent 执行超时阈值 |
| `MAX_RETRIES` | 1 | Agent 失败后最大重试次数 |
| `BATCH_WAIT` | 全部完成 | 批间调度策略：前一批全部完成后再启动下一批 |

> **资源估算**：5 并发约消耗 ~2.5GB 内存。轻量环境可降至 3 并发。

### 执行步骤

#### Phase 1：分配与规划（~2 分钟）

1. **读取 SCHEMA.md**：获取目录约定、页面模板、标签体系、frontmatter 规范
2. **自动检测摄入范围**（基于文件哈希的三模式判定，无需用户手动指定）：

   检测逻辑（通过 `raw/.cache/manifest.json` 记录文件哈希）：
   1. 扫描 `raw/` 目录，计算每个源文档的 SHA256 哈希 → `current_snapshot`
   2. 读取 `raw/.cache/manifest.json`（若无则视为首次 ingest） → `last_snapshot`
   3. 对比两个快照，将文件分为三类：

   | 分类 | 判定条件 | 含义 |
   |------|----------|------|
   | `added` | 文件名不在 `last_snapshot` 中 | 新增文档 |
   | `modified` | 文件名存在但 SHA256 哈希不同 | 内容已变更的文档 |
   | `unchanged` | 文件名存在且哈希相同 | 无变化，跳过 |
   | `removed` | 文件名在 `last_snapshot` 中但 `raw/` 中已不存在 | 已删除（仅记录日志，不回滚 wiki） |

   4. `pending = added ∪ modified`（待处理文件集合）

   | 模式 | 判定条件 | 处理范围 |
   |------|----------|----------|
   | **增量模式**（默认） | `pending` 非空 且 wiki 页面已存在 | 仅处理 `pending`，`added` 合并到已有页面，`modified` 重新提取后替换对应内容 |
   | **全量模式** | `manifest.json` 不存在（首次 ingest） | 处理 `raw/` 下全部文档 |
   | **强制全量** | 用户明确要求"重新摄入"或"全量" | 忽略 manifest，重新处理全部文档并重建哈希 |

   > **增量模式下**，Agent 输出发现的新增/变更文档清单交用户确认后才开始处理。若用户希望全量重建，可显式指定"全量摄入"。
   > **用户也可手动指定文件**：如"只摄入 raw/新报告.md 和 raw/P6-xxx.md"——此时跳过自动检测，直接按用户指定范围执行。
3. **文档-实体映射**（~2 分钟）：
   - 扫描源文档，按 SCHEMA.md 中的实体/概念清单进行关键字匹配
   - 输出映射清单：`{实体/概念: [源文档列表]}`
   - 列出未分配的源文档，交用户确认或标注跳过
   - **效率要求**：映射阶段仅需确定"源文档→目标页面"的归属关系。若使用子 Agent 辅助映射，子 Agent prompt 应限定输出为简洁的映射 JSON（如 `{"doc": "xxx.md", "targets": ["slug1", "slug2"]}`），不应要求子 Agent 返回完整的文档分析文本（否则日志膨胀 3-5 倍，浪费 token）

#### Phase 2–3：并行提取与组装（核心流程）

> **MANDATORY — READ ENTIRE FILE**：进入 Phase 2 之前，你**必须**完整读取 [`references/ingest-workflow.md`](references/ingest-workflow.md)（~250 行），该文件包含：
> - **Phase 2**：分批并行提取的调度策略、子Agent prompt 模板、输出路径约束、批次完整性约束
> - **Phase 2.5**：子Agent输出收集、JSON 容错解析（safe_json_load）、降级处理与修复流程
> - **Phase 3**：合并与组装、章节渲染规范、参见链接路径规范、增量/全量模式写入
>
> **Do NOT skip** 此文件 — 其中包含大量”必须遵守”的约束，违反将导致页面质量参差、交叉引用缺失或工作区污染。
>
> **Phase 2–3 概览**：
> 1. 按调度策略分批并行启动子Agent提取结构化 JSON
> 2. 收集子Agent返回 → JSON 容错解析 → 写入 `.ingest-cache/`
> 3. 按页面模板渲染 Markdown → 写入目标目录 → 检查交叉引用 → 更新 index.md 和 log.md

#### Phase 4：验证与清理

1. **覆盖率验证**：确认所有 `pending` 文档均出现在对应页面的 `sources` 字段
2. **更新 manifest.json**：将已处理文件的最新 SHA256 哈希和 `assigned_to` 写入 `raw/.cache/manifest.json`，`last_updated` 更新为当前时间
3. **断点续传标记**：log.md 中已记录每个实体的完成状态，中断后可跳过已完成项
4. **工作区清理（增强版）**：

   **Step 4a — 递归删除中间产物**：
   - 删除 `<wiki>/.ingest-cache/`（Phase 2 的所有子Agent JSON输出 + 临时脚本）
   - 删除项目根目录下所有非预期目录和文件（`output/`、`entities/`、`*.json`、`*.py`、`*.html`、`*.tmp`）
   - 使用递归删除（`rm -rf` 或等效），而非仅 `rmdir`（后者只能删空目录）
   - **注意**：平台运行时缓存目录（如 `.cowork-temp/`）属于平台内部文件，**不要删除**

   **Step 4b — 根目录清洁度校验**：
   项目根目录只允许：`raw/`、`<wiki-name>/`、平台运行时缓存目录（可选）。其他均为违规残留。

   **Step 4c — 清理确认**：
   - 列出清理后的项目根目录内容
   - 列出已删除的文件清单（文件名 + 大小）
   - 确认仅剩 `raw/`、`<wiki>/`、`.cowork-temp/`（可选）

---

## wiki-query — 知识查询

> **禁止从记忆或训练数据回答领域问题。** 所有回答必须基于 Wiki 页面内容。若知识库中无相关信息，明确告知"知识库中暂无此信息"。

### 执行步骤

1. **分析查询意图**：

   | 查询类型 | 对应来源 |
   |----------|----------|
   | 单实体能力 | `entities/<slug>.md` |
   | 跨实体概念 | `concepts/<slug>.md` |
   | 选型对比 | `comparisons/<slug>.md` |
   | 全局概览 | `index.md` + `concepts/*` |
   | 多实体关联 | 多页面聚合 |

2. **定位相关页面**：根据查询意图确定需要读取的页面

   开始检索前，先问自己：
   - **信息归属**：这个问题的答案主要在哪个页面类型？（实体/概念/对比）
   - **覆盖范围**：是否需要跨多个页面聚合信息？
   - **可信度**：来源页面的 confidence 评级是什么？是否需要标注不确定性？

3. **读取与综合**：读取页面内容，提取与问题相关的信息
4. **组织回答**：
   - 标注信息来源（如"来源：`entities/crew.md`"）
   - 引用页面中的关键段落
   - 如涉及多个页面，说明页面间的信息关联
5. **高频查询沉淀**（可选）：若判断该查询有复用价值，将问答存入 `queries/`

## wiki-lint — 质量检查

### 触发条件

用户说"检查知识库""lint""质量检查"等。

### 执行步骤

> **MANDATORY — READ ENTIRE FILE**：执行前必须完整读取：
> - [`references/lint-rules.md`](references/lint-rules.md) — 四级检查规则的完整定义
> - [`scripts/lint.py`](scripts/lint.py) — 通用 Lint 脚本（写入临时文件后执行）
>
> **Do NOT load** `scripts/evaluate.py` 或 `references/templates.md` — 这些仅用于 wiki-evaluate / wiki-ingest。

1. **读取 SCHEMA.md**：获取 Lint 规则定义
2. **执行 Lint 脚本**：
   - 读取本技能 `scripts/lint.py`，写入项目临时文件 `<project>/_lint.py`
   - 运行：`python _lint.py <wiki_root>`（可选 `--config <wiki>/lint-config.yaml`）
   - 脚本自动从 SCHEMA.md 推导目录结构，也可通过 `--config` 加载自定义配置
   - **运行结束后删除 `_lint.py`**（工作区清洁度规则）
3. **分析报告**：根据脚本输出的红/黄/蓝/清洁度结果

   | 级别 | 含义 | 处理 |
   |------|------|------|
   | 红色 | 必须修复 | 断链、frontmatter 缺失、目录违规、孤立页面 |
   | 黄色 | 建议修复 | 页面过大、标签不一致、新鲜度低、缺少交叉引用 |
   | 蓝色 | 可选优化 | 标签密度、描述丰富度、参见链接数 |
   | 清洁度 | 工作区卫生 | 项目目录残留临时文件 |

4. **输出报告**：按级别列出问题，附修复建议
5. **工作区清理**：删除 lint.py 副本及任何临时文件


### Lint 脚本（按需加载）

> Agent 执行 wiki-lint 时，按以下步骤操作：
> 1. 读取本技能目录下 `scripts/lint.py` 的文件内容
> 2. 将脚本内容写入项目临时文件 `<project>/_lint.py`
> 3. 运行：`python _lint.py <wiki_root>`（可选 `--config <wiki>/lint-config.yaml`）
> 4. 如知识库无 `lint-config.yaml`，可从 `scripts/lint-config.schema.yaml` 复制模板
> 5. **运行结束后删除 `_lint.py`**（工作区清洁度规则）
>
> 脚本为**通用框架**，不绑定特定知识库内容。所有知识库特定配置（目录定义、阈值等）通过 `lint-config.yaml` 或 SCHEMA.md 自动推导。


---

## wiki-update — 知识更新

> wiki-update 是**页面级编辑方法**，直接修改已有 Wiki 页面的内容。
> 若需从源文档导入新内容，请使用 wiki-ingest（自动检测增量）。

### 与 wiki-ingest 的边界

| | wiki-ingest | wiki-update |
|--|-------------|-------------|
| **操作对象** | 源文档（raw/） → Wiki 页面 | Wiki 页面直接编辑 |
| **触发场景** | 新增文档、首次建库、全量重建 | 页面内容有误、需人工修正、级联修改引用 |
| **用户意图** | "摄入""ingest""导入新文档" | "更新""update""修改某页面""修正" |

> **简单判断**：如果涉及 `raw/` 中的文档 → ingest；如果只涉及 `wiki/` 中的页面 → update。

### 触发条件

用户说"更新""update""修改某个页面"等，**不涉及**源文档新增。

### 执行步骤

> 开始更新前，先问自己：
> - **范围边界**：这次修改会影响多少关联页面？是否需要级联？
> - **字段安全**：哪些字段绝对不能动？（sources、created、slug）
> - **回滚准备**：如果改错了，能否从 log.md 追溯到变更前的状态？

1. **确定更新范围**：

   | 类型 | 触发 | 操作 |
   |------|------|------|
   | 单页更新 | 用户指定页面，指出具体修改内容 | 读取 → 修改 → 生成 diff → 确认写入 |
   | 级联更新 | 某实体变更影响多个关联页面 | 扫描引用图 → 批量修改关联页 → 确认写入 |

2. **读取现有页面**：记录当前 frontmatter 和内容结构
3. **生成 diff**：展示修改前后的差异
4. **确认后写入**：用户确认后更新页面
5. **更新 `<wiki>/index.md`**：刷新统计数据
6. **追加 `<wiki>/log.md`**：记录变更

### 核心约束

- 源文档不可变——只在 Wiki 层修改
- 更新后必须更新 `updated` 字段
- `log.md` 只追加，不删改历史

### 级联更新决策流程

当修改内容涉及其他页面引用的实体名称、slug、或核心定义时，按以下流程判断：

| 变更类型 | 是否需要级联 | 级联范围 |
|----------|-------------|----------|
| 实体名称/标题变更 | **必须级联** | 所有引用该实体的概念页、对比页、index.md |
| 核心定义变更 | **必须级联** | 相关概念页的引用段落 |
| 标签增删 | 建议级联 | 同类型页面的标签一致性 |
| 正文细节修正 | 无需级联 | 仅当前页面 |
| 格式/排版调整 | 无需级联 | 仅当前页面 |

**级联执行顺序**：先改被引用实体页 → 再改所有引用页 → 最后更新 index.md

### 绝对禁止

- **NEVER** 修改 `sources` 字段（来源信息由 ingest 维护，手动修改会破坏溯源链）
- **NEVER** 修改 `created` 日期（创建时间不可变）
- **NEVER** 修改实体 `slug`（除非同时级联更新所有交叉引用——这是高风险操作，需用户明确确认）
- **NEVER** 在未读取关联页面的情况下执行级联更新（必须先扫描引用图，确认影响范围后列出给用户确认）
- **NEVER** 跳过 diff 展示直接写入（用户必须看到修改前后的差异）

---

## wiki-evaluate — 质量评估

### 触发条件

用户说"评估知识库""evaluate""质量评分""健康检查"等。

### 五大评估维度

| 维度 | 权重 | 衡量内容 | 计算方式 |
|------|------|----------|----------|
| 覆盖率 | 25% | 对领域知识的覆盖完整度 | 已有页面 / SCHEMA.md 定义页面 |
| 新鲜度 | 25% | 内容时效性 | 加权平均（按页面类型权重） |
| 互联度 | 20% | 页面间交叉引用密度 | 入链率 × 出链率 × 链接密度比 |
| 置信度 | 15% | 信息来源质量 | high×1.0 + medium×0.6 + low×0.3 |
| 一致性 | 15% | 规范遵循度 | frontmatter完整性 + 标签规范 + 模板遵循 + 术语一致（相关页面术语共享率） |

### 执行步骤

> **MANDATORY — READ ENTIRE FILE**：执行前必须完整读取 [`scripts/evaluate.py`](scripts/evaluate.py) — 五维评分脚本（覆盖率25%/新鲜度25%/互联度20%/置信度15%/一致性15%，一致性维度使用混合算法）。
>
> **Do NOT load** `scripts/lint.py` 或 `references/lint-rules.md` — 这些仅用于 wiki-lint。

1. **执行评估脚本**：
   - 读取本技能 `scripts/evaluate.py`，写入项目临时文件 `<project>/_evaluate.py`
   - 运行：`python _evaluate.py <wiki_root>`（可选 `--verbose`）
   - 脚本内含五维评分算法，一致性维度使用混合算法
   - **运行结束后删除 `_evaluate.py`**（工作区清洁度规则）
2. **收集数据**（手动方式，脚本不可用时）：扫描所有页面，收集 frontmatter、引用关系、字符数
3. **五维计算**：逐维度评分（公式见上表）
4. **综合评分**：加权求和，评级 A(85+) / B(70-84) / C(55-69) / D(<55)
5. **生成报告**：输出评分表 + 各维度详情 + 改进建议
6. **追加 `<wiki>/log.md>`**

### 一致性算法与脚本加载

术语一致性检测衡量"同类页面之间的标签规范遵循程度"。

> **经验教训**：跨类型全局 Jaccard 标签相似度会导致不合理低分——实体页面标签丰富（5-8 个），概念页面标签精简（3-4 个），两类标签交集天然小、Jaccard 值必然偏低。这不是知识库质量问题，而是算法与知识库结构不匹配。

**算法：同类型组内标签 Jaccard 相似度**

```
1. 按页面 type 分组 → 组内两两计算 Jaccard 相似度
2. 组内均值 = mean(所有两两 Jaccard 值)
3. 全局一致性 = 各组均值的加权平均
```

混合算法（`scripts/evaluate.py` 已内含实现）：字段完整 40% + 标签规范 30% + 同类型组内 Jaccard 30%。

**备选**（标签体系不成熟时）：结构一致性（frontmatter 必填字段完整性）或相关页面术语共享率。

> **脚本加载**：Agent 读取 `scripts/evaluate.py` → 写入 `<project>/_evaluate.py` → `python _evaluate.py <wiki_root>` → **运行结束后删除**。脚本为通用框架，不绑定特定知识库内容。


### 新鲜度计算

| updated 距今天数 | 得分 |
|-----------------|------|
| 0-7 天 | 1.0 |
| 8-30 天 | 0.8 |
| 31-90 天 | 0.5 |
| 91-180 天 | 0.2 |
| > 180 天 | 0.0 |

### 页面权重

| 页面类型 | 权重 |
|----------|------|
| entities/ | 1.5 |
| concepts/ | 1.0 |
| comparisons/ | 1.0 |
| queries/ | 0.5 |

---

## 核心约束

### 绝对禁止

1. **不修改源文档目录下的任何文件**——源文档是不可变的原始素材层
2. **不从记忆回答领域问题**——所有领域信息必须来自 Wiki 页面
3. **不跳过 SCHEMA.md**——执行 ingest/lint/update 前必须先读取 `<wiki>/SCHEMA.md`
4. **不创建 Wiki 目录以外的知识产出物**
5. **不删除 log.md 中的历史记录**
6. **不在项目目录残留临时文件**——每次操作结束后必须清理

### 操作规范

1. **执行计时**：每个方法（design/init/ingest/query/lint/update/evaluate）开始时记录当前时间，执行结束后计算并输出实际耗时（如 `wiki-design 完成，耗时 3 分 22 秒`）
2. **Ingest 流程**：先讨论后写入——先展示提取要点，确认后再生成
3. **交叉引用**：每次创建/更新页面后检查并更新关联页面的引用
4. **log.md 维护**：每次操作后追加一条日志（含执行耗时）
5. **index.md 维护**：每次 ingest/update 后更新统计数据
6. **工作区清洁度**：每次操作结束后检查并清理项目目录下的非知识库文件
7. **脚本执行方式**：需运行 Python 代码时，使用 Write 工具写入 `.py` 文件再执行，避免在 Bash 中使用 `python -c` 内联执行（bash 对嵌套引号和括号的处理不稳定）
8. **清理失败处理**：若 Bash `rm` 删除临时文件时被平台拒绝（需用户确认），不要反复重试。改为使用 Edit 工具将文件内容清空（写入单个空格），并在 log.md 中记录待手动清理的文件路径

---

## 参考文件

| 文件 | 何时读取 | 互斥规则 |
|------|----------|----------|
| `references/schema-guide.md` | wiki-design 时，编写 SCHEMA.md 的详细指南 | 不与其他文件同时加载 |
| `references/templates.md` | wiki-ingest 时，三类页面模板的完整定义 | 仅 ingest 使用 |
| `references/ingest-workflow.md` | wiki-ingest Phase 2–3 时，**MANDATORY** 完整读取 | 仅 ingest 使用 |
| `references/lint-rules.md` | wiki-lint 时，四级检查规则的完整定义 | 不与 evaluate.py 同时加载 |
| `scripts/lint.py` | wiki-lint 时，按需加载的 lint 脚本（通用框架，配置驱动） | 不与 evaluate.py 同时加载 |
| `scripts/lint-config.schema.yaml` | wiki-lint 时，lint 配置模板（按需复制到知识库） | 仅 lint 使用 |
| `scripts/evaluate.py` | wiki-evaluate 时，按需加载的评估脚本（五维评分，混合一致性算法） | 不与 lint.py / lint-rules.md 同时加载 |

> **按需加载机制**：Agent 读取技能目录下 `scripts/` 中的脚本文件，写入项目临时文件执行，运行后清理；读取 `references/` 中的 Markdown 指导文件以获取详细规范。此机制确保 SKILL.md 保持精简，小上下文模型也能正常加载。

---
name: llm-wiki
description: 通用 LLM Wiki 知识库构建与维护技能。基于"LLM writes, human reads"理念，将原始文档编译为结构化知识库，通过 7 大方法（design → init → ingest → query → lint → update → evaluate）完成知识库全生命周期管理。适用场景：(1) 从零搭建领域知识库（产品文档、技术文档、业务知识等），(2) 将原始文档批量摄入为结构化 Wiki 页面，(3) 基于知识库查询回答领域问题，(4) 检查并修复知识库质量问题，(5) 增量更新已有页面，(6) 评估知识库整体健康度。当用户提到"wiki""知识库""LLM Wiki""知识摄入""知识查询""init wiki""ingest""lint""evaluate"等关键词时触发。
version: '3.5'
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


<!-- ================================================================
捆绑的完整技能附属文件（原技能目录 references/ 与 scripts/ 的全部内容）。
原技能通过「读取技能目录下 references/… 与 scripts/…」按需加载；本插件为自包含部署，
这些文件已全文内联在下方 <llm-wiki-skill-attachment> 块中。会话中凡技能正文要求
「读取 references/X.md」或「读取 scripts/X」时，改为在下方对应块中查找同名标记读取。
================================================================ -->

<!-- ======== BUNDLED: references/schema-guide.md ======== -->
# SCHEMA.md 编写指南

> wiki-design 执行时参考此文件，编写知识库的 `<wiki>/SCHEMA.md`。

---

## SCHEMA.md 位置

**SCHEMA.md 始终位于 `<wiki>/SCHEMA.md`**，即知识库根目录下，与 `index.md`、`log.md` 同级。

```
<project>/<wiki-name>/
└── SCHEMA.md    ← 正确位置
```

**禁止将 SCHEMA.md 放在项目根目录**——项目根目录只放 `raw/` 和 wiki 目录，SCHEMA.md 是知识库的一部分，不是项目配置。

---

## SCHEMA.md 结构模板

```markdown
# <知识库名称> — Wiki 结构规范

> 本文件定义本目录（`<wiki>/`）下所有知识页面的结构约定、页面格式、标签体系与质量规则。

---

## 一、领域定义

| 项 | 说明 |
|----|------|
| 知识库名称 | |
| 领域 | |
| 服务对象 | |
| 知识库理念 | LLM Wiki — "LLM writes, human reads" |
| 维护者 | |

---

## 二、目录约定

```
<wiki>/
├── SCHEMA.md
├── index.md
├── log.md
├── <entities>/       ← 实体页面（按领域命名）
├── concepts/         ← 跨实体概念页面
├── comparisons/      ← 实体对比页面
└── queries/          ← 查询存档
```

### 2.1 <entities>/ — 实体页面

| 文件 | 对应实体 |
|------|----------|
| `<slug>.md` | <实体名称> |

### 2.2 concepts/ — 概念页面

| 文件 | 概念 | 涉及实体数 |
|------|------|-----------|
| `<slug>.md` | <概念名称> | N |

### 2.3 comparisons/ — 对比页面

| 文件 | 对比内容 | 选型场景 |
|------|----------|----------|
| `<slug>-vs-<slug>.md` | <实体A> vs <实体B> | <场景> |

---

## 三、Frontmatter 规范

### 3.1 必填字段

| 字段 | 说明 |
|------|------|
| `title` | 页面标题，与一级标题一致 |
| `tags` | 标签数组，使用标准标签体系 |
| `sources` | 来源文件（相对于源文档目录） |
| `updated` | 最后更新日期 YYYY-MM-DD |
| `confidence` | high / medium / low |

### 3.2 置信度

| 级别 | 含义 |
|------|------|
| high | 直接来自源文档 |
| medium | 多源综合推断 |
| low | 补充推测，待验证 |

### 3.3 可选字段

| 字段 | 说明 |
|------|------|
| `aliases` | 页面别名 |
| `related` | 强关联页面列表 |

---

## 四、标签体系

### 4.1 分类标签

格式：`<前缀>:<值>`

根据领域自定义前缀，例如：

- `product:<代号>`（产品类）
- `module:<模块名>`（模块类）
- `service:<服务名>`（服务类）

### 4.2 属性标签

跨实体的核心能力维度，例如：

- `cap:auth`（认证）
- `cap:deploy`（部署）
- `cap:monitor`（监控）

### 4.3 类型标签

| 标签 | 适用目录 |
|------|----------|
| `type:entity` | entities/ |
| `type:concept` | concepts/ |
| `type:comparison` | comparisons/ |
| `type:query` | queries/ |

### 4.4 层级标签（可选）

若领域有分层结构，增加层级标签，如：

- `layer:exec` / `layer:control` / `layer:support`

---

## 五、页面模板

三类页面模板详见 `references/templates.md`。

---

## 六、交叉引用规则

### 6.1 引用格式

- 相对路径引用：`[text](../concepts/<slug>.md)`
- 在同目录内引用：`[text](<slug>.md)`

### 6.2 强制引用规则

| 页面类型 | 必须引用 |
|----------|----------|
| 实体页 | 关联的概念页 + 关系紧密的其他实体页 |
| 概念页 | 该概念涉及的所有实体页 |
| 对比页 | 双方实体页 |

### 6.3 级联更新规则

- 更新实体页 → 检查引用该实体的概念页和对比页
- 新增实体页 → 更新 index.md
- 重命名页面 → 批量更新所有引用

---

## 七、Lint 规则

三级检查规则 + 工作区清洁度检查，详见 `references/lint-rules.md`。

---

## 八、index.md 规范

包含以下章节：

1. 实体清单（代号/名称/层级/描述/页面链接）
2. 概念清单（名称/涉及实体数/页面链接）
3. 对比清单（对比双方/选型场景/页面链接）
4. 统计数据（总页面数/各目录页面数/最近操作/最近更新）

每次 ingest/lint/update 后必须更新。

---

## 九、log.md 规范

只追加，永不删改历史。

格式：

```markdown
## YYYY-MM-DD — <操作类型>

- 操作：wiki-ingest / wiki-lint / wiki-update / wiki-query / wiki-evaluate
- 执行者：Agent
- 输入：操作的源文件或页面列表
- 产出：创建/更新/删除的页面列表
- 备注：特殊情况说明
```

---

## 十、术语表

列出领域内术语的标准定义，确保全库术语一致。

| 术语 | 标准定义 |
|------|----------|
| | |

<!-- ======== BUNDLED: references/templates.md ======== -->
# 页面模板

> wiki-ingest 执行时参考此文件，按模板将源文档编译为结构化 Wiki 页面。

---

## 一、实体页模板

> 用于 `entities/`（或领域自定义目录如 `products/`、`services/`）下的实体页面。

### 完整结构

```markdown
---
title: <实体全称>
tags: [type:entity, <分类标签>, <属性标签>...]
sources:
  - <source1.md>
  - <source2.md>
updated: YYYY-MM-DD
confidence: high
aliases: [<别名>]
related: [<强关联页面>]
---

# <实体全称>

> <一句话定位，说明该实体是什么、做什么>

## 定位

<2-3 句概述实体的角色定位、核心职责。不展开细节，仅建立读者心智模型。>

## 核心能力

| 能力 | 说明 |
|------|------|
| <能力1> | <简述> |
| <能力2> | <简述> |
| ... | ... |

## 架构

<描述实体的内部架构或组件构成。若源文档有架构图，用文字描述结构关系。>

### 技术架构

- <组件1>：职责
- <组件2>：职责
- ...

## 关系

<描述该实体与其他实体的交互关系。>

| 关系对象 | 关系类型 | 说明 |
|----------|----------|------|
| <实体A> | 上游/下游/协作/依赖 | <简述> |
| ... | ... | ... |

## 场景

<描述该实体的典型使用场景。>

### 场景 1：<场景名称>

- **目标**：<场景要达成的目标>
- **方式**：<该实体如何参与>
- **输出**：<预期产出>

### 场景 2：<场景名称>

...

## 部署 / 配置

<若适用，描述部署要求、配置要点、前提条件。>

| 项目 | 要求 |
|------|------|
| 前提条件 | |
| 部署方式 | |
| 配置要点 | |

## 参见

- [概念页：概念名](../concepts/<slug>.md)
- [对比页：A vs B](../comparisons/<a>-vs-<b>.md)
- [实体页：关联实体](<slug>.md)
```

### 各章节编写要点

| 章节 | 要点 |
|------|------|
| 定位 | 第一段建立认知锚点，回答"这是什么" |
| 核心能力 | 列表形式，每项一句话；从源文档提取，不自行发挥 |
| 架构 | 描述组成结构；若源文档无架构信息则省略 |
| 关系 | 只列直接交互的实体；间接关系放在概念页 |
| 场景 | 每个场景包含目标/方式/输出三要素 |
| 部署/配置 | 仅当源文档包含部署信息时填写，否则省略 |
| 参见 | 至少包含 2 个交叉引用；概念优先，对比其次 |

---

## 二、概念页模板

> 用于 `concepts/` 下的跨实体概念页面。

### 完整结构

```markdown
---
title: <概念名称>
tags: [type:concept, <属性标签>...]
sources:
  - <source1.md>
updated: YYYY-MM-DD
confidence: high
aliases: [<别名>]
---

# <概念名称>

> <一句话定义，用最简练的语言解释这个概念>

## 定义

<精确的概念定义。回答"这个概念是什么"，避免循环定义。>

## 涉及实体

| 实体 | 关联方式 | 说明 |
|------|----------|------|
| <实体A> | <核心/辅助/可选> | <该实体中如何体现此概念> |
| <实体B> | <核心/辅助/可选> | <该实体中如何体现此概念> |
| ... | ... | ... |

## 工作机制

<描述该概念的工作原理或运作方式。>

### 核心流程

1. <步骤1>
2. <步骤2>
3. ...

### 关键参数

| 参数 | 说明 | 典型值 |
|------|------|--------|
| <参数1> | <含义> | <默认或推荐值> |

## 注意事项

- **要点1**：<可能导致问题的注意项>
- **要点2**：<常见误区或边界情况>

## 参见

- [实体页：实体A](../entities/<slug>.md)
- [实体页：实体B](../entities/<slug>.md)
- [概念页：关联概念](<slug>.md)
```

### 各章节编写要点

| 章节 | 要点 |
|------|------|
| 定义 | 精确简洁，避免与别名重复；可引用外部定义 |
| 涉及实体 | 列出所有与此概念关联的实体；标注关联强度 |
| 工作机制 | 若源文档描述了流程则按步骤写；否则用段落描述原理 |
| 注意事项 | 从源文档提取；无明确注意事项则省略 |
| 参见 | 必须引用涉及的所有实体页 |

---

## 三、对比页模板

> 用于 `comparisons/` 下的实体对比页面。

### 完整结构

```markdown
---
title: <实体A> vs <实体B>
tags: [type:comparison, <分类标签>...]
sources:
  - <source1.md>
  - <source2.md>
updated: YYYY-MM-DD
confidence: high
---

# <实体A> vs <实体B>

> <一句话总结两者的核心差异>

## 对比概览

| 维度 | <实体A> | <实体B> |
|------|---------|---------|
| 定位 | <一句话> | <一句话> |
| 核心能力 | <关键能力> | <关键能力> |
| 适用规模 | <适用场景规模> | <适用场景规模> |
| 复杂度 | <低/中/高> | <低/中/高> |

## 详细对比

| 对比维度 | <实体A> | <实体B> |
|----------|---------|---------|
| <维度1> | | |
| <维度2> | | |
| <维度3> | | |
| ... | | |

> 维度选择原则：优先选择影响选型决策的关键差异点。

## 适用场景

### 选择 <实体A> 的场景

- <场景描述>
- <场景描述>

### 选择 <实体B> 的场景

- <场景描述>
- <场景描述>

### 两者均可的场景

- <场景描述>

## 选择建议

<给出明确的选型建议，帮助读者做出决策。>

> **简单规则**：<一句话快速决策标准>

## 参见

- [实体页：<实体A>](../entities/<a-slug>.md)
- [实体页：<实体B>](../entities/<b-slug>.md)
- [概念页：相关概念](../concepts/<slug>.md)
```

### 各章节编写要点

| 章节 | 要点 |
|------|------|
| 对比概览 | 4-6 个高维度对比，快速建立整体认知 |
| 详细对比 | 6-12 个具体维度；每个维度内用简短文字或关键指标对比 |
| 适用场景 | 场景导向，帮读者判断"我属于哪种情况" |
| 选择建议 | 明确结论，避免模棱两可 |
| 参见 | 必须引用对比双方实体页 |

---

## 四、通用编写规则

### 内容来源

- 所有内容必须来自 `sources` 字段标注的源文档
- 若需补充源文档未覆盖的信息，在 frontmatter 中降低 `confidence` 为 `medium` 或 `low`
- 禁止凭训练数据或记忆编造领域事实

### 格式要求

- 一级标题与 `title` 字段完全一致
- 表格用于结构化信息（能力列表、参数列表、对比维度）
- 列表用于并列项（步骤、场景、注意事项）
- 引用块 `>` 用于强调定义、总结、建议
- 页面总长度建议控制在 200-500 行

### frontmatter 字段检查

```markdown
---
# 必填
title:    # 一级标题同名
tags:     # 至少包含 type: 标签 + 1个分类标签
sources:  # 至少 1个源文档（路径相对于 raw/ 目录）
updated:  # YYYY-MM-DD
confidence: # high/medium/low

# 可选
aliases:  # 搜索别名
related:  # 强关联页面
---
```

### 交叉引用

- 每个页面至少 2 个参见链接
- 实体页参见：概念页优先 > 对比页 > 其他实体页
- 概念页参见：涉及的所有实体页
- 对比页参见：双方实体页 + 相关概念页
- 引用格式使用相对路径 Markdown 链接

<!-- ======== BUNDLED: references/ingest-workflow.md ======== -->
# Ingest 核心工作流：Phase 2–3

> 本文档是 woi-llmwiki 技能的一部分。Agent 在进入 wiki-ingest 的 Phase 2 之前**必须完整读取本文档**。
> 本文档包含大量"必须遵守"的约束，违反将导致页面质量参差、交叉引用缺失或工作区污染。

---

## Phase 2：分批并行提取（核心耗时）

**调度策略**：

```
待处理队列 = [实体1, 实体2, ..., 实体N, 概念1, ..., 对比1, ...]

WHILE 队列非空:
    取出 min(MAX_CONCURRENT_AGENTS, 队列长度) 个任务 → 当前批次
    并行启动 Agent 处理当前批次
    等待所有 Agent 完成（超时 AGENT_TIMEOUT 则标记失败）
    对失败任务执行 MAX_RETRIES 次重试（缩小范围：只处理最核心的 3 篇源文档）
    仍失败则记录到 log.md，由主 Agent 兜底处理
    更新 log.md 记录本批进度
END WHILE
```

> **⚠ Phase 2 批次完整性约束（必须遵守）**
>
> Phase 2 是结构化提取的核心步骤，**禁止主 Agent 提前跳过剩余批次直接进入 Phase 3**。
>
> | 禁止行为 | 原因 |
> |---------|------|
> | 主 Agent 在 Phase 2 中段决定跳过 Batch 3–6，直接进入 Phase 3 | 剩余页面由主 Agent 直接生成而非子 Agent 结构化提取，导致产出质量参差（交叉引用缺失、结构化深度不一致、互联度偏低） |
> | 主 Agent 自行读取源文档代替子 Agent 提取 | 子 Agent 返回的结构化 JSON 包含完整的 see_also、frontmatter、分章节要点；主 Agent 直接生成时容易遗漏交叉引用，导致互联度偏低 |
> | 以下一代执行了 x 个子 Agent | 模糊进度，无法追溯 |
>
> **允许的特殊情况**（需在 log.md 中明确记录原因）：
> - 用户主动要求跳过某批次
> - 全部子 Agent 在 MAX_RETRIES 后仍失败，主 Agent 兜底处理
>
> **日志要求**：每批次完成后在 log.md 中记录：批次编号、处理的页面列表、子 Agent 成功/失败数、累计进度（如 `Batch 2/6 完成：5/28 页面已提取`）。
> Phase 2 结束时记录最终摘要：总批次数、成功提取页面数、失败页面数（如有）、总耗时。

**每个 Agent 的任务（简化 prompt）**：
- 输入：实体/概念名称 + 分配的源文档列表 + 页面类型（实体/概念/对比）
- 输出：结构化提取结果（JSON 格式），包含：
  - frontmatter 字段（title/tags/sources/updated/confidence）
  - 正文各章节的要点（列表/表格形式，非完整 Markdown）
- **不要求 Agent 生成最终 Markdown 文件**，只提取结构化信息

> **⚠ 子Agent 输出路径约束（必须遵守）**
>
> 主 Agent 在启动 Phase 2 前，**必须先创建 `<wiki>/.ingest-cache/` 目录**，并在每个子Agent的 prompt 中**显式指定完整的 JSON 输出路径**：
>
> ```
> 输出路径 = <wiki>/.ingest-cache/<entity-slug>.json
> 示例：<wiki>/.ingest-cache/<slug>.json
> ```
>
> | 禁止的输出路径 | 原因 |
> |--------------|------|
> | `raw/` 或 `raw/output/` | 污染源文档目录（不可变层） |
> | `entities/`、`output/` 或项目根目录 | 违反工作区清洁度规则 C1 |
> | 中文或含空格的文件名 | 跨平台路径兼容性问题 |
> | 子Agent自行决定的路径 | 导致主Agent无法定位和收集结果 |
>
> **子Agent prompt 模板**：
> ```
> 你是知识提取助手。请从以下源文档中提取结构化信息。
>
> **提取目标**：<实体/概念名称>
> **页面类型**：entity / concept / comparison
> **源文档**：<文档路径列表>
> （若文档较长，只提供关键段落摘要，或指示子Agent用 Read 工具自行读取完整文件。避免在 prompt 中嵌入完整长文档）
>
> **输出要求**：返回 JSON 对象，结构如下：
> {"slug": "...", "type": "...", "frontmatter": {...}, "sections": {...}}
>
> **参见字段约束（必须遵守）**：
> - JSON 中不得包含独立的"参见"或"see_also"字段，交叉引用由主Agent在Phase 3统一生成
> - 若需表达页面间关联，在 sections 的末尾添加 "_see_also_candidates" 字段，
>   值为字符串数组，每个元素只能是以下两种格式之一：
>   (a) SCHEMA.md 中已定义的页面 slug（如 "deepseek"、"ai-agent-framework"）
>   (b) 源文档中明确提及但 SCHEMA.md 未定义的候选名称
>   主Agent将仅采用 (a) 类候选生成参见链接
>
> **JSON 输出格式约束（必须遵守）**：
> - JSON 字符串值中**禁止使用中文引号**（“”‘’《》「」 等）
> - 若需在字符串值中表达引用或强调，使用以下替代方式：
>   (a) 全角符号：『引用内容』、〈引用内容〉
>   (b) 书名号：《引用内容》
>   (c) 直接去掉引号，用逗号或顿号分隔
> - 违反此约束将导致 JSON 解析失败（JSONDecodeError），主Agent将无法正确处理输出
> - 此约束同时适用于子Agent直接返回的 JSON 和写入文件的 JSON
>
> 将结果写入：<wiki>/.ingest-cache/<slug>.json
> 若无法写入文件，直接在回复中返回JSON文本即可。
> ```
>
> **路径规范**：所有路径使用正斜杠 `/`，Windows 盘符格式（如 `D:/workspace/...`）。
>
> **子Agent写入失败的常见情况**：多数平台的子Agent（general-purpose）无文件写入权限，
> 主Agent应在每个 Batch 完成后**一次检查**缓存目录，若为空则从子Agent内联返回中提取JSON，
> 用 Write 工具手动写入缓存（参见 Phase 2.5 降级策略）。
>
> **⚠ Phase 2 期间禁止检查 .ingest-cache/ 目录（必须遵守）**：
> 子Agent执行期间和每个子Agent完成后，**不要执行 `ls`/`ls -la` 等命令检查 `.ingest-cache/` 目录**。
> 子Agent的结果收集和缓存写入统一在 Phase 2.5 中完成。
> 这样做的原因：实测中主Agent因在 Phase 2 阶段反复 ls 浪费了大量执行时间。

---

## Phase 2.5：子Agent输出收集与降级处理

**目标**：收集Phase 2所有子Agent的提取结果，处理失败情况。

**收集流程（必须严格按以下步骤执行）**：

> **⚠ 目录检查原则（必须遵守）**：
> - 子Agent完成每个 Batch 后，主Agent**直接从子Agent内联返回中提取 JSON 并写入缓存**，
>   不依赖子Agent是否成功写入文件（多平台子Agent文件写入权限不确定）。
> - 验证已写入文件时，使用 `Read` 工具读取目标 JSON 文件，而非 `ls` 列出目录（部分平台 `ls` 行为不可靠）。
> - **禁止反复检查目录**——写入一次后直接进入下一步，不要用 `ls` 确认写入是否成功。

```
对每个 Batch（循环执行）：

  1. 等待该 Batch 所有子Agent完成
  2. 收集该 Batch 子Agent的内联返回文本（无论子Agent是否声称已写入文件）
  3. 从内联文本中提取 JSON（见下方 JSON 提取模板）
  4. 用 Write 工具将 JSON 写入 <wiki>/.ingest-cache/<slug>.json
  5. 直接进入下一个 Batch

全部 Batch 完成后：
  6. 用 Read 工具逐个读取已写入的 JSON 文件，验证解析成功
  7. 若某个 JSON 解析失败，用下方 JSON 容错模板修复后重新写入
  8. 进入 Phase 3
```

**JSON 提取模板（从子Agent内联文本中提取）**：

当子Agent返回的文本中包含 JSON 时，按以下优先级提取：

```
优先级 1：提取 ```json ... ``` 代码块中的内容
优先级 2：提取 { ... } 花括号包裹的完整 JSON 对象
优先级 3：从非结构化文本中手动提取 slug / type / frontmatter / sections 字段
```

提取后使用下方"JSON 容错解析模板"解析，解析成功后用 Write 工具写入。

> **平台差异说明**：不同平台的子Agent文件写入权限差异较大。
> 部分平台子Agent可直接写入文件，部分平台完全禁止。
> 主Agent应根据实际检查结果灵活处理——若子Agent成功写入，直接使用缓存文件；若未写入，从内联返回提取。

> **JSON 容错解析模板（可直接复制到脚本中使用）**：
>
> 以下函数在 Phase 2.5（主Agent内联写入）和 Phase 3（组装脚本）中**必须使用**：
>
> ```python
> def safe_json_load(text_or_path, is_file=False):
>     """容错 JSON 解析。优先直接解析，失败后按错误位置定位修复。
>     Args:
>         text_or_path: JSON 字符串，或文件路径（is_file=True 时）
>         is_file: 是否从文件读取
>     Returns:
>         dict or None（解析完全失败时返回 None）
>     """
>     import json
>     if is_file:
>         with open(text_or_path, 'r', encoding='utf-8') as f:
>             raw = f.read()
>     else:
>         raw = text_or_path
>     try:
>         return json.loads(raw)
>     except json.JSONDecodeError:
>         pass
>     fixed = raw
>     for attempt in range(5):
>         try:
>             return json.loads(fixed)
>         except json.JSONDecodeError as e:
>             if attempt >= 4:
>                 return None
>             flines = fixed.split('\n')
>             ln = e.lineno - 1
>             col = e.colno - 1
>             if ln < 0 or ln >= len(flines) or col < 0 or col >= len(flines[ln]):
>                 return None
>             line = flines[ln]
>             start = max(0, col - 80)
>             end = min(len(line), col + 80)
>             seg = line[start:end]
>             for off in range(col - start, len(seg)):
>                 if seg[off] == '"' and (off == 0 or seg[off-1] != '\\'):
>                     before = seg[:off].rstrip()
>                     if before.endswith(':') or before.endswith(','):
>                         continue
>                     seg = seg[:off] + '\u201c' + seg[off+1:]
>                     break
>             flines[ln] = line[:start] + seg + line[end:]
>             fixed = '\n'.join(flines)
>     return None
> ```
>
> **关键约束**：
> - Phase 2.5 中主Agent内联写入 JSON 时，先调用 `safe_json_load(json_text)` 验证
> - Phase 3 组装脚本中，使用 `safe_json_load(filepath, is_file=True)` 读取每个 JSON 缓存
> - 返回 `None` 的文件**禁止跳过**，必须修复：
>
> **修复流程（safe_json_load 返回 None 时）**：
> 1. 用 Read 工具读取该 JSON 文件（或查看原始文本）
> 2. 根据 JSONDecodeError 的 lineno 定位错误行
> 3. 用 Edit 工具修复该行中未转义的引号（将内容引号替换为中文引号 `"`/`"`）
> 4. 重新调用 `safe_json_load` 验证修复成功
> 5. 修复成功后用 Write 工具重新写入文件
> 6. **禁止编写独立修复脚本**（如 `_fix_*.py`），必须使用 Read + Edit 逐步修复

**数据标准化**：无论通过哪种渠道收集，最终统一为以下JSON结构：
```json
{
  "slug": "entity-slug",
  "type": "entity|concept|comparison",
  "frontmatter": {"title": "...", "tags": [...], ...},
  "sections": {"定位": "...", "核心能力": "...", ...}
}
```

---

## Phase 3：合并与组装

1. **收集所有 Agent 的提取结果**
2. **按 SCHEMA.md 的页面模板**将结构化数据渲染为最终 Markdown

   > **组装方式约束（必须遵守）**：
   > - 页面数 ≤ 10：逐页渲染（读取JSON → 按模板手动写入Markdown），禁止编写脚本
   > - 页面数 11~30：允许编写轻量组装脚本（仅文件 I/O + 模板填充），但：
   >   (1) 所有目录名使用上方路径规范表中的固定值
   >   (2) 禁止 `f"{type}s"` 等动态拼接方式生成目录名
   >   (3) JSON 解析**必须复制 Phase 2.5 的 `safe_json_load()` 模板**，禁止自行实现容错逻辑
   >   (4) 读取 JSON 后用 `data.get('_see_also_candidates', [])` 获取候选字段（禁止 `data['_see_also_candidates']`，对比页面可能不含该字段）
   >   (5) 脚本运行失败时**禁止编写额外修复脚本**（如 `_fix_*.py`），改为逐个处理失败的 JSON
>   (6) 从技能目录复制 lint.py / evaluate.py 到项目时，**禁止修改脚本代码**（直接原样复制运行即可）
   > - 页面数 > 30：允许编写完整组装脚本（同上要求）

   > **章节渲染规范（必须遵守）**：
   > - section_map 中定义的首个章节（实体页"定位"、概念页"定义"、对比页"对比概览"）
   >   必须渲染为 `## 章节名` 格式的 Markdown 二级标题
   > - 禁止将该章节内容渲染为 blockquote（`> ...`）或其他格式

3. **写入页面**到对应目录（`entities/`、`concepts/`、`comparisons/`）：
   - **增量模式**：读取已有页面内容，将新提取的信息**合并**到对应章节（而非覆盖）
   - 合并规则：保留已有内容不丢失，新增内容追加到相关章节，`sources` 字段追加新文档
   - **全量模式**：直接覆盖写入（首次 ingest 无需合并）
4. **交叉引用检查**：确保每个页面的"参见"章节引用正确

   > **参见链接路径规范（必须遵守）**：
   > 生成"参见"章节的 Markdown 链接时，目录名**必须使用以下固定映射**，禁止自行拼接：
   >
   > | 页面类型 | 目标目录 | 正确示例 | 错误示例 |
   > |---------|---------|---------|---------|
   > | entity | `entities/` | `[实体A](../entities/slug-a.md)` | ~~`../entitys/`~~ |
   > | concept | `concepts/` | `[概念B](../concepts/slug-b.md)` | ~~`../concepts/`~~ |
   > | comparison | `comparisons/` | `[对比](../comparisons/a-vs-b.md)` | ~~`../comparisons/`~~ |
   >
   > **禁止**使用 `f"{type}s"` 等动态拼接方式生成目录名。

5. **更新 `<wiki>/index.md`**：更新统计数据
6. **追加 `<wiki>/log.md`**：记录本次操作（含分批进度、失败重试情况）

<!-- ======== BUNDLED: references/lint-rules.md ======== -->
# Lint 规则

> wiki-lint 执行时参考此文件，按四级规则检查知识库质量。

---

## 一、检查级别

| 级别 | 含义 | 处理要求 |
|------|------|----------|
| **红色** | 阻断性缺陷，必须立即修复 | 修复后重新运行 lint |
| **黄色** | 质量隐患，建议尽快修复 | 记录到报告，安排修复 |
| **蓝色** | 优化建议，可选改进 | 记录到报告，按优先级排期 |
| **清洁度** | 工作区卫生问题，应立即清理 | 删除残留文件后重新运行 lint |

---

## 二、红色规则（必须修复）

### R1：断链检测

**规则**：所有 `[text](path)` 和 `[[page]]` 引用必须指向存在的文件。

**检查方法**：
1. 扫描每个页面的正文，提取所有 Markdown 链接路径
2. 将相对路径解析为 Wiki 根目录下的绝对路径
3. 检查文件是否存在

**报告格式**：

```
[R1] 断链: <页面> → 引用 <目标路径>，文件不存在
```

**修复建议**：更新引用路径或创建缺失页面。

### R2：frontmatter 必填字段缺失

**规则**：每个页面必须包含以下 5 个 frontmatter 字段：`title`、`tags`、`sources`、`updated`、`confidence`。

**检查方法**：
1. 解析每个页面的 YAML frontmatter
2. 逐项检查必填字段是否存在

**报告格式**：

```
[R2] frontmatter 缺失: <页面> 缺少 <字段名>
```

**修复建议**：补充缺失字段。

### R3：目录违规

**规则**：所有知识页面必须位于 SCHEMA.md 定义的目录中。

**检查方法**：
1. 读取 SCHEMA.md 中的目录定义
2. 检查 Wiki 根目录下是否有不在定义目录中的 .md 文件（排除 `SCHEMA.md`、`index.md`、`log.md`）

**报告格式**：

```
[R3] 目录违规: <文件路径> 不在 SCHEMA.md 定义的目录中
```

**修复建议**：移动文件到正确目录，或更新 SCHEMA.md 扩展目录定义。

### R4：孤立页面

**规则**：每个页面必须至少被 1 个其他页面引用。

**检查方法**：
1. 构建全库引用图（页面 A → 页面 B）
2. 检查入链数为 0 的页面（被 `index.md` 引用不视为有效入链）

**报告格式**：

```
[R4] 孤立页面: <页面> 无任何入链引用
```

**修复建议**：在相关页面的"参见"章节添加对孤立页面的引用。

---

## 三、黄色规则（建议修复）

### Y1：页面过大

**规则**：单个页面正文（不含 frontmatter）不超过 800 行或 30,000 字符。

**检查方法**：
1. 统计每个页面去掉 frontmatter 后的行数和字符数
2. 超过阈值标记为黄色

**报告格式**：

```
[Y1] 页面过大: <页面> — <行数> 行 / <字符数> 字符
```

**修复建议**：拆分为多个页面，或将部分内容移至概念页。

### Y2：标签不一致

**规则**：同一实体在不同页面中的分类标签必须一致。

**检查方法**：
1. 提取所有页面的分类标签（`type:entity` 之外的前缀标签）
2. 检查同一实体名是否使用不同的标签值

**报告格式**：

```
[Y2] 标签不一致: 实体 <名称> 在 <页面A> 使用 <标签A>，在 <页面B> 使用 <标签B>
```

**修复建议**：统一标签命名。

### Y3：新鲜度低

**规则**：页面 `updated` 字段距今超过 90 天视为低新鲜度。

**检查方法**：
1. 解析每个页面的 `updated` 日期
2. 计算与当前日期的天数差
3. 超过 90 天标记为黄色

**报告格式**：

```
[Y3] 新鲜度低: <页面> — 上次更新 <日期>，距今 <天数> 天
```

**修复建议**：检查源文档是否有更新，如有则执行 wiki-update。

### Y4：缺少交叉引用

**规则**：每个页面的"参见"章节至少包含 2 个外部链接。

**检查方法**：
1. 提取每个页面"参见"章节中的链接数量
2. 少于 2 个标记为黄色

**报告格式**：

```
[Y4] 参见不足: <页面> — 仅 <数量> 个交叉引用
```

**修复建议**：分析页面内容，添加相关概念页或实体页的引用。

### Y5：缺少 type 标签

**规则**：每个页面必须包含与其所在目录匹配的 `type:` 标签。

**匹配规则**：

| 目录 | 标签 |
|------|------|
| entities/ 或领域实体目录 | `type:entity` |
| concepts/ | `type:concept` |
| comparisons/ | `type:comparison` |
| queries/ | `type:query` |

**报告格式**：

```
[Y5] 缺少 type 标签: <页面> 位于 <目录> 但 tags 中无 type:<type>
```

**修复建议**：在 frontmatter 的 tags 数组中添加正确的 type 标签。

---

## 四、蓝色规则（可选优化）

### B1：标签密度

**规则**：每个页面建议包含 3-8 个标签。

**检查方法**：
1. 统计每个页面的标签数量
2. 少于 3 个或超过 8 个标记为蓝色

**报告格式**：

```
[B1] 标签密度: <页面> — <数量> 个标签（建议 3-8 个）
```

### B2：描述丰富度

**规则**：页面的"定位"或"定义"章节（根据页面类型）建议不少于 50 字。

**检查方法**：
1. 根据页面类型定位到对应章节
2. 统计章节文本字符数
3. 少于 50 字标记为蓝色

**报告格式**：

```
[B2] 描述不足: <页面> — <章节名> 仅 <字符数> 字符（建议 >= 50）
```

### B3：参见链接数

**规则**：实体页建议至少 3 个参见链接，概念页和对比页至少 2 个。

**检查方法**：
1. 统计每个页面"参见"章节中的链接数
2. 低于建议值标记为蓝色

**报告格式**：

```
[B3] 参见偏少: <页面> — <数量> 个交叉引用（实体页建议 >= 3）
```

### B4：别名缺失

**规则**：实体页建议设置 `aliases` 字段，包含常用简称或别名。

**检查方法**：
1. 检查实体类型页面的 frontmatter 中是否有 `aliases` 字段
2. 缺失标记为蓝色

**报告格式**：

```
[B4] 别名缺失: <页面> — 建议添加 aliases 字段
```

---

## 五、清洁度检查（工作区卫生）

### C1：项目根目录残留文件

**规则**：项目根目录下只允许 `raw/` 和 wiki 目录，不得残留临时文件。

**检查方法**：
1. 列出项目根目录下所有文件（排除 `raw/`、wiki 目录、`.git/`）
2. 检查是否存在以下类型的残留文件：
   - `*.py`（临时脚本）
   - `*_report.html` 或 `*.html`（构建报告）
   - `.cowork-temp/`（运行时目录）
   - `*.tmp`、`*.log`（临时文件）
   - 其他非知识库文件

**报告格式**：

```
[C1] 残留文件: <项目根目录>/<文件名> — 非知识库文件，应清理
```

**修复建议**：直接删除残留文件。若需保留构建报告，应将其移出项目目录或放入 wiki 目录的专门位置。

### C2：SCHEMA.md 位置检查

**规则**：SCHEMA.md 必须位于 `<wiki>/SCHEMA.md`，不得放在项目根目录。

**检查方法**：
1. 检查项目根目录是否存在 SCHEMA.md
2. 检查 wiki 目录下是否存在 SCHEMA.md
3. 若 SCHEMA.md 在根目录而非 wiki 下，标记为清洁度问题

**报告格式**：

```
[C2] SCHEMA.md 位置错误: 在项目根目录而非 <wiki>/ 目录下，应移入 wiki
```

**修复建议**：将 SCHEMA.md 从项目根目录移入 wiki 目录。

---

## 六、检查流程

```
输入：Wiki 根目录路径 + SCHEMA.md

1. 扫描页面 → 收集所有 .md 文件
2. 解析 frontmatter → 提取元数据
3. 构建引用图 → 解析所有链接
4. 执行红色规则 → R1-R4
5. 执行黄色规则 → Y1-Y5
6. 执行蓝色规则 → B1-B4
7. 执行清洁度检查 → C1-C2
8. 汇总报告 → 按级别分组，附修复建议
```

---

## 七、报告模板

```markdown
# Wiki Lint 报告

**扫描时间**：YYYY-MM-DD HH:MM
**扫描页面数**：N
**SCHEMA.md**：已加载 / 未找到

## 摘要

| 级别 | 数量 |
|------|------|
| 红色（必须修复） | N |
| 黄色（建议修复） | N |
| 蓝色（可选优化） | N |
| 清洁度（应清理） | N |

## 红色问题

- [R1] 断链: ...
- ...

## 黄色问题

- [Y1] 页面过大: ...
- ...

## 蓝色建议

- [B1] 标签密度: ...
- ...

## 清洁度问题

- [C1] 残留文件: ...
- [C2] SCHEMA.md 位置: ...

## 修复优先级

1. 先修复所有红色问题
2. 清理清洁度问题
3. 按影响范围排序黄色问题
4. 蓝色建议按需处理
```

<!-- ======== BUNDLED: scripts/lint-config.schema.yaml ======== -->
# Wiki Lint 配置文件模板

# 用法: 复制此文件到知识库根目录，重命名为 lint-config.yaml，按需修改参数
# lint.py 会自动加载知识库根目录下的 lint-config.yaml（如存在）

# -----------------------------------------------
# 目录定义（通常由 SCHEMA.md 自动推导，也可手动指定）
# -----------------------------------------------
# directories:
#   entities: entities
#   concepts: concepts
#   comparisons: comparisons
#   queries: queries

# -----------------------------------------------
# 目录与 type 标签的映射关系
# -----------------------------------------------
# type_tag_map:
#   entities: "type:entity"
#   concepts: "type:concept"
#   comparisons: "type:comparison"
#   queries: "type:query"

# -----------------------------------------------
# 必填 frontmatter 字段
# -----------------------------------------------
# required_fields:
#   - title
#   - tags
#   - sources
#   - updated
#   - confidence

# -----------------------------------------------
# 检查阈值（按知识库特征调整）
# -----------------------------------------------
thresholds:
  # Y1: 页面大小上限
  page_max_lines: 800
  page_max_chars: 30000

  # Y3: 新鲜度阈值（天）
  freshness_days: 90

  # Y4: 最少交叉引用数
  min_cross_refs: 2

  # B3: 实体页最少交叉引用数
  min_entity_cross_refs: 3

  # B1: 标签密度范围
  tag_density_min: 3
  tag_density_max: 8

  # B2: 描述章节最少字符数
  min_description_chars: 50

# -----------------------------------------------
# 排除文件（不出现在 lint 扫描中）
# -----------------------------------------------
# excluded_files:
#   - SCHEMA.md
#   - index.md
#   - log.md
#   - .gitignore

# -----------------------------------------------
# 页面类型与检查章节的映射
# 用于 B2 描述丰富度检查
# -----------------------------------------------
# section_map:
#   entity: "定位"
#   concept: "定义"
#   comparison: "对比概览"
<!-- ======== BUNDLED: scripts/lint.py ======== -->
\python
#!/usr/bin/env python3
"""
Wiki Lint — 通用质量检查框架（配置驱动）

用法:
  python lint.py <wiki_root> [--config <lint-config.yaml>] [--fix] [--verbose]

特性:
  - 框架层（通用）: frontmatter解析、引用图构建、报告输出 — 所有知识库复用
  - 规则配置层（知识库特定）: 标签体系、阈值、目录定义 — 从 lint-config.yaml 读取
  - 支持从 SCHEMA.md 自动推导目录和页面清单

设计原则:
  - 使用 yaml.safe_load() 解析 frontmatter，不使用手工正则解析 YAML
  - 所有文本匹配默认使用 re.DOTALL
  - 规则参数可配置，不硬编码
"""

import os
import re
import sys
import yaml
import json
import argparse
from pathlib import Path
from datetime import datetime, date
from collections import defaultdict

# ============================================================
# 配置默认值（可被 lint-config.yaml 覆盖）
# ============================================================

DEFAULT_CONFIG = {
    "directories": {
        "entities": "entities",
        "concepts": "concepts",
        "comparisons": "comparisons",
        "queries": "queries"
    },
    "required_fields": ["title", "tags", "sources", "updated", "confidence"],
    "type_tag_map": {
        "entities": "type:entity",
        "concepts": "type:concept",
        "comparisons": "type:comparison",
        "queries": "type:query"
    },
    "thresholds": {
        "page_max_lines": 800,
        "page_max_chars": 30000,
        "freshness_days": 90,
        "min_cross_refs": 2,
        "min_entity_cross_refs": 3,
        "tag_density_min": 3,
        "tag_density_max": 8,
        "min_description_chars": 50
    },
    "excluded_files": ["SCHEMA.md", "index.md", "log.md", ".gitignore"],
    "section_map": {
        "entity": "定位",
        "concept": "定义",
        "comparison": "对比概览"
    }
}


def load_config(config_path=None, wiki_root=None):
    """加载配置：lint-config.yaml > DEFAULT_CONFIG"""
    config = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy

    if config_path and os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = yaml.safe_load(f)
        if user_config:
            for key in user_config:
                if isinstance(user_config[key], dict) and isinstance(config.get(key), dict):
                    config[key].update(user_config[key])
                else:
                    config[key] = user_config[key]

    # 尝试从 SCHEMA.md 推导目录结构
    if wiki_root:
        schema_path = os.path.join(wiki_root, "SCHEMA.md")
        if os.path.exists(schema_path):
            config = merge_schema_config(schema_path, config)

    return config


def merge_schema_config(schema_path, config):
    """从SCHEMA.md中提取目录定义，覆盖config中的directories"""
    with open(schema_path, 'r', encoding='utf-8') as f:
        content = f.read()

    dir_pattern = re.compile(r'├──\s+(\w[-\w]*)/', re.DOTALL)
    dirs = dir_pattern.findall(content)

    if dirs:
        config["directories"] = {}
        config["type_tag_map"] = {}
        for d in dirs:
            config["directories"][d] = d
            if d in DEFAULT_CONFIG["type_tag_map"]:
                config["type_tag_map"][d] = DEFAULT_CONFIG["type_tag_map"][d]
            else:
                config["type_tag_map"][d] = f"type:{d.rstrip('s')}"

    return config


# ============================================================
# Frontmatter 解析
# ============================================================

def parse_frontmatter(filepath):
    """
    解析 Markdown 文件的 frontmatter 和正文。
    使用 yaml.safe_load() 而非手工正则解析 YAML。

    Returns:
        (meta_dict, body_str) 或 (None, content) 如果没有 frontmatter
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    if not content.startswith('---'):
        return None, content

    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, content

    fm_str = parts[1].strip()
    body = parts[2].lstrip('\n')

    try:
        meta = yaml.safe_load(fm_str)
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}

    return meta, body


def normalize_tags(tags):
    """
    标准化标签列表，兼容多种 YAML 格式:
      - tags: [type:entity, topic:ai-coding]         (无引号内联数组)
      - tags: ["type:entity", "topic:ai-coding"]    (有引号)
      - tags:                                        (列表形式)
        - type:entity
    """
    if not tags:
        return []
    if isinstance(tags, str):
        return [tags.strip()]
    if isinstance(tags, list):
        result = []
        for t in tags:
            if isinstance(t, str):
                result.append(t.strip())
        return [r for r in result if r]
    return []


# ============================================================
# 页面收集与引用图
# ============================================================

def collect_pages(wiki_root, config):
    """收集所有 wiki 页面"""
    pages = []
    dirs = config["directories"].values()
    excluded = set(config["excluded_files"])

    for d in dirs:
        dir_path = os.path.join(wiki_root, d)
        if not os.path.isdir(dir_path):
            continue
        for fname in os.listdir(dir_path):
            if fname.endswith('.md') and fname not in excluded:
                full_path = os.path.join(dir_path, fname)
                pages.append(full_path)

    return pages


def build_reference_graph(wiki_root, pages):
    """构建页面引用图: {page_path: set(linked_page_paths)}"""
    graph = defaultdict(set)

    for page in pages:
        _, body = parse_frontmatter(page)
        links = re.findall(r'\[([^\]]*)\]\(([^)]+\.md)\)', body, re.DOTALL)
        for _, link_path in links:
            abs_link = os.path.normpath(os.path.join(os.path.dirname(page), link_path))
            if os.path.exists(abs_link) and abs_link != page:
                graph[page].add(abs_link)

    return graph


# ============================================================
# 检查规则实现
# ============================================================

class LintResult:
    def __init__(self, level, rule_id, message, page=None, fix_hint=None):
        self.level = level
        self.rule_id = rule_id
        self.message = message
        self.page = page
        self.fix_hint = fix_hint

    def __str__(self):
        loc = ""
        if self.page:
            try:
                wiki_parent = os.path.dirname(self.page).rsplit(os.sep, 1)[0]
                loc = os.path.relpath(self.page, wiki_parent)
            except (ValueError, IndexError):
                loc = os.path.basename(self.page)
        hint = f"  → {self.fix_hint}" if self.fix_hint else ""
        return f"[{self.rule_id}] {self.message}: {loc}{hint}"


# --- 红色规则 ---

def check_R1_broken_links(pages, graph):
    """R1: 断链检测"""
    results = []
    for page in pages:
        _, body = parse_frontmatter(page)
        links = re.findall(r'\[([^\]]*)\]\(([^)]+\.md)\)', body, re.DOTALL)
        for _, link_path in links:
            abs_link = os.path.normpath(os.path.join(os.path.dirname(page), link_path))
            if not os.path.exists(abs_link):
                results.append(LintResult(
                    "RED", "R1", f"断链: 引用 '{link_path}' 文件不存在",
                    page=page, fix_hint="更新引用路径或创建缺失页面"
                ))
    return results


def check_R2_missing_fields(pages, config):
    """R2: frontmatter 必填字段缺失"""
    results = []
    required = config["required_fields"]
    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta is None:
            results.append(LintResult(
                "RED", "R2", "frontmatter 完全缺失",
                page=page, fix_hint="添加 YAML frontmatter"
            ))
            continue
        for field in required:
            if field not in meta:
                results.append(LintResult(
                    "RED", "R2", f"frontmatter 缺失字段: {field}",
                    page=page, fix_hint=f"补充 {field} 字段"
                ))
    return results


def check_R3_directory_violation(wiki_root, pages, config):
    """R3: 目录违规"""
    results = []
    allowed_dirs = set(config["directories"].values())
    excluded = set(config["excluded_files"])

    for item in os.listdir(wiki_root):
        item_path = os.path.join(wiki_root, item)
        if item.startswith('.'):
            continue
        if os.path.isfile(item_path) and item.endswith('.md') and item not in excluded:
            results.append(LintResult(
                "RED", "R3", f"目录违规: {item} 不在 SCHEMA.md 定义的目录中",
                page=item_path, fix_hint="移动到正确目录或更新 SCHEMA.md"
            ))
        elif os.path.isdir(item_path) and item not in allowed_dirs:
            for fname in os.listdir(item_path):
                if fname.endswith('.md'):
                    results.append(LintResult(
                        "RED", "R3", f"目录违规: {item}/{fname} 不在 SCHEMA.md 定义的目录中",
                        page=os.path.join(item_path, fname), fix_hint="移动到正确目录"
                    ))
    return results


def check_R4_orphan_pages(pages, graph):
    """R4: 孤立页面（无入链）"""
    results = []
    in_links = defaultdict(int)
    for page, linked in graph.items():
        for target in linked:
            in_links[target] += 1

    for page in pages:
        if in_links[page] == 0:
            results.append(LintResult(
                "RED", "R4", "孤立页面: 无任何入链引用",
                page=page, fix_hint="在相关页面的'参见'章节添加引用"
            ))
    return results


# --- 黄色规则 ---

def check_Y1_page_too_large(pages, config):
    """Y1: 页面过大"""
    results = []
    max_lines = config["thresholds"]["page_max_lines"]
    max_chars = config["thresholds"]["page_max_chars"]
    for page in pages:
        _, body = parse_frontmatter(page)
        if body.count('\n') > max_lines or len(body) > max_chars:
            line_count = body.count('\n')
            char_count = len(body)
            results.append(LintResult(
                "YELLOW", "Y1", f"页面过大: {line_count}行/{char_count}字符",
                page=page, fix_hint="拆分为多个页面或将部分内容移至概念页"
            ))
    return results


def check_Y3_freshness(pages, config):
    """Y3: 新鲜度低"""
    results = []
    max_days = config["thresholds"]["freshness_days"]
    today = date.today()
    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta is None:
            continue
        updated_str = str(meta.get("updated", ""))
        try:
            updated_date = datetime.strptime(updated_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            results.append(LintResult(
                "YELLOW", "Y3", f"updated 格式无效: '{updated_str}'",
                page=page, fix_hint="修正为 YYYY-MM-DD 格式"
            ))
            continue
        days_diff = (today - updated_date).days
        if days_diff > max_days:
            results.append(LintResult(
                "YELLOW", "Y3", f"新鲜度低: 上次更新 {updated_str}，距今 {days_diff} 天",
                page=page, fix_hint="检查源文档是否有更新，执行 wiki-update"
            ))
    return results


def check_Y4_missing_cross_refs(pages, graph, config):
    """Y4: 交叉引用不足"""
    results = []
    min_refs = config["thresholds"]["min_cross_refs"]
    for page in pages:
        out_count = len(graph.get(page, set()))
        if out_count < min_refs:
            results.append(LintResult(
                "YELLOW", "Y4", f"交叉引用不足: 仅 {out_count} 个（建议 >={min_refs}）",
                page=page, fix_hint="在'参见'章节添加引用"
            ))
    return results


def check_Y5_type_tag(pages, config):
    """Y5: 缺少 type 标签"""
    results = []
    type_map = config["type_tag_map"]
    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta is None:
            continue
        rel_path = os.path.relpath(page, os.path.dirname(page).rsplit(os.sep, 1)[0])
        parts = rel_path.split(os.sep)
        dir_name = parts[0] if len(parts) > 1 else ""
        expected_type = type_map.get(dir_name)
        if not expected_type:
            continue
        tags = normalize_tags(meta.get("tags", []))
        if not any(expected_type in str(t) for t in tags):
            results.append(LintResult(
                "YELLOW", "Y5", f"缺少 type 标签: 应包含 '{expected_type}'（位于 {dir_name}/）",
                page=page, fix_hint=f"在 tags 中添加 {expected_type}"
            ))
    return results


# --- 蓝色规则 ---

def check_B1_tag_density(pages, config):
    """B1: 标签密度"""
    results = []
    min_tags = config["thresholds"]["tag_density_min"]
    max_tags = config["thresholds"]["tag_density_max"]
    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta is None:
            continue
        tags = normalize_tags(meta.get("tags", []))
        count = len(tags)
        if count < min_tags or count > max_tags:
            results.append(LintResult(
                "BLUE", "B1", f"标签密度: {count} 个（建议 {min_tags}-{max_tags}）",
                page=page, fix_hint="添加或移除标签"
            ))
    return results


def check_B2_description_richness(pages, config):
    """B2: 描述丰富度"""
    results = []
    min_chars = config["thresholds"]["min_description_chars"]
    section_map = config["section_map"]
    type_map = config["type_tag_map"]

    for page in pages:
        meta, body = parse_frontmatter(page)
        if meta is None:
            continue

        # 确定页面类型 → 要检查的章节
        tags = normalize_tags(meta.get("tags", []))
        rel_path = os.path.relpath(page, os.path.dirname(page).rsplit(os.sep, 1)[0])
        parts = rel_path.split(os.sep)
        dir_name = parts[0] if len(parts) > 1 else ""

        section_name = None
        for type_key, section in section_map.items():
            expected_type = type_map.get(type_key, f"type:{type_key}")
            dir_val = config["directories"].get(type_key, "")
            if any(expected_type in str(t) for t in tags) or dir_name == dir_val:
                section_name = section
                break

        if not section_name:
            continue

        # 提取章节内容（re.DOTALL + re.MULTILINE 跨行匹配）
        pattern = re.compile(
            rf'^##\s+{re.escape(section_name)}\s*\n([\s\S]*?)(?=\n##\s|\Z)',
            re.MULTILINE
        )
        match = pattern.search(body)
        if match:
            char_count = len(match.group(1).strip())
            if char_count < min_chars:
                results.append(LintResult(
                    "BLUE", "B2", f"描述不足: '{section_name}' 仅 {char_count} 字符（建议 >={min_chars}）",
                    page=page, fix_hint="扩展该章节内容"
                ))
        else:
            results.append(LintResult(
                "BLUE", "B2", f"描述不足: 缺少 '{section_name}' 章节",
                page=page, fix_hint="添加该章节"
            ))
    return results


def check_B3_cross_ref_count(pages, graph, config):
    """B3: 参见链接数（实体页>=3，其他>=2）"""
    results = []
    min_entity = config["thresholds"]["min_entity_cross_refs"]
    min_other = config["thresholds"]["min_cross_refs"]

    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta is None:
            continue
        tags = normalize_tags(meta.get("tags", []))
        is_entity = any("type:entity" in str(t) for t in tags)
        min_refs = min_entity if is_entity else min_other
        out_count = len(graph.get(page, set()))
        if out_count < min_refs:
            results.append(LintResult(
                "BLUE", "B3", f"参见偏少: {out_count} 个（{'实体页' if is_entity else '概念/对比页'}建议 >={min_refs}）",
                page=page, fix_hint="在'参见'章节添加相关链接"
            ))
    return results


# --- 清洁度检查 ---

def check_C1_workspace_clean(project_root, wiki_root):
    """C1: 工作区清洁度"""
    results = []
    wiki_name = os.path.basename(wiki_root)

    for item in os.listdir(project_root):
        if item in ['raw', wiki_name, '.git', '.cowork-temp'] or item.startswith('.'):
            continue
        item_path = os.path.join(project_root, item)
        if os.path.isfile(item_path):
            ext = os.path.splitext(item)[1]
            if ext in ['.py', '.html', '.tmp', '.json', '.log'] or ext == '.md':
                results.append(LintResult(
                    "CLEAN", "C1", f"残留文件: {item}",
                    page=item_path, fix_hint="删除"
                ))
        elif os.path.isdir(item_path):
            results.append(LintResult(
                "CLEAN", "C1", f"残留目录: {item}/",
                page=item_path, fix_hint="删除"
            ))
    return results


# ============================================================
# 主入口
# ============================================================

def run_lint(wiki_root, config=None, verbose=False):
    """执行完整的 lint 检查，返回结构化结果"""
    wiki_root = os.path.abspath(wiki_root)
    project_root = os.path.dirname(wiki_root)

    if config is None:
        config = load_config(wiki_root=wiki_root)

    pages = collect_pages(wiki_root, config)
    graph = build_reference_graph(wiki_root, pages)

    all_results = []

    # 红色
    all_results.extend(check_R1_broken_links(pages, graph))
    all_results.extend(check_R2_missing_fields(pages, config))
    all_results.extend(check_R3_directory_violation(wiki_root, pages, config))
    all_results.extend(check_R4_orphan_pages(pages, graph))

    # 黄色
    all_results.extend(check_Y1_page_too_large(pages, config))
    all_results.extend(check_Y3_freshness(pages, config))
    all_results.extend(check_Y4_missing_cross_refs(pages, graph, config))
    all_results.extend(check_Y5_type_tag(pages, config))

    # 蓝色
    all_results.extend(check_B1_tag_density(pages, config))
    all_results.extend(check_B2_description_richness(pages, config))
    all_results.extend(check_B3_cross_ref_count(pages, graph, config))

    # 清洁度
    all_results.extend(check_C1_workspace_clean(project_root, wiki_root))

    summary = {"RED": 0, "YELLOW": 0, "BLUE": 0, "CLEAN": 0}
    for r in all_results:
        summary[r.level] = summary.get(r.level, 0) + 1

    return {
        "summary": summary,
        "results": all_results,
        "pages_count": len(pages),
        "wiki_root": wiki_root,
        "project_root": project_root,
        "config": config
    }


def print_report(output, verbose=False):
    """格式化输出 lint 报告"""
    summary = output["summary"]
    total = output["pages_count"]
    results = output["results"]

    print(f"\n{'='*60}")
    print(f"  Wiki Lint Report")
    print(f"  Pages: {total}  |  "
          f"RED: {summary['RED']}  |  "
          f"YELLOW: {summary['YELLOW']}  |  "
          f"BLUE: {summary['BLUE']}  |  "
          f"CLEAN: {summary['CLEAN']}")
    print(f"{'='*60}")

    for level, label in [("RED", "RED (must fix)"), ("YELLOW", "YELLOW (should fix)"),
                          ("BLUE", "BLUE (optional)"), ("CLEAN", "CLEAN (cleanup)")]:
        level_results = [r for r in results if r.level == level]
        if level_results or verbose:
            print(f"\n--- {label} ({len(level_results)}) ---")
            for r in level_results:
                print(f"  {r}")

    if summary["RED"] > 0 or summary["CLEAN"] > 0:
        print(f"\n--- Priority ---")
        if summary["RED"] > 0:
            print("  1. Fix all RED issues")
        if summary["CLEAN"] > 0:
            print("  2. Clean workspace")
        if summary["YELLOW"] > 0:
            print("  3. Fix YELLOW issues by impact")
        if summary["BLUE"] > 0:
            print("  4. BLUE issues as needed")
    print()


def main():
    parser = argparse.ArgumentParser(description="Wiki Lint — Knowledge Base Quality Checker")
    parser.add_argument("wiki_root", help="Wiki root directory path")
    parser.add_argument("--config", help="lint-config.yaml path (optional)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show all levels")
    args = parser.parse_args()

    config = load_config(config_path=args.config, wiki_root=args.wiki_root)
    output = run_lint(args.wiki_root, config=config, verbose=args.verbose)
    print_report(output, verbose=args.verbose)

    if output["summary"]["RED"] > 0:
        sys.exit(1)
    elif output["summary"]["YELLOW"] > 0:
        sys.exit(2)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
\\n
<!-- ======== BUNDLED: scripts/evaluate.py ======== -->
\python
#!/usr/bin/env python3
"""
Wiki Evaluate — 知识库质量评估脚本（五维评分）

用法:
  python evaluate.py <wiki_root> [--config <eval-config.yaml>] [--verbose]

五维评估:
  1. 覆盖率 (25%): SCHEMA定义的页面是否全部生成
  2. 新鲜度 (25%): 页面 updated 字段的时效性
  3. 互联度 (20%): 页面间交叉引用密度
  4. 置信度 (15%): sources 标注质量
  5. 一致性 (15%): 同类页面标签规范遵循度

一致性算法说明:
  使用同类型页面组内标签Jaccard相似度（实体vs实体、概念vs概念），
  而非跨类型全局计算，避免异构页面天然标签差异导致的不合理低分。
"""

import os
import re
import sys
import yaml
import argparse
from datetime import datetime, date
from collections import defaultdict
from pathlib import Path


# ============================================================
# 配置
# ============================================================

DEFAULT_WEIGHTS = {
    "coverage": 0.25,
    "freshness": 0.25,
    "interlink": 0.20,
    "confidence": 0.15,
    "consistency": 0.15
}

PAGE_TYPE_WEIGHTS = {
    "entity": 1.5,
    "concept": 1.0,
    "comparison": 1.0,
    "query": 0.5
}

FRESHNESS_SCORES = [
    (7, 1.0),
    (30, 0.8),
    (90, 0.5),
    (180, 0.2),
    (99999, 0.0)
]

DEFAULT_DIRS = {
    "entities": "entities",
    "concepts": "concepts",
    "comparisons": "comparisons",
    "queries": "queries"
}

TYPE_TAG_MAP = {
    "entities": "type:entity",
    "concepts": "type:concept",
    "comparisons": "type:comparison",
    "queries": "type:query"
}


# ============================================================
# Frontmatter 解析
# ============================================================

def parse_frontmatter(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    if not content.startswith('---'):
        return None, content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, content
    try:
        meta = yaml.safe_load(parts[1].strip())
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}
    return meta, parts[2].lstrip('\n')


def normalize_tags(tags):
    if not tags:
        return []
    if isinstance(tags, str):
        return [tags.strip()]
    if isinstance(tags, list):
        return [t.strip() for t in tags if isinstance(t, str) and t.strip()]
    return []


# ============================================================
# 页面收集
# ============================================================

def collect_pages(wiki_root):
    pages = []
    for dir_name in DEFAULT_DIRS.values():
        dir_path = os.path.join(wiki_root, dir_name)
        if not os.path.isdir(dir_path):
            continue
        for root, dirs, files in os.walk(dir_path):
            for fname in files:
                if fname.endswith('.md'):
                    pages.append(os.path.join(dir_path, fname))
    return pages


def get_page_type(page_path, wiki_root):
    """根据目录或标签判断页面类型"""
    meta, _ = parse_frontmatter(page_path)
    rel = os.path.relpath(page_path, wiki_root)
    dir_name = rel.split(os.sep)[0]

    # 先检查标签
    if meta:
        tags = normalize_tags(meta.get("tags", []))
        for type_val in tags:
            if type_val.startswith("type:"):
                type_str = type_val.split(":", 1)[1]
                return type_str

    # 再检查目录
    for dir_key, type_val in TYPE_TAG_MAP.items():
        if dir_name == dir_key:
            return type_val.split(":")[1]

    return "unknown"


def load_schema_pages(wiki_root):
    """从SCHEMA.md中提取定义的页面清单，支持多种格式：
    1. 表格中的反引号文件名: | `slug.md` | ...
    2. Markdown链接: [text](slug.md)
    """
    schema_path = os.path.join(wiki_root, "SCHEMA.md")
    if not os.path.exists(schema_path):
        return set()

    with open(schema_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 过滤代码块内容（模板示例中的 <slug>.md 等占位符不应被计为页面定义）
    content_no_blocks = re.sub(r'```[\s\S]*?```', '', content)

    # 过滤特定非页面定义章节（源文档映射、术语表等）
    skip_sections = ['源文档映射', '术语表', '缩略语']
    for section_title in skip_sections:
        pattern = rf'##\s+[^]*{section_title}[\s\S]*?(?=##\s|\Z)'
        content_no_blocks = re.sub(pattern, '', content_no_blocks)

    slugs = set()
    # 方式1: 表格中的反引号文件名 (如 | `claude-code.md` |) — 仅在非代码块内容中匹配
    backtick_files = re.findall(r'`([\w-]+\.md)`', content_no_blocks)
    for fname in backtick_files:
        slug = fname.replace('.md', '')
        if slug and slug not in ('index', 'log', 'SCHEMA', 'README'):
            slugs.add(slug)

    # 方式2: Markdown链接 — 仅在非代码块内容中匹配
    links = re.findall(r'\[([^\]]*)\]\(([^)]+\.md)\)', content_no_blocks, re.DOTALL)
    for _, link in links:
        slug = os.path.basename(link).replace('.md', '')
        if slug and slug not in ('index', 'log'):
            slugs.add(slug)

    return slugs


# ============================================================
# 五维评估
# ============================================================

def eval_coverage(pages, wiki_root):
    """覆盖率：已有页面 / SCHEMA定义页面"""
    schema_slugs = load_schema_pages(wiki_root)
    if not schema_slugs:
        # 无SCHEMA定义时，按已生成页面数给满分
        return 100.0, "SCHEMA.md 未定义页面清单，默认满分"

    existing_slugs = set()
    for p in pages:
        slug = os.path.basename(p).replace('.md', '')
        existing_slugs.add(slug)

    matched = len(schema_slugs & existing_slugs)
    total = len(schema_slugs)
    score = (matched / total) * 100 if total > 0 else 100.0
    detail = f"已生成 {matched}/{total} 个定义页面"
    if matched < total:
        missing = schema_slugs - existing_slugs
        detail += f"（缺失: {', '.join(sorted(missing)[:5])}{'...' if len(missing) > 5 else ''}）"
    return score, detail


def eval_freshness(pages):
    """新鲜度：按页面类型加权平均"""
    today = date.today()
    type_scores = defaultdict(list)

    for page in pages:
        meta, _ = parse_frontmatter(page)
        if not meta:
            continue
        updated_str = str(meta.get("updated", ""))
        try:
            updated_date = datetime.strptime(updated_str, "%Y-%m-%d").date()
            days_diff = (today - updated_date).days
        except (ValueError, TypeError):
            days_diff = 99999

        score = 0.0
        for threshold, val in FRESHNESS_SCORES:
            if days_diff <= threshold:
                score = val
                break

        ptype = get_page_type(page, os.path.dirname(page))
        type_scores[ptype].append(score)

    if not type_scores:
        return 100.0, "无页面数据"

    weighted_sum = 0.0
    total_weight = 0.0
    for ptype, scores in type_scores.items():
        avg = sum(scores) / len(scores)
        w = PAGE_TYPE_WEIGHTS.get(ptype, 1.0)
        weighted_sum += avg * w
        total_weight += w

    overall = (weighted_sum / total_weight) * 100 if total_weight > 0 else 100.0
    detail_parts = []
    for ptype, scores in type_scores.items():
        avg = sum(scores) / len(scores)
        detail_parts.append(f"{ptype}={avg:.2f}")
    return overall, ", ".join(detail_parts)


def eval_interlink(pages, wiki_root):
    """互联度：入链率 x 出链率 x 链接密度"""
    # 构建引用图
    graph = defaultdict(set)
    all_links = 0
    for page in pages:
        _, body = parse_frontmatter(page)
        links = re.findall(r'\[([^\]]*)\]\(([^)]+\.md)\)', body, re.DOTALL)
        for _, link_path in links:
            abs_link = os.path.normpath(os.path.join(os.path.dirname(page), link_path))
            if os.path.exists(abs_link) and abs_link != page:
                graph[page].add(abs_link)
                all_links += 1

    n = len(pages)
    if n == 0:
        return 100.0, "无页面"

    # 出链率：有出链的页面比例
    pages_with_out = sum(1 for p in pages if len(graph.get(p, set())) > 0)
    out_rate = pages_with_out / n

    # 入链率：有入链的页面比例
    in_links = defaultdict(int)
    for p, linked in graph.items():
        for t in linked:
            in_links[t] += 1
    pages_with_in = sum(1 for p in pages if in_links[p] > 0)
    in_rate = pages_with_in / n

    # 链接密度：实际链接数 / 最大可能链接数
    max_links = n * (n - 1)
    density = all_links / max_links if max_links > 0 else 0

    # 归一化到百分制
    # 使用几何平均避免单一维度极低值被掩盖
    import math
    # 将density放大（典型知识库density在0.05-0.15之间）
    norm_density = min(1.0, density * 5)
    score = (math.sqrt(out_rate * in_rate) * 0.6 + norm_density * 0.4) * 100

    detail = f"出链率={out_rate:.2f}, 入链率={in_rate:.2f}, 密度={density:.3f}"
    return min(100.0, score), detail


def eval_confidence(pages):
    """置信度：sources标注质量"""
    type_scores = defaultdict(list)

    for page in pages:
        meta, _ = parse_frontmatter(page)
        if not meta:
            continue
        conf = str(meta.get("confidence", "high")).lower()
        score_map = {"high": 1.0, "medium": 0.6, "low": 0.3}
        score = score_map.get(conf, 0.5)

        # 检查sources字段
        sources = meta.get("sources", [])
        if not sources:
            score *= 0.8  # 无sources降权

        ptype = get_page_type(page, os.path.dirname(page))
        type_scores[ptype].append(score)

    if not type_scores:
        return 100.0, "无页面数据"

    weighted_sum = 0.0
    total_weight = 0.0
    for ptype, scores in type_scores.items():
        avg = sum(scores) / len(scores)
        w = PAGE_TYPE_WEIGHTS.get(ptype, 1.0)
        weighted_sum += avg * w
        total_weight += w

    overall = (weighted_sum / total_weight) * 100 if total_weight > 0 else 100.0

    # 统计置信度分布
    dist = defaultdict(int)
    for page in pages:
        meta, _ = parse_frontmatter(page)
        if meta:
            conf = str(meta.get("confidence", "high")).lower()
            dist[conf] = dist.get(conf, 0) + 1

    detail = ", ".join(f"{k}={v}" for k, v in sorted(dist.items()))
    return overall, detail


def eval_consistency(pages, wiki_root):
    """
    一致性：混合评分 = 字段完整性(40%) + 标签格式规范(30%) + 组内标签Jaccard(30%)
    
    纯Jaccard对标签丰富的知识库得分偏低，混合算法更合理。
    """
    type_pages_meta = defaultdict(list)  # ptype -> list of (tags_set, meta_dict)

    for page in pages:
        meta, _ = parse_frontmatter(page)
        if not meta:
            continue
        tags = set(normalize_tags(meta.get("tags", [])))
        ptype = get_page_type(page, wiki_root)
        type_pages_meta[ptype].append((tags, meta))

    if not type_pages_meta:
        return 100.0, "无页面数据"

    # ---- 维度1: 字段完整性 (40%) ----
    required = ["title", "tags", "sources", "updated", "confidence"]
    field_ok = 0
    field_total = 0
    for ptype, items in type_pages_meta.items():
        for tags, meta in items:
            field_total += len(required)
            for f in required:
                if f in meta and meta[f] is not None:
                    field_ok += 1
    field_score = (field_ok / field_total * 100) if field_total > 0 else 100.0

    # ---- 维度2: 标签格式规范 (30%) ----
    # 检查: 每个页面都有 type: 标签
    type_tag_ok = 0
    type_tag_total = 0
    for ptype, items in type_pages_meta.items():
        for tags, meta in items:
            type_tag_total += 1
            if any(t.startswith("type:") for t in tags):
                type_tag_ok += 1
    tag_format_score = (type_tag_ok / type_tag_total * 100) if type_tag_total > 0 else 100.0

    # ---- 维度3: 组内标签Jaccard (30%) ----
    type_details = []
    type_jaccard_scores = {}
    for ptype, items in type_pages_meta.items():
        tag_sets = [t for t, _ in items]
        if len(tag_sets) < 2:
            type_jaccard_scores[ptype] = 1.0
            type_details.append(f"{ptype}: 仅{len(tag_sets)}页跳过")
            continue
        pairwise_sims = []
        for i in range(len(tag_sets)):
            for j in range(i + 1, len(tag_sets)):
                a, b = tag_sets[i], tag_sets[j]
                union = len(a | b)
                if union == 0:
                    pairwise_sims.append(1.0)
                else:
                    pairwise_sims.append(len(a & b) / union)
        avg_sim = sum(pairwise_sims) / len(pairwise_sims) if pairwise_sims else 1.0
        type_jaccard_scores[ptype] = avg_sim
        type_details.append(f"{ptype}: Jaccard={avg_sim:.3f} ({len(tag_sets)}页)")

    # 加权Jaccard
    weighted_j = 0.0
    total_w = 0.0
    for ptype, items in type_pages_meta.items():
        w = PAGE_TYPE_WEIGHTS.get(ptype, 1.0) * len(items)
        weighted_j += type_jaccard_scores.get(ptype, 1.0) * w
        total_w += w
    jaccard_score = (weighted_j / total_w * 100) if total_w > 0 else 100.0

    # ---- 混合评分 ----
    overall = field_score * 0.40 + tag_format_score * 0.30 + jaccard_score * 0.30

    detail = f"字段完整={field_score:.0f}%, 标签规范={tag_format_score:.0f}%, Jaccard={jaccard_score:.0f}% | " + " | ".join(type_details)
    return overall, detail


# ============================================================
# 报告
# ============================================================

def run_evaluate(wiki_root, weights=None, verbose=False):
    wiki_root = os.path.abspath(wiki_root)
    pages = collect_pages(wiki_root)

    if weights is None:
        weights = DEFAULT_WEIGHTS

    scores = {}

    scores["coverage"], scores["coverage_detail"] = eval_coverage(pages, wiki_root)
    scores["freshness"], scores["freshness_detail"] = eval_freshness(pages)
    scores["interlink"], scores["interlink_detail"] = eval_interlink(pages, wiki_root)
    scores["confidence"], scores["confidence_detail"] = eval_confidence(pages)
    scores["consistency"], scores["consistency_detail"] = eval_consistency(pages, wiki_root)

    # 综合评分
    overall = sum(scores[k] * weights[k] for k in weights)

    # 评级
    if overall >= 85:
        grade = "A"
    elif overall >= 70:
        grade = "B"
    elif overall >= 55:
        grade = "C"
    else:
        grade = "D"

    return {
        "scores": scores,
        "weights": weights,
        "overall": overall,
        "grade": grade,
        "pages_count": len(pages),
        "wiki_root": wiki_root
    }


def print_report(output, verbose=False):
    scores = output["scores"]
    weights = output["weights"]
    overall = output["overall"]
    grade = output["grade"]
    n = output["pages_count"]

    print(f"\n{'='*60}")
    print(f"  Wiki Evaluate Report")
    print(f"  Pages: {n}  |  Overall: {overall:.1f}  |  Grade: {grade}")
    print(f"{'='*60}")

    labels = {
        "coverage": ("覆盖率", "Coverage"),
        "freshness": ("新鲜度", "Freshness"),
        "interlink": ("互联度", "Interlink"),
        "confidence": ("置信度", "Confidence"),
        "consistency": ("一致性", "Consistency")
    }

    print(f"\n{'维度':<12} {'权重':<6} {'得分':<8} {'加权':<8} 详情")
    print("-" * 60)
    for key, (cn, en) in labels.items():
        score = scores[key]
        weight = weights[key]
        weighted = score * weight
        detail_key = f"{key}_detail"
        detail = scores.get(detail_key, "")
        if verbose or len(detail) > 40:
            print(f"  {cn:<10} {weight*100:>4.0f}%  {score:>6.1f}  {weighted:>6.1f}")
            print(f"    {'':>10} {detail}")
        else:
            print(f"  {cn:<10} {weight*100:>4.0f}%  {score:>6.1f}  {weighted:>6.1f}  {detail}")

    print(f"\n  {'综合评分':>10} {'':>4}  {overall:>6.1f}  评级: {grade}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Wiki Evaluate — Knowledge Base Health Assessment")
    parser.add_argument("wiki_root", help="Wiki root directory path")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed breakdown")
    args = parser.parse_args()

    output = run_evaluate(args.wiki_root, verbose=args.verbose)
    print_report(output, verbose=args.verbose)

    if output["grade"] in ("C", "D"):
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
\\n
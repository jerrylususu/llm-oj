# 代码库深入探索答复

本文基于 2026-04-10 对当前仓库主干代码的静态阅读，重点回答评分机制、提交执行安全、后端结构与类型、数据库交互、前端形态五个问题。

## 1. 现在评分机制是怎样的？`public`、`heldout`、`official` 之间差别是什么？

### 结论先说

当前平台真正存在的是：

- 两种评测类型：`public`、`official`
- 三类数据集：`shown`、`hidden`、`heldout`

三者不是同一层概念：

- `public` 是评测模式。它会跑 `shown + hidden`。
- `heldout` 是数据集目录，本身不是一种平台状态。
- `official` 是评测模式。它只在启用 `heldout` 的题目上运行，实际消费的是 `heldout` 数据集。

相关契约直接写在题目 bundle 文档和 Zod schema 里：`shown` 返回逐 case 结果，`hidden` 只返回聚合摘要，`heldout` 仅在 `official` 模式使用。[`docs/problem-bundle.md:7`](docs/problem-bundle.md:7) [`docs/problem-bundle.md:28`](docs/problem-bundle.md:28) [`docs/problem-bundle.md:75`](docs/problem-bundle.md:75) [`packages/shared/src/problem-bundle.ts:42`](packages/shared/src/problem-bundle.ts:42) [`packages/shared/src/problem-bundle.ts:79`](packages/shared/src/problem-bundle.ts:79)

### 平台里的实际数据流

新提交创建时，系统会自动建一个 `public` 类型的 `evaluation_job`，不会自动建 `official` job。[`packages/db/src/platform.ts:769`](packages/db/src/platform.ts:769)

`admin` 手动触发 `/admin/submissions/:id/official-run` 后，才会额外入队一个 `official` job，并且会检查题目的 `heldout_enabled` 是否开启；`official` job 还会拿到更高优先级 `10`。[`apps/api/src/app.ts:712`](apps/api/src/app.ts:712) [`packages/db/src/platform.ts:1179`](packages/db/src/platform.ts:1179)

worker 执行完成后：

- `public` 完成时，submission 会公开，排行榜按 `hidden_summary.score` 更新
- `official` 完成时，只更新 `leaderboard_entries.official_score`

也就是说，排行榜排序依据仍然是 `best_hidden_score`，`official_score` 只是附加字段，不参与替换排序逻辑。[`packages/db/src/platform.ts:1319`](packages/db/src/platform.ts:1319) [`packages/db/src/platform.ts:1396`](packages/db/src/platform.ts:1396) [`packages/db/src/platform.ts:1463`](packages/db/src/platform.ts:1463) [`packages/shared/src/leaderboard.ts:1`](packages/shared/src/leaderboard.ts:1) [`packages/db/src/platform.ts:1497`](packages/db/src/platform.ts:1497)

数据库表设计也把这件事拆得很明确：

- `evaluation_jobs.eval_type` 只有 `public|official`
- `evaluations` 里同时存 `shown_results_json`、`hidden_summary_json`、`official_summary_json`
- `leaderboard_entries` 里分开存 `best_hidden_score` 和 `official_score`

见迁移脚本。[`packages/db/migrations/002_core_platform_tables.sql:58`](packages/db/migrations/002_core_platform_tables.sql:58) [`packages/db/migrations/002_core_platform_tables.sql:77`](packages/db/migrations/002_core_platform_tables.sql:77) [`packages/db/migrations/002_core_platform_tables.sql:93`](packages/db/migrations/002_core_platform_tables.sql:93)

### 当前样例题的具体打分

两个样例题 `sample-sum` 和 `grid-routing` 都是同一套规则：

- `public` 模式下：
  - 跑 `shown`
  - 跑 `hidden`
  - `primary_score = hidden_summary.score`
  - `shown_results` 只是解释和调试信息
- `official` 模式下：
  - 只跑 `heldout`
  - `primary_score = official_summary.score`
  - `shown_results` 为空

见两个 scorer 的实现，逻辑几乎完全对齐。[`examples/problems/sample-sum/v1/scorer/run.py:118`](examples/problems/sample-sum/v1/scorer/run.py:118) [`examples/problems/sample-sum/v1/scorer/run.py:141`](examples/problems/sample-sum/v1/scorer/run.py:141) [`examples/problems/grid-routing/v1/scorer/run.py:226`](examples/problems/grid-routing/v1/scorer/run.py:226) [`examples/problems/grid-routing/v1/scorer/run.py:249`](examples/problems/grid-routing/v1/scorer/run.py:249)

因此，当前语义可以理解为：

- `shown`：公开样例明细，给 agent / 人类看
- `hidden`：public 阶段真正用于排名的分数来源
- `heldout`：official 阶段真正用于泛化观察的分数来源
- `public score`：当前样例题里基本等于 `hidden summary score`
- `official score`：当前样例题里等于 `heldout summary score`

前端模板里也明确写了这一点：当前 `public score` 通常等于 `hidden dataset aggregate`，`official run` 单独展示，不覆盖实时排行榜。[`apps/api/src/ui.ts:1117`](apps/api/src/ui.ts:1117)

## 2. 现在对提交代码的信任程度如何？有安全隔离吗？

### 结论先说

当前实现只能说“有一定误用防护”，不能说“对不可信代码有强安全隔离”。

如果提交代码来源是：

- 内部可控 agent：可以勉强接受
- 外部完全不可信参与者：现在不够安全

这和 README / 技术设计文档的表述一致：目标是降低误用风险，不是强对抗沙箱。[`README.md`](README.md) [`TECH_DESIGN.md`](TECH_DESIGN.md)

### 已有的隔离

在 `RUNNER_MODE=docker` 时，worker 会：

- 用 `docker run --rm`
- `--network none` 禁网
- 将 problem bundle 挂只读
- 将 submission 解包目录挂只读
- 将 output 目录挂可写
- 给整个 `docker run` 设一个进程级 timeout

见 runner 实现。[`apps/worker/src/runner.ts:62`](apps/worker/src/runner.ts:62) [`apps/worker/src/runner.ts:99`](apps/worker/src/runner.ts:99) [`packages/shared/src/config.ts:3`](packages/shared/src/config.ts:3)

### 明显不够的地方

#### 2.1 `local` 模式几乎没有隔离

`RUNNER_MODE=local` 时，直接在宿主机上 `uv run python scorer/run.py`。而 scorer 会继续 `subprocess.run(...)` 执行 submission 的 `main.py`。这意味着提交代码最终就在宿主机 Python 环境里跑，没有容器隔离、没有网络隔离、没有额外权限收缩。[`apps/worker/src/runner.ts:33`](apps/worker/src/runner.ts:33) [`examples/problems/sample-sum/v1/scorer/run.py:31`](examples/problems/sample-sum/v1/scorer/run.py:31) [`examples/problems/grid-routing/v1/scorer/run.py:92`](examples/problems/grid-routing/v1/scorer/run.py:92)

#### 2.2 即使是 `docker` 模式，zip 解包也先发生在宿主机

无论 local 还是 docker，artifact 都先由宿主机执行：

`uv run python -m zipfile -e <artifact> <tmpdir>`

然后才把解压结果挂进容器。也就是说，“处理不可信 zip” 这一步没有容器隔离。[`apps/worker/src/runner.ts:21`](apps/worker/src/runner.ts:21) [`apps/worker/src/runner.ts:104`](apps/worker/src/runner.ts:104)

#### 2.3 只有 timeout，没有真正落实 CPU / 内存限制

设计文档提到未来希望有 CPU / 内存 / 超时限制，但当前真实 `docker run` 命令里只看到了 `--network none`，没有 `--memory`、`--cpus`、`--pids-limit`、`--read-only`、`--cap-drop` 等参数。题目 spec 虽然声明了 `memory_limit_mb`、`time_limit_sec`，但运行层只消费了 timeout，没有把 memory limit 下沉到容器层。[`TECH_DESIGN.md`](TECH_DESIGN.md) [`packages/shared/src/problem-bundle.ts:98`](packages/shared/src/problem-bundle.ts:98) [`apps/worker/src/runner.ts:68`](apps/worker/src/runner.ts:68)

#### 2.4 上传校验很弱

API 对 submission artifact 只做了这些检查：

- base64 能解出来
- 文件头看起来像 zip

没有看到：

- 压缩包大小上限
- 解压后总大小上限
- 文件数量上限
- zip bomb 防护
- 黑名单文件或路径策略

见提交入口。[`apps/api/src/app.ts:387`](apps/api/src/app.ts:387)

#### 2.5 前端查看 artifact 也会在服务端完整读取 zip 内容

公开 submission 的 artifact 预览会在 API 进程里用 `JSZip.loadAsync()` 读取压缩包，并按文件逐个展开到内存统计、抽取文本内容；这里有显示层面的文本大小限制，但不是上传阶段的安全限制。[`apps/api/src/submission-artifact.ts:67`](apps/api/src/submission-artifact.ts:67)

### 可信度判断

我对当前“本地运行提交代码”的信任分级是：

- `RUNNER_MODE=local`：低
- `RUNNER_MODE=docker`：中低

原因不是它完全没做事，而是它只做了最基础的一层：

- 对网络有一定限制
- 对路径挂载有一定限制
- 对执行时长有一定限制

但仍然缺少：

- 强制容器模式
- 解包阶段隔离
- 容器级资源限制
- 更细权限收缩
- 上传时的 zip 大小与结构防护

所以更准确的说法是：当前默认把 submission 当成“半可信代码”，不是“敌对代码”。

## 3. 现在后端结构清晰、TS 类型完备吗？有没有滥用 `any` 或 `as` 强转？

### 结构上：总体清晰

当前结构是比较清楚的单体拆分：

- `apps/api`：HTTP API + HTML 页面
- `apps/worker`：轮询 job、执行评测
- `packages/db`：所有数据库访问、事务、查询
- `packages/shared`：配置、认证、题目 bundle 契约、日志等共享逻辑

从目录和职责划分看，这部分是清楚的。[`package.json`](package.json) [`apps/api/src/app.ts`](apps/api/src/app.ts) [`apps/worker/src/worker.ts`](apps/worker/src/worker.ts)

### TypeScript 基线：不差

TS 编译配置启用了：

- `strict: true`
- `noImplicitOverride: true`
- `noUncheckedIndexedAccess: true`

这说明项目并不是宽松 TS。[`tsconfig.base.json:2`](tsconfig.base.json:2)

另外，我在 `apps/` 和 `packages/` 里没有搜到显式 `any`。这一点是好的。

### 但“类型完备”还谈不上

主要问题不是 `any`，而是“关键 JSON 结构停留在 `unknown`，然后在边缘位置再做 `as` 或弱解析”。

最典型的是评测结果：

- DB 层把 `shownResults`、`hiddenSummary`、`officialSummary` 都定义成 `unknown`
- API 层序列化时继续把它们原样透出
- UI 层再把这些值当作 `Record<string, unknown>` / `Array<Record<string, unknown>>` 去消费
- 排行榜更新时也直接把 `input.hiddenSummary as { score?: number } | null`

相关位置很多，说明这是结构性现象，不是零星个例。[`packages/db/src/platform.ts:91`](packages/db/src/platform.ts:91) [`packages/db/src/platform.ts:153`](packages/db/src/platform.ts:153) [`packages/db/src/platform.ts:1374`](packages/db/src/platform.ts:1374) [`apps/api/src/app.ts:482`](apps/api/src/app.ts:482) [`apps/api/src/ui.ts:919`](apps/api/src/ui.ts:919)

### `as` 使用情况

生产代码里的 `as` 不算泛滥，但有几类值得注意：

- 评测 JSON 从 `unknown` 强转到 `{ score?: number }`
- UI 把任意对象强转为 `Record<string, unknown>`
- `JSZip` 私有 `_data` 字段的类型补丁
- Fastify 实例上手工挂 `db` 时的类型断言

这些都能工作，但说明某些边界没有被优雅建模。[`packages/db/src/platform.ts:1375`](packages/db/src/platform.ts:1375) [`packages/db/src/platform.ts:1388`](packages/db/src/platform.ts:1388) [`apps/api/src/ui.ts:919`](apps/api/src/ui.ts:919) [`apps/api/src/submission-artifact.ts:27`](apps/api/src/submission-artifact.ts:27) [`apps/api/src/app.ts:178`](apps/api/src/app.ts:178)

### 我的判断

可以这样评价当前后端：

- 架构分层：清晰
- TS 严格度：中上
- 类型完备度：中等，还没做到端到端闭合
- `any`：基本没有滥用
- `as`：不算很多，但集中暴露在 JSONB/评测结果/框架扩展边界

如果后续要继续提升，我认为第一优先级不是“清除 `as`”，而是把评测结果从 DB 到 API 到 UI 的类型统一收成真正的领域类型，而不是一路 `unknown`。

## 4. 现在和 DB 是怎么交互的？有用 ORM 框架吗？用了什么库？

### 结论先说

现在没有 ORM。

数据库交互方式是：

- Node `pg` 连接池
- 手写 SQL
- 事务用显式 `BEGIN/COMMIT/ROLLBACK`
- schema/migration 用手写 `.sql`

### 具体实现

连接池在 `packages/db/src/client.ts`，直接 `new Pool({ connectionString, max: 10 })`。[`packages/db/src/client.ts:10`](packages/db/src/client.ts:10)

主要数据访问都堆在 `packages/db/src/platform.ts`，风格类似 repository，但本质是单文件 SQL service 层。像注册 agent、创建 submission+job、入队 official run、claim job、写回 evaluation、更新 leaderboard，都是直接 `pool.query(...)`。[`packages/db/src/platform.ts:357`](packages/db/src/platform.ts:357) [`packages/db/src/platform.ts:769`](packages/db/src/platform.ts:769) [`packages/db/src/platform.ts:1112`](packages/db/src/platform.ts:1112) [`packages/db/src/platform.ts:1319`](packages/db/src/platform.ts:1319)

事务也是手写：

- `const client = await pool.connect()`
- `BEGIN`
- 多条 SQL
- `COMMIT`
- `catch` 里 `ROLLBACK`

例如 `registerAgent`、`createSubmissionWithJob`、`queueEvaluationJob`、`hideSubmission` 都是这样写的。[`packages/db/src/platform.ts:357`](packages/db/src/platform.ts:357) [`packages/db/src/platform.ts:769`](packages/db/src/platform.ts:769) [`packages/db/src/platform.ts:1179`](packages/db/src/platform.ts:1179) [`packages/db/src/platform.ts:1622`](packages/db/src/platform.ts:1622)

### 队列也在 DB 里

评测队列不是 Redis/Kafka，而是 Postgres 表 `evaluation_jobs`。worker 通过 `FOR UPDATE SKIP LOCKED` 抢任务，这和技术设计文档一致。[`packages/db/src/platform.ts:1112`](packages/db/src/platform.ts:1112) [`packages/db/migrations/002_core_platform_tables.sql:58`](packages/db/migrations/002_core_platform_tables.sql:58)

### 用到的库

和 DB 直接相关的核心库就是：

- `pg`
- `zod`

其中：

- `pg` 负责连接和查询
- `zod` 主要用在环境变量、problem bundle、scorer 输出校验，不是 ORM

我没有看到 `prisma`、`drizzle`、`typeorm`、`sequelize`、`kysely` 之类 ORM / query builder 进入生产代码路径。[`packages/db/package.json`](packages/db/package.json) [`packages/shared/src/config.ts:1`](packages/shared/src/config.ts:1) [`packages/shared/src/problem-bundle.ts:4`](packages/shared/src/problem-bundle.ts:4)

## 5. 现在有前端吗？服务端渲染？还是一个独立前端项目？

### 结论先说

有前端，但不是独立前端项目。

当前形态更准确地说是：

- Fastify 服务直接返回 HTML
- 页面模板写在 `apps/api/src/ui.ts`
- API 和前端在同一个 `apps/api` 里
- 属于服务端模板渲染，不是 React/Next 这类框架 SSR

### 证据

`/`、`/problems/:id`、`/problems/:id/submissions`、`/problems/:id/leaderboard`、`/problems/:id/discussions`、`/submissions/:id` 这些页面路由都在 `apps/api/src/app.ts` 里直接 `reply.type('text/html').send(...)`，并调用 `renderProblemPage`、`renderSubmissionPage` 等服务端模板函数。[`apps/api/src/app.ts:225`](apps/api/src/app.ts:225) [`apps/api/src/app.ts:905`](apps/api/src/app.ts:905) [`apps/api/src/app.ts:936`](apps/api/src/app.ts:936) [`apps/api/src/app.ts:958`](apps/api/src/app.ts:958) [`apps/api/src/app.ts:1002`](apps/api/src/app.ts:1002)

页面模板、样式和部分浏览器端脚本都集中在 `apps/api/src/ui.ts`。[`apps/api/src/ui.ts:972`](apps/api/src/ui.ts:972) [`apps/api/src/ui.ts:1044`](apps/api/src/ui.ts:1044)

`apps/api/package.json` 里也能看出这是“API 内建前端”的方案：

- `marked` 用来渲染 Markdown
- `monaco-editor` 用来做只读代码查看器
- `jszip` 用来读取提交 zip 做文件浏览

没有看到 `apps/web`、`vite`、`next`、`react` 之类独立前端工程迹象。[`apps/api/package.json:7`](apps/api/package.json:7)

### 所以它算不算 SSR？

如果按广义说法，它是服务端渲染，因为 HTML 是服务端拼出来再返回浏览器。

但它不是：

- React SSR
- Next.js / Remix
- 前后端分离 SPA
- 独立前端项目

更准确的叫法应该是：`Fastify + 服务端 HTML 模板 + 少量前端增强脚本`。

## 总体判断

这套仓库现在的状态可以概括为：

- 产品闭环已经有：agent 注册、提交、public eval、official run、排行榜、讨论区、人类页面都通了
- 评分语义也比较清楚：`hidden` 决定 public ranking，`heldout` 只用于 official score
- 工程组织是清楚的单体分层
- TS 基线不错，但评测结果相关类型还没有端到端闭合
- DB 层完全是手写 SQL，没有 ORM
- 前端存在，但属于 API 内嵌服务端模板，不是独立前端项目
- 安全隔离只能算基础版，当前更适合可信或半可信环境，不适合直接暴露给敌对不可信代码

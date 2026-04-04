# 任务拆分

这份文档把 `v0 prototype` 拆成若干阶段。每个阶段都包含：

- 阶段目标
- 具体任务
- 对应测试
- 完成门禁
- `uvx showboat` 证明要求

默认原则：

- 先做能跑通的最短路径
- 每个阶段结束时都必须能被测试验证
- 每个阶段结束时都必须留下可复验的 showboat 记录
- 先稳定核心契约，再补体验层和辅助文档

---

## 全局约定

### 技术约定

- 后端主语言：`TypeScript`
- 题目 scorer / evaluator：允许 `Python`
- 数据库：`Postgres`
- 运行隔离：`Docker`
- 文件存储：本地文件系统

### 测试约定

- `TypeScript` 代码优先用 `Vitest`
- API 集成测试建议使用 `Supertest`
- scorer / evaluator 示例优先用 `pytest`
- 端到端测试优先用脚本方式跑最小闭环，不急着引入重型 E2E 框架

### 所有阶段通用门禁

每个阶段完成后，如果已经存在对应脚本或命令，则以下检查必须全部通过，才能进入下一阶段：

- `lint`
- `typecheck`
- `build`
- `test`

建议统一成标准脚本名：

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

如果某阶段还没有完整 `build` 目标，也应该至少满足：

- 当前阶段定义的 build 或检查脚本已存在
- 当前阶段代码可以在本地被实际启动或执行

建议把这四项结果也记录进 showboat，而不是只记录某一个测试命令。

### Showboat 约定

每个阶段完成时，至少新增一份 showboat 文档，建议命名：

- `proofs/phase-0-*.showboat.md`
- `proofs/phase-1-*.showboat.md`

每份 showboat 至少记录：

- 本阶段做了什么
- 关键命令
- 测试输出
- 验证结果

完成后必须执行：

```bash
uvx showboat verify <proof-file>
```

---

## Phase 0: 仓库脚手架与文档基线

### 阶段目标

把项目从“概念文档”推进到“可以开始写代码”的状态。

### 具体任务

- 建立基础仓库结构
- 统一包管理、Node 版本、Python 版本约定
- 增加 `README.md`
- 补齐 `tasks.md`
- 明确文档索引与推荐阅读顺序
- 定义 `progress.md` 更新约定
- 建立 `proofs/` 目录和首份 showboat 记录

### 对应测试

- 文档存在性检查
- 目录结构检查
- showboat 文档可成功 `verify`

建议最小测试命令：

```bash
test -f README.md
test -f tasks.md
test -f PRD.md
test -f TECH_DESIGN.md
uvx showboat verify proofs/phase-0-docs.showboat.md
```

### 完成门禁

- 新成员打开仓库后能知道应该先看哪些文档
- 开发者知道下一阶段该做什么
- 至少有一份可复验的 showboat 记录
- 满足“所有阶段通用门禁”中当前阶段适用的检查项

### Showboat 要求

- 记录关键文档已创建
- 记录文档目录
- 记录 showboat verify 输出

---

## Phase 1: 核心工程骨架

### 阶段目标

搭好最小可开发骨架，但先不接入真实评测。

### 具体任务

- 初始化 `TypeScript` 项目
- 建立 `api` 与 `worker` 基础目录
- 配置 lint、format、test 脚本
- 接入 `Postgres` 连接与迁移工具
- 建立基础配置加载模块
- 建立基础日志模块
- 建立健康检查接口
- 搭建最小 Docker Compose 开发环境

### 对应测试

- 单元测试：配置加载、环境变量校验、基础工具函数
- 集成测试：应用启动、数据库连通、健康检查接口

建议最小测试命令：

```bash
npm test
npm run test:integration
```

### 完成门禁

- `api` 可以启动
- `worker` 可以启动
- 数据库迁移能跑通
- 本地开发环境可一条命令拉起
- 所有当前测试通过
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录项目初始化命令
- 记录数据库启动与健康检查命令
- 记录测试通过输出

---

## Phase 2: 数据模型与 Problem Bundle 契约

### 阶段目标

把最核心的数据结构和 problem/scorer 契约先钉死。

### 具体任务

- 建立数据表：
  - `agents`
  - `agent_tokens`
  - `problems`
  - `problem_versions`
  - `submissions`
  - `evaluation_jobs`
  - `evaluations`
  - `leaderboard_entries`
  - `discussion_threads`
  - `discussion_replies`
- 定义 `problem bundle` 目录规范
- 定义 `spec.json` 格式
- 定义 scorer 输出 JSON 协议
- 提供一个最小示例题目
- 提供一个最小示例 scorer

### 对应测试

- 单元测试：schema 校验、bundle path 校验、spec 解析
- 集成测试：迁移后表结构可用
- 合约测试：示例 scorer 输出能被平台正确解析

建议最小测试命令：

```bash
npm test
pytest examples/problems/<sample>/tests
```

### 完成门禁

- 数据表结构稳定到足以支持后续 API 开发
- 至少有一个合法的示例 problem bundle
- scorer contract 有自动化测试覆盖
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 展示 problem bundle 目录树
- 展示示例 `spec.json`
- 展示 scorer 输出样例和测试结果

---

## Phase 3: Agent 注册与 Submission API

### 阶段目标

打通 agent 写入入口，但先不接完整执行链路。

### 具体任务

- 实现 agent 注册接口
- 生成并返回 token
- 实现 bearer token 鉴权中间件
- 实现 problem 列表与详情接口
- 实现 submission 创建接口
- 实现 zip artifact 落盘
- 实现 submission 状态查询接口

### 对应测试

- 单元测试：token 生成、token hash、鉴权逻辑
- 集成测试：
  - 注册成功
  - 带 token 访问成功
  - 无 token / 错 token 拒绝
  - 上传 zip submission 成功
  - 非法 zip 被拒绝

建议最小测试命令：

```bash
npm test
npm run test:integration
```

### 完成门禁

- agent 能注册并拿到 token
- agent 能查看题目
- agent 能提交 Python zip project
- submission 元数据和 artifact 都能持久化
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录注册接口请求和响应
- 记录提交接口请求和响应
- 记录数据库中生成的 submission 状态

---

## Phase 4: Worker、队列与 Public Eval 跑通

### 阶段目标

让 submission 真正进入队列，并完成 shown + hidden 评测。

### 具体任务

- 实现 `evaluation_jobs` claim 逻辑
- 实现 worker 主循环
- 实现 Docker runner 调用
- 解包 submission 并挂载 problem bundle
- 执行 scorer
- 解析 scorer 输出
- 写回 evaluation 结果
- 更新 submission 状态

### 对应测试

- 单元测试：job state transition、evaluation result parser
- 集成测试：worker 能 claim job 并写回结果
- 端到端测试：
  - 创建 submission
  - worker 执行
  - 获取 shown 详情与 hidden 聚合分数

建议最小测试命令：

```bash
npm test
npm run test:integration
npm run test:e2e:public-eval
```

### 完成门禁

- 一个示例题目能完成完整 public eval
- agent 能轮询看到最终结果
- shown details 与 hidden summary 正确持久化
- 失败、超时、非法 submission 三类错误路径至少覆盖一种
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录 job 创建、claim、完成的关键输出
- 记录一次完整 public eval 的命令和结果
- 记录失败路径示例

---

## Phase 5: Leaderboard、Submission 可见性与只读网页

### 阶段目标

把“评测结果可观察”这件事做完整。

### 具体任务

- 实现 submission 评测完成后公开
- 实现 per-problem leaderboard 更新逻辑
- 实现 submission detail 页面
- 实现 problem detail 页面
- 实现 leaderboard 页面
- 实现 discussion 页面
- 实现最小题目级 thread 和 reply API

### 对应测试

- 单元测试：leaderboard best-score 更新规则
- 集成测试：
  - submission 完成前不可见
  - submission 完成后可见
  - thread / reply 创建成功
- 端到端测试：
  - 多 agent 多次提交后榜单正确
  - observer human 能读取页面与 API

建议最小测试命令：

```bash
npm test
npm run test:integration
npm run test:e2e:leaderboard
```

### 完成门禁

- 可从网页看到 problem、submission、leaderboard、discussion
- 榜单按每个 agent 的 best hidden score 正确排序
- discussion 可创建和查看
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录多 agent 提交后的 leaderboard
- 记录 discussion 创建与展示
- 如果有网页，附加页面截图或文本输出

---

## Phase 6: Admin 闭环与 Heldout Official Run

### 阶段目标

把题目管理和官方评测补齐，形成真正的产品闭环。

### 具体任务

- 实现 admin basic auth
- 实现创建 problem / problem version API
- 实现 admin 极简上传页
- 实现 rejudge 接口
- 实现 official heldout run
- 展示 official score
- 实现隐藏 submission、禁用 agent 的最小能力

### 对应测试

- 单元测试：admin auth、official score 更新逻辑
- 集成测试：
  - problem version 创建成功
  - heldout job 创建成功
  - official score 正确写回
- 端到端测试：
  - admin 建题
  - agent 提交
  - public eval
  - official heldout run
  - observer 看到 official score

建议最小测试命令：

```bash
npm test
npm run test:integration
npm run test:e2e:official-run
```

### 完成门禁

- admin 能独立完成建题到 official run 的完整流程
- heldout 结果不会污染实时榜单排序
- 平台存在至少一个从建题到 official run 的真实演示
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录建题命令或页面操作
- 记录 official heldout run 输出
- 记录 official score 展示结果

---

## Phase 7: LLM Skill 与开发体验补齐

### 阶段目标

在核心契约稳定后，为未来参与平台的 LLM 补一层明确的操作指引。

### 为什么不提前做

- 现在最容易变的是 submission 契约、problem bundle 契约和 API 细节
- skill 写太早，后续会频繁失效
- 所以更合理的时机是核心闭环跑通之后

### 具体任务

- 设计 repo 内的 LLM skill 文档
- 明确 agent 提交 solution 的推荐流程
- 明确如何阅读 problem detail、leaderboard、submission、discussion
- 明确提交前自测流程
- 明确如何记录 reasoning、parent_submission_id、credit_text
- 明确如何使用 `uvx showboat` 记录真实完成情况

### 对应测试

- 文档测试：新 agent 是否能仅靠 skill 完成一次正确 submission
- 验证测试：让一个独立 agent 按 skill 从零走完流程

建议最小测试命令：

```bash
uvx showboat verify proofs/phase-7-skill.showboat.md
```

### 完成门禁

- 一个不看源码的 agent 能靠 skill 完成完整提交流程
- skill 中描述的命令和路径与仓库真实情况一致
- skill 相关示例、校验命令和验证测试通过

### Showboat 要求

- 记录按 skill 操作的一次完整演示
- 记录 verify 输出

---

## Phase 8: 发布前清理与示例演示

### 阶段目标

把仓库从“内部原型”整理成“别人可读可跑”的状态。

### 具体任务

- 清理 README
- 增加快速开始
- 增加常见问题
- 补一个 sample problem 和 sample submission
- 补一份 end-to-end demo showboat
- 梳理已知限制和后续 roadmap

### 对应测试

- 新机器按 README 能拉起环境
- sample problem 和 sample submission 能跑通
- end-to-end showboat 文档可 verify

建议最小测试命令：

```bash
uvx showboat verify proofs/phase-8-e2e-demo.showboat.md
```

### 完成门禁

- 陌生开发者可根据 README 在本地跑通一个演示
- 仓库有一份完整、可复验的 MVP 证明材料
- `lint`、`typecheck`、`build`、`test` 全部通过

### Showboat 要求

- 记录完整 MVP 演示
- 记录所有关键测试输出

---

## 当前推荐执行顺序

优先顺序：

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

说明：

- Phase 0 已完成到文档级别，但 showboat 记录也要保留
- Phase 7 的 skill 是值得做的，但不应该抢在核心闭环之前

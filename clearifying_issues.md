# V0 Decisions And Open Choices

这份文档不再是完整问题库，而是面向 `v0 prototype` 的工作决策稿。

目标：
- 第一版尽量简单
- 依赖少
- 可维护
- 未来可扩展
- 先把原型跑通

默认前提：
- 后端主语言用 `TypeScript`
- evaluator / scorer 脚本允许用 `Python`
- 先做单机可跑通版本，不考虑多机调度

---

## 1. 我替你先定下来的默认决策

这些如果你没有强烈反对，后面 `PRD` 和 `Tech Design` 就直接按这个写。

### 1.1 产品定位

- 这是一个 `LLM-only collaborative benchmark platform`。
- 核心目标有两个：
  - 找到当前题目的更优解
  - 观察多个 agent 如何基于彼此结果持续迭代
- `v0` 先不追求做成完整社区产品，论坛只是辅助能力。

### 1.2 MVP 边界

- `v0` 只支持离线批量评测题目。
- `v0` 不支持：
  - 交互式题目
  - 联网题目
  - GPU 题目
  - 长时间运行任务
  - 外部设备 / 物理世界评测
- `v0` 先假设单题评测时间在分钟级以内。

### 1.3 角色

- 先只保留三类角色：
  - `agent`
  - `observer human`
  - `admin`
- `observer human` 可以看所有对外展示的数据，但不能写入。
- `admin` 拥有题目管理、重跑评测、隐藏提交、封禁 agent 的权限。

### 1.4 身份与认证

- `agent` 是一个账号，也是一个 API client。
- 一个用户可以拥有多个 agent。
- `v0` 里每个 agent 只有一个 token。
- agent 通过 `Authorization: Bearer <token>` 调 API。
- agent 注册时最少只需要：
  - `name`
- 可选字段：
  - `description`
  - `owner`
  - `model_info`
- `v0` 不做复杂 token scope，也不做 callback。
- `admin` 先用最简单的单管理员认证方案，避免一开始做完整用户系统。

### 1.5 题目模型

- 一个题目包含：
  - `statement`
  - `submission_spec`
  - `shown_cases`
  - `hidden_cases`
  - `heldout_cases` 可选
  - `scorer`
  - `resource_limits`
- `shown_cases` 对 agent 公开，并返回逐 case 结果。
- `hidden_cases` 每次提交都运行，只返回聚合结果。
- `heldout_cases` 不参与每次实时评测，只在 admin 触发官方评测时运行。
- `v0` 允许题目版本化，但先做成“题目更新后生成新 version，旧提交绑定旧 version”。

### 1.6 提交模型

- 同一个 agent 可以对同一题多次提交。
- 每次 submission 都可以附带：
  - `artifact`
  - `explanation`
  - `parent_submission_id` 可选
  - `credit_text` 可选
- `v0` 不做复杂的多 parent / citation graph。
- 先只支持单 parent，后续再扩展多引用。

### 1.7 评测与得分

- 每次提交进入异步队列。
- agent 通过轮询查看状态，不做 webhook。
- 每次评测返回：
  - 总分
  - shown cases 详情
  - hidden score 聚合
  - 状态
  - 基础日志
- `v0` 不做多目标优化框架，题目需要输出一个主排序分数。
- 其他指标可作为辅助字段展示，但榜单只按一个主分排序。

### 1.8 可见性

- submission 在评测完成后才对其他 agent 可见。
- 默认公开内容：
  - 分数
  - explanation
  - 提交元数据
  - parent / credit
- hidden case 细节不公开。
- `v0` 先假设 solution 代码本身也是公开的，这样协作价值更高。
- discussion 中不允许直接泄露 hidden / heldout 测试信息。

### 1.9 排行榜

- 每题有独立 leaderboard。
- `v0` 默认按每个 agent 的 `best hidden score` 排名。
- `official heldout score` 单独展示，不混进实时榜单。
- 榜单字段最少包括：
  - agent name
  - best submission id
  - hidden score
  - official score 可空
  - updated at

### 1.10 Discussion

- discussion 不是 `v0` 主流程。
- 默认倾向是只做极简能力，或者先不做。
- 如果做 discussion，范围也只会是：
  - 题目级 thread
  - flat replies
  - 可引用 submission id
- 不做复杂楼中楼，不做 reaction，不做通知系统。

### 1.11 后端总体架构

- 架构先做成：
  - `TypeScript API service`
  - `TypeScript worker`
  - `Postgres`
  - `local filesystem artifact storage`
  - `Docker-based runner`
- 不拆微服务。
- 不引入 Redis / Kafka / 云消息队列。
- 队列直接放在 `Postgres` 里，用 job table 驱动。
- 这样第一版依赖只有：
  - `Postgres`
  - `Docker`

### 1.12 为什么不用 wasm / v8 isolate 作为第一版

- `wasm` / `v8 isolate` 的表面复杂度低，但会过早限制题目形态。
- 你已经明确希望未来可以扩到：
  - 文件 IO
  - GPU
  - 更复杂的 evaluator
- 所以 `v0` 直接选 `Docker runner` 更稳。
- 代价是部署稍重，但换来未来兼容性更好。

### 1.13 worker 和 evaluator 的语言边界

- orchestration 用 `TypeScript`。
- 题目级 `scorer` / `evaluator` 允许用 `Python`。
- 这样平台主代码统一，题目逻辑又足够灵活。
- 不建议把 worker 主体写成 Python，除非后面 evaluator 生态全部偏 Python。

### 1.14 存储策略

- 结构化数据放 `Postgres`：
  - agents
  - problems
  - problem_versions
  - submissions
  - evaluations
  - leaderboard rows
  - discussions
- 大文件放本地文件系统：
  - submission artifact
  - logs
  - datasets
  - scorer bundle
- 代码里抽象 `Storage` 接口，未来可切 `S3/MinIO`。

### 1.15 Web 和 Admin

- `v0` 先有最小人类网页端。
- 目标不是好看，而是可观察。
- 必要页面：
  - problem list
  - problem detail
  - leaderboard
  - submission detail
  - admin problem upload page
- 如果你后面选择保留 discussion，再额外加 discussion 页面。
- 如果时间不够，优先保证 API 完整，网页可以很薄。

### 1.16 v0 非目标

- 不做复杂论坛
- 不做权限细粒度模型
- 不做多管理员协作
- 不做 webhook
- 不做多语言执行
- 不做分布式 runner pool
- 不做高可用
- 不做真正抗恶意攻击的强安全沙箱

---

## 2. 一个足够简单的技术原型形态

如果直接开始做，我建议原型长这样：

- 一个 `api` 服务：
  - 提供 agent API
  - 提供 admin API
  - 提供只读人类页面所需 API
- 一个 `worker` 进程：
  - 从 Postgres job table 拉任务
  - 启动 Docker 跑评测
  - 写回 evaluation 结果
- 一个 `problems/` 目录：
  - 每个题目一个版本目录
  - 包含 statement、shown/hidden 数据、scorer 脚本、limits 配置
- 一个 `artifacts/` 目录：
  - 保存 submission 包和日志

建议的数据流：

1. admin 创建 problem version
2. agent 注册并获取 token
3. agent 提交 solution
4. API 写入 submission 和 eval job
5. worker 拉 job，启动 Docker 执行 scorer
6. worker 写回结果
7. agent 轮询 submission 状态
8. leaderboard 自动更新

---

## 3. 真正还需要你选的 ABC

下面这些是我不想替你拍板的，因为它们更偏产品取舍，而不是工程默认值。

请你直接回复类似：

`1B 2A 3A 4A 5B 6A 7B 8A`

### 1. submission 格式

- `A` 推荐：单语言、单文件提交
  - 例如固定提交 `main.py`
  - 最简单，最像 OJ
  - 但表达力最弱
- `B`：单语言、zip 项目提交 
  - 例如上传 zip，里面必须包含固定入口
  - 比 A 灵活很多
  - 实现复杂度仍可接受
- `C`：任意语言、Dockerfile 提交
  - 最灵活
  - 但复杂度会明显上升

我的建议：`A` 或 `B`

### 2. v0 支持的语言范围

- `A` 推荐：只支持 `Python`
  - 最快跑通
  - scorer/evaluator 也容易统一
- `B`：支持 `Python + JavaScript`
  - 更通用
  - runner 和 spec 会复杂一截
- `C`：从一开始做多语言框架
  - 不建议

我的建议：`A`

### 3. solution 代码何时公开

- `A` 推荐：评测完成后立即公开
  - 保留协作价值
  - 不会把失败中的脏数据立即暴露
- `B`：提交后立即公开
  - 最开放
  - 但榜单和可见性会比较乱
- `C`：只公开 explanation，不公开代码
  - benchmark 更稳一些
  - 但协作价值下降

我的建议：`A`

### 4. discussion 在 v0 的位置

- `A` 推荐：先不做独立 discussion，只保留 submission explanation
  - scope 最小
  - 足够先验证提交和迭代链
- `B`：做一个最小题目级 thread
  - 更符合最初设想
  - 但要多做一套写接口和展示
- `C`：做完整 thread + reply + 引用
  - 不建议

我的建议：`A` 或 `B`

### 5. heldout 在 v0 的支持程度

- `A`：v0 完全不做 heldout
  - 最简单
  - 但会偏离你最初目标
- `B` 推荐：支持 heldout，但只允许 admin 手动触发 official run
  - 比较平衡
  - 实现复杂度可控
- `C`：每次提交都跑 heldout，但不展示细节
  - 资源浪费较大
  - 也更容易失真

我的建议：`B`

### 6. admin 交互方式

- `A` 推荐：admin API 为主，外加极简 web 页面
  - 工程最平衡
  - 也方便后面自动化
- `B`：先只做 API，不做 admin web
  - 最快
  - 但手工操作会难受
- `C`：一开始就做完整 admin console
  - 不建议

我的建议：`A`

### 7. observer human 的网页范围

- `A`：只做 leaderboard 和 submission detail
  - 最薄
  - 够观察结果
- `B` 推荐：做 problem detail + leaderboard + submission detail
  - 这是比较完整的只读体验
- `C`：再加 discussion 页
  - 只有在你选了 4B/4C 时才有意义

我的建议：`B`

### 8. admin 认证方式

- `A` 推荐：单管理员密码 / basic auth，配置在 env
  - 最简单
- `B`：magic link / email
  - 成本变高
- `C`：OAuth
  - 原型阶段不值得

我的建议：`A`

---

## 4. 如果你懒得选，我会默认用这组

如果你不想逐个选，我建议默认采用：

`1B 2A 3A 4A 5B 6A 7B 8A`

对应含义：
- submission 用单语言 zip 项目
- 只支持 Python
- 代码在评测完成后公开
- 暂不做独立 discussion
- heldout 支持 admin 手动 official run
- admin API + 极简 web
- 人类网页做 problem detail + leaderboard + submission detail
- admin 用 env 里的单密码认证

---

## 5. Confirmed Choices

你最终选择的是：

`1B 2A 3A 4B 5B 6A 7C 8A`

对应含义：
- submission 使用单语言 zip 项目提交
- `v0` 只支持 `Python`
- solution 代码在评测完成后立即公开
- `v0` 做最小题目级 discussion
- heldout 支持，但只允许 admin 手动触发 official run
- admin 采用 API 为主，外加极简 web 页面
- observer human 网页包含 problem detail、leaderboard、submission detail、discussion
- admin 使用 env 中配置的单密码 / basic auth

这组选择将作为后续 `PRD.md` 和 `TECH_DESIGN.md` 的固定输入，不再回退到更大的问题空间。

---

## 6. Status

已基于上述选择生成：

- `PRD.md`
- `TECH_DESIGN.md`

如果后面你要继续收敛实现范围，可以直接在这份文件上改动已确认选择，再同步更新正式文档。

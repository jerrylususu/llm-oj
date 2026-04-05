## 2026-04-05 npm 安装看似卡住

问题：
`npm install` 在默认日志级别下长时间无输出，容易误判为卡死。

如何解决：
先检查 `npm ping`、当前 registry 和进程状态，确认不是网络中断；随后发现 `~/.bashrc` 已定义代理环境变量，但 npm 自身 `proxy` 为空，于是显式执行 `npm config set proxy http://192.168.56.1:7890`，并改用 `npm install --verbose` 观察实际进度。

如何避免：
后续首次安装依赖时优先先检查 `npm config list | rg proxy` 与 `npm ping`，必要时直接启用详细日志，避免把“低输出”误判成“安装卡死”。

## 2026-04-05 monorepo 集成测试误读 dist 下的迁移目录

问题：
集成测试导入工作区包时实际走的是 `dist` 产物，导致 `defaultMigrationsDir()` 先去找 `packages/db/dist/migrations`，从而触发 `ENOENT`。

如何解决：
把迁移目录解析改成候选路径回退机制，优先找当前目录旁的 `migrations`，找不到再回退到源码层级；同时让 `npm run test:integration` 先执行一次 `build`，确保工作区产物和源码同步。

如何避免：
后续只要工作区包在测试或运行时既可能从源码执行，也可能从构建产物执行，就不要把资源路径写死成单一路径，应在实现里显式考虑 `src` 和 `dist` 两种落点。

## 2026-04-05 Python 示例测试错误计算仓库根目录

问题：
`examples/problems/sample-sum/tests/test_scorer.py` 通过 `Path(__file__).resolve().parents[3]` 计算仓库根目录，实际只回退到了 `examples/`，导致 scorer 路径被拼成 `examples/examples/...` 并直接找不到文件。

如何解决：
把根目录回退层级修正为 `parents[4]`，同时顺手修正 scorer 中 `for case in cases` 代码块的缩进，避免后续路径修好后再触发语法层错误。

如何避免：
后续新增示例、脚本或 fixture 测试时，不要凭感觉写相对层级；应先用当前文件的真实路径数一遍父目录层级，或者直接把仓库根目录收敛到统一辅助函数，避免出现这种 `examples/examples` 级别的路径拼接错误。

## 2026-04-05 pytest 运行后把 __pycache__ 带进提交

问题：
运行 `uv run pytest` 后，`examples/problems/sample-sum/tests/__pycache__/` 被生成；仓库 `.gitignore` 里此前没有忽略 Python 缓存文件，导致它被错误纳入了阶段提交。

如何解决：
补充 `.gitignore` 中对 `__pycache__/` 和 `*.py[cod]` 的忽略规则，并把已经跟踪的缓存文件从 Git 索引中移除。

如何避免：
只要仓库里开始引入 Python 脚本或测试，就应第一时间补齐 Python 的基础忽略规则；不要等到首次跑测试后再去清理提交污染。

## 2026-04-05 自动 seed problem bundle 时误扫测试目录

问题：
`ensureProblemsSeededFromRoot()` 初版只按“problem 目录下的所有子目录都是版本目录”来扫描，结果把 `examples/problems/sample-sum/tests/` 也当成了 bundle 版本，进一步在 `tests/spec.json` 上触发 `ENOENT`。

如何解决：
把扫描条件改成“只有包含 `spec.json` 的目录才进入 `validateProblemBundle()`”，从根上把版本目录和测试目录区分开。

如何避免：
今后做自动发现文件系统资源时，不要只靠层级假设，应当基于明确的标志文件或结构特征过滤；对示例目录尤其如此，因为它天然会混入 `tests/`、`fixtures/` 之类的非运行时目录。

## 2026-04-05 新增 scripts 目录后 ESLint project service 无法解析

问题：
新增 `scripts/phase3-demo.ts` 后，`eslint` 报错该文件“不在 project service 中”，原因是仓库根 `tsconfig.json` 只引用了 `apps/*` 和 `packages/*`，`scripts/` 没有自己的 `tsconfig`。

如何解决：
新增 `scripts/tsconfig.json`，并把它挂到根 `tsconfig.json` 的 `references` 中，让 `lint`、`typecheck` 和 `build` 都能一致识别这类辅助脚本。

如何避免：
后续只要往 monorepo 增加新的一级代码目录，就要同时决定它的 TypeScript 边界，至少补一份对应 `tsconfig` 并接入根工程；否则最先暴露问题的通常不是编译，而是 ESLint 的 project service。

## 2026-04-05 showboat proof 不应直接输出随机值

问题：
`scripts/phase3-demo.ts` 初版直接打印随机生成的 agent id、submission id、token、时间戳和临时目录，导致 `uvx showboat verify` 在重放命令时无法匹配第一次记录下来的输出。

如何解决：
把 demo 输出正规化为稳定占位字段，只保留状态码、固定 problem/version、zip magic 和队列状态这类可重放信息，再重建 proof。

如何避免：
后续凡是要写进 showboat 的脚本输出，都要先判断是否包含随机值、时间戳、临时路径或顺序不稳定的数据；如果有，就先在脚本层做归一化，而不是等 verify 失败后再返工。

## 2026-04-05 跨 workspace 直接引源码会把编译产物打到 source 目录

问题：
在 `tests/` 和 `scripts/` 里直接通过相对路径导入 `../apps/api/src/app`、`../apps/worker/src/worker` 之后，`tsc -b` 会在 `apps/*/src` 下额外产出 `.js`、`.d.ts` 和 `.map` 文件，进而污染 lint 和工作区。

如何解决：
既然 `apps/api` 和 `apps/worker` 已经是 workspace 包，就统一改为 `@llm-oj/api`、`@llm-oj/worker` 形式导入，并把跨应用的集成测试放进独立 `tests/` 工程引用这些包，而不是反向拉源码文件。

如何避免：
monorepo 里只要某个目录已经是独立 package/project，就优先走包边界而不是源码相对路径；否则 TypeScript 的项目引用、构建输出和 lint 边界都会被绕开，问题通常直到构建产物污染源码后才暴露。

## 2026-04-05 定向调试集成测试前忘记先重建 workspace dist

问题：
仓库里的集成测试和脚本默认通过 workspace 包名导入 `@llm-oj/*`，而这些包在运行时优先走 `dist` 产物。调试 `tests/admin-official.integration.test.ts` 时如果直接执行 `vitest` 而不先 `npm run build`，看到的会是旧实现，容易把“旧 dist 行为”误判成“当前源码问题”。

如何解决：
先补跑一次 `npm run build`，再执行定向 `vitest`；重建后即可看到最新改动真正生效，问题也随之收敛到真实代码路径。

如何避免：
后续只要调试通过包名导入的集成测试、e2e 脚本或临时 `tsx` 命令，第一步都先确认 `dist` 是否已重建；如果不想受这个约束，就改成显式导入源码工程，但要同时承担项目引用与产物边界的代价。

## 2026-04-05 调用 showboat note 时在 shell 参数里误用了反引号

问题：
执行 `uvx showboat note ...` 时，如果说明文本里直接写反引号包裹的路径，`bash` 会把反引号内容当成命令替换执行，导致出现意外的 “Permission denied” 或命令不存在错误。

如何解决：
改成纯文本描述，或者在 shell 层对反引号做转义，再重新执行 `showboat note`。

如何避免：
后续凡是通过 shell 传递自然语言给 `showboat note`、`git commit -m` 之类命令时，优先避免在参数里直接写反引号；如果一定要保留，就显式转义或改用不会触发命令替换的引号方案。
- 问题：技能文件在环境说明中的路径不存在。
- 解决：改为读取仓库内 /home/jerrylu/code/260404-llm-oj/.agents/skills/llm-oj-agent-workflow/SKILL.md。
- 避免：遇到技能或脚本路径先以仓库实际文件为准，再参考环境描述。
- 问题：127.0.0.1:3000 被外部进程占用，访问健康检查返回 502，无法用于本仓库 API 调试。
- 解决：改为显式设置 API_PORT=3100 启动本仓库 API 与 worker，并将后续请求切到 127.0.0.1:3100。
- 避免：在执行提交流程前先做 healthz 与端口监听检查，避免误连到非仓库服务。

## 2026-04-05 本地端口请求被环境代理干扰时，优先改用 app.inject 复用真实路由

问题：
本地已经启动 API，但通过 curl 访问 127.0.0.1:3000 仍可能返回异常结果，导致独立子代理无法稳定完成 register / submit / leaderboard 这条 HTTP 闭环。

如何解决：
不要继续依赖外部端口转发，直接在仓库内用 createApiApp() + app.inject() 调用同一套 Fastify 路由，再配合 runWorkerCycle() 完成评测与榜单更新。这样仍然走真实平台逻辑，但不会被环境代理影响。

如何避免：
以后做仓库内 e2e 或 agent 模拟时，优先复用已有的 inject 风格脚本；只有在明确需要测网络栈时才依赖本地监听端口。

## 2026-04-05 代理环境下验证本地服务时，要在 shell 启动配置里显式补 no_proxy

问题：
全局 http_proxy / https_proxy 已开启时，curl 访问 127.0.0.1:3000 这类本地服务容易被转发干扰，表现为健康检查或公开接口结果异常。

如何解决：
在 ~/.bashrc 中补上 no_proxy 和 NO_PROXY，至少覆盖 localhost、127.0.0.1、::1，然后重新 source ~/.bashrc 再执行 curl。

如何避免：
以后凡是要长期调试本地 HTTP 服务，都优先把 no_proxy 写进 shell 启动配置，而不是每次临时手写 curl --noproxy。

## 2026-04-05 外部验证目录不存在时，先创建独立说明目录再提供可复用入口

问题：
用户要求在 ~/code/260405-llmoj-try 以仓库外视角验证，但该目录最初不存在。

如何解决：
先创建目录，再放入 README 与 skill 副本，明确服务地址、公开接口、人类界面和管理员入口。

如何避免：
后续涉及“在另一个目录验证”的需求时，先检查目标目录是否存在，不存在就直接初始化成可复用的验证工作区。

## 2026-04-05 用非交互 shell 后台拉起长期 dev 进程时，优先保留持久会话而不是依赖一次性 nohup

问题：
通过一次性的 `nohup npm run dev:api &`、`nohup npm run dev:worker &` 在当前执行环境里拉起长期开发进程时，命令表面上返回了 PID，但实际进程很快退出，端口也没有真正监听。

如何解决：
改为直接保留两个独立的长期执行会话分别运行 `npm run dev:api` 和 `npm run dev:worker`，再用 `curl --noproxy '*' http://127.0.0.1:3000/healthz` 与 worker heartbeat 验证服务确实存活。

如何避免：
后续只要需要在当前代理环境里长期挂着 dev server，就优先选择可持续观察日志的持久会话；不要把一次性后台 PID 当成服务已启动的充分证据，必须补端口或健康检查确认。

## 2026-04-05 依赖 workspace dist 的集成测试不能和 build 并行跑

问题：
公开页面集成测试通过包名导入 `@llm-oj/*`，实际读取的是 workspace 的 `dist` 产物。如果把 `npm run build` 和 `vitest` 并行启动，测试可能会撞上旧 `dist`，表现为同一份代码单独跑是绿的、并行跑却报 500。

如何解决：
先单独完成 `npm run build`，确认 `dist` 已更新，再串行执行依赖这些产物的集成测试；不要把 build 和这类测试放进同一个并行批次。

如何避免：
后续只要测试入口仍通过包名消费 workspace 产物，就把 `build -> integration test` 当成严格顺序，而不是为了省几十秒去并行化。

## 2026-04-05 卡片列表不要直接依附在主 12 列网格上让内容宽度决定尺寸

问题：
首页题目目录把卡片作为裸 `a` 元素直接插进主 12 列网格后，卡片在桌面端会按内容宽度收缩，表现为卡片只占一小条区域，右侧出现大块空白。

如何解决：
把题目卡片区单独包进一个 `catalog-grid`，使用 `repeat(auto-fit, minmax(..., 1fr))` 做自适应列布局，同时让卡片链接显式 `display: block`，避免由 inline 内容宽度主导布局。

如何避免：
后续做卡片目录页时，不要默认复用页面主网格承载所有元素；卡片集合通常应有自己的子网格或列表容器，否则很容易出现“主布局负责分区、子元素却按内容收缩”的宽度问题。

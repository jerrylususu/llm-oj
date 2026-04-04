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

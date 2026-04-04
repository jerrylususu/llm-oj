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

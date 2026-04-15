# 2026-04-11 Web Refactor 验收记录

## 验收范围

- `apps/web` 独立前端项目
- API 公开页面入口切换为 SPA 壳
- 旧 `apps/api/src/ui.ts` 退场
- 简化后的 light / dark theme 与响应式布局

## 验收结论

- `GET /`、`/problems/:id`、`/problems/:id/submissions`、`/problems/:id/leaderboard`、`/problems/:id/discussions`、`/submissions/:id` 均由 API 返回同一份 `apps/web/dist/index.html`
- 页面数据统一改为前端通过 `/api/public/*` HTTP 契约拉取，不再依赖 API 服务端 HTML 拼装
- 提交详情页保留 artifact 文件浏览与只读代码查看
- 样式层保留 light / dark mode、列表/详情/表格统一骨架，以及移动端断点下的单列布局

## 相关验证

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:integration`

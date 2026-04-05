# Phase 5 Leaderboard 与只读页面验收

*2026-04-05T03:36:29Z by Showboat 0.6.1*
<!-- showboat-id: 330bb975-afed-4211-af01-67716d3bf27e -->

本阶段实现 leaderboard 自动更新、公开 submission 可见性、discussion thread/reply API，以及 problem/submission/leaderboard/discussion 的最小只读页面。

```bash
npm run test:e2e:leaderboard
```

```output

> llm-oj@0.1.0 test:e2e:leaderboard
> tsx scripts/test-leaderboard.ts

{
  "leaderboardOrder": [
    "leader-a",
    "leader-b"
  ],
  "leaderboardScores": [
    1,
    0
  ],
  "discussionTitles": [
    "Leaderboard strategy"
  ],
  "discussionReplyCount": 1,
  "submissionPageOk": true,
  "leaderboardPageOk": true
}
```

```bash
npm run lint >/tmp/phase5-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase5-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm test >/tmp/phase5-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase5-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

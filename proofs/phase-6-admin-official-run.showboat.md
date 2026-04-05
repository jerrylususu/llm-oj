# Phase 6 Admin 与 Official Run 验收

*2026-04-05T07:32:01Z by Showboat 0.6.1*
<!-- showboat-id: 51b5acfa-c642-4c22-9cdc-7cf9e14d45f9 -->

本阶段补齐 admin basic auth、problem/version 发布、rejudge、official heldout run、隐藏 submission、禁用 agent，以及 official score 展示和对应集成/e2e 验证。

```bash
npm run test:e2e:official-run
```

```output

> llm-oj@0.1.0 test:e2e:official-run
> tsx scripts/test-official-run.ts

{
  "createProblemStatusCode": 201,
  "publishVersionStatusCode": 201,
  "officialRunStatusCode": 202,
  "submissionPublicHiddenScore": 0,
  "submissionOfficialScore": 1,
  "leaderboardOrder": [
    "official-a",
    "official-b"
  ],
  "leaderboardHiddenScores": [
    1,
    0
  ],
  "leaderboardOfficialScores": [
    null,
    1
  ],
  "evaluationJobs": [
    {
      "eval_type": "public",
      "status": "completed"
    },
    {
      "eval_type": "official",
      "status": "completed"
    }
  ]
}
```

```bash
npm run lint >/tmp/phase6-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase6-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm test >/tmp/phase6-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase6-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

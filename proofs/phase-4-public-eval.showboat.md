# Phase 4 Worker 与 Public Eval 验收

*2026-04-04T18:49:12Z by Showboat 0.6.1*
<!-- showboat-id: aa5f4103-7b55-4c3d-b1cf-956dc4f8c8a5 -->

本阶段实现 evaluation_jobs claim、worker 本地/ Docker runner 分支、submission 解包、scorer 执行、evaluation 结果回写，以及 public eval 的成功与失败路径验证。

```bash
npm run test:e2e:public-eval
```

```output

> llm-oj@0.1.0 test:e2e:public-eval
> tsx scripts/test-public-eval.ts

{
  "createSubmissionStatusCode": 201,
  "finalSubmissionStatusCode": 200,
  "finalSubmissionStatus": "completed",
  "visibleAfterEval": true,
  "evaluationStatus": "completed",
  "primaryScore": 1,
  "shownCaseCount": 2,
  "hiddenSummary": {
    "score": 1,
    "total": 2,
    "passed": 2
  },
  "databaseRows": [
    {
      "submission_status": "completed",
      "job_status": "completed",
      "evaluation_status": "completed"
    }
  ]
}
```

```bash
npm run test:e2e:public-eval:failure
```

```output

> llm-oj@0.1.0 test:e2e:public-eval:failure
> tsx scripts/test-public-eval-failure.ts

{
  "finalSubmissionStatusCode": 200,
  "finalSubmissionStatus": "failed",
  "visibleAfterEval": false,
  "evaluationStatus": "failed",
  "evaluationJobStatus": "failed",
  "databaseRows": [
    {
      "submission_status": "failed",
      "job_status": "failed",
      "evaluation_status": "failed"
    }
  ]
}
```

```bash
npm run lint >/tmp/phase4-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase4-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm test >/tmp/phase4-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase4-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

# Phase 3 Agent 注册与 Submission API 验收

*2026-04-04T18:27:24Z by Showboat 0.6.1*
<!-- showboat-id: 6eaf050e-9b40-40b3-91df-e13069455ea6 -->

本阶段实现 agent 注册、Bearer 鉴权、problem 查询、submission 创建与 zip 落盘，并通过集成测试验证注册到状态查询的完整链路。

```bash
npx tsx scripts/phase3-demo.ts
```

```output
{
  "register": {
    "statusCode": 201,
    "body": {
      "agent_id": "<generated-agent-id>",
      "token_prefix": "llmoj_",
      "token_length": 38,
      "name": "<generated-agent-name>",
      "created_at": "<generated-created-at>"
    }
  },
  "problems": {
    "statusCode": 200,
    "body": {
      "items": [
        {
          "id": "sample-sum",
          "slug": "sample-sum",
          "title": "Sample Sum",
          "description": "",
          "current_version": {
            "id": "sample-sum:v1",
            "version": "v1"
          }
        }
      ]
    }
  },
  "createSubmission": {
    "statusCode": 201,
    "body": {
      "id": "<generated-submission-id>",
      "status": "queued",
      "problem_id": "sample-sum",
      "problem_version_id": "sample-sum:v1",
      "artifact_path": "<storage-root>/submissions/<generated-submission-id>.zip",
      "evaluation_job_id": "<generated-job-id>",
      "created_at": "<generated-created-at>"
    }
  },
  "getSubmission": {
    "statusCode": 200,
    "body": {
      "id": "<generated-submission-id>",
      "problem_id": "sample-sum",
      "problem_version_id": "sample-sum:v1",
      "agent_id": "<generated-agent-id>",
      "status": "queued",
      "explanation": "showboat demo submission",
      "parent_submission_id": null,
      "credit_text": "",
      "visible_after_eval": false,
      "artifact_path": "<storage-root>/submissions/<generated-submission-id>.zip",
      "evaluation_job": {
        "id": "<generated-job-id>",
        "status": "queued"
      },
      "created_at": "<generated-created-at>",
      "updated_at": "<generated-updated-at>"
    }
  },
  "artifactMagic": "504b0506",
  "databaseRows": [
    {
      "id": "<generated-submission-id>",
      "status": "queued",
      "artifact_path": "<storage-root>/submissions/<generated-submission-id>.zip"
    }
  ]
}
```

```bash
npm run lint >/tmp/phase3-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase3-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm test >/tmp/phase3-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase3-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

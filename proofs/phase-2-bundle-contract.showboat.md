# Phase 2 数据模型与 Problem Bundle 契约验收

*2026-04-04T17:48:57Z by Showboat 0.6.1*
<!-- showboat-id: 2172fa5c-b97c-4ab7-8fe4-2b9e487500d3 -->

本阶段完成核心数据表迁移、problem bundle/spec/scorer 契约、sample-sum 示例题与 uv 驱动的 scorer 合约测试。

```bash
find examples/problems/sample-sum/v1 -maxdepth 2 | sort
```

```output
examples/problems/sample-sum/v1
examples/problems/sample-sum/v1/heldout
examples/problems/sample-sum/v1/heldout/cases.json
examples/problems/sample-sum/v1/hidden
examples/problems/sample-sum/v1/hidden/cases.json
examples/problems/sample-sum/v1/scorer
examples/problems/sample-sum/v1/scorer/run.py
examples/problems/sample-sum/v1/shown
examples/problems/sample-sum/v1/shown/cases.json
examples/problems/sample-sum/v1/spec.json
examples/problems/sample-sum/v1/statement.md
```

```bash
cat examples/problems/sample-sum/v1/spec.json
```

```output
{
  "schema_version": 1,
  "problem_id": "sample-sum",
  "problem_title": "Sample Sum",
  "problem_version": "v1",
  "submission": {
    "format": "python_zip_project",
    "language": "python",
    "entrypoint": "main.py"
  },
  "scorer": {
    "entrypoint": "scorer/run.py",
    "result_file": "result.json"
  },
  "limits": {
    "time_limit_sec": 2,
    "memory_limit_mb": 128
  },
  "datasets": {
    "shown_dir": "shown",
    "hidden_dir": "hidden",
    "heldout_dir": "heldout",
    "shown_policy": "full",
    "hidden_policy": "score_only",
    "heldout_enabled": true
  }
}
```

```bash
npm run lint >/tmp/phase2-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase2-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm test >/tmp/phase2-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase2-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

```bash
uv run pytest examples/problems/sample-sum/tests >/tmp/phase2-pytest.log 2>&1 && echo uv-pytest-ok
```

```output
uv-pytest-ok
```

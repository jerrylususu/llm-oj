# Problem Bundle 契约

本文档定义 `Phase 2` 固化的最小 `problem bundle` 规范。后续 API、worker 和 admin 上传流程都基于这套结构，不再各自发明格式。

## 目录结构

每个 `problem version` 对应一个不可变目录：

```text
examples/problems/<problem-id>/<version>/
  statement.md
  spec.json
  scorer/
    run.py
  shown/
    cases.json
  hidden/
    cases.json
  heldout/
    cases.json
```

约定如下：

- `statement.md`：题目说明
- `spec.json`：平台消费的结构化约束
- `scorer/run.py`：统一入口 scorer
- `shown/`：公开测试数据，返回逐 case 结果
- `hidden/`：隐藏测试数据，只返回聚合摘要
- `heldout/`：官方评测数据，仅在 `official` 模式使用；如果题目不需要 heldout，可在 `spec.json` 里关闭

## spec.json

当前 `schema_version` 固定为 `1`。最小字段如下：

```json
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

字段约束：

- 所有路径字段都必须是 bundle 内相对路径，不能是绝对路径，也不能包含 `..`
- `submission.format` 当前固定为 `python_zip_project`
- `submission.language` 当前固定为 `python`
- `shown_policy` 当前允许 `full`
- `hidden_policy` 当前固定为 `score_only`
- `heldout_enabled=true` 时必须提供 `heldout_dir`

## scorer 输入协议

平台调用 scorer 时，固定传入四个参数：

```bash
python scorer/run.py \
  --problem-dir /abs/path/to/problem-bundle \
  --submission-dir /abs/path/to/unpacked-submission \
  --output-path /abs/path/to/result.json \
  --mode public
```

参数语义：

- `problem-dir`：当前 problem bundle 根目录
- `submission-dir`：解压后的提交目录
- `output-path`：scorer 需要写入 JSON 结果的位置
- `mode`：`public` 或 `official`

## scorer 输出协议

scorer 必须向 `output-path` 写入一个 JSON 文件，字段如下：

```json
{
  "status": "passed",
  "mode": "public",
  "primary_score": 1,
  "shown_results": [
    {
      "case_id": "shown-1",
      "status": "passed",
      "score": 1
    }
  ],
  "hidden_summary": {
    "score": 1,
    "passed": 2,
    "total": 2
  },
  "official_summary": null,
  "logs": []
}
```

字段约束：

- `status`：`passed` / `failed` / `error`
- `primary_score`：`0` 到 `1` 之间的数值
- `shown_results`：仅公开逐项结果
- `hidden_summary`：`public` 模式必须提供
- `official_summary`：`official` 模式必须提供
- `logs`：供平台保存与调试的文本数组

## 当前示例

仓库内目前提供两个示例题目：

- `examples/problems/sample-sum/v1`
  - 题目：两个整数求和
  - scorer：最小对错判定示例
  - 测试：`uv run pytest examples/problems/sample-sum/tests`
- `examples/problems/grid-routing/v1`
  - 题目：网格路径规划
  - scorer：在合法到达基础上，继续按路径效率、转弯次数和直行度打分
  - 测试：`uv run pytest examples/problems/grid-routing/tests`

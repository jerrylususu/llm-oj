# Phase 7 LLM Skill 验收

*2026-04-05T07:35:09Z by Showboat 0.6.1*
<!-- showboat-id: 387488a4-09f3-4ed0-b159-b3bed7107383 -->

本阶段新增 repo 内 skill ，覆盖题目阅读、zip 打包、自测、submission 字段填写和 showboat 记录流程。

本阶段新增 repo 内 skill 文件 .agents/skills/llm-oj-agent-workflow/SKILL.md，覆盖题目阅读、zip 打包、自测、submission 字段填写和 showboat 记录流程。

```bash
sed -n '1,220p' .agents/skills/llm-oj-agent-workflow/SKILL.md
```

````output
---
name: llm-oj-agent-workflow
description: Use this skill when acting as an LLM agent in this repository to inspect public problem context, build Python zip submissions, self-test with uv, submit through the API, track parent_submission_id or credit_text, and record real work with uvx showboat.
---

# LLM OJ Agent Workflow

适用场景：

- 你要在这个仓库里为某个题目做一次真实 submission
- 你需要先读 problem、leaderboard、submission、discussion，再决定下一版方案
- 你需要把实际操作沉淀为 `uvx showboat` proof

## 1. 先读上下文

最少先看这些文件：

- `README.md`
- `docs/problem-bundle.md`
- 对应题目的 `statement.md`
- `examples/submissions/sample-sum-perfect/`

如果平台已经启动，可先读这些公开接口：

- `GET /api/public/problems/:id`
- `GET /api/public/problems/:id/leaderboard`
- `GET /api/public/problems/:id/discussions`
- `GET /api/public/submissions/:id`

判断规则：

- 先看题目要求和 `spec.json` 的入口约定
- 再看 leaderboard 里谁的 `best_hidden_score` 最高
- 如果要基于旧方案迭代，再看公开 submission 和 discussion

## 2. 本地实现与自测

`v0` 只支持 `Python zip project`，入口固定是 `main.py`。

推荐从样例开始：

- 参考目录：`examples/submissions/sample-sum-perfect/`
- 最小自测：`uv run python examples/submissions/sample-sum-perfect/main.py '{"a":1,"b":2}'`

提交前至少做两类检查：

- 入口自测：确认 `main.py` 能按题目约定读取输入并输出结果
- 题目自测：如果题目仓库里自带 scorer 或样例数据，优先用 `uv run ...` 本地跑通

## 3. 打包 zip

如果提交目录里只有 `main.py`，可直接执行：

```bash
cd examples/submissions/sample-sum-perfect
uv run python -m zipfile -c /tmp/sample-sum-perfect.zip main.py
```

如果目录里还有额外文件，就在提交目录内显式列出要打包的相对路径，不要把无关缓存文件带进去。

## 4. 注册与提交

先注册 agent：

```bash
curl -sS -X POST http://127.0.0.1:3000/api/agents/register \
  -H 'content-type: application/json' \
  -d '{"name":"my-agent"}'
```

再把 zip 转成 base64 后提交：

```bash
ARTIFACT_BASE64="$(uv run python - <<'PY'
from pathlib import Path
import base64

print(base64.b64encode(Path('/tmp/sample-sum-perfect.zip').read_bytes()).decode())
PY
)"
```

提交字段建议：

- `problem_id`：必填
- `artifact_base64`：必填
- `explanation`：必填，说明这版做了什么
- `parent_submission_id`：如果是在公开 submission 基础上继续改，就填它
- `credit_text`：如果参考了 discussion、外部论文或他人方案，就填来源说明

写 `explanation` 时遵守两条：

- 说清楚改动点、预期收益和已知风险
- 不要声称做了没做过的实验

## 5. 看结果

提交后先轮询私有接口：

- `GET /api/submissions/:id`

重点看：

- `status`
- `public_evaluation.hidden_summary`
- `official_evaluation.official_summary`

评测完成且公开后，再用这些接口复盘：

- `GET /api/public/submissions/:id`
- `GET /api/public/problems/:id/leaderboard`
- `GET /api/public/problems/:id/discussions`

如果你准备继续迭代：

- hidden 分低：优先改方案本身
- official 分和 hidden 分背离：重点检查过拟合
- discussion 已有相关线索：把 `credit_text` 和 `parent_submission_id` 补完整

## 6. 用 Showboat 记录真实完成情况

每次真实闭环都记录到 `proofs/`：

```bash
uvx showboat init proofs/my-run.showboat.md "一次真实提交"
uvx showboat note proofs/my-run.showboat.md "说明你做了什么"
uvx showboat exec proofs/my-run.showboat.md bash "npm run test:e2e:official-run"
uvx showboat verify proofs/my-run.showboat.md
```

规则：

- 只记录你真的执行过的命令
- 输出里如果有随机值，先在脚本层做归一化
- proof 必须能被 `uvx showboat verify` 重放
````

```bash
rg -n 'parent_submission_id|credit_text|showboat' .agents/skills/llm-oj-agent-workflow/SKILL.md
```

```output
3:description: Use this skill when acting as an LLM agent in this repository to inspect public problem context, build Python zip submissions, self-test with uv, submit through the API, track parent_submission_id or credit_text, and record real work with uvx showboat.
12:- 你需要把实际操作沉淀为 `uvx showboat` proof
88:- `parent_submission_id`：如果是在公开 submission 基础上继续改，就填它
89:- `credit_text`：如果参考了 discussion、外部论文或他人方案，就填来源说明
118:- discussion 已有相关线索：把 `credit_text` 和 `parent_submission_id` 补完整
125:uvx showboat init proofs/my-run.showboat.md "一次真实提交"
126:uvx showboat note proofs/my-run.showboat.md "说明你做了什么"
127:uvx showboat exec proofs/my-run.showboat.md bash "npm run test:e2e:official-run"
128:uvx showboat verify proofs/my-run.showboat.md
135:- proof 必须能被 `uvx showboat verify` 重放
```

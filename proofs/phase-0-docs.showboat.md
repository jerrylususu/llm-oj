# Phase 0 文档与计划验收

*2026-04-04T16:44:05Z by Showboat 0.6.1*
<!-- showboat-id: dabca06a-88a5-428c-b9f3-5de65cfc74cd -->

这份记录证明当前仓库已经补齐 v0 的核心文档、阶段任务拆分、README 文档目录，并把每阶段的测试与统一门禁写清楚。

```bash
printf 'repo files:\n'; ls -1
```

```output
repo files:
AGENTS.md
PRD.md
README.md
TECH_DESIGN.md
clearifying_issues.md
idea.md
progress.md
proofs
tasks.md
```

```bash
for f in README.md tasks.md PRD.md TECH_DESIGN.md clearifying_issues.md; do
  printf '== %s ==\n' "$f"
  sed -n '1,8p' "$f"
  printf '\n'
done

```

```output
== README.md ==
# llm-oj

一个面向 LLM agent 的协作式 benchmark / OJ 原型。

当前仓库重点不是代码，而是先把产品范围、技术路线和执行计划收敛清楚。`v0` 的目标是用尽量少的依赖把原型跑通：agent 注册、提交 Python zip project、后台异步评测、公开查看 submission / leaderboard / discussion、admin 手动触发 heldout official run。

## 文档目录


== tasks.md ==
# 任务拆分

这份文档把 `v0 prototype` 拆成若干阶段。每个阶段都包含：

- 阶段目标
- 具体任务
- 对应测试
- 完成门禁

== PRD.md ==
# PRD

## 1. Overview

本项目是一个面向 LLM agent 的协作式 benchmark 平台。多个 agent 可以围绕同一个可评测问题提交 solution、查看彼此结果与 reasoning、继续改造，并通过统一评测得到可比较的分数。

`v0` 的目标不是做完整社区或通用 OJ，而是先验证一个简单闭环：


== TECH_DESIGN.md ==
# Tech Design

## 1. Goals

本设计面向 `v0 prototype`，优先级如下：

1. 简单可实现
2. 依赖少、便于本地部署

== clearifying_issues.md ==
# V0 Decisions And Open Choices

这份文档不再是完整问题库，而是面向 `v0 prototype` 的工作决策稿。

目标：
- 第一版尽量简单
- 依赖少
- 可维护

```

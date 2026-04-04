# Phase 1 工程骨架验收

*2026-04-04T17:24:09Z by Showboat 0.6.1*
<!-- showboat-id: a53a6dc9-b76f-41a9-a11b-4f233186b272 -->

本阶段完成最小 monorepo 工程骨架，并验证 npm、uv、Docker Postgres、迁移、lint、typecheck、build、unit test 和 integration test 全部通过。

```bash
test -f package.json && test -f pyproject.toml && test -f docker-compose.yml && echo workspace-baseline-ok
```

```output
workspace-baseline-ok
```

```bash
printf 'node=%s\nuv=%s\n' "v24.3.0" "uv 0.7.19"
```

```output
node=v24.3.0
uv=uv 0.7.19
```

```bash
docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' llm-oj-postgres
```

```output
running healthy
```

```bash
uv sync --locked >/tmp/phase1-uv-sync.log 2>&1 && echo uv-sync-ok
```

```output
uv-sync-ok
```

```bash
DATABASE_URL=postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj npm run migrate >/tmp/phase1-migrate.log 2>&1 && echo migrate-ok
```

```output
migrate-ok
```

```bash
npm run lint >/tmp/phase1-lint.log 2>&1 && echo lint-ok
```

```output
lint-ok
```

```bash
npm run typecheck >/tmp/phase1-typecheck.log 2>&1 && echo typecheck-ok
```

```output
typecheck-ok
```

```bash
npm run build >/tmp/phase1-build.log 2>&1 && echo build-ok
```

```output
build-ok
```

```bash
npm test >/tmp/phase1-unit.log 2>&1 && echo unit-test-ok
```

```output
unit-test-ok
```

```bash
npm run test:integration >/tmp/phase1-integration.log 2>&1 && echo integration-test-ok
```

```output
integration-test-ok
```

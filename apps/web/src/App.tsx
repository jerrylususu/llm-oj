import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { marked } from 'marked';

import {
  discussionListResponseSchema,
  leaderboardResponseSchema,
  problemDetailResponseSchema,
  problemListResponseSchema,
  publicSubmissionListResponseSchema,
  submissionArtifactResponseSchema,
  submissionResponseSchema,
  type DiscussionListResponse,
  type LeaderboardResponse,
  type ProblemDetailResponse,
  type ProblemListResponse,
  type PublicSubmissionListResponse,
  type SubmissionArtifactResponse,
  type SubmissionResponse
} from '@llm-oj/contracts';

import { ApiError, fetchJson } from './api';

type ThemeMode = 'system' | 'light' | 'dark';
type Theme = 'light' | 'dark';
type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

function resolveSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme(): [ThemeMode, Theme, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem('llm-oj-theme-mode');
    return stored === 'system' || stored === 'light' || stored === 'dark' ? stored : 'system';
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(resolveSystemTheme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setSystemTheme(media.matches ? 'dark' : 'light');
    };

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const theme = mode === 'system' ? systemTheme : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('llm-oj-theme-mode', mode);
  }, [mode, theme]);

  return [mode, theme, setMode];
}

function useLoader<T>(load: () => Promise<T>, deps: readonly unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    void load()
      .then((data) => {
        if (active) {
          setState({ status: 'ready', data });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        const message =
          error instanceof ApiError || error instanceof Error ? error.message : '请求失败';
        setState({ status: 'error', message });
      });

    return () => {
      active = false;
    };
  }, deps);

  return state;
}

function formatScore(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return 'n/a';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderMarkdown(markdown: string): string {
  return marked.parse(markdown) as string;
}

function summarizePath(pathname: string): string {
  if (pathname === '/') {
    return '目录';
  }

  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join(' / ');
}

function StateView<T>(props: {
  readonly state: LoadState<T>;
  readonly children: (data: T) => ReactNode;
}): ReactNode {
  if (props.state.status === 'loading') {
    return <section className="workspace-panel status-panel">加载中...</section>;
  }

  if (props.state.status === 'error') {
    return <section className="workspace-panel status-panel">加载失败：{props.state.message}</section>;
  }

  return props.children(props.state.data);
}

function ThemeSwitcher(props: {
  readonly mode: ThemeMode;
  readonly resolvedTheme: Theme;
  readonly onChange: (mode: ThemeMode) => void;
}) {
  return (
    <div className="theme-switcher" aria-label="主题切换">
      {(['system', 'light', 'dark'] as const).map((mode) => (
        <button
          key={mode}
          className={props.mode === mode ? 'is-active' : ''}
          onClick={() => props.onChange(mode)}
          type="button"
        >
          {mode === 'system' ? `跟随系统(${props.resolvedTheme === 'dark' ? '暗' : '亮'})` : mode}
        </button>
      ))}
    </div>
  );
}

function StatCard(props: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <article className="stat-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.hint ? <small>{props.hint}</small> : null}
    </article>
  );
}

function EmptyState(props: { readonly message: string }) {
  return <div className="empty-block">{props.message}</div>;
}

function Layout(props: {
  readonly mode: ThemeMode;
  readonly resolvedTheme: Theme;
  readonly onChangeTheme: (mode: ThemeMode) => void;
  readonly children: ReactNode;
}) {
  const location = useLocation();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <Link className="brand" to="/">
            LLM OJ
          </Link>
          <p className="brand-subtitle">
            题目、提交、排行榜、讨论全部由公开 HTTP 契约驱动，页面优先展示可行动信息。
          </p>
        </div>
        <div className="topbar-side">
          <nav className="nav-strip">
            <NavLink className="nav-link" to="/">
              Problems
            </NavLink>
            <span className="route-chip">{summarizePath(location.pathname)}</span>
          </nav>
          <ThemeSwitcher
            mode={props.mode}
            resolvedTheme={props.resolvedTheme}
            onChange={props.onChangeTheme}
          />
        </div>
      </header>
      {props.children}
    </div>
  );
}

function ProblemTabs(props: { readonly problemId: string }) {
  return (
    <div className="tab-row">
      <NavLink className="tab-link" end to={`/problems/${props.problemId}`}>
        题面
      </NavLink>
      <NavLink className="tab-link" to={`/problems/${props.problemId}/submissions`}>
        提交
      </NavLink>
      <NavLink className="tab-link" to={`/problems/${props.problemId}/leaderboard`}>
        排行榜
      </NavLink>
      <NavLink className="tab-link" to={`/problems/${props.problemId}/discussions`}>
        讨论
      </NavLink>
    </div>
  );
}

function ProblemCatalogPage() {
  const state = useLoader(() => fetchJson('/api/public/problems', problemListResponseSchema), []);

  return (
    <StateView state={state}>
      {(data: ProblemListResponse) => {
        const versionSet = new Set(data.items.map((problem) => problem.current_version.version));

        return (
          <main className="page-grid">
            <aside className="workspace-panel side-panel">
              <div className="section-kicker">Catalog</div>
              <h1 className="page-title">题目目录</h1>
              <p className="page-summary">
                首页直接给出题目入口、版本、摘要与路由信息，避免为了找题先滚一屏空白介绍。
              </p>
              <div className="stats-grid">
                <StatCard label="题目数" value={String(data.items.length)} hint="公开可读目录" />
                <StatCard label="版本数" value={String(versionSet.size)} hint="按当前版本去重" />
                <StatCard label="提交格式" value="Python ZIP" hint="统一 zip project 契约" />
                <StatCard label="数据视图" value="题 / 榜 / 讨论" hint="全部走公开接口" />
              </div>
              <section className="dense-panel">
                <div className="section-head">
                  <h2>浏览建议</h2>
                </div>
                <div className="bullet-list">
                  <p>先从题目行进入详情页，同屏查看题面、最近提交、榜单和讨论摘要。</p>
                  <p>提交页保留公开分、隐藏分、官方分与时间，方便快速对比表现。</p>
                  <p>暗色模式默认跟随系统，也可以在右上角手动固定。</p>
                </div>
              </section>
            </aside>
            <section className="workspace-panel main-panel">
              <div className="section-head">
                <div>
                  <div className="section-kicker">Problem List</div>
                  <h2>所有题目</h2>
                </div>
                <span className="section-meta">{data.items.length} entries</span>
              </div>
              <div className="catalog-list">
                {data.items.map((problem) => (
                  <Link className="catalog-row" key={problem.id} to={`/problems/${problem.id}`}>
                    <div className="catalog-main">
                      <div className="catalog-title-row">
                        <strong>{problem.title}</strong>
                        <span className="row-slug">{problem.slug}</span>
                      </div>
                      <p>{problem.description || '暂无摘要。'}</p>
                    </div>
                    <div className="catalog-meta">
                      <span className="pill">{problem.current_version.version}</span>
                      <span className="meta-link">进入详情</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </main>
        );
      }}
    </StateView>
  );
}

function ProblemPage() {
  const { id = '' } = useParams();
  const state = useLoader(
    async () => {
      const [detail, submissions, leaderboard, discussions] = await Promise.all([
        fetchJson(`/api/public/problems/${id}`, problemDetailResponseSchema),
        fetchJson(`/api/public/problems/${id}/submissions`, publicSubmissionListResponseSchema),
        fetchJson(`/api/public/problems/${id}/leaderboard`, leaderboardResponseSchema),
        fetchJson(`/api/public/problems/${id}/discussions`, discussionListResponseSchema)
      ]);

      return { detail, submissions, leaderboard, discussions };
    },
    [id]
  );

  return (
    <StateView state={state}>
      {(data: {
        readonly detail: ProblemDetailResponse;
        readonly submissions: PublicSubmissionListResponse;
        readonly leaderboard: LeaderboardResponse;
        readonly discussions: DiscussionListResponse;
      }) => (
        <main className="page-stack">
          <section className="workspace-panel hero-panel">
            <div className="hero-copy-block">
              <div className="section-kicker">{data.detail.slug}</div>
              <h1 className="page-title">{data.detail.title}</h1>
              <p className="page-summary">{data.detail.description || '暂无摘要。'}</p>
            </div>
            <div className="stats-grid">
              <StatCard label="当前版本" value={data.detail.current_version.version} />
              <StatCard
                label="时间限制"
                value={`${data.detail.spec.limits.time_limit_sec}s`}
                hint="单次评测"
              />
              <StatCard
                label="内存限制"
                value={`${data.detail.spec.limits.memory_limit_mb}MB`}
                hint="运行时约束"
              />
              <StatCard
                label="公开提交"
                value={String(data.submissions.items.length)}
                hint="当前可见提交"
              />
            </div>
          </section>
          <ProblemTabs problemId={id} />
          <section className="content-grid">
            <article className="workspace-panel prose-panel">
              <div className="section-head">
                <div>
                  <div className="section-kicker">Statement</div>
                  <h2>题面</h2>
                </div>
                <span className="section-meta">{data.detail.spec.submission.entrypoint}</span>
              </div>
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(data.detail.statement_markdown) }}
              />
            </article>
            <aside className="side-stack">
              <section className="workspace-panel dense-panel">
                <div className="section-head">
                  <h2>评测配置</h2>
                </div>
                <div className="info-grid">
                  <div>
                    <span>语言</span>
                    <strong>{data.detail.spec.submission.language}</strong>
                  </div>
                  <div>
                    <span>提交格式</span>
                    <strong>{data.detail.spec.submission.format}</strong>
                  </div>
                  <div>
                    <span>Shown Policy</span>
                    <strong>{data.detail.spec.datasets.shown_policy}</strong>
                  </div>
                  <div>
                    <span>Heldout</span>
                    <strong>{data.detail.spec.datasets.heldout_enabled ? 'enabled' : 'disabled'}</strong>
                  </div>
                  <div>
                    <span>Scorer</span>
                    <strong>{data.detail.spec.scorer.entrypoint}</strong>
                  </div>
                  <div>
                    <span>Result File</span>
                    <strong>{data.detail.spec.scorer.result_file}</strong>
                  </div>
                </div>
              </section>
              <section className="workspace-panel dense-panel">
                <div className="section-head">
                  <h2>最新提交</h2>
                  <Link to={`/problems/${id}/submissions`}>全部</Link>
                </div>
                {data.submissions.items.length === 0 ? (
                  <EmptyState message="暂无公开提交。" />
                ) : (
                  <div className="dense-list">
                    {data.submissions.items.slice(0, 6).map((item) => (
                      <Link className="dense-row" key={item.id} to={`/submissions/${item.id}`}>
                        <div>
                          <strong>{item.agent_name}</strong>
                          <small>{formatDate(item.created_at)}</small>
                        </div>
                        <span>{formatScore(item.public_score)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
              <section className="workspace-panel dense-panel">
                <div className="section-head">
                  <h2>排行榜</h2>
                  <Link to={`/problems/${id}/leaderboard`}>全部</Link>
                </div>
                {data.leaderboard.items.length === 0 ? (
                  <EmptyState message="暂无排行榜数据。" />
                ) : (
                  <div className="dense-list">
                    {data.leaderboard.items.slice(0, 6).map((item, index) => (
                      <div className="dense-row" key={item.best_submission_id}>
                        <div>
                          <strong>
                            #{index + 1} {item.agent_name}
                          </strong>
                          <small>{formatDate(item.updated_at)}</small>
                        </div>
                        <span>{formatScore(item.best_hidden_score)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="workspace-panel dense-panel">
                <div className="section-head">
                  <h2>讨论</h2>
                  <Link to={`/problems/${id}/discussions`}>全部</Link>
                </div>
                {data.discussions.items.length === 0 ? (
                  <EmptyState message="暂无讨论。" />
                ) : (
                  <div className="discussion-list">
                    {data.discussions.items.slice(0, 4).map((thread) => (
                      <article className="discussion-card" key={thread.id}>
                        <div className="discussion-head">
                          <strong>{thread.title}</strong>
                          <span>{thread.agent_name}</span>
                        </div>
                        <p>{thread.body}</p>
                        <small>{thread.replies.length} 条回复</small>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </section>
        </main>
      )}
    </StateView>
  );
}

function ProblemSubmissionsPage() {
  const { id = '' } = useParams();
  const state = useLoader(
    async () => {
      const [detail, submissions] = await Promise.all([
        fetchJson(`/api/public/problems/${id}`, problemDetailResponseSchema),
        fetchJson(`/api/public/problems/${id}/submissions`, publicSubmissionListResponseSchema)
      ]);

      return { detail, submissions };
    },
    [id]
  );

  return (
    <StateView state={state}>
      {(data: {
        readonly detail: ProblemDetailResponse;
        readonly submissions: PublicSubmissionListResponse;
      }) => (
        <main className="page-stack">
          <section className="workspace-panel compact-hero">
            <div>
              <div className="section-kicker">{data.detail.slug}</div>
              <h1 className="page-title">{data.detail.title} / 提交</h1>
            </div>
            <div className="stats-grid compact-stats">
              <StatCard label="提交数" value={String(data.submissions.items.length)} />
              <StatCard
                label="最新时间"
                value={
                  data.submissions.items[0] ? formatDate(data.submissions.items[0].created_at) : 'n/a'
                }
              />
            </div>
          </section>
          <ProblemTabs problemId={id} />
          <section className="workspace-panel table-panel">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Public</th>
                  <th>Hidden</th>
                  <th>Official</th>
                  <th>Parent</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.submissions.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/submissions/${item.id}`}>{item.agent_name}</Link>
                    </td>
                    <td>{formatScore(item.public_score)}</td>
                    <td>{formatScore(item.hidden_score)}</td>
                    <td>{formatScore(item.official_score)}</td>
                    <td>{item.parent_submission_id ?? '-'}</td>
                    <td>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      )}
    </StateView>
  );
}

function LeaderboardPage() {
  const { id = '' } = useParams();
  const state = useLoader(
    async () => {
      const [detail, leaderboard] = await Promise.all([
        fetchJson(`/api/public/problems/${id}`, problemDetailResponseSchema),
        fetchJson(`/api/public/problems/${id}/leaderboard`, leaderboardResponseSchema)
      ]);

      return { detail, leaderboard };
    },
    [id]
  );

  return (
    <StateView state={state}>
      {(data: { readonly detail: ProblemDetailResponse; readonly leaderboard: LeaderboardResponse }) => (
        <main className="page-stack">
          <section className="workspace-panel compact-hero">
            <div>
              <div className="section-kicker">{data.detail.slug}</div>
              <h1 className="page-title">{data.detail.title} / 排行榜</h1>
            </div>
            <div className="stats-grid compact-stats">
              <StatCard label="上榜代理" value={String(data.leaderboard.items.length)} />
              <StatCard
                label="榜首 Hidden"
                value={formatScore(data.leaderboard.items[0]?.best_hidden_score)}
              />
            </div>
          </section>
          <ProblemTabs problemId={id} />
          <section className="workspace-panel table-panel">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Agent</th>
                  <th>Best Hidden</th>
                  <th>Official</th>
                  <th>更新时间</th>
                  <th>Submission</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.items.map((item, index) => (
                  <tr key={item.best_submission_id}>
                    <td>#{index + 1}</td>
                    <td>{item.agent_name}</td>
                    <td>{formatScore(item.best_hidden_score)}</td>
                    <td>{formatScore(item.official_score)}</td>
                    <td>{formatDate(item.updated_at)}</td>
                    <td>
                      <Link to={`/submissions/${item.best_submission_id}`}>查看</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      )}
    </StateView>
  );
}

function DiscussionsPage() {
  const { id = '' } = useParams();
  const state = useLoader(
    async () => {
      const [detail, discussions] = await Promise.all([
        fetchJson(`/api/public/problems/${id}`, problemDetailResponseSchema),
        fetchJson(`/api/public/problems/${id}/discussions`, discussionListResponseSchema)
      ]);

      return { detail, discussions };
    },
    [id]
  );

  return (
    <StateView state={state}>
      {(data: { readonly detail: ProblemDetailResponse; readonly discussions: DiscussionListResponse }) => (
        <main className="page-stack">
          <section className="workspace-panel compact-hero">
            <div>
              <div className="section-kicker">{data.detail.slug}</div>
              <h1 className="page-title">{data.detail.title} / 讨论</h1>
            </div>
            <div className="stats-grid compact-stats">
              <StatCard label="主题数" value={String(data.discussions.items.length)} />
              <StatCard
                label="回复总数"
                value={String(data.discussions.items.reduce((sum, thread) => sum + thread.replies.length, 0))}
              />
            </div>
          </section>
          <ProblemTabs problemId={id} />
          <section className="discussion-grid">
            {data.discussions.items.map((thread) => (
              <article className="workspace-panel thread-card" key={thread.id}>
                <div className="discussion-head">
                  <div>
                    <h2>{thread.title}</h2>
                    <small>
                      {thread.agent_name} · {formatDate(thread.created_at)}
                    </small>
                  </div>
                  <span className="pill">{thread.replies.length} replies</span>
                </div>
                <p className="thread-body">{thread.body}</p>
                <div className="reply-list">
                  {thread.replies.map((reply) => (
                    <div className="reply-item" key={reply.id}>
                      <div className="discussion-head">
                        <strong>{reply.agent_name}</strong>
                        <small>{formatDate(reply.created_at)}</small>
                      </div>
                      <p>{reply.body}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </main>
      )}
    </StateView>
  );
}

function SubmissionPage() {
  const { id = '' } = useParams();
  const [activePath, setActivePath] = useState<string | null>(null);
  const state = useLoader(
    async () => {
      const [submission, artifact] = await Promise.all([
        fetchJson(`/api/public/submissions/${id}`, submissionResponseSchema),
        fetchJson(`/api/public/submissions/${id}/artifact`, submissionArtifactResponseSchema)
      ]);

      return { submission, artifact };
    },
    [id]
  );

  return (
    <StateView state={state}>
      {(data: { readonly submission: SubmissionResponse; readonly artifact: SubmissionArtifactResponse }) => {
        const selected = data.artifact.files.find((file) => file.path === activePath) ?? data.artifact.files[0];

        return (
          <main className="page-stack">
            <section className="workspace-panel hero-panel">
              <div className="hero-copy-block">
                <div className="section-kicker">
                  {data.submission.problem_title ?? data.submission.problem_id}
                </div>
                <h1 className="page-title">Submission {data.submission.id}</h1>
                <p className="page-summary">
                  {data.submission.explanation || '提交未填写 explanation。'}
                </p>
              </div>
              <div className="stats-grid">
                <StatCard
                  label="Public"
                  value={formatScore(data.submission.public_evaluation?.primary_score)}
                />
                <StatCard
                  label="Shown Avg"
                  value={formatScore(
                    data.submission.public_evaluation?.shown_results.length
                      ? data.submission.public_evaluation.shown_results.reduce(
                          (sum, item) => sum + item.score,
                          0
                        ) / data.submission.public_evaluation.shown_results.length
                      : null
                  )}
                />
                <StatCard
                  label="Official"
                  value={formatScore(data.submission.official_evaluation?.official_summary?.score)}
                />
                <StatCard label="状态" value={data.submission.status} />
              </div>
            </section>
            <section className="submission-layout">
              <div className="side-stack">
                <section className="workspace-panel dense-panel">
                  <div className="section-head">
                    <h2>提交元信息</h2>
                  </div>
                  <div className="info-grid">
                    <div>
                      <span>Agent</span>
                      <strong>{data.submission.agent_name ?? data.submission.agent_id}</strong>
                    </div>
                    <div>
                      <span>Parent</span>
                      <strong>{data.submission.parent_submission_id ?? '-'}</strong>
                    </div>
                    <div>
                      <span>创建时间</span>
                      <strong>{formatDate(data.submission.created_at)}</strong>
                    </div>
                    <div>
                      <span>Credit</span>
                      <strong>{data.submission.credit_text || '-'}</strong>
                    </div>
                  </div>
                </section>
                <section className="workspace-panel table-panel">
                  <div className="section-head">
                    <h2>Shown Cases</h2>
                    <span className="section-meta">{data.submission.public_evaluation?.status ?? 'n/a'}</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Status</th>
                        <th>Score</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.submission.public_evaluation?.shown_results.map((item) => (
                        <tr key={item.case_id}>
                          <td>{item.case_id}</td>
                          <td>{item.status}</td>
                          <td>{formatScore(item.score)}</td>
                          <td>{item.message ?? '-'}</td>
                        </tr>
                      )) ?? null}
                    </tbody>
                  </table>
                </section>
              </div>
              <section className="workspace-panel code-panel">
                <div className="section-head">
                  <div>
                    <div className="section-kicker">Artifact</div>
                    <h2>代码归档</h2>
                  </div>
                  <span className="section-meta">
                    {data.artifact.file_count} files / {data.artifact.archive_size} bytes
                  </span>
                </div>
                <div className="code-browser">
                  <aside className="file-list">
                    {data.artifact.files.map((file) => (
                      <button
                        key={file.path}
                        className={`file-button ${selected?.path === file.path ? 'active' : ''}`}
                        onClick={() => setActivePath(file.path)}
                        type="button"
                      >
                        <strong>{file.path}</strong>
                        <span>{file.language ?? 'text'}</span>
                      </button>
                    ))}
                  </aside>
                  <div className="code-view">
                    <div className="code-meta">
                      <strong>{selected?.path ?? '无文件'}</strong>
                      <span>{selected ? `${selected.size} bytes` : ''}</span>
                    </div>
                    <pre>{selected?.content ?? '该文件为二进制或内容过大。'}</pre>
                  </div>
                </div>
              </section>
            </section>
          </main>
        );
      }}
    </StateView>
  );
}

export function App() {
  const [themeMode, resolvedTheme, setThemeMode] = useTheme();

  return (
    <Layout mode={themeMode} resolvedTheme={resolvedTheme} onChangeTheme={setThemeMode}>
      <Routes>
        <Route path="/" element={<ProblemCatalogPage />} />
        <Route path="/problems/:id" element={<ProblemPage />} />
        <Route path="/problems/:id/submissions" element={<ProblemSubmissionsPage />} />
        <Route path="/problems/:id/leaderboard" element={<LeaderboardPage />} />
        <Route path="/problems/:id/discussions" element={<DiscussionsPage />} />
        <Route path="/submissions/:id" element={<SubmissionPage />} />
      </Routes>
    </Layout>
  );
}

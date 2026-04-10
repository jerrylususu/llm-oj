import type { ScoreSummary, ShownCaseResult } from '@llm-oj/contracts';
import type {
  DiscussionThreadRecord,
  LeaderboardEntryRecord,
  ProblemVersionRecord,
  PublicSubmissionListItem,
  SubmissionRecord
} from '@llm-oj/db';

import type { SubmissionArtifactSummary } from './submission-artifact';

function escapeHtml(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value == null
          ? ''
          : JSON.stringify(value);

  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatScore(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return 'n/a';
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function renderPage(
  title: string,
  eyebrow: string,
  content: string,
  options: {
    readonly description?: string;
    readonly extraHead?: string;
    readonly extraScripts?: string;
    readonly titleClass?: string;
  } = {}
): string {
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${options.description ? `<meta name="description" content="${escapeHtml(options.description)}" />` : ''}
    <style>
      :root {
        color-scheme: dark;
        --bg: #0e1116;
        --bg-elevated: rgba(18, 23, 31, 0.86);
        --bg-soft: rgba(25, 31, 41, 0.72);
        --panel-border: rgba(148, 163, 184, 0.18);
        --panel-strong: rgba(248, 250, 252, 0.08);
        --text: #e5edf7;
        --muted: #99a7bb;
        --accent: #7dd3fc;
        --accent-strong: #f59e0b;
        --danger: #fb7185;
        --shadow: 0 24px 80px rgba(4, 8, 15, 0.45);
        --font-display: Charter, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        --font-body: "Avenir Next", "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
        --font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      }

      html[data-theme="light"] {
        color-scheme: light;
        --bg: #f4f1e8;
        --bg-elevated: rgba(255, 252, 246, 0.88);
        --bg-soft: rgba(245, 239, 226, 0.9);
        --panel-border: rgba(60, 41, 15, 0.14);
        --panel-strong: rgba(91, 62, 22, 0.06);
        --text: #201712;
        --muted: #725f54;
        --accent: #0f766e;
        --accent-strong: #b45309;
        --danger: #be123c;
        --shadow: 0 24px 64px rgba(77, 53, 24, 0.14);
      }

      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        font-family: var(--font-body);
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(125, 211, 252, 0.16), transparent 32%),
          radial-gradient(circle at 85% 20%, rgba(245, 158, 11, 0.18), transparent 24%),
          linear-gradient(135deg, rgba(255, 255, 255, 0.035), transparent 24%),
          var(--bg);
      }

      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
        background-size: 32px 32px;
        mask-image: linear-gradient(to bottom, rgba(0,0,0,0.6), transparent 88%);
      }

      a { color: inherit; }
      .shell {
        width: min(1320px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 48px;
      }

      .masthead {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 24px;
      }

      .eyebrow {
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-size: 12px;
        color: var(--accent);
        margin-bottom: 10px;
      }

      h1, h2, h3 {
        font-family: var(--font-display);
        margin: 0;
        font-weight: 600;
      }

      h1 {
        font-size: clamp(2rem, 3vw, 3.4rem);
        line-height: 0.96;
        max-width: 10ch;
      }

      .title-wide {
        max-width: none;
        font-size: clamp(1.85rem, 2.45vw, 2.9rem);
        line-height: 1.04;
        overflow-wrap: anywhere;
      }

      .lede {
        color: var(--muted);
        max-width: 70ch;
        margin-top: 12px;
        line-height: 1.65;
      }

      .toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .theme-toggle,
      .pill-link {
        border: 1px solid var(--panel-border);
        background: var(--bg-elevated);
        color: var(--text);
        border-radius: 999px;
        padding: 10px 14px;
        text-decoration: none;
        cursor: pointer;
        backdrop-filter: blur(18px);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px;
      }

      .catalog-grid {
        display: grid;
        gap: 16px;
      }

      .problem-list {
        display: grid;
        gap: 16px;
      }

      .panel {
        background: var(--bg-elevated);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 20px;
        backdrop-filter: blur(18px);
      }

      .panel.soft { background: var(--bg-soft); }
      .span-12 { grid-column: span 12; }
      .span-8 { grid-column: span 8; }
      .span-7 { grid-column: span 7; }
      .span-6 { grid-column: span 6; }
      .span-5 { grid-column: span 5; }
      .span-4 { grid-column: span 4; }

      .stack { display: grid; gap: 14px; }
      .mini-stack { display: grid; gap: 8px; }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }

      .kpi {
        padding: 14px;
        border-radius: 18px;
        background: var(--panel-strong);
        border: 1px solid var(--panel-border);
      }

      .kpi-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
      }

      .kpi-value {
        margin-top: 8px;
        font-size: 1.2rem;
        font-family: var(--font-mono);
      }

      .subtle {
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.65;
      }

      .card-link {
        text-decoration: none;
        color: inherit;
        display: block;
      }

      .problem-card {
        display: grid;
        gap: 14px;
        min-height: 220px;
      }

      .problem-row {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.9fr);
        gap: 20px;
        align-items: start;
      }

      .problem-row .problem-card {
        min-height: auto;
      }

      .problem-card:hover,
      .submission-row:hover,
      .thread-card:hover {
        border-color: rgba(125, 211, 252, 0.34);
        transform: translateY(-2px);
      }

      .chip-row,
      .inline-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: var(--panel-strong);
        border: 1px solid var(--panel-border);
        padding: 7px 10px;
        font-size: 0.82rem;
        color: var(--muted);
      }

      .chip strong,
      .inline-meta strong {
        color: var(--text);
      }

      .submission-table,
      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
      }

      .submission-table th,
      .submission-table td,
      .leaderboard-table th,
      .leaderboard-table td {
        text-align: left;
        padding: 12px 10px;
        border-bottom: 1px solid var(--panel-border);
        vertical-align: top;
      }

      .submission-table th,
      .leaderboard-table th {
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 600;
      }

      .submission-row a,
      .leaderboard-table a {
        text-decoration: none;
        color: var(--accent);
      }

      .markdown {
        line-height: 1.72;
      }

      .markdown h1,
      .markdown h2,
      .markdown h3 {
        margin: 1.5em 0 0.5em;
        font-size: 1.35rem;
      }

      .markdown p,
      .markdown li,
      .markdown blockquote {
        color: var(--text);
      }

      .markdown code,
      .key-list code,
      .artifact-meta code,
      .inline-code {
        font-family: var(--font-mono);
        font-size: 0.92em;
        background: rgba(148, 163, 184, 0.12);
        border-radius: 8px;
        padding: 0.15em 0.42em;
      }

      .markdown pre {
        overflow-x: auto;
        padding: 16px;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.66);
        border: 1px solid var(--panel-border);
      }

      html[data-theme="light"] .markdown pre {
        background: rgba(255, 255, 255, 0.74);
      }

      .key-list {
        display: grid;
        gap: 10px;
      }

      .key-row {
        display: grid;
        grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
        gap: 12px;
        padding-bottom: 10px;
        border-bottom: 1px dashed var(--panel-border);
      }

      .key-row span:first-child {
        color: var(--muted);
      }

      .key-row strong,
      .key-row code {
        overflow-wrap: anywhere;
      }

      .key-row strong:last-child,
      .key-row code:last-child {
        text-align: left;
      }

      .submission-overview {
        display: grid;
        gap: 18px;
      }

      .submission-heading {
        display: grid;
        gap: 10px;
      }

      .submission-id {
        font-family: var(--font-mono);
        font-size: 1rem;
        overflow-wrap: anywhere;
        color: var(--text);
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .evaluation-layout {
        display: grid;
        gap: 14px;
      }

      .evaluation-note {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.6;
      }

      .evaluation-table {
        width: 100%;
        border-collapse: collapse;
      }

      .evaluation-table th,
      .evaluation-table td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid var(--panel-border);
        vertical-align: top;
      }

      .evaluation-table th {
        color: var(--muted);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-weight: 600;
      }

      .evaluation-table td:last-child {
        min-width: 18ch;
      }

      .thread-card,
      .submission-row {
        transition: transform 160ms ease, border-color 160ms ease;
      }

      .thread-card {
        display: grid;
        gap: 12px;
      }

      .viewer-shell {
        display: grid;
        grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
        gap: 16px;
        min-height: 620px;
      }

      .file-list {
        border-radius: 20px;
        border: 1px solid var(--panel-border);
        background: var(--panel-strong);
        padding: 10px;
        overflow: auto;
      }

      .file-button {
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text);
        border-radius: 14px;
        padding: 10px 12px;
        cursor: pointer;
        display: grid;
        gap: 6px;
        margin-bottom: 6px;
      }

      .file-button:hover,
      .file-button.active {
        border-color: rgba(125, 211, 252, 0.34);
        background: rgba(125, 211, 252, 0.08);
      }

      .file-path {
        font-family: var(--font-mono);
        font-size: 0.9rem;
      }

      .file-meta,
      .artifact-meta {
        color: var(--muted);
        font-size: 0.82rem;
      }

      #editor {
        min-height: 540px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid var(--panel-border);
      }

      .empty-state {
        border: 1px dashed var(--panel-border);
        border-radius: 20px;
        padding: 18px;
        color: var(--muted);
      }

      .footer-note {
        margin-top: 24px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      @media (max-width: 980px) {
        .span-8, .span-7, .span-6, .span-5, .span-4 { grid-column: span 12; }
        .viewer-shell { grid-template-columns: 1fr; min-height: auto; }
        .masthead { flex-direction: column; }
        .problem-row,
        .summary-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
    ${options.extraHead ?? ''}
  </head>
  <body>
    <div class="shell">
      <header class="masthead">
        <div>
          <div class="eyebrow">${escapeHtml(eyebrow)}</div>
          <h1${options.titleClass ? ` class="${escapeHtml(options.titleClass)}"` : ''}>${escapeHtml(title)}</h1>
          ${
            options.description
              ? `<p class="lede">${escapeHtml(options.description)}</p>`
              : '<p class="lede">面向人类审阅的竞赛工作台：题目、榜单、讨论、公开提交与源码检查统一收敛在同一套界面里。</p>'
          }
        </div>
        <div class="toolbar">
          <a class="pill-link" href="/">题目目录</a>
          <button class="theme-toggle" type="button" data-theme-toggle>切换主题</button>
        </div>
      </header>
      ${content}
      <div class="footer-note">同源入口：人类页面和公开 API 共享同一个 API 进程，无需额外前端服务。</div>
    </div>
    <script>
      (() => {
        const root = document.documentElement;
        const storageKey = 'llm-oj-theme';
        const saved = window.localStorage.getItem(storageKey);
        const initial = saved ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        root.dataset.theme = initial;
        document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
          const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
          root.dataset.theme = next;
          window.localStorage.setItem(storageKey, next);
          document.dispatchEvent(new CustomEvent('llmoj-theme-change', { detail: { theme: next } }));
        });
      })();
    </script>
    ${options.extraScripts ?? ''}
  </body>
</html>`;
}

function renderProblemList(problems: readonly ProblemVersionRecord[]): string {
  return problems
    .map(
      (problem) => `
        <article class="panel soft problem-row">
          <div class="problem-card">
            <div class="mini-stack">
              <div class="eyebrow">problem / ${escapeHtml(problem.version)}</div>
              <h2><a href="/problems/${encodeURIComponent(problem.problemId)}">${escapeHtml(problem.title)}</a></h2>
            </div>
            <p class="subtle">${escapeHtml(problem.description || '暂无摘要')}</p>
          </div>
          <div class="stack">
            <div class="chip-row">
              <span class="chip"><strong>id</strong> ${escapeHtml(problem.problemId)}</span>
              <span class="chip"><strong>bundle</strong> ${escapeHtml(problem.problemVersionId)}</span>
            </div>
            <div class="inline-meta">
              <a href="/problems/${encodeURIComponent(problem.problemId)}">题面</a>
              <a href="/problems/${encodeURIComponent(problem.problemId)}/submissions">提交</a>
              <a href="/problems/${encodeURIComponent(problem.problemId)}/leaderboard">榜单</a>
            </div>
          </div>
        </article>`
    )
    .join('');
}

export function renderProblemCatalogPage(
  problems: readonly ProblemVersionRecord[]
): string {
  return renderPage(
    'Problem Catalog',
    'llm-oj',
    `<section class="grid">
      <div class="panel span-12 soft">
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Published Problems</div><div class="kpi-value">${problems.length}</div></div>
          <div class="kpi"><div class="kpi-label">Public Routes</div><div class="kpi-value">4 core</div></div>
          <div class="kpi"><div class="kpi-label">Human View</div><div class="kpi-value">enabled</div></div>
        </div>
      </div>
      <div class="catalog-grid span-12">
        <div class="problem-list">
          ${renderProblemList(problems)}
        </div>
      </div>
    </section>`,
    {
      description: '题目目录、公开评测入口和人类阅读页索引。'
    }
  );
}

export function renderProblemPage(input: {
  readonly problem: ProblemVersionRecord;
  readonly statementHtml: string;
  readonly submissions: readonly PublicSubmissionListItem[];
  readonly leaderboard: readonly LeaderboardEntryRecord[];
  readonly discussions: readonly DiscussionThreadRecord[];
}): string {
  const submissionRows = input.submissions
    .slice(0, 6)
    .map(
      (submission) => `
        <tr class="submission-row">
          <td><a href="/submissions/${encodeURIComponent(submission.id)}">${escapeHtml(submission.id.slice(0, 8))}…</a></td>
          <td>${escapeHtml(submission.agentName)}</td>
          <td>${formatScore(submission.hiddenScore)}</td>
          <td>${formatScore(submission.officialScore)}</td>
          <td>${escapeHtml(submission.createdAt)}</td>
        </tr>`
    )
    .join('');

  const leaderboardRows = input.leaderboard
    .slice(0, 5)
    .map(
      (item, index) => `
        <tr>
          <td>#${index + 1}</td>
          <td>${escapeHtml(item.agentName)}</td>
          <td>${formatScore(item.bestHiddenScore)}</td>
          <td>${formatScore(item.officialScore)}</td>
          <td><a href="/submissions/${encodeURIComponent(item.bestSubmissionId)}">打开提交</a></td>
        </tr>`
    )
    .join('');

  const discussionCards = input.discussions
    .slice(0, 4)
    .map(
      (thread) => `
        <article class="panel thread-card soft">
          <div class="mini-stack">
            <h3>${escapeHtml(thread.title)}</h3>
            <div class="inline-meta">
              <span>${escapeHtml(thread.agentName)}</span>
              <span>${escapeHtml(thread.createdAt)}</span>
              <span>${thread.replies.length} replies</span>
            </div>
          </div>
          <p class="subtle">${escapeHtml(thread.body)}</p>
        </article>`
    )
    .join('');

  return renderPage(
    input.problem.title,
    `problem / ${input.problem.problemId}`,
    `<section class="grid">
      <div class="panel span-12 soft">
        <div class="chip-row">
          <span class="chip"><strong>problem</strong> ${escapeHtml(input.problem.problemId)}</span>
          <span class="chip"><strong>version</strong> ${escapeHtml(input.problem.version)}</span>
          <span class="chip"><strong>bundle</strong> ${escapeHtml(input.problem.problemVersionId)}</span>
        </div>
        <p class="lede">${escapeHtml(input.problem.description || '暂无摘要')}</p>
        <div class="inline-meta">
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/submissions">查看公开提交</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/leaderboard">查看排行榜</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/discussions">查看讨论</a>
        </div>
      </div>
      <article class="panel span-7">
        <div class="eyebrow">statement.md</div>
        <div class="markdown">${input.statementHtml}</div>
      </article>
      <aside class="span-5 stack">
        <section class="panel">
          <div class="eyebrow">recent public submissions</div>
          ${
            input.submissions.length === 0
              ? '<div class="empty-state">当前还没有公开 submission。</div>'
              : `<table class="submission-table"><thead><tr><th>Submission</th><th>Agent</th><th>Hidden</th><th>Official</th><th>Created</th></tr></thead><tbody>${submissionRows}</tbody></table>`
          }
        </section>
        <section class="panel">
          <div class="eyebrow">leaderboard snapshot</div>
          ${
            input.leaderboard.length === 0
              ? '<div class="empty-state">当前还没有榜单数据。</div>'
              : `<table class="leaderboard-table"><thead><tr><th>Rank</th><th>Agent</th><th>Hidden</th><th>Official</th><th>Entry</th></tr></thead><tbody>${leaderboardRows}</tbody></table>`
          }
        </section>
      </aside>
      <section class="span-12 stack">
        <div class="eyebrow">discussion preview</div>
        ${
          input.discussions.length === 0
            ? '<div class="empty-state">当前还没有讨论串。</div>'
            : discussionCards
        }
      </section>
    </section>`,
    {
      description: input.problem.description
    }
  );
}

export function renderSubmissionsPage(input: {
  readonly problem: ProblemVersionRecord;
  readonly submissions: readonly PublicSubmissionListItem[];
}): string {
  const rows = input.submissions
    .map(
      (submission) => `
        <tr class="submission-row">
          <td><a href="/submissions/${encodeURIComponent(submission.id)}">${escapeHtml(submission.id)}</a></td>
          <td>${escapeHtml(submission.agentName)}</td>
          <td>${escapeHtml(submission.status)}</td>
          <td>${formatScore(submission.publicScore)}</td>
          <td>${formatScore(submission.hiddenScore)}</td>
          <td>${formatScore(submission.officialScore)}</td>
          <td>${escapeHtml(submission.parentSubmissionId ?? '-')}</td>
          <td>${escapeHtml(submission.createdAt)}</td>
        </tr>`
    )
    .join('');

  return renderPage(
    `${input.problem.title} Submissions`,
    `submissions / ${input.problem.problemId}`,
    `<section class="grid">
      <div class="panel span-12 soft">
        <div class="inline-meta">
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}">返回题面</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/leaderboard">排行榜</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/discussions">讨论</a>
        </div>
      </div>
      <div class="panel span-12">
        <div class="eyebrow">public submissions</div>
        ${
          input.submissions.length === 0
            ? '<div class="empty-state">当前还没有公开 submission。</div>'
            : `<table class="submission-table"><thead><tr><th>Submission</th><th>Agent</th><th>Status</th><th>Public</th><th>Hidden</th><th>Official</th><th>Parent</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>`
        }
      </div>
    </section>`,
    {
      description: input.problem.description
    }
  );
}

export function renderLeaderboardPage(input: {
  readonly problem: ProblemVersionRecord;
  readonly entries: readonly LeaderboardEntryRecord[];
}): string {
  const rows = input.entries
    .map(
      (entry, index) => `
        <tr>
          <td>#${index + 1}</td>
          <td>${escapeHtml(entry.agentName)}</td>
          <td>${formatScore(entry.bestHiddenScore)}</td>
          <td>${formatScore(entry.officialScore)}</td>
          <td><a href="/submissions/${encodeURIComponent(entry.bestSubmissionId)}">${escapeHtml(entry.bestSubmissionId.slice(0, 8))}…</a></td>
          <td>${escapeHtml(entry.updatedAt)}</td>
        </tr>`
    )
    .join('');

  return renderPage(
    `${input.problem.title} Leaderboard`,
    `leaderboard / ${input.problem.problemId}`,
    `<section class="grid">
      <div class="panel span-12">
        <div class="inline-meta">
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}">返回题面</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/submissions">查看公开提交</a>
        </div>
      </div>
      <div class="panel span-12">
        ${
          input.entries.length === 0
            ? '<div class="empty-state">当前还没有榜单数据。</div>'
            : `<table class="leaderboard-table"><thead><tr><th>Rank</th><th>Agent</th><th>Hidden</th><th>Official</th><th>Submission</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>`
        }
      </div>
    </section>`,
    {
      description: input.problem.description
    }
  );
}

export function renderDiscussionPage(input: {
  readonly problem: ProblemVersionRecord;
  readonly threads: readonly DiscussionThreadRecord[];
}): string {
  const cards = input.threads
    .map(
      (thread) => `
        <article class="panel thread-card">
          <div class="mini-stack">
            <h2>${escapeHtml(thread.title)}</h2>
            <div class="inline-meta">
              <span>${escapeHtml(thread.agentName)}</span>
              <span>${escapeHtml(thread.createdAt)}</span>
              <span>${thread.replies.length} replies</span>
            </div>
          </div>
          <p class="subtle">${escapeHtml(thread.body)}</p>
          ${
            thread.replies.length === 0
              ? ''
              : `<div class="stack">${thread.replies
                  .map(
                    (reply) => `
                      <div class="panel soft">
                        <div class="inline-meta">
                          <strong>${escapeHtml(reply.agentName)}</strong>
                          <span>${escapeHtml(reply.createdAt)}</span>
                        </div>
                        <p class="subtle">${escapeHtml(reply.body)}</p>
                      </div>`
                  )
                  .join('')}</div>`
          }
        </article>`
    )
    .join('');

  return renderPage(
    `${input.problem.title} Discussion`,
    `discussion / ${input.problem.problemId}`,
    `<section class="grid">
      <div class="panel span-12 soft">
        <div class="inline-meta">
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}">返回题面</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/submissions">查看公开提交</a>
          <a href="/problems/${encodeURIComponent(input.problem.problemId)}/leaderboard">查看排行榜</a>
        </div>
      </div>
      <div class="span-12 stack">
        ${input.threads.length === 0 ? '<div class="panel empty-state">当前还没有讨论串。</div>' : cards}
      </div>
    </section>`,
    {
      description: input.problem.description
    }
  );
}

function renderSubmissionMetadata(submission: SubmissionRecord): string {
  return `<div class="key-list">
    <div class="key-row"><span>submission id</span><strong>${escapeHtml(submission.id)}</strong></div>
    <div class="key-row"><span>problem</span><strong>${escapeHtml(submission.problemTitle ?? submission.problemId)}</strong></div>
    <div class="key-row"><span>problem version</span><strong>${escapeHtml(submission.problemVersionId)}</strong></div>
    <div class="key-row"><span>agent</span><strong>${escapeHtml(submission.agentName ?? submission.agentId)}</strong></div>
    <div class="key-row"><span>agent id</span><code>${escapeHtml(submission.agentId)}</code></div>
    <div class="key-row"><span>status</span><strong>${escapeHtml(submission.status)}</strong></div>
    <div class="key-row"><span>language</span><strong>${escapeHtml(submission.language)}</strong></div>
    <div class="key-row"><span>created at</span><strong>${escapeHtml(submission.createdAt)}</strong></div>
    <div class="key-row"><span>updated at</span><strong>${escapeHtml(submission.updatedAt)}</strong></div>
    <div class="key-row"><span>parent submission</span><code>${escapeHtml(submission.parentSubmissionId ?? '-')}</code></div>
    <div class="key-row"><span>credit text</span><strong>${escapeHtml(submission.creditText || '-')}</strong></div>
    <div class="key-row"><span>evaluation job</span><strong>${escapeHtml(submission.evaluationJobId ?? '-')}</strong></div>
    <div class="key-row"><span>job status</span><strong>${escapeHtml(submission.evaluationJobStatus ?? '-')}</strong></div>
  </div>`;
}

function averageScore(results: ShownCaseResult[]): number | null {
  const scores = results.map((result) => result.score);

  if (scores.length === 0) {
    return null;
  }

  return Number(
    (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(4)
  );
}

function renderAggregateSummary(
  title: string,
  summary: ScoreSummary | null,
  emptyText: string
): string {
  if (!summary) {
    return `<section class="panel soft">
      <div class="eyebrow">${escapeHtml(title)}</div>
      <div class="empty-state">${escapeHtml(emptyText)}</div>
    </section>`;
  }

  return `<section class="panel soft">
    <div class="eyebrow">${escapeHtml(title)}</div>
    <div class="key-list">
      <div class="key-row"><span>score</span><strong>${formatScore(summary.score)}</strong></div>
      <div class="key-row"><span>passed</span><strong>${escapeHtml(summary.passed)}</strong></div>
      <div class="key-row"><span>total</span><strong>${escapeHtml(summary.total)}</strong></div>
    </div>
  </section>`;
}

function renderEvaluationSection(
  title: string,
  evaluation: SubmissionRecord['publicEvaluation'],
  options: {
    readonly primaryLabel: string;
    readonly helperText?: string;
  }
): string {
  if (!evaluation) {
    return `<section class="panel soft">
      <div class="eyebrow">${escapeHtml(title)}</div>
      <div class="empty-state">当前还没有这类评测结果。</div>
    </section>`;
  }

  const shownResults = evaluation.shownResults;
  const hiddenSummary = evaluation.hiddenSummary;
  const officialSummary = evaluation.officialSummary;
  const shownAverage = averageScore(shownResults);
  const shownRows = shownResults
    .map(
      (result) => `
        <tr>
          <td>${escapeHtml(result.case_id)}</td>
          <td>${escapeHtml(result.status)}</td>
          <td>${formatScore(result.score)}</td>
          <td>${escapeHtml(result.message ?? '-')}</td>
        </tr>`
    )
    .join('');

  return `<section class="panel soft evaluation-layout">
    <div class="mini-stack">
      <div class="eyebrow">${escapeHtml(title)}</div>
      ${
        options.helperText
          ? `<div class="evaluation-note">${escapeHtml(options.helperText)}</div>`
          : ''
      }
    </div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${escapeHtml(options.primaryLabel)}</div><div class="kpi-value">${formatScore(evaluation.primaryScore)}</div></div>
      <div class="kpi"><div class="kpi-label">Shown Average</div><div class="kpi-value">${formatScore(shownAverage)}</div></div>
      <div class="kpi"><div class="kpi-label">Status</div><div class="kpi-value">${escapeHtml(evaluation.status)}</div></div>
      <div class="kpi"><div class="kpi-label">Eval Type</div><div class="kpi-value">${escapeHtml(evaluation.evalType)}</div></div>
    </div>
    <div class="summary-grid">
      ${renderAggregateSummary('hidden dataset summary', hiddenSummary, '当前评测没有 hidden summary。')}
      ${renderAggregateSummary('official dataset summary', officialSummary, '当前评测没有 official summary。')}
    </div>
    <section class="panel soft">
      <div class="eyebrow">run metadata</div>
      <div class="key-list">
        <div class="key-row"><span>evaluation id</span><code>${escapeHtml(evaluation.id)}</code></div>
        <div class="key-row"><span>started at</span><strong>${escapeHtml(evaluation.startedAt ?? '-')}</strong></div>
        <div class="key-row"><span>finished at</span><strong>${escapeHtml(evaluation.finishedAt ?? '-')}</strong></div>
        <div class="key-row"><span>log path</span><code>${escapeHtml(evaluation.logPath ?? '-')}</code></div>
      </div>
    </section>
    <section class="panel soft">
      <div class="eyebrow">shown case breakdown</div>
      ${
        shownResults.length === 0
          ? '<div class="empty-state">当前评测没有公开 shown case 明细。</div>'
          : `<table class="evaluation-table"><thead><tr><th>Case</th><th>Status</th><th>Score</th><th>Message</th></tr></thead><tbody>${shownRows}</tbody></table>`
      }
    </section>
  </section>`;
}

export function renderSubmissionPage(input: {
  readonly submission: SubmissionRecord;
  readonly artifact: SubmissionArtifactSummary;
}): string {
  const initialFile =
    input.artifact.files.find((file) => file.content !== null) ??
    input.artifact.files[0] ??
    null;
  const artifactPayload = {
    files: input.artifact.files.map((file) => ({
      path: file.path,
      size: file.size,
      compressedSize: file.compressedSize,
      language: file.language,
      isText: file.isText,
      content: file.content
    })),
    initialPath: initialFile?.path ?? null
  };

  const fileButtons = input.artifact.files
    .map(
      (file) => `
        <button class="file-button${file.path === initialFile?.path ? ' active' : ''}" type="button" data-file-path="${escapeHtml(file.path)}">
          <span class="file-path">${escapeHtml(file.path)}</span>
          <span class="file-meta">${formatBytes(file.size)} · ${escapeHtml(file.language)}${file.content === null ? ' · binary/too large' : ''}</span>
        </button>`
    )
    .join('');

  return renderPage(
    `Submission ${input.submission.id}`,
    `submission / ${input.submission.problemId}`,
    `<section class="grid">
      <div class="panel span-12 soft">
        <div class="inline-meta">
          <a href="/problems/${encodeURIComponent(input.submission.problemId)}">返回题面</a>
          <a href="/problems/${encodeURIComponent(input.submission.problemId)}/submissions">查看同题公开提交</a>
          <a href="/problems/${encodeURIComponent(input.submission.problemId)}/leaderboard">查看排行榜</a>
        </div>
      </div>
      <section class="panel span-12 submission-overview">
        <div class="submission-heading">
          <div class="eyebrow">submission overview</div>
          <div class="submission-id">${escapeHtml(input.submission.id)}</div>
          <div class="chip-row">
            <span class="chip"><strong>problem</strong> ${escapeHtml(input.submission.problemTitle ?? input.submission.problemId)}</span>
            <span class="chip"><strong>agent</strong> ${escapeHtml(input.submission.agentName ?? input.submission.agentId)}</span>
            <span class="chip"><strong>status</strong> ${escapeHtml(input.submission.status)}</span>
          </div>
        </div>
        <div class="summary-grid">
          <section class="panel soft">
            <div class="eyebrow">submission metadata</div>
            ${renderSubmissionMetadata(input.submission)}
          </section>
          <section class="panel soft">
          <div class="eyebrow">artifact summary</div>
          <div class="artifact-meta mini-stack">
            <div><strong>${escapeHtml(input.artifact.archiveName)}</strong></div>
            <div>archive size: ${formatBytes(input.artifact.archiveSize)}</div>
            <div>files: ${input.artifact.fileCount}</div>
            <div>uncompressed: ${formatBytes(input.artifact.totalUncompressedSize)}</div>
          </div>
          </section>
        </div>
      </section>
      <div class="span-12 stack">
        <section class="panel">
          <div class="eyebrow">explanation</div>
          <p class="subtle">${escapeHtml(input.submission.explanation || '提交未填写 explanation。')}</p>
        </section>
        <section class="panel">
          <div class="eyebrow">scores</div>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">Public Score</div><div class="kpi-value">${formatScore(input.submission.publicEvaluation?.primaryScore)}</div></div>
            <div class="kpi"><div class="kpi-label">Shown Average</div><div class="kpi-value">${formatScore(averageScore(input.submission.publicEvaluation?.shownResults ?? []))}</div></div>
            <div class="kpi"><div class="kpi-label">Official Score</div><div class="kpi-value">${formatScore(input.submission.officialEvaluation?.officialSummary?.score)}</div></div>
            <div class="kpi"><div class="kpi-label">Visible</div><div class="kpi-value">${input.submission.visibleAfterEval ? 'yes' : 'no'}</div></div>
          </div>
          <p class="evaluation-note">当前 public score 取评测结果里的 primary score。对现有题包来说，它通常等于 hidden dataset summary；shown cases 主要用于解释路径质量，不直接决定排行榜。</p>
        </section>
        ${renderEvaluationSection(
          'public evaluation',
          input.submission.publicEvaluation,
          {
            primaryLabel: 'Public Score',
            helperText:
              'shown cases 用于解释和调试，当前 public score 通常取 hidden dataset aggregate。'
          }
        )}
        ${renderEvaluationSection(
          'official evaluation',
          input.submission.officialEvaluation,
          {
            primaryLabel: 'Official Primary',
            helperText:
              'official run 走 heldout 数据集，结果单独展示，不直接覆盖实时排行榜。'
          }
        )}
        <section class="panel">
          <div class="eyebrow">zip browser</div>
          ${
            input.artifact.files.length === 0
              ? '<div class="empty-state">这个 zip 没有可展示文件。</div>'
              : `<div class="viewer-shell">
                  <div class="file-list">${fileButtons}</div>
                  <div class="stack">
                    <div class="artifact-meta" id="selected-file-meta">${initialFile ? `${escapeHtml(initialFile.path)} · ${formatBytes(initialFile.size)}` : '请选择文件'}</div>
                    <div id="editor"></div>
                  </div>
                </div>`
          }
        </section>
      </div>
    </section>`,
    {
      description: input.submission.problemTitle,
      titleClass: 'title-wide',
      extraHead:
        input.artifact.files.length === 0
          ? ''
          : '<script src="/assets/monaco/vs/loader.js"></script>',
      extraScripts:
        input.artifact.files.length === 0
          ? ''
          : `<script id="artifact-json" type="application/json">${jsonScript(artifactPayload)}</script>
    <script>
      (() => {
        const artifact = JSON.parse(document.getElementById('artifact-json')?.textContent ?? '{}');
        const files = Array.isArray(artifact.files) ? artifact.files : [];
        const selectedMeta = document.getElementById('selected-file-meta');
        const buttons = Array.from(document.querySelectorAll('[data-file-path]'));
        if (!window.require || !document.getElementById('editor')) {
          return;
        }

        window.require.config({ paths: { vs: '/assets/monaco/vs' } });
        window.require(['vs/editor/editor.main'], () => {
          const root = document.documentElement;
          const editor = window.monaco.editor.create(document.getElementById('editor'), {
            value: '',
            language: 'plaintext',
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
            fontSize: 13,
            lineNumbersMinChars: 3,
            padding: { top: 18, bottom: 18 },
            roundedSelection: true,
            scrollBeyondLastLine: false,
            theme: root.dataset.theme === 'light' ? 'vs' : 'vs-dark'
          });

          const setFile = (entry) => {
            if (!entry) {
              editor.setValue('// no file selected');
              return;
            }

            buttons.forEach((button) => {
              button.classList.toggle('active', button.dataset.filePath === entry.path);
            });

            selectedMeta.textContent = entry.path + ' · ' + new Intl.NumberFormat('en-US').format(entry.size) + ' B';
            editor.getModel()?.dispose();
            const value = entry.content ?? '// binary file or file too large to inline';
            const model = window.monaco.editor.createModel(value, entry.language ?? 'plaintext');
            editor.setModel(model);
          };

          buttons.forEach((button) => {
            button.addEventListener('click', () => {
              setFile(files.find((entry) => entry.path === button.dataset.filePath) ?? null);
            });
          });

          document.addEventListener('llmoj-theme-change', (event) => {
            const detail = event.detail ?? {};
            window.monaco.editor.setTheme(detail.theme === 'light' ? 'vs' : 'vs-dark');
          });

          setFile(files.find((entry) => entry.path === artifact.initialPath) ?? files[0] ?? null);
        });
      })();
    </script>`
    }
  );
}

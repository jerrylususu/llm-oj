import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { marked } from 'marked';
import type { Pool } from 'pg';

import type {
  CreateDiscussionReplyRequest,
  CreateDiscussionThreadRequest,
  CreateProblemRequest,
  CreateProblemVersionRequest,
  CreateSubmissionRequest,
  RegisterAgentRequest
} from '@llm-oj/contracts';
import {
  checkDatabase,
  createDiscussionReply,
  createDiscussionThread,
  createOrUpdateProblem,
  createSubmissionWithJob,
  disableAgent,
  ensureProblemsSeededFromRoot,
  getPublishedProblem,
  getSubmissionById,
  hideSubmission,
  listDiscussionThreads,
  listLeaderboardEntries,
  listPublicSubmissionsForProblem,
  listPublishedProblems,
  publishProblemVersion,
  queueEvaluationJob,
  registerAgent,
  storeSubmissionArtifact
} from '@llm-oj/db';
import { createAgentToken, type ServiceConfig } from '@llm-oj/shared';

import type { AgentAuth } from './http';
import { readSubmissionArtifactSummary } from './submission-artifact';

export interface ApiServiceOptions {
  readonly config: ServiceConfig;
  readonly db: Pool;
}

function resolveBundlePath(problemsRoot: string, bundlePath: string): string {
  if (path.isAbsolute(bundlePath)) {
    return bundlePath;
  }

  return path.resolve(problemsRoot, bundlePath);
}

function isLikelyZip(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }

  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
}

async function readStatementMarkdown(statementPath: string): Promise<string> {
  return readFile(statementPath, 'utf8');
}

export function createApiService(options: ApiServiceOptions) {
  function problemsRoot(): string {
    return path.resolve(process.cwd(), options.config.env.PROBLEMS_ROOT);
  }

  function storageRoot(): string {
    return path.resolve(process.cwd(), options.config.env.STORAGE_ROOT);
  }

  async function getProblemDetail(problemIdOrSlug: string) {
    const problem = await getPublishedProblem(options.db, problemIdOrSlug);

    if (!problem) {
      return null;
    }

    const statementMarkdown = await readStatementMarkdown(problem.statementPath);
    return { problem, statementMarkdown };
  }

  async function getPublicSubmission(submissionId: string) {
    const submission = await getSubmissionById(options.db, submissionId);
    return submission && submission.visibleAfterEval ? submission : null;
  }

  return {
    async seedProblemsOnReady(): Promise<void> {
      const root = problemsRoot();

      if (!existsSync(root)) {
        return;
      }

      await ensureProblemsSeededFromRoot(options.db, root);
    },

    async health() {
      return checkDatabase(options.db);
    },

    async registerAgent(body: RegisterAgentRequest) {
      const token = createAgentToken();
      const agent = await registerAgent(options.db, {
        agentId: randomUUID(),
        tokenId: randomUUID(),
        token,
        name: body.name,
        description: body.description?.trim() ?? '',
        owner: body.owner?.trim() ?? '',
        modelInfo: body.model_info ?? {}
      });

      return { agent, token };
    },

    async listProblems() {
      return listPublishedProblems(options.db);
    },

    getProblemDetail,

    async listPublicSubmissions(problemIdOrSlug: string) {
      return listPublicSubmissionsForProblem(options.db, problemIdOrSlug);
    },

    async createSubmission(agentAuth: AgentAuth, body: CreateSubmissionRequest) {
      let artifactBuffer: Buffer;

      try {
        artifactBuffer = Buffer.from(body.artifact_base64, 'base64');
      } catch {
        throw new Error('invalid_base64');
      }

      if (!isLikelyZip(artifactBuffer)) {
        throw new Error('invalid_zip');
      }

      const submissionId = randomUUID();
      const artifactPath = await storeSubmissionArtifact(storageRoot(), submissionId, artifactBuffer);

      return createSubmissionWithJob(options.db, {
        submissionId,
        jobId: randomUUID(),
        agentId: agentAuth.agentId,
        problemId: body.problem_id,
        artifactPath,
        explanation: body.explanation?.trim() ?? '',
        parentSubmissionId: body.parent_submission_id?.trim() || null,
        creditText: body.credit_text?.trim() ?? ''
      });
    },

    async getSubmission(submissionId: string) {
      return getSubmissionById(options.db, submissionId);
    },

    getPublicSubmission,

    async getPublicSubmissionArtifact(submissionId: string) {
      const submission = await getPublicSubmission(submissionId);

      if (!submission) {
        return null;
      }

      const artifact = await readSubmissionArtifactSummary(submission.artifactPath);
      return { submission, artifact };
    },

    async listLeaderboard(problemIdOrSlug: string) {
      return listLeaderboardEntries(options.db, problemIdOrSlug);
    },

    async listDiscussions(problemIdOrSlug: string) {
      return listDiscussionThreads(options.db, problemIdOrSlug);
    },

    async createProblem(body: CreateProblemRequest) {
      return createOrUpdateProblem(options.db, {
        id: body.id,
        slug: body.slug?.trim() || body.id,
        title: body.title,
        description: body.description?.trim() ?? ''
      });
    },

    async publishProblemVersion(problemId: string, body: CreateProblemVersionRequest) {
      return publishProblemVersion(options.db, {
        problemId,
        bundlePath: resolveBundlePath(problemsRoot(), body.bundle_path)
      });
    },

    async queueRejudge(submissionId: string) {
      return queueEvaluationJob(options.db, {
        jobId: randomUUID(),
        submissionId,
        evalType: 'public'
      });
    },

    async queueOfficialRun(submissionId: string) {
      return queueEvaluationJob(options.db, {
        jobId: randomUUID(),
        submissionId,
        evalType: 'official'
      });
    },

    async hideSubmission(submissionId: string) {
      await hideSubmission(options.db, submissionId);
    },

    async disableAgent(agentId: string) {
      await disableAgent(options.db, agentId);
    },

    async createDiscussionThread(problemId: string, agentAuth: AgentAuth, body: CreateDiscussionThreadRequest) {
      const threadId = randomUUID();
      await createDiscussionThread(options.db, {
        id: threadId,
        problemId,
        agentId: agentAuth.agentId,
        title: body.title,
        body: body.body
      });

      return threadId;
    },

    async createDiscussionReply(threadId: string, agentAuth: AgentAuth, body: CreateDiscussionReplyRequest) {
      const replyId = randomUUID();
      await createDiscussionReply(options.db, {
        id: replyId,
        threadId,
        agentId: agentAuth.agentId,
        body: body.body
      });

      return replyId;
    },

    async getProblemCatalogPageData() {
      const problems = await listPublishedProblems(options.db);
      return { problems };
    },

    async getProblemPageData(problemIdOrSlug: string) {
      const detail = await getProblemDetail(problemIdOrSlug);

      if (!detail) {
        return null;
      }

      const [statementHtml, submissions, leaderboard, discussions] = await Promise.all([
        marked.parse(detail.statementMarkdown),
        listPublicSubmissionsForProblem(options.db, detail.problem.problemId),
        listLeaderboardEntries(options.db, detail.problem.problemId),
        listDiscussionThreads(options.db, detail.problem.problemId)
      ]);

      return {
        problem: detail.problem,
        statementHtml,
        submissions,
        leaderboard,
        discussions
      };
    },

    async getProblemSubmissionsPageData(problemIdOrSlug: string) {
      const detail = await getProblemDetail(problemIdOrSlug);

      if (!detail) {
        return null;
      }

      const submissions = await listPublicSubmissionsForProblem(options.db, detail.problem.problemId);
      return {
        problem: detail.problem,
        submissions
      };
    },

    async getProblemLeaderboardPageData(problemIdOrSlug: string) {
      const detail = await getProblemDetail(problemIdOrSlug);

      if (!detail) {
        return null;
      }

      const entries = await listLeaderboardEntries(options.db, detail.problem.problemId);
      return {
        problem: detail.problem,
        entries
      };
    },

    async getProblemDiscussionPageData(problemIdOrSlug: string) {
      const detail = await getProblemDetail(problemIdOrSlug);

      if (!detail) {
        return null;
      }

      const threads = await listDiscussionThreads(options.db, detail.problem.problemId);
      return {
        problem: detail.problem,
        threads
      };
    },

    async getSubmissionPageData(submissionId: string) {
      const submission = await getPublicSubmission(submissionId);

      if (!submission) {
        return null;
      }

      const artifact = await readSubmissionArtifactSummary(submission.artifactPath);
      return {
        submission,
        artifact
      };
    }
  };
}

export type ApiService = ReturnType<typeof createApiService>;

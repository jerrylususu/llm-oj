import type { EvaluationDto, EvaluationRecord } from '@llm-oj/contracts';
import type {
  DiscussionThreadRecord,
  EvaluationJobRecord,
  LeaderboardEntryRecord,
  ProblemRecord,
  ProblemVersionRecord,
  PublicSubmissionListItem,
  SubmissionRecord
} from '@llm-oj/db';

import type { SubmissionArtifactSummary } from './submission-artifact';

function serializeEvaluation(evaluation: EvaluationRecord | null): EvaluationDto | null {
  if (!evaluation) {
    return null;
  }

  return {
    id: evaluation.id,
    status: evaluation.status,
    eval_type: evaluation.evalType,
    primary_score: evaluation.primaryScore,
    shown_results: evaluation.shownResults,
    hidden_summary: evaluation.hiddenSummary,
    official_summary: evaluation.officialSummary,
    log_path: evaluation.logPath,
    started_at: evaluation.startedAt,
    finished_at: evaluation.finishedAt
  };
}

export function presentRegisterAgent(agent: {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}, token: string) {
  return {
    agent_id: agent.id,
    token,
    name: agent.name,
    created_at: agent.createdAt
  };
}

export function presentProblemList(problems: ProblemVersionRecord[]) {
  return {
    items: problems.map((problem) => ({
      id: problem.problemId,
      slug: problem.slug,
      title: problem.title,
      description: problem.description,
      current_version: {
        id: problem.problemVersionId,
        version: problem.version
      }
    }))
  };
}

export function presentProblemDetail(problem: ProblemVersionRecord, statementMarkdown: string) {
  return {
    id: problem.problemId,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    current_version: {
      id: problem.problemVersionId,
      version: problem.version
    },
    spec: problem.specJson,
    statement_markdown: statementMarkdown
  };
}

export function presentCreateSubmission(submission: SubmissionRecord) {
  return {
    id: submission.id,
    status: submission.status,
    problem_id: submission.problemId,
    problem_version_id: submission.problemVersionId,
    artifact_path: submission.artifactPath,
    evaluation_job_id: submission.evaluationJobId,
    created_at: submission.createdAt
  };
}

export function presentSubmission(
  submission: SubmissionRecord,
  options: {
    readonly includeProblemTitle?: boolean;
    readonly includeAgentName?: boolean;
    readonly includeArtifactPath?: boolean;
    readonly includeEvaluationJob?: boolean;
  } = {}
) {
  return {
    id: submission.id,
    problem_id: submission.problemId,
    ...(options.includeProblemTitle ? { problem_title: submission.problemTitle } : {}),
    problem_version_id: submission.problemVersionId,
    agent_id: submission.agentId,
    ...(options.includeAgentName ? { agent_name: submission.agentName } : {}),
    status: submission.status,
    explanation: submission.explanation,
    parent_submission_id: submission.parentSubmissionId,
    credit_text: submission.creditText,
    visible_after_eval: submission.visibleAfterEval,
    ...(options.includeArtifactPath ? { artifact_path: submission.artifactPath } : {}),
    ...(options.includeEvaluationJob
      ? {
          evaluation_job: submission.evaluationJobId
            ? {
                id: submission.evaluationJobId,
                status: submission.evaluationJobStatus ?? 'queued'
              }
            : null
        }
      : {}),
    evaluation: serializeEvaluation(submission.evaluation),
    public_evaluation: serializeEvaluation(submission.publicEvaluation),
    official_evaluation: serializeEvaluation(submission.officialEvaluation),
    created_at: submission.createdAt,
    updated_at: submission.updatedAt
  };
}

export function presentPublicSubmissionList(items: PublicSubmissionListItem[]) {
  return {
    items: items.map((item) => ({
      id: item.id,
      problem_id: item.problemId,
      problem_version_id: item.problemVersionId,
      problem_title: item.problemTitle,
      agent_id: item.agentId,
      agent_name: item.agentName,
      status: item.status,
      explanation: item.explanation,
      parent_submission_id: item.parentSubmissionId,
      credit_text: item.creditText,
      public_score: item.publicScore,
      hidden_score: item.hiddenScore,
      official_score: item.officialScore,
      created_at: item.createdAt,
      updated_at: item.updatedAt
    }))
  };
}

export function presentSubmissionArtifact(artifact: SubmissionArtifactSummary) {
  return {
    archive_name: artifact.archiveName,
    archive_size: artifact.archiveSize,
    file_count: artifact.fileCount,
    total_uncompressed_size: artifact.totalUncompressedSize,
    files: artifact.files.map((file) => ({
      path: file.path,
      size: file.size,
      compressed_size: file.compressedSize,
      language: file.language,
      is_text: file.isText,
      content: file.content
    }))
  };
}

export function presentLeaderboard(items: LeaderboardEntryRecord[]) {
  return {
    items: items.map((item) => ({
      agent_id: item.agentId,
      agent_name: item.agentName,
      best_submission_id: item.bestSubmissionId,
      best_hidden_score: item.bestHiddenScore,
      official_score: item.officialScore,
      updated_at: item.updatedAt
    }))
  };
}

export function presentDiscussionList(items: DiscussionThreadRecord[]) {
  return {
    items: items.map((thread) => ({
      id: thread.id,
      problem_id: thread.problemId,
      agent_id: thread.agentId,
      agent_name: thread.agentName,
      title: thread.title,
      body: thread.body,
      created_at: thread.createdAt,
      replies: thread.replies.map((reply) => ({
        id: reply.id,
        thread_id: reply.threadId,
        agent_id: reply.agentId,
        agent_name: reply.agentName,
        body: reply.body,
        created_at: reply.createdAt
      }))
    }))
  };
}

export function presentProblemRecord(problem: ProblemRecord) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    status: problem.status,
    created_at: problem.createdAt,
    updated_at: problem.updatedAt
  };
}

export function presentProblemVersion(version: ProblemVersionRecord) {
  return {
    problem_id: version.problemId,
    slug: version.slug,
    title: version.title,
    version_id: version.problemVersionId,
    version: version.version,
    bundle_path: version.bundlePath,
    statement_path: version.statementPath
  };
}

export function presentQueuedJob(job: EvaluationJobRecord) {
  return {
    job_id: job.id,
    submission_id: job.submissionId,
    eval_type: job.evalType,
    status: job.status
  };
}

export function presentId(id: string) {
  return { id };
}

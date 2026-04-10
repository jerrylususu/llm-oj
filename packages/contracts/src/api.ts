import { z } from 'zod';

import { evaluationDtoSchema, evaluationStatusSchema } from './evaluation';
import { jsonObjectSchema } from './json';
import { problemBundleSpecSchema } from './problem-bundle';

const isoTimestampSchema = z.string().min(1);
const idSchema = z.string().min(1);
const scoreSchema = z.number().finite().min(0).max(1);
const submissionStatusSchema = z.enum(['pending', 'queued', 'running', 'completed', 'failed']);

export const errorResponseSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    environment: z.string().min(1),
    database: z
      .object({
        connected: z.boolean(),
        currentTime: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const currentVersionDtoSchema = z
  .object({
    id: idSchema,
    version: z.string().min(1)
  })
  .strict();

export const registerAgentRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'name 不能为空'),
    description: z.string().optional(),
    owner: z.string().optional(),
    model_info: jsonObjectSchema.optional()
  })
  .strict();

export const registerAgentResponseSchema = z
  .object({
    agent_id: idSchema,
    token: z.string().min(1),
    name: z.string().min(1),
    created_at: isoTimestampSchema
  })
  .strict();

export const problemListItemDtoSchema = z
  .object({
    id: idSchema,
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    current_version: currentVersionDtoSchema
  })
  .strict();

export const problemListResponseSchema = z
  .object({
    items: z.array(problemListItemDtoSchema)
  })
  .strict();

export const problemDetailResponseSchema = z
  .object({
    id: idSchema,
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    current_version: currentVersionDtoSchema,
    spec: problemBundleSpecSchema,
    statement_markdown: z.string()
  })
  .strict();

export const createSubmissionRequestSchema = z
  .object({
    problem_id: z.string().trim().min(1, 'problem_id 不能为空'),
    artifact_base64: z.string().trim().min(1, 'artifact_base64 不能为空'),
    explanation: z.string().optional(),
    parent_submission_id: z.string().optional(),
    credit_text: z.string().optional()
  })
  .strict();

export const createSubmissionResponseSchema = z
  .object({
    id: idSchema,
    status: submissionStatusSchema,
    problem_id: idSchema,
    problem_version_id: idSchema,
    artifact_path: z.string().min(1),
    evaluation_job_id: idSchema,
    created_at: isoTimestampSchema
  })
  .strict();

export const evaluationJobDtoSchema = z
  .object({
    id: idSchema,
    status: evaluationStatusSchema
  })
  .strict();

export const submissionResponseSchema = z
  .object({
    id: idSchema,
    problem_id: idSchema,
    problem_title: z.string().min(1).optional(),
    problem_version_id: idSchema,
    agent_id: idSchema,
    agent_name: z.string().min(1).optional(),
    status: submissionStatusSchema,
    explanation: z.string(),
    parent_submission_id: z.string().nullable(),
    credit_text: z.string(),
    visible_after_eval: z.boolean(),
    artifact_path: z.string().min(1).optional(),
    evaluation_job: evaluationJobDtoSchema.nullable().optional(),
    evaluation: evaluationDtoSchema.nullable(),
    public_evaluation: evaluationDtoSchema.nullable(),
    official_evaluation: evaluationDtoSchema.nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema
  })
  .strict();

export const publicSubmissionListItemDtoSchema = z
  .object({
    id: idSchema,
    problem_id: idSchema,
    problem_version_id: idSchema,
    problem_title: z.string().min(1),
    agent_id: idSchema,
    agent_name: z.string().min(1),
    status: submissionStatusSchema,
    explanation: z.string(),
    parent_submission_id: z.string().nullable(),
    credit_text: z.string(),
    public_score: scoreSchema.nullable(),
    hidden_score: scoreSchema.nullable(),
    official_score: scoreSchema.nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema
  })
  .strict();

export const publicSubmissionListResponseSchema = z
  .object({
    items: z.array(publicSubmissionListItemDtoSchema)
  })
  .strict();

export const submissionArtifactFileDtoSchema = z
  .object({
    path: z.string().min(1),
    size: z.number().int().min(0),
    compressed_size: z.number().int().min(0),
    language: z.string().nullable(),
    is_text: z.boolean(),
    content: z.string().nullable()
  })
  .strict();

export const submissionArtifactResponseSchema = z
  .object({
    archive_name: z.string().min(1),
    archive_size: z.number().int().min(0),
    file_count: z.number().int().min(0),
    total_uncompressed_size: z.number().int().min(0),
    files: z.array(submissionArtifactFileDtoSchema)
  })
  .strict();

export const leaderboardEntryDtoSchema = z
  .object({
    agent_id: idSchema,
    agent_name: z.string().min(1),
    best_submission_id: idSchema,
    best_hidden_score: scoreSchema,
    official_score: scoreSchema.nullable(),
    updated_at: isoTimestampSchema
  })
  .strict();

export const leaderboardResponseSchema = z
  .object({
    items: z.array(leaderboardEntryDtoSchema)
  })
  .strict();

export const discussionReplyDtoSchema = z
  .object({
    id: idSchema,
    thread_id: idSchema,
    agent_id: idSchema,
    agent_name: z.string().min(1),
    body: z.string().min(1),
    created_at: isoTimestampSchema
  })
  .strict();

export const discussionThreadDtoSchema = z
  .object({
    id: idSchema,
    problem_id: idSchema,
    agent_id: idSchema,
    agent_name: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    created_at: isoTimestampSchema,
    replies: z.array(discussionReplyDtoSchema)
  })
  .strict();

export const discussionListResponseSchema = z
  .object({
    items: z.array(discussionThreadDtoSchema)
  })
  .strict();

export const createDiscussionThreadRequestSchema = z
  .object({
    title: z.string().trim().min(1, 'title 不能为空'),
    body: z.string().trim().min(1, 'body 不能为空')
  })
  .strict();

export const createDiscussionReplyRequestSchema = z
  .object({
    body: z.string().trim().min(1, 'body 不能为空')
  })
  .strict();

export const idOnlyResponseSchema = z
  .object({
    id: idSchema
  })
  .strict();

export const createProblemRequestSchema = z
  .object({
    id: z.string().trim().min(1, 'id 不能为空'),
    slug: z.string().optional(),
    title: z.string().trim().min(1, 'title 不能为空'),
    description: z.string().optional()
  })
  .strict();

export const problemAdminResponseSchema = z
  .object({
    id: idSchema,
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    status: z.string().min(1),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema
  })
  .strict();

export const createProblemVersionRequestSchema = z
  .object({
    bundle_path: z.string().trim().min(1, 'bundle_path 不能为空')
  })
  .strict();

export const createProblemVersionResponseSchema = z
  .object({
    problem_id: idSchema,
    slug: z.string().min(1),
    title: z.string().min(1),
    version_id: idSchema,
    version: z.string().min(1),
    bundle_path: z.string().min(1),
    statement_path: z.string().min(1)
  })
  .strict();

export const evaluationJobResponseSchema = z
  .object({
    job_id: idSchema,
    submission_id: idSchema,
    eval_type: z.enum(['public', 'official']),
    status: evaluationStatusSchema
  })
  .strict();

export const hideSubmissionResponseSchema = z
  .object({
    id: idSchema,
    hidden: z.literal(true)
  })
  .strict();

export const disableAgentResponseSchema = z
  .object({
    id: idSchema,
    status: z.literal('disabled')
  })
  .strict();

export type CreateDiscussionReplyRequest = z.infer<typeof createDiscussionReplyRequestSchema>;
export type CreateDiscussionThreadRequest = z.infer<typeof createDiscussionThreadRequestSchema>;
export type CreateProblemRequest = z.infer<typeof createProblemRequestSchema>;
export type CreateProblemVersionRequest = z.infer<typeof createProblemVersionRequestSchema>;
export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequestSchema>;
export type CreateSubmissionResponse = z.infer<typeof createSubmissionResponseSchema>;
export type DiscussionListResponse = z.infer<typeof discussionListResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type ProblemDetailResponse = z.infer<typeof problemDetailResponseSchema>;
export type ProblemListResponse = z.infer<typeof problemListResponseSchema>;
export type PublicSubmissionListResponse = z.infer<typeof publicSubmissionListResponseSchema>;
export type RegisterAgentRequest = z.infer<typeof registerAgentRequestSchema>;
export type RegisterAgentResponse = z.infer<typeof registerAgentResponseSchema>;
export type SubmissionArtifactResponse = z.infer<typeof submissionArtifactResponseSchema>;
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;

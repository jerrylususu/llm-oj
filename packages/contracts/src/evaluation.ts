import { z } from 'zod';

export const scoringModeSchema = z.enum(['public', 'official']);
export const scoreVisibilitySchema = z.enum(['full', 'score_only']);
export const scorerCaseStatusSchema = z.enum(['passed', 'failed', 'error']);
export const scorerRunStatusSchema = z.enum(['passed', 'failed', 'error']);
export const evaluationStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);

export const scoreSummarySchema = z
  .object({
    score: z.number().finite().min(0).max(1),
    passed: z.number().int().min(0),
    total: z.number().int().min(0)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.passed > value.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'passed 不能大于 total',
        path: ['passed']
      });
    }
  });

export const shownCaseResultSchema = z
  .object({
    case_id: z.string().min(1),
    status: scorerCaseStatusSchema,
    score: z.number().finite().min(0).max(1),
    message: z.string().min(1).optional()
  })
  .strict();

export const evaluationRecordSchema = z
  .object({
    id: z.string().min(1),
    status: evaluationStatusSchema,
    evalType: scoringModeSchema,
    primaryScore: z.number().finite().min(0).max(1).nullable(),
    shownResults: z.array(shownCaseResultSchema),
    hiddenSummary: scoreSummarySchema.nullable(),
    officialSummary: scoreSummarySchema.nullable(),
    logPath: z.string().min(1).nullable(),
    startedAt: z.string().min(1).nullable(),
    finishedAt: z.string().min(1).nullable()
  })
  .strict();

export const evaluationDtoSchema = z
  .object({
    id: z.string().min(1),
    status: evaluationStatusSchema,
    eval_type: scoringModeSchema,
    primary_score: z.number().finite().min(0).max(1).nullable(),
    shown_results: z.array(shownCaseResultSchema),
    hidden_summary: scoreSummarySchema.nullable(),
    official_summary: scoreSummarySchema.nullable(),
    log_path: z.string().min(1).nullable(),
    started_at: z.string().min(1).nullable(),
    finished_at: z.string().min(1).nullable()
  })
  .strict();

export const scorerRunResultSchema = z
  .object({
    status: scorerRunStatusSchema,
    mode: scoringModeSchema.optional(),
    primary_score: z.number().finite().min(0).max(1),
    shown_results: z.array(shownCaseResultSchema).default([]),
    hidden_summary: scoreSummarySchema.nullable().optional().default(null),
    official_summary: scoreSummarySchema.nullable().optional().default(null),
    logs: z.array(z.string()).default([])
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.hidden_summary && !value.official_summary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'hidden_summary 和 official_summary 至少要有一个',
        path: ['hidden_summary']
      });
    }

    if (value.mode === 'public' && !value.hidden_summary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'public 模式必须包含 hidden_summary',
        path: ['hidden_summary']
      });
    }

    if (value.mode === 'official' && !value.official_summary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'official 模式必须包含 official_summary',
        path: ['official_summary']
      });
    }
  });

export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>;
export type EvaluationDto = z.infer<typeof evaluationDtoSchema>;
export type ScoreSummary = z.infer<typeof scoreSummarySchema>;
export type ScorerRunResult = z.infer<typeof scorerRunResultSchema>;
export type ShownCaseResult = z.infer<typeof shownCaseResultSchema>;
export type ScoringMode = z.infer<typeof scoringModeSchema>;

export function parseEvaluationRecord(input: unknown): EvaluationRecord {
  return evaluationRecordSchema.parse(input);
}

export function parseEvaluationDto(input: unknown): EvaluationDto {
  return evaluationDtoSchema.parse(input);
}

export function parseScorerRunResult(input: unknown): ScorerRunResult {
  return scorerRunResultSchema.parse(input);
}

import { z } from 'zod';

import {
  type ScoringMode,
  parseScorerRunResult,
  scorerRunResultSchema,
  scoringModeSchema,
  scoreVisibilitySchema
} from './evaluation';

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => isSafeRelativePath(value), '必须是仓库内相对路径，且不能包含 ..');

export const problemBundleSpecSchema = z
  .object({
    schema_version: z.literal(1),
    problem_id: z.string().min(1),
    problem_title: z.string().min(1),
    problem_version: z.string().min(1),
    submission: z
      .object({
        format: z.literal('python_zip_project'),
        language: z.literal('python'),
        entrypoint: relativePathSchema
      })
      .strict(),
    scorer: z
      .object({
        entrypoint: relativePathSchema,
        result_file: relativePathSchema
      })
      .strict(),
    limits: z
      .object({
        time_limit_sec: z.number().positive(),
        memory_limit_mb: z.number().int().positive()
      })
      .strict(),
    datasets: z
      .object({
        shown_dir: relativePathSchema,
        hidden_dir: relativePathSchema,
        heldout_dir: relativePathSchema.optional(),
        shown_policy: scoreVisibilitySchema,
        hidden_policy: z.literal('score_only'),
        heldout_enabled: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.datasets.heldout_enabled && !value.datasets.heldout_dir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'heldout_enabled=true 时必须声明 heldout_dir',
        path: ['datasets', 'heldout_dir']
      });
    }

    if (!value.datasets.heldout_enabled && value.datasets.heldout_dir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'heldout_enabled=false 时不应声明 heldout_dir',
        path: ['datasets', 'heldout_dir']
      });
    }
  });

export type ProblemBundleSpec = z.infer<typeof problemBundleSpecSchema>;
export { parseScorerRunResult, scorerRunResultSchema, scoringModeSchema };
export type { ScoringMode };

export function parseProblemBundleSpec(input: unknown): ProblemBundleSpec {
  return problemBundleSpecSchema.parse(input);
}

function isSafeRelativePath(value: string): boolean {
  if (value.startsWith('/')) {
    return false;
  }

  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment.length > 0 && segment !== '..');
}

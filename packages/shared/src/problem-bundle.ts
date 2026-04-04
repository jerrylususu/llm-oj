import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => isSafeRelativePath(value), '必须是仓库内相对路径，且不能包含 ..');

export const scoringModeSchema = z.enum(['public', 'official']);
export const scoreVisibilitySchema = z.enum(['full', 'score_only']);
export const scorerCaseStatusSchema = z.enum(['passed', 'failed', 'error']);
export const scorerRunStatusSchema = z.enum(['passed', 'failed', 'error']);

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

export const scorerCaseResultSchema = z
  .object({
    case_id: z.string().min(1),
    status: scorerCaseStatusSchema,
    score: z.number().finite().min(0).max(1),
    message: z.string().min(1).optional()
  })
  .strict();

export const scorerRunResultSchema = z
  .object({
    status: scorerRunStatusSchema,
    mode: scoringModeSchema.optional(),
    primary_score: z.number().finite().min(0).max(1),
    shown_results: z.array(scorerCaseResultSchema).default([]),
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
export type ScorerRunResult = z.infer<typeof scorerRunResultSchema>;
export type ScoringMode = z.infer<typeof scoringModeSchema>;

export interface ProblemBundleValidationResult {
  readonly bundleDir: string;
  readonly spec: ProblemBundleSpec;
  readonly paths: {
    readonly specPath: string;
    readonly statementPath: string;
    readonly scorerEntrypointPath: string;
    readonly shownDirPath: string;
    readonly hiddenDirPath: string;
    readonly heldoutDirPath: string | null;
  };
}

function isSafeRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return false;
  }

  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment.length > 0 && segment !== '..');
}

async function assertPathType(
  targetPath: string,
  kind: 'file' | 'directory',
  label: string
): Promise<void> {
  let stats;

  try {
    stats = await stat(targetPath);
  } catch {
    throw new Error(`${label} 不存在: ${targetPath}`);
  }

  if (kind === 'file' && !stats.isFile()) {
    throw new Error(`${label} 不是文件: ${targetPath}`);
  }

  if (kind === 'directory' && !stats.isDirectory()) {
    throw new Error(`${label} 不是目录: ${targetPath}`);
  }
}

export function parseProblemBundleSpec(input: unknown): ProblemBundleSpec {
  return problemBundleSpecSchema.parse(input);
}

export function parseScorerRunResult(input: unknown): ScorerRunResult {
  return scorerRunResultSchema.parse(input);
}

export async function readProblemBundleSpec(bundleDir: string): Promise<ProblemBundleSpec> {
  const specPath = path.join(bundleDir, 'spec.json');
  const raw = await readFile(specPath, 'utf8');

  return parseProblemBundleSpec(JSON.parse(raw) as unknown);
}

export async function readScorerRunResult(resultPath: string): Promise<ScorerRunResult> {
  const raw = await readFile(resultPath, 'utf8');

  return parseScorerRunResult(JSON.parse(raw) as unknown);
}

export async function validateProblemBundle(
  bundleDir: string
): Promise<ProblemBundleValidationResult> {
  const spec = await readProblemBundleSpec(bundleDir);
  const specPath = path.join(bundleDir, 'spec.json');
  const statementPath = path.join(bundleDir, 'statement.md');
  const scorerEntrypointPath = path.join(bundleDir, spec.scorer.entrypoint);
  const shownDirPath = path.join(bundleDir, spec.datasets.shown_dir);
  const hiddenDirPath = path.join(bundleDir, spec.datasets.hidden_dir);
  const heldoutDirPath = spec.datasets.heldout_dir
    ? path.join(bundleDir, spec.datasets.heldout_dir)
    : null;

  await assertPathType(specPath, 'file', 'spec.json');
  await assertPathType(statementPath, 'file', 'statement.md');
  await assertPathType(scorerEntrypointPath, 'file', 'scorer entrypoint');
  await assertPathType(shownDirPath, 'directory', 'shown 数据目录');
  await assertPathType(hiddenDirPath, 'directory', 'hidden 数据目录');

  if (heldoutDirPath) {
    await assertPathType(heldoutDirPath, 'directory', 'heldout 数据目录');
  }

  return {
    bundleDir,
    spec,
    paths: {
      specPath,
      statementPath,
      scorerEntrypointPath,
      shownDirPath,
      hiddenDirPath,
      heldoutDirPath
    }
  };
}

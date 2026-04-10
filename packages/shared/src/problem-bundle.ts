import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  parseProblemBundleSpec,
  parseScorerRunResult,
  type ProblemBundleSpec,
  problemBundleSpecSchema,
  scorerRunResultSchema,
  scoringModeSchema,
  scoreVisibilitySchema,
  type ScorerRunResult,
  type ScoringMode,
  scoreSummarySchema,
  shownCaseResultSchema
} from '@llm-oj/contracts';

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

export {
  parseProblemBundleSpec,
  parseScorerRunResult,
  problemBundleSpecSchema,
  scorerRunResultSchema,
  scoringModeSchema,
  scoreSummarySchema,
  scoreVisibilitySchema,
  shownCaseResultSchema
};
export type { ProblemBundleSpec, ScorerRunResult, ScoringMode };

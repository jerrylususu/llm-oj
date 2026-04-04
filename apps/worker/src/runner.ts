import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Logger } from 'pino';

import { type ScorerRunResult, readScorerRunResult, type ServiceConfig } from '@llm-oj/shared';

import type { EvaluationJobRecord } from '@llm-oj/db';

const execFileAsync = promisify(execFile);

export interface EvaluationExecutionResult {
  readonly result: ScorerRunResult;
  readonly resultPath: string;
  readonly logPath: string;
}

async function extractSubmissionArtifact(
  artifactPath: string,
  targetDir: string,
  timeoutMs: number
): Promise<void> {
  await execFileAsync(
    'uv',
    ['run', 'python', '-m', 'zipfile', '-e', artifactPath, targetDir],
    { timeout: timeoutMs }
  );
}

async function runScorerLocal(
  config: ServiceConfig,
  job: EvaluationJobRecord,
  submissionDir: string,
  outputDir: string
): Promise<{ stdout: string; stderr: string }> {
  const scorerPath = path.join(job.payload.bundle_path, 'scorer', 'run.py');

  return execFileAsync(
    'uv',
    [
      'run',
      'python',
      scorerPath,
      '--problem-dir',
      job.payload.bundle_path,
      '--submission-dir',
      submissionDir,
      '--output-path',
      path.join(outputDir, 'result.json'),
      '--mode',
      job.evalType
    ],
    {
      timeout: config.env.RUNNER_TIMEOUT_SEC * 1000
    }
  );
}

async function runScorerDocker(
  config: ServiceConfig,
  job: EvaluationJobRecord,
  submissionDir: string,
  outputDir: string
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${job.payload.bundle_path}:/problem:ro`,
      '-v',
      `${submissionDir}:/submission:ro`,
      '-v',
      `${outputDir}:/output`,
      config.env.RUNNER_PYTHON_IMAGE,
      'python',
      '/problem/scorer/run.py',
      '--problem-dir',
      '/problem',
      '--submission-dir',
      '/submission',
      '--output-path',
      '/output/result.json',
      '--mode',
      job.evalType
    ],
    {
      timeout: config.env.RUNNER_TIMEOUT_SEC * 1000
    }
  );
}

export async function executeEvaluationJob(
  config: ServiceConfig,
  job: EvaluationJobRecord,
  logger: Logger
): Promise<EvaluationExecutionResult> {
  const storageRoot = path.resolve(process.cwd(), config.env.STORAGE_ROOT);
  const workingRoot = path.join(storageRoot, 'eval-artifacts', job.id);
  const extractionRoot = path.join(os.tmpdir(), 'llm-oj-submissions', job.id);
  const resultPath = path.join(workingRoot, 'result.json');
  const logPath = path.join(workingRoot, 'runner.log');

  await mkdir(workingRoot, { recursive: true });
  await mkdir(extractionRoot, { recursive: true });
  await extractSubmissionArtifact(
    job.payload.artifact_path,
    extractionRoot,
    config.env.RUNNER_TIMEOUT_SEC * 1000
  );

  let stdout = '';
  let stderr = '';

  try {
    const execution =
      config.env.RUNNER_MODE === 'docker'
        ? await runScorerDocker(config, job, extractionRoot, workingRoot)
        : await runScorerLocal(config, job, extractionRoot, workingRoot);

    stdout = execution.stdout;
    stderr = execution.stderr;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, jobId: job.id }, 'runner execution failed');
    await writeFile(logPath, [stdout, stderr, message].filter(Boolean).join('\n'), 'utf8');
    throw new Error(`runner execution failed: ${message}`);
  }

  await writeFile(logPath, [stdout, stderr].filter(Boolean).join('\n'), 'utf8');
  const result = await readScorerRunResult(resultPath);

  return {
    result,
    resultPath,
    logPath
  };
}

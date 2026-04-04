import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseProblemBundleSpec,
  parseScorerRunResult,
  readProblemBundleSpec,
  validateProblemBundle
} from '../src/problem-bundle';

const exampleBundleDir = path.resolve(process.cwd(), 'examples/problems/sample-sum/v1');
const tempDirs: string[] = [];

describe('problem bundle contract', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('parses the sample problem spec', async () => {
    const spec = await readProblemBundleSpec(exampleBundleDir);

    expect(spec.problem_id).toBe('sample-sum');
    expect(spec.problem_version).toBe('v1');
    expect(spec.submission.entrypoint).toBe('main.py');
    expect(spec.datasets.heldout_enabled).toBe(true);
  });

  it('validates the sample bundle layout', async () => {
    const bundle = await validateProblemBundle(exampleBundleDir);

    expect(bundle.paths.statementPath).toMatch(/statement\.md$/);
    expect(bundle.paths.scorerEntrypointPath).toMatch(/scorer\/run\.py$/);
    expect(bundle.paths.heldoutDirPath).toMatch(/heldout$/);
  });

  it('rejects a bundle when spec and layout disagree', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-bundle-'));
    tempDirs.push(tempDir);
    const bundleDir = path.join(tempDir, 'v1');

    await cp(exampleBundleDir, bundleDir, { recursive: true });
    await writeFile(
      path.join(bundleDir, 'spec.json'),
      JSON.stringify(
        {
          schema_version: 1,
          problem_id: 'sample-sum',
          problem_title: 'Sample Sum',
          problem_version: 'v1',
          submission: {
            format: 'python_zip_project',
            language: 'python',
            entrypoint: 'main.py'
          },
          scorer: {
            entrypoint: 'scorer/run.py',
            result_file: 'result.json'
          },
          limits: {
            time_limit_sec: 2,
            memory_limit_mb: 128
          },
          datasets: {
            shown_dir: 'shown',
            hidden_dir: 'missing-hidden',
            shown_policy: 'full',
            hidden_policy: 'score_only',
            heldout_enabled: false
          }
        },
        null,
        2
      )
    );

    await expect(validateProblemBundle(bundleDir)).rejects.toThrow(/hidden 数据目录 不存在/);
  });

  it('parses scorer output and enforces summary fields', () => {
    const result = parseScorerRunResult({
      status: 'passed',
      mode: 'public',
      primary_score: 1,
      shown_results: [{ case_id: 'shown-1', status: 'passed', score: 1 }],
      hidden_summary: { score: 1, passed: 2, total: 2 },
      logs: ['sample run']
    });

    expect(result.hidden_summary?.passed).toBe(2);

    expect(() =>
      parseScorerRunResult({
        status: 'passed',
        mode: 'public',
        primary_score: 1,
        shown_results: [],
        logs: []
      })
    ).toThrow(/hidden_summary/);
  });

  it('rejects unsafe relative paths in spec', () => {
    expect(() =>
      parseProblemBundleSpec({
        schema_version: 1,
        problem_id: 'unsafe',
        problem_title: 'Unsafe',
        problem_version: 'v1',
        submission: {
          format: 'python_zip_project',
          language: 'python',
          entrypoint: '../main.py'
        },
        scorer: {
          entrypoint: 'scorer/run.py',
          result_file: 'result.json'
        },
        limits: {
          time_limit_sec: 2,
          memory_limit_mb: 128
        },
        datasets: {
          shown_dir: 'shown',
          hidden_dir: 'hidden',
          shown_policy: 'full',
          hidden_policy: 'score_only',
          heldout_enabled: false
        }
      })
    ).toThrow(/相对路径/);
  });
});

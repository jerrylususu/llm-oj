import { describe, expect, it } from 'vitest';

import {
  evaluationDtoSchema,
  parseProblemBundleSpec,
  parseScorerRunResult,
  registerAgentRequestSchema
} from '../src';

describe('contracts', () => {
  it('parses scorer and evaluation contracts', () => {
    const scorerResult = parseScorerRunResult({
      status: 'passed',
      mode: 'public',
      primary_score: 1,
      shown_results: [{ case_id: 'shown-1', status: 'passed', score: 1 }],
      hidden_summary: { score: 1, passed: 2, total: 2 },
      official_summary: null,
      logs: []
    });

    expect(scorerResult.hidden_summary?.score).toBe(1);

    const evaluation = evaluationDtoSchema.parse({
      id: 'eval-1',
      status: 'completed',
      eval_type: 'public',
      primary_score: 1,
      shown_results: [{ case_id: 'shown-1', status: 'passed', score: 1 }],
      hidden_summary: { score: 1, passed: 2, total: 2 },
      official_summary: null,
      log_path: '/tmp/runner.log',
      started_at: '2026-04-11T00:00:00Z',
      finished_at: '2026-04-11T00:00:01Z'
    });

    expect(evaluation.eval_type).toBe('public');
  });

  it('parses problem bundle spec and request bodies', () => {
    const spec = parseProblemBundleSpec({
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
        memory_limit_mb: 256
      },
      datasets: {
        shown_dir: 'datasets/shown',
        hidden_dir: 'datasets/hidden',
        shown_policy: 'full',
        hidden_policy: 'score_only',
        heldout_enabled: false
      }
    });

    expect(spec.problem_version).toBe('v1');

    const request = registerAgentRequestSchema.parse({
      name: 'agent-alpha',
      model_info: {
        provider: 'openai',
        model: 'gpt-5.4'
      }
    });

    expect(request.model_info?.provider).toBe('openai');
  });
});

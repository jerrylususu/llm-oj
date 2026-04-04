import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';
import type { Pool } from 'pg';

import {
  checkDatabase,
  claimNextEvaluationJob,
  markEvaluationFinished,
  markEvaluationStarted,
  upsertServiceHeartbeat
} from '@llm-oj/db';
import type { ServiceConfig } from '@llm-oj/shared';

import { executeEvaluationJob } from './runner';

export interface WorkerBootstrap {
  readonly config: ServiceConfig;
  readonly logger: Logger;
  readonly db: Pool;
}

export interface WorkerRuntime {
  readonly intervalId: NodeJS.Timeout;
  stop(): Promise<void>;
}

export async function runWorkerCycle({ config, logger, db }: WorkerBootstrap): Promise<void> {
  const health = await checkDatabase(db);
  const workerId = `${config.serviceName}-${process.pid}`;
  const job = await claimNextEvaluationJob(db, workerId);

  if (!job) {
    await upsertServiceHeartbeat(db, config.serviceName, { status: 'idle' });
    logger.info({ databaseTime: health.currentTime }, 'worker heartbeat updated');
    return;
  }

  await upsertServiceHeartbeat(db, config.serviceName, {
    status: 'running',
    jobId: job.id,
    submissionId: job.submissionId
  });

  const evaluationId = randomUUID();
  await markEvaluationStarted(db, {
    evaluationId,
    submissionId: job.submissionId,
    jobId: job.id,
    evalType: job.evalType
  });

  try {
    const execution = await executeEvaluationJob(config, job, logger);
    await markEvaluationFinished(db, {
      evaluationId,
      submissionId: job.submissionId,
      jobId: job.id,
      evalType: job.evalType,
      status: 'completed',
      primaryScore: execution.result.primary_score,
      shownResults: execution.result.shown_results,
      hiddenSummary: execution.result.hidden_summary,
      officialSummary: execution.result.official_summary,
      logPath: execution.logPath,
      lastError: null
    });

    await upsertServiceHeartbeat(db, config.serviceName, {
      status: 'idle',
      lastCompletedJobId: job.id
    });
    logger.info(
      {
        jobId: job.id,
        submissionId: job.submissionId,
        primaryScore: execution.result.primary_score
      },
      'worker evaluation completed'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEvaluationFinished(db, {
      evaluationId,
      submissionId: job.submissionId,
      jobId: job.id,
      evalType: job.evalType,
      status: 'failed',
      primaryScore: null,
      shownResults: [],
      hiddenSummary: null,
      officialSummary: null,
      logPath: null,
      lastError: message
    });
    await upsertServiceHeartbeat(db, config.serviceName, {
      status: 'idle',
      lastFailedJobId: job.id
    });
    logger.error({ err: error, jobId: job.id }, 'worker evaluation failed');
  }
}

export async function startWorkerRuntime(setup: WorkerBootstrap): Promise<WorkerRuntime> {
  await upsertServiceHeartbeat(setup.db, setup.config.serviceName, { status: 'starting' });
  await runWorkerCycle(setup);

  const intervalId = setInterval(() => {
    void runWorkerCycle(setup);
  }, setup.config.env.WORKER_POLL_INTERVAL_MS);

  return {
    intervalId,
    async stop() {
      clearInterval(intervalId);
      await setup.db.end();
    }
  };
}

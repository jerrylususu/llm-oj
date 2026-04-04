import type { Logger } from 'pino';
import type { Pool } from 'pg';

import { checkDatabase, upsertServiceHeartbeat } from '@llm-oj/db';
import type { ServiceConfig } from '@llm-oj/shared';

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
  await upsertServiceHeartbeat(db, config.serviceName, { status: 'idle' });
  logger.info({ databaseTime: health.currentTime }, 'worker heartbeat updated');
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

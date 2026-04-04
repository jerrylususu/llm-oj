import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url()
});

export type RuntimeEnv = z.infer<typeof envSchema>;
export type ServiceName = 'api' | 'worker';

export interface ServiceConfig {
  readonly serviceName: ServiceName;
  readonly env: RuntimeEnv;
}

export function loadEnv(input: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');

    throw new Error(`环境变量校验失败: ${reason}`);
  }

  return parsed.data;
}

export function createServiceConfig(
  serviceName: ServiceName,
  input: NodeJS.ProcessEnv = process.env
): ServiceConfig {
  return {
    serviceName,
    env: loadEnv(input)
  };
}

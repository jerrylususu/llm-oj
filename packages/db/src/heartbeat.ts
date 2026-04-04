import type { Pool } from 'pg';

export interface HeartbeatPayload {
  readonly status: 'starting' | 'idle';
}

export async function upsertServiceHeartbeat(
  pool: Pool,
  serviceName: string,
  payload: HeartbeatPayload
): Promise<void> {
  await pool.query(
    `
      INSERT INTO service_heartbeats (service_name, last_seen_at, payload)
      VALUES ($1, NOW(), $2::jsonb)
      ON CONFLICT (service_name)
      DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        payload = EXCLUDED.payload
    `,
    [serviceName, JSON.stringify(payload)]
  );
}

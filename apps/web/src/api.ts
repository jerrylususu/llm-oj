import type { ZodType } from 'zod';

const API_BASE_URL = (() => {
  const configured: string =
    window.__LLM_OJ_API_BASE_URL__ ?? import.meta.env.VITE_API_BASE_URL ?? '';
  return configured.endsWith('/') ? configured.slice(0, -1) : configured;
})();

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    let message = response.statusText;

    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // ignore json parsing failures for non-json error bodies
    }

    throw new ApiError(response.status, message);
  }

  return schema.parse(await response.json());
}

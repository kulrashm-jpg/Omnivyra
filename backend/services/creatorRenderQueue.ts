import { createHash } from 'crypto';

export type RenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';

export type RenderJob<T> = {
  id: string;
  idempotencyKey: string;
  status: RenderJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  result?: T;
  error?: string;
};

const jobs = new Map<string, RenderJob<unknown>>();

export function createRenderJobId(input: unknown): string {
  return createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 24);
}

export function getRenderJob<T>(idempotencyKey: string): RenderJob<T> | null {
  return (jobs.get(idempotencyKey) as RenderJob<T> | undefined) ?? null;
}

export async function enqueueRenderJob<T>(input: {
  idempotencyKey: string;
  timeoutMs?: number;
  maxAttempts?: number;
  run: () => Promise<T>;
}): Promise<RenderJob<T>> {
  const existing = jobs.get(input.idempotencyKey) as RenderJob<T> | undefined;
  if (existing && (existing.status === 'running' || existing.status === 'completed')) return existing;

  const now = new Date().toISOString();
  const job: RenderJob<T> = existing ?? {
    id: createRenderJobId(input.idempotencyKey),
    idempotencyKey: input.idempotencyKey,
    status: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(input.idempotencyKey, job as RenderJob<unknown>);

  const timeoutMs = input.timeoutMs ?? 120_000;
  const maxAttempts = input.maxAttempts ?? 2;
  while (job.attempts < maxAttempts) {
    job.status = 'running';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    try {
      const result = await Promise.race([
        input.run(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('render_job_timeout')), timeoutMs)),
      ]);
      job.status = 'completed';
      job.result = result;
      job.updatedAt = new Date().toISOString();
      return job;
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.status = job.error === 'render_job_timeout' ? 'timeout' : 'failed';
      job.updatedAt = new Date().toISOString();
      if (job.attempts >= maxAttempts) return job;
    }
  }
  return job;
}

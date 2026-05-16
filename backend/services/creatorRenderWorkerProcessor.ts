import type { Job } from 'bullmq';
import { renderAsset } from './creatorAssetRenderer';
import type { CreatorDurableRenderJobData } from './creatorRenderDurableQueue';
import { persistCreatorRenderJobState } from './creatorRenderPersistence';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function processCreatorRenderJob(job: Job<CreatorDurableRenderJobData>): Promise<Record<string, unknown>> {
  const data = job.data;
  await persistCreatorRenderJobState({
    id: String(job.id),
    idempotencyKey: data.idempotencyKey,
    renderer: data.renderer,
    status: 'running',
    progress: 10,
    attempts: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 3,
    payload: data.payload,
    auditId: data.auditId ?? null,
    eventType: 'worker_started',
  });
  await job.updateProgress(10);
  const payload = safeObject(data.payload);
  const assetPayload = safeObject(payload.assetPayload);
  const options = safeObject(payload.options);
  const result = await renderAsset(assetPayload, {
    campaignId: typeof options.campaignId === 'string' ? options.campaignId : null,
    userId: typeof options.userId === 'string' ? options.userId : null,
    companyId: typeof options.companyId === 'string' ? options.companyId : null,
  });
  await job.updateProgress(100);
  const resultRecord = result as unknown as Record<string, unknown>;
  await persistCreatorRenderJobState({
    id: String(job.id),
    idempotencyKey: data.idempotencyKey,
    renderer: data.renderer,
    status: 'completed',
    progress: 100,
    attempts: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 3,
    payload: data.payload,
    result: resultRecord,
    auditId: data.auditId ?? null,
    eventType: 'worker_completed',
  });
  return resultRecord;
}

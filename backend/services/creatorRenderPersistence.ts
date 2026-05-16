import { ownedDbTable } from '../db/writeOwner';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function persistCreatorRenderJobState(input: {
  id: string;
  idempotencyKey: string;
  renderer: string;
  status: string;
  progress?: number;
  attempts?: number;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string | null;
  auditId?: string | null;
  eventType?: string;
  eventMetadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ownedDbTable('creator_render_jobs').upsert({
      id: input.id,
      idempotency_key: input.idempotencyKey,
      renderer: input.renderer,
      status: input.status,
      progress: input.progress ?? 0,
      attempts: input.attempts ?? 0,
      max_attempts: input.maxAttempts ?? 3,
      payload: input.payload ?? {},
      result: input.result ?? null,
      error_message: input.errorMessage ?? null,
      audit_id: input.auditId ?? null,
      completed_at: input.status === 'completed' ? new Date().toISOString() : null,
      failed_at: input.status === 'failed' || input.status === 'dead_letter' ? new Date().toISOString() : null,
      cancelled_at: input.status === 'cancelled' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    await ownedDbTable('creator_render_job_events').insert({
      job_id: input.id,
      event_type: input.eventType ?? input.status,
      metadata: input.eventMetadata ?? {},
    });
  } catch (error) {
    console.warn('[creator-render-persistence] job state write failed', {
      id: input.id,
      status: input.status,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function persistCreatorValidationManifest(input: {
  renderJobId?: string | null;
  rendererId: string;
  assetType: string;
  platform: string;
  attachmentMode?: string | null;
  renderManifest: Record<string, unknown>;
  validationManifest: Record<string, unknown>;
  auditId?: string | null;
}): Promise<void> {
  try {
    const renderManifest = safeObject(input.renderManifest);
    const validationManifest = safeObject(input.validationManifest);
    await ownedDbTable('creator_render_validation_manifests').insert({
      render_job_id: input.renderJobId ?? null,
      renderer_id: input.rendererId,
      asset_type: input.assetType,
      platform: input.platform,
      attachment_mode: input.attachmentMode ?? null,
      render_manifest: renderManifest,
      validation_manifest: validationManifest,
      ocr_result: safeObject(renderManifest.ocrResult ?? validationManifest.ocr ?? validationManifest.final_ocr),
      quality_score: safeObject(renderManifest.qualityScore),
      audit_id: input.auditId ?? null,
    });
  } catch (error) {
    console.warn('[creator-render-persistence] validation manifest write failed', {
      rendererId: input.rendererId,
      assetType: input.assetType,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

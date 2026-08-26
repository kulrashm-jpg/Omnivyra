import type { Job } from 'bullmq';
import { renderAsset } from './creatorAssetRenderer';
import type { CreatorDurableRenderJobData } from './creatorRenderDurableQueue';
import { persistCreatorRenderJobState } from './creatorRenderPersistence';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function processCreatorRenderJob(job: Job<CreatorDurableRenderJobData>): Promise<Record<string, unknown>> {
  const data = job.data;
  const isPreview = data.renderer === 'user_template_preview';
  const payload = safeObject(data.payload);
  const previewCtx = safeObject(payload.preview);

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

  // USER_TEMPLATE_PREVIEW: reflect 'rendering' on the template itself (the
  // editor/gallery read template.previewStatus) — every state is persisted.
  if (isPreview) {
    try {
      const { setPreviewStatus } = await import('./creator/userTemplateService');
      await setPreviewStatus(String(previewCtx.templateId || ''), 'rendering');
    } catch { /* best-effort */ }
  }

  const assetPayload = safeObject(payload.assetPayload);
  const options = safeObject(payload.options);
  const renderStart = Date.now();

  // PART A — resolve the incoming template_id BEFORE render. If it is a user
  // template, load + register it via the canonical runtime registration flow so
  // the renderer's resolveTemplate() resolves its style/contract (no second
  // resolver, no duplicate registration). Best-effort: system/absent ids no-op.
  try {
    const { ensureUserTemplateRegisteredForAsset } = await import('./creator/userTemplateService');
    await ensureUserTemplateRegisteredForAsset(assetPayload);
  } catch { /* best-effort — system + default-style resolution unaffected */ }

  /*
   * A queued render resolves its draft's attachments the SAME way an inline one
   * does — through the one resolver, given the identity the payload carried.
   *
   * Without this a scheduled or campaign render could never see a reference the
   * user had attached: the rows were durable, but the worker had no name for
   * the composition they belonged to. Absent identity => null => the render is
   * byte-identical to before, which is every job that has no draft.
   *
   * `companyId` from the payload remains the ONLY authorization input, exactly
   * as on the inline path; `compositionId` is a lookup key that finds nothing
   * outside its own tenant.
   */
  const workerCompanyId = typeof options.companyId === 'string' ? options.companyId : null;
  const workerCompositionId = typeof options.compositionId === 'string' ? options.compositionId : null;
  const compositionReferences = await (async () => {
    if (!workerCompanyId || !workerCompositionId) return null;
    try {
      const { resolveCompositionReferencesForRender } = await import('./creator/resolveCompositionReferencesForRender');
      const { templateAssetSlotsForRenderPayload } = await import('./creatorAssetRenderer');
      return await resolveCompositionReferencesForRender({
        companyId: workerCompanyId,
        compositionId: workerCompositionId,
        // The template's own slots decide what it accepts. Omitting them is not
        // a neutral default — the resolver reads absent slots as "accepts
        // nothing" and rejects every attachment.
        templateSlots: templateAssetSlotsForRenderPayload(assetPayload),
      });
    } catch {
      // Resolution is an enhancement, never a reason a queued render fails.
      // The reference stays attached and the next attempt can still apply it.
      return null;
    }
  })();

  // ── Render (the ONE rendering path — shared by every job type) ──
  let result: Awaited<ReturnType<typeof renderAsset>>;
  try {
    result = await renderAsset(assetPayload, {
      campaignId: typeof options.campaignId === 'string' ? options.campaignId : null,
      userId: typeof options.userId === 'string' ? options.userId : null,
      companyId: workerCompanyId,
      compositionReferences,
    });
  } catch (error) {
    // USER_TEMPLATE_PREVIEW: on TERMINAL failure (no retries left), mark the
    // template preview failed (keeps the previous preview). Then rethrow so the
    // existing BullMQ retry / dead-letter policy applies (no new retry path).
    if (isPreview && job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
      try {
        const { markUserTemplatePreviewFailed } = await import('./creator/userTemplatePreviewService');
        await markUserTemplatePreviewFailed(String(previewCtx.templateId || ''), Number(previewCtx.version || 0));
      } catch { /* best-effort */ }
    }
    throw error;
  }

  const resultRecord = result as unknown as Record<string, unknown>;

  // ── WATCHDOG: never ship "not worth presenting" output ────────────────────
  // renderAsset attaches a visual_validation verdict. Two non-repairable failures
  // mean the asset is not worth presenting and must NOT be scheduled:
  //   • missing_content — a carousel slide rendered with an EMPTY body (title over
  //     empty space); shortening can't restore a missing body.
  //   • thin_content    — a near-EMPTY infographic (title over mostly-blank canvas).
  // Fail the job here rather than completing + scheduling it. Previews are diagnostic
  // and still surface (so the defect is visible in the editor); only real scheduled
  // renders are blocked.
  if (!isPreview) {
    const vv = safeObject(safeObject(resultRecord.metadata).visual_validation);
    const failures = Array.isArray(vv.failures) ? vv.failures : [];
    const notWorthPresenting = failures.some((f) => {
      const category = safeObject(f).category;
      return category === 'missing_content' || category === 'thin_content';
    });
    if (notWorthPresenting) {
      throw new Error(
        'Render blocked by watchdog: output is not worth presenting (blank carousel slide or near-empty infographic) — regenerate rather than ship it.',
      );
    }
  }

  if (isPreview) {
    // Validating state — visual validation + diagnostic come from the SAME
    // pipeline (renderAsset attached visual_validation; the diagnostic is built
    // here). No duplicate rendering/validation logic.
    await persistCreatorRenderJobState({
      id: String(job.id),
      idempotencyKey: data.idempotencyKey,
      renderer: data.renderer,
      status: 'running',
      progress: 80,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 3,
      payload: data.payload,
      auditId: data.auditId ?? null,
      eventType: 'validating',
    });
    await job.updateProgress(80);

    const renderMeta = safeObject(resultRecord.metadata);
    const previewUrl = (typeof resultRecord.url === 'string' && resultRecord.url)
      || (Array.isArray(renderMeta.files) && typeof renderMeta.files[0] === 'string' ? String(renderMeta.files[0]) : null)
      || null;
    try {
      const { finalizeUserTemplatePreviewRender } = await import('./creator/userTemplatePreviewService');
      await finalizeUserTemplatePreviewRender({
        templateId: String(previewCtx.templateId || ''),
        version: Number(previewCtx.version || 0),
        companyId: String(previewCtx.companyId || ''),
        assetFamily: String(previewCtx.assetFamily || 'image'),
        name: String(previewCtx.name || ''),
        renderingContractVersion: typeof previewCtx.renderingContractVersion === 'string' ? previewCtx.renderingContractVersion : undefined,
        renderMeta,
        previewUrl,
        durationMs: Date.now() - renderStart,
      });
    } catch { /* persistence best-effort; job still completes */ }
  }

  await job.updateProgress(100);
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

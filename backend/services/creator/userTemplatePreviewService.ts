/**
 * User Template Preview Service — async preview generation.
 *
 * REUSES the existing pipeline end-to-end: builds the canonical asset_payload
 * from the template (buildPreviewIntent), renders it through the SAME
 * `renderAsset` (which produces the image + visual validation), then builds the
 * SAME deterministic diagnostic via `buildCreatorDiagnosticReport`. No duplicate
 * rendering/validation/diagnostic. The result (preview image + diagnostic) is
 * persisted per template version and surfaced by the existing Quality Inspector.
 *
 * `enqueueUserTemplatePreview` is fire-and-forget — the save path never awaits
 * it, so saving stays fast. Status transitions: pending → rendering → ready|failed.
 */

import { type CreatorTemplate, registerUserTemplate } from '../../../lib/creator-templates';
import { buildPreviewIntent } from '../../../lib/creator-templates/userTemplatePreview';
import { setPreviewStatus, setPreviewResult } from './userTemplateService';

function safeObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface GeneratedPreview {
  previewUrl: string | null;
  diagnostic: unknown;
}

/**
 * Render a template preview through the existing pipeline. Pure orchestration —
 * imports the renderer + diagnostic dynamically (matching the generate route's
 * font-init ordering). Throws on render failure (caller marks 'failed').
 */
export async function generateUserTemplatePreview(template: CreatorTemplate, companyId: string): Promise<GeneratedPreview> {
  // Register the user template so the renderer's resolveTemplate(template_id)
  // resolves ITS style + contract (not the default) — same pipeline as system.
  registerUserTemplate(template);
  const assetPayload = buildPreviewIntent(template);

  // Configure fontconfig BEFORE the renderer (sharp) is imported — same ordering
  // the generate route uses so preview text renders correctly.
  try {
    const { ensureRenderFonts } = await import('../creatorRenderFonts');
    ensureRenderFonts();
  } catch { /* best-effort */ }

  const start = Date.now();
  const { renderAsset } = await import('../creatorAssetRenderer');
  const bundle = await renderAsset(assetPayload, { companyId });
  const renderMeta = safeObject((bundle as { metadata?: unknown }).metadata);
  const previewUrl = (typeof (bundle as { url?: unknown }).url === 'string' && (bundle as { url: string }).url)
    || (Array.isArray(renderMeta.files) && typeof renderMeta.files[0] === 'string' ? String(renderMeta.files[0]) : null)
    || null;

  // Canonical company/brand context for the diagnostic (best-effort, cached).
  let companyContext: Record<string, unknown> | undefined;
  let brandVoice: Record<string, unknown> | undefined;
  try {
    const { resolveCreatorCopyContext } = await import('./creatorCopyContextResolver');
    const ctx = await resolveCreatorCopyContext(companyId);
    companyContext = ctx.company as unknown as Record<string, unknown>;
    brandVoice = ctx.brandVoice as unknown as Record<string, unknown>;
  } catch { /* best-effort */ }

  const { buildCreatorDiagnosticReport } = await import('./creatorDiagnosticReport');
  const diagnostic = buildCreatorDiagnosticReport({
    assetType: template.assetFamily,
    contentType: template.assetFamily,
    platform: 'linkedin',
    companyId,
    durationMs: Date.now() - start,
    template: {
      id: template.id,
      name: template.name,
      version: template.version,
      assetFamily: template.assetFamily,
      renderingContractVersion: template.renderingContract.renderingContractVersion,
    },
    companyContext,
    brandVoice,
    contentViolations: [],
    renderMetadata: renderMeta,
  });

  return { previewUrl, diagnostic };
}

/** Build the durable render-job payload (one queue, shared renderAsset path). */
export function buildPreviewJobPayload(template: CreatorTemplate, companyId: string): Record<string, unknown> {
  return {
    assetPayload: buildPreviewIntent(template),
    options: { companyId },
    preview: {
      templateId: template.id,
      version: template.version,
      companyId,
      assetFamily: template.assetFamily,
      name: template.name,
      renderingContractVersion: template.renderingContract.renderingContractVersion,
    },
  };
}

/**
 * Enqueue a DURABLE preview-render job onto the EXISTING Creator render queue
 * (job type 'user_template_preview'). The save path never awaits this. When the
 * durable queue is not configured (e.g. local without Redis), fall back to an
 * inline render via the SAME `renderAsset` path — no second queue, no second
 * rendering path.
 */
export async function enqueueUserTemplatePreview(input: { template: CreatorTemplate; companyId: string }): Promise<void> {
  const { template, companyId } = input;
  try {
    const { isDurableCreatorRenderQueueConfigured, enqueueDurableCreatorRenderJob } = await import('../creatorRenderDurableQueue');
    if (isDurableCreatorRenderQueueConfigured()) {
      await setPreviewStatus(template.id, 'pending'); // queued — worker advances to rendering/validating/ready
      await enqueueDurableCreatorRenderJob({
        renderer: 'user_template_preview',
        idempotencyKey: `tpl-preview:${template.id}:${template.version}`,
        auditId: `tpl-preview:${template.id}:${template.version}`,
        timeoutMs: 120_000,
        payload: buildPreviewJobPayload(template, companyId),
      });
      return;
    }
  } catch (error) {
    console.warn('[user-template-preview][enqueue-failed-falling-back-inline]', { id: template.id, message: error instanceof Error ? error.message : String(error) });
  }

  // Inline fallback (no durable queue): same renderAsset + diagnostic pipeline.
  await setPreviewStatus(template.id, 'rendering');
  try {
    const { previewUrl, diagnostic } = await generateUserTemplatePreview(template, companyId);
    await setPreviewResult({ id: template.id, version: template.version, status: 'ready', previewUrl, diagnostic });
  } catch (error) {
    console.warn('[user-template-preview][failed]', { id: template.id, message: error instanceof Error ? error.message : String(error) });
    await setPreviewResult({ id: template.id, version: template.version, status: 'failed' });
  }
}

/**
 * Worker callback — finalize a durable preview render: build the diagnostic from
 * the render metadata (the SAME `buildCreatorDiagnosticReport`) and persist the
 * preview + diagnostic ('ready'). Called by `processCreatorRenderJob` AFTER the
 * shared `renderAsset` produced the image + visual validation.
 */
export async function finalizeUserTemplatePreviewRender(input: {
  templateId: string;
  version: number;
  companyId: string;
  assetFamily: string;
  name: string;
  renderingContractVersion?: string;
  renderMeta: Record<string, unknown>;
  previewUrl: string | null;
  durationMs: number;
}): Promise<void> {
  let companyContext: Record<string, unknown> | undefined;
  let brandVoice: Record<string, unknown> | undefined;
  try {
    const { resolveCreatorCopyContext } = await import('./creatorCopyContextResolver');
    const ctx = await resolveCreatorCopyContext(input.companyId);
    companyContext = ctx.company as unknown as Record<string, unknown>;
    brandVoice = ctx.brandVoice as unknown as Record<string, unknown>;
  } catch { /* best-effort */ }

  const { buildCreatorDiagnosticReport } = await import('./creatorDiagnosticReport');
  const diagnostic = buildCreatorDiagnosticReport({
    assetType: input.assetFamily,
    contentType: input.assetFamily,
    platform: 'linkedin',
    companyId: input.companyId,
    durationMs: input.durationMs,
    template: { id: input.templateId, name: input.name, version: input.version, assetFamily: input.assetFamily, renderingContractVersion: input.renderingContractVersion },
    companyContext,
    brandVoice,
    contentViolations: [],
    renderMetadata: input.renderMeta,
  });
  await setPreviewResult({ id: input.templateId, version: input.version, status: 'ready', previewUrl: input.previewUrl, diagnostic });
}

/** Worker callback — mark a template preview as failed (keeps the previous preview). */
export async function markUserTemplatePreviewFailed(templateId: string, version: number): Promise<void> {
  await setPreviewResult({ id: templateId, version, status: 'failed' });
}

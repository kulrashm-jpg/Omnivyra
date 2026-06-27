import { getTemplateById } from '../../../lib/creator-templates';
import { buildPreviewJobPayload } from '../../services/creator/userTemplatePreviewService';

/**
 * The durable preview job rides the EXISTING Creator render queue as job type
 * 'user_template_preview'. This verifies the payload contract the worker
 * (processCreatorRenderJob) consumes: the canonical asset_payload + render
 * options + the preview context used to finalize (diagnostic + persistence).
 */
describe('User template preview — durable queue payload', () => {
  it('carries the canonical asset_payload, render options, and preview context', () => {
    const t = getTemplateById('sys-image-headline-sub-cta')!;
    const p = buildPreviewJobPayload(t, 'co-1') as any;

    // Same asset_payload the renderer consumes for normal generation.
    expect(p.assetPayload.asset_kind).toBe('image');
    expect(p.assetPayload.overlay_text.__template_authoritative).toBe(true);
    expect(p.assetPayload.media_bundle.metadata.preview_render).toBe(true);

    // Render options (companyId threads to renderAsset).
    expect(p.options.companyId).toBe('co-1');

    // Preview context the worker uses to build the diagnostic + persist.
    expect(p.preview).toMatchObject({
      templateId: t.id,
      version: t.version,
      companyId: 'co-1',
      assetFamily: 'image',
      name: t.name,
    });
    expect(p.preview.renderingContractVersion).toBe(t.renderingContract.renderingContractVersion);
  });

  it('builds a carousel preview payload with slides', () => {
    const t = getTemplateById('sys-carousel-educational-5')!;
    const p = buildPreviewJobPayload(t, 'co-2') as any;
    expect(p.assetPayload.asset_kind).toBe('carousel');
    expect(Array.isArray(p.assetPayload.slides)).toBe(true);
    expect(p.preview.assetFamily).toBe('carousel');
  });
});

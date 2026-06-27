import { getTemplateById } from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';
import { buildPreviewIntent, previewStatusOf, canPublishWithPreview, resolveTemplatePreview, previewStatusLabel } from '../../../lib/creator-templates/userTemplatePreview';

const passing = { reportVersion: 'creator-diagnostic-v1', visualValidation: { passed: true, failures: [] }, scores: { overallReadiness: { value: 90 } } };

describe('User template preview — intent maps template → canonical asset_payload', () => {
  it('image: overlay_text is authoritative and carries the contract lane', () => {
    const t = getTemplateById('sys-image-headline-sub-cta')!;
    const p = buildPreviewIntent(t) as any;
    expect(p.asset_kind).toBe('image');
    expect(p.overlay_text.headline).toBe(t.preview.sample.headline);
    expect(p.overlay_text.cta).toBe(t.preview.sample.cta);
    expect(p.overlay_text.__template_authoritative).toBe(true);
    expect(p.media_bundle.metadata.writer_asset_type).toBe('banner');
    expect(p.media_bundle.metadata.attachment_mode).toBe('embedded_copy');
    expect(p.media_bundle.metadata.preview_render).toBe(true);
  });

  it('carousel: sample slide labels become slides[]', () => {
    const t = getTemplateById('sys-carousel-educational-5')!;
    const p = buildPreviewIntent(t) as any;
    expect(p.asset_kind).toBe('carousel');
    expect(p.slides.length).toBe(t.preview.sample.slides!.length);
    expect(p.slides[0]).toMatchObject({ slide_number: 1, title: t.preview.sample.slides![0] });
    expect(p.slide_count).toBe(p.slides.length);
  });

  it('infographic: sample sections become thread_visual_transform items (label: value)', () => {
    const t = getTemplateById('sys-infographic-statistics')!;
    const p = buildPreviewIntent(t) as any;
    expect(p.asset_kind).toBe('image');
    expect(p.media_bundle.metadata.creator_content_asset_type).toBe('infographic');
    expect(p.media_bundle.metadata.infographic_layout).toBe('stats');
    const items = p.media_bundle.metadata.thread_visual_transform.items as string[];
    expect(items[0]).toContain(':');
    expect(items[0]).toContain(t.preview.sample.sections![0].label);
  });
});

describe('User template preview — status lifecycle + publish gate', () => {
  const mk = (status?: string, thumb?: string | null) => {
    const t = cloneTemplate(getTemplateById('sys-image-headline')!, 'image', { id: 'u1', ownerUserId: 'o1' });
    if (status) (t.metadata as any).previewStatus = status;
    if (thumb !== undefined) t.preview = { ...t.preview, thumbnailUrl: thumb };
    return t;
  };

  it('reports deterministic status from metadata / thumbnail', () => {
    expect(previewStatusOf(mk('rendering'))).toBe('rendering');
    expect(previewStatusOf(mk('failed'))).toBe('failed');
    expect(previewStatusOf(mk(undefined, 'https://x/p.png'))).toBe('ready');
    expect(previewStatusOf(mk(undefined, null))).toBe('pending');
  });

  it('blocks publish until preview is ready, then defers to the diagnostic gate', () => {
    expect(canPublishWithPreview(mk('pending'), passing).ok).toBe(false);
    expect(canPublishWithPreview(mk('rendering'), passing).ok).toBe(false);
    expect(canPublishWithPreview(mk('failed'), passing).ok).toBe(false);
    // Ready + passing diagnostic → publishable.
    expect(canPublishWithPreview(mk('ready'), passing).ok).toBe(true);
    // Ready but failing diagnostic → still blocked.
    expect(canPublishWithPreview(mk('ready'), { reportVersion: 'x', visualValidation: { passed: false }, scores: {} }).ok).toBe(false);
  });
});

describe('User template preview — gallery preview resolution', () => {
  const mk = (status?: string, thumb?: string | null) => {
    const t = cloneTemplate(getTemplateById('sys-image-headline')!, 'image', { id: 'u1', ownerUserId: 'o1' });
    if (status) (t.metadata as any).previewStatus = status;
    if (thumb !== undefined) t.preview = { ...t.preview, thumbnailUrl: thumb };
    return t;
  };

  it('system templates always resolve to the sample composition', () => {
    const sys = getTemplateById('sys-image-headline')!;
    const r = resolveTemplatePreview(sys);
    expect(r.kind).toBe('sample');
    expect(r.isUserTemplate).toBe(false);
  });

  it('shows the real rendered preview when ready + url exists', () => {
    const r = resolveTemplatePreview(mk('ready', 'https://x/p.png'));
    expect(r.kind).toBe('rendered');
    expect(r.url).toBe('https://x/p.png');
    expect(r.status).toBe('ready');
  });

  it('keeps the previous preview (rendered) on failure — never a placeholder', () => {
    const r = resolveTemplatePreview(mk('failed', 'https://x/old.png'));
    expect(r.kind).toBe('rendered');
    expect(r.url).toBe('https://x/old.png');
  });

  it('falls back to the sample composition when no preview exists yet', () => {
    expect(resolveTemplatePreview(mk('pending', null)).kind).toBe('sample');
    expect(resolveTemplatePreview(mk('rendering', '')).kind).toBe('sample');
  });

  it('labels every preview status deterministically', () => {
    expect(previewStatusLabel('pending')).toBe('Queued');
    expect(previewStatusLabel('rendering')).toBe('Rendering');
    expect(previewStatusLabel('ready')).toBe('Ready');
    expect(previewStatusLabel('failed')).toBe('Failed');
  });
});

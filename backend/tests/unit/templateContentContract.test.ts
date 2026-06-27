import {
  ALL_SYSTEM_TEMPLATES, listTemplatesForFamily,
  validateGeneratedContentAgainstTemplate, validateAssetPayloadAgainstTemplate,
} from '../../../lib/creator-templates';
import { buildPreviewIntent } from '../../../lib/creator-templates/userTemplatePreview';

const carousel = listTemplatesForFamily('carousel').find((t) => t.id === 'sys-carousel-educational-5')!;
const stats = listTemplatesForFamily('infographic').find((t) => t.id === 'sys-infographic-statistics')!;
const compare = listTemplatesForFamily('infographic').find((t) => t.id === 'sys-infographic-comparison')!;
const image = listTemplatesForFamily('image').find((t) => t.id === 'sys-image-headline')!;

describe('CAMPAIGN-001 content-contract validation (deterministic)', () => {
  it('every system template’s canonical sample satisfies its own contract', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) {
      const payload = buildPreviewIntent(t);
      const r = validateGeneratedContentAgainstTemplate(t, payload);
      if (!r.ok) throw new Error(`${t.id}: ${r.errors.join(' | ')}`);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects a carousel whose generated count != the requested slide_count', () => {
    const payload: any = buildPreviewIntent(carousel); // slide_count = 5
    payload.slides = payload.slides.slice(0, 3); // generation produced only 3
    const r = validateGeneratedContentAgainstTemplate(carousel, payload);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/generated 3 slide\(s\) but the template\/plan requested 5/);
  });

  it('rejects a carousel slide missing its required title', () => {
    const payload: any = buildPreviewIntent(carousel);
    payload.slides[1].title = ''; payload.slides[1].headline = '';
    const r = validateGeneratedContentAgainstTemplate(carousel, payload);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Slide 2/);
  });

  it('rejects an infographic with too few sections', () => {
    const payload: any = buildPreviewIntent(stats); // min 2
    payload.media_bundle.metadata.thread_visual_transform.items = ['only one: x'];
    const r = validateGeneratedContentAgainstTemplate(stats, payload);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/at least 2/);
  });

  it('rejects an infographic with too many sections', () => {
    const payload: any = buildPreviewIntent(compare); // max 6
    payload.media_bundle.metadata.thread_visual_transform.items = Array.from({ length: 9 }, (_, i) => `r${i}: v`);
    const r = validateGeneratedContentAgainstTemplate(compare, payload);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/at most 6/);
  });

  it('rejects an image missing its required on-image text', () => {
    const payload: any = buildPreviewIntent(image);
    payload.overlay_text.headline = ''; payload.media_bundle.metadata.overlay_text.headline = '';
    const r = validateGeneratedContentAgainstTemplate(image, payload);
    expect(r.ok).toBe(false);
  });

  it('payload gate: matched for a template_id, no-op otherwise', () => {
    const ok = validateAssetPayloadAgainstTemplate(buildPreviewIntent(stats));
    expect(ok).toEqual({ matched: true, ok: true, errors: [] });

    const bad: any = buildPreviewIntent(carousel);
    bad.slides = bad.slides.slice(0, 2);
    const badRes = validateAssetPayloadAgainstTemplate(bad);
    expect(badRes.matched).toBe(true);
    expect(badRes.ok).toBe(false);

    expect(validateAssetPayloadAgainstTemplate({})).toEqual({ matched: false, ok: true, errors: [] });
    expect(validateAssetPayloadAgainstTemplate({ media_bundle: { metadata: { template_id: 'nope-xyz' } } })).toEqual({ matched: false, ok: true, errors: [] });
  });
});

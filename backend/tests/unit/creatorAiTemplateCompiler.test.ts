import { validateTemplateIntent, deriveIntentFromPrompt } from '../../../lib/creator-templates/aiTemplateIntent';
import { compileTemplateIntent } from '../../../lib/creator-templates/aiTemplateCompiler';
import { buildPreviewIntent } from '../../../lib/creator-templates/userTemplatePreview';

const opts = { id: 'tpl-1', ownerUserId: 'user-1', now: '2026-06-25T00:00:00.000Z' };

describe('AI Template Intent — validation + derivation', () => {
  it('coerces invalid enum values to deterministic defaults', () => {
    const r = validateTemplateIntent({ assetFamily: 'nonsense', name: 'X', visualStyle: 'zzz', density: 'huge' });
    expect(r.ok).toBe(true);
    expect(r.intent.assetFamily).toBe('image');
    expect(r.intent.visualStyle).toBe('corporate');
    expect(r.intent.density).toBe('balanced');
  });

  it('flags a missing name as invalid', () => {
    const r = validateTemplateIntent({ assetFamily: 'image' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('derives family + style + emphasis from natural language', () => {
    expect(deriveIntentFromPrompt('Create a luxury product announcement template.').visualStyle).toBe('luxury');
    expect(deriveIntentFromPrompt('Create a luxury product announcement template.').emphasis).toBe('cta');
    expect(deriveIntentFromPrompt('Create a minimal thought leadership carousel.').assetFamily).toBe('carousel');
    expect(deriveIntentFromPrompt('Design an infographic for SaaS metrics.').assetFamily).toBe('infographic');
    expect(deriveIntentFromPrompt('Design an infographic for SaaS metrics.').emphasis).toBe('data');
  });
});

describe('AI Template Compiler — intent → canonical CreatorTemplate', () => {
  it('produces a user template with intent-driven visual language', () => {
    const intent = deriveIntentFromPrompt('I want a bold LinkedIn hiring template.');
    const t = compileTemplateIntent(intent, opts);
    expect(t.ownership).toBe('user');
    expect(t.assetFamily).toBe('image');
    expect(t.visualLanguage.densityBias).toBe(intent.density);
    expect(t.visualLanguage.typographyWeight).toBe(intent.typographyPreference);
    expect((t.metadata as any).generatedByAi).toBe(true);
    expect((t.metadata as any).difficulty).toBeDefined();
  });

  it('image treatment selects the renderer lane deterministically', () => {
    const embedded = compileTemplateIntent({ ...deriveIntentFromPrompt('bold announcement'), imageTreatment: 'embedded_text' }, opts);
    expect(embedded.renderingContract.writerAssetType).toBe('banner');
    expect(embedded.renderingContract.attachmentMode).toBe('embedded_copy');
    const clean = compileTemplateIntent({ ...deriveIntentFromPrompt('logo only clean visual'), imageTreatment: 'clean_visual' }, opts);
    expect(clean.renderingContract.writerAssetType).toBe('supporting_image');
    expect(clean.renderingContract.attachmentMode).toBe('supporting_visual');
  });

  it('marks recommended fields required', () => {
    const intent = { ...deriveIntentFromPrompt('image template'), recommendedFields: ['headline'] };
    const t = compileTemplateIntent(intent, opts);
    expect(t.formDefinition.fields.find((f) => f.key === 'headline')?.required).toBe(true);
  });

  it('populates sample copy per family so the preview has content', () => {
    expect(compileTemplateIntent(deriveIntentFromPrompt('minimal carousel'), opts).preview.sample.slides?.length).toBeGreaterThan(0);
    expect(compileTemplateIntent(deriveIntentFromPrompt('infographic metrics'), opts).preview.sample.sections?.length).toBeGreaterThan(0);
    expect(compileTemplateIntent(deriveIntentFromPrompt('bold announcement image'), opts).preview.sample.headline).toBeTruthy();
  });

  it('is deterministic — same intent + opts yields an identical template', () => {
    const intent = deriveIntentFromPrompt('Create a minimal thought leadership carousel.');
    expect(JSON.stringify(compileTemplateIntent(intent, opts))).toBe(JSON.stringify(compileTemplateIntent(intent, opts)));
  });

  it('compiled templates flow into the existing preview pipeline', () => {
    const carousel = compileTemplateIntent(deriveIntentFromPrompt('minimal carousel'), opts);
    expect((buildPreviewIntent(carousel) as any).asset_kind).toBe('carousel');
    const infographic = compileTemplateIntent(deriveIntentFromPrompt('infographic metrics'), opts);
    expect((buildPreviewIntent(infographic) as any).media_bundle.metadata.creator_content_asset_type).toBe('infographic');
  });
});

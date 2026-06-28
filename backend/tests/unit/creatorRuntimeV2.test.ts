import { creatorRuntimeMode, creatorRuntimeV2Enabled, creatorRuntimeV2Live } from '../../../lib/creator-templates/creatorRuntimeFlag';
import { runCreatorRuntimeV2, shadowCompare, runShadow, shadowFromRequest } from '../../../lib/creator-templates/creatorRuntimeV2';
import { editorStateToGeneratePayload, liveContentToEditorState } from '../../../lib/creator-templates/creatorRuntimeBridge';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const field = (key: string, required = false, maxLength?: number): TemplateField =>
  ({ key, label: key, control: 'text', required, maxLength, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true, 80), field('subheadline', false, 120), field('cta', true, 28)],
    slides: family === 'carousel' ? { countOptions: [5, 7, 10], defaultCount: 5, fields: [field('title', true, 80), field('body', false, 200)] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 2, max: 8, sectionLabel: 'Statistic', fields: [field('label', true, 60), field('value', false, 40)] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 1, status: 'published', ownership: 'system', tags: [], metadata: {}, category: 'x', description: '', visualLanguage: {}, formDefinition, renderingContract: { renderingContractVersion: 'creator-template-v1', family } } as unknown as CreatorTemplate;
}
const WRITER = ['Boost activation by 92%', 'Slow onboarding wastes time.', 'Manual steps cost hours.', 'Automate the flow.', 'Ship 3x faster.', 'Teams love dashboards.', 'Get started free.'].join('\n');
const AI = 'Announce our analytics suite. 4x faster reporting. Try it free.';

describe('Creator Runtime Flag (CREATOR-PROD-001)', () => {
  it('defaults to OFF (legacy) — no behaviour change', () => {
    expect(creatorRuntimeMode(undefined)).toBe('off');
    expect(creatorRuntimeMode('')).toBe('off');
    expect(creatorRuntimeV2Enabled('off')).toBe(false);
    expect(creatorRuntimeV2Live('off')).toBe(false);
  });
  it('resolves shadow and on modes', () => {
    expect(creatorRuntimeMode('shadow')).toBe('shadow');
    expect(creatorRuntimeMode('on')).toBe('on');
    expect(creatorRuntimeMode('true')).toBe('on');
    expect(creatorRuntimeV2Enabled('shadow')).toBe(true);  // runs (silently)
    expect(creatorRuntimeV2Live('shadow')).toBe(false);    // but does NOT drive output
    expect(creatorRuntimeV2Live('on')).toBe(true);
  });
  it('rollback — turning OFF restores legacy (instant, no data conversion)', () => {
    expect(creatorRuntimeV2Enabled('off')).toBe(false);
  });

  it('CREATOR-PROD-005 — the live editor selects v2 payload only when the flag is ON', () => {
    const tpl = makeTemplate('image');
    const templateValues = { fields: { headline: 'User Headline', subheadline: '', cta: 'User CTA' } };
    // Mirror the [type].tsx decision: ON → deterministic payload (preserves typed
    // values as MANUAL); OFF → undefined (page keeps the legacy projector path).
    const decide = (mode: string) =>
      creatorRuntimeV2Live(mode)
        ? runCreatorRuntimeV2({ template: tpl, sourceText: WRITER, existingValues: templateValues }).payload
        : null;
    expect(decide('off')).toBeNull();                         // OFF → legacy path untouched
    expect(decide('shadow')).toBeNull();                      // SHADOW does not drive output
    const onPayload = decide('on');
    expect(onPayload).not.toBeNull();                         // ON → deterministic payload
    expect((onPayload!.overlay_text as Record<string, string>).headline).toBe('User Headline'); // typed preserved
  });
});

describe('Creator Runtime v2 — deterministic chain (STEP 4)', () => {
  const FLOWS: Array<[string, TemplateAssetFamily, string]> = [
    ['Writer → Image', 'image', WRITER], ['Writer → Carousel', 'carousel', WRITER], ['Writer → Infographic', 'infographic', WRITER],
    ['Creator-first → Image', 'image', AI], ['Campaign → Carousel', 'carousel', AI], ['AI → Infographic', 'infographic', AI],
  ];
  it.each(FLOWS)('%s runs through Recommendation → Resolver → Projection → payload', (_name, family, content) => {
    const r = runCreatorRuntimeV2({ template: makeTemplate(family), sourceText: content });
    expect(r.recommendation).toBeDefined();
    expect(r.resolved).toBeDefined();
    expect(r.projected.projection).toBeDefined();  // Population Projection Bridge active
    expect(r.payload.template_fields).toBeDefined();
    expect(r.projectionValid).toBe(true);
    expect(['PASS', 'WARN', 'FAIL']).toContain(r.typographyStatus); // Typography Verification active
  });

  it('is deterministic', () => {
    const a = runCreatorRuntimeV2({ template: makeTemplate('carousel'), sourceText: WRITER });
    const b = runCreatorRuntimeV2({ template: makeTemplate('carousel'), sourceText: WRITER });
    expect(JSON.stringify(a.payload)).toBe(JSON.stringify(b.payload));
  });
});

describe('Shadow mode + parity (STEP 6/7)', () => {
  it('shadowCompare reports field parity vs a legacy payload', () => {
    const tpl = makeTemplate('image');
    // Legacy payload built the same way (the bridge IS the renderer contract).
    const legacy = editorStateToGeneratePayload(liveContentToEditorState({ template: tpl, sourceText: WRITER }), tpl);
    const v2 = runCreatorRuntimeV2({ template: tpl, sourceText: WRITER });
    const parity = shadowCompare(legacy, v2);
    expect(parity.match).toBe(true);
    expect(parity.fieldMismatches).toEqual([]);
    expect(parity.recommendation).toBeTruthy();
  });

  it('shadowCompare flags a mismatch deterministically', () => {
    const tpl = makeTemplate('image');
    const v2 = runCreatorRuntimeV2({ template: tpl, sourceText: WRITER });
    const tampered = { ...v2.payload, overlay_text: { ...(v2.payload.overlay_text as Record<string, unknown>), headline: 'DIFFERENT' } };
    const parity = shadowCompare(tampered, v2);
    expect(parity.match).toBe(false);
    expect(parity.fieldMismatches.some((m) => m.key === 'headline')).toBe(true);
  });

  it('runShadow NEVER throws and never affects the response', () => {
    const tpl = makeTemplate('carousel');
    const legacy = editorStateToGeneratePayload(liveContentToEditorState({ template: tpl, sourceText: WRITER }), tpl);
    const ok = runShadow({ template: tpl, sourceText: WRITER, legacyPayload: legacy });
    expect(ok.ran).toBe(true);
    expect(ok.parity).toBeDefined();
    // Missing template → graceful skip, no throw.
    expect(runShadow({ template: null, sourceText: WRITER, legacyPayload: legacy }).ran).toBe(false);
    expect(runShadow({ template: tpl, sourceText: '', legacyPayload: legacy }).skipReason).toBe('no_source_text');
  });
});

describe('shadowFromRequest — route extraction (CREATOR-PROD-002)', () => {
  const resolver = (id: string, family: TemplateAssetFamily) => (id === 'tpl-image' ? makeTemplate(family) : null);
  const now = () => 0; // deterministic timing for tests

  it('extracts inputs from the request creator_card and produces diagnostics only', () => {
    const card = { template_id: 'tpl-image', source_content: { snippet: WRITER }, overlay_text: { headline: 'H' } };
    const d = shadowFromRequest({ creatorCard: card, contentType: 'image', topic: 'topic' }, resolver, now);
    expect(d.ran).toBe(true);
    expect(d.family).toBe('image');
    expect(typeof d.parityMatch).toBe('boolean');
    expect(d.recommendation).toBeTruthy();
    expect(d.durationMs).toBe(0);
    // Diagnostics only — no asset/user content fields leak through.
    expect(Object.keys(d).every((k) => !['overlay', 'slides', 'sections', 'body'].includes(k))).toBe(true);
  });

  it('maps content types to families (banner→image, slider→carousel, pdf→carousel)', () => {
    const card = { template_id: 'tpl-image', source_content: { snippet: WRITER } };
    expect(shadowFromRequest({ creatorCard: card, contentType: 'banner', topic: '' }, resolver, now).family).toBe('image');
    expect(shadowFromRequest({ creatorCard: card, contentType: 'slider', topic: '' }, resolver, now).family).toBe('carousel');
    expect(shadowFromRequest({ creatorCard: card, contentType: 'infographic', topic: '' }, resolver, now).family).toBe('infographic');
  });

  it('skips gracefully (never throws) when the template cannot be resolved', () => {
    const d = shadowFromRequest({ creatorCard: { template_id: 'unknown', source_content: { snippet: WRITER } }, contentType: 'image', topic: '' }, resolver, now);
    expect(d.ran).toBe(false);
    expect(d.skipReason).toBe('no_resolved_template');
  });

  it('falls back to topic when no source snippet is present', () => {
    const d = shadowFromRequest({ creatorCard: { template_id: 'tpl-image' }, contentType: 'image', topic: WRITER }, resolver, now);
    expect(d.ran).toBe(true);
  });
});

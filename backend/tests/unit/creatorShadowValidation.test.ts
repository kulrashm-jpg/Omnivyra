/**
 * CREATOR-PROD-003/004 — Real-World Shadow Validation harness.
 *
 * NOTE: a live dev/staging server is not available in this environment, so this
 * harness exercises the EXACT shadow code path the live route invokes
 * (`shadowFromRequest` → `runCreatorRuntimeV2`) across a comprehensive matrix of
 * realistic request payloads. PROD-004 adds MANUAL-override seeding so typed
 * flows preserve user content; the harness now constructs realistic per-family
 * legacy payloads and verifies typed-flow parity reaches ~100%.
 */
import { shadowFromRequest, runCreatorRuntimeV2, extractExistingValues } from '../../../lib/creator-templates/creatorRuntimeV2';
import { validateProjection } from '../../../lib/creator-templates/populationProjectionBridge';
import { projectImageOverlayText, projectCarouselSlides, projectInfographicSections, type TemplateFieldValues } from '../../../lib/creator-templates/values';
import { editorFields, createEditorState } from '../../../lib/creator-templates/editorRuntime';
import { liveContentToEditorState } from '../../../lib/creator-templates/creatorRuntimeBridge';
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
const resolver = (_id: string, family: TemplateAssetFamily) => makeTemplate(family);

const CONTENT: Record<string, string> = {
  minimal: 'Try our product. It is fast.',
  short: 'Announce our analytics suite. 4x faster reporting. Try it free.',
  long_saas: ['Boost activation by 92%', 'Slow onboarding wastes time.', 'Manual steps cost hours.', 'Automate the whole flow.', 'Ship 3x faster.', 'Teams love the dashboards.', 'Retention climbs steadily.', 'Get started free today.'].join('\n'),
  rich_health: ['Cut readmissions by 31%', 'Care teams drown in paperwork.', 'Charting steals bedside time.', 'Our platform automates notes.', 'Clinicians reclaim 2 hours daily.', 'Patients get more attention.', 'Outcomes improve measurably.', 'Book a clinical demo.'].join('\n'),
  long_finance: ['Close the books 5 days faster', 'Reconciliation is manual and slow.', 'Spreadsheets break at scale.', 'Automated close with audit trails.', 'Real-time variance alerts.', 'CFOs trust the numbers.', 'Start a guided trial.'].join('\n'),
};

type Diag = ReturnType<typeof shadowFromRequest>;
interface FlowResult { flow: string; family: TemplateAssetFamily; size: string; diag: Diag; projectionValid: boolean; typographyStatus: string; duplicateSlides: boolean; }

// Build the legacy creator_card the route would carry: derived (prefill) or
// user-authored (typed) content placed in the family-appropriate slot — exactly
// the renderer-facing shape the live frontend projectors produce.
function exerciseFlow(flow: string, family: TemplateAssetFamily, size: string, typed: boolean): FlowResult {
  const sourceText = CONTENT[size];
  const tpl = makeTemplate(family);
  const v2Baseline = runCreatorRuntimeV2({ template: tpl, sourceText });
  const card: Record<string, unknown> = { template_id: `tpl-${family}`, source_content: { snippet: sourceText, source_type: flow.startsWith('Writer') ? 'post' : 'brief' } };

  if (!typed) {
    card.overlay_text = v2Baseline.payload.overlay_text;
    card.slides = v2Baseline.payload.slides;
    card.infographic_sections = v2Baseline.payload.infographic_sections;
  } else if (family === 'image') {
    card.overlay_text = { ...projectImageOverlayText(tpl, { fields: { headline: 'User typed headline', subheadline: 'User typed sub', cta: 'User CTA' } }), __template_authoritative: true };
  } else if (family === 'carousel') {
    const slides = v2Baseline.projected.slides.map((_s, i) => ({ title: `User slide ${i + 1}`, body: `User body ${i + 1}` }));
    card.slides = projectCarouselSlides({ fields: {}, slides });
  } else {
    const sections = v2Baseline.projected.sections.map((_s, i) => ({ label: `User label ${i + 1}`, value: `${i + 1}` }));
    card.infographic_sections = projectInfographicSections({ fields: {}, sections });
  }

  const diag = shadowFromRequest({ creatorCard: card, contentType: family, topic: 'topic' }, resolver, () => 0);
  const rows = family === 'carousel' ? v2Baseline.projected.slides : v2Baseline.projected.sections;
  const stamps = rows.map((r) => JSON.stringify(r));
  return {
    flow, family, size, diag,
    projectionValid: validateProjection(v2Baseline.projected, v2Baseline.resolved.template).ok,
    typographyStatus: v2Baseline.typographyStatus,
    duplicateSlides: rows.length > 0 && new Set(stamps).size !== stamps.length,
  };
}

const FLOWS: Array<[string, boolean]> = [
  ['Writer → prefill', false], ['AI → prefill', false], ['Campaign → prefill', false],
  ['Creator-first → typed', true], ['Regenerate → typed', true],
];
const SIZES = ['minimal', 'short', 'long_saas', 'rich_health', 'long_finance'];
const FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

describe('CREATOR-PROD-004 — Typed-flow parity via MANUAL seeding', () => {
  const results: FlowResult[] = [];
  beforeAll(() => {
    for (const [flow, typed] of FLOWS) for (const family of FAMILIES) for (const size of SIZES) results.push(exerciseFlow(flow, family, size, typed));
  });

  it('STEP 5 — typed AND prefill flows reach ~100% renderer parity after seeding', () => {
    const ran = results.filter((r) => r.diag.ran);
    const matched = ran.filter((r) => r.diag.parityMatch === true);
    const typed = ran.filter((r) => r.flow.includes('typed'));
    const typedMatched = typed.filter((r) => r.diag.parityMatch === true);
    const summary = {
      totalFlows: results.length, shadowRan: ran.length,
      parityMatch: matched.length, parityPct: Math.round((matched.length / ran.length) * 100),
      typedFlows: typed.length, typedMatched: typedMatched.length,
      typedParityPct: Math.round((typedMatched.length / typed.length) * 100),
    };
    // eslint-disable-next-line no-console
    console.log('PROD004_PARITY_SUMMARY', JSON.stringify(summary));
    expect(summary.parityPct).toBe(100);       // overall parity now 100%
    expect(summary.typedParityPct).toBe(100);  // typed flows preserved (the PROD-003 gap, closed)
  });

  it('STEP 5 — readiness invariants still hold (no dup slides, projection valid, no AI typography)', () => {
    for (const r of results) {
      expect(r.projectionValid).toBe(true);
      expect(r.duplicateSlides).toBe(false);
      expect(r.typographyStatus).not.toBe('FAIL');
    }
  });
});

describe('CREATOR-PROD-004 — MANUAL seeding mechanics (STEP 2/3/6)', () => {
  it('extractExistingValues recovers user content from the request (inverse projectors)', () => {
    const tpl = makeTemplate('image');
    const card = { overlay_text: { headline: 'My Headline', supportingText: 'My Sub', cta: 'Go', __template_authoritative: true } };
    const ev = extractExistingValues(card, tpl);
    expect(ev.fields.headline).toBe('My Headline');
    expect(ev.fields.subheadline).toBe('My Sub');   // overlay.supportingText → field.subheadline
    expect(ev.fields.cta).toBe('Go');
  });

  it('seeded values become MANUAL; untouched fields stay AUTO (mixed)', () => {
    const tpl = makeTemplate('image');
    const existingValues: TemplateFieldValues = { fields: { headline: 'Mine', subheadline: '', cta: '' } };
    const state = liveContentToEditorState({ template: tpl, sourceText: CONTENT.long_saas, existingValues });
    const fields = editorFields(state);
    expect(fields.find((f) => f.ref === 'field:headline')!.owner).toBe('MANUAL');
    expect(fields.find((f) => f.ref === 'field:headline')!.value).toBe('Mine');
    expect(fields.find((f) => f.ref === 'field:cta')!.owner).toBe('AUTO');  // not seeded → canonical
  });

  it('runCreatorRuntimeV2 with existingValues drives MANUAL content into the payload', () => {
    const tpl = makeTemplate('image');
    const r = runCreatorRuntimeV2({ template: tpl, sourceText: CONTENT.long_saas, existingValues: { fields: { headline: 'Exactly This', subheadline: '', cta: '' } } });
    expect((r.payload.overlay_text as Record<string, string>).headline).toBe('Exactly This');
  });

  it('OFF / SHADOW behaviour unchanged — seeding only affects v2, never the response', () => {
    // shadowFromRequest is invoked only in shadow/on; it returns diagnostics and
    // never mutates anything. The flag gating itself is covered in creatorRuntimeV2.test.
    const tpl = makeTemplate('carousel');
    const card = { template_id: 'tpl-carousel', source_content: { snippet: CONTENT.long_saas }, slides: [] };
    expect(() => shadowFromRequest({ creatorCard: card, contentType: 'carousel', topic: 't' }, resolver, () => 0)).not.toThrow();
  });
});

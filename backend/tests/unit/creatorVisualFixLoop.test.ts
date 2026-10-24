/**
 * PR4 — bounded AI fix-and-re-render loop + publish-gate honesty.
 *
 *   A  validator sees text_fit / manifest contrast; typography is not shortenable
 *   B  fix steps: only flagged fields shortened; headline + CTA never dropped
 *   C  the loop (fake dispatch): pass stop, max attempts, escalation, no-improvement,
 *      provider reuse wiring, render_manifest_rejected retry/rethrow, disclosure
 *   D  real renderAsset: the provider image generator runs ONCE across attempts
 *   E  publish gate: missing verdict with media ⇒ not ready; fresh verdict wins;
 *      fan-out assets carry their own verdict; async merge refreshes the report
 */

jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return { ...actual, config: { ...actual.config, OPENAI_API_KEY: 'test-openai-key' } };
});
let uploads: Buffer[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: {
  listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
  updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
  from: () => ({ upload: async (_p: string, b: Buffer) => { uploads.push(b); return { error: null }; },
    getPublicUrl: () => ({ data: { publicUrl: 'http://l/x.png' } }), createSignedUrl: async () => ({ data: { signedUrl: 'http://l/x.png' }, error: null }) }) } } }));
jest.mock('../../services/creatorOcrProvider', () => ({ runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'm', text: '', regions: [], thresholds: { minConfidence: 0 } }), isLightweightSocialEmbeddedCopy: () => true }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: async () => undefined }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: () => undefined }));
const providerCalls: unknown[] = [];
let providerReturnsImage = true;
jest.mock('../../services/creatorAssetRendererMedia', () => {
  const actual = jest.requireActual('../../services/creatorAssetRendererMedia');
  return {
    ...actual,
    generateProviderImage: jest.fn(async (input: unknown) => {
      providerCalls.push(input);
      if (!providerReturnsImage) return { image: null, fallbackReason: 'provider_down' };
      return { image: { buffer: (globalThis as { __providerPng?: Buffer }).__providerPng as Buffer, model: 'mock-image-model' } };
    }),
  };
});

import sharp from 'sharp';
import * as visualValidation from '../../services/creator/creatorVisualValidation';
import { validateCreatorVisual, describeVisualFailure, type VisualVerdict } from '../../services/creator/creatorVisualValidation';
import {
  applyFixStep,
  resolveMaxFixAttempts,
  runVisualFixLoop,
  MAX_FIX_ATTEMPTS,
} from '../../services/creator/creatorVisualFixLoop';
import type { RenderOptions, RenderedMediaBundle } from '../../services/creatorAssetRendererContracts';
import { buildCreatorDiagnosticReport } from '../../services/creator/creatorDiagnosticReport';
import { creatorResultToPackageAssets, buildCreatorCampaignPackage } from '../../../lib/creator-templates/creatorPackageBridge';
import { buildCampaignPackage, type PackageAsset } from '../../../lib/creator-templates/campaignPackage';
import { mergeRenderedCreatorResult } from '../../../lib/creator-content/creatorRenderedResult';
import type { CreatorResult } from '../../../lib/creator-content/creatorWorkflowModel';

type Rec = Record<string, unknown>;

/* ── A. validator ─────────────────────────────────────────────────────── */

describe('A. validator sees the failures it used to miss', () => {
  it('text_fit.ok=false → text_fit failures per field, slide prefix kept', () => {
    const v = validateCreatorVisual({ text_fit: { ok: false, overflowFields: ['slide_2:headline', 'keyInsight'] } });
    expect(v.passed).toBe(false);
    const fit = v.failures.filter((f) => f.category === 'text_fit');
    expect(fit.map((f) => f.field)).toEqual(['slide_2:headline', 'keyInsight']);
    expect(fit[0].slide).toBe(2);
    expect(v.repairHint).toBe('shorten_text');
    expect(describeVisualFailure(fit[0])).toBe('Headline does not fit its area (slide 2)');
  });

  it('text_fit.ok=true → no failure', () => {
    expect(validateCreatorVisual({ text_fit: { ok: true, overflowFields: [] } }).passed).toBe(true);
  });

  it('reads validation_manifest.geometry.contrastRatio', () => {
    const v = validateCreatorVisual({ validation_manifest: { geometry: { contrastRatio: 2.1 } } });
    expect(v.failures.map((f) => f.category)).toEqual(['contrast']);
    expect(v.repairHint).toBeNull();
  });

  it('typography is NOT shortenable', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: ['headline_likely_unreadable_mobile'], score: 80 } });
    expect(v.failures.map((f) => f.category)).toEqual(['typography']);
    expect(v.repairHint).toBeNull();
  });
});

/* ── B. fix steps ─────────────────────────────────────────────────────── */

const LONG_HEADLINE = 'A very long headline that keeps going well past the space the layout has for it';
const LONG_INSIGHT = 'An insight sentence that is long enough to overflow the box it is placed in. And a second sentence too.';
function imagePayload(): Rec {
  const overlay = {
    hook: 'Hook line for the asset',
    headline: LONG_HEADLINE,
    keyInsight: LONG_INSIGHT,
    supportingText: 'Supporting text that adds detail to the main message here',
    cta: 'Book a demo',
  };
  return {
    asset_kind: 'image',
    color_palette: ['#0F172A', '#2F80ED', '#14B8A6'],
    visual_descriptor: { headline: 'A clear product headline', visual_description: 'desc' },
    overlay_text: { ...overlay },
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'image', topic: 'Topic', summary: 'Sum', overlay_text: { ...overlay } } },
  };
}
const overlayOf = (p: Rec) => p.overlay_text as Rec;
const metaOverlayOf = (p: Rec) => ((p.media_bundle as Rec).metadata as Rec).overlay_text as Rec;

describe('B. fix steps', () => {
  it('shortens ONLY the flagged field (word boundary), both overlay copies', () => {
    const p = imagePayload();
    const r = applyFixStep(p, 'shorten_flagged_fields', [{ category: 'text_fit', flag: 'text_fit_overflow', field: 'keyInsight' }]);
    expect(r.changed).toBe(true);
    expect(overlayOf(r.payload).keyInsight).not.toBe(LONG_INSIGHT);
    expect(LONG_INSIGHT.startsWith(String(overlayOf(r.payload).keyInsight).replace(/[.]$/, ''))).toBe(true);
    expect(metaOverlayOf(r.payload).keyInsight).toBe(overlayOf(r.payload).keyInsight);
    expect(overlayOf(r.payload).headline).toBe(LONG_HEADLINE);
    expect(overlayOf(r.payload).supportingText).toBe(overlayOf(p).supportingText);
    expect(overlayOf(r.payload).cta).toBe('Book a demo');
    expect(overlayOf(p).keyInsight).toBe(LONG_INSIGHT); // pure — input untouched
  });

  it('a slide_N:headline overflow shortens only that slide headline', () => {
    const slides = [
      { headline: 'Short one', body_text: 'Body one is fine.' },
      { headline: 'This second slide headline is far too long to fit on one slide', body_text: 'Body two.' },
    ];
    const r = applyFixStep({ asset_kind: 'carousel', slides }, 'shorten_flagged_fields',
      [{ category: 'text_fit', flag: 'text_fit_overflow', field: 'slide_2:headline', slide: 2 }]);
    const out = (r.payload.slides as Rec[]);
    expect(out[0]).toEqual(slides[0]);
    expect(String(out[1].headline).length).toBeLessThan(slides[1].headline.length);
    expect(out[1].body_text).toBe('Body two.');
  });

  it('headline and CTA are never dropped by any step', () => {
    let p = imagePayload();
    for (const step of ['drop_keyInsight', 'drop_supportingText', 'drop_hook', 'compact_preset'] as const) {
      p = applyFixStep(p, step, []).payload;
    }
    expect(overlayOf(p)).toMatchObject({ headline: LONG_HEADLINE, cta: 'Book a demo', keyInsight: '', supportingText: '', hook: '' });
    expect(metaOverlayOf(p)).toMatchObject({ headline: LONG_HEADLINE, cta: 'Book a demo' });
  });

  it('compact_preset is unavailable → never changes the payload', () => {
    expect(applyFixStep(imagePayload(), 'compact_preset', []).changed).toBe(false);
  });
});

/* ── C. loop ──────────────────────────────────────────────────────────── */

const fail = (n: number): Rec => ({
  overlay_quality: { flags: [], score: 80 },
  text_fit: { ok: false, overflowFields: ['headline', 'keyInsight', 'supportingText', 'hook'].slice(0, n) },
});
const passMeta: Rec = { overlay_quality: { flags: [], score: 90 }, text_fit: { ok: true, overflowFields: [] } };

function fakeDispatch(sequence: Array<Rec | Error>) {
  const calls: Array<{ payload: Rec; options: RenderOptions }> = [];
  const dispatch = async (payload: Rec, options: RenderOptions): Promise<RenderedMediaBundle> => {
    const i = calls.length;
    calls.push({ payload, options });
    if (i === 0 && typeof options.captureProviderImage === 'function') {
      options.captureProviderImage({ buffer: Buffer.from('IMG'), model: 'm' });
    }
    const step = sequence[Math.min(i, sequence.length - 1)];
    if (step instanceof Error) throw step;
    return { url: `http://render/${i}`, metadata: { ...step } };
  };
  return { calls, dispatch };
}
const validate = (m: Rec, ct?: string): VisualVerdict => validateCreatorVisual(m, ct);
const repairOf = (b: RenderedMediaBundle) => ((b.metadata as Rec).visual_validation as Rec).repair as Rec;

describe('C. bounded fix loop', () => {
  it('first render passes → one dispatch, no repair disclosure', async () => {
    const { calls, dispatch } = fakeDispatch([passMeta]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(1);
    expect((out.metadata as Rec).visual_validation).toMatchObject({ passed: true });
    expect(repairOf(out)).toBeUndefined();
  });

  it('stops as soon as the verdict passes; discloses the repair on OUTPUT metadata', async () => {
    const { calls, dispatch } = fakeDispatch([fail(1), passMeta]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(2);
    expect(out.url).toBe('http://render/1');
    const repair = repairOf(out);
    expect(repair).toMatchObject({ attempts: 1, providerImageReused: true, remaining: [], stopReason: 'passed' });
    expect((repair.steps as string[])[0]).toMatch(/^shorten_flagged_fields:headline/);
    expect(repair.resolved).toEqual(['Headline does not fit its area']);
  });

  it('respects max attempts (default 3; env clamps 0..3)', async () => {
    const { calls, dispatch } = fakeDispatch([fail(4), fail(3), fail(2), fail(1), passMeta]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(1 + MAX_FIX_ATTEMPTS);
    const repair = repairOf(out);
    expect(repair.attempts).toBe(3);
    expect(repair.stopReason).toBe('max_attempts');
    expect((repair.remaining as unknown[]).length).toBe(1);
    expect(resolveMaxFixAttempts({ CREATOR_VISUAL_FIX_MAX_ATTEMPTS: '9' })).toBe(3);
    expect(resolveMaxFixAttempts({ CREATOR_VISUAL_FIX_MAX_ATTEMPTS: '-2' })).toBe(0);
    expect(resolveMaxFixAttempts({ CREATOR_VISUAL_FIX_MAX_ATTEMPTS: 'x' })).toBe(3);
    expect(resolveMaxFixAttempts({ CREATOR_VISUAL_FIX_MAX_ATTEMPTS: '1' })).toBe(1);
    expect(resolveMaxFixAttempts({})).toBe(3);
  });

  it('max attempts 0 → no re-render, failure disclosed', async () => {
    const { calls, dispatch } = fakeDispatch([fail(2)]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate, maxAttempts: 0 });
    expect(calls).toHaveLength(1);
    expect(repairOf(out)).toMatchObject({ attempts: 0, stopReason: 'disabled', providerImageReused: false });
  });

  it('escalates one step per attempt: shorten → drop keyInsight → drop supportingText; never headline/CTA', async () => {
    const { calls, dispatch } = fakeDispatch([fail(4), fail(3), fail(2), fail(1)]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    const steps = repairOf(out).steps as string[];
    expect(steps.map((s) => s.split(':')[0])).toEqual(['shorten_flagged_fields', 'drop_keyInsight', 'drop_supportingText']);
    expect(overlayOf(calls[2].payload).keyInsight).toBe('');
    expect(overlayOf(calls[3].payload).supportingText).toBe('');
    for (const c of calls) {
      expect(String(overlayOf(c.payload).headline).length).toBeGreaterThan(0);
      expect(overlayOf(c.payload).cta).toBe('Book a demo');
      expect(metaOverlayOf(c.payload).cta).toBe('Book a demo');
    }
  });

  it('stops when failures stop decreasing and keeps the best attempt', async () => {
    const { calls, dispatch } = fakeDispatch([fail(2), fail(2), fail(1)]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(2);
    expect(out.url).toBe('http://render/0');
    expect(repairOf(out)).toMatchObject({ attempts: 1, stopReason: 'no_improvement' });
  });

  it('typography-only failure is not retried (shortening cannot fix it)', async () => {
    const { calls, dispatch } = fakeDispatch([{ overlay_quality: { flags: ['headline_likely_unreadable_mobile'], score: 80 } }]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(1);
    const repair = repairOf(out);
    expect(repair).toMatchObject({ attempts: 0, stopReason: 'no_fixable_failures' });
    expect((repair.remaining as Array<{ category: string }>)[0].category).toBe('typography');
  });

  it('retries reuse the captured provider image and skip copy enrichment', async () => {
    const { calls, dispatch } = fakeDispatch([fail(2), fail(1), passMeta]);
    await runVisualFixLoop(imagePayload(), { companyId: 'co' }, 'image', { dispatch, validate });
    expect(calls[0].options.reuseProviderImage ?? null).toBeNull();
    for (const c of calls.slice(1)) {
      expect(c.options.reuseProviderImage?.buffer.toString()).toBe('IMG');
      expect(c.options.skipInfographicCopyEnrichment).toBe(true);
      expect(c.options.captureProviderImage ?? null).toBeNull();
      expect(c.options.companyId).toBe('co');
    }
  });

  it('no captured provider image → retries render WITHOUT the provider (noProviderImage)', async () => {
    const calls: RenderOptions[] = [];
    const seq = [fail(2), passMeta];
    const dispatch = async (_p: Rec, o: RenderOptions) => { calls.push(o); return { metadata: { ...seq[Math.min(calls.length - 1, 1)] } }; };
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls[1].noProviderImage).toBe(true);
    expect(calls[1].reuseProviderImage ?? null).toBeNull();
    expect(repairOf(out).providerImageReused).toBe(false);
  });

  it('render_manifest_rejected is caught and retried with the next fix step', async () => {
    const rejected = new Error('governed_render_failed_closed:render_manifest_rejected:paragraph_overlay_forbidden');
    const { calls, dispatch } = fakeDispatch([rejected, passMeta]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate });
    expect(calls).toHaveLength(2);
    expect(repairOf(out)).toMatchObject({ attempts: 1, stopReason: 'passed' });
    expect((repairOf(out).resolved as string[])[0]).toContain('paragraph_overlay_forbidden');
  });

  it('all attempts rejected → the ORIGINAL error is rethrown', async () => {
    const original = new Error('governed_render_failed_closed:render_manifest_rejected:paragraph_overlay_forbidden');
    const later = new Error('governed_render_failed_closed:render_manifest_rejected:text_density_exceeds_profile');
    const { calls, dispatch } = fakeDispatch([original, later]);
    await expect(runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate })).rejects.toBe(original);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(1 + MAX_FIX_ATTEMPTS);
  });

  it('a rejection that needs a NEW AI image is not retried', async () => {
    const original = new Error('governed_render_failed_closed:render_manifest_rejected:provider_non_english_or_fake_glyphs');
    const { calls, dispatch } = fakeDispatch([original, passMeta]);
    await expect(runVisualFixLoop(imagePayload(), {}, 'image', { dispatch, validate })).rejects.toBe(original);
    expect(calls).toHaveLength(1);
  });

  it('honours the time budget', async () => {
    let t = 0;
    const { calls, dispatch } = fakeDispatch([fail(3), fail(2), fail(1)]);
    const out = await runVisualFixLoop(imagePayload(), {}, 'image', {
      dispatch, validate, timeBudgetMs: 1000, now: () => { t += 600; return t; },
    });
    expect(calls).toHaveLength(2);
    expect(repairOf(out).stopReason).toBe('time_budget');
  });
});

/* ── D. real renderAsset ──────────────────────────────────────────────── */

describe('D. renderAsset: the paid provider image is generated once across all attempts', () => {
  beforeAll(async () => {
    (globalThis as { __providerPng?: Buffer }).__providerPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#334155' } }).png().toBuffer();
  });
  afterEach(() => { jest.restoreAllMocks(); providerReturnsImage = true; });

  function forceVerdicts(sequence: Rec[]) {
    let n = 0;
    const real = visualValidation.validateCreatorVisual;
    return jest.spyOn(visualValidation, 'validateCreatorVisual').mockImplementation((meta, ct) => {
      const forced = sequence[n++];
      return forced ? real(forced, ct) : real(meta, ct);
    });
  }

  it('re-renders twice, provider called ONCE, repair on output metadata, no buffer in metadata', async () => {
    providerCalls.length = 0; uploads = [];
    forceVerdicts([fail(2), fail(1), passMeta]);
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const out = await renderAsset(imagePayload(), { companyId: 'co', userId: 'u', campaignId: 'c' });
    expect(providerCalls).toHaveLength(1);
    expect(uploads).toHaveLength(3);
    const meta = out.metadata as Rec;
    expect((meta.visual_validation as Rec).passed).toBe(true);
    expect((meta.visual_validation as Rec).repair).toMatchObject({ attempts: 2, providerImageReused: true });
    expect(meta.provider_model).toBe('mock-image-model');
    const hasBuffer = (v: unknown, depth = 0): boolean => {
      if (Buffer.isBuffer(v)) return true;
      if (!v || typeof v !== 'object' || depth > 6) return false;
      return Object.values(v as Rec).some((x) => hasBuffer(x, depth + 1));
    };
    expect(hasBuffer(meta)).toBe(false);
    // The diagnostic report reads the disclosure from the OUTPUT metadata.
    const report = buildCreatorDiagnosticReport({ assetType: 'image', renderMetadata: meta });
    expect(report.repair).toMatchObject({ reRendered: true, attempts: 2 });
  }, 60000);

  it('provider returned no image → retries do not call the provider again', async () => {
    providerCalls.length = 0; uploads = [];
    providerReturnsImage = false;
    forceVerdicts([fail(2), passMeta]);
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const out = await renderAsset(imagePayload(), { companyId: 'co' });
    expect(providerCalls).toHaveLength(1);
    expect(((out.metadata as Rec).visual_validation as Rec).repair).toMatchObject({ attempts: 1, providerImageReused: false });
  }, 60000);
});

/* ── E. publish gate ──────────────────────────────────────────────────── */

const ctx = {
  templateName: 'Hero', templateId: 'sys-image-hero', assetFamily: 'image',
  selectedPlatform: 'linkedin',
  campaign: { name: 'Launch', objective: 'Awareness', audience: 'Founders', platforms: ['linkedin'] },
  edited: false, regenerations: 0, inProgress: false,
};
function result(meta: Rec, extra: Rec = {}): Rec {
  return {
    success: true, primary_platform: 'linkedin', persisted_asset_id: 'asset-1',
    output: {
      asset_type: 'image',
      packaging: { caption: 'Cap', cta: 'Learn more' },
      asset_payload: { media_bundle: { url: 'https://cdn/x.png', files: ['https://cdn/x.png'], metadata: meta } },
    },
    ...extra,
  };
}
const failingVerdict = { passed: false, failures: [{ category: 'text_fit', flag: 'text_fit_overflow', field: 'headline' }] };

describe('E. publish gate honesty', () => {
  it('media but NO verdict ⇒ not assessed ⇒ not ready', () => {
    const r = result({});
    const [a] = creatorResultToPackageAssets(r, ctx);
    expect(a.visualAssessed).toBe(false);
    const pkg = buildCreatorCampaignPackage(r, ctx);
    expect(pkg.readyForPublishing).toBe(false);
    expect(pkg.readyForScheduling).toBe(false);
    expect(pkg.publishBlockedReasons.join(' ')).toMatch(/not visually checked/);
    expect(pkg.publishingNotes[1]).toMatch(/^0 assets ready; 1 needs fixes/);
  });

  it('a report that never assessed anything does not count as a pass', () => {
    const report = buildCreatorDiagnosticReport({ assetType: 'image', renderMetadata: {} });
    expect(report.visualValidation.assessed).toBe(false);
    const pkg = buildCreatorCampaignPackage(result({ creator_diagnostic_report: report }), ctx);
    expect(pkg.readyForPublishing).toBe(false);
  });

  it('the fresh render verdict wins over the (stale) report verdict', () => {
    const staleReport = { visualValidation: { passed: true, failures: [] } };
    const [a] = creatorResultToPackageAssets(result({ visual_validation: failingVerdict, creator_diagnostic_report: staleReport }), ctx);
    expect(a.visualPassed).toBe(false);
    expect(a.visualIssues).toEqual(['Headline does not fit its area']);
    const [b] = creatorResultToPackageAssets(result({ visual_validation: { passed: true, failures: [] }, creator_diagnostic_report: { visualValidation: failingVerdict } }), ctx);
    expect(b.visualPassed).toBe(true);
    expect(buildCreatorCampaignPackage(result({ visual_validation: { passed: true, failures: [] } }), ctx).readyForPublishing).toBe(true);
  });

  it('fan-out assets carry their own verdict; a completed one without a verdict is not assessed', () => {
    const r = result({ visual_validation: { passed: true, failures: [] } }, { generated_assets: [
      { ok: true, persisted_asset_id: 'asset-1', variant_family: 'a' },
      { ok: true, persisted_asset_id: 'asset-2', variant_family: 'b', visual_validation: failingVerdict },
      { ok: true, persisted_asset_id: 'asset-3', variant_family: 'c' },
    ] });
    const assets = creatorResultToPackageAssets(r, ctx);
    expect(assets.map((a) => [a.visualPassed, a.visualAssessed])).toEqual([[true, true], [false, true], [null, false]]);
    const pkg = buildCreatorCampaignPackage(r, ctx);
    expect(pkg.readyForPublishing).toBe(false);
    expect(pkg.publishingNotes[1]).toMatch(/^1 asset ready; 2 need fixes/);
  });

  it('"N assets ready" counts only passing assets; legacy assets without gate signals still count', () => {
    const base: PackageAsset = { id: 'x', assetType: 'image', template: 't', templateId: 't', variant: null, platform: 'linkedin', cta: 'Go', branding: null, status: 'completed', previewUrl: null, url: null, files: [], caption: null, generatedAt: null };
    const pkg = buildCampaignPackage({ campaign: { platforms: ['linkedin'] }, assets: [base, { ...base, id: 'y', visualPassed: false, visualIssues: ['x'] }] });
    expect(pkg.publishingNotes.some((n) => n.startsWith('1 asset ready; 1 needs fixes'))).toBe(true);
  });

  it('async completion refreshes the stale report from the fresh verdict', () => {
    const staleReport = buildCreatorDiagnosticReport({ assetType: 'image', renderMetadata: {} });
    const current = {
      success: true, primary_platform: 'linkedin',
      output: { asset_type: 'image', asset_instruction: {}, packaging: { caption: '', hashtags: [], cta: '', meta_description: '' },
        asset_payload: { media_bundle: { metadata: { render_async: true, creator_diagnostic_report: staleReport } } } },
    } as unknown as CreatorResult;
    const merged = mergeRenderedCreatorResult(current, current, { url: 'https://cdn/y.png', metadata: { visual_validation: failingVerdict } });
    const meta = merged!.output.asset_payload.media_bundle!.metadata as Rec;
    const report = meta.creator_diagnostic_report as ReturnType<typeof buildCreatorDiagnosticReport>;
    expect(report.visualValidation).toMatchObject({ passed: false, assessed: true });
    expect(report.scores.overallReadiness.value).toBeLessThan(60);
    const pkg = buildCreatorCampaignPackage(merged, ctx);
    expect(pkg.readyForPublishing).toBe(false);
  });
});

/**
 * Independent mode uses the look's colours, or open experimentation (owner
 * request 2026-10-25), plus the #336 leftovers.
 *
 *   A  palette mode: brand-aware → 'brand'; independent → 'look' (default) or
 *      'experimental'; carried from the editor payload onto render metadata
 *   B  image prompt: 'look' → the look palette is authoritative and no brand
 *      colour appears; 'experimental' → fresh-palette instruction + a seeded
 *      palette direction recorded in novelty.picks; brand-aware unchanged
 *   C  carousel / infographic colours follow the mode (seed-pinned), with the
 *      contrast-safe accent fallback
 *   D  payload `palette_mode`
 *   E  avoid-recent picks: avoidance, fail-open, tenant-scoped query
 *   F  pixel-art is a registered look
 *
 * No real provider or database: the OpenAI SDK, storage and the owned DB seam
 * are mocked in memory.
 */
const dbCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
let dbRows: unknown[] = [];

jest.mock('@/config', () => ({ config: { OPENAI_API_KEY: 'test-key' }, getValidatedConfig: () => ({}) }));
jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return { ...actual, config: { ...actual.config, OPENAI_API_KEY: 'test-key' } };
});
jest.mock('openai', () => {
  class FakeOpenAI {
    images = {
      edit: async () => ({ data: [{ b64_json: (globalThis as { __png?: Buffer }).__png!.toString('base64') }] }),
      generate: async () => ({ data: [{ b64_json: (globalThis as { __png?: Buffer }).__png!.toString('base64') }] }),
    };
  }
  return { __esModule: true, default: FakeOpenAI, toFile: async (bytes: Buffer, filename: string, opts: { type: string }) => ({ filename, type: opts.type, bytes }) };
});
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: {
  listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
  updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
  from: () => ({ upload: async () => ({ error: null }),
    getPublicUrl: () => ({ data: { publicUrl: 'http://l/x.png' } }), createSignedUrl: async () => ({ data: { signedUrl: 'http://l/x.png' }, error: null }) }) } } }));
// The owned DB seam: a recording, chainable, thenable query builder.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call = { table, ops: [] as Array<[string, unknown[]]> };
    dbCalls.push(call);
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit', 'in', 'not', 'insert', 'update', 'upsert', 'maybeSingle', 'single']) {
      builder[op] = (...args: unknown[]) => { call.ops.push([op, args]); return builder; };
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: dbRows, error: null });
    return builder;
  },
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../services/creatorOcrProvider', () => ({ runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'm', text: '', regions: [], thresholds: { minConfidence: 0 } }), isLightweightSocialEmbeddedCopy: () => true }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: async () => undefined }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: () => undefined }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({ composeInfographicCopy: async (input: any) => ({
  ok: true, narrative: 'N.', cta: input.cta || 'Learn more',
  sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({ title, lead: `Lead ${i + 1}.`, bullets: ['One point', 'Two point'], stat: null, example: null, take: null, impact: null, risk: null, generated: true })),
}) }));

import * as fs from 'fs';
import * as path from 'path';
import { paletteModeFor } from '../../../lib/creator-content/creatorPaletteMode';
import {
  resolveRenderPaletteMode, resolveIndependentPalette, applyIndependentPaletteToBrandKit,
  experimentalPalette, darkenForWhiteText,
} from '../../services/creator/creatorPaletteMode';
import { buildNoveltyPlan, PALETTE_DIRECTIONS, PALETTE_DIRECTION_PHRASE } from '../../services/creator/creatorNoveltyPlan';
import { loadRecentNoveltyPicks, attachRecentNoveltyAvoid } from '../../services/creator/creatorNoveltyRecentPicks';
import { buildCreatorLookRenderMetadata } from '../../services/creator/creatorLookRenderMetadata';
import { composeCreatorImagePrompt, type CreatorPromptInput } from '../../services/creator/creatorPromptComposer';
import { buildAiImagePrompt } from '../../services/creatorAssetRendererSvg';
import { contrastRatio, resolveCreatorBrandKit } from '../../services/creatorBrandKit';
import { getVisualStyle, VISUAL_STYLES } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { getBlueprint, VISUAL_BLUEPRINTS } from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';
import { listVisualDirections } from '../../../lib/content/guidedCreativeDirection';
import { buildCreatorGenerationBody } from '../../../lib/creator-content/creatorSuggestionAndPayload';
import { getTemplateById } from '../../../lib/creator-templates';
import { WORKFLOW_CONFIG } from '../../../lib/creator-content/creatorWorkflowConfig';
import sharp from 'sharp';

type Rec = Record<string, unknown>;
const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const BRAND_PALETTE = ['#123456', '#654321', '#13579b'];
const BRAND_ACCENT = '#abcdef';

/** The editor's creator_card, as the execution engine projects it onto render metadata. */
function card(lookId: string | null, brandMode: string, paletteMode?: string): Rec {
  return {
    subtype: 'promotional-image',
    brand_generation_mode: brandMode,
    ...(paletteMode ? { palette_mode: paletteMode } : {}),
    ...(lookId ? { guided_creative: { visual_direction_id: lookId, subject: null, visual_instruction: null } } : {}),
  };
}
function renderMetadata(c: Rec, extra: Rec = {}): Rec {
  return {
    topic: 'Launch week', summary: 'Ship faster', content_type: 'image', platform: 'linkedin', creator_content_asset_type: 'image',
    brand_kit: { companyName: 'Acme', palette: BRAND_PALETTE, accentColor: BRAND_ACCENT, tone: 'bold' },
    ...buildCreatorLookRenderMetadata(c), ...extra,
  };
}
function promptFor(metadata: Rec, assetPayload: Rec = { color_palette: BRAND_PALETTE }): string {
  return buildAiImagePrompt({ title: 'Launch week', body: 'Ship faster with fewer meetings.', eyebrow: 'image', metadata, assetPayload, attachmentMode: 'embedded_copy' });
}
const noveltyOf = (assetPayload: Rec) => ((assetPayload.media_bundle as Rec).metadata as Rec).novelty as Rec;

beforeAll(async () => {
  (globalThis as { __png?: Buffer }).__png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).png().toBuffer();
});
beforeEach(() => { dbCalls.length = 0; dbRows = []; });

/* ── A ─────────────────────────────────────────────────────────────────── */

describe('A — palette mode', () => {
  it('brand-aware → brand; independent → look by default, experimental when chosen', () => {
    expect(paletteModeFor('brand-aware', 'experimental')).toBe('brand');
    expect(paletteModeFor('independent', null)).toBe('look');
    expect(paletteModeFor('independent', 'look')).toBe('look');
    expect(paletteModeFor('independent', 'experimental')).toBe('experimental');
    expect(paletteModeFor('independent', 'bogus')).toBe('look');
    // Anything that is not an explicit Independent keeps today's behaviour.
    expect(paletteModeFor('neutral', 'experimental')).toBe('brand');
    expect(paletteModeFor(null, 'experimental')).toBe('brand');
  });

  it('the editor\'s brand_generation_mode + palette_mode now reach render metadata', () => {
    const meta = buildCreatorLookRenderMetadata(card('comic', 'independent', 'experimental'));
    expect(meta.creator_card).toEqual(expect.objectContaining({ brand_generation_mode: 'independent', palette_mode: 'experimental' }));
    expect(resolveRenderPaletteMode(meta)).toBe('experimental');
    expect(resolveRenderPaletteMode(buildCreatorLookRenderMetadata(card('comic', 'independent')))).toBe('look');
    expect(resolveRenderPaletteMode(buildCreatorLookRenderMetadata(card('comic', 'brand-aware', 'experimental')))).toBe('brand');
  });
});

/* ── B ─────────────────────────────────────────────────────────────────── */

describe('B — image prompt', () => {
  it('CRITICAL: independent + look → the look palette leads and NO brand colour appears', () => {
    const comic = getVisualStyle('comic')!;
    const p = promptFor(renderMetadata(card('comic', 'independent'), { novelty_seed: 's1' }));
    expect(p).toContain(`Look palette (dominant colours): ${comic.palette.join(', ')}.`);
    for (const c of [...BRAND_PALETTE, BRAND_ACCENT]) expect(p.toLowerCase()).not.toContain(c);
    expect(p).not.toMatch(/Brand palette|Brand accent color|brand colours appear/i);
    expect(p).toContain('Colour follows the look palette.');
  });

  it('CRITICAL: independent + a photographic look → its palette is stated (it was not before) and no brand palette', () => {
    const style = getVisualStyle('lifestyle')!;
    const p = promptFor(renderMetadata(card('lifestyle', 'independent'), { novelty_seed: 's1' }));
    expect(p).toContain(`Look palette (dominant colours, authoritative): ${style.palette.join(', ')}.`);
    for (const c of BRAND_PALETTE) expect(p.toLowerCase()).not.toContain(c);
  });

  it('CRITICAL: experimental → fresh-palette instruction replaces the look palette; seeded direction recorded in novelty.picks', () => {
    const a: Rec = {};
    const p = promptFor(renderMetadata(card('comic', 'independent', 'experimental'), { novelty_seed: 'exp-1' }), { ...a, color_palette: BRAND_PALETTE });
    expect(p).toContain('choose a fresh, harmonious palette suited to');
    expect(p).toContain("It may depart from any reference image's colours");
    expect(p).not.toContain('Look palette (dominant colours)');
    for (const c of BRAND_PALETTE) expect(p.toLowerCase()).not.toContain(c);
    const payload: Rec = { color_palette: BRAND_PALETTE };
    promptFor(renderMetadata(card('comic', 'independent', 'experimental'), { novelty_seed: 'exp-1' }), payload);
    const pick = (noveltyOf(payload).picks as Rec).palette as string;
    expect(PALETTE_DIRECTIONS).toContain(pick);
    expect(p).toContain(PALETTE_DIRECTION_PHRASE[pick as keyof typeof PALETTE_DIRECTION_PHRASE]);
    expect(((payload.media_bundle as Rec).metadata as Rec).palette_mode).toBe('experimental');
    // Seed-pinned: same seed → same pick; the pick varies across seeds.
    const again: Rec = { color_palette: BRAND_PALETTE };
    promptFor(renderMetadata(card('comic', 'independent', 'experimental'), { novelty_seed: 'exp-1' }), again);
    expect((noveltyOf(again).picks as Rec).palette).toBe(pick);
    const picks = new Set<string>();
    for (let i = 0; i < 20; i += 1) picks.add(buildNoveltyPlan({ seed: `s-${i}`, lookId: 'comic', paletteMode: 'experimental' }).picks.palette!);
    expect(picks.size).toBeGreaterThan(1);
  });

  it('CRITICAL: brand-aware is unchanged — brand palette stated, no look palette authority, no palette pick', () => {
    const payload: Rec = { color_palette: BRAND_PALETTE };
    const p = promptFor(renderMetadata(card('comic', 'brand-aware'), { novelty_seed: 's1' }), payload);
    expect(p).toContain(`Brand palette (use as ambient color discipline, NOT decorative blocks): ${BRAND_PALETTE.join(', ')}.`);
    expect(p).toContain('Colour follows the look palette; brand colours appear as accents within it.');
    expect(p).not.toContain('fresh, harmonious palette');
    expect((noveltyOf(payload).picks as Rec).palette).toBeUndefined();
    // The composer with palette 'brand' is byte-identical to no palette field at all.
    const input: CreatorPromptInput = {
      title: 'T', body: 'B', eyebrow: 'image', brandMode: 'brand-aware',
      brandKit: { companyName: 'Acme', palette: BRAND_PALETTE },
      userVisualDirection: { title: 'Comic', stylePrompt: 'comic', renderingMedium: 'ink', palette: ['#ef4444'], photographic: false },
    };
    expect(composeCreatorImagePrompt({ ...input, palette: { mode: 'brand' } }).prompt).toBe(composeCreatorImagePrompt(input).prompt);
  });

  it('independent mode is not re-branded by the optimizer or the governance retry', () => {
    const src = SRC('../../services/creatorAssetRendererSvg.ts');
    expect(src).toContain("if (optimization.mutations.forceBrandAware && !independentColours) composerInput.brandMode = 'brand-aware';");
    expect(src).toContain("if (!independentColours) govMutations.brandMode = 'brand-aware';");
  });
});

/* ── C ─────────────────────────────────────────────────────────────────── */

describe('C — carousel / infographic colours follow the mode', () => {
  const brandKit = () => resolveCreatorBrandKit({ assetPayload: { color_palette: BRAND_PALETTE }, metadata: {} });

  it('look palette → contrast-safe backgrounds (white copy ≥ 4.5:1), accent from the look, input kit untouched', () => {
    const kit = brandKit();
    const before = JSON.stringify(kit);
    const comic = getVisualStyle('comic')!.palette;
    const out = applyIndependentPaletteToBrandKit(kit, comic);
    expect(JSON.stringify(kit)).toBe(before);
    expect(out.normalizedPalette).toHaveLength(3);
    for (const c of out.normalizedPalette) {
      expect(contrastRatio(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(BRAND_PALETTE).not.toContain(c);
    }
    expect(comic).toContain(out.accentColor);
    expect(contrastRatio(out.accentColor, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(out.overlayStrategy.ctaFill).toBe(out.accentColor);
  });

  it('CRITICAL: contrast fallback — a palette with no accent that clears 3:1 keeps the current accent', () => {
    const kit = brandKit();
    const out = applyIndependentPaletteToBrandKit(kit, ['#fefefe', '#fffbeb', '#e2e8f0'], '#1d4ed8');
    expect(out.accentColor).toBe('#1d4ed8');
    expect(out.contrastProfile.corrections).toContain('independent_palette_accent_fallback');
    for (const c of out.normalizedPalette) expect(contrastRatio(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(darkenForWhiteText('#ffffff')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('experimental palettes are seed-pinned and differ across seeds', () => {
    expect(experimentalPalette('seed-a', 'warm')).toEqual(experimentalPalette('seed-a', 'warm'));
    const set = new Set(['seed-a', 'seed-b', 'seed-c', 'seed-d'].map((s) => experimentalPalette(s, 'complementary').join()));
    expect(set.size).toBeGreaterThan(1);
    const meta = renderMetadata(card('comic', 'independent', 'experimental'));
    const r1 = resolveIndependentPalette({ metadata: meta, seed: 'deck-1' });
    const r2 = resolveIndependentPalette({ metadata: meta, seed: 'deck-1' });
    expect(r1).toEqual(r2);
    expect(r1!.mode).toBe('experimental');
    expect(PALETTE_DIRECTIONS).toContain(r1!.direction);
    // Brand-aware and look-less 'look' → null (renderer keeps its current kit).
    expect(resolveIndependentPalette({ metadata: renderMetadata(card('comic', 'brand-aware')) })).toBeNull();
    expect(resolveIndependentPalette({ metadata: renderMetadata(card(null, 'independent')) })).toBeNull();
  });

  const ovl = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route the play', cta: 'Learn more', supportingText: 'Close it' };
  async function renderCarousel(c: Rec, seed: string): Promise<Rec> {
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const slides = [
      { slide_number: 1, role: 'hook', headline: 'Open strong', body_text: 'First slide body copy.' },
      { slide_number: 2, role: 'cta', headline: 'Take action', body_text: 'Final slide body copy.' },
    ];
    const payload = { asset_kind: 'carousel', color_palette: BRAND_PALETTE, slides, slide_count: 2,
      media_bundle: { metadata: { platform: 'linkedin', content_type: 'carousel', creator_content_asset_type: 'carousel', topic: 'Topic', summary: 'S', cta: 'Get started', overlay_text: ovl, novelty_seed: seed, ...buildCreatorLookRenderMetadata(c) } } };
    const out = await renderAsset(payload, { companyId: 'co-1', userId: 'u', campaignId: 'c' });
    return (out as unknown as { metadata: Rec }).metadata;
  }

  it('CRITICAL: carousel — brand-aware keeps the brand kit; independent uses the look / a seeded palette', async () => {
    const brand = await renderCarousel(card('comic', 'brand-aware'), 'deck-seed');
    expect(brand.paletteUsed).toEqual(BRAND_PALETTE);
    expect(brand.palette_mode).toBe('brand');

    const look = await renderCarousel(card('comic', 'independent'), 'deck-seed');
    expect(look.palette_mode).toBe('look');
    const used = look.paletteUsed as string[];
    for (const c of used) { expect(BRAND_PALETTE).not.toContain(c); expect(contrastRatio(c, '#ffffff')).toBeGreaterThanOrEqual(4.5); }
    expect((look.novelty as Rec).look_id).toBe('comic');

    const e1 = await renderCarousel(card('comic', 'independent', 'experimental'), 'deck-seed');
    const e2 = await renderCarousel(card('comic', 'independent', 'experimental'), 'deck-seed');
    expect(e1.paletteUsed).toEqual(e2.paletteUsed);
    expect(PALETTE_DIRECTIONS).toContain(((e1.novelty as Rec).picks as Rec).palette);
    expect(e1.paletteUsed).not.toEqual(BRAND_PALETTE);
  }, 180000);

  async function renderInfographic(c: Rec, seed: string): Promise<Rec> {
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const payload = { asset_kind: 'image', color_palette: BRAND_PALETTE, visual_descriptor: { headline: 'T', visual_description: 'S' }, overlay_text: ovl,
      media_bundle: { metadata: { platform: 'linkedin', content_type: 'infographic', creator_content_asset_type: 'infographic', topic: 'Topic here', summary: 'Sub.', infographic_layout: 'framework', overlay_text: ovl, novelty_seed: seed, ...buildCreatorLookRenderMetadata(c) } } };
    const out = await renderAsset(payload, { companyId: 'co-1', userId: 'u', campaignId: 'c' });
    return (out as unknown as { metadata: Rec }).metadata;
  }
  const accentOf = (m: Rec) => (m.creatorBrandKit as Rec).accentColor as string;

  it('CRITICAL: infographic — independent accent from the look (WCAG-checked); fallback when the look has none that passes', async () => {
    const brand = await renderInfographic(card('isometric', 'brand-aware'), 'info-seed');
    const look = await renderInfographic(card('isometric', 'independent'), 'info-seed');
    expect(look.palette_mode).toBe('look');
    expect(getVisualStyle('isometric')!.palette).toContain(accentOf(look));
    expect(contrastRatio(accentOf(look), '#ffffff')).toBeGreaterThanOrEqual(3);
    // neumorphism's palette has no colour that carries white at 3:1 → the accent the
    // renderer uses today (here the look-derived sample accent) stays unchanged.
    const fallback = await renderInfographic(card('neumorphism', 'independent'), 'info-seed');
    const today = await renderInfographic(card('neumorphism', 'brand-aware'), 'info-seed');
    const corrections = ((fallback.creatorBrandKit as Rec).contrastProfile as Rec).corrections as string[];
    expect(corrections).toContain('independent_palette_accent_fallback');
    expect(accentOf(fallback)).toBe(accentOf(today));
    expect(brand.palette_mode).toBe('brand');
    expect(brand.paletteUsed).toEqual(BRAND_PALETTE);
  }, 180000);
});

/* ── D ─────────────────────────────────────────────────────────────────── */

describe('D — payload palette_mode', () => {
  function body(over: Rec = {}): Rec {
    return buildCreatorGenerationBody({
      type: 'image', config: WORKFLOW_CONFIG.image, answers: { topic: 'T', keyMessage: 'M' },
      selectedAsset: null, selectedSuggestion: null, refinedSuggestion: null, refinePrompt: '',
      writerSource: null, writerSupportingVisual: false, writerEmbeddedCopy: false,
      writerCompositionIntent: null, writerAssetType: null, writerAttachmentMode: null,
      standaloneAttachmentMode: 'embedded_copy', overlayText: {}, brandMode: 'independent', brandPresence: 'balanced',
      brandSelections: {}, brandProfile: null, brandOverrides: {}, brandContextLines: [],
      selectedPlatform: 'linkedin', selectedCompanyId: 'co-1', activeTemplate: getTemplateById('sys-image-headline-sub-cta')!,
      templateValues: { fields: {} }, lightweightContext: {}, blueprintId: null, compositionId: 'comp-1', variantPinOverride: null,
      ...over,
    } as never) as Rec;
  }
  const cardOf = (b: Rec) => b.creator_card as Rec;

  it('independent → the colour choice (default look); brand-aware → brand; brand fields unchanged', () => {
    expect(cardOf(body()).palette_mode).toBe('look');
    expect(cardOf(body({ paletteChoice: 'experimental' })).palette_mode).toBe('experimental');
    const brand = cardOf(body({ brandMode: 'brand-aware', paletteChoice: 'experimental' }));
    expect(brand.palette_mode).toBe('brand');
    expect(brand.brand_generation_mode).toBe('brand-aware');
    const ind = cardOf(body({ paletteChoice: 'experimental' }));
    expect(ind.brand_presence).toBe('none');
    expect((ind.brand_context as Rec).disabled).toBe(true);
  });
});

/* ── E ─────────────────────────────────────────────────────────────────── */

describe('E — avoid-recent picks', () => {
  it('primary picks step past the recent picks when the pool allows; no avoid list → unchanged', () => {
    for (const seed of ['av-1', 'av-2', 'av-3', 'av-4']) {
      const base = buildNoveltyPlan({ seed, lookId: 'comic', family: 'image' });
      const unchanged = buildNoveltyPlan({ seed, lookId: 'comic', family: 'image', avoid: {} });
      expect(unchanged.picks).toEqual(base.picks);
      const avoided = buildNoveltyPlan({ seed, lookId: 'comic', family: 'image', avoid: { scene: [base.picks.scene!], composition: [base.picks.composition!] } });
      expect(avoided.picks.scene).not.toBe(base.picks.scene);
      expect(avoided.picks.composition).not.toBe(base.picks.composition);
      // Secondary dimensions untouched; deterministic.
      expect(avoided.picks.lighting).toBe(base.picks.lighting);
      expect(buildNoveltyPlan({ seed, lookId: 'comic', family: 'image', avoid: { scene: [base.picks.scene!] } }).picks.scene).toBe(
        buildNoveltyPlan({ seed, lookId: 'comic', family: 'image', avoid: { scene: [base.picks.scene!] } }).picks.scene);
    }
    const exp = buildNoveltyPlan({ seed: 'pal', lookId: 'comic', paletteMode: 'experimental' });
    const expAvoid = buildNoveltyPlan({ seed: 'pal', lookId: 'comic', paletteMode: 'experimental', avoid: { palette: [exp.picks.palette!] } });
    expect(expAvoid.picks.palette).not.toBe(exp.picks.palette);
    // The audit records the look id the avoid lookup keys on.
    expect(exp.audit.look_id).toBe('comic');
  });

  it('CRITICAL: the read is a tenant-scoped SELECT on creator_assets (company_id + look), limited to the last 5', async () => {
    dbRows = [
      { novelty: { picks: { scene: 'a stylised cityscape', composition: 'a frame-within-a-frame arrangement' } } },
      { novelty: { picks: { scene: 'a stylised cityscape', palette: 'warm' } } },
      { novelty: null },
    ];
    const avoid = await loadRecentNoveltyPicks({ companyId: 'co-1', lookId: 'comic' });
    expect(avoid).toEqual({ scene: ['a stylised cityscape'], composition: ['a frame-within-a-frame arrangement'], palette: ['warm'] });
    expect(dbCalls).toHaveLength(1);
    const { table, ops } = dbCalls[0];
    expect(table).toBe('creator_assets');
    expect(ops).toContainEqual(['eq', ['company_id', 'co-1']]);
    expect(ops).toContainEqual(['eq', ['metadata->novelty->>look_id', 'comic']]);
    expect(ops).toContainEqual(['limit', [5]]);
    expect(ops.map(([op]) => op)).not.toEqual(expect.arrayContaining(['insert']));
    expect(ops.some(([op]) => op === 'insert' || op === 'update' || op === 'upsert')).toBe(false);
  });

  it('CRITICAL: fail-open — errors, timeouts, no company or no look → no avoidance', async () => {
    const throwing = () => { throw new Error('db down'); };
    expect(await loadRecentNoveltyPicks({ companyId: 'co-1', lookId: 'comic', table: throwing })).toEqual({});
    const erroring = () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: null, error: { message: 'x' } }); } });
    expect(await loadRecentNoveltyPicks({ companyId: 'co-1', lookId: 'comic', table: erroring as never })).toEqual({});
    const hanging = () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return new Promise(() => undefined); } });
    const t0 = Date.now();
    expect(await loadRecentNoveltyPicks({ companyId: 'co-1', lookId: 'comic', timeoutMs: 60, table: hanging as never })).toEqual({});
    expect(Date.now() - t0).toBeLessThan(2000);
    const spy = jest.fn();
    expect(await loadRecentNoveltyPicks({ companyId: '', lookId: 'comic', table: spy })).toEqual({});
    expect(await loadRecentNoveltyPicks({ companyId: 'co-1', lookId: null, table: spy })).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('renderAsset pins novelty_avoid once; the image plan avoids those picks', async () => {
    const payload: Rec = { media_bundle: { metadata: { guided_creative: { visual_direction_id: 'comic' } } } };
    await attachRecentNoveltyAvoid(payload, 'co-1', { load: async () => ({ scene: ['x'] }) });
    expect(((payload.media_bundle as Rec).metadata as Rec).novelty_avoid).toEqual({ scene: ['x'] });
    await attachRecentNoveltyAvoid(payload, 'co-1', { load: async () => ({ scene: ['y'] }) });
    expect(((payload.media_bundle as Rec).metadata as Rec).novelty_avoid).toEqual({ scene: ['x'] });
    const failing: Rec = { media_bundle: { metadata: { guided_creative: { visual_direction_id: 'comic' } } } };
    await attachRecentNoveltyAvoid(failing, 'co-1', { load: async () => { throw new Error('boom'); } });
    expect(((failing.media_bundle as Rec).metadata as Rec).novelty_avoid).toBeUndefined();
    expect(SRC('../../services/creatorAssetRendererRuntime.ts')).toContain('await attachRecentNoveltyAvoid(assetPayload, options.companyId ?? null);');

    const plain: Rec = {};
    promptFor(renderMetadata(card('comic', 'independent'), { novelty_seed: 'avoid-e2e' }), plain);
    const first = (noveltyOf(plain).picks as Rec).scene as string;
    const avoided: Rec = {};
    promptFor(renderMetadata(card('comic', 'independent'), { novelty_seed: 'avoid-e2e', novelty_avoid: { scene: [first] } }), avoided);
    expect((noveltyOf(avoided).picks as Rec).scene).not.toBe(first);
  });
});

/* ── F ─────────────────────────────────────────────────────────────────── */

describe('F — pixel-art is a registered look', () => {
  it('has look rendering consistent with its siblings, a showcase per family, one blueprint', () => {
    const s = getVisualStyle('pixel-art')!;
    expect(s).not.toBeNull();
    expect(s.renderingMedium.length).toBeGreaterThan(3);
    expect(s.palette.length).toBeGreaterThanOrEqual(2);
    expect(s.negativePrompt.length).toBeGreaterThan(3);
    expect(s.photographic).toBe(false);
    expect(s.surface).toMatch(/pixel/);
    for (const f of s.supportedFamilies) {
      expect(fs.existsSync(path.resolve(__dirname, `../../../public/creator-showcases/pixel-art/${f}.webp`))).toBe(true);
      expect(listVisualDirections(f).some((d) => d.id === 'pixel-art')).toBe(true);
    }
    expect(VISUAL_STYLES.filter((v) => v.id === 'pixel-art')).toHaveLength(1);
    expect(VISUAL_BLUEPRINTS.filter((b) => b.id === 'pixel-art')).toHaveLength(1);
    expect(getBlueprint('pixel-art')!.visualCategory).toBe('illustration');
  });
});

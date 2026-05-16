/**
 * Integration tests — Step-4 feature-flagged Creator cutover.
 *
 * Validates the runtime contract of `applyCreatorBlueprint`, the SINGLE
 * adapter entry point shared by the main generation loop AND the
 * auto-optimize-distribution branch in generate-weekly-structure.ts:
 *
 *   1. Flag OFF  → returns false, `enriched` untouched (legacy parity).
 *   2. Flag ON   → image/carousel rows are adapter-built + stamped.
 *   3. Non-image/carousel (video) → returns false even with flag ON
 *      (reel/video path provably untouched).
 *   4. Packaging precedence: existing non-empty wins over derived;
 *      empty existing fields fall back to derived; opaque extras kept.
 *   5. Live deployed-constraint acceptance of the stamped row.
 *   6. Determinism / no input identity drift across repeated calls
 *      (the property the "same helper, both branches" design protects).
 *
 * supabase is mocked as the purity proof — the helper transitively
 * imports the engine + weekly-structure-helpers (lazy supabase Proxy);
 * if the cutover path hit the DB this spy would throw.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in feature-flag cutover'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  applyCreatorBlueprint,
  isCreatorBlueprintAdapterEnabled,
} from '../../services/creator/intelligence/applyCreatorBlueprint';

const FLAG = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';

function baseContext() {
  return {
    topic: 'From Data to Decisions',
    objective: 'Build brand awareness for mid-market SaaS',
    contentType: 'carousel',
    platforms: ['instagram'],
    campaignTheme: 'Smarter marketing through data',
    creativeObjective: 'Position the product as the data-to-decision bridge',
    coreMessage: 'Turn raw analytics into weekly decisions',
    tone: 'authoritative',
    cta: 'Book a walkthrough',
    distributionMode: 'unique' as const,
  };
}

const ORIG_ENV = process.env[FLAG];
afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env[FLAG];
  else process.env[FLAG] = ORIG_ENV;
  fromSpy.mockClear();
});

describe('feature flag', () => {
  it('is OFF by default / for unset / falsey values', () => {
    delete process.env[FLAG];
    expect(isCreatorBlueprintAdapterEnabled()).toBe(false);
    process.env[FLAG] = '0';
    expect(isCreatorBlueprintAdapterEnabled()).toBe(false);
    process.env[FLAG] = 'false';
    expect(isCreatorBlueprintAdapterEnabled()).toBe(false);
  });

  it('is ON for "1" / "true" (case-insensitive)', () => {
    process.env[FLAG] = '1';
    expect(isCreatorBlueprintAdapterEnabled()).toBe(true);
    process.env[FLAG] = 'TRUE';
    expect(isCreatorBlueprintAdapterEnabled()).toBe(true);
  });
});

describe('flag OFF — legacy parity (no-op)', () => {
  it('returns false and does not mutate enriched', () => {
    delete process.env[FLAG];
    const enriched: Record<string, unknown> = { topic: 'x' };
    const snapshot = JSON.stringify(enriched);
    const handled = applyCreatorBlueprint({
      enriched,
      assetType: 'carousel',
      context: baseContext(),
      platform: 'instagram',
    });
    expect(handled).toBe(false);
    expect(JSON.stringify(enriched)).toEqual(snapshot);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('flag ON — scope guard', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('handles image rows (visual_descriptor object)', () => {
    const enriched: Record<string, unknown> = {};
    const handled = applyCreatorBlueprint({
      enriched,
      assetType: 'image',
      context: { ...baseContext(), contentType: 'image' },
      platform: 'instagram',
    });
    expect(handled).toBe(true);
    expect(enriched.intent_type).toBe('creator');
    expect(enriched.asset_type).toBe('image');
    const ap = enriched.asset_payload as any;
    expect(typeof ap.visual_descriptor).toBe('object');
    expect(Array.isArray(ap.visual_descriptor)).toBe(false);
    expect(typeof enriched.asset_instruction).toBe('object');
  });

  it('handles carousel rows (slides array)', () => {
    const enriched: Record<string, unknown> = {};
    const handled = applyCreatorBlueprint({
      enriched,
      assetType: 'carousel',
      context: baseContext(),
      platform: 'facebook',
    });
    expect(handled).toBe(true);
    expect(enriched.asset_type).toBe('carousel');
    expect(Array.isArray((enriched.asset_payload as any).slides)).toBe(true);
  });

  it('does NOT handle video/reel/post_with_asset (returns false, untouched)', () => {
    for (const at of ['video', 'reel', 'post_with_asset', 'thread_with_asset', 'audio']) {
      const enriched: Record<string, unknown> = { marker: at };
      const handled = applyCreatorBlueprint({
        enriched,
        assetType: at,
        context: baseContext(),
        platform: 'instagram',
      });
      expect(handled).toBe(false);
      expect(enriched).toEqual({ marker: at });
    }
  });
});

describe('flag ON — packaging precedence { ...derived, ...existingNonEmpty }', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('existing non-empty fields win; empty fall back to derived; extras kept', () => {
    const enriched: Record<string, unknown> = {
      packaging: {
        caption: 'HUMAN-WRITTEN HERO CAPTION',          // non-empty → wins
        hashtags: ['#RealDownstreamTag'],                // non-empty → wins
        meta_description: '',                            // empty → derived wins
        keywords: [],                                    // empty → derived wins
        cta: '   ',                                      // blank → derived wins
        editor_note: 'keep me (opaque extra)',           // extra → preserved
      },
    };
    const handled = applyCreatorBlueprint({
      enriched,
      assetType: 'carousel',
      context: baseContext(),
      platform: 'instagram',
    });
    expect(handled).toBe(true);
    const p = enriched.packaging as Record<string, any>;
    expect(p.caption).toBe('HUMAN-WRITTEN HERO CAPTION');
    expect(p.hashtags).toEqual(['#RealDownstreamTag']);
    expect(p.editor_note).toBe('keep me (opaque extra)');
    // derived filled the empty/blank ones (non-empty, present)
    expect(typeof p.meta_description).toBe('string');
    expect(p.meta_description.length).toBeGreaterThan(0);
    expect(Array.isArray(p.keywords)).toBe(true);
    expect(p.keywords.length).toBeGreaterThan(0);
    expect(typeof p.cta).toBe('string');
    expect(p.cta.trim().length).toBeGreaterThan(0);
  });

  it('preserves a richer existing asset_payload shape', () => {
    const enriched: Record<string, unknown> = {
      asset_payload: { slides: [{ index: 0, role: 'hook', headline: 'KEEP', body: 'KEEP' }] },
    };
    applyCreatorBlueprint({
      enriched,
      assetType: 'carousel',
      context: baseContext(),
      platform: 'instagram',
    });
    expect((enriched.asset_payload as any).slides[0].headline).toBe('KEEP');
  });
});

describe('determinism / no drift (the same-helper guarantee)', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('main-loop-style and auto-optimize-style calls converge for the same platform', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    applyCreatorBlueprint({ enriched: a, assetType: 'carousel', context: baseContext(), platform: 'instagram' });
    // auto-optimize branch carries packaging forward THEN calls the same
    // helper; with no existing packaging both reduce to the derived core.
    applyCreatorBlueprint({ enriched: b, assetType: 'carousel', context: baseContext(), platform: 'instagram' });
    expect(JSON.stringify(a.packaging)).toEqual(JSON.stringify(b.packaging));
    expect(JSON.stringify(a.asset_payload)).toEqual(JSON.stringify(b.asset_payload));
  });

  it('platform variation preserved (different platform ⇒ different notes id)', () => {
    const ig: Record<string, unknown> = {};
    const fb: Record<string, unknown> = {};
    applyCreatorBlueprint({ enriched: ig, assetType: 'image', context: { ...baseContext(), contentType: 'image' }, platform: 'instagram' });
    applyCreatorBlueprint({ enriched: fb, assetType: 'image', context: { ...baseContext(), contentType: 'image' }, platform: 'facebook' });
    expect((ig.creator_blueprint_source as any).blueprint_id)
      .not.toEqual((fb.creator_blueprint_source as any).blueprint_id);
  });

  it('never touches the database', () => {
    const enriched: Record<string, unknown> = {};
    applyCreatorBlueprint({ enriched, assetType: 'image', context: { ...baseContext(), contentType: 'image' }, platform: 'instagram' });
    applyCreatorBlueprint({ enriched: {}, assetType: 'carousel', context: baseContext(), platform: 'facebook' });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ── Live deployed-constraint acceptance of the stamped row ───────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('LIVE constraint — cutover rows are accepted by deployed SQL', () => {
  it('image + carousel stamped rows pass is_valid_creator_daily_content_payload', async () => {
    process.env[FLAG] = '1';
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const img: Record<string, unknown> = {};
      applyCreatorBlueprint({ enriched: img, assetType: 'image', context: { ...baseContext(), contentType: 'image' }, platform: 'instagram' });
      const car: Record<string, unknown> = {};
      applyCreatorBlueprint({ enriched: car, assetType: 'carousel', context: baseContext(), platform: 'facebook' });

      const mkRow = (e: Record<string, unknown>, at: string) => JSON.stringify({
        intent_type: 'creator',
        asset_type: at,
        packaging: e.packaging,
        asset_payload: e.asset_payload,
        asset_instruction: e.asset_instruction,
      });

      const r1 = await client.query(
        'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
        ['creator', 'image', mkRow(img, 'image')],
      );
      const r2 = await client.query(
        'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
        ['creator', 'carousel', mkRow(car, 'carousel')],
      );
      expect(r1.rows[0].ok).toBe(true);
      expect(r2.rows[0].ok).toBe(true);
    } finally {
      await client.end();
    }
  }, 25000);
});

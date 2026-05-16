/**
 * Validation — Step-7 controlled runtime cutover of the Creator
 * Week→Daily planning hierarchy (`applyCreatorPlanningFlow`).
 *
 * The helper IS the cutover unit (both generate-weekly-structure call
 * sites route through it). Covers the 10 required validations:
 *   1  image Creator flow (shared)
 *   2  carousel Creator flow (unique)
 *   3  hybrid-content Creator flow
 *   4  2-week continuity flow (passed through, never fetched)
 *   5  multi-platform variation flow
 *   6  feature flag OFF parity (byte-identical no-op)
 *   7  constraint-validation checks (LIVE deployed SQL)
 *   8  reel/video planning isolation (model-only, never scheduler-bound)
 *   9  NO strategic blueprint leakage into scheduler rows
 *   10 schedule-mode regression (flag OFF, and planning-ON/adapter-OFF
 *      backward-compat path stays constraint-valid)
 *
 * supabase mocked = purity proof (planner transitively imports the
 * engine + weekly-structure-helpers lazy supabase Proxy).
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in planning cutover'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  applyCreatorPlanningFlow,
  isCreatorPlanningHierarchyEnabled,
} from '../../services/creator/intelligence/planning/applyCreatorPlanningFlow';

const PLAN = 'ENABLE_CREATOR_PLANNING_HIERARCHY';
const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';

const FORBIDDEN = [
  'blueprint', 'emotional_goal', 'hook_strategy', 'creative_objective',
  'continuity_context', 'adaptation_notes', 'visual_direction',
  'platform_strategy', 'reuse_strategy', 'cta_strategy', 'packaging_strategy',
];

function seeds(over: Record<string, unknown> = {}) {
  return {
    topic: 'From Data to Decisions: Transform your marketing',
    objective: 'Build brand awareness for mid-market SaaS',
    contentType: 'carousel',
    platforms: ['linkedin'],
    campaignTheme: 'Smarter marketing through data',
    creativeObjective: 'Position the product as the data-to-decision bridge',
    coreMessage: 'Turn raw analytics into weekly decisions',
    tone: 'authoritative',
    cta: 'Book a walkthrough',
    distributionMode: 'unique' as const,
    continuityContext: { campaign_id: 'camp-123', week_index: 2 },
    ...over,
  };
}

const O_PLAN = process.env[PLAN];
const O_ADAPT = process.env[ADAPT];
afterEach(() => {
  if (O_PLAN === undefined) delete process.env[PLAN]; else process.env[PLAN] = O_PLAN;
  if (O_ADAPT === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O_ADAPT;
  fromSpy.mockClear();
});

describe('feature flag', () => {
  it('OFF by default; ON for 1/true', () => {
    delete process.env[PLAN];
    expect(isCreatorPlanningHierarchyEnabled()).toBe(false);
    process.env[PLAN] = 'false';
    expect(isCreatorPlanningHierarchyEnabled()).toBe(false);
    process.env[PLAN] = '1';
    expect(isCreatorPlanningHierarchyEnabled()).toBe(true);
    process.env[PLAN] = 'TRUE';
    expect(isCreatorPlanningHierarchyEnabled()).toBe(true);
  });
});

describe('Validation-6/10 — flag OFF parity (no-op)', () => {
  it('returns false and does not mutate enriched', () => {
    delete process.env[PLAN];
    const e: Record<string, unknown> = { topic: 'x' };
    const snap = JSON.stringify(e);
    const handled = applyCreatorPlanningFlow({
      enriched: e, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 2, context: seeds(),
    });
    expect(handled).toBe(false);
    expect(JSON.stringify(e)).toEqual(snap);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('Validation-1/2 — image(shared) / carousel(unique) handled', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('image handled — scheduler-safe stamp only', () => {
    const e: Record<string, unknown> = {};
    const ok = applyCreatorPlanningFlow({
      enriched: e, assetType: 'image', platform: 'instagram',
      weekIndex: 1, context: seeds({ contentType: 'image', platforms: ['instagram'] }),
    });
    expect(ok).toBe(true);
    expect(e.intent_type).toBe('creator');
    expect(e.asset_type).toBe('image');
    expect(typeof (e.asset_payload as any).visual_descriptor).toBe('object');
    expect(typeof e.asset_instruction).toBe('object');
  });

  it('carousel handled — slides array', () => {
    const e: Record<string, unknown> = {};
    const ok = applyCreatorPlanningFlow({
      enriched: e, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 1, context: seeds(),
    });
    expect(ok).toBe(true);
    expect(Array.isArray((e.asset_payload as any).slides)).toBe(true);
  });
});

describe('Validation-9 — NO strategic leakage into scheduler content', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('forbidden strategic keys never present; only scheduler-safe keys', () => {
    const e: Record<string, unknown> = {};
    applyCreatorPlanningFlow({
      enriched: e, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 2, context: seeds(),
    });
    for (const k of FORBIDDEN) expect(k in e).toBe(false);
    const allowed = new Set([
      'intent_type', 'asset_type', 'packaging', 'asset_payload',
      'asset_instruction', 'creator_planning_source',
    ]);
    for (const k of Object.keys(e)) expect(allowed.has(k)).toBe(true);
  });

  it('pre-existing strategic keys are scrubbed by the boundary guard', () => {
    const e: Record<string, unknown> = {
      blueprint: { secret: 1 },
      emotional_goal: { pain_point: 'leak' },
      hook_strategy: { verbal: 'leak' },
    };
    const ok = applyCreatorPlanningFlow({
      enriched: e, assetType: 'image', platform: 'instagram',
      weekIndex: 1, context: seeds({ contentType: 'image', platforms: ['instagram'] }),
    });
    expect(ok).toBe(true);
    expect('blueprint' in e).toBe(false);
    expect('emotional_goal' in e).toBe(false);
    expect('hook_strategy' in e).toBe(false);
  });
});

describe('Validation-8 — reel/video planning isolation', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('reel/video/short return false, tagged requires_human_production, no scheduler stamp', () => {
    for (const at of ['reel', 'video', 'short']) {
      const e: Record<string, unknown> = {};
      const handled = applyCreatorPlanningFlow({
        enriched: e, assetType: at, platform: 'instagram',
        weekIndex: 1, context: seeds({ contentType: at, platforms: ['instagram'] }),
      });
      expect(handled).toBe(false);
      expect(e.requires_human_production).toBe(true);
      // never scheduler-bound: no asset_payload / asset_type written
      expect('asset_payload' in e).toBe(false);
      expect('asset_type' in e).toBe(false);
      expect('creator_planning_source' in e).toBe(false);
    }
  });
});

describe('Validation-5 — multi-platform variation', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('each of the 6 platforms gets a distinct CTA framing', () => {
    const ctas = ['linkedin', 'instagram', 'facebook', 'tiktok', 'youtube', 'x'].map((p) => {
      const e: Record<string, unknown> = {};
      applyCreatorPlanningFlow({
        enriched: e, assetType: 'image', platform: p,
        weekIndex: 1, context: seeds({ contentType: 'image', platforms: [p] }),
      });
      return (e.packaging as any).cta as string;
    });
    expect(new Set(ctas).size).toBe(6);
  });
});

describe('Validation-3 — hybrid-content (existing non-empty packaging wins)', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('richer downstream caption is preserved (precedence)', () => {
    const e: Record<string, unknown> = {
      packaging: { caption: 'HUMAN HERO CAPTION', hashtags: ['#Real'] },
    };
    applyCreatorPlanningFlow({
      enriched: e, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 2, context: seeds(),
    });
    const p = e.packaging as Record<string, any>;
    expect(p.caption).toBe('HUMAN HERO CAPTION');
    expect(p.hashtags).toEqual(['#Real']);
    expect(typeof p.cta).toBe('string'); // planned/variation filled
    expect(Array.isArray(p.keywords)).toBe(true);
  });
});

describe('Validation-4 — 2-week continuity (passed through, not fetched)', () => {
  beforeEach(() => { process.env[PLAN] = '1'; process.env[ADAPT] = '1'; });

  it('different week_index ⇒ deterministic but distinct provenance; DB never touched', () => {
    const w1: Record<string, unknown> = {};
    const w2: Record<string, unknown> = {};
    applyCreatorPlanningFlow({
      enriched: w1, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 1, context: seeds({ continuityContext: { campaign_id: 'c', week_index: 1 } }),
    });
    applyCreatorPlanningFlow({
      enriched: w2, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 2, context: seeds({ continuityContext: { campaign_id: 'c', week_index: 2 } }),
    });
    expect((w1.creator_planning_source as any).card_id)
      .not.toEqual((w2.creator_planning_source as any).card_id);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('deterministic — identical inputs ⇒ byte-identical stamp', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    applyCreatorPlanningFlow({ enriched: a, assetType: 'image', platform: 'instagram', weekIndex: 3, context: seeds({ contentType: 'image', platforms: ['instagram'] }) });
    applyCreatorPlanningFlow({ enriched: b, assetType: 'image', platform: 'instagram', weekIndex: 3, context: seeds({ contentType: 'image', platforms: ['instagram'] }) });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('Validation-10 — planning ON + adapter OFF stays constraint-valid', () => {
  it('no blueprint, but scheduler stamp is still constraint-shaped', () => {
    process.env[PLAN] = '1';
    delete process.env[ADAPT];
    const e: Record<string, unknown> = {};
    const ok = applyCreatorPlanningFlow({
      enriched: e, assetType: 'carousel', platform: 'linkedin',
      weekIndex: 1, context: seeds(),
    });
    expect(ok).toBe(true);
    expect((e.creator_planning_source as any).adapter_applied).toBe(false);
    const p = e.packaging as any;
    expect(Array.isArray(p.hashtags)).toBe(true);
    expect(Array.isArray(p.keywords)).toBe(true);
    expect(Array.isArray((e.asset_payload as any).slides)).toBe(true);
  });
});

// ── Validation-7 — LIVE deployed-constraint acceptance ───────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-7 — stamped rows pass deployed SQL', () => {
  it('image/carousel × shared+unique × planning ON × adapter ON/OFF', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      process.env[PLAN] = '1';
      for (const adapter of ['1', '0']) {
        if (adapter === '1') process.env[ADAPT] = '1'; else delete process.env[ADAPT];
        for (const fmt of ['image', 'carousel']) {
          for (const mode of ['shared', 'unique'] as const) {
            const e: Record<string, unknown> = {};
            const ok = applyCreatorPlanningFlow({
              enriched: e, assetType: fmt, platform: 'instagram', weekIndex: 1,
              context: seeds({ contentType: fmt, platforms: ['instagram'], distributionMode: mode }),
            });
            expect(ok).toBe(true);
            const row = {
              intent_type: e.intent_type,
              asset_type: e.asset_type,
              packaging: e.packaging,
              asset_payload: e.asset_payload,
              asset_instruction: e.asset_instruction,
            };
            const res = await client.query(
              'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
              ['creator', String(e.asset_type), JSON.stringify(row)],
            );
            expect({ adapter, fmt, mode, ok: res.rows[0].ok })
              .toEqual({ adapter, fmt, mode, ok: true });
          }
        }
      }
    } finally {
      await client.end();
    }
  }, 30000);
});

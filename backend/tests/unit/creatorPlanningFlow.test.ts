/**
 * Validation — Step-6 Creator planning hierarchy
 * (Week Plan → Blueprint Card → Daily expansion → scheduler row).
 *
 * Covers the 10 required validations:
 *   1-3  image / carousel / reel Creator cards
 *   4-6  shared / unique / hybrid planning
 *   7    multi-platform adaptation (LinkedIn/IG/FB/TikTok/YT/X)
 *   8    multi-week continuity (passed-through, never fetched)
 *   9    deterministic expansion
 *   10   constraint-valid outputs (LIVE deployed SQL)
 *
 * supabase mocked = purity proof (the planner transitively imports the
 * engine + weekly-structure-helpers lazy supabase Proxy).
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure planner'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  buildCreatorBlueprintCard,
  buildCreatorWeekPlan,
  classifyReuse,
  expandCardToDailyTasks,
  toSchedulerRow,
} from '../../services/creator/intelligence/planning';

const FLAG = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];

function cardInput(format: string, extra: Record<string, unknown> = {}) {
  return {
    topic: 'From Data to Decisions: Transform your marketing',
    objective: 'Build brand awareness for mid-market SaaS',
    contentType: format,
    format,
    platforms: SIX,
    campaignTheme: 'Smarter marketing through data',
    creativeObjective: 'Position the product as the data-to-decision bridge',
    coreMessage: 'Turn raw analytics into weekly decisions',
    tone: 'authoritative',
    cta: 'Book a walkthrough',
    campaignId: 'camp-123',
    weekIndex: 2,
    continuityContext: {
      campaign_id: 'camp-123',
      week_index: 2,
      prior_week_summaries: [{ week_number: 1, summary: 'Awareness week landed' }],
    },
    ...extra,
  } as any;
}

const ORIG = process.env[FLAG];
afterEach(() => {
  if (ORIG === undefined) delete process.env[FLAG];
  else process.env[FLAG] = ORIG;
  fromSpy.mockClear();
});

describe('Phase-1/2 — Creator Blueprint Card generation', () => {
  it.each(['image', 'carousel', 'reel'])(
    'builds a complete strategic card for %s',
    (fmt) => {
      const card = buildCreatorBlueprintCard(cardInput(fmt, { distributionMode: 'shared' }));
      expect(card.format).toBe(fmt);
      expect(card.asset_family).toBe(fmt === 'reel' ? 'video' : fmt);
      for (const k of [
        'creative_objective', 'audience_intent', 'emotional_goal',
        'hook_strategy', 'core_message', 'visual_direction',
        'reuse_classification', 'target_platforms', 'platform_strategy',
        'cta_strategy', 'packaging_strategy', 'production_notes', 'adaptation_notes',
      ]) {
        expect((card as any)[k]).toBeDefined();
      }
      expect(card.target_platforms.sort()).toEqual(
        ['facebook', 'instagram', 'linkedin', 'tiktok', 'x', 'youtube'],
      );
      expect(card.production_notes.length).toBeGreaterThan(0);
      expect(fromSpy).not.toHaveBeenCalled();
    },
  );
});

describe('Phase-3 — shared / unique / hybrid classification', () => {
  it('derives classification from distribution + overrides', () => {
    expect(classifyReuse({ distributionMode: 'shared' })).toBe('shared_content');
    expect(classifyReuse({ distributionMode: 'unique' })).toBe('platform_native_content');
    expect(classifyReuse({ distributionMode: 'shared', hasPerPlatformOverrides: true }))
      .toBe('hybrid_content');
    expect(classifyReuse({ distributionMode: 'unique', explicit: 'hybrid_content' }))
      .toBe('hybrid_content');
  });

  it('shared card classifies shared_content', () => {
    const c = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    expect(c.reuse_classification).toBe('shared_content');
  });
  it('unique card classifies platform_native_content', () => {
    const c = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'unique' }));
    expect(c.reuse_classification).toBe('platform_native_content');
  });
  it('shared + per-platform overrides classifies hybrid_content', () => {
    const c = buildCreatorBlueprintCard(cardInput('carousel', {
      distributionMode: 'shared',
      perPlatformPackaging: { linkedin: { cta: 'Read the LinkedIn breakdown' } },
    }));
    expect(c.reuse_classification).toBe('hybrid_content');
  });
});

describe('Phase-4/5 — Daily expansion + feature-flagged adapter', () => {
  it('flag OFF → no blueprint, scheduler_row still constraint-shaped', () => {
    delete process.env[FLAG];
    const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'shared' }));
    const exp = expandCardToDailyTasks(card);
    expect(exp.tasks.length).toBe(6);
    for (const t of exp.tasks) {
      expect(t.adapter_applied).toBe(false);
      expect(t.blueprint).toBeNull();
      const r = t.scheduler_row;
      expect(r.intent_type).toBe('creator');
      expect(r.asset_type).toBe('carousel');
      expect(Array.isArray(r.packaging.hashtags)).toBe(true);
      expect(Array.isArray(r.packaging.keywords)).toBe(true);
      expect(typeof r.packaging.caption).toBe('string');
      expect(typeof r.packaging.cta).toBe('string');
      expect(Array.isArray((r.asset_payload as any).slides)).toBe(true);
      expect(typeof r.asset_instruction).toBe('object');
    }
  });

  it('flag ON → adapter blueprint attached for image/carousel/reel', () => {
    process.env[FLAG] = '1';
    for (const fmt of ['image', 'carousel', 'reel']) {
      const card = buildCreatorBlueprintCard(cardInput(fmt, { distributionMode: 'shared' }));
      const exp = expandCardToDailyTasks(card);
      expect(exp.tasks.every((t) => t.adapter_applied)).toBe(true);
      expect(exp.tasks.every((t) => t.blueprint !== null)).toBe(true);
      expect(exp.tasks[0]!.blueprint!.asset_family)
        .toBe(fmt === 'reel' ? 'video' : fmt);
    }
  });

  it('Phase-7: toSchedulerRow strips strategy, keeps only the flat row', () => {
    process.env[FLAG] = '1';
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const row = toSchedulerRow(expandCardToDailyTasks(card).tasks[0]!);
    expect(Object.keys(row).sort()).toEqual(
      ['asset_instruction', 'asset_payload', 'asset_type', 'intent_type', 'packaging'],
    );
    expect((row as any).blueprint).toBeUndefined();
    expect((row as any).emotional_goal).toBeUndefined();
  });
});

describe('Phase-3/4 — orchestration shapes', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('platform_native_content builds a DISTINCT blueprint per platform', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'unique' }));
    const exp = expandCardToDailyTasks(card);
    const ids = exp.tasks.map((t) => t.blueprint!.blueprint_id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('shared_content reuses ONE creative core across platforms', () => {
    const card = buildCreatorBlueprintCard(cardInput('reel', { distributionMode: 'shared' }));
    const exp = expandCardToDailyTasks(card);
    const ids = new Set(exp.tasks.map((t) => t.blueprint!.blueprint_id));
    expect(ids.size).toBe(1); // shared core
  });

  it('hybrid_content keeps shared core but applies per-platform override', () => {
    const card = buildCreatorBlueprintCard(cardInput('carousel', {
      distributionMode: 'shared',
      perPlatformPackaging: { linkedin: { caption: 'LINKEDIN-ONLY CAPTION' } },
    }));
    expect(card.reuse_classification).toBe('hybrid_content');
    const exp = expandCardToDailyTasks(card);
    const li = exp.tasks.find((t) => t.platform === 'linkedin')!;
    const ig = exp.tasks.find((t) => t.platform === 'instagram')!;
    expect(li.scheduler_row.packaging.caption).toBe('LINKEDIN-ONLY CAPTION');
    expect(ig.scheduler_row.packaging.caption).not.toBe('LINKEDIN-ONLY CAPTION');
    // shared core blueprint id identical (override is packaging-only)
    expect(li.blueprint!.blueprint_id).toBe(ig.blueprint!.blueprint_id);
  });
});

describe('Phase-6 — multi-platform variation', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('every platform gets differentiated CTA / hashtags / workflow', () => {
    const card = buildCreatorBlueprintCard(cardInput('image', { distributionMode: 'shared' }));
    const exp = expandCardToDailyTasks(card);
    const ctas = exp.tasks.map((t) => t.scheduler_row.packaging.cta);
    expect(new Set(ctas).size).toBe(6); // all distinct CTA framings
    for (const t of exp.tasks) {
      // platform-native hashtag appended
      const tags = t.scheduler_row.packaging.hashtags.join(' ').toLowerCase();
      expect(tags.length).toBeGreaterThan(0);
      expect(t.workflow_notes.join(' ')).toContain(t.platform);
    }
    const liCta = exp.tasks.find((t) => t.platform === 'linkedin')!.scheduler_row.packaging.cta;
    const ytCta = exp.tasks.find((t) => t.platform === 'youtube')!.scheduler_row.packaging.cta;
    expect(liCta).toContain('comments');
    expect(ytCta.toLowerCase()).toContain('subscribe');
  });
});

describe('Phase-2 — week plan + multi-week continuity', () => {
  it('builds a week of cards; continuity passed through (never fetched)', () => {
    const wk = buildCreatorWeekPlan({
      campaignId: 'camp-123',
      weekIndex: 3,
      slots: [cardInput('image'), cardInput('carousel'), cardInput('reel')],
    });
    expect(wk.cards.length).toBe(3);
    expect(wk.week_index).toBe(3);
    for (const c of wk.cards) {
      expect(c.continuity_context.campaign_id).toBe('camp-123');
      expect(c.continuity_context.prior_week_summaries?.[0]?.summary)
        .toBe('Awareness week landed');
    }
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('Validation-9 — deterministic expansion', () => {
  it('identical card → byte-identical expansion (flag ON & OFF)', () => {
    for (const flag of ['1', '0']) {
      process.env[FLAG] = flag;
      const card = buildCreatorBlueprintCard(cardInput('carousel', { distributionMode: 'unique' }));
      const a = expandCardToDailyTasks(card, { variationSeed: 5 });
      const b = expandCardToDailyTasks(card, { variationSeed: 5 });
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    }
  });
});

// ── Validation-10 — LIVE deployed-constraint acceptance ──────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-10 — scheduler_rows pass deployed SQL', () => {
  it('image/carousel/reel × shared+unique all pass, flag ON & OFF', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const flag of ['1', '0']) {
        process.env[FLAG] = flag;
        for (const fmt of ['image', 'carousel', 'reel']) {
          for (const mode of ['shared', 'unique'] as const) {
            const card = buildCreatorBlueprintCard(cardInput(fmt, { distributionMode: mode }));
            for (const task of expandCardToDailyTasks(card).tasks) {
              const r = task.scheduler_row;
              const res = await client.query(
                'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
                ['creator', r.asset_type, JSON.stringify(r)],
              );
              expect({ flag, fmt, mode, platform: task.platform, ok: res.rows[0].ok })
                .toEqual({ flag, fmt, mode, platform: task.platform, ok: true });
            }
          }
        }
      }
    } finally {
      await client.end();
    }
  }, 30000);
});

/**
 * CONTENT-INTELLIGENCE-002 — canonical Context Assimilation Engine.
 * Hermetic + deterministic: sources and `now` are injected (no DB / clock).
 */
import { assimilateContext } from '../../services/context/contextAssimilationEngine';
import { computeFreshness, freshnessText, makeFact } from '../../services/context/freshness';
import { mergeListFacts, pickBest, factScore } from '../../services/context/contextMerge';
import { toBriefGrounding, legacyStrength } from '../../services/context/canonicalContextAdapters';
import type { Fact } from '../../services/context/canonicalContextTypes';

const NOW = Date.parse('2026-07-14T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const RICH_PROFILE = {
  name: 'Omnivyra',
  industry: 'Martech',
  category: 'AI content platform',
  products_services: 'AI content platform, Post generator, Campaign planner',
  competitive_advantages: ['Grounded in your own website crawl', 'Multi-platform in one flow'],
  unique_value: 'Ship on-brand content 5x faster',
  ideal_customer_profile: 'B2B marketing leaders at 50-500 person SaaS',
  target_audience_list: ['CMOs', 'Content leads'],
  pain_symptoms: ['generic AI output', 'slow production'],
  core_problem_statement: 'Marketers cannot ship on-brand content fast enough',
  goals: 'Thought leadership, pipeline',
  brand_positioning: 'sharp, modern, decision-useful',
  content_themes: 'AEO, attribution, pipeline',
  campaign_focus: 'Q3 launch',
  growth_priorities: ['expand mid-market'],
  overall_confidence: 0.85,
  last_refined_at: daysAgo(3),
  report_settings: {
    discovered_metadata: { description: 'Omnivyra — AI content platform for B2B marketers', discovered_at: daysAgo(3), seo_keywords: ['ai content', 'content marketing'] },
    market_pulse: { named_competitors: ['Jasper', 'Writer'], primary_markets: ['US SaaS'], updated_at: daysAgo(10) },
  },
};

const THIN_PROFILE = { name: 'Acme', last_refined_at: daysAgo(200) };

const RICH_CONTENT = [
  { title: 'Why grounded content beats generic AI', published_at: daysAgo(5) },
  { title: 'The proof-first B2B post', published_at: daysAgo(20) },
];

const richDeps = { now: NOW, loadProfile: async () => RICH_PROFILE as any, loadRecentContent: async () => RICH_CONTENT };
const thinDeps = { now: NOW, loadProfile: async () => THIN_PROFILE as any, loadRecentContent: async () => [] };

describe('freshness', () => {
  it('labels by age deterministically', () => {
    expect(computeFreshness(daysAgo(0), NOW).label).toBe('today');
    expect(computeFreshness(daysAgo(5), NOW).label).toBe('recent');
    expect(computeFreshness(daysAgo(20), NOW).label).toBe('aging');
    expect(computeFreshness(daysAgo(90), NOW).label).toBe('stale');
    expect(computeFreshness(null, NOW).label).toBe('unknown');
  });
  it('renders human text', () => {
    expect(freshnessText(computeFreshness(daysAgo(0), NOW))).toBe('today');
    expect(freshnessText(computeFreshness(daysAgo(3), NOW))).toBe('3 days');
    expect(freshnessText(computeFreshness(null, NOW))).toBe('unknown');
  });
});

describe('merge + confidence', () => {
  const f = (value: string[], origin: any, confidence: number, ts: string | null): Fact<string[]> =>
    makeFact(value, origin, confidence, ts, NOW)!;

  it('unions list facts and dedups case-insensitively', () => {
    const merged = mergeListFacts([
      f(['Alpha', 'Beta'], 'profile', 0.8, daysAgo(3)),
      f(['beta', 'Gamma'], 'website', 0.7, daysAgo(1)),
    ]);
    // Union + case-insensitive dedup (order = best-trust source first).
    expect([...merged!.value].map((v) => v.toLowerCase()).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(merged!.value.length).toBe(3);
  });

  it('pickBest prefers higher trust, then freshness', () => {
    const websiteFresh = f(['w'], 'website', 0.7, daysAgo(1));
    const profileOld = f(['p'], 'profile', 0.7, daysAgo(60));
    expect(pickBest([profileOld, websiteFresh])).toBe(websiteFresh);
    expect(factScore(websiteFresh)).toBeGreaterThan(factScore(profileOld));
  });
});

describe('assimilation — rich vs weak profile', () => {
  it('rich profile → strong/excellent, facts present, high confidence', async () => {
    const ctx = await assimilateContext('co1', richDeps);
    expect(['strong', 'excellent']).toContain(ctx.quality.overall);
    expect(ctx.offerings?.value.length).toBeGreaterThan(0);
    expect(ctx.icp?.value).toContain('B2B');
    expect(ctx.differentiators?.value.length).toBeGreaterThan(0);
    expect(ctx.contentHistory?.value.length).toBe(2);
    expect(ctx.transparency.confidence).toBeGreaterThan(50);
    const website = ctx.transparency.groundedFrom.find((g) => g.source === 'Website');
    expect(website?.present).toBe(true);
  });

  it('weak profile → weak/insufficient, thin strength, gaps surfaced (never hidden)', async () => {
    const ctx = await assimilateContext('co2', thinDeps);
    expect(['weak', 'insufficient']).toContain(ctx.quality.overall);
    expect(legacyStrength(ctx)).toBe('thin');
    expect(ctx.knownGaps).toEqual(expect.arrayContaining(['Products & Services', 'ICP', 'Differentiation']));
    // every dimension still reported with a reason — nothing hidden
    expect(ctx.quality.dimensions.differentiation.reason).toMatch(/No differentiation available/i);
  });
});

describe('evidence intelligence — never invents, honest gaps', () => {
  it('rich profile yields internal + reasoning; external honestly noted absent', async () => {
    const ctx = await assimilateContext('co1', richDeps);
    expect(ctx.evidenceIntelligence.internal.length).toBeGreaterThan(0);
    expect(ctx.evidenceIntelligence.reasoning.length).toBeGreaterThan(0);
    // competitors present → external has them
    expect(ctx.evidenceIntelligence.external.length).toBeGreaterThan(0);
  });
  it('thin profile → honest note that first-party proof is missing', async () => {
    const ctx = await assimilateContext('co2', thinDeps);
    expect(ctx.evidenceIntelligence.internal.length).toBe(0);
    expect(ctx.evidenceIntelligence.note).toMatch(/No first-party proof/i);
  });
});

describe('transparency', () => {
  it('marks present/absent sources and lists missing context', async () => {
    const ctx = await assimilateContext('co1', richDeps);
    expect(ctx.transparency.groundedFrom.length).toBeGreaterThan(5);
    expect(typeof ctx.transparency.confidence).toBe('number');
    expect(ctx.transparency.freshnessLabel).not.toBe('');
  });
});

describe('determinism', () => {
  it('same inputs + same now → byte-identical context', async () => {
    const a = await assimilateContext('co1', richDeps);
    const b = await assimilateContext('co1', richDeps);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('backward compatibility (CI-001 grounding shape)', () => {
  it('toBriefGrounding returns {text, signals, strength} grounded in real facts', async () => {
    const ctx = await assimilateContext('co1', richDeps);
    const g = toBriefGrounding(ctx);
    expect(g.text).toContain('Products / services:');
    expect(g.signals.some((s) => s.startsWith('ICP:'))).toBe(true);
    expect(g.strength).toBe('strong');
  });
  it('thin profile maps to legacy strength "thin"', async () => {
    const ctx = await assimilateContext('co2', thinDeps);
    expect(toBriefGrounding(ctx).strength).toBe('thin');
  });
});

/**
 * CONTENT-INTELLIGENCE-003 — consumer migration guarantees.
 * Proves the canonical adapter preserves compatibility: when the profile already
 * has the data, output is identical to legacy; when sparse, gaps are filled and
 * present values are never overwritten. Deterministic + fallback-safe.
 */
import { overlayCanonicalOntoProfile } from '../../services/context/canonicalProfileOverlay';
import { assimilateContext } from '../../services/context/contextAssimilationEngine';
import { getCanonicalAdoptionStats, MIGRATED_CONSUMERS, WAVE1_MIGRATED_CONSUMERS, WAVE2A_MIGRATED_CONSUMERS, WAVE2B_MIGRATED_CONSUMERS, WAVE2C_MIGRATED_CONSUMERS, WAVE2D_MIGRATED_CONSUMERS, WAVE2E_MIGRATED_CONSUMERS, WAVE2F_MIGRATED_CONSUMERS, recordCanonicalRead, getCanonicalReadCounts } from '../../services/context/canonicalAdoptionMetrics';

const NOW = Date.parse('2026-07-14T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const CANON_SOURCE = {
  name: 'Omnivyra', industry: 'Martech', category: 'AI content platform',
  products_services: 'AI content platform, Post generator',
  competitive_advantages: ['Grounded in your crawl', 'Multi-platform'],
  unique_value: 'Ship on-brand content 5x faster',
  ideal_customer_profile: 'B2B marketing leaders at SaaS',
  target_audience_list: ['CMOs', 'Content leads'],
  pain_symptoms: ['generic AI output'],
  content_themes: 'AEO, attribution',
  growth_priorities: ['mid-market'],
  brand_positioning: 'sharp, modern',
  overall_confidence: 0.85, last_refined_at: daysAgo(3),
  report_settings: {},
};

const ctxFrom = (profile: Record<string, unknown>) =>
  assimilateContext('co', { now: NOW, loadProfile: async () => profile as any, loadRecentContent: async () => [] });

describe('overlayCanonicalOntoProfile — compatibility', () => {
  it('canonical == legacy: a COMPLETE profile is returned unchanged (no overwrite)', async () => {
    const ctx = await ctxFrom(CANON_SOURCE);
    const complete = {
      name: 'Acme',
      products_services: 'Existing product', products_services_list: ['Existing product'],
      unique_value: 'Existing edge', competitive_advantages: ['Existing edge'],
      ideal_customer_profile: 'Existing ICP', target_audience: 'Existing ICP', target_audience_list: ['Existing persona'],
      pain_symptoms: ['Existing pain'], industry: 'Existing industry',
      brand_positioning: 'Existing voice', brand_voice: 'Existing voice',
      content_themes: 'Existing theme', content_themes_list: ['Existing theme'],
      growth_priorities: ['Existing goal'],
    };
    const out = overlayCanonicalOntoProfile({ ...complete }, ctx);
    expect(out).toEqual(complete); // nothing changed — prompt would be identical
  });

  it('sparse profile: empty fields are filled from canonical; present fields kept', async () => {
    const ctx = await ctxFrom(CANON_SOURCE);
    const sparse = { name: 'Acme', industry: 'Fintech' }; // industry present, rest empty
    const out = overlayCanonicalOntoProfile({ ...sparse } as Record<string, unknown>, ctx);
    expect(out.name).toBe('Acme');
    expect(out.industry).toBe('Fintech');            // present value NOT overwritten
    expect(out.products_services).toBeTruthy();       // filled from canonical
    expect(Array.isArray(out.competitive_advantages)).toBe(true);
    expect(out.ideal_customer_profile).toContain('B2B');
  });

  it('is deterministic (same profile + ctx → identical)', async () => {
    const ctx = await ctxFrom(CANON_SOURCE);
    const p = { name: 'Acme' };
    expect(JSON.stringify(overlayCanonicalOntoProfile({ ...p }, ctx)))
      .toEqual(JSON.stringify(overlayCanonicalOntoProfile({ ...p }, ctx)));
  });

  it('never overwrites a present value even when canonical differs', async () => {
    const ctx = await ctxFrom(CANON_SOURCE);
    const p = { products_services: 'MY REAL PRODUCT' };
    const out = overlayCanonicalOntoProfile({ ...p } as Record<string, unknown>, ctx);
    expect(out.products_services).toBe('MY REAL PRODUCT');
  });
});

describe('adoption metrics', () => {
  it('reports Wave-1 + Wave-2A + Wave-2B + Wave-2C + Wave-2D migration counts + percentage', () => {
    const s = getCanonicalAdoptionStats();
    expect(WAVE1_MIGRATED_CONSUMERS.length).toBe(15);
    expect(WAVE2A_MIGRATED_CONSUMERS.length).toBe(7);
    expect(WAVE2B_MIGRATED_CONSUMERS.length).toBe(3);
    expect(WAVE2C_MIGRATED_CONSUMERS.length).toBe(15);
    expect(WAVE2D_MIGRATED_CONSUMERS.length).toBe(4);
    expect(WAVE2E_MIGRATED_CONSUMERS.length).toBe(14);
    expect(WAVE2F_MIGRATED_CONSUMERS.length).toBe(38);
    expect(s.migrated).toBe(MIGRATED_CONSUMERS.length);
    expect(s.migrated).toBe(96); // 15 + 7 + 3 + 15 + 4 + 14 + 38
    // Final wave: every getProfile() grounding consumer migrated → 100% adoption.
    expect(s.total).toBe(96);
    expect(s.remaining).toBe(0);
    expect(s.adoptionPercent).toBe(100);
  });

  it('records runtime canonical reads', () => {
    recordCanonicalRead('test-consumer', true);
    recordCanonicalRead('test-consumer', false);
    const c = getCanonicalReadCounts();
    expect(c.byConsumer['test-consumer']).toBeGreaterThanOrEqual(2);
    expect(c.canonicalBacked.yes).toBeGreaterThanOrEqual(1);
    expect(c.canonicalBacked.no).toBeGreaterThanOrEqual(1);
  });
});

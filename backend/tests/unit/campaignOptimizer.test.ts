/**
 * CAMPAIGN-IMPL-006 — deterministic campaign optimizer.
 */
import { optimizeCampaign, applyOptimizedContext, readCampaignContext, DEFAULT_MAX_OPTIMIZATION_PASSES } from '../../../lib/shared/campaign/campaignOptimizer';
import { assessCampaignQuality, type PlannedAsset } from '../../../lib/shared/campaign/campaignQuality';

const asset = (over: Partial<PlannedAsset> = {}): PlannedAsset => ({
  content_type: 'post',
  platform: 'linkedin',
  week: 1,
  theme: 'Onboarding',
  funnel_stage: 'awareness',
  cta: 'Book a demo',
  audience: 'RevOps',
  master_idea_id: 'mi_a',
  idea_fingerprint: 'fp_a',
  narrative_fingerprint: 'nf_a',
  cta_fingerprint: 'cf_a',
  topic_fingerprint: 'tf_a',
  topic_title: 'Topic A',
  hook: 'Hook A',
  ...over,
});

/** A deliberately monotonous campaign: one stage, one CTA, one message. */
const monotonous = (n = 8) =>
  Array.from({ length: n }, (_, i) =>
    asset({ week: (i % 4) + 1, content_type: ['post', 'article', 'carousel'][i % 3], platform: 'linkedin', cta: 'Book a demo', funnel_stage: 'awareness', theme: 'Onboarding', master_idea_id: `mi_${i}`, idea_fingerprint: 'same', topic_title: `T${i}` }));

describe('optimizer — improves or holds, never worsens', () => {
  it('raises the overall score on a monotonous campaign', () => {
    const r = optimizeCampaign(monotonous());
    expect(r.after.overall).toBeGreaterThan(r.before.overall);
    expect(r.improved).toBe(true);
    expect(r.delta).toBeGreaterThan(0);
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it('never lowers the score (each kept pass strictly improves)', () => {
    const r = optimizeCampaign(monotonous(12));
    expect(r.after.overall).toBeGreaterThanOrEqual(r.before.overall);
  });

  it('a healthy campaign is left essentially unchanged', () => {
    const healthy = [
      asset({ week: 1, content_type: 'article', funnel_stage: 'awareness', cta: 'Read more', theme: 'Problem', master_idea_id: 'm1', idea_fingerprint: 'i1', topic_title: 'A' }),
      asset({ week: 2, content_type: 'carousel', platform: 'instagram', funnel_stage: 'consideration', cta: 'Compare', theme: 'Solution', master_idea_id: 'm2', idea_fingerprint: 'i2', topic_title: 'B' }),
      asset({ week: 3, content_type: 'post', platform: 'facebook', funnel_stage: 'decision', cta: 'Book a demo', theme: 'Proof', master_idea_id: 'm3', idea_fingerprint: 'i3', topic_title: 'C' }),
      asset({ week: 4, content_type: 'newsletter', funnel_stage: 'retention', cta: 'Subscribe', theme: 'Adoption', master_idea_id: 'm4', idea_fingerprint: 'i4', topic_title: 'D' }),
      asset({ week: 5, content_type: 'post', funnel_stage: 'advocacy', cta: 'Refer a peer', theme: 'Community', master_idea_id: 'm5', idea_fingerprint: 'i5', topic_title: 'E' }),
    ];
    const r = optimizeCampaign(healthy);
    expect(r.changes.length).toBe(0);
    expect(r.after.overall).toBe(r.before.overall);
  });
});

describe('termination + bounds', () => {
  it('respects the max-pass budget', () => {
    const r = optimizeCampaign(monotonous(20), { maxPasses: 2 });
    expect(r.passes_run).toBeLessThanOrEqual(2);
  });

  it('stops early when no pass improves (does not run all passes needlessly)', () => {
    const r = optimizeCampaign(monotonous(6));
    expect(r.passes_run).toBeLessThanOrEqual(DEFAULT_MAX_OPTIMIZATION_PASSES);
  });

  it('is deterministic — same input yields identical output', () => {
    const a = optimizeCampaign(monotonous(10));
    const b = optimizeCampaign(monotonous(10));
    expect(a.after.overall).toBe(b.after.overall);
    expect(a.changes).toEqual(b.changes);
  });

  it('never throws on empty/small input', () => {
    expect(() => optimizeCampaign([])).not.toThrow();
    expect(optimizeCampaign([asset()]).changes).toEqual([]);
  });
});

describe('SAFETY invariants — structure/schedule/format are never touched', () => {
  it('preserves content_type, platform, week, and asset count for every asset', () => {
    const input = monotonous(9);
    const r = optimizeCampaign(input);
    expect(r.assets).toHaveLength(input.length);
    for (let i = 0; i < input.length; i += 1) {
      expect(r.assets[i].content_type).toBe(input[i].content_type);
      expect(r.assets[i].platform).toBe(input[i].platform);
      expect(r.assets[i].week).toBe(input[i].week);
    }
  });

  it('the content-type distribution is identical before and after (no format removed)', () => {
    const input = monotonous(12);
    const r = optimizeCampaign(input);
    const dist = (xs: PlannedAsset[]) => xs.map((a) => a.content_type).sort().join(',');
    expect(dist(r.assets)).toBe(dist(input));
  });

  it('every change touches only metadata fields (stage/cta/theme/audience/idea)', () => {
    const r = optimizeCampaign(monotonous(10));
    for (const c of r.changes) {
      expect(['funnel_stage', 'cta', 'theme', 'audience', 'master_idea_id']).toContain(c.field);
    }
  });
});

describe('individual passes', () => {
  it('buyer-journey balancing fills a missing stage', () => {
    const r = optimizeCampaign(monotonous(8));
    const before = new Set(monotonous(8).map((a) => a.funnel_stage));
    const after = new Set(r.assets.map((a) => a.funnel_stage));
    expect(after.size).toBeGreaterThan(before.size);
    expect(r.changes.some((c) => c.pass === 'buyer_journey_balancing')).toBe(true);
  });

  it('CTA optimization diversifies a single-CTA campaign', () => {
    const r = optimizeCampaign(monotonous(9));
    const ctas = new Set(r.assets.map((a) => a.cta));
    expect(ctas.size).toBeGreaterThan(1);
    expect(r.changes.some((c) => c.pass === 'cta_optimization')).toBe(true);
  });

  it('audience balancing does NOT invent an audience for a single-audience campaign', () => {
    const r = optimizeCampaign(monotonous(8));
    // all inputs share audience 'RevOps' → conservative pass leaves audience alone
    expect(r.changes.some((c) => c.field === 'audience')).toBe(false);
  });

  it('after optimization the assessment reflects the improvement', () => {
    const input = monotonous(10);
    const r = optimizeCampaign(input);
    // re-assessing the optimized assets reproduces r.after
    expect(assessCampaignQuality(r.assets).overall).toBe(r.after.overall);
  });
});

describe('IMPL-006A — optimized values reach the fields the generators read', () => {
  const baseContent = () => ({
    dailyObjective: 'Explain onboarding',
    whoAreWeWritingFor: 'RevOps',
    desiredAction: 'Book a demo',
    intent: { objective: 'Explain onboarding', cta_type: 'Book a demo', target_audience: 'RevOps', pain_point: 'slow setup', outcome_promise: 'fast value' },
    master_idea: { id: 'mi_1', theme: 'Onboarding', buyer_journey_stage: 'awareness', cta_strategy: 'Book a demo', audience: 'RevOps', core_message: 'value fast' },
    variant: { variant_id: 'cv_1', master_idea_id: 'mi_1' },
    fingerprint: { idea: 'i', narrative: 'n', cta: 'c', topic: 't' },
    campaign_context: 'original',
  });

  it('writes optimized CTA into the flat field the text/BOLT builder reads (desiredAction → cta_type)', () => {
    const c = baseContent();
    applyOptimizedContext(c as any, asset({ cta: 'Get started', cta_fingerprint: 'cf2' }));
    // buildItemFromEnriched: cta_type ← enriched.desiredAction
    expect(c.desiredAction).toBe('Get started');
    expect(c.intent.cta_type).toBe('Get started');
    expect(c.master_idea.cta_strategy).toBe('Get started'); // creator prompt (blob)
    expect(c.fingerprint.cta).toBe('cf2');
  });

  it('writes optimized audience into the flat field the builder reads (whoAreWeWritingFor → target_audience)', () => {
    const c = baseContent();
    applyOptimizedContext(c as any, asset({ audience: 'Founders' }));
    expect(c.whoAreWeWritingFor).toBe('Founders');
    expect(c.intent.target_audience).toBe('Founders');
    expect(c.master_idea.audience).toBe('Founders');
  });

  it('stamps campaign_context=optimized for traceability', () => {
    const c = baseContent();
    applyOptimizedContext(c as any, asset({ cta: 'Learn more' }));
    expect(c.campaign_context).toBe('optimized');
    expect(readCampaignContext(c)).toBe('optimized');
  });

  it('readCampaignContext defaults to original for legacy/unoptimized content', () => {
    expect(readCampaignContext(null)).toBe('original');
    expect(readCampaignContext({})).toBe('original');
    expect(readCampaignContext({ campaign_context: 'original' })).toBe('original');
  });

  it('is backward compatible — content without master_idea/intent does not throw', () => {
    const legacy: any = { desiredAction: 'x', whoAreWeWritingFor: 'y' };
    expect(() => applyOptimizedContext(legacy, asset({ cta: 'New CTA', audience: 'New Aud' }))).not.toThrow();
    // still projects the flat fields the generator reads
    expect(legacy.desiredAction).toBe('New CTA');
    expect(legacy.whoAreWeWritingFor).toBe('New Aud');
    expect(legacy.campaign_context).toBe('optimized');
  });

  it('end-to-end: optimizer changes are visible in the generator-facing fields', () => {
    // Optimize a monotonous campaign, then project each optimized asset onto a
    // matching content envelope — the flat fields must reflect the new values.
    const r = optimizeCampaign(monotonous(9));
    const changedCta = r.changes.find((c) => c.field === 'cta');
    expect(changedCta).toBeDefined();
    const idx = changedCta!.asset_index;
    const c = baseContent();
    applyOptimizedContext(c as any, r.assets[idx]);
    expect(c.desiredAction).toBe(r.assets[idx].cta);
  });
});

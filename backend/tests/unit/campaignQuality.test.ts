/**
 * CAMPAIGN-IMPL-005 — Campaign Quality Intelligence Engine (advisory).
 */
import {
  assessCampaignQuality,
  BUYER_JOURNEY_STAGES,
  type PlannedAsset,
} from '../../../lib/shared/campaign/campaignQuality';

const asset = (over: Partial<PlannedAsset> = {}): PlannedAsset => ({
  content_type: 'post',
  platform: 'linkedin',
  week: 1,
  theme: 'Onboarding',
  funnel_stage: 'awareness',
  cta: 'Learn more',
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

const dim = (a: ReturnType<typeof assessCampaignQuality>, key: string) => a.dimensions.find((d) => d.key === key)!;

describe('campaign quality engine — always produces a measurable assessment', () => {
  it('returns all nine dimensions + overall + grade for any input', () => {
    const a = assessCampaignQuality([asset(), asset({ content_type: 'carousel', platform: 'instagram' })]);
    expect(a.dimensions).toHaveLength(9);
    expect(a.overall).toBeGreaterThanOrEqual(0);
    expect(a.overall).toBeLessThanOrEqual(100);
    expect(['excellent', 'good', 'fair', 'needs_attention']).toContain(a.grade);
  });

  it('never throws on empty / malformed input', () => {
    expect(() => assessCampaignQuality([])).not.toThrow();
    expect(() => assessCampaignQuality(undefined as any)).not.toThrow();
    const empty = assessCampaignQuality([]);
    expect(empty.asset_count).toBe(0);
    expect(empty.dimensions).toHaveLength(9);
  });
});

describe('individual dimensions', () => {
  it('CTA diversity: identical CTAs score low + recommend reducing repetition', () => {
    const a = assessCampaignQuality(Array.from({ length: 5 }, (_, i) => asset({ cta: 'Book a demo', topic_title: `T${i}` })));
    expect(dim(a, 'cta_diversity').score).toBeLessThan(55);
    expect(a.recommendations.some((r) => r.dimension === 'cta_diversity' && /CTA repetition/i.test(r.message))).toBe(true);
  });

  it('CTA diversity: varied CTAs score high', () => {
    const a = assessCampaignQuality(['a', 'b', 'c', 'd'].map((c, i) => asset({ cta: c, topic_title: `T${i}` })));
    expect(dim(a, 'cta_diversity').score).toBeGreaterThan(70);
  });

  it('buyer journey: detects missing stages and recommends filling them', () => {
    const a = assessCampaignQuality([asset({ funnel_stage: 'awareness' }), asset({ funnel_stage: 'awareness' }), asset({ funnel_stage: 'awareness' })]);
    const d = dim(a, 'buyer_journey_coverage');
    expect(d.score).toBe(Math.round((1 / BUYER_JOURNEY_STAGES.length) * 100));
    expect(d.detail).toMatch(/missing/);
    expect(a.recommendations.some((r) => r.dimension === 'buyer_journey_coverage')).toBe(true);
  });

  it('buyer journey: full coverage scores 100', () => {
    const a = assessCampaignQuality(BUYER_JOURNEY_STAGES.map((s, i) => asset({ funnel_stage: s, topic_title: `T${i}`, week: i + 1 })));
    expect(dim(a, 'buyer_journey_coverage').score).toBe(100);
  });

  it('platform fit: flags a format that cannot run on its platform', () => {
    // poll↛X is blocked by the canonical eligibility authority
    const a = assessCampaignQuality([asset({ content_type: 'poll', platform: 'x' }), asset({ content_type: 'post', platform: 'linkedin' })]);
    expect(dim(a, 'platform_fit').score).toBeLessThan(100);
    expect(a.recommendations.some((r) => r.dimension === 'platform_fit')).toBe(true);
  });

  it('platform fit: all-eligible pairs score 100', () => {
    const a = assessCampaignQuality([asset({ content_type: 'post', platform: 'linkedin' }), asset({ content_type: 'carousel', platform: 'instagram' })]);
    expect(dim(a, 'platform_fit').score).toBe(100);
  });

  it('content-type balance: overuse of one format is flagged', () => {
    const a = assessCampaignQuality(Array.from({ length: 5 }, (_, i) => asset({ content_type: 'carousel', platform: 'instagram', cta: `c${i}`, topic_title: `T${i}` })));
    expect(dim(a, 'content_type_balance').score).toBeLessThan(55);
    expect(a.recommendations.some((r) => r.dimension === 'content_type_balance' && /carousel/i.test(r.message))).toBe(true);
  });

  it('master-idea diversity: same message across ideas scores low', () => {
    const a = assessCampaignQuality([
      asset({ master_idea_id: 'mi_1', idea_fingerprint: 'same' }),
      asset({ master_idea_id: 'mi_2', idea_fingerprint: 'same' }),
      asset({ master_idea_id: 'mi_3', idea_fingerprint: 'same' }),
    ]);
    expect(dim(a, 'master_idea_diversity').score).toBeLessThan(70);
    expect(a.recommendations.some((r) => r.dimension === 'master_idea_diversity')).toBe(true);
  });

  it('audience balance: all-same-audience is noted (info, not a failure)', () => {
    const a = assessCampaignQuality(Array.from({ length: 4 }, (_, i) => asset({ audience: 'RevOps', cta: `c${i}`, topic_title: `T${i}` })));
    expect(dim(a, 'audience_balance').score).toBeLessThanOrEqual(60);
    expect(a.recommendations.some((r) => r.dimension === 'audience_balance' && r.severity === 'info')).toBe(true);
  });

  it('fatigue risk: near-identical hooks/headlines lower the score', () => {
    const a = assessCampaignQuality(Array.from({ length: 5 }, () => asset({ topic_title: 'Same headline', hook: 'Same hook', idea_fingerprint: 'same' })));
    expect(dim(a, 'fatigue_risk').score).toBeLessThan(60);
    expect(a.recommendations.some((r) => r.dimension === 'fatigue_risk')).toBe(true);
  });

  it('narrative progression: stages that build across weeks score higher than shuffled', () => {
    const building = assessCampaignQuality([
      asset({ week: 1, funnel_stage: 'awareness' }),
      asset({ week: 2, funnel_stage: 'consideration' }),
      asset({ week: 3, funnel_stage: 'decision' }),
    ]);
    const shuffled = assessCampaignQuality([
      asset({ week: 1, funnel_stage: 'decision' }),
      asset({ week: 2, funnel_stage: 'awareness' }),
      asset({ week: 3, funnel_stage: 'consideration' }),
    ]);
    expect(dim(building, 'narrative_progression').score).toBeGreaterThan(dim(shuffled, 'narrative_progression').score);
  });
});

describe('overall + recommendations', () => {
  it('a well-balanced campaign grades good/excellent with few recommendations', () => {
    const good = assessCampaignQuality([
      asset({ week: 1, content_type: 'article', platform: 'linkedin', funnel_stage: 'awareness', cta: 'Read more', theme: 'Problem', master_idea_id: 'm1', idea_fingerprint: 'i1', topic_title: 'A', hook: 'hA', cta_fingerprint: 'x1' }),
      asset({ week: 2, content_type: 'carousel', platform: 'instagram', funnel_stage: 'consideration', cta: 'Compare', theme: 'Solution', master_idea_id: 'm2', idea_fingerprint: 'i2', topic_title: 'B', hook: 'hB', cta_fingerprint: 'x2' }),
      asset({ week: 3, content_type: 'post', platform: 'facebook', funnel_stage: 'decision', cta: 'Book a demo', theme: 'Proof', master_idea_id: 'm3', idea_fingerprint: 'i3', topic_title: 'C', hook: 'hC', cta_fingerprint: 'x3' }),
      asset({ week: 4, content_type: 'newsletter', platform: 'linkedin', funnel_stage: 'retention', cta: 'Subscribe', theme: 'Adoption', master_idea_id: 'm4', idea_fingerprint: 'i4', topic_title: 'D', hook: 'hD', cta_fingerprint: 'x4' }),
    ]);
    expect(good.overall).toBeGreaterThanOrEqual(70);
    expect(['good', 'excellent']).toContain(good.grade);
  });

  it('a monotonous campaign grades lower and yields multiple recommendations', () => {
    const bad = assessCampaignQuality(Array.from({ length: 6 }, (_, i) => asset({
      week: (i % 3) + 1, content_type: 'carousel', platform: 'instagram', funnel_stage: 'awareness',
      cta: 'Book a demo', theme: 'Onboarding', master_idea_id: `m${i}`, idea_fingerprint: 'same',
      topic_title: 'Same', hook: 'Same', cta_fingerprint: 'same',
    })));
    expect(bad.overall).toBeLessThan(60);
    expect(bad.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  it('scales to a large campaign without error', () => {
    const many = Array.from({ length: 200 }, (_, i) => asset({ week: (i % 12) + 1, content_type: ['post', 'article', 'carousel', 'poll'][i % 4], platform: ['linkedin', 'facebook', 'instagram'][i % 3], cta: `c${i % 7}`, topic_title: `T${i}` }));
    const a = assessCampaignQuality(many);
    expect(a.asset_count).toBe(200);
    expect(a.dimensions).toHaveLength(9);
  });
});

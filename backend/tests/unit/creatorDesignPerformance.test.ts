import {
  buildDesignAttribution, stampDesignAttribution, readDesignAttribution, isAttributed, DESIGN_ATTRIBUTION_KEY,
} from '../../../lib/creator-templates/designAttribution';
import {
  type AssetPerformance,
  aggregateTemplateMetrics, aggregateCollectionMetrics, aggregateFamilyMetrics,
  scorePerformance, toHistoricalCompatibility, performanceReasons, weakAssetFamilies,
} from '../../../lib/creator-templates/designPerformance';
import { buildCampaignPerformance } from '../../../backend/services/creator/designPerformanceService';

const attr = (templateId: string, collectionId: string) => buildDesignAttribution({
  campaignId: 'camp', campaignDesignSystemId: 'cds:camp', collectionId, collectionVersion: 1, templateId, templateVersion: 1,
});
const asset = (over: Partial<AssetPerformance> & { attribution: AssetPerformance['attribution'] }): AssetPerformance => ({
  platform: 'linkedin', assetFamily: 'image', impressions: 1000, reach: 900, engagement: 70, clicks: 40, saves: 25, shares: 12, comments: 5, conversions: 30, ...over,
});

const ASSETS: AssetPerformance[] = [
  asset({ attribution: attr('t1', 'c1') }),
  asset({ attribution: attr('t1', 'c1') }),
  asset({ attribution: attr('t2', 'c1'), assetFamily: 'carousel', platform: 'instagram', engagement: 10, clicks: 5, saves: 2, shares: 1, comments: 1, conversions: 1 }),
];

describe('Design Attribution — immutable stamp', () => {
  it('stamps, reads, and is immutable once set', () => {
    const a = attr('t1', 'c1');
    const stamped = stampDesignAttribution({ topic: 'x' }, a);
    expect(stamped.topic).toBe('x');
    expect(readDesignAttribution(stamped)?.templateId).toBe('t1');
    // Re-stamp with different values must NOT overwrite (provenance preserved).
    const restamped = stampDesignAttribution(stamped, attr('OTHER', 'OTHER'));
    expect(readDesignAttribution(restamped)?.templateId).toBe('t1');
    expect(Object.isFrozen((stamped as any)[DESIGN_ATTRIBUTION_KEY])).toBe(true);
  });
  it('isAttributed requires a template id', () => {
    expect(isAttributed(attr('t1', 'c1'))).toBe(true);
    expect(isAttributed(buildDesignAttribution({ campaignId: 'c' }))).toBe(false);
  });
});

describe('Design Performance — aggregation + scoring', () => {
  it('rolls up by template / collection deterministically', () => {
    const t = aggregateTemplateMetrics(ASSETS);
    expect(t.map((r) => r.key)).toEqual(['t1', 't2']); // sorted by key
    const t1 = t.find((r) => r.key === 't1')!;
    expect(t1.assetCount).toBe(2);
    expect(t1.impressions).toBe(2000);
    expect(t1.ctr).toBeCloseTo(0.04, 5);
    const c1 = aggregateCollectionMetrics(ASSETS).find((r) => r.key === 'c1')!;
    expect(c1.assetCount).toBe(3);
  });

  it('scores high for strong rates, 0 for no impressions, and is deterministic', () => {
    const t1 = aggregateTemplateMetrics(ASSETS).find((r) => r.key === 't1')!;
    const s = scorePerformance(t1);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.components.length).toBe(5);
    expect(s.explanation).toContain('Score');
    expect(JSON.stringify(scorePerformance(t1))).toBe(JSON.stringify(s));
    expect(scorePerformance({ ...t1, impressions: 0 }).score).toBe(0);
  });

  it('maps collection rollups to historical compatibility (0–20)', () => {
    const hc = toHistoricalCompatibility(aggregateCollectionMetrics(ASSETS));
    expect(hc.c1).toBeGreaterThan(0);
    expect(hc.c1).toBeLessThanOrEqual(20);
  });

  it('derives deterministic measured reasons', () => {
    const c1 = aggregateCollectionMetrics(ASSETS).find((r) => r.key === 'c1')!;
    const reasons = performanceReasons(c1, { isTopPerformer: true, audience: 'executive' });
    expect(reasons).toContain('Best performing');
    expect(reasons).toContain('High CTR on Linkedin');
  });

  it('flags weak + absent families', () => {
    const fams = aggregateFamilyMetrics(ASSETS);
    const weak = weakAssetFamilies(fams, ['image', 'carousel', 'infographic']);
    expect(weak).toContain('carousel');      // measured but under-performing
    expect(weak).toContain('infographic');   // required but absent
    expect(weak).not.toContain('image');     // strong
  });
});

describe('Design Performance — campaign payload', () => {
  it('builds a deterministic dashboard payload', () => {
    const p = buildCampaignPerformance(ASSETS, ['image', 'carousel', 'infographic']);
    expect(p.assetCount).toBe(3);
    expect(p.templates[0]!.key).toBe('t1'); // highest score first
    expect(p.weakFamilies).toContain('infographic');
    expect(p.recommendations.length).toBeGreaterThan(0);
    expect(JSON.stringify(buildCampaignPerformance(ASSETS, ['image', 'carousel', 'infographic']))).toBe(JSON.stringify(p));
  });
  it('returns an empty-data payload gracefully', () => {
    const p = buildCampaignPerformance([], ['image']);
    expect(p.assetCount).toBe(0);
    expect(p.recommendations[0]).toContain('No measured performance');
  });
});

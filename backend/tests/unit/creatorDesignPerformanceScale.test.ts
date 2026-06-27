import { buildDesignAttribution } from '../../../lib/creator-templates/designAttribution';
import { aggregateCollectionMetrics, toHistoricalCompatibility, type AssetPerformance } from '../../../lib/creator-templates/designPerformance';
import { buildCampaignPerformance } from '../../../backend/services/creator/designPerformanceService';

/**
 * The N+1 → single-JOIN change in loadAssetPerformance alters only ONE
 * observable thing: the ORDER in which (post, analytics) rows arrive. The pure
 * aggregation is unchanged, so the safety proof is: rollups + scores +
 * historicalCompatibility are byte-identical under ANY row ordering, at every
 * scale. (Deterministic permutations — no randomness — so the test never flakes.)
 */

const TEMPLATES = ['t1', 't2', 't3', 't4', 't5'];
const COLLECTIONS = ['c1', 'c2'];
const FAMILIES = ['image', 'carousel', 'infographic'];
const PLATFORMS = ['linkedin', 'instagram'];

function gen(n: number): AssetPerformance[] {
  const a: AssetPerformance[] = [];
  for (let i = 0; i < n; i++) {
    a.push({
      attribution: buildDesignAttribution({
        campaignId: 'camp', campaignDesignSystemId: 'cds:camp',
        collectionId: COLLECTIONS[i % COLLECTIONS.length], collectionVersion: 1,
        templateId: TEMPLATES[i % TEMPLATES.length], templateVersion: 1,
      }),
      assetFamily: FAMILIES[i % FAMILIES.length],
      platform: PLATFORMS[i % PLATFORMS.length],
      impressions: 100 + (i % 7) * 13,
      reach: 90 + (i % 5),
      engagement: 5 + (i % 5),
      clicks: 1 + (i % 4),
      saves: i % 3,
      shares: i % 2,
      comments: i % 4,
      conversions: i % 6,
    });
  }
  return a;
}

// Deterministic permutations (model the JOIN returning rows in a different order).
const reverse = <T>(a: T[]): T[] => [...a].reverse();
const rotate = <T>(a: T[], k: number): T[] => [...a.slice(k), ...a.slice(0, k)];
const stride = <T>(a: T[]): T[] => { const out: T[] = []; for (let s = 0; s < 3; s++) for (let i = s; i < a.length; i += 3) out.push(a[i]!); return out; };

describe('Design Performance — N+1 → single JOIN: order-independent + identical at scale', () => {
  for (const n of [10, 100, 1000, 10000]) {
    it(`${n} assets → byte-identical rollups under any row ordering`, () => {
      const assets = gen(n);
      const baseline = JSON.stringify(buildCampaignPerformance(assets, ['image', 'carousel', 'infographic']));
      // Any ordering the single JOIN could return must yield identical output.
      for (const perm of [reverse(assets), rotate(assets, 7), stride(assets), rotate(reverse(assets), 3)]) {
        expect(JSON.stringify(buildCampaignPerformance(perm, ['image', 'carousel', 'infographic']))).toBe(baseline);
      }
    });
  }

  it('template / collection / campaign-design / family aggregations are byte-identical regardless of order', () => {
    const assets = gen(1000);
    const a = buildCampaignPerformance(assets);
    const b = buildCampaignPerformance(stride(reverse(assets)));
    expect(JSON.stringify(a.templates)).toBe(JSON.stringify(b.templates));
    expect(JSON.stringify(a.collections)).toBe(JSON.stringify(b.collections));
    expect(JSON.stringify(a.campaignDesign)).toBe(JSON.stringify(b.campaignDesign));
    expect(JSON.stringify(a.weakFamilies)).toBe(JSON.stringify(b.weakFamilies));
  });

  it('strategist historicalCompatibility is unchanged under reordering', () => {
    const assets = gen(500);
    const hc1 = toHistoricalCompatibility(aggregateCollectionMetrics(assets));
    const hc2 = toHistoricalCompatibility(aggregateCollectionMetrics(stride(rotate(assets, 11))));
    expect(JSON.stringify(hc1)).toBe(JSON.stringify(hc2));
    expect(Object.keys(hc1).sort()).toEqual(['c1', 'c2']);
  });

  it('aggregation is deterministic (same input → identical output)', () => {
    const assets = gen(256);
    expect(JSON.stringify(buildCampaignPerformance(assets))).toBe(JSON.stringify(buildCampaignPerformance(assets)));
  });
});

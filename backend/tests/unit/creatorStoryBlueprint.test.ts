import { getTemplateById, listTemplatesForFamily, type CreatorTemplate } from '../../../lib/creator-templates';
import {
  resolveStoryBlueprint, buildStoryBlueprintMetadata, blueprintCoverage, blueprintReasons,
  STORY_BLUEPRINTS, STORY_BLUEPRINT_IDS, CORE_BLUEPRINTS, type StoryBlueprintId,
} from '../../../lib/creator-templates/storyBlueprint';
import { aggregateBlueprintMetrics, type AssetPerformance } from '../../../lib/creator-templates/designPerformance';
import { buildDesignAttribution } from '../../../lib/creator-templates/designAttribution';

const tpl = (over: Partial<CreatorTemplate> & { id: string }): CreatorTemplate => ({
  assetFamily: 'carousel', name: '', category: 'C', description: '',
  preview: { thumbnailUrl: null, sampleAssetUrl: null, sample: {} },
  visualLanguage: {}, formDefinition: { fields: [] }, renderingContract: { renderingContractVersion: 'v', family: 'carousel' },
  version: 1, status: 'draft', ownership: 'system', tags: [], metadata: {}, ...over,
});

describe('Story Blueprint — deterministic resolution', () => {
  it('maps EVERY system template to exactly one blueprint', () => {
    for (const f of ['image', 'carousel', 'infographic'] as const) {
      for (const t of listTemplatesForFamily(f)) {
        const bp = resolveStoryBlueprint(t);
        expect(STORY_BLUEPRINT_IDS).toContain(bp.id);
        expect(bp.narrativeFlow.length).toBeGreaterThan(2);
      }
    }
  });

  it('derives blueprint from template signals (keyword → blueprint)', () => {
    expect(resolveStoryBlueprint(tpl({ id: 'a', name: 'Case Study Carousel' })).id).toBe('case-study');
    expect(resolveStoryBlueprint(tpl({ id: 'b', name: 'Step-by-step guide' })).id).toBe('step-by-step');
    expect(resolveStoryBlueprint(tpl({ id: 'c', name: 'Myth vs Fact' })).id).toBe('myth-vs-fact');
    expect(resolveStoryBlueprint(tpl({ id: 'd', name: 'Comparison: A vs B' })).id).toBe('comparison');
    expect(resolveStoryBlueprint(tpl({ id: 'e', name: 'Quarterly statistics', assetFamily: 'infographic', renderingContract: { renderingContractVersion: 'v', family: 'infographic', infographicLayout: 'stats' } })).id).toBe('statistics');
  });

  it('explicit metadata.storyBlueprint wins', () => {
    expect(resolveStoryBlueprint(tpl({ id: 'f', name: 'Anything', metadata: { storyBlueprint: 'roadmap' } })).id).toBe('roadmap');
  });

  it('falls back to a family default deterministically', () => {
    expect(resolveStoryBlueprint(tpl({ id: 'g', name: 'Untitled', assetFamily: 'image', renderingContract: { renderingContractVersion: 'v', family: 'image' } })).id).toBe('thought-leadership');
    const t = tpl({ id: 'g2', name: 'Untitled' });
    expect(resolveStoryBlueprint(t).id).toBe(resolveStoryBlueprint(t).id); // deterministic
  });

  it('builds full blueprint metadata', () => {
    const m = buildStoryBlueprintMetadata(tpl({ id: 'h', name: 'Educational 101' }));
    expect(m.storyBlueprint).toBe('educational');
    expect(m.communicationGoal).toBe('educate');
    expect(m.primarySlideStructure).toContain('→');
    expect(m.recommendedPlatforms.length).toBeGreaterThan(0);
  });
});

describe('Story Blueprint — coverage + reasons', () => {
  it('reports present / duplicate / missing against the core set', () => {
    const set = [tpl({ id: '1', name: 'Educational' }), tpl({ id: '2', name: 'Educational basics' }), tpl({ id: '3', name: 'Case Study' })];
    const cov = blueprintCoverage(set);
    expect(cov.present).toContain('educational');
    expect(cov.duplicates).toContain('educational'); // two educational members
    expect(cov.missing).toContain('comparison');     // core but absent
  });

  it('produces deterministic blueprint reasons', () => {
    const t = tpl({ id: 'r', name: 'Case Study', metadata: { storyBlueprint: 'case-study' } });
    const reasons = blueprintReasons(t, { campaignGoal: 'conversion', platform: 'linkedin', audience: 'executive' });
    expect(reasons.some((x) => /Case Study structure performs well for Conversion/.test(x))).toBe(true);
    expect(reasons).toContain('Optimized for Linkedin');
    expect(reasons.some((x) => /Executive audiences/.test(x))).toBe(true);
  });
});

describe('Story Blueprint — performance rollup', () => {
  it('aggregates measured performance by blueprint via injected resolver', () => {
    const a = (templateId: string): AssetPerformance => ({
      attribution: buildDesignAttribution({ templateId, collectionId: 'c', campaignId: 'camp' }),
      platform: 'linkedin', impressions: 1000, reach: 900, engagement: 70, clicks: 40, saves: 25, shares: 12, comments: 5, conversions: 30,
    });
    const blueprintOf = (id: string | null): string | null => (id === 't1' ? 'educational' : id === 't2' ? 'case-study' : null);
    const rolls = aggregateBlueprintMetrics([a('t1'), a('t1'), a('t2')], blueprintOf);
    const byKey = Object.fromEntries(rolls.map((r) => [r.key, r.assetCount]));
    expect(byKey['educational']).toBe(2);
    expect(byKey['case-study']).toBe(1);
  });
});

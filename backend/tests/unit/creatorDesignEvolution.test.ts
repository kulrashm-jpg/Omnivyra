import type { PerfRollup } from '../../../lib/creator-templates/designPerformance';
import { analyzeEvolution, type EvolutionInput, type TemplatePerfInput } from '../../../lib/creator-templates/designEvolution';

const roll = (key: string, over: Partial<PerfRollup> = {}): PerfRollup => ({
  key, assetCount: 4, impressions: 2000, reach: 1800, engagement: 140, clicks: 80, saves: 40, shares: 20, comments: 10, conversions: 60,
  engagementRate: 0.07, ctr: 0.04, saveRate: 0.02, shareRate: 0.01, conversionRate: 0.75, byPlatform: [{ platform: 'linkedin', impressions: 2000, clicks: 80, engagement: 140, ctr: 0.04, engagementRate: 0.07 }], ...over,
});
const member = (templateId: string, family: string, rollup: PerfRollup, score: number, diagnostic: TemplatePerfInput['diagnostic'] = null): TemplatePerfInput => ({ templateId, family: family as any, rollup, score, diagnostic });

const base = (over: Partial<EvolutionInput>): EvolutionInput => ({
  collectionId: 'col-1', members: [], presentFamilies: [], requiredFamilies: ['image', 'carousel', 'infographic'], visualConsistency: 'strong', ...over,
});

describe('Design Evolution Engine — deterministic analysis', () => {
  it('recommends replacing a low performer with a high performer in the same family', () => {
    const input = base({
      members: [
        member('good', 'image', roll('good'), 92),
        member('bad', 'image', roll('bad', { ctr: 0.02, engagementRate: 0.035, conversionRate: 0.05, engagement: 50, conversions: 5 }), 30),
      ],
      presentFamilies: ['image'], requiredFamilies: ['image'],
    });
    const a = analyzeEvolution(input);
    const replace = a.recommendations.find((r) => r.type === 'replace_template');
    expect(replace).toBeTruthy();
    expect(replace!.action).toEqual({ op: 'replace', templateId: 'bad', replacementTemplateId: 'good' });
    expect(replace!.evidence.length).toBeGreaterThan(0);
    expect(replace!.impactedMetrics).toContain('CTR');
    expect(['low', 'medium', 'high']).toContain(replace!.confidence.level);
  });

  it('recommends creating missing asset families', () => {
    const a = analyzeEvolution(base({ members: [member('i', 'image', roll('i'), 80)], presentFamilies: ['image'] }));
    const types = a.recommendations.map((r) => r.type);
    expect(types).toContain('create_carousel');
    expect(types).toContain('add_infographic');
    expect(a.weaknesses.some((w) => w.includes('carousel'))).toBe(true);
  });

  it('flags diagnostic failures with full confidence', () => {
    const a = analyzeEvolution(base({
      members: [member('t', 'image', roll('t'), 80, { reportVersion: 'v1', visualValidation: { passed: false } })],
      presentFamilies: ['image', 'carousel', 'infographic'], requiredFamilies: ['image'],
    }));
    const fix = a.recommendations.find((r) => r.type === 'fix_diagnostics');
    expect(fix).toBeTruthy();
    expect(fix!.confidence.level).toBe('high');
  });

  it('retires a persistent low performer with no replacement', () => {
    const a = analyzeEvolution(base({
      members: [member('weak', 'image', roll('weak', { ctr: 0.02, engagementRate: 0.04, engagement: 60, conversions: 8 }), 25)],
      presentFamilies: ['image'], requiredFamilies: ['image'],
    }));
    expect(a.recommendations.some((r) => r.type === 'retire_template' && r.action?.op === 'remove')).toBe(true);
  });

  it('is deterministic and sorts by confidence', () => {
    const input = base({ members: [member('i', 'image', roll('i'), 80)], presentFamilies: ['image'] });
    const a1 = analyzeEvolution(input);
    const a2 = analyzeEvolution(input);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    for (let i = 1; i < a1.recommendations.length; i++) {
      expect(a1.recommendations[i - 1]!.confidence.value).toBeGreaterThanOrEqual(a1.recommendations[i]!.confidence.value);
    }
  });

  it('produces no recommendations when nothing is measured', () => {
    const a = analyzeEvolution(base({ members: [member('i', 'image', roll('i', { impressions: 0 }), 0)], presentFamilies: ['image', 'carousel', 'infographic'], requiredFamilies: ['image'] }));
    expect(a.recommendations.filter((r) => r.type !== 'create_carousel' && r.type !== 'add_infographic')).toEqual([]);
  });
});

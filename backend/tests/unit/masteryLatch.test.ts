import { buildMasterySignals } from '../../../lib/mastery/buildMasterySignals';
import { MASTERY_REGISTRY, type MasterySignals } from '../../../config/masteryRegistry';
import { evaluateCapabilityRegistry } from '../../../lib/shared/capabilityRegistry';

const feature = (key: string, score = 1) => ({ key, status: score >= 1 ? 'completed' : 'in_progress', score } as any);

const rawBase = {
  profile: null,
  blogsCount: 0,
  campaignsCount: 0,
  reportsCount: 0,
  mediaCount: 0,
  templatesCount: 0,
  teamSummary: null,
  automation: null,
  websiteSnapshot: null,
};

describe('Mastery latch — once used = forever', () => {
  it('credits a campaign as completed via the latched feature even when the live count is 0', () => {
    const sig = buildMasterySignals({ ...rawBase, features: [feature('campaign_created')] } as any);
    expect(sig.campaign.completed.count).toBeGreaterThanOrEqual(1);
  });

  it('credits published content / AI assets / reports from their latched features', () => {
    const sig = buildMasterySignals({
      ...rawBase,
      features: [feature('blog_created'), feature('content_creator'), feature('report_generated')],
    } as any);
    expect(sig.content.published.count).toBeGreaterThanOrEqual(1);
    expect(sig.ai.assets.count).toBeGreaterThanOrEqual(1);
    expect(sig.analytics.reports.count).toBeGreaterThanOrEqual(1);
  });

  it('does not fabricate credit when a capability was never used', () => {
    const sig = buildMasterySignals({ ...rawBase, features: [] } as any);
    expect(sig.campaign.completed.count).toBe(0);
    expect(sig.analytics.reports.count).toBe(0);
    expect(sig.content.published.count).toBe(0);
  });

  it('keeps the higher of live count vs latched floor (depth still counts)', () => {
    const sig = buildMasterySignals({ ...rawBase, campaignsCount: 7, features: [feature('campaign_created')] } as any);
    expect(sig.campaign.completed.count).toBe(7); // live depth wins over the floor of 1
  });

  it('a tiered feature used partially (score>0) still latches as used-once', () => {
    const sig = buildMasterySignals({ ...rawBase, features: [feature('content_writer', 0.5)] } as any);
    expect(sig.content.published.count).toBeGreaterThanOrEqual(1);
  });

  it('Campaign Excellence scores above zero once a campaign has ever been created', () => {
    const signals = buildMasterySignals({ ...rawBase, features: [feature('campaign_created')] } as any) as MasterySignals;
    const def = MASTERY_REGISTRY.find((c) => c.id === 'campaign_excellence')!;
    const cat = evaluateCapabilityRegistry([def], signals).categories[0];
    expect(cat.percent).toBeGreaterThan(0);
  });
});

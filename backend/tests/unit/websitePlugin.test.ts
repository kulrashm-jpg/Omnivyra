/**
 * Phase 27 — Website is Plugin #1. The plugin reads the canonical website snapshot and emits
 * modules + raw recommendation inputs; the registry composes everything via the platform
 * engines. getWebsiteSnapshot is mocked (no DB).
 */
const getWebsiteSnapshot = jest.fn();
jest.mock('../../services/websiteIntelligence/websiteIntelligenceRepository', () => ({ getWebsiteSnapshot: (...a: unknown[]) => getWebsiteSnapshot(...a) }));

import { websitePlugin } from '../../services/websiteIntelligence/websitePlugin';
import { composePluginSnapshot, toPresentationModel } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');

beforeEach(() => getWebsiteSnapshot.mockResolvedValue({
  health: { compositeScore: 72, overall: 'warning', computedAt: '2026-06-01T00:00:00Z' },
  intelligence: {
    content: { contentScore: 65, contentHealth: 'warning', contentWeaknesses: ['Pricing visibility'] },
    technical: { technicalScore: 80, technicalHealth: 'healthy', criticalIssues: [], warnings: ['Internal linking'] },
    accessibility: { accessibilityScore: 55, wcagLevel: 'A', criticalIssues: [] },
    brand: { brandScore: 70, brandHealth: 'warning', brandWeaknesses: [] },
  },
  recommendations: [{ key: 'pricing_visibility', recommendation: 'Publish a pricing page.', originEngine: 'contentIntelligenceEngine', affectedModules: ['content_analysis'], businessImpact: 'medium', confidence: 0.8 }],
}));

describe('Phase 27 — Website plugin (#1)', () => {
  it('provide() maps the website snapshot into platform modules + raw inputs', async () => {
    const data = await websitePlugin.provide({ companyId: 'co1', nowMs: NOW });
    expect(data.modules.map((m) => m.key)).toEqual(['website_health', 'content', 'technical', 'accessibility', 'brand']);
    expect(data.modules.find((m) => m.key === 'technical')!.score).toBe(80);
    expect(data.score).toBe(72);
    expect(data.recommendationInputs[0]!.key).toBe('pricing_visibility');
  });

  it('composes through the platform engines via the registry', async () => {
    const snap = await composePluginSnapshot(websitePlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Website scores')).toBe(true);
    expect(snap.recommendations.length).toBeGreaterThan(0);
    expect(toPresentationModel(snap).modules.length).toBe(5);
  });

  it('is registered with id "website" reusing the website impact config', () => {
    expect(websitePlugin.id).toBe('website');
    expect(websitePlugin.impactConfig.graph.pricing_visibility).toBeDefined();
  });
});

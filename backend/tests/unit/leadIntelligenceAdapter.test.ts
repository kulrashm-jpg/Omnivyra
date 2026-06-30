/**
 * Phase 21C — Lead Intelligence is Consumer #2 of the Platform Intelligence Framework.
 * Proves the adapter composes EXISTING lead stats through the platform engines (executive
 * summary, business impact, recommendations, roadmap, confidence, freshness, presentation
 * model) — no new intelligence, no duplicated builders. Lead engines are mocked.
 */
const getLeadStats = jest.fn();
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => ({ getLeadStats: (...a: unknown[]) => getLeadStats(...a) }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(async () => ({ companyId: 'co1', activated: false, generatedAt: '2026-06-01T00:00:00Z', checks: [
    { id: 'leads', label: 'Leads', done: false, detail: '', nextActionHref: '/lead-capture', nextActionLabel: 'Configure lead capture' },
  ] })),
}));

import { buildLeadIntelligenceSnapshot, buildLeadPresentationModel } from '../../services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import { renderIntelligenceHtml } from '../../services/platformIntelligence/htmlRenderer';

const NOW = Date.parse('2026-06-10T00:00:00Z');

describe('Phase 21C — Lead Intelligence adapter (Consumer #2)', () => {
  beforeEach(() => getLeadStats.mockResolvedValue({ total: 20, bySource: {}, byStatus: {}, intentBands: { high: 2, medium: 6, low: 12 }, withIdentity: 8, withCampaign: 5 }));

  it('composes existing lead stats through the platform engines', async () => {
    const snap = await buildLeadIntelligenceSnapshot('co1', NOW);
    expect(snap.modules.map((m) => m.key)).toEqual(['buying_intent', 'identity', 'attribution', 'pipeline', 'lead_readiness']);
    // platform executive engine — entity label is Lead pipeline (not Website)
    expect(snap.executiveSummary.headline.startsWith('Lead pipeline scores')).toBe(true);
    // platform business-impact engine (lead config) — recommendations carry cascades
    const lowIntent = snap.recommendations.find((r) => r.recommendation.includes('buying intent'));
    expect(lowIntent?.impact.cascade).toContain('Lower revenue confidence');
    expect(lowIntent?.affectedModules).toContain('buying_intent');
    // platform roadmap engine — 30/60/90
    expect(snap.roadmap.map((r) => r.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(typeof snap.confidence).toBe('number');
    expect(snap.businessImpact.summary).toBeDefined();
  });

  it('builds the platform presentation model + renders via the platform HTML renderer', async () => {
    const snap = await buildLeadIntelligenceSnapshot('co1', NOW);
    const model = buildLeadPresentationModel(snap);
    expect(model.executiveSummary?.statusToken).toBeDefined();
    expect(model.modules[0]!.scoreToken).toBeDefined();
    expect(model.roadmap.map((r) => r.label)).toEqual(['30 days', '60 days', '90 days']);
    const html = renderIntelligenceHtml(model);
    expect(html).toContain('Executive Summary');
    expect(html).toMatch(/background:#[0-9a-f]{6}/i);
  });

  it('is fail-open with an empty pipeline', async () => {
    getLeadStats.mockResolvedValue({ total: 0, bySource: {}, byStatus: {}, intentBands: { high: 0, medium: 0, low: 0 }, withIdentity: 0, withCampaign: 0 });
    const snap = await buildLeadIntelligenceSnapshot('co1', NOW);
    expect(snap.health.overall).toBe('disconnected');
    expect(snap.recommendations.some((r) => r.recommendation.includes('empty'))).toBe(true);
  });
});

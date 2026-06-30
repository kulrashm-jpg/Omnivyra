/**
 * Phase 21D — Platform Intelligence plugin registry + auto-discovery + extensibility.
 * Proves Phase O: a newly registered plugin appears and composes through the platform
 * engines WITHOUT touching reports/renderers/UI; unregistering removes it cleanly.
 */
import { registerPlugin, unregisterPlugin, getPlugins, getPluginsForReport, getPluginsForDashboard, composePluginSnapshot, toPresentationModel, renderPluginHtml, type IntelligencePlugin } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');

const dummyPlugin: IntelligencePlugin = {
  id: 'dummy', displayName: 'Dummy Intelligence', domain: 'dummy', entityLabel: 'Dummy',
  supportedReports: ['snapshot'], supportedDashboards: ['dummy'],
  impactConfig: {
    graph: { dummy_gap: { dimensions: { revenue: 60 }, cascade: ['Dummy gap', 'Lower revenue'] } },
    moduleDimensions: { dummy: { revenue: 50 } },
    dimensionTail: { revenue: 'revenue' },
  },
  provide: async () => ({
    modules: [{ key: 'dummy', label: 'Dummy', source: 'dummy', score: 40, status: 'partial', available: true, findings: ['x'], lastUpdated: '2026-06-01T00:00:00Z' }],
    recommendationInputs: [{ key: 'dummy_gap', text: 'Fix the dummy gap.', source: 'dummy', module: 'dummy', impactLevel: 'medium', confidence: 0.8 }],
    score: 40, lastUpdated: '2026-06-01T00:00:00Z',
  }),
};

describe('Phase 21D — plugin registry', () => {
  it('a newly registered plugin appears + composes via the platform engines (Phase O)', async () => {
    registerPlugin(dummyPlugin);
    expect(getPlugins().some((p) => p.id === 'dummy')).toBe(true);
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'dummy')).toBe(true);

    const snap = await composePluginSnapshot(dummyPlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Dummy scores')).toBe(true);
    expect(snap.recommendations[0]!.impact.cascade).toContain('Lower revenue');
    expect(snap.roadmap.map((r) => r.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(typeof snap.confidence).toBe('number');

    const model = toPresentationModel(snap);
    expect(model.modules[0]!.scoreToken).toBeDefined();
    const html = await renderPluginHtml(dummyPlugin, 'co1', NOW);
    expect(html).toContain('Executive Summary');
  });

  it('unregistering removes it — registration is the only wiring (Phase L)', () => {
    unregisterPlugin('dummy');
    expect(getPlugins().some((p) => p.id === 'dummy')).toBe(false);
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'dummy')).toBe(false);
  });

  it('Phase K — a temporary Customer Success plugin appears in report + dashboard discovery, then deletes cleanly', async () => {
    const customerSuccess: IntelligencePlugin = {
      id: 'customer_success', displayName: 'Customer Success', domain: 'customer_success', entityLabel: 'Customer Success',
      supportedReports: ['snapshot', 'growth'], supportedDashboards: ['customer-success', 'command-center'],
      impactConfig: { graph: { churn_risk: { dimensions: { retention: 70, revenue: 60 }, cascade: ['Churn risk', 'Lower retention', 'Lower revenue'] } }, moduleDimensions: { health: { retention: 60 } }, dimensionTail: { retention: 'retention', revenue: 'revenue' } },
      provide: async () => ({ modules: [{ key: 'health', label: 'Account Health', source: 'cs', score: 55, status: 'partial', available: true, findings: ['2 accounts at risk'], lastUpdated: '2026-06-01T00:00:00Z' }], recommendationInputs: [{ key: 'churn_risk', text: 'Engage at-risk accounts.', source: 'cs', module: 'health', impactLevel: 'high', confidence: 0.9 }], score: 55, lastUpdated: '2026-06-01T00:00:00Z' }),
    };
    registerPlugin(customerSuccess);
    // Appears automatically in BOTH report and dashboard discovery — no report/dashboard edits.
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'customer_success')).toBe(true);
    expect(getPluginsForDashboard('command-center').some((p) => p.id === 'customer_success')).toBe(true);
    const snap = await composePluginSnapshot(customerSuccess, 'co1', NOW);
    expect(snap.recommendations[0]!.impact.cascade).toContain('Lower retention');
    expect(toPresentationModel(snap).modules[0]!.label).toBe('Account Health');
    expect(await renderPluginHtml(customerSuccess, 'co1', NOW)).toContain('Executive Summary');
    // Delete — nothing outside the registry changes.
    unregisterPlugin('customer_success');
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'customer_success')).toBe(false);
    expect(getPluginsForDashboard('command-center').some((p) => p.id === 'customer_success')).toBe(false);
  });
});

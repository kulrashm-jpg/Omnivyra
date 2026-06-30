/**
 * Phase 18 — canonical Website Intelligence Repository façade. Composes existing
 * services (all mocked), owns validation + recommendation dedup + module registry +
 * summary + freshness. No business logic is duplicated; this proves the composition.
 */
jest.mock('../../services/websiteHealthScoreService', () => ({
  computeWebsiteHealthScore: jest.fn(async () => ({
    company_id: 'co1', website_id: 'w1', composite_score: 80,
    category_scores: { tracking_health: 90, cms_health: 60, publishing_reliability: 100, attribution_readiness: 80, conversion_readiness: 70, integration_reliability: 90, form_health: 55, domain_verification: 90 },
    issues: [{ key: 'cms_health', score: 60, severity: 'medium' }],
    recommendations: [{ key: 'tracking', recommendation: 'Install the tracking script' }],
    improvement_priorities: [{ category: 'form_health', score: 55 }],
    computed_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  })),
}));
jest.mock('../../services/integrationHealthService', () => ({
  getWebsiteHealthSummary: jest.fn(async () => ({ connections: [{ id: 'c1', provider: 'wordpress', status: 'connected', health_status: 'healthy', last_error: null, last_sync_at: '2026-06-01T00:00:00Z' }], tracking_last_seen_at: '2026-06-01T00:00:00Z', failed_publish_count: 0 })),
  deriveIntegrationHealth: jest.fn(() => ({ state: 'healthy', score: 90, reasons: [], last_success_at: '2026-06-01T00:00:00Z', last_failure_at: null, last_error_message: null })),
}));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(async () => ({ companyId: 'co1', activated: true, generatedAt: '2026-06-01T00:00:00Z', checks: [
    { id: 'leads', label: 'Leads', done: true, detail: '', nextActionHref: '/lead-capture', nextActionLabel: 'Configure lead capture' },
    { id: 'cms', label: 'CMS', done: false, detail: '', nextActionHref: '/website-setup', nextActionLabel: 'Connect a CMS' },
    { id: 'analytics', label: 'Analytics', done: true, detail: '', nextActionHref: '/integrations', nextActionLabel: 'Connect analytics' },
  ] })),
}));
jest.mock('../../services/websiteIntelligenceService', () => ({
  getWebsiteIntelligenceSignals: jest.fn(async () => ([{ signal_key: 'tracking_gap', type: 'tracking', severity: 'medium', confidence: 0.8, recommendation: 'Install the tracking script', metadata: {}, generated_at: '2026-06-02T00:00:00Z', updated_at: '2026-06-02T00:00:00Z' }])),
}));
jest.mock('../../services/integrationService', () => ({
  getIntegrations: jest.fn(async () => ([
    { id: 'i1', type: 'wordpress', name: 'WordPress', status: 'connected', last_tested_at: '2026-06-01T00:00:00Z', last_error: null },
    { id: 'i2', type: 'lead_webhook', name: 'Lead Webhook', status: 'connected', last_tested_at: null, last_error: null },
  ])),
}));
jest.mock('../../services/domainRecordService', () => ({
  getCompanyDomainVerification: jest.fn(async () => ({ final_domain: 'acme.com', verification_status: 'verified', verified: true, verified_at: '2026-05-01T00:00:00Z' })),
}));
const getWebsites = jest.fn(async () => ([{ id: 'w1', name: 'Acme', canonical_url: 'https://acme.com', status: 'active' }]));
jest.mock('../../services/websiteService', () => ({ getWebsites: (...a: unknown[]) => getWebsites(...a) }));
// Phase 18 engines — mocked so the façade test stays DB-free + deterministic.
const freshness = { lastEvaluatedAt: '2026-06-01T00:00:00Z', dataAgeHours: 1, stale: false };
const prov = { sources: [], checksEvaluated: 5, checksTotal: 8, deterministic: true };
jest.mock('../../services/websiteIntelligence/contentIntelligenceEngine', () => ({
  evaluateContentIntelligence: jest.fn(async () => ({ contentScore: 70, contentHealth: 'warning', contentReadiness: 'partial', contentStrengths: [], contentWeaknesses: ['Pricing visibility'], missingContent: ['Pricing visibility'], conversionIssues: [], trustIssues: [], recommendations: [{ key: 'pricing_visibility', recommendation: 'Publish a pricing or plans page.' }], checks: [], confidence: 0.6, freshness, provenance: prov })),
}));
jest.mock('../../services/websiteIntelligence/technicalIntelligenceEngine', () => ({
  evaluateTechnicalIntelligence: jest.fn(async () => ({ technicalScore: 82, technicalHealth: 'healthy', criticalIssues: [], warnings: ['Internal linking'], passedChecks: ['HTTPS'], recommendations: [{ key: 'internal_linking', recommendation: 'Add internal links between related pages.' }], checks: [], confidence: 0.5, freshness, provenance: prov })),
}));
jest.mock('../../services/websiteIntelligence/accessibilityIntelligenceEngine', () => ({
  evaluateAccessibilityIntelligence: jest.fn(async () => ({ accessibilityScore: 60, wcagLevel: 'A', criticalIssues: [], warnings: ['Descriptive link text'], recommendations: [{ key: 'link_text', recommendation: 'Replace generic link text.' }], checks: [], confidence: 0.3, freshness, provenance: prov })),
}));
jest.mock('../../services/websiteIntelligence/brandIntelligenceEngine', () => ({
  evaluateBrandIntelligence: jest.fn(async () => ({ brandScore: 75, brandHealth: 'warning', brandConsistency: 70, brandTrust: 60, brandAuthority: 50, brandMaturity: 80, brandStrengths: ['Brand colours'], brandWeaknesses: [], recommendations: [], checks: [], confidence: 0.7, freshness, provenance: prov })),
}));

import { getWebsiteSnapshot } from '../../services/websiteIntelligence/websiteIntelligenceRepository';
import { buildWebsitePresentationModel } from '../../services/websiteIntelligence/websitePresentationModel';
import { renderWebsiteIntelligenceHtml } from '../../services/websiteIntelligence/websiteIntelligenceHtmlRenderer';

describe('Phase 18 — websiteIntelligenceRepository', () => {
  it('composes a complete snapshot with health, modules, validation, recommendations, summary', async () => {
    const snap = await getWebsiteSnapshot('co1');
    expect(snap.websiteId).toBe('w1');
    expect(snap.health?.overall).toBe('healthy'); // composite 80 + verified + tracking active
    expect(snap.health?.compositeScore).toBe(80);
    expect(snap.tracking.active).toBe(true);
    expect(snap.domain?.verified).toBe(true);
    // 21-item validation engine (Part 7)
    expect(snap.validation.total).toBe(21);
    expect(snap.validation.checks.find((c) => c.key === 'domain_verified')?.ok).toBe(true);
    expect(snap.validation.checks.find((c) => c.key === 'ssl')?.ok).toBe(true);
    expect(snap.validation.checks.find((c) => c.key === 'tracker_installed')?.ok).toBe(true);
    expect(snap.summary.overallScore).toBe(80);
    expect(snap.summary.lastIntelligenceUpdate).toBe('2026-06-01T00:00:00Z');
  });

  it('surfaces the 4 new deterministic engines + existing engines as available modules', async () => {
    const snap = await getWebsiteSnapshot('co1');
    const by = (k: string) => snap.modules.find((m) => m.key === k)!;
    for (const k of ['seo', 'performance', 'competitive']) { expect(by(k).available).toBe(true); expect(by(k).status).not.toBe('unavailable'); }
    // Phase 18 engines now produce real scores → available modules (no longer "unavailable")
    for (const k of ['content_analysis', 'technical', 'accessibility', 'brand']) { expect(by(k).available).toBe(true); expect(by(k).status).not.toBe('unavailable'); }
    expect(snap.intelligence.content.contentScore).toBe(70);
    expect(snap.intelligence.technical.technicalScore).toBe(82);
    expect(snap.intelligence.accessibility.wcagLevel).toBe('A');
    expect(snap.intelligence.brand.brandMaturity).toBe(80);
  });

  it('builds a report projection + rich merged recommendations (Phases F + H)', async () => {
    const snap = await getWebsiteSnapshot('co1');
    // recommendations are the rich shape, deduped + categorised + prioritised
    const pricing = snap.recommendations.find((r) => r.recommendation.includes('pricing'));
    expect(pricing?.affectedModules).toContain('content_analysis');
    expect(pricing?.category).toBeDefined();
    expect(typeof pricing?.priority).toBe('number');
    expect(snap.recommendations.every((r, i, a) => i === 0 || a[i - 1]!.priority >= r.priority)).toBe(true); // sorted by priority
    // report projects all sections incl. the 4 engines
    const keys = snap.report.sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['content_analysis', 'technical', 'accessibility', 'brand']));
    expect(snap.report.roadmap).toHaveLength(3);
    expect(typeof snap.report.confidence).toBe('number');
  });

  it('owns a structured executive summary + business-impact on every recommendation (Phase 19)', async () => {
    const snap = await getWebsiteSnapshot('co1');
    // Phase B — repository-owned executive summary
    expect(snap.executiveSummary).toBeDefined();
    expect(snap.executiveSummary.overallStatus).toBeDefined();
    expect(snap.executiveSummary.businessImpact.summary).toBeDefined();
    expect(Array.isArray(snap.executiveSummary.weaknesses)).toBe(true);
    // Phase C/D — every recommendation carries the impact cascade + ROI + dependencies
    const pricing = snap.recommendations.find((r) => r.recommendation.includes('pricing'))!;
    expect(pricing.impact.cascade.length).toBeGreaterThan(0);
    expect(pricing.estimatedROI).toBeDefined();
    expect(pricing.dependencies.length).toBeGreaterThan(0);
    // Phase E — 30/60/90-day roadmap
    expect(snap.report.roadmap.map((r) => r.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(snap.report.businessImpact.summary).toBeDefined();
  });

  it('builds ONE presentation model consumed by both React and HTML renderers (Phase 20)', async () => {
    const snap = await getWebsiteSnapshot('co1');
    const model = buildWebsitePresentationModel(snap);
    expect(model.modules.map((m) => m.key)).toEqual(['content', 'technical', 'accessibility', 'brand']);
    expect(model.modules[0]!.scoreToken).toBeDefined();
    expect(model.executiveSummary?.statusToken).toBeDefined();
    expect(model.roadmap.map((r) => r.label)).toEqual(['30 days', '60 days', '90 days']);
    expect(model.confidence.token).toBeDefined();
    // HTML renderer consumes the SAME model + emits registry colours (one styling system)
    const html = renderWebsiteIntelligenceHtml(model);
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Website Intelligence Engines');
    expect(html).toContain('Priority Roadmap');
    expect(html).toMatch(/background:#[0-9a-f]{6}/i);
  });

  it('dedupes recommendations across builders (Part 8)', async () => {
    const snap = await getWebsiteSnapshot('co1');
    const tracking = snap.recommendations.filter((r) => r.recommendation.toLowerCase().includes('install the tracking script'));
    expect(tracking).toHaveLength(1); // health-score + signal collapsed to one
    expect(snap.recommendations.some((r) => r.recommendation === 'Connect a CMS' && r.source === 'activationReadinessService')).toBe(true);
  });

  it('is fail-open: a failing source degrades without throwing', async () => {
    getWebsites.mockRejectedValueOnce(new Error('db down'));
    const snap = await getWebsiteSnapshot('co1');
    expect(snap.websiteId).toBeNull();
    expect(snap.validation.total).toBe(21); // still returns a full snapshot
  });
});

/**
 * BETA-ROADMAP-EXEC-001 — Honest state classification for Content Freshness (authority_velocity).
 *
 * Locks the STATE-ONLY correction: a freshness_score of 0 means the crawler detected NO recency signal
 * at all (no dated pages + no blog) — an ABSENCE of signal — and must read as `insufficient_signal`
 * (honestly excluded), NOT a measured "zero momentum" that drags the Momentum pillar + Authority Index.
 * A detected recency signal (value > 0) stays `measured`, even if low. No value/formula/aggregation change.
 */
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

const now = new Date('2026-03-31T00:00:00.000Z').toISOString();
const d = (id: string): PersistedDecisionObject => ({
  id, company_id: 'company-1', report_tier: 'snapshot', source_service: 't', entity_type: 'global', entity_id: null,
  issue_type: 'content_gap', title: id, description: 'x', evidence: {}, impact_traffic: 60, impact_conversion: 45,
  impact_revenue: 30, priority_score: 70, effort_score: 20, execution_score: 60, confidence_score: 0.8,
  recommendation: 'x', action_type: 'improve_content', action_payload: {}, status: 'open', last_changed_by: 's',
  created_at: now, updated_at: now, resolved_at: null, ignored_at: null,
});

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'company-1', reportCategory: 'snapshot', profile: null, requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: { companyName: 'Acme', websiteDomain: 'example.com', businessType: 'B2B Services', geography: 'United States', socialLinks: [], competitors: [], source: 'manual-entry', uploadedFileName: null, manualData: null, companyContext: { marketFocus: null, productServices: [], targetCustomer: null, idealCustomerProfile: null, brandPositioning: null, competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null } },
    integrations: Object.fromEntries(['google_analytics', 'google_search_console', 'google_ads', 'linkedin_ads', 'meta_ads', 'shopify', 'woocommerce', 'social_accounts', 'wordpress', 'custom_blog_api', 'lead_webhook', 'website_crawl', 'data_upload', 'manual_entry'].map((k) => [k, { connected: k === 'website_crawl', source: 'system', label: k }])) as ResolvedReportInput['integrations'],
  };
}

async function reportWithFreshness(freshness: number | null) {
  const r: any = await composeSnapshotReportFromDecisions({
    companyId: 'company-1',
    snapshotDecisions: [d('seo-1')],
    resolvedInput: resolvedInput(),
    publicAudit: {
      site_structure: { homepage: 'https://example.com/', product_pages: [], pricing_pages: [], blog_pages: [], contact_pages: [], geo_pages: [] },
      geo_aeo_context: { queries: [], entities: [], answerable_content_pct: null, structured_content_pct: null, citation_ready_pct: null, answer_coverage_score: null, entity_clarity_score: null, topical_authority_score: null, citation_readiness_score: null, content_structure_score: null, freshness_score: freshness },
      decisions: [],
    },
    // Short-circuit live competitor discovery (external calls) so this stays a fast, deterministic unit test.
    competitorIntelligenceOverride: { detected_competitors: [], generated_gaps: [], summary: '', comparison: null, discovery_metadata: { serp_status: 'unavailable', serp_domains_found: 0, is_fallback_used: true } },
  } as never);
  const c = r.canonical;
  const momentum = c.pillars.find((p: any) => p.pillar === 'momentum');
  const av = momentum.dimensions.find((x: any) => x.key === 'authority_velocity');
  return { av_value: av.score.value, av_state: av.score.state, momentum_state: momentum.score.state };
}

describe('BETA-ROADMAP-EXEC-001 — Content Freshness honest state', () => {
  it('Scenario A — recent measurable content (freshness 74) → measured', async () => {
    const r = await reportWithFreshness(74);
    expect(r.av_state).toBe('measured');
    expect(r.av_value).toBe(74);
    expect(r.momentum_state).toBe('measured');
  }, 120000);

  it('Scenario B — old but measurable content (freshness 18, low>0) → measured (value preserved)', async () => {
    const r = await reportWithFreshness(18);
    expect(r.av_state).toBe('measured');
    expect(r.av_value).toBe(18);
    expect(r.momentum_state).toBe('measured');
  }, 120000);

  it('Scenario C — no detectable recency signal (freshness 0) → insufficient_signal, momentum excluded', async () => {
    const r = await reportWithFreshness(0);
    expect(r.av_state).toBe('insufficient_signal');
    expect(r.momentum_state).toBe('insufficient_signal');
  }, 120000);

  it('is state-only: the raw value is preserved for value > 0', async () => {
    expect((await reportWithFreshness(74)).av_value).toBe(74);
    expect((await reportWithFreshness(18)).av_value).toBe(18);
  }, 120000);
});

/**
 * BETA-ROADMAP-EXEC-012 — Trust merge graceful degradation.
 *
 * Locks the merge contract at canonicalReportBuilder.ts (trust_coherence branch):
 *   IF the review/reputation provider returns state = 'measured' → the PROVIDER wins (authoritative).
 *   ELSE → RETAIN the Brand-engine Trust baseline (dimTrustCoherence) — do NOT overwrite a measured
 *          Brand-Trust result with an unavailable provider output.
 *
 * Before EXEC-012 the merge overwrote the Brand baseline UNCONDITIONALLY, so a measured Brand-Trust
 * signal was silently discarded whenever the reviews provider was inactive (the default). These three
 * scenarios pin the restored fallback, the preserved honest gap, and the preserved provider precedence.
 *
 * No provider is activated in the product: the reviews provider is injected here as an in-process test
 * double via the registry (registerTrustCoherenceProvider) purely to exercise the precedence branch.
 */
import type { TrustCoherenceProvider, TrustCoherenceResult } from '../../services/intelligence/providerInterfaces';
import { emptyEvidenceTrace } from '../../services/canonicalReport/canonicalReportTypes';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import {
  registerTrustCoherenceProvider,
  getTrustCoherenceProvider,
} from '../../services/intelligence/providerRegistry';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';

// Brand engine is fetched through the WI repository barrel; mock ONLY getWebsiteBrandIntelligence so we
// can control the measured Brand-Trust value while every other engine keeps its real (null) best-effort path.
let mockBrandIntelligence: { brandScore: number | null; brandTrust: number | null; confidence: number; freshness: { lastEvaluatedAt: string | null } } | null = null;
jest.mock('../../services/websiteIntelligence/websiteIntelligenceRepository', () => ({
  ...jest.requireActual('../../services/websiteIntelligence/websiteIntelligenceRepository'),
  getWebsiteBrandIntelligence: jest.fn(async () => mockBrandIntelligence),
}));

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

// In-process measured reviews provider (test double). NOT the real adapter and NOT activated in prod.
function measuredReviewsProvider(score: number): TrustCoherenceProvider {
  return {
    id: 'review_aggregator',
    async isAvailable() { return true; },
    async lookup(): Promise<TrustCoherenceResult> {
      return {
        state: 'measured',
        signals: {
          nap_consistency: 0.9, brand_description_consistency: 0.9, review_parity: 0.9,
          review_source_count: 3,
          expertise_signals: { author_bylines: 2, credentialed_authors: 1, organizational_about_completeness: 0.8 },
        },
        score,
        evidence: { ...emptyEvidenceTrace(), count: 3, sources: ['review_aggregator'] },
        reason_unavailable: null,
      };
    },
  };
}

// The registry default is UnavailableTrustCoherenceProvider; keep a handle to restore it between cases.
const defaultTrustProvider = getTrustCoherenceProvider();

async function trustDimension() {
  const r: any = await composeSnapshotReportFromDecisions({
    companyId: 'company-1',
    snapshotDecisions: [d('seo-1')],
    resolvedInput: resolvedInput(),
    publicAudit: {
      site_structure: { homepage: 'https://example.com/', product_pages: [], pricing_pages: [], blog_pages: [], contact_pages: [], geo_pages: [] },
      geo_aeo_context: { queries: [], entities: [], answerable_content_pct: null, structured_content_pct: null, citation_ready_pct: null, answer_coverage_score: null, entity_clarity_score: null, topical_authority_score: null, citation_readiness_score: null, content_structure_score: null, freshness_score: null },
      decisions: [],
    },
    competitorIntelligenceOverride: { detected_competitors: [], generated_gaps: [], summary: '', comparison: null, discovery_metadata: { serp_status: 'unavailable', serp_domains_found: 0, is_fallback_used: true } },
  } as never);
  const trustPillar = r.canonical.pillars.find((p: any) => p.pillar === 'trust');
  const dim = trustPillar.dimensions.find((x: any) => x.key === 'trust_coherence');
  return { value: dim.score.value, state: dim.score.state, pillar_state: trustPillar.score.state };
}

describe('BETA-ROADMAP-EXEC-012 — Trust merge graceful degradation', () => {
  beforeEach(() => {
    mockBrandIntelligence = null;
    registerTrustCoherenceProvider(defaultTrustProvider); // reviews provider inactive (product default)
  });
  afterAll(() => {
    registerTrustCoherenceProvider(defaultTrustProvider);
  });

  it('FALLBACK RESTORED — provider unavailable + measured Brand-Trust → Trust uses Brand-Trust', async () => {
    mockBrandIntelligence = { brandScore: 60, brandTrust: 72, confidence: 0.8, freshness: { lastEvaluatedAt: now } };
    const t = await trustDimension();
    expect(t.state).toBe('measured');
    expect(t.value).toBe(72); // brand-engine Trust value survives instead of being overwritten to null
    expect(t.pillar_state).toBe('measured');
  }, 120000);

  it('HONEST GAP PRESERVED — provider unavailable + no Brand data → Trust unavailable (no fabrication)', async () => {
    mockBrandIntelligence = null;
    const t = await trustDimension();
    expect(t.value).toBeNull();
    expect(t.state).toBe('unavailable');
  }, 120000);

  it('PRECEDENCE PRESERVED — provider measured overrides Brand-Trust (reviews remain authoritative)', async () => {
    mockBrandIntelligence = { brandScore: 60, brandTrust: 72, confidence: 0.8, freshness: { lastEvaluatedAt: now } };
    registerTrustCoherenceProvider(measuredReviewsProvider(88));
    const t = await trustDimension();
    expect(t.state).toBe('measured');
    expect(t.value).toBe(88); // provider (88) wins over brand-trust (72)
    expect(t.pillar_state).toBe('measured');
  }, 120000);
});

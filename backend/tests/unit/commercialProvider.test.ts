/**
 * BETA-PROVIDER-008 — Commercial Outcomes & Revenue Evidence Provider.
 *
 * Verifies the canonical commercial provider (measured revenue/conversions/derived metrics — never
 * fabricated / never estimated), multi-source consolidation, failure governance, availability, AND the
 * Business Impact ROI upgrade: snippet ROI becomes MEASURED (revenue) ONLY when authenticated commercial
 * evidence (conversion_rate + revenue_per_conversion) is present, else stays Estimated (clicks).
 * Deterministic; no DB; no network.
 */
import {
  commercialEvidenceAdapter, COMMERCIAL_EVIDENCE_KEYS, type CommercialEvidenceInput,
} from '../../services/evidencePlatform/providers/commercial/commercialEvidenceAdapter';
import { PROVIDER_FAILURE, __clearProviderRegistry } from '../../services/evidencePlatform';
import {
  isCommercialProviderConfigured, registerCommercialProvider, isCommercialProviderAvailable,
  commercialProviderReliability, consolidateCommercialSources, fetchCommercialEvidence, type CommercialSourcePayload,
} from '../../services/commercialProviderBridge';
import {
  correlateEvidence, diagnoseRootCauses, generateRecommendations, assessBusinessImpact, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';

describe('BETA-PROVIDER-008 — commercial adapter (Phase 4)', () => {
  const input: CommercialEvidenceInput = {
    subjectId: 'c1', revenue: 100000, conversions: 500, conversionValueTotal: 100000, qualifiedLeads: 800,
    closedDeals: 200, pipelineValue: 250000, recurringRevenue: 40000, ordersCount: 400, customersCount: 300,
    observedAt: NOW, providerReliability: 0.9, contributingSources: ['crm', 'ga4'],
  };
  it('emits measured revenue/conversions + derived metrics from real inputs', () => {
    const ev = commercialEvidenceAdapter.toEvidence(input, { observedAt: NOW });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['revenue'].value).toBe(100000);
    expect(byKey['revenue'].maturity).toBe('MEASURED');
    expect(byKey['revenue_per_conversion'].value).toBe(200); // 100000/500
    expect(byKey['revenue_per_conversion'].maturity).toBe('CALCULATED');
    expect(byKey['avg_order_value'].value).toBe(250); // 100000/400
    expect(byKey['lead_to_customer_rate'].value).toBe(0.25); // 200/800
    expect(byKey['customer_lifetime_value'].value).toBeCloseTo(333.33, 2); // 100000/300
  });

  it('never fabricates / never estimates: derived metrics omitted when an input is missing', () => {
    const sparse: CommercialEvidenceInput = { ...input, conversions: null, ordersCount: null };
    const keys = commercialEvidenceAdapter.toEvidence(sparse, { observedAt: NOW }).map((e) => e.id.split(':').pop());
    expect(keys).not.toContain('revenue_per_conversion'); // no conversions → cannot derive
    expect(keys).not.toContain('avg_order_value'); // no orders → cannot derive
    expect(keys).toContain('revenue'); // still measured
  });

  it('maps failure to canonical Evidence', () => {
    const ev = commercialEvidenceAdapter.onFailure({ providerId: 'commercial', state: PROVIDER_FAILURE.UNAUTHORIZED, reason: 'no crm', evidenceKey: 'revenue', observedAt: NOW });
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_UNAUTHORIZED');
  });

  it('exposes exactly the declared keys', () => {
    expect(commercialEvidenceAdapter.supportedEvidence).toEqual([...COMMERCIAL_EVIDENCE_KEYS]);
  });
});

describe('BETA-PROVIDER-008 — consolidation + availability + failure governance', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });
  const clear = () => { delete process.env.CRM_ENABLED; delete process.env.COMMERCIAL_EVIDENCE_ENABLED; };

  it('consolidates measured outcomes across sources (sums; nulls stay null)', () => {
    const sources: CommercialSourcePayload[] = [
      { source: 'crm', revenue: 60000, closedDeals: 120, qualifiedLeads: 500 },
      { source: 'ga4', conversions: 500, conversionValue: 100000 },
    ];
    const c = consolidateCommercialSources(sources, NOW);
    expect(c.revenue).toBe(60000);
    expect(c.conversions).toBe(500);
    expect(c.conversionValueTotal).toBe(100000);
    expect(c.contributingSources.sort()).toEqual(['crm', 'ga4']);
    expect(c.customersCount).toBeNull(); // nothing supplied it → null (not 0)
  });

  it('is UNAVAILABLE without credentials; connected with a flag', () => {
    clear();
    expect(isCommercialProviderConfigured()).toBe(false);
    expect(registerCommercialProvider().connectionStatus).toBe('disconnected');
    expect(isCommercialProviderAvailable()).toBe(false);
    process.env.CRM_ENABLED = 'true';
    __clearProviderRegistry();
    expect(isCommercialProviderAvailable()).toBe(true);
    expect(commercialProviderReliability()).toBe(0.9);
  });

  it('fetch without credentials → UNAVAILABLE (no network, ROI stays not determinable)', () => {
    clear();
    const ev = fetchCommercialEvidence('c1', null, NOW);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });

  it('connected but no revenue/conversion data → UNAVAILABLE (never fabricated)', () => {
    process.env.CRM_ENABLED = 'true';
    const ev = fetchCommercialEvidence('c1', [{ source: 'crm' }], NOW);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
  });
});

describe('BETA-PROVIDER-008 — ROI upgrade Estimated → Measured (Phase 5/6)', () => {
  const m = (key: string, value: number, unit: string): Evidence =>
    createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: NOW });
  const snippetImpact = (evidence: Evidence[]) => {
    const causes = diagnoseRootCauses(correlateEvidence(evidence));
    const plans = generateRecommendations(causes);
    return assessBusinessImpact(plans, causes, evidence).find((i) => i.ruleId === 'biz_search_snippet')!;
  };

  it('WITHOUT commercial evidence → ROI is Estimated (clicks, not revenue)', () => {
    const i = snippetImpact([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')]);
    expect(i.roi.status).toBe('estimated');
    expect(i.roi.quantified!.unit).toBe('additional_clicks_per_period');
  });

  it('WITH authenticated commercial evidence → ROI upgrades to Measured (revenue)', () => {
    // additional clicks = 5000 × (0.05 − 0.005) = 225; × conversion_rate 0.04 × revenue_per_conversion 200 = 1800
    const i = snippetImpact([
      m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'),
      m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount'),
    ]);
    expect(i.roi.status).toBe('measured');
    expect(i.roi.quantified!.unit).toBe('revenue_per_period');
    expect(i.roi.quantified!.value).toBe(Math.round(225 * 0.04 * 200 * 100) / 100); // 1800
  });

  it('honest boundary: authority ROI stays Not-Determinable even with commercial evidence (no revenue-per-position chain)', () => {
    const causes = diagnoseRootCauses(correlateEvidence([m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'), m('revenue', 100000, 'currency_amount'), m('conversions', 500, 'count')]));
    const plans = generateRecommendations(causes);
    const auth = assessBusinessImpact(plans, causes, [m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position'), m('revenue', 100000, 'currency_amount')]).find((i) => i.ruleId === 'biz_authority_deficit')!;
    expect(auth.roi.status).toBe('not_determinable');
  });
});

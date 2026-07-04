/**
 * BETA-RELEASE-002 — Executive Intelligence Report composition + Beta acceptance.
 *
 * Verifies the canonical report payload (one view model → HTML/PDF/API/dashboard: business-first ordered,
 * de-duplicated roadmap, honest provider health) and the deterministic acceptance verifier (a fully-evidenced
 * report is accepted; an honest-empty report is accepted — empties are `awaiting_evidence`, not placeholders;
 * an injected defect is caught + graded). Fixture-based; no DB; no fabrication.
 */
import {
  composeExecutiveIntelligenceReport, verifyBetaAcceptance,
  assembleExecutiveSection, buildProviderActivationMatrix,
  correlateEvidence, diagnoseRootCauses, generateRecommendations, assessBusinessImpact,
  deriveDecisionConfidence, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T12:00:00.000Z';
const AGO = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: AGO });

function evidencedSection(id: string, title: string, evidence: Evidence[]) {
  const correlations = correlateEvidence(evidence);
  const rootCauses = diagnoseRootCauses(correlations);
  const recommendations = generateRecommendations(rootCauses);
  const businessImpact = assessBusinessImpact(recommendations, rootCauses, evidence);
  const confidence = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
  return assembleExecutiveSection({ sectionId: id, title, evidence, correlations, rootCauses, recommendations, businessImpact, confidence, nowIso: NOW });
}

const CLEAR = ['AHREFS_API_KEY', 'GSC_OAUTH_CLIENT_ID', 'GA4_PROPERTY_ID', 'BING_WEBMASTER_API_KEY', 'REVIEWS_API_KEY', 'WIKIDATA_ENABLED', 'GOOGLE_KG_API_KEY', 'OPENAI_API_KEY', 'CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED'];

describe('BETA-RELEASE-002 — report composition (Phase 2/3)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; });

  it('composes one canonical report: business-first sections, deduped roadmap, honest provider health', () => {
    const seo = evidencedSection('seo', 'SEO / Search', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')]);
    const trust = assembleExecutiveSection({ sectionId: 'trust', title: 'Trust', nowIso: NOW }); // no evidence
    const report = composeExecutiveIntelligenceReport({ sections: [trust, seo], activation: buildProviderActivationMatrix(), generatedAt: NOW });

    expect(report.state).toBe('awaiting_activation'); // no active providers
    expect(report.sections[0].sectionId).toBe('seo'); // business-first: evidenced SEO before empty trust
    expect(report.providerHealth.implemented).toBe(8);
    expect(report.providerHealth.connected).toBe(0);
    // roadmap deduped + priority-ordered
    const ids = report.executionRoadmap.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < report.executionRoadmap.length; i++) expect(report.executionRoadmap[i - 1].priority).toBeGreaterThanOrEqual(report.executionRoadmap[i].priority);
  });

  it('is deterministic', () => {
    const s = evidencedSection('seo', 'SEO', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')]);
    const a = composeExecutiveIntelligenceReport({ sections: [s], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    const b = composeExecutiveIntelligenceReport({ sections: [s], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    expect(a).toEqual(b);
  });
});

describe('BETA-RELEASE-002 — Beta acceptance verifier (Phase 4/8)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; });

  it('accepts a fully-evidenced report (traceable, no placeholders, honest status)', () => {
    const seo = evidencedSection('seo', 'SEO / Search', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount')]);
    const report = composeExecutiveIntelligenceReport({ sections: [seo], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    const res = verifyBetaAcceptance(report);
    expect(res.accepted).toBe(true);
    expect(res.summary.critical).toBe(0);
    expect(res.checks.everyNumberTraceable).toBe(true);
    expect(res.checks.noDuplicateRecommendations).toBe(true);
    expect(res.checks.everyProviderStatusHonest).toBe(true);
  });

  it('accepts an honest-empty report (awaiting_evidence is NOT a placeholder)', () => {
    const empty = assembleExecutiveSection({ sectionId: 'authority', title: 'Authority', nowIso: NOW });
    const report = composeExecutiveIntelligenceReport({ sections: [empty], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    const res = verifyBetaAcceptance(report);
    expect(res.accepted).toBe(true); // empties are honest, not defects
    expect(res.checks.noPlaceholders).toBe(true);
  });

  it('catches a placeholder title (critical) and an unexplained-metric defect', () => {
    const seo = evidencedSection('seo', 'SEO', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')]);
    const report = composeExecutiveIntelligenceReport({ sections: [seo], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    // inject defects into the composed model (simulating a bad renderer)
    report.sections[0].title = 'TODO: rename this section';
    report.sections[0].drillDown = { ...report.sections[0].drillDown, explanationId: '' } as any;
    const res = verifyBetaAcceptance(report);
    expect(res.accepted).toBe(false);
    expect(res.issues.some((i) => i.code === 'PLACEHOLDER_TITLE' && i.severity === 'critical')).toBe(true);
    expect(res.issues.some((i) => i.code === 'UNEXPLAINED_METRIC')).toBe(true);
  });

  it('catches a dishonest provider status', () => {
    const report = composeExecutiveIntelligenceReport({ sections: [], activation: buildProviderActivationMatrix(), generatedAt: NOW });
    report.providerHealth.providers[0].status = 'totally_fine_trust_me';
    const res = verifyBetaAcceptance(report);
    expect(res.issues.some((i) => i.code === 'DISHONEST_PROVIDER_STATUS' && i.severity === 'critical')).toBe(true);
  });
});

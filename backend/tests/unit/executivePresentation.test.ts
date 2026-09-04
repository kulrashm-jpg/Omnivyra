/**
 * BETA-FINAL-001 — Executive Report Experience, Live Activation & Production Readiness.
 *
 * Verifies the READ-ONLY presentation + activation layer: the provider activation matrix reports honest
 * status (active vs awaiting_credentials — never fabricated), the executive section assembler surfaces the
 * hidden evidence/provenance/confidence/root-cause/business/ROI/drill-down fields, and the dashboard composes
 * provider health + coverage — all deterministically, with NO engine/scoring change. Fixture-based; no DB.
 */
import {
  buildProviderActivationMatrix, summarizeActivation,
  assembleExecutiveSection, assembleExecutiveDashboard,
  correlateEvidence, diagnoseRootCauses, generateRecommendations, assessBusinessImpact,
  deriveDecisionConfidence, createEvidence, type Evidence,
} from '../../services/evidencePlatform';

const NOW = '2026-02-01T12:00:00.000Z';
const AGO = '2026-02-01T00:00:00.000Z';
const m = (key: string, value: number, unit: string): Evidence =>
  createEvidence({ engineId: 'provider:x', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit, observedAt: AGO });

const CLEAR = ['AHREFS_API_KEY', 'MOZ_API_KEY', 'MAJESTIC_API_KEY', 'GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET',
  'GA4_PROPERTY_ID', 'GA4_OAUTH', 'BING_WEBMASTER_API_KEY', 'REVIEWS_API_KEY', 'WIKIDATA_ENABLED', 'GOOGLE_KG_API_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY', 'CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED'];

describe('BETA-FINAL-001 — provider activation matrix (Phase 5)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeEach(() => {
    for (const k of CLEAR) delete process.env[k];
    // Phase 1A: keyless Wikidata is ON by default, so "unconfigured" must be stated
    // explicitly. Clearing the env now yields an ACTIVE entity_graph provider — which
    // is the truthful state the report path has always been in.
    process.env.WIKIDATA_ENABLED = 'false';
  });

  it('reports all 8 implemented providers as awaiting_credentials when unconfigured (honest, no fabrication)', () => {
    const matrix = buildProviderActivationMatrix();
    const impl = matrix.filter((p) => p.implemented);
    expect(impl.length).toBe(8);
    expect(impl.every((p) => p.status === 'awaiting_credentials')).toBe(true);
    expect(impl.every((p) => p.requiredEnvKeys.length > 0)).toBe(true);
    expect(impl.every((p) => p.migrationPending)).toBe(true); // migration unapplied by default
    const s = summarizeActivation(matrix);
    expect(s.implemented).toBe(8);
    expect(s.active).toBe(0);
    expect(s.awaitingCredentials).toBe(8);
  });

  it('flips a provider to active when its credentials are present', () => {
    process.env.AHREFS_API_KEY = 'k';
    const backlink = buildProviderActivationMatrix().find((p) => p.providerId === 'backlink.authority')!;
    expect(backlink.status).toBe('active');
    expect(backlink.configured).toBe(true);
    expect(backlink.activationChecklist[0]).toMatch(/✓ credentials present/);
  });

  it('honestly marks anticipated-but-unimplemented providers as not_implemented (never active)', () => {
    const notImpl = buildProviderActivationMatrix().filter((p) => !p.implemented);
    expect(notImpl.length).toBeGreaterThan(0);
    expect(notImpl.every((p) => p.status === 'not_implemented')).toBe(true);
  });

  it('migrationApplied=true clears the migration-pending flag', () => {
    const s = summarizeActivation(buildProviderActivationMatrix({ migrationApplied: true }));
    expect(s.migrationPending).toBe(false);
  });
});

describe('BETA-FINAL-001 — executive presentation assembler (Phase 2/3)', () => {
  function section(evidence: Evidence[]) {
    const correlations = correlateEvidence(evidence);
    const rootCauses = diagnoseRootCauses(correlations);
    const recommendations = generateRecommendations(rootCauses);
    const businessImpact = assessBusinessImpact(recommendations, rootCauses, evidence);
    const confidence = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
    return assembleExecutiveSection({ sectionId: 'seo', title: 'SEO / Search', evidence, correlations, rootCauses, recommendations, businessImpact, confidence, nowIso: NOW, rejectedEvidenceKeys: ['bad_ctr'] });
  }

  it('surfaces the hidden fields (evidence strength/freshness/sources, confidence, root causes, business, ROI, drill-down)', () => {
    const v = section([m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount')]);
    expect(v.conclusion).toBe('evidence_backed');
    expect(v.evidenceStrength.measured).toBeGreaterThan(0);
    expect(v.evidenceFreshnessHours).toBe(12); // AGO → NOW
    expect(v.evidenceSources).toContain('impressions');
    expect(v.providerSources).toContain('provider:x');
    expect(v.rootCauses.some((c) => c.id === 'search_snippet_quality')).toBe(true);
    expect(v.businessImpact.some((b) => b.roiStatus === 'measured')).toBe(true); // commercial evidence → measured ROI
    expect(v.roiStatus).toContain('measured');
    expect(v.executionPlans.length).toBeGreaterThan(0);
    expect(v.reasonCodes.length).toBeGreaterThan(0);
    expect(v.drillDown.fullyTraceable).toBe(true); // nothing is a black box
  });

  it('honest awaiting-evidence section when no evidence (no fabrication)', () => {
    const v = assembleExecutiveSection({ sectionId: 'authority', title: 'Authority', nowIso: NOW });
    expect(v.conclusion).toBe('awaiting_evidence');
    expect(v.evidenceStrength.measured).toBe(0);
    expect(v.rootCauses).toEqual([]);
    expect(v.drillDown.fullyTraceable).toBe(false);
  });

  it('is deterministic', () => {
    const ev = [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio')];
    expect(section(ev)).toEqual(section(ev));
  });
});

describe('BETA-FINAL-001 — executive dashboard (Phase 4)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it('composes provider health + coverage + opportunities + risks + roadmap', () => {
    for (const k of CLEAR) delete process.env[k];
    // Phase 1A: this test asserts the "no active providers" dashboard. Keyless Wikidata is
    // now ON by default (canonical `isWikidataEnabled()`), so clearing the env is no longer
    // sufficient to express "unconfigured" — it must be disabled explicitly.
    process.env.WIKIDATA_ENABLED = 'false';
    const evidence = [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('domain_authority', 15, 'score_0_100'), m('avg_position', 22, 'position')];
    const correlations = correlateEvidence(evidence);
    const rootCauses = diagnoseRootCauses(correlations);
    const recommendations = generateRecommendations(rootCauses);
    const businessImpact = assessBusinessImpact(recommendations, rootCauses, evidence);
    const confidence = deriveDecisionConfidence({ maturity: 'MEASURED', sampleSize: 40, dataPresent: true });
    const seo = assembleExecutiveSection({ sectionId: 'seo', title: 'SEO', evidence, correlations, rootCauses, recommendations, businessImpact, confidence, nowIso: NOW });
    const empty = assembleExecutiveSection({ sectionId: 'trust', title: 'Trust', nowIso: NOW });

    const dash = assembleExecutiveDashboard([seo, empty], buildProviderActivationMatrix());
    expect(dash.readiness).toBe('awaiting_activation'); // no active providers → honest
    expect(dash.providerHealth.implemented).toBe(8);
    expect(dash.providerHealth.awaitingCredentials).toBe(8);
    expect(dash.dataCoverage.sectionsBacked).toBe(1); // seo backed, trust empty
    expect(dash.dataCoverage.sectionsTotal).toBe(2);
    expect(dash.businessOpportunities.length).toBeGreaterThan(0);
    // roadmap sorted by priority desc
    for (let i = 1; i < dash.priorityRoadmap.length; i++) expect(dash.priorityRoadmap[i - 1].priority).toBeGreaterThanOrEqual(dash.priorityRoadmap[i].priority);
  });
});

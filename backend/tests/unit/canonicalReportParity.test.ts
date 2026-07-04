/**
 * BETA-RELEASE-003 — Canonical presentation completion & render parity.
 *
 * Proves the ONE-payload guarantee: a single canonical executive report serializes to surface-agnostic
 * content that is BYTE-IDENTICAL across Dashboard / API / HTML / PDF (layout may differ, content may not).
 * Also proves the single-source-of-truth consolidation: the report's roadmap + opportunities ARE the
 * dashboard's (no duplicate composition). Fixture-based; deterministic; no DB; no fabrication.
 */
import {
  composeExecutiveIntelligenceReport,
  assembleExecutiveSection, assembleExecutiveDashboard, buildProviderActivationMatrix,
  serializeReportContent, buildSurfaceView, verifyRenderParity, type RenderSurface,
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

describe('BETA-RELEASE-003 — render parity across surfaces', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; });

  const report = () => {
    const seo = evidencedSection('seo', 'SEO / Search', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('domain_authority', 15, 'score_0_100'), m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount')]);
    const trust = assembleExecutiveSection({ sectionId: 'trust', title: 'Trust', nowIso: NOW });
    return composeExecutiveIntelligenceReport({ sections: [trust, seo], activation: buildProviderActivationMatrix(), generatedAt: NOW });
  };

  it('serializes byte-identical content for every surface (layout-only difference)', () => {
    const r = report();
    const surfaces: RenderSurface[] = ['dashboard', 'api', 'html', 'pdf'];
    const contents = surfaces.map((s) => JSON.stringify(buildSurfaceView(r, s).content));
    for (let i = 1; i < contents.length; i++) expect(contents[i]).toBe(contents[0]);
    // and the layout tag is the ONLY thing that differs between surfaces
    expect(new Set(surfaces.map((s) => buildSurfaceView(r, s).surface)).size).toBe(4);
  });

  it('verifyRenderParity confirms parity holds and reports zero mismatches', () => {
    const res = verifyRenderParity(report());
    expect(res.parity).toBe(true);
    expect(res.mismatches).toEqual([]);
    expect(res.surfaces).toEqual(['dashboard', 'api', 'html', 'pdf']);
  });

  it('serialization is deterministic and loss-preserving of canonical fields', () => {
    const r = report();
    expect(serializeReportContent(r)).toEqual(serializeReportContent(r));
    const content = serializeReportContent(r);
    // the surface-agnostic content carries the same section identities + ordering as the canonical report
    expect(content.sections.map((s) => s.sectionId)).toEqual(r.sections.map((s) => s.sectionId));
    expect(content.executionRoadmap).toEqual(r.executionRoadmap);
    expect(content.businessOpportunities).toEqual(r.businessOpportunities);
    expect(content.state).toBe(r.state);
  });
});

describe('BETA-RELEASE-003 — single source of truth (no duplicate composition)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; });

  it('report roadmap + opportunities ARE the dashboard\'s (composer does not recompute)', () => {
    const seo = evidencedSection('seo', 'SEO / Search', [m('impressions', 5000, 'count'), m('ctr', 0.005, 'ratio'), m('domain_authority', 15, 'score_0_100'), m('conversion_rate', 0.04, 'ratio'), m('revenue_per_conversion', 200, 'currency_amount')]);
    const activation = buildProviderActivationMatrix();
    const report = composeExecutiveIntelligenceReport({ sections: [seo], activation, generatedAt: NOW });
    // recompose the dashboard the same way the composer orders sections (single section → identity ordering)
    const dashboard = assembleExecutiveDashboard(report.sections, activation);
    expect(report.executionRoadmap).toEqual(dashboard.priorityRoadmap);
    expect(report.businessOpportunities).toEqual(dashboard.businessOpportunities);
  });
});

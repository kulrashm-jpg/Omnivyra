/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1 — Evidence Unification.
 *
 * Adapters → EvidenceRefs → policy-driven fusion → evidence-derived canonical facets. Covers: adapter
 * output, resolution, conflict, abstention, provenance, freshness, confidence, semantic divergence, the
 * Omnivyra fixture, cross-company isolation, hallucination prevention, shadow delta, explainability, and
 * determinism. Shadow-only; no production path touched.
 */
import {
  ingestCompanyEvidence,
  companyProfileFactsEvidence,
  aiExtractionEvidence,
  companyFromEvidence,
  buildCompanyUnderstandingFromEvidence,
  explainCompanyField,
  runSemanticDelta,
  type EvidenceSources,
} from '../../services/companyIntelligence/evidence';
import { toLegacyFields } from '../../services/companyIntelligence';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';
const STALE = '2024-06-01T00:00:00.000Z';

// Omnivyra — reconstructed from production. Profile ingests FACTS (no derived category); AI extraction
// (grounded on the marketing/SEO/content products) supplies the interpretive category/solution_domains.
const OMNI_SOURCES = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis', 'Campaign planning and execution', 'Content performance tracking'], services: [], industry: 'Marketing Technology, Data & Analytics, Communication', competitors: [] },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', industry: 'Marketing Technology', solutionDomains: ['marketing', 'content', 'seo', 'campaigns'], operatingModel: 'AI-powered marketing & content platform', domainRole: 'AI marketing content solution provider', segments: ['marketing teams', 'SMBs'], products: ['digital marketing system'] },
  website: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', offerings: ['digital marketing', 'SEO', 'content'] },
  firmographics: [{ companyId: 'omnivyra', observedAt: ASOF, system: 'crunchbase', foundedYear: '2023', size: '11-50' }],
});
const OMNI_LEGACY = (): CompanyProfileInput => ({ companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis', 'Campaign planning and execution', 'Content performance tracking'], services: [], competitors: [] });

describe('U1 · evidence adapters emit EvidenceRefs (never business objects)', () => {
  it('every EvidenceRef carries source/kind/observed+recorded timestamps/lifecycle/id/weight', () => {
    for (const e of ingestCompanyEvidence(OMNI_SOURCES())) {
      expect(e.id).toBeTruthy();
      expect(e.source.system).toBeTruthy();
      expect(['structured', 'observed', 'inferred', 'external', 'ai_generated']).toContain(e.kind);
      expect(e.observedAt).toBe(ASOF);
      expect(e.recordedAt).toBe(ASOF);
      expect(e.lifecycle).toBe('created');
      expect(typeof e.weight).toBe('number');
    }
  });
  it('the company-profile adapter ingests FACTS, never the derived classification', () => {
    const labels = companyProfileFactsEvidence(OMNI_SOURCES().profile).map((e) => e.label);
    expect(labels).toContain('name');
    expect(labels).toContain('products');
    expect(labels).not.toContain('category'); // derived classification is NOT re-ingested
    expect(labels).not.toContain('operating_model');
    // AI extraction is the interpretive source
    expect(aiExtractionEvidence(OMNI_SOURCES().ai).map((e) => e.label)).toContain('category');
  });
});

describe('U1 · resolution + conflict (policy-driven: weight × kind × freshness)', () => {
  it('category resolves from AI evidence; structured facts beat AI on conflict (products)', () => {
    const b = companyFromEvidence(OMNI_SOURCES(), ASOF);
    // category: only AI emits it → evidence-derived, corrected value
    expect(b.worldView.category).toBe('AI-driven digital marketing & content platform');
    // products conflict (profile structured vs ai vs website) → structured (highest effective weight) wins
    expect(b.facets.offerings?.value?.products).toEqual(['AI-Driven Digital Marketing System', 'SEO and website health analysis', 'Campaign planning and execution', 'Content performance tracking']);
  });
  it('records contradictions without dropping conflicting evidence', () => {
    const b = companyFromEvidence(OMNI_SOURCES(), ASOF);
    // products disagree across sources → a contradiction is represented, not silently overwritten
    expect(b.contradictions.length).toBeGreaterThan(0);
  });
});

describe('U1 · freshness — fresher evidence wins at equal weight', () => {
  it('a fresh founded_year beats a stale one of the same source/weight', () => {
    const sources: EvidenceSources = {
      profile: { companyId: 'f', observedAt: ASOF, name: 'F' },
      firmographics: [
        { companyId: 'f', observedAt: STALE, system: 'wikidata', foundedYear: '2019' },
        { companyId: 'f', observedAt: ASOF, system: 'wikidata', foundedYear: '2023' },
      ],
    };
    expect(companyFromEvidence(sources, ASOF).facets.identity?.value?.foundedYear).toBe('2023');
  });
});

describe('U1 · abstention + hallucination prevention (never fabricate)', () => {
  it('facets with no evidence abstain; no fabricated defaults', () => {
    const u = buildCompanyUnderstandingFromEvidence({ profile: { companyId: 'bare', observedAt: ASOF, name: 'Bare' } }, ASOF);
    const legacy = toLegacyFields(u);
    expect(legacy.name).toBe('Bare');
    expect(legacy.category).toBeNull();        // no category evidence → abstain
    expect(legacy.products).toEqual([]);       // no offerings evidence → abstain
    expect(legacy.competitors).toEqual([]);    // no competitor evidence → abstain (honest empty)
    expect(u.facets.competitive.value).toBeNull();
    expect(u.facets.competitive.confidence).toBe(0);
  });
});

describe('U1 · provenance + confidence (every fact traceable)', () => {
  const u = buildCompanyUnderstandingFromEvidence(OMNI_SOURCES(), ASOF);
  it('populated facets carry evidence + provenance + confidence', () => {
    expect(u.facets.identity.value?.name).toBe('Omnivyra');
    expect(u.facets.identity.evidence.length).toBeGreaterThan(0);
    expect(u.facets.identity.provenance.map((p) => p.system)).toEqual(expect.arrayContaining(['company_profile']));
    expect(u.facets.identity.confidence).toBeGreaterThan(0);
  });
  it('firmographics enter as evidence with provenance (crunchbase)', () => {
    expect(u.facets.identity.value?.foundedYear).toBe('2023');
    const founded = u.facets.identity.evidence.find((e) => e.label === 'founded_year');
    expect(founded?.source.system).toBe('crunchbase');
  });
});

describe('U1 · Omnivyra fixture + semantic divergence (whitelist)', () => {
  it('corrects category, preserves name/domain/products, abstains competitors — 0 regressions', () => {
    const report = runSemanticDelta([{ legacy: OMNI_LEGACY(), sources: OMNI_SOURCES() }]);
    const omni = report.companies[0];
    const cls = Object.fromEntries(omni.fields.map((f) => [f.field, f.class]));
    expect(cls.category).toBe('approved_improvement'); // Analytics → marketing/content
    expect(cls.name).toBe('parity');
    expect(cls.domain).toBe('parity');
    expect(cls.products).toBe('parity');
    expect(cls.competitors).toBe('parity'); // legacy [] and evidence [] both empty
    expect(report.totalRegressions).toBe(0);
    expect(report.approvedImprovements).toBeGreaterThan(0);
  });
});

describe('U1 · cross-company isolation', () => {
  it('two companies build independently with no cross-contamination', () => {
    const a = companyFromEvidence(OMNI_SOURCES(), ASOF);
    const b = companyFromEvidence({ profile: { companyId: 'other', observedAt: ASOF, name: 'OtherCo', domain: 'other.com', products: ['thing'] }, ai: { companyId: 'other', observedAt: ASOF, category: 'Widget maker' } }, ASOF);
    expect(a.facets.identity?.value?.name).toBe('Omnivyra');
    expect(b.facets.identity?.value?.name).toBe('OtherCo');
    expect(b.worldView.category).toBe('Widget maker');
    expect(a.worldView.category).not.toBe(b.worldView.category);
  });
});

describe('U1 · explainability — Field → Facet → EvidenceRefs → Resolution Policy → Final Value', () => {
  it('explains the corrected category with its full chain', () => {
    const ex = explainCompanyField(OMNI_SOURCES(), ASOF, 'category');
    expect(ex.facet).toBe('worldView');
    expect(ex.finalValue).toBe('AI-driven digital marketing & content platform');
    expect(ex.evidence.length).toBeGreaterThan(0);
    expect(ex.resolution.winnerSource).toBe('ai_extraction');
    expect(ex.resolution.policy).toMatch(/weight/);
  });
});

describe('U1 · determinism + shadow-delta corpus', () => {
  it('is deterministic (same sources+asOf ⇒ identical understanding)', () => {
    expect(buildCompanyUnderstandingFromEvidence(OMNI_SOURCES(), ASOF)).toEqual(buildCompanyUnderstandingFromEvidence(OMNI_SOURCES(), ASOF));
  });
  it('corpus delta: 0 unexpected regressions', () => {
    const report = runSemanticDelta([
      { legacy: OMNI_LEGACY(), sources: OMNI_SOURCES() },
      { legacy: { companyId: 'bi', asOf: ASOF, name: 'InsightGrid', domain: 'insightgrid.com', category: 'Business intelligence dashboards', products: ['BI dashboards'], competitors: ['Tableau'] }, sources: { profile: { companyId: 'bi', observedAt: ASOF, name: 'InsightGrid', domain: 'insightgrid.com', products: ['BI dashboards'], competitors: ['Tableau'] }, ai: { companyId: 'bi', observedAt: ASOF, category: 'Business intelligence platform' } } },
    ]);
    expect(report.totalRegressions).toBe(0);
  });
});

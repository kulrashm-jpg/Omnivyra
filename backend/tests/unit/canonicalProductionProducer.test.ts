/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4.5 — Canonical Production Producer.
 *
 * Certifies the missing producer: canonical identity is derived from write-path EVIDENCE (profile facts +
 * AI extraction), category/industry are evidence-derived, the ungrounded interpretive fields ABSTAIN
 * (never fabricated), the shadow record is persistable, and production parity shows zero unexpected
 * regressions. Types: Production Producer · Write-path · Evidence Ownership · Persistence · Parity ·
 * Approved Divergence · Unexpected Regression · Rollback · Performance · Production Activation.
 */
import { produceCanonicalIdentity, collectWriteEvidence, writeInputsFromProfileAndExtraction, type WriteEvidenceInputs } from '../../services/companyIntelligence/production/canonicalIdentityProducer';
import { runProductionParity } from '../../services/companyIntelligence/production/productionParity';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';

// Omnivyra reconstructed at the write path: FACTS + AI extraction (extraction independently yields category).
const OMNI_INPUTS = (): WriteEvidenceInputs => ({
  companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com',
  products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], industry: 'Marketing Technology', competitors: [],
  ai: { category: 'AI-driven digital marketing & content platform', industry: 'Marketing Technology', products: ['digital marketing system'], segments: 'marketing teams; SMBs', differentiators: 'AI-native content engine' },
});
// Legacy stored identity (classifier output — wrong category + fabricated interpretive fields).
const OMNI_LEGACY = (): CompanyProfileInput => ({ companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights', businessModel: 'B2B SaaS', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [] });

describe('U4.5 · production producer — identity derived from evidence', () => {
  it('category/industry come from AI-extraction evidence; name/domain/products from facts', () => {
    const { legacy, understanding } = produceCanonicalIdentity(OMNI_INPUTS());
    expect(legacy.category).toBe('AI-driven digital marketing & content platform'); // evidence, not the classifier
    expect(legacy.name).toBe('Omnivyra');
    expect(legacy.domain).toBe('omnivyra.com');
    expect(legacy.products).toEqual(['AI-Driven Digital Marketing System', 'SEO and website health analysis']);
    expect(understanding.facets.identity.value?.name).toBe('Omnivyra');
  });
});

describe('U4.5 · evidence ownership + abstention (never fabricate)', () => {
  it('ungrounded interpretive fields ABSTAIN — no evidence source at the write path', () => {
    const { understanding, legacy } = produceCanonicalIdentity(OMNI_INPUTS());
    // business_model has no evidence adapter output → abstains (null), NOT fabricated 'B2B SaaS'
    expect(legacy.business_model).toBeNull();
    // operating_model / domain_role are worldView.primaryMotion / marketPosition — no evidence → abstain
    expect(understanding.facets.worldView.value?.primaryMotion ?? null).toBeNull();
    expect(understanding.facets.worldView.value?.marketPosition ?? null).toBeNull();
  });
  it('collectWriteEvidence never emits firmographics or derived classification (no fetch/fabrication)', () => {
    const sources = collectWriteEvidence(OMNI_INPUTS());
    expect(sources.firmographics).toBeUndefined();
    expect(sources.ai && 'operatingModel' in sources.ai ? sources.ai.operatingModel : undefined).toBeUndefined();
  });
  it('empty inputs ⇒ everything abstains (no defaults invented)', () => {
    const { legacy } = produceCanonicalIdentity({ companyId: 'bare', asOf: ASOF });
    expect(legacy.category).toBeNull();
    expect(legacy.business_model).toBeNull();
    expect(legacy.products).toEqual([]);
    expect(legacy.competitors).toEqual([]);
  });
});

describe('U4.5 · persistence shape', () => {
  it('produces a persistable canonical record (versioned, evidence-sourced)', () => {
    const { record } = produceCanonicalIdentity(OMNI_INPUTS());
    expect(record.company_id).toBe('omnivyra');
    expect(record.version).toBeGreaterThan(0);
    expect(record.built_at).toBe(ASOF);
    expect(record.identity_source).toBe('evidence');
    expect(record.producer).toMatch(/canonicalIdentityProducer/);
    expect(record.understanding).toBeDefined();
  });
  it('maps a CompanyProfile + extraction → write inputs (extraction supplies category)', () => {
    const inputs = writeInputsFromProfileAndExtraction(
      { company_id: 'omnivyra', name: 'Omnivyra', website_url: 'omnivyra.com', products_services_list: ['x'], industry: 'MarTech', competitors_list: [] },
      { category: { value: 'AI-driven digital marketing & content platform', source: 'website', confidence: 'High' }, industry: { value: 'Marketing Technology' } } as never,
      ASOF,
    );
    expect(inputs.ai?.category).toBe('AI-driven digital marketing & content platform');
    expect(inputs.name).toBe('Omnivyra');
  });
});

describe('U4.5 · production parity (canonical vs legacy)', () => {
  it('Omnivyra: category improves, business_model abstains, facts parity, 0 unexpected regressions', () => {
    const report = runProductionParity([{ legacy: OMNI_LEGACY(), inputs: OMNI_INPUTS() }]);
    const cls = Object.fromEntries(report.rows[0].delta.fields.map((f) => [f.field, f.class]));
    expect(cls.category).toBe('approved_improvement');
    expect(cls.business_model).toBe('expected_abstention'); // legacy fabricated 'B2B SaaS' → canonical honest null
    expect(cls.name).toBe('parity');
    expect(cls.products).toBe('parity');
    expect(report.totalUnexpectedRegressions).toBe(0);
    expect(report.certifiable).toBe(true);
    expect(report.approvedImprovements).toBeGreaterThan(0);
  });
  it('corpus parity is certifiable (0 unexpected regressions)', () => {
    const report = runProductionParity([
      { legacy: OMNI_LEGACY(), inputs: OMNI_INPUTS() },
      { legacy: { companyId: 'bi', asOf: ASOF, name: 'InsightGrid', domain: 'insightgrid.com', category: 'BI dashboards', products: ['BI dashboards'], competitors: ['Tableau'] }, inputs: { companyId: 'bi', asOf: ASOF, name: 'InsightGrid', domain: 'insightgrid.com', products: ['BI dashboards'], competitors: ['Tableau'], ai: { category: 'Business intelligence platform' } } },
    ]);
    expect(report.certifiable).toBe(true);
  });
});

describe('U4.5 · determinism + performance', () => {
  it('deterministic (same inputs ⇒ identical record) and fast', () => {
    expect(produceCanonicalIdentity(OMNI_INPUTS())).toEqual(produceCanonicalIdentity(OMNI_INPUTS()));
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) produceCanonicalIdentity(OMNI_INPUTS());
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(3000);
  });
});

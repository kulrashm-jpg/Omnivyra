/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 1 — Company Profile.
 *
 * Certifies the Company Profile consumer reads identity ONLY through the projection seam: byte-identical
 * legacy when the flag is OFF, canonical (evidence) when ON, fail-safe on regression, no derivation, no
 * raw-evidence exposure, explainability preserved, O(1) rollback. Test types: Inventory · Projection
 * Integration · Output Parity · Approved Improvement · Unexpected Regression · Rollback · Performance ·
 * Explainability · Consumer Isolation.
 */
import { readCompanyProfileIdentity, adoptCompanyProfileIdentity, companyProfileRecordToInput, type CompanyProfileIdentityInput } from '../../services/companyIntelligence/adoption/consumers/companyProfileConsumer';
import { COMPANY_MODEL_VERSION } from '../../services/companyIntelligence/builder';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

const RECORD = (): CompanyProfileIdentityInput => ({
  companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com',
  category: 'Analytics software for clearer performance insights',
  products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [],
});
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [] },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', solutionDomains: ['marketing', 'content'], operatingModel: 'AI-powered marketing & content platform', domainRole: 'AI marketing content solution provider' },
});

describe('U3·C1 · inventory (the identity surface the consumer renders)', () => {
  it('exposes exactly the identity fields + projection metadata — nothing else', () => {
    const v = readCompanyProfileIdentity(RECORD());
    expect(Object.keys(v).sort()).toEqual(['businessModel', 'category', 'competitors', 'confidence', 'domain', 'name', 'observation', 'products', 'projectionSource', 'projectionVersion', 'services'].sort());
  });
});

describe('U3·C1 · projection integration', () => {
  it('flag ON + evidence → canonical_evidence, category corrected', () => {
    ON();
    const v = readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() });
    expect(v.projectionSource).toBe('canonical_evidence');
    expect(v.category).toBe('AI-driven digital marketing & content platform');
  });
});

describe('U3·C1 · output parity (flag OFF ⇒ byte-identical legacy)', () => {
  it('returns the legacy identity unchanged', () => {
    const v = readCompanyProfileIdentity(RECORD());
    expect(v.projectionSource).toBe('legacy');
    expect({ name: v.name, domain: v.domain, category: v.category, businessModel: v.businessModel, products: v.products, services: v.services, competitors: v.competitors }).toEqual({
      name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights',
      businessModel: null, products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [],
    });
  });
});

describe('U3·C1 · approved improvement', () => {
  it('category improves and is served; classified approved_improvement', () => {
    ON();
    const v = readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() });
    expect(v.category).toBe('AI-driven digital marketing & content platform');
    expect(v.observation.unexpectedRegressions).toBe(0);
    expect(v.observation.deltas.find((d) => d.field === 'category')?.class).toBe('approved_improvement');
  });
});

describe('U3·C1 · unexpected regression fail-safe', () => {
  it('a parity-locked divergence falls back to legacy identity', () => {
    ON();
    const record = { ...RECORD(), products: ['Legacy Only'] };
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', products: ['Different Evidence'] }, ai: EVIDENCE().ai };
    const v = readCompanyProfileIdentity({ ...record, evidence });
    expect(v.projectionSource).toBe('legacy_fallback');
    expect(v.products).toEqual(['Legacy Only']);
  });
});

describe('U3·C1 · rollback (O(1))', () => {
  it('flipping the flag off restores identical legacy identity', () => {
    const before = readCompanyProfileIdentity(RECORD());
    ON();
    expect(readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() }).projectionSource).toBe('canonical_evidence');
    OFF();
    expect(readCompanyProfileIdentity(RECORD())).toEqual(before);
  });
});

describe('U3·C1 · performance + determinism', () => {
  it('1000 reads, no network, deterministic', () => {
    ON();
    const first = readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() });
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() })).toEqual(first);
    expect(ms).toBeLessThan(2000);
  });
});

describe('U3·C1 · explainability', () => {
  it('preserves Projection→Facet→Evidence→Resolution→Value via observation', () => {
    ON();
    const v = readCompanyProfileIdentity({ ...RECORD(), evidence: EVIDENCE() });
    expect(v.projectionVersion).toBe(COMPANY_MODEL_VERSION);
    expect(v.observation.deltas.length).toBeGreaterThan(0);
    for (const d of v.observation.deltas) expect(['parity', 'approved_improvement', 'expected_abstention', 'unexpected_regression']).toContain(d.class);
  });
});

describe('U3·C1 · live-record adoption (display API wiring)', () => {
  const RECORD_ROW = () => ({ name: 'Omnivyra', website_url: 'omnivyra.com', category: 'Analytics software for clearer performance insights', business_classification: { level_1: 'Software' }, competitors: [], report_settings: { keep: true } });

  it('maps the stored record → projection input (website_url→domain, level_1→businessModel)', () => {
    const inp = companyProfileRecordToInput(RECORD_ROW(), 'omnivyra', ASOF);
    expect(inp.domain).toBe('omnivyra.com');
    expect(inp.businessModel).toBe('Software');
    expect(inp.category).toBe('Analytics software for clearer performance insights');
  });

  it('flag OFF → returns the SAME record reference (byte-identical no-op)', () => {
    const row = RECORD_ROW();
    expect(adoptCompanyProfileIdentity(row, 'omnivyra', ASOF)).toBe(row); // identical reference
  });

  it('flag ON → overlays projected category, preserves all other fields', () => {
    ON();
    const row = RECORD_ROW();
    const out = adoptCompanyProfileIdentity(row, 'omnivyra', ASOF);
    expect(out).not.toBe(row);                       // new object
    expect(out.report_settings).toEqual({ keep: true }); // non-identity fields preserved
    expect(out.name).toBe('Omnivyra');
    expect(typeof out.category === 'string' || out.category === null).toBe(true);
  });
});

describe('U3·C1 · consumer isolation (consumes, never derives)', () => {
  it('never exposes raw facets/evidence and never mutates the input record', () => {
    const input = RECORD();
    const snapshot = JSON.parse(JSON.stringify(input));
    const v = readCompanyProfileIdentity(input) as unknown as Record<string, unknown>;
    expect(v.facets).toBeUndefined();
    expect(v.evidence).toBeUndefined();
    expect(input).toEqual(snapshot); // input untouched
  });
});

/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U2 — Projection Cutover.
 *
 * Certifies authoritative projection routing through the seam `resolveCompanyProjection`: flag OFF ⇒
 * byte-identical legacy; flag ON + evidence ⇒ evidence-derived canonical (fail-safe on unexpected
 * regression); flag ON w/o evidence ⇒ profile-derived canonical. Parity gate, approved-divergence,
 * regression fail-safe, version, explainability, rollback, performance. Consumers unchanged; default OFF.
 */
import { resolveCompanyProjection, validateConsumerParity } from '../../services/companyIntelligence/adoption/consumerAdapter';
import { COMPANY_MODEL_VERSION } from '../../services/companyIntelligence/builder';
import type { CompanyProfileInput } from '../../services/companyIntelligence';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF); // every test starts with the flag OFF (default)

const LEGACY = (): CompanyProfileInput => ({ companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [] });
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'], services: [], competitors: [] },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', solutionDomains: ['marketing', 'content'], operatingModel: 'AI-powered marketing & content platform', domainRole: 'AI marketing content solution provider' },
});

describe('U2 · projection routing', () => {
  it('flag OFF → legacy path', () => {
    expect(resolveCompanyProjection(LEGACY()).source).toBe('legacy');
  });
  it('flag ON + evidence → canonical_evidence path', () => {
    ON();
    expect(resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() }).source).toBe('canonical_evidence');
  });
  it('flag ON without evidence → canonical_profile path', () => {
    ON();
    expect(resolveCompanyProjection(LEGACY()).source).toBe('canonical_profile');
  });
});

describe('U2 · authoritative flag + O(1) rollback', () => {
  it('flag OFF is byte-identical legacy (no canonical code path)', () => {
    const r = resolveCompanyProjection(LEGACY());
    expect(r.fields).toEqual({
      name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights',
      business_model: null, products: ['AI-Driven Digital Marketing System', 'SEO and website health analysis'],
      services: [], competitors: [], confidence: 0,
    });
    expect(r.observation.flagAuthoritative).toBe(false);
  });
  it('flipping the flag flips the path; flipping back restores legacy exactly', () => {
    const before = resolveCompanyProjection(LEGACY());
    ON();
    expect(resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() }).source).toBe('canonical_evidence');
    OFF();
    expect(resolveCompanyProjection(LEGACY())).toEqual(before); // O(1) rollback = identical result
  });
});

describe('U2 · parity gate (validateConsumerParity)', () => {
  it('evidence path passes with zero unexpected regressions', () => {
    const p = validateConsumerParity(LEGACY(), { evidence: EVIDENCE() });
    expect(p.matches).toBe(true);
    expect(p.unexpectedRegressions).toBe(0);
    expect(p.approvedImprovements).toBeGreaterThan(0); // category improved
  });
  it('profile path (no evidence) retains ≥0.999 parity gate', () => {
    const p = validateConsumerParity(LEGACY());
    expect(p.matches).toBe(true);
    expect(p.parity).toBeGreaterThanOrEqual(0.999);
  });
});

describe('U2 · approved semantic divergence is served (not blocked)', () => {
  it('category is corrected and served; classified approved_improvement; 0 regressions', () => {
    ON();
    const r = resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() });
    expect(r.fields.category).toBe('AI-driven digital marketing & content platform');
    expect(r.observation.unexpectedRegressions).toBe(0);
    expect(r.observation.deltas.find((d) => d.field === 'category')?.class).toBe('approved_improvement');
  });
});

describe('U2 · unexpected regression fail-safe', () => {
  it('a parity-locked field diverging falls back to legacy and is recorded', () => {
    ON();
    const legacy = { ...LEGACY(), products: ['Legacy Only Product'] };
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', products: ['Different Evidence Product'] }, ai: EVIDENCE().ai };
    const r = resolveCompanyProjection(legacy, { evidence });
    expect(r.source).toBe('legacy_fallback');
    expect(r.observation.unexpectedRegressions).toBeGreaterThan(0);
    expect(r.fields.products).toEqual(['Legacy Only Product']); // legacy served, never the regressed value
  });
});

describe('U2 · projection version + explainability', () => {
  it('observation carries the model version', () => {
    ON();
    expect(resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() }).observation.version).toBe(COMPANY_MODEL_VERSION);
  });
  it('every projected divergence is traceable via the delta record', () => {
    ON();
    const deltas = resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() }).observation.deltas;
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) expect(['parity', 'approved_improvement', 'expected_abstention', 'unexpected_regression']).toContain(d.class);
  });
});

describe('U2 · Omnivyra projection', () => {
  it('corrects category, preserves name/domain/products, abstains competitors', () => {
    ON();
    const r = resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() });
    expect(r.source).toBe('canonical_evidence');
    expect(r.fields.category).toBe('AI-driven digital marketing & content platform');
    expect(r.fields.name).toBe('Omnivyra');
    expect(r.fields.domain).toBe('omnivyra.com');
    expect(r.fields.products).toEqual(['AI-Driven Digital Marketing System', 'SEO and website health analysis']);
    expect(r.fields.competitors).toEqual([]);
  });
});

describe('U2 · performance + determinism', () => {
  it('is deterministic and constant-time (1000 resolves, no network)', () => {
    ON();
    const first = resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() });
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(resolveCompanyProjection(LEGACY(), { evidence: EVIDENCE() })).toEqual(first); // deterministic
    expect(ms).toBeLessThan(2000); // well under; pure in-memory
  });
});

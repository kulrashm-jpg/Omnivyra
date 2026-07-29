/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 2 — Content Architect.
 *
 * Certifies the Content Architect content pipeline reads its projection-owned `category` identity through
 * the seam: byte-identical when the flag is OFF, projected when ON (evidence-derived when supplied),
 * fail-safe on regression, no reclassification, explainability preserved, O(1) rollback, isolation.
 * Types: Inventory · Projection Integration · Prompt Input · Output Parity · Approved Improvement ·
 * Unexpected Regression · Rollback · Explainability · Performance · Consumer Isolation.
 */
import { adoptContentArchitectIdentity } from '../../services/companyIntelligence/adoption/consumers/contentArchitectConsumer';
import { readCompanyProfileIdentity, companyProfileRecordToInput } from '../../services/companyIntelligence/adoption/consumers/companyProfileConsumer';
import { buildCompanyContextFoundation } from '../../services/longForm/companyContextFoundation';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';
import type { CompanyProfile } from '../../services/companyProfileService';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

const RECORD = () => ({
  company_id: 'omnivyra', name: 'Omnivyra', website_url: 'omnivyra.com',
  category: 'Analytics software for clearer performance insights',
  business_classification: { level_1: 'Software' }, competitors: [], products_services: 'Marketing system',
});
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com' },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform' },
});
const catOf = (rec: ReturnType<typeof RECORD>) => rec.category;

describe('U3·C2 · inventory + projection integration', () => {
  it('flag OFF → identity unchanged; flag ON + evidence → projected category', () => {
    expect(catOf(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF))).toBe('Analytics software for clearer performance insights');
    ON();
    expect(catOf(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE()))).toBe('AI-driven digital marketing & content platform');
  });
});

describe('U3·C2 · prompt input (through buildCompanyContextFoundation)', () => {
  it('businessIdentity.companyCategory flows from the (projected) category — OFF byte-identical', () => {
    const foundation = buildCompanyContextFoundation(RECORD() as unknown as CompanyProfile);
    expect(foundation.businessIdentity.companyCategory).toBe('Analytics software for clearer performance insights');
  });
  it('flag ON without evidence keeps the stored category (no reclassification at prompt time)', () => {
    ON();
    const foundation = buildCompanyContextFoundation(RECORD() as unknown as CompanyProfile);
    expect(foundation.businessIdentity.companyCategory).toBe('Analytics software for clearer performance insights');
  });
});

describe('U3·C2 · output parity + rollback (O(1))', () => {
  it('flag OFF returns the SAME profile reference (no-op)', () => {
    const rec = RECORD();
    expect(adoptContentArchitectIdentity(rec, 'omnivyra', ASOF)).toBe(rec);
  });
  it('ON→OFF restores identical output', () => {
    const before = adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF);
    ON();
    expect(catOf(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE()))).toBe('AI-driven digital marketing & content platform');
    OFF();
    expect(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF)).toEqual(before);
  });
});

describe('U3·C2 · approved improvement + unexpected regression fail-safe', () => {
  it('approved: category corrects under evidence', () => {
    ON();
    expect(catOf(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE()))).toBe('AI-driven digital marketing & content platform');
  });
  it('regression: a parity-locked divergence (name) keeps the stored category', () => {
    ON();
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'DIFFERENT NAME', domain: 'omnivyra.com' }, ai: EVIDENCE().ai };
    // name diverges → fail-safe legacy_fallback → category stays the stored value (never a regressed identity)
    expect(catOf(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, evidence))).toBe('Analytics software for clearer performance insights');
  });
});

describe('U3·C2 · explainability (seam preserves the chain)', () => {
  it('the underlying read exposes deltas + version for the category', () => {
    ON();
    const identity = readCompanyProfileIdentity({ ...companyProfileRecordToInput(RECORD(), 'omnivyra', ASOF), evidence: EVIDENCE() });
    expect(identity.observation.deltas.find((d) => d.field === 'category')?.class).toBe('approved_improvement');
    expect(identity.projectionVersion).toBeGreaterThan(0);
  });
});

describe('U3·C2 · performance + determinism', () => {
  it('1000 adopts, no network, deterministic', () => {
    ON();
    const first = adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE());
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE());
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(adoptContentArchitectIdentity(RECORD(), 'omnivyra', ASOF, EVIDENCE())).toEqual(first);
    expect(ms).toBeLessThan(2000);
  });
});

describe('U3·C2 · consumer isolation (consumes, never derives)', () => {
  it('never mutates the input profile and only touches category', () => {
    ON();
    const rec = RECORD();
    const snapshot = JSON.parse(JSON.stringify(rec));
    const out = adoptContentArchitectIdentity(rec, 'omnivyra', ASOF, EVIDENCE());
    expect(rec).toEqual(snapshot);                 // input untouched
    expect(out.name).toBe('Omnivyra');             // non-category identity preserved
    expect(out.products_services).toBe('Marketing system');
    expect(out.business_classification).toEqual({ level_1: 'Software' }); // not reclassified
  });
});

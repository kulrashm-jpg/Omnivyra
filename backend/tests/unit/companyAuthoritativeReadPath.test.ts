/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U5 Stage A — Authoritative Read Path.
 *
 * Certifies the projection can read a PERSISTED canonical understanding as the production source of truth
 * (no companyFromProfile reconstruction, no legacy echo), flag-gated, with the fail-safe intact. Flag OFF ⇒
 * persistedCanonical is ignored and legacy is returned (byte-identical). Additive — existing calls unaffected.
 */
import { resolveCompanyProjection } from '../../services/companyIntelligence/adoption/consumerAdapter';
import { buildCompanyUnderstandingFromEvidence, type EvidenceSources } from '../../services/companyIntelligence/evidence';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

const PROFILE = (): CompanyProfileInput => ({ companyId: 'omnivyra', asOf: ASOF, name: 'Omnivyra', domain: 'omnivyra.com', category: 'Analytics software for clearer performance insights', products: ['AI Marketing System'] });
const PERSISTED = (name = 'Omnivyra') => buildCompanyUnderstandingFromEvidence(
  { profile: { companyId: 'omnivyra', observedAt: ASOF, name, domain: 'omnivyra.com', products: ['AI Marketing System'] }, ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', businessModel: 'Subscription SaaS', providerType: 'software/product' } } as EvidenceSources,
  ASOF,
);

describe('U5·A · authoritative read path', () => {
  it('flag OFF → persistedCanonical ignored; legacy returned (byte-identical)', () => {
    const r = resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED() });
    expect(r.source).toBe('legacy');
    expect(r.fields.category).toBe('Analytics software for clearer performance insights');
    expect(r).toEqual(resolveCompanyProjection(PROFILE())); // identical to a no-opts legacy call
  });

  it('flag ON + persistedCanonical → projection reads the persisted canonical (source of truth)', () => {
    ON();
    const r = resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED() });
    expect(r.source).toBe('canonical_persisted');
    expect(r.fields.category).toBe('AI-driven digital marketing & content platform'); // from persistence, not legacy
    expect(r.fields.business_model).toBe('Subscription SaaS');
    expect(r.worldView?.businessModel).toBe('Subscription SaaS');
    expect(r.observation.path).toBe('canonical_persisted');
    expect(r.observation.version).toBeGreaterThan(0);
  });

  it('fail-safe: a parity-locked divergence (name) in the persisted canonical degrades to legacy', () => {
    ON();
    const r = resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED('DIFFERENT NAME') });
    expect(r.source).toBe('legacy_fallback');
    expect(r.fields.name).toBe('Omnivyra'); // legacy served, never the divergent identity
    expect(r.observation.unexpectedRegressions).toBeGreaterThan(0);
  });

  it('rollback: ON→OFF restores the legacy result', () => {
    const before = resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED() });
    ON();
    expect(resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED() }).source).toBe('canonical_persisted');
    OFF();
    expect(resolveCompanyProjection(PROFILE(), { persistedCanonical: PERSISTED() })).toEqual(before);
  });
});

/**
 * Phase 11D — domain validation success cache tests.
 * Exercises the real in-memory cache through validateCompanyIdentity with a
 * controllable clock + injected stage stubs (no DNS, no DB).
 */

import { validateCompanyIdentity } from '../../services/companyIdentityValidationService';
import {
  clearDomainVerdictCache,
  domainVerdictCacheSize,
  DOMAIN_VALIDATION_SUCCESS_TTL_MS,
} from '../../services/companyIdentityValidationCache';
import type { ResolveDomainResult } from '../../services/domainCanonicalService';

const live = (d: string): ResolveDomainResult => ({ input_domain: d, final_domain: d, redirect_chain: [], is_forwarding: false });

beforeEach(() => clearDomainVerdictCache());

function harness(over: Partial<Parameters<typeof validateCompanyIdentity>[1]> = {}) {
  let clock = 1_000_000;
  let probes = 0;
  const innerProbe = over.probeWebsite ?? (async (d: string) => live(d));
  const deps = {
    checkEligibility: async () => ({ result: 'DOMAIN_ELIGIBLE' as const, eligible: true }),
    // AUTH-001 §7: stub the parked-domain probe so unit tests stay
    // deterministic (the default implementation performs a real fetch).
    probeParked: async () => ({ parked: false, checked: true }),
    lookupClaimedCompany: async () => null,
    now: () => clock,
    ...over,
    // Count every probe, wrapping whatever (possibly overridden) probe impl is used.
    probeWebsite: async (d: string) => { probes += 1; return innerProbe(d); },
  };
  return {
    deps,
    probeCount: () => probes,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('Phase 11D — domain validation success cache', () => {
  it('cache MISS: first call probes and populates the cache', async () => {
    const h = harness();
    const r = await validateCompanyIdentity('john@acme.com', h.deps);
    expect(r.eligible).toBe(true);
    expect(h.probeCount()).toBe(1);
    expect(domainVerdictCacheSize()).toBe(1);
  });

  it('cache HIT: second call serves from cache, does NOT probe again', async () => {
    const h = harness();
    await validateCompanyIdentity('john@acme.com', h.deps);
    const r2 = await validateCompanyIdentity('jane@acme.com', h.deps); // same domain
    expect(r2.eligible).toBe(true);
    expect(h.probeCount()).toBe(1); // still 1 — probe skipped on hit
  });

  it('cached result EQUALS the fresh result', async () => {
    const h = harness();
    const fresh = await validateCompanyIdentity('john@acme.com', h.deps);
    const hit = await validateCompanyIdentity('john@acme.com', h.deps);
    expect(hit).toEqual(fresh);
  });

  it('cache EXPIRY: after TTL the entry expires and re-validates', async () => {
    const h = harness();
    await validateCompanyIdentity('john@acme.com', h.deps);
    expect(h.probeCount()).toBe(1);
    h.advance(DOMAIN_VALIDATION_SUCCESS_TTL_MS); // reach expiry boundary
    const r = await validateCompanyIdentity('john@acme.com', h.deps);
    expect(r.eligible).toBe(true);
    expect(h.probeCount()).toBe(2); // re-probed after expiry
  });

  it('just BEFORE expiry still hits (deterministic boundary)', async () => {
    const h = harness();
    await validateCompanyIdentity('john@acme.com', h.deps);
    h.advance(DOMAIN_VALIDATION_SUCCESS_TTL_MS - 1);
    await validateCompanyIdentity('john@acme.com', h.deps);
    expect(h.probeCount()).toBe(1);
  });

  it('FAILURE never cached: resolution_failed (NO_WEBSITE_FOUND) re-probes every time', async () => {
    const h = harness({ probeWebsite: async (d) => ({ ...live(d), resolution_failed: true }), classifyDomainDns: async () => 'no_records' });
    const r1 = await validateCompanyIdentity('john@acme.com', h.deps);
    expect(r1.validationReason).toBe('NO_WEBSITE_FOUND');
    expect(domainVerdictCacheSize()).toBe(0);
    await validateCompanyIdentity('john@acme.com', h.deps);
    expect(h.probeCount()).toBe(2); // not cached → probed again
  });

  it('REVIEW-REQUIRED not cached: forwarding domain re-evaluates every time', async () => {
    const h = harness({ probeWebsite: async (d) => ({ ...live(d), is_forwarding: true }) });
    const r1 = await validateCompanyIdentity('john@acme.com', h.deps);
    expect(r1.validationReason).toBe('FORWARDING_DOMAIN');
    expect(r1.requiresManualReview).toBe(true);
    expect(domainVerdictCacheSize()).toBe(0);
    await validateCompanyIdentity('john@acme.com', h.deps);
    expect(h.probeCount()).toBe(2);
  });

  it('hard block (PUBLIC_EMAIL) not cached', async () => {
    const h = harness({ checkEligibility: async () => ({ result: 'PUBLIC_EMAIL' as const, eligible: false }) });
    const r = await validateCompanyIdentity('john@gmail.com', h.deps);
    expect(r.validationReason).toBe('PUBLIC_EMAIL');
    expect(domainVerdictCacheSize()).toBe(0);
  });

  it('claimed-domain re-checked on every HIT (cache can never bypass it)', async () => {
    let claimed: { id: string; name: string | null } | null = null;
    const h = harness({ lookupClaimedCompany: async () => claimed });
    const r1 = await validateCompanyIdentity('john@acme.com', h.deps); // success → cached
    expect(r1.eligible).toBe(true);
    claimed = { id: 'co_1', name: 'Acme' }; // domain gets claimed AFTER caching
    const r2 = await validateCompanyIdentity('jane@acme.com', h.deps); // cache hit, but...
    expect(r2.eligible).toBe(false);
    expect(r2.validationReason).toBe('CLAIMED_DOMAIN');
    expect(r2.existingCompany).toEqual({ id: 'co_1', name: 'Acme' });
    expect(h.probeCount()).toBe(1); // probe still skipped on the hit
  });
});

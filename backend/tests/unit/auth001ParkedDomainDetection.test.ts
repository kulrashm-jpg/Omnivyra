/**
 * AUTH-001 §7 — parked/expired-domain detection + identity-engine wiring.
 *
 * Locks: marker matching, fail-open on probe failure, and that
 * validateCompanyIdentity routes a parked verdict to PARKED_DOMAIN with
 * requiresManualReview=true + diagnostics — running the probe ONLY after
 * every other rule passed, and never caching a parked verdict.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/domainEligibilityService', () => ({ checkDomainEligibility: jest.fn() }));
jest.mock('../../services/domainCanonicalService', () => ({ resolveDomain: jest.fn() }));

import { safeFetch } from '../../../lib/security/safeFetch';
import { detectParkedDomain } from '../../services/parkedDomainDetectionService';
import { validateCompanyIdentity } from '../../services/companyIdentityValidationService';

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

const page = (html: string, ok = true) =>
  ({ ok, status: ok ? 200 : 500, text: async () => html }) as unknown as Response;

describe('AUTH-001 §7 — detectParkedDomain', () => {
  test('matches high-specificity parking markers', async () => {
    mockSafeFetch.mockResolvedValueOnce(page('<html><body>This domain is for sale. Contact broker.</body></html>'));
    const verdict = await detectParkedDomain('parked-example.com');
    expect(verdict.parked).toBe(true);
    expect(verdict.checked).toBe(true);
    expect(verdict.marker).toBe('this domain is for sale');
  });

  test('matches parking-provider script hosts', async () => {
    mockSafeFetch.mockResolvedValueOnce(page('<script src="https://www.sedoparking.com/frmpark.js"></script>'));
    expect((await detectParkedDomain('x.com')).parked).toBe(true);
  });

  test('matches registrar expiry landers', async () => {
    mockSafeFetch.mockResolvedValueOnce(page('<h1>This domain has expired.</h1>'));
    expect((await detectParkedDomain('x.com')).parked).toBe(true);
  });

  test('a real company page passes (no generic false positives)', async () => {
    mockSafeFetch.mockResolvedValueOnce(page(
      '<html><title>Acme Realty — homes for sale</title><body>Browse our properties for sale in Springfield.</body></html>',
    ));
    const verdict = await detectParkedDomain('acmerealty.com');
    expect(verdict).toEqual({ parked: false, checked: true });
  });

  test('fail-open: fetch error / non-200 → not parked, not checked', async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await detectParkedDomain('x.com')).toEqual({ parked: false, checked: false });

    mockSafeFetch.mockResolvedValueOnce(page('ignored', false));
    expect(await detectParkedDomain('x.com')).toEqual({ parked: false, checked: false });

    expect(await detectParkedDomain('')).toEqual({ parked: false, checked: false });
  });
});

describe('AUTH-001 §7 — validateCompanyIdentity wiring', () => {
  const cleanResolution = {
    input_domain: 'acme.com',
    final_domain: 'acme.com',
    redirect_chain: [],
    is_forwarding: false,
  };

  const deps = (probeParked: jest.Mock, cacheSet = jest.fn()) => ({
    checkEligibility: jest.fn(async () => ({ result: 'DOMAIN_ELIGIBLE' as const, eligible: true })),
    probeWebsite: jest.fn(async () => cleanResolution),
    probeParked,
    lookupClaimedCompany: jest.fn(async () => null),
    cacheGet: () => null,
    cacheSet,
  });

  test('parked verdict → PARKED_DOMAIN, manual review, diagnostics, NOT cached', async () => {
    const cacheSet = jest.fn();
    const probeParked = jest.fn(async () => ({ parked: true, checked: true, marker: 'hugedomains.com' }));
    const identity = await validateCompanyIdentity('user@acme.com', deps(probeParked, cacheSet));

    expect(identity.eligible).toBe(false);
    expect(identity.validationReason).toBe('PARKED_DOMAIN');
    expect(identity.requiresManualReview).toBe(true);
    expect(identity.diagnostics).toEqual({ parkedMarker: 'hugedomains.com' });
    expect(probeParked).toHaveBeenCalledWith('acme.com');
    expect(cacheSet).not.toHaveBeenCalled();
  });

  test('clean (or unchecked) verdict → eligible, success cached', async () => {
    const cacheSet = jest.fn();
    const probeParked = jest.fn(async () => ({ parked: false, checked: false }));
    const identity = await validateCompanyIdentity('user@acme.com', deps(probeParked, cacheSet));

    expect(identity.eligible).toBe(true);
    expect(identity.validationReason).toBeNull();
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  test('probe runs ONLY after the other rules pass (ineligible email skips it)', async () => {
    const probeParked = jest.fn();
    const identity = await validateCompanyIdentity('user@gmail.com', {
      ...deps(probeParked),
      checkEligibility: jest.fn(async () => ({ result: 'PUBLIC_EMAIL' as const, eligible: false })),
    });
    expect(identity.validationReason).toBe('PUBLIC_EMAIL');
    expect(probeParked).not.toHaveBeenCalled();
  });
});

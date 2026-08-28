/**
 * CP-STRUCT-005 — the platform-config request must carry authentication.
 *
 * The live symptom was "Access denied to this company." in
 * PlatformContentMatrix, which renders ONLY on HTTP 403. The cause was not a
 * tenancy problem: `getCompanyPlatformConfig` used a bare
 * `fetch(..., { credentials: 'include' })` with no `Authorization: Bearer`
 * header, so the route authenticated by cookie alone. When that failed,
 * `resolveUserContext` fell back to a synthetic dev identity — a member of no
 * company — so `assertTenantAccess` returned NOT_A_MEMBER and the route
 * answered 403 rather than 401. An authentication failure was therefore
 * displayed as a tenancy denial.
 *
 * Verified against production: an unauthenticated GET to
 * /api/company/platform-config returns 403 {"error":"Access denied to company"}.
 *
 * These tests pin the request contract and the error mapping. They do NOT
 * change or assert new authorization semantics — a genuine non-member must
 * still be denied.
 */

const mockFetchWithAuth = jest.fn();
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

import { getCompanyPlatformConfig } from '../../../lib/companyPlatformService';

const COMPANY = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  mockFetchWithAuth.mockReset();
  // A bare global fetch must never be reached by this service.
  (globalThis as { fetch?: unknown }).fetch = jest.fn(() => {
    throw new Error('bare fetch used — the request would carry no Bearer token');
  });
});

describe('CP-STRUCT-005 — the request is authenticated', () => {
  it('routes through fetchWithAuth, never a bare fetch', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(200, { platforms: [] }));
    await getCompanyPlatformConfig(COMPANY);

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requests the canonical route with the company id encoded', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(200, { platforms: [] }));
    await getCompanyPlatformConfig(COMPANY);

    expect(String(mockFetchWithAuth.mock.calls[0][0]))
      .toBe(`/api/company/platform-config?companyId=${encodeURIComponent(COMPANY)}`);
  });

  it('does not hand-roll auth headers — fetchWithAuth owns that', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(200, { platforms: [] }));
    await getCompanyPlatformConfig(COMPANY);

    const init = mockFetchWithAuth.mock.calls[0][1] as Record<string, unknown> | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('the response contract is unchanged', () => {
  it('returns the platform list on success', async () => {
    const platforms = [{ platform: 'linkedin', content_types: ['post', 'carousel'] }];
    mockFetchWithAuth.mockResolvedValue(reply(200, { platforms }));
    await expect(getCompanyPlatformConfig(COMPANY)).resolves.toEqual({ platforms });
  });

  it('a genuine non-member is STILL denied — 403 propagates with its status', async () => {
    // The fix must not weaken authorization. This is the case the UI is
    // entitled to report as "Access denied to this company."
    mockFetchWithAuth.mockResolvedValue(reply(403, { error: 'Access denied to company' }));
    await expect(getCompanyPlatformConfig(COMPANY)).rejects.toMatchObject({
      status: 403,
      message: 'Access denied to company',
    });
  });

  it('an unauthenticated response propagates as 401, so the UI can say "log in again"', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(401, { error: 'Unauthorized' }));
    await expect(getCompanyPlatformConfig(COMPANY)).rejects.toMatchObject({ status: 401 });
  });

  it('a transient tenant-lookup failure propagates as 503, not a denial', async () => {
    // enforceCompanyAccess returns 503 on TENANT_LOOKUP_ERROR precisely so a
    // member is never locked out by a blip; the client must not flatten it.
    mockFetchWithAuth.mockResolvedValue(reply(503, { error: 'temporarily unavailable' }));
    await expect(getCompanyPlatformConfig(COMPANY)).rejects.toMatchObject({ status: 503 });
  });

  it('a body-less error still yields a usable message and status', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error('not json'); },
    });
    await expect(getCompanyPlatformConfig(COMPANY)).rejects.toMatchObject({
      status: 500,
      message: 'Failed to load platform config',
    });
  });
});

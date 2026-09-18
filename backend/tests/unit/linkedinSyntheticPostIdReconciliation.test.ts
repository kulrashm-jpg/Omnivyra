/**
 * LinkedIn reconciliation — a synthetic post id is unverifiable, not "no_match".
 *
 * WHY THIS EXISTS
 * ---------------
 * linkedinAdapter reads the published post's URN from LinkedIn's x-restli-id
 * response header, falling back to an id in the body. When a 2xx publish
 * carries neither, it stores `linkedin_<Date.now()>` instead — a non-URN id.
 * It has to store SOMETHING non-empty: publishNowService uses
 * platform_post_id as the re-publish guard, so an empty id would let the row
 * publish a second time.
 *
 * linkedinReconciliation then fed that synthetic id to
 * `GET /rest/posts/<urn-encoded-id>`. LinkedIn answers 404, and the 404 branch
 * classifies it `confidence: 'no_match'` with the diagnostic "post is deleted
 * or was never visible at this URN" — about a post that was genuinely
 * published and is live. A fabricated verdict, and the exact opposite of the
 * truth.
 *
 * The module's own header states its contract: anything it cannot verify
 * returns `unverifiable` and reconciliation stays observation-only. An id that
 * is not a LinkedIn URN is precisely that case, and it is knowable before any
 * network call.
 *
 * All HTTP is mocked (global.fetch). Nothing here contacts LinkedIn and no
 * credential is used.
 */

export {};

const mockFetch = jest.fn();

function stubFetch(status: number, body: string) {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  });
  (global as any).fetch = mockFetch;
}

const loadLookup = async () => {
  jest.resetModules();
  const registered: any[] = [];
  jest.doMock('../../services/providerReconciliation/types', () => ({
    registerProviderReconciliationLookup: (l: any) => registered.push(l),
  }));
  jest.doMock('../../auth/tokenStore', () => ({
    getToken: async () => ({ access_token: 'tok' }),
  }));
  await import('../../services/providerReconciliation/providers/linkedinReconciliation');
  return registered[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe('linkedinReconciliation — synthetic platform_post_id', () => {
  it('CRITICAL: the adapter fallback id is unverifiable, never no_match', async () => {
    // A 404 is what LinkedIn actually answers for this id; the point is that we
    // never ask, so the 404 can never be turned into "deleted or never existed".
    stubFetch(404, '');
    const lookup = await loadLookup();

    const r = await lookup.lookup({
      row: { platform_post_id: 'linkedin_1758200000000' },
      socialAccountId: 'acct-1',
    });

    expect(r.confidence).toBe('unverifiable');
    expect(r.confidence).not.toBe('no_match');
    expect(String(r.diagnostic)).toMatch(/not a LinkedIn URN/i);
    // Refused before the lookup — no token was spent and no call was made.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('CRITICAL: the diagnostic does not claim the post was deleted', async () => {
    stubFetch(404, '');
    const lookup = await loadLookup();

    const r = await lookup.lookup({
      row: { platform_post_id: 'linkedin_1758200000000' },
      socialAccountId: 'acct-1',
    });

    expect(String(r.diagnostic)).not.toMatch(/deleted/i);
    expect(String(r.diagnostic)).not.toMatch(/never visible/i);
    expect(String(r.diagnostic)).toMatch(/verify the post manually/i);
  });

  it('a real URN is still looked up and a 404 is still no_match (preserved)', async () => {
    stubFetch(404, '');
    const lookup = await loadLookup();

    const r = await lookup.lookup({
      row: { platform_post_id: 'urn:li:share:123' },
      socialAccountId: 'acct-1',
    });

    expect(r.confidence).toBe('no_match');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('every documented URN family still reaches the lookup', async () => {
    for (const urn of ['urn:li:share:1', 'urn:li:ugcPost:2', 'urn:li:post:3']) {
      jest.clearAllMocks();
      stubFetch(200, JSON.stringify({ id: urn }));
      const lookup = await loadLookup();

      await lookup.lookup({ row: { platform_post_id: urn }, socialAccountId: 'acct-1' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('a missing id is still its own unverifiable case (preserved)', async () => {
    stubFetch(200, '{}');
    const lookup = await loadLookup();

    const r = await lookup.lookup({ row: { platform_post_id: null }, socialAccountId: 'acct-1' });

    expect(r.confidence).toBe('unverifiable');
    expect(String(r.diagnostic)).toMatch(/no platform_post_id/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

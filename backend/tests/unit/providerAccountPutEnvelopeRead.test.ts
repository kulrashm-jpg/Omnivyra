/**
 * Route level (2026-11-12): PUT /api/provider-accounts/[id] with credentials.
 *  - envelope read error -> 503, NOTHING written (it used to merge onto nothing
 *    and overwrite the stored secrets with only the supplied fields);
 *  - the update carries the envelope AS READ as its CAS expectation;
 *  - a lost CAS -> 409 CREDENTIALS_CHANGED.
 */
export {};
let mockEnvelopeRead: { data: unknown; error: { message: string } | null } = { data: { credentials_encrypted: 'ENV-v1' }, error: null };
const mockUpdates: Array<{ patch: Record<string, unknown>; opts: unknown }> = [];
let mockConflict = false;

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: 'sa1' } }) }));
jest.mock('../../security/platformWriteAuthority', () => ({ enforcePlatformWriteAuthority: async () => true }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      let n = 0;
      const b: any = { select: (cols: string) => { n = cols.includes('credentials_encrypted') ? 2 : 1; return b; }, eq: () => b };
      b.maybeSingle = async () => (n === 2 ? mockEnvelopeRead : { data: { id: 'a1', api_source_id: 's', account_name: 'x' }, error: null });
      return b;
    },
  },
}));
jest.mock('../../services/providerAccountService', () => {
  class ProviderAccountConflictError extends Error {}
  return {
    ProviderAccountConflictError,
    buildCredentialEnvelope: ({ existing, supplied }: { existing: string | null; supplied: unknown }) => `merged(${existing}|${JSON.stringify(supplied)})`,
    updateProviderAccount: async (_id: string, patch: Record<string, unknown>, opts: unknown) => {
      mockUpdates.push({ patch, opts });
      if (mockConflict) throw new ProviderAccountConflictError('changed');
      return { id: 'a1', ...patch };
    },
    deactivateProviderAccount: async () => undefined,
  };
});

import handler from '../../../pages/api/provider-accounts/[id]';

function mockRes() { const r: any = { statusCode: 0, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; return r; }
async function put(body: unknown) { const res = mockRes(); await handler({ method: 'PUT', query: { id: 'a1' }, body, headers: {} } as any, res); return res; }

beforeEach(() => { mockEnvelopeRead = { data: { credentials_encrypted: 'ENV-v1' }, error: null }; mockUpdates.length = 0; mockConflict = false; });

it('envelope read error -> 503 and NOTHING written (never merged onto nothing)', async () => {
  mockEnvelopeRead = { data: null, error: { message: 'down' } };
  const r = await put({ credentials: { client_id: 'new' } });
  expect(r.statusCode).toBe(503);
  expect(mockUpdates).toEqual([]);
});

it('the update carries the envelope AS READ as its CAS expectation', async () => {
  const r = await put({ credentials: { client_id: 'new' } });
  expect(r.statusCode).toBe(200);
  expect(mockUpdates[0].opts).toEqual({ expectCredentialsEncrypted: 'ENV-v1' });
});

it('a lost CAS -> 409 CREDENTIALS_CHANGED', async () => {
  mockConflict = true;
  const r = await put({ credentials: { client_id: 'new' } });
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('CREDENTIALS_CHANGED');
});

it('control: a non-credential patch carries no CAS expectation', async () => {
  await put({ account_name: 'renamed' });
  expect(mockUpdates[0].opts).toBeUndefined();
});

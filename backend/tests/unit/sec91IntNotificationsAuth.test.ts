/**
 * STEP 3AH-91 integration — /api/notifications must not re-admit a session the
 * canonical resolver refused.
 *
 * The route used a second, unchecked identity path: when getSupabaseUserFromRequest
 * rejected the caller (deleted / suspended / revoked session / invited), it rebuilt
 * an @supabase/ssr client from the request cookies, called getUser(), and mapped
 * supabase_uid → users.id with no account-state checks — the same class as
 * SEC91-W2B-1 (connectors/utils). The canonical resolver already reads the cookie,
 * so the fallback only ever re-admitted callers the resolver had refused.
 */
export {};

const mockCanonical = jest.fn();
const mockSsrGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => mockCanonical(...a),
}));
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: (...a: unknown[]) => mockSsrGetUser(...a) } }),
}));
jest.mock('../../../lib/supabase/publishableKey', () => ({ requireSupabasePublishableKey: () => 'pk-placeholder' }));
jest.mock('../../db/supabaseClient', () => {
  const builder: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'in', 'is']) builder[m] = (..._a: unknown[]) => builder;
  builder.maybeSingle = async () => ({ data: { id: 'internal-user-from-fallback' }, error: null });
  builder.then = (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
  return { supabase: { from: (t: string) => { mockFrom(t); return builder; } } };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/notifications').default;

function run(method = 'GET') {
  const out: { status: number; body: unknown } = { status: 0, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  const req: any = { method, query: {}, body: {}, headers: {}, cookies: { 'sb-x-auth-token': 'cookie-session' }, url: '/api/notifications' };
  return Promise.resolve(handler(req, res)).then(() => out);
}

beforeEach(() => { mockCanonical.mockReset(); mockSsrGetUser.mockReset(); mockFrom.mockReset(); });

it.each(['ACCOUNT_DELETED', 'ACCOUNT_SUSPENDED', 'SESSION_REVOKED', 'INVALID_AUTH'])(
  'a session the canonical resolver refused (%s) gets 401 — the cookie is never re-resolved',
  async (reason) => {
    mockCanonical.mockResolvedValue({ user: null, error: reason });
    mockSsrGetUser.mockResolvedValue({ data: { user: { id: 'supabase-uid-of-refused-account' } } });
    const r = await run();
    expect(r.status).toBe(401);
    expect(mockSsrGetUser).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith('users');
  },
);

it('an accepted session is still served', async () => {
  mockCanonical.mockResolvedValue({ user: { id: 'user-a' }, error: null });
  const r = await run();
  expect(r.status).not.toBe(401);
});

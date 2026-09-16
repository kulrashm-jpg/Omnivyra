/**
 * SEC91-W2B-1 (P2) — requireManageConnectors must resolve cookie sessions through the
 * canonical auth resolver.
 *
 * THE DEFECT: pages/api/community-ai/connectors/utils.ts `requireManageConnectors` first
 * called the canonical resolver (getSupabaseUserFromRequest → resolveAuthenticatedUser,
 * which already reads the Supabase auth cookie) and, whenever that returned ANY error,
 * fell back to its own @supabase/ssr cookie client: `auth.getUser()` + a bare
 * `users.supabase_uid` lookup. That fallback skipped every account-state check the
 * canonical resolver applies, so a soft-deleted user, a suspended user, a user whose
 * sessions were revoked (users.session_revoked_after) and a not-yet-accepted invitee were
 * all REJECTED by the resolver and then ACCEPTED by the fallback — and could start or
 * finish connector OAuth (write provider tokens into the organization).
 *
 * NOW: the cookie session goes through the canonical resolver only; its verdict is final.
 *
 * Only the database and GoTrue are faked. The canonical resolver
 * (backend/services/authResolver.ts), the legacy facade and rbacService run for real. The
 * @supabase/ssr fake validates the same cookie the same way GoTrue would (deletion,
 * suspension and revocation are application-level, so GoTrue still accepts the token) —
 * i.e. exactly what the removed fallback saw in production.
 */
import { seed } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = require('../helpers/routeAuthHarness');
  const db = {
    ...h.fakeSupabase,
    auth: { getUser: async (token?: string) => mockGoTrue(token) },
  };
  return { supabase: db, default: db, getSupabase: () => db, supabaseAdmin: db };
});
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../security/startup/authSubsystemBoot', () => ({ __esModule: true, bootAuthSubsystem: async () => undefined }));
jest.mock('../../../lib/supabase/publishableKey', () => ({ requireSupabasePublishableKey: () => 'fake-publishable' }));
// What the removed fallback would have seen: a GoTrue-valid cookie session.
jest.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { getAll: () => Array<{ name: string; value: string }> } }) => ({
    auth: {
      getUser: async () => {
        const cookie = opts.cookies.getAll().find((c) => /^sb-[a-z0-9]+-auth-token$/i.test(c.name));
        if (!cookie) return { data: { user: null }, error: null };
        const raw = cookie.value.replace(/^base64-/, '');
        const token = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).access_token as string;
        const r = await mockGoTrue(token);
        return { data: { user: r.data.user }, error: r.error };
      },
    },
  }),
}));

const b64u = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A JWT-shaped token (GoTrue is faked, so the signature is irrelevant; the resolver reads `iat`). */
const jwt = (sub: string, iat: number) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub, iat })}.sig`;

const ISSUED_AT = 1_780_000_000; // seconds
const ORG = 'co-a-0000-0000-0000-00000000000a';
const P = {
  active: { uid: 'auth-active-0000', id: 'user-active-0000', email: 'active@example.test' },
  deleted: { uid: 'auth-deleted-000', id: 'user-deleted-000', email: 'deleted@example.test' },
  statusDeleted: { uid: 'auth-stdel-00000', id: 'user-stdel-00000', email: 'stdel@example.test' },
  suspended: { uid: 'auth-suspend-000', id: 'user-suspend-000', email: 'suspended@example.test' },
  revoked: { uid: 'auth-revoked-000', id: 'user-revoked-000', email: 'revoked@example.test' },
  invited: { uid: 'auth-invited-000', id: 'user-invited-000', email: 'invited@example.test' },
  outsider: { uid: 'auth-outside-000', id: 'user-outside-000', email: 'outsider@example.test' },
} as const;
type Who = keyof typeof P;

const mockTokens: Record<string, { id: string; email: string; email_confirmed_at: string }> = {};
for (const k of Object.keys(P) as Who[]) {
  mockTokens[jwt(P[k].uid, ISSUED_AT)] = { id: P[k].uid, email: P[k].email, email_confirmed_at: '2026-01-01T00:00:00Z' };
}
async function mockGoTrue(token?: string) {
  const u = token ? mockTokens[token] : undefined;
  return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { requireManageConnectors } = require('../../../pages/api/community-ai/connectors/utils');
/* eslint-enable @typescript-eslint/no-var-requires */

const userRow = (who: Who, extra: Record<string, unknown> = {}) => ({
  id: P[who].id, supabase_uid: P[who].uid, email: P[who].email,
  is_deleted: false, status: 'active', session_revoked_after: null, ...extra,
});

beforeEach(() => {
  seed({
    users: [
      userRow('active'),
      userRow('deleted', { is_deleted: true }),
      userRow('statusDeleted', { status: 'deleted' }),
      userRow('suspended', { status: 'suspended' }),
      // Sessions revoked one hour AFTER the token was issued → the token is dead.
      userRow('revoked', { session_revoked_after: new Date((ISSUED_AT + 3600) * 1000).toISOString() }),
      userRow('invited', { status: 'invited' }),
      userRow('outsider'),
    ],
    user_company_roles: (['active', 'deleted', 'statusDeleted', 'suspended', 'revoked', 'invited'] as Who[]).map((w) => ({
      user_id: P[w].id, company_id: ORG, role: 'COMPANY_ADMIN', status: 'active',
    })),
  });
});

/** Browser navigation: no Authorization header, only the @supabase/ssr session cookie. */
function cookieReq(who: Who | null): any {
  const cookies: Record<string, string> = {};
  if (who) {
    const envelope = { access_token: jwt(P[who].uid, ISSUED_AT), refresh_token: 'rt', token_type: 'bearer' };
    cookies['sb-testref-auth-token'] = `base64-${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')}`;
  }
  return {
    method: 'GET',
    query: {},
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    cookies,
    socket: { remoteAddress: '127.0.0.1' },
  };
}
function bearerReq(who: Who): any {
  return { method: 'GET', query: {}, headers: { authorization: `Bearer ${jwt(P[who].uid, ISSUED_AT)}` }, cookies: {}, socket: { remoteAddress: '127.0.0.1' } };
}
function fakeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  return { res, out };
}
async function run(req: any) {
  const { res, out } = fakeRes();
  const access = await requireManageConnectors(req, res, ORG);
  return { access, ...out };
}

describe('SEC91-W2B-1 requireManageConnectors — cookie sessions obey the canonical account-state checks', () => {
  it('LEGITIMATE: an active member with a browser cookie session is allowed (cookie support preserved)', async () => {
    const r = await run(cookieReq('active'));
    expect(r.access).toEqual({ userId: P.active.id, role: 'COMPANY_ADMIN' });
  });

  it('LEGITIMATE: an active member with a Bearer token is allowed', async () => {
    const r = await run(bearerReq('active'));
    expect(r.access).toEqual({ userId: P.active.id, role: 'COMPANY_ADMIN' });
  });

  it.each([
    ['soft-deleted (is_deleted)', 'deleted'],
    ['deleted (status=deleted)', 'statusDeleted'],
    ['suspended', 'suspended'],
    ['session-revoked (token iat < session_revoked_after)', 'revoked'],
    ['invited, not yet accepted', 'invited'],
  ] as Array<[string, Who]>)('THE BYPASS: a %s user with a GoTrue-valid cookie session → 401, no access', async (_label, who) => {
    const r = await run(cookieReq(who));
    expect(r.access).toBeNull();
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'UNAUTHORIZED' });
  });

  it.each(['deleted', 'suspended', 'revoked'] as Who[])('a %s user presenting a Bearer token is also rejected (unchanged)', async (who) => {
    const r = await run(bearerReq(who));
    expect(r.access).toBeNull();
    expect(r.status).toBe(401);
  });

  it('anonymous → 401', async () => {
    const r = await run(cookieReq(null));
    expect(r.status).toBe(401);
    expect(r.access).toBeNull();
  });

  it('an active user who is not a member of the organization → 403 (authorization unchanged)', async () => {
    const r = await run(cookieReq('outsider'));
    expect(r.access).toBeNull();
    expect(r.status).toBe(403);
  });

  it('the module no longer carries its own cookie-session client', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('pages/api/community-ai/connectors/utils.ts', 'utf8') as string;
    expect(src).not.toMatch(/from '@supabase\/ssr'/);
    expect(src).not.toMatch(/createServerClient\(/);
  });
});

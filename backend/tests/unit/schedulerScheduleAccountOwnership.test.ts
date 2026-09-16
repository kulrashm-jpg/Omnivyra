/**
 * P1-A — POST /api/scheduler/schedule proves that the connected account named by
 * the request belongs to the company the server just authorized, BEFORE it
 * persists or enqueues anything.
 *
 * THE DEFECT: the route authenticated, ran enforceCompanyAccess on the body
 * `companyId`, and then persisted the caller-supplied `accountId` verbatim
 * (`insertPayload.social_account_id`, and `social_account_id` on the thread
 * insert) with no ownership check. At publish time the tenant is derived FROM
 * the account (publishProcessor → resolvePublishingOrganization →
 * social_accounts.company_id) and the post is signed with that account's token,
 * so a member of company A could schedule a post onto company B's connected
 * account and have it published with B's credentials.
 *
 * The real guard chain runs (resolveUserContext → enforceCompanyAccess →
 * TenantGuard.assertTenantAccess → rbacService); only the database, the identity
 * provider, the media resolver and the queue are fake. Authentication, the
 * company verdict, the account-owner read, every scheduled_posts write and every
 * enqueue land in ONE ordered event log.
 */
import {
  seed, invoke, failTable, rows, CO_A, CO_B, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];
const mockHooks: { threadEnabled?: boolean } = {};

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => {
      mockEvents.push(`db:read:${t}`);
      const b = h.fakeSupabase.from(t);
      const insert = b.insert;
      b.insert = (p: unknown) => { mockEvents.push(`db:insert:${t}`); return insert(p); };
      return b;
    },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => {
  const m = jest.requireActual('../helpers/routeAuthHarness').authModule();
  const inner = m.getSupabaseUserFromRequest;
  return { ...m, getSupabaseUserFromRequest: jest.fn(async (req: Record<string, unknown>) => { mockEvents.push('auth'); return inner(req); }) };
});
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/userContextService', () => {
  const actual = jest.requireActual('../../services/userContextService');
  return {
    ...actual,
    enforceCompanyAccess: jest.fn(async (input: unknown) => {
      const r = await actual.enforceCompanyAccess(input);
      mockEvents.push(r ? 'authz:company:ok' : 'authz:company:deny');
      return r;
    }),
  };
});
jest.mock('../../services/creator/creatorPublishResolution', () => ({
  resolvePublishMedia: jest.fn(async () => { mockEvents.push('media:resolve'); return { mediaUrls: [], resolvedCount: 0, fallbackCount: 0 }; }),
}));
jest.mock('../../services/creatorRenderObservability', () => ({ recordCreatorRenderMetric: jest.fn() }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: jest.fn(async () => undefined) }));
jest.mock('../../services/threadRuntime/threadRuntimeInstrumentation', () => ({
  openThreadRuntimeTracer: jest.fn(() => ({
    recordPersistAttempt: jest.fn(), recordPersistSuccess: jest.fn(),
    recordPersistFailure: jest.fn(), recordNodeCreate: jest.fn(),
  })),
}));
jest.mock('../../../lib/thread/threadRuntimeMode', () => ({
  getThreadRuntimeMode: () => (mockHooks.threadEnabled ? 'shadow' : 'off'),
  isMultiRowWriteEnabled: () => Boolean(mockHooks.threadEnabled),
  isLegacyJoinedWriteSkipped: () => false,
  isThreadOrchestratorEnabled: () => false,
  checkEnforceGate: () => ({ allowed: true }),
}));
jest.mock('../../../lib/thread/threadNodePersistence', () => ({
  ThreadInsertError: class extends Error {},
  insertThreadAtomic: jest.fn(async (_db: unknown, payload: { social_account_id?: string | null }) => {
    mockEvents.push(`db:insert:thread:${payload.social_account_id ?? 'none'}`);
    return { rootId: 'thread-root-1', nodeIds: ['thread-root-1', 'thread-node-2'] };
  }),
}));
jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async (id: string, userId: string, accountId: string) => {
    mockEvents.push(`queue:enqueue:${id}:${userId}:${accountId}`);
    return 'enqueued';
  }),
}));

import handler from '../../../pages/api/scheduler/schedule';

const ACCOUNT_A = 'sa-a0000000-0000-4000-8000-00000000000a';
const ACCOUNT_B = 'sa-b0000000-0000-4000-8000-00000000000b';
const ACCOUNT_ORPHAN = 'sa-000000-0000-4000-8000-0000000000ff';
// The caller's own legacy account (no owning company) and the caller's own account
// held by a company the caller is not a member of.
const ACCOUNT_ORPHAN_A = 'sa-000000-0000-4000-8000-0000000000fa';
const ACCOUNT_A_IN_B = 'sa-ab0000-0000-4000-8000-0000000000ab';
const UNKNOWN_ACCOUNT = 'sa-999999-0000-4000-8000-000000000999';
const FUTURE = '2027-06-01T10:00:00.000Z';

beforeEach(() => {
  mockEvents.length = 0;
  mockHooks.threadEnabled = false;
  seed({
    social_accounts: [
      { id: ACCOUNT_A, company_id: CO_A, user_id: USER_A, platform: 'twitter', account_name: 'a-handle' },
      { id: ACCOUNT_B, company_id: CO_B, user_id: USER_B, platform: 'twitter', account_name: 'b-handle' },
      { id: ACCOUNT_ORPHAN, company_id: null, user_id: USER_B, platform: 'twitter', account_name: 'orphan' },
      { id: ACCOUNT_ORPHAN_A, company_id: null, user_id: USER_A, platform: 'twitter', account_name: 'orphan-a' },
      { id: ACCOUNT_A_IN_B, company_id: CO_B, user_id: USER_A, platform: 'twitter', account_name: 'a-in-b' },
    ],
    scheduled_posts: [],
  });
});

const schedule = (body: Record<string, unknown>, as: 'A' | 'B' | 'SUPER' | null) =>
  invoke(handler as never, {
    method: 'POST',
    body: { content: 'hello world', scheduledFor: FUTURE, platform: 'twitter', ...body },
    as,
  });

const inserts = () => mockEvents.filter((e) => e.startsWith('db:insert:'));
const enqueues = () => mockEvents.filter((e) => e.startsWith('queue:'));
const posts = () => rows('scheduled_posts');
const at = (prefix: string) => mockEvents.findIndex((e) => e.startsWith(prefix));

function expectNothingHappened() {
  expect(inserts()).toEqual([]);
  expect(enqueues()).toEqual([]);
  expect(posts()).toEqual([]);
}

// ── 1. Legitimate same-company scheduling still works ────────────────────────
describe('company A scheduling on company A\'s own account', () => {
  it('succeeds: the row is inserted with the account and the publish is enqueued', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A }, 'A');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ message: 'Post scheduled successfully' });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ social_account_id: ACCOUNT_A, user_id: USER_A, status: 'scheduled' });
    expect(enqueues()).toEqual([`queue:enqueue:${posts()[0].id}:${USER_A}:${ACCOUNT_A}`]);
  });

  it('company B on company B\'s own account succeeds too (the guard is not A-specific)', async () => {
    const r = await schedule({ companyId: CO_B, accountId: ACCOUNT_B }, 'B');
    expect(r.status).toBe(201);
    expect(posts()[0]).toMatchObject({ social_account_id: ACCOUNT_B, user_id: USER_B });
  });

  it('an absent accountId keeps its pre-existing behaviour: insert, no account, no enqueue', async () => {
    const r = await schedule({ companyId: CO_A }, 'A');
    expect(r.status).toBe(201);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].social_account_id).toBeUndefined();
    expect(enqueues()).toEqual([]);
    expect(mockEvents).not.toContain('db:read:social_accounts');
  });

  it('an empty accountId keeps its pre-existing behaviour as well', async () => {
    const r = await schedule({ companyId: CO_A, accountId: '' }, 'A');
    expect(r.status).toBe(201);
    expect(posts()[0].social_account_id).toBeUndefined();
    expect(enqueues()).toEqual([]);
  });
});

// ── 2, 3. Foreign and unknown accounts ───────────────────────────────────────
describe('an account the authorized company does not own', () => {
  it.each([
    ['company A naming company B\'s account (the P1-A exploit)', 'A' as const, { companyId: CO_A, accountId: ACCOUNT_B }],
    ['company B naming company A\'s account', 'B' as const, { companyId: CO_B, accountId: ACCOUNT_A }],
    ['an unknown account id', 'A' as const, { companyId: CO_A, accountId: UNKNOWN_ACCOUNT }],
    ['a legacy account (no owning company) connected by someone else', 'A' as const, { companyId: CO_A, accountId: ACCOUNT_ORPHAN }],
    ['no companyId, naming another tenant account', 'A' as const, { accountId: ACCOUNT_B }],
    ['no companyId, a legacy account connected by someone else', 'A' as const, { accountId: ACCOUNT_ORPHAN }],
    ['no companyId, an unknown account id', 'A' as const, { accountId: UNKNOWN_ACCOUNT }],
  ])('%s → 404, nothing inserted, nothing enqueued', async (_n, as, body) => {
    const r = await schedule(body, as);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: 'Social account not found', code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
    expectNothingHappened();
  });

  it('a foreign account is indistinguishable from an unknown one (no existence oracle)', async () => {
    const foreign = await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    const unknown = await schedule({ companyId: CO_A, accountId: UNKNOWN_ACCOUNT }, 'A');
    expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
  });

  it('the denial leaks nothing about company B', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    expect(JSON.stringify(r.body)).not.toContain(CO_B);
    expect(JSON.stringify(r.body)).not.toContain(ACCOUNT_B);
  });
});

// ── 3b. No company named: pages/scheduler.tsx sends only the caller own account ──
describe('no companyId in the body (the scheduler page own-account flow)', () => {
  it('the caller own account in a company the caller belongs to → 201 (pages/scheduler.tsx keeps working)', async () => {
    const r = await schedule({ accountId: ACCOUNT_A }, 'A');
    expect(r.status).toBe(201);
    expect(posts()[0]).toMatchObject({ social_account_id: ACCOUNT_A, user_id: USER_A });
  });

  it('the caller own account, but held by a company the caller is not a member of → 403, nothing happens', async () => {
    const r = await schedule({ accountId: ACCOUNT_A_IN_B }, 'A');
    expect(r.status).toBe(403);
    expectNothingHappened();
  });

  it('the caller own legacy account (no owning company) → 201', async () => {
    const r = await schedule({ accountId: ACCOUNT_ORPHAN_A }, 'A');
    expect(r.status).toBe(201);
    expect(posts()[0]).toMatchObject({ social_account_id: ACCOUNT_ORPHAN_A, user_id: USER_A });
  });

  it('a named company still accepts the caller own legacy account', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_ORPHAN_A }, 'A');
    expect(r.status).toBe(201);
  });

  it('a named company refuses the caller own account when it belongs to ANOTHER company → 404', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A_IN_B }, 'A');
    expect(r.status).toBe(404);
    expectNothingHappened();
  });
});

// ── 4. Lookup failure fails closed ───────────────────────────────────────────
describe('the ownership lookup cannot be answered', () => {
  it('→ 503 retryable, never an allow', async () => {
    failTable('social_accounts');
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A }, 'A');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'SOCIAL_ACCOUNT_LOOKUP_ERROR', retryable: true });
    expectNothingHappened();
  });

  it('a failed lookup denies even the caller\'s own account', async () => {
    failTable('social_accounts');
    const r = await schedule({ companyId: CO_B, accountId: ACCOUNT_B }, 'B');
    expect(r.status).toBe(503);
    expectNothingHappened();
  });
});

// ── 5. Thread (multi-row) path ───────────────────────────────────────────────
describe('the thread multi-row path is governed by the same gate', () => {
  const nodes = [{ position: 0, content: 'first segment' }, { position: 1, content: 'second segment' }];

  it('company A naming company B\'s account → 404, no thread rows, no enqueue', async () => {
    mockHooks.threadEnabled = true;
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_B, nodes }, 'A');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'SOCIAL_ACCOUNT_NOT_FOUND' });
    expect(mockEvents.filter((e) => e.startsWith('db:insert:thread'))).toEqual([]);
    expectNothingHappened();
  });

  it('company A on its own account still reaches the thread insert with that account', async () => {
    mockHooks.threadEnabled = true;
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A, nodes }, 'A');
    expect(r.status).toBe(201);
    expect(mockEvents).toContain(`db:insert:thread:${ACCOUNT_A}`);
  });

  it('an unknown account on the thread path is refused identically', async () => {
    mockHooks.threadEnabled = true;
    const r = await schedule({ companyId: CO_A, accountId: UNKNOWN_ACCOUNT, nodes }, 'A');
    expect(r.status).toBe(404);
    expect(mockEvents.filter((e) => e.startsWith('db:insert:thread'))).toEqual([]);
  });
});

// ── 6, 7. No write and no enqueue on a mismatch ──────────────────────────────
describe('a mismatch has no side effect at all', () => {
  it('no scheduled_posts insert', async () => {
    await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    expect(mockEvents.filter((e) => e === 'db:insert:scheduled_posts')).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it('no publish enqueue', async () => {
    await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    expect(enqueues()).toEqual([]);
  });

  it('not even the media resolution runs', async () => {
    await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    expect(mockEvents).not.toContain('media:resolve');
  });
});

// ── 8. The body companyId cannot authorize another tenant's account ──────────
describe('the request body is never proof of ownership', () => {
  it('naming company B in the body does not let A use B\'s account (the company gate refuses)', async () => {
    const r = await schedule({ companyId: CO_B, accountId: ACCOUNT_B }, 'A');
    expect([403, 404]).toContain(r.status);
    expect(mockEvents).toContain('authz:company:deny');
    expectNothingHappened();
  });

  it('naming company B in the body does not let A use A\'s own account either', async () => {
    const r = await schedule({ companyId: CO_B, accountId: ACCOUNT_A }, 'A');
    expect([403, 404]).toContain(r.status);
    expectNothingHappened();
  });

  // ── 9. A caller-supplied user_id changes nothing ──────────────────────────
  it.each([
    ['company B\'s user id', USER_B],
    ['the account owner\'s user id', USER_B],
    ['a fabricated user id', 'user-does-not-exist'],
  ])('a body user_id (%s) cannot make B\'s account usable by A', async (_n, spoofed) => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_B, user_id: spoofed, userId: spoofed }, 'A');
    expect(r.status).toBe(404);
    expectNothingHappened();
  });

  it('a body user_id does not change the owner recorded on a legitimate insert', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A, user_id: USER_B, userId: USER_B }, 'A');
    expect(r.status).toBe(201);
    expect(posts()[0].user_id).toBe(USER_A);
  });
});

// ── 10. Ordering ─────────────────────────────────────────────────────────────
describe('ordering of the guard chain', () => {
  it('auth → company authorization → account-owner read → insert → enqueue', async () => {
    await schedule({ companyId: CO_A, accountId: ACCOUNT_A }, 'A');
    const authAt = at('auth');
    const companyAt = mockEvents.indexOf('authz:company:ok');
    const ownerAt = mockEvents.indexOf('db:read:social_accounts');
    const insertAt = mockEvents.indexOf('db:insert:scheduled_posts');
    const queueAt = at('queue:');
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(companyAt);
    expect(companyAt).toBeGreaterThan(-1);
    expect(companyAt).toBeLessThan(ownerAt);
    expect(ownerAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(queueAt);
  });

  it('on a mismatch the log stops at the account-owner read', async () => {
    await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, 'A');
    expect(mockEvents).toContain('db:read:social_accounts');
    expect(mockEvents.indexOf('db:read:social_accounts')).toBeGreaterThan(mockEvents.indexOf('authz:company:ok'));
    expect(inserts()).toEqual([]);
    expect(enqueues()).toEqual([]);
  });

  it('an anonymous caller is refused before the account is ever read', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_B }, null);
    expect(r.status).toBe(401);
    expect(mockEvents).not.toContain('db:read:social_accounts');
    expectNothingHappened();
  });

  it('an unauthenticated caller cannot use its own company\'s account either', async () => {
    const r = await schedule({ companyId: CO_A, accountId: ACCOUNT_A }, null);
    expect(r.status).toBe(401);
    expectNothingHappened();
  });
});

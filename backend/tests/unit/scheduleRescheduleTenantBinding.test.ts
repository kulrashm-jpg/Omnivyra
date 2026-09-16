/**
 * 3AH-92 (S-3) — POST /api/schedule/reschedule resolves the post's owner
 * server-side and authorizes it BEFORE the scheduled_posts update and the
 * publish re-enqueue.
 *
 * THE DEFECT: the route loaded the post by id with no tenant scope, authorized
 * whatever `companyId` the caller sent, and bound the post to that company only
 * when a campaign_versions row existed. A post with campaign_id NULL, a campaign
 * with no version row, or a failed version read skipped the binding, so a member
 * of company A could retime company B's post and re-enqueue publishing on B's
 * social account by naming A in the body.
 *
 * The real guard chain runs (resolveUserContext → requireCampaignAccess →
 * rbacService → campaign roles); only the database, the identity provider and
 * the queue are fake. Authentication, the authorization verdict, every
 * scheduled_posts write and every enqueue land in ONE ordered event log.
 */
import {
  seed, invoke, failTable, rows, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];
const mockHooks: { afterAuthz?: () => void; failNeq?: boolean } = {};

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const from = (t: string) => {
    const b = h.fakeSupabase.from(t);
    const update = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:update:${t}`); return update(p); };
    const neq = b.neq;
    b.neq = (col: string, val: unknown) => {
      if (!mockHooks.failNeq) return neq(col, val);
      const failed = { then: (ok: any, err: any) => Promise.resolve({ data: null, error: { message: 'forced' } }).then(ok, err) };
      return { limit: () => failed, ...failed };
    };
    return b;
  };
  const supabase = { ...h.fakeSupabase, from: (t: string) => { mockEvents.push(`db:${t}`); return from(t); } };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => {
  const m = jest.requireActual('../helpers/routeAuthHarness').authModule();
  const inner = m.getSupabaseUserFromRequest;
  return { ...m, getSupabaseUserFromRequest: jest.fn(async (req: any) => { mockEvents.push('auth'); return inner(req); }) };
});
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/campaignAccessService', () => {
  const actual = jest.requireActual('../../services/campaignAccessService');
  return {
    ...actual,
    requireCampaignAccess: jest.fn(async (req: any, res: any, campaignId: string) => {
      const r = await actual.requireCampaignAccess(req, res, campaignId);
      mockEvents.push(r ? 'authz:ok' : 'authz:deny');
      if (r) mockHooks.afterAuthz?.();
      return r;
    }),
  };
});
jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async (id: string, userId: string, accountId: string, at: string) => {
    mockEvents.push(`queue:enqueue:${id}:${userId}:${accountId}:${at}`);
    return 'enqueued';
  }),
}));

import handler from '../../../pages/api/schedule/reschedule';

const POST_A = '0a000000-0000-4000-8000-00000000000a';
const POST_B = '0b000000-0000-4000-8000-00000000000b';
const POST_A_SOLO = '0a000000-0000-4000-8000-0000000005a0';
const POST_B_SOLO = '0b000000-0000-4000-8000-0000000005b0';
const POST_B_BY_A = '0b000000-0000-4000-8000-00000000ab00';
const POST_NOVER_A = '0c000000-0000-4000-8000-00000000000a';
const POST_NOVER_B = '0c000000-0000-4000-8000-00000000000b';
const POST_DANGLING = '0d000000-0000-4000-8000-00000000000d';
const POST_GHOST = '0e000000-0000-4000-8000-00000000000e';
const POST_CONF_LEGACY = '0f000000-0000-4000-8000-000000000001';
const POST_CONF_HISTORY = '0f000000-0000-4000-8000-000000000002';
const UNKNOWN_POST = '09999999-0000-4000-8000-000000000000';
const ORIGINAL_AT = '2027-03-10T14:30:00.000Z';

function post(id: string, campaignId: string | null, userId: string, account = `sa-${userId.slice(5, 6)}`, status = 'scheduled') {
  return { id, campaign_id: campaignId, user_id: userId, social_account_id: account, status, scheduled_for: ORIGINAL_AT };
}

beforeEach(() => {
  mockEvents.length = 0;
  mockHooks.afterAuthz = undefined;
  mockHooks.failNeq = false;
  seed({
    campaigns: [
      { id: 'camp-nover-a', company_id: CO_A },
      { id: 'camp-nover-b', company_id: CO_B },
      { id: 'camp-conf-legacy', company_id: CO_B },
      { id: 'camp-conf-history', company_id: null },
    ],
    campaign_versions: [
      { campaign_id: 'camp-ghost', company_id: CO_A, created_at: '2026-02-01' },
      { campaign_id: 'camp-conf-legacy', company_id: CO_A, created_at: '2026-02-01' },
      { campaign_id: 'camp-conf-history', company_id: CO_B, created_at: '2026-01-01' },
      { campaign_id: 'camp-conf-history', company_id: CO_A, created_at: '2026-03-01' },
    ],
    scheduled_posts: [
      post(POST_A, CAMPAIGN_A, USER_A), post(POST_B, CAMPAIGN_B, USER_B),
      post(POST_A_SOLO, null, USER_A), post(POST_B_SOLO, null, USER_B), post(POST_B_BY_A, CAMPAIGN_B, USER_A),
      post(POST_NOVER_A, 'camp-nover-a', USER_A), post(POST_NOVER_B, 'camp-nover-b', USER_B),
      post(POST_DANGLING, 'camp-does-not-exist', USER_B), post(POST_GHOST, 'camp-ghost', USER_A),
      post(POST_CONF_LEGACY, 'camp-conf-legacy', USER_A), post(POST_CONF_HISTORY, 'camp-conf-history', USER_A),
    ],
  });
});

const reschedule = (body: Record<string, unknown>, as: 'A' | 'B' | 'SUPER' | null, headers?: Record<string, string>) =>
  invoke(handler as any, { method: 'POST', body: { new_date: '2027-04-02', ...body }, as, headers });
const updates = () => mockEvents.filter((e) => e === 'db:update:scheduled_posts');
const enqueues = () => mockEvents.filter((e) => e.startsWith('queue:'));
const scheduledFor = (id: string) => rows('scheduled_posts').find((r) => r.id === id)?.scheduled_for;
const at = (prefix: string) => mockEvents.findIndex((e) => e.startsWith(prefix));

function expectUntouched(...ids: string[]) {
  expect(updates()).toEqual([]);
  expect(enqueues()).toEqual([]);
  for (const id of ids) expect(scheduledFor(id)).toBe(ORIGINAL_AT);
}

// ── 1. Anonymous ──────────────────────────────────────────────────────────────
describe('anonymous caller', () => {
  it.each([
    ['campaign post', { scheduled_post_id: POST_B }],
    ['campaign_id NULL post', { scheduled_post_id: POST_B_SOLO }],
    ['with a company named in the body', { scheduled_post_id: POST_B, companyId: CO_B }],
    ['unknown post', { scheduled_post_id: UNKNOWN_POST }],
  ])('%s → 401 before the post is even read', async (_n, body) => {
    const r = await reschedule(body, null);
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
  });
});

// ── 2 + 14. Legitimate same-tenant rescheduling ──────────────────────────────
describe('same-tenant rescheduling still works', () => {
  it('campaign post: authorize → update → enqueue on the post owner\'s account, in that order', async () => {
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_A }, 'A');
    expect(r.status).toBe(200);
    // new_date echoes the route's (pre-existing, timezone-dependent) formatting.
    expect(r.body).toMatchObject({ success: true, scheduled_post_id: POST_A, new_date: new Date(2027, 3, 2).toISOString().slice(0, 10) });
    const stored = scheduledFor(POST_A);
    const expected = new Date(2027, 3, 2);
    const old = new Date(ORIGINAL_AT);
    expected.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), 0);
    expect(stored).toBe(expected.toISOString());
    expect(enqueues()).toEqual([`queue:enqueue:${POST_A}:${USER_A}:sa-a:${stored}`]);
    expect(at('authz:ok')).toBeGreaterThan(-1);
    expect(at('authz:ok')).toBeLessThan(at('db:update:scheduled_posts'));
    expect(at('db:update:scheduled_posts')).toBeLessThan(at('queue:'));
  });
  it('campaign post without a companyId in the body (campaign calendar may send none)', async () => {
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: '' }, 'A');
    expect(r.status).toBe(200);
    expect(enqueues()).toHaveLength(1);
  });
  it('a teammate in the owning company may reschedule a colleague\'s campaign post', async () => {
    const r = await reschedule({ scheduled_post_id: POST_A }, 'SUPER');
    expect(r.status).toBe(200);
    expect(enqueues()).toEqual([`queue:enqueue:${POST_A}:${USER_A}:sa-a:${scheduledFor(POST_A)}`]);
  });
  it('campaign_id NULL post: its own user may reschedule it (update + enqueue)', async () => {
    const r = await reschedule({ scheduled_post_id: POST_A_SOLO, companyId: CO_A }, 'A');
    expect(r.status).toBe(200);
    expect(scheduledFor(POST_A_SOLO)).not.toBe(ORIGINAL_AT);
    expect(enqueues()).toEqual([`queue:enqueue:${POST_A_SOLO}:${USER_A}:sa-a:${scheduledFor(POST_A_SOLO)}`]);
    expect(at('auth')).toBeLessThan(at('db:update:scheduled_posts'));
  });
  it('B reschedules B\'s own posts', async () => {
    expect((await reschedule({ scheduled_post_id: POST_B, companyId: CO_B }, 'B')).status).toBe(200);
    expect((await reschedule({ scheduled_post_id: POST_B_SOLO }, 'B')).status).toBe(200);
    expect(enqueues()).toHaveLength(2);
  });
  it('a draft post is retimed but not enqueued; a post without an account is not enqueued', async () => {
    rows('scheduled_posts').find((p) => p.id === POST_A)!.status = 'draft';
    rows('scheduled_posts').find((p) => p.id === POST_A_SOLO)!.social_account_id = null;
    expect((await reschedule({ scheduled_post_id: POST_A }, 'A')).status).toBe(200);
    expect((await reschedule({ scheduled_post_id: POST_A_SOLO }, 'A')).status).toBe(200);
    expect(updates()).toHaveLength(2);
    expect(enqueues()).toEqual([]);
  });
});

// ── 3, 4, 6. Wrong company, company override, foreign campaign ───────────────
describe('cross-tenant attempts', () => {
  it.each([
    ['B on A\'s campaign post, no company named', 'B', { scheduled_post_id: POST_A }, [403]],
    ['B on A\'s campaign post, naming B', 'B', { scheduled_post_id: POST_A, companyId: CO_B }, [403]],
    ['A on B\'s campaign post, no company named', 'A', { scheduled_post_id: POST_B }, [403]],
    ['A on B\'s campaign post, naming its own company A', 'A', { scheduled_post_id: POST_B, companyId: CO_A }, [403]],
    ['A on B\'s campaign post, naming B', 'A', { scheduled_post_id: POST_B, companyId: CO_B }, [403]],
    ['A on a post A created inside B\'s campaign (campaign ownership governs)', 'A', { scheduled_post_id: POST_B_BY_A, companyId: CO_A }, [403]],
    ['A on B\'s campaign_id NULL post, naming its own company A (the S-3 exploit)', 'A', { scheduled_post_id: POST_B_SOLO, companyId: CO_A }, [404]],
    ['A on B\'s campaign_id NULL post, naming B', 'A', { scheduled_post_id: POST_B_SOLO, companyId: CO_B }, [404]],
    ['A on B\'s campaign_id NULL post, no company named', 'A', { scheduled_post_id: POST_B_SOLO }, [404]],
    ['B on A\'s campaign_id NULL post', 'B', { scheduled_post_id: POST_A_SOLO, companyId: CO_B }, [404]],
  ] as const)('%s → denied, nothing written or enqueued', async (_n, as, body, codes) => {
    const r = await reschedule(body, as);
    expect(codes).toContain(r.status);
    expectUntouched(POST_A, POST_B, POST_A_SOLO, POST_B_SOLO, POST_B_BY_A);
  });
  it('a member of the owner company cannot act under another company it names', async () => {
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_B }, 'A');
    expect(r.status).toBe(403);
    expectUntouched(POST_A);
  });
  it('a campaign_id NULL post answers exactly like an unknown id to non-owners (no existence oracle)', async () => {
    const victim = await reschedule({ scheduled_post_id: POST_B_SOLO }, 'A');
    const unknown = await reschedule({ scheduled_post_id: UNKNOWN_POST }, 'A');
    expect([victim.status, victim.body]).toEqual([unknown.status, unknown.body]);
  });
});

// ── 5. Foreign activity ──────────────────────────────────────────────────────
describe('foreign activity', () => {
  it('naming A\'s own campaign / activity alongside B\'s post changes nothing', async () => {
    const r = await reschedule({
      scheduled_post_id: POST_B, companyId: CO_A, campaign_id: CAMPAIGN_A, campaignId: CAMPAIGN_A,
      activityId: 'plan-a', execution_id: 'exec-a', daily_plan_id: 'plan-a',
    }, 'A');
    expect(r.status).toBe(403);
    expectUntouched(POST_B);
  });
});

// ── 7. Conflicting ownership records ─────────────────────────────────────────
describe('conflicting campaign / version ownership fails closed', () => {
  it('latest version names A but campaigns.company_id names B → denied for A and for B', async () => {
    const a = await reschedule({ scheduled_post_id: POST_CONF_LEGACY, companyId: CO_A }, 'A');
    expect(a.status).toBe(403);
    expect(a.body).toMatchObject({ code: 'CAMPAIGN_OWNERSHIP_CONFLICT' });
    const b = await reschedule({ scheduled_post_id: POST_CONF_LEGACY, companyId: CO_B }, 'B');
    expect(b.status).toBe(403);
    expectUntouched(POST_CONF_LEGACY);
  });
  it('version history names two companies → denied for the latest one and the older one', async () => {
    const a = await reschedule({ scheduled_post_id: POST_CONF_HISTORY }, 'A');
    expect(a.status).toBe(403);
    expect(a.body).toMatchObject({ code: 'CAMPAIGN_OWNERSHIP_CONFLICT' });
    const b = await reschedule({ scheduled_post_id: POST_CONF_HISTORY, companyId: CO_B }, 'B');
    expect(b.status).toBe(403);
    expectUntouched(POST_CONF_HISTORY);
  });
  it('the write repeats the authorized campaign predicate (a post re-parented after authz is untouched)', async () => {
    mockHooks.afterAuthz = () => { rows('scheduled_posts').find((p) => p.id === POST_A)!.campaign_id = CAMPAIGN_B; };
    await reschedule({ scheduled_post_id: POST_A }, 'A');
    expect(scheduledFor(POST_A)).toBe(ORIGINAL_AT);
  });
});

// ── 8, 9. Missing campaign / missing version ─────────────────────────────────
describe('missing ownership records fail closed', () => {
  it.each([
    ['campaign_id names no campaign and no version (dangling)', 'B', POST_DANGLING, CO_B],
    ['version row for A but no campaigns row', 'A', POST_GHOST, CO_A],
  ] as const)('%s → 404, nothing written or enqueued', async (_n, as, id, companyId) => {
    const r = await reschedule({ scheduled_post_id: id, companyId }, as);
    expect(r.status).toBe(404);
    expectUntouched(id);
  });

  /*
   * STEP 3AH-95 reconciliation — a campaign with a `campaigns` row but no
   * `campaign_versions` row now resolves to its owner (SEC91-A8, PR #246):
   * requireCampaignAccess falls back to campaigns.company_id ONLY when no
   * version row exists, so a legacy campaign stops 404-ing for the company that
   * owns it. The tenant boundary is unchanged, and these two cases pin it: the
   * owner is served, a foreign tenant is refused with nothing written.
   */
  it('campaigns row for A but no version row: A (the owner) is served — SEC91-A8 legacy owner fallback', async () => {
    const r = await reschedule({ scheduled_post_id: POST_NOVER_A, companyId: CO_A }, 'A');
    expect(r.status).toBe(200);
    expect(scheduledFor(POST_NOVER_A)).not.toBe(ORIGINAL_AT);
    // Only the owner's own post moved; every other seeded post is untouched.
    for (const id of rows('scheduled_posts').map((p) => p.id as string)) {
      if (id !== POST_NOVER_A) expect(scheduledFor(id)).toBe(ORIGINAL_AT);
    }
  });

  it('campaigns row for B, no version, A names its own company (the S-3 exploit) → 403, nothing written or enqueued', async () => {
    const r = await reschedule({ scheduled_post_id: POST_NOVER_B, companyId: CO_A }, 'A');
    expect(r.status).toBe(403);
    expectUntouched(POST_NOVER_B);
  });
  it('unknown post → 404', async () => {
    expect((await reschedule({ scheduled_post_id: UNKNOWN_POST }, 'A')).status).toBe(404);
    expectUntouched();
  });
});

// ── 10. Lookup failures ──────────────────────────────────────────────────────
describe('lookup failures fail closed', () => {
  it('scheduled_posts read fails → 503', async () => {
    failTable('scheduled_posts');
    const r = await reschedule({ scheduled_post_id: POST_A }, 'A');
    expect(r.status).toBe(503);
    expect(enqueues()).toEqual([]);
    expect(updates()).toEqual([]);
  });
  it('campaign_versions read fails, caller names its own company on B\'s post → denied (was: allowed)', async () => {
    failTable('campaign_versions');
    const r = await reschedule({ scheduled_post_id: POST_B, companyId: CO_A }, 'A');
    expect([403, 404, 503]).toContain(r.status);
    expectUntouched(POST_B);
  });
  it('campaign_versions read fails for the owner too → denied', async () => {
    failTable('campaign_versions');
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_A }, 'A');
    expect([404, 503]).toContain(r.status);
    expectUntouched(POST_A);
  });
  it('campaigns read fails → 503', async () => {
    failTable('campaigns');
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_A }, 'A');
    expect(r.status).toBe(503);
    expectUntouched(POST_A);
  });
  it('the other-company version read fails → 503', async () => {
    mockHooks.failNeq = true;
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_A }, 'A');
    expect(r.status).toBe(503);
    expectUntouched(POST_A);
  });
  it('membership read fails → denied', async () => {
    failTable('user_company_roles');
    const r = await reschedule({ scheduled_post_id: POST_A, companyId: CO_A }, 'A');
    expect(r.status).not.toBe(200);
    expectUntouched(POST_A);
  });
});

// ── 11. Malformed identifiers ────────────────────────────────────────────────
describe('malformed identifiers', () => {
  it.each([
    ['non-UUID post id', { scheduled_post_id: 'not-a-uuid' }],
    ['SQL-ish post id', { scheduled_post_id: `${POST_B}' or '1'='1` }],
    ['numeric post id', { scheduled_post_id: 42 }],
    ['array post id', { scheduled_post_id: [POST_B] }],
    ['object post id', { scheduled_post_id: { id: POST_B } }],
    ['empty post id', { scheduled_post_id: '' }],
    ['array companyId', { scheduled_post_id: POST_B, companyId: [CO_A] }],
    ['object companyId', { scheduled_post_id: POST_B, companyId: { id: CO_A } }],
    ['bad date', { scheduled_post_id: POST_B, new_date: 'tomorrow' }],
  ])('%s → 400, the post is never read', async (_n, body) => {
    const r = await reschedule(body as Record<string, unknown>, 'A');
    expect(r.status).toBe(400);
    expect(mockEvents.filter((e) => e.startsWith('db:scheduled_posts'))).toEqual([]);
    expectUntouched(POST_B);
  });
});

// ── 12. Forged request context ───────────────────────────────────────────────
describe('forged request context is ignored', () => {
  it('body user_id / userId / company_id naming the victim do not make A the owner', async () => {
    for (const id of [POST_B, POST_B_SOLO]) {
      const r = await reschedule({ scheduled_post_id: id, user_id: USER_B, userId: USER_B, company_id: CO_B, companyId: CO_A }, 'A');
      expect([403, 404]).toContain(r.status);
    }
    expectUntouched(POST_B, POST_B_SOLO);
  });
  it('identity / tenant headers do not authenticate or re-scope the caller', async () => {
    const forged = { 'x-user-id': USER_B, 'x-company-id': CO_B, 'x-tenant-id': CO_B };
    expect((await reschedule({ scheduled_post_id: POST_B_SOLO }, null, forged)).status).toBe(401);
    expect([403, 404]).toContain((await reschedule({ scheduled_post_id: POST_B_SOLO }, 'A', forged)).status);
    expect([403, 404]).toContain((await reschedule({ scheduled_post_id: POST_B }, 'A', forged)).status);
    expectUntouched(POST_B, POST_B_SOLO);
  });
  it('an invalid bearer token is anonymous', async () => {
    const r = await reschedule({ scheduled_post_id: POST_B_SOLO }, null, { authorization: 'Bearer forged-token' });
    expect(r.status).toBe(401);
    expect(mockEvents).toEqual(['auth']);
  });
});

// ── 13. Zero side effects on every rejection ─────────────────────────────────
describe('no rejection writes or enqueues', () => {
  it('every rejection above left every post exactly as seeded', async () => {
    const attempts: Array<[Record<string, unknown>, 'A' | 'B' | null]> = [
      [{ scheduled_post_id: POST_B }, null], [{ scheduled_post_id: POST_B, companyId: CO_A }, 'A'],
      [{ scheduled_post_id: POST_B_SOLO, companyId: CO_A }, 'A'], [{ scheduled_post_id: POST_NOVER_B, companyId: CO_A }, 'A'],
      [{ scheduled_post_id: POST_CONF_LEGACY }, 'A'], [{ scheduled_post_id: POST_CONF_HISTORY }, 'A'],
      [{ scheduled_post_id: POST_GHOST }, 'A'], [{ scheduled_post_id: POST_DANGLING }, 'B'], [{ scheduled_post_id: 'x' }, 'A'],
    ];
    for (const [body, as] of attempts) expect((await reschedule(body, as)).status).not.toBe(200);
    expectUntouched(...rows('scheduled_posts').map((p) => p.id as string));
  });
});

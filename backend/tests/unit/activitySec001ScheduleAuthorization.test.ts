/**
 * ACTIVITY-SEC-001 — POST /api/activity-workspace/schedule writes
 * `scheduled_posts`, and every identifier that selected the target row came
 * from the request body.
 *
 * Two distinct defects, both reachable by any authenticated user:
 *
 *   V1 — INJECTION. `campaignId` was unvalidated, so a row could be inserted
 *        into ANOTHER company's campaign. The row carries
 *        `status: 'scheduled'`, which is a RELEASABLE post status
 *        (lib/campaign/publishAuthorization), so it is a live candidate for the
 *        victim's release/publish pipeline — not merely a display artefact.
 *
 *   V2 — TAKEOVER. Both dedup lookups matched on caller-supplied values with
 *        no `user_id` scope:
 *          #1  campaign_id + platform + title
 *          #2  repurpose_parent_execution_id + platform
 *        A match then UPDATEs that row with the caller's content, schedule,
 *        user_id and social_account_id — i.e. it overwrites and takes
 *        ownership of another user's scheduled post.
 *
 * What was NOT vulnerable, and is asserted here so a future change cannot
 * quietly break it: the social-account lookups are already scoped to the
 * authenticated user, so a caller-supplied `companyId` can only narrow the
 * choice among the caller's OWN accounts. A post can never be bound to another
 * company's social account.
 *
 * `scheduled_posts` is USER-anchored (`user_id NOT NULL`, no `company_id`), so
 * row ownership IS `user_id` — the model MEDIA-SEC-001 established.
 */

type Row = Record<string, unknown>;

const ATTACKER = 'user-attacker';
const VICTIM = 'user-victim';
const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAMPAIGN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // Company A
const CAMPAIGN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // Company B

const CAMPAIGN_OWNER: Record<string, string> = {
  [CAMPAIGN_A]: COMPANY_A,
  [CAMPAIGN_B]: COMPANY_B,
};
const MEMBERSHIP: Record<string, string[]> = {
  [ATTACKER]: [COMPANY_A],
  [VICTIM]: [COMPANY_B],
};

let authUser: string | null = ATTACKER;
/** The victim's existing scheduled post — the takeover target. */
const VICTIM_POST = {
  id: 'post-victim-1',
  user_id: VICTIM,
  campaign_id: CAMPAIGN_B,
  platform: 'linkedin',
  title: 'Victim launch post',
  repurpose_parent_execution_id: 'exec-victim-1',
};
/** Everything the route asked the database to write. */
const writes: Array<{ op: 'insert' | 'update'; table: string; id?: unknown; row: Row }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' }),
}));

jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () => (authUser
    ? { ok: true, principal: { userId: authUser, legacyCookieSuperAdmin: false } }
    : { ok: false, reason: 'NO_PRINCIPAL' })),
}));

/** One query builder over campaigns / user_company_roles / companies /
 *  scheduled_posts / social_accounts. The REAL TenantGuard runs on top. */
function makeQuery(table: string) {
  const f: Record<string, unknown> = {};
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Row = {};
  const b: any = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () => b;
  b.in = (col: string, vals: unknown[]) => { f[col] = vals; return b; };
  b.eq = (col: string, val: unknown) => { f[col] = val; return b; };
  b.insert = (p: Row) => { op = 'insert'; payload = p; return b; };
  b.update = (p: Row) => { op = 'update'; payload = p; return b; };

  const resolve = () => {
    if (op === 'insert') {
      writes.push({ op, table, row: payload });
      return { data: { id: 'new-post-1' }, error: null };
    }
    if (op === 'update') {
      writes.push({ op, table, id: f.id, row: payload });
      return { data: null, error: null };
    }
    if (table === 'campaigns') {
      const company = CAMPAIGN_OWNER[String(f.id)];
      return { data: company ? { company_id: company } : null, error: null };
    }
    if (table === 'user_company_roles') {
      const member = (MEMBERSHIP[String(f.user_id)] ?? []).includes(String(f.company_id));
      return { data: member ? { role: 'COMPANY_ADMIN', status: 'active' } : null, error: null };
    }
    if (table === 'companies') {
      const known = Object.values(CAMPAIGN_OWNER).includes(String(f.id));
      return { data: known ? { id: f.id, status: 'active' } : null, error: null };
    }
    if (table === 'campaign_versions') {
      return { data: { company_id: CAMPAIGN_OWNER[String(f.campaign_id)] ?? null }, error: null };
    }
    if (table === 'social_accounts') {
      // Always scoped by user_id in the route; model that faithfully.
      return { data: { id: `account-of-${f.user_id}` }, error: null };
    }
    if (table === 'scheduled_posts') {
      // The dedup lookups. A row matches only if EVERY supplied filter matches.
      const p: Row = VICTIM_POST;
      for (const [k, v] of Object.entries(f)) {
        if (p[k] !== v) return { data: null, error: null };
      }
      return { data: { id: p.id }, error: null };
    }
    return { data: null, error: null };
  };
  b.single = () => Promise.resolve(resolve());
  b.maybeSingle = () => Promise.resolve(resolve());
  b.then = (r: any) => Promise.resolve(resolve()).then(r);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeQuery(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeQuery(t) }));

// Side effects that are not under test.
jest.mock('../../scheduler/schedulerService', () => ({ enqueueScheduledPostAt: jest.fn(async () => {}) }));
jest.mock('../../services/creator/media', () => ({ runSharedMediaPreEnqueue: jest.fn(async () => ({ ran: false })) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));

/** The credit grant is a caller-influenced financial side effect — recorded. */
const creditGrants: Array<{ orgId: string; userId: string }> = [];
jest.mock('../../services/earnCreditsService', () => ({
  grantEarnCredit: jest.fn(async (p: { orgId: string; userId: string }) => {
    creditGrants.push({ orgId: p.orgId, userId: p.userId });
    return { granted: true, credits: 200 };
  }),
}));

import handler from '../../../pages/api/activity-workspace/schedule';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

async function schedule(as: string | null, body: Row) {
  authUser = as;
  const res = mockRes();
  await handler({
    method: 'POST', url: '/api/activity-workspace/schedule', headers: {}, query: {},
    body: { platform: 'linkedin', content: 'hello world', scheduledDate: tomorrow, ...body },
  } as never, res);
  return res;
}

const postWrites = () => writes.filter((w) => w.table === 'scheduled_posts');

beforeEach(() => {
  authUser = ATTACKER;
  writes.length = 0;
  creditGrants.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — unauthenticated ──────────────────────────────────────────────── */

describe('A — unauthenticated', () => {
  it('never reaches a write sink', async () => {
    const res = await schedule(null, { campaignId: CAMPAIGN_B, title: 'x' });
    expect(res.statusCode).toBe(401);
    expect(writes).toEqual([]);
    expect(creditGrants).toEqual([]);
  });
});

/* ── B — the legitimate workflow still works ──────────────────────────── */

describe('B — an authenticated member scheduling into their OWN campaign', () => {
  it('succeeds and writes a post owned by the caller', async () => {
    const res = await schedule(ATTACKER, { campaignId: CAMPAIGN_A, title: 'My own post' });

    expect(res.statusCode).toBe(200);
    const inserts = postWrites().filter((w) => w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.user_id).toBe(ATTACKER);
    expect(inserts[0].row.campaign_id).toBe(CAMPAIGN_A);
    expect(inserts[0].row.status).toBe('scheduled');
  });

  it('the credit grant targets the AUTHORIZED org, not a body field', async () => {
    await schedule(ATTACKER, { campaignId: CAMPAIGN_A, title: 'My own post', companyId: COMPANY_B });
    // COMPANY_B was supplied in the body and must be ignored entirely.
    expect(creditGrants.every((g) => g.orgId === COMPANY_A)).toBe(true);
    expect(creditGrants.some((g) => g.orgId === COMPANY_B)).toBe(false);
  });
});

/* ── V1 / D — cross-company campaign injection ────────────────────────── */

describe('D — a caller cannot schedule into another company’s campaign', () => {
  it('CRITICAL: cross-company campaignId is refused and nothing is written', async () => {
    const res = await schedule(ATTACKER, { campaignId: CAMPAIGN_B, title: 'planted post' });

    expect(res.statusCode).toBe(403);
    expect(postWrites()).toEqual([]);
    expect(creditGrants).toEqual([]);
  });

  it('a body-supplied companyId cannot buy access to that campaign', async () => {
    const res = await schedule(ATTACKER, {
      campaignId: CAMPAIGN_B, title: 'planted post', companyId: COMPANY_A,
    });
    expect(res.statusCode).toBe(403);
    expect(postWrites()).toEqual([]);
  });
});

/* ── V2 / C — cross-user takeover of an existing post ─────────────────── */

describe('C — a caller cannot take over another user’s scheduled post', () => {
  it('CRITICAL: dedup by campaign+platform+title cannot match another user’s row', async () => {
    // The victim's own campaign is refused outright, so the takeover cannot
    // even be attempted through the campaign the post belongs to.
    const res = await schedule(ATTACKER, {
      campaignId: CAMPAIGN_B, platform: 'linkedin', title: VICTIM_POST.title,
    });
    expect(res.statusCode).toBe(403);
    expect(postWrites().filter((w) => w.op === 'update')).toEqual([]);
  });

  it('CRITICAL: dedup by executionId cannot match another user’s row', async () => {
    // Attacker uses their OWN campaign (authorized) but names the victim's
    // execution id. The lookup is now owner-scoped, so it must not match —
    // the request inserts a NEW post instead of overwriting the victim's.
    const res = await schedule(ATTACKER, {
      campaignId: CAMPAIGN_A, platform: 'linkedin', executionId: VICTIM_POST.repurpose_parent_execution_id,
    });

    expect(res.statusCode).toBe(200);
    const updates = postWrites().filter((w) => w.op === 'update');
    expect(updates.every((u) => u.id !== VICTIM_POST.id)).toBe(true);
    const inserts = postWrites().filter((w) => w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.user_id).toBe(ATTACKER);
  });

  it('every scheduled_posts lookup is scoped to the authenticated owner', async () => {
    await schedule(ATTACKER, { campaignId: CAMPAIGN_A, title: 'x', executionId: 'exec-1' });
    // No write may ever land on a row the caller does not own.
    for (const w of postWrites()) {
      if (w.op === 'update') expect(w.id).not.toBe(VICTIM_POST.id);
      expect(w.row.user_id).toBe(ATTACKER);
    }
  });
});

/* ── E — spoofed identity fields ──────────────────────────────────────── */

describe('E — client input cannot override the authenticated principal', () => {
  it('ownership is the session user regardless of body fields', async () => {
    await schedule(ATTACKER, {
      campaignId: CAMPAIGN_A, title: 'x',
      user_id: VICTIM, userId: VICTIM, companyId: COMPANY_B,
    });
    const inserts = postWrites().filter((w) => w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.user_id).toBe(ATTACKER);
  });

  it('the social account is chosen from the CALLER’s accounts only', async () => {
    // Not a regression this fix introduced — asserted so it cannot become one.
    await schedule(ATTACKER, { campaignId: CAMPAIGN_A, title: 'x', companyId: COMPANY_B });
    const inserts = postWrites().filter((w) => w.op === 'insert');
    expect(inserts[0].row.social_account_id).toBe(`account-of-${ATTACKER}`);
  });
});

/* ── G — unknown campaign ─────────────────────────────────────────────── */

describe('G — an unknown campaign', () => {
  it('is 404 and writes nothing', async () => {
    const res = await schedule(ATTACKER, {
      campaignId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', title: 'x',
    });
    expect(res.statusCode).toBe(404);
    expect(res.body?.code).toBe('CAMPAIGN_NOT_FOUND');
    expect(postWrites()).toEqual([]);
  });

  it('a missing campaignId is still a 400, before any authorization work', async () => {
    const res = await schedule(ATTACKER, { title: 'x' });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });
});

/**
 * MEDIA-SEC-002 — a caller cannot attach media to a campaign it may not access.
 *
 * Ownership has been safe since #67 (`user_id` is always the authenticated
 * principal — MEDIA-SEC-001). The ASSOCIATION was not: `campaign_id` came
 * straight off the upload form and was persisted verbatim, and
 * `viralitySnapshotBuilder` reads campaign media by
 *
 *     .from('media_files').select('*').eq('campaign_id', campaignId)
 *
 * with no user or company scoping. So an authenticated attacker in Company A
 * could name Company B's campaign, and the row entered B's virality snapshot
 * and AI context — consumed by B running their OWN assessment (the assess
 * route authorizes the caller, so B is the one who reads it).
 *
 * Verified read-only against production before fixing: `media_files` has the
 * `campaign_id` column (so the write is possible) and 0 rows currently carry
 * one (so there is no existing contamination).
 *
 * These tests drive the REAL route and the REAL `requireCampaignTenantAccess`;
 * only the database, the auth reader and the storage service are scripted.
 */

type Row = Record<string, unknown>;

const ATTACKER = 'user-attacker';
const VICTIM = 'user-victim';
const CAMPAIGN_A = 'campaign-of-company-a';
const CAMPAIGN_B = 'campaign-of-company-b';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

/** campaignId → owning company, exactly as the campaigns table would answer. */
const CAMPAIGN_OWNER: Record<string, string> = {
  [CAMPAIGN_A]: COMPANY_A,
  [CAMPAIGN_B]: COMPANY_B,
};
/** userId → the companies they are actually a member of. */
const MEMBERSHIP: Record<string, string[]> = {
  [ATTACKER]: [COMPANY_A],
  [VICTIM]: [COMPANY_B],
};

let authResult: { user: { id: string } | null; error: string | null } = {
  user: { id: ATTACKER }, error: null,
};
let formFields: Record<string, string[]> = {};
let unlinked: string[] = [];
/** Every media row the service was asked to persist. */
const uploads: Array<{ userId: string; campaignId?: string }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => authResult),
}));

/** One query builder serving campaigns, user_company_roles and companies. */
function makeQuery(table: string) {
  const filters: Record<string, string> = {};
  const builder: any = {};
  builder.select = () => builder;
  builder.limit = () => builder;
  builder.eq = (col: string, val: unknown) => { filters[col] = String(val); return builder; };
  builder.maybeSingle = () => {
    if (table === 'campaigns') {
      const company = CAMPAIGN_OWNER[filters.id];
      return Promise.resolve({ data: company ? { company_id: company } : null, error: null });
    }
    if (table === 'user_company_roles') {
      const member = (MEMBERSHIP[filters.user_id] ?? []).includes(filters.company_id);
      return Promise.resolve({ data: member ? { role: 'COMPANY_ADMIN', status: 'active' } : null, error: null });
    }
    if (table === 'companies') {
      const known = Object.values(CAMPAIGN_OWNER).includes(filters.id);
      return Promise.resolve({ data: known ? { id: filters.id, status: 'active' } : null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return builder;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

// Nothing in TenantGuard is stubbed. The REAL requireCampaignTenantAccess and
// the REAL assertTenantAccess run; only the data layer beneath them is
// scripted, so the guard's actual query shape and HTTP contract are exercised.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => makeQuery(table),
}));

// TenantGuard resolves its own principal via IdentityResolver — the same
// authenticated user the route reads, scripted here to match.
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () => {
    const id = (global as any).__authUserId;
    return id
      ? { ok: true, principal: { userId: id, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_PRINCIPAL' };
  }),
}));

jest.mock('../../services/mediaService', () => ({
  uploadMedia: jest.fn(async (opts: { userId: string; campaignId?: string }) => {
    uploads.push({ userId: opts.userId, campaignId: opts.campaignId });
    return { id: 'media-1', user_id: opts.userId, campaign_id: opts.campaignId ?? null };
  }),
  validateMedia: jest.fn(async () => ({ valid: true, errors: [], warnings: [] })),
}));

jest.mock('formidable', () => ({
  __esModule: true,
  default: () => ({
    parse: async () => [
      (global as any).__fields,
      { file: [{ filepath: '/tmp/upload-tmp', originalFilename: 'a.png', newFilename: 'a.png', mimetype: 'image/png' }] },
    ],
  }),
}));

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    readFileSync: jest.fn(() => Buffer.from('fake-png')),
    unlinkSync: jest.fn((p: string) => { (global as any).__unlinked.push(p); }),
  },
  readFileSync: jest.fn(() => Buffer.from('fake-png')),
  unlinkSync: jest.fn((p: string) => { (global as any).__unlinked.push(p); }),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/media/upload';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const req = () => ({ method: 'POST', url: '/api/media/upload', headers: {}, query: {} }) as any;

/** Upload as `who`, naming `campaign` (omit for none). */
async function upload(who: string | null, campaign?: string) {
  authResult = who ? { user: { id: who }, error: null } : { user: null, error: 'MISSING_AUTH' };
  (global as any).__authUserId = who;
  formFields = campaign ? { campaign_id: [campaign] } : {};
  (global as any).__fields = formFields;
  const res = mockRes();
  await handler(req(), res);
  return res;
}

beforeEach(() => {
  uploads.length = 0;
  unlinked = [];
  (global as any).__unlinked = unlinked;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── A — legitimate attachment ────────────────────────────────────────── */

describe('A — a member attaches media to their OWN company’s campaign', () => {
  it('succeeds and records the association', async () => {
    const res = await upload(VICTIM, CAMPAIGN_B);

    expect(res.statusCode).toBe(200);
    expect(uploads).toEqual([{ userId: VICTIM, campaignId: CAMPAIGN_B }]);
  });

  it('an upload with NO campaign is unaffected — the check only guards the association', async () => {
    const res = await upload(VICTIM);

    expect(res.statusCode).toBe(200);
    expect(uploads).toEqual([{ userId: VICTIM, campaignId: undefined }]);
  });
});

/* ── B — the exploit ──────────────────────────────────────────────────── */

describe('B — CROSS-COMPANY attachment is refused', () => {
  it('CRITICAL: Company A cannot attach media to Company B’s campaign', async () => {
    const res = await upload(ATTACKER, CAMPAIGN_B);

    expect(res.statusCode).toBe(403);
    // The decisive assertion: nothing was persisted, so nothing can reach
    // Company B's virality snapshot.
    expect(uploads).toEqual([]);
  });

  it('the refused request leaves no storage object and no row', async () => {
    await upload(ATTACKER, CAMPAIGN_B);

    expect(uploads).toHaveLength(0);
    // The parsed temp file is cleaned up too — a refusal leaves nothing behind.
    expect(unlinked).toContain('/tmp/upload-tmp');
  });

  it('the attacker CAN still use their own campaign — legitimate use is untouched', async () => {
    const res = await upload(ATTACKER, CAMPAIGN_A);

    expect(res.statusCode).toBe(200);
    expect(uploads).toEqual([{ userId: ATTACKER, campaignId: CAMPAIGN_A }]);
  });
});

/* ── C — nonexistent campaign ─────────────────────────────────────────── */

describe('C — an unknown campaign', () => {
  it('is 404, and creates no orphaned association', async () => {
    const res = await upload(VICTIM, 'campaign-does-not-exist');

    expect(res.statusCode).toBe(404);
    expect(res.body?.code).toBe('CAMPAIGN_NOT_FOUND');
    expect(uploads).toEqual([]);
  });
});

/* ── D — unauthenticated ──────────────────────────────────────────────── */

describe('D — no credentials', () => {
  it('is 401 and writes nothing, campaign id or not', async () => {
    const res = await upload(null, CAMPAIGN_B);

    expect(res.statusCode).toBe(401);
    expect(uploads).toEqual([]);
  });

  it('a campaign id cannot substitute for a session', async () => {
    await upload(null, CAMPAIGN_A);
    expect(uploads).toEqual([]);
  });
});

/* ── E/F — what the analytics read can therefore contain ──────────────── */

describe('E/F — the analytics consequence', () => {
  it('after the fix, Company B’s campaign has NO attacker media to read', async () => {
    // The snapshot builder reads `.eq('campaign_id', CAMPAIGN_B)`. Whatever it
    // returns is exactly the set of rows this route allowed to be written.
    await upload(ATTACKER, CAMPAIGN_B); // refused
    await upload(VICTIM, CAMPAIGN_B);   // legitimate

    const rowsOnCampaignB = uploads.filter((u) => u.campaignId === CAMPAIGN_B);
    expect(rowsOnCampaignB).toEqual([{ userId: VICTIM, campaignId: CAMPAIGN_B }]);
    expect(rowsOnCampaignB.some((r) => r.userId === ATTACKER)).toBe(false);
  });

  it('legitimate campaign media from the owning company is still included', async () => {
    await upload(VICTIM, CAMPAIGN_B);
    expect(uploads.filter((u) => u.campaignId === CAMPAIGN_B)).toHaveLength(1);
  });
});

/* ── MEDIA-SEC-001 must not regress ───────────────────────────────────── */

describe('MEDIA-SEC-001 ownership is untouched', () => {
  it('ownership is still the authenticated user, never a client field', async () => {
    authResult = { user: { id: VICTIM }, error: null };
    (global as any).__authUserId = VICTIM;
    (global as any).__fields = { campaign_id: [CAMPAIGN_B], user_id: [ATTACKER] };
    const res = mockRes();
    await handler(req(), res);

    expect(res.statusCode).toBe(200);
    // The supplied user_id is ignored; the campaign check runs against the
    // AUTHENTICATED user, not the claimed one.
    expect(uploads).toEqual([{ userId: VICTIM, campaignId: CAMPAIGN_B }]);
  });

  it('a spoofed user_id cannot buy access to another company’s campaign either', async () => {
    authResult = { user: { id: ATTACKER }, error: null };
    (global as any).__authUserId = ATTACKER;
    // Claim to be the victim; the guard must still see the attacker.
    (global as any).__fields = { campaign_id: [CAMPAIGN_B], user_id: [VICTIM] };
    const res = mockRes();
    await handler(req(), res);

    expect(res.statusCode).toBe(403);
    expect(uploads).toEqual([]);
  });
});

/**
 * BLOCKING fast-track (e9, 2026-11-13): the legacy ad-hoc scheduler (createLegacyScheduledPost: a standalone
 * post with no campaign, from pages/api/schedule/posts.ts and pages/api/social/post.ts) used to attach the
 * user's NEWEST active account for the platform in ANY company. A standalone post has no company to scope by,
 * so it now gets an account only when the user's matching accounts are all in ONE company; accounts in two
 * companies are refused as ambiguous (the caller passes an explicit accountId instead).
 *
 * FAITHFUL fake for social_accounts (every eq / in filter must match; .order('created_at', desc) honoured).
 * The insert after the account is stubbed, so the HEAD control cannot pass by failing for another reason:
 * the assertion is on the specific error code and reason.
 */
type Row = Record<string, unknown>;
const CO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let ACCOUNTS: Row[] = [];
const inserts: Row[] = [];

function makeQuery(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let orderDesc = false;
  let insertPayload: Row | null = null;
  const b: any = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { filters.push(['eq', c, v]); return b; };
  b.in = (c: string, v: unknown[]) => { filters.push(['in', c, v]); return b; };
  b.order = (_c: string, o?: { ascending?: boolean }) => { orderDesc = o?.ascending === false; return b; };
  b.limit = () => b;
  b.insert = (p: Row) => { insertPayload = p; inserts.push(p); return b; };
  b.upsert = (p: Row) => { insertPayload = p; inserts.push(p); return b; };
  const rows = (): Row[] => {
    if (table !== 'social_accounts') return [];
    let out = ACCOUNTS.filter((r) => filters.every(([op, c, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : r[c] === v)));
    if (orderDesc) out = [...out].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return out;
  };
  b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  b.single = async () => ({ data: insertPayload ? { id: 'sp-new', ...insertPayload } : rows()[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: insertPayload ? [{ id: 'sp-new', ...insertPayload }] : rows(), error: null }).then(ok, ko);
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeQuery(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeQuery(t) }));
jest.mock('../../services/platformIntelligenceService', () => ({
  getPlatformRules: jest.fn(async () => ({ platform: { canonical_key: 'linkedin' }, content_rules: [{ content_type: 'post' }] })),
  listPlatformCatalog: jest.fn(async () => []),
}));

import { createLegacyScheduledPost } from '../../services/structuredPlanSchedulerExecDaily';

const input = (userId: string) => ({
  userId, platform: 'linkedin', contentType: 'post', content: 'hello',
  scheduledFor: new Date(Date.now() + 86400000).toISOString(),
}) as any;

beforeEach(() => {
  inserts.length = 0;
  ACCOUNTS = [
    // DUAL: LinkedIn accounts in BOTH companies (B's is the newest).
    { id: 'dual-li-A', user_id: 'u-dual', company_id: CO_A, platform: 'linkedin', is_active: true, created_at: '2026-01-01' },
    { id: 'dual-li-B', user_id: 'u-dual', company_id: CO_B, platform: 'linkedin', is_active: true, created_at: '2026-02-01' },
    // SOLO: one LinkedIn account in company A.
    { id: 'solo-li-A', user_id: 'u-solo', company_id: CO_A, platform: 'linkedin', is_active: true, created_at: '2026-01-01' },
  ];
});

describe('legacy ad-hoc scheduler: a standalone post never picks an account across companies', () => {
  it('CRITICAL: a user with accounts in TWO companies is refused as ambiguous, and nothing is scheduled', async () => {
    const err = await createLegacyScheduledPost(input('u-dual')).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SCHEDULING_NO_ACCOUNT_FOR_PLATFORM', details: expect.objectContaining({ reason: 'ACCOUNT_AMBIGUOUS' }) });
    expect(inserts).toEqual([]);
  });

  it("CONTROL: a user whose accounts are all in ONE company gets that account", async () => {
    await createLegacyScheduledPost(input('u-solo')).catch(() => undefined);
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts[0]).toMatchObject({ social_account_id: 'solo-li-A' });
  });
});

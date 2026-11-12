/**
 * BLOCKING fast-track (e9, 2026-11-13): a post's social account comes from its CAMPAIGN's company, never
 * from another company the user also belongs to. FAITHFUL fake: a social_accounts row matches only when
 * EVERY supplied filter matches (eq, and membership for .in); results honour .order('created_at', desc).
 * Hostile: an unconfigured table throws.
 */
type Row = Record<string, unknown>;
const CO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DUAL = 'user-dual';
const SOLO = 'user-solo';

let CAMPAIGNS: Row[] = [];
let ACCOUNTS: Row[] = [];
let failTable: string | null = null;

function makeQuery(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let orderDesc = false;
  const b: any = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => { filters.push(['eq', c, v]); return b; };
  b.in = (c: string, v: unknown[]) => { filters.push(['in', c, v]); return b; };
  b.not = (c: string, op: string, val: unknown) => {
    if (op !== 'is' || val !== null) throw new Error(`hostile fake: unsupported .not(${c}, ${op})`);
    filters.push(['notnull', c, null]); return b;
  };
  b.order = (_c: string, o?: { ascending?: boolean }) => { orderDesc = o?.ascending === false; return b; };
  b.limit = () => b;
  const rows = () => {
    if (failTable === table) return { data: null, error: { message: 'boom' } };
    const src = table === 'campaigns' ? CAMPAIGNS : table === 'social_accounts' ? ACCOUNTS : null;
    if (!src) throw new Error(`hostile fake: unconfigured table ${table}`);
    let out = src.filter((r) => filters.every(([op, c, v]) =>
      (op === 'in' ? (v as unknown[]).includes(r[c]) : op === 'notnull' ? r[c] !== null && r[c] !== undefined : r[c] === v)));
    if (orderDesc) out = [...out].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return { data: out, error: null };
  };
  b.maybeSingle = async () => { const r = rows(); return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }; };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    try { return Promise.resolve(rows()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeQuery(t) } }));

import { resolvePostSocialAccount } from '../../services/postSocialAccountResolver';

beforeEach(() => {
  failTable = null;
  CAMPAIGNS = [
    { id: 'camp-A', company_id: CO_A },
    { id: 'camp-B', company_id: CO_B },
    { id: 'camp-nocompany', company_id: null },
  ];
  ACCOUNTS = [
    // DUAL has LinkedIn ONLY in company B (and twitter in A).
    { id: 'dual-li-B', user_id: DUAL, company_id: CO_B, platform: 'linkedin', is_active: true, created_at: '2026-01-02' },
    { id: 'dual-tw-A', user_id: DUAL, company_id: CO_A, platform: 'twitter', is_active: true, created_at: '2026-01-01' },
    { id: 'dual-tw-B', user_id: DUAL, company_id: CO_B, platform: 'twitter', is_active: true, created_at: '2026-01-03' },
    // SOLO has two LinkedIn accounts, both in company A (the newer wins).
    { id: 'solo-li-old', user_id: SOLO, company_id: CO_A, platform: 'linkedin', is_active: true, created_at: '2026-01-01' },
    { id: 'solo-li-new', user_id: SOLO, company_id: CO_A, platform: 'linkedin', is_active: true, created_at: '2026-02-01' },
  ];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const resolve = (userId: string, platform: string, campaignId: string | null) =>
  resolvePostSocialAccount({ userId, platforms: [platform], campaignId });

describe('campaign posts: the account comes from the campaign company ONLY', () => {
  it("CRITICAL: a two-company user's company-A post never gets their company-B account", async () => {
    await expect(resolve(DUAL, 'linkedin', 'camp-A')).resolves.toMatchObject({ ok: false, code: 'NO_CONNECTED_ACCOUNT', retryable: false });
  });
  it('CONTROL: the same user\'s company-B post gets the company-B account', async () => {
    await expect(resolve(DUAL, 'linkedin', 'camp-B')).resolves.toEqual({ ok: true, socialAccountId: 'dual-li-B', companyId: CO_B, code: null, message: null, retryable: false });
  });
  it('picks the account IN the campaign company even when another company has a newer one', async () => {
    await expect(resolve(DUAL, 'twitter', 'camp-A')).resolves.toEqual({ ok: true, socialAccountId: 'dual-tw-A', companyId: CO_A, code: null, message: null, retryable: false });
  });
  it('a campaign with NO company fails visibly and is logged CRITICAL (never a fallback)', async () => {
    await expect(resolve(DUAL, 'linkedin', 'camp-nocompany')).resolves.toMatchObject({ ok: false, code: 'CAMPAIGN_COMPANY_MISSING', retryable: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'), expect.objectContaining({ campaignId: 'camp-nocompany' }));
  });
  it('a missing campaign is CAMPAIGN_NOT_FOUND', async () => {
    await expect(resolve(DUAL, 'linkedin', 'camp-gone')).resolves.toMatchObject({ ok: false, code: 'CAMPAIGN_NOT_FOUND' });
  });
  it('an UNREADABLE campaign is retryable, never "no account"', async () => {
    failTable = 'campaigns';
    await expect(resolve(DUAL, 'linkedin', 'camp-B')).resolves.toMatchObject({ ok: false, code: 'CAMPAIGN_UNREADABLE', retryable: true });
  });
  it('an UNREADABLE account lookup is retryable, never "no account"', async () => {
    failTable = 'social_accounts';
    await expect(resolve(DUAL, 'linkedin', 'camp-B')).resolves.toMatchObject({ ok: false, code: 'ACCOUNT_LOOKUP_FAILED', retryable: true });
  });
});

describe('standalone posts: only when the user\'s matching accounts are all in ONE company', () => {
  it('CONTROL: all matching accounts in one company: the NEWEST is used', async () => {
    await expect(resolve(SOLO, 'linkedin', null)).resolves.toEqual({ ok: true, socialAccountId: 'solo-li-new', companyId: CO_A, code: null, message: null, retryable: false });
  });
  it('matching accounts in TWO companies are ambiguous (the user must choose), never "the first one"', async () => {
    await expect(resolve(DUAL, 'twitter', null)).resolves.toMatchObject({ ok: false, code: 'ACCOUNT_AMBIGUOUS', retryable: false });
  });
  it('no matching account at all is NO_CONNECTED_ACCOUNT', async () => {
    await expect(resolve(SOLO, 'tiktok', null)).resolves.toMatchObject({ ok: false, code: 'NO_CONNECTED_ACCOUNT' });
  });
});

/* ── 05 finding: a company-LESS account has unknown tenancy and is never chosen for a standalone post ── */
describe('standalone posts: company-less accounts are never chosen', () => {
  const NULLONLY = 'u-nullonly';
  const MIXED = 'u-mixed';
  beforeEach(() => {
    ACCOUNTS.push(
      { id: 'null-li', user_id: NULLONLY, company_id: null, platform: 'linkedin', is_active: true, created_at: '2026-03-01' },
      { id: 'mixed-li-null', user_id: MIXED, company_id: null, platform: 'linkedin', is_active: true, created_at: '2026-03-01' },
      { id: 'mixed-li-A', user_id: MIXED, company_id: CO_A, platform: 'linkedin', is_active: true, created_at: '2026-01-01' },
    );
  });
  it('CRITICAL: a user whose only matching account has NO company gets NO_CONNECTED_ACCOUNT, not that account', async () => {
    await expect(resolve(NULLONLY, 'linkedin', null)).resolves.toMatchObject({ ok: false, code: 'NO_CONNECTED_ACCOUNT', socialAccountId: null });
  });
  it('a company-less account beside a company-A account: the company-A one is used (even though the company-less one is newer)', async () => {
    await expect(resolve(MIXED, 'linkedin', null)).resolves.toMatchObject({ ok: true, socialAccountId: 'mixed-li-A', companyId: CO_A });
  });
});

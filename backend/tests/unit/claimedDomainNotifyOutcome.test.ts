/**
 * 05 review (2026-11-12): notifyAdminAndProspectOfClaimedDomain is best-effort and never throws, so it
 * must REPORT what happened to the admin notice - callers tell the prospect "we've asked your admin"
 * only when an admin was notified. A failed lookup is 'failed', never 'no_admin'. The idempotency key
 * is inert in the email function, so the admin notice is deduped by signup_referrals.admin_user_id,
 * written only after a successful send. Owner ruling: ALL active COMPANY_ADMINs are notified.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockFailTable: string | null = null;
const mockFailingAddresses = new Set<string>();
const mockAdminSends: string[] = [];
const mockProspectSends: unknown[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row | null = null; let cap = Infinity;
  const run = () => {
    if (mockFailTable === table) return { data: null, error: { message: 'boom' } };
    const rows = (mockDb[table] ??= []);
    if (op === 'insert') { const row = { id: `id-${rows.length + 1}`, ...payload }; rows.push(row); return { data: row, error: null }; }
    const hit = rows.filter((r) => tests.every((t) => t(r))).slice(0, cap);
    if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (one && hit.length > 1) return { data: null, error: { code: 'PGRST116' } };
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b,
    limit: (n: number) => { cap = n; return b; },
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/emailService', () => ({
  sendCompanyAdminReferral: async (_to: string, opts: unknown) => { mockProspectSends.push(opts); },
  sendInboundSignupNoticeToAdmin: async (to: string) => {
    if (mockFailingAddresses.has(to)) throw new Error('send failed');
    mockAdminSends.push(to);
  },
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { notifyAdminAndProspectOfClaimedDomain } = require('../../services/claimedDomainNotifyService');
/* eslint-enable @typescript-eslint/no-var-requires */
const db: any = { from: (t: string) => mockTable(t) };
const input = { prospectEmail: 'p@acme.com', emailDomain: 'acme.com', companyId: 'co-1', companyName: 'Acme', nowIso: '2026-11-12T00:00:00Z' };
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockFailTable = null; mockFailingAddresses.clear(); mockAdminSends.length = 0; mockProspectSends.length = 0;
  mockDb.user_company_roles = [
    { user_id: 'u-admin', company_id: 'co-1', status: 'active', role: 'COMPANY_ADMIN', created_at: '1' },
    { user_id: 'u-admin2', company_id: 'co-1', status: 'active', role: 'COMPANY_ADMIN', created_at: '2' },
    { user_id: 'u-gone', company_id: 'co-1', status: 'inactive', role: 'COMPANY_ADMIN', created_at: '0' },
    { user_id: 'u-member', company_id: 'co-1', status: 'active', role: 'CONTENT_CREATOR', created_at: '0' },
    { user_id: 'u-other', company_id: 'co-2', status: 'active', role: 'COMPANY_ADMIN', created_at: '0' },
  ];
  mockDb.users = [
    { id: 'u-admin', name: 'Ada', email: 'ada@acme.com' },
    { id: 'u-admin2', name: 'Bob', email: 'bob@acme.com' },
    { id: 'u-gone', name: 'Gone', email: 'gone@acme.com' },
    { id: 'u-member', name: 'Mem', email: 'mem@acme.com' },
    { id: 'u-other', name: 'Oth', email: 'oth@other.com' },
  ];
  mockDb.signup_referrals = [];
});

it("'sent': EVERY active admin of THIS company is notified (no inactive admin, member or other company)", async () => {
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(mockAdminSends).toEqual(['ada@acme.com', 'bob@acme.com']);
});
it('the prospect email carries ONE contact: the oldest active admin', async () => {
  await notifyAdminAndProspectOfClaimedDomain(db, input);
  expect(mockProspectSends).toEqual([expect.objectContaining({ admin: { name: 'Ada', email: 'ada@acme.com' } })]);
});
it("one admin's send failing still counts as notified when another succeeded", async () => {
  mockFailingAddresses.add('ada@acme.com');
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(mockAdminSends).toEqual(['bob@acme.com']);
  expect(mockDb.signup_referrals[0].admin_user_id).toBe('u-admin2');
});
it("'failed' when every send throws (and it still never throws)", async () => {
  mockFailingAddresses.add('ada@acme.com'); mockFailingAddresses.add('bob@acme.com');
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'failed' });
});
it("'no_admin' when the company has no active admin", async () => {
  mockDb.user_company_roles = mockDb.user_company_roles.filter((r) => r.company_id !== 'co-1' || r.status !== 'active' || r.role !== 'COMPANY_ADMIN');
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'no_admin' });
});
it("a failed admin lookup is 'failed', never 'no_admin'", async () => {
  for (const t of ['user_company_roles', 'users']) {
    mockFailTable = t;
    expect([t, await notifyAdminAndProspectOfClaimedDomain(db, input)]).toEqual([t, { adminNotice: 'failed' }]);
  }
});
it('a repeat attempt by the same prospect never re-notifies any admin: already_sent', async () => {
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'already_sent' });
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'already_sent' });
  expect(mockAdminSends).toEqual(['ada@acme.com', 'bob@acme.com']);
});
it('a fully failed first attempt is RETRIED next time; the marker is written only on success', async () => {
  mockFailingAddresses.add('ada@acme.com'); mockFailingAddresses.add('bob@acme.com');
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'failed' });
  expect(mockDb.signup_referrals[0].admin_user_id).toBeNull();
  mockFailingAddresses.clear();
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(mockDb.signup_referrals[0].admin_user_id).toBe('u-admin');
  expect(mockAdminSends).toEqual(['ada@acme.com', 'bob@acme.com']);
});

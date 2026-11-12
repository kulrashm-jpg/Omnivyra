/**
 * 05 review (2026-11-12): notifyAdminAndProspectOfClaimedDomain is best-effort and never throws, so it
 * must REPORT what happened to the admin notice - callers tell the prospect "we've asked your admin"
 * only on 'sent'. A failed lookup is 'failed', never 'no_admin'.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockFailTable: string | null = null;
let mockSendThrows = false;
const mockAdminSends: string[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row | null = null;
  const run = () => {
    if (mockFailTable === table) return { data: null, error: { message: 'boom' } };
    const rows = (mockDb[table] ??= []);
    if (op === 'insert') { const row = { id: `id-${rows.length + 1}`, ...payload }; rows.push(row); return { data: row, error: null }; }
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (one && hit.length > 1) return { data: null, error: { code: 'PGRST116' } };
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/emailService', () => ({
  sendCompanyAdminReferral: async () => undefined,
  sendInboundSignupNoticeToAdmin: async (to: string) => { if (mockSendThrows) throw new Error('send failed'); mockAdminSends.push(to); },
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { notifyAdminAndProspectOfClaimedDomain } = require('../../services/claimedDomainNotifyService');
/* eslint-enable @typescript-eslint/no-var-requires */
const db: any = { from: (t: string) => mockTable(t) };
const input = { prospectEmail: 'p@acme.com', emailDomain: 'acme.com', companyId: 'co-1', companyName: 'Acme', nowIso: '2026-11-12T00:00:00Z' };
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockFailTable = null; mockSendThrows = false; mockAdminSends.length = 0;
  mockDb.user_company_roles = [{ user_id: 'u-admin', company_id: 'co-1', status: 'active', role: 'COMPANY_ADMIN', created_at: '1' }];
  mockDb.users = [{ id: 'u-admin', name: 'Ada', email: 'ada@acme.com' }];
  mockDb.signup_referrals = [];
});

it("'sent' when the admin notice went out", async () => {
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(mockAdminSends).toEqual(['ada@acme.com']);
});
it("'failed' when the send throws (and it still never throws)", async () => {
  mockSendThrows = true;
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'failed' });
});
it("'no_admin' when the company has no active admin", async () => {
  mockDb.user_company_roles = [];
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'no_admin' });
});
it("a failed admin lookup is 'failed', never 'no_admin'", async () => {
  for (const t of ['user_company_roles', 'users']) {
    mockFailTable = t;
    expect([t, await notifyAdminAndProspectOfClaimedDomain(db, input)]).toEqual([t, { adminNotice: 'failed' }]);
  }
});

it('a repeat attempt by the same prospect never re-notifies the admin: already_sent', async () => {
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'already_sent' });
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'already_sent' });
  expect(mockAdminSends).toEqual(['ada@acme.com']);
});
it('a failed first send is RETRIED next time; the marker is written only on success', async () => {
  mockSendThrows = true;
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'failed' });
  expect(mockDb.signup_referrals[0].admin_user_id).toBeNull();
  mockSendThrows = false;
  expect(await notifyAdminAndProspectOfClaimedDomain(db, input)).toEqual({ adminNotice: 'sent' });
  expect(mockDb.signup_referrals[0].admin_user_id).toBe('u-admin');
  expect(mockAdminSends).toEqual(['ada@acme.com']);
});

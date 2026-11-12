/**
 * P1 - GoTrue-bypass gate (e1, 2026-11-13; e9 ruling, 05 review). A company (and its initial credits) can only be
 * bootstrapped from a BOUND signup intent minted by the server after every signup gate passed; the company's id is
 * the intent's id. Hostile by default: a faithful fake applies every filter; nothing defaults to "acceptable".
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockFail: string | null = null;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let lim = Infinity; let order: [string, boolean] | null = null;
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    gt: (c: string, v: string) => { tests.push((r) => String(r[c]) > v); return b; },
    order: (c: string, o: { ascending: boolean }) => { order = [c, o.ascending]; return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      if (mockFail === table) return Promise.resolve({ data: null, error: { message: 'transient' } }).then(ok, ko);
      let hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      if (order) { const [c, asc] = order; hit = hit.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1)); }
      hit = hit.slice(0, lim);
      if (one && hit.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(ok, ko);
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../services/signupBootstrapGate');
/* eslint-enable @typescript-eslint/no-var-requires */

const NOW = Date.parse('2026-12-01T12:00:00.000Z');
const later = new Date(NOW + 3600_000).toISOString();
const EMAIL = 'jane@acme.com';
const intent = (over: Row = {}, data: Row = {}) => ({
  id: 'intent-1', email: EMAIL, status: 'pending', created_at: '2026-12-01T10:00:00.000Z', expires_at: later,
  intent_data: { company_name: 'Acme', validated_company_domain: 'acme.com', validated_website_url: 'https://www.acme.com', verdict: 'eligible', ...data },
  ...over,
});
const resolve = (email = EMAIL) => gate.resolveBootstrapIntent(email, { now: () => NOW });
beforeEach(() => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockFail = null; });

describe('resolveBootstrapIntent', () => {
  it('a server-minted, unexpired intent with an accepted verdict binds - company id = intent id', async () => {
    mockDb.signup_intents = [intent()];
    expect(await resolve()).toEqual({ ok: true, intent: { intentId: 'intent-1', websiteUrl: 'https://www.acme.com', companyDomain: 'acme.com', verdict: 'eligible', companyName: 'Acme' } });
  });

  it("verdict 'auto_approved' is accepted (e9: today's bar, explicit); a 'completed' intent (email verified) still binds", async () => {
    mockDb.signup_intents = [intent({ status: 'completed' }, { verdict: 'auto_approved' })];
    expect(await resolve()).toMatchObject({ ok: true, intent: { verdict: 'auto_approved' } });
  });

  it('NO intent at all (the bypass signature) -> revalidation required, never allowed', async () => {
    expect(await resolve()).toEqual({ ok: false, reason: 'SIGNUP_REVALIDATION_REQUIRED' });
  });

  const refused: Array<[string, Row, Row]> = [
    ['expired', { expires_at: new Date(NOW - 1).toISOString() }, {}],
    ['status expired', { status: 'expired' }, {}],
    ['another email', { email: 'bob@acme.com' }, {}],
    ['unknown verdict', {}, { verdict: 'review' }],
    ['company domain != email domain', {}, { validated_company_domain: 'other.com' }],
    ['website on another domain', {}, { validated_website_url: 'https://www.other.com' }],
    ['no website', {}, { validated_website_url: '' }],
  ];
  for (const [label, over, data] of refused) {
    it(`refuses: ${label}`, async () => {
      mockDb.signup_intents = [intent(over, data)];
      expect([label, await resolve()]).toEqual([label, { ok: false, reason: 'SIGNUP_REVALIDATION_REQUIRED' }]);
    });
  }

  it('website <-> email match is at the REGISTRABLE domain (mail.acme.com email, acme.com site)', async () => {
    mockDb.signup_intents = [intent({ email: 'jane@mail.acme.com' })];
    expect(await resolve('jane@mail.acme.com')).toMatchObject({ ok: true });
  });

  it('LEGACY cutoff boundary: a verdict-less intent is accepted only if created BEFORE the server-side cutoff', async () => {
    const cutoff = Date.parse(gate.SIGNUP_INTENT_VERDICT_CUTOFF);
    mockDb.signup_intents = [intent({ created_at: new Date(cutoff - 1).toISOString() }, { verdict: undefined })];
    expect(await resolve()).toMatchObject({ ok: true, intent: { verdict: 'legacy' } });
    mockDb.signup_intents = [intent({ created_at: new Date(cutoff).toISOString() }, { verdict: undefined })];
    expect(await resolve()).toEqual({ ok: false, reason: 'SIGNUP_REVALIDATION_REQUIRED' });
  });

  it('the newest ACCEPTABLE intent wins; an unacceptable newer one does not hide an acceptable older one', async () => {
    mockDb.signup_intents = [
      intent({ id: 'old', created_at: '2026-12-01T09:00:00.000Z' }),
      intent({ id: 'new-bad', created_at: '2026-12-01T11:00:00.000Z' }, { verdict: 'review' }),
    ];
    expect(await resolve()).toMatchObject({ ok: true, intent: { intentId: 'old' } });
  });

  it('a signup_intents READ ERROR is INTENT_LOOKUP_FAILED (retryable), never allowed', async () => {
    mockDb.signup_intents = [intent()];
    mockFail = 'signup_intents';
    expect(await resolve()).toEqual({ ok: false, reason: 'INTENT_LOOKUP_FAILED' });
  });
});

describe('isIntentBornOrganization (credit chokepoint)', () => {
  it("yes only when a signup_intents row has id = orgId; 'unknown' on a read error", async () => {
    mockDb.signup_intents = [intent({ id: 'org-born' })];
    expect(await gate.isIntentBornOrganization('org-born')).toBe('yes');
    expect(await gate.isIntentBornOrganization('org-other')).toBe('no');
    mockFail = 'signup_intents';
    expect(await gate.isIntentBornOrganization('org-born')).toBe('unknown');
  });
});

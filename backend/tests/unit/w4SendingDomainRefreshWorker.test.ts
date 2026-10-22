/**
 * W4 — the sending-domain refresh worker (FR-1: 48-hour verification freshness).
 *
 * The worker runs for real against a database double and a fake SES identity
 * port; the real `refreshSendingDomainStatus` and `validateSender` run on top.
 * No test contacts AWS.
 */
type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { op?: string; code: string }>,
  calls: 0,
  /** Runs once, just before the next UPDATE is applied: a competing process. */
  onUpdate: null as null | ((table: string) => void),
  /** Every UPDATE issued: table, payload and filters (for scoping assertions). */
  updates: [] as Array<{ table: string; payload: Row | null; filters: Filter[] }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    db.calls += 1;
    const st = {
      op: 'select', payload: null as Row | null, filters: [] as Filter[],
      order: null as null | { col: string; asc: boolean; nullsFirst: boolean }, limit: null as number | null,
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.filters.every(([k, c, v]) =>
      k === 'eq' ? r[c] === v
        : k === 'is' ? (r[c] ?? null) === v
          : k === 'in' ? (v as unknown[]).includes(r[c]) : true);
    const exec = async (mode: 'many' | 'one') => {
      // Two awaits: lets concurrent workers interleave between read and write.
      await Promise.resolve();
      await Promise.resolve();
      const f = db.failures[table];
      if (f && (!f.op || f.op === st.op)) return { data: null, error: { code: f.code, message: 'injected' } };
      if (st.op === 'update') {
        db.updates.push({ table, payload: st.payload, filters: [...st.filters] });
        if (db.onUpdate) { const hook = db.onUpdate; db.onUpdate = null; hook(table); }
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return mode === 'one' ? { data: hit[0] ?? null, error: null } : { data: hit.map((r) => ({ ...r })), error: null };
      }
      let found = rows().filter(match).map((r) => ({ ...r }));
      if (st.order) {
        const { col, asc, nullsFirst } = st.order;
        found.sort((a, b) => {
          const av = a[col] ?? null; const bv = b[col] ?? null;
          if (av === bv) return 0;
          if (av === null) return nullsFirst ? -1 : 1;
          if (bv === null) return nullsFirst ? 1 : -1;
          return (String(av) < String(bv) ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (st.limit !== null) found = found.slice(0, st.limit);
      return mode === 'one' ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      insert: () => { throw new Error('the worker never inserts'); },
      delete: () => { throw new Error('the worker never deletes'); },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => { st.order = { col, asc: o.ascending !== false, nullsFirst: !!o.nullsFirst }; return b; },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => exec('one'),
      maybeSingle: () => exec('one'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import { SesIdentityError, type SesIdentityErrorCode, type SesIdentityState } from '../../services/sendingDomains/sesIdentityPort';
import {
  CANDIDATE_SCAN_LIMIT,
  REFRESH_AFTER_MS,
  RETRY_AFTER_MS,
  isRefreshDue,
  runSendingDomainRefresh,
} from '../../services/sendingDomains/sendingDomainRefreshWorker';
import { validateSender } from '../../services/sendingDomains/sendingDomainService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const CS = (org: string) => `omnivyra-t-${org}`;
const NOW = new Date('2026-10-22T12:00:00.000Z');
const H = 60 * 60 * 1000;
const ago = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

/** A fake SES identity port: answers per domain; records every call. */
function fakeSes() {
  const api = {
    region: 'eu-north-1',
    calls: [] as Array<[string, string]>,
    state: new Map<string, SesIdentityState>(),
    fail: new Map<string, SesIdentityErrorCode>(),
    async createDomainIdentity(input: { domain: string }) { api.calls.push(['create', input.domain]); throw new Error('the worker never creates'); },
    async getDomainIdentity(domain: string) {
      api.calls.push(['get', domain]);
      const code = api.fail.get(domain);
      if (code) throw new SesIdentityError(code);
      const s = api.state.get(domain);
      if (!s) throw new SesIdentityError('not_found');
      return s;
    },
  };
  return api;
}
const held = (org: string): SesIdentityState => ({ verifiedForSending: true, dkimStatus: 'SUCCESS', dkimTokens: ['t1', 't2', 't3'], configurationSetName: CS(org) });

let ses: ReturnType<typeof fakeSes>;
let logs: Array<{ level: string; event: string; payload: Record<string, unknown> }>;
const log = {
  info: (event: string, payload: Record<string, unknown> = {}) => { logs.push({ level: 'info', event, payload }); },
  warn: (event: string, payload: Record<string, unknown> = {}) => { logs.push({ level: 'warn', event, payload }); },
};
const run = (at = NOW, extra: Record<string, unknown> = {}) => runSendingDomainRefresh({ ses, now: () => at, log, ...extra });

let nextId = 1;
function domainRow(over: Row = {}): Row {
  const org = (over.organization_id as string) ?? ORG_A;
  return {
    id: `sd-${nextId++}`, organization_id: org, domain: 'acme.com', status: 'verified', ses_region: 'eu-north-1',
    configuration_set_name: CS(org), dkim_tokens: ['t1', 't2', 't3'], dkim_signing_hosted_zone: null,
    ses_identity_state: 'created', last_error_code: null, last_checked_at: ago(13 * H), verified_at: ago(13 * H),
    removed_at: null, created_at: ago(100 * H), ...over,
  };
}
const rows = () => db.tables.tenant_sending_domains;

beforeEach(() => {
  nextId = 1;
  db.calls = 0;
  db.failures = {};
  db.onUpdate = null;
  db.updates = [];
  db.tables = {
    tenant_sending_domains: [],
    company_domains: [
      { company_id: ORG_A, final_domain: 'acme.com', verification_status: 'verified' },
      { company_id: ORG_B, final_domain: 'beta.com', verification_status: 'verified' },
    ],
    companies: [{ id: ORG_A, status: 'active', deleted_at: null }, { id: ORG_B, status: 'active', deleted_at: null }],
  };
  ses = fakeSes();
  logs = [];
});

describe('W4 refresh worker — what is due', () => {
  it.each([
    ['never checked', { last_checked_at: null }, true],
    ['checked 13 h ago', { last_checked_at: ago(13 * H) }, true],
    ['checked exactly REFRESH_AFTER ago', { last_checked_at: ago(REFRESH_AFTER_MS) }, true],
    ['checked 1 h ago (lease / fresh)', { last_checked_at: ago(1 * H) }, false],
    ['retryable error 31 min ago', { last_checked_at: ago(31 * 60 * 1000), last_error_code: 'ses_throttled' }, true],
    ['retryable error 10 min ago', { last_checked_at: ago(10 * 60 * 1000), last_error_code: 'ses_unavailable' }, false],
    ['terminal error 1 h ago (waits for the full interval)', { last_checked_at: ago(1 * H), last_error_code: 'ses_access_denied' }, false],
    ['checked in the future (another worker, skewed clock)', { last_checked_at: new Date(NOW.getTime() + H).toISOString() }, false],
    ['malformed last_checked_at (treated as never checked)', { last_checked_at: 'garbage' }, true],
    ['removed', { removed_at: ago(H) }, false],
    ["state 'none'", { ses_identity_state: 'none' }, false],
    ["state 'missing'", { ses_identity_state: 'missing' }, false],
    ["state 'delete_pending'", { ses_identity_state: 'delete_pending' }, false],
    ["state 'adopted'", { ses_identity_state: 'adopted' }, true],
  ])('%s → due=%p', (_label, over, due) => {
    expect(isRefreshDue(domainRow(over), NOW.getTime())).toBe(due);
  });

  it('the intervals keep a held identity well inside the approved 48 h window', () => {
    expect(REFRESH_AFTER_MS).toBe(12 * H);
    expect(RETRY_AFTER_MS).toBe(30 * 60 * 1000);
    expect(48 * H / REFRESH_AFTER_MS).toBeGreaterThanOrEqual(4);
  });
});

describe('W4 refresh worker — a successful refresh', () => {
  it('re-reads SES once and renews verified_at; the domain stays sendable', async () => {
    db.tables.tenant_sending_domains = [domainRow({ verified_at: ago(47 * H), last_checked_at: ago(13 * H) })];
    ses.state.set('acme.com', held(ORG_A));
    const s = await run();
    expect(s).toMatchObject({ claimed: 1, refreshed: 1, stoppedEarly: null });
    expect(ses.calls).toEqual([['get', 'acme.com']]);
    expect(rows()[0]).toMatchObject({ status: 'verified', verified_at: NOW.toISOString(), last_error_code: null });
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, { now: () => new Date(NOW.getTime() + 47 * H) })).ok).toBe(true);
  });

  it('a STALE verified domain (refused by validateSender) is fresh again after a successful refresh', async () => {
    db.tables.tenant_sending_domains = [domainRow({ verified_at: ago(50 * H), last_checked_at: ago(50 * H) })];
    ses.state.set('acme.com', held(ORG_A));
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, { now: () => NOW })).reason).toBe('verification_stale');
    await run();
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, { now: () => NOW })).ok).toBe(true);
  });

  it('nothing is due → no SES call', async () => {
    db.tables.tenant_sending_domains = [domainRow({ last_checked_at: ago(H) })];
    const s = await run();
    expect(s).toMatchObject({ scanned: 1, due: 0, claimed: 0 });
    expect(ses.calls).toHaveLength(0);
  });
});

describe('W4 refresh worker — claiming (cross-process)', () => {
  it('two concurrent workers refresh each due row EXACTLY once', async () => {
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null }),
      domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: ago(20 * H) }),
    ];
    ses.state.set('acme.com', held(ORG_A));
    ses.state.set('beta.com', held(ORG_B));
    const [a, b] = await Promise.all([run(), run()]);
    expect(ses.calls.filter(([op]) => op === 'get').map(([, d]) => d).sort()).toEqual(['acme.com', 'beta.com']);
    expect(a.claimed + b.claimed).toBe(2);
    expect(a.claimLost + b.claimLost).toBe(2);
    expect(a.refreshed + b.refreshed).toBe(2);
  });

  it('a row changed between read and claim (claim lost) is skipped without an SES call', async () => {
    db.tables.tenant_sending_domains = [domainRow({ last_checked_at: ago(20 * H) })];
    ses.state.set('acme.com', held(ORG_A));
    // Another process claims the row after this worker read it, before its claim lands.
    db.onUpdate = () => { rows()[0].last_checked_at = ago(1000); };
    const s = await run();
    expect(s).toMatchObject({ due: 1, claimed: 0, claimLost: 1 });
    expect(ses.calls).toHaveLength(0);
  });

  it('a claim WRITE failure is reported and nothing is refreshed', async () => {
    db.tables.tenant_sending_domains = [domainRow()];
    db.failures.tenant_sending_domains = { op: 'update', code: '08006' };
    const s = await run();
    expect(s.outcomes[0]).toMatchObject({ result: 'claim_failed' });
    expect(ses.calls).toHaveLength(0);
  });

  it('an unreadable candidate list stops the run (no SES call)', async () => {
    db.tables.tenant_sending_domains = [domainRow()];
    db.failures.tenant_sending_domains = { op: 'select', code: '08006' };
    expect((await run()).stoppedEarly).toBe('candidate_read_failed');
    expect(ses.calls).toHaveLength(0);
  });

  it('recovery: a row claimed by a worker that died is left alone (lease) and picked up once it is due again', async () => {
    db.tables.tenant_sending_domains = [domainRow({ last_checked_at: ago(H) })]; // claimed 1 h ago, never completed
    ses.state.set('acme.com', held(ORG_A));
    expect((await run()).claimed).toBe(0);
    const later = new Date(NOW.getTime() + REFRESH_AFTER_MS);
    const s = await run(later);
    expect(s).toMatchObject({ claimed: 1, refreshed: 1 });
    expect(rows()[0].verified_at).toBe(later.toISOString());
  });
});

describe('W4 refresh worker — failures fail closed', () => {
  it("not_found → 'missing' + failed + verified_at cleared; the sender is refused", async () => {
    db.tables.tenant_sending_domains = [domainRow()];
    const s = await run();
    expect(s.outcomes[0]).toMatchObject({ result: 'refreshed', reason: 'ses_identity_missing' });
    expect(rows()[0]).toMatchObject({ ses_identity_state: 'missing', status: 'failed', verified_at: null });
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, { now: () => NOW })).ok).toBe(false);
  });

  it('throttling stops the run (back-off); nothing is upgraded or renewed; retried after RETRY_AFTER', async () => {
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null, verified_at: ago(40 * H) }),
      domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: ago(20 * H) }),
    ];
    ses.fail.set('acme.com', 'throttled');
    const s = await run();
    expect(s).toMatchObject({ claimed: 1, retryable: 1, stoppedEarly: 'throttled' });
    expect(ses.calls).toEqual([['get', 'acme.com']]);
    expect(rows()[0]).toMatchObject({ status: 'verified', verified_at: ago(40 * H), last_error_code: 'ses_throttled' });
    expect(isRefreshDue(rows()[0], NOW.getTime() + 10 * 60 * 1000)).toBe(false);
    expect(isRefreshDue(rows()[0], NOW.getTime() + RETRY_AFTER_MS)).toBe(true);
  });

  it.each([['provider_not_configured'], ['access_denied']])('%s stops the run; the verified status is kept but NOT renewed', async (code) => {
    db.tables.tenant_sending_domains = [domainRow({ verified_at: ago(40 * H) }), domainRow({ organization_id: ORG_B, domain: 'beta.com' })];
    ses.fail.set('acme.com', code as SesIdentityErrorCode);
    const s = await run();
    expect(s.stoppedEarly).toBe(code);
    expect(ses.calls).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ verified_at: ago(40 * H), last_error_code: `ses_${code}` });
    // …so it goes stale on schedule and sending stops.
    expect((await validateSender({ organizationId: ORG_A, fromAddress: 'a@acme.com' }, { now: () => new Date(NOW.getTime() + 9 * H) })).reason).toBe('verification_stale');
  });

  it('the default (unconfigured) provider fails closed: no AWS, run stopped', async () => {
    db.tables.tenant_sending_domains = [domainRow()];
    const s = await runSendingDomainRefresh({ now: () => NOW, log });
    expect(s.stoppedEarly).toBe('provider_not_configured');
    expect(rows()[0].status).toBe('verified');
  });

  it('a malformed SES answer is terminal for that row only; the run continues', async () => {
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null }),
      domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: ago(20 * H) }),
    ];
    ses.fail.set('acme.com', 'incomplete_response');
    ses.state.set('beta.com', held(ORG_B));
    const s = await run();
    expect(s).toMatchObject({ terminal: 1, refreshed: 1, stoppedEarly: null });
    expect(rows()[0]).toMatchObject({ status: 'verified', last_error_code: 'ses_incomplete_response' });
  });

  it("an identity whose configuration set is not the tenant's is failed, never renewed", async () => {
    db.tables.tenant_sending_domains = [domainRow()];
    ses.state.set('acme.com', { ...held(ORG_A), configurationSetName: CS(ORG_B) });
    await run();
    expect(rows()[0]).toMatchObject({ status: 'failed', verified_at: null, last_error_code: 'ses_identity_not_adoptable' });
  });

  it('a refresh that throws is contained (retryable) and nothing is upgraded', async () => {
    db.tables.tenant_sending_domains = [domainRow({ status: 'pending', verified_at: null })];
    ses.getDomainIdentity = async () => { throw new Error('socket hang up'); };
    const s = await run();
    expect(s.retryable).toBe(1);
    expect(rows()[0]).toMatchObject({ status: 'pending', verified_at: null });
  });
});

describe('W4 refresh worker — tenant isolation and bounds', () => {
  it("each row is refreshed under its OWN tenant; another tenant's row is untouched", async () => {
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null }),
      domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: ago(H), verified_at: ago(H) }),
    ];
    ses.state.set('acme.com', held(ORG_A));
    const before = { ...rows()[1] };
    await run();
    expect(rows()[1]).toEqual(before);
    expect(ses.calls).toEqual([['get', 'acme.com']]);
  });

  it('every UPDATE the worker (and the refresh it drives) issues is scoped by id AND organization_id', async () => {
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null }),
      domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: null }),
    ];
    ses.state.set('acme.com', held(ORG_A));
    ses.state.set('beta.com', held(ORG_B));
    await run();
    const updates = db.updates.filter((u) => u.table === 'tenant_sending_domains');
    expect(updates.length).toBeGreaterThanOrEqual(4); // 2 claims + 2 refresh writes
    for (const u of updates) {
      const id = u.filters.find(([k, c]) => k === 'eq' && c === 'id');
      const org = u.filters.find(([k, c]) => k === 'eq' && c === 'organization_id');
      expect(id).toBeDefined();
      expect(org).toBeDefined();
      const target = rows().find((r) => r.id === id![2]);
      expect(org![2]).toBe(target!.organization_id);
    }
  });

  it('no tenant gets more than perTenantLimit refreshes per run', async () => {
    db.tables.company_domains.push({ company_id: ORG_A, final_domain: 'acme2.com', verification_status: 'verified' }, { company_id: ORG_A, final_domain: 'acme3.com', verification_status: 'verified' });
    db.tables.tenant_sending_domains = [
      domainRow({ last_checked_at: null }), domainRow({ domain: 'acme2.com', last_checked_at: null }), domainRow({ domain: 'acme3.com', last_checked_at: null }),
    ];
    for (const d of ['acme.com', 'acme2.com', 'acme3.com']) ses.state.set(d, held(ORG_A));
    const s = await run(NOW, { perTenantLimit: 2 });
    expect(s.claimed).toBe(2);
    expect(ses.calls).toHaveLength(2);
  });

  it('the batch size bounds SES calls per run', async () => {
    const orgs = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000010${i}`);
    db.tables.company_domains = orgs.map((org, i) => ({ company_id: org, final_domain: `d${i}.com`, verification_status: 'verified' }));
    db.tables.tenant_sending_domains = orgs.map((org, i) => domainRow({ organization_id: org, domain: `d${i}.com`, last_checked_at: null }));
    orgs.forEach((org, i) => ses.state.set(`d${i}.com`, held(org)));
    const s = await run(NOW, { batchSize: 3, perTenantLimit: 5 });
    expect(s.claimed).toBe(3);
    expect(ses.calls).toHaveLength(3);
  });

  it(`at most CANDIDATE_SCAN_LIMIT (${CANDIDATE_SCAN_LIMIT}) rows are inspected per run, oldest-checked first`, async () => {
    db.tables.tenant_sending_domains = Array.from({ length: CANDIDATE_SCAN_LIMIT + 5 }, () => domainRow({ last_checked_at: ago(H) }));
    db.tables.tenant_sending_domains.push(domainRow({ id: 'oldest', last_checked_at: null }));
    ses.state.set('acme.com', held(ORG_A));
    const s = await run(NOW, { batchSize: 1 });
    expect(s.scanned).toBe(CANDIDATE_SCAN_LIMIT);
    expect(s.outcomes[0].id).toBe('oldest');
  });
});

describe('W4 refresh worker — never deletes, never creates; redacted logs', () => {
  it('only GetEmailIdentity is ever called, and no row is deleted or inserted', async () => {
    db.tables.tenant_sending_domains = [domainRow({ last_checked_at: null }), domainRow({ organization_id: ORG_B, domain: 'beta.com', last_checked_at: null })];
    ses.state.set('acme.com', held(ORG_A));
    await run();
    expect(new Set(ses.calls.map(([op]) => op))).toEqual(new Set(['get']));
    expect(rows()).toHaveLength(2);
  });

  it('logs carry ids and outcome codes only', async () => {
    db.tables.tenant_sending_domains = [domainRow({ last_checked_at: null })];
    ses.state.set('acme.com', held(ORG_A));
    await run();
    const allowed = new Set(['sendingDomainId', 'organizationId', 'result', 'reason', 'scanned', 'due', 'claimed', 'refreshed', 'retryable', 'terminal', 'claimLost', 'stoppedEarly']);
    for (const entry of logs) for (const k of Object.keys(entry.payload)) expect(allowed.has(k)).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/acme\.com|t1|SECRET|AKIA|accessKey/i);
  });
});

/**
 * PI FOUNDATION — CHARACTERIZATION of the person→company edge, at the
 * ORCHESTRATOR level.
 *
 * `prospectIdentityAccountResolution.test.ts` already proves `attachPersonToAccount`
 * itself refuses to re-home an attached person. That is the function's contract and
 * it is correct. What nothing covered is what the ORCHESTRATOR does with that
 * refusal — and the answer is the reason this file exists:
 *
 *   `orchestrator.ts:326` calls `attachPersonToAccount(...)` and DISCARDS its
 *   return value, while `:511` reports `accountId` from `resolveAccount` in a
 *   SUCCESSFUL outcome regardless of whether the attach happened.
 *
 * So a second employer for an already-attached person produces `ok: true` with
 * `accountId` set to the employer that was NOT attached. The caller is not merely
 * under-informed, it is affirmatively misinformed: the outcome names an employer
 * the person is not linked to, and the firmographic pass then attributes that
 * employer's attributes to the account row the person does not belong to.
 *
 * These tests assert BEHAVIOUR AS BUILT. They do not endorse it. They exist so the
 * loss is visible and cannot regress silently, and so the person-company
 * multiplicity work has a baseline to change deliberately.
 *
 * ─── THE MOCKS MODEL THE DIMENSION UNDER TEST ─────────────────────────────
 * Per the Phase 4A-H lesson, a port that ignores the argument being tested cannot
 * detect a fault in it. `attachPersonToAccount` here is therefore BOTH
 * state-sensitive (it reproduces the real `.is('account_id', null)` write-once
 * predicate) and tenant-sensitive (attachments are kept per tenant), so a
 * cross-tenant or re-home regression is observable rather than invisible.
 */

type Row = Record<string, unknown>;

const db = { tables: {} as Record<string, Row[]>, writes: [] as Array<{ table: string; payload: Row }>, nextId: 1 };

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'insert' = 'select';
    let payload: Row = {};
    const rows = (): Row[] => (db.tables[table] ??= []);
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (op === 'insert') {
        db.writes.push({ table, payload });
        const created = { id: `${table}-${db.nextId++}`, ...payload };
        rows().push(created);
        return { data: created, error: null };
      }
      return { data: rows().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { op = 'insert'; payload = p; return api; },
      update: (p: Row) => { op = 'insert'; payload = p; return api; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      in: () => api,
      limit: () => api,
      maybeSingle: () => exec().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      single: () => exec().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACCOUNT_A1 = 'acct-A1';
const ACCOUNT_A2 = 'acct-A2';
const ACCOUNT_B1 = 'acct-B1';

/**
 * TENANT-SENSITIVE identity: one canonical person per (tenant, email). This is
 * the real unique arbiter — `idx_unified_persons_company_email_unique` is
 * `(company_id, primary_email)` — so the same human in two tenants is two
 * persons, and the same human twice in one tenant is ONE person.
 */
const personIds = new Map<string, string>();
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async (input: { companyId: string; email?: string | null }) => {
    const key = `${input.companyId}|${input.email ?? ''}`;
    if (!personIds.has(key)) personIds.set(key, `person-${personIds.size + 1}`);
    return { unifiedPersonId: personIds.get(key) };
  }),
  normalizeEmail: (v: string) => v,
  normalizePhone: (v: string) => v,
}));

/**
 * STATE-SENSITIVE attachment: reproduces the production predicate
 * `.update({account_id}).eq('id',person).eq('company_id',org).is('account_id',null)`
 * — the first attach for a person wins and every later one matches zero rows.
 * Keyed by tenant AND person so a cross-tenant leak is detectable.
 */
const attached = new Map<string, string>();
const attachCalls: Array<{ org: string; person: string; account: string; result: boolean }> = [];
let resolvedAccount: string | null = null;

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => (
    resolvedAccount
      ? { accountId: resolvedAccount, outcome: 'resolved' }
      : { accountId: null, outcome: 'insufficient_evidence' }
  )),
  attachPersonToAccount: jest.fn(async (org: string, person: string, account: string) => {
    const key = `${org}|${person}`;
    const already = attached.has(key);
    if (!already) attached.set(key, account);
    attachCalls.push({ org, person, account, result: !already });
    return already
      ? { attached: false, reason: 'person not found in this tenant, or already attached to an account' }
      : { attached: true, reason: 'person attached to account' };
  }),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => ({
    sourceRecordId: 'src-1', outcome: 'created', canonicalApplied: [], canonicalWithheld: [],
  })),
}));
jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => ({ prospectId: 'prospect-1', outcome: 'created' })),
  attachPersonToProspect: jest.fn(async () => ({ attached: true })),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';

/**
 * `resolveAccount` (orchestrator.ts:211-230) returns null unless the record
 * carries an `account` with at least one deterministic key, so every record here
 * supplies a domain. Which account that domain resolves to is controlled by the
 * `resolvedAccount` fixture, mirroring W4's resolution rather than re-testing it.
 */
const record = (org: string, email: string, externalId: string, domain = 'employer.test') => ({
  raw: {},
  normalized: {
    organizationId: org, source: 'crm', entityType: 'person' as const,
    externalId, person: { email }, account: { domain },
  },
});

// The outer kill switch is read from the environment on every record, so the
// suite sets it itself instead of inheriting whatever the shell happens to hold
// (the same save/restore pattern as p2cEmployerFirmographicPropagation).
const INGESTION_FLAG = 'ENABLE_LEAD_INGESTION';
let ingestionFlagBefore: string | undefined;
beforeAll(() => { ingestionFlagBefore = process.env[INGESTION_FLAG]; });
afterAll(() => {
  if (ingestionFlagBefore === undefined) delete process.env[INGESTION_FLAG];
  else process.env[INGESTION_FLAG] = ingestionFlagBefore;
});

beforeEach(() => {
  process.env[INGESTION_FLAG] = 'true';
  db.tables = {}; db.writes = []; db.nextId = 1;
  personIds.clear(); attached.clear(); attachCalls.length = 0;
  resolvedAccount = null;
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PI FOUNDATION — one person, one company (the supported case)', () => {
  it('attaches the employer and reports it', async () => {
    resolvedAccount = ACCOUNT_A1;
    const out = await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    expect(out.ok).toBe(true);
    expect(out.accountId).toBe(ACCOUNT_A1);
    expect(attachCalls).toEqual([{ org: ORG_A, person: 'person-1', account: ACCOUNT_A1, result: true }]);
  });

  it('a replay of the same record is idempotent and does not re-home', async () => {
    resolvedAccount = ACCOUNT_A1;
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    expect(attached.get(`${ORG_A}|person-1`)).toBe(ACCOUNT_A1);
    // The second attach was attempted and REFUSED, which is the correct
    // behaviour for a replay — the employer did not change.
    expect(attachCalls.map((c) => c.result)).toEqual([true, false]);
  });
});

describe('PI FOUNDATION — one person, a SECOND company (the unsupported case)', () => {
  it('the second employer is NOT attached — the first one stands', async () => {
    resolvedAccount = ACCOUNT_A1;
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    resolvedAccount = ACCOUNT_A2;
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-2') as never, {});

    expect(attached.get(`${ORG_A}|person-1`)).toBe(ACCOUNT_A1);
    expect(attachCalls[1]).toMatchObject({ account: ACCOUNT_A2, result: false });
  });

  it('CHARACTERIZATION: the outcome still reports ok=true and names the UNATTACHED employer', async () => {
    // The sharp edge. `orchestrator.ts:326` discards the attach result and `:511`
    // reports `accountId` from `resolveAccount`, so the caller is told the person
    // is at ACCOUNT_A2 while the database still says ACCOUNT_A1. Not merely
    // under-informed — affirmatively misinformed, with no error, no counter and
    // no field anywhere in the outcome recording the discrepancy.
    resolvedAccount = ACCOUNT_A1;
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    resolvedAccount = ACCOUNT_A2;
    const second = await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-2') as never, {});

    expect(second.ok).toBe(true);
    expect(second.accountId).toBe(ACCOUNT_A2);          // reported
    expect(attached.get(`${ORG_A}|person-1`)).toBe(ACCOUNT_A1); // actual
    expect(second.accountId).not.toBe(attached.get(`${ORG_A}|person-1`));
    // Nothing in the outcome mentions the refusal.
    expect(JSON.stringify(second)).not.toMatch(/attach|already attached|relationship/i);
  });

  it('the person is NOT duplicated by the second employer', async () => {
    // The invariant that makes future multiplicity cheap: person identity is
    // `(tenant, email)` and `account_id` appears in NO unique index, so a second
    // employer never mints a second person. Only the edge is lossy.
    resolvedAccount = ACCOUNT_A1;
    const a = await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    resolvedAccount = ACCOUNT_A2;
    const b = await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-2') as never, {});

    expect(a.personId).toBe('person-1');
    expect(b.personId).toBe('person-1');
    expect(personIds.size).toBe(1);
  });
});

describe('PI FOUNDATION — tenant isolation of the edge', () => {
  it('the same human in two tenants is two persons with independent employers', async () => {
    resolvedAccount = ACCOUNT_A1;
    const a = await ingestNormalizedRecord(record(ORG_A, 'same@x.test', 'CRM-1') as never, {});
    resolvedAccount = ACCOUNT_B1;
    const b = await ingestNormalizedRecord(record(ORG_B, 'same@x.test', 'CRM-1') as never, {});

    expect(a.personId).not.toBe(b.personId);
    expect(attached.get(`${ORG_A}|${a.personId}`)).toBe(ACCOUNT_A1);
    expect(attached.get(`${ORG_B}|${b.personId}`)).toBe(ACCOUNT_B1);
  });

  it('every attach is made with the RECORD\'s tenant, never another', async () => {
    resolvedAccount = ACCOUNT_A1;
    await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    resolvedAccount = ACCOUNT_B1;
    await ingestNormalizedRecord(record(ORG_B, 'q@x.test', 'CRM-2') as never, {});

    expect(attachCalls.map((c) => c.org)).toEqual([ORG_A, ORG_B]);
    expect(attachCalls.find((c) => c.org === ORG_A)?.account).toBe(ACCOUNT_A1);
    expect(attachCalls.find((c) => c.org === ORG_B)?.account).toBe(ACCOUNT_B1);
    // ORG_B's person must never appear under ORG_A's tenant key.
    expect([...attached.keys()].sort()).toEqual([`${ORG_A}|person-1`, `${ORG_B}|person-2`].sort());
  });

  it('no employer is attached when the account cannot be resolved', async () => {
    resolvedAccount = null;
    const out = await ingestNormalizedRecord(record(ORG_A, 'p@x.test', 'CRM-1') as never, {});
    expect(out.ok).toBe(true);
    expect(out.accountId).toBeNull();
    expect(attachCalls).toEqual([]);
  });
});

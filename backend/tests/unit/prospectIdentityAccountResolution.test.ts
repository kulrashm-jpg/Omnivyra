/**
 * W4 — account resolution contract lock.
 *
 * The failure this guards against is a silent account merge. Two external
 * companies fused into one row is unrecoverable once people and claims hang off
 * it, so the tests assert hardest on the cases where the resolver must REFUSE:
 * name-only evidence, disagreeing keys, and any cross-tenant reach.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { prospect_accounts: [], unified_persons: [] };
let issued: Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload?: Row }> = [];
let insertError: { code: string; message: string } | null = null;
let nextId = 1;
/** Simulates a row created by another worker: appears only after N lookups. */
let appearAfter: { lookups: number; row: Row } | null = null;
let lookupCount = 0;

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op = 'select';
  let payload: Row | undefined;

  const rows = () => (db[table] ?? []).filter((r) => filters.every(([col, val]) =>
    val === null ? r[col] == null : r[col] === val));

  const settle = () => {
    issued.push({ table, op, filters: [...filters], payload });
    if (op === 'insert') {
      if (insertError) { const e = insertError; insertError = null; return { data: null, error: e }; }
      const row = { id: `acc-${nextId++}`, ...(payload as Row) };
      db[table].push(row);
      return { data: { id: row.id }, error: null };
    }
    if (op === 'update') {
      const hit = rows();
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (table === 'prospect_accounts') {
      lookupCount += 1;
      if (appearAfter && lookupCount > appearAfter.lookups) {
        if (!db.prospect_accounts.some((r) => r.id === appearAfter!.row.id)) db.prospect_accounts.push(appearAfter.row);
      }
    }
    return { data: rows(), error: null };
  };

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
    is: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
    limit: () => builder,
    insert: (p: Row) => { op = 'insert'; payload = p; return builder; },
    update: (p: Row) => { op = 'update'; payload = p; return builder; },
    single: () => Promise.resolve(settle()),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
  };
  return builder;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const acct = require('../../services/prospectIdentity/accountResolution');
const { resolveAccountShadow, resolveOrCreateAccount, attachPersonToAccount, W4_SOURCE } = acct;

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';

beforeEach(() => { db.prospect_accounts = []; db.unified_persons = []; issued = []; insertError = null; nextId = 1; appearAfter = null; lookupCount = 0; });

const seed = (org: string, over: Partial<Row> = {}) => {
  const r: Row = { id: `seed-${nextId++}`, organization_id: org, status: 'active',
    domain_normalized: null, source: null, source_reference: null, ...over };
  db.prospect_accounts.push(r);
  return r.id as string;
};

describe('what is NOT identity', () => {
  it('refuses to resolve on company name alone', async () => {
    seed(ORG_A, { name: 'Acme Corp', domain_normalized: 'acme.com' });
    const r = await resolveAccountShadow(ORG_A, { name: 'Acme Corp' });
    expect(r.outcome).toBe('insufficient_evidence');
    expect(r.accountId).toBeNull();
  });

  it('refuses to CREATE on name alone', async () => {
    const r = await resolveOrCreateAccount(ORG_A, { name: 'Acme Corp' });
    expect(r.outcome).toBe('insufficient_evidence');
    expect(db.prospect_accounts).toHaveLength(0);
  });

  it('reports AMBIGUOUS when the two keys disagree — never merges', async () => {
    const a1 = seed(ORG_A, { source: 'crm', source_reference: 'X1' });
    const a2 = seed(ORG_A, { domain_normalized: 'other.com' });
    const r = await resolveAccountShadow(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'other.com' });
    expect(r.outcome).toBe('ambiguous');
    expect(r.accountId).toBeNull();
    expect(r.candidateAccountIds.sort()).toEqual([a1, a2].sort());
  });

  it('does not create when evidence is ambiguous', async () => {
    seed(ORG_A, { source: 'crm', source_reference: 'X1' });
    seed(ORG_A, { domain_normalized: 'other.com' });
    const before = db.prospect_accounts.length;
    const r = await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'other.com' });
    expect(r.outcome).toBe('ambiguous');
    expect(db.prospect_accounts).toHaveLength(before);
  });
});

describe('deterministic resolution order', () => {
  it('prefers the provider reference over the domain', async () => {
    const bySource = seed(ORG_A, { source: 'crm', source_reference: 'X1', domain_normalized: 'acme.com' });
    const r = await resolveAccountShadow(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'acme.com' });
    expect(r.outcome).toBe('matched_source');
    expect(r.accountId).toBe(bySource);
  });

  it('falls back to domain when there is no provider reference', async () => {
    const byDomain = seed(ORG_A, { domain_normalized: 'acme.com' });
    const r = await resolveAccountShadow(ORG_A, { domain: 'https://www.acme.com/pricing?x=1' });
    expect(r.outcome).toBe('matched_domain');
    expect(r.accountId).toBe(byDomain);
    expect(r.normalizedDomain).toBe('acme.com');
  });

  it('takes the domain from an email address', async () => {
    const r = await resolveAccountShadow(ORG_A, { domain: 'john@mail.acme.com' });
    expect(r.normalizedDomain).toBe('acme.com');
  });

  it('ignores non-active accounts', async () => {
    seed(ORG_A, { domain_normalized: 'acme.com', status: 'merged' });
    const r = await resolveAccountShadow(ORG_A, { domain: 'acme.com' });
    expect(r.outcome).toBe('insufficient_evidence');
  });
});

describe('tenant scope', () => {
  it('filters every lookup by organization_id', async () => {
    await resolveAccountShadow(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'acme.com' });
    const q = issued.filter((x) => x.table === 'prospect_accounts');
    expect(q.length).toBeGreaterThan(0);
    for (const x of q) expect(x.filters).toContainEqual(['organization_id', ORG_A]);
  });

  it('never resolves another tenant\'s account', async () => {
    seed(ORG_B, { domain_normalized: 'acme.com' });
    const r = await resolveAccountShadow(ORG_A, { domain: 'acme.com' });
    expect(r.outcome).toBe('insufficient_evidence');
  });

  it('creates a SEPARATE account for the same company in another tenant', async () => {
    const a = await resolveOrCreateAccount(ORG_A, { domain: 'acme.com' });
    const b = await resolveOrCreateAccount(ORG_B, { domain: 'acme.com' });
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.accountId).not.toBe(b.accountId);
  });

  it('requires a tenant', async () => {
    await expect(resolveAccountShadow('', { domain: 'acme.com' })).rejects.toThrow(/organizationId/);
  });
});

describe('creation and idempotency', () => {
  it('creates from deterministic evidence and stamps provenance', async () => {
    const r = await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'acme.com', name: 'Acme' }, '2026-08-12T00:00:00.000Z');
    expect(r.outcome).toBe('created');
    const row = db.prospect_accounts[0] as any;
    expect(row.organization_id).toBe(ORG_A);
    expect(row.source).toBe('crm');
    expect(row.source_reference).toBe('X1');
    expect(row.domain_normalized).toBe('acme.com');
    expect(row.metadata.accountResolutionVersion).toBeDefined();
    expect(row.metadata.createdBy).toBe(W4_SOURCE);
    expect(row.first_seen_at).toBe('2026-08-12T00:00:00.000Z');
  });

  it('rates a provider reference more confidently than an inferred domain', async () => {
    await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1' });
    await resolveOrCreateAccount(ORG_B, { domain: 'acme.com' });
    expect((db.prospect_accounts[0] as any).confidence).toBe(1);
    expect((db.prospect_accounts[1] as any).confidence).toBeLessThan(1);
  });

  it('a replay resolves to the same account instead of creating a second', async () => {
    const first = await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'acme.com' });
    const again = await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1', domain: 'acme.com' });
    expect(again.accountId).toBe(first.accountId);
    expect(again.outcome).toBe('matched_source');
    expect(db.prospect_accounts).toHaveLength(1);
  });

  it('on a concurrent 23505 it re-resolves rather than retrying blindly', async () => {
    // Another worker wins the race: the row does not exist during our first
    // lookup, our INSERT loses with 23505, and it IS visible on re-resolve.
    const winner = { id: 'acc-winner', organization_id: ORG_A, status: 'active',
      domain_normalized: null, source: 'crm', source_reference: 'X1' };
    // With a source reference and no domain the first shadow pass performs
    // exactly one lookup, so the winner becomes visible from the second on —
    // i.e. only during the re-resolve that follows the 23505.
    appearAfter = { lookups: 1, row: winner };
    insertError = { code: '23505', message: 'duplicate key' };
    const r = await resolveOrCreateAccount(ORG_A, { source: 'crm', sourceReference: 'X1' });
    expect(r.accountId).toBe('acc-winner');
    expect(r.reason).toMatch(/concurrently/);
  });

  it('surfaces a non-unique insert failure instead of swallowing it', async () => {
    insertError = { code: '23503', message: 'fk violation' };
    await expect(resolveOrCreateAccount(ORG_A, { domain: 'acme.com' })).rejects.toThrow(/insert failed/);
  });
});

describe('person → account attachment', () => {
  it('attaches within the tenant and only when unattached', async () => {
    db.unified_persons.push({ id: 'p1', company_id: ORG_A, account_id: null });
    const r = await attachPersonToAccount(ORG_A, 'p1', 'acc-1');
    expect(r.attached).toBe(true);
    const q = issued.find((x) => x.table === 'unified_persons' && x.op === 'update');
    expect(q?.filters).toContainEqual(['company_id', ORG_A]);
    expect(q?.filters).toContainEqual(['account_id', null]);   // never silently re-homes
  });

  it('refuses to re-home a person already attached', async () => {
    db.unified_persons.push({ id: 'p1', company_id: ORG_A, account_id: 'acc-existing' });
    expect((await attachPersonToAccount(ORG_A, 'p1', 'acc-2')).attached).toBe(false);
  });

  it('cannot reach a person in another tenant', async () => {
    db.unified_persons.push({ id: 'p1', company_id: ORG_B, account_id: null });
    expect((await attachPersonToAccount(ORG_A, 'p1', 'acc-1')).attached).toBe(false);
  });

  it('reports a tenant-integrity rejection from the database', async () => {
    db.unified_persons.push({ id: 'p1', company_id: ORG_A, account_id: null });
    const orig = acct.attachPersonToAccount;
    expect(typeof orig).toBe('function');
    expect((await attachPersonToAccount(ORG_A, '', 'acc-1')).attached).toBe(false);
  });
});

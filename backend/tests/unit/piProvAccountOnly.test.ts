/**
 * Prospect provenance — ACCOUNT-ONLY prospects (owner decision 7, lifecycle
 * option (a), no new schema).
 *
 * An account-entity record creates a canonical prospect with
 * `unified_person_id = NULL` — no person is resolved, created or invented — and
 * its ORIGINATING contribution names the source record that carries the
 * account. The account is therefore reachable as:
 *
 *   prospect_source_contributions (role = originating, canonical_lead_id = P)
 *     .source_record_id → source_records.id
 *     source_records.account_id → prospect_accounts.id
 *
 * The real orchestrator, WS-1 resolver and PI contribution helper run here; only
 * the database, the identity/account resolvers and the LI-2 boundary are doubled
 * (the boundary double stores `account_id` exactly as `upsertSourceRecord`
 * does: from `input.accountId`, keyed by provider + entity type + record id).
 */
type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; payload: Row }>,
  nextId: 1,
};

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const rows = (): Row[] => (db.tables[table] ??= []);
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (op === 'insert') {
        db.writes.push({ table, op, payload });
        const created = { id: `${table}-${db.nextId++}`, ...payload };
        rows().push(created);
        return { data: created, error: null };
      }
      const hit = rows().filter((r) => filters.every(([c, v]) => r[c] === v));
      if (op === 'update') {
        db.writes.push({ table, op, payload });
        for (const r of hit) Object.assign(r, payload);
      }
      return { data: hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { op = 'insert'; payload = p; return api; },
      update: (p: Row) => { op = 'update'; payload = p; return api; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => ({ data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

const resolveUnifiedPerson = jest.fn(async () => ({ unifiedPersonId: 'person-1' }));
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: (...a: unknown[]) => (resolveUnifiedPerson as unknown as (...x: unknown[]) => unknown)(...a),
  normalizeEmail: (v: string) => v,
  normalizePhone: (v: string) => v,
}));

let accountOutcome: { accountId: string | null; outcome: string } = { accountId: 'acct-1', outcome: 'created' };
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ ...accountOutcome, candidateAccountIds: [], reason: 'test' })),
  attachPersonToAccount: jest.fn(async () => ({ attached: true, reason: 'test' })),
}));

// LI-2 boundary double: one source_records row per (org, provider, entity type,
// record id); account_id filled once from input.accountId, never re-pointed.
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: Row) => {
    const rows = (db.tables.source_records ??= []);
    const found = rows.find((r) => r.organization_id === input.organizationId && r.provider === input.provider
      && r.source_entity_type === input.entityType && r.source_record_id === input.sourceRecordId);
    if (found) {
      if (input.accountId && !found.account_id) found.account_id = input.accountId;
      if (input.personId && !found.person_id) found.person_id = input.personId;
      return { sourceRecordId: found.id, outcome: 'unchanged', canonicalApplied: [], canonicalWithheld: [] };
    }
    const row = {
      id: `sr-${rows.length + 1}`, organization_id: input.organizationId, provider: input.provider,
      source_entity_type: input.entityType, source_record_id: input.sourceRecordId,
      person_id: input.personId ?? null, account_id: input.accountId ?? null,
      source_category: input.sourceCategory ?? null, platform: input.platform ?? null,
    };
    rows.push(row);
    return { sourceRecordId: row.id, outcome: 'created', canonicalApplied: [], canonicalWithheld: [] };
  }),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

const contributions: Row[] = [];
jest.mock('../../services/prospectProvenance/contributionWriter', () => ({
  recordSourceContribution: jest.fn(async (input: Row) => {
    const key = (r: Row) => `${r.organizationId}|${r.canonicalLeadId}|${r.externalRef}`;
    if (contributions.some((r) => key(r) === key(input))) return { status: 'duplicate', role: null };
    let role = input.leadCreated ? 'originating' : 'contributing';
    if (role === 'originating' && contributions.some((r) => r.canonicalLeadId === input.canonicalLeadId && r.role === 'originating')) role = 'contributing';
    const row = { ...input, role, id: `c-${contributions.length + 1}` };
    contributions.push(row);
    return { status: 'inserted', id: row.id, role, roleDowngraded: false };
  }),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const accountRecord = (over: Row = {}) => ({
  raw: { org: 'Acme' },
  normalized: {
    organizationId: ORG, source: 'apollo', entityType: 'account' as const, externalId: 'org-42',
    account: { externalId: 'org-42', domain: 'acme.test', name: 'Acme' },
    observedAt: '2026-10-01T00:00:00.000Z', ...over,
  },
});
const personRecord = (over: Row = {}) => ({
  raw: { person: 'Ada' },
  normalized: {
    organizationId: ORG, source: 'apollo', entityType: 'person' as const, externalId: 'org-42',
    person: { email: 'ada@acme.test', fullName: 'Ada' },
    account: { externalId: 'org-42', domain: 'acme.test', name: 'Acme' }, ...over,
  },
});

const leads = () => db.tables.canonical_leads ?? [];
const sourceRecords = () => db.tables.source_records ?? [];

/** The read path Workstream D implements, expressed over the doubled tables. */
function accountForProspect(prospectId: string): Row | null {
  const originating = contributions.find((c) => c.canonicalLeadId === prospectId && c.role === 'originating');
  if (!originating?.sourceRecordId) return null;
  const sr = sourceRecords().find((r) => r.id === originating.sourceRecordId && r.organization_id === originating.organizationId);
  if (!sr?.account_id) return null;
  return (db.tables.prospect_accounts ?? []).find((a) => a.id === sr.account_id && a.organization_id === originating.organizationId) ?? null;
}

beforeEach(() => {
  db.tables = { prospect_accounts: [{ id: 'acct-1', organization_id: ORG, name: 'Acme Corp', domain: 'acme.test' }] };
  db.writes = []; db.nextId = 1;
  contributions.length = 0;
  accountOutcome = { accountId: 'acct-1', outcome: 'created' };
  resolveUnifiedPerson.mockClear();
  process.env.ENABLE_LEAD_INGESTION = 'true';
});
afterEach(() => { delete process.env.ENABLE_LEAD_INGESTION; });

describe('account-only prospect — no person is invented', () => {
  it('creates the prospect with unified_person_id NULL and resolves no person', async () => {
    const out = await ingestNormalizedRecord(accountRecord());
    expect(out.ok).toBe(true);
    expect(out.personId).toBeNull();
    expect(out.accountId).toBe('acct-1');
    expect(resolveUnifiedPerson).not.toHaveBeenCalled();

    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({
      id: out.prospectId, company_id: ORG, unified_person_id: null, source: 'apollo', external_lead_key: 'apollo:org-42',
    });
    // The canonical subject carries no person either.
    expect(db.tables.canonical_users).toHaveLength(1);
    expect(db.tables.canonical_users[0].unified_person_id).toBeNull();
    // Nothing anywhere wrote a unified_persons row.
    expect(db.writes.filter((w) => w.table === 'unified_persons')).toHaveLength(0);
  });

  it('records the ORIGINATING contribution with a source record that carries the account', async () => {
    const out = await ingestNormalizedRecord(accountRecord());
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      organizationId: ORG, canonicalLeadId: out.prospectId, role: 'originating', leadCreated: true,
      sourceCategory: 'pi_discovery', platform: 'apollo', externalRef: 'apollo:org-42',
      sourceRecordId: out.sourceRecordId, observedAt: '2026-10-01T00:00:00.000Z',
      evidence: expect.objectContaining({ personId: null, accountId: 'acct-1' }),
    });
    const sr = sourceRecords().find((r) => r.id === contributions[0].sourceRecordId)!;
    expect(sr).toMatchObject({ source_entity_type: 'account', account_id: 'acct-1', person_id: null, source_category: 'pi_discovery', platform: 'apollo' });
  });

  it('the read path (contribution → source_records.account_id → prospect_accounts) yields the account', async () => {
    const out = await ingestNormalizedRecord(accountRecord());
    expect(accountForProspect(out.prospectId!)).toMatchObject({ id: 'acct-1', name: 'Acme Corp' });
  });

  it('replaying the same account record converges: one prospect, one contribution', async () => {
    const a = await ingestNormalizedRecord(accountRecord());
    const b = await ingestNormalizedRecord(accountRecord());
    expect(b.prospectId).toBe(a.prospectId);
    expect(leads()).toHaveLength(1);
    expect(contributions).toHaveLength(1);
    expect(sourceRecords()).toHaveLength(1);
  });

  it('a later PERSON-bearing record with the same source key does not create a duplicate prospect', async () => {
    const a = await ingestNormalizedRecord(accountRecord());
    const p = await ingestNormalizedRecord(personRecord());
    expect(p.ok).toBe(true);
    expect(p.prospectId).toBe(a.prospectId);
    expect(leads()).toHaveLength(1);
    // Same source key ⇒ same source event under the contract ⇒ no second contribution.
    expect(contributions).toHaveLength(1);
    expect(contributions[0].role).toBe('originating');
    // CURRENT BEHAVIOUR (documented): the matched account-only prospect is not
    // re-anchored to the person by ingestion; its person evidence lives on its
    // own person-entity source record.
    expect(leads()[0].unified_person_id).toBeNull();
    expect(sourceRecords().map((r) => r.source_entity_type).sort()).toEqual(['account', 'person']);
  });

  it('a person record with a DIFFERENT source key is a different prospect (no cross-source merge)', async () => {
    await ingestNormalizedRecord(accountRecord());
    await ingestNormalizedRecord(personRecord({ externalId: 'person-9' }));
    expect(leads()).toHaveLength(2);
    expect(leads().map((l) => l.unified_person_id).sort()).toEqual(['person-1', null].sort());
  });

  it('tenant isolation: the same account key in another tenant is a separate prospect', async () => {
    await ingestNormalizedRecord(accountRecord());
    await ingestNormalizedRecord(accountRecord({ organizationId: ORG_B }));
    expect(leads()).toHaveLength(2);
    expect(contributions.map((c) => c.organizationId).sort()).toEqual([ORG, ORG_B].sort());
  });

  it('an AMBIGUOUS account still yields the prospect, but no account is attached (never guessed)', async () => {
    accountOutcome = { accountId: 'acct-1', outcome: 'ambiguous' };
    const out = await ingestNormalizedRecord(accountRecord());
    expect(out.ok).toBe(true);
    expect(out.accountId).toBeNull();
    expect(leads()[0].unified_person_id).toBeNull();
    const sr = sourceRecords().find((r) => r.id === contributions[0].sourceRecordId)!;
    expect(sr.account_id).toBeNull();
    expect(accountForProspect(out.prospectId!)).toBeNull();
  });

  it('an account that resolves on a later replay is filled onto the same source record', async () => {
    accountOutcome = { accountId: null, outcome: 'ambiguous' };
    const first = await ingestNormalizedRecord(accountRecord());
    accountOutcome = { accountId: 'acct-1', outcome: 'matched_domain' };
    await ingestNormalizedRecord(accountRecord());
    expect(accountForProspect(first.prospectId!)).toMatchObject({ id: 'acct-1' });
  });
});

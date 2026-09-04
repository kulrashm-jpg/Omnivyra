/**
 * WS-7 (BR-24) — Account Intelligence aggregation.
 *
 * The default ports run against a stub database rather than being doubled away,
 * because the tenant filters ARE the security property: a suite that mocked
 * `loadContacts` would pass even if the real query dropped `company_id`.
 *
 * WS-3's MarketPulse seam is likewise NOT mocked — it runs for real through the
 * same stub, so what is proven is that tenant market context stays tenant
 * market context all the way into the aggregate.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string } | undefined>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  writeOps: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const iss: Array<[string, unknown]> = [];
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      const matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v)
        && ins.every(([c, vs]) => vs.includes(r[c] as never))
        && iss.every(([c, v]) => (r[c] ?? null) === v));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      is: (c: string, v: unknown) => { iss.push([c, v]); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => run().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      api[op] = () => { db.writeOps.push(`${table}.${op}`); return api; };
    }
    return api;
  },
}));

import {
  ACCOUNT_INTELLIGENCE_VERSION,
  ACCOUNT_FACT_COLUMNS,
  aggregateAccountIntelligence,
  CONTACT_COLUMNS,
  defaultAccountIntelligencePorts,
  type AccountIntelligencePorts,
} from '../../services/prospectIdentity/accountIntelligence';
import {
  ACCOUNT_ATTRIBUTE_COLUMNS,
  PERSON_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACC_A = 'account-a';
const NOW = '2026-09-04T00:00:00.000Z';

const seedAccount = (org: string, id: string, over: Row = {}) => {
  (db.tables.prospect_accounts ??= []).push({
    id, organization_id: org, name: 'Acme Ltd', domain_normalized: 'acme.test',
    status: 'active', merged_into_id: null, confidence: 0.8,
    first_seen_at: '2026-08-01T00:00:00.000Z', last_verified_at: null,
    attributes_source: 'crm', attributes_updated_at: '2026-09-02T00:00:00.000Z',
    industry: 'Fintech', ...over,
  });
};
const seedPerson = (org: string, id: string, accountId: string | null, over: Row = {}) => {
  (db.tables.unified_persons ??= []).push({
    id, company_id: org, account_id: accountId, job_title: 'Head of Ops',
    department: 'Operations', seniority: 'head', authority: null, influence: null,
    buying_role: null, ...over,
  });
};
const seedProspect = (org: string, id: string, personId: string | null, over: Row = {}) => {
  (db.tables.canonical_leads ??= []).push({
    id, company_id: org, unified_person_id: personId, source: 'crm',
    created_at: '2026-09-01T00:00:00.000Z', ...over,
  });
};
const seedAssertion = (org: string, accountId: string, id: string, over: Row = {}) => {
  (db.tables.source_assertions ??= []).push({
    id, organization_id: org, account_id: accountId, attribute: 'industry',
    normalized_value: 'Fintech', provider: 'crm', confidence: 0.9,
    observed_at: '2026-09-02T00:00:00.000Z', source_record_id: 'sr-1',
    superseded_at: null, ...over,
  });
};
const seedThread = (org: string, id: string, personId: string | null, over: Row = {}) => {
  (db.tables.engagement_threads ??= []).push({
    id, organization_id: org, unified_person_id: personId,
    updated_at: '2026-09-03T00:00:00.000Z', created_at: '2026-09-01T00:00:00.000Z', ...over,
  });
};
const seedMarketPulse = (org: string) => {
  (db.tables.market_pulse_runs ??= []).push({
    id: `run-${org}`, company_id: org, status: 'completed',
    created_at: '2026-09-01T00:00:00.000Z', completed_at: '2026-09-01T01:00:00.000Z',
    market_direction: 'expanding',
  });
  (db.tables.market_pulse_findings ??= []).push({
    id: `finding-${org}`, run_id: `run-${org}`, company_id: org, category: 'hiring_talent',
    title: 'Hiring surge', regions: ['India'], impact_type: 'opportunity',
    priority_tier: 'P1', confidence_score: 72, relevance_score: 80,
    last_seen_at: '2026-09-01T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z',
  });
};

const aggregate = (over: Partial<Parameters<typeof aggregateAccountIntelligence>[0]> = {}) =>
  aggregateAccountIntelligence({ organizationId: ORG_A, accountId: ACC_A, now: NOW, ...over });

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — one Account, many Prospects', () => {
  beforeEach(() => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A, { buying_role: 'decision_maker' });
    seedPerson(ORG_A, 'p-2', ACC_A, { buying_role: 'influencer', job_title: 'CFO' });
    seedPerson(ORG_A, 'p-3', ACC_A);
    seedProspect(ORG_A, 'lead-1', 'p-1');
    seedProspect(ORG_A, 'lead-2', 'p-2');
    seedProspect(ORG_A, 'lead-3', 'p-2');       // two Prospects for ONE person
  });

  it('three people and three Prospects aggregate to ONE Account', async () => {
    const intel = await aggregate();
    expect(intel).not.toBeNull();
    expect(intel!.accountId).toBe(ACC_A);
    expect(intel!.contacts).toHaveLength(3);
    expect(intel!.prospects).toHaveLength(3);
    // The company facts exist ONCE, not once per Prospect.
    expect(intel!.facts.filter((f) => f.attribute === 'industry')).toHaveLength(1);
  });

  it('does not assume one Prospect = one Account', async () => {
    const intel = await aggregate();
    const byPerson = Object.fromEntries(intel!.contacts.map((c) => [c.personId, c.prospectIds]));
    expect(byPerson['p-1']).toEqual(['lead-1']);
    expect([...byPerson['p-2']].sort()).toEqual(['lead-2', 'lead-3']);
    expect(byPerson['p-3']).toEqual([]);        // a contact with no Prospect yet
  });

  it('carries the buying roles that exist and invents none for the rest', async () => {
    const intel = await aggregate();
    const roles = Object.fromEntries(intel!.contacts.map((c) => [c.personId, c.attributes.buying_role]));
    expect(roles).toEqual({ 'p-1': 'decision_maker', 'p-2': 'influencer', 'p-3': null });
  });

  it('the roster columns are a SUBSET of LI-1\'s person surface, never a restatement', () => {
    for (const col of CONTACT_COLUMNS) expect(PERSON_ATTRIBUTE_COLUMNS).toContain(col);
    // FR-21's three are carried; provenance columns are not company facts.
    for (const fr21 of ['authority', 'influence', 'buying_role']) {
      expect(CONTACT_COLUMNS as readonly string[]).toContain(fr21);
    }
    expect(CONTACT_COLUMNS as readonly string[]).not.toContain('attributes_source');
  });

  it('a person at ANOTHER account is not part of this roster', async () => {
    seedPerson(ORG_A, 'p-other', 'account-z');
    const intel = await aggregate();
    expect(intel!.contacts.map((c) => c.personId)).not.toContain('p-other');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — aggregation derives, and stores nothing', () => {
  it('writes nothing at all', async () => {
    seedAccount(ORG_A, ACC_A);
    await aggregate();
    expect(db.writeOps).toEqual([]);
  });

  it('repeated aggregation is idempotent and creates no second record', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A);
    seedProspect(ORG_A, 'lead-1', 'p-1');
    seedAssertion(ORG_A, ACC_A, 'a-1');

    const first = await aggregate();
    const second = await aggregate();

    expect(second).toEqual(first);
    expect(db.writeOps).toEqual([]);
    expect(db.tables.prospect_accounts).toHaveLength(1);
    expect(db.tables.source_assertions).toHaveLength(1);
  });

  it('introduces no storage model — it names only existing canonical tables', () => {
    const src = readFile('../../services/prospectIdentity/accountIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const tables = [...code.matchAll(/ownedDbTable\('([a-z_0-9]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual([
      'canonical_leads', 'engagement_threads', 'prospect_accounts',
      'source_assertions', 'unified_persons',
    ]);
  });

  it('performs no write — the module contains no write verb', () => {
    const src = readFile('../../services/prospectIdentity/accountIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(code).not.toContain(verb);
    }
  });

  it('resolves no account of its own — WS-1 keeps the identity rules', () => {
    const src = readFile('../../services/prospectIdentity/accountIntelligence.ts');
    expect(src).not.toContain('resolveOrCreateAccount');
    expect(src).not.toContain('attachPersonToAccount');
    expect(src).not.toContain('normalizeCompanyDomain');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — the six quality dimensions stay six', () => {
  it('reports completeness as counts and names, never as a score', async () => {
    seedAccount(ORG_A, ACC_A);            // only `industry` is set
    const intel = await aggregate();
    expect(intel!.completeness.total).toBe(ACCOUNT_FACT_COLUMNS.length);
    expect(intel!.completeness.known).toBe(1);
    expect(intel!.completeness.missing).toContain('employee_count');
    expect(intel!.completeness.missing).not.toContain('industry');
  });

  it('the fact surface excludes the provenance columns — they are not company facts', () => {
    expect(ACCOUNT_FACT_COLUMNS).not.toContain('attributes_source');
    expect(ACCOUNT_FACT_COLUMNS).not.toContain('attributes_updated_at');
    expect(ACCOUNT_FACT_COLUMNS.length).toBe(ACCOUNT_ATTRIBUTE_COLUMNS.length - 2);
    // Derived from LI-1's surface, so it cannot drift from it.
    for (const c of ACCOUNT_FACT_COLUMNS) expect(ACCOUNT_ATTRIBUTE_COLUMNS).toContain(c);
  });

  it('keeps account confidence and per-attribute confidence apart', async () => {
    seedAccount(ORG_A, ACC_A, { confidence: 0.8 });
    seedAssertion(ORG_A, ACC_A, 'a-1', { confidence: 0.9 });
    const intel = await aggregate();
    expect(intel!.confidence.account).toBe(0.8);
    expect(intel!.confidence.byAttribute.industry).toBe(0.9);
  });

  it('a confidence nobody stated is null, never zero', async () => {
    seedAccount(ORG_A, ACC_A, { confidence: null });
    seedAssertion(ORG_A, ACC_A, 'a-1', { confidence: null });
    const intel = await aggregate();
    expect(intel!.confidence.account).toBeNull();
    expect(intel!.confidence.byAttribute.industry).toBeNull();
    expect(intel!.confidence.byAttribute.employee_count).toBeNull();
  });

  it('reports freshness age, and asserts staleness only under a caller policy', async () => {
    seedAccount(ORG_A, ACC_A);            // attributes written 2026-09-02, now 09-04
    expect((await aggregate())!.freshness).toMatchObject({ ageDays: 2, stale: null });
    expect((await aggregate({ stalenessDays: 30 }))!.freshness.stale).toBe(false);
    expect((await aggregate({ stalenessDays: 1 }))!.freshness.stale).toBe(true);
  });

  it('an age that cannot be shown is STALE under a policy, not fresh', async () => {
    seedAccount(ORG_A, ACC_A, { attributes_updated_at: null });
    const intel = await aggregate({ stalenessDays: 30 });
    expect(intel!.freshness.ageDays).toBeNull();
    expect(intel!.freshness.stale).toBe(true);
  });

  it('preserves provenance: which provider, which source record, when observed', async () => {
    seedAccount(ORG_A, ACC_A);
    seedAssertion(ORG_A, ACC_A, 'a-1', { provider: 'crm', source_record_id: 'sr-1' });
    seedAssertion(ORG_A, ACC_A, 'a-2', {
      attribute: 'city', normalized_value: 'Pune', provider: 'csv', source_record_id: 'sr-2',
    });
    const intel = await aggregate();
    expect(intel!.provenance.providers).toEqual(['crm', 'csv']);
    expect(intel!.provenance.sourceRecordIds).toEqual(['sr-1', 'sr-2']);
    expect(intel!.facts.find((f) => f.attribute === 'industry')!.provenance).toEqual([
      { provider: 'crm', sourceRecordId: 'sr-1', observedAt: '2026-09-02T00:00:00.000Z', confidence: 0.9 },
    ]);
  });

  it('emits NO actionability — WS-8 owns that dimension', async () => {
    seedAccount(ORG_A, ACC_A);
    const intel = await aggregate();
    expect(intel).not.toHaveProperty('actionability');
    expect(intel).not.toHaveProperty('readiness');
    expect(intel).not.toHaveProperty('score');
    expect(intel).not.toHaveProperty('recommendation');
    // ...and the five it does own are separate objects, not one number.
    for (const d of ['completeness', 'confidence', 'freshness', 'provenance', 'consistency']) {
      expect(typeof (intel as unknown as Record<string, unknown>)[d]).toBe('object');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — consistency is LI-2\'s verdict, and evidence never becomes fact', () => {
  it('disagreeing sources are reported contested, and no value is picked', async () => {
    seedAccount(ORG_A, ACC_A, { industry: null });
    seedAssertion(ORG_A, ACC_A, 'a-1', { normalized_value: 'Fintech', provider: 'crm' });
    seedAssertion(ORG_A, ACC_A, 'a-2', { normalized_value: 'Insurance', provider: 'csv' });

    const intel = await aggregate();
    expect(intel!.consistency.contested).toEqual(['industry']);
    const fact = intel!.facts.find((f) => f.attribute === 'industry')!;
    expect(fact.consistency).toBe('sources_disagree');
    expect(fact.value).toBeNull();                       // nothing was chosen
    expect(fact.provenance).toHaveLength(2);             // both are retained
  });

  it('ONE Prospect\'s unsupported assertion does not become an Account-wide fact', async () => {
    // The canonical column is empty; a single source asserts a value. WS-7
    // reports the evidence but the fact stays null — LI-2 alone promotes it.
    seedAccount(ORG_A, ACC_A, { industry: null, employee_count: null });
    seedAssertion(ORG_A, ACC_A, 'a-1', { attribute: 'employee_count', normalized_value: '5000' });
    const fact = (await aggregate())!.facts.find((f) => f.attribute === 'employee_count')!;
    expect(fact.value).toBeNull();
    expect(fact.provenance).toHaveLength(1);
  });

  it('agreeing sources are uncontested and the canonical value stands', async () => {
    seedAccount(ORG_A, ACC_A, { industry: 'Fintech' });
    seedAssertion(ORG_A, ACC_A, 'a-1', { normalized_value: 'Fintech', provider: 'crm' });
    seedAssertion(ORG_A, ACC_A, 'a-2', { normalized_value: 'Fintech', provider: 'csv' });
    const fact = (await aggregate())!.facts.find((f) => f.attribute === 'industry')!;
    expect(fact.consistency).toBe('uncontested');
    expect(fact.value).toBe('Fintech');
  });

  it('a value with no live evidence is UNATTESTED, not silently trusted', async () => {
    seedAccount(ORG_A, ACC_A, { industry: 'Fintech' });      // no assertions seeded
    const intel = await aggregate();
    expect(intel!.consistency.unattested).toContain('industry');
    expect(intel!.facts.find((f) => f.attribute === 'industry')!.consistency).toBe('unattested');
  });

  it('absence stays absence — no value, no evidence, reported as unknown', async () => {
    seedAccount(ORG_A, ACC_A);
    const fact = (await aggregate())!.facts.find((f) => f.attribute === 'founded_year')!;
    expect(fact).toMatchObject({ value: null, consistency: 'unknown', provenance: [] });
  });

  it('superseded evidence is not counted as live', async () => {
    seedAccount(ORG_A, ACC_A, { industry: null });
    seedAssertion(ORG_A, ACC_A, 'a-1', { normalized_value: 'Fintech' });
    seedAssertion(ORG_A, ACC_A, 'a-old', {
      normalized_value: 'Insurance', superseded_at: '2026-08-01T00:00:00.000Z',
    });
    const intel = await aggregate();
    // Without the `superseded_at IS NULL` filter these two would look contested.
    expect(intel!.consistency.contested).toEqual([]);
    expect(intel!.facts.find((f) => f.attribute === 'industry')!.consistency).toBe('uncontested');
  });

  it('every fact is marked OBSERVED — the aggregate derives no company fact', async () => {
    seedAccount(ORG_A, ACC_A);
    const intel = await aggregate();
    expect(new Set(intel!.facts.map((f) => f.kind))).toEqual(new Set(['observed']));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — tenant MarketPulse context stays tenant-level', () => {
  it('is absent unless the caller asks for it', async () => {
    seedAccount(ORG_A, ACC_A);
    seedMarketPulse(ORG_A);
    expect((await aggregate())!.marketContext).toBeNull();
  });

  it('when asked for, it arrives labelled as the TENANT\'s market, not the company\'s', async () => {
    seedAccount(ORG_A, ACC_A);
    seedMarketPulse(ORG_A);
    const intel = await aggregate({ includeMarketContext: true });
    expect(intel!.marketContext!.subject).toBe('tenant_market');
    expect(intel!.marketContext!.context.organizationId).toBe(ORG_A);
    expect(intel!.marketContext!.context.items[0].kind).toBe('derived');
  });

  it('no company fact is ever sourced from MarketPulse', async () => {
    seedAccount(ORG_A, ACC_A, { region: null, market: null, country_code: null });
    seedMarketPulse(ORG_A);                       // its finding carries regions: ['India']
    const intel = await aggregate({ includeMarketContext: true });

    // The tenant's scan region did NOT become the company's geography.
    for (const attr of ['region', 'market', 'country_code']) {
      const fact = intel!.facts.find((f) => f.attribute === attr)!;
      expect(fact.value).toBeNull();
      expect(fact.provenance).toEqual([]);
    }
    // Stated structurally: no provenance entry anywhere names a MarketPulse source.
    const providers = intel!.facts.flatMap((f) => f.provenance.map((p) => p.provider));
    expect(providers.filter((p) => p && /market.?pulse/i.test(p))).toEqual([]);
  });

  it('a tenant with no scan gets an honest absence, not a fabricated market', async () => {
    seedAccount(ORG_A, ACC_A);
    const intel = await aggregate({ includeMarketContext: true });
    expect(intel!.marketContext!.context.available).toBe(false);
    expect(intel!.marketContext!.context.items).toEqual([]);
  });

  it('Tenant A cannot consume Tenant B\'s MarketPulse context', async () => {
    seedAccount(ORG_A, ACC_A);
    seedMarketPulse(ORG_B);                       // only B has scanned
    const intel = await aggregate({ includeMarketContext: true });
    expect(intel!.marketContext!.context.available).toBe(false);
    expect(intel!.marketContext!.context.run).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — tenant isolation', () => {
  it('Tenant A cannot read Tenant B\'s Account', async () => {
    seedAccount(ORG_B, ACC_A);                    // same id, other tenant
    expect(await aggregate()).toBeNull();
  });

  it('Tenant B\'s people never join onto Tenant A\'s Account', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'mine', ACC_A);
    seedPerson(ORG_B, 'theirs', ACC_A);           // same account_id, other tenant
    const intel = await aggregate();
    expect(intel!.contacts.map((c) => c.personId)).toEqual(['mine']);
  });

  it('a cross-tenant person id cannot drag in another tenant\'s Prospects or threads', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A);
    seedProspect(ORG_A, 'lead-mine', 'p-1');
    seedProspect(ORG_B, 'lead-theirs', 'p-1');    // same person id, other tenant
    seedThread(ORG_A, 't-mine', 'p-1');
    seedThread(ORG_B, 't-theirs', 'p-1');

    const intel = await aggregate();
    expect(intel!.prospects.map((p) => p.prospectId)).toEqual(['lead-mine']);
    expect(intel!.engagement.threadCount).toBe(1);
  });

  it('Tenant B\'s assertions never become Tenant A\'s evidence', async () => {
    seedAccount(ORG_A, ACC_A, { industry: null });
    seedAssertion(ORG_A, ACC_A, 'a-mine', { normalized_value: 'Fintech' });
    seedAssertion(ORG_B, ACC_A, 'a-theirs', { normalized_value: 'Insurance' });
    const intel = await aggregate();
    expect(intel!.provenance.sourceRecordIds).toEqual(['sr-1']);
    // A cross-tenant leak here would have shown up as a fabricated disagreement.
    expect(intel!.consistency.contested).toEqual([]);
  });

  it('EVERY read carries the tenant column — never left to the join', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A);
    seedProspect(ORG_A, 'lead-1', 'p-1');
    seedThread(ORG_A, 't-1', 'p-1');
    await aggregate();

    const expected: Array<[string, string]> = [
      ['prospect_accounts', 'organization_id'],
      ['unified_persons', 'company_id'],
      ['canonical_leads', 'company_id'],
      ['source_assertions', 'organization_id'],
      ['engagement_threads', 'organization_id'],
    ];
    for (const [table, column] of expected) {
      expect(db.filters).toContainEqual({ table, column, value: ORG_A });
    }
  });

  it('refuses to run tenant-less, and refuses ambient time', async () => {
    await expect(aggregate({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(aggregate({ accountId: '' })).rejects.toThrow(/accountId is required/);
    await expect(aggregate({ now: '' })).rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-7 — partial data and failure semantics', () => {
  it('an Account with no contacts, Prospects or engagement still aggregates', async () => {
    seedAccount(ORG_A, ACC_A, { name: null, domain_normalized: null, industry: null });
    const intel = await aggregate();
    expect(intel!.version).toBe(ACCOUNT_INTELLIGENCE_VERSION);
    expect(intel!.contacts).toEqual([]);
    expect(intel!.prospects).toEqual([]);
    expect(intel!.completeness.known).toBe(0);
    expect(intel!.engagement).toEqual({ threadCount: 0, personsEngaged: 0, lastActivityAt: null });
  });

  it('no conversation is null, never an epoch timestamp', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A);
    expect((await aggregate())!.engagement.lastActivityAt).toBeNull();
  });

  it('reports the most recent engagement across all the Account\'s people', async () => {
    seedAccount(ORG_A, ACC_A);
    seedPerson(ORG_A, 'p-1', ACC_A);
    seedPerson(ORG_A, 'p-2', ACC_A);
    seedThread(ORG_A, 't-1', 'p-1', { updated_at: '2026-09-01T00:00:00.000Z' });
    seedThread(ORG_A, 't-2', 'p-2', { updated_at: '2026-09-03T00:00:00.000Z' });
    const intel = await aggregate();
    expect(intel!.engagement).toMatchObject({
      threadCount: 2, personsEngaged: 2, lastActivityAt: '2026-09-03T00:00:00.000Z',
    });
  });

  it('a merged Account says where its intelligence now lives', async () => {
    seedAccount(ORG_A, ACC_A, { status: 'merged', merged_into_id: 'account-survivor' });
    const intel = await aggregate();
    expect(intel!.account.mergedIntoId).toBe('account-survivor');
    expect(intel!.reason).toMatch(/merged into account-survivor/);
  });

  it('an unreadable canonical table fails safely, with the table named', async () => {
    db.errors.prospect_accounts = { message: 'connection reset' };
    await expect(aggregate()).rejects.toThrow(/prospect_accounts read failed: connection reset/);

    db.errors = {};
    seedAccount(ORG_A, ACC_A);
    db.errors.source_assertions = { message: 'permission denied' };
    await expect(aggregate()).rejects.toThrow(/source_assertions read failed: permission denied/);
  });

  it('a port failure returns no partial aggregate', async () => {
    seedAccount(ORG_A, ACC_A);
    const ports: AccountIntelligencePorts = {
      ...defaultAccountIntelligencePorts,
      async loadEngagement() { throw new Error('downstream unavailable'); },
    };
    await expect(aggregateAccountIntelligence(
      { organizationId: ORG_A, accountId: ACC_A, now: NOW }, ports,
    )).rejects.toThrow('downstream unavailable');
    expect(db.writeOps).toEqual([]);
  });

  it('an unknown Account is null — distinct from an Account we know nothing about', async () => {
    expect(await aggregate({ accountId: 'nope' })).toBeNull();

    seedAccount(ORG_A, 'known', { industry: null, attributes_source: null });
    const empty = await aggregateAccountIntelligence(
      { organizationId: ORG_A, accountId: 'known', now: NOW },
    );
    expect(empty).not.toBeNull();
    expect(empty!.completeness.known).toBe(0);
  });
});

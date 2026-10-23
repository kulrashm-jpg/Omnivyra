/**
 * PI-WP-B3 — account seeding contract lock.
 *
 * The failure being guarded is the same one W4 guards, arriving through a door
 * W4 does not watch: a string that is not a company identity becoming a
 * `prospect_accounts` row, after which every prospect that produces the same
 * string resolves onto it. 'gmail.com' is the worst case — one row that
 * eventually owns every prospect in the tenant with a personal address — and
 * '1.1' (from the IP literal 192.168.1.1) is the same shape of error.
 *
 * The suite therefore asserts hardest on REFUSALS, and on the fact that a
 * refusal reaches the database as nothing at all: the real resolver is wired to
 * an in-memory `prospect_accounts` (the same harness the W4 suite uses), so
 * "refused" is proven by row count, not by a mock's call count.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { prospect_accounts: [] };
let issued: Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload?: Row }> = [];
let nextId = 1;

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op = 'select';
  let payload: Row | undefined;

  const rows = () => (db[table] ?? []).filter((r) => filters.every(([col, val]) =>
    val === null ? r[col] == null : r[col] === val));

  const settle = () => {
    issued.push({ table, op, filters: [...filters], payload });
    if (op === 'insert') {
      const row = { id: `acc-${nextId++}`, ...(payload as Row) };
      db[table].push(row);
      return { data: { id: row.id }, error: null };
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

import {
  classifyAccountDomain, classifyProvenance, assessAccountSeed, seedAccountFromEvidence,
  LEGACY_PROVENANCE_PROVIDERS, ACCOUNT_SEEDING_VERSION,
  type AccountSeedEvidence, type EvidenceProvenance,
} from '../../services/prospectIdentity/accountSeeding';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const NOW = '2026-09-06T00:00:00.000Z';

/** A provider that really observed something, at a time in the past. */
const PROV: EvidenceProvenance = {
  provider: 'crm',
  sourceRecordId: 'crm-record-0001',
  observedAt: '2026-09-05T12:00:00.000Z',
};

const evidence = (over: Partial<AccountSeedEvidence> = {}): AccountSeedEvidence => ({
  candidate: { name: 'Acme Corporation', domain: 'acme.com' },
  provenance: PROV,
  ...over,
});

const seedRow = (org: string, over: Partial<Row> = {}) => {
  const r: Row = {
    id: `seed-${nextId++}`, organization_id: org, status: 'active',
    domain_normalized: null, source: null, source_reference: null, ...over,
  };
  db.prospect_accounts.push(r);
  return r.id as string;
};

const accounts = (org?: string) =>
  db.prospect_accounts.filter((r) => !org || r.organization_id === org);

beforeEach(() => { db.prospect_accounts = []; issued = []; nextId = 1; });

/* ───────────────────────────────────────────────────────────────────────────
 * THE SIX FIXTURES
 * ────────────────────────────────────────────────────────────────────────── */

describe('fixture 1 — valid corporate domain', () => {
  it('seeds an account keyed on the registrable domain', async () => {
    const r = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    expect(r.outcome).toBe('created');
    expect(r.accountId).toBeTruthy();
    expect(r.decision.normalizedDomain).toBe('acme.com');
    expect(accounts(ORG_A)).toHaveLength(1);
    expect(accounts(ORG_A)[0].domain_normalized).toBe('acme.com');
  });

  it('reduces a URL, a subdomain and a work email to the same identity key', () => {
    for (const raw of ['acme.com', 'https://www.acme.com/pricing?x=1', 'jane@mail.acme.com', 'ACME.COM.']) {
      const v = classifyAccountDomain(raw);
      expect(v.admissible).toBe(true);
      expect(v.domain).toBe('acme.com');
    }
  });

  it('keeps a multi-part TLD whole rather than collapsing it to the public suffix', () => {
    expect(classifyAccountDomain('jane@sub.acme.co.uk').domain).toBe('acme.co.uk');
  });

  it('never lets the company name become the identity key', async () => {
    const r = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { name: 'Acme Corporation' } }), NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('no_deterministic_identity');
    expect(accounts()).toHaveLength(0);
  });
});

describe('fixture 2 — free-mail domain', () => {
  const FREE = ['jane@gmail.com', 'bob@outlook.com', 'x@yahoo.co.uk', 'y@protonmail.com',
    'z@icloud.com', 'q@hotmail.com', 'r@rediffmail.com'];

  it.each(FREE)('refuses %s as a company identity', async (address) => {
    const v = classifyAccountDomain(address);
    expect(v.admissible).toBe(false);
    expect(v.rejection).toBe('free_mail');

    const r = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { name: 'Jane at Gmail', domain: address } }), NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('free_mail');
    expect(accounts()).toHaveLength(0);
  });

  it('refuses a free-mail provider reached through a subdomain', () => {
    expect(classifyAccountDomain('jane@mail.yahoo.com').rejection).toBe('free_mail');
  });

  it('cannot be smuggled in through websiteUrl when domain is absent', async () => {
    const r = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { name: 'Acme', websiteUrl: 'https://www.gmail.com' } }), NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('free_mail');
    expect(accounts()).toHaveLength(0);
  });

  it('honours the env extension to the canonical blocklist', () => {
    const prev = process.env.PUBLIC_EMAIL_EXTRA_DOMAINS;
    process.env.PUBLIC_EMAIL_EXTRA_DOMAINS = 'freemail.test';
    try {
      expect(classifyAccountDomain('jane@freemail.test').rejection).toBe('free_mail');
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_EMAIL_EXTRA_DOMAINS;
      else process.env.PUBLIC_EMAIL_EXTRA_DOMAINS = prev;
    }
  });

  it('drops the free-mail domain but keeps a provider reference, and reports the drop', async () => {
    const r = await seedAccountFromEvidence(ORG_A, evidence({
      candidate: { source: 'crm', sourceReference: 'CRM-77', name: 'Acme', domain: 'jane@gmail.com' },
    }), NOW);
    expect(r.outcome).toBe('created');
    expect(r.decision.withheldDomain).toEqual({ raw: 'jane@gmail.com', rejection: 'free_mail' });
    // The poison never reached the row, by either column.
    expect(accounts(ORG_A)[0].domain_normalized).toBeNull();
    expect(accounts(ORG_A)[0].website_url).toBeNull();
    expect(accounts(ORG_A)[0].source_reference).toBe('CRM-77');
  });
});

describe('fixture 3 — malformed domain', () => {
  const MALFORMED: Array<[string, string]> = [
    ['acme .com', 'malformed'],
    ['acme..com', 'malformed'],
    ['-acme.com', 'malformed'],
    ['acme-.com', 'malformed'],
    ['acme', 'malformed'],
    ['acme.1', 'malformed'],
    ['co.uk', 'malformed'],
    ['com.au', 'malformed'],
    [`${'a'.repeat(64)}.com`, 'malformed'],
    ['192.168.1.1', 'ip_literal'],
    ['10.0.0.7', 'ip_literal'],
    ['localhost', 'non_routable'],
    ['printer.local', 'non_routable'],
    ['box.internal', 'non_routable'],
    ['', 'absent'],
    ['   ', 'absent'],
    ['http://', 'absent'],
  ];

  it.each(MALFORMED)('refuses %s as %s', (raw, rejection) => {
    const v = classifyAccountDomain(raw);
    expect(v.admissible).toBe(false);
    expect(v.rejection).toBe(rejection);
    expect(v.domain).toBeNull();
  });

  it('an IP literal never becomes a domain by collapsing to its last two octets', async () => {
    const r = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { name: 'Acme', domain: '192.168.1.1' } }), NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('ip_literal');
    expect(accounts()).toHaveLength(0);
    // The failure mode being locked out: normalizeCompanyDomain would have
    // produced the identity key '1.1'.
    expect(db.prospect_accounts.some((x) => x.domain_normalized === '1.1')).toBe(false);
  });

  it('refuses a malformed domain outright when nothing else identifies the account', async () => {
    const r = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { name: 'Acme', domain: 'acme..com' } }), NOW);
    expect(r.outcome).toBe('refused');
    expect(accounts()).toHaveLength(0);
  });
});

describe('fixture 4 — duplicate domain', () => {
  it('matches the existing account instead of creating a second one', async () => {
    seedRow(ORG_A, { domain_normalized: 'acme.com' });
    const r = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    expect(r.outcome).toBe('matched_domain');
    expect(accounts(ORG_A)).toHaveLength(1);
  });

  it('is idempotent across repeated seeding of the same evidence', async () => {
    const first = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    const second = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    const third = await seedAccountFromEvidence(
      ORG_A, evidence({ candidate: { domain: 'https://WWW.Acme.com/careers' } }), NOW);
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('matched_domain');
    expect(third.outcome).toBe('matched_domain');
    expect(second.accountId).toBe(first.accountId);
    expect(third.accountId).toBe(first.accountId);
    expect(accounts(ORG_A)).toHaveLength(1);
  });
});

describe('fixture 5 — cross-tenant domain', () => {
  it('gives each tenant its own account for the same domain', async () => {
    const a = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    const b = await seedAccountFromEvidence(ORG_B, evidence(), NOW);
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.accountId).not.toBe(b.accountId);
    expect(accounts(ORG_A)).toHaveLength(1);
    expect(accounts(ORG_B)).toHaveLength(1);
  });

  it('never matches another tenant\'s account on an identical domain', async () => {
    seedRow(ORG_B, { domain_normalized: 'acme.com' });
    const r = await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    expect(r.outcome).toBe('created');
    expect(r.accountId).not.toBe(accounts(ORG_B)[0].id);
  });

  it('scopes every prospect_accounts read to the tenant', async () => {
    await seedAccountFromEvidence(ORG_A, evidence(), NOW);
    const reads = issued.filter((q) => q.table === 'prospect_accounts' && q.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      expect(q.filters).toContainEqual(['organization_id', ORG_A]);
    }
    for (const w of issued.filter((q) => q.op === 'insert')) {
      expect(w.payload?.organization_id).toBe(ORG_A);
    }
  });

  it('refuses without a tenant, before any provenance or domain work', () => {
    const d = assessAccountSeed('', evidence(), NOW);
    expect(d.admissible).toBe(false);
    expect(d.refusal).toBe('no_tenant');
  });
});

describe('fixture 6 — ambiguous identity', () => {
  it('creates nothing when the two keys point at different accounts', async () => {
    seedRow(ORG_A, { source: 'crm', source_reference: 'CRM-77' });
    seedRow(ORG_A, { domain_normalized: 'acme.com' });
    const before = accounts(ORG_A).length;

    const r = await seedAccountFromEvidence(ORG_A, evidence({
      candidate: { source: 'crm', sourceReference: 'CRM-77', domain: 'acme.com' },
    }), NOW);

    expect(r.outcome).toBe('ambiguous');
    expect(r.accountId).toBeNull();
    expect(accounts(ORG_A)).toHaveLength(before);
  });

  it('surfaces the candidates so a human can arbitrate', async () => {
    seedRow(ORG_A, { source: 'crm', source_reference: 'CRM-77' });
    seedRow(ORG_A, { domain_normalized: 'acme.com' });
    const r = await seedAccountFromEvidence(ORG_A, evidence({
      candidate: { source: 'crm', sourceReference: 'CRM-77', domain: 'acme.com' },
    }), NOW);
    expect(r.resolution?.candidateAccountIds).toHaveLength(2);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * LEGACY DATA IS NOT ACQUISITION EVIDENCE
 * ────────────────────────────────────────────────────────────────────────── */

describe('legacy data is not evidence that a domain was observed', () => {
  it('refuses a perfectly good corporate domain with no provenance at all', async () => {
    const r = await seedAccountFromEvidence(
      ORG_A, { candidate: { domain: 'acme.com' }, provenance: null }, NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('missing_provenance');
    expect(accounts()).toHaveLength(0);
  });

  it.each([...LEGACY_PROVENANCE_PROVIDERS])('refuses provenance stamped %s', async (provider) => {
    const r = await seedAccountFromEvidence(ORG_A, evidence({
      provenance: { ...PROV, provider },
    }), NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('legacy_provenance');
    expect(accounts()).toHaveLength(0);
  });

  it('refuses a domain lifted out of a legacy unified_persons email, however well-formed', async () => {
    const r = await seedAccountFromEvidence(ORG_A, {
      candidate: { domain: 'jane.doe@acme.com', name: 'Acme' },
      provenance: PROV,                 // a real provider is present...
      derivedFromCanonicalRow: true,    // ...but the value came from a row we already had
    }, NOW);
    expect(r.outcome).toBe('refused');
    expect(r.decision.refusal).toBe('derived_from_canonical_row');
    expect(accounts()).toHaveLength(0);
  });

  it('requires a retained source record, not just a provider name', () => {
    expect(classifyProvenance({ provider: 'crm', sourceRecordId: '  ', observedAt: PROV.observedAt }, false, NOW))
      .toEqual({ evidenceBacked: false, rejection: 'missing_provenance' });
  });

  it('refuses an unparseable or fabricated observation time', () => {
    expect(classifyProvenance({ ...PROV, observedAt: 'sometime last year' }, false, NOW).rejection)
      .toBe('unusable_observed_at');
    expect(classifyProvenance({ ...PROV, observedAt: '2099-01-01T00:00:00.000Z' }, false, NOW).rejection)
      .toBe('unusable_observed_at');
  });

  it('tolerates small clock skew between the provider and this process', () => {
    const skewed = new Date(Date.parse(NOW) + 30_000).toISOString();
    expect(classifyProvenance({ ...PROV, observedAt: skewed }, false, NOW).evidenceBacked).toBe(true);
  });

  it('matches the provider marker case-insensitively', () => {
    expect(classifyProvenance({ ...PROV, provider: ' W3_Backfill ' }, false, NOW).rejection)
      .toBe('legacy_provenance');
  });

  it('checks provenance BEFORE the domain, so a legacy row is never reported as a domain problem', () => {
    const d = assessAccountSeed(ORG_A, {
      candidate: { domain: 'jane@gmail.com' },
      provenance: { ...PROV, provider: 'w3_backfill' },
    }, NOW);
    expect(d.refusal).toBe('legacy_provenance');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE — one resolver, one write path
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gate owns no write path of its own', () => {
  it('delegates to W4 rather than resolving or inserting itself', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('node:fs')
      .readFileSync(require('node:path').join(__dirname, '../../services/prospectIdentity/accountSeeding.ts'), 'utf8');
    expect(src).toContain('resolveOrCreateAccount');
    expect(src).not.toMatch(/ownedDbTable/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/from\s+['"]\.\.\/\.\.\/db\//);
  });

  it('reuses the canonical free-mail blocklist rather than declaring a second one', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('node:fs')
      .readFileSync(require('node:path').join(__dirname, '../../services/prospectIdentity/accountSeeding.ts'), 'utf8');
    expect(src).toContain("from '../../../lib/auth/publicEmailDomains'");
    // Prose may name gmail; CODE may not. A provider domain appearing outside a
    // comment would be the start of the second blocklist.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('isPublicEmailDomain(');
    expect(code).not.toMatch(/gmail|outlook|yahoo|hotmail|protonmail|icloud/i);
  });

  it('writes nothing on any refusal, across every refusal reason', async () => {
    const refusals: AccountSeedEvidence[] = [
      { candidate: { name: 'Acme' }, provenance: PROV },
      { candidate: { domain: 'jane@gmail.com' }, provenance: PROV },
      { candidate: { domain: 'acme..com' }, provenance: PROV },
      { candidate: { domain: '192.168.1.1' }, provenance: PROV },
      { candidate: { domain: 'acme.com' }, provenance: null },
      { candidate: { domain: 'acme.com' }, provenance: { ...PROV, provider: 'w3_backfill' } },
      { candidate: { domain: 'acme.com' }, provenance: PROV, derivedFromCanonicalRow: true },
    ];
    for (const e of refusals) {
      const r = await seedAccountFromEvidence(ORG_A, e, NOW);
      expect(r.outcome).toBe('refused');
    }
    expect(issued.filter((q) => q.op === 'insert')).toHaveLength(0);
    expect(accounts()).toHaveLength(0);
  });

  it('assessAccountSeed is pure — it issues no query', () => {
    assessAccountSeed(ORG_A, evidence(), NOW);
    assessAccountSeed(ORG_A, evidence({ candidate: { domain: 'jane@gmail.com' } }), NOW);
    expect(issued).toHaveLength(0);
  });

  it('stamps a version so a decision can be traced to the rules that made it', () => {
    expect(ACCOUNT_SEEDING_VERSION).toMatch(/^pi\.b3\./);
  });

  it('passes the sanitized candidate, never the caller\'s raw one', async () => {
    const raw = { source: 'crm', sourceReference: 'CRM-9', domain: 'HTTPS://WWW.Acme.com/x', name: 'Acme' };
    const seen: unknown[] = [];
    const r = await seedAccountFromEvidence(ORG_A, evidence({ candidate: raw }), NOW,
      (async (org: string, cand: unknown) => {
        seen.push(cand);
        return { organizationId: org, accountId: 'acc-x', outcome: 'created',
          candidateAccountIds: ['acc-x'], normalizedDomain: 'acme.com',
          sourceKey: { source: 'crm', sourceReference: 'CRM-9' }, reason: 'stub' };
      }) as never);
    expect(r.outcome).toBe('created');
    expect((seen[0] as { domain: string }).domain).toBe('acme.com');
    // The caller's object is not mutated.
    expect(raw.domain).toBe('HTTPS://WWW.Acme.com/x');
  });
});

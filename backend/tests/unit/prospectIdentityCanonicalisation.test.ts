/**
 * W3 — canonicalisation contract lock.
 *
 * The load-bearing property is restraint: this module must transcribe evidence
 * that already exists and must NEVER invent attribution. A backfill that
 * guesses an owner for an identifier is how two humans quietly become one, and
 * unlike a missed match that is not recoverable once claims accumulate.
 *
 * So these tests assert as hard on what is NOT produced as on what is.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { unified_persons: [], contacts: [], identity_claims: [] };
let inserted: Row[] = [];
let failNext: { code: string; message: string } | null = null;
let issuedFilters: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const run = () => {
    issuedFilters.push({ table, filters: [...filters] });
    const rows = (db[table] ?? []).filter((r) => filters.every(([col, val]) => r[col] === val));
    return { data: rows, error: null };
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
    insert: (row: Row) => {
      if (failNext) { const e = failNext; failNext = null; return Promise.resolve({ data: null, error: e }); }
      inserted.push(row);
      return Promise.resolve({ data: null, error: null });
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return builder;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const canon = require('../../services/prospectIdentity/canonicalisation');
const { deriveFromPerson, deriveFromContact, analyseCanonicalisation, persistClaims,
  CANONICALISATION_SOURCE, CANONICALISATION_VERSION } = canon;

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const P1 = 'p1111111-0000-0000-0000-000000000001';

beforeEach(() => {
  db.unified_persons = []; db.contacts = []; db.identity_claims = [];
  inserted = []; failNext = null; issuedFilters = [];
});

describe('person derivation', () => {
  it('derives an email and a phone claim, normalized', () => {
    const out = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: '  Jane@ACME.com ', primary_phone: '+1 (415) 555-0100' });
    expect(out).toHaveLength(2);
    expect(out.find((c: any) => c.claimType === 'email').normalizedValue).toBe('jane@acme.com');
    expect(out.find((c: any) => c.claimType === 'phone').normalizedValue).toBe('+14155550100');
  });

  it('keeps the RAW value alongside the normalized one, so the transcription is auditable', () => {
    const out = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: '  Jane@ACME.com ', primary_phone: null });
    expect(out[0].rawValue).toBe('  Jane@ACME.com ');
    expect(out[0].normalizedValue).toBe('jane@acme.com');
  });

  it('emits platform NULL for email/phone so the DB platform rule is always satisfied', () => {
    const out = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: '4155550100' });
    expect(out.every((c: any) => c.platform === null)).toBe(true);
  });

  it('derives nothing from a person with no identifiers — silence, not a placeholder claim', () => {
    expect(deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: null, primary_phone: null })).toEqual([]);
  });

  it('always attributes a person claim to that person', () => {
    const out = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null });
    expect(out[0].personId).toBe(P1);
    expect(out[0].organizationId).toBe(ORG_A);
  });
});

describe('contact derivation — the restraint that matters', () => {
  const base = { id: 'c1', organization_id: ORG_A, platform: 'LinkedIn', platform_user_id: '  JaneDoe ' };

  it('records the identifier but does NOT invent a person', () => {
    const out = deriveFromContact({ ...base, unified_person_id: null });
    expect(out).toHaveLength(1);
    expect(out[0].personId).toBeNull();          // ← the whole point
    expect(out[0].claimType).toBe('external_id');
    expect(out[0].platform).toBe('linkedin');
    expect(out[0].normalizedValue).toBe('janedoe');
  });

  it('honours a link that already exists, but never creates one', () => {
    expect(deriveFromContact({ ...base, unified_person_id: P1 })[0].personId).toBe(P1);
  });

  it('derives nothing when the platform identifier is blank', () => {
    expect(deriveFromContact({ ...base, platform_user_id: '   ', unified_person_id: null })).toEqual([]);
    expect(deriveFromContact({ ...base, platform: '  ', unified_person_id: null })).toEqual([]);
  });

  it('does not collapse distinct handles', () => {
    const a = deriveFromContact({ ...base, platform_user_id: 'jane.doe', unified_person_id: null })[0].normalizedValue;
    const b = deriveFromContact({ ...base, platform_user_id: 'jane-doe', unified_person_id: null })[0].normalizedValue;
    expect(a).not.toBe(b);
  });
});

describe('shadow analysis is tenant-scoped and read-only', () => {
  it('writes nothing while analysing', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null });
    db.contacts.push({ id: 'c1', organization_id: ORG_A, platform: 'linkedin', platform_user_id: 'x', unified_person_id: null });
    await analyseCanonicalisation();
    expect(inserted).toHaveLength(0);
  });

  it('scopes both scans to the tenant when one is given', async () => {
    await analyseCanonicalisation(ORG_A);
    const tables = issuedFilters.map(q => q.table);
    expect(tables).toContain('unified_persons');
    expect(tables).toContain('contacts');
    expect(issuedFilters.find(q => q.table === 'unified_persons')?.filters).toContainEqual(['company_id', ORG_A]);
    expect(issuedFilters.find(q => q.table === 'contacts')?.filters).toContainEqual(['organization_id', ORG_A]);
  });

  it('counts a person with no evidence as unusable rather than dropping it silently', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_A, primary_email: null, primary_phone: null });
    const a = await analyseCanonicalisation();
    expect(a.persons.scanned).toBe(1);
    expect(a.persons.derived).toBe(0);
    expect(a.persons.unusable).toBe(1);
  });

  it('never mixes tenants — each claim carries its own record\'s tenant', async () => {
    db.unified_persons.push(
      { id: P1, company_id: ORG_A, primary_email: 'same@x.com', primary_phone: null },
      { id: 'p2', company_id: ORG_B, primary_email: 'same@x.com', primary_phone: null },
    );
    const a = await analyseCanonicalisation();
    const orgs = a.claims.map((c: any) => c.organizationId).sort();
    expect(orgs).toEqual([ORG_A, ORG_B].sort());
    // identical identifier, two tenants, two separate claims — never merged
    expect(a.claims).toHaveLength(2);
  });
});

describe('persistence provenance', () => {
  it('stamps source, source_reference and derivation evidence on every claim', async () => {
    const claims = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null });
    await persistClaims(claims, '2026-08-12T00:00:00.000Z');
    expect(inserted).toHaveLength(1);
    const row: any = inserted[0];
    expect(row.source).toBe(CANONICALISATION_SOURCE);
    expect(row.source_reference).toBe(`unified_persons:${P1}`);
    expect(row.evidence.canonicalisationVersion).toBe(CANONICALISATION_VERSION);
    expect(row.evidence.sourceTable).toBe('unified_persons');
    expect(row.evidence.sourceColumn).toBe('primary_email');
    expect(row.evidence.derivation).toBe('direct_column_transcription');
    expect(row.observed_at).toBe('2026-08-12T00:00:00.000Z');
  });

  it('marks transcribed claims unverified — copied is not confirmed', async () => {
    await persistClaims(deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null }));
    expect((inserted[0] as any).verification_state).toBe('unverified');
  });
});

describe('idempotency', () => {
  it('treats a unique violation as already-present, not as a failure', async () => {
    const claims = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null });
    failNext = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const r = await persistClaims(claims);
    expect(r.attempted).toBe(1);
    expect(r.inserted).toBe(0);
    expect(r.alreadyPresent).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('reports a genuine error rather than swallowing it', async () => {
    const claims = deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null });
    failNext = { code: '23503', message: 'foreign key violation' };
    const r = await persistClaims(claims);
    expect(r.failed).toBe(1);
    expect(r.errors[0].code).toBe('23503');
    expect(r.errors[0].sourceTable).toBe('unified_persons');
  });

  it('relies on the DB constraint, never on a prior SELECT', async () => {
    await persistClaims(deriveFromPerson({ id: P1, company_id: ORG_A, primary_email: 'a@b.com', primary_phone: null }));
    // A read against identity_claims before inserting would be a lost-update bug
    // under concurrency; assert none was issued.
    expect(issuedFilters.filter(q => q.table === 'identity_claims')).toHaveLength(0);
  });
});
export {};  // module marker: without it this file is a global script and its top-level names collide with the sibling prospectIdentity suites

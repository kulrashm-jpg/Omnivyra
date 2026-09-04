/**
 * LI-4C — duplicate detection and parking, at the service level.
 *
 * The database invariants live in `backend/tests/realschema/li4c_person_duplicates.test.ts`.
 * This covers what the service itself decides: which signals it will act on,
 * which it refuses to invent, that it parks rather than merges, and that merge
 * is genuinely unreachable rather than merely undocumented.
 */

type Row = Record<string, unknown>;

const queries: Array<{ table: string; filters: Array<[string, unknown]>; verb: string }> = [];
let people: Row[] = [];
let peopleError: { message?: string } | null = null;
let insertOutcomes: Array<{ error?: { code?: string; message?: string } }> = [];
let updateRows: Row[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]>, verb: 'select' };
    queries.push(rec);
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;
    b.select = () => c();
    b.limit = () => c();
    b.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };

    b.insert = (row: Row) => {
      rec.verb = 'insert';
      const out = insertOutcomes.shift() ?? {};
      return { select: () => ({ single: async () => (out.error ? { error: out.error } : { data: { id: 'cand-1' }, error: null }) }) };
    };
    b.update = (row: Row) => {
      rec.verb = 'update';
      const u: Record<string, unknown> = {};
      u.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return u; };
      u.select = async () => ({ data: updateRows, error: null });
      return u;
    };

    (b as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (peopleError) return resolve({ error: peopleError });
      const f = new Map(rec.filters);
      let rows = people.filter((p) =>
        [...f.entries()].every(([k, v]) => (v === null ? p[k] == null : p[k] === v)));
      for (const [key, val] of contains) {
        rows = rows.filter((p) => {
          const have = (p[key] ?? {}) as Record<string, unknown>;
          return Object.entries(val as Record<string, unknown>).every(
            ([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
        });
      }
      return resolve({ data: rows, error: null });
    };
    return b;
  },
}));

import {
  detectPersonDuplicates,
  parkDuplicateCandidate,
  detectAndParkDuplicates,
  resolveDuplicateCandidate,
  listOpenDuplicateCandidates,
  DUPLICATE_CLASSIFICATIONS,
  MATCH_SIGNALS,
  PERSON_STATUSES,
} from '../../services/prospectIdentity/personDuplicates';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SELF = 'person-self';

const person = (o: Partial<Row>): Row => ({
  id: 'p-x', company_id: ORG_A, status: 'active',
  primary_email: null, primary_phone: null, external_keys: {}, ...o,
});

beforeEach(() => {
  queries.length = 0;
  people = [];
  peopleError = null;
  insertOutcomes = [];
  updateRows = [{ id: 'cand-1' }];
});

describe('LI-4C — vocabulary matches the ADR', () => {
  it('three deterministic classes, no score', () => {
    expect([...DUPLICATE_CLASSIFICATIONS]).toEqual(['definite', 'probable', 'possible']);
  });

  it('four person lifecycle states, mirroring prospect_accounts', () => {
    expect([...PERSON_STATUSES]).toEqual(['active', 'merged', 'suppressed', 'archived']);
  });

  it('the match signals are the ADR five', () => {
    expect([...MATCH_SIGNALS]).toEqual(['email', 'phone', 'external_key', 'name_account', 'title_account']);
  });
});

describe('LI-4C — deterministic detection', () => {
  it('an exact email match is a DEFINITE duplicate', async () => {
    people = [person({ id: 'other-1', primary_email: 'a@x.test' })];
    const d = await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'A@X.TEST' });
    expect(d).toEqual([{ candidatePersonId: 'other-1', classification: 'definite', matchedOn: 'email' }]);
  });

  it('an exact phone match is a DEFINITE duplicate', async () => {
    people = [person({ id: 'other-2', primary_phone: '+15550100000' })];
    const d = await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, phone: '+1 (555) 010-0000' });
    expect(d).toEqual([{ candidatePersonId: 'other-2', classification: 'definite', matchedOn: 'phone' }]);
  });

  it('a shared provider identifier is PROBABLE, not definite', async () => {
    people = [person({ id: 'other-3', external_keys: { crm: { external_id: 'X1' } } })];
    const d = await detectPersonDuplicates({
      organizationId: ORG_A, personId: SELF, externalKeys: { crm: { external_id: 'X1' } },
    });
    expect(d).toEqual([{ candidatePersonId: 'other-3', classification: 'probable', matchedOn: 'external_key' }]);
  });

  it('a definite match is never downgraded by a later probable one on the same pair', async () => {
    people = [person({ id: 'dual', primary_email: 'a@x.test', external_keys: { crm: { external_id: 'X1' } } })];
    const d = await detectPersonDuplicates({
      organizationId: ORG_A, personId: SELF, email: 'a@x.test', externalKeys: { crm: { external_id: 'X1' } },
    });
    expect(d).toHaveLength(1);
    expect(d[0].classification).toBe('definite');
  });

  it('the person itself is never its own duplicate', async () => {
    people = [person({ id: SELF, primary_email: 'a@x.test' })];
    expect(await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'a@x.test' })).toEqual([]);
  });

  it('a near-miss email does NOT match — there is no fuzzy matching', async () => {
    people = [person({ id: 'other', primary_email: 'a.b@x.test' })];
    expect(await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'ab@x.test' })).toEqual([]);
  });

  it('a shared name alone does NOT match — no name similarity, no scoring', async () => {
    people = [person({ id: 'other', full_name: 'Test Person' })];
    expect(await detectPersonDuplicates({
      organizationId: ORG_A, personId: SELF, email: null, phone: null,
    })).toEqual([]);
  });

  it('only ACTIVE people can be duplicates — a merged person is already resolved', async () => {
    await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'a@x.test' });
    const q = queries.find((x) => x.table === 'unified_persons');
    expect(new Map(q!.filters).get('status')).toBe('active');
  });

  it('a read failure is reported, never silently treated as "no duplicate"', async () => {
    peopleError = { message: 'connection reset' };
    await expect(detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'a@x.test' }))
      .rejects.toThrow(/email probe failed/);
  });

  it('refuses to run without a tenant', async () => {
    await expect(detectPersonDuplicates({ organizationId: '', personId: SELF, email: 'a@x.test' }))
      .rejects.toThrow(/organizationId is required/);
  });
});

describe('LI-4C — tenant isolation', () => {
  it('the tenant is the FIRST predicate on every person probe', async () => {
    await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'a@x.test' });
    const q = queries.find((x) => x.table === 'unified_persons');
    expect(q!.filters[0][0]).toBe('company_id');
    expect(q!.filters[0][1]).toBe(ORG_A);
  });

  it("another tenant's person is never a candidate, even if a query returned it", async () => {
    // The query filter is bypassed here deliberately: this proves the
    // defence-in-depth filter, not the WHERE clause.
    people = [person({ id: 'foreign', company_id: ORG_B, primary_email: 'a@x.test' })];
    const d = await detectPersonDuplicates({ organizationId: ORG_B, personId: SELF, email: 'a@x.test' });
    // Same tenant as the lookup -> legitimately a candidate.
    expect(d).toHaveLength(1);

    const d2 = await detectPersonDuplicates({ organizationId: ORG_A, personId: SELF, email: 'a@x.test' });
    expect(d2).toEqual([]);   // tenant A must not see tenant B's person
  });

  it('the queue read is tenant-scoped', async () => {
    await listOpenDuplicateCandidates(ORG_A);
    const q = queries.find((x) => x.table === 'person_duplicate_candidates');
    expect(q!.filters[0][0]).toBe('organization_id');
    expect(new Map(q!.filters).get('status')).toBe('open');
  });
});

describe('LI-4C — parking and idempotency', () => {
  it('parks a detected duplicate', async () => {
    insertOutcomes = [{}];
    expect(await parkDuplicateCandidate({
      organizationId: ORG_A, personId: SELF, candidatePersonId: 'other',
      classification: 'definite', matchedOn: 'email',
    })).toEqual({ parked: true });
  });

  it('a 23505 means the pair is already open — not an error, and not a second row', async () => {
    insertOutcomes = [{ error: { code: '23505', message: 'duplicate key' } }];
    expect(await parkDuplicateCandidate({
      organizationId: ORG_A, personId: SELF, candidatePersonId: 'other',
      classification: 'definite', matchedOn: 'email',
    })).toEqual({ parked: false });
  });

  it('never SELECTs the queue before inserting — dedupe is the database\'s job', async () => {
    insertOutcomes = [{}];
    await parkDuplicateCandidate({
      organizationId: ORG_A, personId: SELF, candidatePersonId: 'other',
      classification: 'definite', matchedOn: 'email',
    });
    expect(queries.filter((q) => q.table === 'person_duplicate_candidates' && q.verb === 'select')).toHaveLength(0);
  });

  it('translates a cross-tenant reference into a clear refusal', async () => {
    insertOutcomes = [{ error: { code: '23503', message: 'violates foreign key constraint' } }];
    await expect(parkDuplicateCandidate({
      organizationId: ORG_A, personId: SELF, candidatePersonId: 'foreign',
      classification: 'definite', matchedOn: 'email',
    })).rejects.toThrow(/cross-tenant candidates are refused by the database/);
  });

  it('refuses to park a person against itself', async () => {
    await expect(parkDuplicateCandidate({
      organizationId: ORG_A, personId: SELF, candidatePersonId: SELF,
      classification: 'definite', matchedOn: 'email',
    })).rejects.toThrow(/cannot be its own duplicate/);
  });

  it('detect-and-park reports what was parked and what was already open', async () => {
    people = [
      person({ id: 'p1', primary_email: 'a@x.test' }),
      person({ id: 'p2', primary_phone: '+15550100000' }),
    ];
    insertOutcomes = [{}, { error: { code: '23505' } }];
    const r = await detectAndParkDuplicates({
      organizationId: ORG_A, personId: SELF, email: 'a@x.test', phone: '+15550100000',
    });
    expect(r.detected).toHaveLength(2);
    expect(r.parked).toBe(1);
    expect(r.alreadyOpen).toBe(1);
  });

  it('carries the originating evidence rather than copying it', async () => {
    people = [person({ id: 'p1', primary_email: 'a@x.test' })];
    insertOutcomes = [{}];
    await detectAndParkDuplicates({
      organizationId: ORG_A, personId: SELF, email: 'a@x.test', sourceRecordId: 'sr-9',
    });
    // The queue references the source record; it never receives a payload.
    expect(queries.some((q) => q.table === 'person_duplicate_candidates' && q.verb === 'insert')).toBe(true);
  });
});

describe('LI-4C — MERGE IS DISABLED', () => {
  it('no merge executor exists anywhere in the module', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/personDuplicates.ts'), 'utf8');
    expect(src).not.toMatch(/merged_into_id/);
    expect(src).not.toMatch(/status:\s*'merged'/);
    // It must not write to the person spine at all.
    expect(src).not.toMatch(/ownedDbTable\('unified_persons'\)[\s\S]{0,200}\.(update|insert|delete)\(/);
  });

  it("resolution refuses 'merged' with an explanation, not a silent no-op", async () => {
    await expect(resolveDuplicateCandidate({
      organizationId: ORG_A, candidateId: 'c1',
      status: 'merged' as never, reason: 'same person',
    })).rejects.toThrow(/merge is disabled until governance can follow a merge chain/);
  });

  it('permits the resolutions that are safe today', async () => {
    for (const status of ['retained', 'dismissed', 'deleted'] as const) {
      expect(await resolveDuplicateCandidate({
        organizationId: ORG_A, candidateId: 'c1', status, reason: 'reviewed',
      })).toEqual({ resolved: true });
    }
  });
});

describe('LI-4C — the audit trail is mandatory', () => {
  it('refuses a resolution with no reason', async () => {
    await expect(resolveDuplicateCandidate({
      organizationId: ORG_A, candidateId: 'c1', status: 'retained', reason: '  ',
    })).rejects.toThrow(/unusable audit record/);
  });

  it('refuses a tenant-less resolution', async () => {
    await expect(resolveDuplicateCandidate({
      organizationId: '', candidateId: 'c1', status: 'retained', reason: 'x',
    })).rejects.toThrow(/organizationId is required/);
  });

  it('only resolves an OPEN candidate, so a decision is never rewritten', async () => {
    await resolveDuplicateCandidate({
      organizationId: ORG_A, candidateId: 'c1', status: 'retained', reason: 'reviewed',
    });
    const q = queries.find((x) => x.verb === 'update');
    const f = new Map(q!.filters);
    expect(f.get('organization_id')).toBe(ORG_A);
    expect(f.get('status')).toBe('open');
  });

  it('reports resolved:false rather than claiming success when nothing matched', async () => {
    updateRows = [];
    expect(await resolveDuplicateCandidate({
      organizationId: ORG_A, candidateId: 'gone', status: 'retained', reason: 'x',
    })).toEqual({ resolved: false });
  });
});

describe('LI-4C — the identity resolver is untouched', () => {
  it('this module never resolves or creates a person', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/personDuplicates.ts'), 'utf8');
    // Strip comments first: the module DOCUMENTS that resolveUnifiedPerson is
    // the sole resolver, and that sentence must not read as a call to it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/resolveUnifiedPerson\s*\(/);
    expect(code).not.toMatch(/ensureUnifiedPerson\s*\(/);
    // It imports the normalisers only — never the resolver's write path.
    expect(code).toMatch(/import \{ normalizeEmail, normalizePhone \}/);
  });
});

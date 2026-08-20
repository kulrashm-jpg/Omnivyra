/**
 * W1 — shadow resolver contract lock.
 *
 * Two properties are load-bearing and are the reason this file exists:
 *
 *  1. It NEVER writes. The resolver's whole justification is that an incorrect
 *     automatic merge destroys the evidence that two humans were ever distinct.
 *     The fake below throws on insert/update/upsert/delete, so a future change
 *     that starts writing fails here rather than in production.
 *
 *  2. Tenant scope is not optional. Every query must carry the tenant filter;
 *     the service-role client bypasses RLS, so that filter IS the boundary.
 *     The fake records filters and the tests assert on them directly, rather
 *     than only checking that results happen to look right.
 */

interface Row { [k: string]: unknown }

const db: Record<string, Row[]> = { identity_claims: [], unified_persons: [] };
let issuedFilters: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];

function makeBuilder(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  const forbid = (op: string) => () => { throw new Error(`shadow resolver must never ${op} (table=${table})`); };

  // Faithful to supabase-js: every filter returns the builder, and the builder
  // itself is thenable, so filters may be chained AFTER .limit() and the query
  // only executes on await. A fake that resolved early would let a real
  // ordering bug pass here.
  const run = () => {
    issuedFilters.push({ table, filters: [...filters] });
    const rows = (db[table] ?? []).filter((r) => filters.every(([op, col, val]) => {
      if (op === 'eq') return r[col] === val;
      if (op === 'is') return val === null ? r[col] == null : r[col] === val;
      if (op === 'not') return val === null ? r[col] != null : r[col] !== val;
      return true;
    }));
    return { data: rows, error: null };
  };

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push(['eq', col, val]); return builder; },
    is: (col: string, val: unknown) => { filters.push(['is', col, val]); return builder; },
    not: (col: string, _op: string, val: unknown) => { filters.push(['not', col, val]); return builder; },
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
    insert: forbid('insert'), update: forbid('update'),
    upsert: forbid('upsert'), delete: forbid('delete'),
  };
  return builder;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveIdentityShadow, evaluateCandidate } = require('../../services/prospectIdentity/shadowResolver');

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const P1 = 'p1111111-0000-0000-0000-000000000001';
const P2 = 'p2222222-0000-0000-0000-000000000002';

beforeEach(() => {
  db.identity_claims = [];
  db.unified_persons = [];
  issuedFilters = [];
});

describe('read-only guarantee', () => {
  it('performs no write of any kind while resolving', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_A, primary_email: 'jane@acme.com' });
    await expect(resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'Jane@Acme.com' }]))
      .resolves.toBeTruthy();
    // The fake throws on any mutation; reaching here proves none was attempted.
  });
});

describe('tenant scope', () => {
  it('filters every claims query by organization_id', async () => {
    await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }]);
    const claimQueries = issuedFilters.filter(q => q.table === 'identity_claims');
    expect(claimQueries.length).toBeGreaterThan(0);
    for (const q of claimQueries) {
      expect(q.filters).toContainEqual(['eq', 'organization_id', ORG_A]);
    }
  });

  it('filters every spine query by company_id', async () => {
    await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }]);
    const spineQueries = issuedFilters.filter(q => q.table === 'unified_persons');
    for (const q of spineQueries) {
      expect(q.filters).toContainEqual(['eq', 'company_id', ORG_A]);
    }
  });

  it('does not resolve another tenant\'s person even on an identical identifier', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_B, primary_email: 'jane@acme.com' });
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }]);
    expect(r.outcome).toBe('unresolved');
    expect(r.personId).toBeNull();
  });

  it('resolves the SAME identifier to different people in different tenants', async () => {
    db.unified_persons.push(
      { id: P1, company_id: ORG_A, primary_email: 'jane@acme.com' },
      { id: P2, company_id: ORG_B, primary_email: 'jane@acme.com' },
    );
    expect((await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }])).personId).toBe(P1);
    expect((await resolveIdentityShadow(ORG_B, [{ claimType: 'email', value: 'jane@acme.com' }])).personId).toBe(P2);
  });
});

describe('resolution outcomes', () => {
  it('matches an active identity_claim', async () => {
    db.identity_claims.push({
      organization_id: ORG_A, claim_type: 'email', platform: null,
      normalized_value: 'jane@acme.com', person_id: P1, revoked_at: null,
    });
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: '  JANE@acme.com ' }]);
    expect(r.outcome).toBe('matched_claim');
    expect(r.personId).toBe(P1);
  });

  it('ignores a REVOKED claim — a withdrawn belief must not resurrect', async () => {
    db.identity_claims.push({
      organization_id: ORG_A, claim_type: 'email', platform: null,
      normalized_value: 'jane@acme.com', person_id: P1, revoked_at: '2026-01-01T00:00:00Z',
    });
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }]);
    expect(r.outcome).toBe('unresolved');
  });

  it('falls back to the spine when no claim exists', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_A, primary_email: 'jane@acme.com' });
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'jane@acme.com' }]);
    expect(r.outcome).toBe('matched_spine');
    expect(r.personId).toBe(P1);
  });

  it('reports UNRESOLVED, not a guess, when nobody matches', async () => {
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'nobody@acme.com' }]);
    expect(r.outcome).toBe('unresolved');
    expect(r.personId).toBeNull();
    expect(r.candidatePersonIds).toEqual([]);
  });

  it('reports AMBIGUOUS rather than picking a winner when one identifier hits two people', async () => {
    db.identity_claims.push(
      { organization_id: ORG_A, claim_type: 'email', platform: null, normalized_value: 'x@acme.com', person_id: P1, revoked_at: null },
      { organization_id: ORG_A, claim_type: 'email', platform: null, normalized_value: 'x@acme.com', person_id: P2, revoked_at: null },
    );
    const r = await resolveIdentityShadow(ORG_A, [{ claimType: 'email', value: 'x@acme.com' }]);
    expect(r.outcome).toBe('ambiguous');
    expect(r.personId).toBeNull();
    expect(r.candidatePersonIds.sort()).toEqual([P1, P2].sort());
  });

  it('reports AMBIGUOUS when two candidates disagree about who this is', async () => {
    db.unified_persons.push(
      { id: P1, company_id: ORG_A, primary_email: 'jane@acme.com' },
      { id: P2, company_id: ORG_A, primary_phone: '+14155550100' },
    );
    const r = await resolveIdentityShadow(ORG_A, [
      { claimType: 'email', value: 'jane@acme.com' },
      { claimType: 'phone', value: '+1 415 555 0100' },
    ]);
    expect(r.outcome).toBe('ambiguous');
    expect(r.personId).toBeNull();
  });

  it('agrees when both candidates point at the same person', async () => {
    db.unified_persons.push({ id: P1, company_id: ORG_A, primary_email: 'jane@acme.com', primary_phone: '+14155550100' });
    const r = await resolveIdentityShadow(ORG_A, [
      { claimType: 'email', value: 'jane@acme.com' },
      { claimType: 'phone', value: '+14155550100' },
    ]);
    expect(r.personId).toBe(P1);
    expect(r.outcome).toBe('matched_spine');
  });
});

describe('candidate validation', () => {
  it('marks a value that does not normalize as UNUSABLE, not unresolved', async () => {
    const v = await evaluateCandidate(ORG_A, { claimType: 'email', value: '   ' });
    expect(v.outcome).toBe('unusable');
    expect(v.normalizedValue).toBeNull();
  });

  it('rejects an external claim with no platform', async () => {
    const v = await evaluateCandidate(ORG_A, { claimType: 'external_id', value: 'janedoe', platform: '  ' });
    expect(v.outcome).toBe('unusable');
    expect(v.reason).toMatch(/requires a platform/);
  });

  it('queries platform IS NULL for platform-free types', async () => {
    await evaluateCandidate(ORG_A, { claimType: 'email', value: 'jane@acme.com', platform: 'linkedin' });
    const q = issuedFilters.find(x => x.table === 'identity_claims');
    expect(q?.filters).toContainEqual(['is', 'platform', null]);
  });

  it('separates the same handle on two platforms', async () => {
    db.identity_claims.push({
      organization_id: ORG_A, claim_type: 'external_id', platform: 'linkedin',
      normalized_value: 'janedoe', person_id: P1, revoked_at: null,
    });
    const li = await resolveIdentityShadow(ORG_A, [{ claimType: 'external_id', value: '@JaneDoe', platform: 'LinkedIn' }]);
    expect(li.personId).toBe(P1);
    const fb = await resolveIdentityShadow(ORG_A, [{ claimType: 'external_id', value: '@JaneDoe', platform: 'facebook' }]);
    expect(fb.outcome).toBe('unresolved');
  });

  it('requires an organizationId — resolution without a tenant is never valid', async () => {
    await expect(resolveIdentityShadow('', [{ claimType: 'email', value: 'a@b.com' }])).rejects.toThrow(/organizationId/);
  });
});
export {};  // module marker: without it this file is a global script and its top-level names collide with the sibling prospectIdentity suites

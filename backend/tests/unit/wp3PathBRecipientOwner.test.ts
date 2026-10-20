/**
 * WP3 / L2 — Path B's block-only recipient-owner check.
 *
 * The frozen anchor order (explicit → task → lead → none) decides which identity
 * a decision is recorded against. The address being contacted may belong to a
 * different person, or to someone when the task has no anchor; a restriction
 * recorded against that owner must still block. The supplementary lookup may
 * only ADD a block, and an unreadable or ambiguous answer fails closed.
 *
 * Runs against a database double. It proves control flow, query shape and
 * precedence — not PostgREST behaviour.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  throws: {} as Record<string, string>,
  queries: [] as Array<{ table: string; filters: Filter[] }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { filters: [] as Filter[] };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row): boolean =>
      st.filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val;
        if (kind === 'is') return (r[col] ?? null) === val;
        if (kind === 'in') return Array.isArray(val) && (val as unknown[]).includes(r[col] ?? null);
        return true;
      });
    const exec = async (mode: 'many' | 'maybe'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, filters: st.filters });
      if (db.throws[table]) throw new Error(db.throws[table]);
      if (db.failures[table]) return { data: null, error: db.failures[table] };
      const found = rows().filter(match);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('maybe'),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => exec('many').then(resolve, reject),
    };
    return b;
  },
}));

import { resolveCanonicalGovernanceWithAnchor } from '../../services/leadOutreachExecution/governanceService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const P = '00000000-0000-4000-8000-0000000000a1';   // the anchored person
const Q = '00000000-0000-4000-8000-0000000000b2';   // the recipient's owner
const R = '00000000-0000-4000-8000-0000000000c3';
const RECIPIENT = 'Owner@Example.Test';
const NORMALISED = 'owner@example.test';
const NOW = '2026-10-20T12:00:00.000Z';

const task = (over: Row = {}) => ({
  id: 't-1', companyId: ORG_A, leadId: 'L1', channel: 'email', personId: P, ...over,
}) as never;

/** A person-only restriction: the shape C-1 and the owner gap are about. */
const personRestriction = (personId: string, over: Row = {}): Row => ({
  id: `g-${personId}`, organization_id: ORG_A, person_id: personId, target_normalized: null,
  channel: '*', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

const claim = (personId: string, over: Row = {}): Row => ({
  organization_id: ORG_A, person_id: personId, claim_type: 'email', platform: null,
  normalized_value: NORMALISED, revoked_at: null, ...over,
});

const evaluate = (t = task(), explicitPersonId: string | null = null, recipient: string | null = RECIPIENT) =>
  resolveCanonicalGovernanceWithAnchor(ORG_A, t, recipient, explicitPersonId, NOW);

beforeEach(() => {
  db.tables = { contact_governance_records: [], identity_claims: [], leads: [] };
  db.failures = {};
  db.throws = {};
  db.queries = [];
});

describe('WP3/L2 — the recipient owner can add a block', () => {
  it('1. anchored person restricted, owner unrestricted → BLOCK', async () => {
    db.tables.identity_claims = [claim(Q)];
    db.tables.contact_governance_records = [personRestriction(P)];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.recordId).toBe(`g-${P}`);
  });

  it('2. anchored person unrestricted, owner restricted → BLOCK (new)', async () => {
    db.tables.identity_claims = [claim(Q)];
    db.tables.contact_governance_records = [personRestriction(Q)];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.matchedBy).toBe('person');
    expect(verdict?.recordId).toBe(`g-${Q}`);
  });

  it('3. NO person anchor, owner restricted → BLOCK (new)', async () => {
    db.tables.identity_claims = [claim(Q)];
    db.tables.contact_governance_records = [personRestriction(Q)];

    const { verdict, anchor } = await evaluate(task({ personId: null }));
    expect(anchor.source).toBe('none');
    expect(verdict?.decision).toBe('blocked');
  });

  it('4. anchored person IS the owner and unrestricted → allowed', async () => {
    db.tables.identity_claims = [claim(P)];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('allowed');
  });

  it('5a. no owner claim → address matching is unchanged (an address restriction blocks)', async () => {
    db.tables.contact_governance_records = [personRestriction(R, { person_id: null, target_normalized: NORMALISED })];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.matchedBy).toBe('target');
  });

  it('5b. no owner claim and nothing restricted → allowed', async () => {
    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('allowed');
  });
});

describe('WP3/L2 — uncertainty fails closed', () => {
  it('6. two people claim the address → BLOCK, person resolution failed', async () => {
    db.tables.identity_claims = [claim(Q), claim(R)];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('7a. the claims read errors → BLOCK', async () => {
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('7b. the claims client throws → BLOCK', async () => {
    db.throws.identity_claims = 'socket hang up';

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
  });

  it("7c. the owner's governance read fails → BLOCK", async () => {
    db.tables.identity_claims = [claim(Q)];
    // The anchored read happens first and must succeed for the owner read to run,
    // so fail only on the person-filtered read of the OWNER.
    const real = db.tables.contact_governance_records;
    let reads = 0;
    Object.defineProperty(db.failures, 'contact_governance_records', {
      configurable: true,
      get: () => (++reads > 2 ? { code: '08006', message: 'connection failure' } : undefined),
    });
    db.tables.contact_governance_records = real;

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.reason).toBe('governance_lookup_failed_failclosed');
  });
});

describe('WP3/L2 — tenant isolation and precedence', () => {
  it("8. a claim held only in ANOTHER tenant resolves nobody here", async () => {
    db.tables.identity_claims = [claim(Q, { organization_id: ORG_B })];
    db.tables.contact_governance_records = [personRestriction(Q, { organization_id: ORG_B })];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('allowed');
    const claimRead = db.queries.find((q) => q.table === 'identity_claims');
    expect(claimRead?.filters[0]).toEqual(['eq', 'organization_id', ORG_A]);
  });

  it("9. the owner's REVOKED restriction is ignored", async () => {
    db.tables.identity_claims = [claim(Q)];
    db.tables.contact_governance_records = [personRestriction(Q, { revoked_at: '2026-06-01T00:00:00.000Z' })];

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('allowed');
  });

  it('10. an anchored block stands even when the owner lookup would fail — nothing lifts it', async () => {
    db.tables.contact_governance_records = [personRestriction(P)];
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const { verdict } = await evaluate();
    expect(verdict?.decision).toBe('blocked');
    expect(verdict?.recordId).toBe(`g-${P}`);
    // The owner lookup is never consulted once a block is known.
    expect(db.queries.some((q) => q.table === 'identity_claims')).toBe(false);
  });

  it('11. the recorded anchor is the frozen-order anchor, even when the owner blocks', async () => {
    db.tables.identity_claims = [claim(Q)];
    db.tables.contact_governance_records = [personRestriction(Q)];

    const explicit = await evaluate(task(), P);
    expect(explicit.anchor).toMatchObject({ ok: true, personId: P, source: 'explicit' });
    expect(explicit.verdict?.decision).toBe('blocked');

    const stored = await evaluate(task());
    expect(stored.anchor).toMatchObject({ ok: true, personId: P, source: 'task' });
  });

  it('12. no recipient → no owner lookup at all', async () => {
    const { verdict } = await evaluate(task(), null, null);
    expect(verdict?.decision).toBe('allowed');
    expect(db.queries.some((q) => q.table === 'identity_claims')).toBe(false);
  });
});

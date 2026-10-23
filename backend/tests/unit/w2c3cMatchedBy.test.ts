/**
 * PHASE 4C-3C / P4-2 (O3) — `matchedBy` is attached ONLY by a real canonical
 * verdict.
 *
 * WHY THE FIELD EXISTS. `scope` is overloaded between the two stores: a
 * canonical answer puts `person`/`target` there, a legacy answer puts
 * `suppression_entries.scope`, whose CHECK admits only `global`/`tenant`. A
 * consumer reading `scope` cannot tell which vocabulary it received without also
 * reading `store`. `matchedBy` is canonical-only and unambiguous.
 *
 * WHAT THESE TESTS PIN:
 *   - the two permitted values, each from the verdict that produced it;
 *   - OMISSION — not `null`, not a guess, not the legacy `scope` — on every
 *     other exit;
 *   - that `scope`, `scopesEvaluated`, `store`, `reason` and `suppressed` are
 *     all unchanged;
 *   - and that nothing about governance behaviour moved.
 *
 * Runs against a double. Real constraints, RLS and PostgREST stay UNVERIFIED.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  throws: {} as Record<string, string>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
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
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.throws[table]) throw new Error(db.throws[table]);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, ...defaults, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(match);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
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

import { isSuppressed } from '../../services/execution/suppressionService';

const ORG = '00000000-0000-4000-8000-00000000000a';
const PERSON = '00000000-0000-4000-8000-000000000001';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG, person_id: null, target_normalized: NORMALISED,
  channel: 'email', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

const claim = (over: Row = {}): Row => ({
  id: `c-${db.nextId++}`, organization_id: ORG, person_id: PERSON,
  claim_type: 'email', platform: null, normalized_value: NORMALISED, revoked_at: null,
  ...over,
});

const legacyRow = (over: Row = {}): Row => ({
  id: 'se-1', company_id: ORG, channel: '*', target: NORMALISED,
  reason: 'manual', scope: 'tenant', active: true, released_at: null,
  ...over,
});

const has = (r: object): boolean => 'matchedBy' in r;

beforeEach(() => {
  db.tables = {
    contact_governance_records: [], suppression_entries: [], identity_claims: [],
  };
  db.failures = {};
  db.throws = {};
  db.queries = [];
  db.nextId = 1;
});

describe('4C-3C — attached by a canonical verdict', () => {
  it('1. a canonical PERSON match attaches matchedBy: person', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.matchedBy).toBe('person');
    expect(r).toMatchObject({ suppressed: true, store: 'canonical', reason: 'unsubscribe' });
  });

  it('2. a canonical TARGET match attaches matchedBy: target', async () => {
    db.tables.contact_governance_records = [govRow()];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.matchedBy).toBe('target');
    expect(r).toMatchObject({ suppressed: true, store: 'canonical' });
  });

  it('3. a canonical DEFERRAL also reports its anchor', async () => {
    db.tables.contact_governance_records = [govRow({ governance_type: 'deferred', effective_until: '2099-01-01T00:00:00.000Z' })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.matchedBy).toBe('target');
    expect(r.reason).toBe('deferred');
  });

  it('4. the value is the VERDICT’s, never guessed: person wins when both anchors match', async () => {
    // The record carries BOTH a person and the target. `mayContact` reports
    // `person`, and that is what must surface — not a coin-flip or the target.
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: NORMALISED })];

    expect((await isSuppressed(ORG, 'email', TARGET)).matchedBy).toBe('person');
  });
});

describe('4C-3C — omitted everywhere else', () => {
  it('5. a LEGACY block omits it, even though its legacy `scope` is present', async () => {
    db.tables.suppression_entries = [legacyRow({ scope: 'tenant' })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, store: 'legacy', scope: 'tenant' });
    // The overloaded `scope` must NOT be promoted into `matchedBy`.
    expect(has(r)).toBe(false);
  });

  it('6. a GLOBAL legacy block omits it too', async () => {
    db.tables.suppression_entries = [legacyRow({ company_id: '__global__', scope: 'global', reason: 'legal_hold' })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, scope: 'global' });
    expect(has(r)).toBe(false);
  });

  it('7. allow-by-absence omits it — `mayContact` reported no anchor', async () => {
    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.suppressed).toBe(false);
    expect(has(r)).toBe(false);
    // ...and the 4C-2 metadata is untouched.
    expect(r.scopesEvaluated).toEqual(['canonical.target', 'suppression_entries']);
  });

  it('8. an empty target omits it, and the shape is exactly as before', async () => {
    const r = await isSuppressed(ORG, 'email', '   ');

    expect(r).toEqual({ suppressed: false });
    expect(has(r)).toBe(false);
  });

  it('9. tenant rejection omits it, and the shape is exactly as before', async () => {
    const r = await isSuppressed('', 'email', TARGET);

    expect(r).toEqual({ suppressed: true, reason: 'suppression_no_tenant_failclosed' });
    expect(has(r)).toBe(false);
  });

  it('10. identity-resolution FAILURE omits it', async () => {
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
    expect(has(r)).toBe(false);
  });

  it('11. identity AMBIGUITY omits it', async () => {
    db.tables.identity_claims = [
      claim({ claim_type: 'email', person_id: PERSON }),
      claim({ claim_type: 'phone', person_id: '00000000-0000-4000-8000-000000000002' }),
    ];

    const r = await isSuppressed(ORG, '*', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
    expect(has(r)).toBe(false);
  });

  it('12. canonical-read FAILURE omits it, and the shape is exactly as before', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toEqual({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
    expect(has(r)).toBe(false);
  });

  it('13. legacy-read ERROR omits it', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'suppression_lookup_error_failclosed', store: 'legacy' });
    expect(has(r)).toBe(false);
  });

  it('14. legacy-read EXCEPTION omits it', async () => {
    db.throws.suppression_entries = 'socket hang up';

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'suppression_exception_failclosed', store: 'legacy' });
    expect(has(r)).toBe(false);
  });

  it('15. a non-matching canonical record cannot produce the field', async () => {
    // A record on another channel: the read completes, nothing matches, and the
    // evaluator returns `allowed` with a null anchor.
    db.tables.contact_governance_records = [govRow({ channel: 'phone' })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.suppressed).toBe(false);
    expect(has(r)).toBe(false);
  });
});

describe('4C-3C — nothing else moved', () => {
  it('16. a canonical result keeps its existing `scope` and `scopesEvaluated`', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    // `scope` is unchanged — same value the pre-4C-3C code produced.
    expect(r.scope).toBe('person');
    // `scopesEvaluated` is unchanged: a canonical block short-circuits, so the
    // legacy store is still not listed.
    expect(r.scopesEvaluated).toEqual(['canonical.person', 'canonical.target']);
    expect(r.scopesEvaluated).not.toContain('suppression_entries');
  });

  it('17. canonical-first short-circuit is intact — the legacy store is not queried', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [legacyRow()];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.store).toBe('canonical');
    expect(db.queries.some((q) => q.table === 'suppression_entries')).toBe(false);
  });

  it('18. a released legacy row still cannot relax a canonical restriction', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [legacyRow({ active: false, released_at: '2026-04-01T00:00:00.000Z' })];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, store: 'canonical' });
    expect(r.matchedBy).toBe('target');
  });

  it('19. Path A still reads ONLY `suppression_entries`', async () => {
    db.tables.contact_governance_records = [];
    await isSuppressed(ORG, 'email', TARGET);

    const tables = [...new Set(db.queries.map((q) => q.table))];
    expect(tables).toContain('suppression_entries');
    expect(tables).not.toContain('outreach_suppressions');
  });

  it('20. the field carries no endpoint value, record id or count', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    const r = await isSuppressed(ORG, 'email', TARGET);
    const serialized = JSON.stringify(r);

    expect(['person', 'target']).toContain(r.matchedBy);
    expect(serialized).not.toContain(NORMALISED);
    expect(serialized).not.toContain(PERSON);
    expect(serialized).not.toContain('g1');
  });

  it('21. no `decision`, `failClosed` or identity field was introduced', async () => {
    db.tables.contact_governance_records = [govRow()];
    const blocked = await isSuppressed(ORG, 'email', TARGET);
    const allowed = await isSuppressed(ORG, 'email', 'someone.else@example.test');

    for (const r of [blocked, allowed]) {
      expect('decision' in r).toBe(false);
      expect('failClosed' in r).toBe(false);
      expect('identity' in r).toBe(false);
    }
    // The whole key set stays within the authorized contract.
    expect(Object.keys(blocked).sort()).toEqual(['matchedBy', 'reason', 'scope', 'scopesEvaluated', 'store', 'suppressed']);
  });
});

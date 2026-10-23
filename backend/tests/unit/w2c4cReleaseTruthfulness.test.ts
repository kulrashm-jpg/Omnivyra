/**
 * PHASE 4C-4C / R2 — a legacy release reports what it actually did.
 *
 * THE DEFECT (M3). `releaseSuppression` keyed completion on the ABSENCE of an
 * error. A PostgREST update that matches no row errors on nothing, so a phone
 * release issued with a different spelling from the one stored revoked the
 * canonical record, left the legacy row active, and answered `complete: true` —
 * while the surviving row kept blocking the contact.
 *
 * THE FIX. The update requests a representation (`.select('id')`), so the
 * affected-row count is observable, and the result reports one of three
 * outcomes: `deactivated`, `no_match`, `failed`. Only the first may be called
 * complete.
 *
 * WHAT THE FIX DELIBERATELY DOES *NOT* DO. It does not change which rows match,
 * add a second lookup, or make two spellings equivalent — that is the M5/C-5
 * normalization gap, which remains unfixed and unauthorized. A `no_match`
 * therefore still means "nothing was deactivated AND nothing verified that
 * nothing remains", which is why it is not reported as success.
 *
 * Runs against a double. Real PostgREST semantics stay UNVERIFIED — see the
 * closeout report for the source evidence the contract rests on.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  throws: {} as Record<string, string>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null; selected: boolean }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null, selected: false };
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
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload, selected: st.selected });
      if (db.throws[table]) throw new Error(db.throws[table]);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const candidate = { ...defaults, ...(st.payload as Row) };
        if (st.op === 'upsert' && table === 'suppression_entries') {
          const existing = rows().find((r) => r.company_id === candidate.company_id && r.channel === candidate.channel && r.target === candidate.target);
          if (existing) { Object.assign(existing, candidate); return { data: existing, error: null }; }
        }
        const created = { id: `${table}-${db.nextId++}`, ...candidate };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        // PostgREST returns a representation ONLY when one was requested. Without
        // `.select()` the caller gets `data: null` and cannot know the count —
        // which is exactly the condition that made M3 possible, so the double
        // reproduces it rather than hiding it.
        return st.selected ? { data: hit.map((r) => ({ id: r.id })), error: null } : { data: null, error: null };
      }
      const found = rows().filter(match);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => { st.selected = true; return b; },
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

import { addSuppression, isSuppressed, releaseSuppression } from '../../services/execution/suppressionService';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const EMAIL = 'CTO@Example.Test';
const EMAIL_NORM = 'cto@example.test';
const SPACED = '+1 555 010 0000';
const COMPACT = '+15550100000';

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: EMAIL_NORM,
  channel: 'email', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

const legacyRow = (over: Row = {}): Row => ({
  id: 'se-1', company_id: ORG_A, channel: 'email', target: EMAIL_NORM,
  reason: 'manual', scope: 'tenant', active: true, released_at: null,
  ...over,
});

beforeEach(() => {
  db.tables = { contact_governance_records: [], suppression_entries: [], identity_claims: [] };
  db.failures = {};
  db.throws = {};
  db.queries = [];
  db.nextId = 1;
});

// ── The query contract the fix depends on ───────────────────────────────────
describe('R2 — the release asks for an affected-row representation', () => {
  it('0. the legacy update requests `.select()`, which is what makes the count knowable', async () => {
    db.tables.suppression_entries = [legacyRow()];

    await releaseSuppression(ORG_A, 'email', EMAIL);

    const update = db.queries.find((q) => q.table === 'suppression_entries' && q.op === 'update');
    expect(update).toBeDefined();
    expect(update!.selected).toBe(true);
    // The filters are UNCHANGED — the fix alters what comes back, not what matches.
    expect(update!.filters.map(([, col]) => col).sort())
      .toEqual(['active', 'channel', 'company_id', 'target']);
  });
});

// ── 1-3. The three outcomes ────────────────────────────────────────────────
describe('R2 — deactivated / no_match / failed', () => {
  it('1. PHONE FORMATTING MISMATCH: both halves are released — R3-A′ removed the cause', async () => {
    // UPDATED BY R3-A′. This case pinned the surviving legacy row that R2 could
    // only REPORT. R3-A′ recovers the recorded spelling from the canonical
    // record's `target_raw`, so the row is now actually deactivated. The
    // `no_match` outcome this suite exists to pin is still covered by cases 3
    // (already-inactive row) and 11 (canonical-only), which are unchanged.
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(1);
    expect(r).toMatchObject({ legacyOutcome: 'deactivated', legacyDeactivated: true, complete: true, legacyError: null });
    expect(db.tables.suppression_entries[0].active).toBe(false);
    // POSITIVE: the contact is released, and no legacy row answers for it.
    expect((await isSuppressed(ORG_A, 'phone', SPACED)).suppressed).toBe(false);
  });

  it('2. LEGACY ROW MATCHED: a confirmed deactivation reports complete', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [legacyRow()];

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'deactivated', legacyDeactivated: true, complete: true, legacyError: null });
    expect(db.tables.suppression_entries[0].active).toBe(false);
    expect((await isSuppressed(ORG_A, 'email', EMAIL)).suppressed).toBe(false);
  });

  it('3. ZERO ROWS AFFECTED: the query succeeded and confirmed no deactivation', async () => {
    // An already-inactive row: the query runs, matches nothing, errors on nothing.
    db.tables.suppression_entries = [legacyRow({ active: false, released_at: '2026-04-01T00:00:00.000Z' })];

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r).toMatchObject({ legacyOutcome: 'no_match', legacyDeactivated: false, complete: false });
    expect(r.legacyError).toBeNull();     // NOT an error — the distinction R2 adds
  });

  it('4. LEGACY UPDATE ERROR: canonical may already be revoked; partial state is reported', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r.canonicalRevoked).toBe(1);                       // the canonical half DID happen
    expect(r).toMatchObject({ legacyOutcome: 'failed', legacyDeactivated: false, complete: false });
    expect(r.legacyError).toBe('legacy_release_failed:08006');
  });

  it('5. LEGACY UPDATE EXCEPTION: no false success', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.throws.suppression_entries = 'socket hang up';

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r).toMatchObject({ legacyOutcome: 'failed', legacyDeactivated: false, complete: false });
    expect(r.legacyError).toBe('legacy_release_exception');
  });

  it('6. the three outcomes are mutually exclusive and exhaustive across the cases above', async () => {
    const seen = new Set<string>();

    db.tables.suppression_entries = [legacyRow()];
    seen.add((await releaseSuppression(ORG_A, 'email', EMAIL)).legacyOutcome);

    db.tables.suppression_entries = [];
    seen.add((await releaseSuppression(ORG_A, 'email', EMAIL)).legacyOutcome);

    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };
    seen.add((await releaseSuppression(ORG_A, 'email', EMAIL)).legacyOutcome);

    expect([...seen].sort()).toEqual(['deactivated', 'failed', 'no_match']);
  });
});

// ── 7-10. Everything the fix must not disturb ──────────────────────────────
describe('R2 — invariants preserved', () => {
  it('7. EMAIL REGRESSION: a normal release where both stores share the key still succeeds', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'email', target: ' Alice@Example.Test ', reason: 'unsubscribe' });
    expect(db.tables.contact_governance_records[0].target_normalized).toBe('alice@example.test');
    expect(db.tables.suppression_entries[0].target).toBe('alice@example.test');

    const r = await releaseSuppression(ORG_A, 'email', 'ALICE@example.test');

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'deactivated', complete: true });
    expect((await isSuppressed(ORG_A, 'email', 'alice@example.test')).suppressed).toBe(false);
  });

  it('8a. WILDCARD: a channel release lifts neither store’s "*" row', async () => {
    db.tables.contact_governance_records = [govRow({ channel: '*' })];
    db.tables.suppression_entries = [legacyRow({ channel: '*' })];

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r.canonicalRevoked).toBe(0);
    expect(db.tables.contact_governance_records[0].revoked_at).toBeNull();
    expect(db.tables.suppression_entries[0].active).toBe(true);
    expect(r.legacyOutcome).toBe('no_match');          // nothing matched, truthfully reported
    expect((await isSuppressed(ORG_A, 'email', EMAIL)).suppressed).toBe(true);
  });

  it('8b. WILDCARD: releasing "*" lifts no channel-specific restriction', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'email' })];
    db.tables.suppression_entries = [legacyRow({ channel: 'email' })];

    const r = await releaseSuppression(ORG_A, '*', EMAIL);

    expect(r.canonicalRevoked).toBe(0);
    expect(db.tables.suppression_entries[0].active).toBe(true);
    expect((await isSuppressed(ORG_A, 'email', EMAIL)).suppressed).toBe(true);
  });

  it('9. TENANT ISOLATION: a release never touches another tenant’s row', async () => {
    db.tables.contact_governance_records = [govRow({ organization_id: ORG_B })];
    db.tables.suppression_entries = [legacyRow({ company_id: ORG_B })];

    const r = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(r.canonicalRevoked).toBe(0);
    expect(db.tables.suppression_entries[0].active).toBe(true);      // ORG_B's row survives
    expect(db.tables.contact_governance_records[0].revoked_at).toBeNull();
    expect(r.legacyOutcome).toBe('no_match');
    // ORG_B is still suppressed; ORG_A never was.
    expect((await isSuppressed(ORG_B, 'email', EMAIL)).suppressed).toBe(true);
    // Every legacy query named the tenant.
    for (const q of db.queries.filter((x) => x.table === 'suppression_entries')) {
      expect(q.filters.map(([, col]) => col)).toContain('company_id');
    }
  });

  it('10. REPLAY: the second attempt reports its own result, claiming no unverified success', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [legacyRow()];

    const first = await releaseSuppression(ORG_A, 'email', EMAIL);
    const again = await releaseSuppression(ORG_A, 'email', EMAIL);

    expect(first).toMatchObject({ legacyOutcome: 'deactivated', complete: true });
    expect(again).toMatchObject({ legacyOutcome: 'no_match', complete: false, legacyError: null });
    // Replay is still SAFE: nothing re-revoked, nothing deleted, contact released.
    expect(again.canonicalRevoked).toBe(0);
    expect(db.tables.contact_governance_records).toHaveLength(1);
    expect(db.tables.suppression_entries).toHaveLength(1);
    expect((await isSuppressed(ORG_A, 'email', EMAIL)).suppressed).toBe(false);
  });

  it('11. a GLOBAL release still targets the sentinel row and reports honestly', async () => {
    db.tables.suppression_entries = [legacyRow({ company_id: '__global__', scope: 'global' })];

    const r = await releaseSuppression(null, 'email', EMAIL);

    expect(r).toMatchObject({ canonicalRevoked: 0, legacyOutcome: 'deactivated', complete: true });
    expect(db.tables.suppression_entries[0].active).toBe(false);
  });

  it('12. fail-closed contact governance is untouched by the release contract', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    // The canonical read failure still THROWS out of the release, as before.
    await expect(releaseSuppression(ORG_A, 'email', EMAIL)).rejects.toThrow();

    // ...and the evaluator still fails closed.
    db.failures = { contact_governance_records: { code: '08006', message: 'connection failure' } };
    expect(await isSuppressed(ORG_A, 'email', EMAIL)).toMatchObject({
      suppressed: true, reason: 'governance_lookup_failed_failclosed',
    });
  });
});

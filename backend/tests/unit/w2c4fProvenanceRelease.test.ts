/**
 * PHASE 4C-4F / R3-A′ — the legacy release key is recovered from the canonical
 * record's OWN recorded spelling.
 *
 * THE DEFECT (M3/M5). `addSuppression` hands one raw string to both stores and
 * they key it differently — canonical through `normalizeGovernanceTarget`
 * (punctuation stripped from a phone number), legacy through `norm` (trim and
 * lowercase only). A release naming either spelling therefore missed the other
 * store: canonical was revoked, the legacy row stayed active, and R2 honestly
 * reported `no_match` / `complete: false` without being able to fix it.
 *
 * THE FIX. The canonical writer already persists the original string as
 * `target_raw`, so `norm(target_raw)` reconstructs the legacy key EXACTLY — the
 * same transformation `addSuppression` applied when it wrote that row. The
 * release now deactivates on the request's key PLUS the recorded spelling of
 * every canonical record it actually revoked.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: guess formatting variants, equate
 * `15550100000` with `+15550100000`, equate national with international, parse
 * extensions, or query legacy rows that no revoked record points at.
 *
 * Runs against a double. Real PostgREST semantics stay UNVERIFIED.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  throws: {} as Record<string, string>,
  /** Fail ONLY the provenance read (a select on the canonical table). */
  failProvenance: false,
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
      // The provenance read is the only SELECT that filters canonical rows by id.
      if (db.failProvenance && table === 'contact_governance_records' && st.op === 'select'
        && st.filters.some(([kind, col]) => kind === 'in' && col === 'id')) {
        return { data: null, error: { code: '08006', message: 'connection failure' } };
      }

      if (st.op === 'insert' || st.op === 'upsert') {
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null, target_raw: null }
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
const SPACED = '+1 555 010 0000';
const PUNCT = '+1 (555) 010-0000';
const COMPACT = '+15550100000';
const NOPLUS = '15550100000';
const NATIONAL = '5550100000';

const legacyRows = () => (db.tables.suppression_entries ?? []);
const activeLegacy = () => legacyRows().filter((r) => r.active === true);

beforeEach(() => {
  db.tables = { contact_governance_records: [], suppression_entries: [], identity_claims: [] };
  db.failures = {};
  db.throws = {};
  db.failProvenance = false;
  db.queries = [];
  db.nextId = 1;
});

// ── 1-2. The headline fix ──────────────────────────────────────────────────
describe('R3-A′ — a release names the spelling the record recorded', () => {
  it('1. FORMATTED/COMPACT MISMATCH: both stores are released, and completion is claimed', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    // The two keys really do differ — that is the whole problem.
    expect(db.tables.contact_governance_records[0].target_normalized).toBe(COMPACT);
    expect(db.tables.contact_governance_records[0].target_raw).toBe(SPACED);
    expect(legacyRows()[0].target).toBe(SPACED.toLowerCase());

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(1);
    expect(r).toMatchObject({ legacyOutcome: 'deactivated', legacyDeactivated: true, complete: true, legacyError: null });
    expect(legacyRows()[0].active).toBe(false);
    // ...and the contact is genuinely released on BOTH spellings now.
    expect((await isSuppressed(ORG_A, 'phone', SPACED)).suppressed).toBe(false);
    expect((await isSuppressed(ORG_A, 'phone', COMPACT)).suppressed).toBe(false);
  });

  it('2. SAME-SPELLING release is unchanged, and issues ONE update (keys deduped)', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    db.queries = [];

    const r = await releaseSuppression(ORG_A, 'phone', SPACED);

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'deactivated', complete: true });
    const updates = db.queries.filter((q) => q.table === 'suppression_entries' && q.op === 'update');
    expect(updates).toHaveLength(1);          // request key === provenance key
  });

  it('3. a PUNCTUATED original is recovered too', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: PUNCT, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r).toMatchObject({ legacyOutcome: 'deactivated', complete: true });
    expect(activeLegacy()).toHaveLength(0);
  });

  it('4. WHATSAPP behaves identically — it shares the phone normaliser', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'whatsapp', target: SPACED, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, 'whatsapp', COMPACT);

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'deactivated', complete: true });
  });
});

// ── 3-4. No equivalence was invented ───────────────────────────────────────
describe('R3-A′ — no phone-identity policy was changed', () => {
  it('5. the leading + is still significant: +1555… is not 1555…', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: COMPACT, reason: 'manual' });

    // Canonical keys differ, so NOTHING is revoked and no provenance is recovered.
    const r = await releaseSuppression(ORG_A, 'phone', NOPLUS);

    expect(r.canonicalRevoked).toBe(0);
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false });
    expect(activeLegacy()).toHaveLength(1);                       // still suppressed
    expect((await isSuppressed(ORG_A, 'phone', COMPACT)).suppressed).toBe(true);
  });

  it('6. NATIONAL and INTERNATIONAL remain different subjects', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: COMPACT, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, 'phone', NATIONAL);

    expect(r.canonicalRevoked).toBe(0);
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false });
    expect((await isSuppressed(ORG_A, 'phone', COMPACT)).suppressed).toBe(true);
  });

  it('7. only the revoked records’ OWN spellings are used — an unrelated row is untouched', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    // A different endpoint, same tenant and channel.
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: '+1 555 999 0000', reason: 'manual' });

    await releaseSuppression(ORG_A, 'phone', COMPACT);

    const other = legacyRows().find((r) => r.target === '+1 555 999 0000');
    expect(other!.active).toBe(true);                             // untouched
  });
});

// ── 5-9. Provenance, duplicates, zero rows, errors ─────────────────────────
describe('R3-A′ — provenance and partial results', () => {
  it('8. MISSING provenance (person-anchored record) guesses nothing', async () => {
    // A person-anchored canonical record has no target and no legacy twin.
    db.tables.contact_governance_records = [{
      id: 'g-person', organization_id: ORG_A, person_id: '00000000-0000-4000-8000-000000000001',
      target_normalized: null, target_raw: null, channel: 'phone', governance_type: 'dnc_channel',
      effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
    }];
    // An unrelated legacy row that must NOT be touched.
    db.tables.suppression_entries = [{
      id: 'se-x', company_id: ORG_A, channel: 'phone', target: SPACED.toLowerCase(),
      reason: 'manual', scope: 'tenant', active: true, released_at: null,
    }];

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    // The person-anchored record is not target-matched, so nothing is revoked...
    expect(r.canonicalRevoked).toBe(0);
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false });
    expect(legacyRows()[0].active).toBe(true);                    // no guessed key reached it
  });

  it('9. an UNREADABLE provenance read is reported as failed, never as complete', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    db.failProvenance = true;

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(1);                           // canonical half DID happen
    expect(r).toMatchObject({ legacyOutcome: 'failed', legacyDeactivated: false, complete: false });
    expect(r.legacyError).toBe('legacy_provenance_unreadable');
    // No legacy update was attempted on an unknown key.
    expect(db.queries.some((q) => q.table === 'suppression_entries' && q.op === 'update')).toBe(false);
  });

  it('10. DUPLICATE keys are deduped: two records, one spelling, one update', async () => {
    // Two governance types for one endpoint — the canonical identity key admits
    // both — written from the same raw spelling.
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'unsubscribe' });
    expect(db.tables.contact_governance_records.filter((r) => r.revoked_at == null)).toHaveLength(2);
    expect(legacyRows()).toHaveLength(1);                         // uq_suppression collapses them
    db.queries = [];

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(2);

    // TWO records shared ONE recorded spelling, so provenance contributes ONE
    // key — not two. With the request's own key that is two updates in total,
    // not four: the dedupe is what keeps it from being four.
    const keys = db.queries
      .filter((q) => q.table === 'suppression_entries' && q.op === 'update')
      .map((q) => q.filters.find(([, col]) => col === 'target')?.[2]);
    expect(keys).toHaveLength(2);
    expect(keys.filter((k) => k === SPACED.toLowerCase())).toHaveLength(1);   // deduped
    expect(keys.filter((k) => k === COMPACT)).toHaveLength(1);                // the request key

    expect(r).toMatchObject({ legacyOutcome: 'deactivated', complete: true });
    expect(activeLegacy()).toHaveLength(0);
  });

  it('11. CANONICAL-ONLY: no legacy row is falsely reported as deactivated', async () => {
    db.tables.contact_governance_records = [{
      id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: COMPACT, target_raw: SPACED,
      channel: 'phone', governance_type: 'unsubscribe',
      effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
    }];

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(1);
    expect(r).toMatchObject({ legacyOutcome: 'no_match', legacyDeactivated: false, complete: false, legacyError: null });
    expect((await isSuppressed(ORG_A, 'phone', COMPACT)).suppressed).toBe(false);   // genuinely released
  });

  it('12. a legacy update ERROR keeps the canonical count and reports failure', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(1);
    expect(r).toMatchObject({ legacyOutcome: 'failed', legacyDeactivated: false, complete: false });
    expect(r.legacyError).toBe('legacy_release_failed:08006');
  });

  it('13. a legacy update EXCEPTION behaves the same', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    db.throws.suppression_entries = 'socket hang up';

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r).toMatchObject({ legacyOutcome: 'failed', complete: false });
    expect(r.legacyError).toBe('legacy_release_exception');
  });

  it('14. no fault code or diagnostic carries the endpoint', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });
    db.failures.suppression_entries = { code: '23505', message: `conflict on (target)=(${SPACED})` };

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.legacyError).not.toContain('555');
    expect(r.legacyError).not.toContain(SPACED);
    expect(JSON.stringify(r)).not.toContain('555');
  });
});

// ── 10-13. Everything that must not move ───────────────────────────────────
describe('R3-A′ — invariants preserved', () => {
  it('15. EMAIL control: case-insensitive release still succeeds', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'email', target: ' Alice@Example.Test ', reason: 'unsubscribe' });

    const r = await releaseSuppression(ORG_A, 'email', 'ALICE@example.test');

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'deactivated', complete: true });
    expect((await isSuppressed(ORG_A, 'email', 'alice@example.test')).suppressed).toBe(false);
  });

  it('16. WILDCARD: a channel release does not deactivate a "*" legacy row', async () => {
    await addSuppression({ companyId: ORG_A, channel: '*', target: SPACED, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(0);                           // channel-exact loop skips '*'
    expect(activeLegacy()).toHaveLength(1);
    expect(activeLegacy()[0].channel).toBe('*');
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false });
  });

  it('17. WILDCARD: releasing "*" does not deactivate a channel-specific row', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });

    const r = await releaseSuppression(ORG_A, '*', COMPACT);

    expect(r.canonicalRevoked).toBe(0);
    expect(activeLegacy()).toHaveLength(1);
    expect(activeLegacy()[0].channel).toBe('phone');
  });

  it('18. TENANT ISOLATION: another tenant’s row is never touched', async () => {
    await addSuppression({ companyId: ORG_B, channel: 'phone', target: SPACED, reason: 'manual' });
    db.queries = [];

    const r = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(r.canonicalRevoked).toBe(0);
    expect(activeLegacy()).toHaveLength(1);                       // ORG_B's row survives
    expect((await isSuppressed(ORG_B, 'phone', SPACED)).suppressed).toBe(true);
    // Every canonical and legacy query named the tenant.
    for (const q of db.queries.filter((x) => x.table === 'suppression_entries' || x.table === 'contact_governance_records')) {
      const cols = q.filters.map(([, col]) => col);
      expect(cols.some((c) => c === 'company_id' || c === 'organization_id')).toBe(true);
    }
  });

  it('19. REPLAY: the second release does not claim a second deactivation', async () => {
    await addSuppression({ companyId: ORG_A, channel: 'phone', target: SPACED, reason: 'manual' });

    const first = await releaseSuppression(ORG_A, 'phone', COMPACT);
    const again = await releaseSuppression(ORG_A, 'phone', COMPACT);

    expect(first).toMatchObject({ legacyOutcome: 'deactivated', complete: true });
    // Nothing left to revoke, and the row is already inactive.
    expect(again).toMatchObject({ canonicalRevoked: 0, legacyOutcome: 'no_match', complete: false, legacyError: null });
    expect(legacyRows()).toHaveLength(1);
    expect(db.tables.contact_governance_records).toHaveLength(1);
  });

  it('20. a GLOBAL release still targets the sentinel row', async () => {
    db.tables.suppression_entries = [{
      id: 'se-g', company_id: '__global__', channel: 'phone', target: SPACED.toLowerCase(),
      reason: 'legal_hold', scope: 'global', active: true, released_at: null,
    }];

    // No tenant, so there is no canonical record and no provenance — the
    // request key is the only key, exactly as before.
    const r = await releaseSuppression(null, 'phone', SPACED);

    expect(r).toMatchObject({ canonicalRevoked: 0, legacyOutcome: 'deactivated', complete: true });
    expect(legacyRows()[0].active).toBe(false);
  });

  it('21. an unreadable CANONICAL governance read still throws, as before', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };
    await expect(releaseSuppression(ORG_A, 'phone', COMPACT)).rejects.toThrow();
  });
});

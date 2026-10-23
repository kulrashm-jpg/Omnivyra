/**
 * W2-B — suppression correctness at the Path A seam.
 *
 * Pins the three defects the W2-A audit confirmed, and the properties that
 * fixing them must not disturb:
 *
 *   C-1  Path A supplied no person anchor, so a canonical record anchored to a
 *        PERSON with no target — exactly what the W1 unsubscribe flow writes —
 *        was reported to the operator route as "not suppressed".
 *   C-2  the legacy `suppression_entries` write result was discarded, so a
 *        rejected mirror write returned success.
 *   C-3  the legacy deactivation result was discarded, so a release that only
 *        half happened was reported as complete.
 *
 * Everything here runs against a double of the database. It proves control flow,
 * query shape, precedence and the two uniqueness keys this seam depends on. It
 * does NOT prove PostgREST behaviour, real constraint enforcement or trigger
 * behaviour — those stay UNVERIFIED, because database access is prohibited in
 * this workstream.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  /** Tables that answer with a PostgREST-shaped error. */
  failures: {} as Record<string, { code: string; message: string }>,
  /** Tables whose client THROWS — a transport fault, not a query error. */
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

    /**
     * `uq_contact_governance_identity`, emulated:
     *   (organization_id, channel, governance_type, coalesce(person_id, target_normalized))
     *   among rows WHERE revoked_at IS NULL
     * Without it a replay would simply append a second row here and the
     * idempotency assertions below would be testing nothing.
     */
    const canonicalAnchor = (r: Row): unknown => r.person_id ?? r.target_normalized ?? null;
    const canonicalCollision = (candidate: Row): boolean =>
      rows().some((r) => (r.revoked_at ?? null) === null
        && r.organization_id === candidate.organization_id
        && r.channel === candidate.channel
        && r.governance_type === candidate.governance_type
        && canonicalAnchor(r) === canonicalAnchor(candidate));

    const exec = async (mode: 'many' | 'maybe'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.throws[table]) throw new Error(db.throws[table]);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        // Mirror the column defaults the real schema applies (20261003000000);
        // without them a freshly written record reads back with no start instant
        // and `mayContact` correctly judges it not yet in force — a defect of the
        // double, not of the code under test.
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const candidate = { ...defaults, ...(st.payload as Row) };

        if (table === 'contact_governance_records' && canonicalCollision(candidate)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_contact_governance_identity"' } };
        }
        // `uq_suppression (company_id, channel, target)` — the upsert target.
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  addSuppression,
  isSuppressed,
  releaseSuppression,
} from '../../services/execution/suppressionService';
import { evaluateGovernance } from '../../services/leadOutreachExecution/governance';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON = '00000000-0000-4000-8000-000000000001';
const PERSON_2 = '00000000-0000-4000-8000-000000000002';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';

/** A canonical record. `person_id` / `target_normalized` are set per test. */
const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: NORMALISED,
  channel: '*', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

/**
 * An `identity_claims` row — the canonical endpoint-to-person link. `platform` is
 * NULL for email and phone, which is why the real uniqueness index is NULLS NOT
 * DISTINCT.
 */
const claim = (over: Row = {}): Row => ({
  id: `c-${db.nextId++}`, organization_id: ORG_A, person_id: PERSON,
  claim_type: 'email', platform: null, normalized_value: NORMALISED, revoked_at: null,
  ...over,
});

const legacyRow = (over: Row = {}): Row => ({
  id: 'se-1', company_id: ORG_A, channel: 'email', target: NORMALISED,
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

// ── Phase 1 — C-1: a person-anchored restriction must reach Path A ───────────
describe('W2-B/C-1 — Path A resolves the person behind a recipient', () => {
  it('1. a PERSON-ANCHORED unsubscribe suppresses, though the caller supplied only an address', async () => {
    // The exact shape the W1 unsubscribe writer produces: anchored to the person,
    // no target at all. Before W2-B this read as `{ suppressed: false }`.
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'email' })];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    expect(r.store).toBe('canonical');
    expect(r.reason).toBe('unsubscribe');
  });

  it('2. the verdict reports that it matched on the PERSON, not the address', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'email' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).scope).toBe('person');
  });

  it('3. TARGET-anchored restrictions are untouched — the old path still works', async () => {
    db.tables.contact_governance_records = [govRow()];   // target-anchored, no claim at all

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.scope).toBe('target');
  });

  it('4. the claim lookup is TENANT-FIRST and does not widen the read', async () => {
    db.tables.identity_claims = [claim()];
    await isSuppressed(ORG_A, 'email', TARGET);

    const q = db.queries.find((x) => x.table === 'identity_claims');
    expect(q).toBeDefined();
    const cols = q!.filters.map(([, col]) => col);
    expect(cols[0]).toBe('organization_id');             // tenant FIRST, always
    expect(cols).toEqual(expect.arrayContaining(['normalized_value', 'revoked_at', 'claim_type']));
  });

  it('5. ANOTHER TENANT’s claim on the same address resolves no person here', async () => {
    db.tables.identity_claims = [claim({ organization_id: ORG_B })];
    // Their person-anchored restriction must not reach us, and their claim must
    // not anchor us to their person.
    db.tables.contact_governance_records = [govRow({ organization_id: ORG_B, person_id: PERSON, target_normalized: null })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('6. a person-anchored restriction in THIS tenant does not leak to another', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    expect((await isSuppressed(ORG_B, 'email', TARGET)).suppressed).toBe(false);
  });

  it('7. a REVOKED claim resolves no person — the tenant withdrew that belief', async () => {
    db.tables.identity_claims = [claim({ revoked_at: '2026-03-01T00:00:00.000Z' })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    // Deliberate, and consistent with `personErasure.loadContactPoints`, which
    // excludes revoked claims for the same reason.
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('8. an AMBIGUOUS address — two persons claiming it — FAILS CLOSED', async () => {
    db.tables.identity_claims = [
      claim({ claim_type: 'email', person_id: PERSON }),
      claim({ claim_type: 'phone', person_id: PERSON_2 }),
    ];

    // channel '*' asks for both contact claim types, so both rows are candidates.
    const r = await isSuppressed(ORG_A, '*', TARGET);

    expect(r).toMatchObject({
      suppressed: true,
      reason: 'governance_person_resolution_failed_failclosed',
      store: 'canonical',
    });
  });

  it('9. an UNREADABLE claims table FAILS CLOSED, and says so distinctly', async () => {
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    // NOT the governance-table reason: an operator must not be sent to the wrong table.
    expect(r.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('10. a THROWING claims client FAILS CLOSED too', async () => {
    db.throws.identity_claims = 'socket hang up';

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
  });

  it('11. an unreadable GOVERNANCE table still fails closed with its own reason', async () => {
    db.tables.identity_claims = [claim()];
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG_A, 'email', TARGET);
    expect(r).toMatchObject({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  });

  it('12. an EMAIL claim is not used to resolve a PHONE channel', async () => {
    db.tables.identity_claims = [claim({ claim_type: 'email' })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'phone' })];

    // The phone channel asks only for phone claims, so this address anchors nothing.
    expect((await isSuppressed(ORG_A, 'phone', '+1 555 010 0000')).suppressed).toBe(false);
  });

  it('13. a person-anchored record on ANOTHER channel does not block this one', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null, channel: 'phone' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('14. an unanchorable or tenant-less question NEVER becomes an authorization', async () => {
    expect(await isSuppressed(ORG_A, 'email', '   ')).toEqual({ suppressed: false });
    // ...and it reads nothing at all, so it cannot be mistaken for a decision.
    expect(db.queries).toHaveLength(0);

    const noTenant = await isSuppressed('', 'email', TARGET);
    expect(noTenant).toMatchObject({ suppressed: true, reason: 'suppression_no_tenant_failclosed' });
    expect(db.queries).toHaveLength(0);
  });
});

// ── Phase 2 — C-2 / C-3: a partial store write is never reported complete ───
describe('W2-B/C-2 — a legacy write failure is surfaced, not discarded', () => {
  const add = () => addSuppression({ companyId: ORG_A, channel: 'email', target: TARGET, reason: 'unsubscribe' });

  it('15. a legacy upsert ERROR yields an explicit incomplete result', async () => {
    db.failures.suppression_entries = { code: '23505', message: `duplicate key value ... (target)=(${NORMALISED})` };

    const r = await add();

    expect(r.canonicalId).toBeTruthy();                  // the canonical record landed
    expect(r.legacyRecorded).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.legacyError).toBe('legacy_write_failed:23505');
  });

  it('16. a legacy upsert THROW is handled the same way', async () => {
    db.throws.suppression_entries = 'socket hang up';

    const r = await add();
    expect(r.complete).toBe(false);
    expect(r.legacyError).toBe('legacy_write_exception');
  });

  it('17. the fault code NEVER carries the recipient', async () => {
    db.failures.suppression_entries = { code: '23505', message: `conflict on (target)=(${NORMALISED})` };

    const r = await add();
    expect(r.legacyError).not.toContain(NORMALISED);
    expect(r.legacyError).not.toContain('@');
  });

  it('18. the canonical restriction REMAINS EFFECTIVE after a failed mirror write', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };
    const r = await add();
    expect(r.complete).toBe(false);
    db.failures = {};

    // The point of not rolling back: the person stays protected.
    const check = await isSuppressed(ORG_A, 'email', TARGET);
    expect(check.suppressed).toBe(true);
    expect(check.store).toBe('canonical');
  });

  it('19. a CANONICAL write failure is still a rejection, never a partial success', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };
    await expect(add()).rejects.toThrow();
  });

  it('20. a fully successful write reports complete', async () => {
    const r = await add();
    expect(r).toMatchObject({ legacyRecorded: true, legacyError: null, complete: true });
    expect(r.canonicalId).toBeTruthy();
  });

  it('21. replay stays idempotent: one legacy row, one ACTIVE canonical record', async () => {
    const first = await add();
    const replay = await add();

    expect(first.complete).toBe(true);
    expect(replay.complete).toBe(true);
    // `uq_suppression` is the upsert target; `uq_contact_governance_identity`
    // makes the second canonical insert a 23505 the writer resolves to the
    // existing row.
    expect(db.tables.suppression_entries).toHaveLength(1);
    expect(db.tables.contact_governance_records.filter((r) => r.revoked_at == null)).toHaveLength(1);
    expect(replay.canonicalId).toBe(first.canonicalId);
  });
});

describe('W2-B/C-3 — a half-completed release is not reported as a release', () => {
  beforeEach(() => {
    db.tables.contact_governance_records = [govRow({ channel: 'email' })];
    db.tables.suppression_entries = [legacyRow()];
  });

  it('22. a legacy deactivation ERROR yields complete: false, with the canonical half counted', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r.canonicalRevoked).toBe(1);
    expect(r.legacyDeactivated).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.legacyError).toBe('legacy_release_failed:08006');
  });

  it('23. a legacy deactivation THROW is handled the same way', async () => {
    db.throws.suppression_entries = 'socket hang up';

    const r = await releaseSuppression(ORG_A, 'email', TARGET);
    expect(r.complete).toBe(false);
    expect(r.legacyError).toBe('legacy_release_exception');
  });

  it('24. the row that failed to deactivate STILL BLOCKS — which is why the claim matters', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };
    const r = await releaseSuppression(ORG_A, 'email', TARGET);
    expect(r.complete).toBe(false);
    db.failures = {};

    // Canonical is revoked, but the legacy row survived: the target is NOT released.
    const check = await isSuppressed(ORG_A, 'email', TARGET);
    expect(check.suppressed).toBe(true);
    expect(check.store).toBe('legacy');
  });

  it('25. a complete release reports complete, and the target is actually released', async () => {
    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r).toMatchObject({ canonicalRevoked: 1, legacyDeactivated: true, legacyError: null, complete: true });
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });

  it('26. repeating a release is SAFE, and reports what actually happened the second time', async () => {
    const first = await releaseSuppression(ORG_A, 'email', TARGET);
    const again = await releaseSuppression(ORG_A, 'email', TARGET);

    // Unchanged: idempotent and non-destructive.
    expect(again.canonicalRevoked).toBe(0);              // already revoked; ADR §16 keeps the row
    expect(db.tables.contact_governance_records).toHaveLength(1);
    expect(again.legacyError).toBeNull();                // a replay is not an error
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);

    // CHANGED BY R2, deliberately: the first release deactivated the legacy row;
    // the second matched nothing. Pre-R2 both answered `complete: true`, which is
    // the unverified-success claim M3 exploited. The replay now reports the state
    // its own result supports.
    expect(first).toMatchObject({ legacyOutcome: 'deactivated', complete: true });
    expect(again).toMatchObject({ legacyOutcome: 'no_match', complete: false });
  });
});

// ── D-4 — wildcard and exact-channel release semantics, both stores ──────────
describe('W2-B/D-4 — release stays channel-exact, symmetrically', () => {
  it('27. releasing one channel lifts neither store’s "*" restriction', async () => {
    db.tables.contact_governance_records = [govRow({ channel: '*' })];
    db.tables.suppression_entries = [legacyRow({ channel: '*' })];

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r.canonicalRevoked).toBe(0);
    expect(db.tables.contact_governance_records[0].revoked_at).toBeNull();
    expect(db.tables.suppression_entries[0].active).toBe(true);   // symmetric, by design
    // CHANGED BY R2: nothing failed and nothing matched, now reported as exactly
    // that instead of as a completed release. The channel-exact BEHAVIOUR above
    // is unchanged — both stores keep their `'*'` row.
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false, legacyError: null });
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });

  it('28. releasing "*" does not lift a channel-specific restriction', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'email' })];

    const r = await releaseSuppression(ORG_A, '*', TARGET);

    expect(r.canonicalRevoked).toBe(0);
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });
});

// ── Phase 3 — precedence and inventory ──────────────────────────────────────
describe('W2-B — canonical-first precedence is intact on both paths', () => {
  it('29. Path A: a canonical block answers before the legacy store is read at all', async () => {
    db.tables.contact_governance_records = [govRow()];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.store).toBe('canonical');
    expect(db.queries.some((q) => q.table === 'suppression_entries')).toBe(false);
  });

  it('30. Path A: a legacy row can ADD a suppression but can never lift a canonical one', async () => {
    db.tables.contact_governance_records = [govRow()];
    // A released legacy row is not a release of the canonical instruction.
    db.tables.suppression_entries = [legacyRow({ active: false, released_at: '2026-04-01T00:00:00.000Z' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('canonical');
  });

  it('31. Path A: a legacy-only row still blocks while the store is retained', async () => {
    db.tables.suppression_entries = [legacyRow({ channel: '*' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('legacy');
  });

  it('32. Path A: a GLOBAL legacy row still blocks — D-1 retires nothing in this slice', async () => {
    db.tables.suppression_entries = [legacyRow({ company_id: '__global__', channel: '*', scope: 'global', reason: 'legal_hold' })];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });

  it('33. Path B: the canonical verdict decides before any legacy scope is consulted', () => {
    const base = {
      task: { id: 't-1', planTaskId: null, leadId: 'L1', channel: 'email', companyId: ORG_A, requiresApproval: false } as never,
      config: { companyId: ORG_A, configured: true, enabled: true, killSwitch: false, enabledChannels: ['email'], restrictedRegions: [], dailyLimitTenant: null, dailyLimitLead: null },
      usage: { tenantCount: 0, leadCount: 0, windowHours: 24, layer: 'db' as const },
      globalKillSwitch: false,
      region: null,
      evaluatedAt: '2026-05-01T00:00:00.000Z',
    };

    const canonicalBlocks = evaluateGovernance({
      ...base,
      suppressions: { task: false, lead: false, channel: false, recipient: false },
      canonicalGovernance: {
        decision: 'blocked', gate: 4, governanceType: 'unsubscribe', recordId: 'g1',
        matchedBy: 'person', reason: 'blocked_by_unsubscribe', deferredUntil: null, version: 'li3c',
      },
    });
    expect(canonicalBlocks.decision).toBe('blocked');
    expect(canonicalBlocks.blockingCondition).toBe('governance.unsubscribe');

    // ...and with canonical silent, a legacy scope can still ADD a block.
    const legacyAdds = evaluateGovernance({
      ...base,
      suppressions: { task: false, lead: false, channel: false, recipient: true },
      canonicalGovernance: null,
    });
    expect(legacyAdds.decision).toBe('blocked');
    expect(legacyAdds.blockingCondition).toBe('suppression.recipient');
  });
});

describe('W2-B — architectural inventory', () => {
  const ROOT = join(__dirname, '..', '..', '..');

  /** Source trees that ship. `scripts/` is excluded: it is tooling, not the app. */
  const APP_DIRS = ['backend', 'lib', 'pages', 'hooks', 'components'];

  /** Path-aware exclusions, matched on path SEGMENTS, never as substrings. */
  const EXCLUDED_SEGMENTS = ['node_modules', '.next', 'tests', '__tests__', '__mocks__'];

  const sourceFiles = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (abs: string): void => {
      let entries: string[];
      try { entries = readdirSync(abs); } catch { return; }
      for (const name of entries) {
        if (EXCLUDED_SEGMENTS.includes(name)) continue;
        const full = join(abs, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) { walk(full); continue; }
        if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
      }
    };
    walk(join(ROOT, dir));
    return out;
  };

  /** Comments stripped, so a table named in prose is never mistaken for a call. */
  const code = (file: string): string =>
    readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const rel = (f: string): string => relative(ROOT, f).split(sep).join('/');

  const TABLE_REF = String.raw`ownedDbTable\(\s*(?:['"]outreach_suppressions['"]|OUTREACH_SUPPRESSIONS_TABLE)\s*\)`;
  const writeCall = new RegExp(`${TABLE_REF}\\s*\\.\\s*(?:insert|upsert|update|delete)\\b`);
  const readCall = new RegExp(TABLE_REF);

  const files = APP_DIRS.flatMap(sourceFiles);

  it('34. the scan actually works — it finds the known READ site', () => {
    // Guards the assertion below from passing because the scan found nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel).filter((f) => readCall.test(code(join(ROOT, f)))))
      .toContain('backend/services/leadOutreachExecution/governanceService.ts');
  });

  it('35. `outreach_suppressions` has NO application writer', () => {
    // W2-A C-6: the schema offers recipient/channel/task/lead scopes and nothing
    // in the application writes any of them. The only INSERT in the repository
    // is the WS-3 Milestone-8 certification fixture, which refuses to run
    // anywhere but a local certification instance. If a writer is ever added
    // deliberately, update this test together with the suppression contract —
    // do not delete it.
    expect(files.filter((f) => writeCall.test(code(f))).map(rel)).toEqual([]);
  });

  it('36. `suppression_entries` is still REACHED by ONE module only', () => {
    // Phase 4C-2 retargeted this. It used to assert that only one module
    // mentioned the string anywhere, which stopped being the right proxy once
    // the observability vocabulary gained a `'suppression_entries'` member: the
    // invariant held while the grep broke. What matters is who can REACH the
    // table, so that is what is asserted — the module that binds it as a table
    // name, and nobody querying it by literal.
    const binds = files.filter((f) => /=\s*'suppression_entries'/.test(code(f))).map(rel);
    expect(binds).toEqual(['backend/services/execution/suppressionService.ts']);

    const queriesByLiteral = files
      .filter((f) => /ownedDbTable\(\s*'suppression_entries'\s*\)/.test(code(f)))
      .map(rel);
    expect(queriesByLiteral).toEqual([]);
  });
});

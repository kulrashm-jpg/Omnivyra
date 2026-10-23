/**
 * W2-A PHASE 4A — Path A and Path B share ONE canonical evaluation edge, and
 * nothing else.
 *
 * The refactor is only safe if two things are simultaneously true:
 *
 *   SHARED      — given the same tenant, anchors, channel and instant, both
 *                 paths reach the SAME canonical verdict. Proved DIFFERENTIALLY
 *                 below rather than by grepping for an import: a behavioural
 *                 agreement across every dimension of the policy is what
 *                 "one evaluator" actually means.
 *   NOT SHARED  — each path keeps its OWN identity resolver and its OWN legacy
 *                 store. Phase 4A is explicitly not legacy convergence, so
 *                 Path A must still never see `outreach_suppressions` and
 *                 Path B must still never see `suppression_entries`.
 *
 * Both are asserted on observed database traffic, not on source text.
 *
 * Runs against a double. PostgREST behaviour, real constraints and triggers
 * remain UNVERIFIED — database access is prohibited in this workstream.
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

import { isSuppressed, releaseSuppression } from '../../services/execution/suppressionService';
import {
  loadSuppressionMatches,
  resolveCanonicalGovernanceWithAnchor,
} from '../../services/leadOutreachExecution/governanceService';
import { recordContactGovernance } from '../../services/prospectIdentity/contactGovernanceWriter';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON = '00000000-0000-4000-8000-000000000001';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';
const NOW = '2026-06-01T00:00:00.000Z';

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: NORMALISED,
  channel: 'email', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

const claim = (over: Row = {}): Row => ({
  id: `c-${db.nextId++}`, organization_id: ORG_A, person_id: PERSON,
  claim_type: 'email', platform: null, normalized_value: NORMALISED, revoked_at: null,
  ...over,
});

/**
 * A Path B task. `personId` is the Contract 12 stored anchor — step 2 of the
 * frozen order — so Path B resolves identity WITHOUT touching `identity_claims`.
 */
const task = (over: Record<string, unknown> = {}): never => ({
  id: 't-1', planTaskId: null, leadId: 'L1', companyId: ORG_A,
  channel: 'email', personId: null, requiresApproval: false,
  ...over,
}) as never;

/** Path A's answer, reduced to the policy outcome. */
const pathA = async (channel = 'email', target = TARGET, org = ORG_A) => {
  const r = await isSuppressed(org, channel, target);
  return { blocked: r.suppressed === true, type: r.reason ?? null, matchedBy: r.scope ?? null };
};

/** Path B's canonical answer, reduced to the same shape. */
const pathB = async (over: Record<string, unknown> = {}, recipient: string | null = TARGET, org = ORG_A) => {
  const { verdict } = await resolveCanonicalGovernanceWithAnchor(org, task(over), recipient, null, NOW);
  if (!verdict) return { blocked: false, type: null, matchedBy: null };
  // An ALLOWED verdict still carries `reason: 'no_governance_record_applies'`,
  // which is an explanation rather than a governance type. Only a refusal names
  // a type, so only a refusal reports one — otherwise the two paths would be
  // compared on a field that means different things.
  const blocked = verdict.decision !== 'allowed';
  return {
    blocked,
    type: blocked ? (verdict.governanceType ?? verdict.reason ?? null) : null,
    matchedBy: blocked ? (verdict.matchedBy ?? null) : null,
  };
};

const tablesQueried = (): string[] => [...new Set(db.queries.map((q) => q.table))];

beforeEach(() => {
  db.tables = {
    contact_governance_records: [], suppression_entries: [], outreach_suppressions: [],
    identity_claims: [], leads: [],
  };
  db.failures = {};
  db.throws = {};
  db.queries = [];
  db.nextId = 1;
});

// ── SHARED: both paths reach the same canonical verdict ─────────────────────
describe('Phase 4A — the two paths agree on every canonical dimension', () => {
  /**
   * Each case seeds one canonical state and asserts BOTH paths reduce it to the
   * same outcome. Path A resolves the person from `identity_claims`; Path B from
   * the stored task anchor. Different evidence, same verdict — which is only
   * possible if one evaluator decides.
   */
  const CASES: Array<{
    name: string;
    records: Row[];
    claims?: Row[];
    taskOver?: Record<string, unknown>;
    channel?: string;
    expected: { blocked: boolean; type: string | null; matchedBy: string | null };
  }> = [
    {
      name: 'target-anchored unsubscribe',
      records: [govRow()],
      expected: { blocked: true, type: 'unsubscribe', matchedBy: 'target' },
    },
    {
      name: 'person-anchored unsubscribe (no target on the record)',
      records: [govRow({ person_id: PERSON, target_normalized: null })],
      claims: [claim()],
      taskOver: { personId: PERSON },
      expected: { blocked: true, type: 'unsubscribe', matchedBy: 'person' },
    },
    {
      name: 'wildcard channel record blocks a specific channel',
      records: [govRow({ channel: '*' })],
      expected: { blocked: true, type: 'unsubscribe', matchedBy: 'target' },
    },
    {
      name: 'record on another channel does not apply',
      records: [govRow({ channel: 'phone' })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
    {
      name: 'REVOKED record decides nothing',
      records: [govRow({ revoked_at: '2026-05-01T00:00:00.000Z' })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
    {
      name: 'NOT YET effective record decides nothing',
      records: [govRow({ effective_from: '2099-01-01T00:00:00.000Z' })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
    {
      name: 'LAPSED record decides nothing',
      records: [govRow({ governance_type: 'deferred', effective_until: '2026-02-01T00:00:00.000Z' })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
    {
      name: 'band precedence: dnc_permanent (3) beats deferred (6)',
      records: [
        govRow({ id: 'g-d', channel: '*', governance_type: 'deferred', effective_until: '2099-01-01T00:00:00.000Z' }),
        govRow({ id: 'g-p', channel: '*', governance_type: 'dnc_permanent' }),
      ],
      expected: { blocked: true, type: 'dnc_permanent', matchedBy: 'target' },
    },
    {
      name: 'band precedence: unsubscribe (4) beats bounce_hard (5)',
      records: [
        govRow({ id: 'g-b', governance_type: 'bounce_hard' }),
        govRow({ id: 'g-u', governance_type: 'unsubscribe' }),
      ],
      expected: { blocked: true, type: 'unsubscribe', matchedBy: 'target' },
    },
    {
      name: 'a live DEFERMENT is not an allow',
      records: [govRow({ governance_type: 'deferred', effective_until: '2099-01-01T00:00:00.000Z' })],
      expected: { blocked: true, type: 'deferred', matchedBy: 'target' },
    },
    {
      name: 'campaign_exclusion (band 9) is INERT',
      records: [govRow({ governance_type: 'campaign_exclusion' })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
    {
      name: 'another tenant’s record never decides for this one',
      records: [govRow({ organization_id: ORG_B })],
      expected: { blocked: false, type: null, matchedBy: null },
    },
  ];

  it.each(CASES)('$name — Path A and Path B agree', async ({ records, claims, taskOver, channel, expected }) => {
    db.tables.contact_governance_records = records.map((r) => ({ ...r }));
    db.tables.identity_claims = (claims ?? []).map((c) => ({ ...c }));
    const a = await pathA(channel ?? 'email');

    // Reset observed state between the two paths so neither sees the other's
    // queries, then seed the identical canonical state again.
    db.tables.contact_governance_records = records.map((r) => ({ ...r }));
    db.queries = [];
    const b = await pathB(taskOver ?? {}, TARGET, ORG_A);

    expect(a).toEqual(expected);
    expect(b).toEqual(expected);
    expect(a).toEqual(b);
  });

  it('a cross-tenant IDENTITY cannot carry a verdict between tenants', async () => {
    // ORG_B holds the claim and the person-anchored record; we ask as ORG_A.
    db.tables.identity_claims = [claim({ organization_id: ORG_B })];
    db.tables.contact_governance_records = [govRow({ organization_id: ORG_B, person_id: PERSON, target_normalized: null })];

    expect(await pathA()).toEqual({ blocked: false, type: null, matchedBy: null });
    expect(await pathB({ personId: PERSON })).toEqual({ blocked: false, type: null, matchedBy: null });
  });

  it('every canonical read is tenant-first, on both paths', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow()];
    await pathA();
    await pathB({ personId: PERSON });

    const canonical = db.queries.filter((q) => q.table === 'contact_governance_records');
    expect(canonical.length).toBeGreaterThan(0);
    for (const q of canonical) expect(q.filters[0][1]).toBe('organization_id');
  });
});

// ── NOT SHARED: each path keeps its own identity resolver ───────────────────
describe('Phase 4A — identity resolution stays path-specific', () => {
  it('Path A resolves identity from `identity_claims`', async () => {
    db.tables.identity_claims = [claim()];
    await pathA();
    expect(tablesQueried()).toContain('identity_claims');
  });

  it('Path B does NOT consult `identity_claims` — it uses the Contract 13 anchor order', async () => {
    db.tables.identity_claims = [claim()];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    const b = await pathB({ personId: PERSON });

    expect(b.blocked).toBe(true);
    expect(b.matchedBy).toBe('person');
    expect(tablesQueried()).not.toContain('identity_claims');
  });

  it('Path B falls through to `leads` when the task carries no anchor', async () => {
    db.tables.leads = [{ id: 'L1', company_id: ORG_A, unified_person_id: PERSON }];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];

    const b = await pathB();

    expect(b).toEqual({ blocked: true, type: 'unsubscribe', matchedBy: 'person' });
    expect(tablesQueried()).toContain('leads');
    expect(tablesQueried()).not.toContain('identity_claims');
  });

  it('Path B keeps ABSENCE distinct from FAILURE: an unreadable `leads` row blocks', async () => {
    db.failures.leads = { code: '08006', message: 'connection failure' };

    const { verdict, anchor } = await resolveCanonicalGovernanceWithAnchor(ORG_A, task(), TARGET, null, NOW);

    expect(anchor.ok).toBe(false);
    expect(verdict!.decision).toBe('blocked');
    expect(verdict!.reason).toBe('governance_person_resolution_failed_failclosed');
  });

  it('Path B treats a genuinely absent person as DEGRADED, not blocked', async () => {
    // `leads` answers, and the answer is that there is no canonical person.
    db.tables.leads = [{ id: 'L1', company_id: ORG_A, unified_person_id: null }];

    const { verdict, anchor } = await resolveCanonicalGovernanceWithAnchor(ORG_A, task(), TARGET, null, NOW);

    expect(anchor.ok).toBe(true);
    expect(anchor.degraded).toBe(true);
    expect(verdict!.decision).toBe('allowed');
  });

  it('Path A fails closed on an ambiguous or unreadable claims table', async () => {
    db.tables.identity_claims = [
      claim({ claim_type: 'email', person_id: PERSON }),
      claim({ claim_type: 'phone', person_id: '00000000-0000-4000-8000-000000000002' }),
    ];
    const ambiguous = await isSuppressed(ORG_A, '*', TARGET);
    expect(ambiguous).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });

    db.tables.identity_claims = [];
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };
    const unreadable = await isSuppressed(ORG_A, 'email', TARGET);
    expect(unreadable).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
  });
});

// ── NOT SHARED: each path keeps its own legacy store ───────────────────────
describe('Phase 4A — legacy readers are NOT converged', () => {
  it('Path A reads `suppression_entries` and never `outreach_suppressions`', async () => {
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG_A, channel: '*', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: true, released_at: null,
    }];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, store: 'legacy' });
    expect(tablesQueried()).toContain('suppression_entries');
    expect(tablesQueried()).not.toContain('outreach_suppressions');
  });

  it('Path A still honours the `__global__` sentinel — Path-A-only, pending D-1', async () => {
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: '__global__', channel: '*', target: NORMALISED,
      reason: 'legal_hold', scope: 'global', active: true, released_at: null,
    }];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });

  it('Path B reads `outreach_suppressions` and never `suppression_entries`', async () => {
    db.tables.outreach_suppressions = [{ company_id: ORG_A, scope: 'recipient', value: NORMALISED, revoked_at: null }];

    const matches = await loadSuppressionMatches(ORG_A, task(), NORMALISED);

    expect(matches.recipient).toBe(true);
    expect(tablesQueried()).toContain('outreach_suppressions');
    expect(tablesQueried()).not.toContain('suppression_entries');
  });

  it('Path B keeps its task/lead scopes — Path-B-only, pending D-3', async () => {
    db.tables.outreach_suppressions = [
      { company_id: ORG_A, scope: 'task', value: 't-1', revoked_at: null },
      { company_id: ORG_A, scope: 'lead', value: 'L1', revoked_at: null },
    ];

    const matches = await loadSuppressionMatches(ORG_A, task(), NORMALISED);
    expect(matches.task).toBe(true);
    expect(matches.lead).toBe(true);
  });

  it('each path fails closed on its OWN legacy store, in its own shape', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };
    expect(await isSuppressed(ORG_A, 'email', TARGET)).toMatchObject({
      suppressed: true, reason: 'suppression_lookup_error_failclosed', store: 'legacy',
    });

    db.failures = { outreach_suppressions: { code: '08006', message: 'connection failure' } };
    // All four scopes true — an unreadable list is never "nobody is suppressed".
    // Phase 4C-2 added `readCompleted` alongside them, so this pins the four
    // booleans (unchanged) AND the new flag, rather than the whole object.
    const failed = await loadSuppressionMatches(ORG_A, task(), NORMALISED);
    expect(failed).toMatchObject({ task: true, lead: true, channel: true, recipient: true });
    expect(failed.readCompleted).toBe(false);
  });
});

// ── Canonical-first precedence, unchanged by the refactor ──────────────────
describe('Phase 4A — canonical state cannot be weakened by legacy state', () => {
  it('Path A short-circuits on a canonical block — the legacy table is never read', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [];

    const r = await isSuppressed(ORG_A, 'email', TARGET);

    expect(r.store).toBe('canonical');
    expect(tablesQueried()).not.toContain('suppression_entries');
  });

  it('a RELEASED legacy row does not lift a live canonical restriction', async () => {
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG_A, channel: 'email', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: false, released_at: '2026-04-01T00:00:00.000Z',
    }];

    expect((await isSuppressed(ORG_A, 'email', TARGET)).store).toBe('canonical');
  });

  it('a canonical read failure fails closed on BOTH paths, each in its own vocabulary', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    expect(await isSuppressed(ORG_A, 'email', TARGET)).toMatchObject({
      suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical',
    });

    const { verdict } = await resolveCanonicalGovernanceWithAnchor(ORG_A, task({ personId: PERSON }), TARGET, null, NOW);
    expect(verdict).toMatchObject({
      decision: 'blocked', reason: 'governance_lookup_failed_failclosed', version: 'li3c', gate: null,
    });
  });

  it('a THROWING canonical client also fails closed on both paths', async () => {
    db.throws.contact_governance_records = 'socket hang up';

    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);

    const { verdict } = await resolveCanonicalGovernanceWithAnchor(ORG_A, task({ personId: PERSON }), TARGET, null, NOW);
    expect(verdict).toMatchObject({ decision: 'blocked', reason: 'governance_lookup_failed_failclosed' });
  });
});

// ── Release semantics, unchanged ───────────────────────────────────────────
describe('Phase 4A — wildcard and exact-channel release are untouched', () => {
  it('releasing one channel lifts neither store’s "*" restriction', async () => {
    db.tables.contact_governance_records = [govRow({ channel: '*' })];
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG_A, channel: '*', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: true, released_at: null,
    }];

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    expect(r.canonicalRevoked).toBe(0);
    // CHANGED BY R2: nothing matched, so completion is no longer claimed. The
    // channel-exact behaviour this test exists for is unchanged.
    expect(r).toMatchObject({ legacyOutcome: 'no_match', complete: false });
    expect(db.tables.suppression_entries[0].active).toBe(true);
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(true);
  });

  it('an exact-channel release revokes exactly that record', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'email' })];

    const r = await releaseSuppression(ORG_A, 'email', TARGET);

    // CHANGED BY R2: the canonical record IS revoked and the contact IS released,
    // but this fixture seeds no legacy row, so the legacy half matched nothing and
    // `complete` reports that rather than asserting a verified full release.
    expect(r).toMatchObject({ canonicalRevoked: 1, legacyOutcome: 'no_match', complete: false });
    expect((await isSuppressed(ORG_A, 'email', TARGET)).suppressed).toBe(false);
  });
});

// ── The W1 linkage, through the real writer ────────────────────────────────
describe('Phase 4A — unsubscribe → check_suppression stays correct', () => {
  it('a restriction written exactly as the W1 unsubscribe flow writes it is honoured by Path A', async () => {
    // The REAL canonical writer, with the exact argument set `feedbackIngestion`
    // uses for an `unsubscribed` outcome: person-anchored, channel-scoped, NO
    // target. (W1-C's own suite covers event -> writer; this covers
    // writer -> operator check, which is the half C-1 broke.)
    const written = await recordContactGovernance({
      organizationId: ORG_A,
      governanceType: 'unsubscribe',
      channel: 'email',
      personId: PERSON,
      source: 'outreach_feedback',
      evidence: { provider: 'ses' },
      effectiveFrom: '2026-05-01T00:00:00.000Z',
    });
    expect(written.id).toBeTruthy();

    // The stored row really is person-anchored with no target.
    const stored = db.tables.contact_governance_records[0];
    expect(stored.person_id).toBe(PERSON);
    expect(stored.target_normalized).toBeNull();

    // The operator check resolves the person from the endpoint and reports it.
    db.tables.identity_claims = [claim()];
    const check = await isSuppressed(ORG_A, 'email', TARGET);

    expect(check).toMatchObject({ suppressed: true, reason: 'unsubscribe', scope: 'person', store: 'canonical' });
  });

  it('and the same restriction is honoured by Path B', async () => {
    await recordContactGovernance({
      organizationId: ORG_A,
      governanceType: 'unsubscribe',
      channel: 'email',
      personId: PERSON,
      source: 'outreach_feedback',
      evidence: { provider: 'ses' },
      effectiveFrom: '2026-05-01T00:00:00.000Z',
    });

    const b = await pathB({ personId: PERSON });
    expect(b).toEqual({ blocked: true, type: 'unsubscribe', matchedBy: 'person' });
  });
});

/**
 * PHASE 4C-2 — `scopesEvaluated` is observability metadata derived from what
 * actually happened, and nothing else.
 *
 * The contract these tests pin:
 *   - a scope is reported ONLY after its read has successfully completed;
 *   - a canonical short-circuit, a failed read and a non-decision report no
 *     scope for the store they never reached — and the FIELD IS OMITTED when
 *     nothing was evaluated, so existing response shapes are untouched;
 *   - Path A reports `suppression_entries` and never `outreach_suppressions.*`;
 *     Path B reports `outreach_suppressions.*` and never `suppression_entries`;
 *   - a target-only evaluation never claims person-anchored governance was
 *     evaluated;
 *   - and NONE of it changes a verdict.
 *
 * Runs against a double. Real constraints, RLS and PostgREST remain UNVERIFIED.
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
        if (kind === 'gte') return String(r[col] ?? '') >= String(val);
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
      gte: (c: string, v: unknown) => { st.filters.push(['gte', c, v]); return b; },
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
import {
  evaluateTaskGovernance,
  loadSuppressionMatches,
  resolveCanonicalGovernanceWithAnchor,
} from '../../services/leadOutreachExecution/governanceService';
import { evaluateGovernance } from '../../services/leadOutreachExecution/governance';
import { evaluateCanonicalGovernance } from '../../services/prospectIdentity/contactGovernanceEvaluation';

const ORG = '00000000-0000-4000-8000-00000000000a';
const PERSON = '00000000-0000-4000-8000-000000000001';
const TARGET = 'CTO@Example.Test';
const NORMALISED = 'cto@example.test';
const NOW = '2026-06-01T00:00:00.000Z';
const TASK_ID = 't-1';
const LEAD = 'L1';

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

const taskObj = (over: Record<string, unknown> = {}): never => ({
  id: TASK_ID, planTaskId: null, leadId: LEAD, companyId: ORG,
  channel: 'email', personId: null, requiresApproval: false,
  ...over,
}) as never;

/** Seed everything `evaluateTaskGovernance` needs for a clean ALLOW. */
const seedPathB = (over: Record<string, unknown> = {}): void => {
  // `rowToOutreachTask` returns null unless company_id, lead_id AND
  // plan_task_id are all present, so the row must carry a plan task id or the
  // task reads as "not found" and nothing downstream runs.
  db.tables.outreach_tasks = [{
    id: TASK_ID, company_id: ORG, lead_id: LEAD, plan_task_id: 'task-1-intro',
    person_id: null, channel: 'email', status: 'approved', requires_approval: false,
    planner_version: 'p', translation_version: 't', governance_version: 'g',
    execution_runtime_version: 'r', materialized_at: NOW,
    ...over,
  }];
  db.tables.outreach_governance_config = [{
    company_id: ORG, enabled: true, kill_switch: false,
    enabled_channels: ['email'], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null,
  }];
  db.tables.outreach_attempts = [];
  db.tables.outreach_decisions = [];
};

beforeEach(() => {
  db.tables = {
    contact_governance_records: [], suppression_entries: [], outreach_suppressions: [],
    identity_claims: [], leads: [], outreach_tasks: [], outreach_governance_config: [],
    outreach_attempts: [], outreach_decisions: [],
  };
  db.failures = {};
  db.throws = {};
  db.queries = [];
  db.nextId = 1;
});

// ── Path A ──────────────────────────────────────────────────────────────────
describe('4C-2 Path A — reports only what it read', () => {
  it('1. canonical allow + successful legacy read reports BOTH, target-only', async () => {
    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.suppressed).toBe(false);
    expect(r.scopesEvaluated).toEqual(['canonical.target', 'suppression_entries']);
    // A target-only evaluation must NOT claim person-anchored governance.
    expect(r.scopesEvaluated).not.toContain('canonical.person');
  });

  it('2. with a resolved person it reports BOTH canonical anchors', async () => {
    db.tables.identity_claims = [claim()];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.scopesEvaluated).toEqual(['canonical.person', 'canonical.target', 'suppression_entries']);
  });

  it('3. a canonical BLOCK short-circuits — `suppression_entries` is NOT reported', async () => {
    db.tables.contact_governance_records = [govRow()];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r.suppressed).toBe(true);
    expect(r.scopesEvaluated).toEqual(['canonical.target']);
    expect(r.scopesEvaluated).not.toContain('suppression_entries');
    // ...and the claim is true: the store really was never queried.
    expect(db.queries.some((q) => q.table === 'suppression_entries')).toBe(false);
  });

  it('4. a canonical DEFERRAL short-circuits identically', async () => {
    db.tables.contact_governance_records = [govRow({ governance_type: 'deferred', effective_until: '2099-01-01T00:00:00.000Z' })];

    const r = await isSuppressed(ORG, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.scopesEvaluated).toEqual(['canonical.target']);
  });

  it('5. a legacy-only block reports both — legacy ADDS, canonical had completed', async () => {
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG, channel: '*', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: true, released_at: null,
    }];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, store: 'legacy' });
    expect(r.scopesEvaluated).toEqual(['canonical.target', 'suppression_entries']);
  });

  it('6. Path A NEVER reports an `outreach_suppressions` scope', async () => {
    db.tables.outreach_suppressions = [{ company_id: ORG, scope: 'recipient', value: NORMALISED, revoked_at: null }];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect((r.scopesEvaluated ?? []).some((s) => s.startsWith('outreach_suppressions'))).toBe(false);
    expect(db.queries.some((q) => q.table === 'outreach_suppressions')).toBe(false);
  });

  it('7. a FAILED legacy read is not reported as evaluated — canonical still is', async () => {
    db.failures.suppression_entries = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'suppression_lookup_error_failclosed' });
    expect(r.scopesEvaluated).toEqual(['canonical.target']);
    expect(r.scopesEvaluated).not.toContain('suppression_entries');
  });

  it('8. a THROWING legacy read behaves the same', async () => {
    db.throws.suppression_entries = 'socket hang up';

    const r = await isSuppressed(ORG, 'email', TARGET);
    expect(r.suppressed).toBe(true);
    expect(r.scopesEvaluated).toEqual(['canonical.target']);
  });

  it('9. a FAILED canonical read reports NOTHING, and the shape is unchanged', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    // Exactly the pre-4C-2 shape — the field is absent, not empty.
    expect(r).toEqual({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
    expect('scopesEvaluated' in r).toBe(false);
  });

  it('10. a failed IDENTITY read reports nothing evaluated', async () => {
    db.failures.identity_claims = { code: '08006', message: 'connection failure' };

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, reason: 'governance_person_resolution_failed_failclosed' });
    expect('scopesEvaluated' in r).toBe(false);
  });

  it('11. tenant rejection happens BEFORE any store is evaluated', async () => {
    const r = await isSuppressed('', 'email', TARGET);

    expect(r).toEqual({ suppressed: true, reason: 'suppression_no_tenant_failclosed' });
    expect('scopesEvaluated' in r).toBe(false);
    expect(db.queries).toHaveLength(0);
  });

  it('12. an empty target is a non-decision and keeps its exact shape', async () => {
    const r = await isSuppressed(ORG, 'email', '   ');

    expect(r).toEqual({ suppressed: false });
    expect('scopesEvaluated' in r).toBe(false);
    expect(db.queries).toHaveLength(0);
  });
});

// ── Path B ──────────────────────────────────────────────────────────────────
describe('4C-2 Path B — reports only what it read', () => {
  it('13. canonical allow + successful legacy read reports canonical AND the applicable legacy scopes', async () => {
    seedPathB();

    const res = await evaluateTaskGovernance(ORG, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.ok).toBe(true);
    expect(res.scopesEvaluated).toEqual([
      'canonical.target',
      'outreach_suppressions.recipient',
      'outreach_suppressions.channel',
      'outreach_suppressions.task',
      'outreach_suppressions.lead',
    ]);
  });

  it('14. Path B NEVER reports `suppression_entries`', async () => {
    seedPathB();
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG, channel: '*', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: true, released_at: null,
    }];

    const res = await evaluateTaskGovernance(ORG, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.scopesEvaluated).not.toContain('suppression_entries');
    expect(db.queries.some((q) => q.table === 'suppression_entries')).toBe(false);
  });

  it('15. a scope with NO VALUE to match on is not claimed as evaluated', async () => {
    seedPathB();

    // No recipient supplied: nothing a recipient-scoped row could have matched.
    const res = await evaluateTaskGovernance(ORG, TASK_ID, { evaluatedAt: NOW });

    expect(res.scopesEvaluated).not.toContain('outreach_suppressions.recipient');
    expect(res.scopesEvaluated).toContain('outreach_suppressions.task');
  });

  it('16. a FAILED legacy read is not reported as evaluated, and still fails closed', async () => {
    seedPathB();
    db.failures.outreach_suppressions = { code: '08006', message: 'connection failure' };

    const res = await evaluateTaskGovernance(ORG, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    // Unchanged fail-closed behaviour: all four scopes true, so it blocks.
    expect(res.evaluation!.decision).toBe('blocked');
    expect((res.scopesEvaluated ?? []).some((s) => s.startsWith('outreach_suppressions'))).toBe(false);
    // The canonical read did complete, and is reported.
    expect(res.scopesEvaluated).toEqual(['canonical.target']);
  });

  it('17. `loadSuppressionMatches` distinguishes a completed read from a failed one', async () => {
    const ok = await loadSuppressionMatches(ORG, taskObj(), NORMALISED);
    expect(ok).toMatchObject({ readCompleted: true, recipient: false });

    db.failures.outreach_suppressions = { code: '08006', message: 'connection failure' };
    const failed = await loadSuppressionMatches(ORG, taskObj(), NORMALISED);
    // The four booleans are IDENTICAL to the pre-4C-2 fail-closed shape.
    expect(failed).toMatchObject({ task: true, lead: true, channel: true, recipient: true, readCompleted: false });
  });

  it('18. a canonical read failure reports nothing evaluated', async () => {
    seedPathB();
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const { verdict, scopes } = await resolveCanonicalGovernanceWithAnchor(ORG, taskObj(), TARGET, null, NOW);

    expect(verdict).toMatchObject({ decision: 'blocked', reason: 'governance_lookup_failed_failclosed' });
    expect(scopes).toEqual([]);
  });

  it('19. the "canonical layer does not apply" exit reports nothing', async () => {
    const { verdict, scopes } = await resolveCanonicalGovernanceWithAnchor(ORG, taskObj(), null, null, NOW);

    expect(verdict).toBeNull();
    expect(scopes).toEqual([]);
  });

  it('20. a degraded (target-only) identity does not claim person governance', async () => {
    db.tables.leads = [{ id: LEAD, company_id: ORG, unified_person_id: null }];

    const { anchor, scopes } = await resolveCanonicalGovernanceWithAnchor(ORG, taskObj(), TARGET, null, NOW);

    expect(anchor.degraded).toBe(true);
    expect(scopes).toEqual(['canonical.target']);
  });

  it('21. a resolved person reports both canonical anchors', async () => {
    const { anchor, scopes } = await resolveCanonicalGovernanceWithAnchor(ORG, taskObj({ personId: PERSON }), TARGET, null, NOW);

    expect(anchor.personId).toBe(PERSON);
    expect(scopes).toEqual(['canonical.person', 'canonical.target']);
  });

  it('22. a failed identity read reports nothing evaluated', async () => {
    db.failures.leads = { code: '08006', message: 'connection failure' };

    const { anchor, scopes } = await resolveCanonicalGovernanceWithAnchor(ORG, taskObj(), TARGET, null, NOW);

    expect(anchor.ok).toBe(false);
    expect(scopes).toEqual([]);
  });

  it('23. an unknown task keeps its exact pre-4C-2 result shape', async () => {
    const res = await evaluateTaskGovernance(ORG, 'no-such-task', { evaluatedAt: NOW });

    expect(res).toEqual({ ok: false, evaluation: null, recorded: false, error: 'no such task for this tenant' });
    expect('scopesEvaluated' in res).toBe(false);
  });
});

// ── The metadata cannot change a verdict ────────────────────────────────────
describe('4C-2 — metadata is inert', () => {
  const base = {
    task: taskObj(),
    config: { companyId: ORG, configured: true, enabled: true, killSwitch: false, enabledChannels: ['email'], restrictedRegions: [], dailyLimitTenant: null, dailyLimitLead: null },
    usage: { tenantCount: 0, leadCount: 0, windowHours: 24, layer: 'db' as const },
    globalKillSwitch: false,
    region: null,
    evaluatedAt: NOW,
    canonicalGovernance: null,
  };

  it('24. `readCompleted` does not affect the pure evaluator', () => {
    const none = { task: false, lead: false, channel: false, recipient: false };

    const without = evaluateGovernance({ ...base, suppressions: none });
    const withTrue = evaluateGovernance({ ...base, suppressions: { ...none, readCompleted: true } });
    const withFalse = evaluateGovernance({ ...base, suppressions: { ...none, readCompleted: false } });

    expect(withTrue.decision).toBe(without.decision);
    expect(withFalse.decision).toBe(without.decision);
    expect(withTrue.blockingCondition).toBe(without.blockingCondition);
    expect(withFalse.blockingCondition).toBe(without.blockingCondition);
  });

  it('25. the same canonical state yields the same verdict whatever was reported', async () => {
    db.tables.contact_governance_records = [govRow()];
    const targetOnly = await isSuppressed(ORG, 'email', TARGET);

    db.tables.contact_governance_records = [govRow()];
    db.tables.identity_claims = [claim()];
    const withPerson = await isSuppressed(ORG, 'email', TARGET);

    // Different metadata, identical decision.
    expect(targetOnly.scopesEvaluated).not.toEqual(withPerson.scopesEvaluated);
    expect(withPerson.suppressed).toBe(targetOnly.suppressed);
    expect(withPerson.reason).toBe(targetOnly.reason);
  });

  it('26. the shared edge reports nothing when it was given no anchor at all', async () => {
    const r = await evaluateCanonicalGovernance({
      organizationId: ORG, channel: 'email', personId: null, target: null, now: NOW,
    });

    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.scopesEvaluated).toEqual([]);
    // Nothing could match, so the reader returns without querying at all.
    expect(db.queries.some((q) => q.table === 'contact_governance_records')).toBe(false);
  });

  it('27. a legacy-only restriction still cannot relax canonical governance', async () => {
    // Canonical blocks; a RELEASED legacy row must not lift it, and the scope
    // list must not imply the legacy store was consulted.
    db.tables.contact_governance_records = [govRow()];
    db.tables.suppression_entries = [{
      id: 'se-1', company_id: ORG, channel: 'email', target: NORMALISED,
      reason: 'manual', scope: 'tenant', active: false, released_at: '2026-04-01T00:00:00.000Z',
    }];

    const r = await isSuppressed(ORG, 'email', TARGET);

    expect(r).toMatchObject({ suppressed: true, store: 'canonical' });
    expect(r.scopesEvaluated).toEqual(['canonical.target']);
  });
});

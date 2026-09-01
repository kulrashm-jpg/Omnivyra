/**
 * A3 — Contracts 12 and 13: the canonical person anchor for outreach.
 *
 * What these tests are actually for. The anchor changes WHICH identity a
 * governance verdict is computed from, and getting that wrong is not a cosmetic
 * bug: resolving the wrong person means enforcing the wrong do-not-contact
 * record, and resolving none silently means enforcing a strictly weaker rule set
 * while the audit log claims a normal evaluation. So the properties under test
 * are the order itself, the two distinct failure modes (read failure vs true
 * absence), tenant isolation of the verdict, and — new in A3 — that the
 * degradation is actually written down.
 *
 * The database double mirrors the real constraints that matter here: per-table
 * failure injection, and `contact_governance_records` answering only the anchor
 * a given query filtered on, exactly as the repository's two narrow reads do.
 */

type Row = Record<string, unknown>;

type Filter = [kind: 'eq' | 'is' | 'in' | 'gte', column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  /** Per-table error injection, for the fail-closed tests. */
  failures: {} as Record<string, { code: string; message: string }>,
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

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        const created = { id: `${table}-${db.nextId++}`, ...(st.payload as Row) };
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
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePersonAnchor, resolveLeadPersonId } from '../../services/leadOutreachExecution/personAnchor';
import {
  evaluateTaskGovernance,
  resolveCanonicalGovernanceWithAnchor,
} from '../../services/leadOutreachExecution/governanceService';
import { setOutreachTaskPersonId } from '../../services/leadOutreachExecution/storage';
import type { OutreachTask } from '../../services/leadOutreachExecution/types';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const PERSON_TASK = 'person-on-task';
const PERSON_LEAD = 'person-on-lead';
const PERSON_EXPLICIT = 'person-explicit';
const LEAD = 'lead-1';
const TASK_ID = 'task-uuid-1';
const TARGET = 'cto@example.test';
const NOW = '2026-09-01T12:00:00.000Z';

const task = (over: Partial<OutreachTask> = {}): OutreachTask => ({
  id: TASK_ID, companyId: ORG_A, leadId: LEAD, planTaskId: 'task-1-intro', personId: null,
  taskOrder: 1, kind: 'outreach', action: 'Send intro', channel: 'email',
  dependsOnPlanTaskId: null, estimatedDelayHours: 0, confidence: 0.7, explanation: 'x',
  status: 'approved', deliveryStatus: null, requiresApproval: true,
  plannerVersion: 'p', translationVersion: 't', governanceVersion: 'g',
  executionRuntimeVersion: 'r', materializedAt: NOW, createdAt: NOW, updatedAt: NOW,
  ...over,
});

/** A stored outreach_tasks row, as the double would hold it. */
const taskRow = (over: Row = {}): Row => ({
  id: TASK_ID, company_id: ORG_A, lead_id: LEAD, plan_task_id: 'task-1-intro',
  person_id: null, channel: 'email', status: 'approved', requires_approval: true,
  planner_version: 'p', translation_version: 't', governance_version: 'g',
  execution_runtime_version: 'r', materialized_at: NOW, ...over,
});

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG_A, person_id: null, target_normalized: null,
  channel: '*', governance_type: 'dnc_permanent',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

beforeEach(() => {
  db.tables = {
    leads: [{ id: LEAD, company_id: ORG_A, unified_person_id: PERSON_LEAD }],
    outreach_tasks: [taskRow()],
    outreach_governance_config: [{
      company_id: ORG_A, enabled: true, kill_switch: false,
      enabled_channels: ['email'], restricted_regions: [],
      daily_limit_tenant: null, daily_limit_lead: null,
    }],
    outreach_suppressions: [],
    outreach_attempts: [],
    outreach_decisions: [],
    contact_governance_records: [],
  };
  db.failures = {};
  db.queries = [];
  db.nextId = 1;
});

const decisions = (): Row[] => db.tables.outreach_decisions ?? [];
const tablesTouched = (): string[] => [...new Set(db.queries.map((q) => q.table))];

// ───────────────────────────────────────────────────────────────────────────
// Contract 13 — the resolution order
// ───────────────────────────────────────────────────────────────────────────

describe('A3 / Contract 13 — the person anchor resolution order', () => {
  it('1. an explicit caller-supplied personId WINS over the stored anchor and the lead', async () => {
    const r = await resolvePersonAnchor(ORG_A, task({ personId: PERSON_TASK }), PERSON_EXPLICIT);
    expect(r).toEqual({ ok: true, personId: PERSON_EXPLICIT, source: 'explicit', degraded: false, reason: null });
    // Nothing was read: the strongest evidence short-circuits every lookup.
    expect(db.queries).toHaveLength(0);
  });

  it('2. the STORED outreach_tasks.person_id is used when no explicit id is given', async () => {
    const r = await resolvePersonAnchor(ORG_A, task({ personId: PERSON_TASK }), null);
    expect(r).toEqual({ ok: true, personId: PERSON_TASK, source: 'task', degraded: false, reason: null });
    // The Contract 12 anchor also removes the per-evaluation `leads` read.
    expect(tablesTouched()).not.toContain('leads');
  });

  it('3. falls back to leads.unified_person_id when neither is present', async () => {
    const r = await resolvePersonAnchor(ORG_A, task(), null);
    expect(r).toEqual({ ok: true, personId: PERSON_LEAD, source: 'lead', degraded: false, reason: null });
    expect(tablesTouched()).toContain('leads');
  });

  it('4. a lead that is not canonicalised is UNRESOLVED — absence, not failure', async () => {
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];
    const r = await resolvePersonAnchor(ORG_A, task(), null);
    expect(r).toEqual({
      ok: true, personId: null, source: 'none', degraded: true,
      reason: 'lead_absent_or_not_canonicalised',
    });
  });

  it('4b. a task with no lead id at all is unresolved, and reports why', async () => {
    const r = await resolvePersonAnchor(ORG_A, task({ leadId: '' }), null);
    expect(r.source).toBe('none');
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('task_has_no_lead_id');
    expect(r.ok).toBe(true);
  });

  it('5. an UNREADABLE leads table fails closed — ok:false, never a silent absence', async () => {
    db.failures.leads = { code: '08006', message: 'connection reset' };
    const r = await resolvePersonAnchor(ORG_A, task(), null);
    expect(r.ok).toBe(false);
    expect(r.personId).toBeNull();
    expect(r.reason).toBe('lead_person_resolution_failed');
  });

  it('6. tenant mismatch: another tenant’s lead resolves to nothing, not to their person', async () => {
    // The row exists, but company_id is the FIRST predicate, so ORG_B sees none.
    expect(await resolveLeadPersonId(ORG_B, LEAD)).toEqual({ ok: true, personId: null });
    const leadQuery = db.queries.find((q) => q.table === 'leads');
    expect(leadQuery!.filters[0]).toEqual(['eq', 'company_id', ORG_B]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract 13 — the verdict, and its recorded identity
// ───────────────────────────────────────────────────────────────────────────

describe('A3 / Contract 13 — governance evaluated against the anchor', () => {
  it('7. a person-anchored DNC on the STORED anchor blocks, via mayContact', async () => {
    db.tables.outreach_tasks = [taskRow({ person_id: PERSON_TASK })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON_TASK })];

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.ok).toBe(true);
    expect(res.evaluation!.decision).toBe('blocked');
    expect(res.evaluation!.blockedBy).toBe('suppression');
    expect(res.evaluation!.blockingCondition).toBe('governance.dnc_permanent');
    expect(res.identity).toMatchObject({ personId: PERSON_TASK, source: 'task', degraded: false });
  });

  it('8. TENANT MISMATCH REFUSED — another tenant’s person-anchored DNC never applies', async () => {
    // The record is real, and names the very person the caller supplied. It
    // belongs to ORG_B, so it must not reach an ORG_A evaluation.
    db.tables.contact_governance_records = [
      govRow({ id: 'g-b', organization_id: ORG_B, person_id: PERSON_EXPLICIT }),
    ];

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, {
      recipient: TARGET, personId: PERSON_EXPLICIT, evaluatedAt: NOW,
    });

    expect(res.evaluation!.decision).toBe('allowed');
    expect(res.identity).toMatchObject({ personId: PERSON_EXPLICIT, source: 'explicit' });
    // The tenant is the first predicate on the canonical read.
    const govQuery = db.queries.find((q) => q.table === 'contact_governance_records');
    expect(govQuery!.filters[0]).toEqual(['eq', 'organization_id', ORG_A]);
  });

  it('9. an unreadable governance table FAILS CLOSED — blocked, not allowed', async () => {
    db.failures.contact_governance_records = { code: '08006', message: 'connection failure' };

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.decision).toBe('blocked');
    expect(res.evaluation!.blockedBy).toBe('suppression');
    expect(decisions()[0].decision).toBe('denied');
  });

  it('9b. an unreadable leads table also fails closed, through the same one shape', async () => {
    db.failures.leads = { code: '08006', message: 'connection reset' };

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.decision).toBe('blocked');
    expect(res.evaluation!.blockingCondition).toBe('governance.blocked');
    expect(res.identity!.ok).toBe(false);
  });

  it('10. the TARGET-ONLY FALLBACK IS RECORDED on the persisted decision', async () => {
    // No stored anchor, and a lead that was never canonicalised: identity is
    // genuinely absent, matching degrades to the target alone, and that must be
    // visible in the log rather than inferred from its absence.
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.decision).toBe('allowed');
    expect(res.recorded).toBe(true);

    const row = decisions()[0];
    expect(row.identity_anchor).toBe('none');
    expect(row.identity_degraded).toBe(true);
    expect(row.person_id).toBeNull();
  });

  it('11. a RESOLVED anchor is recorded too, and is not marked degraded', async () => {
    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.decision).toBe('allowed');
    const row = decisions()[0];
    expect(row.identity_anchor).toBe('lead');
    expect(row.identity_degraded).toBe(false);
    expect(row.person_id).toBe(PERSON_LEAD);
  });

  it('11b. identity_degraded is always exactly (identity_anchor === "none")', async () => {
    // The invariant `outreach_decisions_identity_coherent` enforces in the
    // database. Asserted here too, so a writer drift is caught before it
    // reaches a constraint violation in production.
    for (const link of [PERSON_LEAD, null]) {
      db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: link }];
      db.tables.outreach_decisions = [];
      await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });
      const row = decisions()[0];
      expect(row.identity_degraded).toBe(row.identity_anchor === 'none');
    }
  });

  it('12. a legacy outreach_suppressions recipient entry still blocks', async () => {
    db.tables.outreach_suppressions = [{ company_id: ORG_A, scope: 'recipient', value: TARGET, revoked_at: null }];

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.decision).toBe('blocked');
    expect(res.evaluation!.blockingCondition).toBe('suppression.recipient');
  });

  it('13. the FROZEN gate order is unchanged: kill_switch is still evaluated first', async () => {
    db.tables.outreach_governance_config = [];   // unconfigured tenant => blocked at gate 1

    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });

    expect(res.evaluation!.gates.map((g) => g.gate)).toEqual(['kill_switch']);
    expect(res.evaluation!.blockedBy).toBe('kill_switch');
  });

  it('13b. a fully allowed evaluation still runs all five gates in the frozen order', async () => {
    const res = await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });
    expect(res.evaluation!.gates.map((g) => g.gate))
      .toEqual(['kill_switch', 'suppression', 'region', 'approval', 'rate_limit']);
  });

  it('14. resolveCanonicalGovernanceWithAnchor reports the anchor the verdict was computed from', async () => {
    db.tables.outreach_tasks = [taskRow({ person_id: PERSON_TASK })];
    db.tables.contact_governance_records = [govRow({ person_id: PERSON_TASK })];

    const { verdict, anchor } = await resolveCanonicalGovernanceWithAnchor(
      ORG_A, task({ personId: PERSON_TASK }), TARGET, null, NOW,
    );

    expect(verdict!.decision).toBe('blocked');
    expect(verdict!.matchedBy).toBe('person');
    expect(anchor.personId).toBe(PERSON_TASK);
    expect(anchor.source).toBe('task');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract 12 — the stored anchor's write path
// ───────────────────────────────────────────────────────────────────────────

describe('A3 / Contract 12 — setOutreachTaskPersonId', () => {
  it('anchors a task, tenant-scoped', async () => {
    const r = await setOutreachTaskPersonId(ORG_A, TASK_ID, PERSON_TASK);
    expect(r).toEqual({ ok: true, changed: true });
    expect(db.tables.outreach_tasks[0].person_id).toBe(PERSON_TASK);
  });

  it('refuses to touch another tenant’s task — changed:false, not an error', async () => {
    const r = await setOutreachTaskPersonId(ORG_B, TASK_ID, PERSON_TASK);
    expect(r).toEqual({ ok: true, changed: false });
    expect(db.tables.outreach_tasks[0].person_id).toBeNull();
  });

  it('reports a cross-tenant person (23503) as the tenant error it is', async () => {
    db.failures.outreach_tasks = { code: '23503', message: 'violates foreign key constraint' };
    const r = await setOutreachTaskPersonId(ORG_A, TASK_ID, 'person-from-another-tenant');
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.error).toMatch(/no such person in this tenant/);
  });

  it('unanchoring with null is legal', async () => {
    db.tables.outreach_tasks = [taskRow({ person_id: PERSON_TASK })];
    const r = await setOutreachTaskPersonId(ORG_A, TASK_ID, null);
    expect(r).toEqual({ ok: true, changed: true });
    expect(db.tables.outreach_tasks[0].person_id).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Exclusion: consent_records
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — consent_records is EXCLUDED', () => {
  it('15. no evaluation ever queries consent_records', async () => {
    await evaluateTaskGovernance(ORG_A, TASK_ID, { recipient: TARGET, evaluatedAt: NOW });
    expect(tablesTouched()).not.toContain('consent_records');
    expect(tablesTouched().length).toBeGreaterThan(0);   // the double really ran
  });

  it('16. no file A3 owns carries an executable reference to consent_records', () => {
    // Comments are stripped first, deliberately. Several of these files DISCUSS
    // the exclusion at length — saying why a table is out of scope is the
    // opposite of touching it — so a naive text match would fail on its own
    // documentation. What must not exist is a reference the runtime can act on:
    // a quoted table name in TypeScript, or an identifier in SQL.
    const stripComments = (src: string): string => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // TS block comments
      .replace(/^\s*\/\/.*$/gm, ' ')       // TS line comments
      .replace(/--.*$/gm, ' ');            // SQL line comments

    const root = join(__dirname, '..', '..', '..');
    const owned = [
      'backend/services/leadOutreachExecution/personAnchor.ts',
      'backend/services/leadOutreachExecution/governanceService.ts',
      'backend/services/leadOutreachExecution/governance.ts',
      'backend/services/leadOutreachExecution/storage.ts',
      'backend/services/leadOutreachExecution/types.ts',
      'backend/services/execution/suppressionService.ts',
      'supabase/migrations/20261011000000_a3_outreach_person_anchor.sql',
      'supabase/migrations/rollbacks/a3_outreach_person_anchor_rollback.sql',
    ];
    for (const rel of owned) {
      const code = stripComments(readFileSync(join(root, rel), 'utf8'));
      expect(code).not.toMatch(/consent_records/);
    }
  });
});

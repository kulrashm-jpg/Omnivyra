/**
 * PI-EXECUTION-SUBJECT-IMPL-024 — the explicit execution subject.
 *
 * Substrate C (022) makes one planner serve two subject kinds. The database's
 * guarantees — the re-keyed profile identity, the kind CHECK, tenant isolation —
 * are proven against real PostgreSQL in
 * `backend/tests/realschema/pi_execution_subject_024.test.ts`.
 *
 * What belongs HERE is what is a decision rather than a constraint: that an
 * unknown kind fails closed instead of defaulting to `lead`, that the person is
 * resolved from the subject's OWN table, that quota and suppression are scoped to
 * the canonical person with a distinguishable fail-closed path, and that the
 * website lead route is behaviourally unchanged.
 *
 * PORTED 2026-10-28 (feat/orchestration-core) from refs/preserve/wt/pi-consol.
 * This slice carries 024's SUBJECT TYPE and SUBJECT-AWARE PERSON RESOLUTION only.
 * Two parts of 024 are deliberately NOT here, and neither are their tests:
 *   - the person-keyed WS-3 quota (G): on main most outreach tasks have no person
 *     anchor yet, so a quota that refuses an unresolved person would stop existing
 *     dispatch — an owner decision, landing with the WS-3 reconciliation slice;
 *   - the 1108 profile re-keying migration (D, F): destructive (drops
 *     lead_intelligence_profiles.lead_id), landing with the subject-identity slice.
 */

import {
  SUBJECT_KINDS, SUBJECT_SOURCE_TABLE, isSubjectKind, parseSubjectRef,
  parseSubjectScopedRef, leadSubject, prospectSubject, describeSubject,
  assertNeverSubject, SubjectError,
} from '../../services/executionSubject/subjectRef';

// ── A. The subject type ─────────────────────────────────────────────────────

describe('024 — the subject type', () => {
  it('(A) supports exactly two kinds, and names each one’s table', () => {
    expect([...SUBJECT_KINDS]).toEqual(['lead', 'prospect']);
    expect(SUBJECT_SOURCE_TABLE).toEqual({ lead: 'leads', prospect: 'canonical_leads' });
  });

  it('(A) accepts a lead and a prospect', () => {
    expect(parseSubjectRef('lead', 'L1')).toEqual({ kind: 'lead', id: 'L1' });
    expect(parseSubjectRef('prospect', 'P1')).toEqual({ kind: 'prospect', id: 'P1' });
    expect(leadSubject('L1')).toEqual({ kind: 'lead', id: 'L1' });
    expect(prospectSubject('P1')).toEqual({ kind: 'prospect', id: 'P1' });
  });

  it('(A) AN UNKNOWN KIND FAILS CLOSED — it never defaults to `lead`', () => {
    for (const bad of ['person', 'account', 'LEAD', '', null, undefined, 42, {}]) {
      let caught: unknown = null;
      try { parseSubjectRef(bad, 'X'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(SubjectError);
      expect((caught as SubjectError).code).toBe('unknown_subject_kind');
    }
    // The point of the guard: a silent fallback would reinterpret a prospect as
    // a website lead and lose its person.
    expect(() => parseSubjectRef('prospekt', 'P1')).toThrow(/unknown execution subject kind/);
  });

  it('(A) refuses an empty id, and does NOT impose a uuid format', () => {
    expect(() => parseSubjectRef('lead', '  ')).toThrow(/requires an id/);
    // `outreach_tasks.lead_id` has always been text. 024 adds the KIND, not a new
    // constraint on the id — tightening that is a separate change.
    expect(parseSubjectRef('lead', 'not-a-uuid').id).toBe('not-a-uuid');
  });

  it('(A) a tenant-scoped ref requires its tenant', () => {
    expect(parseSubjectScopedRef('co1', 'lead', 'L1'))
      .toEqual({ companyId: 'co1', kind: 'lead', id: 'L1' });
    expect(() => parseSubjectScopedRef('', 'lead', 'L1')).toThrow(/never tenant-less/);
  });

  it('(A) the subject carries NO person and NO tenant inside its identity', () => {
    const s = leadSubject('L1') as unknown as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(['id', 'kind']);
    for (const banned of ['personId', 'person_id', 'companyId', 'company_id', 'unifiedPersonId']) {
      expect(s).not.toHaveProperty(banned);
    }
  });

  it('(A) describeSubject is a stable log form, and the kind discriminates', () => {
    expect(describeSubject(leadSubject('X'))).toBe('lead:X');
    expect(describeSubject(prospectSubject('X'))).toBe('prospect:X');
    // The same raw id under two kinds is two different subjects.
    expect(describeSubject(leadSubject('X'))).not.toBe(describeSubject(prospectSubject('X')));
  });

  it('(A) isSubjectKind is total, and the exhaustiveness helper fails closed', () => {
    expect(isSubjectKind('lead')).toBe(true);
    expect(isSubjectKind('prospect')).toBe(true);
    expect(isSubjectKind('other')).toBe(false);
    expect(() => assertNeverSubject('other' as never)).toThrow(/unhandled execution subject kind/);
  });
});

// ── C. Person resolution, from the subject's OWN table ──────────────────────

type Row = Record<string, unknown>;

const anchorDb = {
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  rows: {} as Record<string, Row[]>,
  error: null as null | { code?: string; message?: string },
};

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    // `gte` is a RANGE, not equality — modelling it as equality would make every
    // windowed count come back empty and the test would prove nothing.
    const ranges: Array<[string, unknown]> = [];
    const exec = async () => {
      anchorDb.queries.push({ table, filters: [...filters] });
      if (anchorDb.error) return { data: null, error: anchorDb.error };
      const rows = (anchorDb.rows[table] ?? [])
        .filter((r) => filters.every(([c, v]) => r[c] === v))
        .filter((r) => ranges.every(([c, v]) => String(r[c] ?? '') >= String(v)));
      return { data: rows, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { ranges.push([c, v]); return b; },
      in: () => b,
      limit: () => exec(),
      order: () => exec(),
      maybeSingle: () => exec(),
      single: () => exec(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

import {
  resolveSubjectPersonId, resolveLeadPersonId,
} from '../../services/leadOutreachExecution/personAnchor';
import { readDurableUsage, reserveQuota } from '../../services/leadOutreachExecution/quota';

const ORG = 'co-1';
const ORG_B = 'co-2';
const PERSON = 'person-1';

beforeEach(() => { anchorDb.queries = []; anchorDb.rows = {}; anchorDb.error = null; });

describe('024 — person resolution is per subject KIND', () => {
  it('(C) a LEAD resolves through leads.unified_person_id', async () => {
    anchorDb.rows.leads = [{ id: 'L1', company_id: ORG, unified_person_id: PERSON }];
    const r = await resolveSubjectPersonId(ORG, leadSubject('L1'));
    expect(r).toEqual({ ok: true, personId: PERSON });
    expect(anchorDb.queries[0].table).toBe('leads');
  });

  it('(C) a PROSPECT resolves through canonical_leads.unified_person_id', async () => {
    anchorDb.rows.canonical_leads = [{ id: 'P1', company_id: ORG, unified_person_id: PERSON }];
    const r = await resolveSubjectPersonId(ORG, prospectSubject('P1'));
    expect(r).toEqual({ ok: true, personId: PERSON });
    // THE DEFECT 024 REMOVES: before this, a prospect id was looked up in `leads`,
    // matched nothing, and returned personId: null as "not a failure".
    expect(anchorDb.queries[0].table).toBe('canonical_leads');
  });

  it('(B) THE TENANT IS THE FIRST PREDICATE, for both kinds', async () => {
    anchorDb.rows.leads = [{ id: 'L1', company_id: ORG, unified_person_id: PERSON }];
    anchorDb.rows.canonical_leads = [{ id: 'P1', company_id: ORG, unified_person_id: PERSON }];
    await resolveSubjectPersonId(ORG, leadSubject('L1'));
    await resolveSubjectPersonId(ORG, prospectSubject('P1'));
    for (const q of anchorDb.queries) expect(q.filters[0]).toEqual(['company_id', ORG]);
  });

  it('(B) neither kind resolves ACROSS a tenant', async () => {
    anchorDb.rows.leads = [{ id: 'L1', company_id: ORG, unified_person_id: PERSON }];
    anchorDb.rows.canonical_leads = [{ id: 'P1', company_id: ORG, unified_person_id: PERSON }];
    expect(await resolveSubjectPersonId(ORG_B, leadSubject('L1'))).toEqual({ ok: true, personId: null });
    expect(await resolveSubjectPersonId(ORG_B, prospectSubject('P1'))).toEqual({ ok: true, personId: null });
  });

  it('(C) nullable person semantics are PRESERVED — an unanchored subject is not a failure', async () => {
    anchorDb.rows.canonical_leads = [{ id: 'P1', company_id: ORG, unified_person_id: null }];
    expect(await resolveSubjectPersonId(ORG, prospectSubject('P1'))).toEqual({ ok: true, personId: null });
  });

  it('(C) an unreadable row FAILS CLOSED via ok:false', async () => {
    anchorDb.error = { code: '08006', message: 'down' };
    expect(await resolveSubjectPersonId(ORG, leadSubject('L1'))).toEqual({ ok: false, personId: null });
  });

  it('(C) an UNKNOWN kind fails closed rather than reading a table', async () => {
    const r = await resolveSubjectPersonId(ORG, { kind: 'person' as never, id: 'X' });
    expect(r).toEqual({ ok: false, personId: null });
    expect(anchorDb.queries).toHaveLength(0);
  });

  it('(I) the pre-024 helper still works and asserts the LEAD kind', async () => {
    anchorDb.rows.leads = [{ id: 'L1', company_id: ORG, unified_person_id: PERSON }];
    expect(await resolveLeadPersonId(ORG, 'L1')).toEqual({ ok: true, personId: PERSON });
    expect(anchorDb.queries[0].table).toBe('leads');
    // It cannot be used to smuggle a prospect id into the lead branch undetected:
    // the id is simply looked up in `leads`, where it does not exist.
    anchorDb.queries = [];
    expect(await resolveLeadPersonId(ORG, 'P1')).toEqual({ ok: true, personId: null });
  });
});

// ── G. Quota is PER CANONICAL PERSON ───────────────────────────────────────

// 024 (G) — the person-keyed quota — lands with the WS-3 reconciliation slice; see the header.

describe('024 — forbidden scope, proven by content', () => {
  const read = (rel: string): string =>
    require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const sql = (s: string) => s.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON [\s\S]*?';/g, '');
  // The orchestration migrations this slice adds. None may reach a WS-3 table.
  const PORTED = [
    'supabase/migrations/20270111100000_pi_prospect_campaigns.sql',
    'supabase/migrations/20270111100001_pi_workflow_definitions.sql',
    'supabase/migrations/20270111100002_pi_execution_instances.sql',
    'supabase/migrations/20270111100003_pi_execution_plans.sql',
    'supabase/migrations/20270111100004_pi_execution_step_scheduling.sql',
    'supabase/migrations/20270111100005_pi_outreach_bridge.sql',
  ];

  it('(E) the task identity is UNTOUCHED', () => {
    const ws3 = read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql');
    expect(ws3).toMatch(
      /CONSTRAINT outreach_tasks_identity_unique UNIQUE \(company_id, lead_id, plan_task_id\)/,
    );
    // No orchestration migration may go near it (the bridge's OWN
    // outreach_bridge_handoffs table is the one outreach_* table it may alter).
    const alters = /ALTER TABLE\s+(public\.)?outreach_(?!bridge_handoffs\b)/i;
    const drops = /DROP\s+[^;]*outreach_tasks/i;
    // The guard is not vacuous: it does catch an ALTER of a WS-3 table, and it
    // does let the bridge's own table through.
    expect(alters.test('ALTER TABLE public.outreach_tasks ADD COLUMN x int')).toBe(true);
    expect(alters.test('ALTER TABLE public.outreach_bridge_handoffs ENABLE ROW LEVEL SECURITY')).toBe(false);
    for (const m of PORTED) {
      const body = sql(read(m));
      expect({ m, alters: alters.test(body) }).toEqual({ m, alters: false });
      expect({ m, drops: drops.test(body) }).toEqual({ m, drops: false });
    }
  });

  it('(E) plan_task_id generation is UNCHANGED', () => {
    expect(read('backend/services/automationExecution/taskGenerator.ts'))
      .toMatch(/id: `task-\$\{order\}-\$\{slug\(action\)\}`/);
  });

  it('(E) the outcome schema is UNCHANGED', () => {
    expect(read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql'))
      .toMatch(/CONSTRAINT outreach_outcomes_idempotent UNIQUE \(company_id, task_id, outcome_type, occurred_at\)/);
  });

  it('mayContact is NOT modified by 024', () => {
    const gov = code(read('backend/services/prospectIdentity/contactGovernance.ts'));
    // Its contract: tenant mandatory, person/target anchored, bands 3–6.
    expect(gov).toMatch(/mayContact: organizationId is required/);
    expect(gov).toMatch(/GATE_BAND\[x\.record\.governanceType\] >= 3/);
    // And 024 introduced no subject concept into it.
    expect(gov).not.toMatch(/subject_kind|SubjectRef|subjectKind/);
  });

  it('quota did NOT become channel-aware', () => {
    const q = code(read('backend/services/leadOutreachExecution/quota.ts'));
    expect(q).toMatch(/ws3:quota:lead:/); // lead-keyed in this slice; person-keyed lands with WS-3 reconciliation
    expect(q).toMatch(/ws3:quota:tenant:/);
    // Exactly two key builders, and neither takes a channel.
    expect([...q.matchAll(/ws3:quota:/g)]).toHaveLength(2);
    expect(q).not.toMatch(/ws3:quota:channel|channel.*quota.*key/i);
  });

  it('the 24-hour window is unchanged', () => {
    expect(read('backend/services/leadOutreachExecution/quota.ts'))
      .toMatch(/QUOTA_WINDOW_HOURS = 24/);
  });

  // (D) 1108 re-keying assertions land with the subject-identity slice.

  it('the subject module reaches NO database and NO other service', () => {
    const src = code(read('backend/services/executionSubject/subjectRef.ts'));
    expect(src).not.toMatch(/^import/m);
    expect(src).not.toMatch(/ownedDbTable|supabase|fetch\(/);
  });

  it('no semantic consumer still assumes leadId === leads.id', () => {
    // The snapshot source's subject dispatch lands with the subject-identity slice;
    // person resolution (this slice) dispatches on the kind.
    const anchor = code(read('backend/services/leadOutreachExecution/personAnchor.ts'));
    expect(anchor).toMatch(/case 'prospect':/);
    expect(anchor).toMatch(/canonical_leads/);
  });

  // (D)/(F) snapshot and ICP-context assertions land with the subject-identity slice.

  it('(F) the planner’s hardcoded ICP is NOT treated as authoritative by 024', () => {
    // 020 ruled it non-authoritative for PI. 024 may not consume it as if it were.
    const touched = [
      'backend/services/executionSubject/subjectRef.ts',
      'backend/services/leadIntelligenceOrchestration/snapshotSource.ts',
    ];
    for (const f of touched) {
      const src = code(read(f));
      expect(src).not.toMatch(/ICP_COMPANY_SIZES|ICP_INDUSTRIES/);
    }
  });
});

/**
 * PI-033 — the Execution Instance.
 *
 * The database's guarantees — the partial unique index that makes active
 * uniqueness an invariant, the narrow identity guard that freezes attribution
 * while lifecycle still moves, five composite tenant-safe foreign keys, atomic
 * creation with the version resolved by status, and Target agreement — are proven
 * against real PostgreSQL in
 * `backend/tests/realschema/pi_execution_instances_033.test.ts`.
 *
 * What belongs HERE is what is a DECISION rather than a constraint: that the store
 * is the sole writer, that no caller can supply a Workflow Version, that creation
 * is a single atomic RPC rather than a sequence, that the surface offers no delete
 * and no identity edit, that the migration states its own invariants, and that the
 * routes keep the interim capability boundary with the verified tenant.
 */

type Row = Record<string, unknown>;

const db = {
  ops: [] as Array<{ table: string; op: string; payload: Row; filters: Array<[string, unknown]> }>,
  rows: {} as Record<string, Row[]>,
  error: null as null | { code?: string; message?: string },
};

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const st = { op: 'select', cols: '*', payload: {} as Row, filters: [] as Array<[string, unknown]> };
    const inFilters: Array<[string, unknown[]]> = [];
    const exec = async (mode: 'many' | 'one') => {
      if (st.op !== 'select') {
        db.ops.push({ table, op: st.op, payload: st.payload, filters: [...st.filters] });
      }
      if (db.error) { const e = db.error; db.error = null; return { data: null, error: e }; }
      const existing = (db.rows[table] ??= []);
      if (st.op === 'insert') {
        const created = { id: `row-${existing.length + 1}`, ...st.payload };
        existing.push(created);
        return { data: mode === 'one' ? created : [created], error: null };
      }
      let matching = existing.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      for (const [col, vals] of inFilters) {
        matching = matching.filter((r) => vals.includes(r[col]));
      }
      if (st.op === 'update') {
        for (const r of matching) Object.assign(r, st.payload, { updated_at: 't2' });
        return { data: matching, error: null };
      }
      if (st.op === 'delete') {
        db.rows[table] = existing.filter((r) => !matching.includes(r));
        return { data: matching, error: null };
      }
      return { data: mode === 'one' ? matching[0] ?? null : matching, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      in: (c: string, v: unknown[]) => { inFilters.push([c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      single: () => exec('one'),
      maybeSingle: () => exec('one'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
let rpcBehaviour: (params: Record<string, unknown>) => unknown = () => ({
  data: [{ create_execution_instance: '00000000-0000-4000-8000-000000000001' }], error: null,
});

jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return rpcBehaviour(params);
    },
  },
}));

import {
  createExecutionInstance, getExecutionInstance, setExecutionInstanceState,
  listCampaignExecutionInstances, listSubjectExecutionInstances,
  getOccupiedExecutionInstance,
  ExecutionInstanceError, EXECUTION_INSTANCES_TABLE, CREATE_EXECUTION_INSTANCE_FN,
  SUBJECT_KINDS, LIFECYCLE_STATES, OCCUPIED_LIFECYCLE_STATES, TERMINAL_LIFECYCLE_STATES,
  isOccupiedState, isTerminalState,
} from '../../services/executionInstances/executionInstanceStore';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const CMP = '00000000-0000-4000-8000-0000000000f1';
const WF = '00000000-0000-4000-8000-0000000000e1';
const VER = '00000000-0000-4000-8000-0000000000d1';
const PROSPECT = '00000000-0000-4000-8000-0000000000c1';
const TARGET = '00000000-0000-4000-8000-0000000000b1';
const INSTANCE = '00000000-0000-4000-8000-000000000001';

const read = (rel: string): string =>
  require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STORE = 'backend/services/executionInstances/executionInstanceStore.ts';
const MIGRATION = 'supabase/migrations/20270111100002_pi_execution_instances.sql';
// The campaign is a PATH PARENT, matching every other prospect-campaigns
// sub-resource. An earlier draft took `campaignId` in the query/body on a flat
// `/api/execution-instances` route and route-auth R3 correctly failed it.
const ROUTES = [
  'pages/api/prospect-campaigns/[id]/execution-instances.ts',
  'pages/api/execution-instances/[id].ts',
];

/** The row the double hands back after a successful RPC. */
const seedInstance = (over: Row = {}): void => {
  db.rows[EXECUTION_INSTANCES_TABLE] = [{
    id: INSTANCE, organization_id: ORG, campaign_id: CMP, workflow_id: WF,
    workflow_version_id: VER, target_id: null, subject_kind: 'prospect',
    subject_id: PROSPECT, lifecycle_state: 'created', created_at: 't1', updated_at: 't1',
    ...over,
  }];
};

const createInput = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, campaignId: CMP, workflowId: WF,
  subjectKind: 'prospect' as const, subjectId: PROSPECT, ...over,
});

beforeEach(() => {
  db.ops = []; db.rows = {}; db.error = null;
  rpcCalls.length = 0;
  rpcBehaviour = () => ({
    data: [{ create_execution_instance: INSTANCE }], error: null,
  });
});

// ── Creation ────────────────────────────────────────────────────────────────

describe('033 — creation goes through ONE atomic RPC', () => {
  it('creates an instance and reads it back', async () => {
    seedInstance();
    const inst = await createExecutionInstance(createInput());
    expect(inst).toMatchObject({
      id: INSTANCE, organizationId: ORG, campaignId: CMP, workflowId: WF,
      workflowVersionId: VER, subjectKind: 'prospect', subjectId: PROSPECT,
      lifecycleState: 'created',
    });
    expect(inst.targetId).toBeNull();
  });

  it('CALLS THE RPC EXACTLY ONCE, WITH A WORKFLOW AND NO VERSION', async () => {
    seedInstance();
    await createExecutionInstance(createInput());
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe(CREATE_EXECUTION_INSTANCE_FN);
    expect(Object.keys(rpcCalls[0].params).sort()).toEqual([
      'p_campaign_id', 'p_organization_id', 'p_subject_id', 'p_subject_kind',
      'p_target_id', 'p_workflow_id',
    ]);
    // The version is the function's to resolve. There is no parameter for it.
    expect(Object.keys(rpcCalls[0].params)).not.toContain('p_workflow_version_id');
  });

  it('THE INPUT TYPE HAS NO workflowVersionId — a caller cannot pin a version', () => {
    const src = read(STORE);
    const iface = /export interface CreateExecutionInstanceInput \{([\s\S]*?)\n\}/.exec(src);
    expect(iface).not.toBeNull();
    expect(iface![1]).toMatch(/workflowId/);                 // not vacuous
    expect(iface![1]).not.toMatch(/workflowVersionId/);
    expect(iface![1]).not.toMatch(/versionId/);
  });

  it('THE STORE PERFORMS NO INSERT OF ITS OWN — creation is the RPC', () => {
    const src = code(read(STORE));
    expect(src).toMatch(/supabase\.rpc\(CREATE_EXECUTION_INSTANCE_FN/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect(src).not.toMatch(/\.delete\(/);
  });

  it('a lead subject is accepted and carries no target', async () => {
    seedInstance({ subject_kind: 'lead', subject_id: PROSPECT });
    const inst = await createExecutionInstance(createInput({ subjectKind: 'lead' }));
    expect(inst.subjectKind).toBe('lead');
    expect(rpcCalls[0].params.p_subject_kind).toBe('lead');
    expect(rpcCalls[0].params.p_target_id).toBeNull();
  });

  it('a valid target is passed through for a prospect subject', async () => {
    seedInstance({ target_id: TARGET });
    const inst = await createExecutionInstance(createInput({ targetId: TARGET }));
    expect(inst.targetId).toBe(TARGET);
    expect(rpcCalls[0].params.p_target_id).toBe(TARGET);
  });

  it('A LEAD SUBJECT WITH A TARGET IS REFUSED BEFORE THE WIRE', async () => {
    await expect(createExecutionInstance(
      createInput({ subjectKind: 'lead', targetId: TARGET }),
    )).rejects.toMatchObject({ code: 'target_requires_prospect' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a tenant-less call, bad uuids and an unknown subject kind', async () => {
    const bad = async (over: Record<string, unknown>, wanted: string) => {
      await expect(createExecutionInstance(createInput(over) as never))
        .rejects.toMatchObject({ code: wanted });
      expect(rpcCalls).toHaveLength(0);
    };
    await bad({ organizationId: 'nope' }, 'tenant_required');
    await bad({ campaignId: 'x' }, 'invalid_campaign');
    await bad({ workflowId: 'x' }, 'invalid_workflow');
    await bad({ subjectKind: 'person' }, 'invalid_subject_kind');
    await bad({ subjectId: '   ' }, 'invalid_subject_id');
    await bad({ targetId: 'x' }, 'invalid_target');
  });

  it('translates every refusal the function raises into a stated code', async () => {
    const cases: Array<[string, string]> = [
      ['ei_create:invalid_subject_kind', 'invalid_subject_kind'],
      ['ei_create:invalid_subject_id', 'invalid_subject_id'],
      ['ei_create:campaign_not_found', 'campaign_not_found'],
      ['ei_create:workflow_not_found', 'workflow_not_found'],
      ['ei_create:workflow_not_active', 'workflow_not_active'],
      ['ei_create:no_published_version', 'no_published_version'],
      ['ei_create:subject_not_found', 'subject_not_found'],
      ['ei_create:target_requires_prospect', 'target_requires_prospect'],
      ['ei_create:target_mismatch', 'target_mismatch'],
    ];
    for (const [raised, wanted] of cases) {
      rpcBehaviour = () => ({ data: null, error: { code: 'P0001', message: raised } });
      await expect(createExecutionInstance(createInput()))
        .rejects.toMatchObject({ code: wanted });
    }
  });

  it('A SECOND OCCUPIED RUN IS REPORTED AS already_active, NOT A GENERIC DUPLICATE', async () => {
    rpcBehaviour = () => ({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_execution_instances_active"',
      },
    });
    await expect(createExecutionInstance(createInput()))
      .rejects.toMatchObject({ code: 'already_active' });
  });

  it('names each cross-tenant foreign-key failure distinctly', async () => {
    const cases: Array<[string, string]> = [
      ['execution_instances_campaign_tenant_fk', 'cross_tenant_campaign'],
      ['execution_instances_workflow_tenant_fk', 'cross_tenant_workflow'],
      ['execution_instances_version_tenant_fk', 'cross_tenant_version'],
      ['execution_instances_target_tenant_fk', 'cross_tenant_target'],
    ];
    for (const [constraint, wanted] of cases) {
      rpcBehaviour = () => ({
        data: null,
        error: { code: '23503', message: `violates foreign key constraint "${constraint}"` },
      });
      await expect(createExecutionInstance(createInput()))
        .rejects.toMatchObject({ code: wanted });
    }
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('033 — lifecycle', () => {
  it('exposes exactly the seven ratified states, split four occupied / three terminal', () => {
    expect([...LIFECYCLE_STATES]).toEqual([
      'created', 'queued', 'active', 'paused', 'completed', 'cancelled', 'failed',
    ]);
    expect([...OCCUPIED_LIFECYCLE_STATES]).toEqual(['created', 'queued', 'active', 'paused']);
    expect([...TERMINAL_LIFECYCLE_STATES]).toEqual(['completed', 'cancelled', 'failed']);
    for (const s of OCCUPIED_LIFECYCLE_STATES) {
      expect(isOccupiedState(s)).toBe(true);
      expect(isTerminalState(s)).toBe(false);
    }
    for (const s of TERMINAL_LIFECYCLE_STATES) {
      expect(isTerminalState(s)).toBe(true);
      expect(isOccupiedState(s)).toBe(false);
    }
  });

  it('moves an occupied instance and writes ONLY lifecycle_state', async () => {
    seedInstance();
    db.ops = [];
    const moved = await setExecutionInstanceState({
      organizationId: ORG, instanceId: INSTANCE, lifecycleState: 'active',
    });
    expect(moved?.lifecycleState).toBe('active');
    const patch = db.ops.find((o) => o.op === 'update');
    expect(Object.keys(patch?.payload ?? {})).toEqual(['lifecycle_state']);
  });

  it.each([...TERMINAL_LIFECYCLE_STATES])(
    'REFUSES to reopen a %s instance', async (terminal) => {
      seedInstance({ lifecycle_state: terminal });
      await expect(setExecutionInstanceState({
        organizationId: ORG, instanceId: INSTANCE, lifecycleState: 'active',
      })).rejects.toMatchObject({ code: 'terminal_instance' });
      expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(0);
    });

  it('re-asserting the SAME terminal state is an idempotent no-op, not an error', async () => {
    seedInstance({ lifecycle_state: 'completed' });
    const same = await setExecutionInstanceState({
      organizationId: ORG, instanceId: INSTANCE, lifecycleState: 'completed',
    });
    expect(same?.lifecycleState).toBe('completed');
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(0);
  });

  it('refuses an unknown state and returns null for an unknown instance', async () => {
    seedInstance();
    await expect(setExecutionInstanceState({
      organizationId: ORG, instanceId: INSTANCE, lifecycleState: 'running' as never,
    })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await setExecutionInstanceState({
      organizationId: ORG, instanceId: '00000000-0000-4000-8000-0000000000ff',
      lifecycleState: 'active',
    })).toBeNull();
  });

  it('THE STORE ADVANCES NOTHING ON ITS OWN — no scheduler, no timer, no auto-retry', () => {
    const src = code(read(STORE));
    for (const banned of [
      /setTimeout/, /setInterval/, /cron/i, /schedule/i, /\bretry\b/i,
      /queue\.add/, /BullMQ/i, /worker/i,
    ]) {
      expect(src).not.toMatch(banned);
    }
    expect(src).toMatch(/setExecutionInstanceState/);        // not vacuous
  });
});

// ── Reads ───────────────────────────────────────────────────────────────────

describe('033 — reads are tenant-first and history is never collapsed', () => {
  it("another tenant's instance reads as null", async () => {
    seedInstance();
    expect(await getExecutionInstance(ORG_B, INSTANCE)).toBeNull();
  });

  it('lists a campaign’s runs and a subject’s runs', async () => {
    db.rows[EXECUTION_INSTANCES_TABLE] = [
      { id: 'a', organization_id: ORG, campaign_id: CMP, workflow_id: WF,
        workflow_version_id: VER, target_id: null, subject_kind: 'prospect',
        subject_id: PROSPECT, lifecycle_state: 'completed', created_at: 't1', updated_at: 't1' },
      { id: 'b', organization_id: ORG, campaign_id: CMP, workflow_id: WF,
        workflow_version_id: VER, target_id: null, subject_kind: 'prospect',
        subject_id: PROSPECT, lifecycle_state: 'created', created_at: 't2', updated_at: 't2' },
    ];
    // TWO instances for one five-tuple: one terminal, one occupied. History is kept.
    expect(await listCampaignExecutionInstances(ORG, CMP)).toHaveLength(2);
    expect(await listSubjectExecutionInstances(ORG, 'prospect', PROSPECT)).toHaveLength(2);
  });

  it('THE OCCUPIED READ USES THE SAME PREDICATE AS THE INDEX', async () => {
    db.rows[EXECUTION_INSTANCES_TABLE] = [
      { id: 'a', organization_id: ORG, campaign_id: CMP, workflow_id: WF,
        workflow_version_id: VER, target_id: null, subject_kind: 'prospect',
        subject_id: PROSPECT, lifecycle_state: 'completed', created_at: 't1', updated_at: 't1' },
    ];
    // Only a terminal instance exists, so there is no occupied one.
    expect(await getOccupiedExecutionInstance(ORG, CMP, WF, 'prospect', PROSPECT)).toBeNull();

    (db.rows[EXECUTION_INSTANCES_TABLE] as Row[]).push({
      id: 'b', organization_id: ORG, campaign_id: CMP, workflow_id: WF,
      workflow_version_id: VER, target_id: null, subject_kind: 'prospect',
      subject_id: PROSPECT, lifecycle_state: 'paused', created_at: 't2', updated_at: 't2',
    });
    expect((await getOccupiedExecutionInstance(ORG, CMP, WF, 'prospect', PROSPECT))?.id).toBe('b');

    const src = read(STORE);
    const fn = src.indexOf('export async function getOccupiedExecutionInstance(');
    const end = src.indexOf('\n}\r\n', fn) > -1 ? src.indexOf('\n}\r\n', fn) : src.indexOf('\n}\n', fn);
    expect(end).toBeGreaterThan(fn);
    // It filters on the OCCUPIED set, not a hand-written list.
    expect(src.slice(fn, end)).toMatch(/OCCUPIED_LIFECYCLE_STATES/);
  });

  it('refuses an out-of-range limit', async () => {
    await expect(listCampaignExecutionInstances(ORG, CMP, { limit: 0 }))
      .rejects.toMatchObject({ code: 'invalid_limit' });
    await expect(listSubjectExecutionInstances(ORG, 'prospect', PROSPECT, { limit: 1001 }))
      .rejects.toMatchObject({ code: 'invalid_limit' });
  });
});

// ── Surface ─────────────────────────────────────────────────────────────────

describe('033 — the surface offers no delete and no identity edit', () => {
  it('exports no delete-shaped function and no identity mutator', () => {
    const store = require('../../services/executionInstances/executionInstanceStore');
    const exported = Object.keys(store).sort();
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      expect(name).not.toMatch(/^(delete|remove|destroy|purge)/i);
      expect(name).not.toMatch(/setCampaign|setWorkflow|setVersion|setTarget|setSubject|repin/i);
    }
    expect(exported).toContain('createExecutionInstance');
    expect(exported).toContain('setExecutionInstanceState');
  });

  it('no write reaches a table other than execution_instances', async () => {
    seedInstance();
    await setExecutionInstanceState({
      organizationId: ORG, instanceId: INSTANCE, lifecycleState: 'queued',
    });
    const writes = db.ops.filter((o) => o.op !== 'select');
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.table).toBe(EXECUTION_INSTANCES_TABLE);
  });

  it('NO FORBIDDEN DOWNSTREAM CONCEPT APPEARS IN THE STORE', () => {
    const src = code(read(STORE));
    for (const banned of [
      /outreach_tasks/, /plan_task_id/, /buildOutreachPlan/, /taskGenerator/,
      /automationPlanning/, /PERSONA_PLAYBOOKS/, /mayContact/, /dispatch/i,
      /transport/i, /provider/i, /suppression/i, /gtm_/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });

  it('one module owns the table', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e);
        let stat; try { stat = fs.statSync(p); } catch { continue; }
        if (stat.isDirectory()) {
          if (e === 'node_modules' || e === 'tests' || e === '.next') continue;
          walk(p); continue;
        }
        if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
        const body = fs.readFileSync(p, 'utf8') as string;
        if (/'execution_instances'|"execution_instances"/.test(body)) {
          hits.push(path.relative(process.cwd(), p).split(path.sep).join('/'));
        }
      }
    };
    for (const r of ['backend', 'pages', 'lib', 'shared']) walk(path.join(process.cwd(), r));
    expect(hits.sort()).toEqual([STORE]);
  });
});

// ── Migration ───────────────────────────────────────────────────────────────

describe('033 — the migration', () => {
  const body = () => read(MIGRATION);

  it('creates exactly one table, and it is the instance', () => {
    const creates = body().match(/CREATE TABLE IF NOT EXISTS public\.[a-z_]+/g) ?? [];
    expect(creates).toEqual(['CREATE TABLE IF NOT EXISTS public.execution_instances']);
  });

  it('THE ACTIVE UNIQUENESS INDEX IS PARTIAL AND COVERS THE FIVE-TUPLE', () => {
    const b = body();
    expect(b).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_instances_active/);
    expect(b).toMatch(/\(organization_id, campaign_id, workflow_id, subject_kind, subject_id\)/);
    expect(b).toMatch(/WHERE lifecycle_state IN \('created', 'queued', 'active', 'paused'\)/);
    // The postcondition refuses a predicate that includes a terminal state.
    expect(b).toMatch(/re-entry would be impossible/);
    // And refuses an unconditional composite unique key.
    expect(b).toMatch(/historical instances would be collapsed/);
  });

  it('declares four tenant-safe FKs (the target FK is deferred), exactly one cascade, and refuses SET NULL', () => {
    const b = body();
    // PORT 2026-10-28: the target FK moves to the campaign-targets migration
    // (LISTS-001 chain); until then a target is refused, never referenced.
    expect(b.match(/FOREIGN KEY \(/g) ?? []).toHaveLength(4);
    expect(b).toMatch(/% foreign keys, expected 4/);
    expect(b).toMatch(/ei_create:targets_not_installed/);
    expect(b).toMatch(/execution_instances_target_tenant_fk[\s\S]{0,160}added by the campaign-targets migration/);
    expect(b).toMatch(/expected exactly 1 \(the tenant\)/);
    expect(b).toMatch(/historical attribution could vanish silently/);
    expect(b).toMatch(/REFERENCES public\.prospect_campaigns \(id, organization_id\)/);
    expect(b).toMatch(/REFERENCES public\.workflows \(id, organization_id\)/);
    expect(b).toMatch(/REFERENCES public\.workflow_versions \(id, organization_id\)/);
    expect(b).not.toMatch(/REFERENCES public\.prospect_campaign_targets/);
  });

  it('THE GUARD IS NARROW — identity frozen, lifecycle still moves', () => {
    const b = body();
    expect(b).toMatch(/CREATE TRIGGER trg_execution_instances_guard/);
    expect(b).toMatch(/BEFORE UPDATE ON public\.execution_instances/);
    expect(b).toMatch(/a retry is a NEW instance/);
    expect(b).toMatch(/an unconditional guard would freeze the run/);
    // It must reason about lifecycle rather than refusing every update.
    expect(b).toMatch(/NEW\.lifecycle_state IS DISTINCT FROM OLD\.lifecycle_state/);
  });

  it('THE VERSION IS RESOLVED BY STATUS, NEVER BY ORDERING', () => {
    const b = body();
    expect(b).toMatch(/AND v\.status = 'published'/);
    // No ordering heuristic anywhere in the creation function.
    const fn = /CREATE OR REPLACE FUNCTION public\.create_execution_instance([\s\S]*?)\$\$;/.exec(b);
    expect(fn).not.toBeNull();
    // SQL COMMENTS STRIPPED FIRST. The function's own comment states that there is
    // no ORDER BY and no MAX — which the bans below matched, the same way the 032
    // closeout's `/\bmax\b/` matched the comment explaining why MAX is not used.
    const fnCode = fn![1].replace(/--[^\n]*/g, '');
    expect(fnCode).toMatch(/v\.status = 'published'/);       // not vacuous
    for (const banned of [/ORDER BY/i, /\bMAX\s*\(/i, /LIMIT 1/i, /created_at DESC/i]) {
      expect(fnCode).not.toMatch(banned);
    }
  });

  it('a lead subject cannot carry a target, by CHECK', () => {
    expect(body()).toMatch(/CHECK \(target_id IS NULL OR subject_kind = 'prospect'\)/);
  });

  it('the lifecycle and subject vocabularies are exactly the ratified sets', () => {
    const b = body();
    expect(b).toMatch(/subject_kind IN \('lead', 'prospect'\)/);
    expect(b).toMatch(/'created', 'queued', 'active', 'paused'/);
    expect(b).toMatch(/'completed', 'cancelled', 'failed'/);
  });

  it('the creation function is SECURITY INVOKER, scalar-returning, and anon-revoked', () => {
    const b = body();
    expect(b).toMatch(/CREATE OR REPLACE FUNCTION public\.create_execution_instance/);
    expect(b).toMatch(/RETURNS uuid/);           // scalar: cannot shadow a column (032's 42702)
    expect(b).toMatch(/SECURITY INVOKER/);
    expect(b).not.toMatch(/SECURITY DEFINER/);
    expect(b).toMatch(/REVOKE EXECUTE ON FUNCTION\s*\n?\s*public\.create_execution_instance/);
    expect(b).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_execution_instance[\s\S]{0,80}TO service_role/);
  });

  it('enables RLS with a service-role policy and grants nothing to anon', () => {
    const b = body();
    expect(b).toMatch(/ALTER TABLE public\.execution_instances ENABLE ROW LEVEL SECURITY/);
    expect(b).toMatch(/auth\.role\(\) = 'service_role'/);
    expect(b).not.toMatch(/TO anon/);
    expect(b).not.toMatch(/TO authenticated/);
  });

  it('CREATES NO FORBIDDEN DOWNSTREAM ENTITY', () => {
    const b = body();
    for (const banned of [
      /CREATE TABLE[^;]*\bplans?\b/i, /CREATE TABLE[^;]*step/i, /CREATE TABLE[^;]*task/i,
      /CREATE TABLE[^;]*message/i, /CREATE TABLE[^;]*schedule/i,
    ]) {
      expect(b).not.toMatch(banned);
    }
  });

  it('ALTERS NO EXISTING TABLE', () => {
    const alters = body().match(/ALTER TABLE public\.[a-z_]+/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) expect(a).toBe('ALTER TABLE public.execution_instances');
  });

  it('owns its table alone and sorts after 032', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    // Anchored to the TABLE-NAME position. The earlier form was
    // `CREATE TABLE[^;]*public.execution_instances`, where `[^;]*` reached across
    // a whole column list — so 036's migration matched it merely for carrying a
    // FOREIGN KEY that REFERENCES this table.
    const owners = files.filter((f: string) =>
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.execution_instances\b/i.test(
        fs.readFileSync(path.join(dir, f), 'utf8') as string)).sort();
    expect(owners).toEqual(['20270111100002_pi_execution_instances.sql']);
    expect('20270111100001_pi_workflow_definitions.sql'
      < '20270111100002_pi_execution_instances.sql').toBe(true);
  });
});

// ── Predecessors untouched ──────────────────────────────────────────────────

describe('033 — isolation, proven by content not by git status', () => {
  it('032’s migration and store are unchanged in the ways that matter', () => {
    const m = read('supabase/migrations/20270111100001_pi_workflow_definitions.sql');
    expect(m).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_one_published/);
    expect(m).toMatch(/WHERE status = 'published'/);
    const s = code(read('backend/services/workflows/workflowStore.ts'));
    expect(s).toMatch(/\.eq\('status', 'published'\)/);
    expect(s).not.toMatch(/execution_instances/);
    expect(s).not.toMatch(/executionInstanceStore/);
  });

  it('THE PLANNER AND OUTREACH LAYERS ARE UNTOUCHED BY 033', () => {
    const files = [
      'backend/services/qualificationPlanning/outreachPlanner.ts',
      'backend/services/automationExecution/taskGenerator.ts',
      'backend/services/automationExecution/automationConfig.ts',
      'backend/services/leadOutreachExecution/dispatch.ts',
      // listEvaluator / campaignSelectionService land with the lists slice.
    ];
    expect(files.length).toBe(4);
    for (const f of files) {
      const src = code(read(f));
      expect(src.length).toBeGreaterThan(0);
      for (const banned of [
        /execution_instances/, /executionInstanceStore/, /createExecutionInstance/,
      ]) {
        expect(src).not.toMatch(banned);
      }
    }
  });

  it('the execution layer identity and the global timing constants are untouched', () => {
    expect(read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql'))
      .toMatch(/CONSTRAINT outreach_tasks_identity_unique UNIQUE \(company_id, lead_id, plan_task_id\)/);
    const cfg = read('backend/services/automationExecution/automationConfig.ts');
    expect(cfg).toMatch(/STEP_DELAY_LADDER_HOURS = \[0, 48, 72, 72, 96, 120\]/);
    expect(cfg).toMatch(/MAX_TASKS = 20/);
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

describe('033 — the routes', () => {
  it('each verifies membership then the capability, in that order', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      const access = src.indexOf('enforceCompanyAccess');
      const cap = src.indexOf('requireCapability');
      expect(access).toBeGreaterThan(-1);
      expect(cap).toBeGreaterThan(access);
      expect(src).toMatch(/guard\.ok !== true/);
    }
  });

  it('ADDS NO CAPABILITY — the security import is exactly the 032 interim grant', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      const imported = /import \{([^}]*)\} from '[^']*shared\/contracts\/security';/.exec(src);
      expect(imported).not.toBeNull();
      expect(imported![1].split(',').map((s) => s.trim()).filter(Boolean))
        .toEqual(['PROSPECT_ICP_MANAGE']);
      for (const banned of [
        /EXECUTION_[A-Z_]+/, /INSTANCE_[A-Z_]+/, /CAMPAIGN_EXECUTE/, /AUTOMATION_EXECUTE/,
      ]) {
        expect(src).not.toMatch(banned);
      }
    }
  });

  it('records WHY the obvious alternative capability was rejected', () => {
    // In the SOURCE, so the reasoning survives the next edit.
    const src = read('pages/api/prospect-campaigns/[id]/execution-instances.ts');
    expect(src).toMatch(/AUTOMATION_EXECUTE/);
    expect(src).toMatch(/campaigns\/\[id\]\/release\.ts/);
    expect(src).toMatch(/widening/);
  });

  it('RECORDS WHY THE CAMPAIGN IS A PATH PARENT, AND WHY THE EASY FIXES WERE WRONG', () => {
    // The vacuous-binder trap is worth keeping written down: passing a
    // prospect-campaign id to `enforceCompanyAccess({ campaignId })` resolves
    // against the CONTENT `campaigns` table and silently passes.
    const src = read('pages/api/prospect-campaigns/[id]/execution-instances.ts');
    expect(src).toMatch(/R3/);
    expect(src).toMatch(/campaignOwnershipService/);
    expect(src).toMatch(/proving NOTHING/);
    // And the bind itself is present and tenant-scoped.
    expect(src).toMatch(/getProspectCampaign\(companyId, campaignId\)/);
  });

  it('THERE IS NO FLAT CAMPAIGN-KEYED ROUTE — the campaign is always path-scoped', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'pages/api/execution-instances');
    // The claim is about the absence of a FLAT collection route, which is what
    // route-auth R3 rejected. An exact directory listing also asserted that no
    // sub-resource may ever exist, which was never the point and broke the moment
    // 036 legitimately added `[id]/plan.ts`.
    const entries = fs.readdirSync(dir).sort();
    expect(entries).not.toContain('index.ts');
    expect(entries).toContain('[id].ts');
    // Positive counterpart: every entry is accounted for, so a new flat route
    // under another name still fails this.
    expect(entries).toEqual(['[id]', '[id].ts']);
    // Sub-resources of the bound run, each added by a later ratified workstream:
    // `plan.ts` by 036, `progression.ts` by 037. Enumerated rather than counted so
    // a NEW flat collection route still fails this, whatever it is named.
    // Sub-resources of the bound run, each added by a later ratified workstream:
    // `plan.ts` (036), `progression.ts` (037), `outreach-bridge.ts` (040),
    // `community-link.ts` (community journey link, 2026-10-28 — path-scoped to the run),
    // `events.ts` (execution contract v0.1, read-only).
    expect(fs.readdirSync(path.join(dir, '[id]')).sort())
      .toEqual(['community-link.ts', 'events.ts', 'outreach-bridge.ts', 'plan.ts', 'progression.ts']);
  });

  it('the method sets are exactly what the substrate needs, and NO DELETE', () => {
    expect(code(read('pages/api/prospect-campaigns/[id]/execution-instances.ts')))
      .toMatch(/METHODS = \['GET', 'POST'\]/);
    expect(code(read('pages/api/execution-instances/[id].ts')))
      .toMatch(/METHODS = \['GET', 'PATCH'\]/);
    for (const r of ROUTES) expect(code(read(r))).not.toMatch(/'DELETE'/);
  });

  it('NO ROUTE ACCEPTS A WORKFLOW VERSION', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).not.toMatch(/workflowVersionId/);
      expect(src).not.toMatch(/body\.versionId/);
    }
  });

  it('passes the VERIFIED tenant, never a body value', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).toMatch(/organizationId: companyId/);
      expect(src).not.toMatch(/body\.organizationId/);
    }
  });

  it('reaches no plan, task, dispatch or governance concept', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      for (const banned of [
        /ownedDbTable/, /'execution_instances'/, /supabase\.rpc/, /plan_task_id/,
        /mayContact/, /dispatch/i, /outreach_tasks/,
      ]) {
        expect(src).not.toMatch(banned);
      }
    }
  });
});

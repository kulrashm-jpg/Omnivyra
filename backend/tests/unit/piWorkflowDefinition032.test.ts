/**
 * PI-WORKFLOW-DEFINITION-032 — Workflow and Workflow Version.
 *
 * The database's guarantees — the partial unique index that makes one published
 * version an invariant, the immutability guard that freezes content while
 * permitting a status transition, the composite tenant-safe keys, the atomic
 * publication function and the FK delete semantics — are proven against real
 * PostgreSQL in `backend/tests/realschema/pi_workflow_definitions_032.test.ts`,
 * including the three mandatory bottleneck proofs.
 *
 * What belongs HERE is what is a DECISION rather than a constraint: the store's
 * validation, that the current-version resolver is written against the STATUS
 * predicate and takes no maximum, that no function offers to edit a published
 * version or to delete anything, that the store is the sole writer, that the
 * migration states its own invariants, and that the routes keep publication an
 * explicit action with the verified tenant and actor.
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
    const exec = async (mode: 'many' | 'one') => {
      if (st.op !== 'select') {
        db.ops.push({ table, op: st.op, payload: st.payload, filters: [...st.filters] });
      }
      if (db.error) { const e = db.error; db.error = null; return { data: null, error: e }; }
      const existing = (db.rows[table] ??= []);
      if (st.op === 'insert') {
        const created = {
          id: `00000000-0000-4000-8000-0000000${String(existing.length + 1).padStart(5, '0')}`,
          status: table === 'workflows' ? 'active' : 'draft',
          description: null, created_by: null, published_at: null, published_by: null,
          definition: { steps: [] },
          ...st.payload,
          created_at: 't1', updated_at: 't1',
        };
        existing.push(created);
        return { data: mode === 'one' ? created : [created], error: null };
      }
      const matching = existing.filter((r) => st.filters.every(([c, v]) => r[c] === v));
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
let rpcBehaviour: () => unknown = () => ({ data: [{ superseded_id: null }], error: null });

jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return rpcBehaviour();
    },
  },
}));

import {
  createWorkflow, getWorkflow, listWorkflows, updateWorkflowMetadata, setWorkflowStatus,
  createDraftVersion, updateDraftVersion, publishWorkflowVersion, archiveWorkflowVersion,
  getCurrentWorkflowVersion, getWorkflowVersion, listWorkflowVersions,
  validateWorkflowDefinition, WorkflowError,
  WORKFLOWS_TABLE, WORKFLOW_VERSIONS_TABLE, PUBLISH_WORKFLOW_VERSION_FN,
  WORKFLOW_STATUSES, WORKFLOW_VERSION_STATUSES, WORKFLOW_STEP_CHANNELS,
} from '../../services/workflows/workflowStore';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ACTOR = '00000000-0000-4000-8000-0000000000d9';

const read = (rel: string): string =>
  require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STORE = 'backend/services/workflows/workflowStore.ts';
const MIGRATION = 'supabase/migrations/20270111100001_pi_workflow_definitions.sql';
const ROUTES = [
  'pages/api/workflows/index.ts',
  'pages/api/workflows/[id].ts',
  'pages/api/workflows/[id]/versions.ts',
  'pages/api/workflows/[id]/publish.ts',
];

// PI-040 added `execution_mode` as a REQUIRED authored field, so every step this
// suite builds carries one. `assisted` is the neutral choice here: it is the only
// mode that asserts nothing about approval by itself, whereas a `human` default
// would have made several assertions below pass for the wrong reason. 040's own
// suite covers each mode explicitly.
const step = (key: string, over: Record<string, unknown> = {}) => ({
  key, channel: 'email', delay_after_previous_hours: 0, execution_mode: 'assisted', ...over,
});

beforeEach(() => {
  db.ops = []; db.rows = {}; db.error = null;
  rpcCalls.length = 0;
  rpcBehaviour = () => ({ data: [{ superseded_id: null }], error: null });
});

// ── Workflow ────────────────────────────────────────────────────────────────

describe('032 — the Workflow carries identity and nothing else', () => {
  it('creates a workflow with the verified actor', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'Outbound', actorUserId: ACTOR });
    expect(wf).toMatchObject({ organizationId: ORG, name: 'Outbound', status: 'active' });
    const insert = db.ops.find((o) => o.op === 'insert');
    expect(insert?.table).toBe(WORKFLOWS_TABLE);
    expect(insert?.payload.created_by).toBe(ACTOR);
  });

  it('THE PAYLOAD CARRIES NO AUTHORING CONTENT AND NO RUNTIME STATE', async () => {
    await createWorkflow({ organizationId: ORG, name: 'W' });
    const insert = db.ops.find((o) => o.op === 'insert');
    expect(Object.keys(insert?.payload ?? {}).sort())
      .toEqual(['created_by', 'description', 'name', 'organization_id']);
    for (const banned of [
      'definition', 'steps', 'timing', 'channel', 'version', 'delay_after_previous_hours',
      'run_count', 'last_used_at', 'performance', 'is_current',
    ]) {
      expect(Object.keys(insert?.payload ?? {})).not.toContain(banned);
    }
  });

  it('refuses a blank name, an over-long name and a tenant-less call', async () => {
    await expect(createWorkflow({ organizationId: ORG, name: '  ' }))
      .rejects.toMatchObject({ code: 'name_required' });
    await expect(createWorkflow({ organizationId: ORG, name: 'x'.repeat(201) }))
      .rejects.toMatchObject({ code: 'name_too_long' });
    await expect(createWorkflow({ organizationId: 'nope', name: 'W' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
  });

  it('metadata update cannot touch status, and status change is its own operation', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    db.ops = [];
    await updateWorkflowMetadata({ organizationId: ORG, workflowId: wf.id, name: 'W2' });
    const patch = db.ops.find((o) => o.op === 'update');
    expect(Object.keys(patch?.payload ?? {})).toEqual(['name']);
    expect(Object.keys(patch?.payload ?? {})).not.toContain('status');

    db.ops = [];
    await setWorkflowStatus(ORG, wf.id, 'archived');
    expect(db.ops.find((o) => o.op === 'update')?.payload).toEqual({ status: 'archived' });
  });

  it('refuses an unknown status and an empty update', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    await expect(setWorkflowStatus(ORG, wf.id, 'live' as never))
      .rejects.toMatchObject({ code: 'invalid_status' });
    await expect(updateWorkflowMetadata({ organizationId: ORG, workflowId: wf.id }))
      .rejects.toMatchObject({ code: 'empty_update' });
  });

  it('every read filters organization_id first', async () => {
    const src = code(read(STORE));
    const chains = src.match(/\.eq\('organization_id', (?:organizationId|input\.organizationId)\)/g) ?? [];
    expect(chains.length).toBeGreaterThanOrEqual(8);
    // And no read or write omits it.
    expect(src).not.toMatch(/\.select\([A-Z_]+\)\s*\n\s*\.eq\('id'/);
  });

  it('an archived workflow cannot author a new version', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    await setWorkflowStatus(ORG, wf.id, 'archived');
    await expect(createDraftVersion({ organizationId: ORG, workflowId: wf.id }))
      .rejects.toMatchObject({ code: 'workflow_not_active' });
    expect(db.ops.filter((o) => o.op === 'insert' && o.table === WORKFLOW_VERSIONS_TABLE))
      .toHaveLength(0);
  });

  it('a missing workflow is reported, not assumed', async () => {
    await expect(createDraftVersion({
      organizationId: ORG, workflowId: '00000000-0000-4000-8000-0000000000ff',
    })).rejects.toMatchObject({ code: 'workflow_not_found' });
  });

  it("another tenant's workflow reads as null, never an error", async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    expect(await getWorkflow(ORG_B, wf.id)).toBeNull();
    expect(await listWorkflows(ORG_B)).toEqual([]);
  });
});

// ── Definition validation ───────────────────────────────────────────────────

describe('032 — definition validation', () => {
  const bad = (definition: unknown, codeWanted: string) =>
    expect(() => validateWorkflowDefinition(definition)).toThrow(
      expect.objectContaining({ code: codeWanted }) as never);

  it('accepts a minimal ordered definition', () => {
    const d = validateWorkflowDefinition({
      steps: [step('intro'), step('followup', { delay_after_previous_hours: 48 })],
    });
    expect(d.steps).toHaveLength(2);
    expect(d.steps[1].delay_after_previous_hours).toBe(48);
  });

  it('refuses a non-object definition and a missing steps array', () => {
    bad(null, 'invalid_definition');
    bad([], 'invalid_definition');
    bad({}, 'invalid_definition');
    bad({ steps: 'nope' }, 'invalid_definition');
  });

  it('REFUSES A DUPLICATE STEP KEY WITHIN ONE VERSION', () => {
    bad({ steps: [step('intro'), step('intro')] }, 'duplicate_step_key');
  });

  it('refuses a blank, over-long or malformed step key', () => {
    bad({ steps: [step('  ')] }, 'invalid_step_key');
    bad({ steps: [step('x'.repeat(121))] }, 'invalid_step_key');
    bad({ steps: [step('has space')] }, 'invalid_step_key');
  });

  it('refuses an unknown channel', () => {
    bad({ steps: [step('a', { channel: 'carrier-pigeon' })] }, 'invalid_step_channel');
    // ORCHESTRATION 2026-10-28 (owner confirmation pending): `internal` — a task for
    // the tenant's own team, the WS-3 internal transport, contacts nobody — is now
    // authorable. It is the only WS-3 channel that executes on main (email is
    // flag-disabled), so without it no workflow step could complete through WS-3.
    expect(validateWorkflowDefinition({ steps: [step('a', { channel: 'internal' })] }).steps[0].channel).toBe('internal');
  });

  it('DOES NOT NARROW CHANNELS TO THE TWO REGISTERED TRANSPORTS', () => {
    // The 9-vs-2 gap is a deferred product decision; restricting here would decide it.
    for (const channel of ['whatsapp', 'sms', 'linkedin', 'phone', 'slack', 'community']) {
      // A whatsapp step must name the approved template the engine will send.
      const extra = channel === 'whatsapp' ? { whatsapp: { template_name: 'intro_v1' } } : {};
      expect(validateWorkflowDefinition({ steps: [step('a', { channel, ...extra })] }).steps[0].channel)
        .toBe(channel);
    }
    // 12: `social_post` (public post awaiting one released scheduled post) appended
    // 2026-10-28 — see socialPostStepContract.test.ts.
    expect(WORKFLOW_STEP_CHANNELS).toHaveLength(12);
  });

  it('refuses a non-numeric, negative or absurd delay', () => {
    bad({ steps: [step('a', { delay_after_previous_hours: '48' })] }, 'invalid_step_delay');
    bad({ steps: [step('a', { delay_after_previous_hours: -1 })] }, 'invalid_step_delay');
    bad({ steps: [step('a', { delay_after_previous_hours: 24 * 91 })] }, 'invalid_step_delay');
    bad({ steps: [step('a', { delay_after_previous_hours: Number.NaN })] }, 'invalid_step_delay');
  });

  it('keeps a personalization INSTRUCTION and drops nothing else in', () => {
    const d = validateWorkflowDefinition({
      steps: [step('a', { instruction: 'reference their funding signal', prospectEmail: 'x@y.z' })],
    });
    expect(d.steps[0].instruction).toBe('reference their funding signal');
    // Only the contracted fields survive: a Version cannot become a PI store by
    // a caller adding resolved prospect data to a step.
    // PI-040 added `execution_mode` to the contracted set. The claim this test
    // makes is unchanged — only the CONTRACTED fields survive — so the expected
    // set grows by exactly the field 040-D authorized and nothing else.
    expect(Object.keys(d.steps[0]).sort())
      .toEqual(['channel', 'delay_after_previous_hours', 'execution_mode', 'instruction', 'key']);
  });

  it('TIMING IS THE ONLY TEMPORAL VOCABULARY — no absolute time, window or timezone survives', () => {
    const d = validateWorkflowDefinition({
      steps: [step('a', { at: '2026-01-01T09:00:00Z', timezone: 'IST', send_window: '9-17', business_days: true })],
    });
    // `execution_mode` is contracted since PI-040; no temporal field joins it.
    expect(Object.keys(d.steps[0]).sort())
      .toEqual(['channel', 'delay_after_previous_hours', 'execution_mode', 'key']);
  });
});

// ── Draft and publication ───────────────────────────────────────────────────

describe('032 — draft, edit, publish', () => {
  const seed = async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    return wf;
  };

  it('allocates the next ordinal, which is the ONE legitimate use of a maximum', async () => {
    const wf = await seed();
    const d1 = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    const d2 = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    expect(d1.version).toBe(1);
    expect(d2.version).toBe(2);
  });

  it('EDITING IS SCOPED TO DRAFTS BY A DATABASE PREDICATE', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    db.ops = [];
    await updateDraftVersion({
      organizationId: ORG, versionId: d.id, definition: { steps: [step('a')] },
    });
    const patch = db.ops.find((o) => o.op === 'update');
    expect(patch?.filters).toEqual(expect.arrayContaining([['status', 'draft']]) as never);
    expect(Object.keys(patch?.payload ?? {})).toEqual(['definition']);
  });

  it('publication goes through the RPC with the verified tenant and actor', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    // The double's row is a draft; the RPC is mocked, so flip it as the function would.
    (db.rows[WORKFLOW_VERSIONS_TABLE] ?? []).forEach((r) => {
      if (r.id === d.id) { r.status = 'published'; r.published_by = ACTOR; r.published_at = 't3'; }
    });
    const result = await publishWorkflowVersion({
      organizationId: ORG, versionId: d.id, actorUserId: ACTOR,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe(PUBLISH_WORKFLOW_VERSION_FN);
    expect(rpcCalls[0].params).toEqual({
      p_organization_id: ORG, p_version_id: d.id, p_published_by: ACTOR,
    });
    expect(result.version.status).toBe('published');
  });

  it('PUBLICATION REQUIRES AN ACTOR', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    await expect(publishWorkflowVersion({
      organizationId: ORG, versionId: d.id, actorUserId: null as never,
    })).rejects.toMatchObject({ code: 'actor_required' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('translates each publication refusal into a stated code', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    const cases: Array<[string, string]> = [
      ['wf_publish:version_not_found', 'version_not_found'],
      ['wf_publish:workflow_not_active', 'workflow_not_active'],
      ['wf_publish:not_draft', 'not_draft'],
      ['wf_publish:no_steps', 'no_steps'],
      ['wf_publish:duplicate_step_key', 'duplicate_step_key'],
      ['wf_publish:invalid_step', 'invalid_step'],
      ['wf_publish:actor_required', 'actor_required'],
    ];
    for (const [raised, wanted] of cases) {
      rpcBehaviour = () => ({ data: null, error: { code: 'P0001', message: raised } });
      await expect(publishWorkflowVersion({
        organizationId: ORG, versionId: d.id, actorUserId: ACTOR,
      })).rejects.toMatchObject({ code: wanted });
    }
  });

  it('a second published row is reported as already_published, not as a generic duplicate', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    rpcBehaviour = () => ({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_workflow_versions_one_published"',
      },
    });
    await expect(publishWorkflowVersion({
      organizationId: ORG, versionId: d.id, actorUserId: ACTOR,
    })).rejects.toMatchObject({ code: 'already_published' });
  });

  it('archival is scoped to a published version by a database predicate', async () => {
    const wf = await seed();
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    db.ops = [];
    await archiveWorkflowVersion(ORG, d.id);
    const patch = db.ops.find((o) => o.op === 'update');
    expect(patch?.payload).toEqual({ status: 'archived' });
    expect(patch?.filters).toEqual(expect.arrayContaining([['status', 'published']]) as never);
  });
});

// ── BOTTLENECK 1: the resolver's contract ───────────────────────────────────

describe('032 — BOTTLENECK 1: current is a STATUS, never a maximum', () => {
  it('the resolver filters status = published', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    const d = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    // Only a published row may be returned: the draft must not be.
    expect(await getCurrentWorkflowVersion(ORG, wf.id)).toBeNull();
    (db.rows[WORKFLOW_VERSIONS_TABLE] ?? []).forEach((r) => {
      if (r.id === d.id) { r.status = 'published'; r.published_at = 't'; r.published_by = ACTOR; }
    });
    expect((await getCurrentWorkflowVersion(ORG, wf.id))?.id).toBe(d.id);
  });

  it('A DRAFT WITH A HIGHER ORDINAL IS NOT CURRENT', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    const v1 = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    const v2 = await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    (db.rows[WORKFLOW_VERSIONS_TABLE] ?? []).forEach((r) => {
      if (r.id === v1.id) { r.status = 'published'; r.published_at = 't'; r.published_by = ACTOR; }
    });
    const current = await getCurrentWorkflowVersion(ORG, wf.id);
    expect(current?.id).toBe(v1.id);
    expect(current?.id).not.toBe(v2.id);
    expect(v2.version).toBeGreaterThan(v1.version);
  });

  it('THE RESOLVER SOURCE TAKES NO MAXIMUM, NO ORDER AND NO LIMIT', () => {
    // A future developer cannot swap in MAX(version) without this failing.
    const src = read(STORE);
    const fn = /export async function getCurrentWorkflowVersion\(([\s\S]*?)\n}/.exec(src);
    expect(fn).not.toBeNull();
    const body = fn![1];
    expect(body).toMatch(/\.eq\('status', 'published'\)/);   // the guard is not vacuous
    for (const banned of [/\.order\(/, /\.limit\(/, /\bMath\.max\b/, /created_at/, /'version'/]) {
      expect(body).not.toMatch(banned);
    }
  });

  it('the store never reads the global delay ladder as Version truth', () => {
    const src = code(read(STORE));
    for (const banned of [
      /STEP_DELAY_LADDER_HOURS/, /WAIT_TASK_THRESHOLD_HOURS/, /MAX_TASKS/,
      /automationConfig/, /PERSONA_PLAYBOOKS/, /automationPlanning/,
    ]) {
      expect(src).not.toMatch(banned);
    }
    expect(src).toMatch(/delay_after_previous_hours/);        // not vacuous
  });
});

// ── The surface offers no unsafe mutation ───────────────────────────────────

describe('032 — the store offers no edit-published and no delete', () => {
  it('exports no delete function at all', () => {
    const store = require('../../services/workflows/workflowStore');
    const exported = Object.keys(store).sort();
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      expect(name).not.toMatch(/^(delete|remove|destroy|purge)/i);
      expect(name).not.toMatch(/editPublished|updatePublished|unpublish|republish/i);
    }
    expect(exported).toContain('publishWorkflowVersion');
    expect(exported).toContain('getCurrentWorkflowVersion');
  });

  it('THE STORE SOURCE PERFORMS NO DELETE AND NO UPSERT', () => {
    const src = code(read(STORE));
    expect(src).toMatch(/\.update\(/);                 // not vacuous: it does update drafts
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/\.upsert\(/);
  });

  it('no write reaches a table other than the two it owns', async () => {
    const wf = await createWorkflow({ organizationId: ORG, name: 'W' });
    await createDraftVersion({ organizationId: ORG, workflowId: wf.id });
    const writes = db.ops.filter((o) => o.op !== 'select');
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect([WORKFLOWS_TABLE, WORKFLOW_VERSIONS_TABLE]).toContain(w.table);
    }
  });

  it('it reaches no PI, execution or legacy concept', () => {
    const src = code(read(STORE));
    for (const banned of [
      /prospect_/, /canonical_leads/, /unified_persons/, /outreach_/, /execution_instance/,
      /gtm_/, /mayContact/, /suppression/, /dispatch/i, /plan_task_id/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });
});

// ── Sole writer ────────────────────────────────────────────────────────────

describe('032 — one module owns both tables', () => {
  it('no other non-test source file names workflows or workflow_versions as a table', () => {
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
        const rel = path.relative(process.cwd(), p).replace(/\\/g, '/');
        if (/'workflow_versions'|"workflow_versions"/.test(body)
            || /ownedDbTable\(WORKFLOWS_TABLE\)/.test(body)) hits.push(rel);
      }
    };
    for (const r of ['backend', 'pages', 'lib', 'shared']) walk(path.join(process.cwd(), r));
    expect(hits.sort()).toEqual([STORE]);
  });

  it('the routes reach the tables only through the store', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).toMatch(/workflows\/workflowStore/);
      expect(src).not.toMatch(/ownedDbTable/);
      expect(src).not.toMatch(/'workflow_versions'/);
      expect(src).not.toMatch(/supabase\.rpc/);
    }
  });
});

// ── The migration states its own invariants ────────────────────────────────

describe('032 — the migration', () => {
  const body = () => read(MIGRATION);

  it('creates exactly the two tables', () => {
    const creates = body().match(/CREATE TABLE IF NOT EXISTS public\.[a-z_]+/g) ?? [];
    expect(creates).toEqual([
      'CREATE TABLE IF NOT EXISTS public.workflows',
      'CREATE TABLE IF NOT EXISTS public.workflow_versions',
    ]);
  });

  it('CREATES NO FORBIDDEN ENTITY', () => {
    const b = body();
    for (const banned of [
      /CREATE TABLE[^;]*workflow_steps/i, /CREATE TABLE[^;]*execution_instance/i,
      /CREATE TABLE[^;]*\bplans?\b/i, /CREATE TABLE[^;]*\btasks?\b/i,
      /CREATE TABLE[^;]*message/i,
    ]) {
      expect(b).not.toMatch(banned);
    }
  });

  it('BOTTLENECK 1: the one-published invariant is a PARTIAL unique index', () => {
    expect(body()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_one_published\s*\n\s*ON public\.workflow_versions \(organization_id, workflow_id\)\s*\n\s*WHERE status = 'published'/);
  });

  it('BOTTLENECK 2: the guard permits the published transitions and is NOT unconditional', () => {
    const b = body();
    expect(b).toMatch(/CREATE TRIGGER trg_workflow_versions_guard/);
    expect(b).toMatch(/BEFORE UPDATE ON public\.workflow_versions/);
    expect(b).toMatch(/NEW\.status NOT IN \('superseded', 'archived'\)/);
    expect(b).toMatch(/the content of a published version is immutable/);
    // The postcondition checks the guard mentions both transitions, so a future
    // replacement with an unconditional guard fails the migration itself.
    expect(b).toMatch(/an unconditional guard would break publication/);
  });

  it('BOTTLENECK 3: no DELETE protection is claimed from the trigger', () => {
    const b = body();
    expect(b).toMatch(/BEFORE UPDATE. only, so it cannot stop a DELETE/);
    expect(b).toMatch(/ON DELETE NO ACTION. and not .RESTRICT/);
    // The Version's own keys cascade (tenant + workflow); NO ACTION belongs on the
    // FUTURE referrer, which 032 does not create.
    expect(b).not.toMatch(/REFERENCES public\.workflow_versions/);
  });

  it('declares the companion keys the future Execution Instance needs', () => {
    const b = body();
    expect(b).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_versions_id_org/);
    expect(b).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_id_org/);
  });

  it('the Version → Workflow key is composite and tenant-safe', () => {
    expect(body()).toMatch(
      /FOREIGN KEY \(workflow_id, organization_id\)\s*\n\s*REFERENCES public\.workflows \(id, organization_id\)/);
  });

  it('the lifecycles are exactly the ratified vocabularies', () => {
    const b = body();
    expect(b).toMatch(/status IN \('active', 'archived'\)/);
    expect(b).toMatch(/status IN \('draft', 'published', 'superseded', 'archived'\)/);
  });

  it('there is NO stored current flag and NO authoring content on workflows', () => {
    const b = body();
    expect(b).toMatch(/a redundant current-version flag appeared/);
    expect(b).toMatch(/authoring content appeared on workflows/);
    const create = /CREATE TABLE IF NOT EXISTS public\.workflows \(([\s\S]*?)\n\);/.exec(b);
    expect(create).not.toBeNull();
    for (const banned of [/\bdefinition\b/, /\bsteps\b/, /\bversion\b/, /is_current/]) {
      expect(create![1]).not.toMatch(banned);
    }
  });

  it('the publication function exists, is SECURITY INVOKER and is revoked from anon', () => {
    const b = body();
    expect(b).toMatch(/CREATE OR REPLACE FUNCTION public\.publish_workflow_version/);
    expect(b).toMatch(/SECURITY INVOKER/);
    expect(b).not.toMatch(/SECURITY DEFINER/);
    expect(b).toMatch(/REVOKE EXECUTE ON FUNCTION public\.publish_workflow_version/);
    expect(b).toMatch(/GRANT EXECUTE ON FUNCTION public\.publish_workflow_version\(uuid, uuid, uuid\) TO service_role/);
    expect(b).toMatch(/FOR UPDATE OF w/);               // concurrent publications serialise
  });

  it('enables RLS with service-role policies and grants nothing to anon', () => {
    const b = body();
    expect(b).toMatch(/ALTER TABLE public\.workflows\s+ENABLE ROW LEVEL SECURITY/);
    expect(b).toMatch(/ALTER TABLE public\.workflow_versions\s+ENABLE ROW LEVEL SECURITY/);
    expect((b.match(/auth\.role\(\) = 'service_role'/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(b).not.toMatch(/TO anon/);
    expect(b).not.toMatch(/TO authenticated/);
  });

  it('ALTERS NO EXISTING TABLE', () => {
    const alters = body().match(/ALTER TABLE public\.[a-z_]+/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) {
      expect(['ALTER TABLE public.workflows', 'ALTER TABLE public.workflow_versions']).toContain(a);
    }
  });

  it('owns its tables alone and sorts after the PI chain', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    const owners = files.filter((f: string) =>
      /CREATE\s+TABLE[^;]*public\.workflow_versions/i.test(
        fs.readFileSync(path.join(dir, f), 'utf8') as string)).sort();
    expect(owners).toEqual(['20270111100001_pi_workflow_definitions.sql']);
    // A NAMED predecessor, not "it is the newest".
    expect('20261109000000_pi_campaign_targets.sql' < '20270111100001_pi_workflow_definitions.sql')
      .toBe(true);
  });
});

// ── The predecessors are untouched ─────────────────────────────────────────

describe('032 — isolation, proven by content not by git status', () => {
  // 029's Target identity and 030's producer land with the lists/targets slice
  // (LISTS-001); their isolation from 032 is re-asserted there.

  it('THE PLANNER AND LEGACY LAYERS ARE UNTOUCHED BY 032', () => {
    const files = [
      'backend/services/qualificationPlanning/planningConfig.ts',
      'backend/services/qualificationPlanning/outreachPlanner.ts',
      'backend/services/automationExecution/taskGenerator.ts',
      'backend/services/automationExecution/automationConfig.ts',
      // listEvaluator lands with the lists slice.
    ];
    expect(files.length).toBe(4);
    for (const f of files) {
      const src = code(read(f));
      expect(src.length).toBeGreaterThan(0);
      for (const banned of [/workflowStore/, /workflow_versions/, /publish_workflow_version/]) {
        expect(src).not.toMatch(banned);
      }
    }
  });

  it('the global timing constants still exist and were not redefined', () => {
    const cfg = read('backend/services/automationExecution/automationConfig.ts');
    expect(cfg).toMatch(/STEP_DELAY_LADDER_HOURS = \[0, 48, 72, 72, 96, 120\]/);
    expect(cfg).toMatch(/WAIT_TASK_THRESHOLD_HOURS = 48/);
    expect(cfg).toMatch(/MAX_TASKS = 20/);
  });

  it('the execution layer identity is untouched', () => {
    expect(read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql'))
      .toMatch(/CONSTRAINT outreach_tasks_identity_unique UNIQUE \(company_id, lead_id, plan_task_id\)/);
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────

describe('032 — the routes', () => {
  it('every route verifies membership, then the capability, in that order', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      const access = src.indexOf('enforceCompanyAccess');
      const cap = src.indexOf('requireCapability');
      expect(access).toBeGreaterThan(-1);
      expect(cap).toBeGreaterThan(access);
      expect(src).toMatch(/PROSPECT_ICP_MANAGE/);
      expect(src).toMatch(/guard\.ok !== true/);
    }
  });

  it('introduces NO new capability', () => {
    // Asserted on the SECURITY IMPORT, not on any capitalised identifier: the
    // earlier form also flagged `WORKFLOW_STATUSES`, a store vocabulary, which is
    // not a capability at all. What is durably true is that the only grant any of
    // these routes imports is PROSPECT_ICP_MANAGE.
    for (const r of ROUTES) {
      const src = code(read(r));
      const imported = /import \{([^}]*)\} from '[^']*shared\/contracts\/security';/.exec(src);
      expect(imported).not.toBeNull();
      expect(imported![1].split(',').map((s) => s.trim()).filter(Boolean))
        .toEqual(['PROSPECT_ICP_MANAGE']);
      // And no other capability constant is referenced anywhere in the handler.
      for (const banned of [
        /CAMPAIGN_EXECUTE/, /CAMPAIGN_VIEW/, /CAMPAIGN_DELETE/,
        /AUTOMATION_EXECUTE/, /AUTOMATION_TRANSFER/, /PROSPECT_INGEST/,
      ]) {
        expect(src).not.toMatch(banned);
      }
    }
  });

  it('the method sets are exactly what the contract needs', () => {
    expect(code(read('pages/api/workflows/index.ts'))).toMatch(/METHODS = \['GET', 'POST'\]/);
    expect(code(read('pages/api/workflows/[id].ts'))).toMatch(/METHODS = \['GET', 'PATCH'\]/);
    expect(code(read('pages/api/workflows/[id]/versions.ts')))
      .toMatch(/METHODS = \['GET', 'POST', 'PATCH'\]/);
    expect(code(read('pages/api/workflows/[id]/publish.ts'))).toMatch(/METHODS = \['POST'\]/);
  });

  it('NO ROUTE OFFERS DELETE', () => {
    for (const r of ROUTES) expect(code(read(r))).not.toMatch(/'DELETE'/);
  });

  it('PUBLICATION IS ITS OWN ROUTE, AND THE VERSIONS ROUTE CANNOT PUBLISH', () => {
    const versions = code(read('pages/api/workflows/[id]/versions.ts'));
    expect(versions).not.toMatch(/publishWorkflowVersion/);
    expect(versions).toMatch(/status !== 'archived'/);      // archived only
    const publish = code(read('pages/api/workflows/[id]/publish.ts'));
    expect(publish).toMatch(/publishWorkflowVersion/);
  });

  it('every route passes the VERIFIED tenant and actor, never a body value', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).toMatch(/organizationId: companyId/);
      expect(src).not.toMatch(/body\.organizationId/);
      expect(src).not.toMatch(/body\.actorUserId/);
      expect(src).not.toMatch(/body\.createdBy/);
      expect(src).not.toMatch(/body\.publishedBy/);
    }
    expect(code(read('pages/api/workflows/[id]/publish.ts')))
      .toMatch(/access as \{ userId\?: unknown \}/);
  });

  it('the publish route binds the version to the workflow in the path', () => {
    const src = code(read('pages/api/workflows/[id]/publish.ts'));
    expect(src).toMatch(/candidate\.workflowId !== workflowId/);
  });

  it('no route reaches an execution, plan or governance concept', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      for (const banned of [
        /executionInstance/, /execution_instance/, /createCampaignTarget/,
        /selectCampaignPopulation/, /mayContact/, /dispatch/i, /plan_task_id/,
      ]) {
        expect(src).not.toMatch(banned);
      }
    }
  });
});

// ── Vocabularies ───────────────────────────────────────────────────────────

describe('032 — the exported vocabularies match the ratified contract', () => {
  it('workflow and version statuses are exactly the ratified sets', () => {
    expect([...WORKFLOW_STATUSES]).toEqual(['active', 'archived']);
    expect([...WORKFLOW_VERSION_STATUSES])
      .toEqual(['draft', 'published', 'superseded', 'archived']);
  });

  it('the channel vocabulary is intent, plus the one internal team-task channel', () => {
    // ORCHESTRATION 2026-10-28 (owner confirmation pending): `internal` added — see
    // 'refuses an unknown channel'. It contacts nobody. `social_post` (public post
    // awaiting one released scheduled post; NOT `content`) appended 2026-10-28.
    expect([...WORKFLOW_STEP_CHANNELS]).toEqual([
      'email', 'linkedin', 'phone', 'whatsapp', 'sms',
      'github', 'discord', 'slack', 'community', 'content', 'internal',
      'social_post',
    ]);
  });
});

// ── 032 CLOSEOUT HARDENING ─────────────────────────────────────────────────

describe('032 CLOSEOUT — the maximum is used for ALLOCATION only, never resolution', () => {
  it('a numeric maximum appears in createDraftVersion and NOWHERE in the resolver', () => {
    // LINE ENDINGS NORMALIZED FIRST. This repository's files are CRLF on Windows,
    // so a terminator written as '\n}\n' never matches — it is '\n}\r\n' on disk.
    const src = read(STORE).replace(/\r\n/g, '\n');
    // Built by SPLITTING on a plain marker rather than a constructed RegExp: a
    // template literal eats `\s` and `\n`, which is how the first draft of this
    // guard silently became a different pattern than intended.
    const fnBody = (name: string): string => {
      const head = `export async function ${name}(`;
      const start = src.indexOf(head);
      expect(start).toBeGreaterThan(-1);
      // The terminator is a closing brace ALONE on its line. `'\n}'` also matches
      // the `}` that closes an inline parameter object type at column 0 — which
      // truncated this slice to the signature on the first attempt.
      const end = src.indexOf('\n}\n', start);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    };
    // Allocation legitimately takes a maximum: it is minting a human-facing label.
    expect(fnBody('createDraftVersion')).toMatch(/reduce\(/);
    // Resolution must not, in any form.
    const resolver = fnBody('getCurrentWorkflowVersion');
    expect(resolver).toMatch(/\.eq\('status', 'published'\)/);
    for (const banned of [/reduce\(/, /\.order\(/, /\.limit\(/, /Math\.max/, /created_at/, /'version'/]) {
      expect(resolver).not.toMatch(banned);
    }
  });

  it('listing orders by ordinal, and is never the resolver', () => {
    const src = read(STORE);
    const listing = /export async function listWorkflowVersions\(([\s\S]*?)\n}/.exec(src);
    expect(listing).not.toBeNull();
    // A listing may order; it just must not be mistaken for currency.
    expect(listing![1]).toMatch(/\.order\('version'/);
    expect(listing![1]).not.toMatch(/'published'/);
  });
});

describe('032 CLOSEOUT — the interim authorization decision is recorded in the code', () => {
  it('the collection route states the interim choice and names the rejected alternatives', () => {
    // Recorded in the SOURCE, not only in a report, so it cannot be silently
    // dropped the next time someone edits this route.
    const src = read('pages/api/workflows/index.ts');
    expect(src).toMatch(/PROSPECT_ICP_MANAGE/);
    expect(src).toMatch(/No workflow-specific capability exists/);
    expect(src).toMatch(/CAMPAIGN_EXECUTE/);          // the rejected alternatives,
    expect(src).toMatch(/AUTOMATION_EXECUTE/);        // named with reasons
    expect(src).toMatch(/widening/);                  // the consequence, stated
  });

  it('EVERY workflow mutation route is capability-gated by the same single grant', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'pages/api/workflows');
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d)) {
        const p = path.join(d, e);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(e)) continue;
        found.push(path.relative(process.cwd(), p).split(path.sep).join('/'));
      }
    };
    walk(dir);
    // The whole route surface, enumerated — so a new unguarded route fails here.
    expect(found.sort()).toEqual([
      'pages/api/workflows/[id].ts',
      'pages/api/workflows/[id]/publish.ts',
      // Orchestration 2026-10-28: the read-only journey report, same single grant.
      'pages/api/workflows/[id]/report.ts',
      'pages/api/workflows/[id]/versions.ts',
      'pages/api/workflows/index.ts',
    ].sort());
    for (const f of found) {
      const src = code(read(f));
      expect(src).toMatch(/requireCapability/);
      const imported = /import \{([^}]*)\} from '[^']*shared\/contracts\/security';/.exec(src);
      expect(imported).not.toBeNull();
      expect(imported![1].split(',').map((s) => s.trim()).filter(Boolean))
        .toEqual(['PROSPECT_ICP_MANAGE']);
    }
  });
});

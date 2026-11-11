/**
 * PI-041-A — the Email send path against real PostgreSQL.
 *
 * The REAL migration, the REAL guard, the REAL CHECK constraints, the REAL
 * evidence store, the REAL context and recipient resolvers, the REAL
 * `dispatchInternalOutreachTask` with its certified gate order, and the REAL
 * extended email transport all run here through the pg adapter 030 established.
 *
 * ─── NO PROVIDER IS EVER CALLED ───────────────────────────────────────────
 * The email transport is registered with an INJECTED fake provider port that
 * records what it was handed. There is no SES call, no Edge Function invocation,
 * no network, and no production credential anywhere in this file. Every assertion
 * about "what was sent" is an assertion about what that fake recorded.
 *
 * ─── WHAT THIS DOES NOT PROVE ─────────────────────────────────────────────
 * The adapter connects as the harness superuser and bypasses PostgREST, Kong and
 * RLS, because this harness is a bare PostgreSQL container with none of them. RLS
 * is asserted structurally; route authorization is proven at T1.
 */
process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`; // main's WP3 refuses a send with no unsubscribe link
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson,
} from './setup';
import { Client } from 'pg';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    // `gte` is here because the quota gate reads the attempt window with it. An
    // adapter missing an operator does not fail loudly — the builder returns
    // undefined, `safeDb` catches it, and quota refuses with `read_failed`, which
    // looks exactly like a tenant at its limit. So the comparison operators are
    // supported rather than discovered one failing run at a time.
    type Op = 'eq' | 'is' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'neq';
    type Filter = { col: string; op: Op; val: unknown };
    const SQL_OP: Record<string, string> = {
      gte: '>=', lte: '<=', gt: '>', lt: '<', neq: '<>',
    };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], order: null as { col: string; asc: boolean } | null,
      limit: null as number | null, mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
        params.push(f.val);
        return `"${f.col}" ${SQL_OP[f.op] ?? '='} $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      let sql: string;
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object'
            ? JSON.stringify(row[k]) : row[k]);
          return `$${params.length}`;
        }).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object'
            ? JSON.stringify(row[k]) : row[k]);
          return `"${k}" = $${params.length}`;
        }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Record<string, unknown>) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Record<string, unknown>) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      gte: (col: string, val: unknown) => { st.filters.push({ col, op: 'gte', val }); return b; },
      lte: (col: string, val: unknown) => { st.filters.push({ col, op: 'lte', val }); return b; },
      gt: (col: string, val: unknown) => { st.filters.push({ col, op: 'gt', val }); return b; },
      lt: (col: string, val: unknown) => { st.filters.push({ col, op: 'lt', val }); return b; },
      neq: (col: string, val: unknown) => { st.filters.push({ col, op: 'neq', val }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        st.order = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      const { db: client } = require('./setup') as { db: { query: Function } };
      let call: { sql: string; args: unknown[] };
      if (fn === 'bridge_execution_task') {
        call = {
          sql: `SELECT public.${fn}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS ${fn}`,
          args: [params.p_organization_id, params.p_execution_task_id, params.p_person_id,
            params.p_execution_mode, params.p_workflow_requires_approval,
            params.p_policy_source, params.p_planner_version, params.p_translation_version,
            params.p_governance_version, params.p_execution_runtime_version],
        };
      } else if (fn === 'create_execution_plan' || fn === 'advance_execution_plan'
        || fn === 'cancel_execution_run') {
        call = {
          sql: `SELECT public.${fn}($1,$2) AS ${fn}`,
          args: [params.p_organization_id, params.p_execution_instance_id],
        };
      } else {
        call = {
          sql: `SELECT public.${fn}($1,$2,$3,$4,$5,$6) AS ${fn}`,
          args: [params.p_organization_id, params.p_campaign_id, params.p_workflow_id,
            params.p_subject_kind, params.p_subject_id, params.p_target_id],
        };
      }
      await client.query('SAVEPOINT rpc_adapter');
      try {
        const r = await client.query(call.sql, call.args) as { rows: Record<string, unknown>[] };
        await client.query('RELEASE SAVEPOINT rpc_adapter');
        return { data: r.rows, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT rpc_adapter');
        return { data: null, error: err };
      }
    },
  },
}));

import { bridgeExecutionTask } from '../../services/outreachBridge/outreachBridgeStore';
import { createExecutionInstance } from '../../services/executionInstances/executionInstanceStore';
import { createExecutionPlan, listInstanceTasks } from '../../services/executionPlans/executionPlanStore';
import { approveOutreachTask, submitForApproval } from '../../services/leadOutreachExecution/approval';
// D-02 (S-02) — an external approval needs a passkey proof: the real ceremony over a WebAuthn double.
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';
import { resolveTransport, supportedChannels, __clearTransportsForTests } from '../../services/leadOutreachExecution/transport';
import { registerDefaultTransports } from '../../services/leadOutreachExecution/transportRegistry';
import { type EmailProviderPort, type EmailProviderRequest, type EmailProviderResponse } from '../../services/leadOutreachExecution/emailTransport';
import {
  recordEmailContentEvidence, getEmailContentEvidence,
} from '../../services/emailEngine/emailContentEvidenceStore';
import {
  resolveEmailExecutionContext, resolveEmailRecipient,
} from '../../services/emailEngine/emailExecutionContext';
import { sendEmailForOutreachTask, prepareEmailSend } from '../../services/emailEngine/emailSendPath';
import { dispatchWorkflowEmailTask } from '../../services/emailEngine/workflowEmailDispatch';
import { dispatchApprovedOutreachForLead } from '../../services/leadOutreachActivation';

const EV = 'public.email_outreach_content_evidence';
const ACTOR = '00000000-0000-4000-8000-0000000000e1';
const AT = '2026-10-04T09:00:00.000Z';

/** The fake provider port. It records; it never reaches a network. */
const sent: EmailProviderRequest[] = [];
let providerBehaviour: () => EmailProviderResponse = () => ({ accepted: true, messageId: 'pm-1' });
const fakeProvider: EmailProviderPort = {
  name: 'fake_provider',
  async send(r: EmailProviderRequest): Promise<EmailProviderResponse> {
    sent.push(r);
    return providerBehaviour();
  },
};

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'DID_NOT_THROW';
  } catch (e) {
    return (e as { code?: string }).code ?? `UNTYPED:${(e as Error).message}`;
  }
};

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * A canonical person with a usable address.
 *
 * The address is UNIQUE per person because `unified_persons` enforces one email
 * per company (`idx_unified_persons_company_email_unique`) — a shared fixture
 * address makes the second person in a test collide, which is a property of the
 * real schema worth meeting here rather than working around.
 */
async function personWithEmail(org: string, email: string | null | undefined, extra: Record<string, string | null> = {}) {
  const id = await newPerson(org);
  const address = email === undefined
    ? `t041a-${Math.random().toString(36).slice(2)}@example.test`
    : email;
  await db.query(
    `UPDATE public.unified_persons
        SET primary_email = $2, first_name = $3, full_name = $4, city = $5
      WHERE id = $1`,
    [id, address, extra.first_name ?? 'Ada', extra.full_name ?? 'Ada Lovelace',
      extra.city ?? 'London'],
  );
  return { id, address };
}

/**
 * Authorize a tenant for outreach.
 *
 * Governance is RESTRICTIVE BY DEFAULT: an unconfigured tenant is blocked at the
 * `kill_switch` gate before anything else runs. So every send fixture must
 * authorize its tenant explicitly, and a test below asserts that an unauthorized
 * one cannot send at all.
 */
async function authorizeTenant(org: string): Promise<void> {
  await db.query(
    `INSERT INTO public.outreach_governance_config
        (company_id, enabled, kill_switch, enabled_channels, restricted_regions)
     VALUES ($1, true, false, ARRAY['email','internal'], ARRAY[]::text[])
     ON CONFLICT (company_id) DO UPDATE
        SET enabled = true, kill_switch = false,
            enabled_channels = ARRAY['email','internal']`, [org]);
}

async function newCampaign(org: string, name = 'Q4'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_campaigns (organization_id, name) VALUES ($1,$2) RETURNING id`,
    [org, name]);
  return rows[0].id;
}

async function newWorkflowWithVersion(org: string, definition: unknown, name = 'Outbound') {
  const { rows: w } = await db.query(
    `INSERT INTO public.workflows (organization_id, name) VALUES ($1,$2) RETURNING id`, [org, name]);
  const { rows: v } = await db.query(
    `INSERT INTO public.workflow_versions (organization_id, workflow_id, version, status,
        definition, published_at, published_by)
     VALUES ($1,$2,1,'published',$3::jsonb, now(), $4) RETURNING id`,
    [org, w[0].id, JSON.stringify(definition), ACTOR]);
  return { workflowId: w[0].id as string, versionId: v[0].id as string };
}

async function newProspect(org: string, personId: string | null) {
  const key = `t041a-${Math.random().toString(36).slice(2)}`;
  const { rows: u } = await db.query(
    `INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
     VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `${key}-u`]);
  const { rows } = await db.query(
    `INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key,
        unified_person_id)
     VALUES ($1,$2,'t041a',$3,$4) RETURNING id`, [org, u[0].id, key, personId]);
  return rows[0].id as string;
}

async function newLead(org: string, personId: string) {
  const { rows } = await db.query(
    `INSERT INTO public.leads (company_id, name, email, unified_person_id)
     VALUES ($1,'T041A Lead',$2,$3) RETURNING id`,
    [org, `t041a-${Math.random().toString(36).slice(2)}@example.test`, personId]);
  return rows[0].id as string;
}

const INSTRUCTION = 'Hi {{first_name}}, I noticed your team in {{city}}.\n\nWorth a short call?';

/**
 * A bridged, sendable email task: campaign → workflow → version → instance →
 * plan → step → execution task → legacy task + handoff.
 */
async function bridged(opts: {
  org?: string;
  mode?: string;
  instruction?: string | null;
  email?: string | null;
  kind?: 'lead' | 'prospect';
  requiresApproval?: boolean;
  campaignName?: string;
  withPerson?: boolean;
  /** Skip tenant authorization, to prove an unauthorized tenant cannot send. */
  authorize?: boolean;
} = {}) {
  const org = opts.org ?? ORG_A;
  const kind = opts.kind ?? 'prospect';
  if (opts.authorize !== false) await authorizeTenant(org);
  const step: Record<string, unknown> = {
    key: 'intro', channel: 'email', delay_after_previous_hours: 0,
    execution_mode: opts.mode ?? 'autonomous',
  };
  if (opts.instruction !== null) step.instruction = opts.instruction ?? INSTRUCTION;
  if (opts.requiresApproval) step.requires_approval = true;

  const campaignId = await newCampaign(org, opts.campaignName ?? 'Q4');
  const { workflowId, versionId } = await newWorkflowWithVersion(org, { steps: [step] },
    `WF-${Math.random().toString(36).slice(2)}`);

  const person = opts.withPerson === false
    ? null
    : await personWithEmail(org, opts.email);
  const personId = person ? person.id : null;
  const subjectId = kind === 'lead'
    ? await newLead(org, personId as string)
    : await newProspect(org, personId);

  const instance = await createExecutionInstance({
    organizationId: org, campaignId, workflowId, subjectKind: kind, subjectId,
  });
  const plan = await createExecutionPlan({ organizationId: org, executionInstanceId: instance.id });
  // D-03 fixture: the run is under way, as advance_execution_plan leaves it once a
  // step is eligible. A bridged task of a run that is not active is held, not sent.
  await db.query(`UPDATE public.execution_instances SET lifecycle_state='active' WHERE id=$1`, [instance.id]);
  const [execTask] = await listInstanceTasks(org, instance.id);
  const { handoff } = await bridgeExecutionTask({
    organizationId: org, executionTaskId: execTask.id,
  });
  return {
    org, campaignId, workflowId, versionId, subjectId, personId, instance, plan,
    execTask, handoff, outreachTaskId: handoff.outreachTaskId as string,
    email: person ? person.address : null,
  };
}

/**
 * Approve a bridged task so the dispatcher's claim can succeed. D-02: through the one
 * approval path, which records the content binding the dispatch gate re-checks; a status
 * written directly no longer authorises a send.
 */
async function approve(org: string, taskId: string): Promise<void> {
  expect((await submitForApproval(org, taskId)).ok).toBe(true);
  const r = await approveWithPasskey(org, taskId, 'u-approver');
  expect(r.ok).toBe(true);
  expect(r.changed).toBe(true);
}

/**
 * D-02 — a task whose message cannot be prepared has nothing to bind an approval to, so
 * the approval path refuses it. The status is then forced, as a pre-D-02 approval would
 * have left it, so the send path's own refusal is still what these tests observe.
 */
async function approveUnbindable(org: string, taskId: string): Promise<void> {
  expect((await submitForApproval(org, taskId)).ok).toBe(true);
  expect(await approveOutreachTask(org, taskId, { approverUserId: 'u-approver' }))
    .toMatchObject({ ok: false, refusal: 'binding_unavailable' });
  await db.query("UPDATE public.outreach_tasks SET status = 'approved' WHERE id = $1", [taskId]);
}

/** One real attempt against a bridged task, for the table-level tests. */
async function oneAttempt(org: string, taskId: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.outreach_attempts (company_id, task_id, attempt_number, channel,
        transport, started_at)
     VALUES ($1,$2,1,'email','fake_provider', now()) RETURNING id`, [org, taskId]);
  return rows[0].id as string;
}

const EVIDENCE_INPUT = (org: string, attemptId: string, over: Record<string, unknown> = {}) => ({
  organizationId: org,
  outreachAttemptId: attemptId,
  renderedSubject: 'About your Series B',
  renderedBody: 'Hi Ada,\n\nWorth a call?',
  personalizationInputs: { first_name: 'Ada' },
  contentSource: 'workflow_instruction:email-deterministic-1.0.0',
  ...over,
});

beforeAll(async () => {
  await seedTenants();
});

beforeEach(() => {
  sent.length = 0;
  providerBehaviour = () => ({ accepted: true, messageId: 'pm-1' });
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  __clearTransportsForTests();
  // PI-041-A-E — the PRODUCTION composition root, not a hand-built transport.
  // 041-A registered the hooks itself, which proved the boundary but not the
  // wiring; going through `registerDefaultTransports({ email: 'engine' })` makes
  // every assertion below a statement about what production actually composes.
  // Only the provider is injected, so no real provider is ever reached.
  registerDefaultTransports({ email: 'engine', emailProvider: fakeProvider });
});

afterAll(() => {
  delete process.env.LEAD_OUTREACH_EMAIL_ENABLED;
  __clearTransportsForTests();
});

// ── 1. The migration and the schema it created ──────────────────────────────

describe('041-A/T2 — the evidence table exists as ratified', () => {
  it('has exactly the seven ratified columns plus id, and NONE is nullable', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='email_outreach_content_evidence'
        ORDER BY column_name`);
    expect(rows.map((r: any) => r.column_name)).toEqual([
      'content_source', 'created_at', 'id', 'organization_id', 'outreach_attempt_id',
      'personalization_inputs', 'rendered_body', 'rendered_subject',
    ]);
    expect(rows.filter((r: any) => r.is_nullable === 'YES')).toEqual([]);
    const types = Object.fromEntries(rows.map((r: any) => [r.column_name, r.data_type]));
    expect(types.personalization_inputs).toBe('jsonb');
    expect(types.rendered_subject).toBe('text');
    expect(types.rendered_body).toBe('text');
    expect(types.outreach_attempt_id).toBe('uuid');
  });

  it('EXCLUDES the columns 041-D2 declined', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='email_outreach_content_evidence'
          AND column_name IN ('execution_task_id','provider_message_id','provider','state',
                              'status','updated_at','message_id','message_version_id',
                              'template_id')`);
    expect(rows).toEqual([]);
  });

  it('enforces one evidence row per attempt, and RLS is on', async () => {
    const { rows: u } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conname='email_outreach_content_evidence_attempt_unique'`);
    expect(u[0].d).toBe('UNIQUE (organization_id, outreach_attempt_id)');
    const { rows: r } = await db.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname='email_outreach_content_evidence'`);
    expect(r[0].relrowsecurity).toBe(true);
  });

  it('J-5 IS STILL DEFERRED — no message-versioning table was created', async () => {
    const { rows } = await db.query(
      `SELECT to_regclass('public.message_versions') a,
              to_regclass('public.gtm_message_versions') b,
              to_regclass('public.email_templates') c,
              to_regclass('public.email_threads') d`);
    expect(rows[0]).toEqual({ a: null, b: null, c: null, d: null });
  });

  it('041-A ADDED EXACTLY ONE TABLE, alongside the two that already existed', async () => {
    // Pinned to the exact set, not to "only mine": `email_events` and
    // `email_jobs` are pre-existing transactional-email plumbing and are no part
    // of this chain. Naming them is what makes the census mean something.
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'email%' ORDER BY table_name`);
    expect(rows.map((r: any) => r.table_name))
      .toEqual(['email_events', 'email_jobs', 'email_outreach_content_evidence']);
  });
});

// ── 2. The legacy substrate is untouched ───────────────────────────────────

describe('041-A/T2 — nothing legacy or frozen was changed', () => {
  it('outreach_attempts keeps its 15 columns and its EXACT pre-existing uniqueness', async () => {
    const { rows: c } = await db.query(
      `SELECT count(*)::int n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='outreach_attempts'`);
    expect(c[0].n).toBe(15);
    // WS-3 already gave it one unique constraint. 041-A added none — and in
    // particular not the companion key a tenant-safe composite FK would need,
    // whose absence is why the evidence table uses a single-column FK and a guard.
    const { rows: u } = await db.query(
      `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conrelid='public.outreach_attempts'::regclass AND contype='u'
        ORDER BY conname`);
    expect(u).toEqual([{
      conname: 'outreach_attempts_unique',
      d: 'UNIQUE (company_id, task_id, attempt_number)',
    }]);
  });

  it('the legacy task identity and BOTH 040 bridge identities are intact', async () => {
    // `_legacy_unique` is the one 041-A leans on: it is what makes resolving a
    // context by (organization_id, outreach_task_id) return at most one handoff,
    // so the resolver's single-row read is sound rather than merely lucky.
    const { rows } = await db.query(
      `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conname IN ('outreach_tasks_identity_unique',
                          'outreach_bridge_handoffs_task_unique',
                          'outreach_bridge_handoffs_legacy_unique')
        ORDER BY conname`);
    expect(rows).toEqual([
      {
        conname: 'outreach_bridge_handoffs_legacy_unique',
        d: 'UNIQUE (organization_id, outreach_task_id)',
      },
      {
        conname: 'outreach_bridge_handoffs_task_unique',
        d: 'UNIQUE (organization_id, execution_task_id)',
      },
      {
        conname: 'outreach_tasks_identity_unique',
        d: 'UNIQUE (company_id, lead_id, plan_task_id)',
      },
    ]);
  });

  it('outreach_tasks.lead_id is STILL text — the person anchor contract holds', async () => {
    const { rows } = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='outreach_tasks' AND column_name='lead_id'`);
    expect(rows[0].data_type).toBe('text');
  });
});

// ── 3. Evidence: identity, tenancy, immutability ───────────────────────────

describe('041-A/T2 — content evidence is write-once and tenant-bound', () => {
  it('records once and reads back exactly', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);

      const row = await recordEmailContentEvidence(EVIDENCE_INPUT(ORG_A, attemptId));
      expect(row.outreachAttemptId).toBe(attemptId);
      expect(row.renderedSubject).toBe('About your Series B');
      expect(row.renderedBody).toBe('Hi Ada,\n\nWorth a call?');
      expect(row.personalizationInputs).toEqual({ first_name: 'Ada' });
      expect(row.createdAt).not.toBeNull();

      const back = await getEmailContentEvidence(ORG_A, attemptId);
      expect(back).toEqual(row);
    });
  });

  it('A SECOND ROW FOR THE SAME ATTEMPT IS REFUSED', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);
      await recordEmailContentEvidence(EVIDENCE_INPUT(ORG_A, attemptId));

      expect(await codeOf(recordEmailContentEvidence(
        EVIDENCE_INPUT(ORG_A, attemptId, { renderedBody: 'a different story' }),
      ))).toBe('evidence_exists');

      // And the first story is the one that survived.
      const back = await getEmailContentEvidence(ORG_A, attemptId);
      expect(back?.renderedBody).toBe('Hi Ada,\n\nWorth a call?');
    });
  });

  it('EVERY UPDATE IS REFUSED, including a harmless one', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);
      const row = await recordEmailContentEvidence(EVIDENCE_INPUT(ORG_A, attemptId));

      for (const sql of [
        `UPDATE ${EV} SET rendered_body='rewritten' WHERE id=$1`,
        `UPDATE ${EV} SET rendered_subject='rewritten' WHERE id=$1`,
        `UPDATE ${EV} SET personalization_inputs='{}'::jsonb WHERE id=$1`,
        `UPDATE ${EV} SET content_source='something_else' WHERE id=$1`,
        `UPDATE ${EV} SET created_at=now() WHERE id=$1`,
        `UPDATE ${EV} SET id=id WHERE id=$1`,
      ]) {
        expect(await attempt(sql, [row.id])).not.toBe('ok');
      }

      // Unchanged, byte for byte.
      const { rows } = await db.query(`SELECT rendered_subject, rendered_body FROM ${EV} WHERE id=$1`,
        [row.id]);
      expect(rows[0].rendered_body).toBe('Hi Ada,\n\nWorth a call?');
    });
  });

  it('A CROSS-TENANT EVIDENCE ROW IS REFUSED BY THE DATABASE', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);
      // ORG_B claiming ORG_A's attempt. The FK alone would permit this.
      expect(await codeOf(recordEmailContentEvidence(EVIDENCE_INPUT(ORG_B, attemptId))))
        .toBe('cross_tenant');
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('evidence for an attempt that does not exist is refused', async () => {
    await inRollback(async () => {
      expect(await codeOf(recordEmailContentEvidence(
        EVIDENCE_INPUT(ORG_A, '00000000-0000-4000-8000-0000000000ff'),
      ))).not.toBe('DID_NOT_THROW');
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('refuses blank content and a non-object personalization payload', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);
      // Through the store (its own validation).
      expect(await codeOf(recordEmailContentEvidence(
        EVIDENCE_INPUT(ORG_A, attemptId, { renderedSubject: '   ' })))).toBe('invalid_content');
      // And straight at the database, where the CHECK is the authority. The
      // guard runs BEFORE the CHECK, so the row must satisfy the guard first —
      // which it does: the attempt and tenant agree.
      for (const sql of [
        `INSERT INTO ${EV} (organization_id, outreach_attempt_id, rendered_subject, rendered_body,
            personalization_inputs, content_source) VALUES ($1,$2,'  ','b','{}'::jsonb,'s')`,
        `INSERT INTO ${EV} (organization_id, outreach_attempt_id, rendered_subject, rendered_body,
            personalization_inputs, content_source) VALUES ($1,$2,'s','','{}'::jsonb,'s')`,
        `INSERT INTO ${EV} (organization_id, outreach_attempt_id, rendered_subject, rendered_body,
            personalization_inputs, content_source) VALUES ($1,$2,'s','b','{}'::jsonb,' ')`,
        `INSERT INTO ${EV} (organization_id, outreach_attempt_id, rendered_subject, rendered_body,
            personalization_inputs, content_source) VALUES ($1,$2,'s','b','[1,2]'::jsonb,'s')`,
      ]) {
        expect(await attempt(sql, [ORG_A, attemptId])).toBe('23514');
      }
    });
  });

  it('CONCURRENT RECORDING OF ONE ATTEMPT YIELDS EXACTLY ONE ROW', async () => {
    // Real concurrency needs two COMMITTED connections, so this one test cannot
    // run inside `inRollback`. It therefore commits the smallest possible
    // fixture — a legacy task and an attempt, no execution chain, since evidence
    // only needs an attempt — captures every id as it is created, and removes
    // them in reverse in `finally`. A committed fixture left behind here would
    // surface as a census failure two suites later, which has happened before.
    const second = new Client({ connectionString: process.env.W6_DB_URL });
    let taskId: string | null = null;
    let attemptId: string | null = null;
    await second.connect();
    try {
      const { rows: t } = await db.query(
        `INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, channel, action,
            status, planner_version, translation_version, governance_version,
            execution_runtime_version, materialized_at)
         VALUES ($1,'t041a-conc',$2,'email','Say hello','pending','p','t','g','r', now())
         RETURNING id`, [ORG_A, `task-conc-${Math.random().toString(36).slice(2)}`]);
      taskId = t[0].id as string;
      attemptId = await oneAttempt(ORG_A, taskId);

      const ins = (c: { query: Function }, body: string) => c.query(
        `INSERT INTO ${EV} (organization_id, outreach_attempt_id, rendered_subject,
            rendered_body, personalization_inputs, content_source)
         VALUES ($1,$2,'s',$3,'{}'::jsonb,'src')`, [ORG_A, attemptId, body]);

      const results = await Promise.allSettled([
        ins(db, 'first writer'), ins(second, 'second writer'),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);

      const { rows } = await db.query(
        `SELECT count(*)::int n FROM ${EV} WHERE outreach_attempt_id=$1`, [attemptId]);
      expect(rows[0].n).toBe(1);
    } finally {
      // `outreach_attempts` is append-only: a trigger refuses DELETE outright, so
      // the fixture cannot be withdrawn without standing that trigger down for
      // exactly one statement. It is re-enabled immediately, and the test after
      // this one proves both that nothing leaked and that the trigger is back.
      if (attemptId) await db.query(`DELETE FROM ${EV} WHERE outreach_attempt_id=$1`, [attemptId]);
      if (attemptId) {
        await db.query(`ALTER TABLE public.outreach_attempts DISABLE TRIGGER USER`);
        try {
          await db.query(`DELETE FROM public.outreach_attempts WHERE id=$1`, [attemptId]);
        } finally {
          await db.query(`ALTER TABLE public.outreach_attempts ENABLE TRIGGER USER`);
        }
      }
      if (taskId) await db.query(`DELETE FROM public.outreach_tasks WHERE id=$1`, [taskId]);
      await second.end();
    }
  });

  it('THE CONCURRENCY FIXTURE LEFT NOTHING BEHIND, and the guard is back on', async () => {
    // The counterpart to the test above: proven by content, not by `git status`.
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM ${EV}) ev,
              (SELECT count(*)::int FROM public.outreach_tasks WHERE lead_id='t041a-conc') tasks,
              (SELECT count(*)::int FROM pg_trigger
                WHERE tgrelid='public.outreach_attempts'::regclass
                  AND NOT tgisinternal AND tgenabled = 'D') disabled`);
    expect(rows[0]).toEqual({ ev: 0, tasks: 0, disabled: 0 });
    // And the append-only guard still bites, so standing it down was temporary.
    const { rows: a } = await db.query(
      `SELECT count(*)::int n FROM pg_trigger
        WHERE tgrelid='public.outreach_attempts'::regclass AND NOT tgisinternal`);
    expect(a[0].n).toBeGreaterThan(0);
  });

  it('it survives the content a real email actually contains', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const attemptId = await oneAttempt(ORG_A, r.outreachTaskId);
      const body = [
        'Hi Ada — I noticed your team’s work.',
        '',
        'Quotes: "double" and \'single\'; a backslash \\ and a percent 100%.',
        'Unicode: naïve café 東京 🚀',
        'A line with a trailing space ',
        'x'.repeat(5000),
      ].join('\n');
      const subject = 'Re: “Series B” — 50% faster, naïve café';

      const row = await recordEmailContentEvidence(EVIDENCE_INPUT(ORG_A, attemptId, {
        renderedSubject: subject, renderedBody: body,
        personalizationInputs: { first_name: 'Ada', nested: { a: [1, 2, null] } },
      }));

      const { rows } = await db.query(
        `SELECT rendered_subject, rendered_body, personalization_inputs FROM ${EV} WHERE id=$1`,
        [row.id]);
      expect(rows[0].rendered_subject).toBe(subject);
      expect(rows[0].rendered_body).toBe(body);               // byte for byte
      expect(rows[0].personalization_inputs)
        .toEqual({ first_name: 'Ada', nested: { a: [1, 2, null] } });
    });
  });

  it('tenant offboarding still works — evidence cascades with the company', async () => {
    // Deliberately NOT guarded against DELETE: guarding it would make a tenant
    // undeletable, which is the trap 029 fell into. Immutability is about
    // rewriting history, not about retaining it forever.
    await inRollback(async () => {
      const org = '00000000-0000-4000-8000-00000000c041';
      await db.query(`INSERT INTO public.companies (id, name) VALUES ($1,'T041A Offboard')`, [org]);
      const r = await bridged({ org });
      const attemptId = await oneAttempt(org, r.outreachTaskId);
      await recordEmailContentEvidence(EVIDENCE_INPUT(org, attemptId));

      expect(await attempt(`DELETE FROM public.companies WHERE id=$1`, [org])).toBe('ok');
    });
  });
});

// ── 4. Context and recipient, against the real chain ──────────────────────

describe('041-A/T2 — context and recipient resolve from real rows', () => {
  it('recovers the whole execution chain from a real handoff', async () => {
    await inRollback(async () => {
      const r = await bridged();
      const ctx = await resolveEmailExecutionContext(ORG_A, r.outreachTaskId);
      expect(ctx.campaignId).toBe(r.campaignId);
      expect(ctx.workflowId).toBe(r.workflowId);
      expect(ctx.workflowVersionId).toBe(r.versionId);
      expect(ctx.executionInstanceId).toBe(r.instance.id);
      expect(ctx.executionPlanId).toBe(r.plan.id);
      expect(ctx.executionTaskId).toBe(r.execTask.id);
      expect(ctx.subjectKind).toBe('prospect');
      expect(ctx.subjectId).toBe(r.subjectId);
      expect(ctx.personId).toBe(r.personId);
      expect(ctx.executionMode).toBe('autonomous');
    });
  });

  it('BOTH SUBJECT KINDS resolve, and a lead is not mistaken for a prospect', async () => {
    await inRollback(async () => {
      const p = await bridged({ kind: 'prospect' });
      const l = await bridged({ kind: 'lead' });
      expect((await resolveEmailExecutionContext(ORG_A, p.outreachTaskId)).subjectKind)
        .toBe('prospect');
      const lc = await resolveEmailExecutionContext(ORG_A, l.outreachTaskId);
      expect(lc.subjectKind).toBe('lead');
      expect(lc.subjectId).toBe(l.subjectId);
      // The legacy row carries the subject in a text column that cannot express
      // a kind, which is exactly why the handoff is the authority.
      const { rows } = await db.query(
        `SELECT lead_id FROM public.outreach_tasks WHERE id=$1`, [l.outreachTaskId]);
      expect(rows[0].lead_id).toBe(l.subjectId);
    });
  });

  it('A TASK IN ANOTHER TENANT IS NOT FOUND', async () => {
    await inRollback(async () => {
      const r = await bridged({ org: ORG_A });
      expect(await codeOf(resolveEmailExecutionContext(ORG_B, r.outreachTaskId)))
        .toBe('handoff_not_found');
      expect(await codeOf(resolveEmailRecipient(ORG_B, r.personId as string)))
        .toBe('person_not_found');
    });
  });

  it('a real person with no address refuses, and one with a bad address refuses', async () => {
    await inRollback(async () => {
      const none = await bridged({ email: null });
      expect(await codeOf(resolveEmailRecipient(ORG_A, none.personId as string)))
        .toBe('email_missing');

      const bad = await bridged({ email: 'not-an-address' });
      expect(await codeOf(resolveEmailRecipient(ORG_A, bad.personId as string)))
        .toBe('email_invalid');
    });
  });

  it('a task with no handoff at all is not sendable', async () => {
    await inRollback(async () => {
      // A legacy task, materialized the old way — no execution chain behind it.
      const { rows } = await db.query(
        `INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, channel, action,
            status, planner_version, translation_version, governance_version,
            execution_runtime_version, materialized_at)
         VALUES ($1,'legacy-lead','task-1-legacy','email','Say hello','pending',
            'p','t','g','r', now()) RETURNING id`, [ORG_A]);
      expect(await codeOf(resolveEmailExecutionContext(ORG_A, rows[0].id)))
        .toBe('handoff_not_found');
      expect(await codeOf(prepareEmailSend(ORG_A, rows[0].id))).toBe('handoff_not_found');
    });
  });
});

// ── 5. The send path, end to end, with a fake provider ─────────────────────

describe('041-A/T2 — the real send path', () => {
  it('SENDS THE AUTHORED CONTENT AND RECORDS IT, keyed to the real attempt', async () => {
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      const { dispatch, prepared } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      expect(dispatch.outcome).toBe('sent');
      // The provider received the rendered instruction, personalized.
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(r.email);           // the person's canonical address
      expect(sent[0].body)
        .toBe('Hi Ada, I noticed your team in London.\n\nWorth a short call?');
      expect(sent[0].subject).toBe('Hi Ada, I noticed your team in London.');
      expect(prepared.rendered.body).toBe(sent[0].body);

      // Exactly one attempt, and the evidence is keyed to it.
      const { rows: a } = await db.query(
        `SELECT id, idempotency_key FROM public.outreach_attempts WHERE task_id=$1`,
        [r.outreachTaskId]);
      expect(a).toHaveLength(1);
      const ev = await getEmailContentEvidence(ORG_A, a[0].id);
      expect(ev).not.toBeNull();
      expect(ev?.renderedBody).toBe(sent[0].body);
      expect(ev?.renderedSubject).toBe(sent[0].subject);
      expect(ev?.personalizationInputs).toMatchObject({
        first_name: 'Ada', city: 'London', execution_mode: 'autonomous',
        policy_source: 'authored',
      });
      expect(ev?.contentSource).toBe('workflow_instruction:email-deterministic-1.0.0');
      // The provider's id is NOT on the evidence row — it is not what was sent.
      expect(Object.keys(ev as object)).not.toContain('providerMessageId');
    });
  });

  it('THE RECORDED BYTES ARE THE SENT BYTES, not a re-render', async () => {
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);
      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT });

      const { rows } = await db.query(
        `SELECT e.rendered_body, e.rendered_subject FROM ${EV} e
          JOIN public.outreach_attempts a ON a.id = e.outreach_attempt_id
         WHERE a.task_id = $1`, [r.outreachTaskId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].rendered_body).toBe(sent[0].body);
      expect(rows[0].rendered_subject).toBe(sent[0].subject);
    });
  });

  it('TWO CAMPAIGNS, TWO RUNS, TWO DISTINCT RECORDS', async () => {
    await inRollback(async () => {
      const a = await bridged({ campaignName: 'Campaign A' });
      const b = await bridged({ campaignName: 'Campaign B', instruction: 'Hello {{first_name}}, second campaign.' });
      await approve(ORG_A, a.outreachTaskId);
      await approve(ORG_A, b.outreachTaskId);

      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: a.outreachTaskId, now: AT });
      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: b.outreachTaskId, now: AT });

      expect(sent).toHaveLength(2);
      const { rows } = await db.query(
        `SELECT e.rendered_body, t.id task FROM ${EV} e
          JOIN public.outreach_attempts at ON at.id = e.outreach_attempt_id
          JOIN public.outreach_tasks t ON t.id = at.task_id
         WHERE t.id IN ($1,$2) ORDER BY e.rendered_body`, [a.outreachTaskId, b.outreachTaskId]);
      expect(rows).toHaveLength(2);
      expect(rows[0].rendered_body).toContain('second campaign');
      expect(rows[1].rendered_body).toContain('Worth a short call');
      expect(rows[0].task).not.toBe(rows[1].task);
    });
  });

  it('a LEAD subject sends exactly as a PROSPECT does', async () => {
    await inRollback(async () => {
      const r = await bridged({ kind: 'lead' });
      await approve(ORG_A, r.outreachTaskId);
      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });
      expect(dispatch.outcome).toBe('sent');
      expect(sent).toHaveLength(1);
    });
  });
});

// ── 6. Refusals, against the real chain ────────────────────────────────────

describe('041-A/T2 — what is not sendable is not sent', () => {
  it('NO ADDRESS → NO ATTEMPT, NO EVIDENCE, NO PROVIDER CALL', async () => {
    await inRollback(async () => {
      const r = await bridged({ email: null });
      await approveUnbindable(ORG_A, r.outreachTaskId);

      expect(await codeOf(sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      }))).toBe('email_missing');

      expect(sent).toEqual([]);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.outreach_attempts WHERE task_id=$1`,
        [r.outreachTaskId]);
      expect(rows[0].n).toBe(0);
      const { rows: e } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(e[0].n).toBe(0);
    });
  });

  it('NO AUTHORED INSTRUCTION → NO SEND, and nothing is invented', async () => {
    await inRollback(async () => {
      const r = await bridged({ instruction: null });
      await approveUnbindable(ORG_A, r.outreachTaskId);

      expect(await codeOf(sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      }))).toBe('instruction_missing');

      expect(sent).toEqual([]);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.outreach_attempts WHERE task_id=$1`,
        [r.outreachTaskId]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('A MISSING PERSONALIZATION VALUE REFUSES rather than sending a gap', async () => {
    await inRollback(async () => {
      const r = await bridged({ instruction: 'Hi {{last_name}}, about your work.' });
      await approveUnbindable(ORG_A, r.outreachTaskId);
      // The fixture person has no last_name.
      expect(await codeOf(sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      }))).toBe('personalization_missing');
      expect(sent).toEqual([]);
    });
  });

  // NOT PORTED: PI-041-A-H (autonomous dispatch, the specific awaiting_approval reason) is an open owner decision.
  it.skip('APPROVAL IS AUTHORITATIVE — a human step is not sent', async () => {
    await inRollback(async () => {
      const r = await bridged({ mode: 'human' });
      // The bridge put it in `awaiting_approval`; no approval has been granted.
      const { rows } = await db.query(
        `SELECT status, requires_approval FROM public.outreach_tasks WHERE id=$1`,
        [r.outreachTaskId]);
      expect(rows[0].status).toBe('awaiting_approval');
      expect(rows[0].requires_approval).toBe(true);

      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      // The EXISTING approval authority held it, and it is named: the `approval`
      // gate inside the frozen governance order. PI-041-A-H made the reason more
      // specific — `awaiting_approval` rather than the generic `not_approved` — so
      // that "waiting for a human" is distinguishable from "not a dispatchable
      // state". The authority is unchanged.
      // 041-A added no second path and did not move that gate.
      expect(dispatch.outcome).toBe('blocked_governance');
      expect(dispatch.governance?.blockedBy).toBe('approval');
      expect(dispatch.governance?.blockingCondition).toBe('eligibility.awaiting_approval');
      expect(sent).toEqual([]);
      const { rows: e } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(e[0].n).toBe(0);
    });
  });

  it('an ASSISTED step that requires approval is held the same way', async () => {
    await inRollback(async () => {
      const r = await bridged({ mode: 'assisted', requiresApproval: true });
      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });
      expect(dispatch.outcome).toBe('blocked_governance');
      expect(dispatch.governance?.blockedBy).toBe('approval');
      expect(sent).toEqual([]);
    });
  });

  // NOT PORTED: PI-041-A-H. On main every WS-3 action needs a human; see engineAdapters.ts.
  it.skip('AUTONOMY SKIPS ONLY THE APPROVAL GATE — every other gate still applies', async () => {
    // REWRITTEN by PI-041-A-H. This test used to assert that an autonomous step was
    // held at the approval gate until a human approved it. That was not a policy —
    // it was the defect 041-A-G found: 040 creates an autonomous task as `pending`,
    // `pending → approved` is not a legal transition, and the only route to
    // `approved` needs a named approver, so AUTONOMOUS could never send at all.
    //
    // What "autonomy is not permission" correctly means is asserted here instead:
    // the approval gate no longer holds it, and NOTHING ELSE was relaxed.
    await inRollback(async () => {
      const r = await bridged({ mode: 'autonomous' });

      const out = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      // It sends with no human in the loop, and no approval was fabricated.
      expect(out.dispatch.outcome).toBe('sent');
      expect(sent).toHaveLength(1);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.outreach_approvals WHERE task_id=$1`,
        [r.outreachTaskId]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('AND AUTONOMY IS STILL NOT PERMISSION: the other gates hold it', async () => {
    await inRollback(async () => {
      // Same autonomous step, but the tenant has its kill switch engaged. The
      // approval gate is no longer what stops it; everything else still does.
      const r = await bridged({ mode: 'autonomous' });
      await db.query(
        `UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1`,
        [ORG_A]);

      const out = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      expect(out.dispatch.outcome).toBe('blocked_governance');
      expect(out.dispatch.governance?.blockedBy).toBe('kill_switch');
      expect(sent).toEqual([]);
    });
  });

  it('THE FLAG GATE STILL HOLDS: disabled sends nothing and records nothing', async () => {
    await inRollback(async () => {
      process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'false';
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      expect(dispatch.outcome).not.toBe('sent');
      expect(sent).toEqual([]);
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
      process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
    });
  });

  it('AN UNAUTHORIZED TENANT CANNOT SEND — governance is restrictive by default', async () => {
    await inRollback(async () => {
      const r = await bridged({ authorize: false });
      await approve(ORG_A, r.outreachTaskId);

      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      // The kill_switch gate, FIRST in the frozen order, refuses an unconfigured
      // tenant before a transport is ever consulted.
      expect(dispatch.outcome).toBe('blocked_governance');
      expect(dispatch.governance?.blockedBy).toBe('kill_switch');
      expect(dispatch.governance?.blockingCondition).toBe('tenant.enablement');
      expect(sent).toEqual([]);
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('A PROVIDER REJECTION STILL LEAVES THE EVIDENCE — we know what we tried to send', async () => {
    await inRollback(async () => {
      providerBehaviour = () => ({
        accepted: false, messageId: null, rejectionReason: 'recipient suppressed',
      });
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      const { dispatch } = await sendEmailForOutreachTask({
        organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT,
      });

      expect(dispatch.outcome).not.toBe('sent');
      const { rows } = await db.query(
        `SELECT e.rendered_body FROM ${EV} e
          JOIN public.outreach_attempts a ON a.id=e.outreach_attempt_id WHERE a.task_id=$1`,
        [r.outreachTaskId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].rendered_body).toBe(sent[0].body);
    });
  });

  it('CONTENT NEVER LEAKS INTO THE DELIVERY EVIDENCE', async () => {
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);
      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT });

      const { rows } = await db.query(
        `SELECT d.transport_response::text t FROM public.outreach_delivery_evidence d
          JOIN public.outreach_attempts a ON a.id=d.attempt_id WHERE a.task_id=$1`,
        [r.outreachTaskId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].t).not.toContain('Worth a short call');
      expect(rows[0].t).not.toContain('Ada');
      // Content lives in exactly one place, by design.
      expect(rows[0].t).not.toContain('London');
    });
  });
});

// ── 7. PI-041-A-E — the activation boundary ────────────────────────────────

describe('041-A-E/T2 — the production composition root', () => {
  it('registers EXACTLY ONE email transport, and it is Engine-aware', () => {
    // Re-registering must not accumulate: the registry is a keyed Map, so a
    // second call replaces rather than adds. Proven by the channel census, since
    // two email transports would be indistinguishable from one by any other means.
    registerDefaultTransports({ email: 'engine', emailProvider: fakeProvider });
    registerDefaultTransports({ email: 'engine', emailProvider: fakeProvider });

    expect(supportedChannels()).toEqual(['email', 'internal']);
    const t = resolveTransport('email');
    expect(t).not.toBeNull();
    expect(t?.channel).toBe('email');
    expect(t?.external).toBe(true);
  });

  it('the Engine-aware transport is the one that actually serves a send', async () => {
    // Identity by behaviour, not by inspection: a hook-less transport would send
    // the placeholder derivation and record no evidence.
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);
      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT });

      expect(sent[0].body).toBe('Hi Ada, I noticed your team in London.\n\nWorth a short call?');
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(1);
    });
  });

  it('THE PLACEHOLDER COMPOSITION REFUSES A WORKFLOW TASK — no silent fallback', async () => {
    // The hook-less transport is what the WS-3 harnesses construct. If it ever
    // reached production it would send unauthored content with no evidence, so
    // this records what it does to a Workflow task: sends the placeholder and
    // writes NO evidence. That is precisely why the application never selects it.
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      __clearTransportsForTests();
      registerDefaultTransports({ email: 'placeholder', emailProvider: fakeProvider });
      await sendEmailForOutreachTask({ organizationId: ORG_A, outreachTaskId: r.outreachTaskId, now: AT });

      // What went out is the RAW instruction with its placeholders unsubstituted —
      // a literal `{{first_name}}` addressed to a real person — and nothing at all
      // was recorded. This is the concrete harm the ratified composition prevents.
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toContain('{{first_name}}');
      expect(sent[0].body).toContain('{{city}}');
      expect(sent[0].body).not.toContain('Ada');
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('041-A-E/T2 — the Workflow email caller', () => {
  it('SENDS FROM AN EXECUTION TASK ID, resolving the 040 handoff itself', async () => {
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      const out = await dispatchWorkflowEmailTask({
        organizationId: ORG_A, executionTaskId: r.execTask.id, now: AT,
        // The caller composes the transports itself, so the provider port is
        // injected HERE rather than in `beforeEach` — otherwise it would register
        // the platform's real seam over the fake and reach for the network.
        emailProvider: fakeProvider,
      });

      expect(out.outreachTaskId).toBe(r.outreachTaskId);
      expect(out.dispatch.outcome).toBe('sent');
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(r.email);
      // And the evidence is keyed to the attempt, through the certified path.
      const { rows } = await db.query(
        `SELECT e.rendered_body FROM ${EV} e
          JOIN public.outreach_attempts a ON a.id=e.outreach_attempt_id WHERE a.task_id=$1`,
        [r.outreachTaskId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].rendered_body).toBe(sent[0].body);
    });
  });

  it('AN UNBRIDGED EXECUTION TASK CANNOT SEND — no handoff is manufactured', async () => {
    await inRollback(async () => {
      // A real plan and real execution tasks, but never bridged.
      const campaignId = await newCampaign(ORG_A, 'Unbridged');
      await authorizeTenant(ORG_A);
      const person = await personWithEmail(ORG_A, undefined);
      const subjectId = await newProspect(ORG_A, person.id);
      const { workflowId } = await newWorkflowWithVersion(ORG_A, {
        steps: [{
          key: 'intro', channel: 'email', delay_after_previous_hours: 0,
          execution_mode: 'autonomous', instruction: INSTRUCTION,
        }],
      }, `WF-unbridged-${Math.random().toString(36).slice(2)}`);
      const instance = await createExecutionInstance({
        organizationId: ORG_A, campaignId, workflowId,
        subjectKind: 'prospect', subjectId,
      });
      await createExecutionPlan({ organizationId: ORG_A, executionInstanceId: instance.id });
      const [execTask] = await listInstanceTasks(ORG_A, instance.id);

      expect(await codeOf(dispatchWorkflowEmailTask({
        organizationId: ORG_A, executionTaskId: execTask.id, now: AT,
        emailProvider: fakeProvider,
      }))).toBe('handoff_not_found');

      // Nothing was bridged, sent, attempted or recorded on the way to refusing.
      expect(sent).toEqual([]);
      const { rows } = await db.query(
        `SELECT (SELECT count(*)::int FROM public.outreach_bridge_handoffs
                  WHERE execution_task_id=$1) handoffs,
                (SELECT count(*)::int FROM public.outreach_tasks
                  WHERE plan_task_id=$1::text) legacy,
                (SELECT count(*)::int FROM ${EV}) ev`, [execTask.id]);
      expect(rows[0]).toEqual({ handoffs: 0, legacy: 0, ev: 0 });
    });
  });

  it('AN EXECUTION TASK IN ANOTHER TENANT CANNOT SEND', async () => {
    await inRollback(async () => {
      const r = await bridged({ org: ORG_A });
      await approve(ORG_A, r.outreachTaskId);

      expect(await codeOf(dispatchWorkflowEmailTask({
        organizationId: ORG_B, executionTaskId: r.execTask.id, now: AT,
        emailProvider: fakeProvider,
      }))).toBe('handoff_not_found');
      expect(sent).toEqual([]);
    });
  });

  it('it adds no second opinion: approval still holds the task', async () => {
    await inRollback(async () => {
      const r = await bridged({ mode: 'human' });
      const out = await dispatchWorkflowEmailTask({
        organizationId: ORG_A, executionTaskId: r.execTask.id, now: AT,
        emailProvider: fakeProvider,
      });
      expect(out.dispatch.outcome).toBe('blocked_governance');
      expect(out.dispatch.governance?.blockedBy).toBe('approval');
      expect(sent).toEqual([]);
    });
  });

  it('the flag still gates it: disabled sends nothing', async () => {
    await inRollback(async () => {
      process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'false';
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      const out = await dispatchWorkflowEmailTask({
        organizationId: ORG_A, executionTaskId: r.execTask.id, now: AT,
        emailProvider: fakeProvider,
      });
      expect(out.dispatch.outcome).not.toBe('sent');
      expect(sent).toEqual([]);
      const { rows } = await db.query(`SELECT count(*)::int n FROM ${EV}`);
      expect(rows[0].n).toBe(0);
      process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
    });
  });
});

describe('041-A-E/T2 — legacy operator email is retired', () => {
  // NOT PORTED: PI-041-A-E retiring legacy operator email is an open owner decision.
  it.skip('THE LEGACY PATH REFUSES EMAIL even when the operator asks for it', async () => {
    await inRollback(async () => {
      const r = await bridged();
      await approve(ORG_A, r.outreachTaskId);

      // The legacy service, with email explicitly requested and a recipient
      // supplied — exactly the shape the operator route would produce.
      const reports = await dispatchApprovedOutreachForLead(ORG_A, r.subjectId, {
        channels: ['email', 'internal'], now: AT, recipient: 'operator@example.test',
      });

      expect(reports).toHaveLength(1);
      expect(reports[0].channel).toBe('email');
      expect(reports[0].action).toBe('channel_retired');
      expect(reports[0].reason).toContain('retired');

      // No provider call, no attempt, no evidence — it stopped before dispatch.
      expect(sent).toEqual([]);
      const { rows } = await db.query(
        `SELECT (SELECT count(*)::int FROM public.outreach_attempts WHERE task_id=$1) attempts,
                (SELECT count(*)::int FROM ${EV}) ev`, [r.outreachTaskId]);
      expect(rows[0]).toEqual({ attempts: 0, ev: 0 });
    });
  });

  it('LEGACY INTERNAL ACTIVATION STILL WORKS — only email was retired', async () => {
    await inRollback(async () => {
      const r = await bridged({ mode: 'autonomous' });
      // Re-channel the bridged task to `internal`, which contacts nobody. This is
      // the capability that must survive the retirement.
      await db.query(`UPDATE public.outreach_tasks SET channel='internal' WHERE id=$1`,
        [r.outreachTaskId]);
      await approve(ORG_A, r.outreachTaskId);

      const reports = await dispatchApprovedOutreachForLead(ORG_A, r.subjectId, {
        channels: ['internal'], now: AT,
      });

      expect(reports).toHaveLength(1);
      expect(reports[0].action).toBe('dispatched');
      expect(reports[0].outcome).toBe('sent');
      // An internal work item, not an email: no provider was involved.
      expect(sent).toEqual([]);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.outreach_internal_work_items WHERE task_id=$1`,
        [r.outreachTaskId]);
      expect(rows[0].n).toBe(1);
    });
  });
});

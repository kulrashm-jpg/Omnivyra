/**
 * ORCHESTRATION — one person's whole journey, against REAL PostgreSQL.
 *
 * list → campaign target → enrollment → published version → plan → sweep → WS-3
 * bridge → human approval → email dispatch with the authored message → response →
 * journey exit → PI lifecycle. Everything is the real module writing the real schema.
 *
 * Replaced, and only these: the PostgREST transport (the pg adapter pattern of
 * orch_campaign_targets), the Redis counter behind the WS-3 quota, and the email
 * provider, which records what it was asked to send. Nothing leaves the process.
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

type Row = Record<string, unknown>;

let adapterTail: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = adapterTail.then(fn, fn);
  adapterTail = run.catch(() => undefined);
  return run;
}
(global as unknown as { __orchSerialized: typeof serialized }).__orchSerialized = serialized;

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const serial = (global as unknown as { __orchSerialized: <T>(fn: () => Promise<T>) => Promise<T> }).__orchSerialized;
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: string; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Row | null, filters: [] as Filter[],
      orders: [] as Array<{ col: string; asc: boolean }>, limit: null as number | null, mode: 'many' as 'many' | 'one' | 'single',
    };
    const normalize = (row: Row): Row => {
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const SQL_OP: Record<string, string> = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<', neq: '<>' };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'not_is_null') return `"${f.col}" IS NOT NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return list.length ? `"${f.col}" IN (${list.join(', ')})` : 'false';
        }
        params.push(f.val);
        return `"${f.col}" ${SQL_OP[f.op]} $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      const render = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      let sql: string;
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (`
          + keys.map((k) => { params.push(render(row[k])); return `$${params.length}`; }).join(', ')
          + `) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => { params.push(render(row[k])); return `"${k}" = $${params.length}`; }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.orders.length) sql += ` ORDER BY ${st.orders.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: Row[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = res.rows.map(normalize);
        if (st.mode === 'single' && out.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected one row, got ${out.length}` } };
        if (st.mode !== 'many') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const filter = (op: string) => (col: string, val: unknown) => { st.filters.push({ col, op, val }); return b; };
    const b: Row = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: filter('eq'), gte: filter('gte'), lte: filter('lte'), gt: filter('gt'), lt: filter('lt'), neq: filter('neq'),
      is: filter('is'), in: filter('in'),
      not: (col: string, _op: string, _val: unknown) => { st.filters.push({ col, op: 'not_is_null', val: null }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => { st.orders.push({ col, asc: opts?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'single'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => serial(exec).then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => (global as unknown as { __orchSerialized: <T>(f: () => Promise<T>) => Promise<T> }).__orchSerialized(async () => {
      const { db: client } = require('./setup') as { db: { query: Function } };
      if (!/^[a-z_]+$/.test(fn)) throw new Error(`pg adapter: bad function name ${fn}`);
      const keys = Object.keys(args);
      const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      await client.query('SAVEPOINT pg_rpc');
      try {
        const res = await client.query(sql, keys.map((k) => args[k])) as { rows: Row[] };
        await client.query('RELEASE SAVEPOINT pg_rpc');
        return { data: res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_rpc');
        return { data: null, error: err };
      }
    }),
  },
}));

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
// D-02 (S-02) — an external approval needs a passkey proof: the real ceremony, over a WebAuthn
// double (realschema/d02_approval_binding.test.ts exercises the real challenge store).
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';

/* eslint-disable @typescript-eslint/no-var-requires */
const lists = require('../../services/prospectLists');
const { productionListStore: store } = require('../../services/prospectLists/store');
const campaigns = require('../../services/prospectCampaigns/prospectCampaignStore');
const attach = require('../../services/prospectCampaigns/campaignListStore');
const { selectCampaignTargets } = require('../../services/prospectCampaigns/campaignSelectionService');
const { enrollCampaignTargets } = require('../../services/orchestration/campaignEnrollment');
const workflows = require('../../services/workflows/workflowStore');
const { buildJourneyReport } = require('../../services/orchestration/journeyReport');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { listJourneyDecisions } = require('../../services/orchestration/journeyDecisionLog');
const { whatsappReplyFingerprint } = require('../../services/orchestration/journeyFeedback');
const ws3 = require('../../services/leadOutreachExecution');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { ensureProspectLifecycleOpen, recordProspectTransition } = require('../../services/prospectLifecycle');
/* eslint-enable @typescript-eslint/no-var-requires */

const rnd = () => Math.random().toString(36).slice(2, 10);
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Row;
const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

const sent: Array<{ to: string; subject: string; body: string }> = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; subject: string; body: string; idempotencyKey: string }) {
    sent.push({ to: r.to, subject: r.subject, body: r.body });
    return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} };
  },
};
const adapters = () => [createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Row) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
})];
const sweep = (org: string = ORG_A) =>
  advanceAndDispatchWorkflowExecution(org, { now: new Date().toISOString(), deps: { adapters: adapters() } });

async function newUser(): Promise<string> {
  return String((await one('INSERT INTO public.users (email) VALUES ($1) RETURNING id', [`orch-${rnd()}@example.test`])).id);
}
async function newProspect(org: string, contact: { email?: string; phone?: string; firstName?: string | null } = {}): Promise<{ prospectId: string; personId: string }> {
  const key = `orch-${rnd()}`;
  const personId = String((await one(
    'INSERT INTO public.unified_persons (company_id, primary_email, primary_phone, first_name) VALUES ($1,$2,$3,$4) RETURNING id',
    [org, contact.email ?? null, contact.phone ?? null, contact.firstName === undefined ? 'Ana' : contact.firstName],
  )).id);
  const u = await one(`INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
    VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `${key}-u`]);
  const prospectId = String((await one(`INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key, unified_person_id)
    VALUES ($1,$2,'orch',$3,$4) RETURNING id`, [org, u.id, key, personId])).id);
  return { prospectId, personId };
}
async function openLedger(org: string, prospectId: string, to = 'qualified'): Promise<void> {
  await ensureProspectLifecycleOpen({ organizationId: org, prospectId, now: new Date().toISOString() });
  await recordProspectTransition({
    organizationId: org, prospectId, to, origin: 'derived', actorUserId: null,
    evidence: { kind: 'icp_evaluation' }, sourceEventKey: `derivation:seed-${rnd()}`, now: new Date().toISOString(),
  });
}
async function enableOutreach(org: string, channels: string[]): Promise<void> {
  await db.query(`INSERT INTO public.outreach_governance_config (company_id, enabled, enabled_channels)
    VALUES ($1, true, $2) ON CONFLICT (company_id) DO UPDATE SET enabled = true, enabled_channels = $2`, [org, channels]);
}
const human = (key: string, channel: string, extra: Row = {}) =>
  ({ key, channel, delay_after_previous_hours: 0, execution_mode: 'human', ...extra });
const EMAIL_STEP = (key: string) => human(key, 'email', { instruction: `Hello {{first_name}}, about ${key}\nBody of ${key}` });

async function enrol(org: string, actor: string, prospectId: string, definition: Row): Promise<{ instanceId: string; workflowId: string; report: Row }> {
  const l = await lists.createProspectList(store, { organizationId: org, name: `list-${rnd()}`, actorUserId: actor });
  await lists.addProspectToList(store, { organizationId: org, listId: l.value.id, prospectId, addedVia: 'manual', actorUserId: actor });
  const campaignId = String((await campaigns.createProspectCampaign({ organizationId: org, name: `camp-${rnd()}`, status: 'active' })).id);
  await attach.attachListToCampaign({ organizationId: org, campaignId, listId: l.value.id, actorUserId: actor });
  await selectCampaignTargets({ organizationId: org, campaignId, selectionKey: rnd(), origin: 'human', actorUserId: actor });
  const wf = await workflows.createWorkflow({ organizationId: org, name: `wf-${rnd()}`, actorUserId: actor });
  const draft = await workflows.createDraftVersion({ organizationId: org, workflowId: wf.id, definition, actorUserId: actor });
  await workflows.publishWorkflowVersion({ organizationId: org, versionId: draft.id, actorUserId: actor });
  const report = await enrollCampaignTargets({ organizationId: org, campaignId, workflowId: wf.id });
  const out = report.outcomes.find((o: Row) => o.prospectId === prospectId);
  return { instanceId: out?.instanceId as string, workflowId: String(wf.id), report };
}
const lifecycle = (org: string, prospectId: string) => db.query(
  'SELECT state, evidence_kind, source_event_key FROM public.prospect_lifecycle_transitions WHERE organization_id = $1 AND prospect_id = $2 ORDER BY seq',
  [org, prospectId],
).then((r) => r.rows as Row[]);
const instanceState = async (id: string) => String((await one('SELECT lifecycle_state s FROM public.execution_instances WHERE id = $1', [id])).s);
const handoffTasks = (id: string) => db.query(
  `SELECT t.id, t.status FROM public.outreach_bridge_handoffs h JOIN public.outreach_tasks t ON t.id = h.outreach_task_id
    WHERE h.execution_instance_id = $1 ORDER BY t.task_order`, [id],
).then((r) => r.rows as Array<{ id: string; status: string }>);

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });

describe('one person, list to lifecycle', () => {
  it('sends only what was authored, to their canonical address, after approval; a reply ends the journey and reaches PI once', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'person@example.test' });
      await openLedger(ORG_A, prospectId);
      const { instanceId, workflowId, report } = await enrol(ORG_A, actor, prospectId, {
        objective: { statement: 'Get a reply', success_outcome: 'replied' },
        steps: [EMAIL_STEP('intro'), EMAIL_STEP('followup')],
      });
      expect(report.enrolled).toBe(1);

      // Sweep 1: the step is bridged and waits on a person. Nothing is sent.
      let r = await sweep();
      expect(r.counters.tasks_waiting).toBe(1);
      expect(sent).toHaveLength(0);
      let tasks = await handoffTasks(instanceId);
      expect(tasks.map((t) => t.status)).toEqual(['awaiting_approval']);

      // A repeated sweep decides the same thing and records nothing new.
      const before = (await listJourneyDecisions(ORG_A, instanceId)).length;
      await sweep();
      expect((await listJourneyDecisions(ORG_A, instanceId))).toHaveLength(before);

      // Approved: dispatched with the authored message to the canonical address.
      expect((await approveWithPasskey(ORG_A, tasks[0].id, actor)).ok).toBe(true);
      r = await sweep();
      expect(r.issues).toEqual([]);
      expect(sent).toEqual([{ to: 'person@example.test', subject: 'Hello Ana, about intro', body: 'Hello Ana, about intro\nBody of intro' }]);

      // The certified engine recorded exactly what was handed over, against the attempt.
      const evidence = await one('SELECT e.rendered_subject, e.rendered_body, e.personalization_inputs FROM public.email_outreach_content_evidence e JOIN public.outreach_attempts a ON a.id = e.outreach_attempt_id WHERE a.task_id = $1', [tasks[0].id]);
      expect(evidence).toMatchObject({ rendered_subject: sent[0].subject, rendered_body: sent[0].body });
      expect(evidence.personalization_inputs).toMatchObject({ first_name: 'Ana' });
      expect(r.counters.steps_settled).toBe(1);

      // The follow-up is due and queued for approval.
      await sweep();
      tasks = await handoffTasks(instanceId);
      expect(tasks.map((t) => t.status)).toEqual(['sent', 'awaiting_approval']);

      // The person replies on the first message. The journey ends before the follow-up
      // can be approved, and its task is withdrawn so nobody approves a moot message.
      const fed = await ws3.ingestFeedback({
        companyId: ORG_A, taskId: tasks[0].id, signal: 'replied',
        occurredAt: new Date().toISOString(), source: 'manual',
      });
      expect(fed.ok).toBe(true);
      r = await sweep();
      expect(r.counters.journeys_exited).toBe(1);
      expect(await instanceState(instanceId)).toBe('cancelled');
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['sent', 'cancelled']);
      expect(sent).toHaveLength(1);

      // PI heard it, through its own producer, citing the outcome.
      expect(r.lifecycleFeedback.written).toBe(1);
      let ledger = await lifecycle(ORG_A, prospectId);
      expect(ledger.at(-1)).toMatchObject({ state: 'engaged', evidence_kind: 'outreach_outcome' });

      // Replays converge: no second exit, no second transition.
      r = await sweep();
      expect(r.counters.journeys_exited).toBe(0);
      expect(r.lifecycleFeedback.written).toBe(0);
      expect(await lifecycle(ORG_A, prospectId)).toHaveLength(ledger.length);
      ledger = await lifecycle(ORG_A, prospectId);

      // The durable record and the operator report agree.
      const decisions = await listJourneyDecisions(ORG_A, instanceId);
      expect(decisions.map((d: Row) => d.decision)).toEqual(expect.arrayContaining(['waiting', 'executed', 'exited']));
      const exited = decisions.find((d: Row) => d.decision === 'exited') as Row;
      expect(exited).toMatchObject({ planStepId: null, outcome: 'replied' });
      expect(JSON.stringify(decisions)).not.toContain('person@example.test');
      const journeyReport = await buildJourneyReport({ organizationId: ORG_A, workflowId });
      expect(journeyReport.versions[0].attainment.reached).toBe(1);
      expect(journeyReport.versions[0].decisions.exited).toBe(1);
    });
  });

  it('a prospect with no ledger gets one when a journey first acts, so a reply after the journey finished still reaches PI', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'late@example.test' });
      expect(await lifecycle(ORG_A, prospectId)).toEqual([]);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [EMAIL_STEP('only')] });
      await sweep();
      expect((await lifecycle(ORG_A, prospectId)).map((t) => t.state)).toEqual(['identified']);
      const [task] = await handoffTasks(instanceId);
      expect((await approveWithPasskey(ORG_A, task.id, actor)).ok).toBe(true);
      await sweep();
      await sweep();
      expect(await instanceState(instanceId)).toBe('completed');

      await ws3.ingestFeedback({ companyId: ORG_A, taskId: task.id, signal: 'replied', occurredAt: new Date().toISOString(), source: 'manual' });
      const r = await sweep();
      expect(r.lifecycleFeedback.written).toBe(1);
      expect((await lifecycle(ORG_A, prospectId)).at(-1)).toMatchObject({ state: 'engaged' });
    });
  });

  it('a person with no value for a placeholder is skipped, never sent "Hello ,"', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'n@example.test', firstName: null });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [EMAIL_STEP('only')] });
      await sweep();
      expect(sent).toHaveLength(0);
      expect(await handoffTasks(instanceId)).toEqual([]);
      const d = await listJourneyDecisions(ORG_A, instanceId);
      expect(d.find((x: Row) => x.decision === 'skipped')).toMatchObject({ outcome: 'personalization_missing' });
    });
  });

  it('an email step with no authored message goes to a person, and nothing is bridged', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'x@example.test' });
      const { instanceId, workflowId } = await enrol(ORG_A, actor, prospectId, { steps: [human('bare', 'email')] });
      const r = await sweep();
      expect(r.counters.tasks_needing_human).toBe(1);
      expect(await handoffTasks(instanceId)).toEqual([]);
      expect(sent).toHaveLength(0);
      const report = await buildJourneyReport({ organizationId: ORG_A, workflowId });
      expect(report.versions[0].needsHuman).toEqual([
        expect.objectContaining({ executionInstanceId: instanceId, stepKey: 'bare', outcome: 'no_authored_content' }),
      ]);
    });
  });

  it('a person with no address is skipped, recorded, and the journey completes', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [EMAIL_STEP('only')] });
      await sweep();
      await sweep();
      expect(await instanceState(instanceId)).toBe('completed');
      expect(sent).toHaveLength(0);
      const d = await listJourneyDecisions(ORG_A, instanceId);
      expect(d.some((x: Row) => x.decision === 'skipped')).toBe(true);
    });
  });
});

describe('Prospect Intelligence decides who is closed', () => {
  it('a closed prospect is not enrolled, and a run whose prospect closes later stops without contact', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();

      const closed = await newProspect(ORG_A, { email: 'c@example.test' });
      await openLedger(ORG_A, closed.prospectId, 'closed_disqualified');
      const first = await enrol(ORG_A, actor, closed.prospectId, { steps: [EMAIL_STEP('only')] });
      expect(first.report.enrolled).toBe(0);
      expect(first.report.exclusionReasons.prospect_lifecycle_closed).toBe(1);

      const open = await newProspect(ORG_A, { email: 'o@example.test' });
      await openLedger(ORG_A, open.prospectId);
      const second = await enrol(ORG_A, actor, open.prospectId, { steps: [EMAIL_STEP('only')] });
      expect(second.report.enrolled).toBe(1);
      await recordProspectTransition({
        organizationId: ORG_A, prospectId: open.prospectId, to: 'closed_disqualified', origin: 'derived', actorUserId: null,
        evidence: { kind: 'contact_governance' }, sourceEventKey: `derivation:seed-${rnd()}`, now: new Date().toISOString(),
      });
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(1);
      expect(await instanceState(second.instanceId)).toBe('cancelled');
      expect(sent).toHaveLength(0);
      const exited = (await listJourneyDecisions(ORG_A, second.instanceId)).find((d: Row) => d.decision === 'exited') as Row;
      expect(exited.outcome).toBe('closed_disqualified');
    });
  });
});

describe('WhatsApp responses', () => {
  it('an inbound message after this run reached out ends the journey and reaches PI as engagement-thread evidence', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'w@example.test', phone: '+15551230001' });
      await openLedger(ORG_A, prospectId);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, {
        steps: [human('wa', 'whatsapp', { whatsapp: { template_name: 'hello_1' } }), EMAIL_STEP('next')],
      });

      // The engine's request exists, as the WhatsApp adapter leaves it once submitted.
      await sweep();                                     // no whatsapp adapter here: step is ready, visible as unsupported
      const task = await one('SELECT id FROM public.execution_tasks WHERE execution_instance_id = $1 AND channel = $2', [instanceId, 'whatsapp']);
      const u = await one(`SELECT id FROM public.users LIMIT 1`);
      const account = await one(`INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
        VALUES ($1,'whatsapp',$2,'wa','t',$3) RETURNING id`, [u.id, rnd(), ORG_A]);
      await db.query(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state, external_ref, created_at)
        VALUES ($1,$2,'whatsapp','submitted',$3, now() - interval '1 hour')`, [ORG_A, task.id, rnd()]);
      const thread = await one(`INSERT INTO public.engagement_threads (platform, platform_thread_id, organization_id, social_account_id)
        VALUES ('whatsapp',$1,$2,$3) RETURNING id`, [`wa:${account.id}:15551230001`, ORG_A, account.id]);
      await db.query(`INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, content, direction, status, created_at)
        VALUES ($1,'whatsapp',$2,'yes please','inbound','received', now())`, [thread.id, 'wamid.HBgM+abc=']);

      // A whatsapp adapter that must not be asked: the response is seen first.
      const execute = jest.fn();
      const r = await advanceAndDispatchWorkflowExecution(ORG_A, {
        now: new Date().toISOString(),
        deps: { adapters: [...adapters(), { engine: 'whatsapp', channels: ['whatsapp'], execute }] },
      });
      expect(execute).not.toHaveBeenCalled();
      expect(r.counters.journeys_exited).toBe(1);
      expect(await instanceState(instanceId)).toBe('cancelled');
      const ledger = await lifecycle(ORG_A, prospectId);
      expect(ledger.at(-1)).toMatchObject({ state: 'engaged', evidence_kind: 'engagement_thread', source_event_key: `derivation:${whatsappReplyFingerprint('wamid.HBgM+abc=')}` });
    });
  });
});

describe('frequency policy counts contact, not bookkeeping', () => {
  it('an internal step does not defer the email that follows it', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email', 'internal']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'f@example.test' });
      await openLedger(ORG_A, prospectId);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, {
        policy: { min_hours_between_actions: 48 },
        steps: [human('assign', 'internal'), EMAIL_STEP('intro')],
      });
      await sweep();
      const [task] = await handoffTasks(instanceId);
      expect((await approveWithPasskey(ORG_A, task.id, actor)).ok).toBe(true);
      await sweep();
      expect((await handoffTasks(instanceId))[0].status).toBe('sent');
      const r = await sweep();
      expect(r.counters.tasks_deferred_frequency).toBe(0);
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['sent', 'awaiting_approval']);
    });
  });
});

describe('frequency policy does not hold back a step that contacts nobody', () => {
  it('an internal step right after an email is not deferred, and a second email is', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email', 'internal']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'g@example.test' });
      await openLedger(ORG_A, prospectId);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, {
        policy: { min_hours_between_actions: 48 },
        steps: [EMAIL_STEP('intro'), human('note', 'internal'), EMAIL_STEP('again')],
      });
      await sweep();
      expect((await approveWithPasskey(ORG_A, (await handoffTasks(instanceId))[0].id, actor)).ok).toBe(true);
      await sweep();
      expect(sent).toHaveLength(1);

      let r = await sweep();                             // the internal step is due right after contact
      expect(r.counters.tasks_deferred_frequency).toBe(0);
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['sent', 'awaiting_approval']);
      expect((await approveWithPasskey(ORG_A, (await handoffTasks(instanceId))[1].id, actor)).ok).toBe(true);
      await sweep();

      r = await sweep();                                 // the next email is real contact, within 48h
      expect(r.counters.tasks_deferred_frequency).toBe(1);
      expect(sent).toHaveLength(1);
      expect((await handoffTasks(instanceId))).toHaveLength(2);
    });
  });
});

describe('execution_journey_decisions as PostgreSQL holds it', () => {
  it('is append-only, unique per decision, closed to client roles, and tenant-scoped on read', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [human('bare', 'email')] });
      await sweep();
      const [d] = await listJourneyDecisions(ORG_A, instanceId);
      expect(d).toBeDefined();

      await db.query('SAVEPOINT u');
      await expect(db.query(`UPDATE public.execution_journey_decisions SET outcome = 'x' WHERE id = $1`, [d.id])).rejects.toThrow(/historical record/);
      await db.query('ROLLBACK TO SAVEPOINT u');
      await db.query('SAVEPOINT v');
      await expect(db.query(
        `INSERT INTO public.execution_journey_decisions (organization_id, execution_instance_id, plan_step_id, decision, decision_key)
         VALUES ($1,$2,NULL,'waiting','k')`, [ORG_A, instanceId],
      )).rejects.toThrow(/step_or_exit/);
      await db.query('ROLLBACK TO SAVEPOINT v');

      for (const role of ['anon', 'authenticated']) {
        expect(await count(`SELECT count(*) n FROM information_schema.role_table_grants
          WHERE table_name = 'execution_journey_decisions' AND grantee = $1`, [role])).toBe(0);
      }
      expect(await listJourneyDecisions(ORG_B, instanceId)).toEqual([]);
    });
  });
});

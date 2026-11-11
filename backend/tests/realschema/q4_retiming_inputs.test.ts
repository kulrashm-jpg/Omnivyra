/**
 * SC-7 Q-4 — the retiming engine's read seam on REAL PostgreSQL: the run, step, controls,
 * recorded consequences, window and tenant timezone come from the stores that already hold
 * them, and reading them writes nothing. The engine itself is pure (unit fixtures in
 * unit/q4FollowUpRetiming.test.ts); nothing persists a retiming yet, and nothing in the
 * sweeper calls it (SC7-R open).
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import { enableOutreach, enrol, emailStep, handoffTasks, newProspect, newUser, one, rows } from './helpers/journeyFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
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

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { decideFollowUpRetiming, loadRetimingInputs } = require('../../services/orchestration/journeyRetiming');
/* eslint-enable @typescript-eslint/no-var-requires */

const sent: string[] = [];
const provider = { name: 'supabase_edge_ses', async send(r: { to: string; idempotencyKey: string }) { sent.push(r.to); return { accepted: true, messageId: `m-${r.idempotencyKey}`, raw: {} }; } };
const adapters = () => [createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
})];
const sweep = () => advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date().toISOString(), deps: { adapters: adapters() } });
// Open all week: the fixture sweeps at the real clock, so a narrower window fails outside it.
const WINDOW = { timezone: 'Europe/London', start_hour: 0, end_hour: 24, weekdays: [0, 1, 2, 3, 4, 5, 6] };
const signal = (id = 'wamid-ooo-1') => ({ signalId: id, kind: 'out_of_office', receivedAt: new Date().toISOString(), returnDate: { kind: 'date', date: '2026-11-30' } });
const NOW = '2026-11-05T12:00:00.000Z';

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });

/** Two email steps in a windowed journey: step 1 handed off and awaiting approval, step 2 the follow-up. */
async function journey() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email']);
  const actor = await newUser();
  const { prospectId } = await newProspect(ORG_A, { email: 'q4@example.test' });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, {
    steps: [emailStep('intro'), { ...emailStep('follow'), delay_after_previous_hours: 48 }],
    policy: { execution_window: WINDOW },
  });
  await sweep();
  const [task] = await handoffTasks(instanceId);
  const steps = await rows(`SELECT s.id, s.step_key, s.state FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id
    WHERE p.execution_instance_id = $1 ORDER BY s.step_order`, [instanceId]);
  return { instanceId, firstTask: String(task.id), followStep: String(steps[1].id) };
}

/** Everything the loader could conceivably write. */
const footprint = async (instanceId: string) => JSON.stringify(await rows(`
  SELECT (SELECT lifecycle_state FROM public.execution_instances WHERE id = $1) run,
         (SELECT json_agg(json_build_object('s', s.state, 'r', s.ready_at) ORDER BY s.step_order) FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id WHERE p.execution_instance_id = $1) steps,
         (SELECT count(*) FROM public.execution_journey_decisions WHERE execution_instance_id = $1) decisions,
         (SELECT count(*) FROM public.outreach_outcomes WHERE company_id = $2) outcomes,
         (SELECT count(*) FROM public.outreach_tasks WHERE company_id = $2) tasks,
         (SELECT count(*) FROM public.audit_logs) audits`, [instanceId, ORG_A]));
const outcome = (taskId: string, type: string) => db.query(
  `INSERT INTO public.outreach_outcomes (company_id, task_id, outcome_type, occurred_at, source, metadata) VALUES ($1,$2,$3,now(),'manual','{}'::jsonb)`,
  [ORG_A, taskId, type]);

describe('Q-4 — the retiming inputs, read from the existing stores (real PostgreSQL)', () => {
  it('an active run: the step, window, delay and tenant timezone are read; the read writes nothing', async () => {
    await inRollback(async () => {
      const j = await journey();
      await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'America/New_York')
        ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
      const before = await footprint(j.instanceId);
      const { context, policy } = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      expect(await footprint(j.instanceId)).toBe(before);
      expect(context).toMatchObject({ runLifecycleState: 'active', stepState: 'pending', controlRefusal: null, consequences: [], prior: null });
      expect(policy).toEqual({ delayHours: 48, window: WINDOW, personTimezone: null, tenantTimezone: 'America/New_York' });
      // 30 Nov midnight London (the window's zone outranks the tenant's) + 48h = Wed 2 Dec 00:00, inside the open window.
      const d = decideFollowUpRetiming(signal(), context, policy, NOW);
      expect(d).toMatchObject({ kind: 'retime', nextEligibleAt: '2026-12-02T00:00:00.000Z' });
      // The same read inputs under a 09:00-17:00 weekday window move to the window's opening.
      const office = { ...policy, window: { timezone: 'Europe/London', start_hour: 9, end_hour: 17, weekdays: [1, 2, 3, 4, 5] } };
      expect(decideFollowUpRetiming(signal(), context, office, NOW)).toMatchObject({ kind: 'retime', nextEligibleAt: '2026-12-02T09:00:00.000Z' });
      expect(d.effects).toMatchObject({ outcome: null, endsJourney: false, suppression: false, unsubscribe: false, complaint: false, channelSwitch: false });
    });
  });

  it('pause, kill switch and an ended run win, read from their own columns', async () => {
    await inRollback(async () => {
      const j = await journey();
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'paused' WHERE id = $1`, [j.instanceId]);
      let r = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      expect(decideFollowUpRetiming(signal(), r.context, r.policy, NOW)).toMatchObject({ kind: 'no_change', reason: 'run_paused' });
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'active' WHERE id = $1`, [j.instanceId]);
      await db.query(`UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1`, [ORG_A]);
      r = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      expect(r.context.controlRefusal).toBe('tenant_kill_switch');
      expect(decideFollowUpRetiming(signal(), r.context, r.policy, NOW)).toMatchObject({ kind: 'no_change', reason: 'controls_refuse' });
      await db.query(`UPDATE public.outreach_governance_config SET kill_switch = false WHERE company_id = $1`, [ORG_A]);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [j.instanceId]);
      r = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      expect(decideFollowUpRetiming(signal(), r.context, r.policy, NOW)).toMatchObject({ kind: 'no_change', reason: 'run_finished' });
    });
  });

  it.each(['replied', 'unsubscribed', 'complained'])('a recorded %s keeps its own consequence over the out-of-office', async (type) => {
    await inRollback(async () => {
      const j = await journey();
      await outcome(j.firstTask, type);
      const { context, policy } = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      expect(context.consequences).toEqual([{ outcome: type, sourceId: null }]);
      expect(decideFollowUpRetiming(signal(), context, policy, NOW)).toMatchObject({ kind: 'no_change', reason: 'superseded_by_consequence' });
    });
  });

  it('repeated sweeps and evaluations: the engine is not wired, the journey is untouched, one action key', async () => {
    await inRollback(async () => {
      const j = await journey();
      const first = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep);
      const d1 = decideFollowUpRetiming(signal(), first.context, first.policy, NOW);
      await sweep();
      await sweep();
      const prior = { actionKey: d1.actionKey, signalId: 'wamid-ooo-1', receivedAt: new Date(0).toISOString(), nextEligibleAt: d1.nextEligibleAt };
      const again = await loadRetimingInputs(ORG_A, j.instanceId, j.followStep, { prior });
      expect(decideFollowUpRetiming(signal(), again.context, again.policy, NOW))
        .toMatchObject({ kind: 'no_change', reason: 'duplicate_signal', nextEligibleAt: d1.nextEligibleAt, actionKey: d1.actionKey });
      // Nothing the sweeps did refers to a retiming: no decision row carries one.
      expect(await rows(`SELECT 1 FROM public.execution_journey_decisions WHERE execution_instance_id = $1 AND (outcome ILIKE '%retim%' OR reasons::text ILIKE '%retim%')`, [j.instanceId])).toEqual([]);
      expect((await one(`SELECT state FROM public.execution_plan_steps WHERE id = $1`, [j.followStep])).state).toBe('pending');
      expect(sent).toHaveLength(0);
    });
  });

  it('cross-tenant: another tenant reads no run', async () => {
    await inRollback(async () => {
      const j = await journey();
      await expect(loadRetimingInputs(ORG_B, j.instanceId, j.followStep)).rejects.toMatchObject({ code: 'run_not_found' });
    });
  });
});

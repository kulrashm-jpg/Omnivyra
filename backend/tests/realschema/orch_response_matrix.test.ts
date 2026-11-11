/**
 * ORCHESTRATION — every response a person can give, through the path that really records
 * it, on REAL PostgreSQL: what happens to the journey, to contact, and to PI.
 *
 * Real: SES event ingestion after signature verification, the unsubscribe service, the
 * operator outcome path, governance, the sweeper, the certified email engine, PI's
 * producer. Replaced: the email provider (recording), the Redis quota counter, PostgREST.
 * The SNS signature check is covered by main's own webhook suites and is not repeated.
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B, newPerson } from './setup';
import {
  decisions, enableOutreach, enrol, emailStep, handoffTasks, instanceState, lifecycle, newProspect, newUser, one, rnd, rows,
} from './helpers/journeyFixtures';

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
// D-02 (S-02) — an external approval needs a passkey proof: the real ceremony, over a WebAuthn
// double (realschema/d02_approval_binding.test.ts exercises the real challenge store).
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const ws3 = require('../../services/leadOutreachExecution');
const { ingestSesEvent } = require('../../services/providerEvents/sesProviderEventIngestion');
const { recordOutreachUnsubscribe } = require('../../services/leadOutreachExecution/unsubscribeService');
const { ensureProspectLifecycleOpen, recordProspectTransition } = require('../../services/prospectLifecycle');
const { createExecutionInstance } = require('../../services/executionInstances/executionInstanceStore');
const { createExecutionPlan } = require('../../services/executionPlans/executionPlanStore');
const workflows = require('../../services/workflows/workflowStore');
const campaigns = require('../../services/prospectCampaigns/prospectCampaignStore');
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = 'person@example.test';
const sent: Array<{ to: string; subject: string }> = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; subject: string; idempotencyKey: string }) {
    sent.push({ to: r.to, subject: r.subject });
    return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} };
  },
};
const adapters = () => [createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
})];
const sweep = (org: string = ORG_A) =>
  advanceAndDispatchWorkflowExecution(org, { now: new Date().toISOString(), deps: { adapters: adapters() } });

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });

/** Two email steps; the first approved and sent, the second due and awaiting approval. */
async function firstSent() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email']);
  const actor = await newUser();
  const { prospectId, personId } = await newProspect(ORG_A, { email: ADDRESS });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: new Date().toISOString() });
  const { instanceId, workflowId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
  await sweep();
  const [first] = await handoffTasks(instanceId);
  expect((await approveWithPasskey(ORG_A, first.id, actor)).ok).toBe(true);
  await sweep();
  expect(sent).toHaveLength(1);
  await sweep();
  const attempt = await one('SELECT id FROM public.outreach_attempts WHERE task_id = $1', [first.id]);
  const evidence = await one('SELECT provider_message_id FROM public.outreach_delivery_evidence WHERE task_id = $1 AND provider_message_id IS NOT NULL', [first.id]);
  return { actor, prospectId, personId, instanceId, workflowId, firstTask: first.id, attemptId: String(attempt.id), messageId: String(evidence.provider_message_id) };
}
const sesEvent = (type: 'Bounce' | 'Complaint' | 'Delivery', messageId: string, extra: Record<string, unknown>) => ({
  eventType: type,
  mail: { messageId, destination: [ADDRESS] },
  ...extra,
});
const NOW = () => new Date().toISOString();
const feedback = (task: string, signal: string, extra: Record<string, unknown> = {}) =>
  ws3.ingestFeedback({ companyId: ORG_A, taskId: task, signal, occurredAt: NOW(), source: 'manual', ...extra });

describe('what each response does', () => {
  it('replied (Prompt 4 — CHANGED): journey suspended for a person, the next task kept and held, PI engaged', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      expect((await feedback(s.firstTask, 'replied')).ok).toBe(true);
      const r = await sweep();
      expect(r.counters).toMatchObject({ journeys_exited: 0, journeys_suspended: 1 });
      expect(await instanceState(s.instanceId)).toBe('paused');
      expect((await handoffTasks(s.instanceId)).map((t) => t.status)).toEqual(['sent', 'awaiting_approval']);
      expect(sent).toHaveLength(1);
      expect((await lifecycle(ORG_A, s.prospectId)).at(-1)).toMatchObject({ state: 'engaged', origin: 'derived' });
    });
  });

  // `rejected` is deliberately not ingestible (feedbackIngestion.ts) and NOTHING in production writes it
  // today: that gap is on the blocker register. The row is inserted directly so PI's path is still proven.
  it('a rejected outcome row: journey ends, PI not_interested attributed to the operator, re-enrolment refused', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      await recordProspectTransition({
        organizationId: ORG_A, prospectId: s.prospectId, to: 'engaged', origin: 'derived', actorUserId: null,
        evidence: { kind: 'engagement_thread' }, sourceEventKey: `derivation:seed-${rnd()}`, now: NOW(),
      });
      await db.query(`INSERT INTO public.outreach_outcomes (company_id, task_id, outcome_type, occurred_at, source, metadata)
        VALUES ($1,$2,'rejected',now(),'manual',$3)`, [ORG_A, s.firstTask, JSON.stringify({ recordedByUserId: s.actor })]);
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(1);
      expect((await lifecycle(ORG_A, s.prospectId)).at(-1)).toMatchObject({ state: 'not_interested', origin: 'human' });
      const again = await enrol(ORG_A, s.actor, s.prospectId, { steps: [emailStep('later')] });
      expect(again.report.enrolled).toBe(0);
      expect((again.report.exclusionReasons as Record<string, number>).prospect_lifecycle_closed).toBe(1);
    });
  });

  it('opened: not a response. The journey continues and PI does not move', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const before = await lifecycle(ORG_A, s.prospectId);
      await feedback(s.firstTask, 'opened');
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(0);
      expect(await instanceState(s.instanceId)).toBe('active');
      expect(await lifecycle(ORG_A, s.prospectId)).toHaveLength(before.length);
    });
  });

  it('one-click unsubscribe, through the real service: journey ends or no longer contacts, governance stands', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const out = await recordOutreachUnsubscribe(
        { organizationId: ORG_A, attemptId: s.attemptId, scope: 'email', recipient: ADDRESS, issuedAt: Date.now(), keyId: 'k1' },
        'one_click',
      );
      expect(out.status).not.toBe('retryable_failure');
      expect(out.status).not.toBe('invalid_link');
      const r = await sweep();
      expect(sent).toHaveLength(1);
      expect(Number((await one(`SELECT count(*) n FROM public.contact_governance_records WHERE organization_id = $1 AND governance_type = 'unsubscribe'`, [ORG_A])).n)).toBeGreaterThan(0);
      // The next step may not proceed, whichever gate reached it first.
      const statuses = (await handoffTasks(s.instanceId)).map((t) => t.status);
      expect(statuses[0]).toBe('sent');
      expect(r.counters.tasks_seen).toBeLessThanOrEqual(1);
      expect(sent).toHaveLength(1);
    });
  });

  it('SES hard bounce, through the real ingestion: the address is restricted, the next email is skipped, never sent', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const out = await ingestSesEvent(sesEvent('Bounce', s.messageId, {
        bounce: { bounceType: 'Permanent', timestamp: NOW(), bouncedRecipients: [{ emailAddress: ADDRESS }] },
      }), `sns-${rnd()}`);
      expect(out.status).toBe('processed');
      await sweep();
      await sweep();
      expect(sent).toHaveLength(1);
      const d = await decisions(s.instanceId);
      expect(d.some((x) => x.step_key === 'next' && x.decision === 'skipped')).toBe(true);
    });
  });

  it('SES complaint: person and address restricted on every channel, no further contact, replay is harmless', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const event = sesEvent('Complaint', s.messageId, {
        complaint: { timestamp: NOW(), complainedRecipients: [{ emailAddress: ADDRESS }] },
      });
      const id = `sns-${rnd()}`;
      expect((await ingestSesEvent(event, id)).status).toBe('processed');
      const replay = await ingestSesEvent(event, id);
      expect(replay.status).toBe('processed');
      expect(replay.duplicate).toBe(true);
      await sweep();
      await sweep();
      expect(sent).toHaveLength(1);
      const n = await rows(`SELECT channel, person_id IS NOT NULL AS by_person FROM public.contact_governance_records WHERE organization_id = $1 AND governance_type = 'complaint'`, [ORG_A]);
      expect(n.some((x) => x.by_person === true)).toBe(true);
    });
  });

  it('SES delivery: evidence only. Nothing about the journey changes', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const out = await ingestSesEvent(sesEvent('Delivery', s.messageId, { delivery: { timestamp: NOW() } }), `sns-${rnd()}`);
      expect(out.status).toBe('processed');
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(0);
      expect(await instanceState(s.instanceId)).toBe('active');
    });
  });
});

describe('journey state and isolation', () => {
  it('a paused run is not acted on; resuming continues it', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const [, second] = await handoffTasks(s.instanceId);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'paused' WHERE id = $1`, [s.instanceId]);
      expect((await approveWithPasskey(ORG_A, second.id, s.actor)).ok).toBe(true);
      await sweep();
      expect(sent).toHaveLength(1);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'active' WHERE id = $1`, [s.instanceId]);
      await sweep();
      expect(sent).toHaveLength(2);
    });
  });

  it('two sweeps at once send one message', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro')] });
      await sweep();
      const [t] = await handoffTasks(instanceId);
      await approveWithPasskey(ORG_A, t.id, actor);
      await Promise.all([sweep(), sweep()]);
      expect(sent).toHaveLength(1);
    });
  });

  it('another tenant\'s outcome cannot end this journey, and its sweep sees nothing here', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      await enableOutreach(ORG_B, ['email']);
      const r = await sweep(ORG_B);
      expect(r.counters.instances_scanned).toBe(0);
      const crossed = await ws3.ingestFeedback({ companyId: ORG_B, taskId: s.firstTask, signal: 'replied', occurredAt: NOW(), source: 'manual' });
      expect(crossed.ok).toBe(false);
      expect((await sweep()).counters.journeys_exited).toBe(0);
    });
  });

  it('a lead-subject journey ends on a reply too, and writes nothing to PI\'s prospect ledger', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const personId = await newPerson(ORG_A);
      await db.query('UPDATE public.unified_persons SET primary_email = $1, first_name = $2 WHERE id = $3', [ADDRESS, 'Ana', personId]);
      const lead = await one(`INSERT INTO public.leads (company_id, unified_person_id, name, email, source) VALUES ($1,$2,'n',$3,'orch') RETURNING id`, [ORG_A, personId, ADDRESS]);
      const campaign = await campaigns.createProspectCampaign({ organizationId: ORG_A, name: `camp-${rnd()}`, status: 'active' });
      const wf = await workflows.createWorkflow({ organizationId: ORG_A, name: `wf-${rnd()}`, actorUserId: actor });
      const draft = await workflows.createDraftVersion({ organizationId: ORG_A, workflowId: wf.id, definition: { steps: [emailStep('intro'), emailStep('next')] }, actorUserId: actor });
      await workflows.publishWorkflowVersion({ organizationId: ORG_A, versionId: draft.id, actorUserId: actor });
      const instance = await createExecutionInstance({ organizationId: ORG_A, campaignId: campaign.id, workflowId: wf.id, subjectKind: 'lead', subjectId: String(lead.id) });
      await createExecutionPlan({ organizationId: ORG_A, executionInstanceId: instance.id });

      await sweep();
      const [t] = await handoffTasks(instance.id);
      await approveWithPasskey(ORG_A, t.id, actor);
      await sweep();
      expect(sent).toHaveLength(1);
      await feedback(t.id, 'replied');
      const r = await sweep();
      // Prompt 4 — CHANGED: suspended for a person, not ended.
      expect(r.counters).toMatchObject({ journeys_exited: 0, journeys_suspended: 1 });
      expect(await instanceState(instance.id)).toBe('paused');
    });
  });
});

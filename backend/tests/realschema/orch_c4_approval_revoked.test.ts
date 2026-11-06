/**
 * ORCHESTRATION Prompt 4 / contract 0.3.0 — `approval.revoked` on REAL PostgreSQL.
 *
 * The event is PRODUCED by the journey event view from the append-only `revoked` row
 * that `revokeOutreachApproval` already writes; nothing here adds a store. The suite also
 * proves the CONSUMER side through the real stores: a revoked approval authorises nothing
 * at the sweep, the claim or the dispatch; the journey records what became of the step;
 * re-reads are stable; a revocation after a send claims nothing was undone; and another
 * tenant cannot revoke.
 *
 * Real: every store, the sweeper, WS-3 (approval, revocation, dispatch gate, claim
 * trigger), the certified email engine, the journey event view and its route handler.
 * Replaced: the email provider (recording), the Redis quota counter, PostgREST, the
 * WebAuthn signature check (approvalPasskeyDouble), and the session and capability checks
 * in front of the route. Provider integration is NOT proven here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import { decisions, enableOutreach, enrol, emailStep, handoffTasks, newProspect, newUser, one, rows } from './helpers/journeyFixtures';

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
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';
const mockActor = { id: 'unset' };
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: mockActor.id })),
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: mockActor.id } })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { revokeOutreachApproval } = require('../../services/leadOutreachExecution/approvalRevocation');
const storage = require('../../services/leadOutreachExecution/storage');
const journeyApproval = require('../../services/orchestration/journeyApproval');
const { readJourneyEvents, isComplaintInferredEvidence } = require('../../services/orchestration/journeyEvents');
const { ingestSesEvent } = require('../../services/providerEvents/sesProviderEventIngestion');
type Row = Record<string, unknown>;
const eventsRoute = require('../../../pages/api/execution-instances/[id]/events').default;
/* eslint-enable @typescript-eslint/no-var-requires */

type Ev = { eventId: string; type: string; code: string | null; occurredAt: string; source: { table: string; id: string }; actor?: unknown; positiveEngagement: boolean };

const ADDRESS = 'person@example.test';
const sent: string[] = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; idempotencyKey: string }) { sent.push(r.to); return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} }; },
};
const ws3Adapter = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
const sweep = (org: string = ORG_A) => advanceAndDispatchWorkflowExecution(org, { now: new Date().toISOString(), deps: { adapters: [ws3Adapter()] } });
const status = async (taskId: string) => String((await one('SELECT status FROM public.outreach_tasks WHERE id = $1', [taskId])).status);
const attempts = async (taskId: string) => Number((await one('SELECT count(*)::int n FROM public.outreach_attempts WHERE task_id = $1', [taskId])).n);
const decisionsOf = async (taskId: string) =>
  (await rows('SELECT decision FROM public.outreach_approvals WHERE task_id = $1 ORDER BY decided_at, created_at', [taskId])).map((r) => String(r.decision));
const events = async (instanceId: string, org: string = ORG_A): Promise<Ev[]> => (await readJourneyEvents(org, instanceId)).events;
const revoke = (taskId: string, approver: string, org: string = ORG_A) =>
  journeyApproval.revokeTenantJourneyApproval({ organizationId: org, taskId, approverUserId: approver });

/** A two-step email journey whose first message is approved (bound, passkey-verified) and unsent. */
async function approvedJourney() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email']);
  const publisher = await newUser();
  const approver = await newUser();
  mockActor.id = approver;
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
  const { instanceId } = await enrol(ORG_A, publisher, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
  await sweep();
  const [task] = await handoffTasks(instanceId);
  expect(task!.status).toBe('awaiting_approval');
  expect((await approveWithPasskey(ORG_A, task!.id, approver)).ok).toBe(true);
  expect(await status(task!.id)).toBe('approved');
  return { publisher, approver, prospectId, instanceId, taskId: String(task!.id) };
}

function callRoute(route: (req: NextApiRequest, res: NextApiResponse) => unknown, id: string, query: Record<string, string>) {
  const out: { status: number; json: Record<string, unknown> } = { status: 0, json: {} };
  const res = {
    setHeader: () => res,
    status(n: number) { out.status = n; return res; },
    json(j: Record<string, unknown>) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'GET', query: { id, ...query }, body: {}, headers: {}, url: `/api/execution-instances/${id}/events` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });

describe('approval.revoked is produced from the durable revocation row', () => {
  it('valid revocation before execution: one revoked row, the event, and nothing sent', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect(await revoke(s.taskId, s.approver)).toMatchObject({ ok: true, status: 'cancelled' });
      expect(await decisionsOf(s.taskId)).toEqual(['approved', 'revoked']);

      const ev = await events(s.instanceId);
      const approvals = ev.filter((e) => e.type.startsWith('approval.'));
      expect(approvals.map((e) => [e.type, e.code])).toEqual([['approval.granted', 'approved'], ['approval.revoked', 'revoked']]);
      const revoked = approvals[1]!;
      const row = await one(`SELECT id, decided_at FROM public.outreach_approvals WHERE task_id = $1 AND decision = 'revoked'`, [s.taskId]);
      expect(revoked).toMatchObject({
        eventVersion: 1, organizationId: ORG_A, executionInstanceId: s.instanceId, engine: 'ws3', channel: 'email',
        source: { table: 'outreach_approvals', id: String(row.id) }, occurredAt: new Date(row.decided_at as string).toISOString(),
        positiveEngagement: false, actor: { kind: 'user', id: s.approver, tier: 'tenant' },
      });
      expect(ev.some((e) => e.type === 'approval.rejected')).toBe(false);
      // The free-text reason and the address never leave through the view.
      expect(JSON.stringify(ev)).not.toContain('tenant approver revoked the approval');
      expect(JSON.stringify(ev)).not.toContain(ADDRESS);

      // A sweep after the revocation executes nothing.
      await sweep();
      await sweep();
      expect(sent).toHaveLength(0);
      expect(await attempts(s.taskId)).toBe(0);
      expect(await status(s.taskId)).toBe('cancelled');
    });
  });

  // RE-PINNED 2026-11-05 (Prompt 4, RV-1): a revocation pauses the run for review instead of
  // skipping the step and moving on. Resume is proven in p4_governance_precedence.test.ts.
  it('the journey consequence (RV-1): the run is paused for review, the step is not settled, and no next message is handed off', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      await sweep();
      await sweep();
      const intro = (await decisions(s.instanceId)).filter((d) => d.step_key === 'intro');
      expect(intro.filter((d) => d.decision === 'needs_human')).toHaveLength(1);
      expect(String(intro.at(-1)!.outcome)).toMatch(/^approval_revoked:[0-9a-f]{32}$/);
      expect(intro.some((d) => d.decision === 'skipped')).toBe(false);
      expect(String((await one('SELECT lifecycle_state FROM public.execution_instances WHERE id = $1', [s.instanceId])).lifecycle_state)).toBe('paused');
      const step = await one(`SELECT s.state FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id
        WHERE p.execution_instance_id = $1 AND s.step_key = 'intro'`, [s.instanceId]);
      expect(step.state).not.toBe('skipped');
      expect((await handoffTasks(s.instanceId)).map((t) => t.status)).toEqual(['cancelled']);
      expect(sent).toHaveLength(0);
      // In the view the pause is a suspension, not an execution event.
      const ev = await events(s.instanceId);
      expect(ev.filter((e) => e.source.table === 'execution_journey_decisions' && e.type === 'journey.suspended')).toHaveLength(1);
      expect(ev.some((e) => e.type === 'execution.cancelled' || e.type === 'execution.accepted')).toBe(false);
    });
  });
});

describe('a revoked approval authorises nothing', () => {
  it('duplicate revocation: the second is refused and writes nothing', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      expect(await revoke(s.taskId, s.approver)).toMatchObject({ ok: false });
      expect(await revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'invalid_state' });
      expect(await decisionsOf(s.taskId)).toEqual(['approved', 'revoked']);
      expect((await events(s.instanceId)).filter((e) => e.type === 'approval.revoked')).toHaveLength(1);
    });
  });

  it('two revocations at once: exactly one wins, one revoked row', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      const results = await Promise.all([revoke(s.taskId, s.approver), revoke(s.taskId, s.approver)]);
      expect(results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(1);
      expect(await decisionsOf(s.taskId)).toEqual(['approved', 'revoked']);
    });
  });

  it('invalid references: an unknown task, a missing approver, and a task with no approval are refused and write nothing', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      const unknown = '00000000-0000-4000-8000-0000000000ff';
      expect(await revokeOutreachApproval(ORG_A, unknown, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'task_not_found' });
      expect(await revoke(unknown, s.approver)).toMatchObject({ ok: false });
      expect(await revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: '  ' })).toMatchObject({ ok: false, refusal: 'missing_approver' });
      // Revoke the first; a second journey hands off a task that has no approval yet.
      // RE-PINNED 2026-11-05 (Prompt 4, RV-1): the revoked run pauses, so it hands off nothing more.
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      const { prospectId: other } = await newProspect(ORG_A, { email: 'other@example.test' });
      const { instanceId: otherRun } = await enrol(ORG_A, s.publisher, other, { steps: [emailStep('intro')] });
      await sweep();
      const second = (await handoffTasks(otherRun))[0]!;
      expect(second.status).toBe('awaiting_approval');
      expect(await revokeOutreachApproval(ORG_A, second.id, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'invalid_state' });
      expect(await decisionsOf(second.id)).toEqual([]);
      expect(Number((await one(`SELECT count(*)::int n FROM public.outreach_approvals WHERE decision = 'revoked'`)).n)).toBe(1);
    });
  });

  it('revocation racing the scheduler sweep: either the revocation or the send wins, never both, never a send after a revocation', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      const [revoked] = await Promise.all([revoke(s.taskId, s.approver), sweep()]);
      if (revoked.ok) {
        expect(sent).toHaveLength(0);
        expect(await attempts(s.taskId)).toBe(0);
        expect(await status(s.taskId)).toBe('cancelled');
      } else {
        expect(sent).toEqual([ADDRESS]);
        expect(await decisionsOf(s.taskId)).toEqual(['approved']);
      }
      await sweep();
      expect(sent.length).toBeLessThanOrEqual(1);
      expect(revoked.ok === (sent.length === 0)).toBe(true);
    });
  });

  it('revocation racing the dispatch claim: exactly one of the two compare-and-sets changes the task', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      const [revoked, claim] = await Promise.all([
        revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: s.approver }),
        storage.transitionOutreachTaskState(ORG_A, s.taskId, 'approved', 'dispatching'),
      ]);
      expect([revoked.ok, claim.ok && claim.changed].filter(Boolean)).toHaveLength(1);
      expect(await status(s.taskId)).toBe(revoked.ok ? 'cancelled' : 'dispatching');
      expect(await decisionsOf(s.taskId)).toEqual(revoked.ok ? ['approved', 'revoked'] : ['approved']);
    });
  });

  it('the claim race in both orders, deterministically: revoke first refuses the claim; claim first refuses the revocation', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      await db.query('SAVEPOINT o');
      expect(await revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: s.approver })).toMatchObject({ ok: true, status: 'cancelled' });
      expect(await storage.transitionOutreachTaskState(ORG_A, s.taskId, 'approved', 'dispatching')).toMatchObject({ ok: true, changed: false });
      expect(await status(s.taskId)).toBe('cancelled');
      await db.query('ROLLBACK TO SAVEPOINT o');
      expect(await storage.transitionOutreachTaskState(ORG_A, s.taskId, 'approved', 'dispatching')).toMatchObject({ ok: true, changed: true });
      expect(await revokeOutreachApproval(ORG_A, s.taskId, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'invalid_state' });
      expect(await decisionsOf(s.taskId)).toEqual(['approved']);
    });
  });

  it('a pending task carrying a revoked approval cannot execute: the sweep, the gate and the database claim all refuse', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      // Defence in depth: a revocation row recorded while the task was left `approved`
      // (no writer does this; the row alone must still refuse).
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, tier) VALUES ($1, $2, 'revoked', $3, 'tenant')`, [ORG_A, s.taskId, s.approver]);
      expect(await status(s.taskId)).toBe('approved');
      await sweep();
      await sweep();
      expect(sent).toHaveLength(0);
      expect(await attempts(s.taskId)).toBe(0);
      expect(await status(s.taskId)).toBe('approved');
      // The claim trigger refuses the compare-and-set itself.
      await db.query('SAVEPOINT c');
      await expect(db.query(`UPDATE public.outreach_tasks SET status = 'dispatching' WHERE id = $1`, [s.taskId])).rejects.toThrow(/cannot be claimed/);
      await db.query('ROLLBACK TO SAVEPOINT c');
      // The step waits on a person; it is not settled as sent.
      expect((await decisions(s.instanceId)).some((d) => d.step_key === 'intro' && d.decision === 'executed')).toBe(false);
    });
  });
});

describe('a revocation after a completed send', () => {
  it('is refused, and the view keeps the send; a revoked row recorded anyway shows both facts and claims nothing was undone', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      await sweep();
      expect(sent).toEqual([ADDRESS]);
      const after = await status(s.taskId);
      expect(['sent', 'delivered', 'completed']).toContain(after);
      expect(await revoke(s.taskId, s.approver)).toMatchObject({ ok: false });
      expect(await decisionsOf(s.taskId)).toEqual(['approved']);
      expect((await events(s.instanceId)).some((e) => e.type === 'approval.revoked')).toBe(false);

      // A revoked row after the send (no writer allows it today): the view shows both.
      await db.query(`INSERT INTO public.outreach_approvals (company_id, task_id, decision, approver_user_id, tier) VALUES ($1, $2, 'revoked', $3, 'tenant')`, [ORG_A, s.taskId, s.approver]);
      const ev = await events(s.instanceId);
      const types = ev.map((e) => e.type);
      expect(types).toContain('approval.granted');
      expect(types).toContain('execution.started');
      expect(types).toContain('approval.revoked');
      expect(types.indexOf('approval.revoked')).toBeGreaterThan(types.indexOf('execution.started'));
      expect(types).not.toContain('execution.cancelled');
      expect(types).not.toContain('execution.failed');
      expect(await status(s.taskId)).toBe(after);
      expect(await attempts(s.taskId)).toBe(1);
    });
  });
});

describe('a consumer reading approval.revoked', () => {
  it('duplicate delivery and retry: re-reading gives the same events, the same eventId for the revocation', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      const a = await events(s.instanceId);
      const b = await events(s.instanceId);
      expect(b).toEqual(a);
      expect(new Set(a.map((e) => e.eventId)).size).toBe(a.length);
      const id = a.find((e) => e.type === 'approval.revoked')!.eventId;
      await sweep();
      expect((await events(s.instanceId)).filter((e) => e.type === 'approval.revoked').map((e) => e.eventId)).toEqual([id]);
    });
  });

  it('out of order: the order is (occurredAt, eventId), and a cursor walks every event exactly once', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      await sweep();
      await sweep();
      const all = await events(s.instanceId);
      const sorted = [...all].sort((x, y) => x.occurredAt.localeCompare(y.occurredAt) || x.eventId.localeCompare(y.eventId));
      expect(all).toEqual(sorted);
      const walked: string[] = [];
      let after: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        const p = await readJourneyEvents(ORG_A, s.instanceId, { limit: 1, ...(after === undefined ? {} : { after }) });
        walked.push(...p.events.map((e: Ev) => e.eventId));
        if (!p.hasMore) break;
        after = p.cursor;
      }
      expect(walked).toEqual(all.map((e) => e.eventId));
    });
  });
});

describe('the complaint marker, read from a stored evidence row (P-1, option E)', () => {
  type EvidenceRow = { id: unknown; delivery_status: unknown; transport_response: unknown };
  const complaint = (messageId: string, at: string) => ({
    eventType: 'Complaint',
    mail: { messageId, destination: [ADDRESS] },
    complaint: { complainedRecipients: [{ emailAddress: ADDRESS }], timestamp: at, complaintFeedbackType: 'abuse' },
  });
  const evidenceRows = async (taskId: string) => (await rows(
    'SELECT id, delivery_status, transport_response FROM public.outreach_delivery_evidence WHERE task_id = $1 ORDER BY observed_at, id', [taskId],
  )) as EvidenceRow[];
  const messageIdOf = async (taskId: string) => String((await one(
    'SELECT provider_message_id FROM public.outreach_delivery_evidence WHERE task_id = $1 AND provider_message_id IS NOT NULL', [taskId],
  )).provider_message_id);

  it('the real SES path stores the marker; the helper reads it from the stored row; the view gives one delivery.complained and no delivery.confirmed', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      await sweep();
      expect(sent).toEqual([ADDRESS]);
      const msg = await messageIdOf(s.taskId);
      const at = new Date(Date.now() - 1000).toISOString();
      await ingestSesEvent(complaint(msg, at), 'sns-complaint-1');

      const stored = await evidenceRows(s.taskId);
      const marked = stored.filter((r) => isComplaintInferredEvidence(r));
      expect(marked).toHaveLength(1);
      // The exact stored column and key the writer uses.
      expect(marked[0]!.delivery_status).toBe('delivered');
      expect((marked[0]!.transport_response as Row).deliveryInferredFrom).toBe('Complaint');
      // Every other stored row (the send's own evidence) is not a complaint.
      expect(stored.length).toBeGreaterThan(1);
      for (const r of stored.filter((x) => x.id !== marked[0]!.id)) expect(isComplaintInferredEvidence(r)).toBe(false);

      const ev = await events(s.instanceId);
      const fromRow = ev.filter((e) => e.source.table === 'outreach_delivery_evidence' && e.source.id === String(marked[0]!.id));
      expect(fromRow.map((e) => [e.type, e.code])).toEqual([['delivery.complained', 'complained']]);
      expect(fromRow[0]!.positiveEngagement).toBe(false);
      expect(ev.filter((e) => e.type === 'delivery.complained')).toHaveLength(1);
      expect(ev.some((e) => e.type === 'delivery.confirmed')).toBe(false);
      const text = JSON.stringify(ev);
      for (const s2 of ['abuse', 'sns-complaint-1', ADDRESS]) expect(text).not.toContain(s2);

      // The same provider event again: no second row, no second event.
      await ingestSesEvent(complaint(msg, at), 'sns-complaint-1');
      expect((await evidenceRows(s.taskId)).filter((r) => isComplaintInferredEvidence(r))).toHaveLength(1);
      expect((await events(s.instanceId)).filter((e) => e.type === 'delivery.complained')).toHaveLength(1);
    });
  });

  it('a stored row whose transport_response is a JSON string, or whose status is unexpected, or written before D7, still reads as a complaint', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      await db.query(`INSERT INTO public.outreach_delivery_evidence (company_id, task_id, delivery_status, transport_response, observed_at)
        VALUES ($1, $2, 'bounced', to_jsonb($3::text), now() - interval '2 seconds'),
               ($1, $2, 'delivered', '{"sesEventType":"Complaint"}'::jsonb, now() - interval '1 second')`,
      [ORG_A, s.taskId, JSON.stringify({ deliveryInferredFrom: 'Complaint' })]);
      const stored = await evidenceRows(s.taskId);
      expect(stored).toHaveLength(2);
      expect(typeof stored[0]!.transport_response).toBe('string');
      for (const r of stored) expect(isComplaintInferredEvidence(r)).toBe(true);
      expect((await events(s.instanceId)).filter((e) => e.source.table === 'outreach_delivery_evidence').map((e) => e.type))
        .toEqual(['delivery.complained', 'delivery.complained']);
    });
  });

  it('acceptance by the transport is never delivery.confirmed; an observed delivery is', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      await sweep();
      const statuses = (await evidenceRows(s.taskId)).map((r) => String(r.delivery_status));
      const ev = (await events(s.instanceId)).filter((e) => e.source.table === 'outreach_delivery_evidence');
      expect(ev.map((e) => e.code).sort()).toEqual([...statuses].sort());
      expect(ev.length).toBeGreaterThan(0);
      for (const e of ev) expect(e.type).not.toBe('delivery.confirmed');
      await ingestSesEvent({
        eventType: 'Delivery', mail: { messageId: await messageIdOf(s.taskId), destination: [ADDRESS] },
        delivery: { timestamp: new Date(Date.now() - 500).toISOString() },
      }, 'sns-delivery-1');
      expect((await events(s.instanceId)).filter((e) => e.type === 'delivery.confirmed').map((e) => e.code)).toEqual(['delivered']);
    });
  });
});

describe('another tenant', () => {
  it('cannot revoke: refused as not found through the service and the tenant surface, nothing written, the task still sends', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect(await revokeOutreachApproval(ORG_B, s.taskId, { approverUserId: s.approver })).toMatchObject({ ok: false, refusal: 'task_not_found' });
      expect(await revoke(s.taskId, s.approver, ORG_B)).toMatchObject({ ok: false });
      expect(await decisionsOf(s.taskId)).toEqual(['approved']);
      expect(await status(s.taskId)).toBe('approved');
      await sweep();
      expect(sent).toEqual([ADDRESS]);
    });
  });

  it('cannot read the revocation: the view and the route answer as if the run did not exist', async () => {
    await inRollback(async () => {
      const s = await approvedJourney();
      expect((await revoke(s.taskId, s.approver)).ok).toBe(true);
      expect(await readJourneyEvents(ORG_B, s.instanceId)).toBeNull();
      expect((await callRoute(eventsRoute, s.instanceId, { company_id: ORG_B })).status).toBe(404);
      const own = await callRoute(eventsRoute, s.instanceId, { company_id: ORG_A });
      expect(own.status).toBe(200);
      expect((own.json.events as Ev[]).some((e) => e.type === 'approval.revoked')).toBe(true);
    });
  });
});

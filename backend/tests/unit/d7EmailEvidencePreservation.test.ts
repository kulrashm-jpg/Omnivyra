/**
 * D7 / Agent D — the email engine never lets a LATER event or lifecycle update
 * erase delivery, bounce, complaint or unsubscribe evidence.
 *
 * Three stores hold that evidence, and each is checked for the overwrite it is
 * exposed to:
 *
 *   outreach_delivery_evidence  append-only (DB trigger) — modelled here; an
 *                               UPDATE/DELETE is refused like the trigger does.
 *   contact_governance_records  insert-only from these paths; revocation is an
 *                               operator act and is never reached from here.
 *   outreach_tasks.delivery_status
 *                               MUTABLE summary. Feedback decides a transition
 *                               from a task it read a moment earlier; without a
 *                               compare-and-set a concurrently processed event
 *                               overwrote a terminal `bounced`/`delivered`.
 *
 * The database double records every UPDATE so a test can prove no path issued
 * one against an evidence store, and exposes a hook that runs immediately
 * before an UPDATE so a concurrent writer can be interleaved deterministically.
 */

type Row = Record<string, unknown>;

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_approvals'];

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  updates: [] as Array<{ table: string; payload: Row }>,
  /** Runs once, immediately before the next UPDATE on `table` is applied. */
  beforeUpdate: null as null | { table: string; run: () => void },
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      payload: null as Row | null,
      eq: [] as Array<[string, unknown]>,
      ins: [] as Array<[string, unknown[]]>,
      mode: 'many' as 'many' | 'one',
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.eq.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      && st.ins.every(([c, vs]) => vs.indexOf(r[c]) !== -1);
    const run = async () => {
      await Promise.resolve();
      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'contact_governance_records') {
          const key = (r: Row) => [r.organization_id, r.channel, r.governance_type, r.person_id ?? r.target_normalized].join('|');
          if (rows().some((r) => r.revoked_at == null && key(r) === key(row))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_contact_governance_identity"' } };
          }
        }
        if (table === 'outreach_delivery_evidence') {
          const logical = rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id
            && r.delivery_status === row.delivery_status && r.observed_at === row.observed_at);
          const providerEvent = row.provider_event_id != null && rows().some((r) => r.company_id === row.company_id
            && r.provider === row.provider && r.provider_event_id === row.provider_event_id);
          if (logical || providerEvent) return { data: null, error: { code: '23505', message: 'duplicate delivery evidence' } };
        }
        if (table === 'outreach_outcomes') {
          const logical = rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id
            && r.outcome_type === row.outcome_type && r.occurred_at === row.occurred_at);
          if (logical) return { data: null, error: { code: '23505', message: 'duplicate outcome' } };
        }
        const defaults: Row = table === 'contact_governance_records'
          ? { revoked_at: null, revoked_reason: null, effective_from: new Date(0).toISOString(), effective_until: null }
          : {};
        const created = { id: `${table}-${db.nextId++}`, created_at: '2026-11-04T00:00:00.000Z', ...defaults, ...row };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update' || st.op === 'delete') {
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `${table} is append-only` } };
        }
        if (db.beforeUpdate && db.beforeUpdate.table === table) {
          const hook = db.beforeUpdate;
          db.beforeUpdate = null;
          hook.run();
        }
        db.updates.push({ table, payload: { ...(st.payload ?? {}) } });
        const hit = rows().filter(match);
        if (st.op === 'update') hit.forEach((r) => Object.assign(r, st.payload));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(match);
      return st.mode === 'one' ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      delete: () => { st.op = 'delete'; return api; },
      eq: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      is: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return api; },
      gte: () => api,
      order: () => api,
      limit: () => run(),
      single: () => { st.mode = 'one'; return run(); },
      maybeSingle: () => { st.mode = 'one'; return run(); },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return api;
  },
}));

// G-11: after the `email` records, the all-channel hold and the admin review are Orchestration's
// service, called through optOutHold. This suite pins the evidence the producer writes and what it
// hands the hold; g11_outreach_producers (real schema) runs the real hold.
const holdAndOpenOptOutReview = jest.fn();
jest.mock('../../services/leadOutreachExecution/optOutHold', () => ({
  holdAndOpenOptOutReview: (...a: unknown[]) => holdAndOpenOptOutReview(...a),
}));

import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  TRANSLATION_VERSION,
  ingestFeedback,
  insertOutreachTask,
  setOutreachTaskState,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import { recordOutreachUnsubscribe } from '../../services/leadOutreachExecution/unsubscribeService';
import { ingestSesEvent } from '../../services/providerEvents/sesProviderEventIngestion';

const ORG = '00000000-0000-4000-8000-00000000000a';
const PERSON = '00000000-0000-4000-8000-0000000000a1';
const RECIPIENT = 'Jane.Doe@Example.Test';
const PROVIDER = 'supabase_edge_ses';
const NOW = '2026-11-04T10:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: `task-${db.nextId++}`, taskOrder: 1,
  kind: 'outreach', action: 'Send intro', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'x',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, personId: PERSON, ...over,
});

/** A dispatched email: task (sent/confirmed) + attempt + the send-time evidence row. */
async function sentMessage(messageId = 'ses-msg-1') {
  const task = await insertOutreachTask(newTask());
  const taskId = String(task.data!.id);
  await setOutreachTaskState(ORG, taskId, { status: 'sent', deliveryStatus: 'confirmed' });
  const attemptId = `att-${db.nextId++}`;
  (db.tables.outreach_attempts ??= []).push({ id: attemptId, company_id: ORG, task_id: taskId, attempt_number: 1 });
  (db.tables.outreach_delivery_evidence ??= []).push({
    id: `ev-${db.nextId++}`, company_id: ORG, task_id: taskId, attempt_id: attemptId,
    delivery_status: 'confirmed', provider: PROVIDER, provider_message_id: messageId, provider_event_id: null,
    observed_at: NOW,
  });
  return { taskId, attemptId };
}

const taskRow = (taskId: string) => (db.tables.outreach_tasks ?? []).find((r) => r.id === taskId) as Row;
const governance = () => (db.tables.contact_governance_records ??= []);
const snapshot = (rows: Row[]) => JSON.parse(JSON.stringify(rows)) as Row[];

type Ses = Record<string, unknown>;
const mail = (messageId = 'ses-msg-1'): Ses => ({ messageId, timestamp: NOW, destination: [RECIPIENT] });
const sesDelivery = (at: string): Ses => ({ notificationType: 'Delivery', mail: mail(), delivery: { timestamp: at, recipients: [RECIPIENT] } });
const sesBounce = (at: string): Ses => ({
  notificationType: 'Bounce', mail: mail(),
  bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: at, bouncedRecipients: [{ emailAddress: RECIPIENT }] },
});
const sesComplaint = (at: string): Ses => ({
  notificationType: 'Complaint', mail: mail(),
  complaint: { timestamp: at, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: RECIPIENT }] },
});

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.updates = [];
  db.beforeUpdate = null;
  holdAndOpenOptOutReview.mockReset();
  holdAndOpenOptOutReview.mockResolvedValue({ status: 'opened', reviewId: 'rv-1', holdIds: ['h-1'], reason: null });
});

// ── 1. the mutable delivery summary: compare-and-set ─────────────────────────

describe('D7 — a concurrently settled delivery status is never overwritten', () => {
  it('a BOUNCE that settled first is not overwritten by a stale DELIVERY', async () => {
    const { taskId } = await sentMessage();
    // The delivered event read the task as `confirmed`; between its read and its
    // write a concurrent bounce settled the task. Interleave exactly that.
    db.beforeUpdate = { table: 'outreach_tasks', run: () => Object.assign(taskRow(taskId), { delivery_status: 'bounced', status: 'failed' }) };

    const res = await ingestFeedback({
      companyId: ORG, taskId, signal: 'delivered', occurredAt: '2026-11-04T10:01:00.000Z', source: 'provider_webhook',
      provider: PROVIDER, providerEventId: 'sns-d1',
    });

    expect(res.ok).toBe(true);
    expect(res.stateAdvanced).toBe(false);
    expect(res.stateRefusal).toMatch(/no longer confirmed/);
    expect(taskRow(taskId)).toMatchObject({ delivery_status: 'bounced', status: 'failed' });
    // The losing observation is still durable evidence.
    expect((db.tables.outreach_delivery_evidence ?? []).some((r) => r.provider_event_id === 'sns-d1' && r.delivery_status === 'delivered')).toBe(true);
  });

  it('a DELIVERY that settled first is not overwritten by a stale BOUNCE', async () => {
    const { taskId } = await sentMessage();
    db.beforeUpdate = { table: 'outreach_tasks', run: () => Object.assign(taskRow(taskId), { delivery_status: 'delivered', status: 'delivered' }) };

    const res = await ingestFeedback({
      companyId: ORG, taskId, signal: 'bounced', occurredAt: '2026-11-04T10:01:00.000Z', source: 'provider_webhook',
      provider: PROVIDER, providerEventId: 'sns-b1',
    });

    expect(res.stateAdvanced).toBe(false);
    expect(taskRow(taskId)).toMatchObject({ delivery_status: 'delivered', status: 'delivered' });
  });

  it('the uncontended path still advances (the predicate matches the state it read)', async () => {
    const { taskId } = await sentMessage();
    const res = await ingestFeedback({
      companyId: ORG, taskId, signal: 'bounced', occurredAt: '2026-11-04T10:01:00.000Z', source: 'provider_webhook',
    });
    expect(res.stateAdvanced).toBe(true);
    expect(taskRow(taskId)).toMatchObject({ delivery_status: 'bounced', status: 'failed' });
  });
});

// ── 2. unsubscribe evidence survives everything that happens after it ────────

describe('D7 — unsubscribe evidence is written and never overwritten by later lifecycle updates', () => {
  it('the link unsubscribe writes the ADDRESS and PERSON records on email (G-11 replaced `*`) with their evidence, then the hold', async () => {
    const { attemptId, taskId } = await sentMessage();
    const out = await recordOutreachUnsubscribe(
      { organizationId: ORG, attemptId, scope: '*', recipient: RECIPIENT, issuedAt: 1, keyId: 'k1' }, 'one_click',
    );
    expect(out).toMatchObject({ status: 'recorded', created: 2, alreadyPresent: 0, reviewId: 'rv-1' });
    const rows = governance();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({
        organization_id: ORG, governance_type: 'unsubscribe', channel: 'email', revoked_at: null,
        source: 'outreach_unsubscribe_link', evidence: { attemptId, taskId, method: 'one_click', tokenKeyId: 'k1' },
      });
    }
    expect(rows.filter((r) => r.person_id === PERSON)).toHaveLength(1);
    // G-11: every channel is then held and the admin review opened, anchored to the person.
    expect(holdAndOpenOptOutReview).toHaveBeenCalledTimes(1);
    expect(holdAndOpenOptOutReview.mock.calls[0][0]).toMatchObject({
      organizationId: ORG, trigger: 'email_unsubscribe', anchor: { kind: 'person', personId: PERSON },
      sourceRef: `attempt:${attemptId}`, triggerRecordId: rows.find((r) => r.person_id === PERSON)!.id, personId: PERSON,
    });
    // It writes NO outcome row today (see the SC-4 note in ENGINE-READINESS-D7.md).
    expect(db.tables.outreach_outcomes ?? []).toHaveLength(0);
  });

  it('later delivery, bounce, reply, lifecycle moves, a repeat unsubscribe and a complaint leave it byte-identical', async () => {
    const { attemptId, taskId } = await sentMessage();
    await recordOutreachUnsubscribe({ organizationId: ORG, attemptId, scope: '*', recipient: RECIPIENT, issuedAt: 1, keyId: 'k1' }, 'one_click');
    const before = snapshot(governance());

    // Provider events arriving after the unsubscribe, through the real webhook core.
    expect((await ingestSesEvent(sesDelivery('2026-11-04T10:02:00.000Z'), 'sns-1')).status).toBe('processed');
    expect((await ingestSesEvent(sesBounce('2026-11-04T10:03:00.000Z'), 'sns-2')).status).toBe('processed');
    expect((await ingestSesEvent(sesComplaint('2026-11-04T10:04:00.000Z'), 'sns-3')).status).toBe('processed');
    // A business signal, an operator lifecycle move, and a second unsubscribe
    // by the other method (which must NOT replace the first one's evidence).
    expect((await ingestFeedback({ companyId: ORG, taskId, signal: 'replied', occurredAt: '2026-11-04T10:05:00.000Z', source: 'manual' })).ok).toBe(true);
    await setOutreachTaskState(ORG, taskId, { status: 'completed' });
    const again = await recordOutreachUnsubscribe(
      { organizationId: ORG, attemptId, scope: '*', recipient: RECIPIENT, issuedAt: 2, keyId: 'k2' }, 'confirmation',
    );
    expect(again).toMatchObject({ status: 'recorded', created: 0, alreadyPresent: 2 });
    expect(before.every((r) => r.channel === 'email')).toBe(true);

    const unsubscribeNow = governance().filter((r) => r.governance_type === 'unsubscribe');
    expect(unsubscribeNow).toEqual(before);
    // Nothing ever issued an UPDATE (or DELETE) against an evidence store.
    const touched = db.updates.map((u) => u.table);
    expect(touched).not.toContain('contact_governance_records');
    expect(touched.filter((t) => APPEND_ONLY.includes(t))).toEqual([]);
  });
});

// ── 3. complaint evidence survives later events ─────────────────────────────

describe('D7 — complaint evidence is preserved and never overwritten', () => {
  it('a later Delivery and Bounce leave the complaint record and its evidence row intact', async () => {
    await sentMessage();
    expect((await ingestSesEvent(sesComplaint('2026-11-04T10:01:00.000Z'), 'sns-c')).status).toBe('processed');
    const complaintRecords = snapshot(governance().filter((r) => r.governance_type === 'complaint'));
    expect(complaintRecords).toHaveLength(2);
    const complaintEvidence = snapshot((db.tables.outreach_delivery_evidence ?? []).filter((r) => r.provider_event_id === 'sns-c'));
    expect(complaintEvidence).toHaveLength(1);
    expect(complaintEvidence[0].transport_response).toMatchObject({ sesEventType: 'Complaint', deliveryInferredFrom: 'Complaint' });

    await ingestSesEvent(sesDelivery('2026-11-04T10:02:00.000Z'), 'sns-d');
    await ingestSesEvent(sesBounce('2026-11-04T10:03:00.000Z'), 'sns-b');

    expect(governance().filter((r) => r.governance_type === 'complaint')).toEqual(complaintRecords);
    expect((db.tables.outreach_delivery_evidence ?? []).filter((r) => r.provider_event_id === 'sns-c')).toEqual(complaintEvidence);
    expect(db.updates.map((u) => u.table)).not.toContain('contact_governance_records');
  });
});

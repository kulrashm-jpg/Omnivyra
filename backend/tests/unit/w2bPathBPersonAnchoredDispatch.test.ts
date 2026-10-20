/**
 * WP2 — a person-anchored restriction blocks Path B at the REAL dispatch gate.
 *
 * Path B (the WS-3 outreach gate) already resolves a person anchor in the frozen
 * order — explicit id, `outreach_tasks.person_id`, `leads.unified_person_id` —
 * and reads canonical governance by that person. This suite pins that behaviour
 * end to end, through `dispatchInternalOutreachTask`, with a spy transport whose
 * calls are the proof that a send did or did not happen.
 *
 * The database double is the one the r1-ctx W1-C suite uses. Nothing contacts an
 * external system.
 */

type Row = Record<string, unknown>;

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_approvals'];

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      payload: null as Row | null,
      eq: [] as Array<[string, unknown]>,
      ins: [] as Array<[string, unknown[]]>,
      gte: [] as Array<[string, unknown]>,
      mode: 'many' as 'many' | 'one',
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.eq.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      && st.ins.every(([c, vs]) => vs.indexOf(r[c]) !== -1)
      && st.gte.every(([c, v]) => String(r[c] ?? '') >= String(v));
    const run = async () => {
      await Promise.resolve();
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        // Model `uq_contact_governance_identity`, which is where the writer's
        // idempotency actually lives: (org, channel, type, person|target)
        // WHERE revoked_at IS NULL.
        if (table === 'contact_governance_records') {
          const key = (r: Row) => [r.organization_id, r.channel, r.governance_type, r.person_id ?? r.target_normalized].join('|');
          if (rows().some((r) => r.revoked_at == null && key(r) === key(row))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_contact_governance_identity"' } };
          }
        }
        // Mirror the real column defaults. Without `revoked_at: null` a freshly
        // inserted record reads as `undefined`, which is a state the database
        // cannot hold and which would quietly weaken every "still active"
        // assertion below.
        const defaults: Row = table === 'contact_governance_records' ? { revoked_at: null, revoked_reason: null } : {};
        const created = { id: `${table}-${db.nextId++}`, created_at: NOW, ...defaults, ...row };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `${table} is append-only` } };
        }
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }

      const found = rows().filter(match);
      return st.mode === 'one' ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      is: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return api; },
      // Quota's durable usage read windows attempts with `.gte('started_at', …)`;
      // without it the read fails and dispatch defers, so no control case could
      // ever reach the transport. ISO-8601 strings compare correctly as text.
      gte: (c: string, v: unknown) => { st.gte.push([c, v]); return api; },
      order: () => api,
      limit: () => run(),
      single: () => { st.mode = 'one'; return run(); },
      maybeSingle: () => { st.mode = 'one'; return run(); },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return api;
  },
}));

const fakeRedis = { store: new Map<string, string>() };
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));

import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  __resetQuotaRedisForTests,
  dispatchInternalOutreachTask,
  insertOutreachTask,
  registerTransport,
  setOutreachTaskState,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const ORG = 'co-a';
const OTHER_ORG = 'co-b';
const PERSON = 'p-1';
const OTHER_PERSON = 'p-2';
const NOW = '2026-10-12T12:00:00.000Z';
const RECIPIENT = 'person@example.test';

/** A spy transport. Its calls are the proof that a send happened or did not. */
const sent: Array<{ channel: string; to: string }> = [];
const spyTransport = (channel: string) => ({
  channel,
  provider: `spy_${channel}`,
  external: true,
  // A COMPLETE TransportResult — `provider`, `deliveryStatus`, `response` and
  // `duplicate` are all required, and an incomplete one makes dispatch return a
  // shape that silently fails the assertions rather than the transport.
  async send(req: { recipient?: string | null }) {
    sent.push({ channel, to: String(req?.recipient ?? '') });
    return {
      outcome: 'sent' as const,
      provider: `spy_${channel}`,
      providerMessageId: 'spy-1',
      deliveryStatus: 'sent_unverified' as const,
      response: {},
      duplicate: false,
    };
  },
});

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'x',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, personId: PERSON, ...over,
});

const configureTenant = (over: Row = {}) => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: ORG, enabled: true, kill_switch: false,
    enabled_channels: ['email', 'phone'], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, ...over,
  });
};

/** A fresh approved task, ready for the real dispatch caller. */
const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState(ORG, id, { status: 'approved' });
  return id;
};

const dispatch = (taskId: string) =>
  dispatchInternalOutreachTask(ORG, taskId, { now: NOW, recipient: RECIPIENT });

/** A canonical person-anchored unsubscribe with NO target — the shape that C-1 missed on Path A. */
const personUnsubscribe = (over: Row = {}): Row => ({
  id: `g-${db.nextId++}`, organization_id: ORG, person_id: PERSON, target_normalized: null,
  channel: 'email', governance_type: 'unsubscribe',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null,
  revoked_at: null, revoked_reason: null,
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  fakeRedis.store.clear();
  sent.length = 0;
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerTransport(spyTransport('email') as never);
});

describe('WP2 — Path B honours a person-anchored restriction before the transport', () => {
  it('control: with no restriction the real gate lets the task reach the transport', async () => {
    configureTenant();
    const res = await dispatch(await approvedTask());

    expect(res.outcome).not.toBe('blocked_governance');
    expect(sent).toHaveLength(1);
  });

  it('a PERSON-ANCHORED unsubscribe blocks the task, and the transport is never called', async () => {
    configureTenant();
    (db.tables.contact_governance_records ??= []).push(personUnsubscribe());

    const res = await dispatch(await approvedTask());

    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it("another person's restriction does not block this person", async () => {
    configureTenant();
    (db.tables.contact_governance_records ??= []).push(personUnsubscribe({ person_id: OTHER_PERSON }));

    await dispatch(await approvedTask());
    expect(sent).toHaveLength(1);
  });

  it("another tenant's restriction on the same person id does not leak here", async () => {
    configureTenant();
    (db.tables.contact_governance_records ??= []).push(personUnsubscribe({ organization_id: OTHER_ORG }));

    await dispatch(await approvedTask());
    expect(sent).toHaveLength(1);
  });

  it('an unreadable governance table FAILS CLOSED — the transport is never called', async () => {
    configureTenant();
    db.failTable = 'contact_governance_records';

    const res = await dispatch(await approvedTask());

    expect(res.outcome).not.toBe('sent');
    expect(sent).toHaveLength(0);
  });
});

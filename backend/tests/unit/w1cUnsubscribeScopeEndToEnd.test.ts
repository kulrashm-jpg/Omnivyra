/**
 * W1-C — unsubscribe scope, proven END TO END through the real dispatch gate.
 *
 * The W1 report could only verify ingestion and dispatch in two separate
 * harnesses and said so. This file closes that: ONE database double serves both
 * modules (they resolve `ownedDbTable` from the same path), so a single test can
 * run the actual flow —
 *
 *   ingestFeedback({ signal: 'unsubscribed', unsubscribeScope })
 *     → recordContactGovernance  (the real writer)
 *       → dispatchInternalOutreachTask  (the real dispatch caller)
 *         → transport NOT invoked
 *
 * The transport is a spy, so a refusal is proven by the absence of a provider
 * call rather than by a return value. Nothing contacts an external system.
 *
 * SCOPE MAPPING under test: `all` records the canonical `unsubscribe` type
 * against ALL_CHANNELS ('*') — the same instruction with a broader channel, not
 * `dnc_permanent`, which would assert a permanence the recipient never
 * expressed. Only `dnc_permanent`/`dnc_channel` constrain the channel column,
 * so this is schema-valid without a migration.
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
      mode: 'many' as 'many' | 'one',
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row) => st.eq.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      && st.ins.every(([c, vs]) => vs.indexOf(r[c]) !== -1);
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
  getOutreachTaskById,
  ingestFeedback,
  insertOutreachTask,
  registerTransport,
  setOutreachTaskState,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const ORG = 'co-a';
const PERSON = 'p-1';
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

/** A task in `sent`/`confirmed`, which is what feedback attaches to. */
const feedbackTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState(ORG, id, { status: 'sent', deliveryStatus: 'confirmed' });
  return id;
};

/** A fresh approved task, ready for the real dispatch caller. */
const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState(ORG, id, { status: 'approved' });
  return id;
};

const unsubscribe = (taskId: string, scope?: 'channel' | 'all', over: Row = {}) => ingestFeedback({
  companyId: ORG, taskId, signal: 'unsubscribed', occurredAt: NOW,
  source: 'manual', provider: null, providerEventId: null,
  ...(scope ? { unsubscribeScope: scope } : {}),
  ...over,
} as never);

const dispatch = (taskId: string) =>
  dispatchInternalOutreachTask(ORG, taskId, { now: NOW, recipient: RECIPIENT });

const governance = () => (db.tables.contact_governance_records ??= []);

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  fakeRedis.store.clear();
  sent.length = 0;
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerTransport(spyTransport('email') as never);
  registerTransport(spyTransport('phone') as never);
});

// ── A. Backward compatibility ──────────────────────────────────────────────

describe('W1-C/A — omitting scope keeps W1-B behaviour', () => {
  it('records the task channel, not a cross-channel restriction', async () => {
    configureTenant();
    const res = await unsubscribe(await feedbackTask());

    expect(res.ok).toBe(true);
    expect(governance()).toHaveLength(1);
    expect(governance()[0]).toMatchObject({
      organization_id: ORG, governance_type: 'unsubscribe', channel: 'email', person_id: PERSON,
    });
    expect(governance()[0].channel).not.toBe('*');
  });
});

// ── B. scope: 'channel' ────────────────────────────────────────────────────

describe("W1-C/B — scope 'channel' blocks that channel at the REAL dispatch gate", () => {
  it('END TO END: ingest → write → dispatch refuses → transport never called', async () => {
    configureTenant();
    await unsubscribe(await feedbackTask(), 'channel');
    expect(governance()[0].channel).toBe('email');

    // The real dispatch caller, on a fresh approved task for the same person.
    const res = await dispatch(await approvedTask({ planTaskId: 'task-2-followup' }));

    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it('does NOT block an unrelated channel on the strength of this event alone', async () => {
    configureTenant();
    await unsubscribe(await feedbackTask({ channel: 'email' }), 'channel');

    const res = await dispatch(await approvedTask({ planTaskId: 'task-3-call', channel: 'phone' }));

    // The claim is about GOVERNANCE, so it is asserted on the governance
    // verdict rather than on a completed send: this harness's durable-usage
    // read is not modelled, so the quota gate defers AFTER governance allows
    // (`deferred_quota`) — a different fail-closed guard, not this restriction.
    expect(res.outcome).not.toBe('blocked_governance');
    expect(res.governance?.decision).toBe('allowed');
    const suppression = res.governance?.gates.find((g) => g.gate === 'suppression');
    expect(suppression).toMatchObject({ decision: 'allowed', evidence: { channel: 'phone' } });
  });
});

// ── C. scope: 'all' ────────────────────────────────────────────────────────

describe("W1-C/C — scope 'all' is a cross-channel objection", () => {
  it("persists the canonical unsubscribe against '*', not dnc_permanent", async () => {
    configureTenant();
    const res = await unsubscribe(await feedbackTask(), 'all');

    expect(res.ok).toBe(true);
    expect(governance()[0]).toMatchObject({ governance_type: 'unsubscribe', channel: '*', person_id: PERSON });
    // A permanent DNC would assert something the recipient did not say.
    expect(governance()[0].governance_type).not.toBe('dnc_permanent');
  });

  it('END TO END: blocks dispatch on a DIFFERENT channel', async () => {
    configureTenant();
    await unsubscribe(await feedbackTask({ channel: 'email' }), 'all');

    const res = await dispatch(await approvedTask({ planTaskId: 'task-4-call', channel: 'phone' }));

    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it('a later narrower unsubscribe cannot revoke or weaken it', async () => {
    configureTenant();
    const t1 = await feedbackTask();
    await unsubscribe(t1, 'all');
    await unsubscribe(await feedbackTask({ planTaskId: 'task-5-again' }), 'channel');

    const broad = governance().find((g) => g.channel === '*')!;
    expect(broad.revoked_at).toBeNull();
    expect(broad.governance_type).toBe('unsubscribe');
    // Additive, both active — nothing is relaxed.
    expect(governance().filter((g) => g.revoked_at == null)).toHaveLength(2);

    // ...and the broad one still blocks another channel.
    const res = await dispatch(await approvedTask({ planTaskId: 'task-6-call', channel: 'phone' }));
    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });
});

// ── D. Failure and isolation ───────────────────────────────────────────────

describe('W1-C/D — failure and isolation', () => {
  it('a governance-write failure is not reported as success', async () => {
    configureTenant();
    const id = await feedbackTask();
    db.failTable = 'contact_governance_records';
    const res = await unsubscribe(id, 'all');
    db.failTable = null;

    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('governance_write_failed');
    expect(governance()).toHaveLength(0);
  });

  it('an unanchorable task creates no guessed restriction', async () => {
    configureTenant();
    const res = await unsubscribe(await feedbackTask({ personId: null }), 'all');

    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('governance_unanchorable');
    expect(governance()).toHaveLength(0);
  });

  it("another tenant's event cannot write a restriction here", async () => {
    configureTenant();
    const id = await feedbackTask();
    const res = await ingestFeedback({
      companyId: 'co-b', taskId: id, signal: 'unsubscribed', occurredAt: NOW,
      source: 'manual', provider: null, providerEventId: null, unsubscribeScope: 'all',
    } as never);

    expect(res.ok).toBe(false);
    expect(res.rejection).toBe('task_not_found');
    expect(governance()).toHaveLength(0);
  });

  it('replay stays idempotent for both scopes', async () => {
    configureTenant();
    const a = await feedbackTask();
    await unsubscribe(a, 'all');
    await unsubscribe(a, 'all');
    expect(governance().filter((g) => g.channel === '*')).toHaveLength(1);

    const b = await feedbackTask({ planTaskId: 'task-7-chan' });
    await unsubscribe(b, 'channel');
    await unsubscribe(b, 'channel');
    expect(governance().filter((g) => g.channel === 'email')).toHaveLength(1);
  });

  it('a non-unsubscribe signal ignores the scope and writes nothing', async () => {
    configureTenant();
    const res = await unsubscribe(await feedbackTask(), 'all', { signal: 'replied' });
    expect(res.ok).toBe(true);
    expect(governance()).toHaveLength(0);
  });
});

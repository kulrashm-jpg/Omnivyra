/**
 * WS-3 Milestone-5B — External Channel Dispatch (email).
 *
 * This is the first code in the platform that can reach a real person, so the
 * tests concentrate on the things that would make that dangerous: sending when
 * governance said no, sending twice, sending with the flag off, or sending and
 * leaving no evidence.
 *
 * Every provider outcome is exercised through an injected port — no network is
 * ever touched, and the default provider is never constructed.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
};

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items', 'outreach_approvals'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => {
        if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
        if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
        return r[c] === v;
      });

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.filtersSeen.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts') {
          if (rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
            return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
          }
          // The real unique index on (company_id, idempotency_key).
          if (row.idempotency_key && rows().some((r) => r.company_id === row.company_id && r.idempotency_key === row.idempotency_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate idempotency_key' } };
          }
        }
        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; UPDATE is not permitted` } };
        const affected = rows().filter(matches);
        for (const r of affected) Object.assign(r, st.payload);
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }

      const found = rows().filter(matches);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([`__is__${c}`, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) + n; this.store.set(k, v); return v; },
  async decrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) - n; this.store.set(k, v); return v; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));

import { registry } from '../../observability/registry';
import {
  EMAIL_ENABLED_ENV,
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  OUTREACH_METRICS,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  __resetQuotaRedisForTests,
  buildIdempotencyKey,
  createEmailTransport,
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  insertOutreachTask,
  isEmailTransportEnabled,
  listAttempts,
  listDeliveryEvidence,
  registerDefaultTransports,
  registerTransport,
  resolveTransport,
  setOutreachTaskState,
  supportedChannels,
  type EmailProviderPort,
  type EmailProviderResponse,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';
const RECIPIENT = 'cto@bigcorp.com';

/** Records every provider call so "did we send?" is directly observable. */
const provider = {
  calls: [] as Array<{ to: string; idempotencyKey: string; subject: string }>,
  response: { accepted: true, messageId: 'ses-msg-1' } as EmailProviderResponse,
  behaviour: 'respond' as 'respond' | 'throw' | 'hang',
};

const testProvider: EmailProviderPort = {
  name: 'test_provider',
  async send(req) {
    provider.calls.push({ to: req.to, idempotencyKey: req.idempotencyKey, subject: req.subject });
    if (provider.behaviour === 'throw') throw new Error('provider exploded');
    if (provider.behaviour === 'hang') return new Promise<EmailProviderResponse>(() => undefined); // never resolves
    return provider.response;
  },
};

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Hot lead viewed pricing twice',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = (over: Row = {}) => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: 'co-a', enabled: true, kill_switch: false,
    enabled_channels: ['email', INTERNAL_CHANNEL], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, ...over,
  });
};

const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState('co-a', id, { status: 'approved' });
  return id;
};

const dispatch = (id: string, over: Record<string, unknown> = {}) =>
  dispatchInternalOutreachTask('co-a', id, { now: NOW, recipient: RECIPIENT, ...over });

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.filtersSeen = [];
  fakeRedis.store.clear();
  provider.calls = [];
  provider.response = { accepted: true, messageId: 'ses-msg-1' };
  provider.behaviour = 'respond';
  registry.reset();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  process.env[EMAIL_ENABLED_ENV] = 'true'; // explicitly enabled for these tests
  registerDefaultTransports({ emailProvider: testProvider });
});

afterEach(() => {
  delete process.env[EMAIL_ENABLED_ENV];
});

// ── 1. Transport abstraction ────────────────────────────────────────────────

describe('WS-3 M5B (1) — transport abstraction', () => {
  it('resolves transports by channel through one registry', () => {
    expect(supportedChannels()).toEqual(['email', 'internal']);
    expect(resolveTransport('email')?.provider).toBe('test_provider');
    expect(resolveTransport(INTERNAL_CHANNEL)?.external).toBe(false);
    expect(resolveTransport('email')?.external).toBe(true);
  });

  it('leaves WhatsApp, SMS, LinkedIn, voice, push and Slack unserved', () => {
    for (const channel of ['whatsapp', 'sms', 'linkedin', 'voice', 'push', 'slack']) {
      expect(resolveTransport(channel)).toBeNull();
    }
  });

  it('the dispatcher contains no per-channel branching', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/dispatch.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // A hardcoded channel in the dispatcher is a place a future channel can be
    // sent down the wrong path.
    for (const channel of ["'email'", "'whatsapp'", "'sms'", "'linkedin'"]) {
      expect(src).not.toContain(channel);
    }
  });

  it('a custom transport plugs into the same interface', async () => {
    configureTenant({ enabled_channels: ['email', INTERNAL_CHANNEL, 'carrier_pigeon'] });
    registerTransport({
      channel: 'carrier_pigeon', provider: 'pigeon', external: true,
      async send() {
        return { outcome: 'accepted', provider: 'pigeon', providerMessageId: 'p-1', deliveryStatus: 'sent_unverified', response: {}, duplicate: false };
      },
    });
    const id = await approvedTask({ planTaskId: 'task-9-pigeon', channel: 'carrier_pigeon' });
    const res = await dispatch(id);
    expect(res).toMatchObject({ outcome: 'sent', provider: 'pigeon', deliveryStatus: 'sent_unverified' });
  });
});

// ── 2. Email dispatch ───────────────────────────────────────────────────────

describe('WS-3 M5B (2) — email dispatch', () => {
  it('sends an approved email task and records sent_unverified', async () => {
    configureTenant();
    const id = await approvedTask();
    const res = await dispatch(id);

    expect(res).toMatchObject({
      ok: true, outcome: 'sent', status: 'sent',
      deliveryStatus: 'sent_unverified', // acceptance is NOT delivery
      provider: 'test_provider', providerMessageId: 'ses-msg-1', attemptNumber: 1,
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].to).toBe(RECIPIENT);

    const task = await getOutreachTaskById('co-a', id);
    expect(task?.status).toBe('sent');
    expect(task?.deliveryStatus).toBe('sent_unverified');
  });

  it('builds the provider request from the plan', async () => {
    configureTenant();
    await dispatch(await approvedTask());
    expect(provider.calls[0].subject).toBe('Send intro email');
  });

  it('is DISABLED by default — no provider call without the flag', async () => {
    delete process.env[EMAIL_ENABLED_ENV];
    __clearTransportsForTests();
    registerDefaultTransports({ emailProvider: testProvider });
    configureTenant();
    const id = await approvedTask();
    const res = await dispatch(id);

    expect(isEmailTransportEnabled()).toBe(false);
    expect(res.outcome).toBe('skipped_transport_disabled');
    // The gate sits before egress: the provider was never called.
    expect(provider.calls).toHaveLength(0);
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('queued');
  });

  it('rejects a missing or malformed recipient without calling the provider', async () => {
    configureTenant();
    for (const recipient of [null, '', 'not-an-email', 'a@b']) {
      const id = await approvedTask({ planTaskId: `task-r-${String(recipient)}` });
      const res = await dispatch(id, { recipient });
      expect(res.outcome).toBe('rejected');
    }
    expect(provider.calls).toHaveLength(0);
  });
});

// ── 3. Failure model ────────────────────────────────────────────────────────

describe('WS-3 M5B (3) — transport failure model', () => {
  it('classifies provider rejection', async () => {
    configureTenant();
    provider.response = { accepted: false, messageId: null, rejectionReason: 'suppressed by provider' };
    const id = await approvedTask();
    const res = await dispatch(id);

    expect(res).toMatchObject({ ok: false, outcome: 'rejected', transportOutcome: 'rejected' });
    expect(res.reason).toContain('suppressed by provider');
    // Deferred back to queued — NOT retried.
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('queued');
  });

  it('classifies a provider timeout distinctly from a failure', async () => {
    configureTenant();
    __clearTransportsForTests();
    registerTransport(createEmailTransport(testProvider, { timeoutMs: 20, enabled: () => true }));
    provider.behaviour = 'hang';

    const id = await approvedTask();
    const res = await dispatch(id);
    // A timeout is genuinely ambiguous — the provider may have accepted it —
    // so it must never be mistaken for a clean failure.
    expect(res).toMatchObject({ outcome: 'timeout', transportOutcome: 'timeout' });
    expect(res.reason).toContain('did not respond');
  });

  it('classifies a thrown provider error', async () => {
    configureTenant();
    provider.behaviour = 'throw';
    const res = await dispatch(await approvedTask());
    expect(res).toMatchObject({ outcome: 'failed', transportOutcome: 'provider_error' });
    expect(res.reason).toContain('provider exploded');
  });

  it('persists evidence for EVERY failure outcome', async () => {
    configureTenant();
    const cases: Array<[string, () => void]> = [
      ['rejected', () => { provider.response = { accepted: false, messageId: null, rejectionReason: 'no' }; }],
      ['error', () => { provider.behaviour = 'throw'; }],
    ];
    for (const [label, setup] of cases) {
      provider.response = { accepted: true, messageId: 'x' };
      provider.behaviour = 'respond';
      setup();
      const id = await approvedTask({ planTaskId: `task-f-${label}` });
      await dispatch(id);
      // A failed send with no evidence is indistinguishable from one never made.
      const evidence = await listDeliveryEvidence('co-a', id);
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ delivery_status: 'failed', provider: 'test_provider' });
      expect(await listAttempts('co-a', id)).toHaveLength(1);
    }
  });

  it('schedules NO retry after a failure', async () => {
    configureTenant();
    provider.behaviour = 'throw';
    const id = await approvedTask();
    await dispatch(id);
    // Exactly one attempt, one provider call, and the task is parked.
    expect(await listAttempts('co-a', id)).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('queued');
  });
});

// ── 4. Governance and quota gating ──────────────────────────────────────────

describe('WS-3 M5B (4) — governance and quota precede transport', () => {
  it('never calls the provider when governance blocks', async () => {
    configureTenant({ kill_switch: true });
    const res = await dispatch(await approvedTask());
    expect(res.outcome).toBe('blocked_governance');
    expect(provider.calls).toHaveLength(0);
    expect(db.tables.outreach_attempts ?? []).toHaveLength(0);
  });

  it('never calls the provider for a suppressed recipient', async () => {
    configureTenant();
    (db.tables.outreach_suppressions ??= []).push({ company_id: 'co-a', scope: 'recipient', value: RECIPIENT, revoked_at: null });
    const res = await dispatch(await approvedTask());
    expect(res.outcome).toBe('blocked_governance');
    expect(provider.calls).toHaveLength(0);
  });

  it('never calls the provider for a channel the tenant has not enabled', async () => {
    configureTenant({ enabled_channels: [INTERNAL_CHANNEL] });
    const res = await dispatch(await approvedTask());
    expect(res.outcome).toBe('blocked_governance');
    expect(provider.calls).toHaveLength(0);
  });

  it('never calls the provider when quota is exhausted', async () => {
    configureTenant({ daily_limit_tenant: 1 });
    await dispatch(await approvedTask({ planTaskId: 'task-a' }));
    provider.calls = [];
    const res = await dispatch(await approvedTask({ planTaskId: 'task-b' }));
    expect(['deferred_quota', 'deferred_governance']).toContain(res.outcome);
    expect(provider.calls).toHaveLength(0);
  });

  it('never calls the provider for an unapproved task', async () => {
    configureTenant();
    const res = await insertOutreachTask(newTask({ planTaskId: 'task-p' }));
    const out = await dispatch(res.data!.id as string);
    expect(out.outcome).toBe('blocked_governance');
    expect(provider.calls).toHaveLength(0);
  });
});

// ── 5. Idempotency ──────────────────────────────────────────────────────────

describe('WS-3 M5B (5) — provider idempotency', () => {
  it('derives the key from identity only — no time, no randomness', () => {
    const a = buildIdempotencyKey('co-a', 'task-uuid', 1);
    const b = buildIdempotencyKey('co-a', 'task-uuid', 1);
    expect(a).toBe(b);
    expect(a).not.toBe(buildIdempotencyKey('co-a', 'task-uuid', 2));
    expect(a).not.toBe(buildIdempotencyKey('co-b', 'task-uuid', 1));
    expect(a).toMatch(/^ws3-[0-9a-f]{40}$/);
  });

  it('passes the deterministic key to the provider and persists it', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatch(id);
    const expected = buildIdempotencyKey('co-a', id, 1);
    expect(provider.calls[0].idempotencyKey).toBe(expected);
    expect((await listAttempts('co-a', id))[0].idempotency_key).toBe(expected);
  });

  it('a second dispatch does NOT send again', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatch(id);
    provider.calls = [];
    const again = await dispatch(id);

    expect(again.ok).toBe(false);
    expect(provider.calls).toHaveLength(0);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });

  it('exactly ONE of six concurrent dispatchers sends', async () => {
    configureTenant();
    const id = await approvedTask();
    const results = await Promise.all(Array.from({ length: 6 }, () => dispatch(id)));

    expect(results.filter((r) => r.outcome === 'sent')).toHaveLength(1);
    expect(provider.calls).toHaveLength(1); // the provider saw exactly one request
    expect(await listAttempts('co-a', id)).toHaveLength(1);
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('sent');
  });

  it('honours a provider-side duplicate acknowledgement', async () => {
    configureTenant();
    provider.response = { accepted: true, messageId: 'ses-1', duplicate: true };
    const res = await dispatch(await approvedTask());
    expect(res.outcome).toBe('sent');
    expect(res.reason).toContain('repeat');
  });
});

// ── 6. Evidence and lifecycle ───────────────────────────────────────────────

describe('WS-3 M5B (6) — evidence and lifecycle', () => {
  it('captures provider, message id, response, status, channel and attempt', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatch(id);

    const evidence = (await listDeliveryEvidence('co-a', id))[0];
    const attempt = (await listAttempts('co-a', id))[0];
    expect(evidence).toMatchObject({
      delivery_status: 'sent_unverified',
      provider: 'test_provider',
      provider_message_id: 'ses-msg-1',
      observed_at: NOW,
      attempt_id: attempt.id,
    });
    expect(attempt).toMatchObject({ channel: 'email', transport: 'test_provider', execution_runtime_version: EXECUTION_RUNTIME_VERSION });
  });

  it('reaches sent + sent_unverified and goes NO further', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatch(id);
    const task = await getOutreachTaskById('co-a', id);
    // The frozen lifecycle has no `sent_unverified` STATE — it is the delivery
    // axis. Adding one would change the lifecycle.
    expect(task?.status).toBe('sent');
    expect(task?.deliveryStatus).toBe('sent_unverified');
    expect(['delivered', 'completed']).not.toContain(task?.status);
  });

  it('internal dispatch still records confirmed, not sent_unverified', async () => {
    configureTenant();
    const id = await approvedTask({ planTaskId: 'task-int', channel: INTERNAL_CHANNEL });
    await dispatch(id);
    const task = await getOutreachTaskById('co-a', id);
    // A platform-completed write can assert more than a third party's acceptance.
    expect(task?.deliveryStatus).toBe('confirmed');
  });

  it('attempts and evidence are append-only', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatch(id);
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    for (const table of ['outreach_attempts', 'outreach_delivery_evidence']) {
      const res = await ownedDbTable(table).update({ provider: 'tampered' }).eq('company_id', 'co-a');
      expect(String(res.error?.message)).toContain('append-only');
    }
  });

  it('creates no business outcome and emits no feedback', async () => {
    configureTenant();
    await dispatch(await approvedTask());
    expect(db.tables.outreach_outcomes ?? []).toHaveLength(0);
  });
});

// ── 7. Observability, isolation and guards ──────────────────────────────────

describe('WS-3 M5B (7) — observability, isolation and guards', () => {
  const of = (name: string) => registry.counterEntries().filter((c) => c.name === name);

  it('records external dispatch and provider response separately', async () => {
    configureTenant();
    await dispatch(await approvedTask());
    expect(of(OUTREACH_METRICS.external.dispatch).some((c) => (c.labels ?? {}).external === true)).toBe(true);
    expect(of(OUTREACH_METRICS.provider.response).some((c) => (c.labels ?? {}).provider === 'test_provider')).toBe(true);
  });

  it('records transport errors distinctly', async () => {
    configureTenant();
    provider.behaviour = 'throw';
    await dispatch(await approvedTask());
    expect(of(OUTREACH_METRICS.provider.errors).length).toBeGreaterThan(0);
  });

  it('keeps cardinality bounded and leaks no recipient or message id', async () => {
    configureTenant();
    for (let i = 0; i < 15; i += 1) {
      provider.response = { accepted: true, messageId: `msg-${i}` };
      await dispatch(await approvedTask({ planTaskId: `task-${i}` }));
    }
    const series = registry.counterEntries().filter((c) => c.name.startsWith('outreach.'));
    expect(series.length).toBeLessThanOrEqual(60);
    for (const s of series) {
      const labels = JSON.stringify(s.labels ?? {});
      expect(labels).not.toContain(RECIPIENT);
      expect(labels).not.toMatch(/msg-\d/);
      expect(labels).not.toContain('co-a');
    }
  });

  it('every dispatch query is company-scoped', async () => {
    configureTenant();
    const id = await approvedTask();
    db.filtersSeen = [];
    await dispatch(id);
    for (const q of db.filtersSeen) {
      if (q.op === 'insert') expect(q.payload?.company_id).toBe('co-a');
      else expect(q.filters.map(([c]) => c.replace(/^__\w+__/, ''))).toContain('company_id');
    }
  });

  it('has NO WhatsApp, SMS, LinkedIn transport, retry scheduler, DLQ or feedback emitter', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const files = fs.readdirSync(dir);

    // No module for an unsupported channel exists at all.
    for (const banned of ['whatsapp', 'sms', 'linkedin', 'voice', 'slack', 'retry', 'deadLetter']) {
      expect(files.some((f: string) => f.toLowerCase().includes(banned.toLowerCase()))).toBe(false);
    }

    /**
     * Feedback modules DO exist as of M7, so a filename ban would now be
     * asserting the wrong thing. The invariant this guard actually protects is
     * that the DISPATCH path does not emit feedback — a transport that wrote
     * its own outcome would be marking its own homework. That is stricter than
     * the filename check it replaces: it survives any future renaming.
     */
    for (const f of ['dispatch.ts', 'transport.ts', 'emailTransport.ts', 'internalTransport.ts', 'transportRegistry.ts']) {
      const mod = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(mod).not.toMatch(/ingestFeedback|appendOutcome\s*\(|buildFeedbackEnvelope/);
    }

    const src = files.map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const forbidden of ['whatsapp', 'twilio', 'linkedin', 'nodemailer', 'sendgrid', 'axios', 'node-fetch', 'undici', 'communityAiActionExecutor']) {
      expect(src).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(src).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }
    // No retry scheduling, no dead-letter queue, no repeating timer.
    expect(src).not.toMatch(/\bsetInterval\s*\(/);
    expect(src).not.toMatch(/deadLetter|dead_letter/i);
    expect(src).not.toMatch(/scheduleRetry|retryQueue|\.add\s*\(\s*'/);
    // No raw HTTP: the provider port is the only egress, via the platform seam.
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('the email transport constructs no client until it is actually used', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/emailTransport.ts'), 'utf8');
    // The supabase client is imported lazily, inside the provider, so a
    // disabled transport carries no client in its module graph.
    expect(src).not.toMatch(/^import .*supabaseClient/m);
    expect(src).toMatch(/await import\('\.\.\/\.\.\/db\/supabaseClient'\)/);
  });
});

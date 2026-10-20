/**
 * WP3 / L4 — the unsubscribe flow, end to end.
 *
 * One database double serves the route, the governance writer, Path A and the
 * real Path B dispatch gate, so a single test can prove the whole chain:
 *
 *   signed link → GET confirms (writes nothing) → POST records canonical
 *   governance → the NEXT send is refused on Path A AND Path B
 *
 * The rate limiter and route wrapper are stubbed; nothing leaves the process.
 */

type Row = Record<string, unknown>;

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_approvals'];

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  /** Every ownedDbTable() call — proves a rejection happened before ANY database access. */
  calls: 0,
  /** The SQLSTATE an injected failure answers with, and which operation it hits. */
  failCode: '08006',
  failOp: null as null | 'insert' | 'select' | 'update',
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    db.calls += 1;
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
      if (db.failTable === table && (db.failOp === null || db.failOp === st.op)) {
        return { data: null, error: { code: db.failCode, message: 'injected failure' } };
      }

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
        // `effective_from` defaults to now() in the real schema; without it a
        // freshly written record reads as not yet in force — a defect of the
        // double, not of the code under test.
        const defaults: Row = table === 'contact_governance_records'
          ? { revoked_at: null, revoked_reason: null, effective_from: new Date(0).toISOString(), effective_until: null }
          : {};
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

const rate = { allowed: true };
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: async () => ({ allowed: rate.allowed, remaining: 1, resetAt: 0, bypassed: false }),
}));
// The canonical wrapper is pass-through by contract; stub it so the test calls
// the handler itself.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

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
import { isSuppressed } from '../../services/execution/suppressionService';
import { UNSUBSCRIBE_TOKEN_KEYS_ENV, issueOutreachUnsubscribeToken } from '../../security/outreachUnsubscribeToken';
import handler from '../../../pages/api/outreach/unsubscribe';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const PERSON = '00000000-0000-4000-8000-0000000000a1';
const NOW = '2026-10-20T12:00:00.000Z';
const RECIPIENT = 'Jane.Doe@Example.Test';
const NORMALISED = 'jane.doe@example.test';

const sent: Array<{ to: string }> = [];
const spyEmail = {
  channel: 'email',
  provider: 'spy_email',
  external: true,
  async send(req: { recipient?: string | null }) {
    sent.push({ to: String(req?.recipient ?? '') });
    return { outcome: 'sent' as const, provider: 'spy_email', providerMessageId: 'spy-1', deliveryStatus: 'sent_unverified' as const, response: {}, duplicate: false };
  },
};

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'x',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, personId: PERSON, ...over,
});

const configureTenant = () => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: ORG, enabled: true, kill_switch: false, enabled_channels: ['email'],
    restricted_regions: [], daily_limit_tenant: null, daily_limit_lead: null,
  });
};

/** A task the email went out for, and the attempt the link names. */
async function sentAttempt(over: Partial<NewOutreachTask> = {}, company = ORG): Promise<{ taskId: string; attemptId: string }> {
  const task = await insertOutreachTask(newTask({ companyId: company, ...over }));
  const taskId = task.data!.id as string;
  const attemptId = `att-${db.nextId++}`;
  (db.tables.outreach_attempts ??= []).push({ id: attemptId, company_id: company, task_id: taskId, attempt_number: 1 });
  return { taskId, attemptId };
}

const tokenFor = (attemptId: string, organizationId = ORG) =>
  issueOutreachUnsubscribeToken({ organizationId, attemptId, recipient: RECIPIENT });

interface Res { statusCode: number; headers: Record<string, unknown>; body: string }
async function call(method: string, token: string | null, body: Record<string, unknown> | null = null): Promise<Res> {
  const res: Res = { statusCode: 0, headers: {}, body: '' };
  const api = {
    status(code: number) { res.statusCode = code; return api; },
    setHeader(k: string, v: unknown) { res.headers[k.toLowerCase()] = v; return api; },
    send(b: string) { res.body = String(b); return api; },
    json(b: unknown) { res.body = JSON.stringify(b); return api; },
  };
  const req = { method, query: token === null ? {} : { t: token }, body, headers: {}, socket: { remoteAddress: '203.0.113.9' } };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, api);
  return res;
}

const governance = () => (db.tables.contact_governance_records ??= []);

const priorKeys = process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV];
beforeEach(() => {
  process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV] = `k1:${'k'.repeat(40)}`;
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.failCode = '08006';
  db.failOp = null;
  db.calls = 0;
  rate.allowed = true;
  fakeRedis.store.clear();
  sent.length = 0;
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerTransport(spyEmail as never);
});
afterAll(() => { process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV] = priorKeys; });

describe('WP3/L4 — GET confirms and writes nothing', () => {
  it('a valid link renders a confirmation form and records nothing', async () => {
    const { attemptId } = await sentAttempt();
    const res = await call('GET', tokenFor(attemptId));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<form method="post"');
    expect(governance()).toHaveLength(0);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('an invalid link renders the generic page, 400', async () => {
    const res = await call('GET', 'u1.k1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB');
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('not valid');
  });
});

describe('WP3/L4 — POST records canonical governance, both anchors, scope *', () => {
  it('one-click: one TARGET record and one PERSON record, both unsubscribe on *', async () => {
    const { attemptId, taskId } = await sentAttempt();
    const res = await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('You are unsubscribed');
    const rows = governance();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ organization_id: ORG, governance_type: 'unsubscribe', channel: '*', source: 'outreach_unsubscribe_link' });
      expect(r.evidence).toMatchObject({ attemptId, taskId, method: 'one_click' });
      expect(JSON.stringify(r.evidence)).not.toContain(NORMALISED);
    }
    expect(rows.find((r) => r.person_id == null)).toMatchObject({ target_normalized: NORMALISED });
    expect(rows.find((r) => r.person_id === PERSON)).toBeDefined();
  });

  it('the confirmation form is recorded as method=confirmation', async () => {
    const { attemptId } = await sentAttempt();
    await call('POST', tokenFor(attemptId), {});
    expect(governance()[0].evidence).toMatchObject({ method: 'confirmation' });
  });

  it('a task with no person records the TARGET only', async () => {
    const { attemptId } = await sentAttempt({ personId: null });
    await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });
    expect(governance()).toHaveLength(1);
    expect(governance()[0]).toMatchObject({ person_id: null, target_normalized: NORMALISED });
  });

  it('a REPEAT is idempotent: same response, still two records', async () => {
    const { attemptId } = await sentAttempt();
    const first = await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });
    const second = await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
    expect(governance()).toHaveLength(2);
  });

  it('never writes the legacy suppression store', async () => {
    const { attemptId } = await sentAttempt();
    await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });
    expect(db.tables.suppression_entries ?? []).toHaveLength(0);
  });

  it('never echoes the address in the response', async () => {
    const { attemptId } = await sentAttempt();
    const res = await call('POST', tokenFor(attemptId), {});
    expect(res.body.toLowerCase()).not.toContain(NORMALISED);
  });
});

describe('WP3/L4 — the next send is refused on BOTH paths', () => {
  it('Path A: isSuppressed answers suppressed for the address', async () => {
    const { attemptId } = await sentAttempt();
    expect((await isSuppressed(ORG, 'email', RECIPIENT)).suppressed).toBe(false);

    await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });

    const after = await isSuppressed(ORG, 'email', RECIPIENT);
    expect(after).toMatchObject({ suppressed: true, store: 'canonical', reason: 'unsubscribe' });
  });

  it('Path B: a NEW task to the same person and address is blocked; the transport is never called', async () => {
    configureTenant();
    const { attemptId } = await sentAttempt();
    await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });

    const fresh = await insertOutreachTask(newTask({ planTaskId: 'task-2-followup' }));
    await setOutreachTaskState(ORG, fresh.data!.id as string, { status: 'approved' });
    const res = await dispatchInternalOutreachTask(ORG, fresh.data!.id as string, { now: NOW, recipient: RECIPIENT });

    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it('Path B: an unanchored task to the same ADDRESS is blocked too (target record)', async () => {
    configureTenant();
    const { attemptId } = await sentAttempt();
    await call('POST', tokenFor(attemptId), { 'List-Unsubscribe': 'One-Click' });

    const fresh = await insertOutreachTask(newTask({ planTaskId: 'task-3', personId: null, leadId: 'L-none' }));
    await setOutreachTaskState(ORG, fresh.data!.id as string, { status: 'approved' });
    const res = await dispatchInternalOutreachTask(ORG, fresh.data!.id as string, { now: NOW, recipient: RECIPIENT });

    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });
});

describe('WP3/L4 — tenant binding and refusal', () => {
  it("a token naming ANOTHER tenant cannot reach this tenant's attempt", async () => {
    const { attemptId } = await sentAttempt();
    const res = await call('POST', tokenFor(attemptId, OTHER_ORG), {});
    expect(res.statusCode).toBe(400);
    expect(governance()).toHaveLength(0);
  });

  it('a token for an attempt that does not exist is the generic invalid page', async () => {
    const res = await call('POST', tokenFor('att-missing'), {});
    expect(res.statusCode).toBe(400);
    expect(governance()).toHaveLength(0);
  });

  it('a tampered token is refused', async () => {
    const { attemptId } = await sentAttempt();
    const t = tokenFor(attemptId);
    const last = t[t.length - 2];
    const tampered = t.slice(0, -2) + (last === 'A' ? 'B' : 'A') + t.slice(-1);
    const res = await call('POST', tampered, {});
    expect(res.statusCode).toBe(400);
    expect(governance()).toHaveLength(0);
  });

  it('a missing token is refused', async () => {
    expect((await call('POST', null, {})).statusCode).toBe(400);
  });

  it('rate-limited requests are refused with 429 and record nothing', async () => {
    const { attemptId } = await sentAttempt();
    rate.allowed = false;
    const res = await call('POST', tokenFor(attemptId), {});
    expect(res.statusCode).toBe(429);
    expect(governance()).toHaveLength(0);
  });

  it('other methods answer 405', async () => {
    expect((await call('PUT', null)).statusCode).toBe(405);
  });
});

describe('WP3/L4 — a failure is never reported as success', () => {
  it('an attempt read failure answers 503', async () => {
    const { attemptId } = await sentAttempt();
    db.failTable = 'outreach_attempts';
    const res = await call('POST', tokenFor(attemptId), {});
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('You are unsubscribed');
  });

  it('a transient governance write failure answers 503 (retry is safe)', async () => {
    const { attemptId } = await sentAttempt();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    const res = await call('POST', tokenFor(attemptId), {});
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
  });

  it('a terminal governance write failure (invariant) answers 500', async () => {
    const { attemptId } = await sentAttempt();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    db.failCode = '23514';
    const res = await call('POST', tokenFor(attemptId), {});
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('You are unsubscribed');
  });

  it('a retry after a transient failure completes, without duplicates', async () => {
    const { attemptId } = await sentAttempt();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    expect((await call('POST', tokenFor(attemptId), {})).statusCode).toBe(503);
    db.failTable = null;
    expect((await call('POST', tokenFor(attemptId), {})).statusCode).toBe(200);
    expect((await call('POST', tokenFor(attemptId), {})).statusCode).toBe(200);
    expect(governance()).toHaveLength(2);
  });

  it('logs never carry the address', async () => {
    const spies = [jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    const { attemptId } = await sentAttempt();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    await call('POST', tokenFor(attemptId), {});
    await call('POST', 'garbage', {});
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(logged.toLowerCase()).not.toContain(NORMALISED);
  });
});


// ── Hardening: real Next.js body parsing, and no database access on refusal ──

import { Readable } from 'stream';
import { parseBody } from 'next/dist/server/api-utils/node/parse-body';
import * as unsubscribeRoute from '../../../pages/api/outreach/unsubscribe';

/** Parse a raw request body exactly as Next.js does for a route with bodyParser on. */
async function nextParse(raw: string, contentType: string): Promise<unknown> {
  const stream = Object.assign(Readable.from([Buffer.from(raw, 'utf8')]), { headers: { 'content-type': contentType } });
  return parseBody(stream as never, '1mb');
}

describe('WP3 hardening — one-click POST through the REAL Next.js body parser', () => {
  it('the route keeps Next.js body parsing ON (no config disables it)', () => {
    const cfg = (unsubscribeRoute as { config?: { api?: { bodyParser?: unknown } } }).config;
    expect(cfg?.api?.bodyParser).not.toBe(false);
  });

  it('an RFC 8058 one-click body (form-encoded) parses to List-Unsubscribe=One-Click and is recorded as one_click', async () => {
    const { attemptId } = await sentAttempt();
    const body = await nextParse('List-Unsubscribe=One-Click', 'application/x-www-form-urlencoded');
    expect(body).toEqual({ 'List-Unsubscribe': 'One-Click' });

    const res = await call('POST', tokenFor(attemptId), body as Record<string, unknown>);
    expect(res.statusCode).toBe(200);
    expect(governance()[0].evidence).toMatchObject({ method: 'one_click' });
  });

  it('the confirmation form (token in the form body, none in the query) is parsed and recorded', async () => {
    const { attemptId } = await sentAttempt();
    const token = tokenFor(attemptId);
    const body = await nextParse(`t=${encodeURIComponent(token)}`, 'application/x-www-form-urlencoded');
    const res = await call('POST', null, body as Record<string, unknown>);
    expect(res.statusCode).toBe(200);
    expect(governance()[0].evidence).toMatchObject({ method: 'confirmation' });
  });
});

describe('WP3 hardening — a refused token causes NO database access at all', () => {
  it.each([
    ['a tampered token', (t: string) => t.slice(0, -2) + (t[t.length - 2] === 'A' ? 'B' : 'A') + t.slice(-1)],
    ['a malformed token', () => 'not-a-token'],
    ['no token', () => null],
  ])('%s → 400 with zero database calls', async (_label, mutate) => {
    const { attemptId } = await sentAttempt();
    const token = (mutate as (t: string) => string | null)(tokenFor(attemptId));
    const before = db.calls;
    const res = await call('POST', token, {});
    expect(res.statusCode).toBe(400);
    expect(db.calls).toBe(before);
  });

  it('an unknown key id → 400 with zero database calls', async () => {
    const { attemptId } = await sentAttempt();
    const token = tokenFor(attemptId);
    process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV] = `k9:${'z'.repeat(40)}`;
    const before = db.calls;
    expect((await call('POST', token, {})).statusCode).toBe(400);
    expect(db.calls).toBe(before);
  });

  it('a missing key list → 400 with zero database calls', async () => {
    const { attemptId } = await sentAttempt();
    const token = tokenFor(attemptId);
    delete process.env[UNSUBSCRIBE_TOKEN_KEYS_ENV];
    const before = db.calls;
    expect((await call('POST', token, {})).statusCode).toBe(400);
    expect(db.calls).toBe(before);
  });

  it('GET with a valid token renders the page with zero database calls', async () => {
    const { attemptId } = await sentAttempt();
    const token = tokenFor(attemptId);
    const before = db.calls;
    expect((await call('GET', token)).statusCode).toBe(200);
    expect(db.calls).toBe(before);
  });
});

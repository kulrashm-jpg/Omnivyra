/**
 * WP3 / L6–L9 — the SES/SNS webhook, end to end.
 *
 * Real RSA signatures over real SNS canonical strings; only the certificate
 * download is substituted. One database double serves the route, ingestion,
 * the governance writer, Path A and the real Path B dispatch gate, so a test can
 * prove: authentic event → evidence → restriction → the next send is refused.
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
        // Model `uq_outreach_delivery_provider_event`: (company_id, provider,
        // provider_event_id) among rows with an event id — the webhook's
        // idempotency key. Without it a redelivered event would be appended
        // twice and the duplicate assertions would test nothing.
        if (table === 'outreach_delivery_evidence' && row.provider_event_id != null) {
          const clash = rows().some((r) => r.company_id === row.company_id && r.provider === row.provider
            && r.provider_event_id === row.provider_event_id);
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_outreach_delivery_provider_event"' } };
        }
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


// The canonical wrapper is pass-through by contract; stub it so the test calls
// the handler itself.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import crypto from 'crypto';
import { Readable } from 'stream';
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
import { canonicalSnsString, checkSnsTimestamp, isSnsCertificateUrl } from '../../services/providerEvents/snsSignature';
import handler, { __setSnsCertificateFetcherForTests } from '../../../pages/api/webhooks/ses';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const PERSON = '00000000-0000-4000-8000-0000000000a1';
const TOPIC = 'arn:aws:sns:eu-north-1:111122223333:omnivyra-ses-events';
const CERT_URL = 'https://sns.eu-north-1.amazonaws.com/SimpleNotificationService-test.pem';
const NOW = '2026-10-20T12:00:00.000Z';
const RECIPIENT = 'Jane.Doe@Example.Test';
const NORMALISED = 'jane.doe@example.test';
const PROVIDER = 'supabase_edge_ses';

// A real RSA key pair: the webhook verifies real signatures, only the
// certificate download is substituted.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fetched: string[] = [];

const sent: Array<{ to: string }> = [];
const spyEmail = {
  channel: 'email', provider: 'spy_email', external: true,
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

/** The send this event is about: task + attempt + the send-time evidence row. */
async function sentMessage(messageId = 'ses-msg-1', over: Partial<NewOutreachTask> = {}, company = ORG) {
  const task = await insertOutreachTask(newTask({ companyId: company, ...over }));
  const taskId = task.data!.id as string;
  const attemptId = `att-${db.nextId++}`;
  (db.tables.outreach_attempts ??= []).push({ id: attemptId, company_id: company, task_id: taskId, attempt_number: 1 });
  (db.tables.outreach_delivery_evidence ??= []).push({
    id: `ev-${db.nextId++}`, company_id: company, task_id: taskId, attempt_id: attemptId,
    delivery_status: 'sent_unverified', provider: PROVIDER, provider_message_id: messageId, provider_event_id: null,
  });
  return { taskId, attemptId };
}

type Ses = Record<string, unknown>;
const mail = (over: Ses = {}): Ses => ({ messageId: 'ses-msg-1', timestamp: NOW, destination: [RECIPIENT], ...over });
const delivery = (over: Ses = {}): Ses => ({ notificationType: 'Delivery', mail: mail(), delivery: { timestamp: NOW, recipients: [RECIPIENT] }, ...over });
const bounce = (bounceType: string, over: Ses = {}): Ses => ({
  notificationType: 'Bounce', mail: mail(),
  bounce: { bounceType, bounceSubType: 'General', timestamp: NOW, bouncedRecipients: [{ emailAddress: RECIPIENT, diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] },
  ...over,
});
const complaint = (over: Ses = {}): Ses => ({
  notificationType: 'Complaint', mail: mail(),
  complaint: { timestamp: NOW, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: RECIPIENT }] },
  ...over,
});

let snsSeq = 0;
function envelope(ses: Ses | string, over: Record<string, unknown> = {}, sign = true): Record<string, unknown> {
  const env: Record<string, unknown> = {
    Type: 'Notification',
    MessageId: `sns-${++snsSeq}`,
    TopicArn: TOPIC,
    Message: typeof ses === 'string' ? ses : JSON.stringify(ses),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    ...over,
  };
  if (sign) {
    const alg = env.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
    env.Signature = crypto.createSign(alg).update(canonicalSnsString(env.Type as never, env as never), 'utf8').sign(privateKey, 'base64');
  }
  return env;
}

interface Res { statusCode: number; body: Record<string, unknown> }
async function post(body: unknown, method = 'POST'): Promise<Res> {
  const res: Res = { statusCode: 0, body: {} };
  const api = {
    status(code: number) { res.statusCode = code; return api; },
    setHeader() { return api; },
    json(b: Record<string, unknown>) { res.body = b; return api; },
  };
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Object.assign(Readable.from([Buffer.from(raw, 'utf8')]), { method, headers: {}, query: {} });
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, api);
  return res;
}

const governance = () => (db.tables.contact_governance_records ??= []);
const evidenceRows = () => (db.tables.outreach_delivery_evidence ?? []).filter((r) => r.provider_event_id != null);

const configureTenant = () => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: ORG, enabled: true, kill_switch: false, enabled_channels: ['email'],
    restricted_regions: [], daily_limit_tenant: null, daily_limit_lead: null,
  });
};
async function dispatchNew(over: Partial<NewOutreachTask> = {}) {
  configureTenant();
  const fresh = await insertOutreachTask(newTask({ planTaskId: `task-${db.nextId++}`, ...over }));
  await setOutreachTaskState(ORG, fresh.data!.id as string, { status: 'approved' });
  return dispatchInternalOutreachTask(ORG, fresh.data!.id as string, { now: NOW, recipient: RECIPIENT });
}

const priorTopics = process.env.SES_SNS_TOPIC_ARNS;
beforeEach(() => {
  process.env.SES_SNS_TOPIC_ARNS = TOPIC;
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.failCode = '08006';
  db.failOp = null;
  db.calls = 0;
  fakeRedis.store.clear();
  sent.length = 0;
  fetched.length = 0;
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerTransport(spyEmail as never);
  __setSnsCertificateFetcherForTests(async (url) => { fetched.push(url); return PUBLIC_PEM; });
});
afterAll(() => {
  if (priorTopics === undefined) delete process.env.SES_SNS_TOPIC_ARNS;
  else process.env.SES_SNS_TOPIC_ARNS = priorTopics;
  __setSnsCertificateFetcherForTests(null);
});

// ── L6 — authenticity ───────────────────────────────────────────────────────

describe('WP3/L6 — only authentic, allow-listed, current messages are processed', () => {
  it('a valid signed Delivery is processed: evidence under the SEND provider name, with its attempt', async () => {
    const { attemptId, taskId } = await sentMessage();
    const res = await post(envelope(delivery()));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, duplicate: false, eventType: 'Delivery' });
    expect(evidenceRows()).toHaveLength(1);
    expect(evidenceRows()[0]).toMatchObject({ provider: PROVIDER, delivery_status: 'delivered', task_id: taskId, attempt_id: attemptId });
    expect(governance()).toHaveLength(0);
  });

  it('SignatureVersion 1 (SHA1) is verified too', async () => {
    await sentMessage();
    expect((await post(envelope(delivery(), { SignatureVersion: '1' }))).statusCode).toBe(200);
  });

  it('a payload changed after signing is refused (401) and nothing is written', async () => {
    await sentMessage();
    const env = envelope(delivery());
    env.Message = JSON.stringify(bounce('Permanent'));
    expect((await post(env)).statusCode).toBe(401);
    expect(evidenceRows()).toHaveLength(0);
    expect(governance()).toHaveLength(0);
  });

  it('an unsigned message is refused', async () => {
    await sentMessage();
    expect((await post(envelope(delivery(), {}, false))).statusCode).toBe(401);
  });

  it('a validly signed message from ANOTHER topic is refused', async () => {
    await sentMessage();
    const res = await post(envelope(delivery(), { TopicArn: 'arn:aws:sns:eu-north-1:999999999999:someone-else' }));
    expect(res.statusCode).toBe(401);
    expect(evidenceRows()).toHaveLength(0);
  });

  it('with no topic allow-list configured, everything is refused', async () => {
    delete process.env.SES_SNS_TOPIC_ARNS;
    await sentMessage();
    expect((await post(envelope(delivery()))).statusCode).toBe(401);
  });

  it('a STALE message (older than the replay window) is refused', async () => {
    await sentMessage();
    const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect((await post(envelope(delivery(), { Timestamp: old }))).statusCode).toBe(401);
  });

  it('a message from the FUTURE is refused', async () => {
    await sentMessage();
    const later = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect((await post(envelope(delivery(), { Timestamp: later }))).statusCode).toBe(401);
  });

  it('the replay window covers SNS\'s full 3,600 s retry limit', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(checkSnsTimestamp(new Date(now - 3600 * 1000).toISOString(), now)).toBeNull();
    expect(checkSnsTimestamp(new Date(now - 3 * 3600 * 1000).toISOString(), now)).toBe('stale_message');
    expect(checkSnsTimestamp('not a date', now)).toBe('invalid_timestamp');
  });

  it('a certificate URL off the SNS host is refused BEFORE any fetch', async () => {
    await sentMessage();
    const res = await post(envelope(delivery(), { SigningCertURL: 'https://evil.example/cert.pem' }));
    expect(res.statusCode).toBe(401);
    expect(fetched).toHaveLength(0);
    for (const bad of ['http://sns.eu-north-1.amazonaws.com/x.pem', 'https://sns.eu-north-1.amazonaws.com/x.txt',
      'https://sns.eu-north-1.amazonaws.com.evil.example/x.pem', 'https://u:p@sns.eu-north-1.amazonaws.com/x.pem']) {
      expect(isSnsCertificateUrl(bad)).toBe(false);
    }
  });

  it('malformed JSON is 400; a non-object or unknown Type is 401', async () => {
    expect((await post('{nope')).statusCode).toBe(400);
    expect((await post('"text"')).statusCode).toBe(401);
    expect((await post(envelope(delivery(), { Type: 'Surprise', Signature: 'AAAA' }, false))).statusCode).toBe(401);
  });

  it('a SubscriptionConfirmation is acknowledged for an operator; its URL is never fetched', async () => {
    const env = envelope('confirm', {
      Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.eu-north-1.amazonaws.com/?Action=ConfirmSubscription', Token: 'tok',
    });
    const res = await post(env);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ action: 'operator_confirmation_required' });
    expect(fetched).toEqual([CERT_URL]);
  });

  it('only POST is accepted', async () => {
    expect((await post(envelope(delivery()), 'GET')).statusCode).toBe(405);
  });
});

// ── L6/L9 — idempotency and drops ───────────────────────────────────────────

describe('WP3/L6 — duplicates and unsupported events', () => {
  it('the same SNS message twice: both 200, ONE evidence row, the second reported as duplicate', async () => {
    await sentMessage();
    const env = envelope(delivery());
    const first = await post(env);
    const second = await post(env);
    expect(first.body).toMatchObject({ duplicate: false });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(evidenceRows()).toHaveLength(1);
  });

  it.each(['DeliveryDelay', 'Open', 'Click', 'Send'])('%s is dropped with 200 and writes nothing', async (t) => {
    await sentMessage();
    const res = await post(envelope({ notificationType: t, mail: mail() }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ dropped: 'unsupported_event_type' });
    expect(evidenceRows()).toHaveLength(0);
  });
});

// ── L7 — mapping ────────────────────────────────────────────────────────────

describe('WP3/L7 — a provider message resolves to exactly one tenant, task and attempt', () => {
  it('an unknown message id is terminal (422)', async () => {
    await sentMessage('some-other-id');
    const res = await post(envelope(delivery()));
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ error: 'not_found' });
  });

  it('evidence recorded under any other provider name is NOT matched', async () => {
    await sentMessage();
    db.tables.outreach_delivery_evidence[0].provider = 'ses';
    expect((await post(envelope(delivery()))).statusCode).toBe(422);
  });

  it('one message id on TWO tasks is ambiguous (422)', async () => {
    await sentMessage();
    await sentMessage('ses-msg-1', { planTaskId: 'task-other' });
    const res = await post(envelope(delivery()));
    expect(res.body).toMatchObject({ error: 'ambiguous_task' });
    expect(evidenceRows()).toHaveLength(0);
  });

  it('one message id in TWO tenants is refused as cross-tenant (422)', async () => {
    await sentMessage();
    await sentMessage('ses-msg-1', {}, OTHER_ORG);
    const res = await post(envelope(delivery()));
    expect(res.body).toMatchObject({ error: 'cross_tenant_mismatch' });
    expect(evidenceRows()).toHaveLength(0);
  });

  it('two different attempts for one message are ambiguous (422)', async () => {
    const { taskId } = await sentMessage();
    db.tables.outreach_delivery_evidence.push({
      id: 'ev-x', company_id: ORG, task_id: taskId, attempt_id: 'att-other', provider: PROVIDER, provider_message_id: 'ses-msg-1', provider_event_id: null,
    });
    expect((await post(envelope(delivery()))).body).toMatchObject({ error: 'ambiguous_attempt' });
  });

  it('evidence with no attempt is refused (422)', async () => {
    await sentMessage();
    db.tables.outreach_delivery_evidence[0].attempt_id = null;
    expect((await post(envelope(delivery()))).body).toMatchObject({ error: 'attempt_unknown' });
  });

  it.each([
    ['two destinations', complaint({ mail: mail({ destination: [RECIPIENT, 'other@example.test'] }) })],
    ['no destination', complaint({ mail: mail({ destination: [] }) })],
    ['a complained recipient that is not the destination', complaint({ complaint: { timestamp: NOW, complainedRecipients: [{ emailAddress: 'other@example.test' }] } })],
    ['a bounce naming no recipient', bounce('Permanent', { bounce: { bounceType: 'Permanent', timestamp: NOW, bouncedRecipients: [] } })],
    ['no message id', delivery({ mail: { timestamp: NOW, destination: [RECIPIENT] } })],
  ])('refuses %s (422) and writes nothing', async (_label, ses) => {
    await sentMessage();
    expect((await post(envelope(ses))).statusCode).toBe(422);
    expect(evidenceRows()).toHaveLength(0);
    expect(governance()).toHaveLength(0);
  });
});

// ── L8 — governance ─────────────────────────────────────────────────────────

describe('WP3/L8 — permanent bounces and complaints become restrictions; transient bounces do not', () => {
  it('PERMANENT bounce → bounce_hard on the ADDRESS, email channel only', async () => {
    await sentMessage();
    const res = await post(envelope(bounce('Permanent')));

    expect(res.statusCode).toBe(200);
    expect(evidenceRows()[0]).toMatchObject({ delivery_status: 'bounced' });
    expect(governance()).toHaveLength(1);
    expect(governance()[0]).toMatchObject({
      organization_id: ORG, governance_type: 'bounce_hard', channel: 'email', person_id: null,
      target_normalized: NORMALISED, source: 'webhook:ses',
    });
  });

  it('…and the next send to that address is refused on Path A and Path B', async () => {
    await sentMessage();
    await post(envelope(bounce('Permanent')));

    expect(await isSuppressed(ORG, 'email', RECIPIENT)).toMatchObject({ suppressed: true, reason: 'bounce_hard' });
    const res = await dispatchNew();
    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it.each(['Transient', 'Undetermined'])('%s bounce → evidence only, NO restriction, the address stays contactable', async (type) => {
    await sentMessage();
    const res = await post(envelope(bounce(type)));

    expect(res.statusCode).toBe(200);
    expect(evidenceRows()[0]).toMatchObject({ delivery_status: 'bounced' });
    expect(governance()).toHaveLength(0);
    expect((await isSuppressed(ORG, 'email', RECIPIENT)).suppressed).toBe(false);
  });

  it('COMPLAINT → complaint on *, anchored to the ADDRESS and the PERSON', async () => {
    await sentMessage();
    const res = await post(envelope(complaint()));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ governance: { created: 2, alreadyPresent: 0 } });
    const rows = governance();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ governance_type: 'complaint', channel: '*', organization_id: ORG });
    expect(rows.find((r) => r.person_id == null)).toMatchObject({ target_normalized: NORMALISED });
    expect(rows.find((r) => r.person_id === PERSON)).toBeDefined();
    // Evidence: delivered (a complaint implies arrival) with the SES type kept.
    expect(evidenceRows()[0]).toMatchObject({ delivery_status: 'delivered' });
    expect(evidenceRows()[0].transport_response).toMatchObject({ sesEventType: 'Complaint', complaintFeedbackType: 'abuse' });
  });

  it('…and the next send is refused on Path A and Path B', async () => {
    await sentMessage();
    await post(envelope(complaint()));

    expect(await isSuppressed(ORG, 'email', RECIPIENT)).toMatchObject({ suppressed: true, reason: 'complaint' });
    const res = await dispatchNew();
    expect(res.outcome).toBe('blocked_governance');
    expect(sent).toHaveLength(0);
  });

  it('a provider timestamp AHEAD of our clock still yields a restriction in force now', async () => {
    await sentMessage();
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await post(envelope(complaint({ complaint: { timestamp: ahead, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: RECIPIENT }] } })));
    expect(Date.parse(String(governance()[0].effective_from))).toBeLessThanOrEqual(Date.now());
    expect((await isSuppressed(ORG, 'email', RECIPIENT)).suppressed).toBe(true);
  });

  it('a complaint in one tenant does not restrict the same address in another', async () => {
    await sentMessage();
    await post(envelope(complaint()));
    expect((await isSuppressed(OTHER_ORG, 'email', RECIPIENT)).suppressed).toBe(false);
  });

  it('a complaint on a task with no person records the ADDRESS only', async () => {
    await sentMessage('ses-msg-1', { personId: null });
    await post(envelope(complaint()));
    expect(governance()).toHaveLength(1);
    expect(governance()[0]).toMatchObject({ person_id: null, target_normalized: NORMALISED });
  });

  it('a duplicate complaint is idempotent: 200, still two restrictions', async () => {
    await sentMessage();
    const env = envelope(complaint());
    await post(env);
    const again = await post(env);
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, governance: { created: 0, alreadyPresent: 2 } });
    expect(governance()).toHaveLength(2);
  });

  it('evidence and restrictions never carry the address or diagnostic text', async () => {
    await sentMessage();
    await post(envelope(bounce('Permanent')));
    const stored = JSON.stringify([evidenceRows()[0].transport_response, governance()[0].evidence]).toLowerCase();
    expect(stored).not.toContain(NORMALISED);
    expect(stored).not.toContain('550');
  });
});

// ── L9 — retry semantics ────────────────────────────────────────────────────

describe('WP3/L9 — transient failures are retried (503), terminal ones are not (422)', () => {
  it('an evidence READ failure is 503', async () => {
    await sentMessage();
    db.failTable = 'outreach_delivery_evidence';
    db.failOp = 'select';
    expect((await post(envelope(delivery()))).statusCode).toBe(503);
  });

  it('an evidence WRITE failure is 503 and nothing is restricted', async () => {
    await sentMessage();
    db.failTable = 'outreach_delivery_evidence';
    db.failOp = 'insert';
    expect((await post(envelope(complaint()))).statusCode).toBe(503);
    expect(governance()).toHaveLength(0);
  });

  it('a transient governance write failure is 503 — never a false success', async () => {
    await sentMessage();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    const res = await post(envelope(complaint()));
    expect(res.statusCode).toBe(503);
  });

  it('a terminal governance write failure (invariant) is 422', async () => {
    await sentMessage();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    db.failCode = '23514';
    expect((await post(envelope(complaint()))).statusCode).toBe(422);
  });

  it("SNS's retry after a transient governance failure completes the restriction", async () => {
    await sentMessage();
    const env = envelope(complaint());
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    expect((await post(env)).statusCode).toBe(503);
    db.failTable = null;
    const retry = await post(env);
    expect(retry.statusCode).toBe(200);
    // The evidence was already written, so the retry is a duplicate there —
    // and the restriction is written now.
    expect(retry.body).toMatchObject({ duplicate: true, governance: { created: 2 } });
    expect(governance()).toHaveLength(2);
  });

  it('logs never carry the address', async () => {
    const spies = [jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    await sentMessage();
    db.failTable = 'contact_governance_records';
    db.failOp = 'insert';
    await post(envelope(complaint()));
    await post(envelope(complaint({ mail: mail({ destination: [RECIPIENT, 'x@example.test'] }) })));
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls)).toLowerCase();
    spies.forEach((s) => s.mockRestore());
    expect(logged).not.toContain(NORMALISED);
  });
});

// ── Hardening: body size, claimed topic, rejection before database access ──

import { SES_WEBHOOK_MAX_BODY_BYTES } from '../../../pages/api/webhooks/ses';

/** Call the handler with an arbitrary readable stream and headers. */
async function postStream(stream: Readable, headers: Record<string, string> = {}): Promise<Res & { ended: boolean }> {
  const res = { statusCode: 0, body: {} as Record<string, unknown>, ended: false };
  let streamEnded = false;
  stream.on('end', () => { streamEnded = true; });
  const api = {
    status(code: number) { res.statusCode = code; res.ended = streamEnded; return api; },
    setHeader() { return api; },
    json(b: Record<string, unknown>) { res.body = b; return api; },
  };
  const req = Object.assign(stream, { method: 'POST', headers, query: {} });
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(req, api);
  return res;
}

/** A signed envelope padded (in an UNSIGNED field) to exactly `bytes` bytes of JSON. */
function envelopeOfSize(ses: Ses, bytes: number): string {
  const env = envelope(ses);
  const empty = JSON.stringify({ ...env, Pad: '' });
  const out = JSON.stringify({ ...env, Pad: 'x'.repeat(bytes - Buffer.byteLength(empty)) });
  expect(Buffer.byteLength(out)).toBe(bytes);
  return out;
}

describe('WP3 hardening — the request body is bounded BEFORE parsing or verification', () => {
  it('the cap is 1 MiB', () => {
    expect(SES_WEBHOOK_MAX_BODY_BYTES).toBe(1_048_576);
  });

  it('a body of EXACTLY the cap is accepted and processed end to end', async () => {
    await sentMessage();
    const res = await post(envelopeOfSize(delivery(), SES_WEBHOOK_MAX_BODY_BYTES));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, eventType: 'Delivery' });
  });

  it('ONE byte over the cap is 413 — no certificate fetch, no database access', async () => {
    const body = envelopeOfSize(delivery(), SES_WEBHOOK_MAX_BODY_BYTES + 1);
    const res = await post(body);
    expect(res.statusCode).toBe(413);
    expect(fetched).toHaveLength(0);
    expect(db.calls).toBe(0);
  });

  it('a declared Content-Length over the cap is 413 without reading the body', async () => {
    let reads = 0;
    const stream = new Readable({ read() { reads += 1; this.push(null); } });
    const res = await postStream(stream, { 'content-length': String(SES_WEBHOOK_MAX_BODY_BYTES + 1) });
    expect(res.statusCode).toBe(413);
    expect(reads).toBe(0);
    expect(db.calls).toBe(0);
  });

  it('a streamed (chunked) body is refused AS IT CROSSES the cap — it never waits for the end', async () => {
    // No Content-Length, and the stream NEVER ends: it produces just past the cap
    // and then stalls. A reader that buffers to the end would hang here; the
    // bounded reader answers the moment the cap is crossed.
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let produced = 0;
    const stream = new Readable({
      read() {
        if (produced > SES_WEBHOOK_MAX_BODY_BYTES) return; // stall, never push(null)
        produced += chunk.length;
        this.push(chunk);
      },
    });
    const res = await postStream(stream);
    expect(res.statusCode).toBe(413);
    expect(produced).toBeLessThanOrEqual(SES_WEBHOOK_MAX_BODY_BYTES + 2 * chunk.length);
    expect(db.calls).toBe(0);
    stream.destroy();
  });

  it('a stream error is 400 and leaks nothing it carried', async () => {
    const spies = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {})];
    const secret = 'SECRET-PAYLOAD-jane.doe@example.test';
    // Push ONE chunk, then fail — a read() that pushes on every call would keep
    // producing data before the error fires.
    let pushed = false;
    const stream = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        this.push(Buffer.from(`{"partial":"${secret}`));
        process.nextTick(() => this.destroy(new Error(`socket reset while reading ${secret}`)));
      },
    });
    const res = await postStream(stream);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(logged).not.toContain('SECRET');
    expect(db.calls).toBe(0);
  });

  it('a malformed body is 400 with no certificate fetch and no database access', async () => {
    const res = await post('{"Type": "Notification", ');
    expect(res.statusCode).toBe(400);
    expect(fetched).toHaveLength(0);
    expect(db.calls).toBe(0);
  });
});

describe('WP3 hardening — no certificate is fetched for a topic that is not ours', () => {
  it('a CLAIMED topic outside the allow-list is refused with ZERO certificate fetches', async () => {
    const res = await post(envelope(delivery(), { TopicArn: 'arn:aws:sns:eu-north-1:999999999999:someone-else' }));
    expect(res.statusCode).toBe(401);
    expect(fetched).toHaveLength(0);
    expect(db.calls).toBe(0);
  });

  it('a missing TopicArn is refused with ZERO certificate fetches', async () => {
    const env = envelope(delivery());
    delete env.TopicArn;
    expect((await post(env)).statusCode).toBe(401);
    expect(fetched).toHaveLength(0);
  });

  it('an EMPTY allow-list refuses everything with ZERO fetches and without reading the body', async () => {
    delete process.env.SES_SNS_TOPIC_ARNS;
    let reads = 0;
    const stream = new Readable({ read() { reads += 1; this.push(null); } });
    const res = await postStream(stream);
    expect(res.statusCode).toBe(401);
    expect(reads).toBe(0);
    expect(fetched).toHaveLength(0);
  });

  it('the authoritative topic check still runs AFTER the signature (claim allowed, signature over a different topic)', async () => {
    await sentMessage();
    // Signed for another topic, then the CLAIM is rewritten to ours: the
    // pre-filter passes, the signature (which covers TopicArn) fails.
    const env = envelope(delivery(), { TopicArn: 'arn:aws:sns:eu-north-1:999999999999:someone-else' });
    env.TopicArn = TOPIC;
    const before = db.calls;
    const res = await post(env);
    expect(res.statusCode).toBe(401);
    expect(fetched).toHaveLength(1);
    expect(db.calls).toBe(before);
  });
});

describe('WP3 hardening — a failed verification stops ALL database access', () => {
  it.each([
    ['a tampered payload', () => { const e = envelope(delivery()); e.Message = JSON.stringify(bounce('Permanent')); return e; }],
    ['an unsigned message', () => envelope(delivery(), {}, false)],
    ['a stale timestamp', () => envelope(delivery(), { Timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })],
    ['a certificate off the SNS host', () => envelope(delivery(), { SigningCertURL: 'https://evil.example/cert.pem' })],
  ])('%s → 401 with zero database calls', async (_label, build) => {
    await sentMessage();
    const before = db.calls;
    const res = await post((build as () => Record<string, unknown>)());
    expect(res.statusCode).toBe(401);
    expect(db.calls).toBe(before);
  });
});

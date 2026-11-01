/**
 * WA-5 — the webhook answers 200 only for an event the queue accepted. Anything else
 * answers 503, so Meta's retry is what recovers it (an inference from Meta's documented
 * retry behaviour: nothing here talks to Meta).
 *
 * The route used to ack every failure "to prevent Meta retrying a payload we may have
 * partially queued". These tests are the proof that a retry is safe:
 *
 *   - the real route and real safeEnqueue, over a fake queue that models BullMQ's add:
 *     a jobId already in Redis is a no-op (addStandardJob: EXISTS jobIdKey). A real Redis
 *     is NOT exercised;
 *   - the real processor, delivery update and opt-out on a fake database, so an event
 *     that does run twice (retention expired, or Meta re-batched the body) is shown to
 *     take effect once WITHOUT relying on the queue's dedupe.
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';

const mockGovernance = { keys: new Set<string>(), created: [] as string[] };
const mockQueue = {
  jobs: new Map<string, { data: { payload: unknown } }>(),
  /** ok | refuse (add returns null) | throw (never reached Redis) | lost_ack (stored, reply lost) */
  mode: 'ok' as 'ok' | 'refuse' | 'throw' | 'lost_ack',
  depth: 0,
  unavailable: false,
  async getJobCounts() { return { waiting: this.depth, active: 0, delayed: 0 }; },
  async add(_name: string, data: { payload: unknown }, opts: { jobId: string }) {
    if (this.mode === 'refuse') return null;
    if (this.mode === 'throw') throw new Error('connect ECONNRESET');
    if (!this.jobs.has(opts.jobId)) this.jobs.set(opts.jobId, { data });
    if (this.mode === 'lost_ack') throw new Error('read ECONNRESET');
    return { id: opts.jobId };
  },
};

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../queue/contentGenerationQueues', () => ({
  getContentQueue: () => {
    if (mockQueue.unavailable) throw new Error('REDIS_URL is not configured');
    return mockQueue;
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../services/whatsappRateLimiter', () => ({ checkAndConsume: jest.fn(), getBroadcastChunkStrategy: jest.fn() }));
jest.mock('../../services/prospectIdentity/contactGovernanceWriter', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceWriter');
  return {
    ...actual,
    recordContactGovernance: async (i: { organizationId: string; target: string }) => {
      const key = `${i.organizationId}|${i.target}`;
      if (mockGovernance.keys.has(key)) return { id: key, outcome: 'already_present' };
      mockGovernance.keys.add(key);
      mockGovernance.created.push(key);
      return { id: key, outcome: 'created' };
    },
  };
});

const SECRET = 'fake-app-secret-wa5';
process.env.WHATSAPP_APP_SECRET = SECRET;

/* eslint-disable @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/whatsapp/webhook/index').default;
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
const { fakeDb, resetFakeDb } = require('../helpers/fakeWhatsappDb');
/* eslint-enable @typescript-eslint/no-var-requires */

const PN = 'pn-1';
const FROM = '15551234567';
const WAMID_OUT = 'wamid.out.1';

const stop = { from: FROM, id: 'wamid.in.1', timestamp: '1793000000', text: { body: 'STOP' } };
const reply = { from: FROM, id: 'wamid.in.2', timestamp: '1793000001', text: { body: 'one more thing' } };
const delivered = { id: WAMID_OUT, status: 'delivered' };
const bodyOf = (value: Record<string, unknown>) =>
  JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PN }, ...value } }] }] });
const ALL = bodyOf({ messages: [stop], statuses: [delivered] });

async function post(body: string): Promise<{ status: number; body: unknown }> {
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(req, { method: 'POST', query: {}, headers: { 'x-hub-signature-256': sig }, url: '/api/whatsapp/webhook' });
  const out = { status: 0, body: undefined as unknown };
  const res = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    send(b: unknown) { out.body = b; return this; },
    setHeader() { return this; },
  };
  const done = Promise.resolve(handler(req, res));
  setImmediate(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
  await done;
  return out;
}

/** What the worker does: run every job in the queue. `forget` models retention expiring. */
async function drain(opts: { forget?: boolean } = {}): Promise<number> {
  let ran = 0;
  for (const [id, j] of [...mockQueue.jobs.entries()]) {
    if ((j as { done?: boolean }).done) continue;
    await processWhatsAppWebhookJob({ data: j.data });
    (j as { done?: boolean }).done = true;
    ran += 1;
    if (opts.forget) mockQueue.jobs.delete(id);
  }
  return ran;
}

/** Each event's effect, exactly once. */
const expectEachEventOnce = () => {
  expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
  expect((fakeDb.tables.engagement_messages ?? []).filter((m: { platform_message_id: string }) => m.platform_message_id === stop.id)).toHaveLength(1);
  expect(fakeDb.tables.whatsapp_broadcast_recipients[0].status).toBe('delivered');
  expect(fakeDb.rpcs).toHaveLength(1);
};

beforeEach(() => {
  resetFakeDb({
    social_accounts: [{ id: 'sa-1', company_id: 'co-a', platform: 'whatsapp', phone_number_id: PN, is_active: true }],
    whatsapp_broadcast_recipients: [{ id: 'r1', broadcast_id: 'b1', wa_message_id: WAMID_OUT, status: 'sent' }],
  });
  mockQueue.jobs.clear();
  mockQueue.mode = 'ok';
  mockQueue.depth = 0;
  mockQueue.unavailable = false;
  mockGovernance.keys.clear();
  mockGovernance.created.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('WA-5: 200 only for an event the queue accepted', () => {
  it('accepted: 200', async () => {
    expect((await post(ALL)).status).toBe(200);
    expect(mockQueue.jobs.size).toBe(1);
  });

  it('shed by depth backpressure: 503, and the redelivery is processed', async () => {
    mockQueue.depth = 2_000;
    expect((await post(ALL)).status).toBe(503);
    expect(mockQueue.jobs.size).toBe(0);

    mockQueue.depth = 0;
    expect((await post(ALL)).status).toBe(200);
    expect(await drain()).toBe(1);
    expectEachEventOnce();
  });

  it('not accepted by the queue (add returned null): 503', async () => {
    mockQueue.mode = 'refuse';
    expect((await post(ALL)).status).toBe(503);
    expect(mockQueue.jobs.size).toBe(0);
  });

  it('Redis refused the add: 503', async () => {
    mockQueue.mode = 'throw';
    expect((await post(ALL)).status).toBe(503);
    expect(mockQueue.jobs.size).toBe(0);
  });

  it('no queue at all: 503', async () => {
    mockQueue.unavailable = true;
    expect((await post(ALL)).status).toBe(503);
  });

  it('a body that cannot be parsed is still 400: a retry of the same bytes would not help', async () => {
    expect((await post('not json')).status).toBe(400);
  });
});

describe('WA-5: a redelivered, partly queued payload is processed once per event', () => {
  it('the job reached Redis but the reply was lost: 503, the redelivery folds into the same job', async () => {
    mockQueue.mode = 'lost_ack';
    expect((await post(ALL)).status).toBe(503);
    expect(mockQueue.jobs.size).toBe(1);        // the "partly queued" state the old comment feared

    mockQueue.mode = 'ok';
    expect((await post(ALL)).status).toBe(200);
    expect(mockQueue.jobs.size).toBe(1);        // same bytes, same jobId

    expect(await drain()).toBe(1);
    expectEachEventOnce();
  });

  it('one body is one job: the payload cannot be split, so no event is queued without the others', async () => {
    mockQueue.mode = 'lost_ack';
    await post(bodyOf({ messages: [stop, reply], statuses: [delivered] }));
    const [only] = [...mockQueue.jobs.values()];
    const value = (only.data.payload as { entry: Array<{ changes: Array<{ value: { messages: unknown[]; statuses: unknown[] } }> }> }).entry[0].changes[0].value;
    expect(value.messages).toHaveLength(2);
    expect(value.statuses).toHaveLength(1);
  });

  it('without the queue\'s dedupe (the job aged out of retention before the redelivery), events still take effect once', async () => {
    expect((await post(ALL)).status).toBe(200);
    expect(await drain({ forget: true })).toBe(1);

    expect((await post(ALL)).status).toBe(200);
    expect(mockQueue.jobs.size).toBe(1);        // a second job really is created
    expect(await drain({ forget: true })).toBe(1);

    expectEachEventOnce();
  });

  it('a redelivery with different bytes (re-batched by Meta) is a new job, and overlapping events take effect once', async () => {
    expect((await post(bodyOf({ messages: [stop], statuses: [delivered] }))).status).toBe(200);
    expect((await post(bodyOf({ messages: [reply, stop], statuses: [delivered] }))).status).toBe(200);
    expect(mockQueue.jobs.size).toBe(2);
    expect(await drain()).toBe(2);

    expectEachEventOnce();
    expect((fakeDb.tables.engagement_messages ?? []).map((m: { platform_message_id: string }) => m.platform_message_id).sort()).toEqual([stop.id, reply.id].sort());
  });
});

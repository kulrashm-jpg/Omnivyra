/**
 * WhatsApp broadcast RESUME and one-run-at-a-time (e9 decision (a), 2026-11-11; S port).
 *
 * The defect: batch jobs had a FIXED jobId `wa-batch-<id>-<n>` (retries:
 * `wa-retry-<id>-<Date.now()>`), completed jobs are kept 24 h, and BullMQ ignores an add
 * whose jobId exists - so a resume within 24 h added nothing while the route answered
 * `enqueued: true`.
 *
 * Real enqueueBroadcast / retryFailed / processBatch on S's fake database
 * (helpers/fakeWhatsappDb.ts). The queue reproduces the BullMQ behaviour that matters (an
 * add with an existing jobId returns the EXISTING job and adds nothing, whatever its
 * state); the lease reproduces withLease's contract in memory. Jobs run through the REAL
 * processBatch with `fetch` spied, so "the resume sends" is proven by provider calls.
 * Nothing here contacts Meta or Redis.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');

type Job = { id: string; data: { broadcast_id: string; recipient_ids: string[] }; state: string };
const mockQueue = {
  jobs: new Map<string, Job>(),
  failAddAt: 0,   // 1-based add number that throws (0 = never)
  adds: 0,
  async add(data: Job['data'], opts: { jobId: string }): Promise<Job> {
    this.adds += 1;
    if (this.failAddAt && this.adds === this.failAddAt) throw new Error('Command timed out');
    const existing = this.jobs.get(opts.jobId);
    if (existing) return existing; // BullMQ: a duplicate jobId adds nothing
    const job = { id: opts.jobId, data, state: 'waiting' };
    this.jobs.set(opts.jobId, job);
    return job;
  },
  async getJobs(states: string[]): Promise<Job[]> {
    return [...this.jobs.values()].filter((j) => states.includes(j.state));
  },
};
const mockLease = { held: new Set<string>(), unavailable: false, names: [] as string[] };

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}), handleTemplateStatusWebhook: async () => undefined }));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => mockQueue }));
const mockCheckAndConsume = jest.fn(async () => ({ allowed: true, tier: 'TIER_1' }));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: (...a: unknown[]) => (mockCheckAndConsume as any)(...a),
  getBroadcastChunkStrategy: () => ({ batch_size: 2, delay_ms: 0 }),
}));
jest.mock('../../middleware/queueBackpressure', () => ({
  // The real enqueueOrThrow maps BullMQ's returned job to 'enqueued' - it cannot see a
  // duplicate - which is what made the old route answer enqueued:true.
  enqueueOrThrow: async (q: typeof mockQueue, _n: unknown, _j: unknown, data: Job['data'], opts: { jobId: string }) => ({ id: (await q.add(data, opts)).id }),
}));
jest.mock('../../../lib/platform/distributedLock', () => ({
  withLease: async (name: string, _ttl: number, fn: () => Promise<unknown>) => {
    mockLease.names.push(name);
    if (mockLease.unavailable) return { ran: false, reason: 'unavailable' };
    if (mockLease.held.has(name)) return { ran: false, reason: 'held' };
    mockLease.held.add(name);
    try { return { ran: true, value: await fn() }; } finally { mockLease.held.delete(name); }
  },
}));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  BroadcastAlreadyRunningError,
  BroadcastPartiallyEnqueuedError,
  WhatsAppEnqueueUncertainError,
  enqueueBroadcast,
  enqueueOutcomeResponse,
  processBatch,
  retryFailed,
  retryOutcomeResponse,
} from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const id = (n: number) => `0b000000-0000-4000-8000-00000000000${n}`;
const phone = (n: number) => `+1555010000${n}`;
const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const seed = (n = 3, over: Row = {}) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'draft', message_type: 'template', template_name: 'tpl', name: 'Launch' }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  whatsapp_broadcast_recipients: Array.from({ length: n }, (_v, k) => ({
    id: id(k + 1), broadcast_id: 'b1', encrypted_phone: encrypt(phone(k + 1)), status: 'pending', retry_count: 0, wa_message_id: null, ...over,
  })),
  contact_governance_records: [],
  whatsapp_provider_events: [],
});
const rec = (k: number): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id(k))!;
const sends: string[] = [];

/** Run every waiting job through the REAL processBatch, then keep it as completed (BullMQ retains it 24 h). */
const drain = async () => {
  for (const j of mockQueue.jobs.values()) {
    if (j.state !== 'waiting') continue;
    j.state = 'active';
    await processBatch(j.data.broadcast_id, j.data.recipient_ids);
    j.state = 'completed';
  }
};

beforeEach(() => {
  mockQueue.jobs.clear(); mockQueue.failAddAt = 0; mockQueue.adds = 0;
  mockLease.held.clear(); mockLease.unavailable = false; mockLease.names = [];
  mockCheckAndConsume.mockClear();
  sends.length = 0;
  (global as any).fetch = async (_url: string, init: any) => {
    sends.push(JSON.parse(init.body).to);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) };
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('a resume within 24 h actually sends the pending recipients', () => {
  it('a stopped run, then a resume: NEW jobs, and the remaining recipient is sent exactly once', async () => {
    seed(3);
    const first = await enqueueBroadcast('b1', 'free');
    expect(first.batches).toBe(2);
    const [job0, job1] = [...mockQueue.jobs.values()];
    job0.state = 'active'; await processBatch('b1', job0.data.recipient_ids); job0.state = 'completed';
    job1.state = 'completed'; // stopped before sending (as a paused batch does), retained
    fakeDb.tables.whatsapp_broadcasts[0].status = 'paused';

    const resume = await enqueueBroadcast('b1', 'free');
    expect(resume).toMatchObject({ batches: 1, recipients: 1 });
    expect(resume.run_id).not.toBe(first.run_id);
    expect(enqueueOutcomeResponse({ ok: true, result: resume })).toEqual({
      status: 200, body: { enqueued: true, run_id: resume.run_id, batches: 1, recipients: 1 },
    });
    await drain();
    expect(rec(3).status).toBe('sent');
    expect(sends).toHaveLength(3);
    expect(new Set(sends).size).toBe(3);
  });

  it('batch and retry job ids carry a fresh UUID per run, never an index alone or a timestamp', async () => {
    seed(1);
    await enqueueBroadcast('b1', 'free');
    await drain();
    rec(1).status = 'failed'; rec(1).retry_count = 1;
    await retryFailed('b1');
    const ids = [...mockQueue.jobs.keys()];
    expect(ids[0]).toMatch(/^wa-batch-b1-[0-9a-f-]{36}-0$/);
    expect(ids[1]).toMatch(/^wa-retry-b1-[0-9a-f-]{36}$/);
  });
});

describe('one run at a time', () => {
  it('two concurrent enqueues: exactly one run queued, the other refused (409)', async () => {
    seed(3);
    const results = await Promise.allSettled([enqueueBroadcast('b1', 'free'), enqueueBroadcast('b1', 'free')]);
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(BroadcastAlreadyRunningError);
    expect(enqueueOutcomeResponse({ ok: false, error: refused[0].reason }).status).toBe(409);
    expect(mockQueue.jobs.size).toBe(2);
    expect(mockCheckAndConsume).toHaveBeenCalledTimes(1);
  });

  it('live jobs -> 409 naming a possibly stalled worker, BEFORE screening or quota', async () => {
    seed(3);
    await enqueueBroadcast('b1', 'free');
    mockCheckAndConsume.mockClear();
    const calls = fakeDb.calls.length;
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastAlreadyRunningError);
    expect(String(err.message)).toMatch(/stopped mid-batch.*30 minutes/);
    expect(mockCheckAndConsume).not.toHaveBeenCalled();
    expect(fakeDb.calls.slice(calls).filter((c) => c.endsWith(':update'))).toEqual([]);
  });

  it('NEGATIVE CONTROL: live jobs of ANOTHER broadcast do not block this one', async () => {
    seed(3);
    mockQueue.jobs.set('wa-batch-b2-x-0', { id: 'wa-batch-b2-x-0', data: { broadcast_id: 'b2', recipient_ids: ['z'] }, state: 'active' });
    expect((await enqueueBroadcast('b1', 'free')).batches).toBe(2);
  });

  it('NEGATIVE CONTROL: once the previous run has completed, a resume is allowed', async () => {
    seed(3);
    await enqueueBroadcast('b1', 'free');
    for (const j of mockQueue.jobs.values()) j.state = 'completed';
    expect((await enqueueBroadcast('b1', 'free')).batches).toBe(2);
  });

  it('two concurrent retries: one re-queues, the other 409; each failed recipient is sent once', async () => {
    seed(2, { status: 'failed', retry_count: 1 });
    const results = await Promise.allSettled([retryFailed('b1'), retryFailed('b1')]);
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(refused).toHaveLength(1);
    expect(retryOutcomeResponse({ ok: false, error: refused[0].reason }).status).toBe(409);
    await drain();
    expect(sends).toHaveLength(2);
  });

  it('a retry while an enqueue run has live jobs -> 409 and no failed row is reset', async () => {
    seed(3);
    await enqueueBroadcast('b1', 'free');
    rec(3).status = 'failed'; rec(3).retry_count = 1;
    await expect(retryFailed('b1')).rejects.toBeInstanceOf(BroadcastAlreadyRunningError);
    expect(rec(3).status).toBe('failed');
  });

  it('lease unavailable: nothing queued, quota untouched, a plain 400', async () => {
    seed(3);
    mockLease.unavailable = true;
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).not.toBeInstanceOf(BroadcastAlreadyRunningError);
    expect(mockQueue.jobs.size).toBe(0);
    expect(mockCheckAndConsume).not.toHaveBeenCalled();
    expect(enqueueOutcomeResponse({ ok: false, error: err })).toMatchObject({ status: 400, body: { enqueued: false } });
  });
});

describe('every outcome is reported honestly (composed with the L-4 settlement)', () => {
  it('an add that fails AFTER a batch is queued, its batch withdrawn -> 202 {enqueued:true, partial:true}', async () => {
    seed(3);
    mockQueue.failAddAt = 2;
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastPartiallyEnqueuedError);
    expect(rec(3).status).toBe('failed'); // withdrawn by the settlement: never sent, retryable
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('running');
    expect(enqueueOutcomeResponse({ ok: false, error: err })).toMatchObject({
      status: 202, body: { enqueued: true, partial: true, uncertain: false, batches: 1, recipients: 2 },
    });
  });

  it('the withdrawal itself cannot be written after a queued batch -> partial AND uncertain', async () => {
    seed(3);
    mockQueue.failAddAt = 2;
    failNext('whatsapp_broadcast_recipients', 'update', 0);
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastPartiallyEnqueuedError);
    expect(enqueueOutcomeResponse({ ok: false, error: err }).body).toMatchObject({ enqueued: true, partial: true, uncertain: true });
  });

  it('the FIRST add fails and is withdrawn -> a plain failure (nothing known queued)', async () => {
    seed(3);
    mockQueue.failAddAt = 1;
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).not.toBeInstanceOf(BroadcastPartiallyEnqueuedError);
    expect(enqueueOutcomeResponse({ ok: false, error: err })).toMatchObject({ status: 400, body: { enqueued: false } });
  });

  it('the FIRST add fails and the withdrawal cannot be written -> 500 {enqueued:false, uncertain:true}', async () => {
    seed(3);
    mockQueue.failAddAt = 1;
    failNext('whatsapp_broadcast_recipients', 'update', 0);
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppEnqueueUncertainError);
    expect(enqueueOutcomeResponse({ ok: false, error: err })).toMatchObject({ status: 500, body: { enqueued: false, uncertain: true } });
  });

  it('zero batches and nothing to retry are never reported as success', async () => {
    expect(enqueueOutcomeResponse({ ok: true, result: { run_id: 'x', batches: 0, recipients: 0 } })).toMatchObject({ status: 409, body: { enqueued: false } });
    seed(1);
    const r = await retryFailed('b1');
    expect(r.retried).toBe(0);
    expect(retryOutcomeResponse({ ok: true, result: r })).toMatchObject({ status: 409, body: { retried: false } });
  });
});

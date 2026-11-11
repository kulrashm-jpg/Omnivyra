/**
 * Work Item 2 / L-4 — WhatsApp send-once, lost acknowledgements and reconciliation.
 *
 * Real enqueueBroadcast, processBatch, retryFailed, updateRecipientDelivery and the webhook
 * job processor, on the fake database (helpers/fakeWhatsappDb.ts). The provider is a
 * `fetch` test double and the queue a recording fake: no Meta call, no Redis, no send.
 *
 * Proven:
 *   - one external call per recipient across duplicate, concurrent and retried invocations;
 *   - confirmed delivery, confirmed failure and an uncertain outcome are distinct states:
 *     a timeout, a lost response, a 5xx/408 or an id-less acceptance are `send_uncertain`,
 *     never `failed`, so retryFailed never resends them;
 *   - a queue add that threw is settled without guessing: the batch's pending recipients are
 *     withdrawn (never sent, safe to retry), or the batch is known queued; never both sent
 *     and reported failed;
 *   - an uncertain send is reconciled ONLY by a status webhook carrying its marker
 *     (biz_opaque_callback_data = recipient id) for the same number; nothing is resent;
 *   - the quota check runs once per enqueue (billing boundary unchanged).
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
let mockTableHook: ((table: string) => void) | null = null;
const mockQueue: Array<{ jobId: string; ids: string[] }> = [];
let mockEnqueue: (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => Promise<unknown>;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => { mockTableHook?.(t); return require('../helpers/fakeWhatsappDb').fakeTable(t); },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}), handleTemplateStatusWebhook: async () => undefined }));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));
const mockCheckAndConsume = jest.fn(async () => ({ allowed: true, tier: 'TIER_1' }));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: (...a: unknown[]) => (mockCheckAndConsume as any)(...a),
  getBroadcastChunkStrategy: () => ({ batch_size: 10, delay_ms: 0 }),
}));
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: any, opts: any) => mockEnqueue(data, opts),
}));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import {
  ENQUEUE_UNCONFIRMED_MESSAGE,
  WHATSAPP_SEND_TIMEOUT_MS,
  WhatsAppEnqueueUncertainError,
  enqueueBroadcast,
  processBatch,
  retryFailed,
  updateRecipientDelivery,
} from '../../services/whatsappBroadcastService';
import { processWhatsAppWebhookJob } from '../../queue/jobProcessors/whatsappWebhookProcessor';

const ORG = 'co-a';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';
const PHONE1 = '+15550100001';
const PHONE2 = '+15550100002';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const recipient = (id: string, phone: string, over: Row = {}): Row =>
  ({ id, broadcast_id: 'b1', encrypted_phone: encrypt(phone), status: 'pending', retry_count: 0, wa_message_id: null, ...over });

// An operator broadcast (no `wf:` prefix): the journey send controls are covered elsewhere.
const seed = (recipients: Row[] = [recipient(R1, PHONE1)]) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'draft', message_type: 'template', template_name: 'tpl', name: 'Launch' }],
  social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  whatsapp_broadcast_recipients: recipients,
  contact_governance_records: [],
  whatsapp_provider_events: [],
});
const rec = (id = R1): Row => fakeDb.tables.whatsapp_broadcast_recipients.find((x) => x.id === id)!;

type Provider = (url: string, init: any) => Promise<unknown>;
let provider: Provider;
const sends: Array<{ to: string; marker: unknown }> = [];
const okWith = (wamid: string): Provider => async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: wamid }] }) });

/** A queue whose job runs immediately (a free worker), like the production processor. */
const runNow = async (data: any, opts: any) => { mockQueue.push({ jobId: opts.jobId, ids: data.recipient_ids }); await processBatch(data.broadcast_id, data.recipient_ids); return { id: opts.jobId }; };

/** A Meta status webhook job for one message. */
const statusJob = (wamid: string, status: string, over: Row = {}) => ({
  data: { payload: { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'pn1' }, statuses: [{ id: wamid, status, timestamp: '1762600000', ...over }] } }] }] } },
}) as any;

beforeEach(() => {
  sends.length = 0;
  mockQueue.length = 0;
  mockTableHook = null;
  mockCheckAndConsume.mockClear();
  mockEnqueue = runNow;
  provider = okWith('wamid.ok.1');
  (global as any).fetch = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    sends.push({ to: body.to, marker: body.biz_opaque_callback_data });
    return provider(url, init);
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('send-once boundary (processBatch)', () => {
  it('every message carries its recipient id as the reconciliation marker, and nothing else of ours', async () => {
    seed();
    await processBatch('b1', [R1]);
    expect(sends).toEqual([{ to: PHONE1, marker: R1 }]);
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.ok.1' });
  });

  it('duplicate invocation (the same job twice, or a BullMQ retry): one provider call', async () => {
    seed();
    await processBatch('b1', [R1]);
    await processBatch('b1', [R1]);
    expect(sends).toHaveLength(1);
  });

  it('concurrent invocations of the same batch: exactly one provider call', async () => {
    seed([recipient(R1, PHONE1), recipient(R2, PHONE2)]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    provider = async () => { await gate; return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) }; };
    const runs = Promise.all([processBatch('b1', [R1, R2]), processBatch('b1', [R1, R2]), processBatch('b1', [R2, R1])]);
    await new Promise((r) => setImmediate(r));
    release();
    await runs;
    expect(sends.map((s) => s.to).sort()).toEqual([PHONE1, PHONE2]);
    expect([rec(R1).status, rec(R2).status]).toEqual(['sent', 'sent']);
  });
});

describe('confirmed delivery, confirmed failure and uncertain outcomes are distinct', () => {
  it('timeout: the call is abandoned, the recipient is send_uncertain, and nothing ever resends it', async () => {
    seed();
    jest.useFakeTimers();
    try {
      provider = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      const run = processBatch('b1', [R1]);
      await jest.advanceTimersByTimeAsync(WHATSAPP_SEND_TIMEOUT_MS + 1);
      await run;
    } finally {
      jest.useRealTimers();
    }
    expect(rec()).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect(String(rec().error_message)).toContain('timed out');
    provider = okWith('wamid.second');
    await processBatch('b1', [R1]);        // job retry
    await retryFailed('b1');               // operator retry
    expect(sends).toHaveLength(1);
    expect(mockQueue).toEqual([]);
  });

  it('lost response (the request reached Meta, the answer did not): send_uncertain, never resent', async () => {
    seed();
    provider = async () => { throw new Error('socket hang up'); };
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'send_uncertain', error_message: 'socket hang up' });
    await retryFailed('b1');
    await processBatch('b1', [R1]);
    expect(sends).toHaveLength(1);
  });

  it.each([500, 502, 503, 408])('HTTP %i does not say the message was refused: send_uncertain, not failed, never retried', async (status) => {
    seed();
    provider = async () => ({ ok: false, status, json: async () => ({ error: { message: 'upstream' } }) });
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'send_uncertain', error_code: status });
    await retryFailed('b1');
    expect(mockQueue).toEqual([]);
    expect(sends).toHaveLength(1);
  });

  it('accepted without a message id: send_uncertain (unchanged behaviour)', async () => {
    seed();
    provider = async () => ({ ok: true, status: 200, json: async () => ({}) });
    await processBatch('b1', [R1]);
    expect(rec().status).toBe('send_uncertain');
  });

  it('a confirmed refusal (4xx with a Meta code) is failed, and retryFailed sends it again exactly once', async () => {
    seed();
    provider = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131008, message: 'Required parameter is missing' } }) });
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'failed', error_code: 131008, retry_count: 1 });
    provider = okWith('wamid.retry');
    await retryFailed('b1');
    expect(mockQueue.map((q) => q.ids)).toEqual([[R1]]);
    expect(sends).toHaveLength(2);
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.retry' });
  });

  it('retryFailed resets only rows still failed: one a webhook moved to delivered meanwhile is not resent', async () => {
    seed([recipient(R1, PHONE1, { status: 'failed', retry_count: 1, wa_message_id: 'wamid.r1' }), recipient(R2, PHONE2, { status: 'failed', retry_count: 1 })]);
    let accesses = 0;
    mockTableHook = (t) => {
      if (t !== 'whatsapp_broadcast_recipients') return;
      accesses += 1;
      // Between retryFailed's read (1st access) and its reset (2nd): a late `delivered` event.
      if (accesses === 2) rec(R1).status = 'delivered';
    };
    await retryFailed('b1');
    mockTableHook = null;
    expect(rec(R1).status).toBe('delivered');
    expect(mockQueue.map((q) => q.ids)).toEqual([[R2]]);
    expect(sends.map((s) => s.to)).toEqual([PHONE2]);
  });
});

describe('a lost queue acknowledgement (enqueueBroadcast)', () => {
  it('the job was never stored: the batch is withdrawn (never sent), the caller is told, and a retry sends exactly once', async () => {
    seed();
    mockEnqueue = async () => { throw new Error('Connection is closed.'); };
    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('Connection is closed.');
    expect(rec()).toMatchObject({ status: 'failed', error_code: null, error_message: ENQUEUE_UNCONFIRMED_MESSAGE, retry_count: 0 });
    expect(sends).toHaveLength(0);
    expect(mockCheckAndConsume).toHaveBeenCalledTimes(1);
    mockEnqueue = runNow;
    await retryFailed('b1');
    expect(sends).toHaveLength(1);
    expect(rec().status).toBe('sent');
  });

  it('the job was stored and already ran before the error reached us: treated as queued, sent once, no error', async () => {
    seed();
    mockEnqueue = async (data, opts) => { await runNow(data, opts); throw new Error('Command timed out'); };
    await expect(enqueueBroadcast('b1', 'free')).resolves.toBeUndefined();
    expect(sends).toHaveLength(1);
    expect(rec().status).toBe('sent');
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('running');
  });

  it('the job was stored but runs later: the withdrawal wins, the late job sends nothing, a retry sends once', async () => {
    seed();
    let stored: { data: any; opts: any } | null = null;
    mockEnqueue = async (data, opts) => { stored = { data, opts }; throw new Error('Command timed out'); };
    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow('Command timed out');
    await runNow(stored!.data, stored!.opts);   // the job the queue did keep
    expect(sends).toHaveLength(0);
    expect(rec().error_message).toBe(ENQUEUE_UNCONFIRMED_MESSAGE);
    mockEnqueue = runNow;
    await retryFailed('b1');
    expect(sends).toHaveLength(1);
  });

  it('the withdrawal itself cannot be written: WhatsAppEnqueueUncertainError, for a person to review', async () => {
    seed();
    mockEnqueue = async () => { throw new Error('Connection is closed.'); };
    failNext('whatsapp_broadcast_recipients', 'update');
    const err = await enqueueBroadcast('b1', 'free').catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppEnqueueUncertainError);
    expect(err.code).toBe('whatsapp_enqueue_uncertain');
    expect(rec().status).toBe('pending');
  });

  it('retryFailed applies the same settlement to its own lost acknowledgement', async () => {
    seed([recipient(R1, PHONE1, { status: 'failed', retry_count: 1 })]);
    mockEnqueue = async () => { throw new Error('Connection is closed.'); };
    await expect(retryFailed('b1')).rejects.toThrow('Connection is closed.');
    expect(rec()).toMatchObject({ status: 'failed', error_message: ENQUEUE_UNCONFIRMED_MESSAGE });
    expect(sends).toHaveLength(0);
  });
});

describe('reconciliation through the existing status webhook and provider event ledger', () => {
  const uncertain = async () => {
    seed();
    provider = async () => { throw new Error('socket hang up'); };
    await processBatch('b1', [R1]);
    expect(rec().status).toBe('send_uncertain');
  };

  it('a status event with the marker and the same number attaches the message id; later events apply; nothing is resent', async () => {
    await uncertain();
    await processWhatsAppWebhookJob(statusJob('wamid.late', 'sent', { biz_opaque_callback_data: R1, recipient_id: '15550100001' }));
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.late' });
    await processWhatsAppWebhookJob(statusJob('wamid.late', 'delivered', { biz_opaque_callback_data: R1, recipient_id: '15550100001', timestamp: '1762600100' }));
    expect(rec().status).toBe('delivered');
    // A replay changes nothing on the recipient. Every event went to the provider event
    // ledger (its unique key collapses replays on the real schema: 20270128000002 suites).
    await processWhatsAppWebhookJob(statusJob('wamid.late', 'sent', { biz_opaque_callback_data: R1, recipient_id: '15550100001' }));
    expect(rec().status).toBe('delivered');
    expect(new Set(fakeDb.tables.whatsapp_provider_events.map((e) => `${e.wa_message_id}:${e.event_status}`)))
      .toEqual(new Set(['wamid.late:sent', 'wamid.late:delivered']));
    expect(sends).toHaveLength(1);
  });

  it('a failed status event reconciles to failed with the message id (a confirmed provider failure)', async () => {
    await uncertain();
    await updateRecipientDelivery({ wa_message_id: 'wamid.f', status: 'failed', error_code: 131049, error_message: 'not delivered',
      callback_data: R1, recipient_wa_id: '15550100001' });
    expect(rec()).toMatchObject({ status: 'failed', wa_message_id: 'wamid.f', error_code: 131049 });
  });

  it.each([
    ['another number', { callback_data: R1, recipient_wa_id: '15550109999' }],
    ['no number', { callback_data: R1, recipient_wa_id: null }],
    ['no marker', { callback_data: null, recipient_wa_id: '15550100001' }],
    ['a marker that is not one of our ids', { callback_data: 'r1; drop table', recipient_wa_id: '15550100001' }],
  ])('a status event with %s changes nothing', async (_n, over) => {
    await uncertain();
    await updateRecipientDelivery({ wa_message_id: 'wamid.x', status: 'sent', ...over } as any);
    expect(rec()).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
  });

  it('a recipient that already has its message id is never re-attached to another message', async () => {
    seed();
    await processBatch('b1', [R1]);
    await updateRecipientDelivery({ wa_message_id: 'wamid.other', status: 'sent', callback_data: R1, recipient_wa_id: '15550100001' });
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.ok.1' });
  });

  it('two status events racing for the same unconfirmed recipient: the second never overwrites the first message id', async () => {
    await uncertain();
    let accesses = 0;
    mockTableHook = (t) => {
      if (t !== 'whatsapp_broadcast_recipients') return;
      accesses += 1;
      // After this event's read (1st access) and before its write (2nd): another event attached.
      if (accesses === 2) Object.assign(rec(), { status: 'sent', wa_message_id: 'wamid.first' });
    };
    await updateRecipientDelivery({ wa_message_id: 'wamid.second', status: 'sent', callback_data: R1, recipient_wa_id: '15550100001' });
    mockTableHook = null;
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.first' });
  });

  it('recovery: the process sent but could not record it (row left sending); the job retry sends nothing; the webhook reconciles', async () => {
    seed();
    failNext('whatsapp_broadcast_recipients', 'update', 1);   // the claim succeeds, the `sent` write fails
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'sending', wa_message_id: null });
    await processBatch('b1', [R1]);
    expect(sends).toHaveLength(1);
    await updateRecipientDelivery({ wa_message_id: 'wamid.ok.1', status: 'sent', callback_data: R1, recipient_wa_id: '15550100001' });
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.ok.1' });
  });
});

describe('leaving `sending` is conditional: a late worker never overwrites another path (05 / e9)', () => {
  /** The provider answers AFTER `mutate` ran, as if the sweep or a webhook resolved the row mid-call. */
  const answerAfter = (mutate: () => void, answer: () => Promise<unknown>): Provider => async () => { mutate(); return answer(); };
  const errorLog = () => (console.error as jest.Mock).mock.calls;

  it('the sweep inferred send_uncertain mid-call; the worker then gets the provider id -> sent with that id (proof beats inference)', async () => {
    seed();
    provider = answerAfter(() => Object.assign(rec(), { status: 'send_uncertain', error_message: 'swept' }), okWith('wamid.late').bind(null, '', {}));
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.late' });
  });

  it('another path attached id X mid-call; the worker brings a DIFFERENT id Y -> the row keeps X, and the ERROR names both ids', async () => {
    seed();
    provider = answerAfter(() => Object.assign(rec(), { status: 'delivered', wa_message_id: 'wamid.X' }), okWith('wamid.Y').bind(null, '', {}));
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'delivered', wa_message_id: 'wamid.X' });
    expect(errorLog()).toContainEqual([
      expect.stringContaining('already been resolved by another path'),
      expect.objectContaining({ worker_wa_message_id: 'wamid.Y', row_wa_message_id: 'wamid.X', row_status: 'delivered', conflicting_ids: true }),
    ]);
  });

  it('the same id attached by the webhook first -> the row is unchanged and the log says not conflicting', async () => {
    seed();
    provider = answerAfter(() => Object.assign(rec(), { status: 'sent', wa_message_id: 'wamid.same' }), okWith('wamid.same').bind(null, '', {}));
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.same' });
    expect(errorLog()).toContainEqual([expect.any(String), expect.objectContaining({ conflicting_ids: false })]);
  });

  it.each([
    ['a timeout (catch path)', () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }],
    ['an id-less acceptance', async () => ({ ok: true, status: 200, json: async () => ({}) })],
    ['an ambiguous 503', async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['a definite 400 refusal', async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131008, message: 'bad' } }) })],
  ])('evidence attached (sent, X) mid-call, then %s -> the row KEEPS sent X (never failed, never retried)', async (_l, answer) => {
    seed();
    provider = answerAfter(() => Object.assign(rec(), { status: 'sent', wa_message_id: 'wamid.X' }), answer as () => Promise<unknown>);
    await processBatch('b1', [R1]);
    expect(rec()).toMatchObject({ status: 'sent', wa_message_id: 'wamid.X' });
    expect(errorLog()).toContainEqual([expect.stringContaining('the row moved while this worker held it'), expect.objectContaining({ recipient_id: R1 })]);
    await retryFailed('b1');
    expect(sends).toHaveLength(1); // nothing re-queued
  });

  it('NEGATIVE CONTROL: an untouched row resolves normally on every outcome, and no "moved" ERROR is logged', async () => {
    seed([recipient(R1, PHONE1), recipient(R2, PHONE2)]);
    let n = 0;
    provider = async () => (n++ === 0
      ? { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) }
      : { ok: false, status: 400, json: async () => ({ error: { code: 131008, message: 'bad' } }) });
    await processBatch('b1', [R1, R2]);
    expect(rec(R1)).toMatchObject({ status: 'sent', wa_message_id: 'wamid.ok' });
    expect(rec(R2)).toMatchObject({ status: 'failed', error_code: 131008 });
    expect(errorLog().filter(([m]) => /moved while|another path/.test(String(m)))).toHaveLength(0);
  });
});

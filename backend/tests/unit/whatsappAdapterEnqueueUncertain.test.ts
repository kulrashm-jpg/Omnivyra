/**
 * RUL-C (owner ruling 2026-11-09): a WhatsApp batch whose queue acknowledgement was lost AND
 * whose recipients the engine could not withdraw is `uncertain`: never `failed` (which reads
 * as "refused; nothing went out") and never `submitted`. It is never resubmitted on its own.
 *
 * Handoff: docs/orchestration/OUTREACH-IMPLEMENTATION-HANDOFF-20261109.md §1.3 (C-1..C-9).
 *
 * REAL: the Orchestration adapter, and the engine it drives (createBroadcast,
 * expandPersonRecipients, enqueueBroadcast, processBatch, retryFailed) on the fake database
 * (helpers/fakeWhatsappDb.ts). The request ledger is an in-test double that keeps the
 * guard of migration 20261230000000: a settled request (completed, skipped, failed,
 * uncertain) never moves, and `external_ref` is set once. The queue is a recording fake and
 * the provider a `fetch` double: no Meta call, no Redis, no send.
 *
 * NOT covered here (see the completion report): reconciliation of a settled `uncertain`
 * request from later evidence (C-5, C-6) and an operator resolution path. The ledger guard
 * forbids moving a settled request, so neither exists without a schema change.
 */
// The engine hashes each recipient number with this salt; a test value, read at call time.
process.env.PHONE_HASH_SALT = 'rulc-test-salt';

let mockEnqueue: (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => Promise<unknown>;
const mockCheckAndConsume = jest.fn(async () => ({ allowed: true, tier: 'TIER_1', remaining: 1000 }));

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
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));
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
  WhatsAppEnqueueUncertainError,
  enqueueBroadcast,
  processBatch,
  retryFailed,
} from '../../services/whatsappBroadcastService';
import {
  ENQUEUE_UNCERTAIN_DETAIL,
  STALE_SUBMISSION_MS,
  WHATSAPP_ENQUEUE_UNCERTAIN_CODE,
  broadcastNameFor,
  createWhatsAppAdapter,
  defaultWhatsAppDeps,
  type WhatsAppAdapterDeps,
} from '../../services/orchestration/whatsappEngineAdapter';
import { normalizeEngineResult } from '../../services/orchestration/executionContract';
import type { EngineResult, EngineStepContext } from '../../services/orchestration/engineAdapters';

const ORG = 'co-a';
const TASK = '0b000000-0000-4000-8000-000000000001';
const PHONE = '+15550100001';
const T0 = '2026-11-09T10:00:00.000Z';

// ── The request ledger, keeping the migration's guard ─────────────────────────
type State = 'requested' | 'submitting' | 'submitted' | 'completed' | 'skipped' | 'failed' | 'uncertain';
interface Req { id: string; state: State; external_ref: string | null; detail: string | null; updated_at: string }
const SETTLED: readonly State[] = ['completed', 'skipped', 'failed', 'uncertain'];
let ledger: Map<string, Req>;
let clock: string;
/** Every write the ledger accepted, in order. */
let ledgerWrites: Array<{ from: State; to: State }>;

const ledgerDeps: Pick<WhatsAppAdapterDeps, 'getOrCreateRequest' | 'transitionRequest'> = {
  async getOrCreateRequest(org, task) {
    const key = `${org}|${task}`;
    let r = ledger.get(key);
    if (!r) {
      r = { id: `req-${ledger.size + 1}`, state: 'requested', external_ref: null, detail: null, updated_at: clock };
      ledger.set(key, r);
    }
    return { ...r };
  },
  async transitionRequest(org, task, from, patch) {
    const r = ledger.get(`${org}|${task}`);
    if (!r || r.state !== from) return false;                                         // compare-and-set
    if (SETTLED.includes(r.state) && patch.state !== r.state) return false;           // a settled request does not move
    if (r.external_ref !== null && patch.external_ref !== undefined && patch.external_ref !== r.external_ref) return false;
    if ((patch.state === 'submitted' || patch.state === 'completed') && (patch.external_ref ?? r.external_ref) === null) return false;
    Object.assign(r, patch, { updated_at: clock });
    ledgerWrites.push({ from, to: patch.state });
    return true;
  },
};
const req = (): Req => ledger.get(`${ORG}|${TASK}`)!;

// ── The engine's world ───────────────────────────────────────────────────────
const seed = () => {
  resetFakeDb({
    whatsapp_broadcasts: [],
    whatsapp_broadcast_recipients: [],
    social_accounts: [{ id: 'sa1', company_id: ORG, platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
    outreach_governance_config: [{ company_id: ORG, enabled: true, kill_switch: false, enabled_channels: ['whatsapp'] }],
    contact_governance_records: [],
    engagement_threads: [],
    engagement_messages: [],
    whatsapp_provider_events: [],
  });
};
const broadcasts = (): Row[] => fakeDb.tables.whatsapp_broadcasts;
const recipients = (): Row[] => fakeDb.tables.whatsapp_broadcast_recipients;

/** Every queue add attempted (stored or not), and the jobs the queue really kept. */
let queueAdds: Array<{ jobId: string; ids: string[] }>;
let keptJobs: Array<{ broadcastId: string; ids: string[] }>;
const sends: string[] = [];

/** The queue stored the job but its acknowledgement was lost. */
const lostAckStored = async (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => {
  queueAdds.push({ jobId: opts.jobId, ids: data.recipient_ids });
  keptJobs.push({ broadcastId: data.broadcast_id, ids: data.recipient_ids });
  throw new Error('Connection is closed.');
};
/** As above, and the engine cannot write the withdrawal either: WhatsAppEnqueueUncertainError. */
const lostAckStoredWithdrawalFails = async (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => {
  failNext('whatsapp_broadcast_recipients', 'update');
  return lostAckStored(data, opts);
};
/** The queue lost the add entirely (nothing stored), and the withdrawal cannot be written. */
const lostAckNothingStoredWithdrawalFails = async (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => {
  queueAdds.push({ jobId: opts.jobId, ids: data.recipient_ids });
  failNext('whatsapp_broadcast_recipients', 'update');
  throw new Error('Connection is closed.');
};
/** A healthy queue: the job is kept, the add acknowledged. */
const healthy = async (data: { broadcast_id: string; recipient_ids: string[] }, opts: { jobId: string }) => {
  queueAdds.push({ jobId: opts.jobId, ids: data.recipient_ids });
  keptJobs.push({ broadcastId: data.broadcast_id, ids: data.recipient_ids });
  return { id: opts.jobId };
};
/** The worker runs every job the queue kept (and a BullMQ retry would run it again). */
const runKeptJobs = async () => { for (const j of keptJobs) await processBatch(j.broadcastId, j.ids); };

const deps = (over: Partial<WhatsAppAdapterDeps> = {}): WhatsAppAdapterDeps => ({
  ...defaultWhatsAppDeps,           // the REAL engine calls and broadcast/recipient reads
  ...ledgerDeps,
  readPersonPhone: async () => PHONE,
  findWhatsAppAccount: async () => ({ id: 'sa1' }),
  hasApproval: async () => true,    // approval is not what this suite tests
  channelRefusal: async () => null,
  ...over,
});
const ctx = (over: Partial<EngineStepContext> = {}): EngineStepContext => ({
  organizationId: ORG,
  executionInstanceId: 'inst-1',
  executionTaskId: TASK,
  planStepId: 'step-1',
  channel: 'whatsapp',
  subject: { kind: 'prospect', id: 'p-1' } as never,
  step: { key: 'wa-intro', channel: 'whatsapp', delay_after_previous_hours: 0, whatsapp: { template_name: 'tpl' } } as never,
  personId: 'person-1',
  now: clock,
  ...over,
});
const run = (over: Partial<WhatsAppAdapterDeps> = {}, c: Partial<EngineStepContext> = {}): Promise<EngineResult> =>
  createWhatsAppAdapter(deps(over)).execute(ctx(c));
const later = (ms: number) => { clock = new Date(Date.parse(clock) + ms).toISOString(); };

beforeEach(() => {
  seed();
  ledger = new Map();
  ledgerWrites = [];
  clock = T0;
  queueAdds = [];
  keptJobs = [];
  sends.length = 0;
  mockCheckAndConsume.mockClear();
  mockCheckAndConsume.mockImplementation(async () => ({ allowed: true, tier: 'TIER_1', remaining: 1000 }));
  mockEnqueue = healthy;
  (global as any).fetch = async (_url: string, init: any) => {
    sends.push(JSON.parse(init.body).to);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${sends.length}` }] }) };
  };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('RUL-C: queue acceptance that cannot be confirmed is uncertain', () => {
  it('C-1: lost acknowledgement + withdrawal cannot be written → uncertain, needs_human; not failed, not submitted', async () => {
    mockEnqueue = lostAckStoredWithdrawalFails;
    const r = await run();

    const bc = String(broadcasts()[0].id);
    expect(r).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', reason: ENQUEUE_UNCERTAIN_DETAIL, externalRef: bc });
    expect(req()).toMatchObject({ state: 'uncertain', external_ref: bc, detail: ENQUEUE_UNCERTAIN_DETAIL });
    expect(req().state).not.toBe('failed');
    expect(req().state).not.toBe('submitted');
    expect(ledgerWrites).toEqual([{ from: 'requested', to: 'submitting' }, { from: 'submitting', to: 'uncertain' }]);

    // The shared contract reads it as "may have acted", for a person; never FAILED.
    const n = normalizeEngineResult(r);
    expect(n).toMatchObject({ certainty: 'uncertain', errorClass: 'may_have_acted', retryability: 'human_only' });
    expect(n.state).not.toBe('FAILED');

    // The batch's recipients were NOT withdrawn: the kept job may still send them (once).
    expect(recipients().map((x) => x.status)).toEqual(['pending']);
    // The detail is a fixed code-level summary: no raw database text, no number.
    expect(req().detail).not.toMatch(/fake failure|08006|\d{6,}/);
  });

  it('C-1b: the uncertain settlement itself cannot be written → the stale-claim path still ends uncertain, never a second batch', async () => {
    mockEnqueue = lostAckStoredWithdrawalFails;
    const dropUncertainWrite: WhatsAppAdapterDeps['transitionRequest'] = async (o, t, from, patch) =>
      (patch.state === 'uncertain' ? false : ledgerDeps.transitionRequest(o, t, from, patch));
    const first = await run({ transitionRequest: dropUncertainWrite });
    expect(first).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
    expect(req().state).toBe('submitting');

    mockEnqueue = healthy;
    later(STALE_SUBMISSION_MS + 1000);
    const r = await run({}, { now: clock });
    expect(r).toMatchObject({ outcome: 'submission_interrupted', disposition: 'needs_human' });
    expect(req().state).toBe('uncertain');
    expect(broadcasts()).toHaveLength(1);
    expect(queueAdds).toHaveLength(1);
  });

  it('C-2: lost acknowledgement + withdrawal succeeds → stays failed (nothing of it can be sent), as before', async () => {
    mockEnqueue = lostAckStored;
    const r = await run();
    expect(r).toMatchObject({ outcome: 'submit_failed', disposition: 'needs_human', reason: 'Connection is closed.' });
    expect(req().state).toBe('failed');
    expect(queueAdds).toHaveLength(1);
    expect(normalizeEngineResult(r)).toMatchObject({ state: 'FAILED', certainty: 'definite', errorClass: 'provider_rejected' });
    expect(recipients()[0]).toMatchObject({ status: 'failed', error_message: ENQUEUE_UNCONFIRMED_MESSAGE });
    // The job the queue did keep runs and sends nothing: the withdrawal won.
    await runKeptJobs();
    expect(sends).toHaveLength(0);
  });

  it('confirmed acceptance is submitted, never uncertain; a send then completes the step', async () => {
    const r = await run();
    expect(r).toMatchObject({ outcome: 'submitted', disposition: 'wait' });
    expect(req().state).toBe('submitted');
    await runKeptJobs();
    expect(sends).toEqual([PHONE]);
    const done = await run();
    expect(done).toMatchObject({ outcome: 'sent', disposition: 'completed' });
    expect(req().state).toBe('completed');
  });

  it('confirmed non-acceptance (the rate limit refuses before any job) is failed, not uncertain', async () => {
    mockCheckAndConsume.mockImplementation(async () => ({ allowed: false, tier: 'TIER_1', remaining: 0 }));
    const r = await run();
    expect(r).toMatchObject({ outcome: 'submit_failed', disposition: 'needs_human' });
    expect(r.reason).toMatch(/^Rate limit exceeded/);
    expect(req().state).toBe('failed');
    expect(queueAdds).toHaveLength(0);
  });
});

describe('RUL-C: an uncertain batch is never sent twice, on any path', () => {
  const uncertain = async () => {
    mockEnqueue = lostAckStoredWithdrawalFails;
    await run();
    expect(req().state).toBe('uncertain');
    mockEnqueue = healthy;      // the queue recovers: any resubmission would now succeed
    return String(broadcasts()[0].id);
  };

  it('C-3: sweeps and retries over an uncertain request never create, enqueue or re-queue anything', async () => {
    const bc = await uncertain();
    for (const wait of [0, 60_000, STALE_SUBMISSION_MS + 1000, 24 * 3600 * 1000]) {
      later(wait);
      const r = await run({}, { now: clock });
      expect(r).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: bc });
    }
    expect(broadcasts()).toHaveLength(1);
    expect(recipients()).toHaveLength(1);
    expect(queueAdds).toHaveLength(1);                       // the original, lost-ack add only
    expect(ledgerWrites).toHaveLength(2);                    // requested→submitting→uncertain, nothing after
    // Nothing can put it back in play: a release to `requested` is refused by the guard.
    expect(await ledgerDeps.transitionRequest(ORG, TASK, 'uncertain', { state: 'requested' })).toBe(false);
  });

  it('C-3: the job the queue kept sends exactly once, through its retries, retryFailed and a manual re-enqueue', async () => {
    const bc = await uncertain();
    await runKeptJobs();
    await runKeptJobs();                                     // a BullMQ retry of the same job
    expect(sends).toEqual([PHONE]);
    await retryFailed(bc);                                   // operator ?action=retry: only `failed` rows
    await expect(enqueueBroadcast(bc, 'free')).rejects.toThrow('No pending recipients');   // operator ?action=enqueue
    await runKeptJobs();
    expect(sends).toEqual([PHONE]);
    expect(await run()).toMatchObject({ outcome: 'uncertain' });   // the request does not move to completed on its own
  });

  it('C-3: when the queue kept nothing, the recipients stay pending and unsent; retryFailed does not touch them', async () => {
    mockEnqueue = lostAckNothingStoredWithdrawalFails;
    await run();
    expect(req().state).toBe('uncertain');
    mockEnqueue = healthy;
    const bc = String(broadcasts()[0].id);
    await retryFailed(bc);
    await runKeptJobs();
    for (let i = 0; i < 3; i += 1) { later(STALE_SUBMISSION_MS + 1000); await run({}, { now: clock }); }
    expect(sends).toHaveLength(0);
    expect(recipients()[0].status).toBe('pending');
    expect(queueAdds).toHaveLength(1);
  });

  it('C-4: a re-run of the same task (a new adapter instance) adopts the one record; no second batch', async () => {
    const bc = await uncertain();
    expect(broadcasts()[0].name).toBe(broadcastNameFor(TASK));
    const again = await createWhatsAppAdapter(deps()).execute(ctx());
    expect(again).toMatchObject({ outcome: 'uncertain', externalRef: bc });
    expect(broadcasts()).toHaveLength(1);
    expect(queueAdds).toHaveLength(1);
  });

  it('C-7 (partial): with no reconciler, the request stays uncertain even after the recipient row shows a send', async () => {
    await uncertain();
    await runKeptJobs();
    expect(recipients()[0].status).toBe('sent');
    // Request-level reconciliation does not exist (C-5/C-6 are blocked by the ledger guard):
    // the step stays with a person, who sees the broadcast id and its recipient state.
    expect(await run()).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
    expect(req().state).toBe('uncertain');
  });
});

describe('RUL-C: only the engine\'s own signal is uncertain (C-9)', () => {
  const throwing = (e: unknown) => ({
    enqueueBroadcast: (async () => { throw e; }) as unknown as WhatsAppAdapterDeps['enqueueBroadcast'],
  });
  const lookalikeMessage = new WhatsAppEnqueueUncertainError('bc-x', 'detail').message;

  it('the adapter matches the engine\'s code', () => {
    expect(WHATSAPP_ENQUEUE_UNCERTAIN_CODE).toBe(new WhatsAppEnqueueUncertainError('b', 'd').code);
  });

  it('the class with its code → uncertain', async () => {
    expect(await run(throwing(new WhatsAppEnqueueUncertainError('bc-x', 'down')))).toMatchObject({ outcome: 'uncertain' });
  });

  it.each([
    ['a plain Error carrying the same message', () => new Error(lookalikeMessage)],
    ['a plain Error carrying the code', () => Object.assign(new Error('x'), { code: WHATSAPP_ENQUEUE_UNCERTAIN_CODE })],
    ['the class with its code altered', () => Object.defineProperty(new WhatsAppEnqueueUncertainError('bc-x', 'down'), 'code', { value: 'other' })],
    ['a plain object shaped like it', () => ({ name: 'WhatsAppEnqueueUncertainError', code: WHATSAPP_ENQUEUE_UNCERTAIN_CODE, message: lookalikeMessage })],
  ])('%s → failed, not uncertain', async (_label, make) => {
    const thrown = make();
    const r = await run(throwing(thrown));
    expect(r).toMatchObject({ outcome: 'submit_failed', disposition: 'needs_human', reason: String((thrown as { message: string }).message).slice(0, 200) });
    expect(recipients()).toHaveLength(1);       // it reached enqueue: the classification is what is tested
    expect(req().state).toBe('failed');
  });
});

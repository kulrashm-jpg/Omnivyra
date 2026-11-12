/**
 * Follow-up A to Work Item 2 (L-4) — the unconfirmed-send sweep, unit level.
 *
 * Proven here (the SQL functions, constraints and races are proven on real PostgreSQL in
 * realschema/whatsapp_unconfirmed_sweep_real.test.ts):
 *   - foldDeliveryEvidence applies provider events with the webhook's forward-only rule;
 *   - the threshold and page size are validated, and a bad value refuses instead of widening;
 *   - the webhook job names the recipient in the ledger ONLY when marker and number match,
 *     and writes nothing when the check cannot read the recipient;
 *   - the sweep never calls the provider, never writes `failed` without an event, writes the
 *     N-2 restriction before attaching, and isolates one row's failure from the rest.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
const mockRpc = jest.fn();
const mockRestrict = jest.fn(async () => undefined);

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
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
jest.mock('../../middleware/queueBackpressure', () => ({ enqueueOrThrow: async () => { throw new Error('the sweep never queues'); } }));
jest.mock('../../services/whatsappBroadcastService', () => ({
  ...jest.requireActual('../../services/whatsappBroadcastService'),
  recordInvalidContact: (...a: unknown[]) => (mockRestrict as any)(...a),
}));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { foldDeliveryEvidence } from '../../services/whatsappBroadcastService';
import {
  WHATSAPP_UNCONFIRMED_DEFAULT_BATCH,
  WHATSAPP_UNCONFIRMED_DEFAULT_STALE_MS,
  resolveSweepConfig,
  sweepUnconfirmedWhatsAppSends,
} from '../../services/whatsappUnconfirmedSendSweep';
import { processWhatsAppWebhookJob } from '../../queue/jobProcessors/whatsappWebhookProcessor';

const ORG = '0b000000-0000-4000-8000-0000000000aa';
const R1 = '0a000000-0000-4000-8000-000000000001';
const R2 = '0a000000-0000-4000-8000-000000000002';
const PHONE1 = '+15550100001';

const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const ev = (status: string, at: string, over: Row = {}): Row =>
  ({ id: `ev-${status}-${at}`, wa_message_id: 'wamid.1', event_status: status, event_at: at, error_code: null, error_title: null, ...over });

let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  (global as any).fetch = async () => { fetchCalls += 1; throw new Error('no provider in this suite'); };
  mockRpc.mockReset();
  mockRestrict.mockClear();
  delete process.env.WHATSAPP_UNCONFIRMED_STALE_AFTER_MS;
  delete process.env.WHATSAPP_UNCONFIRMED_SWEEP_BATCH;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); expect(fetchCalls).toBe(0); });

describe('foldDeliveryEvidence (the webhook rule, applied to stored events)', () => {
  it('sent then delivered then read ends read, with each timestamp', () => {
    const out = foldDeliveryEvidence([
      { status: 'read', event_at: '2026-11-09T10:03:00.000Z' },
      { status: 'sent', event_at: '2026-11-09T10:01:00.000Z' },
      { status: 'delivered', event_at: '2026-11-09T10:02:00.000Z' },
    ]);
    expect(out).toMatchObject({ status: 'read', sent_at: '2026-11-09T10:01:00.000Z', delivered_at: '2026-11-09T10:02:00.000Z', read_at: '2026-11-09T10:03:00.000Z', permanentFailureCode: null });
  });
  it('a failed after delivered never goes backwards', () => {
    expect(foldDeliveryEvidence([
      { status: 'delivered', event_at: '2026-11-09T10:02:00.000Z' },
      { status: 'failed', event_at: '2026-11-09T10:05:00.000Z', error_code: 131026 },
    ])).toMatchObject({ status: 'delivered', permanentFailureCode: null, error_code: null });
  });
  it('a permanent failure is reported for the N-2 restriction; a transient one is not', () => {
    expect(foldDeliveryEvidence([{ status: 'failed', event_at: 't1', error_code: 131026, error_title: 'Message undeliverable' }]))
      .toMatchObject({ status: 'failed', error_code: 131026, error_message: 'Message undeliverable', permanentFailureCode: 131026 });
    expect(foldDeliveryEvidence([{ status: 'failed', event_at: 't1', error_code: 131047 }]))
      .toMatchObject({ status: 'failed', permanentFailureCode: null });
  });
  it('events with the same second apply in forward order', () => {
    expect(foldDeliveryEvidence([
      { status: 'delivered', event_at: 't1' }, { status: 'sent', event_at: 't1' }, { status: 'failed', event_at: 't1' },
    ]).status).toBe('delivered');
  });
});

describe('configuration refuses instead of widening', () => {
  it('defaults: 30 minutes, 100 rows', () => {
    expect(resolveSweepConfig({})).toEqual({ staleAfterMs: WHATSAPP_UNCONFIRMED_DEFAULT_STALE_MS, batchSize: WHATSAPP_UNCONFIRMED_DEFAULT_BATCH });
  });
  it('environment overrides, validated', () => {
    process.env.WHATSAPP_UNCONFIRMED_STALE_AFTER_MS = '3600000';
    process.env.WHATSAPP_UNCONFIRMED_SWEEP_BATCH = '25';
    expect(resolveSweepConfig({})).toEqual({ staleAfterMs: 3_600_000, batchSize: 25 });
    process.env.WHATSAPP_UNCONFIRMED_STALE_AFTER_MS = 'soon';
    expect(() => resolveSweepConfig({})).toThrow(/must be a number/);
  });
  it.each([[{ staleAfterMs: 299_999 }, /floor/], [{ staleAfterMs: Number.NaN }, /floor/], [{ batchSize: 0 }, /batchSize/], [{ batchSize: 501 }, /batchSize/], [{ batchSize: 2.5 }, /batchSize/]])(
    'refuses %p', (opts, msg) => { expect(() => resolveSweepConfig(opts as any)).toThrow(msg); });
  it('a sweep without a tenant reads nothing', async () => {
    await expect(sweepUnconfirmedWhatsAppSends({ companyId: '' })).rejects.toThrow(/tenant/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('the webhook job names the recipient in the ledger only when verified', () => {
  const job = (over: Row) => ({
    data: { payload: { entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.w', status: 'sent', timestamp: '1762600000', ...over }] } }] }] } },
  }) as any;
  const seed = () => resetFakeDb({
    whatsapp_broadcast_recipients: [{ id: R1, broadcast_id: 'b1', encrypted_phone: encrypt(PHONE1), status: 'send_uncertain', wa_message_id: null }],
    whatsapp_provider_events: [],
  });

  it('marker + same number: verified_recipient_id is the recipient', async () => {
    seed();
    await processWhatsAppWebhookJob(job({ biz_opaque_callback_data: R1, recipient_id: '15550100001' }));
    expect(fakeDb.tables.whatsapp_provider_events).toEqual([expect.objectContaining({ wa_message_id: 'wamid.w', verified_recipient_id: R1 })]);
  });
  it('marker + another number, or no marker: the event is kept without a recipient', async () => {
    seed();
    await processWhatsAppWebhookJob(job({ biz_opaque_callback_data: R1, recipient_id: '15550109999' }));
    await processWhatsAppWebhookJob(job({ id: 'wamid.n' }));
    expect(fakeDb.tables.whatsapp_provider_events).toHaveLength(2);
    for (const e of fakeDb.tables.whatsapp_provider_events) expect(e).not.toHaveProperty('verified_recipient_id');
  });
  it('the check cannot read the recipient: nothing is written and the job fails (retried)', async () => {
    seed();
    failNext('whatsapp_broadcast_recipients', 'select');
    await expect(processWhatsAppWebhookJob(job({ biz_opaque_callback_data: R1, recipient_id: '15550100001' }))).rejects.toThrow();
    expect(fakeDb.tables.whatsapp_provider_events).toEqual([]);
  });
});

const CLAIMED = '2026-11-09T09:59:30.000Z';

describe('the sweep (scripted database functions)', () => {
  // stale_since is the current claim's send_started_at (the RPC's COALESCE), before every event here.
  type Cand = { recipient_id: string; broadcast_id: string; status: string; stale_since?: string };
  /** The four functions, scripted. `attach`/`mark`/`flag` answer as the SQL would. */
  function script(cands: Cand[], answers: Partial<Record<string, (args: Row) => unknown>> = {}) {
    mockRpc.mockImplementation(async (fn: string, args: Row) => {
      if (fn === 'whatsapp_unconfirmed_sends') return { data: cands, error: null };
      const a = answers[fn];
      if (a) {
        const v = a(args);
        return v instanceof Error ? { data: null, error: { message: v.message } } : { data: v, error: null };
      }
      return { data: true, error: null };
    });
  }
  const calls = (fn: string) => mockRpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1] as Row);

  it('no evidence, send_uncertain: flagged only; never attached, never marked, never failed', async () => {
    resetFakeDb({ whatsapp_provider_events: [], whatsapp_broadcast_recipients: [{ id: R1, broadcast_id: 'b1', status: 'send_uncertain', wa_message_id: null }] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    // The sweep writes recipient state only through the database functions: no direct update.
    expect(fakeDb.calls.filter((c) => c.startsWith('whatsapp_broadcast_recipients:') && c !== 'whatsapp_broadcast_recipients:select')).toEqual([]);
    expect(fakeDb.tables.whatsapp_broadcast_recipients[0]).toMatchObject({ status: 'send_uncertain', wa_message_id: null });
    expect(out).toMatchObject({ examined: 1, attached: 0, markedUncertain: 0, flaggedForReview: 1, errors: [] });
    expect(calls('whatsapp_attach_unconfirmed_send')).toEqual([]);
    expect(calls('whatsapp_mark_stale_send_uncertain')).toEqual([]);
    expect(calls('whatsapp_flag_unconfirmed_send')).toEqual([expect.objectContaining({ p_company_id: ORG, p_recipient_id: R1, p_outcome: 'awaiting_operator_review' })]);
  });

  it('no evidence, sending: marked uncertain with the same cutoff, then flagged', async () => {
    resetFakeDb({ whatsapp_provider_events: [] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'sending', stale_since: CLAIMED }]);
    const now = new Date('2026-11-09T12:00:00.000Z');
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG, now });
    expect(out).toMatchObject({ markedUncertain: 1, flaggedForReview: 1 });
    expect(calls('whatsapp_mark_stale_send_uncertain')[0]).toMatchObject({ p_cutoff: '2026-11-09T11:30:00.000Z', p_company_id: ORG });
    expect(calls('whatsapp_unconfirmed_sends')[0]).toMatchObject({ p_cutoff: '2026-11-09T11:30:00.000Z', p_limit: 100 });
  });

  it('evidence: attached with the folded state and every event id; one run id throughout', async () => {
    resetFakeDb({ whatsapp_provider_events: [
      { ...ev('sent', '2026-11-09T10:00:00.000Z'), verified_recipient_id: R1 },
      { ...ev('delivered', '2026-11-09T10:01:00.000Z'), verified_recipient_id: R1 },
      { ...ev('read', '2026-11-09T10:02:00.000Z'), verified_recipient_id: R2 },
    ] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(out).toMatchObject({ attached: 1, flaggedForReview: 0 });
    const [a] = calls('whatsapp_attach_unconfirmed_send');
    expect(a).toMatchObject({
      p_company_id: ORG, p_recipient_id: R1, p_wa_message_id: 'wamid.1', p_status: 'delivered',
      p_delivered_at: '2026-11-09T10:01:00.000Z', p_read_at: null, p_sweep_run_id: out.runId,
      p_evidence_event_ids: ['ev-sent-2026-11-09T10:00:00.000Z', 'ev-delivered-2026-11-09T10:01:00.000Z'],
    });
    expect(mockRestrict).not.toHaveBeenCalled();
  });

  it('a permanent failure writes the restriction BEFORE the attach; a failed attach leaves the row for the next run', async () => {
    resetFakeDb({
      whatsapp_provider_events: [{ ...ev('failed', '2026-11-09T10:00:00.000Z', { error_code: 131026 }), verified_recipient_id: R1 }],
      whatsapp_broadcast_recipients: [{ id: R1, broadcast_id: 'b1', encrypted_phone: 'enc-1', status: 'send_uncertain' }],
    });
    const order: string[] = [];
    mockRestrict.mockImplementation(async () => { order.push('restrict'); });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }], {
      whatsapp_attach_unconfirmed_send: () => { order.push('attach'); return new Error('connection reset'); },
    });
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(order).toEqual(['restrict', 'attach']);
    expect(mockRestrict).toHaveBeenCalledWith(ORG, 'enc-1', 'wamid.1', 131026, R1);
    expect(out).toMatchObject({ attached: 0, errors: [{ recipientId: R1, code: 'rpc_failed' }] });
  });

  it('CLASS-2: evidence OLDER than the current claim (an earlier, retried message) is ignored - not attached, not a conflict', async () => {
    resetFakeDb({ whatsapp_provider_events: [
      { ...ev('failed', '2026-11-09T09:00:00.000Z', { wa_message_id: 'wamid.old' }), verified_recipient_id: R1 },
    ] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'sending', stale_since: CLAIMED }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG, now: new Date('2026-11-09T12:00:00.000Z') });
    expect(calls('whatsapp_attach_unconfirmed_send')).toEqual([]);
    expect(out).toMatchObject({ attached: 0, conflicting: 0, markedUncertain: 1, flaggedForReview: 1 });
  });

  it('CLASS-2: old and current evidence together: only the current message is attached', async () => {
    resetFakeDb({ whatsapp_provider_events: [
      { ...ev('failed', '2026-11-09T09:00:00.000Z', { wa_message_id: 'wamid.old' }), verified_recipient_id: R1 },
      { ...ev('sent', '2026-11-09T10:00:00.000Z'), verified_recipient_id: R1 },
    ] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(out).toMatchObject({ attached: 1, conflicting: 0 });
    expect(calls('whatsapp_attach_unconfirmed_send')[0]).toMatchObject({ p_wa_message_id: 'wamid.1' });
  });

  it('a candidate whose send time is unknown is refused by name, never swept on all evidence', async () => {
    resetFakeDb({ whatsapp_provider_events: [{ ...ev('sent', '2026-11-09T10:00:00.000Z'), verified_recipient_id: R1 }] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain' }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(calls('whatsapp_attach_unconfirmed_send')).toEqual([]);
    expect(out.errors).toEqual([expect.objectContaining({ recipientId: R1, code: 'send_time_unknown' })]);
  });

  it('two message ids for one recipient: no attach; conflict and review flags', async () => {
    resetFakeDb({ whatsapp_provider_events: [
      { ...ev('sent', '2026-11-09T10:00:00.000Z'), verified_recipient_id: R1 },
      { ...ev('sent', '2026-11-09T10:00:05.000Z', { id: 'ev-x', wa_message_id: 'wamid.2' }), verified_recipient_id: R1 },
    ] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }]);
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(out).toMatchObject({ attached: 0, conflicting: 1, flaggedForReview: 1 });
    expect(calls('whatsapp_attach_unconfirmed_send')).toEqual([]);
    expect(calls('whatsapp_flag_unconfirmed_send').map((a) => a.p_outcome)).toEqual(['conflicting_provider_evidence', 'awaiting_operator_review']);
  });

  it('one unreadable row does not stop the page; a row resolved meanwhile is counted, not retried', async () => {
    resetFakeDb({ whatsapp_provider_events: [{ ...ev('sent', '2026-11-09T10:00:00.000Z'), verified_recipient_id: R2 }] });
    failNext('whatsapp_provider_events', 'select');
    script([
      { recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED },
      { recipient_id: R2, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED },
    ], { whatsapp_attach_unconfirmed_send: () => false });
    const out = await sweepUnconfirmedWhatsAppSends({ companyId: ORG });
    expect(out).toMatchObject({ examined: 2, alreadyResolved: 1, errors: [{ recipientId: R1, code: 'evidence_unreadable' }] });
  });

  it('only a literal true counts (a row-shaped answer, as the transport returns it, is unwrapped)', async () => {
    resetFakeDb({ whatsapp_provider_events: [] });
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }], {
      whatsapp_flag_unconfirmed_send: () => [{ whatsapp_flag_unconfirmed_send: false }],
    });
    expect((await sweepUnconfirmedWhatsAppSends({ companyId: ORG })).flaggedForReview).toBe(0);
    script([{ recipient_id: R1, broadcast_id: 'b1', status: 'send_uncertain', stale_since: CLAIMED }], { whatsapp_flag_unconfirmed_send: () => 'true' });
    expect((await sweepUnconfirmedWhatsAppSends({ companyId: ORG })).flaggedForReview).toBe(0);
  });
});

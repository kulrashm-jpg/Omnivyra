/**
 * WA-13 — enqueueBroadcast paged `pending` recipients by OFFSET, unordered, while the
 * batches it had just queued (batch 0 has no delay) were moving rows out of `pending`.
 * The set shrank under the offset and recipients were never queued.
 *
 * Real enqueueBroadcast on a fake database (helpers/fakeWhatsappDb.ts); the queue is a
 * recording fake that, like a free worker, completes each batch as soon as it is queued.
 */

const mockBatches: Array<{ ids: string[]; jobId: string; delay: number }> = [];

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) } }));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}) }));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: async () => ({ allowed: true, tier: 'TIER_1' }),
  getBroadcastChunkStrategy: () => ({ batch_size: 2, delay_ms: 1000 }),
}));
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { recipient_ids: string[] }, opts: { jobId: string; delay: number }) => {
    mockBatches.push({ ids: data.recipient_ids, jobId: opts.jobId, delay: opts.delay });
    const { fakeDb } = require('../helpers/fakeWhatsappDb');
    for (const r of fakeDb.tables.whatsapp_broadcast_recipients) {
      if (data.recipient_ids.includes(r.id)) r.status = 'sent';
    }
    return { id: opts.jobId };
  },
}));

import { fakeDb, failNext, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { enqueueBroadcast } from '../../services/whatsappBroadcastService';

const seed = (ids: string[], over: Record<string, unknown> = {}) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: 'co-a', social_account_id: 'sa-1', message_type: 'template', template_name: 'hello', status: 'draft' }],
  whatsapp_broadcast_recipients: ids.map((id) => ({ id, broadcast_id: 'b1', status: 'pending', ...over })),
});
const queued = () => mockBatches.flatMap((b) => b.ids);

beforeEach(() => { mockBatches.length = 0; });

describe('enqueueBroadcast', () => {
  it('queues every pending recipient once, however fast the first batches complete', async () => {
    seed(['r1', 'r2', 'r3', 'r4', 'r5']);
    await enqueueBroadcast('b1', 'free');
    expect([...queued()].sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(queued()).toHaveLength(5);
  });

  it('batches are deterministic: the same recipients in the same order for the same set', async () => {
    seed(['r5', 'r3', 'r1', 'r4', 'r2']);
    await enqueueBroadcast('b1', 'free');
    expect(mockBatches.map((b) => b.ids)).toEqual([['r1', 'r2'], ['r3', 'r4'], ['r5']]);
    expect(mockBatches.map((b) => b.jobId)).toEqual(['wa-batch-b1-0', 'wa-batch-b1-1', 'wa-batch-b1-2']);
    expect(mockBatches.map((b) => b.delay)).toEqual([0, 1000, 2000]);
  });

  it('reads past a single page of the row limit', async () => {
    const ids = Array.from({ length: 2_300 }, (_, i) => `r${String(i).padStart(5, '0')}`);
    seed(ids);
    await enqueueBroadcast('b1', 'free');
    expect(queued()).toHaveLength(2_300);
    expect(new Set(queued()).size).toBe(2_300);
  });

  it('only pending recipients of this broadcast', async () => {
    seed(['r1', 'r2']);
    fakeDb.tables.whatsapp_broadcast_recipients.push(
      { id: 'r3', broadcast_id: 'b1', status: 'sent' },
      { id: 'r4', broadcast_id: 'other', status: 'pending' },
    );
    await enqueueBroadcast('b1', 'free');
    expect(queued()).toEqual(['r1', 'r2']);
  });

  it('a failed recipient read fails the enqueue rather than marking a partial broadcast running', async () => {
    seed(['r1', 'r2', 'r3']);
    failNext('whatsapp_broadcast_recipients', 'select', 1);   // the pending count reads first
    await expect(enqueueBroadcast('b1', 'free')).rejects.toThrow(/recipients unreadable/);
    expect(mockBatches).toHaveLength(0);
    expect(fakeDb.tables.whatsapp_broadcasts[0].status).toBe('draft');
  });
});

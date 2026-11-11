/**
 * WA-11 — a delivery webhook may only move a recipient forward, and a failed write is
 * reported instead of reading as "no such recipient".
 *
 * Real `updateRecipientDelivery` on a fake database (helpers/fakeWhatsappDb.ts).
 */

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../middleware/queueBackpressure', () => ({ enqueueOrThrow: jest.fn() }));
jest.mock('../../services/whatsappRateLimiter', () => ({ checkAndConsume: jest.fn(), getBroadcastChunkStrategy: jest.fn() }));

import { fakeDb, failNext, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { updateRecipientDelivery } from '../../services/whatsappBroadcastService';

const WAMID = 'wamid.1';
const row = () => fakeDb.tables.whatsapp_broadcast_recipients[0];
const seed = (status: string) => resetFakeDb({
  whatsapp_broadcast_recipients: [{ id: 'r1', broadcast_id: 'b1', wa_message_id: WAMID, status }],
});
const event = (status: 'sent' | 'delivered' | 'read' | 'failed') => updateRecipientDelivery({ wa_message_id: WAMID, status });

describe('updateRecipientDelivery moves forward only', () => {
  it.each([
    ['sent', 'delivered', 'delivered'],
    ['sent', 'read', 'read'],
    ['delivered', 'read', 'read'],
    ['sent', 'failed', 'failed'],
    // Evidence it arrived outranks an earlier failure, and stops `retryFailed` resending it.
    ['failed', 'delivered', 'delivered'],
    ['failed', 'read', 'read'],
  ] as const)('%s then %s is %s', async (from, incoming, expected) => {
    seed(from);
    await event(incoming);
    expect(row().status).toBe(expected);
  });

  it.each([
    ['delivered', 'sent'],
    ['read', 'sent'],
    ['failed', 'sent'],
    ['read', 'delivered'],
    // Would otherwise make a delivered message eligible for `retryFailed`: a duplicate.
    ['delivered', 'failed'],
    ['read', 'failed'],
    // A row mid-retry still carries the previous attempt's message id.
    ['pending', 'delivered'],
    ['sending', 'read'],
  ] as const)('%s stays when a late %s arrives', async (from, incoming) => {
    seed(from);
    await event(incoming);
    expect(row().status).toBe(from);
  });

  it('a replayed event changes nothing and is counted once', async () => {
    seed('sent');
    await event('delivered');
    const firstDeliveredAt = row().delivered_at;
    await event('delivered');
    expect(row().delivered_at).toBe(firstDeliveredAt);
    // One (debounced) recompute for the event that moved the row; the replay moved nothing
    // and triggers none. (A recompute could not over-count even if it were called again.)
    expect(fakeDb.rpcs).toEqual([{ fn: 'whatsapp_refresh_broadcast_counts', args: { p_broadcast_id: 'b1', p_min_interval_seconds: 30 } }]);
  });

  it('a late event leaves the failure detail alone', async () => {
    seed('delivered');
    await updateRecipientDelivery({ wa_message_id: WAMID, status: 'failed', error_code: 131026, error_message: 'undeliverable' });
    expect(row().error_code).toBeUndefined();
    expect(row().error_message).toBeUndefined();
  });
});

describe('updateRecipientDelivery reports a failed write', () => {
  it('throws, so the webhook job is retried, instead of dropping the update', async () => {
    seed('sent');
    failNext('whatsapp_broadcast_recipients', 'update');
    await expect(event('delivered')).rejects.toThrow(/delivery update failed/);
    expect(fakeDb.rpcs).toEqual([]);

    await event('delivered');
    expect(row().status).toBe('delivered');
  });

  it('a message that is not ours is not an error', async () => {
    seed('sent');
    await expect(updateRecipientDelivery({ wa_message_id: 'wamid.other', status: 'delivered' })).resolves.toBeUndefined();
    expect(row().status).toBe('sent');
  });

  it('two rows sharing a message id (no unique key on the chain) are both moved, without an error', async () => {
    resetFakeDb({ whatsapp_broadcast_recipients: [
      { id: 'r1', broadcast_id: 'b1', wa_message_id: WAMID, status: 'sent' },
      { id: 'r2', broadcast_id: 'b1', wa_message_id: WAMID, status: 'sent' },
    ] });
    await expect(event('read')).resolves.toBeUndefined();
    expect(fakeDb.tables.whatsapp_broadcast_recipients.map((r) => r.status)).toEqual(['read', 'read']);
  });

  it('the absent counter function is not treated as a failed delivery (B-11 is separate)', async () => {
    seed('sent');
    await expect(event('read')).resolves.toBeUndefined();
    expect(fakeDb.rpcs).toHaveLength(1);
    expect(row().status).toBe('read');
  });
});

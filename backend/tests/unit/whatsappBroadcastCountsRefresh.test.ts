/**
 * Broadcast counts are recomputed through whatsapp_refresh_broadcast_counts (C10,
 * 2026-11-11) - never through the increment RPCs that exist nowhere.
 *
 * Real processBatch / updateRecipientDelivery / refresh helpers on S's fake database; the
 * RPC is recorded by the fake (answered per test). The SQL itself is proven in
 * realschema/whatsapp_broadcast_counts_real.test.ts.
 */
import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');
let mockRpcAnswer: { data: unknown; error: { message: string } | null } = { data: 'refreshed', error: null };

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      require('../helpers/fakeWhatsappDb').fakeDb.rpcs.push({ fn, args });
      return mockRpcAnswer;
    },
  },
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({}), handleTemplateStatusWebhook: async () => undefined }));

import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import {
  WEBHOOK_COUNTS_MIN_INTERVAL_SECONDS,
  processBatch,
  refreshBroadcastCounts,
  refreshDirtyBroadcastCounts,
  updateRecipientDelivery,
} from '../../services/whatsappBroadcastService';

const R1 = '0c000000-0000-4000-8000-000000000001';
const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};
const seed = (status = 'pending', over: Record<string, unknown> = {}) => resetFakeDb({
  whatsapp_broadcasts: [{ id: 'b1', company_id: 'co-a', social_account_id: 'sa1', status: 'running', message_type: 'template', template_name: 'tpl', name: 'Launch' }],
  social_accounts: [{ id: 'sa1', company_id: 'co-a', platform: 'whatsapp', phone_number_id: 'pn1', is_active: true }],
  whatsapp_broadcast_recipients: [{ id: R1, broadcast_id: 'b1', encrypted_phone: encrypt('+15550100001'), status, retry_count: 0, wa_message_id: null, ...over }],
  contact_governance_records: [],
  whatsapp_provider_events: [],
});
const refreshCalls = () => fakeDb.rpcs.filter((r: { fn: string }) => r.fn === 'whatsapp_refresh_broadcast_counts');

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockRpcAnswer = { data: 'refreshed', error: null };
  (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('the counts are refreshed, never incremented', () => {
  it('batch end: ONE unconditional refresh (interval 0); no increment RPC anywhere', async () => {
    seed();
    await processBatch('b1', [R1]);
    expect(refreshCalls()).toEqual([{ fn: 'whatsapp_refresh_broadcast_counts', args: { p_broadcast_id: 'b1', p_min_interval_seconds: 0 } }]);
    expect(fakeDb.rpcs.some((r: { fn: string }) => r.fn.startsWith('increment_'))).toBe(false);
  });

  it('a delivery webhook that moves a row refreshes DEBOUNCED (the window)', async () => {
    seed('sent', { wa_message_id: 'wamid.1' });
    await updateRecipientDelivery({ wa_message_id: 'wamid.1', status: 'delivered' });
    expect(refreshCalls()).toEqual([{ fn: 'whatsapp_refresh_broadcast_counts', args: { p_broadcast_id: 'b1', p_min_interval_seconds: WEBHOOK_COUNTS_MIN_INTERVAL_SECONDS } }]);
  });

  it('a refresh ERROR is logged at ERROR and never fails the batch (the send already happened)', async () => {
    seed();
    mockRpcAnswer = { data: null, error: { message: 'function does not exist' } };
    await expect(processBatch('b1', [R1])).resolves.toBeUndefined();
    expect(fakeDb.tables.whatsapp_broadcast_recipients[0].status).toBe('sent');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('counts NOT refreshed'), expect.objectContaining({ broadcast_id: 'b1' }));
  });

  it.each([[null], [''], ['unexpected']])('NO ANSWER (%p) is reported as an error, not as refreshed', async (data) => {
    mockRpcAnswer = { data, error: null };
    expect(await refreshBroadcastCounts('b1')).toBe('error');
  });
});

describe('readers refresh DIRTY broadcasts before reading', () => {
  it('only the dirty ones are refreshed, unconditionally', async () => {
    resetFakeDb({});
    const n = await refreshDirtyBroadcastCounts([{ id: 'b1', counts_dirty: true }, { id: 'b2', counts_dirty: false }, { id: 'b3' }]);
    expect(n).toBe(1);
    expect(refreshCalls()).toEqual([{ fn: 'whatsapp_refresh_broadcast_counts', args: { p_broadcast_id: 'b1', p_min_interval_seconds: 0 } }]);
  });

  it('nothing dirty -> no refresh at all (dirty-only, not a control: it fails when readers refresh everything)', async () => {
    resetFakeDb({});
    expect(await refreshDirtyBroadcastCounts([{ id: 'b1', counts_dirty: false }])).toBe(0);
    expect(refreshCalls()).toEqual([]);
  });
});

/**
 * Collaboration receipts carry their company (6f; migration 20270217000035). message_reads / message_mentions key a
 * POLYMORPHIC message_id (activity / calendar / campaign), so no foreign key can reach the company: every read
 * receipt and mention row is stamped with the company the route's campaign access check authorized. A failed mention
 * write used to vanish unread - it is now logged (and the mention alert still goes out).
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../db/supabaseClient', () => {
  const from = (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t);
  return { supabase: { from }, default: { from } };
});

import { fakeDb, resetFakeDb, failNext } from '../helpers/fakeWhatsappDb';
import { markMessagesRead, listMessages } from '../../services/collaborationMessageService';
import { processMentions } from '../../services/collaborationMentionService';

const CO = '11111111-1111-4111-8111-111111111111';
const READER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MENTIONED = 'bbbbbbbb-0000-4000-8000-000000000001';
const AUTHOR = 'cccccccc-0000-4000-8000-000000000001';

it('markMessagesRead stamps the company on every receipt', async () => {
  resetFakeDb({ message_reads: [] });
  await markMessagesRead(['m1', 'm2'], 'campaign', READER, CO);
  expect(fakeDb.tables.message_reads).toEqual([
    expect.objectContaining({ message_id: 'm1', message_source: 'campaign', user_id: READER, company_id: CO }),
    expect.objectContaining({ message_id: 'm2', message_source: 'campaign', user_id: READER, company_id: CO }),
  ]);
});

it('listMessages passes the route company through to the receipts it writes', async () => {
  resetFakeDb({ campaign_messages: [{ id: 'm9', created_at: '2026-11-13T00:00:00Z', campaign_id: 'c1' }], message_reads: [] });
  await listMessages({ table: 'campaign_messages', select: '*', source: 'campaign', userId: READER, companyId: CO });
  expect(fakeDb.tables.message_reads).toEqual([expect.objectContaining({ message_id: 'm9', company_id: CO })]);
});

describe('processMentions', () => {
  const world = () => resetFakeDb({
    user_company_roles: [{ user_id: MENTIONED, company_id: CO, name: 'Dana Lee', status: 'active' }],
    message_mentions: [],
    intelligence_alerts: [],
  });

  it('stamps the company on the mention row (and still raises the alert)', async () => {
    world();
    await processMentions('m1', 'campaign', 'hi @danalee', CO, AUTHOR);
    expect(fakeDb.tables.message_mentions).toEqual([expect.objectContaining({ message_id: 'm1', mentioned_user_id: MENTIONED, company_id: CO })]);
    expect(fakeDb.tables.intelligence_alerts).toHaveLength(1);
  });

  it('a failed mention write is LOGGED (was: unread) and the alert still goes out', async () => {
    world();
    failNext('message_mentions', 'upsert');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await processMentions('m1', 'campaign', 'hi @danalee', CO, AUTHOR);
      expect(warn).toHaveBeenCalledWith('[collaborationMention] mention write failed', expect.objectContaining({ message_source: 'campaign' }));
    } finally {
      warn.mockRestore();
    }
    expect(fakeDb.tables.intelligence_alerts).toHaveLength(1);
  });
});

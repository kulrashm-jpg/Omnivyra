/**
 * WA-6 — a webhook job that could not do its work fails, so its 5 attempts apply, and
 * replaying the whole payload has the effect of processing each event once.
 * WA-20 — a phone_number_id held by more than one row no longer drops the message.
 *
 * Real processor, delivery update, opt-out and template handler on a fake database
 * (helpers/fakeWhatsappDb.ts). The governance writer is modelled by its canonical key;
 * its real behaviour is pinned by whatsappStopOptOut.test.ts and the real-schema suite.
 */

const mockGovernance = { keys: new Set<string>(), failures: 0, terminal: false, created: [] as string[] };

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
jest.mock('../../services/prospectIdentity/contactGovernanceWriter', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceWriter');
  return {
    ...actual,
    recordContactGovernance: async (i: { organizationId: string; target: string }) => {
      if (mockGovernance.terminal) throw new actual.GovernanceWriteError('refused', 'cross_tenant_reference');
      if (mockGovernance.failures > 0) { mockGovernance.failures -= 1; throw new Error('connection reset'); }
      const key = `${i.organizationId}|${i.target}`;
      if (mockGovernance.keys.has(key)) return { id: key, outcome: 'already_present' };
      mockGovernance.keys.add(key);
      mockGovernance.created.push(key);
      return { id: key, outcome: 'created' };
    },
  };
});

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { processWhatsAppWebhookJob } from '../../queue/jobProcessors/whatsappWebhookProcessor';

const PN = 'pn-1';
const FROM = '15551234567';
const job = (value: Row, field = 'messages') => ({ data: { payload: { entry: [{ changes: [{ field, value }] }] } } }) as never;
const inbound = (text: string, id = 'wamid.in.1'): Row => ({ from: FROM, id, timestamp: '1793000000', text: { body: text } });
const messagesEvent = (...messages: Row[]): Row => ({ metadata: { phone_number_id: PN }, messages });

const account = (over: Row = {}): Row => ({ id: 'sa-1', company_id: 'co-a', platform: 'whatsapp', phone_number_id: PN, is_active: true, ...over });
const threadsFor = () => (fakeDb.tables.engagement_threads ?? []);
const messages = () => (fakeDb.tables.engagement_messages ?? []);

beforeEach(() => {
  resetFakeDb({
    social_accounts: [account()],
    whatsapp_broadcast_recipients: [{ id: 'r1', broadcast_id: 'b1', wa_message_id: 'wamid.out.1', status: 'sent' }],
    whatsapp_templates: [{ id: 't1', meta_template_id: 'mt-1', template_name: 'hello', company_id: 'co-a', version: 1, status: 'PENDING', is_active: false }],
  });
  mockGovernance.keys.clear();
  mockGovernance.created.length = 0;
  mockGovernance.failures = 0;
  mockGovernance.terminal = false;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('WA-6: a failed event fails the job, after every other event has had its turn', () => {
  it('a clean payload resolves', async () => {
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('hello'))))).resolves.toBeUndefined();
    expect(messages()).toHaveLength(1);
  });

  it('a STOP the store could not take fails the job; the next attempt records it', async () => {
    mockGovernance.failures = 3;     // outlasts the three immediate tries
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).rejects.toThrow(/1 event\(s\) failed/);
    expect(mockGovernance.created).toEqual([]);
    expect(messages()).toHaveLength(1);    // the conversation record is still kept

    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).resolves.toBeUndefined();
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
    expect(messages()).toHaveLength(1);
  });

  it('a delivery update that failed fails the job, and later events in the payload still run', async () => {
    failNext('whatsapp_broadcast_recipients', 'update');
    const value = { ...messagesEvent(inbound('hello')), statuses: [{ id: 'wamid.out.1', status: 'delivered' }] };
    await expect(processWhatsAppWebhookJob(job(value))).rejects.toThrow(/status/);
    expect(messages()).toHaveLength(1);
    expect(fakeDb.tables.whatsapp_broadcast_recipients[0].status).toBe('sent');

    await processWhatsAppWebhookJob(job(value));
    expect(fakeDb.tables.whatsapp_broadcast_recipients[0].status).toBe('delivered');
    expect(messages()).toHaveLength(1);
  });

  it.each([
    ['thread', 'engagement_threads'],
    ['message', 'engagement_messages'],
  ])('a failed %s write fails the job instead of losing the reply', async (_what, table) => {
    failNext(table, 'upsert');
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('yes please'))))).rejects.toThrow(/inbound/);
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('yes please'))));
    expect(messages()).toHaveLength(1);
  });

  it('a terminal governance refusal is logged, not retried: repeating it cannot succeed', async () => {
    mockGovernance.terminal = true;
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[wa-webhook-processor] opt-out NOT recorded', expect.objectContaining({ status: 'terminal_failure' }));
    expect(messages()).toHaveLength(1);
  });

  it('what the job fails with carries no number and no message text: it reaches logs and dead letters', async () => {
    failNext('engagement_threads', 'upsert');
    const err = await processWhatsAppWebhookJob(job(messagesEvent(inbound('my private words')))).catch((e) => e as Error);
    expect(String(err)).not.toMatch(new RegExp(`${FROM}|private`));
  });
});

describe('WA-6: replaying a whole payload is processing each event once', () => {
  const statusValue = { statuses: [{ id: 'wamid.out.1', status: 'delivered' }] };
  const stopValue = messagesEvent(inbound('STOP'), inbound('and a real message', 'wamid.in.2'));
  const templateValue = { message_template_id: 'mt-1', message_template_name: 'hello', event: 'APPROVED' };

  it('statuses, opt-outs, inbound messages and template events', async () => {
    const payload = { data: { payload: { entry: [{ changes: [
      { field: 'messages', value: statusValue },
      { field: 'messages', value: stopValue },
      { field: 'message_template_status_update', value: templateValue },
    ] }] } } } as never;

    await processWhatsAppWebhookJob(payload);
    const first = JSON.stringify({ m: messages(), r: fakeDb.tables.whatsapp_broadcast_recipients, t: fakeDb.tables.whatsapp_templates.map((x) => ({ s: x.status, a: x.is_active })) });
    await processWhatsAppWebhookJob(payload);
    await processWhatsAppWebhookJob(payload);

    expect(JSON.stringify({ m: messages(), r: fakeDb.tables.whatsapp_broadcast_recipients, t: fakeDb.tables.whatsapp_templates.map((x) => ({ s: x.status, a: x.is_active })) })).toBe(first);
    expect(mockGovernance.created).toHaveLength(1);
    expect(messages().map((m) => m.platform_message_id)).toEqual(['wamid.in.1', 'wamid.in.2']);
    expect(threadsFor()).toHaveLength(1);
    expect(fakeDb.rpcs).toHaveLength(1);        // the delivered counter moved once
  });
});

describe('WA-20: the inbound account lookup', () => {
  it('a row on another platform with the same id does not drop the STOP', async () => {
    fakeDb.tables.social_accounts.push(account({ id: 'sa-other', company_id: 'co-b', platform: 'facebook' }));
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
    expect(messages()).toHaveLength(1);
  });

  it('a deactivated duplicate does not drop it, and the active account takes the thread', async () => {
    fakeDb.tables.social_accounts.unshift(account({ id: 'sa-0-old', is_active: false }));
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
    expect(threadsFor()[0].social_account_id).toBe('sa-1');
  });

  it('a number on a deactivated account still opts out: a STOP must not depend on the account being live', async () => {
    fakeDb.tables.social_accounts = [account({ is_active: false })];
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
    expect(messages()).toHaveLength(1);
  });

  it('two active accounts of one tenant: one opt-out, one message, on a stable thread across replays', async () => {
    fakeDb.tables.social_accounts.push(account({ id: 'sa-0' }));
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
    expect(threadsFor()).toHaveLength(1);
    expect(threadsFor()[0].social_account_id).toBe('sa-0');
    expect(messages()).toHaveLength(1);
  });

  describe('two tenants hold the number', () => {
    beforeEach(() => { fakeDb.tables.social_accounts.push(account({ id: 'sa-b', company_id: 'co-b' })); });

    it('a STOP binds both, no tenant receives the text, and the job fails so the event survives to dead-letter', async () => {
      await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).rejects.toThrow(/inbound/);
      expect(mockGovernance.created.sort()).toEqual([`co-a|+${FROM}`, `co-b|+${FROM}`]);
      expect(threadsFor()).toHaveLength(0);
      expect(messages()).toHaveLength(0);
      const logged = (console.error as jest.Mock).mock.calls.find((c) => c[0] === '[wa-webhook-processor] phone_number_id held by more than one tenant');
      expect(logged).toBeDefined();
      expect(JSON.stringify(logged)).not.toContain(FROM);
    });

    it('an ordinary message writes nothing anywhere, and fails the same way', async () => {
      await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('hello'))))).rejects.toThrow(/inbound/);
      expect(mockGovernance.created).toEqual([]);
      expect(messages()).toHaveLength(0);
    });
  });

  it('an unreadable lookup fails the job rather than reading as "no such account"', async () => {
    failNext('social_accounts', 'select');
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).rejects.toThrow(/inbound/);
    await processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))));
    expect(mockGovernance.created).toEqual([`co-a|+${FROM}`]);
  });

  it('a number nobody holds is not an error', async () => {
    fakeDb.tables.social_accounts = [];
    await expect(processWhatsAppWebhookJob(job(messagesEvent(inbound('STOP'))))).resolves.toBeUndefined();
    expect(mockGovernance.created).toEqual([]);
  });
});

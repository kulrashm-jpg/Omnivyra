/**
 * WhatsApp STOP / opt-out — inbound detection and recording in the canonical
 * contact-governance store, driven through the real webhook processor.
 *
 * Enforcement on the send side is the existing W0-C gate in
 * whatsappBroadcastService.processBatch (w0cWhatsappBroadcastGovernance.test.ts);
 * the last block here pins that the target recorded from an inbound STOP is the
 * one that gate computes for an E.164 recipient, so the two actually meet.
 */

type Row = Record<string, unknown>;

const db = {
  accounts: [] as Row[],
  threads: [] as Row[],
  messages: [] as Row[],
  failThreads: false,
};

jest.mock('../../db/supabaseClient', () => {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let payload: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      upsert: (row: Row) => { payload = row; return b; },
      single: async () => {
        if (table === 'social_accounts') {
          const hit = db.accounts.filter((a) => filters.every(([c, v]) => a[c] === v));
          return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { code: 'PGRST116' } };
        }
        if (table === 'engagement_threads') {
          if (db.failThreads) return { data: null, error: { code: '08006', message: 'connection failure' } };
          const row = { id: `thread-${db.threads.length + 1}`, ...payload };
          db.threads.push(row);
          return { data: { id: row.id }, error: null };
        }
        return { data: null, error: null };
      },
      then: (res: (v: unknown) => unknown) => {
        if (table === 'social_accounts') {
          return Promise.resolve({ data: db.accounts.filter((a) => filters.every(([c, v]) => a[c] === v)), error: null }).then(res);
        }
        if (table === 'engagement_messages' && payload) db.messages.push(payload);
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return b;
  };
  return { supabase: { from } };
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no direct table access in this suite'); } }));
jest.mock('../../services/whatsappBroadcastService', () => ({ updateRecipientDelivery: jest.fn() }));
jest.mock('../../services/whatsappTemplateService', () => ({ handleTemplateStatusWebhook: jest.fn() }));

const recordContactGovernance = jest.fn();
jest.mock('../../services/prospectIdentity/contactGovernanceWriter', () => {
  const actual = jest.requireActual('../../services/prospectIdentity/contactGovernanceWriter');
  return { ...actual, recordContactGovernance: (...a: unknown[]) => recordContactGovernance(...a) };
});

// G-11: the all-channel hold and the admin review are Orchestration's service, called through
// optOutHold; this suite pins what the producer hands it. g11_outreach_producers (real schema)
// runs the real thing.
const holdAndOpenOptOutReview = jest.fn();
jest.mock('../../services/leadOutreachExecution/optOutHold', () => ({
  holdAndOpenOptOutReview: (...a: unknown[]) => holdAndOpenOptOutReview(...a),
}));

import { GovernanceWriteError } from '../../services/prospectIdentity/contactGovernanceWriter';
import { normalizeGovernanceTarget } from '../../services/prospectIdentity/contactGovernanceRepository';
import { processWhatsAppWebhookJob } from '../../queue/jobProcessors/whatsappWebhookProcessor';
import {
  WHATSAPP_OPT_OUT_MAX_ATTEMPTS,
  WHATSAPP_OPT_OUT_SOURCE,
  detectWhatsAppOptOut,
  recordWhatsAppOptOut,
  whatsappSenderTarget,
} from '../../services/whatsappOptOut';

const PHONE_NUMBER_ID = 'pnid-1';

const job = (messages: Row[]) => ({
  data: { payload: { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages } }] }] } },
}) as never;

const inbound = (text: string, over: Row = {}): Row => ({
  from: '15551234567', id: 'wamid.1', timestamp: '1793000000', type: 'text', text: { body: text }, ...over,
});

beforeEach(() => {
  db.accounts = [{ id: 'sa-1', company_id: 'co-a', platform: 'whatsapp', is_active: true, phone_number_id: PHONE_NUMBER_ID }];
  db.threads = [];
  db.messages = [];
  db.failThreads = false;
  recordContactGovernance.mockReset();
  recordContactGovernance.mockResolvedValue({ id: 'cg-1', outcome: 'created' });
  holdAndOpenOptOutReview.mockReset();
  holdAndOpenOptOutReview.mockResolvedValue({ status: 'opened', reviewId: 'rv-1', holdIds: ['h-1'], reason: null });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('detectWhatsAppOptOut — whole-message keywords only', () => {
  it.each(['STOP', 'stop', '  Stop  ', 'STOP.', 'Stop!', 'unsubscribe', 'Opt out', 'OPT-OUT', 'optout', 'Stop Promotions', 'STOP ALL', 'cancel', 'end', 'quit'])(
    '%p is an opt-out',
    (text) => expect(detectWhatsAppOptOut(text)).not.toBeNull(),
  );

  it.each(['please stop calling me at night', 'stopwatch', "don't stop", 'STOP STOP', 'start', 'hello', '', '   ', undefined, null, 42])(
    '%p is NOT an opt-out',
    (text) => expect(detectWhatsAppOptOut(text)).toBeNull(),
  );
});

describe('whatsappSenderTarget', () => {
  it('turns Meta\'s wa_id into +<digits>', () => {
    expect(whatsappSenderTarget('15551234567')).toBe('+15551234567');
    expect(whatsappSenderTarget('+44 7700 900123')).toBe('+447700900123');
  });

  it.each(['', 'abc', '1234567', '1234567890123456', undefined])('rejects %p', (v) => {
    expect(whatsappSenderTarget(v)).toBeNull();
  });
});

describe('inbound STOP through the real webhook processor', () => {
  it('records a WhatsApp unsubscribe for the sender, tenant-scoped, and still stores the message', async () => {
    await processWhatsAppWebhookJob(job([inbound('STOP')]));

    expect(recordContactGovernance).toHaveBeenCalledTimes(1);
    expect(recordContactGovernance).toHaveBeenCalledWith({
      organizationId: 'co-a',
      governanceType: 'unsubscribe',
      channel: 'whatsapp',
      personId: null,
      target: '+15551234567',
      source: WHATSAPP_OPT_OUT_SOURCE,
      evidence: { waMessageId: 'wamid.1', matchedKeyword: 'STOP', detectorVersion: 'wa-optout-1', socialAccountId: 'sa-1' },
    });
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]).toMatchObject({ content: 'STOP', direction: 'inbound' });
  });

  it('G-11: after the whatsapp record, every channel is held on the number and the review is opened', async () => {
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    expect(holdAndOpenOptOutReview).toHaveBeenCalledTimes(1);
    expect(holdAndOpenOptOutReview).toHaveBeenCalledWith({
      organizationId: 'co-a',
      trigger: 'whatsapp_stop',
      anchor: { kind: 'target', channel: 'whatsapp', target: '+15551234567' },
      sourceRef: 'wamid.1',
      triggerRecordId: 'cg-1',
      phone: '+15551234567',
      evidence: { detectorVersion: 'wa-optout-1', socialAccountId: 'sa-1' },
    });
    // The channel record comes first: the hold never stands without it.
    expect(recordContactGovernance.mock.invocationCallOrder[0]).toBeLessThan(holdAndOpenOptOutReview.mock.invocationCallOrder[0]);
  });

  it('G-11: a hold or review that could not be written fails the job, so it is retried', async () => {
    holdAndOpenOptOutReview.mockResolvedValue({ status: 'retryable_failure', reviewId: null, holdIds: [], reason: 'review_write_failed' });
    await expect(processWhatsAppWebhookJob(job([inbound('STOP')]))).rejects.toThrow(/1 event\(s\) failed: inbound/);
    const call = (console.error as jest.Mock).mock.calls.find((c) => c[0] === '[wa-webhook-processor] opt-out NOT recorded');
    expect(call[1]).toMatchObject({ status: 'retryable_failure', reason: 'review_write_failed' });
  });

  it('G-11: no hold is written when the whatsapp record itself failed', async () => {
    recordContactGovernance.mockRejectedValue(new GovernanceWriteError('bad', 'cross_tenant_reference'));
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    expect(holdAndOpenOptOutReview).not.toHaveBeenCalled();
  });

  it('evidence never carries the message text or the number', async () => {
    await processWhatsAppWebhookJob(job([inbound('unsubscribe')]));
    const evidence = JSON.stringify(recordContactGovernance.mock.calls[0][0].evidence);
    expect(evidence).not.toMatch(/15551234567/);
    expect(evidence).not.toMatch(/"text"|"body"|"message"|"payload"/);
  });

  it('recognises Meta\'s "Stop promotions" quick-reply button', async () => {
    await processWhatsAppWebhookJob(job([inbound('', { type: 'button', text: undefined, button: { text: 'Stop promotions' } })]));
    expect(recordContactGovernance).toHaveBeenCalledWith(expect.objectContaining({ evidence: expect.objectContaining({ matchedKeyword: 'STOP PROMOTIONS' }) }));
  });

  it('an ordinary message records nothing', async () => {
    await processWhatsAppWebhookJob(job([inbound('please stop calling me at night')]));
    expect(recordContactGovernance).not.toHaveBeenCalled();
    expect(db.messages).toHaveLength(1);
  });

  it('an unknown phone_number_id records nothing (no tenant, no opt-out)', async () => {
    db.accounts = [];
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    expect(recordContactGovernance).not.toHaveBeenCalled();
  });

  it('a failed thread write cannot swallow the opt-out', async () => {
    db.failThreads = true;
    // WA-6: the job now fails so the message is retried; the opt-out is already in.
    await expect(processWhatsAppWebhookJob(job([inbound('STOP')]))).rejects.toThrow(/1 event\(s\) failed: inbound/);
    expect(recordContactGovernance).toHaveBeenCalledTimes(1);
    expect(db.messages).toHaveLength(0);
  });

  it('a webhook redelivery is idempotent: the store reports already_present', async () => {
    recordContactGovernance.mockResolvedValueOnce({ id: 'cg-1', outcome: 'created' }).mockResolvedValueOnce({ id: 'cg-1', outcome: 'already_present' });
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    expect(recordContactGovernance).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalledWith('[wa-webhook-processor] opt-out NOT recorded', expect.anything());
  });

  it('logs a failure as codes only — never the number or text', async () => {
    recordContactGovernance.mockRejectedValue(new GovernanceWriteError('bad', 'cross_tenant_reference'));
    await processWhatsAppWebhookJob(job([inbound('STOP')]));
    const call = (console.error as jest.Mock).mock.calls.find((c) => c[0] === '[wa-webhook-processor] opt-out NOT recorded');
    expect(call).toBeDefined();
    expect(JSON.stringify(call)).not.toMatch(/15551234567|STOP"/);
    expect(call[1]).toMatchObject({ status: 'terminal_failure', reason: 'cross_tenant_reference', companyId: 'co-a' });
  });
});

describe('recordWhatsAppOptOut — retry discipline', () => {
  const input = { organizationId: 'co-a', waId: '15551234567', waMessageId: 'wamid.1', keyword: 'STOP', socialAccountId: 'sa-1' };

  it('retries a transient failure and then records', async () => {
    recordContactGovernance.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce({ id: 'cg-1', outcome: 'created' });
    expect(await recordWhatsAppOptOut(input)).toEqual({ status: 'recorded', reason: null, attempts: 2, review: 'opened', reviewId: 'rv-1' });
  });

  it('never retries a terminal writer error', async () => {
    recordContactGovernance.mockRejectedValue(new GovernanceWriteError('x', 'anchor_required'));
    expect(await recordWhatsAppOptOut(input)).toMatchObject({ status: 'terminal_failure', reason: 'anchor_required', attempts: 1 });
    expect(recordContactGovernance).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of transient failures and says so', async () => {
    recordContactGovernance.mockRejectedValue(new Error('connection reset'));
    expect(await recordWhatsAppOptOut(input)).toMatchObject({ status: 'retryable_failure', attempts: WHATSAPP_OPT_OUT_MAX_ATTEMPTS });
    expect(recordContactGovernance).toHaveBeenCalledTimes(WHATSAPP_OPT_OUT_MAX_ATTEMPTS);
  });

  it('a sender that is not a phone number is refused without a write', async () => {
    expect(await recordWhatsAppOptOut({ ...input, waId: 'not-a-number' })).toMatchObject({ status: 'invalid_sender', attempts: 0 });
    expect(recordContactGovernance).not.toHaveBeenCalled();
  });
});

describe('the recorded target meets the existing broadcast gate', () => {
  it.each(['+15551234567', '+1 555 123 4567', '+1 (555) 123-4567'])(
    'an E.164 recipient %p normalises to the opt-out target',
    (recipient) => expect(normalizeGovernanceTarget('whatsapp', recipient)).toBe(whatsappSenderTarget('15551234567')),
  );

  it('KNOWN LIMITATION: a recipient stored without "+" does not match (phone normalisation is unchanged, G-2)', () => {
    expect(normalizeGovernanceTarget('whatsapp', '15551234567')).not.toBe(whatsappSenderTarget('15551234567'));
  });
});

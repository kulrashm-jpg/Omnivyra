/**
 * CLASS-2 D11 (e9 sweep): the admin's inbound-signup notice is sent ONCE per (company, prospect).
 * Its callers passed an idempotency key to send-transactional-email, which never reads it, so every
 * repeat verify notified the admin again. It is now QUEUED on email_jobs, whose unique
 * idempotency_key is the constraint; the worker sends it through the same edge function.
 * The real emailService + emailJobsService over the fake database (sequential repeats use the
 * pre-flight replay; a concurrent one is refused by the unique index in the real schema).
 */
const mockInvoke = jest.fn(async () => ({ data: null, error: null }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    functions: { invoke: (...a: unknown[]) => (mockInvoke as any)(...a) },
    rpc: async () => ({ data: null, error: null }), // record_email_event ('queued')
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { createHash } from 'crypto';
import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { sendInboundSignupNoticeToAdmin } from '../../services/emailService';
import { buildSendEnvelopeFromClaim } from '../../services/emailJobsService';

const ADMIN = 'admin@acme.test';
const notice = (prospect: string) => sendInboundSignupNoticeToAdmin(
  ADMIN, { prospectEmail: prospect, companyName: 'Acme', supportEmail: 'support@x.test' }, `inbound-signup-notice:co-1:${prospect}`,
);
const jobs = () => fakeDb.tables.email_jobs ?? [];

beforeEach(() => { resetFakeDb({ email_jobs: [] }); mockInvoke.mockClear(); });

it('a repeat verify with the same key queues NOTHING more: one job, and no direct edge send', async () => {
  await notice('p@x.test');
  await notice('p@x.test');
  expect(jobs()).toHaveLength(1);
  expect(jobs()[0]).toMatchObject({ job_type: 'inbound_signup_notice', template_key: 'inbound_signup_notice', recipient_email: ADMIN, idempotency_key: 'inbound-signup-notice:co-1:p@x.test', status: 'pending' });
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('notices about two DIFFERENT prospects to one admin are both queued (not collapsed by the payload hash)', async () => {
  await notice('p1@x.test');
  await notice('p2@x.test');
  expect(jobs()).toHaveLength(2);
  expect(jobs()[0].payload_hash).not.toBe(jobs()[1].payload_hash);
});

it('the worker builds the edge function\'s inbound_signup_notice body from the queued job', () => {
  expect(buildSendEnvelopeFromClaim({
    template_key: 'inbound_signup_notice',
    payload: { recipientEmail: ADMIN, prospectEmail: 'p@x.test', companyName: 'Acme', supportEmail: 'support@x.test', correlationId: 'c' },
    payload_encrypted: false,
    recipient_email: ADMIN,
  })).toEqual({ ok: true, body: { type: 'inbound_signup_notice', recipientEmail: ADMIN, prospectEmail: 'p@x.test', companyName: 'Acme', supportEmail: 'support@x.test' } });
});

it('NEGATIVE CONTROL: the existing invite templates keep their payload hash (pending rows still dedupe against new ones)', async () => {
  const { enqueueEmailJob } = require('../../services/emailJobsService');
  await enqueueEmailJob({
    templateKey: 'team_invite_magic_link', recipientEmail: 'u@x.test', invitationId: 'inv-1', correlationId: 'c',
    payload: { recipientEmail: 'u@x.test', recipientName: null, companyName: null, role: 'member', inviteUrl: 'https://x/i', invitationId: 'inv-1', correlationId: 'c' },
  });
  const legacy = createHash('sha256').update(['team_invite_magic_link', 'u@x.test', 'inv-1'].join(':')).digest('hex');
  expect(jobs()[0].payload_hash).toBe(legacy);
});

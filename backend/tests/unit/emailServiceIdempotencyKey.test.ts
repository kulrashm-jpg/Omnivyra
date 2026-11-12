/**
 * emailService passes the caller's idempotencyKey IN THE BODY to send-transactional-email (correct-sending, e9
 * 2026-11-13). It used to only log it, so every keyed caller (reinvite, company referral, inbound signup notice,
 * credit alerts) believed its email was deduplicated and it was not. Without a key, the body is unchanged.
 */
const invoked: Array<{ fn: string; body: Record<string, unknown> }> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => { invoked.push({ fn, body: opts.body }); return { data: { ok: true }, error: null }; } } },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined } }));

import { sendCompanyAdminReferral, sendCreditAlert, sendInboundSignupNoticeToAdmin, sendInvite } from '../../services/emailService';

beforeEach(() => { invoked.length = 0; });

it('each live keyed helper puts its key in the body sent to the function', async () => {
  await sendInvite('a@example.test', 'https://app.test/i', 'reinvite:co:u');
  await sendCompanyAdminReferral('p@example.test', { admin: null, companyName: null, supportEmail: 's@example.test' }, 'company-referral:p@example.test');
  await sendInboundSignupNoticeToAdmin('ad@example.test', { prospectEmail: 'p@example.test', companyName: null, supportEmail: 's@example.test' }, 'inbound-signup-notice:co:p@example.test');
  await sendCreditAlert({ recipientEmail: 'ad@example.test', companyName: null, consumedPercent: 90, remainingCredits: 1, projectedRequiredCredits: 9, ctaUrl: 'https://app.test/b' }, 'credit_alert:org:2026-11');
  expect(invoked.map((i) => [i.fn, i.body.type, i.body.idempotencyKey])).toEqual([
    ['send-transactional-email', 'team_invite', 'reinvite:co:u'],
    ['send-transactional-email', 'company_referral', 'company-referral:p@example.test'],
    ['send-transactional-email', 'inbound_signup_notice', 'inbound-signup-notice:co:p@example.test'],
    ['send-transactional-email', 'credit_alert', 'credit_alert:org:2026-11'],
  ]);
});

it('CONTROL: without a key the body carries no idempotencyKey field at all (unchanged)', async () => {
  await sendInvite('a@example.test', 'https://app.test/i');
  expect(invoked[0].body).toEqual({ type: 'team_invite', recipientEmail: 'a@example.test', inviteUrl: 'https://app.test/i' });
  expect('idempotencyKey' in invoked[0].body).toBe(false);
});

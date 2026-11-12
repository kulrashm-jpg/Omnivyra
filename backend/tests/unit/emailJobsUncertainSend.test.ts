/**
 * CLASS-2 D3 (e9 sweep): the email_jobs worker never resends an email whose send may have
 * happened. It retried EVERY invoke failure, so a lost answer to a message SES had accepted was sent
 * a second time on the next tick. Now only a failure known to have sent nothing is retried:
 *   - the function answered 4xx (it refused before any send), or 500 with outcome "not_sent";
 *   - anything else (500 "uncertain" / without an outcome, relay or network error) is dead-lettered
 *     OUTCOME_UNCERTAIN for a person - the same verdict as CMS publishing.
 * The REAL cron handler; supabase is a double that records RPCs; the invoke errors are the REAL
 * supabase-js error classes (FunctionsHttpError carries the function's Response).
 * Also: the edge function's own classifier (outcome.ts), executed.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

const mockRpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let mockInvoke: () => Promise<{ data: unknown; error: unknown }>;

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      if (fn === 'claim_email_jobs') {
        return { data: [{ id: 'ej-1', job_type: 'invite', template_key: 'company_invite', payload: {}, payload_encrypted: false, recipient_email: 'a@x.test', subject: null, html: null, retry_count: 0, max_retries: 5, invitation_id: null, correlation_id: null, idempotency_key: 'k1', payload_hash: null, request_id: null }], error: null };
      }
      return { data: null, error: null };
    },
    functions: { invoke: () => mockInvoke() },
  },
}));
jest.mock('../../services/emailJobsService', () => ({
  buildSendEnvelopeFromClaim: () => ({ ok: true, body: { type: 'company_invite', to: 'a@x.test' } }),
  computeNextAttemptAt: () => new Date('2026-11-12T12:00:00.000Z'),
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import handler from '../../../pages/api/cron/email-jobs';
import { classifySendFailure } from '../../../supabase/functions/send-transactional-email/outcome';

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const finalized = () => mockRpcs.filter((r) => r.fn === 'finalize_email_job').map((r) => r.args);

async function tick() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (handler as any)({ method: 'POST', headers: { authorization: 'Bearer cron-secret' } }, res);
  return res;
}

const ORIGINAL = process.env.CRON_SECRET;
beforeEach(() => { mockRpcs.length = 0; process.env.CRON_SECRET = 'cron-secret'; });
afterAll(() => { if (ORIGINAL === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = ORIGINAL; });

describe('the worker: only a failure known to have sent nothing is retried', () => {
  it.each([
    ['a network error / timeout (the request may have reached SES)', () => new FunctionsFetchError(new Error('socket hang up'))],
    ['a relay error', () => new FunctionsRelayError({})],
    ['a 500 whose answer says the outcome is uncertain', () => new FunctionsHttpError(response(500, { error: 'timeout', outcome: 'uncertain' }))],
    ['a 500 with no outcome (an older function)', () => new FunctionsHttpError(response(500, { error: 'boom' }))],
  ])('%s -> DEAD-LETTERED OUTCOME_UNCERTAIN, never retried', async (_l, err) => {
    mockInvoke = async () => ({ data: null, error: err() });
    await tick();
    expect(finalized()).toEqual([expect.objectContaining({ p_job_id: 'ej-1', p_status: 'dead', p_error: expect.stringMatching(/^OUTCOME_UNCERTAIN/) })]);
  });

  it.each([
    ['a 500 whose answer says nothing was sent (e.g. SES rejected it)', () => new FunctionsHttpError(response(500, { error: 'MessageRejected', outcome: 'not_sent' }))],
    ['a 4xx (the function refused before any send)', () => new FunctionsHttpError(response(400, { error: "Missing 'type' field" }))],
  ])('NEGATIVE CONTROL: %s -> retried as before', async (_l, err) => {
    mockInvoke = async () => ({ data: null, error: err() });
    await tick();
    expect(finalized()).toEqual([expect.objectContaining({ p_job_id: 'ej-1', p_status: 'failed' })]);
  });

  it('NEGATIVE CONTROL: a success is recorded sent', async () => {
    mockInvoke = async () => ({ data: { ok: true, messageId: 'ses-1' }, error: null });
    await tick();
    expect(finalized()).toEqual([expect.objectContaining({ p_status: 'sent', p_provider_message_id: 'ses-1' })]);
  });
});

describe('the edge function classifies its own failure (outcome.ts, executed)', () => {
  it('nothing reached SES -> not_sent', () => {
    expect(classifySendFailure(new Error('SES_NOT_CONFIGURED'), false)).toBe('not_sent');
  });
  it('SES answered 4xx (MessageRejected / Throttling) -> not_sent', () => {
    expect(classifySendFailure(Object.assign(new Error('MessageRejected'), { $metadata: { httpStatusCode: 400 } }), true)).toBe('not_sent');
  });
  it.each([
    ['a timeout (no answer)', new Error('The operation was aborted')],
    ['a 5xx from SES', Object.assign(new Error('InternalFailure'), { $metadata: { httpStatusCode: 500 } })],
  ])('after the call started, %s -> uncertain', (_l, err) => {
    expect(classifySendFailure(err, true)).toBe('uncertain');
  });
});

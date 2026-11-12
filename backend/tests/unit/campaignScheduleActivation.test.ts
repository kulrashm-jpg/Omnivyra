/**
 * activateScheduledCampaign (e9, 2026-11-12): the idempotent activation write is tried
 * ACTIVATION_ATTEMPTS (3) times with a short backoff; on FINAL failure an alert-ready operational
 * event is recorded so ops sees posts that will not publish even if the user closes the tab.
 * REAL: the service. FAKED: the campaigns update (scripted answers) and the event recorder.
 */
export {};

let answers: Array<{ error: { message: string } | null }> = [];
const writes: unknown[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'campaigns') throw new Error(`undeclared table ${t}`);
      const b: any = {};
      b.update = (p: unknown) => { writes.push(p); return b; };
      b.eq = () => b;
      b.then = (res: any, rej: any) => Promise.resolve({ data: null, error: (answers.shift() ?? { error: null }).error }).then(res, rej);
      return b;
    },
  },
}));
const recordEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: (...a: unknown[]) => recordEvent(...a) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = require('../../services/campaignScheduleActivation');
const fail = { error: { message: 'boom' } };
const ok = { error: null };

beforeEach(() => {
  answers = [];
  writes.length = 0;
  recordEvent.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('activateScheduledCampaign', () => {
  it('first attempt succeeds: one write, no wait, no event', async () => {
    const sleep = jest.fn(async () => undefined);
    answers = [ok];
    await expect(svc.activateScheduledCampaign('c1', { sleep })).resolves.toEqual({ ok: true, error: null, attempts: 1 });
    expect(writes).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('succeeds on the 3rd attempt after the configured backoff: no event', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    answers = [fail, fail, ok];
    await expect(svc.activateScheduledCampaign('c1', { sleep })).resolves.toEqual({ ok: true, error: null, attempts: 3 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...svc.ACTIVATION_BACKOFF_MS]);
    expect(svc.ACTIVATION_ATTEMPTS).toBe(3);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('all 3 fail: ok false with the last error, and ONE alert-ready CAMPAIGN_ACTIVATION_FAILED event', async () => {
    answers = [fail, fail, { error: { message: 'last' } }];
    const r = await svc.activateScheduledCampaign('c1', { companyId: 'co-1', source: 'test', sleep: async () => undefined });
    expect(r).toEqual({ ok: false, error: { message: 'last' }, attempts: 3 });
    expect(writes).toHaveLength(3);
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent.mock.calls[0][0]).toMatchObject({
      eventName: 'scheduling.campaign_activation_failed', severity: 'ERROR', alertReady: true, requiresHumanReview: true,
      organizationId: 'co-1',
      metadata: expect.objectContaining({ code: 'CAMPAIGN_ACTIVATION_FAILED', campaign_id: 'c1', attempts: 3, source: 'test', error: 'last' }),
    });
  });

  it('a throwing event recorder never masks the result (logged instead)', async () => {
    answers = [fail, fail, fail];
    recordEvent.mockRejectedValue(new Error('events down'));
    const r = await svc.activateScheduledCampaign('c1', { sleep: async () => undefined });
    expect(r.ok).toBe(false);
    expect((console.error as jest.Mock).mock.calls.some((c) => String(c[0]).includes('could not record the activation-failed event'))).toBe(true);
  });
});

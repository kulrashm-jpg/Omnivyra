/**
 * Closure-011 — submitSuperAdminWrite: the established super-admin step-up
 * flow (lib/security/superAdminStepUp.ts runStepUpFlowIfNeeded +
 * classifyAuthFailure), with the three results a call site acts on.
 *
 * Real: submitSuperAdminWrite, runStepUpFlowIfNeeded, classifyAuthFailure,
 * describeStepUpOutcome. Mocked: the WebAuthn ceremony (triggerWebAuthnStepUp
 * — real passkeys need a browser and an authenticator) and the device-trust
 * POST. No real passkey behaviour is proven here.
 */
const mockCeremony = jest.fn();
jest.mock('../../../lib/security/stepUpClient', () => ({
  triggerWebAuthnStepUp: (...a: unknown[]) => mockCeremony(...a),
}));

import { submitSuperAdminWrite, STEP_UP_DEFERRED_MESSAGE } from '../../../lib/security/superAdminStepUp';

type Body = Record<string, unknown> | null;
function res(status: number, body: Body = {}): Response {
  const make = (): unknown => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    clone: () => make(),
  });
  return make() as Response;
}
const STEP_UP = () => res(401, { code: 'STEP_UP_REQUIRED', error: 'Step-up authentication required', capability: 'platform.controls.manage' });
const NOT_AUTH = () => res(401, { code: 'NOT_AUTHENTICATED', error: 'Authorization required' });

const mockTrust = jest.fn(async () => ({ ok: true, status: 201 }));
beforeEach(() => {
  mockCeremony.mockReset();
  mockCeremony.mockResolvedValue({ stepUp: { id: 'su-1' } });
  mockTrust.mockClear();
  (globalThis as { fetch?: unknown }).fetch = mockTrust;
});

/** A route double: answers each successive call with the next response. */
function route(...answers: Array<() => Response>) {
  const calls: number[] = [];
  const fire = jest.fn(async () => {
    calls.push(calls.length);
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    return next();
  });
  return fire;
}

describe('submitSuperAdminWrite', () => {
  it('a normal 2xx write: ok, sent once, no passkey prompt', async () => {
    const fire = route(() => res(200, { ok: true }));
    const r = await submitSuperAdminWrite(fire);
    expect(r.status).toBe('ok');
    expect(fire).toHaveBeenCalledTimes(1);
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it('401 STEP_UP_REQUIRED: the established passkey ceremony runs once, the device is trusted, the write is retried ONCE and succeeds', async () => {
    const fire = route(STEP_UP, () => res(200, { ok: true }));
    const onChallengeStart = jest.fn();
    const r = await submitSuperAdminWrite(fire, { onChallengeStart });
    expect(r.status).toBe('ok');
    expect(onChallengeStart).toHaveBeenCalledTimes(1);
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(mockCeremony).toHaveBeenCalledWith({ scopedCapability: null });
    expect(mockTrust).toHaveBeenCalledWith('/api/auth/devices/trust', expect.objectContaining({ method: 'POST' }));
    // One denied attempt (which did nothing server-side) + one executed retry: no duplicate execution.
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('401 NOT_AUTHENTICATED follows the session path — no passkey prompt, no retry', async () => {
    const fire = route(NOT_AUTH);
    const r = await submitSuperAdminWrite(fire);
    expect(r).toEqual({ status: 'blocked', message: expect.stringMatching(/session has expired/i) });
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PLATFORM_SUPER_ADMIN_REQUIRED', 403],
    ['CAPABILITY_NOT_HELD', 403],
    ['BRIDGE_FACTOR_INSUFFICIENT', 403],
  ])('403 %s: no passkey prompt, no retry, no authentication loop — failed with the server response', async (code, status) => {
    const fire = route(() => res(status, { error: 'Forbidden', code }));
    const r = await submitSuperAdminWrite(fire);
    expect(r.status).toBe('failed');
    expect(mockCeremony).not.toHaveBeenCalled();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404, 409, 429, 502])('%s (a non-auth refusal): failed with the server response, never ok, no prompt', async (status) => {
    const fire = route(() => res(status, { error: 'server said no' }));
    const r = await submitSuperAdminWrite(fire);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(await r.response.json()).toEqual({ error: 'server said no' });
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it('the operator CANCELS the passkey prompt: blocked, nothing retried, never reported as success', async () => {
    mockCeremony.mockRejectedValue(new Error('NotAllowedError: The operation either timed out or was not allowed.'));
    const fire = route(STEP_UP, () => res(200, { ok: true }));
    const r = await submitSuperAdminWrite(fire);
    expect(r).toEqual({ status: 'blocked', message: expect.stringMatching(/cancelled/i) });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(mockTrust).not.toHaveBeenCalled();
  });

  it('step-up UNAVAILABLE (no passkey enrolled / verify failed / unsupported browser): blocked with an explicit reason, nothing retried', async () => {
    mockCeremony.mockRejectedValue(new Error('No passkey registered for this account'));
    const fire = route(STEP_UP);
    const r = await submitSuperAdminWrite(fire);
    expect(r).toEqual({ status: 'blocked', message: expect.stringMatching(/not available.*No passkey registered/i) });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('step-up "succeeds" but the retry is STILL denied (e.g. an expired/untrusted state): failed after exactly ONE retry — no loop, no second prompt', async () => {
    const fire = route(STEP_UP, STEP_UP, STEP_UP);
    const r = await submitSuperAdminWrite(fire);
    expect(r.status).toBe('failed');
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('the session is lost during the step-up: blocked (session), not success', async () => {
    const fire = route(STEP_UP, NOT_AUTH);
    const r = await submitSuperAdminWrite(fire);
    expect(r).toEqual({ status: 'blocked', message: expect.stringMatching(/session has expired/i) });
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('the retried write fails on its own merits (409): failed with that response, not success', async () => {
    const fire = route(STEP_UP, () => res(409, { error: 'changed concurrently' }));
    const r = await submitSuperAdminWrite(fire);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.response.status).toBe(409);
  });

  describe('interactive: false (no user gesture — e.g. an automatic refresh)', () => {
    it('STEP_UP_REQUIRED is NOT answered with a passkey prompt: blocked with the deferred message, sent once', async () => {
      const fire = route(STEP_UP);
      const r = await submitSuperAdminWrite(fire, { interactive: false });
      expect(r).toEqual({ status: 'blocked', message: STEP_UP_DEFERRED_MESSAGE });
      expect(mockCeremony).not.toHaveBeenCalled();
      expect(fire).toHaveBeenCalledTimes(1);
    });
    it('a 2xx is ok; NOT_AUTHENTICATED is the session path; a 403 is failed', async () => {
      expect((await submitSuperAdminWrite(route(() => res(200, {})), { interactive: false })).status).toBe('ok');
      expect((await submitSuperAdminWrite(route(NOT_AUTH), { interactive: false })).status).toBe('blocked');
      expect((await submitSuperAdminWrite(route(() => res(403, { code: 'X' })), { interactive: false })).status).toBe('failed');
      expect(mockCeremony).not.toHaveBeenCalled();
    });
  });
});

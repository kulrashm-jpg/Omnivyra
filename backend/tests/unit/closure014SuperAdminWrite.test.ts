/**
 * Closure-014 (C) — performSuperAdminWrite: the single UI write call.
 *
 * Real: performSuperAdminWrite, submitSuperAdminWrite, runStepUpFlowIfNeeded,
 * classifyAuthFailure. Mocked: ONLY the browser WebAuthn ceremony
 * (triggerWebAuthnStepUp) and the device-trust POST. Real passkey behaviour is a
 * separate real-browser validation (Closure-012 Section A pattern).
 */
const mockCeremony = jest.fn();
jest.mock('../../../lib/security/stepUpClient', () => ({
  triggerWebAuthnStepUp: (...a: unknown[]) => mockCeremony(...a),
}));

import { performSuperAdminWrite, describeWriteFailure, retryAfterSeconds, freshIdempotencyHeaders } from '../../../lib/security/superAdminWrite';

type Body = Record<string, unknown> | null;
function res(status: number, body: Body = {}, headers: Record<string, string> = {}): Response {
  const h = { get: (k: string) => headers[k.toLowerCase()] ?? null } as unknown as Headers;
  const make = (): unknown => ({ ok: status >= 200 && status < 300, status, headers: h, json: async () => body, text: async () => JSON.stringify(body), clone: () => make() });
  return make() as Response;
}
const STEP_UP = () => res(401, { code: 'STEP_UP_REQUIRED', error: 'Step-up authentication required', capability: 'cron.config.manage' });
function route(...answers: Array<() => Response>) {
  let n = 0;
  return jest.fn(async () => answers[Math.min(n++, answers.length - 1)]());
}
const mockTrust = jest.fn(async () => ({ ok: true, status: 201 }));
beforeEach(() => {
  mockCeremony.mockReset();
  mockCeremony.mockResolvedValue({ stepUp: { id: 'su-1' } });
  mockTrust.mockClear();
  (globalThis as { fetch?: unknown }).fetch = mockTrust;
});

describe('performSuperAdminWrite', () => {
  it('2xx: ok with the parsed body, one request, no ceremony', async () => {
    const fire = route(() => res(200, { saved: true }));
    expect(await performSuperAdminWrite(fire)).toEqual({ ok: true, status: 200, body: { saved: true }, message: null, code: null });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it('401 STEP_UP_REQUIRED → real passkey ceremony (browser part mocked) → device trust → exactly ONE retry → ok', async () => {
    const fire = route(STEP_UP, () => res(200, { saved: true }));
    const r = await performSuperAdminWrite(fire);
    expect(r).toMatchObject({ ok: true, body: { saved: true } });
    expect(fire).toHaveBeenCalledTimes(2);
    expect(mockCeremony).toHaveBeenCalledTimes(1);
    expect(mockTrust).toHaveBeenCalled();
  });

  it('a cancelled passkey prompt is never success: one request, a cancel message, no retry', async () => {
    const err = new Error('The operation either timed out or was not allowed.'); err.name = 'NotAllowedError';
    mockCeremony.mockRejectedValue(err);
    const fire = route(STEP_UP, () => res(200, {}));
    const r = await performSuperAdminWrite(fire);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cancelled/i);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('passkeys unavailable (no credential / unsupported browser) → actionable, not success', async () => {
    mockCeremony.mockRejectedValue(new Error('No passkey registered for this account'));
    const r = await performSuperAdminWrite(route(STEP_UP));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not available.*Enroll a passkey/i);
  });

  it('still denied after elevation (expired / untrusted) → failed after exactly ONE retry, no loop', async () => {
    const fire = route(STEP_UP, STEP_UP, STEP_UP);
    const r = await performSuperAdminWrite(fire);
    expect(r.ok).toBe(false);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(mockCeremony).toHaveBeenCalledTimes(1);
  });

  it('interactive:false (background) never prompts — it reports a confirmation is needed', async () => {
    const fire = route(STEP_UP);
    const r = await performSuperAdminWrite(fire, { interactive: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/passkey confirmation/i);
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it.each([
    [403, { code: 'PLATFORM_SUPER_ADMIN_REQUIRED' }, /active platform super-admin/],
    [403, { code: 'CAPABILITY_NOT_HELD' }, /does not have permission/],
    [409, { error: 'Row revision changed.' }, /Conflict: Row revision changed\. Refresh/],
    [409, {}, /changed or the same request is already running/],
    [500, {}, /Server error \(500\)\. Nothing was confirmed as saved/],
    [400, { error: 'name required' }, /^name required$/],
  ])('%i %j → an actionable message (never success)', async (status, body, re) => {
    const r = await performSuperAdminWrite(route(() => res(status as number, body as Body)));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.message).toMatch(re as RegExp); expect(r.status).toBe(status); }
  });

  it('401 NOT_AUTHENTICATED → sign in again (no ceremony)', async () => {
    const r = await performSuperAdminWrite(route(() => res(401, { code: 'NOT_AUTHENTICATED' })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/sign in/i);
    expect(mockCeremony).not.toHaveBeenCalled();
  });

  it('429 honours Retry-After; without it gives a sensible wait', async () => {
    const a = await performSuperAdminWrite(route(() => res(429, { error: 'Too many requests. Try again later.' }, { 'retry-after': '17' })));
    if (!a.ok) expect(a.message).toBe('Too many requests. Wait 17 seconds and try again.');
    const b = await performSuperAdminWrite(route(() => res(429, { error: 'Too many requests. Try again later.' })));
    if (!b.ok) expect(b.message).toMatch(/about a minute/);
  });

  it('a network error is reported as not saved', async () => {
    const r = await performSuperAdminWrite(jest.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(r).toMatchObject({ ok: false, status: null });
    if (!r.ok) expect(r.message).toMatch(/Nothing was confirmed as saved/);
  });
});

describe('helpers', () => {
  it('retryAfterSeconds parses delta-seconds and HTTP dates', () => {
    const h = (v: string) => ({ get: () => v }) as unknown as Headers;
    expect(retryAfterSeconds(h('5'))).toBe(5);
    expect(retryAfterSeconds(h(new Date(Date.UTC(2030, 0, 1, 0, 0, 30)).toUTCString()), Date.UTC(2030, 0, 1))).toBe(30);
    expect(retryAfterSeconds(h('soon'))).toBeNull();
    expect(retryAfterSeconds(null)).toBeNull();
  });
  it('describeWriteFailure covers STEP_UP still-required after retry', () => {
    expect(describeWriteFailure(401, { code: 'STEP_UP_REQUIRED' })).toMatch(/passkey confirmation/);
  });
  it('freshIdempotencyHeaders mints a new key per call', () => {
    expect(freshIdempotencyHeaders()['Idempotency-Key']).not.toBe(freshIdempotencyHeaders()['Idempotency-Key']);
  });
});

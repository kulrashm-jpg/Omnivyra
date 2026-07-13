/**
 * AUTH-001 §3 — provider-agnostic CAPTCHA seam.
 *
 * Locks the fail-mode contract:
 *   disabled (no provider)          → ok (no-op)
 *   enabled + missing token         → FAIL (fail-closed)
 *   enabled + provider rejects      → FAIL
 *   enabled + provider verifies     → ok
 *   enabled + provider unreachable  → ok (fail-open, like the rate-limiter SDR)
 *   provider named but no secret    → ok (misconfiguration ≠ signup blackout)
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(),
}));

import { safeFetch } from '../../../lib/security/safeFetch';
import { verifyCaptchaToken, isCaptchaEnabled } from '../../../lib/auth/captcha';

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

function setEnv(provider?: string, secret?: string) {
  if (provider === undefined) delete process.env.CAPTCHA_PROVIDER;
  else process.env.CAPTCHA_PROVIDER = provider;
  if (secret === undefined) delete process.env.CAPTCHA_SECRET_KEY;
  else process.env.CAPTCHA_SECRET_KEY = secret;
}

const providerResponse = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 502, json: async () => body }) as unknown as Response;

describe('AUTH-001 §3 — CAPTCHA verification seam', () => {
  const envBackup = { provider: process.env.CAPTCHA_PROVIDER, secret: process.env.CAPTCHA_SECRET_KEY };

  afterEach(() => setEnv(envBackup.provider, envBackup.secret));

  test('disabled by default: no provider configured → ok/no-op, no outbound call', async () => {
    setEnv(undefined, undefined);
    expect(isCaptchaEnabled()).toBe(false);
    const result = await verifyCaptchaToken('anything', '1.2.3.4');
    expect(result).toEqual({ ok: true, reason: 'disabled' });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  test('unknown provider string is treated as disabled', async () => {
    setEnv('rot13-captcha', 's3cret');
    expect(isCaptchaEnabled()).toBe(false);
    expect((await verifyCaptchaToken('t', null)).ok).toBe(true);
  });

  test('enabled + missing token → fail-closed', async () => {
    setEnv('turnstile', 's3cret');
    expect(isCaptchaEnabled()).toBe(true);
    for (const token of [null, undefined, '', '   ']) {
      const result = await verifyCaptchaToken(token, '1.2.3.4');
      expect(result).toEqual({ ok: false, reason: 'missing_token' });
    }
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  test('enabled + provider rejects token → fail', async () => {
    setEnv('turnstile', 's3cret');
    mockSafeFetch.mockResolvedValueOnce(providerResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
    const result = await verifyCaptchaToken('bad-token', '1.2.3.4');
    expect(result).toEqual({ ok: false, reason: 'rejected' });
  });

  test('enabled + provider verifies → ok, form-encoded POST to the provider URL', async () => {
    setEnv('hcaptcha', 's3cret');
    mockSafeFetch.mockResolvedValueOnce(providerResponse({ success: true }));
    const result = await verifyCaptchaToken('good-token', '9.9.9.9');
    expect(result).toEqual({ ok: true, reason: 'verified' });
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://api.hcaptcha.com/siteverify',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
    const body = String((mockSafeFetch.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('secret=s3cret');
    expect(body).toContain('response=good-token');
    expect(body).toContain('remoteip=9.9.9.9');
  });

  test('enabled + provider unreachable → fail-open (outage must not black out signups)', async () => {
    setEnv('recaptcha', 's3cret');
    mockSafeFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await verifyCaptchaToken('tok', null))).toEqual({ ok: true, reason: 'provider_unreachable' });

    mockSafeFetch.mockResolvedValueOnce(providerResponse({}, false));
    expect((await verifyCaptchaToken('tok', null))).toEqual({ ok: true, reason: 'provider_unreachable' });
  });

  test('provider named but secret missing → fail-open as misconfigured', async () => {
    setEnv('turnstile', undefined);
    expect(isCaptchaEnabled()).toBe(false);
    expect(await verifyCaptchaToken('tok', null)).toEqual({ ok: true, reason: 'misconfigured' });
  });
});

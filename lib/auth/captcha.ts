/**
 * captcha.ts — provider-agnostic CAPTCHA verification seam (AUTH-001, Section 3).
 *
 * SERVER-ONLY. Client widget lives in components/auth/CaptchaWidget.tsx.
 *
 * Configuration (env / runtime):
 *   CAPTCHA_PROVIDER            'turnstile' | 'hcaptcha' | 'recaptcha' | '' (disabled)
 *   CAPTCHA_SECRET_KEY          provider secret (server)
 *   NEXT_PUBLIC_CAPTCHA_PROVIDER + NEXT_PUBLIC_CAPTCHA_SITE_KEY  (client widget)
 *
 * DISABLED BY DEFAULT: with no provider configured, requireCaptcha() is a
 * no-op success — zero behavior change until ops turns it on. This is the
 * "disable via configuration" requirement inverted into safe-by-default
 * rollout: configure → enforce.
 *
 * Fail-mode when ENABLED: fail-closed on missing/invalid token; fail-OPEN on
 * provider outage (verification endpoint unreachable) — consistent with the
 * rate-limiter SDR (lib/auth/rateLimit.ts): CAPTCHA is an abuse-mitigation
 * control, not an authentication control, and a provider outage must not
 * black out signups. Outage bypasses are logged loudly.
 *
 * All three supported providers share the same verify contract
 * (POST form-encoded secret+response → { success: boolean }), so adding a
 * provider = one entry in PROVIDER_VERIFY_URLS.
 */

import { safeFetch } from '../security/safeFetch';
import { logger } from '../../backend/services/logger';
import { recordRawCounter } from '../../backend/observability';

/** Fail-safe counter — CAPTCHA outcomes must never depend on metrics. */
function countCaptchaFailed(reason: string): void {
  try { recordRawCounter('signup.captcha_failed', 1, { reason }); } catch { /* fail-safe */ }
}

export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha';

const PROVIDER_VERIFY_URLS: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha:  'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

export interface CaptchaResult {
  ok: boolean;
  /** 'disabled' | 'verified' | 'missing_token' | 'rejected' | 'provider_unreachable' | 'misconfigured' */
  reason: string;
}

function configuredProvider(): CaptchaProvider | null {
  const p = (process.env.CAPTCHA_PROVIDER ?? '').trim().toLowerCase();
  if (p === 'turnstile' || p === 'hcaptcha' || p === 'recaptcha') return p;
  return null;
}

/** True when a provider + secret are configured (enforcement active). */
export function isCaptchaEnabled(): boolean {
  return configuredProvider() !== null && !!(process.env.CAPTCHA_SECRET_KEY ?? '').trim();
}

/**
 * Verify a client token against the configured provider.
 * Never throws. See fail-mode notes in the header.
 */
export async function verifyCaptchaToken(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<CaptchaResult> {
  const provider = configuredProvider();
  if (!provider) return { ok: true, reason: 'disabled' };

  const secret = (process.env.CAPTCHA_SECRET_KEY ?? '').trim();
  if (!secret) {
    // Provider named but no secret — misconfiguration. Fail open + log loudly
    // rather than blocking all signups on a config mistake.
    logger.error('captcha_misconfigured_no_secret', { provider });
    return { ok: true, reason: 'misconfigured' };
  }

  if (!token || !String(token).trim()) {
    countCaptchaFailed('missing_token');
    return { ok: false, reason: 'missing_token' };
  }

  const body = new URLSearchParams({ secret, response: String(token).trim() });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const res = await safeFetch(
      PROVIDER_VERIFY_URLS[provider],
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      { timeoutMs: 5_000, maxRedirects: 0, metricLabel: `captcha_${provider}` },
    );
    if (!res.ok) {
      logger.warn('captcha_provider_http_error', { provider, status: res.status });
      return { ok: true, reason: 'provider_unreachable' }; // fail-open on outage
    }
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (json.success === true) return { ok: true, reason: 'verified' };
    countCaptchaFailed('rejected');
    return { ok: false, reason: 'rejected' };
  } catch (err) {
    logger.warn('captcha_provider_unreachable', {
      provider,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: true, reason: 'provider_unreachable' }; // fail-open on outage
  }
}

/** Canonical error payload for a failed CAPTCHA check. */
export const CAPTCHA_FAILED_RESPONSE = {
  error: 'CAPTCHA verification failed. Please try again.',
  code:  'CAPTCHA_FAILED',
} as const;

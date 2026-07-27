/**
 * G1 (LC-102 / W1.2) — Capture Abuse Protection.
 *
 * A thin protection layer that WRAPS the existing public capture pipeline — it does
 * not replace validation, tenant resolution, identity, or canonical adoption. Every
 * capability reuses existing platform primitives:
 *   • Rate limiting  — distributed via the canonical Redis client when configured,
 *                      falling back to the existing in-memory limiter (same one
 *                      already guarding /api/website-events/track).
 *   • Bot detection  — the existing `isLikelyBot` heuristic.
 *   • CAPTCHA        — provider-agnostic token verification via the SSRF-safe
 *                      `safeFetch` seam; DARK until `LEAD_CAPTURE_CAPTCHA_SECRET`
 *                      is set (Cloudflare-Turnstile-shaped by default).
 *   • Replay         — single-use submission nonce (Redis SET NX PX, in-memory
 *                      fallback), rejecting a re-posted nonce within the window.
 *
 * Flag: LEAD_CAPTURE_PROTECTION_ENABLED (default ON for rate-limit+bot; CAPTCHA stays
 * dark until its secret exists). Fail-open by design: an infrastructure error in the
 * protection layer never blocks a legitimate capture.
 */

import { checkInMemoryRateLimit, isLikelyBot } from './trackingRateLimitService';
import { safeFetch } from '../../lib/security/safeFetch';

export interface CaptureProtectionInput {
  ip: string | null;
  userAgent: string | null;
  email?: string | null;
  /** Optional client-supplied single-use submission id (replay guard). */
  nonce?: string | null;
  /** Optional CAPTCHA token (verified only when a secret is configured). */
  captchaToken?: string | null;
}

export type CaptureBlockReason = 'rate_limited' | 'bot_detected' | 'captcha_failed' | 'replay_detected';

export interface CaptureProtectionDecision {
  allowed: boolean;
  reason?: CaptureBlockReason;
  httpStatus?: number;
  retryAfterMs?: number;
}

const ALLOW: CaptureProtectionDecision = { allowed: true };

const flagEnabled = (): boolean => {
  const v = process.env.LEAD_CAPTURE_PROTECTION_ENABLED;
  return v !== 'false' && v !== '0';
};
const RATE_LIMIT = Number(process.env.LEAD_CAPTURE_RATE_LIMIT || 20);
const RATE_WINDOW_MS = Number(process.env.LEAD_CAPTURE_RATE_WINDOW_MS || 60_000);
const REPLAY_WINDOW_MS = Number(process.env.LEAD_CAPTURE_REPLAY_WINDOW_MS || 10 * 60_000);

/** Distributed limiter (Redis) with graceful fallback to the in-memory limiter. */
async function rateLimit(key: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  try {
    const { redisConfigured, getStandaloneRedis } = await import('../../lib/redis/canonicalClient');
    if (redisConfigured()) {
      const redis = await getStandaloneRedis('lead_capture_protection');
      const k = `lcap:rl:${key}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.pexpire(k, RATE_WINDOW_MS);
      if (n > RATE_LIMIT) {
        const ttl = await redis.pttl(k);
        return { allowed: false, retryAfterMs: ttl > 0 ? ttl : RATE_WINDOW_MS };
      }
      return { allowed: true, retryAfterMs: 0 };
    }
  } catch {
    /* redis unavailable → fall back */
  }
  return checkInMemoryRateLimit(`lcap:${key}`, RATE_LIMIT, RATE_WINDOW_MS);
}

/** Single-use nonce (replay guard). Returns true if this nonce is FRESH (first use). */
async function claimNonce(nonce: string): Promise<boolean> {
  try {
    const { redisConfigured, getStandaloneRedis } = await import('../../lib/redis/canonicalClient');
    if (redisConfigured()) {
      const redis = await getStandaloneRedis('lead_capture_protection');
      const res = await redis.set(`lcap:nonce:${nonce}`, '1', 'PX', REPLAY_WINDOW_MS, 'NX');
      return res === 'OK';
    }
  } catch {
    /* fall back */
  }
  // In-memory: a limit of 1 in the window means the 2nd claim is rejected.
  return checkInMemoryRateLimit(`lcap:nonce:${nonce}`, 1, REPLAY_WINDOW_MS).allowed;
}

/** Verify a CAPTCHA token (Turnstile-shaped). Only called when a secret is configured. */
async function verifyCaptcha(token: string | null | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.LEAD_CAPTURE_CAPTCHA_SECRET;
  if (!secret) return true; // dark — not enforced
  if (!token) return false;
  const url = process.env.LEAD_CAPTURE_CAPTCHA_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  try {
    const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    const res = await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return Boolean(json?.success);
  } catch {
    return false; // verification error → treat as failed (do not silently allow)
  }
}

/**
 * Evaluate all protection checks. Order: bot → captcha (if configured) → replay → rate.
 * Fail-open: any unexpected error resolves to ALLOW (protection must never break capture).
 */
export async function evaluateCaptureProtection(input: CaptureProtectionInput): Promise<CaptureProtectionDecision> {
  if (!flagEnabled()) return ALLOW;
  try {
    if (isLikelyBot(input.userAgent ?? undefined)) {
      return { allowed: false, reason: 'bot_detected', httpStatus: 403 };
    }
    if (process.env.LEAD_CAPTURE_CAPTCHA_SECRET) {
      const ok = await verifyCaptcha(input.captchaToken, input.ip);
      if (!ok) return { allowed: false, reason: 'captcha_failed', httpStatus: 403 };
    }
    if (input.nonce) {
      const fresh = await claimNonce(input.nonce);
      if (!fresh) return { allowed: false, reason: 'replay_detected', httpStatus: 409 };
    }
    const rl = await rateLimit(input.ip || input.email || 'anon');
    if (!rl.allowed) return { allowed: false, reason: 'rate_limited', httpStatus: 429, retryAfterMs: rl.retryAfterMs };
    return ALLOW;
  } catch {
    return ALLOW; // fail-open
  }
}

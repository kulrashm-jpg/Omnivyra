/**
 * Provider-specific SANDBOX webhook signature verification.
 *
 * Replaces the generic HMAC foundation with the real per-provider sandbox
 * verification scheme for each governed provider:
 *
 *   Razorpay  — HMAC-SHA256(rawBody) hex, header x-razorpay-signature
 *   Stripe    — `t=<ts>,v1=<sig>` scheme; HMAC-SHA256(`<t>.<rawBody>`); the
 *               timestamp is checked against a replay window
 *   Cashfree  — HMAC-SHA256(`<timestamp><rawBody>`) base64; header
 *               x-webhook-signature + x-webhook-timestamp (replay window)
 *   PhonePe   — X-VERIFY: sha256(base64(rawBody) + saltKey) + '###' + saltIndex
 *
 * STRICTLY sandbox/test mode:
 *   - Secrets are read from SETTLEMENT_WEBHOOK_SANDBOX_SECRET_<PROVIDER> (the
 *     PhonePe value is the salt key). NO live/production signing keys are wired.
 *   - When a provider has no sandbox secret configured the webhook is REJECTED
 *     with reason `secret_not_configured`. The previous fall-open behaviour
 *     ("accept unverified") let any actor with a known checkout session
 *     reference drive the settlement state machine through
 *     pending→authorized→succeeded by POSTing to the endpoint.
 *   - An operator can opt back into the legacy unverified-accept behaviour
 *     for local dev by setting SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX=true.
 *     This MUST NOT be set in any shared/production-like environment.
 *   - Verification is pure + deterministic + constant-time; `nowMs` is
 *     injectable so the replay-window behaviour is unit-testable.
 *
 * Carries NO pricing data and performs NO settlement side-effect — it answers
 * one question: is this sandbox webhook authentic and fresh?
 */

import crypto from 'crypto';
import type { SupportedProvider } from './paymentProviderAdapter';

export type WebhookVerificationReason =
  | 'missing_signature'
  | 'malformed_signature'
  | 'signature_mismatch'
  | 'stale_timestamp'
  | 'secret_not_configured';

export interface WebhookVerificationResult {
  ok: boolean;
  mode: 'verified' | 'unverified_sandbox';
  reason?: WebhookVerificationReason;
}

export interface WebhookVerificationInput {
  provider: SupportedProvider;
  rawBody: string;
  /** Lowercased HTTP header map (Next.js req.headers is already lowercased). */
  headers: Record<string, string | string[] | undefined>;
  /** Injectable clock (ms) — defaults to Date.now(). */
  nowMs?: number;
  /** Injectable replay tolerance — defaults to the env / 300s. */
  replayToleranceSeconds?: number;
}

const DEFAULT_REPLAY_TOLERANCE_SECONDS = 300;

function header(h: WebhookVerificationInput['headers'], name: string): string {
  const v = h[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
}

/** Constant-time string compare with a length guard (timingSafeEqual throws on
 *  unequal length). An empty input never matches. */
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sandboxSecret(provider: SupportedProvider): string | undefined {
  const v = process.env[`SETTLEMENT_WEBHOOK_SANDBOX_SECRET_${provider.toUpperCase()}`];
  return v && v.trim() !== '' ? v : undefined;
}

function replayToleranceSeconds(input: WebhookVerificationInput): number {
  if (typeof input.replayToleranceSeconds === 'number' && input.replayToleranceSeconds > 0) {
    return input.replayToleranceSeconds;
  }
  const env = Number(process.env.SETTLEMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_REPLAY_TOLERANCE_SECONDS;
}

/** Parse a provider timestamp header into epoch-ms; null when unparseable. */
function parseTimestampMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (Number.isFinite(n) && n > 0) {
    // Heuristic: > 1e12 is already milliseconds, otherwise seconds.
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const FAIL = (reason: WebhookVerificationReason): WebhookVerificationResult =>
  ({ ok: false, mode: 'verified', reason });
const PASS: WebhookVerificationResult = { ok: true, mode: 'verified' };

// ── Razorpay — HMAC-SHA256 hex over the canonical raw body ──────────────────
function verifyRazorpay(input: WebhookVerificationInput, secret: string): WebhookVerificationResult {
  const sig = header(input.headers, 'x-razorpay-signature').trim().toLowerCase();
  if (!sig) return FAIL('missing_signature');
  const expected = crypto.createHmac('sha256', secret).update(input.rawBody).digest('hex');
  return constantTimeEqual(sig, expected) ? PASS : FAIL('signature_mismatch');
}

// ── Stripe — `t=<ts>,v1=<sig>`; HMAC-SHA256(`<t>.<rawBody>`) + replay window ─
function verifyStripe(input: WebhookVerificationInput, secret: string): WebhookVerificationResult {
  const sigHeader = header(input.headers, 'stripe-signature');
  if (!sigHeader) return FAIL('missing_signature');

  let t = '';
  const v1: string[] = [];
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (k === 't') t = val;
    else if (k === 'v1') v1.push(val);
  }
  if (!t || v1.length === 0) return FAIL('malformed_signature');

  const tsSec = Number(t);
  if (!Number.isFinite(tsSec)) return FAIL('malformed_signature');

  // Replay-window validation — a stale signed timestamp is rejected.
  const nowSec = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSec - tsSec) > replayToleranceSeconds(input)) return FAIL('stale_timestamp');

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${input.rawBody}`).digest('hex');
  const match = v1.some((candidate) => constantTimeEqual(candidate.toLowerCase(), expected));
  return match ? PASS : FAIL('signature_mismatch');
}

// ── Cashfree — HMAC-SHA256(`<timestamp><rawBody>`) base64 + replay window ───
function verifyCashfree(input: WebhookVerificationInput, secret: string): WebhookVerificationResult {
  const sig = header(input.headers, 'x-webhook-signature').trim();
  const ts = header(input.headers, 'x-webhook-timestamp').trim();
  if (!sig) return FAIL('missing_signature');

  // Replay-window validation when a timestamp header is present.
  if (ts) {
    const tsMs = parseTimestampMs(ts);
    if (tsMs !== null) {
      const nowMs = input.nowMs ?? Date.now();
      if (Math.abs(nowMs - tsMs) > replayToleranceSeconds(input) * 1000) return FAIL('stale_timestamp');
    }
  }

  // Cashfree canonicalization: timestamp prepended to the raw body.
  const expected = crypto.createHmac('sha256', secret).update(`${ts}${input.rawBody}`).digest('base64');
  return constantTimeEqual(sig, expected) ? PASS : FAIL('signature_mismatch');
}

// ── PhonePe — X-VERIFY: sha256(base64(rawBody)+saltKey)###saltIndex ─────────
function verifyPhonepe(input: WebhookVerificationInput, saltKey: string): WebhookVerificationResult {
  const xverify = header(input.headers, 'x-verify').trim();
  if (!xverify) return FAIL('missing_signature');

  const hashPart = xverify.split('###')[0]?.trim().toLowerCase() ?? '';
  const indexPart = xverify.split('###')[1]?.trim() ?? '';
  if (!hashPart) return FAIL('malformed_signature');

  // PhonePe canonicalization: sha256 over base64(payload) concatenated with the
  // sandbox salt key; the salt index is appended after '###'.
  const base64Body = Buffer.from(input.rawBody, 'utf8').toString('base64');
  const expectedHash = crypto.createHash('sha256').update(base64Body + saltKey).digest('hex');
  const expectedIndex = (process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE || '1').trim();

  const hashOk = constantTimeEqual(hashPart, expectedHash);
  const indexOk = indexPart === '' || indexPart === expectedIndex;
  return hashOk && indexOk ? PASS : FAIL('signature_mismatch');
}

/**
 * Operator opt-in for the legacy unverified-accept behaviour. Only honour the
 * flag when it is explicitly set to the string `'true'` — any other value
 * (unset, empty, `'1'`, `'false'`) keeps the secure default.
 */
function isUnverifiedSandboxExplicitlyAllowed(): boolean {
  return process.env.SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX === 'true';
}

/**
 * Verify a sandbox provider webhook. Deterministic, constant-time, side-effect
 * free. When no sandbox secret is configured the webhook is REJECTED with
 * reason `secret_not_configured` — the operator must either provision the
 * provider's `SETTLEMENT_WEBHOOK_SANDBOX_SECRET_*` env var or explicitly
 * opt into unverified acceptance via `SETTLEMENT_WEBHOOK_ALLOW_UNVERIFIED_SANDBOX`.
 */
export function verifyProviderWebhookSignature(
  input: WebhookVerificationInput,
): WebhookVerificationResult {
  const secret = sandboxSecret(input.provider);
  if (!secret) {
    if (isUnverifiedSandboxExplicitlyAllowed()) {
      return { ok: true, mode: 'unverified_sandbox' };
    }
    return FAIL('secret_not_configured');
  }

  switch (input.provider) {
    case 'razorpay': return verifyRazorpay(input, secret);
    case 'stripe':   return verifyStripe(input, secret);
    case 'cashfree': return verifyCashfree(input, secret);
    case 'phonepe':  return verifyPhonepe(input, secret);
    default:         return FAIL('missing_signature');
  }
}

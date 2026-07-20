/**
 * WAVE-1D-001 — Provider Gateway retry policy + error normalization (realizes
 * AI-CONTRACT-000 §C1 gateway hardening). Pure, deterministic, testable rules the
 * gateway adopts — NOT a new gateway, NOT a provider-selection change.
 *
 *   - classifyProviderError: is this error retryable? which class? → one place.
 *   - computeBackoffMs: deterministic, bounded exponential backoff with equal jitter.
 *   - normalizeProviderError: map any provider failure → the canonical AiError.
 *
 * Retryable ONLY: rate-limit (429/529), transient server (5xx), transport/network,
 * timeout. NEVER retryable: auth (401/403), validation (400/422), aborts, permanent
 * provider errors — and (by construction, upstream) prompt-safety / moderation /
 * schema-validation failures, which never reach the provider call.
 */
import { AiError, type AiErrorCode } from './aiError';

export type ProviderErrorClass =
  | 'rate_limit' | 'server_error' | 'network' | 'timeout'
  | 'auth' | 'validation' | 'aborted' | 'unknown';

export interface ProviderErrorClassification {
  class: ProviderErrorClass;
  status?: number;
  code: AiErrorCode;
  /** Retryable transient failure (bounded retry eligible). */
  retryable: boolean;
  /** True for rate-limit/overload specifically (the always-on legacy retry class). */
  rateLimit: boolean;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } } | null;
  return e?.status ?? e?.response?.status ?? e?.statusCode;
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null;
  return e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.code === 'PROVIDER_ABORTED';
}

function isNetwork(err: unknown): boolean {
  const e = err as { code?: string } | null;
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.code === 'ECONNRESET' ||
    e?.code === 'ETIMEDOUT' || msg.includes('fetch failed') || msg.includes('network') || msg.includes('socket hang up')
  );
}

function isTimeout(err: unknown): boolean {
  const e = err as { killed?: boolean; code?: string } | null;
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return e?.killed === true || e?.code === 'ETIMEDOUT' || msg.includes('timed out') || msg.includes('timeout');
}

/** Classify a provider error into a retry/normalization class. Deterministic. */
export function classifyProviderError(err: unknown): ProviderErrorClassification {
  const status = statusOf(err);
  if (isAbort(err)) return { class: 'aborted', status, code: 'PROVIDER_ERROR', retryable: false, rateLimit: false };
  if (status === 429 || status === 529) return { class: 'rate_limit', status, code: 'PROVIDER_ERROR', retryable: true, rateLimit: true };
  if (status === 401 || status === 403) return { class: 'auth', status, code: 'PROVIDER_ERROR', retryable: false, rateLimit: false };
  if (status === 400 || status === 422) return { class: 'validation', status, code: 'VALIDATION_REJECTED', retryable: false, rateLimit: false };
  if (isTimeout(err)) return { class: 'timeout', status, code: 'GATEWAY_TIMEOUT', retryable: true, rateLimit: false };
  if (isNetwork(err)) return { class: 'network', status, code: 'PROVIDER_ERROR', retryable: true, rateLimit: false };
  if (typeof status === 'number' && status >= 500) return { class: 'server_error', status, code: 'PROVIDER_ERROR', retryable: true, rateLimit: false };
  return { class: 'unknown', status, code: 'PROVIDER_ERROR', retryable: false, rateLimit: false };
}

export interface BackoffOptions { baseMs?: number; factor?: number; maxMs?: number; jitter?: boolean }

/**
 * Deterministic, bounded exponential backoff with equal jitter.
 * attempt 1 → ~[base/2, base]; capped at maxMs. Jitter bounded (never exceeds the
 * exponential value), so behavior is predictable and de-synchronizes retries.
 */
export function computeBackoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 2000;
  const factor = opts.factor ?? 2;
  const maxMs = opts.maxMs ?? 30_000;
  const raw = Math.min(maxMs, base * Math.pow(factor, Math.max(0, attempt - 1)));
  if (opts.jitter === false) return Math.round(raw);
  // Equal jitter: half fixed + half random in [0, raw/2].
  const jittered = raw / 2 + Math.random() * (raw / 2);
  return Math.round(Math.min(maxMs, jittered));
}

const CODE_MESSAGE: Partial<Record<ProviderErrorClass, string>> = {
  rate_limit: 'The AI provider is rate-limited. Please try again shortly.',
  server_error: 'The AI provider is temporarily unavailable. Please try again.',
  network: 'A network error reached the AI provider. Please try again.',
  timeout: 'The AI provider timed out. Please try again.',
  auth: 'AI provider authentication failed.',
  validation: 'The AI request was rejected as invalid.',
  aborted: 'The AI request was cancelled.',
  unknown: 'An unexpected AI provider error occurred.',
};

/**
 * Map ANY provider failure to the canonical AiError. No provider-specific
 * exception should escape the gateway boundary once this is applied.
 */
export function normalizeProviderError(err: unknown, opts: { correlationId?: string; provider?: string } = {}): AiError {
  const c = classifyProviderError(err);
  const devDetail = `provider=${opts.provider ?? '?'} class=${c.class} status=${c.status ?? '?'}: ${err instanceof Error ? err.message : String(err)}`;
  return new AiError(c.class === 'timeout' ? 'GATEWAY_TIMEOUT' : c.code, {
    userMessage: CODE_MESSAGE[c.class],
    devDetail,
    retryable: c.retryable,
    correlationId: opts.correlationId,
    severity: c.class === 'auth' || c.class === 'unknown' ? 'error' : 'warn',
  });
}

/**
 * F-10 — Canonical Outbound HTTP Layer (Foundation Batch C).
 *
 * ONE function for outbound HTTP: `platformFetch` = safeFetch (the untouched
 * SSRF security core) + external-call metrics (observeExternalCall) + default
 * timeout + opt-in trace-header propagation. The ~72 adapter files with raw
 * fetch/axios (audit B-98) migrate onto this in Wave 2 — no adapter is
 * migrated in Batch C.
 *
 * BATCH C CONTRACT:
 *   - Security validation is DELEGATED, never reimplemented or bypassed —
 *     every request goes through safeFetch's pinned-lookup dispatcher.
 *   - Keep-alive is NOT enabled. The agent-lifecycle seam exists
 *     (configureOutboundAgents / outboundAgentPolicy) so W2-5 can flip it in
 *     ONE place, but the default policy is byte-identical to today
 *     (per-call agents inside safeFetch).
 *   - Trace propagation is opt-in per call (adds x-correlation-id /
 *     x-request-id request headers ONLY when `propagateTrace: true`) — no
 *     outbound request changes shape unless a call site asks.
 */
import { safeFetch, type SafeFetchOptions } from '../security/safeFetch';
import { observeExternalCall } from '../../backend/observability';
import { getRequestContext } from '../../backend/services/requestContext';

// ── Agent lifecycle seam (W2-5 target; default = today's behavior) ───────────

export interface OutboundAgentPolicy {
  /** false (Batch C default): safeFetch builds per-call agents (today). */
  keepAlive: boolean;
}

let agentPolicy: OutboundAgentPolicy = { keepAlive: false };

/**
 * W2-5: programmatic control of the safeFetch keep-alive pool. Sets the
 * 'outbound-keepalive' rollout flag via its env override (the flag is
 * re-resolved per call, so this takes effect immediately; the env-var
 * indirection avoids a module cycle with lib/security/safeFetch).
 */
export function configureOutboundAgents(policy: OutboundAgentPolicy): void {
  agentPolicy = { ...policy };
  try {
    process.env.ROLLOUT_OUTBOUND_KEEPALIVE_MODE = policy.keepAlive ? 'enforce' : 'off';
  } catch { /* fail-safe */ }
}

export function outboundAgentPolicy(): OutboundAgentPolicy {
  return { ...agentPolicy };
}

// ── Canonical fetch ───────────────────────────────────────────────────────────

export interface PlatformFetchOptions extends SafeFetchOptions {
  /** Attach the caller's trace/request ids as outbound headers. Default false. */
  propagateTrace?: boolean;
  /** Metrics label override (defaults to the URL host via observeExternalCall). */
  metricsHost?: string;
}

/**
 * Canonical outbound HTTP call. Every request is:
 *   1. SSRF-validated + dispatched by safeFetch (timeouts, size caps,
 *      redirect re-validation — all unchanged),
 *   2. timed into the HARDEN-001 external.* metrics,
 *   3. optionally trace-stamped (opt-in).
 */
export async function platformFetch(
  url: string,
  init: RequestInit = {},
  options: PlatformFetchOptions = {},
): Promise<Response> {
  const { propagateTrace, metricsHost, ...safeOptions } = options;

  let finalInit = init;
  if (propagateTrace) {
    try {
      const ctx = getRequestContext();
      const traceId = ctx.traceId || ctx.correlationId || ctx.requestId;
      if (traceId) {
        const headers = new Headers(init.headers as HeadersInit | undefined);
        if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', traceId);
        if (ctx.requestId && !headers.has('x-request-id')) headers.set('x-request-id', ctx.requestId);
        finalInit = { ...init, headers };
      }
    } catch { /* trace stamping must never break the call */ }
  }

  const host = metricsHost ?? url;
  return observeExternalCall(host, () => safeFetch(url, finalInit, safeOptions));
}

// Re-export the security surface so call sites need exactly one import.
export { SsrfBlockedError, readCapped, safeFetchBuffer, assertUrlSafe } from '../security/safeFetch';
export type { SafeFetchOptions } from '../security/safeFetch';

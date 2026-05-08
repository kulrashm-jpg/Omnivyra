// Per-provider circuit breaker.
//
// Production orchestration primitive that protects the report from a flapping
// upstream. States:
//
//   closed    — calls flow through normally
//   open      — too many consecutive failures; calls short-circuit to
//                `unavailable` until cool-down expires
//   half-open — cool-down expired; one probe call is allowed; success → closed,
//                failure → open again
//
// A failing provider can NEVER block the report: if the breaker is open, the
// caller must surface the well-formed `unavailable` result the registry's
// default Unavailable* providers always return.

export type BreakerState = 'closed' | 'open' | 'half_open';

export type BreakerConfig = {
  failureThreshold: number;
  cooldownMs: number;
  successThresholdInHalfOpen: number;
};

const DEFAULT_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000, // 1 min cooldown
  successThresholdInHalfOpen: 2,
};

type BreakerCounters = {
  state: BreakerState;
  consecutiveFailures: number;
  successesInHalfOpen: number;
  openedAt: number | null;
};

const breakers = new Map<string, BreakerCounters>();

function ensureBreaker(providerId: string): BreakerCounters {
  const existing = breakers.get(providerId);
  if (existing) return existing;
  const fresh: BreakerCounters = {
    state: 'closed',
    consecutiveFailures: 0,
    successesInHalfOpen: 0,
    openedAt: null,
  };
  breakers.set(providerId, fresh);
  return fresh;
}

export function shouldShortCircuit(providerId: string, config: BreakerConfig = DEFAULT_CONFIG): {
  shortCircuit: boolean;
  state: BreakerState;
  reason: string | null;
} {
  const breaker = ensureBreaker(providerId);
  if (breaker.state === 'open' && breaker.openedAt != null) {
    if (Date.now() - breaker.openedAt >= config.cooldownMs) {
      breaker.state = 'half_open';
      breaker.successesInHalfOpen = 0;
      return { shortCircuit: false, state: 'half_open', reason: null };
    }
    return {
      shortCircuit: true,
      state: 'open',
      reason: `circuit_open:${providerId} (cool-down ${Math.round((config.cooldownMs - (Date.now() - breaker.openedAt)) / 1000)}s remaining)`,
    };
  }
  return { shortCircuit: false, state: breaker.state, reason: null };
}

export function recordSuccess(providerId: string, config: BreakerConfig = DEFAULT_CONFIG): void {
  const breaker = ensureBreaker(providerId);
  if (breaker.state === 'half_open') {
    breaker.successesInHalfOpen += 1;
    if (breaker.successesInHalfOpen >= config.successThresholdInHalfOpen) {
      breaker.state = 'closed';
      breaker.consecutiveFailures = 0;
      breaker.successesInHalfOpen = 0;
      breaker.openedAt = null;
    }
    return;
  }
  breaker.consecutiveFailures = 0;
}

export function recordFailure(providerId: string, config: BreakerConfig = DEFAULT_CONFIG): void {
  const breaker = ensureBreaker(providerId);
  breaker.consecutiveFailures += 1;
  if (breaker.state === 'half_open') {
    breaker.state = 'open';
    breaker.openedAt = Date.now();
    breaker.successesInHalfOpen = 0;
    return;
  }
  if (breaker.consecutiveFailures >= config.failureThreshold) {
    breaker.state = 'open';
    breaker.openedAt = Date.now();
  }
}

export function snapshotBreakers(): Array<{
  provider_id: string;
  state: BreakerState;
  consecutive_failures: number;
  opened_at: string | null;
}> {
  return [...breakers.entries()].map(([provider_id, b]) => ({
    provider_id,
    state: b.state,
    consecutive_failures: b.consecutiveFailures,
    opened_at: b.openedAt ? new Date(b.openedAt).toISOString() : null,
  }));
}

/** Test helper. */
export function _resetCircuitBreakers(): void {
  breakers.clear();
}

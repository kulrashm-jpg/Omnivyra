/**
 * Canonical Provider Health Service
 * ---------------------------------
 * ONE place to read every external provider's operational health. Derives state
 * from the canonical catalog (credentials, enablement) + the cost governor
 * (kill-switch, budget) — NEVER fires a paid probe. No UI.
 *
 * States exposed per provider:
 *   reachable       — best-effort: credentials present and not killed (config-
 *                     derived, NOT a live network probe — see limitations)
 *   authenticated   — all required credential env keys are present
 *   quotaRemaining  — remaining budget units (null when no ceiling configured)
 *   enabled         — catalog default AND not killed
 *   degraded        — dry-run active, or budget near/over ceiling
 *   unavailable     — killed, or a paid provider with missing credentials
 */

import {
  PROVIDER_CATALOG,
  ALL_PROVIDER_IDS,
  getProviderDescriptor,
  type ProviderDescriptor,
} from './providerCatalog';
import { isProviderKilled, isDryRun, authorizeProviderCall, getProviderOutcome } from './providerCostGovernor';

export interface ProviderHealth {
  id: string;
  category: string;
  reachable: boolean;
  authenticated: boolean;
  quotaRemaining: number | null;
  enabled: boolean;
  /** Whether this provider's calls pass through the cost governor. */
  governed: boolean;
  degraded: boolean;
  unavailable: boolean;
  /** Last successful / failed call (in-process), for operational visibility. */
  lastSuccess: string | null;
  lastFailure: string | null;
  /** Human-readable state summary. */
  status: 'connected' | 'awaiting_credentials' | 'disabled' | 'killed' | 'degraded' | 'not_integrated';
}

function isAuthenticated(descriptor: ProviderDescriptor): boolean {
  if (descriptor.authType === 'none') return true;
  if (descriptor.envKeys.length === 0) return true;
  return descriptor.envKeys.every((k) => {
    const v = process.env[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function getProviderHealth(id: string): ProviderHealth | null {
  const descriptor = getProviderDescriptor(id);
  if (!descriptor) return null;

  const killed = isProviderKilled(id);
  const authenticated = isAuthenticated(descriptor);
  const dryRun = isDryRun();
  // Budget headroom without spending: authorize a zero-effect probe.
  const decision = authorizeProviderCall({ providerId: id, estimatedUnits: 0 });
  const quotaRemaining = decision.remaining.daily ?? decision.remaining.monthly ?? null;
  const budgetExhausted =
    (decision.remaining.daily !== null && decision.remaining.daily <= 0) ||
    (decision.remaining.monthly !== null && decision.remaining.monthly <= 0);

  const enabled = descriptor.enabled && !killed;
  const unavailable = killed || (descriptor.paid && !authenticated);
  const degraded = !unavailable && (dryRun || budgetExhausted);
  // No live probe — reachability is inferred from credentials + not-killed.
  const reachable = !killed && authenticated;

  let status: ProviderHealth['status'];
  if (!descriptor.integrated) status = 'not_integrated';
  else if (killed) status = 'killed';
  else if (descriptor.paid && !authenticated) status = 'awaiting_credentials';
  else if (!enabled) status = 'disabled';
  else if (degraded) status = 'degraded';
  else status = 'connected';

  const outcome = getProviderOutcome(id);
  return {
    id,
    category: descriptor.category,
    reachable,
    authenticated,
    quotaRemaining,
    enabled,
    governed: descriptor.governedVia !== 'none',
    degraded,
    unavailable,
    lastSuccess: outcome.lastSuccessAt,
    lastFailure: outcome.lastFailureAt,
    status,
  };
}

export function getAllProviderHealth(): ProviderHealth[] {
  return ALL_PROVIDER_IDS.map((id) => getProviderHealth(id)).filter(
    (h): h is ProviderHealth => h !== null,
  );
}

/** Providers currently operational (authenticated, enabled, not killed/degraded). */
export function healthyProviderIds(): string[] {
  return getAllProviderHealth()
    .filter((h) => h.status === 'connected')
    .map((h) => h.id);
}

export const PROVIDER_HEALTH_PROVIDERS = Object.keys(PROVIDER_CATALOG);

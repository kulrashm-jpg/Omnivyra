/**
 * AI Gateway Billing Guard — C-2 closure
 *
 * Enforces that every call into the AI Gateway carries either:
 *   (a) a CreditHandle (token-priced HOLD already in flight), OR
 *   (b) an explicit untracked-action allowlist entry in `credit_untracked_actions`.
 *
 * Rollout posture:
 *   - Phase 1 (this commit): "shadow" mode by default. Emits an anomaly +
 *     bumps the `untracked_ai_call_blocked_total` counter on violations
 *     but does NOT throw. Set BILLING_REQUIRE_AI_HANDLE=true to enforce.
 *   - Phase 2 (follow-up): flip the default to enforce; remove shadow mode.
 *
 * Callers that legitimately bypass billing (e.g. internal debug operations,
 * pre-purchase preview workflows) must register an entry in
 * `credit_untracked_actions` with a justification and approver. Once
 * registered, the operation key is allowlisted.
 *
 * Backward compatibility:
 *   - aiGateway.runCompletionWithOperation() continues to work unchanged.
 *   - This guard is invoked from a small wrapper (`runBilledCompletion()`)
 *     that callers progressively migrate to.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { emitAnomaly } from './billingAuditEmitter';
import { incrCounter } from './billingMetrics';

const ENV_FLAG = 'BILLING_REQUIRE_AI_HANDLE';
const ALLOWLIST_CACHE_TTL_MS = 60_000;
let allowlistCache: { set: Set<string>; expiresAt: number } | null = null;

export interface CreditHandle {
  operationId:    string;
  idempotencyKey: string;
  orgId:          string;
  action:         string;
  source:         'orchestrator' | 'queue_middleware' | 'http';
  amountReserved?: number;
}

export interface AiBillingGuardResult {
  allowed:    boolean;
  reason:     'has_handle' | 'allowlisted' | 'shadow_mode' | 'enforced_block';
  metadata?:  Record<string, unknown>;
}

export function isAiBillingEnforced(): boolean {
  return String(process.env[ENV_FLAG] ?? '').toLowerCase() === 'true';
}

async function loadAllowlist(): Promise<Set<string>> {
  const now = Date.now();
  if (allowlistCache && allowlistCache.expiresAt > now) return allowlistCache.set;

  const { data, error } = await supabase
    .from('credit_untracked_actions')
    .select('action_key, expires_at');

  if (error) {
    logger.warn('untracked_action_allowlist_load_failed', { message: error.message });
    return allowlistCache?.set ?? new Set();
  }

  const set = new Set<string>();
  const nowIso = new Date().toISOString();
  for (const r of (data ?? []) as Array<{ action_key: string; expires_at: string | null }>) {
    if (r.expires_at && r.expires_at < nowIso) continue;
    set.add(r.action_key);
  }
  allowlistCache = { set, expiresAt: now + ALLOWLIST_CACHE_TTL_MS };
  return set;
}

/**
 * Inspect a call site. Either it has a credit handle, or its operation is
 * allowlisted. In shadow mode, violations are observed but allowed.
 */
export async function checkAiBillingGuard(args: {
  operation:     string;
  creditHandle?: CreditHandle;
  orgId?:        string;
}): Promise<AiBillingGuardResult> {
  if (args.creditHandle) {
    return { allowed: true, reason: 'has_handle', metadata: { handleAction: args.creditHandle.action } };
  }

  const allowlist = await loadAllowlist();
  if (allowlist.has(args.operation)) {
    return { allowed: true, reason: 'allowlisted' };
  }

  // Violation — handle missing AND operation not allowlisted.
  incrCounter('untracked_ai_call_blocked_total');
  emitAnomaly({
    organizationId: args.orgId,
    kind: 'untracked_ai_call_blocked',
    severity: isAiBillingEnforced() ? 'critical' : 'warn',
    message: `aiGateway call with no credit handle and no allowlist entry: operation=${args.operation}`,
    metadata: { operation: args.operation, enforced: isAiBillingEnforced() },
  });

  if (!isAiBillingEnforced()) {
    return { allowed: true, reason: 'shadow_mode' };
  }
  return { allowed: false, reason: 'enforced_block' };
}

/**
 * Wrapper for callers migrating to the new contract. Either pass a CreditHandle
 * from an enclosing orchestrator scope, or rely on shadow mode during the
 * rollout window. The wrapper itself doesn't call the gateway — it returns a
 * guard result that the caller checks before invoking aiGateway.
 *
 * Typical migration pattern at a call site:
 *
 *   const handle = await runBilledOperation({...});
 *   const guard = await checkAiBillingGuard({ operation: 'refineVariant', creditHandle: { ... } });
 *   if (!guard.allowed) throw new Error('Billing required: refineVariant');
 *   await runCompletionWithOperation({ ..., operation: 'refineVariant' });
 */

export function invalidateAllowlistCache(): void {
  allowlistCache = null;
}

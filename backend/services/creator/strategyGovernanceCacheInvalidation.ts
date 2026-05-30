/**
 * Strategy Governance Cache Invalidation (Final Creator Governance
 * Closure Pass — Phase 2).
 *
 * Additive future-proofing hooks. Today's governance policy registry
 * is statically compiled into the bundle, so there is no per-process
 * governance cache to invalidate. This module exists so that future
 * runtime-tunable policies (admin-UI overrides, per-company policy
 * overrides, etc.) can be plumbed in without an architecture change.
 *
 * STRICT SCOPE:
 *   - NO BEHAVIOR CHANGES today. The two public functions are no-ops
 *     until callers register invalidation handlers via
 *     `registerGovernanceCacheInvalidator`.
 *   - NO admin UI.
 *   - NO persistence changes.
 *   - NO new analytics / publishing / variant edits.
 *
 * Design:
 *   - `registerGovernanceCacheInvalidator(fn)` adds a handler.
 *   - `invalidateGovernanceCaches()` invokes every registered handler.
 *   - `onGovernancePolicyChanged(payload)` fires when an admin surface
 *     mutates a policy at runtime (no such surface exists today; the
 *     hook is reserved). Invokes registered handlers AND fires
 *     audit-log events so the compliance trail captures who changed
 *     what / when.
 *
 * Failure semantics: every handler call is wrapped in try/catch. A
 * misbehaving handler cannot break the rest of the chain.
 */

import { recordAuditEvent } from '../auditEventService';

export type GovernanceCacheInvalidator = (
  scope?: { companyId?: string | null; industry?: string | null },
) => void | Promise<void>;

export type GovernancePolicyChangeEvent = {
  industry?: string | null;
  companyId?: string | null;
  changedBy?: string | null;
  /** Free-form summary of what changed. Stored on the audit event. */
  reason?: string | null;
};

const handlers: GovernanceCacheInvalidator[] = [];

/**
 * Register a handler that runs whenever `invalidateGovernanceCaches`
 * fires. Idempotent — registering the same function twice does NOT
 * deduplicate (intentional: callers may want to register and later
 * unregister via the returned dispose function).
 *
 * Returns a dispose function that removes the registered handler.
 */
export function registerGovernanceCacheInvalidator(
  fn: GovernanceCacheInvalidator,
): () => void {
  handlers.push(fn);
  return () => {
    const idx = handlers.indexOf(fn);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

/**
 * Invokes every registered invalidator. Best-effort: a handler that
 * throws does NOT stop the chain. Returns the number of handlers
 * that fired successfully.
 *
 * Today this is a no-op when no handlers have been registered, so
 * calling it is harmless. Reserved for future runtime-policy paths.
 */
export async function invalidateGovernanceCaches(
  scope?: { companyId?: string | null; industry?: string | null },
): Promise<number> {
  let ok = 0;
  for (const fn of handlers) {
    try {
      await fn(scope);
      ok += 1;
    } catch (err) {
      console.warn('[governance-cache-invalidate][handler-failed]', {
        message: err instanceof Error ? err.message : String(err),
        scope,
      });
    }
  }
  return ok;
}

/**
 * Called when a policy mutation lands at runtime. Today there is no
 * admin surface for this; the hook is reserved. When invoked, it:
 *
 *   1. Records an audit event so the compliance trail captures who
 *      changed what.
 *   2. Invokes `invalidateGovernanceCaches({ companyId, industry })`
 *      so any per-process caches refresh on next read.
 *
 * Best-effort. Never throws. The audit write goes through the
 * existing `recordAuditEvent` infrastructure.
 */
export async function onGovernancePolicyChanged(
  event: GovernancePolicyChangeEvent,
): Promise<void> {
  try {
    await recordAuditEvent({
      companyId: event.companyId ?? '',
      actorUserId: event.changedBy ?? null,
      actorType: event.changedBy ? 'user' : 'system',
      action: 'strategy_governance.policy_changed',
      resourceType: 'strategy_governance_policy',
      resourceId: event.industry ?? 'global',
      severity: 'info',
      metadata: {
        industry: event.industry ?? null,
        company_id: event.companyId ?? null,
        reason: event.reason ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Best-effort.
  }
  try {
    await invalidateGovernanceCaches({
      companyId: event.companyId ?? null,
      industry: event.industry ?? null,
    });
  } catch {
    // Best-effort.
  }
}

/* ── Diagnostics (test surface) ─────────────────────────────────── */

export function governanceCacheInvalidationStats(): {
  registeredHandlerCount: number;
} {
  return { registeredHandlerCount: handlers.length };
}

/** Test-only — drop every registered handler. NOT used in production. */
export function _resetGovernanceCacheInvalidatorsForTests(): void {
  handlers.length = 0;
}

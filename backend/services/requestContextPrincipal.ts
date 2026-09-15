/**
 * SEC-91 W2-A (STEP 3AH-91, W2A-4) — authenticated-principal attribution for
 * the request context.
 *
 * WHY
 * ---
 * HARDEN-006's AI guard (backend/services/ai/aiRequestGuard.ts) keys its
 * per-user / per-company / burst layers on the request context's `userId`
 * (the gateway passes no userId of its own). With no userId and no ip, a call
 * is inferred to be BACKGROUND work and those layers are skipped. Two facts made
 * that the normal case for interactive gateway calls (SEC-D D1d):
 *
 *   1. Most routes authenticate through resolveUserContext / enforceCompanyAccess
 *      / requireCampaignAccess, which never recorded the principal at all.
 *   2. requireTenantAccess DID record it — via mergeRequestContext(), i.e.
 *      AsyncLocalStorage.enterWith() inside an awaited callee. A store entered
 *      there is not visible to the caller once the callee returns, so even
 *      those routes' later gateway calls ran without a userId.
 *
 * WHAT
 * ----
 * The auth seams call attributeAuthenticatedPrincipal() after a SUCCESSFUL
 * authentication/authorization. It updates the LIVE context object in place
 * (so the handler and everything it calls afterwards see it) and never creates
 * a scope (no enterWith — outside a request scope it is a no-op).
 *
 * STAGED ROLLOUT (rollout flag `ai-guard-principal`,
 * env ROLLOUT_AI_GUARD_PRINCIPAL_MODE / _KILL / _TENANTS):
 *
 *   shadow (DEFAULT) — OBSERVE. Records `authPrincipal` {userId, orgId, source}
 *                      only. No existing reader consults that field, so the AI
 *                      guard, the AI cache, logs and billing behave exactly as
 *                      before. Counts `ai.guard.principal_attribution`:
 *                        outcome=would_attribute   — the request would gain a
 *                                                    user identity in the guard
 *                        outcome=already_attributed — it already had one
 *                        outcome=conflict          — a second, different user
 *   enforce          — additionally fills context `userId` (never `orgId`: the
 *                      AI cache derives its tenant scope from orgId, and the
 *                      guard's company layers already get companyId from the
 *                      gateway request) when it is not already set. The guard
 *                      then applies per-user + burst limits to interactive
 *                      calls. Per-tenant promotion from shadow via _TENANTS.
 *   off              — no-op.
 *
 * Moving to `enforce` is an OPERATOR decision (docs/security/SEC91_W2A.md):
 * multi-call pipelines inside one HTTP request (campaign planning, BOLT) would
 * start counting against the 20-per-10s burst and 60/min per-user layers.
 *
 * Fail-safe: this function never throws — attribution is observability and
 * rate-limit input, never an authorization decision.
 */
import { defineRolloutFlag, resolveRolloutSync, type RolloutMode } from '../../lib/platform/rollout';
import {
  getMutableRequestContext,
  type AuthenticatedPrincipal,
  type PrincipalAttributionSource,
} from './requestContext';

export type { AuthenticatedPrincipal, PrincipalAttributionSource };

export const AI_GUARD_PRINCIPAL_FLAG = defineRolloutFlag({
  key: 'ai-guard-principal',
  description:
    'SEC91-W2A-4: attribute the authenticated principal to the request context (shadow = observe only; enforce = AI guard keys per-user/burst limits on it)',
  defaultMode: 'shadow',
});

export type AttributionOutcome =
  | 'would_attribute'
  | 'already_attributed'
  | 'applied'
  | 'conflict'
  | 'updated'
  | 'skipped';

/** Synthetic principals that must never become a shared rate-limit key. */
const SYNTHETIC_PRINCIPALS = new Set(['content_architect', 'dev-user', 'unknown']);

function usableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/\s/.test(value);
}

function count(source: PrincipalAttributionSource, mode: RolloutMode, outcome: AttributionOutcome): void {
  try {
    // Lazy: keeps the auth seams free of an import-time observability dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordRawCounter } = require('../observability');
    recordRawCounter('ai.guard.principal_attribution', 1, { source, mode, outcome });
  } catch {
    /* fail-safe */
  }
}

/**
 * Record the principal a request authenticated as. Call ONLY after the
 * caller's identity (and, when `orgId` is given, its access to that org) has
 * been proven. Returns what happened (for tests/diagnostics).
 */
export function attributeAuthenticatedPrincipal(input: {
  userId: string | null | undefined;
  orgId?: string | null;
  source: PrincipalAttributionSource;
}): AttributionOutcome {
  try {
    const store = getMutableRequestContext();
    if (!store) return 'skipped'; // no request scope: never create one
    const userId = input.userId;
    if (!usableId(userId) || SYNTHETIC_PRINCIPALS.has(userId)) return 'skipped';
    const orgId = usableId(input.orgId) ? input.orgId : undefined;

    const mode = resolveRolloutSync(AI_GUARD_PRINCIPAL_FLAG, {
      tenantId: orgId ?? store.authPrincipal?.orgId ?? store.orgId,
    }).mode;
    if (mode === 'off') return 'skipped';

    const existing = store.authPrincipal;
    if (existing && existing.userId !== userId) {
      // One request, two different authenticated users: keep the first, never
      // re-attribute.
      count(input.source, mode, 'conflict');
      return 'conflict';
    }
    if (store.userId && store.userId !== userId) {
      count(input.source, mode, 'conflict');
      return 'conflict';
    }

    if (existing) {
      if (!existing.orgId && orgId) existing.orgId = orgId;
    } else {
      store.authPrincipal = { userId, ...(orgId ? { orgId } : {}), source: input.source };
    }

    if (mode === 'enforce') {
      if (!store.userId) {
        store.userId = userId;
        if (!existing) count(input.source, mode, 'applied');
        return 'applied';
      }
      return existing ? 'updated' : 'already_attributed';
    }

    // shadow — observe only.
    if (!existing) count(input.source, mode, store.userId ? 'already_attributed' : 'would_attribute');
    return existing ? 'updated' : store.userId ? 'already_attributed' : 'would_attribute';
  } catch {
    return 'skipped';
  }
}

/** The principal recorded for the active request, if any (observe surface). */
export function getAuthenticatedPrincipal(): AuthenticatedPrincipal | undefined {
  try {
    const p = getMutableRequestContext()?.authPrincipal;
    return p ? { ...p } : undefined;
  } catch {
    return undefined;
  }
}

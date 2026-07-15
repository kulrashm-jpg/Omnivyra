/**
 * F-03 — Request Execution Context (Foundation Batch A).
 *
 * The canonical composed request context for the platform. This PROMOTES the
 * two existing AsyncLocalStorage seams into one API — it introduces NO new ALS
 * store and NO new behavior:
 *
 *   - backend/services/requestContext.ts   → requestId / correlationId /
 *     traceId / principal (userId, orgId) / idempotencyKey / meta
 *   - backend/services/requestScopedMemo.ts → request-scoped memoization
 *     (PERF-001), already used by /activity-workspace/resolve
 *
 * Everything here is fail-safe: any ALS error degrades to direct execution,
 * and every accessor returns undefined outside a scope. Code that never calls
 * this module behaves exactly as before.
 *
 * Consumers (per the Foundation Analysis): the route factory (F-01) seeds this
 * on every wrapped route; Wave 2's guard memoization, Wave 4's request-scoped
 * caches, and the trace kit (F-02) all read from it.
 */
import type { NextApiRequest } from 'next';
import {
  getRequestContext,
  mergeRequestContext,
  runWithRequestContext,
  seedRequestContextFromRequest,
  type RequestContext,
} from '../../backend/services/requestContext';
import {
  runWithRequestMemo,
  memoRequest,
  hasRequestMemoScope,
} from '../../backend/services/requestScopedMemo';

export type { RequestContext };
export {
  getRequestContext,
  mergeRequestContext,
  runWithRequestContext,
  memoRequest,
  hasRequestMemoScope,
};

/** Minimal principal shape carried in the context (promotion of userId/orgId). */
export interface ExecutionPrincipal {
  userId?: string;
  orgId?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/**
 * Run `fn` inside the canonical composed scope: identity context + request
 * memo. This is the ONE entry point the route factory and worker trace kit
 * use. Fail-safe: if ALS setup throws, `fn` runs unscoped (previous behavior).
 */
export function runWithRequestExecutionContext<T>(seed: RequestContext, fn: () => T): T {
  try {
    return runWithRequestContext({ ...seed }, () => runWithRequestMemo(fn));
  } catch {
    return fn();
  }
}

/**
 * Seed the active context from an incoming API request. Delegates to the
 * existing seedRequestContextFromRequest (x-request-id / x-correlation-id /
 * idempotency-key) and additionally resolves traceId from `x-trace-id`,
 * falling back to correlationId → requestId. Must be called inside a scope
 * (the route factory guarantees this).
 */
export function seedFromApiRequest(
  req: NextApiRequest,
  patch: Partial<RequestContext> = {},
): RequestContext {
  const ctx = seedRequestContextFromRequest(req, patch);
  if (!ctx.traceId) {
    const traceId =
      headerValue(req.headers['x-trace-id']) || ctx.correlationId || ctx.requestId;
    if (traceId) mergeRequestContext({ traceId });
  }
  return getRequestContext();
}

/** The cross-boundary trace id: traceId → correlationId → requestId. */
export function getTraceId(): string | undefined {
  const ctx = getRequestContext();
  return ctx.traceId || ctx.correlationId || ctx.requestId;
}

export function getRequestId(): string | undefined {
  return getRequestContext().requestId;
}

/** Tenant identity (alias of the existing orgId field — no new concept). */
export function getTenantId(): string | undefined {
  return getRequestContext().orgId;
}

export function getPrincipal(): ExecutionPrincipal {
  const ctx = getRequestContext();
  return { userId: ctx.userId, orgId: ctx.orgId };
}

/**
 * Attach the resolved principal to the active context. Guards call this once
 * after authentication so downstream code (metrics labels, memo keys, rollout
 * tenant targeting) can read it without re-resolving. Undefined fields never
 * overwrite previously-set values.
 */
export function setPrincipal(principal: ExecutionPrincipal): void {
  const patch: Partial<RequestContext> = {};
  if (principal.userId !== undefined) patch.userId = principal.userId;
  if (principal.orgId !== undefined) patch.orgId = principal.orgId;
  if (Object.keys(patch).length) mergeRequestContext(patch);
}

/** Set one entry in the request-scoped metadata bag (fail-safe no-op unscoped). */
export function setContextMeta(key: string, value: unknown): void {
  try {
    const meta = { ...(getRequestContext().meta ?? {}), [key]: value };
    mergeRequestContext({ meta });
  } catch {
    /* fail-safe */
  }
}

export function getContextMeta<T = unknown>(key: string): T | undefined {
  try {
    return getRequestContext().meta?.[key] as T | undefined;
  } catch {
    return undefined;
  }
}

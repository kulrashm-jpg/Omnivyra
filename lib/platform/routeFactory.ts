/**
 * F-01 — Route Factory (Foundation Batch A).
 *
 * The canonical execution pipeline for Next.js API routes. It COMPOSES the
 * existing seams — it does not reimplement them:
 *
 *   createApiRoute(handler)
 *     = withApiObservability(            ← HARDEN-001 metrics (unchanged)
 *         requestExecutionContext(       ← F-03 identity + memo ALS scopes
 *           errorClassification(         ← counts error classes, then RETHROWS
 *             ...opts.use middleware,    ← future: guard / response cache / logging
 *             handler)))
 *
 * GUARANTEES (Foundation Batch A contract):
 *   - Response bytes, headers, and status are byte-identical to the unwrapped
 *     handler. Thrown errors are rethrown so Next.js error semantics are
 *     preserved exactly.
 *   - Every layer is fail-safe: an instrumentation/context failure degrades to
 *     running the handler directly.
 *   - `opts.use` is the sanctioned integration point for later waves (W2-1
 *     guard, W4-1 response cache) so those never re-wrap routes ad hoc.
 *
 * Adoption in Batch A is deliberately minimal: withContract() delegates here
 * (its 3 existing routes are the validation surface) plus the new metrics
 * export endpoint. Repository-wide migration is Wave 0 work.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { withApiObservability } from '../../backend/observability';
import { normalizeRoute } from '../../backend/observability/apiObservability';
import { recordRawCounter } from '../../backend/observability';
import {
  runWithRequestExecutionContext,
  seedFromApiRequest,
} from './requestContext';
import type { RoutePolicy } from './routePolicy';

/** A wrapper that decorates a handler — the future middleware unit (guard, cache…). */
export type RouteMiddleware = (handler: NextApiHandler) => NextApiHandler;

export interface CreateApiRouteOptions {
  /** Static route label for stable metric series (falls back to normalized URL). */
  route?: string;
  /**
   * Middleware applied innermost-last (use[0] is outermost). Reserved for
   * later waves; Batch A ships no middleware.
   */
  use?: RouteMiddleware[];
  /**
   * Echo the request id as an `x-request-id` response header. DEFAULT FALSE —
   * enabling it is an (additive) externally-visible change, deferred to Wave 0.
   */
  exposeRequestId?: boolean;
  /**
   * AUTH-ENFORCEMENT Phase 1 (Task 3a): declarative authorization policy
   * (docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md v3 §3.4). OBSERVATION
   * ONLY in Phase 1 — when declared and the route-policy-gate rollout flag is
   * non-off, the policy is evaluated and logged; it never blocks, never
   * writes to the response. Absent ⇒ this option adds one undefined-check and
   * nothing else. Enforcement (fail-closed, INV-10) arrives in Phase 2.
   */
  policy?: RoutePolicy;
}

/**
 * Classify a thrown error into a small, bounded label set for the
 * `api.request.error_class` counter. Heuristic and fail-safe — used for
 * metrics only, never for control flow.
 */
export function classifyError(err: unknown): string {
  try {
    if (err === null || err === undefined) return 'unknown';
    const e = err as { name?: string; code?: string | number; message?: string; status?: number; statusCode?: number };
    const name = String(e.name ?? '');
    const code = String(e.code ?? '');
    const msg = String(e.message ?? '');
    const status = Number(e.status ?? e.statusCode ?? NaN);

    if (name === 'AbortError' || /aborted/i.test(msg)) return 'abort';
    if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(`${name} ${code} ${msg}`)) return 'timeout';
    if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up/i.test(`${code} ${msg}`)) return 'network';
    if (name === 'ZodError' || /validation|invalid/i.test(name)) return 'validation';
    if (Number.isFinite(status)) {
      if (status === 401 || status === 403) return 'auth';
      if (status === 429) return 'rate_limit';
      if (status >= 500) return 'upstream';
      if (status >= 400) return 'client';
    }
    if (/unauthorized|forbidden/i.test(msg)) return 'auth';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build the canonical route pipeline around a handler. Pass-through by
 * construction: see the module doc for the layer order and guarantees.
 */
export function createApiRoute(
  handler: NextApiHandler,
  opts: CreateApiRouteOptions = {},
): NextApiHandler {
  // Compose reserved middleware (none in Batch A). Fail-safe per middleware:
  // a wrapper that throws during composition is skipped, not fatal.
  let composed: NextApiHandler = handler;
  const middleware = opts.use ?? [];
  for (let i = middleware.length - 1; i >= 0; i--) {
    try {
      composed = middleware[i](composed);
    } catch {
      /* skip broken middleware — never take the route down */
    }
  }

  const core: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    return runWithRequestExecutionContext({}, async () => {
      try {
        const ctx = seedFromApiRequest(req);
        if (opts.exposeRequestId && ctx.requestId && !res.headersSent) {
          try { res.setHeader('x-request-id', ctx.requestId); } catch { /* fail-safe */ }
        }
      } catch {
        /* context seeding must never break the route */
      }

      // AUTH-ENFORCEMENT Phase 1: observation-only policy gate. Dynamically
      // imported so routes WITHOUT a policy (all of them in Task 3a) never
      // load the gate or the security module graph. Fail-safe by Decision 2:
      // observation can never affect the route.
      if (opts.policy) {
        try {
          const { observePolicy } = await import('./policyGate');
          await observePolicy(opts.policy, opts.route ?? normalizeRoute(req.url), req);
        } catch {
          /* observation must never break the route */
        }
      }

      try {
        return await composed(req, res);
      } catch (err) {
        try {
          recordRawCounter('api.request.error_class', 1, {
            route: opts.route ?? normalizeRoute(req.url),
            class: classifyError(err),
          });
        } catch { /* fail-safe */ }
        // Rethrow — Next.js error handling stays byte-identical to today.
        throw err;
      }
    });
  };

  return withApiObservability(core, opts.route);
}

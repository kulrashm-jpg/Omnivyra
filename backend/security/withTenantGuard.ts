/**
 * HARDEN-007 — approved higher-order tenant-isolation wrapper.
 *
 * A single, hard-to-misuse way to protect a Next.js API route that operates on
 * tenant-owned data. Instead of remembering to call enforceCompanyAccess() and
 * checking its result, a route wraps its handler:
 *
 *   export default withTenantGuard(async (req, res, ctx) => {
 *     // ctx.userId / ctx.companyIds are the verified membership; the requested
 *     // company has already been authorized. Use ctx.companyId for the scoped id.
 *   });
 *
 * The wrapper:
 *   - extracts the company id from the request (query/body — the same keys the
 *     rest of the platform uses), unless the caller supplies a resolver,
 *   - calls the canonical enforceCompanyAccess() (membership + soft-delete +
 *     bridge-principal checks, transient-error 503, missing-id 400),
 *   - short-circuits with the guard's own response on denial (never runs the
 *     handler), and
 *   - passes the resolved UserContext + authorized companyId to the handler so
 *     it cannot "forget" to scope its queries.
 *
 * It is recognized by the HARDEN-007 CI guard (scripts/check-tenant-authz.js) as
 * an approved authorization mechanism, so routes that use it pass the scanner.
 *
 * This does NOT change RBAC, authentication, permissions, or the enforcement
 * semantics — it is a thin, reusable composition of the existing helper.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../services/userContextService';
import type { UserContext } from '../lib/userContext';
import { recordRawCounter } from '../observability';

export interface TenantGuardHandlerContext extends UserContext {
  /** The request-supplied, now-authorized company id. */
  companyId: string;
  /** The request-supplied campaign id, when the route is campaign-scoped. */
  campaignId?: string | null;
}

export type TenantGuardedHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: TenantGuardHandlerContext,
) => unknown | Promise<unknown>;

export interface TenantGuardOptions {
  /** Also require + carry a campaign id (enforceCompanyAccess requireCampaignId). */
  requireCampaignId?: boolean;
  /** Custom company-id resolver (default: query/body companyId|company_id). */
  resolveCompanyId?: (req: NextApiRequest) => string | null | undefined;
  /** Custom campaign-id resolver (default: query/body campaignId|campaign_id). */
  resolveCampaignId?: (req: NextApiRequest) => string | null | undefined;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function defaultCompanyId(req: NextApiRequest): string | null {
  const q = req.query as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  return firstString(q.companyId, q.company_id, b.companyId, b.company_id);
}

function defaultCampaignId(req: NextApiRequest): string | null {
  const q = req.query as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  return firstString(q.campaignId, q.campaign_id, b.campaignId, b.campaign_id);
}

/**
 * Wrap a Next.js API handler so tenant access is authorized BEFORE it runs.
 * The handler receives the verified UserContext + authorized companyId as a
 * third argument.
 */
export function withTenantGuard(handler: TenantGuardedHandler, options: TenantGuardOptions = {}): NextApiHandler {
  return async function tenantGuardedHandler(req: NextApiRequest, res: NextApiResponse) {
    const companyId = (options.resolveCompanyId ?? defaultCompanyId)(req) ?? null;
    const campaignId = (options.resolveCampaignId ?? defaultCampaignId)(req) ?? null;

    const ctx = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: options.requireCampaignId,
    });

    if (!ctx) {
      // enforceCompanyAccess already sent the 400/401/403/503 response.
      try { recordRawCounter('authz.tenant.denied', 1, { route: normalizeRoute(req.url), via: 'withTenantGuard' }); } catch { /* fail-safe */ }
      return;
    }

    try { recordRawCounter('authz.tenant.allowed', 1, { route: normalizeRoute(req.url), via: 'withTenantGuard' }); } catch { /* fail-safe */ }
    return handler(req, res, { ...ctx, companyId: companyId as string, campaignId });
  };
}

function normalizeRoute(url: string | undefined): string {
  try {
    return (url ?? '').split('?')[0] || '/';
  } catch {
    return 'unknown';
  }
}

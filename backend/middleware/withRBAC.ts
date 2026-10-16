import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role, ALL_ROLES } from '../services/rbacService';
import { companyOperationalState } from '../services/companyOperationalState';

/**
 * WITHRBAC-STRUCT-001 — what withRBAC puts on `req.rbac`.
 *
 * `companyId` is the company the wrapper ACTUALLY AUTHORIZED — the exact value
 * passed to enforceRole for the authorization decision. It is NOT merely "a
 * company the request mentioned".
 *
 * It is always present when `req.rbac` is set: enforceRole answers 400
 * `companyId required` before any success path, including the super-admin and
 * content-architect bypasses, so a resolved context always carries one.
 *
 * Handlers that operate on tenant data should bind to THIS value (or to an
 * approved resource-ownership primitive), never to a company they re-derive
 * from request input. Re-derivation is what produced RECOMMENDATIONS-SEC-001,
 * OPPORTUNITIES-SEC-001 and WITHRBAC-SEC-001: the wrapper authorized one
 * company while the handler operated on another.
 */
export type RbacContext = {
  userId: string;
  role: Role;
  /** The company withRBAC authorized for this request. */
  companyId: string;
};

type RbacHandler = NextApiHandler & { rbac?: RbacContext };

/**
 * RBAC Middleware with whitelist and blacklist support
 *
 * Usage:
 * - Whitelist (allowedRoles): Only specified roles can access
 *   withRBAC(handler, ['ADMIN', 'CONTENT_MANAGER'])
 *
 * - Blacklist (forbiddenRoles): Everyone EXCEPT specified roles can access
 *   withRBAC(handler, undefined, ['VIEW_ONLY', 'VIEWER'])
 *
 * - Hybrid: allowedRoles takes precedence if both are specified
 */
export const withRBAC = (
  handler: NextApiHandler,
  allowedRoles?: Role[],
  forbiddenRoles?: Role[]
) => {
  const wrapped: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const companyId =
      (req.query?.companyId as string | undefined) ||
      (req.body?.companyId as string | undefined);

    // Compute final allowed roles
    let finalAllowedRoles = allowedRoles;
    if (!finalAllowedRoles && forbiddenRoles) {
      // Blacklist approach: allowed = all roles - forbidden roles
      finalAllowedRoles = ALL_ROLES.filter(role => !forbiddenRoles.includes(role));
    } else if (!finalAllowedRoles) {
      // No restrictions: allow all roles
      finalAllowedRoles = ALL_ROLES;
    }

    const result = await enforceRole({ req, res, companyId, allowedRoles: finalAllowedRoles });
    if (!result) return;

    /*
     * Closure-015E — company operational state, as the canonical tenant guard
     * (TenantGuard.assertTenantAccess) and enforceCompanyAccess already decide
     * it: a tenant principal is refused for a company that is missing or whose
     * companies.status is not 'active' (suspended / soft-deleted); a transient
     * read failure answers a retryable 503, never an allow. Platform principals
     * keep TenantGuard's bypass and never depend on the company read: the
     * active platform super admin (enforceRole's bypass, the only path that
     * yields SUPER_ADMIN) and the content-architect principal. None of the
     * withRBAC routes is a billing / reactivation / export / recovery flow
     * (Closure-015E route inventory), so no tenant exception applies.
     */
    if (result.role !== Role.SUPER_ADMIN && result.userId !== 'content_architect') {
      const orgState = await companyOperationalState(companyId as string);
      if (orgState === 'lookup_error') {
        res.status(503).json({
          error: 'Membership check is temporarily unavailable. Please try again.',
          code: 'TENANT_LOOKUP_ERROR',
          retryable: true,
        });
        return;
      }
      if (orgState === 'not_operational') {
        res.status(403).json({ error: 'Access denied to company' });
        return;
      }
    }

    /*
     * WITHRBAC-STRUCT-001 — expose the authorized company. Purely additive:
     * `companyId` is the same local already passed to enforceRole above, so no
     * second membership query, no second authorization decision, and no change
     * to any existing verdict, role check, precedence or response. enforceRole
     * cannot return a result for an absent companyId, so the non-null assertion
     * below reflects a guarantee rather than an assumption.
     */
    const rbac: RbacContext = { ...result, companyId: companyId as string };
    (req as any).rbac = rbac;
    return handler(req, res);
  };
  return wrapped as RbacHandler;
};

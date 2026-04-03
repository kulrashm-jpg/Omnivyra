import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role, ALL_ROLES } from '../services/rbacService';

type RbacHandler = NextApiHandler & { rbac?: { userId: string; role: Role } };

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

    (req as any).rbac = result;
    return handler(req, res);
  };
  return wrapped as RbacHandler;
};

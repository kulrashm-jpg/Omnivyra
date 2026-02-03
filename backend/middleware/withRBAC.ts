import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../services/rbacService';

type RbacHandler = NextApiHandler & { rbac?: { userId: string; role: Role } };

export const withRBAC = (handler: NextApiHandler, allowedRoles: Role[]) => {
  const wrapped: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const companyId =
      (req.query?.companyId as string | undefined) ||
      (req.body?.companyId as string | undefined);
    const result = await enforceRole({ req, res, companyId, allowedRoles });
    if (!result) return;
    (req as any).rbac = result;
    return handler(req, res);
  };
  return wrapped as RbacHandler;
};

import type { NextApiHandler, NextApiRequest } from 'next';
import {
  buildAuthContext,
  type AuthContext,
  type AuthContextError,
} from '../auth/authContext';

export interface AuthGuardConfig {
  requiresAuth?: boolean;
  requiresOrg?: boolean;
  requiredRole?: string | null;
  allowSuperAdminOverride?: boolean;
}

const firstValue = (value: unknown): string | null => {
  if (Array.isArray(value)) return firstValue(value[0]);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const getBody = (req: NextApiRequest): any => {
  if (typeof req.body !== 'string') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
};

const resolveOrgId = (req: NextApiRequest, ctx: AuthContext | null): string | null => {
  const body = getBody(req);
  return (
    ctx?.activeOrgId ||
    firstValue(req.headers['x-org-id']) ||
    firstValue(req.query.orgId) ||
    firstValue(req.query.companyId) ||
    firstValue(req.query.company_id) ||
    firstValue(req.query.organization_id) ||
    firstValue(body?.orgId) ||
    firstValue(body?.companyId) ||
    firstValue(body?.company_id) ||
    firstValue(body?.organization_id)
  );
};

const getStatusCode = (err: unknown): number | null => {
  const status = (err as Partial<AuthContextError> | undefined)?.statusCode;
  return typeof status === 'number' ? status : null;
};

export function applyAuthGuard(config: AuthGuardConfig) {
  return function guard(handler: NextApiHandler): NextApiHandler {
    return async (req, res) => {
      let ctx: AuthContext | null = null;

      if (config.requiresAuth) {
        try {
          ctx = await buildAuthContext(req);
        } catch (err) {
          if (getStatusCode(err) === 401) {
            return res.status(401).json({ error: 'Unauthorized' });
          }
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      let orgMembership: AuthContext['memberships'][number] | undefined;

      if (config.requiresOrg) {
        const orgId = resolveOrgId(req, ctx);
        if (!orgId) {
          return res.status(400).json({ error: 'Missing organization_id' });
        }

        orgMembership = ctx?.memberships.find((item) => item.orgId === orgId);
        if (!orgMembership && !(config.allowSuperAdminOverride && ctx?.isSuperAdmin)) {
          return res.status(403).json({ error: 'Invalid org access' });
        }

        (req as any).organization_id = orgId;
      }

      if (config.requiredRole) {
        const hasRole =
          ctx?.roles.includes(config.requiredRole) ||
          orgMembership?.role === config.requiredRole;
        if (!hasRole && !(config.allowSuperAdminOverride && ctx?.isSuperAdmin)) {
          return res.status(403).json({ error: 'Insufficient role' });
        }
      }

      if (ctx) {
        (req as any).auth = ctx;
      }

      return handler(req, res);
    };
  };
}

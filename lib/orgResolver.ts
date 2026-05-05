import type { NextApiRequest } from 'next';
import { getAuthContext, type AuthContext } from '@/backend/auth/authContext';

export type OrganizationContext = {
  organization_id: string;
  role: string;
};

const firstValue = (value: unknown): string | null => {
  if (Array.isArray(value)) return firstValue(value[0]);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const bodyValue = (req: NextApiRequest, key: string): string | null => {
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  return firstValue(body?.[key]);
};

const safeJson = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export function resolveRequestedOrganizationId(req: NextApiRequest, ctx?: AuthContext | null): string | null {
  return (
    firstValue(req.headers['x-org-id']) ||
    firstValue(req.query.organization_id) ||
    bodyValue(req, 'organization_id') ||
    ctx?.activeOrgId ||
    null
  );
}

export function getOrganizationContext(req: NextApiRequest): OrganizationContext {
  const ctx = getAuthContext(req);
  const organization_id = resolveRequestedOrganizationId(req, ctx);
  if (!organization_id) {
    throw new Error('organization_id required');
  }

  const membership = ctx.memberships.find((item) => item.orgId === organization_id);
  if (!membership && !ctx.isSuperAdmin) {
    throw new Error('organization access denied');
  }

  return {
    organization_id,
    role: membership?.role ?? 'SUPER_ADMIN',
  };
}

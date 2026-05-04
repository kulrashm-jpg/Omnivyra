import type { NextApiRequest } from 'next';
import { runWithServiceRole } from '../db/supabaseClient';
import { isPlatformSuperAdmin } from '../services/rbacService';
import {
  verifySupabaseAuthHeader,
  type VerifiedSupabaseUser,
} from '../../lib/auth/serverValidation';

export type SupabaseUser = VerifiedSupabaseUser;

export interface AuthContext {
  user: SupabaseUser;
  internalUser: {
    id: string;
    email: string;
    status: string;
  };
  memberships: Array<{
    orgId: string;
    role: string;
    status: string;
  }>;
  activeOrgId: string | null;
  roles: string[];
  isSuperAdmin: boolean;
}

export const USER_COMPANY_ROLES_TABLE = 'user_company_roles';

export class AuthContextError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403) {
    super(message);
    this.name = 'AuthContextError';
    this.statusCode = statusCode;
  }
}

type AuthContextRequest = NextApiRequest & {
  __authContext?: AuthContext;
};

const firstHeaderValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const firstBodyValue = (value: unknown): string | null => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' ? value : null;
};

const resolveActiveOrgId = (req: NextApiRequest): string | null => {
  const fromHeader = firstHeaderValue(req.headers['x-org-id']);
  if (fromHeader?.trim()) return fromHeader.trim();

  const fromQuery =
    firstHeaderValue(req.query.orgId) ||
    firstHeaderValue(req.query.companyId) ||
    firstHeaderValue(req.query.company_id) ||
    firstHeaderValue(req.query.organization_id);
  if (fromQuery?.trim()) return fromQuery.trim();

  const body = typeof req.body === 'string' ? safeParseJson(req.body) : req.body;
  const fromBody =
    firstBodyValue(body?.orgId) ||
    firstBodyValue(body?.companyId) ||
    firstBodyValue(body?.company_id) ||
    firstBodyValue(body?.organization_id);
  if (fromBody?.trim()) return fromBody.trim();

  return null;
};

const safeParseJson = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export async function buildAuthContext(req: NextApiRequest): Promise<AuthContext> {
  const cached = (req as AuthContextRequest).__authContext;
  if (cached) return cached;

  let user: SupabaseUser;
  try {
    user = await verifySupabaseAuthHeader(req.headers.authorization);
  } catch {
    throw new AuthContextError('Unauthorized', 401);
  }

  const email = user.email.toLowerCase();
  const { data: userRows, error: userError } = await runWithServiceRole(
    'Build auth context internal user lookup',
    (client) => client
      .from('users')
      .select('id, email, status, supabase_uid, is_deleted')
      .or(`supabase_uid.eq.${user.id},email.eq.${email}`)
      .limit(2),
  );

  if (userError) {
    throw new AuthContextError('Unauthorized', 401);
  }

  const internalRow =
    (userRows ?? []).find((row: any) => row.supabase_uid === user.id) ??
    (userRows ?? []).find((row: any) => String(row.email ?? '').toLowerCase() === email);

  if (!internalRow) {
    throw new AuthContextError('Unauthorized', 401);
  }

  const internalStatus = String((internalRow as any).status ?? '');
  if ((internalRow as any).is_deleted || internalStatus !== 'active') {
    throw new AuthContextError('Forbidden', 403);
  }

  const internalUser = {
    id: String((internalRow as any).id),
    email: String((internalRow as any).email ?? user.email),
    status: internalStatus,
  };

  const { data: membershipRows, error: membershipError } = await runWithServiceRole(
    'Build auth context active memberships',
    (client) => client
      .from(USER_COMPANY_ROLES_TABLE)
      .select('company_id, role, status')
      .eq('user_id', internalUser.id)
      .eq('status', 'active'),
  );

  if (membershipError) {
    throw new AuthContextError('Forbidden', 403);
  }

  const memberships = (membershipRows ?? []).map((row: any) => ({
    orgId: String(row.company_id),
    role: String(row.role),
    status: String(row.status),
  }));

  const activeOrgId = resolveActiveOrgId(req);
  const roles = activeOrgId
    ? memberships
        .filter((membership) => membership.orgId === activeOrgId)
        .map((membership) => membership.role)
    : [];

  const context: AuthContext = {
    user,
    internalUser,
    memberships,
    activeOrgId,
    roles,
    isSuperAdmin: await isPlatformSuperAdmin(internalUser.id),
  };

  (req as AuthContextRequest).__authContext = context;
  return context;
}

export function getAuthContext(req: NextApiRequest): AuthContext {
  const context = (req as AuthContextRequest).__authContext;
  if (!context) {
    throw new AuthContextError('Auth context has not been initialized', 401);
  }
  return context;
}

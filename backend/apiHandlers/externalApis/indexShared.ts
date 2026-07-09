/** Part of the external-apis API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import {
  getPlatformConfigs,
  getExternalApiRuntimeSnapshot,
  savePlatformConfig,
  validatePlatformConfig,
  VALID_API_CATEGORIES,
} from '../../services/externalApiService';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../services/rbacService';
import { encryptCredential } from '../../auth/credentialEncryption';
import { checkAndGrantSetupCredits } from '../../services/earnCreditsService';
import { requireCapability } from '../../security/requireCapability';
import { hasCapability } from '../../security/AuthorizationService';
import { resolvePrincipal } from '../../security/IdentityResolver';
import { INTEGRATION_SECRETS_READ } from '../../../shared/contracts/security';
import type { AuthenticatedPrincipal } from '../../../shared/contracts/security';

export const requireExternalApiAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string,
  requireManage = false
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) {
    return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (requireManage && !(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

export const requirePlatformAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) {
    return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  return null;
};

export const parseUsageUserId = (value: string) => {
  if (value.startsWith('feature:')) {
    const parts = value.split('|');
    const feature = parts[0]?.slice('feature:'.length) || null;
    const companyPart = parts.find((part) => part.startsWith('company:'));
    const companyId = companyPart?.slice('company:'.length) || null;
    return { kind: 'feature' as const, feature, companyId, userId: null };
  }
  const idx = value.lastIndexOf(':');
  if (idx > 0 && idx < value.length - 1) {
    return {
      kind: 'user' as const,
      feature: null,
      companyId: value.slice(idx + 1),
      userId: value.slice(0, idx),
    };
  }
  return { kind: 'unknown' as const, feature: null, companyId: null, userId: value };
};


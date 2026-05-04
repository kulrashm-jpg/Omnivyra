import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import {
  requireAdminRateLimit,
  requireAdminScope,
  requireAuthenticatedInternalUser,
} from '../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';
import { logDomainUnverifiedUsageForCompany } from '../../../backend/services/domainVerificationService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

const VALID_ROLES = new Set([
  'COMPANY_ADMIN',
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
]);

type SuccessResponse = { invitationId: string };
type ErrorResponse = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:invite-user', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, role = 'CONTENT_CREATOR', companyId: bodyCompanyId } = body as {
    email?: string;
    role?: string;
    companyId?: string;
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Resolve effective companyId: super-admin supplies it explicitly; company-admin
  // is scoped to their own org row. Final scope check below enforces the role.
  const isSuperAdmin = await isPlatformSuperAdmin(user.id);

  let companyId: string;
  if (isSuperAdmin) {
    if (!bodyCompanyId) {
      return res.status(400).json({ error: 'companyId is required for super admin invitations' });
    }
    companyId = bodyCompanyId.trim();
  } else {
    const { data: roleRow } = await supabase
      .from('user_company_' + 'roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('role', 'COMPANY_ADMIN')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!roleRow) {
      return res.status(403).json({ error: 'Only company admins can send invitations' });
    }
    companyId = (roleRow as any).company_id;
  }

  const ctx = await requireAdminScope(req, res, 'users:invite', { companyId });
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/invite-user', 'users:invite');
  }

  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('company_id', companyId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: `An active invitation for ${normalizedEmail} already exists.`, code: 'INVITE_EXISTS' });
  }

  try {
    const invitation = await createAndSendInvitation({
      email: normalizedEmail,
      companyId,
      role,
      invitedBy: user.id,
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });

    // Soft-enforcement signal — non-blocking log when a company-admin issues
    // an invitation for a company whose domain is not yet verified.
    void logDomainUnverifiedUsageForCompany({
      company_id: companyId,
      operation:  'admin_invite_user',
      metadata:   { invitationId: invitation.id, role, invited_by: user.id },
    });

    return res.status(201).json({ invitationId: invitation.id });
  } catch (error: any) {
    logger.error('admin_invite_user_failed', { userId: user.id, companyId, email: normalizedEmail, message: error?.message || String(error) });
    return res.status(500).json({ error: 'Failed to create and send invitation' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);

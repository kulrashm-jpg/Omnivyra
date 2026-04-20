import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';

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

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) {
    const status = userErr === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: userErr ?? 'Invalid session', code: userErr ?? undefined });
  }

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

  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let companyId: string;
  if (superAdminRow) {
    if (!bodyCompanyId) {
      return res.status(400).json({ error: 'companyId is required for super admin invitations' });
    }
    companyId = bodyCompanyId.trim();
  } else {
    const { data: roleRow } = await supabase
      .from('user_company_roles')
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

    return res.status(201).json({ invitationId: invitation.id });
  } catch (error: any) {
    logger.error('admin_invite_user_failed', { userId: user.id, companyId, email: normalizedEmail, message: error?.message || String(error) });
    return res.status(500).json({ error: 'Failed to create and send invitation' });
  }
}

export default withIdempotency(handler, { scope: 'admin-invite-user' });

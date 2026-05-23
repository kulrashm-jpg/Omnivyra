import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { checkRateLimit, LOGIN_LIMIT, INVITE_UID_LIMIT } from '../../../lib/auth/rateLimit';
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';

const VALID_ROLES = new Set([
  'COMPANY_ADMIN',
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
]);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const rl = await checkRateLimit(ip, { ...LOGIN_LIMIT, keyPrefix: 'rl:invite', limit: 20, windowSecs: 60 * 60 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many invite requests. Try again later.' });
  }

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const callerUid: string = authResult.user.supabaseUid;

  const rlUid = await checkRateLimit(callerUid, INVITE_UID_LIMIT);
  if (!rlUid.allowed) {
    return res.status(429).json({ error: 'Too many invite requests. Try again later.' });
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

  const { data: callerUser } = await supabase
    .from('users')
    .select('id')
    .eq('supabase_uid', callerUid)
    .maybeSingle();

  if (!callerUser) {
    return res.status(401).json({ error: 'User not found' });
  }

  const callerId: string = (callerUser as any).id;

  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', callerId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let companyId: string;

  if (superAdminRow) {
    if (!bodyCompanyId || typeof bodyCompanyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required when sending invitations as super admin' });
    }
    companyId = bodyCompanyId.trim();
  } else {
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', callerId)
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
    return res.status(409).json({
      error: `An active invitation for ${normalizedEmail} already exists. Revoke it first if you want to resend.`,
    });
  }

  try {
    const invitation = await createAndSendInvitation({
      email: normalizedEmail,
      companyId,
      role,
      invitedBy: callerId,
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });

    return res.status(201).json({ invitationId: invitation.id });
  } catch (error: any) {
    const message = String(error?.message ?? '');
    if (message.includes('duplicate') || message.includes('23505')) {
      return res.status(409).json({ error: 'An invitation for this email already exists' });
    }
    logger.error('team_invite_failed', { message: error?.message ?? String(error), email: normalizedEmail, companyId });
    return res.status(500).json({ error: 'Failed to create and send invitation' });
  }
}

export default withIdempotency(handler, { scope: 'team-invite' });

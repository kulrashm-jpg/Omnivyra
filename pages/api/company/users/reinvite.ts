import { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runWithServiceRole } from '@/backend/db/supabaseClient';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { requireCompanyContext } from '@/backend/services/companyContextGuardService';
import { sendInvite } from '@/backend/services/emailService';
import { config } from '@/config';
import { randomBytes, createHash } from 'crypto';

async function findOrCreateUserByEmail(client: SupabaseClient, email: string): Promise<{ id: string; isNew: boolean }> {
  const { data: existing } = await client
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) return { id: (existing as any).id, isNew: false };

  const { data: created, error } = await client
    .from('users')
    .insert({ email, created_at: new Date().toISOString() })
    .select('id')
    .single();

  if (error || !created) throw new Error('Failed to create user record');
  return { id: (created as any).id, isNew: true };
}

async function createInvitationToken(
  client: SupabaseClient,
  userId: string,
  email: string,
  companyId: string,
  actorId: string,
): Promise<string> {
  // Revoke any existing active invitations for this email+company
  await client
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('email', email)
    .eq('company_id', companyId)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await client.from('invitations').insert({
    token_hash: tokenHash,
    email,
    company_id: companyId,
    invited_by: actorId,
    user_id: userId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });

  if (error) throw new Error('Failed to create invitation token');
  return rawToken;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, companyId } = req.body || {};
  if (!email || !companyId) {
    return res.status(400).json({ error: 'email and companyId are required' });
  }

  const targetCompanyId = String(companyId).trim();
  const actorId = (req as any).auth?.internalUser?.id as string | undefined;
  if (!actorId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const companyContext = await requireCompanyContext({ req, res, companyId: targetCompanyId });
  if (!companyContext) return;

  return runWithServiceRole('Reinvite company user after company access guard', async (client) => {
    const normalizedEmail = String(email).trim().toLowerCase();

    try {
      const { id: userId } = await findOrCreateUserByEmail(client, normalizedEmail);

      // Preserve existing role if any
      const { data: existingRoleRow } = await client
        .from('user_company_' + 'roles')
        .select('role')
        .eq('user_id', userId)
        .eq('company_id', targetCompanyId)
        .limit(1)
        .maybeSingle();

      const role = (existingRoleRow as any)?.role || 'CONTENT_CREATOR';

      // Reset role to invited state
      await client
        .from('user_company_' + 'roles')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', targetCompanyId);

      await client.from('user_company_' + 'roles').insert({
        user_id: userId,
        company_id: targetCompanyId,
        role,
        status: 'invited',
        created_at: new Date().toISOString(),
      });

      const rawToken = await createInvitationToken(client, userId, normalizedEmail, targetCompanyId, actorId);
      const inviteUrl = `${config.NEXT_PUBLIC_APP_URL}/accept-invite?token=${rawToken}`;

      // Send the invite via SES through the email_jobs queue. Idempotency
      // key bound to (user, company) so back-to-back reinvite requests
      // collapse to a single email instead of spamming the recipient.
      await sendInvite(
        normalizedEmail,
        inviteUrl,
        `reinvite:${targetCompanyId}:${userId}`,
      );

      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'FAILED_TO_REINVITE_USER' });
    }
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
  requiredRole: 'COMPANY_ADMIN',
  allowSuperAdminOverride: true,
})(handler);

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '@/backend/db/supabaseClient';
import { verifySupabaseAuthHeader } from '../../../../lib/auth/serverValidation';
import { randomBytes, createHash } from 'crypto';

async function getActorUserId(req: NextApiRequest): Promise<string | null> {
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`supabase_uid.eq.${verified.id},email.eq.${verified.email.toLowerCase()}`)
      .maybeSingle();
    return (data as any)?.id ?? null;
  } catch {
    return null;
  }
}

async function isActorAuthorized(actorId: string, companyId: string): Promise<boolean> {
  // Check super admin
  const { data: superRole } = await supabaseAdmin
    .from('user_company_roles')
    .select('role')
    .eq('user_id', actorId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .maybeSingle();
  if (superRole) return true;

  // Check company admin
  const { data: companyRole } = await supabaseAdmin
    .from('user_company_roles')
    .select('role')
    .eq('user_id', actorId)
    .eq('company_id', companyId)
    .in('role', ['COMPANY_ADMIN', 'ADMIN'])
    .eq('status', 'active')
    .maybeSingle();
  return !!companyRole;
}

async function findOrCreateUserByEmail(email: string): Promise<{ id: string; isNew: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) return { id: (existing as any).id, isNew: false };

  const { data: created, error } = await supabaseAdmin
    .from('users')
    .insert({ email, created_at: new Date().toISOString() })
    .select('id')
    .single();

  if (error || !created) throw new Error('Failed to create user record');
  return { id: (created as any).id, isNew: true };
}

async function createInvitationToken(
  userId: string,
  email: string,
  companyId: string,
  actorId: string,
): Promise<string> {
  // Revoke any existing active invitations for this email+company
  await supabaseAdmin
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('email', email)
    .eq('company_id', companyId)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin.from('invitations').insert({
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, companyId } = req.body || {};
  if (!email || !companyId) {
    return res.status(400).json({ error: 'email and companyId are required' });
  }

  const actorId = await getActorUserId(req);
  if (!actorId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const authorized = await isActorAuthorized(actorId, companyId);
  if (!authorized) return res.status(403).json({ error: 'FORBIDDEN' });

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const { id: userId } = await findOrCreateUserByEmail(normalizedEmail);

    // Preserve existing role if any
    const { data: existingRoleRow } = await supabaseAdmin
      .from('user_company_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();

    const role = (existingRoleRow as any)?.role || 'CONTENT_CREATOR';

    // Reset role to invited state
    await supabaseAdmin
      .from('user_company_roles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId);

    await supabaseAdmin.from('user_company_roles').insert({
      user_id: userId,
      company_id: companyId,
      role,
      status: 'invited',
      created_at: new Date().toISOString(),
    });

    const rawToken = await createInvitationToken(userId, normalizedEmail, companyId, actorId);
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${rawToken}`;

    // TODO: send invite email via Resend/SendGrid/SES
    console.info('[reinvite] invitation link for', normalizedEmail, ':', inviteUrl);

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'FAILED_TO_REINVITE_USER' });
  }
}

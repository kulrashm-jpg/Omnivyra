import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '@/backend/db/supabaseClient';
import { requireCompanyContext } from '@/backend/services/companyContextGuardService';
import { sendInvite } from '@/backend/services/emailService';
import { resolveAuthenticatedUser } from '@/backend/services/authResolver';
import { getCanonicalAppUrl } from '@/backend/config/getCanonicalAppUrl';
import { randomBytes, createHash } from 'crypto';
import { normalizeRole, Role } from '@/backend/services/rbacPrimitives';

async function getActorUserId(req: NextApiRequest): Promise<string | null> {
  // resolveAuthenticatedUser already returns public.users.id after joining
  // public.users by supabase_uid (with email fallback + supabase_uid back-fill).
  // No additional .or() lookup is needed — and the previous raw-string .or()
  // was unsafe with emails containing '@'/'.'.
  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) return null;
  return authResult.user.id;
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
  role: string,
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
    // Closure-015D: the invitation carries the role acceptance will activate
    // (team/accept-invite and activate_invitation_membership apply
    // invitation.role). Omitting it let the column DEFAULT 'CONTENT_CREATOR'
    // silently demote a re-invited administrator on acceptance.
    role,
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

  const companyContext = await requireCompanyContext({ req, res, companyId: String(companyId).trim() });
  if (!companyContext) return;

  const actorId = await getActorUserId(req);
  if (!actorId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const authorized = await isActorAuthorized(actorId, companyContext.companyId);
  if (!authorized) return res.status(403).json({ error: 'FORBIDDEN' });

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const { id: userId } = await findOrCreateUserByEmail(normalizedEmail);

    // Preserve existing role if any.
    // Closure-015J (R-13): every membership row of the user in this company is
    // read (only active rows are unique) — an arbitrary first row decided before.
    const { data: existingRoleRows, error: existingRolesError } = await supabaseAdmin
      .from('user_company_roles')
      .select('id, role, status')
      .eq('user_id', userId)
      .eq('company_id', companyId);
    if (existingRolesError) {
      return res.status(503).json({ error: 'MEMBERSHIP_LOOKUP_FAILED' });
    }
    const existingRows = ((existingRoleRows ?? []) as Array<{ id: string; role: string | null; status: string | null }>)
      .map((r) => ({ id: r.id, role: r.role, status: r.status }));
    if (existingRows.some((r) => normalizeRole(r.role ?? '') === Role.SUPER_ADMIN)) {
      return res.status(403).json({ error: 'SUPER_ADMIN_NOT_REINVITABLE' });
    }
    // Closure-015J (R-13): an ACTIVE member is not reinvited — the delete +
    // insert below reset it to 'invited' and removed its access. Refused before
    // any write, invitation or email.
    if (existingRows.some((r) => r.status === 'active')) {
      return res.status(409).json({ error: 'ALREADY_ACTIVE_MEMBER' });
    }

    const role = existingRows[0]?.role || 'CONTENT_CREATOR';

    // Closure-015D — reinvitation never grants, restores or removes a
    // SUPER_ADMIN membership (any status). SUPER_ADMIN is granted only through
    // identity.admin.assign and revoked only through identity.admin.revoke;
    // this company-admin route may do neither. Refused before any write.
    const canonicalRole = normalizeRole(role);
    if (canonicalRole === Role.SUPER_ADMIN) {
      return res.status(403).json({ error: 'SUPER_ADMIN_NOT_REINVITABLE' });
    }
    // The invitation must name the role acceptance will activate. The preserved
    // role is mapped onto the invitation vocabulary (invitations_role_check:
    // COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER,
    // VIEW_ONLY) by the existing normalizeRole aliases — ADMIN → COMPANY_ADMIN,
    // CONTENT_MANAGER / CONTENT_PLANNER → CONTENT_CREATOR, CONTENT_ENGAGER /
    // VIEWER → VIEW_ONLY. A role with no such mapping fails closed.
    const INVITATION_ROLES: ReadonlyArray<string> = [
      Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_REVIEWER, Role.CONTENT_PUBLISHER, Role.VIEW_ONLY,
    ];
    if (!canonicalRole || !INVITATION_ROLES.includes(canonicalRole)) {
      return res.status(409).json({ error: 'ROLE_NOT_REINVITABLE' });
    }

    // Reset role to invited state.
    // Closure-015J (R-13): only the (non-active) rows read above are removed, each
    // by a conditional delete on id + status as read — a row activated in between
    // is never deleted; the reinvite then stops (STALE_MEMBERSHIP) before
    // inserting, issuing an invitation or sending email.
    for (const row of existingRows) {
      let removal = supabaseAdmin
        .from('user_company_roles')
        .delete()
        .eq('id', row.id);
      removal = row.status === null ? removal.is('status', null) : removal.eq('status', row.status);
      const { data: removed, error: removeError } = await removal.select('id');
      if (removeError) throw new Error(removeError.message);
      if (!removed || removed.length === 0) {
        return res.status(409).json({ error: 'STALE_MEMBERSHIP' });
      }
    }

    await supabaseAdmin.from('user_company_roles').insert({
      user_id: userId,
      company_id: companyId,
      role,
      status: 'invited',
      created_at: new Date().toISOString(),
    });

    const rawToken = await createInvitationToken(userId, normalizedEmail, companyId, actorId, canonicalRole);
    const inviteUrl = `${getCanonicalAppUrl()}/accept-invite?token=${rawToken}`;

    // Send the invite via SES through the email_jobs queue. Idempotency
    // key bound to (user, company) so back-to-back reinvite requests
    // collapse to a single email instead of spamming the recipient.
    await sendInvite(
      normalizedEmail,
      inviteUrl,
      `reinvite:${companyId}:${userId}`,
    );

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'FAILED_TO_REINVITE_USER' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/users/reinvite' });

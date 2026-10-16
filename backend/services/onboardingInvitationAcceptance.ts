/**
 * Closure-015M (R-14) — invitation acceptance from onboarding (setup-company).
 *
 * setup-company used to move ANY 'invited' membership of the caller to 'active'
 * by row id: no invitation, no expiry, no revocation, no single use — and no role
 * check, so an invited SUPER_ADMIN row became ACTIVE platform authority outside
 * identity.admin.assign. Onboarding now accepts an invitation with the same rules
 * as the token flow (pages/api/team/accept-invite.ts):
 *
 *   1. the invited row's role must be an INVITATION role (invitations_role_check):
 *      SUPER_ADMIN — or anything else — is refused before any write; platform
 *      super-admin authority is granted only by bootstrap-super-admin
 *      (identity.admin.assign + step-up);
 *   2. a pending invitation must exist for this company and the caller's
 *      (verified) email: not revoked, not accepted, not expired;
 *   3. the role that becomes active is the INVITATION's role (the row's stored
 *      role is not trusted; nothing in the request body is consulted);
 *   4. the invitation is claimed first, conditionally (accepted_at IS NULL AND
 *      revoked_at IS NULL) — a replay or a concurrent acceptance loses;
 *   5. the membership is activated conditionally on id + role + 'invited' as read —
 *      a concurrent change loses (STALE_MEMBERSHIP) and the claim is released;
 *   6. the same INVITATION_ACCEPTED audit row as the token flow (via: onboarding).
 *
 * Tenant isolation: the invitation is looked up by the membership's own
 * company_id and the caller's email; nothing crosses companies.
 */
import { supabase } from '../db/supabaseClient';
import { insertAuditLogStrict, SYSTEM_USER_ID } from './auditActorService';
import { isInvitationExpired } from './invitationExpiry';
import { normalizeRole } from './rbacPrimitives';

/** invitations_role_check — the only roles an invitation can activate. */
export const INVITATION_ACCEPTANCE_ROLES: ReadonlyArray<string> = [
  'COMPANY_ADMIN',
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
];

export type InvitedMembership = { id: string; company_id: string; role: string | null; status: string | null };

export type OnboardingAcceptanceResult =
  | { ok: true; companyId: string; role: string; invitationId: string }
  | {
      ok: false;
      status: 403 | 409 | 410 | 500 | 503;
      error:
        | 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT'
        | 'INVITATION_REQUIRED'
        | 'INVITATION_EXPIRED'
        | 'INVITATION_ALREADY_USED'
        | 'STALE_MEMBERSHIP'
        | 'INVITATION_LOOKUP_FAILED'
        | 'ACCEPTANCE_FAILED';
    };

export async function acceptInvitationViaOnboarding(input: {
  userId: string;
  email: string;
  membership: InvitedMembership;
}): Promise<OnboardingAcceptanceResult> {
  const { userId, membership } = input;
  const email = String(input.email || '').trim().toLowerCase();
  // Snapshot what was read: the conditional write compares against THESE values.
  const rowId = membership.id;
  const rowRole = membership.role;
  const companyId = membership.company_id;

  // 1. Role gate — before any read or write.
  const canonical = normalizeRole(String(rowRole ?? '')) as string | null;
  if (membership.status !== 'invited' || !canonical || !INVITATION_ACCEPTANCE_ROLES.includes(canonical)) {
    await insertAuditLogStrict({
      actorUserId: userId || SYSTEM_USER_ID,
      action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED',
      targetUserId: userId,
      companyId,
      metadata: { operation: 'ONBOARDING_INVITATION_ACCEPT', stored_role: rowRole, stored_status: membership.status },
    });
    return { ok: false, status: 403, error: 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT' };
  }

  // 2. A pending invitation for this company + this verified email.
  const { data: invitations, error: invitationError } = await supabase
    .from('invitations')
    .select('id, email, company_id, role, accepted_at, revoked_at, expires_at')
    .eq('company_id', companyId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null);
  if (invitationError) {
    return { ok: false, status: 503, error: 'INVITATION_LOOKUP_FAILED' };
  }
  const pending = ((invitations ?? []) as Array<{ id: string; role: string; expires_at: string | null }>)
    .map((i) => ({ id: i.id, role: i.role, expires_at: i.expires_at }));
  if (pending.length === 0) {
    return { ok: false, status: 409, error: 'INVITATION_REQUIRED' };
  }
  const live = pending.filter((i) => !isInvitationExpired(i.expires_at));
  if (live.length === 0) {
    return { ok: false, status: 410, error: 'INVITATION_EXPIRED' };
  }
  // The newest unexpired invitation decides (reinvite revokes older ones anyway).
  const invitation = live.reduce((a, b) => (String(b.expires_at ?? '') > String(a.expires_at ?? '') ? b : a));
  const invitedRole = normalizeRole(String(invitation.role ?? '')) as string | null;
  if (!invitedRole || !INVITATION_ACCEPTANCE_ROLES.includes(invitedRole)) {
    return { ok: false, status: 403, error: 'INVITED_ROLE_REQUIRES_GOVERNED_GRANT' };
  }

  // 3./4. Claim the invitation (single use; a replay or a concurrent acceptance loses).
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('invitations')
    .update({ accepted_at: now, accepted_by: userId })
    .eq('id', invitation.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('id');
  if (claimError) {
    return { ok: false, status: 500, error: 'ACCEPTANCE_FAILED' };
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: 409, error: 'INVITATION_ALREADY_USED' };
  }

  // 5. Activate the membership with the INVITATION's role, conditionally on the row as read.
  let activate = supabase
    .from('user_company_roles')
    .update({ role: invitedRole, status: 'active', accepted_at: now, deactivated_at: null, updated_at: now })
    .eq('id', rowId)
    .eq('status', 'invited');
  activate = rowRole === null ? activate.is('role', null) : activate.eq('role', rowRole);
  const { data: activated, error: activateError } = await activate.select('id');
  if (activateError || !activated || activated.length === 0) {
    // Release the claim so the invitation stays usable (best effort; reported either way).
    await supabase
      .from('invitations')
      .update({ accepted_at: null, accepted_by: null })
      .eq('id', invitation.id)
      .eq('accepted_by', userId);
    return activateError
      ? { ok: false, status: 500, error: 'ACCEPTANCE_FAILED' }
      : { ok: false, status: 409, error: 'STALE_MEMBERSHIP' };
  }

  // 6. Same audit semantics as the token flow.
  await insertAuditLogStrict({
    actorUserId: userId || SYSTEM_USER_ID,
    action: 'INVITATION_ACCEPTED',
    targetUserId: userId,
    companyId,
    metadata: { invitation_id: invitation.id, role: invitedRole, previous_role_value: rowRole, via: 'onboarding' },
  });
  return { ok: true, companyId, role: invitedRole, invitationId: invitation.id };
}

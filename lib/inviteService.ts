import crypto from 'crypto';
import { runWithServiceRole } from '@/backend/db/supabaseClient';
import { UserState } from './userLifecycle';

export type InviteStatus = 'invited' | 'accepted' | 'expired';

export type InviteResult =
  | { ok: true; invite: any; reused: boolean }
  | { ok: false; status: number; error: string };

const DEFAULT_INVITE_DAYS = 7;

export const normalizeInviteEmail = (email: string) => email.trim().toLowerCase();

export const hashInviteToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export function calculateInviteExpiry(now = new Date(), days = DEFAULT_INVITE_DAYS): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function createOrExtendInvite(input: {
  email: string;
  organization_id: string;
  role: string;
  invited_by: string;
  token?: string;
  now?: Date;
}): Promise<InviteResult> {
  const email = normalizeInviteEmail(input.email);
  const expires_at = calculateInviteExpiry(input.now);
  const nowIso = (input.now ?? new Date()).toISOString();

  const { data: existing, error: existingError } = await runWithServiceRole(
    'Resolve existing organization invite',
    (client) => client
      .from('invitations')
      .select('*')
      .eq('email', email)
      .eq('organization_id', input.organization_id)
      .eq('status', 'invited')
      .maybeSingle(),
  );

  if (existingError) {
    return { ok: false, status: 500, error: 'FAILED_TO_RESOLVE_INVITE' };
  }

  if (existing) {
    const { data: updated, error: updateError } = await runWithServiceRole(
      'Extend existing organization invite',
      (client) => client
        .from('invitations')
        .update({ expires_at, role: input.role, status: 'invited', updated_at: nowIso })
        .eq('id', (existing as any).id)
        .select('*')
        .single(),
    );
    if (updateError || !updated) {
      return { ok: false, status: 500, error: 'FAILED_TO_EXTEND_INVITE' };
    }
    return { ok: true, invite: updated, reused: true };
  }

  const token = input.token ?? crypto.randomUUID();
  const { data: created, error: createError } = await runWithServiceRole(
    'Create organization invite',
    (client) => client
      .from('invitations')
      .insert({
        email,
        organization_id: input.organization_id,
        role: input.role,
        invited_by: input.invited_by,
        expires_at,
        status: 'invited',
        token_hash: hashInviteToken(token),
      })
      .select('*')
      .single(),
  );

  if (createError || !created) {
    if ((createError as any)?.code === '23505') {
      return { ok: false, status: 409, error: 'ACTIVE_INVITE_ALREADY_EXISTS' };
    }
    return { ok: false, status: 500, error: 'FAILED_TO_CREATE_INVITE' };
  }

  return { ok: true, invite: { ...created, token }, reused: false };
}

export async function markInviteAccepted(inviteId: string, acceptedBy: string, now = new Date()) {
  return runWithServiceRole('Accept organization invite', (client) => client
    .from('invitations')
    .update({
      status: 'accepted',
      accepted_at: now.toISOString(),
      accepted_by: acceptedBy,
      accepted_user_id: acceptedBy,
      token_consumed_at: now.toISOString(),
    })
    .eq('id', inviteId)
    .eq('status', 'invited'));
}

export const inviteLifecycleState = UserState.INVITED;

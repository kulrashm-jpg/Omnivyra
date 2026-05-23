/**
 * POST /api/super-admin/invitations/[invitationId]/resend
 *
 * Phase 2.A.1 — admin re-enqueues an invitation for delivery.
 *
 * Behavior:
 *   - magic_link invitations only. Temp-password invites are not resent
 *     because the original credential is single-use and the resend would
 *     either reveal a stale secret or require generating a new one (which
 *     belongs to a separate rotate-credentials flow).
 *   - The invitation row itself is NOT modified (token, expiry, etc).
 *   - Any pending/failed email_jobs row for this invitation is marked
 *     dead with reason='admin_resend' (audit trail preserved).
 *   - A fresh email_jobs row is enqueued for the worker to drain.
 *
 * Auth:
 *   - requireCapability(IDENTITY_ADMIN_ASSIGN) — same gate as create
 *     endpoint; phishing-resistant + trusted-device step-up required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { supabase } from '../../../../../backend/db/supabaseClient';
import { logger } from '../../../../../backend/services/logger';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../../shared/contracts/security';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../../../backend/services/auditActorService';
import { enqueueEmailJob } from '../../../../../backend/services/emailJobsService';
import { requireAdminRateLimit } from '../../../../../backend/services/requestAccessService';
import { createHmac, createHash } from 'crypto';

function appUrl(): string {
  return getCanonicalAppUrl();
}

function invitationSecret(): string {
  return (
    process.env.INVITATION_TOKEN_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || 'local-dev-invite-secret'
  );
}

/**
 * Rebuild the deterministic raw token for a given invitation.
 *
 * The token is HMAC(secret, [email, company_id, idempotency_key].join(':'))
 * — see backend/services/invitationService.ts buildInvitationToken. We
 * regenerate it (rather than persist it) so the original send still works
 * and the user can use either email link interchangeably.
 *
 * NOTE: this rebuild matches the createInvitation path's idempotency-key
 * basis. If the invitation row was created with a non-default key, the
 * rebuild only works when that key is recorded on the invitation row.
 * Our schema stores it in invitations.idempotency_key.
 */
function rebuildRawToken(email: string, companyId: string, idempotencyKey: string | null): string {
  const basis = [email.toLowerCase(), companyId, idempotencyKey ?? ''].join(':');
  return createHmac('sha256', invitationSecret()).update(basis).digest('hex');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:invite:resend', 30, 60))) return;

  const invitationId = String(req.query.invitationId || '').trim();
  if (!invitationId) {
    return res.status(400).json({ error: 'MISSING_INVITATION_ID' });
  }

  // Capability + step-up.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `super-admin resends invitation ${invitationId}`,
    resourceId: invitationId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  // Load invitation.
  const { data: invitation, error: invErr } = await supabase
    .from('invitations')
    .select('id, email, company_id, role, expires_at, accepted_at, revoked_at, token_consumed_at, idempotency_key')
    .eq('id', invitationId)
    .maybeSingle();

  if (invErr) {
    logger.error('super_admin_invite_resend_lookup_failed', { invitationId, message: invErr.message });
    return res.status(500).json({ error: 'INVITATION_LOOKUP_FAILED', details: invErr.message });
  }
  if (!invitation) {
    return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
  }
  if ((invitation as any).accepted_at) {
    return res.status(409).json({ error: 'INVITATION_ALREADY_ACCEPTED' });
  }
  if ((invitation as any).revoked_at) {
    return res.status(409).json({ error: 'INVITATION_REVOKED' });
  }
  if (new Date((invitation as any).expires_at) <= new Date()) {
    return res.status(409).json({ error: 'INVITATION_EXPIRED', details: 'Issue a fresh invitation instead.' });
  }

  // Mark any in-flight email_jobs for THIS invitation as dead (admin-driven).
  const { data: inflight } = await supabase
    .from('email_jobs')
    .select('id, status')
    .eq('invitation_id', invitationId)
    .in('status', ['pending', 'processing', 'failed']);
  if (inflight && inflight.length > 0) {
    for (const row of inflight) {
      const id = (row as any).id;
      const { error: finErr } = await supabase.rpc('finalize_email_job', {
        p_job_id: id,
        p_status: 'dead',
        p_error: 'admin_resend',
        p_provider_message_id: null,
        p_next_attempt_at: null,
      });
      if (finErr) {
        logger.warn('super_admin_invite_resend_finalize_inflight_failed', {
          jobId: id,
          message: finErr.message,
        });
      }
    }
  }

  // Rebuild token + invite URL for the resend.
  const email = String((invitation as any).email).toLowerCase();
  const companyId = String((invitation as any).company_id);
  const role = String((invitation as any).role);
  const expectedRawToken = rebuildRawToken(email, companyId, (invitation as any).idempotency_key ?? null);

  // Sanity check: the rebuilt hash must match the persisted one. If it
  // doesn't, the resend cannot work without persisting a new token —
  // surface a clear error to the operator.
  const { data: tokenRow } = await supabase
    .from('invitations')
    .select('token_hash')
    .eq('id', invitationId)
    .maybeSingle();
  if (!tokenRow || hashToken(expectedRawToken) !== (tokenRow as any).token_hash) {
    return res.status(409).json({
      error: 'TOKEN_REBUILD_MISMATCH',
      details:
        'The invitation token cannot be regenerated for this row (token_hash mismatch). '
        + 'Use the create-user flow to issue a fresh invitation.',
    });
  }

  const inviteUrl = `${appUrl()}/auth/accept-invite?token=${expectedRawToken}`;

  // Load company name for the email body.
  const { data: companyRow } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  const companyName = (companyRow as any)?.name ?? null;

  // Look up recipient display name (best-effort).
  const { data: userRow } = await supabase
    .from('users')
    .select('name')
    .eq('email', email)
    .maybeSingle();
  const recipientName = (userRow as any)?.name ?? null;

  const correlationId = `super_admin_resend:${invitationId}:${Date.now()}`;

  try {
    const enqueued = await enqueueEmailJob({
      templateKey: 'team_invite_magic_link',
      recipientEmail: email,
      invitationId,
      correlationId,
      payload: {
        recipientEmail: email,
        recipientName,
        companyName,
        role,
        inviteUrl,
        invitationId,
        correlationId,
      },
    });

    await insertAuditLogStrict({
      actorUserId,
      action: 'SUPER_ADMIN_INVITE_RESEND',
      targetUserId: null,
      companyId,
      metadata: {
        invitation_id: invitationId,
        job_id: enqueued.jobId,
        previous_inflight_jobs: (inflight ?? []).map((r) => (r as any).id),
        correlation_id: correlationId,
      },
    });

    return res.status(202).json({
      invitation_id: invitationId,
      delivery: {
        status: 'queued',
        job_id: enqueued.jobId,
        correlation_id: correlationId,
        replayed: enqueued.replayed,
      },
    });
  } catch (err: any) {
    logger.error('super_admin_invite_resend_enqueue_failed', {
      invitationId,
      message: err?.message ?? String(err),
    });
    return res.status(500).json({
      error: 'RESEND_ENQUEUE_FAILED',
      details: err?.message ?? String(err),
    });
  }
}

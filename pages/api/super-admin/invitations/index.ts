/**
 * GET /api/super-admin/invitations
 *
 * Phase 2.A.1 — list invitations with their latest delivery state.
 *
 * Query params:
 *   - companyId (optional) — filter to a single company
 *   - status (optional)    — 'pending' | 'accepted' | 'revoked' | 'expired'
 *                            (defaults to 'pending' — the most common admin
 *                            workflow is "what's outstanding?")
 *
 * Returns invitations + the most recent email_jobs row per invitation
 * (joined as latest_job). NO payload, NO encrypted fields ever surfaced.
 *
 * Auth: requireCapability(SUPER_ADMIN_DASHBOARD_VIEW) — bridge-compatible.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { logger } from '../../../../backend/services/logger';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';

type StatusFilter = 'pending' | 'accepted' | 'revoked' | 'expired';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin lists invitations',
  });
  if (guard.ok !== true) return;

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  const statusFilter = (
    typeof req.query.status === 'string' ? req.query.status.trim() : 'pending'
  ) as StatusFilter;

  let query = supabase
    .from('invitations')
    .select('id, email, company_id, role, expires_at, accepted_at, revoked_at, token_consumed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (companyId) query = query.eq('company_id', companyId);

  const now = new Date().toISOString();
  if (statusFilter === 'pending') {
    query = query.is('accepted_at', null).is('revoked_at', null).gt('expires_at', now);
  } else if (statusFilter === 'accepted') {
    query = query.not('accepted_at', 'is', null);
  } else if (statusFilter === 'revoked') {
    query = query.not('revoked_at', 'is', null);
  } else if (statusFilter === 'expired') {
    query = query.is('accepted_at', null).is('revoked_at', null).lt('expires_at', now);
  }

  const { data: invitations, error: invErr } = await query;
  if (invErr) {
    logger.error('super_admin_invitations_list_failed', { message: invErr.message });
    return res.status(500).json({ error: 'INVITATIONS_LIST_FAILED', details: invErr.message });
  }

  const invIds = (invitations ?? []).map((row) => (row as any).id as string).filter(Boolean);
  if (invIds.length === 0) {
    return res.status(200).json({ invitations: [] });
  }

  // Fetch latest job per invitation in a single query, then group client-side.
  const { data: jobs, error: jobErr } = await supabase
    .from('email_jobs')
    .select('id, invitation_id, status, retry_count, max_retries, next_attempt_at, last_attempt_at, sent_at, dead_lettered_at, last_error, template_key, created_at')
    .in('invitation_id', invIds)
    .order('created_at', { ascending: false });

  if (jobErr) {
    logger.warn('super_admin_invitations_jobs_lookup_failed', { message: jobErr.message });
  }

  const latestByInvitation = new Map<string, Record<string, unknown>>();
  for (const j of jobs ?? []) {
    const invId = (j as any).invitation_id as string | null;
    if (!invId) continue;
    if (!latestByInvitation.has(invId)) {
      latestByInvitation.set(invId, {
        job_id: (j as any).id,
        status: (j as any).status,
        retry_count: (j as any).retry_count,
        max_retries: (j as any).max_retries,
        next_attempt_at: (j as any).next_attempt_at,
        last_attempt_at: (j as any).last_attempt_at,
        sent_at: (j as any).sent_at,
        dead_lettered_at: (j as any).dead_lettered_at,
        last_error: (j as any).last_error,
        template_key: (j as any).template_key,
        created_at: (j as any).created_at,
      });
    }
  }

  const deriveDeliveryState = (job: Record<string, unknown> | undefined): string => {
    if (!job) return 'none';
    const status = job.status as string | null;
    const retry = (job.retry_count as number | null) ?? 0;
    if (status === 'pending') return 'queued';
    if (status === 'processing') return 'sending';
    if (status === 'sent') return 'sent';
    if (status === 'dead') return 'dead';
    if (status === 'failed') return retry > 0 ? 'retrying' : 'failed';
    return 'none';
  };

  const result = (invitations ?? []).map((row) => {
    const invId = (row as any).id as string;
    const job = latestByInvitation.get(invId);
    return {
      id: invId,
      email: (row as any).email,
      company_id: (row as any).company_id,
      role: (row as any).role,
      expires_at: (row as any).expires_at,
      accepted_at: (row as any).accepted_at,
      revoked_at: (row as any).revoked_at,
      created_at: (row as any).created_at,
      delivery_state: deriveDeliveryState(job),
      latest_job: job ?? null,
    };
  });

  return res.status(200).json({ invitations: result });
}

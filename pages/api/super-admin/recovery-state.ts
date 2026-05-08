/**
 * GET /api/super-admin/recovery-state
 *
 * Operator visibility into users who appear stuck in a recovery /
 * continuation flow. Surfaces:
 *
 *   - users.onboarding_state = 'pending_verification' / 'verified' /
 *     similar partial states older than `stuckHours` (default 24h)
 *   - users.is_email_verified=false older than `stuckHours`
 *   - users with no active company role + no pending invite older than
 *     `stuckHours`
 *
 * Read-only. Repair is operator-driven (admin can resend verification,
 * resend invitation, manually verify email, or trigger a fresh signup
 * intent).
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

const PARTIAL_ONBOARDING_STATES: ReadonlyArray<string> = [
  'pending_verification',
  'verified',
  'profile_pending',
];

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  is_email_verified: boolean | null;
  onboarding_state: string | null;
  active_company_id: string | null;
  has_password: boolean | null;
  is_deleted: boolean | null;
  created_at: string;
  last_sign_in_at: string | null;
}

interface RoleRow {
  user_id: string | null;
  status: string | null;
}

interface InvitationRow {
  email: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:recovery-state', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin recovery-state report',
  });
  if (guard.ok !== true) return;

  const stuckHoursParam = typeof req.query.stuckHours === 'string' ? Number(req.query.stuckHours) : NaN;
  const stuckHours = Number.isFinite(stuckHoursParam) && stuckHoursParam > 0 ? stuckHoursParam : 24;
  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200;

  const cutoff = new Date(Date.now() - stuckHours * 3_600_000).toISOString();

  try {
    // Pull every non-deleted user older than the cutoff. The classifier
    // below decides which (if any) recovery bucket each falls into.
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, is_email_verified, onboarding_state, active_company_id, has_password, is_deleted, created_at, last_sign_in_at')
      .eq('is_deleted', false)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit * 4); // over-fetch so the classifier has headroom

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    const rows = (users ?? []) as UserRow[];
    if (rows.length === 0) {
      return res.status(200).json({ ok: true, total: 0, entries: [], stuckHours });
    }

    // Look up roles + pending invites in one shot per user-id list.
    const userIds = rows.map((r) => r.id);
    const emails  = rows.map((r) => r.email);

    const [{ data: roles }, { data: invites }] = await Promise.all([
      supabase
        .from('user_company_roles')
        .select('user_id, status')
        .in('user_id', userIds)
        .eq('status', 'active'),
      supabase
        .from('invitations')
        .select('email')
        .in('email', emails)
        .is('accepted_at', null)
        .is('revoked_at', null),
    ]);

    const userIdsWithActiveRole = new Set(
      ((roles ?? []) as RoleRow[]).map((r) => r.user_id).filter((id): id is string => !!id),
    );
    const emailsWithPendingInvite = new Set(
      ((invites ?? []) as InvitationRow[]).map((i) => (i.email ?? '').toLowerCase()).filter(Boolean),
    );

    type Bucket =
      | 'unverified_email'
      | 'partial_onboarding_state'
      | 'no_company_no_invite'
      | 'no_password';

    const classified: Array<{
      userId: string;
      email: string;
      name: string | null;
      buckets: Bucket[];
      onboardingState: string | null;
      isEmailVerified: boolean;
      hasPassword: boolean;
      hasActiveRole: boolean;
      hasPendingInvite: boolean;
      activeCompanyId: string | null;
      createdAt: string;
      lastSignInAt: string | null;
    }> = [];

    for (const u of rows) {
      const buckets: Bucket[] = [];

      const verified = u.is_email_verified === true;
      if (!verified) buckets.push('unverified_email');

      if (
        u.onboarding_state &&
        PARTIAL_ONBOARDING_STATES.includes(u.onboarding_state)
      ) {
        buckets.push('partial_onboarding_state');
      }

      const hasRole   = userIdsWithActiveRole.has(u.id);
      const hasInvite = emailsWithPendingInvite.has(u.email.toLowerCase());
      if (!hasRole && !hasInvite) buckets.push('no_company_no_invite');

      // Only flag has_password=false if they're old enough to plausibly
      // have completed the password set-up step (>= cutoff already
      // ensures created_at is older than stuckHours).
      if (u.has_password === false) buckets.push('no_password');

      if (buckets.length === 0) continue;

      classified.push({
        userId:           u.id,
        email:            u.email,
        name:             u.name,
        buckets,
        onboardingState:  u.onboarding_state,
        isEmailVerified:  verified,
        hasPassword:      u.has_password === true,
        hasActiveRole:    hasRole,
        hasPendingInvite: hasInvite,
        activeCompanyId:  u.active_company_id,
        createdAt:        u.created_at,
        lastSignInAt:     u.last_sign_in_at,
      });

      if (classified.length >= limit) break;
    }

    return res.status(200).json({
      ok: true,
      total: classified.length,
      entries: classified,
      stuckHours,
    });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

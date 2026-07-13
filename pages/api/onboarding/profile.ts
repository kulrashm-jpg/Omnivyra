
/**
 * POST /api/onboarding/profile
 *
 * Protected endpoint. Saves user profile (name, phone) and advances
 * onboarding_state to 'profile_complete'.
 *
 * Body: { name: string, phone?: string }
 * Auth: Bearer <supabase_access_token>
 * Returns: { success: true, route: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getPostLoginRoute as getUserPreferenceRoute } from '../../../backend/services/userPreferencesService';
import { selectCompatibleCompanyRole } from '../../../backend/services/companyMembershipIntegrityService';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  requestIp,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

type SuccessResponse = { success: true; route: string };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Bearer token & resolve user ─────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) {
    const status = userErr === 'ACCOUNT_DELETED' ? 403 : 401;
    return res.status(status).json({ error: userErr ?? 'Invalid session', code: userErr ?? undefined });
  }

  // ── 1a. App-level email-verification gate (AUTH-001 §1) ───────────────────
  // Onboarding may not continue for a session whose auth identity is
  // unconfirmed — backstop for the Supabase "Confirm email" project setting.
  if (!user.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { name, phone, jobTitle, industry } = body as {
    name?: string; phone?: string; jobTitle?: string; industry?: string;
  };

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  // ── 2. Update user profile in public.users ────────────────────────────────
  const updates: Record<string, unknown> = {
    name:             name.trim(),
    onboarding_state: 'profile_complete',
  };

  if (phone    !== undefined) updates.phone     = phone.trim()    || null;
  if (jobTitle !== undefined) updates.job_title = jobTitle.trim() || null;
  if (industry !== undefined) updates.industry  = industry.trim() || null;

  const { error: updateErr } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id);

  if (updateErr) {
    console.error('[onboarding/profile] update error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  // ── 3. Determine next route ───────────────────────────────────────────────
  // After profile completion, user needs to set up or join a company
  const { data: roleRows } = await supabase
    .from('user_company_roles')
    .select('company_id, join_source, created_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const rawRows = (roleRows as Array<{ company_id?: string | null; join_source?: string | null }> | null) ?? [];
  const companyIds = Array.from(new Set(rawRows.map((row) => row.company_id).filter(Boolean) as string[]));
  const { data: companyRows } = companyIds.length
    ? await supabase
        .from('companies')
        .select('id, website_domain, admin_email_domain')
        .in('id', companyIds)
    : { data: [] as any[] };
  const companyById = new Map((companyRows || []).map((row: any) => [String(row.id), row]));
  const compatibleRole = selectCompatibleCompanyRole({
    rows: rawRows,
    companyById,
    userEmail: user.email ?? null,
  });

  const route = compatibleRole ? await getUserPreferenceRoute(user.id) : '/onboarding/company';

  // Canonical journey event (AUTH-001 §9): the profile step is the first
  // onboarding action after verification.
  const eventEmail = user.email ?? null;
  if (eventEmail) {
    void ensureSignupCorrelationId(eventEmail).then((correlationId) =>
      emitSignupEvent({
        event:         'OnboardingStarted',
        outcome:       'allowed',
        correlationId,
        email:         eventEmail,
        userId:        user.id,
        reason:        'onboarding_state=profile_complete',
        ip:            requestIp(req),
        userAgent:     requestUserAgent(req),
      }),
    );
  }

  return res.status(200).json({ success: true, route });
}

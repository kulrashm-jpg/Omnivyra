/**
 * POST /api/onboarding/setup-company
 * Authorization: Bearer <supabase_access_token>
 *
 * Creates a company record + links the authenticated user as ADMIN.
 * Idempotent: if user already has a company, returns the existing one.
 *
 * Body: { companyName, website, industry, companySize }
 * Returns: { companyId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import {
  findMatchingCompany,
  notifyCompanyAdminsOfSelfJoin,
  extractDomain,
  isFreeEmailDomain,
} from '../../../backend/services/companyMatchService';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';

type Result =
  | { companyId: string; selfJoined?: boolean; matchedCompanyName?: string }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  // Verify token with anon client, then use service role for table writes
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Service role bypasses RLS — required for inserts into companies,
  // user_company_roles, company_profiles, and free_credit_profiles.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    companyName = '',
    website     = '',
    industry    = '',
    companySize = '',
  } = body as {
    companyName?: string;
    website?: string;
    industry?: string;
    companySize?: string;
  };

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  // ── Domain eligibility gate ───────────────────────────────────────────────
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (eligibility.status === 'blocked') {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }
  }

  try {
    // ── 1. Fix any SUPER_ADMIN role — company users must be COMPANY_ADMIN ─────
    await supabase
      .from('user_company_roles')
      .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('role', 'SUPER_ADMIN');

    // ── 2. Check for existing company membership (idempotent) ────────────────
    const { data: existing } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existing?.company_id) {
      return res.status(200).json({ companyId: existing.company_id });
    }

    // ── 3. Check if a matching company already exists in the system ───────────
    const matched = await findMatchingCompany({
      companyName: companyName.trim(),
      website: website.trim() || null,
      userEmail: user.email ?? null,
    });

    if (matched) {
      // User's company already exists — add them as CONTENT_CREATOR (self-joined)
      const now = new Date().toISOString();

      // Idempotent: skip if already a member
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', matched.company_id)
        .maybeSingle();

      if (!existingRole) {
        const { error: roleErr } = await supabase.from('user_company_roles').insert({
          user_id:     user.id,
          company_id:  matched.company_id,
          role:        'CONTENT_CREATOR',
          status:      'active',
          join_source: 'self_joined',
          created_at:  now,
          updated_at:  now,
          invited_at:  now,
        });
        if (roleErr) throw roleErr;
      }

      // Update free_credit_profiles with the org_id
      await supabase
        .from('free_credit_profiles')
        .update({ organization_id: matched.company_id, updated_at: now })
        .eq('user_id', user.id);

      // Notify all company admins (non-fatal)
      try {
        await notifyCompanyAdminsOfSelfJoin({
          companyId: matched.company_id,
          companyName: matched.company_name,
          newUserId: user.id,
          newUserEmail: user.email ?? null,
          matchType: matched.match_type,
        });
      } catch (notifyErr: any) {
        console.warn('[setup-company] admin notification failed:', notifyErr?.message);
      }

      return res.status(200).json({
        companyId: matched.company_id,
        selfJoined: true,
        matchedCompanyName: matched.company_name,
      });
    }

    const companyId = randomUUID();
    const now = new Date().toISOString();

    // ── 3. Create companies row ───────────────────────────────────────────────
    // website_domain: normalised domain from the website URL (e.g. "drishiq.com"
    //   from "www.drishiq.com"). Used for fast indexed lookup when a new user
    //   from the same domain signs up independently.
    // admin_email_domain: fallback for companies created without a real website.
    const websiteDomain = (() => {
      const d = extractDomain(website.trim());
      return d && !isFreeEmailDomain(d) ? d : null;
    })();
    const adminEmailDomain = (() => {
      const d = extractDomain(user.email ?? '');
      return d && !isFreeEmailDomain(d) ? d : null;
    })();

    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               companyName.trim(),
      website:            website.trim() || companyId, // NOT NULL — use companyId as placeholder if blank
      industry:           industry.trim() || null,
      status:             'active',
      website_domain:     websiteDomain,
      admin_email_domain: adminEmailDomain,
      created_at:         now,
    });
    if (companyErr) throw companyErr;

    // ── 4. Create user_company_roles row (company admin) ─────────────────────
    const { error: roleErr } = await supabase.from('user_company_roles').insert({
      user_id:     user.id,
      company_id:  companyId,
      role:        'COMPANY_ADMIN',
      status:      'active',
      join_source: 'invited',
      created_at:  now,
      updated_at:  now,
      invited_at:  now,
    });
    if (roleErr) throw roleErr;

    // ── 5. Create company_profiles row ────────────────────────────────────────
    await supabase.from('company_profiles').insert({
      company_id:  companyId,
      name:        companyName.trim(),
      website_url: website.trim() || null,
      industry:    industry.trim() || null,
      geography:   companySize.trim() || null, // repurpose for team size hint
      created_at:  now,
      updated_at:  now,
    });
    // Non-fatal if profile insert fails — company + role are sufficient

    // ── 6. Update free_credit_profiles with org_id (if exists) ───────────────
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    // ── 7. Retroactively grant pending free credits ───────────────────────────
    // onboarding/complete runs BEFORE setup-company, so orgId is null when
    // credits are first attempted. Grant them now that the org exists.
    const { data: pendingProfile } = await supabase
      .from('free_credit_profiles')
      .select('id, initial_credits, credit_expiry_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (pendingProfile?.initial_credits) {
      const { data: existingClaim } = await supabase
        .from('free_credit_claims')
        .select('id, organization_id')
        .eq('user_id', user.id)
        .eq('category', 'initial')
        .maybeSingle();

      if (!existingClaim) {
        // First time — grant credits and log claim
        const expiryNote = pendingProfile.credit_expiry_at
          ? ` (expires ${(pendingProfile.credit_expiry_at as string).slice(0, 10)})`
          : '';
        const { error: creditErr } = await supabase.rpc('apply_credit_transaction', {
          p_organization_id: companyId,
          p_transaction_type: 'purchase',
          p_credits_delta: pendingProfile.initial_credits,
          p_usd_equivalent: null,
          p_reference_type: 'free_credits',
          p_reference_id: null,
          p_note: `Free credits — onboarding${expiryNote}`,
          p_performed_by: user.id,
        });
        if (creditErr) {
          console.error('[setup-company] credit grant failed:', creditErr.message);
          // Non-fatal — company is still created
        } else {
          await supabase.from('free_credit_claims').insert({
            user_id:         user.id,
            organization_id: companyId,
            category:        'initial',
            credits_granted: pendingProfile.initial_credits,
          });
        }
      } else if (!existingClaim.organization_id) {
        // Claim was logged without an org — backfill the org reference
        await supabase
          .from('free_credit_claims')
          .update({ organization_id: companyId })
          .eq('user_id', user.id)
          .eq('category', 'initial');
        // Also grant the credits since they were skipped (orgId was null)
        const expiryNote = pendingProfile.credit_expiry_at
          ? ` (expires ${(pendingProfile.credit_expiry_at as string).slice(0, 10)})`
          : '';
        await supabase.rpc('apply_credit_transaction', {
          p_organization_id: companyId,
          p_transaction_type: 'purchase',
          p_credits_delta: pendingProfile.initial_credits,
          p_usd_equivalent: null,
          p_reference_type: 'free_credits',
          p_reference_id: null,
          p_note: `Free credits — onboarding retroactive${expiryNote}`,
          p_performed_by: user.id,
        });
      }
    }

    return res.status(200).json({ companyId });
  } catch (err: any) {
    console.error('[onboarding/setup-company]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

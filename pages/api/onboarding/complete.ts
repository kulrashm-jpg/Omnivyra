/**
 * POST /api/onboarding/complete
 *
 * Called after phone verification to:
 *  0. Create user in database users table (if not exists)
 *  1. Create a free_credit_profiles row (idempotent)
 *  2. Grant 300 initial credits via creditExecutionService.createCredit()
 *  3. Log the 'initial' claim in free_credit_claims
 *
 * Body:
 *  {
 *    phoneNumber:   string   -- E.164 format (required)
 *    firebaseUid:   string   -- UID from Firebase phone auth (required)
 *    firebaseIdToken: string -- Firebase ID token for verification (optional but recommended)
 *    companyName:   string   -- Company name (optional, defaults to email prefix)
 *    intentGoals:   string[] -- Q1 answers (optional)
 *    intentTeam:    string   -- Q2 answer (optional)
 *    intentChallenges: string[] -- Q3 answers (optional)
 *  }
 *
 * Auth: requires Supabase session (user must be logged in via email OTP first)
 *
 * User Flow:
 *  1. User signs up via /create-account (created in Supabase auth only)
 *  2. User verifies phone (Firebase SMS OTP)
 *  3. This endpoint is called to:
 *     - Create user record in database (for login lookup via /api/auth/check-user)
 *     - Create free credit profile
 *     - Grant 300 initial credits
 *  4. User can now log in via /login (which checks database users table)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '../../../backend/services/creditExecutionService';
import { verifyFirebaseIdToken as verifyFirebaseAdmin } from '../../../lib/firebaseAdmin';
import { checkRateLimit, ONBOARDING_COMPLETE_LIMIT, ONBOARDING_UID_LIMIT } from '../../../lib/auth/rateLimit';

// Fallback constants — overridden by free_credit_config DB row at runtime
const INITIAL_CREDITS_DEFAULT = 300;
const EXPIRY_DAYS_DEFAULT     = 14;

/**
 * Verifies a Firebase ID token using Firebase's public REST API.
 * Returns the decoded payload (including uid and phone_number) or throws.
 * Does not require firebase-admin SDK.
 */
async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; phone_number?: string }> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set');

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? 'Firebase token verification failed');
  }

  const data = await resp.json() as { users?: Array<{ localId: string; phoneNumber?: string }> };
  const user = data.users?.[0];
  if (!user?.localId) throw new Error('Firebase token did not resolve to a user');

  return { uid: user.localId, phone_number: user.phoneNumber };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = String(
    req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown'
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, ONBOARDING_COMPLETE_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many onboarding attempts. Please try again later.' });
  }

  // ── Auth: verify Firebase ID token from Authorization header ─────────────
  const authHeader = req.headers.authorization ?? '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let firebaseEmail: string;
  let firebaseUidFromToken: string;
  try {
    const decoded = await verifyFirebaseAdmin(idToken);
    if (!decoded.email) throw new Error('Token has no email');
    firebaseEmail = decoded.email;
    firebaseUidFromToken = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid Firebase token' });
  }

  // ── Post-auth UID rate limit ──────────────────────────────────────────────
  // Second pass keyed by Firebase UID — blocks rotating-proxy abuse where a
  // single identity uses many IPs to bypass the IP-based pre-auth check above.
  const rlUid = await checkRateLimit(firebaseUidFromToken, ONBOARDING_UID_LIMIT);
  if (!rlUid.allowed) {
    return res.status(429).json({ error: 'Too many onboarding attempts. Please try again later.' });
  }

  // Look up or create the internal users row
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userDbRow } = await supabaseAdmin
    .from('users')
    .select('id, email, is_deleted')
    .eq('firebase_uid', firebaseUidFromToken)
    .maybeSingle();

  // Block soft-deleted users from re-onboarding even with a valid Firebase token.
  // sync-firebase-user already enforces this during login, but onboarding/complete
  // is an independent endpoint and must enforce it independently (defence-in-depth).
  if (userDbRow && (userDbRow as any).is_deleted) {
    console.warn('[onboarding/complete] ghost_session_detected', {
      event:  'ghost_session_detected',
      uid:    firebaseUidFromToken,
      reason: 'user_is_soft_deleted',
    });
    return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
  }

  // Build a synthetic user object compatible with the rest of this handler
  const user = {
    id:    userDbRow ? (userDbRow as any).id : null,
    email: firebaseEmail,
    // firebase_uid is used for DB writes
    firebase_uid: firebaseUidFromToken,
  };

  // Service-role client for all table writes (reuse supabaseAdmin created above)
  const supabase = supabaseAdmin;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    phoneNumber,
    firebaseUid,
    firebaseIdToken,
    companyName      = '',
    fullName         = '',
    jobTitle         = '',
    industry         = '',
    intentGoals      = [],
    intentTeam       = '',
    intentChallenges = [],
  } = body as {
    phoneNumber: string;
    firebaseUid: string;
    firebaseIdToken?: string;
    companyName?: string;
    fullName?: string;
    jobTitle?: string;
    industry?: string;
    intentGoals: string[];
    intentTeam: string;
    intentChallenges: string[];
  };

  if (!phoneNumber || !firebaseUid) {
    return res.status(400).json({ error: 'phoneNumber and firebaseUid are required' });
  }

  // Use provided company name or generate from email prefix
  let finalCompanyName = companyName.trim();
  if (!finalCompanyName) {
    // Default: use email prefix before @
    const emailParts = user.email?.split('@') || [];
    finalCompanyName = emailParts[0] || 'Company';
  }

  // ── Domain eligibility gate ───────────────────────────────────────────────
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (eligibility.status === 'blocked') {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }

    // Public email domain (Gmail, Yahoo, etc.) — allowed ONLY via:
    //   A) explicit team invite (user_company_roles status='invited'), OR
    //   B) approved access request (influencer/creator self-applied)
    // Neither path can create companies or claim free credits.
    if (eligibility.reason === 'public_provider') {
      // ── Path A: team invite ──────────────────────────────────────────────
      const { data: invite } = await supabase
        .from('user_company_roles')
        .select('id, company_id, role')
        .eq('user_id', user.id)
        .eq('status', 'invited')
        .limit(1)
        .maybeSingle();

      // ── Path B: approved access request ─────────────────────────────────
      // Admin approved the user by email; company was pre-created at approval time.
      const { data: accessRequest } = user.email
        ? await supabase
            .from('access_requests')
            .select('id, organization_id')
            .eq('email', user.email.toLowerCase())
            .eq('status', 'approved')
            .not('organization_id', 'is', null)
            .limit(1)
            .maybeSingle()
        : { data: null };

      if (!invite && !accessRequest) {
        return res.status(403).json({
          code:  'INVITE_REQUIRED',
          error: 'You can only join via an organization invite',
        });
      }

      // Create user record — both paths need this
      if (user.id && user.email) {
        // company_id / role are set after company creation below — upsert the base row now
      await supabase.from('users').upsert({
        id:         user.id,
        email:      user.email.toLowerCase(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'email' });
      }

      const companyId = invite?.company_id ?? accessRequest!.organization_id;

      return res.status(200).json({
        success:    true,
        inviteOnly: true,
        companyId,
      });
    }
  }

  // ── Verify Firebase phone auth server-side ───────────────────────────────
  if (!firebaseIdToken) {
    return res.status(401).json({ error: 'Phone verification token missing. Complete phone verification to claim credits.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(firebaseIdToken);
    if (verified.uid !== firebaseUid) {
      return res.status(401).json({ error: 'Phone verification mismatch. Please retry phone verification.' });
    }
    // Also confirm the phone number matches what Firebase recorded
    if (verified.phone_number && verified.phone_number !== phoneNumber) {
      return res.status(401).json({ error: 'Phone number mismatch. Please retry phone verification.' });
    }
  } catch (verifyErr: any) {
    console.error('[onboarding/complete] Firebase token verify failed:', verifyErr.message);
    return res.status(401).json({ error: 'Could not verify phone authentication. Please retry.' });
  }

  try {
    // ── STEP 4: Load credit config from DB (with fallback to defaults) ────────
    const { data: creditConfig } = await supabase
      .from('free_credit_config')
      .select('credits, expiry_days')
      .eq('category', 'initial')
      .eq('is_active', true)
      .maybeSingle();
    const initialCredits = (creditConfig as any)?.credits    ?? INITIAL_CREDITS_DEFAULT;
    const expiryDays     = (creditConfig as any)?.expiry_days ?? EXPIRY_DAYS_DEFAULT;

    // ── 0a. Create user in database if not exists ────────────────────────────
    if (user.email && user.id) {
      await supabase.from('users').upsert({
        id:         user.id,
        email:      user.email.toLowerCase(),
        created_at: new Date().toISOString(),
      }, { onConflict: 'email' });
    }

    // Store name + job title in users table (no Supabase auth.admin call needed)
    if (user.id) {
      await supabase.from('users').update({
        ...(fullName ? { name: fullName, job_title: jobTitle || null } : {}),
        is_phone_verified: true,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
    }

    // ── 0. Create or retrieve company from company name ──────────────────────
    let companyId: string | null = null;

    // Check if company with this name already exists (case-insensitive)
    const { data: existingCompanies, error: checkError } = await supabase
      .from('companies')
      .select('id')
      .ilike('name', finalCompanyName)
      .limit(1);

    if (checkError) {
      console.error('[onboarding/complete] company check failed:', checkError.message);
      return res.status(500).json({ error: 'Could not verify company name availability' });
    }

    if (existingCompanies && existingCompanies.length > 0) {
      companyId = existingCompanies[0].id;
      console.log('[onboarding/complete] company already exists:', companyId);
    } else {
      // Derive website and domain from email
      const emailDomain = user.email?.split('@')[1]?.toLowerCase() ?? '';
      const website = emailDomain ? `https://${emailDomain}` : 'https://example.com';

      // Create new company
      const { data: newCompany, error: createError } = await supabase
        .from('companies')
        .insert({
          name:               finalCompanyName,
          website,
          admin_email_domain: emailDomain || null,
          industry:           industry || null,
          created_at:         new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[onboarding/complete] company creation failed:', createError.message);
        return res.status(500).json({ error: 'Could not create company' });
      }

      companyId = newCompany.id;
      console.log('[onboarding/complete] company created:', companyId);

      // Seed a minimal company_profiles row so CompanyContext can resolve the
      // company name immediately. User fills in the rest via the dashboard wizard.
      await supabase.from('company_profiles').upsert({
        company_id:  companyId,
        name:        finalCompanyName,
        website_url: website,
        industry:    industry || null,
        created_at:  new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'company_id', ignoreDuplicates: true });
    }

    // ── 1. Upsert free_credit_profiles (idempotent) ─────────────────────────
    const expiryAt = new Date(Date.now() + expiryDays * 86400 * 1000).toISOString();

    const { data: existingProfile } = await supabase
      .from('free_credit_profiles')
      .select('id, user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileErr } = await supabase.from('free_credit_profiles').insert({
        user_id:           user.id,
        phone_number:      phoneNumber,
        phone_verified_at: new Date().toISOString(),
        firebase_uid:      firebaseUid,
        organization_id:   companyId,
        intent_goals:      intentGoals,
        intent_team:       intentTeam,
        intent_challenges: intentChallenges,
        acquisition_source: 'get_free_credits',
        initial_credits:   initialCredits,
        credit_expiry_at:  expiryAt,
      });
      if (profileErr) {
        // phone_number UNIQUE violation = someone already used this phone
        if (profileErr.code === '23505') {
          return res.status(409).json({ error: 'This phone number has already been used to claim free credits.' });
        }
        throw profileErr;
      }
    }

    // ── 2. Check if 'initial' credits already claimed ────────────────────────
    const { data: existingClaim } = await supabase
      .from('free_credit_claims')
      .select('id')
      .eq('user_id', user.id)
      .eq('category', 'initial')
      .maybeSingle();

    if (existingClaim) {
      return res.status(200).json({ success: true, credits: initialCredits, alreadyClaimed: true });
    }

    // ── STEP 2: One free credit grant per domain ──────────────────────────────
    // Block the grant if any org on the same admin_email_domain has already
    // received an initial credit grant (domain-level dedup across orgs).
    if (user.email && companyId) {
      const emailDomain = user.email.includes('@') ? user.email.split('@')[1].toLowerCase() : null;
      if (emailDomain) {
        const { data: domainOrgs } = await supabase
          .from('companies')
          .select('id')
          .eq('admin_email_domain', emailDomain)
          .neq('id', companyId);

        const domainOrgIds = (domainOrgs ?? []).map((r: any) => r.id);
        if (domainOrgIds.length > 0) {
          const { data: domainClaim } = await supabase
            .from('free_credit_claims')
            .select('id')
            .eq('category', 'initial')
            .in('organization_id', domainOrgIds)
            .limit(1)
            .maybeSingle();

          if (domainClaim) {
            return res.status(409).json({ error: 'Free credits have already been claimed for this email domain.' });
          }
        }
      }
    }

    // ── 3. Fix any SUPER_ADMIN role — free-credit users must be COMPANY_ADMIN ──
    await supabase
      .from('user_company_roles')
      .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('role', 'SUPER_ADMIN');

    // ── 3b. Create user_company_roles if user doesn't have one for this company ──
    const { data: existingMembership } = await supabase
      .from('user_company_roles')
      .select('id, role')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!existingMembership) {
      const { error: roleErr } = await supabase.from('user_company_roles').insert({
        user_id:    user.id,
        company_id: companyId,
        role:       'COMPANY_ADMIN',
        status:     'active',
        name:       fullName || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (roleErr) {
        console.error('[onboarding/complete] role creation failed:', roleErr.message);
        // Non-fatal: try to proceed
      }
    }

    // ── 4. Get org_id from organization membership ───────────────────────────
    const { data: membership } = await supabase
      .from('user_company_roles')
      .select('company_id, role, id')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const orgId: string = companyId; // Use the company we just created

    // Ensure role is a valid content role (fix any legacy 'ADMIN' values)
    const validRoles = ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'];
    if (membership && !validRoles.includes(membership.role)) {
      await supabase
        .from('user_company_roles')
        .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
        .eq('id', membership.id);
    }

    // ── 4b. Grant credits via creditExecutionService (idempotent) ─────────────
    if (orgId) {
      // Ensure organization_credits row exists — apply_credit_reservation raises
      // 'no_credit_account' if the row is missing, so we upsert it first.
      await supabase.from('organization_credits').upsert({
        organization_id:   orgId,
        free_balance:      0,
        paid_balance:      0,
        incentive_balance: 0,
        lifetime_purchased: 0,
        lifetime_consumed:  0,
        credit_rate_usd:   0.001,
      }, { onConflict: 'organization_id', ignoreDuplicates: true });

      try {
        await createCredit({
          orgId,
          amount:         initialCredits,
          category:       'free',
          referenceType:  'free_credits',
          referenceId:    orgId,               // STEP 3: org-scoped referenceId
          note:           `Free credits — onboarding (expires ${expiryAt.slice(0, 10)})`,
          performedBy:    user.id,
          // STEP 3: org-scoped key — same result regardless of which user triggers
          idempotencyKey: makeIdempotencyKey(orgId, 'initial_free_credit', orgId),
        });
      } catch (creditErr: any) {
        console.error('[onboarding/complete] credit grant failed:', creditErr.message);
        // Non-fatal: still log the claim
      }

      // Update free_credit_profiles with org_id
      await supabase
        .from('free_credit_profiles')
        .update({ organization_id: orgId })
        .eq('user_id', user.id);

      // ── Backfill users.company_id + users.role ──────────────────────────────
      // This ensures a seamless upgrade to paid subscription — when the billing
      // system creates a paid account it can rely on these fields already being set.
      await supabase
        .from('users')
        .update({ company_id: orgId, role: 'COMPANY_ADMIN' })
        .eq('id', user.id);
    }

    // ── 5. Log 'initial' claim ────────────────────────────────────────────────
    // `domain` is sourced from the verified user email — not from the company row
    // (which may not have admin_email_domain set at this point in the flow).
    // UNIQUE(domain) WHERE category='initial' enforces domain-level uniqueness at DB level.
    const claimDomain = user.email?.includes('@')
      ? user.email.split('@')[1].toLowerCase()
      : null;
    await supabase.from('free_credit_claims').insert({
      user_id:         user.id,
      organization_id: orgId,
      category:        'initial',
      credits_granted: initialCredits,
      domain:          claimDomain,
    });

    return res.status(200).json({
      success:      true,
      credits:      initialCredits,
      expiresAt:    expiryAt,
      alreadyClaimed: false,
    });
  } catch (err: any) {
    console.error('[onboarding/complete]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

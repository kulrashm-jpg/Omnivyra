/**
 * POST /api/onboarding/complete
 *
 * Called after phone verification to:
 *  0. Create user in database users table (if not exists)
 *  1. Create a free_credit_profiles row (idempotent)
 *  2. Grant 300 initial credits via apply_credit_transaction()
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

const INITIAL_CREDITS = 300;
const EXPIRY_DAYS     = 14;

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

  // ── Auth: get user from Authorization header (Bearer <access_token>) ───────
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  // Verify the user token with the anon client
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Use service role for all table writes — free_credit_profiles and
  // free_credit_claims have RLS that blocks anon/user inserts.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    phoneNumber,
    firebaseUid,
    firebaseIdToken,
    companyName      = '',
    intentGoals      = [],
    intentTeam       = '',
    intentChallenges = [],
  } = body as {
    phoneNumber: string;
    firebaseUid: string;
    firebaseIdToken?: string;
    companyName?: string;
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
    // ── 0a. Create user in database if not exists ────────────────────────────
    // Ensure user exists in the users table (separate from Supabase auth)
    if (user.email && user.id) {
      const { error: userCheckErr } = await supabase
        .from('users')
        .select('id')
        .eq('email', user.email.toLowerCase())
        .limit(1)
        .maybeSingle();

      // Try to insert if user doesn't exist (ignore unique constraint errors)
      if (!userCheckErr) {
        await supabase.from('users').upsert({
          id: user.id,
          email: user.email.toLowerCase(),
          name: user.user_metadata?.name || user.email.split('@')[0] || 'User',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
      }
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
      // Create new company
      const { data: newCompany, error: createError } = await supabase
        .from('companies')
        .insert({
          name: finalCompanyName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[onboarding/complete] company creation failed:', createError.message);
        return res.status(500).json({ error: 'Could not create company' });
      }

      companyId = newCompany.id;
      console.log('[onboarding/complete] company created:', companyId);
    }

    // ── 1. Upsert free_credit_profiles (idempotent) ─────────────────────────
    const expiryAt = new Date(Date.now() + EXPIRY_DAYS * 86400 * 1000).toISOString();

    const { data: existingProfile } = await supabase
      .from('free_credit_profiles')
      .select('id, user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileErr } = await supabase.from('free_credit_profiles').insert({
        user_id:          user.id,
        phone_number:     phoneNumber,
        phone_verified_at: new Date().toISOString(),
        firebase_uid:     firebaseUid,
        company_name:     finalCompanyName,
        organization_id:  companyId,
        intent_goals:     intentGoals,
        intent_team:      intentTeam,
        intent_challenges: intentChallenges,
        acquisition_source: 'get_free_credits',
        initial_credits:  INITIAL_CREDITS,
        credit_expiry_at: expiryAt,
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
      return res.status(200).json({ success: true, credits: INITIAL_CREDITS, alreadyClaimed: true });
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
        user_id: user.id,
        company_id: companyId,
        role: 'COMPANY_ADMIN',
        status: 'active',
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

    // ── 4b. Grant credits via apply_credit_transaction RPC ────────────────────
    if (orgId) {
      const { error: creditErr } = await supabase.rpc('apply_credit_transaction', {
        p_organization_id: orgId,
        p_transaction_type: 'purchase',
        p_credits_delta: INITIAL_CREDITS,
        p_usd_equivalent: null,
        p_reference_type: 'free_credits',
        p_reference_id: null,
        p_note: `Free credits — onboarding (expires ${expiryAt.slice(0, 10)})`,
        p_performed_by: user.id,
      });
      if (creditErr) {
        console.error('[onboarding/complete] credit grant failed:', creditErr.message);
        // Non-fatal: still log the claim
      }

      // Update free_credit_profiles with org_id
      await supabase
        .from('free_credit_profiles')
        .update({ organization_id: orgId })
        .eq('user_id', user.id);
    }

    // ── 5. Log 'initial' claim (UNIQUE constraint prevents duplicates) ────────
    await supabase.from('free_credit_claims').insert({
      user_id:         user.id,
      organization_id: orgId,
      category:        'initial',
      credits_granted: INITIAL_CREDITS,
    });

    return res.status(200).json({
      success:      true,
      credits:      INITIAL_CREDITS,
      expiresAt:    expiryAt,
      alreadyClaimed: false,
    });
  } catch (err: any) {
    console.error('[onboarding/complete]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

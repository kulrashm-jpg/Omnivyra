/**
 * POST /api/onboarding/complete
 *
 * Called after phone verification to:
 *  1. Create a free_credit_profiles row (idempotent)
 *  2. Grant 300 initial credits via apply_credit_transaction()
 *  3. Log the 'initial' claim in free_credit_claims
 *
 * Body:
 *  {
 *    phoneNumber:   string   -- E.164 format
 *    firebaseUid:   string   -- UID from Firebase phone auth
 *    intentGoals:   string[] -- Q1 answers
 *    intentTeam:    string   -- Q2 answer
 *    intentChallenges: string[] -- Q3 answers
 *  }
 *
 * Auth: requires Supabase session (user must be logged in via email OTP first)
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
    intentGoals      = [],
    intentTeam       = '',
    intentChallenges = [],
  } = body as {
    phoneNumber: string;
    firebaseUid: string;
    firebaseIdToken?: string;
    intentGoals: string[];
    intentTeam: string;
    intentChallenges: string[];
  };

  if (!phoneNumber || !firebaseUid) {
    return res.status(400).json({ error: 'phoneNumber and firebaseUid are required' });
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

    // ── 4. Get org_id from organization membership ───────────────────────────
    const { data: membership } = await supabase
      .from('user_company_roles')
      .select('company_id, role, id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const orgId: string | null = membership?.company_id ?? null;

    // Ensure role is a valid content role (fix any legacy 'ADMIN' values)
    const validRoles = ['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'];
    if (membership && !validRoles.includes(membership.role)) {
      await supabase
        .from('user_company_roles')
        .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
        .eq('id', membership.id);
    }

    // ── 4. Grant credits via apply_credit_transaction RPC ────────────────────
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

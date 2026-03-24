/**
 * POST /api/credits/claim-action
 *
 * Grants bonus credits for a completed earn-more action.
 * Each category can only be claimed ONCE per user (enforced by DB UNIQUE constraint).
 *
 * Body: { category: string }
 *
 * Valid categories:
 *   invite_friend   → +200
 *   feedback        → +100
 *   setup           → +100
 *   connect_social  → +150
 *   first_campaign  → +200
 *
 * Auth: requires Supabase Bearer token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { createCredit, makeIdempotencyKey } from '../../../backend/services/creditExecutionService';

// Fallback rewards used when free_credit_config DB rows are missing or inactive
const CREDIT_REWARDS_DEFAULT: Record<string, number> = {
  invite_friend:  200,
  feedback:       100,
  setup:          100,
  connect_social: 150,
  first_campaign: 200,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── Domain eligibility gate ───────────────────────────────────────────────
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (eligibility.status === 'blocked') {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { category } = body as { category: string };

  // ── STEP 4: Load active reward amounts from DB with fallback ─────────────
  const serviceSb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: configRows } = await serviceSb
    .from('free_credit_config')
    .select('category, credits')
    .eq('is_active', true)
    .in('category', Object.keys(CREDIT_REWARDS_DEFAULT));

  const CREDIT_REWARDS: Record<string, number> = { ...CREDIT_REWARDS_DEFAULT };
  for (const row of (configRows ?? []) as Array<{ category: string; credits: number }>) {
    CREDIT_REWARDS[row.category] = row.credits;
  }

  if (!category || !(category in CREDIT_REWARDS)) {
    return res.status(400).json({ error: `Unknown category "${category}". Valid: ${Object.keys(CREDIT_REWARDS).join(', ')}` });
  }

  const credits = CREDIT_REWARDS[category];

  try {
    // Insert claim — UNIQUE(user_id, category) will reject duplicates
    const { error: claimErr } = await supabase.from('free_credit_claims').insert({
      user_id:         user.id,
      category,
      credits_granted: credits,
    });

    if (claimErr) {
      if (claimErr.code === '23505') {
        return res.status(409).json({ error: 'Credits for this action have already been claimed.' });
      }
      throw claimErr;
    }

    // Get org to apply credit transaction
    const { data: membership } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    const orgId = membership?.company_id ?? null;
    if (orgId) {
      try {
        await createCredit({
          orgId,
          amount:         credits,
          category:       'incentive',
          referenceType:  'free_credits_earn',
          referenceId:    `${user.id}:${category}`,
          note:           `Free credits — ${category.replace(/_/g, ' ')}`,
          performedBy:    user.id,
          // Permanently unique per user+category — mirrors the DB UNIQUE constraint
          idempotencyKey: makeIdempotencyKey(user.id, `earn:${category}`, orgId),
        });
      } catch (creditErr: any) {
        console.error('[credits/claim-action] credit grant failed:', creditErr.message);
        // Roll back the claim so the user can retry
        await supabase.from('free_credit_claims').delete()
          .eq('user_id', user.id).eq('category', category);
        return res.status(500).json({ error: 'Credit grant failed. Please try again.' });
      }
    }

    return res.status(200).json({ success: true, category, credits });
  } catch (err: any) {
    console.error('[credits/claim-action]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

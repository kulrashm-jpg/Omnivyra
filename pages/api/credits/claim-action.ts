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

const CREDIT_REWARDS: Record<string, number> = {
  invite_friend:  200,
  feedback:       100,
  setup:          100,
  connect_social: 150,
  first_campaign: 200,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
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
      const { error: creditErr } = await supabase.rpc('apply_credit_transaction', {
        p_organization_id:  orgId,
        p_transaction_type: 'purchase',
        p_credits_delta:    credits,
        p_usd_equivalent:   null,
        p_reference_type:   'free_credits_earn',
        p_reference_id:     null,
        p_note:             `Free credits — ${category.replace(/_/g, ' ')}`,
        p_performed_by:     user.id,
      });
      if (creditErr) {
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

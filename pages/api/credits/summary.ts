/**
 * GET /api/credits/summary?org_id=<uuid>
 *
 * Returns current credit balance + health + monthly consumption metrics.
 * Used by CreditDashboard component.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

function creditHealth(balance: number): 'healthy' | 'low' | 'critical' | 'empty' {
  if (balance <= 0)   return 'empty';
  if (balance < 50)   return 'critical';
  if (balance < 200)  return 'low';
  return 'healthy';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  try {
    // Balance
    const { data: creditRow } = await supabase
      .from('organization_credits')
      .select('balance_credits')
      .eq('organization_id', orgId)
      .maybeSingle();

    const balance = (creditRow as any)?.balance_credits ?? 0;

    // Monthly metrics — current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: txRows } = await supabase
      .from('credit_transactions')
      .select('transaction_type, credits_delta, reference_type')
      .eq('organization_id', orgId)
      .gte('created_at', monthStart);

    let monthlyConsumed = 0;
    let monthlyPurchased = 0;
    const actionTotals: Record<string, number> = {};

    for (const tx of (txRows ?? []) as Array<{ transaction_type: string; credits_delta: number; reference_type: string | null }>) {
      if (tx.credits_delta < 0) {
        monthlyConsumed += Math.abs(tx.credits_delta);
        const key = tx.reference_type ?? 'other';
        actionTotals[key] = (actionTotals[key] ?? 0) + Math.abs(tx.credits_delta);
      } else {
        monthlyPurchased += tx.credits_delta;
      }
    }

    // Top action
    let topAction: string | null = null;
    let topActionCredits = 0;
    for (const [action, total] of Object.entries(actionTotals)) {
      if (total > topActionCredits) { topAction = action; topActionCredits = total; }
    }

    return res.status(200).json({
      balance,
      health:             creditHealth(balance),
      monthly_consumed:   monthlyConsumed,
      monthly_purchased:  monthlyPurchased,
      top_action:         topAction,
      top_action_credits: topActionCredits,
    });
  } catch (err: any) {
    console.error('[credits/summary]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}

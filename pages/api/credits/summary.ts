import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as sb } from '@/backend/db/supabaseClient';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';

function creditHealth(balance: number): 'healthy' | 'low' | 'critical' | 'empty' {
  if (balance <= 0) return 'empty';
  if (balance < 50) return 'critical';
  if (balance < 200) return 'low';
  return 'healthy';
}

export interface CreditSummaryResponse {
  wallet: {
    free_balance: number;
    paid_balance: number;
    incentive_balance: number;
    reserved_free: number;
    reserved_paid: number;
    reserved_incentive: number;
  };
  totals: {
    total_balance: number;
    total_reserved: number;
    total_available: number;
  };
  health: 'healthy' | 'low' | 'critical' | 'empty';
  expiring_soon: {
    credits: number;
    expires_at: string | null;
  };
  monthly: {
    consumed: number;
    purchased: number;
    top_action: string | null;
    top_action_credits: number;
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const in7Days = new Date(now.getTime() + 7 * 86400_000).toISOString();

    const [walletRes, expiryRes, txRes] = await Promise.all([
      sb.from('organization_credits')
        .select('free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive')
        .eq('organization_id', orgId)
        .maybeSingle(),
      sb.from('free_credit_profiles')
        .select('initial_credits, credit_expiry_at')
        .eq('organization_id', orgId)
        .gt('credit_expiry_at', now.toISOString())
        .lte('credit_expiry_at', in7Days)
        .order('credit_expiry_at', { ascending: true }),
      sb.from('credit_transactions')
        .select('credits_delta, reference_type, execution_phase')
        .eq('organization_id', orgId)
        .gte('created_at', monthStart)
        .eq('execution_phase', 'confirm'),
    ]);

    const w = (walletRes.data as any) ?? {};
    const freeBalance = w.free_balance ?? 0;
    const paidBalance = w.paid_balance ?? 0;
    const incentiveBalance = w.incentive_balance ?? 0;
    const reservedFree = w.reserved_free ?? 0;
    const reservedPaid = w.reserved_paid ?? 0;
    const reservedIncentive = w.reserved_incentive ?? 0;

    const totalBalance = freeBalance + paidBalance + incentiveBalance;
    const totalReserved = reservedFree + reservedPaid + reservedIncentive;
    const totalAvailable = Math.max(0, totalBalance - totalReserved);

    const expiryRows = (expiryRes.data ?? []) as Array<{ initial_credits: number; credit_expiry_at: string }>;
    const expiringSoonCredits = expiryRows.reduce((sum, row) => sum + (row.initial_credits ?? 0), 0);
    const expiringSoonCapped = Math.min(expiringSoonCredits, freeBalance);
    const earliestExpiry = expiryRows[0]?.credit_expiry_at ?? null;

    let monthlyConsumed = 0;
    let monthlyPurchased = 0;
    const actionTotals: Record<string, number> = {};

    for (const tx of (txRes.data ?? []) as Array<{ credits_delta: number; reference_type: string | null }>) {
      if (tx.credits_delta < 0) {
        const spent = Math.abs(tx.credits_delta);
        monthlyConsumed += spent;
        const key = tx.reference_type ?? 'other';
        actionTotals[key] = (actionTotals[key] ?? 0) + spent;
      } else {
        monthlyPurchased += tx.credits_delta;
      }
    }

    let topAction: string | null = null;
    let topActionCredits = 0;
    for (const [action, total] of Object.entries(actionTotals)) {
      if (total > topActionCredits) {
        topAction = action;
        topActionCredits = total;
      }
    }

    const body: CreditSummaryResponse = {
      wallet: {
        free_balance: freeBalance,
        paid_balance: paidBalance,
        incentive_balance: incentiveBalance,
        reserved_free: reservedFree,
        reserved_paid: reservedPaid,
        reserved_incentive: reservedIncentive,
      },
      totals: {
        total_balance: totalBalance,
        total_reserved: totalReserved,
        total_available: totalAvailable,
      },
      health: creditHealth(totalAvailable),
      expiring_soon: {
        credits: expiringSoonCapped,
        expires_at: earliestExpiry,
      },
      monthly: {
        consumed: monthlyConsumed,
        purchased: monthlyPurchased,
        top_action: topAction,
        top_action_credits: topActionCredits,
      },
    };

    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    return res.status(200).json(body);
  } catch (err: any) {
    logger.error('credits_summary_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message });
  }
}

export default withOrgAccess(handler);

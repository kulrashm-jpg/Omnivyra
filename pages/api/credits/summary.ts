/**
 * GET /api/credits/summary?org_id=<uuid>
 *
 * Unified credit summary for all frontend components.
 *
 * Returns:
 *   wallet       — per-category balances + reserved amounts
 *   totals       — total_balance, total_reserved, total_available (net spendable)
 *   health       — healthy | low | critical | empty
 *   expiring_soon — credits expiring within 7 days
 *   monthly      — consumed, purchased, top action this month
 *
 * Two parallel DB queries:
 *   1. organization_credits  — single row, all wallet columns
 *   2. free_credit_profiles  — expiry window aggregation
 *   3. credit_transactions   — current-month aggregation (filter on JS side)
 *
 * Auth: Bearer token (Supabase user session) OR super_admin_session cookie.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

// ── Health thresholds (aligned with creditAlertService) ───────────────────────

function creditHealth(balance: number): 'healthy' | 'low' | 'critical' | 'empty' {
  if (balance <= 0)   return 'empty';
  if (balance < 50)   return 'critical';
  if (balance < 200)  return 'low';
  return 'healthy';
}

// ── Response type (mirrors what frontend components expect) ───────────────────

export interface CreditSummaryResponse {
  wallet: {
    free_balance:       number;
    paid_balance:       number;
    incentive_balance:  number;
    reserved_free:      number;
    reserved_paid:      number;
    reserved_incentive: number;
  };
  totals: {
    total_balance:   number;   // free + paid + incentive
    total_reserved:  number;   // sum of all reserved (in-flight)
    total_available: number;   // total_balance − total_reserved (spendable right now)
  };
  health:        'healthy' | 'low' | 'critical' | 'empty';
  expiring_soon: {
    credits:    number;        // free credits expiring within 7 days
    expires_at: string | null; // earliest expiry date (ISO)
  };
  monthly: {
    consumed:           number;
    purchased:          number;
    top_action:         string | null;
    top_action_credits: number;
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  // ── Auth: Bearer token or super_admin_session cookie ─────────────────────
  const isSuperAdminCookie = req.cookies?.super_admin_session === '1';
  if (!isSuperAdminCookie) {
    const { user, error: userErr } = await getSupabaseUserFromRequest(req);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });
  }

  // Service role for all DB reads (bypasses RLS on credit tables)
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const in7Days    = new Date(now.getTime() + 7 * 86400_000).toISOString();

    // ── Parallel fetch: wallet row + expiry profiles + monthly transactions ───
    const [walletRes, expiryRes, txRes] = await Promise.all([

      // 1. Full wallet snapshot — single row, all columns
      sb.from('organization_credits')
        .select([
          'free_balance', 'paid_balance', 'incentive_balance',
          'reserved_free', 'reserved_paid', 'reserved_incentive',
        ].join(', '))
        .eq('organization_id', orgId)
        .maybeSingle(),

      // 2. Free credits expiring within the next 7 days
      //    One row per phone-verified user; sum initial_credits for the window.
      sb.from('free_credit_profiles')
        .select('initial_credits, credit_expiry_at')
        .eq('organization_id', orgId)
        .gt('credit_expiry_at', now.toISOString())   // not already expired
        .lte('credit_expiry_at', in7Days)             // within 7-day window
        .order('credit_expiry_at', { ascending: true }),

      // 3. This month's transactions — only columns needed for aggregation
      sb.from('credit_transactions')
        .select('credits_delta, reference_type, execution_phase')
        .eq('organization_id', orgId)
        .gte('created_at', monthStart)
        .eq('execution_phase', 'confirm'),  // only confirmed charges (not holds/releases)
    ]);

    // ── 1. Wallet ─────────────────────────────────────────────────────────────
    const w = (walletRes.data as any) ?? {};
    const freeBalance      = w.free_balance       ?? 0;
    const paidBalance      = w.paid_balance       ?? 0;
    const incentiveBalance = w.incentive_balance  ?? 0;
    const reservedFree     = w.reserved_free      ?? 0;
    const reservedPaid     = w.reserved_paid      ?? 0;
    const reservedIncentive= w.reserved_incentive ?? 0;

    const totalBalance   = freeBalance + paidBalance + incentiveBalance;
    const totalReserved  = reservedFree + reservedPaid + reservedIncentive;
    const totalAvailable = Math.max(0, totalBalance - totalReserved);

    // ── 2. Expiring soon ──────────────────────────────────────────────────────
    const expiryRows = (expiryRes.data ?? []) as Array<{
      initial_credits: number;
      credit_expiry_at: string;
    }>;
    const expiringSoonCredits = expiryRows.reduce(
      (sum, r) => sum + (r.initial_credits ?? 0), 0,
    );
    // Cap at actual free_balance — can't expire more than what's there
    const expiringSoonCapped = Math.min(expiringSoonCredits, freeBalance);
    const earliestExpiry     = expiryRows[0]?.credit_expiry_at ?? null;

    // ── 3. Monthly aggregation ────────────────────────────────────────────────
    let monthlyConsumed  = 0;
    let monthlyPurchased = 0;
    const actionTotals: Record<string, number> = {};

    for (const tx of (txRes.data ?? []) as Array<{
      credits_delta: number;
      reference_type: string | null;
    }>) {
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
      if (total > topActionCredits) { topAction = action; topActionCredits = total; }
    }

    // ── Response ──────────────────────────────────────────────────────────────
    const body: CreditSummaryResponse = {
      wallet: {
        free_balance:       freeBalance,
        paid_balance:       paidBalance,
        incentive_balance:  incentiveBalance,
        reserved_free:      reservedFree,
        reserved_paid:      reservedPaid,
        reserved_incentive: reservedIncentive,
      },
      totals: {
        total_balance:   totalBalance,
        total_reserved:  totalReserved,
        total_available: totalAvailable,
      },
      health:        creditHealth(totalAvailable),
      expiring_soon: {
        credits:    expiringSoonCapped,
        expires_at: earliestExpiry,
      },
      monthly: {
        consumed:           monthlyConsumed,
        purchased:          monthlyPurchased,
        top_action:         topAction,
        top_action_credits: topActionCredits,
      },
    };

    // Cache hint: balance changes on every deduction — short TTL is safest
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    return res.status(200).json(body);

  } catch (err: any) {
    console.error('[credits/summary]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}

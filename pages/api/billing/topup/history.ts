import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/billing/topup/history?org_id=<id>
 *
 * Customer-visible top-up purchase history (Section G). READ-ONLY — reads the
 * existing `credit_purchases` table for the org. No charging, no allocation.
 * Auth: withOrgAccess (caller must be a member of org_id).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as sb } from '@/backend/db/supabaseClient';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { logger } from '../../../../backend/services/logger';

export interface TopupHistoryRow {
  id: string;
  credits: number;
  amount_paid: number | null;
  currency: string | null;
  status: string | null;
  fulfillment_status: string | null;
  provider_order_id: string | null;
  created_at: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  try {
    const { data, error } = await sb
      .from('credit_purchases')
      .select('id, credits, amount_paid, currency, status, fulfillment_status, provider_order_id, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = (data ?? []) as TopupHistoryRow[];
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
      purchases: rows,
      total_credits_purchased: rows
        .filter((r) => r.status === 'completed' || r.fulfillment_status === 'fulfilled')
        .reduce((s, r) => s + (r.credits ?? 0), 0),
      count: rows.length,
    });
  } catch (err: any) {
    logger.error('topup_history_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'history_failed' });
  }
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/billing/topup/history' });

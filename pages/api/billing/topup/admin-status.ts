/**
 * GET /api/billing/topup/admin-status?org_id=<id>&limit=<n>
 *
 * Read-only staging observability: recent top-up purchases + payment-provider
 * events (attempts / success / webhook records) + allocation status, for
 * validating the staging flow. READ-ONLY — no charging, no allocation.
 * Auth: withOrgAccess (org-scoped).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as sb } from '@/backend/db/supabaseClient';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { logger } from '../../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);

  try {
    const [purchases, events, credits] = await Promise.all([
      sb.from('credit_purchases')
        .select('id, credits, amount_paid, currency, status, fulfillment_status, provider, provider_order_id, created_at')
        .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(limit),
      sb.from('payment_provider_events')
        .select('id, provider, event_id, event_type, status, created_at')
        .order('created_at', { ascending: false }).limit(limit),
      sb.from('credit_transactions')
        .select('credits_delta, reference_type, reference_id, execution_phase, created_at')
        .eq('organization_id', orgId).eq('reference_type', 'credit_purchase')
        .order('created_at', { ascending: false }).limit(limit),
    ]);

    const p = (purchases.data ?? []) as any[];
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({
      summary: {
        attempts: p.length,
        succeeded: p.filter((r) => r.status === 'completed' || r.fulfillment_status === 'fulfilled').length,
        pending: p.filter((r) => r.status === 'pending').length,
        failed: p.filter((r) => r.status === 'failed').length,
        credits_allocated: (credits.data ?? []).reduce((s: number, r: any) => s + Math.max(0, Number(r.credits_delta ?? 0)), 0),
      },
      purchases: p,
      provider_events: events.data ?? [],
      allocation_ledger: credits.data ?? [],
    });
  } catch (err: any) {
    logger.error('topup_admin_status_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message ?? 'admin_status_failed' });
  }
}

export default withOrgAccess(handler);

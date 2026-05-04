import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/analytics/whatsapp/broadcasts
 *
 * Returns WhatsApp broadcast analytics: delivery, read, and reply rates
 * aggregated from whatsapp_broadcasts and whatsapp_broadcast_recipients.
 *
 * Query params:
 *   company_id   (required)
 *   status       (optional) â€” filter: sent | sending | failed | partial
 *   date_from    (optional) â€” YYYY-MM-DD (filters on broadcast created_at)
 *   date_to      (optional) â€” YYYY-MM-DD
 *   page         (optional, default 1)
 *   per_page     (optional, default 20, max 100)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const {
    company_id,
    status,
    date_from,
    date_to,
    page     = '1',
    per_page = '20',
  } = req.query as Record<string, string>;

  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const pageNum    = Math.max(1, parseInt(page, 10) || 1);
  const perPageNum = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));
  const offset     = (pageNum - 1) * perPageNum;

  let query = supabase
    .from('whatsapp_broadcasts')
    .select(
      `id, name, template_name, status,
       total_recipients, sent_count, delivered_count, read_count, failed_count,
       created_at, completed_at`,
      { count: 'exact' },
    )
    .eq('company_id', company_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + perPageNum - 1);

  if (status)    query = query.eq('status', status);
  if (date_from) query = query.gte('created_at', `${date_from}T00:00:00Z`);
  if (date_to)   query = query.lte('created_at', `${date_to}T23:59:59Z`);

  const { data: broadcasts, count, error } = await query;

  if (error) {
    console.error('[analytics/whatsapp/broadcasts] query error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch broadcast analytics' });
  }

  // Compute rates for each broadcast
  const enriched = (broadcasts ?? []).map((b) => {
    const total     = b.total_recipients || 1;
    const delivered = b.delivered_count  ?? 0;
    const read      = b.read_count       ?? 0;
    const failed    = b.failed_count     ?? 0;
    return {
      ...b,
      delivery_rate: parseFloat(((delivered / total) * 100).toFixed(1)),
      read_rate:     parseFloat(((read       / total) * 100).toFixed(1)),
      failure_rate:  parseFloat(((failed     / total) * 100).toFixed(1)),
    };
  });

  // Aggregate summary across the returned page
  const summary = enriched.reduce(
    (acc, b) => {
      acc.total_sent      += b.sent_count      ?? 0;
      acc.total_delivered += b.delivered_count ?? 0;
      acc.total_read      += b.read_count      ?? 0;
      acc.total_failed    += b.failed_count    ?? 0;
      acc.total_recipients += b.total_recipients ?? 0;
      return acc;
    },
    { total_sent: 0, total_delivered: 0, total_read: 0, total_failed: 0, total_recipients: 0 },
  );

  const summaryTotal = summary.total_recipients || 1;

  return res.status(200).json({
    data:       enriched,
    total:      count ?? 0,
    page:       pageNum,
    per_page:   perPageNum,
    total_pages: Math.ceil((count ?? 0) / perPageNum),
    summary: {
      ...summary,
      delivery_rate: parseFloat(((summary.total_delivered / summaryTotal) * 100).toFixed(1)),
      read_rate:     parseFloat(((summary.total_read      / summaryTotal) * 100).toFixed(1)),
      failure_rate:  parseFloat(((summary.total_failed    / summaryTotal) * 100).toFixed(1)),
    },
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);


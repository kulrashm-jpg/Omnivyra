/**
 * GET /api/engagement/inbox
 * SYSTEM 1: General Engagement Inbox — thread-based items from engagement_threads.
 * Used by: /engagement page, InboxDashboard, useEngagementInbox hook.
 * Returns: { items: InboxThread[] }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getThreads } from '../../../backend/services/engagementThreadService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.query.organization_id ?? req.query.organizationId ?? req.query.companyId) as string | undefined;
  const platform = (req.query.platform as string)?.trim() || undefined;
  const priority = (req.query.priority ?? req.query.status) as 'high' | 'medium' | 'low' | undefined;
  const startDate = (req.query.start_date ?? req.query.dateFrom) as string | undefined;
  const endDate = (req.query.end_date ?? req.query.dateTo) as string | undefined;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

  const companyId = organizationId?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, or companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const threads = await getThreads({
      organization_id: companyId,
      platform: platform || null,
      priority: priority || null,
      start_date: startDate || null,
      end_date: endDate || null,
      limit,
      exclude_ignored: true,
    });

    const threadIds = threads.map((t) => t.thread_id);
    let opportunityByThread = new Set<string>();
    if (threadIds.length > 0) {
      const { data: opps } = await supabase
        .from('engagement_opportunities')
        .select('source_thread_id')
        .in('source_thread_id', threadIds)
        .eq('resolved', false);
      (opps ?? []).forEach((o: { source_thread_id: string }) => opportunityByThread.add(o.source_thread_id));
    }

    const items = threads.map((t) => ({
      thread_id: t.thread_id,
      platform: t.platform,
      author_name: t.author_summary ?? null,
      author_username: null,
      latest_message: t.latest_message ?? null,
      latest_message_time: t.latest_message_time ?? null,
      priority_score: t.priority_score ?? 0,
      unread_count: t.unread_count ?? 0,
      message_count: t.message_count ?? 0,
      dominant_intent: t.dominant_intent ?? null,
      lead_detected: t.lead_detected ?? false,
      lead_score: t.lead_score ?? 0,
      negative_feedback: t.negative_feedback ?? false,
      customer_question: t.customer_question ?? false,
      opportunity_indicator: opportunityByThread.has(t.thread_id),
      latest_message_id: t.latest_message_id ?? null,
      classification_category: t.classification_category ?? null,
      triage_priority: t.triage_priority ?? null,
      sentiment: t.sentiment ?? null,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[engagement/inbox]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to fetch inbox',
    });
  }
}

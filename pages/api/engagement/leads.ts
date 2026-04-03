
/**
 * GET /api/engagement/leads
 * Returns potential leads from engagement_lead_signals.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';
import { computeThreadLeadScoresBatch } from '../../../backend/services/leadThreadScoring';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: signals } = await supabase
      .from('engagement_lead_signals')
      .select('id, message_id, thread_id, author_id, lead_intent, lead_score, confidence_score, detected_at')
      .eq('organization_id', organizationId)
      .order('lead_score', { ascending: false })
      .limit(200);

    if (!signals?.length) {
      return res.status(200).json({ leads: [], threads: [] });
    }

    const threadIds = [...new Set((signals ?? []).map((s: { thread_id: string }) => s.thread_id))];
    const leadScores = await computeThreadLeadScoresBatch(threadIds, organizationId);

    const { data: threads } = await supabase
      .from('engagement_threads')
      .select('id, platform, platform_thread_id')
      .in('id', threadIds);

    const { data: messages } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, content, platform_created_at, author_id')
      .in('id', (signals ?? []).map((s: { message_id: string }) => s.message_id));

    const authorIds = [...new Set((messages ?? []).map((m: { author_id?: string }) => m.author_id).filter(Boolean))];
    const { data: authors } = await supabase
      .from('engagement_authors')
      .select('id, username, display_name')
      .in('id', authorIds);

    const authorMap = new Map((authors ?? []).map((a: { id: string; username?: string; display_name?: string }) => [a.id, a.display_name ?? a.username ?? 'Unknown']));

    const msgMap = new Map((messages ?? []).map((m: { id: string; thread_id: string; content?: string; platform_created_at?: string; author_id?: string }) => [m.id, m]));

    const leads = (signals ?? []).map((s: { id: string; message_id: string; thread_id: string; author_id?: string; lead_intent: string; lead_score: number; confidence_score?: number; detected_at?: string }) => {
      const msg = msgMap.get(s.message_id) as { content?: string; platform_created_at?: string; author_id?: string } | undefined;
      const thread = (threads ?? []).find((t: { id: string }) => t.id === s.thread_id) as { id: string; platform: string } | undefined;
      const scoreResult = leadScores.get(s.thread_id);
      return {
        id: s.id,
        message_id: s.message_id,
        thread_id: s.thread_id,
        platform: thread?.platform ?? null,
        author_name: s.author_id ? authorMap.get(s.author_id) : msg?.author_id ? authorMap.get(msg.author_id) : null,
        message_preview: (msg?.content ?? '').toString().slice(0, 150),
        lead_intent: s.lead_intent,
        lead_score: s.lead_score,
        thread_lead_score: scoreResult?.thread_lead_score ?? 0,
        confidence_score: s.confidence_score ?? null,
        detected_at: s.detected_at ?? null,
        platform_created_at: msg?.platform_created_at ?? null,
      };
    });

    leads.sort((a, b) => (b.thread_lead_score || b.lead_score) - (a.thread_lead_score || a.lead_score));

    const threadSummaries = threadIds.map((tid) => {
      const score = leadScores.get(tid);
      const thread = (threads ?? []).find((t: { id: string }) => t.id === tid) as { id: string; platform: string } | undefined;
      const threadLeads = leads.filter((l) => l.thread_id === tid);
      return {
        thread_id: tid,
        platform: thread?.platform ?? null,
        lead_score: score?.thread_lead_score ?? 0,
        lead_detected: score?.lead_detected ?? false,
        signal_count: score?.signal_count ?? 0,
        top_lead_intent: score?.top_lead_intent ?? null,
        lead_count: threadLeads.length,
      };
    });

    threadSummaries.sort((a, b) => b.lead_score - a.lead_score);

    return res.status(200).json({
      leads,
      threads: threadSummaries,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch leads';
    console.error('[engagement/leads]', message);
    return res.status(500).json({ error: message });
  }
}

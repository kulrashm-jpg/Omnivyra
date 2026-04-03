
/**
 * GET /api/engagement/messages
 * Returns engagement messages from the unified model.
 * Supports filters: platform, thread_id, author_id, organization_id, date_range.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const platform = (req.query.platform as string)?.trim();
    const threadId = (req.query.thread_id ?? req.query.threadId) as string | undefined;
    const authorId = (req.query.author_id ?? req.query.authorId) as string | undefined;
    const startDate = (req.query.start_date ?? req.query.startDate) as string | undefined;
    const endDate = (req.query.end_date ?? req.query.endDate) as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Scope by organization via engagement_threads
    let threadIds: string[] | null = null;
    if (!threadId) {
      const { data: threads } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('organization_id', organizationId);
      threadIds = (threads ?? []).map((r: { id: string }) => r.id);
      if (threadIds.length === 0) {
        return res.status(200).json({ messages: [] });
      }
    }

    let query = supabase
      .from('engagement_messages')
      .select('id, thread_id, source_id, author_id, platform, platform_message_id, message_type, parent_message_id, content, like_count, reply_count, sentiment_score, created_at, platform_created_at')
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (threadId) {
      const { data: thread } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('id', threadId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found or access denied' });
      }
      query = query.eq('thread_id', threadId);
    } else if (threadIds && threadIds.length > 0) {
      query = query.in('thread_id', threadIds);
    }
    if (platform) query = query.eq('platform', platform);
    if (authorId) query = query.eq('author_id', authorId);
    if (startDate) query = query.gte('platform_created_at', startDate);
    if (endDate) query = query.lte('platform_created_at', endDate);

    const { data, error } = await query;

    if (error) {
      console.error('[engagement/messages]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const messages = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      thread_id: r.thread_id,
      author_id: r.author_id,
      platform: r.platform,
      platform_message_id: r.platform_message_id,
      message_type: r.message_type,
      parent_message_id: r.parent_message_id,
      content: r.content,
      like_count: r.like_count ?? 0,
      reply_count: r.reply_count ?? 0,
      sentiment_score: r.sentiment_score,
      created_at: r.created_at,
      platform_created_at: r.platform_created_at,
    }));

    return res.status(200).json({ messages });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch messages';
    console.error('[engagement/messages]', message);
    return res.status(500).json({ error: message });
  }
}

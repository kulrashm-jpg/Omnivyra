import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/engagement/queue-diagnostic?organization_id=<uuid>
 *
 * Read-only diagnostic. Returns the same items the inbox API surfaces,
 * but with the raw signals that drive Needs Response inclusion +
 * dedup so we can see exactly why two visually-identical entries
 * stay split (or fail to split).
 *
 * For each thread:
 *   - thread_id
 *   - platform_thread_id (LinkedIn's URN â€” same value = same conversation
 *     on LinkedIn, different values = different conversations)
 *   - participant_name + participant_profile_url + participant_username
 *     (from engagement_threads.raw_payload â€” set by the new scraper)
 *   - latest_message: direction, sender_self/author_self, sender_name,
 *     sender_profile_url, sender_username (from engagement_messages.raw_payload)
 *   - counterparty_author_id (the dedup key â€” same value across threads
 *     means they collapse into one queue row)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { isAuthorSelf } from '../../../lib/engagement/messageRoles';
import {
  isNeedsResponseThread,
  isPeopleReactionThread,
} from '../../../lib/engagement/queueRules';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId = String(req.query.organization_id ?? '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, platform, platform_thread_id, raw_payload')
    .eq('organization_id', organizationId);
  const threadList = (threads ?? []) as Array<{
    id: string;
    platform: string;
    platform_thread_id: string;
    raw_payload: Record<string, unknown> | null;
  }>;

  if (threadList.length === 0) {
    return res.status(200).json({ items: [], note: 'No engagement_threads in org' });
  }

  const threadIds = threadList.map((t) => t.id);
  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform, platform_message_id, message_type, direction, content, author_id, platform_created_at, created_at, raw_payload')
    .in('thread_id', threadIds)
    .order('platform_created_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false });
  const messageList = (messages ?? []) as Array<{
    id: string;
    thread_id: string;
    platform: string | null;
    platform_message_id: string | null;
    message_type: string | null;
    direction: string | null;
    content: string | null;
    author_id: string | null;
    platform_created_at: string | null;
    created_at: string | null;
    raw_payload: Record<string, unknown> | null;
  }>;

  const latestByThread = new Map<string, typeof messageList[number]>();
  const messageCountByThread = new Map<string, number>();
  for (const m of messageList) {
    if (!latestByThread.has(m.thread_id)) latestByThread.set(m.thread_id, m);
    messageCountByThread.set(m.thread_id, (messageCountByThread.get(m.thread_id) ?? 0) + 1);
  }

  const items = threadList.map((t) => {
    const trp = t.raw_payload ?? {};
    const latest = latestByThread.get(t.id);
    const mrp = latest?.raw_payload ?? {};
    const latestMessageAuthorSelf = latest
      ? isAuthorSelf({
          platform: latest.platform,
          platform_message_id: latest.platform_message_id,
          direction: latest.direction,
          author_self: mrp.author_self as boolean | null | undefined,
          sender_self: mrp.sender_self as boolean | null | undefined,
          sender_username: mrp.sender_username as string | null | undefined,
          sender_profile_url: mrp.sender_profile_url as string | null | undefined,
          content: latest.content,
        })
      : false;
    const queueSignals = {
      latest_message_type: latest?.message_type ?? null,
      latest_message_direction: latest?.direction ?? null,
      latest_message_author_self: latestMessageAuthorSelf,
      latest_message_time: latest?.platform_created_at ?? latest?.created_at ?? null,
      has_completed_outbound_action: false,
      has_pending_outbound_action: false,
    };
    return {
      thread_id: t.id,
      platform_thread_id: t.platform_thread_id,
      message_count: messageCountByThread.get(t.id) ?? 0,
      thread_signals: {
        participant_name: trp.participant_name ?? null,
        participant_username: trp.participant_username ?? null,
        participant_profile_url: trp.participant_profile_url ?? null,
        last_message_self: trp.last_message_self ?? null,
      },
      latest_message: latest ? {
        id: latest.id,
        platform: latest.platform,
        platform_message_id: latest.platform_message_id,
        message_type: latest.message_type,
        direction: latest.direction,
        author_id: latest.author_id,
        author_self_inferred: latestMessageAuthorSelf,
        platform_created_at: latest.platform_created_at,
        created_at_db: latest.created_at,
        content_preview: (latest.content ?? '').slice(0, 80),
        sender_name: mrp.sender_name ?? null,
        sender_username: mrp.sender_username ?? null,
        sender_profile_url: mrp.sender_profile_url ?? null,
        sender_self: mrp.sender_self ?? null,
        author_self: mrp.author_self ?? null,
      } : null,
      eligibility: {
        needs_response: isNeedsResponseThread(queueSignals),
        people_reaction: isPeopleReactionThread(queueSignals),
      },
    };
  });

  return res.status(200).json({
    organization_id: organizationId,
    thread_count: threadList.length,
    items,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);


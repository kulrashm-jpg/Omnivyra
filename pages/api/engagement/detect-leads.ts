import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/engagement/detect-leads
 * Run lead detection for a thread's messages and populate canonical lead_signals.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { processMessageForLeads } from '../../../backend/services/leadDetectionService';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const threadId = (body.thread_id ?? body.threadId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    let threadIds: string[] = [];
    if (threadId) {
      const { data: thread } = await supabase
        .from('engagement_threads')
        .select('id, organization_id')
        .eq('id', threadId)
        .maybeSingle();
      if (!thread || thread.organization_id !== organizationId) {
        return res.status(404).json({ error: 'Thread not found' });
      }
      threadIds = [threadId];
    } else {
      const { data: threads } = await supabase
        .from('engagement_threads')
        .select('id')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })
        .limit(50);
      threadIds = (threads ?? []).map((t: { id: string }) => t.id);
    }

    // OPT-010 W2-8: TWO batched prefetches replace 2 queries per thread
    // (up to 100 round-trips), and per-message processing runs with BOUNDED
    // concurrency (5) instead of fully serial. Thread context strings are
    // built from the grouped prefetch — same derivation as before.
    type MsgRow = { id: string; thread_id: string; content?: string; author_id?: string };

    const { data: allMessages } =
      threadIds.length > 0
        ? await supabase
            .from('engagement_messages')
            .select('id, thread_id, content, author_id')
            .in('thread_id', threadIds)
        : { data: [] as MsgRow[] };

    const messagesByThread = new Map<string, MsgRow[]>();
    for (const m of (allMessages ?? []) as MsgRow[]) {
      const list = messagesByThread.get(m.thread_id) ?? [];
      list.push(m);
      messagesByThread.set(m.thread_id, list);
    }

    const allMessageIds = ((allMessages ?? []) as MsgRow[]).map((m) => m.id);
    const { data: intel } =
      allMessageIds.length > 0
        ? await supabase
            .from('engagement_message_intelligence')
            .select('message_id, intent, sentiment')
            .in('message_id', allMessageIds)
        : { data: [] as Array<{ message_id: string; intent?: string; sentiment?: string }> };

    const intelByMsg = new Map<string, { intent?: string; sentiment?: string }>();
    for (const i of intel ?? []) {
      intelByMsg.set((i as { message_id: string }).message_id, {
        intent: (i as { intent?: string }).intent,
        sentiment: (i as { sentiment?: string }).sentiment,
      });
    }

    const CONCURRENCY = 5;
    let totalDetected = 0;
    let totalProcessed = 0;

    for (const tid of threadIds) {
      const messages = messagesByThread.get(tid) ?? [];
      const threadContext = messages
        .map((m) => (m.content ?? '').toString().slice(0, 100))
        .join(' ');

      for (let i = 0; i < messages.length; i += CONCURRENCY) {
        const chunk = messages.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map((msg) => {
            const im = intelByMsg.get(msg.id);
            return processMessageForLeads({
              organization_id: organizationId,
              message_id: msg.id,
              thread_id: msg.thread_id,
              author_id: msg.author_id ?? null,
              content: (msg.content ?? '').toString(),
              intent: im?.intent ?? null,
              sentiment: im?.sentiment ?? null,
              thread_context: threadContext,
            });
          })
        );
        for (const result of results) {
          totalProcessed++;
          if (result.detected) totalDetected++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      threads_processed: threadIds.length,
      messages_processed: totalProcessed,
      leads_detected: totalDetected,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/detect-leads]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/detect-leads' });

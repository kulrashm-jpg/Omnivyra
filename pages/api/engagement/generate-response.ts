import { withContract } from '@/lib/api/withContract';
/**
 * POST /api/engagement/generate-response
 *
 * Generate an AI response to a community message (comment, DM, question).
 * Supports fast path (instant) + AI refinement (queued).
 *
 * This is different from /api/engagement/reply which executes the response.
 * This endpoint just generates suggestions.
 *
 * Body:
 * {
 *   message: string
 *   platform: string (linkedin, x, instagram, facebook, reddit)
 *   engagement_type: 'reply' | 'new_conversation' | 'dm' | 'outreach_response'
 *   thread_context?: string
 *   force_queue?: boolean (skip deterministic fast path)
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateEngagementResponse } from '../../../backend/adapters/engagement/responseAdapter';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * Resolve a campaign engagement signal id to engagement_threads.id.
 * Walks signal.source_id -> engagement_messages.thread_id. Returns null
 * if the chain can't be resolved.
 */
async function resolveThreadIdFromSignal(signalId: string): Promise<string | null> {
  const { data: signal } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('source_id')
    .eq('id', signalId)
    .maybeSingle();
  const sourceId = (signal as { source_id?: string | null } | null)?.source_id ?? null;
  if (!sourceId) return null;
  const { data: msg } = await supabase
    .from('engagement_messages')
    .select('thread_id')
    .eq('id', sourceId)
    .maybeSingle();
  return ((msg as { thread_id?: string | null } | null)?.thread_id) ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const company_id = (user?.defaultCompanyId || req.body?.company_id) as string | undefined;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    const {
      message,
      platform,
      engagement_type,
      thread_context,
      force_queue,
      signal_id,
      thread_id,
    } = req.body ?? {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }
    if (!platform || typeof platform !== 'string') {
      return res.status(400).json({ error: 'platform required' });
    }
    if (!engagement_type || typeof engagement_type !== 'string') {
      return res.status(400).json({ error: 'engagement_type required' });
    }

    // Get queue
    const { getContentQueue } = await import('../../../backend/queue/contentGenerationQueues');
    const contentGenerationQueue = getContentQueue('content-engagement');

    // Generate response
    const result = await generateEngagementResponse(company_id, contentGenerationQueue, {
      original_message: message,
      platform: platform.toLowerCase(),
      engagement_type: engagement_type as any,
      thread_context: typeof thread_context === 'string' ? thread_context : undefined,
    }, {
      force_queue: Boolean(force_queue),
    });

    // ── AI safety: create the ai_message_drafts row at generation time so
    //    the UI cannot send AI-derived text without a draft. The draft is
    //    only created on the deterministic fast-path where we have the
    //    text immediately. The queued path returns a jobId; the worker
    //    that processes the job is responsible for creating the draft
    //    when it produces text (out of scope for this endpoint).
    let aiDraftId: string | null = null;
    const generatedText =
      typeof (result as { immediate_response?: string }).immediate_response === 'string'
        ? (result as { immediate_response: string }).immediate_response
        : null;

    if (generatedText) {
      let resolvedThreadId: string | null = null;
      if (typeof thread_id === 'string' && thread_id.length > 0) {
        resolvedThreadId = thread_id;
      } else if (typeof signal_id === 'string' && signal_id.length > 0) {
        resolvedThreadId = await resolveThreadIdFromSignal(signal_id);
      }

      if (resolvedThreadId) {
        const { data: draftRow, error: draftErr } = await supabase
          .from('ai_message_drafts')
          .insert({
            thread_id: resolvedThreadId,
            platform: platform.toLowerCase(),
            generated_text: generatedText,
            status: 'draft',
            created_by: user?.userId ?? null,
          })
          .select('id')
          .single();
        if (draftErr) {
          console.warn('[engagement/generate-response] ai_draft create failed:', draftErr.message);
        } else {
          aiDraftId = (draftRow as { id?: string } | null)?.id ?? null;
        }
      }
    }

    return res.status(200).json({
      ...result,
      ai_draft_id: aiDraftId,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to generate response';
    console.error('[engagement/generate-response]', msg);
    return res.status(500).json({ error: msg });
  }
}

export default withContract(handler);

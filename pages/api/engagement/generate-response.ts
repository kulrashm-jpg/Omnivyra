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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    return res.status(200).json(result);
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to generate response';
    console.error('[engagement/generate-response]', msg);
    return res.status(500).json({ error: msg });
  }
}

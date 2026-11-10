import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/response/generate
 * Generate an AI response suggestion for a message. It never sends.
 *
 * Engagement Intelligence generates and does not send (owner ruling). The
 * former caller-supplied `execute` flag is REFUSED with 400
 * GENERATION_DOES_NOT_EXECUTE rather than silently ignored, so a caller that
 * expected a send learns that none happened. Sending a reply is the job of the
 * community executor on a persisted, human-approved action (D-01), and
 * autonomous response is governed only by automation/automationService.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { orchestrateResponse } from '../../../backend/services/responseOrchestrator';
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
    const messageId = (body.message_id ?? body.messageId) as string | undefined;
    if (body.execute !== undefined && body.execute !== false) {
      return res.status(400).json({
        error: 'execute is not supported: response generation never sends',
        code: 'GENERATION_DOES_NOT_EXECUTE',
      });
    }

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!messageId) {
      return res.status(400).json({ error: 'message_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: message, error: msgError } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, content, platform')
      .eq('organization_id', organizationId)
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('organization_id')
      .eq('id', message.thread_id)
      .maybeSingle();

    if (!thread || thread.organization_id !== organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: intel } = await supabase
      .from('engagement_message_intelligence')
      .select('intent, sentiment')
      .eq('message_id', messageId)
      .maybeSingle();

    const { data: leadSignal } = await supabase
      .from('lead_signals')
      .select('metadata')
      .eq('source_id', messageId)
      .eq('organization_id', organizationId)
      .eq('source_type', 'engagement')
      .maybeSingle();

    const intentOverride =
      ((leadSignal as { metadata?: { lead_intent?: string } } | null)?.metadata?.lead_intent ?? null)
        ? 'lead_interest'
        : null;

    const result = await orchestrateResponse({
      message_id: messageId,
      thread_id: message.thread_id,
      organization_id: organizationId,
      platform: (message.platform ?? 'linkedin').toString(),
      intent: intentOverride ?? (intel as { intent?: string })?.intent ?? null,
      sentiment: (intel as { sentiment?: string })?.sentiment ?? null,
      original_message: (message.content ?? '').toString(),
      author_name: null,
      thread_context: null,
    });

    return res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      suggested_text: result.suggested_text,
      executed: false,
      requires_human_review: result.requires_human_review,
      auto_reply_rule_matched: result.auto_reply_rule_matched,
      reason: result.reason,
      error: result.error,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/generate]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/response/generate' });

/**
 * POST /api/response/generate
 * Generate (and optionally execute) AI response for a message.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { orchestrateResponse } from '../../../backend/services/responseOrchestrator';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const messageId = (body.message_id ?? body.messageId) as string | undefined;
    const execute = Boolean(body.execute);

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
      .from('engagement_lead_signals')
      .select('lead_intent')
      .eq('message_id', messageId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    const intentOverride =
      (leadSignal as { lead_intent?: string } | null)?.lead_intent
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
      execute,
    });

    return res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      suggested_text: result.suggested_text,
      executed: result.executed,
      requires_human_review: result.requires_human_review,
      reason: result.reason,
      error: result.error,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/generate]', msg);
    return res.status(500).json({ error: msg });
  }
}

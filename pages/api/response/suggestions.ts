/**
 * GET /api/response/suggestions
 * Analyze message patterns and propose rules.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

const SUGGESTED_INTENTS = [
  'greeting',
  'introduction',
  'question',
  'product_inquiry',
  'price_inquiry',
  'positive_feedback',
  'negative_feedback',
  'complaint',
  'lead_interest',
  'general_discussion',
  'spam',
];

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

    const { data: existingRules } = await supabase
      .from('response_rules')
      .select('intent_type, platform')
      .eq('organization_id', organizationId);

    const covered = new Set(
      (existingRules ?? []).map((r: { intent_type: string; platform: string | null }) =>
        `${r.intent_type}:${r.platform ?? '*'}`.toLowerCase()
      )
    );

    const { data: threads } = await supabase
      .from('engagement_threads')
      .select('id')
      .eq('organization_id', organizationId);
    const threadIds = (threads ?? []).map((t: { id: string }) => t.id);

    let intentCounts: Record<string, number> = {};
    if (threadIds.length > 0) {
      const { data: messages } = await supabase
        .from('engagement_messages')
        .select('id')
        .in('thread_id', threadIds.slice(0, 500));
      const messageIds = (messages ?? []).map((m: { id: string }) => m.id);

      if (messageIds.length > 0) {
        const { data: msgIntel } = await supabase
          .from('engagement_message_intelligence')
          .select('message_id, intent')
          .in('message_id', messageIds);
        for (const row of msgIntel ?? []) {
          const intent = ((row as { intent?: string }).intent ?? 'general_discussion').toLowerCase();
          intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
        }
      }
    }

    const proposed: Array<{
      intent_type: string;
      platform: string;
      message_count: number;
      has_rule: boolean;
      suggested_auto_reply: boolean;
    }> = [];

    for (const intent of SUGGESTED_INTENTS) {
      const count = intentCounts[intent] ?? 0;
      const hasRule = covered.has(`${intent}:*`) || covered.has(`${intent}:linkedin`);
      proposed.push({
        intent_type: intent,
        platform: 'linkedin',
        message_count: count,
        has_rule: hasRule,
        suggested_auto_reply: !['complaint', 'negative_feedback', 'spam'].includes(intent) && count > 0,
      });
    }

    return res.status(200).json({
      proposals: proposed.sort((a, b) => b.message_count - a.message_count),
      intent_counts: intentCounts,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[response/suggestions]', msg);
    return res.status(500).json({ error: msg });
  }
}

import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/engagement/message/mark-self
 *
 * Manual override for "this message was actually sent by me, not the
 * person LinkedIn attributed it to." Needed when two people in a thread
 * share a display name (or any case where the scraper couldn't determine
 * authorship reliably) — the thread otherwise gets stuck in Needs
 * Response indefinitely because the system thinks the user's own reply
 * is from the other party.
 *
 * Effect on the row:
 *   - direction = 'outgoing'
 *   - raw_payload.author_self = true
 *   - raw_payload.manual_self_marked_at = <ISO timestamp>
 *
 * Once flipped:
 *   - The latest_message_author_self signal on the inbox row turns true,
 *     dropping the thread from Needs Response.
 *   - Re-syncing from LinkedIn won't undo it (the manual marker is
 *     preserved through upserts on platform_message_id).
 *
 * Idempotent: re-marking a row that's already outgoing is a no-op.
 * Authorisation: caller must own the thread (org membership check).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

type Body = {
  organization_id?: string;
  message_id?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as Body;
  const organizationId = (body.organization_id ?? '').trim();
  const messageId = (body.message_id ?? '').trim();

  if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
  if (!messageId) return res.status(400).json({ error: 'message_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  // Org-scope check: load the message + its thread, refuse if the thread
  // doesn't belong to the caller's org.
  const { data: msg } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, direction, raw_payload')
    .eq('id', messageId)
    .maybeSingle();

  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .eq('id', (msg as { thread_id: string }).thread_id)
    .maybeSingle();

  if (!thread || (thread as { organization_id: string }).organization_id !== organizationId) {
    return res.status(403).json({ error: 'Message thread not found or access denied' });
  }

  const existingPayload = ((msg as { raw_payload: Record<string, unknown> | null }).raw_payload ?? {}) as Record<string, unknown>;
  const newPayload = {
    ...existingPayload,
    author_self: true,
    sender_self: true,
    manual_self_marked_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from('engagement_messages')
    .update({
      direction: 'outgoing',
      raw_payload: newPayload,
    })
    .eq('id', messageId);

  if (updateError) {
    console.error('[engagement/message/mark-self] update failed:', updateError.message);
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({ success: true, message_id: messageId });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/message/mark-self' });

/**
 * POST /api/engagement/thread/ignore
 * Mark a thread as ignored.
 * Body: thread_id, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

type Body = {
  thread_id?: string;
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const threadId = body.thread_id?.trim();
    const organizationId = body.organization_id ?? user?.defaultCompanyId as string | undefined;

    if (!threadId) {
      return res.status(400).json({ error: 'thread_id required' });
    }
    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: thread, error: fetchError } = await supabase
      .from('engagement_threads')
      .select('id, organization_id')
      .eq('id', threadId)
      .maybeSingle();

    if (fetchError || !thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if ((thread as { organization_id: string | null }).organization_id !== organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error: updateError } = await supabase
      .from('engagement_threads')
      .update({ ignored: true, updated_at: new Date().toISOString() })
      .eq('id', threadId);

    if (updateError) {
      console.warn('[engagement/thread/ignore] update error', updateError.message);
      return res.status(500).json({ error: 'Failed to ignore thread' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/ignore]', msg);
    return res.status(500).json({ error: msg });
  }
}

/**
 * POST /api/engagement/thread/bulk-ignore
 * Mark multiple threads as ignored.
 * Body: thread_ids, organization_id
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

const MAX_BATCH = 20;

type Body = {
  thread_ids?: string[];
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
    const rawThreadIds = Array.isArray(body.thread_ids) ? body.thread_ids : [];
    const organizationId = body.organization_id ?? user?.defaultCompanyId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (rawThreadIds.length === 0) {
      return res.status(400).json({ error: 'thread_ids required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const threadIds = rawThreadIds.slice(0, MAX_BATCH);

    const { data: threads } = await supabase
      .from('engagement_threads')
      .select('id')
      .eq('organization_id', organizationId)
      .in('id', threadIds);

    const validIds = (threads ?? []).map((t: { id: string }) => t.id);
    if (validIds.length === 0) {
      return res.status(200).json({ success: true, ignored: 0 });
    }

    const { error: updateErr } = await supabase
      .from('engagement_threads')
      .update({ ignored: true, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .in('id', validIds);

    if (updateErr) {
      console.warn('[engagement/thread/bulk-ignore]', updateErr.message);
      return res.status(500).json({ error: 'Failed to ignore threads' });
    }

    return res.status(200).json({ success: true, ignored: validIds.length });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/bulk-ignore]', msg);
    return res.status(500).json({ error: msg });
  }
}

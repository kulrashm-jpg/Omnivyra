/**
 * POST /api/engagement/thread/bulk-resolve
 * Resolve opportunities for selected threads.
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

    const validIds = new Set((threads ?? []).map((t: { id: string }) => t.id));
    const toResolve = threadIds.filter((id) => validIds.has(id));

    if (toResolve.length === 0) {
      return res.status(200).json({ success: true, resolved: 0 });
    }

    const { error: updateErr } = await supabase
      .from('engagement_opportunities')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)
      .in('source_thread_id', toResolve);

    if (updateErr) {
      console.warn('[engagement/thread/bulk-resolve]', updateErr.message);
      return res.status(500).json({ error: 'Failed to resolve opportunities' });
    }

    return res.status(200).json({ success: true, resolved: toResolve.length });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/bulk-resolve]', msg);
    return res.status(500).json({ error: msg });
  }
}

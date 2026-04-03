
/**
 * GET /api/engagement/threads
 * Returns engagement threads from the unified model.
 * Supports filters: platform, organization_id, date_range.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as string | undefined;
    const platform = (req.query.platform as string)?.trim();
    const sourceId = (req.query.source_id ?? req.query.sourceId) as string | undefined;
    const startDate = (req.query.start_date ?? req.query.startDate) as string | undefined;
    const endDate = (req.query.end_date ?? req.query.endDate) as string | undefined;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id or organizationId required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    let query = supabase
      .from('engagement_threads')
      .select('id, platform, platform_thread_id, root_message_id, source_id, organization_id, created_at, updated_at')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (platform) query = query.eq('platform', platform);
    if (sourceId) query = query.eq('source_id', sourceId);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data, error } = await query;

    if (error) {
      console.error('[engagement/threads]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const threads = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      platform: r.platform,
      platform_thread_id: r.platform_thread_id,
      root_message_id: r.root_message_id,
      source_id: r.source_id,
      organization_id: r.organization_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.status(200).json({ threads });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch threads';
    console.error('[engagement/threads]', message);
    return res.status(500).json({ error: message });
  }
}

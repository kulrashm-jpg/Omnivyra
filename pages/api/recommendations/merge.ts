import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { companyId, snapshot_ids: snapshotIds } = req.body || {};
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const ids = Array.isArray(snapshotIds)
    ? snapshotIds.filter((x: unknown) => typeof x === 'string')
    : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'snapshot_ids array is required' });
  }

  const { data: rows, error: fetchError } = await supabase
    .from('recommendation_snapshots')
    .select('id, company_id, campaign_id, trend_topic, confidence, explanation, status, regions, source_signals_count')
    .in('id', ids)
    .eq('company_id', companyId);

  if (fetchError || !rows?.length) {
    return res.status(404).json({ error: 'No matching recommendations found' });
  }

  const topics = [...new Set(rows.map((r: any) => r.trend_topic).filter(Boolean))];
  const allRegions = rows.reduce<string[]>((acc, r: any) => {
    if (Array.isArray(r.regions)) acc.push(...r.regions);
    return acc;
  }, []);
  const uniqueRegions = [...new Set(allRegions)];
  const totalSignals = rows.reduce((sum: number, r: any) => sum + (r.source_signals_count ?? 0), 0);

  const merged = {
    trend_topics: topics,
    regions: uniqueRegions,
    source_signals_count: totalSignals,
    snapshot_count: rows.length,
    snapshot_ids: ids,
  };

  try {
    await supabase.from('audit_logs').insert({
      action: 'RECOMMENDATION_MERGE',
      actor_user_id: access.userId ?? null,
      company_id: companyId,
      metadata: { snapshot_ids: ids, merged_topic_count: topics.length },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('RECOMMENDATION_MERGE audit failed', e);
  }

  return res.status(200).json({
    ok: true,
    merged,
  });
}

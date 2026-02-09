import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';

const applyFrequencyValue = (value: any, next: number) => {
  if (value && typeof value === 'object') {
    return { ...value, posts_per_week: next };
  }
  return next;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = String(campaignRow.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const { data: proposedVersion, error: proposedError } = await supabase
    .from('campaign_versions')
    .select('*')
    .eq('campaign_id', id)
    .eq('status', 'proposed_rebalance')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proposedError || !proposedVersion) {
    return res.status(404).json({ error: 'No proposed rebalance found' });
  }

  const proposedChanges = proposedVersion?.campaign_snapshot?.proposed_changes || [];
  const impactProjection = proposedVersion?.campaign_snapshot?.impact_projection || null;

  const { data: platformStrategies } = await supabase
    .from('platform_strategies')
    .select('platform, content_frequency, content_types, target_metrics')
    .eq('campaign_id', id);
  const platformMap = (platformStrategies || []).reduce<Record<string, any>>((acc, row) => {
    acc[String(row.platform).toLowerCase()] = row;
    return acc;
  }, {});

  const upserts = (proposedChanges || []).map((change: any) => {
    const platform = String(change.platform || '').toLowerCase();
    const existing = platformMap[platform];
    const nextFrequency = Number(change.recommended_frequency ?? 0);
    return {
      campaign_id: id,
      platform: existing?.platform || platform,
      content_frequency: applyFrequencyValue(existing?.content_frequency, nextFrequency),
      content_types: existing?.content_types ?? [],
      target_metrics: existing?.target_metrics ?? {},
      optimal_posting_times: existing?.optimal_posting_times ?? {},
      character_limits: existing?.character_limits ?? {},
      media_requirements: existing?.media_requirements ?? {},
      updated_at: new Date().toISOString(),
    };
  });

  if (upserts.length > 0) {
    const { error: updateError } = await supabase.from('platform_strategies').upsert(upserts);
    if (updateError) {
      return res.status(500).json({ error: `Failed to apply frequency changes: ${updateError.message}` });
    }
  }

  const latestVersion = await getLatestCampaignVersion(companyId, id);
  const nextVersion = (latestVersion?.version ?? 0) + 1;
  const { data: approvedVersion, error: approvedError } = await supabase
    .from('campaign_versions')
    .insert({
      company_id: companyId,
      campaign_id: id,
      campaign_snapshot: {
        ...(proposedVersion?.campaign_snapshot || {}),
        approved_from_version_id: proposedVersion?.id ?? null,
        impact_projection: impactProjection,
        applied_at: new Date().toISOString(),
      },
      status: 'approved',
      version: nextVersion,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (approvedError) {
    return res.status(500).json({ error: `Failed to approve rebalance: ${approvedError.message}` });
  }

  return res.status(200).json({
    success: true,
    status: 'approved',
    version_id: approvedVersion?.id ?? null,
  });
}

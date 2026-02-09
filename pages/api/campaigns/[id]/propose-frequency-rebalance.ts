import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../../../../backend/db/campaignApprovedVersionStore';

const getFrequencyValue = (value: any) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const candidate =
      value.posts_per_week ??
      value.per_week ??
      value.frequency ??
      value.count ??
      value.weekly;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return 0;
};

const applyFrequencyValue = (value: any, next: number) => {
  if (value && typeof value === 'object') {
    return { ...value, posts_per_week: next };
  }
  return next;
};

const buildOrigin = (req: NextApiRequest) =>
  req.headers.origin || `http://${req.headers.host}`;

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

  const approvedVersion = await getLatestApprovedCampaignVersion(companyId, id);
  const latestVersion = await getLatestCampaignVersion(companyId, id);

  const { data: platformStrategies } = await supabase
    .from('platform_strategies')
    .select('platform, content_frequency')
    .eq('campaign_id', id);
  const platformFrequency = (platformStrategies || []).reduce<Record<string, any>>((acc, row) => {
    acc[String(row.platform).toLowerCase()] = row.content_frequency;
    return acc;
  }, {});

  const origin = buildOrigin(req);
  const adviceResponse = await fetch(`${origin}/api/campaigns/${id}/platform-allocation-advice`, {
    headers: {
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
    },
  });
  if (!adviceResponse.ok) {
    const errorBody = await adviceResponse.json().catch(() => null);
    return res.status(500).json({ error: errorBody?.error || 'Failed to load platform advice' });
  }
  const advice = await adviceResponse.json();

  const proposedChanges = (advice.platform_advice || []).map((item: any) => {
    const platformKey = String(item.platform || '').toLowerCase();
    const currentFrequency = getFrequencyValue(platformFrequency[platformKey]);
    const delta = typeof item.suggested_frequency_delta === 'number' ? item.suggested_frequency_delta : 0;
    const recommendedFrequency = Math.max(0, currentFrequency + delta);
    return {
      platform: item.platform,
      current_frequency: currentFrequency,
      recommended_frequency: recommendedFrequency,
      reason: item.rationale || 'Rebalance based on performance signals.',
    };
  });

  const increaseCount = proposedChanges.filter((change: any) => change.recommended_frequency > change.current_frequency).length;
  const reduceCount = proposedChanges.filter((change: any) => change.recommended_frequency < change.current_frequency).length;
  const expectedReachDelta = Math.max(0, increaseCount * 6 - reduceCount * 3);
  const expectedLeadsDelta = Math.max(0, Math.round(expectedReachDelta * 0.5));
  const impactProjection = {
    expected_reach_delta: `+${expectedReachDelta}%`,
    expected_leads_delta: `+${expectedLeadsDelta}%`,
  };

  const nextVersion = (latestVersion?.version ?? 0) + 1;
  const campaignSnapshot = {
    previous_version_id: approvedVersion?.id ?? latestVersion?.id ?? null,
    rebalance_type: 'platform_frequency',
    proposed_changes: proposedChanges,
    impact_projection: impactProjection,
  };

  const { data: insertedVersion, error: insertError } = await supabase
    .from('campaign_versions')
    .insert({
      company_id: companyId,
      campaign_id: id,
      campaign_snapshot: campaignSnapshot,
      status: 'proposed_rebalance',
      version: nextVersion,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (insertError) {
    return res.status(500).json({ error: `Failed to save rebalance proposal: ${insertError.message}` });
  }

  await supabase.from('audit_logs').insert({
    action: 'PLATFORM_FREQUENCY_REBALANCE_PROPOSED',
    actor_user_id: user.id,
    company_id: companyId,
    metadata: {
      campaign_id: id,
      proposed_changes: proposedChanges,
      impact_projection: impactProjection,
    },
    created_at: new Date().toISOString(),
  });

  return res.status(200).json({
    proposal_version_id: insertedVersion?.id ?? null,
    proposed_changes: proposedChanges,
    impact_projection: impactProjection,
  });
}

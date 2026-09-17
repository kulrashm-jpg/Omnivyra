import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { compareLatestVersionFirst, type getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';
import { resolveCampaignOwnership } from '../../../../backend/services/campaignOwnershipService';
import { computePlatformAllocationAdvice } from '../../../../backend/services/campaignPlatformAllocationAdviceService';

type CampaignVersionRow = Awaited<ReturnType<typeof getLatestCampaignVersion>>;

/**
 * 3AH-116 (WS-D) — the newest version of this campaign INSIDE the authorized
 * company, by the canonical content ordering (created_at DESC NULLS LAST,
 * version DESC NULLS LAST, id DESC — compareLatestVersionFirst). Content
 * selection only: ownership is decided by resolveCampaignOwnership.
 */
async function latestCompanyVersion(
  companyId: string,
  campaignId: string,
  status?: string,
): Promise<{ failed: boolean; row: CampaignVersionRow }> {
  let candidates = supabase
    .from('campaign_versions')
    .select('id, created_at, version')
    .eq('company_id', companyId)
    .eq('campaign_id', campaignId);
  if (status) candidates = candidates.eq('status', status);
  const { data, error } = await candidates;
  if (error) return { failed: true, row: null };
  const [latest] = [...(data ?? [])].sort(compareLatestVersionFirst);
  if (!latest) return { failed: false, row: null };
  const { data: row, error: rowError } = await supabase
    .from('campaign_versions')
    .select('*')
    .eq('id', latest.id)
    .eq('company_id', companyId)
    .eq('campaign_id', campaignId)
    .maybeSingle();
  return rowError ? { failed: true, row: null } : { failed: false, row };
}

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  // 3AH-116 (WS-D) — the owner is the canonical resolver's answer over EVERY
  // owner record, never one version row or the campaigns row alone. CONFLICT,
  // UNOWNED and NOT_FOUND are the same 404; a failed lookup is a retryable 503.
  const ownership = await resolveCampaignOwnership(id);
  if (ownership.status === 'LOOKUP_FAILED') {
    return res.status(503).json({
      error: 'Campaign ownership check is temporarily unavailable. Please try again.',
      code: 'CAMPAIGN_LOOKUP_ERROR',
      retryable: true,
    });
  }
  if (ownership.status === 'INVALID') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }
  if (ownership.status !== 'OWNED') {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = ownership.companyId;
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const approved = await latestCompanyVersion(companyId, id, 'approved');
  const latest = await latestCompanyVersion(companyId, id);
  if (approved.failed || latest.failed) {
    return res.status(500).json({ error: 'Failed to load campaign version' });
  }
  const approvedVersion = approved.row;
  const latestVersion = latest.row;

  const { data: platformStrategies } = await supabase
    .from('platform_strategies')
    .select('platform, content_frequency')
    .eq('campaign_id', id);
  const platformFrequency = (platformStrategies || []).reduce<Record<string, any>>((acc, row) => {
    acc[String(row.platform).toLowerCase()] = row.content_frequency;
    return acc;
  }, {});

  // SEC-E1 (STEP 3AH-91): the advice is computed in-process. This route used
  // to request the advice route on the host named by the caller's Origin
  // header, forwarding the caller's Authorization + Cookie — a request to a
  // caller-chosen host carrying the caller's credentials. The caller has already
  // been authorised above (COMPANY_ADMIN of the campaign's own company), which is
  // stricter than the advice route's own membership check.
  let advice: Awaited<ReturnType<typeof computePlatformAllocationAdvice>>;
  try {
    advice = await computePlatformAllocationAdvice(id);
  } catch {
    return res.status(500).json({ error: 'Failed to load platform advice' });
  }

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
    return res.status(500).json({ error: 'Failed to save rebalance proposal' });
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/propose-frequency-rebalance' });

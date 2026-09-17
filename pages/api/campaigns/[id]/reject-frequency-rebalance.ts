import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { compareLatestVersionFirst, type getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';
import { resolveCampaignOwnership } from '../../../../backend/services/campaignOwnershipService';

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

  const { failed: proposedFailed, row: proposedVersion } = await latestCompanyVersion(companyId, id, 'proposed_rebalance');
  if (proposedFailed) {
    return res.status(500).json({ error: 'Failed to load rebalance proposal' });
  }
  if (!proposedVersion) {
    return res.status(404).json({ error: 'No proposed rebalance found' });
  }

  const rejection_reason =
    req.body && typeof req.body === 'object' ? req.body.rejection_reason || null : null;

  const { failed: latestFailed, row: latestVersion } = await latestCompanyVersion(companyId, id);
  if (latestFailed) {
    return res.status(500).json({ error: 'Failed to load campaign version' });
  }
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const { data: rejectedVersion, error: rejectedError } = await supabase
    .from('campaign_versions')
    .insert({
      company_id: companyId,
      campaign_id: id,
      campaign_snapshot: {
        previous_version_id: proposedVersion?.campaign_snapshot?.previous_version_id ?? null,
        rejected_proposal_id: proposedVersion.id,
        rejection_reason,
      },
      status: 'rebalance_rejected',
      version: nextVersion,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (rejectedError) {
    return res.status(500).json({ error: 'Failed to reject rebalance' });
  }

  await supabase.from('audit_logs').insert({
    action: 'PLATFORM_FREQUENCY_REBALANCE_REJECTED',
    actor_user_id: user.id,
    company_id: companyId,
    metadata: {
      campaign_id: id,
      proposal_version_id: proposedVersion.id,
      rejection_reason,
      actor_user_id: user.id,
    },
    created_at: new Date().toISOString(),
  });

  return res.status(200).json({
    success: true,
    status: 'rebalance_rejected',
    version_id: rejectedVersion?.id ?? null,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/reject-frequency-rebalance' });

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';

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

  const rejection_reason =
    req.body && typeof req.body === 'object' ? req.body.rejection_reason || null : null;

  const latestVersion = await getLatestCampaignVersion(companyId, id);
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
    return res.status(500).json({ error: `Failed to reject rebalance: ${rejectedError.message}` });
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

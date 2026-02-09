import { supabase } from './supabaseClient';
import { getLatestCampaignVersion } from './campaignVersionStore';

export async function getLatestApprovedCampaignVersion(
  companyId: string,
  campaignId?: string
): Promise<any | null> {
  console.debug('Approved version resolver used', { companyId, campaignId });

  let approvedQuery = supabase
    .from('campaign_versions')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'approved');
  if (campaignId) {
    approvedQuery = approvedQuery.eq('campaign_id', campaignId);
  }
  const { data: approvedVersion } = await approvedQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestVersion = await getLatestCampaignVersion(companyId, campaignId);

  if (
    approvedVersion &&
    latestVersion &&
    latestVersion.status === 'proposed' &&
    latestVersion.id !== approvedVersion.id
  ) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existingAudit } = await supabase
        .from('audit_logs')
        .select('created_at')
        .eq('action', 'STRATEGY_REAPPROVAL_REQUIRED')
        .eq('company_id', companyId)
        .eq('metadata->>proposed_version', latestVersion.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingAudit?.created_at) {
        console.debug('Reapproval audit deduped', {
          companyId,
          campaignId,
          proposedVersion: latestVersion.id,
        });
      } else {
        await supabase.from('audit_logs').insert({
          action: 'STRATEGY_REAPPROVAL_REQUIRED',
          actor_user_id: null,
          company_id: companyId,
          metadata: {
            campaign_id: campaignId ?? null,
            proposed_version: latestVersion.id,
            approved_version: approvedVersion.id,
          },
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }
  }

  return approvedVersion || latestVersion || null;
}

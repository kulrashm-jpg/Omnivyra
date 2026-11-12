import { supabase } from './supabaseClient';
import { getLatestCampaignVersion, CampaignVersionReadError } from './campaignVersionStore';

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
  const { data: approvedVersion, error: approvedError } = await approvedQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // unread-error pkg 2 (e9: BLOCKING): a FAILED approved read is not "no approved version". It used to
  // fall through to the latest version, possibly UNAPPROVED, and campaignOptimizationService then SAVED a
  // new blueprint and campaign version derived from it. A failed read throws; the designed fallback below
  // (no approved version exists -> the latest) applies only to a read that succeeded.
  if (approvedError) throw new CampaignVersionReadError('getLatestApprovedCampaignVersion.approved', approvedError);

  const latestVersion = await getLatestCampaignVersion(companyId, campaignId);

  if (
    approvedVersion &&
    latestVersion &&
    latestVersion.status === 'proposed' &&
    latestVersion.id !== approvedVersion.id
  ) {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existingAudit, error: auditReadError } = await supabase
        .from('audit_logs')
        .select('created_at')
        .eq('action', 'STRATEGY_REAPPROVAL_REQUIRED')
        .eq('company_id', companyId)
        .eq('metadata->>proposed_version', latestVersion.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditReadError) {
        // Unread, a failed dedupe read wrote a DUPLICATE audit row. Best-effort audit: skip and log.
        console.warn('AUDIT_LOG_FAILED', { reason: 'dedupe read failed', companyId, campaignId, message: auditReadError.message });
      } else if (existingAudit?.created_at) {
        console.debug('Reapproval audit deduped', {
          companyId,
          campaignId,
          proposedVersion: latestVersion.id,
        });
      } else {
        const { error: auditInsertError } = await supabase.from('audit_logs').insert({
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
        if (auditInsertError) console.warn('AUDIT_LOG_FAILED', { reason: 'insert failed', companyId, campaignId, message: auditInsertError.message });
      }
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }
  }

  return approvedVersion || latestVersion || null;
}

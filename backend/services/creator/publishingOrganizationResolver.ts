/**
 * Canonical Publishing Organization Resolver.
 *
 * The ONE runtime source of organization (company) identity for publishing. Every
 * publishing path resolves the owning org through here instead of ad-hoc lookups or
 * the userId-as-companyId fallback. The canonical owner is `social_accounts.company_id`
 * (the tenant that owns the connected account — never a caller-supplied id), with
 * `campaigns.company_id` and the scheduled post's own bindings as ordered fallbacks.
 *
 * This consolidates the lookup that `publishProcessor` previously inlined (twice) so
 * the server asset resolver always receives the real company id, lifting hit-rate.
 * Fail-soft: returns null when the org genuinely cannot be determined (caller then
 * falls back exactly as before — no behaviour regression).
 */

import { supabase } from '../../db/supabaseClient';

export interface PublishingOrgInput {
  socialAccountId?: string | null;
  campaignId?: string | null;
  scheduledPostId?: string | null;
}

async function companyOfSocialAccount(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('social_accounts').select('company_id').eq('id', id).maybeSingle();
    const org = (data as { company_id?: string } | null)?.company_id;
    return org ? String(org) : null;
  } catch { return null; }
}

async function companyOfCampaign(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('campaigns').select('company_id').eq('id', id).maybeSingle();
    const org = (data as { company_id?: string } | null)?.company_id;
    return org ? String(org) : null;
  } catch { return null; }
}

/**
 * Resolve the canonical organization id for a publish. Order: connected account →
 * campaign → (scheduled post's account/campaign). Returns null only when none resolve.
 */
export async function resolvePublishingOrganization(input: PublishingOrgInput): Promise<string | null> {
  if (input.socialAccountId) {
    const org = await companyOfSocialAccount(String(input.socialAccountId));
    if (org) return org;
  }
  if (input.campaignId) {
    const org = await companyOfCampaign(String(input.campaignId));
    if (org) return org;
  }
  if (input.scheduledPostId) {
    try {
      const { data } = await supabase
        .from('scheduled_posts')
        .select('social_account_id, campaign_id')
        .eq('id', String(input.scheduledPostId))
        .maybeSingle();
      const row = data as { social_account_id?: string | null; campaign_id?: string | null } | null;
      if (row?.social_account_id) { const org = await companyOfSocialAccount(String(row.social_account_id)); if (org) return org; }
      if (row?.campaign_id) { const org = await companyOfCampaign(String(row.campaign_id)); if (org) return org; }
    } catch { /* fall through */ }
  }
  return null;
}

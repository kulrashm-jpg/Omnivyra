/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — campaign → tenant binding for enforceCompanyAccess.
 *
 * enforceCompanyAccess({ companyId, campaignId }) proved that the caller is an
 * active member of `companyId`, and then returned success without ever asking
 * whether `campaignId` belonged to that company. A member of company A could
 * therefore authorize against A and pass company B's campaign id, and every
 * route that trusted the guard read or wrote B's campaign (STEP 3AH-84 P1-4,
 * e.g. campaigns/[id]/commit-plan).
 *
 * Ownership records, in the order they are consulted:
 *   1. a `campaign_versions` row pairing this campaign with this company — the
 *      record every creation flow writes (see campaignAccessService
 *      .resolveCampaignCompanyId). The read carries the company predicate, so
 *      it can only ever confirm ownership, never disclose another tenant's row.
 *   2. `campaigns.company_id` — for legacy campaigns that have no version row
 *      for the company (the same authority TenantGuard.requireCampaignTenantAccess
 *      uses).
 *
 * Outcomes:
 *   owned        — a record ties the campaign to the company;
 *   foreign      — the campaign exists but nothing ties it to the company
 *                  (another tenant's campaign, or an orphan with no owner);
 *   not_found    — no campaign with this id exists yet (no campaigns row and
 *                  no campaign_versions row). Creation flows pass the id of the
 *                  campaign they are about to create, and a campaign that does
 *                  not exist cannot belong to another tenant;
 *   lookup_error — a read failed; callers must fail closed (503).
 *
 * This module deliberately imports nothing but the database client, so the
 * guard in userContextService can use it without the import cycle that
 * campaignAccessService (which imports userContextService) would create.
 */
import { supabase } from '../db/supabaseClient';

export type CampaignOwnership = 'owned' | 'foreign' | 'not_found' | 'lookup_error';

export async function checkCampaignOwnership(
  campaignId: string,
  companyId: string,
): Promise<CampaignOwnership> {
  if (!campaignId || typeof campaignId !== 'string' || !companyId) return 'not_found';

  const version = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('campaign_id', campaignId)
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();
  if (version.error) return 'lookup_error';
  if (version.data) return 'owned';

  const campaign = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaign.error) return 'lookup_error';
  if (!campaign.data) {
    // campaign_versions.campaign_id is plain text with no foreign key, so a
    // version row can exist without a campaigns row. Any such row belongs to
    // another company (step 1 already ruled out this one) → foreign, not new.
    const anyVersion = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    if (anyVersion.error) return 'lookup_error';
    return anyVersion.data ? 'foreign' : 'not_found';
  }
  const legacyCompany = (campaign.data as { company_id?: string | null }).company_id ?? null;
  // A campaign that exists with no owner record for this company is never
  // "unowned, so allowed" — it is someone else's, or nobody's.
  return legacyCompany && String(legacyCompany) === String(companyId) ? 'owned' : 'foreign';
}

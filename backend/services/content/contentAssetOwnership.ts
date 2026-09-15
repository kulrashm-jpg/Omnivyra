/**
 * STEP 3AH-91 (SEC91-W2G-N1) — bind a content asset to the company a route
 * authorized.
 *
 * `enforceCompanyAccess` only proves the caller belongs to the body's
 * `companyId`; routes that then act on a body `assetId` must prove the asset
 * belongs to that company too. Same resolution as the guard already in
 * `pages/api/content/regenerate.ts`: asset → campaign → owning company via
 * `campaign_versions` (the canonical campaign→company map). Fails closed: an
 * owner that cannot be resolved (missing row, lookup error) is `forbidden`.
 */
import { getContentAssetById } from '../../db/contentAssetStore';
import { supabase } from '../../db/supabaseClient';

export type ContentAssetOwnership = 'owned' | 'not_found' | 'forbidden';

export async function checkContentAssetOwnership(assetId: string, companyId: string): Promise<ContentAssetOwnership> {
  const asset = await getContentAssetById(String(assetId));
  if (!asset) return 'not_found';
  const { data: campaignRow, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', asset.campaign_id)
    .limit(1)
    .maybeSingle();
  if (error || !campaignRow?.company_id) return 'forbidden';
  return String(campaignRow.company_id) === String(companyId) ? 'owned' : 'forbidden';
}

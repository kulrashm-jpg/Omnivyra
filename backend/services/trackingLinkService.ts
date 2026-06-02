import { getProfile } from './companyProfileService';

type TrackingLinkInput = {
  companyId: string;
  campaignId: string;
  platform: string;
  contentType: string;
  weekNumber: number;
  dayNumber: number;
  // Creator-side identifiers. All optional and best-effort — when present
  // they ride alongside (never inside) the UTM fields as dedicated omn_*
  // params so they survive the visit → journey → lead attribution flow.
  assetId?: string | null;
  variantId?: string | null;
  strategyId?: string | null;
};

type TrackingLinkResult = {
  url: string;
  utm_params: {
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string;
  };
  // Echoed back so callers/tests can assert the creator params were minted.
  omn_params: {
    omn_asset_id?: string;
    omn_variant_id?: string;
    omn_strategy_id?: string;
  };
};

const normalizeBaseUrl = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
};

export async function generateTrackingLink(
  input: TrackingLinkInput
): Promise<TrackingLinkResult> {
  const profile = await getProfile(input.companyId, { autoRefine: false, languageRefine: true });
  const baseUrl = normalizeBaseUrl(
    profile?.website_url || ''
  );
  if (!baseUrl) {
    throw new Error('Company website_url is required to generate tracking link');
  }

  const utmParams = {
    utm_source: input.platform,
    utm_medium: 'social',
    utm_campaign: input.campaignId,
    utm_content: `${input.contentType}_w${input.weekNumber}_d${input.dayNumber}`,
  };

  // Creator identifiers kept in a SEPARATE namespace. We never overload the
  // utm_* fields — utm_content stays exactly `${type}_wN_dN` as before.
  const clean = (value?: string | null) => {
    const trimmed = String(value ?? '').trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const omnParams: TrackingLinkResult['omn_params'] = {};
  const assetId = clean(input.assetId);
  const variantId = clean(input.variantId);
  const strategyId = clean(input.strategyId);
  if (assetId) omnParams.omn_asset_id = assetId;
  if (variantId) omnParams.omn_variant_id = variantId;
  if (strategyId) omnParams.omn_strategy_id = strategyId;

  const url = new URL(baseUrl);
  Object.entries(utmParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  Object.entries(omnParams).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  return {
    url: url.toString(),
    utm_params: utmParams,
    omn_params: omnParams,
  };
}

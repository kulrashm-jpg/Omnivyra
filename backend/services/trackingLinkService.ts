import { getProfile } from './companyProfileService';

type TrackingLinkInput = {
  companyId: string;
  campaignId: string;
  platform: string;
  contentType: string;
  weekNumber: number;
  dayNumber: number;
};

type TrackingLinkResult = {
  url: string;
  utm_params: {
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string;
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

  const url = new URL(baseUrl);
  Object.entries(utmParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return {
    url: url.toString(),
    utm_params: utmParams,
  };
}

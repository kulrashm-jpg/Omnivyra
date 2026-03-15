/**
 * Campaign Resume Store
 * Saves and restores the last-visited page/state for each campaign.
 * Key: campaign_resume_v1_{campaignId}, TTL: 7 days
 */

const RESUME_KEY_PREFIX = 'campaign_resume_v1_';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CampaignPage =
  | 'campaign-details'
  | 'campaign-calendar'
  | 'campaign-planner'
  | 'campaign-daily-plan';

export interface CampaignResumeState {
  campaignId: string;
  page: CampaignPage;
  params: Record<string, string>;
  savedAt: number;
}

function key(campaignId: string): string {
  return `${RESUME_KEY_PREFIX}${campaignId}`;
}

export function saveCampaignResume(
  campaignId: string,
  page: CampaignPage,
  params: Record<string, string>
): void {
  if (typeof window === 'undefined') return;
  try {
    const state: CampaignResumeState = {
      campaignId,
      page,
      params,
      savedAt: Date.now(),
    };
    localStorage.setItem(key(campaignId), JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota exceeded)
  }
}

export function loadCampaignResume(campaignId: string): CampaignResumeState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(campaignId));
    if (!raw) return null;
    const state = JSON.parse(raw) as CampaignResumeState;
    if (Date.now() - state.savedAt > TTL_MS) {
      localStorage.removeItem(key(campaignId));
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function clearCampaignResume(campaignId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key(campaignId));
  } catch {
    // ignore
  }
}

/**
 * Build the URL to resume a campaign from saved state.
 * Always includes companyId if provided.
 */
export function buildResumeUrl(
  state: CampaignResumeState,
  companyId?: string | null
): string {
  const params = new URLSearchParams(state.params);
  if (companyId) params.set('companyId', companyId);

  const qs = params.toString();
  switch (state.page) {
    case 'campaign-details':
      return `/campaign-details/${state.campaignId}${qs ? `?${qs}` : ''}`;
    case 'campaign-calendar':
      return `/campaign-calendar/${state.campaignId}${qs ? `?${qs}` : ''}`;
    case 'campaign-planner':
      return `/campaign-planner${qs ? `?${qs}` : ''}`;
    case 'campaign-daily-plan':
      return `/campaign-daily-plan/${state.campaignId}${qs ? `?${qs}` : ''}`;
    default:
      return `/campaign-details/${state.campaignId}${companyId ? `?companyId=${companyId}` : ''}`;
  }
}

/**
 * Navigate to a campaign, resuming from last saved state if available.
 * Falls back to campaign-details.
 */
export function navigateToCampaign(
  campaignId: string,
  companyId?: string | null
): void {
  const saved = loadCampaignResume(campaignId);
  if (saved) {
    window.location.href = buildResumeUrl(saved, companyId);
  } else {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    const qs = params.toString();
    window.location.href = `/campaign-details/${campaignId}${qs ? `?${qs}` : ''}`;
  }
}

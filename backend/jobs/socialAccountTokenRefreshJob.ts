/**
 * Social Account Token Refresh Job
 *
 * Runs on the 10-minute cron tick to refresh social_accounts tokens that
 * are within REFRESH_BUFFER_MS of expiry. social_accounts is the single
 * source of truth for tokens since the community_ai_platform_tokens
 * consolidation, so this is the only background refresh job in the system.
 *
 * X access tokens have a 2-hour lifetime; without this proactive job they
 * silently expire between dashboard loads.
 */

import { refreshAllExpiringSocialAccounts } from '../auth/tokenRefresh';

export type SocialAccountTokenRefreshJobResult = {
  companies: number;
  checked: number;
  refreshed: number;
  skipped: number;
  errors: number;
};

export async function runSocialAccountTokenRefreshJob(): Promise<SocialAccountTokenRefreshJobResult> {
  try {
    const result = await refreshAllExpiringSocialAccounts();
    if (result.refreshed > 0 || result.errors > 0) {
      console.log(
        `[socialAccountTokenRefresh] companies=${result.companies} checked=${result.checked} refreshed=${result.refreshed} skipped=${result.skipped} errors=${result.errors}`,
      );
    }
    return result;
  } catch (err: any) {
    console.error('[socialAccountTokenRefresh] job error:', err?.message);
    return { companies: 0, checked: 0, refreshed: 0, skipped: 0, errors: 1 };
  }
}

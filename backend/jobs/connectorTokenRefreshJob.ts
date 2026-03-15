/**
 * Connector Token Refresh Job (G5.4)
 *
 * Runs periodically to refresh Community AI platform tokens before they expire.
 * Uses connectorTokenRefreshService to find and refresh tokens in community_ai_platform_tokens.
 *
 * Schedule: Every 6 hours (or CONNECTOR_TOKEN_REFRESH_INTERVAL_MS env).
 * Run: via cron (backend/scheduler/cron.ts) or manually: runConnectorTokenRefreshJob().
 */

import { runConnectorTokenRefresh } from '../services/connectorTokenRefreshService';

export type ConnectorTokenRefreshJobResult = {
  refreshed: number;
  skipped: number;
  errors: number;
  checked: number;
};

export async function runConnectorTokenRefreshJob(): Promise<ConnectorTokenRefreshJobResult> {
  try {
    const result = await runConnectorTokenRefresh();
    if (result.refreshed > 0 || result.errors > 0) {
      console.log(
        `[connectorTokenRefresh] refreshed=${result.refreshed} skipped=${result.skipped} errors=${result.errors}`
      );
      result.details
        .filter((d) => d.status === 'error')
        .slice(0, 5)
        .forEach((d) =>
          console.warn(`[connectorTokenRefresh] error: ${d.platform} org=${d.org_id}`)
        );
    }
    return {
      refreshed: result.refreshed,
      skipped: result.skipped,
      errors: result.errors,
      checked: result.checked,
    };
  } catch (err: any) {
    console.error('[connectorTokenRefresh] job error:', err?.message);
    return {
      refreshed: 0,
      skipped: 0,
      errors: 1,
      checked: 0,
    };
  }
}

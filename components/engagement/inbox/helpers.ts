/**
 * Inbox helpers — extracted from InboxDashboard.tsx.
 *
 * Pure utilities + types used by the inbox surface. All exports here are
 * standalone (no closure over component state); moving them out of the
 * orchestrator is purely a structural refactor with no behaviour change.
 *
 * Phase 35-A — split helpers from InboxDashboard.tsx.
 */

// =====================================================================
// Constants
// =====================================================================

export const PLATFORM_SYNC_SETTLE_DELAYS_MS = [1500, 3500, 6500] as const;
export const BACKGROUND_PLATFORM_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const BROWSER_DELIVERY_POLL_ATTEMPTS = 6;
export const BROWSER_DELIVERY_POLL_INTERVAL_MS = 1500;

export const EXTENSION_SYNC_PLATFORM_SET = new Set([
  'linkedin',
  'facebook',
  'instagram',
  'x',
  'twitter',
]);

export const SERVER_SYNC_PLATFORM_SET = new Set(['linkedin']);

export const GENERIC_BROWSER_ASSIST_PLATFORM_SET = new Set([
  'facebook',
  'instagram',
  'x',
  'twitter',
]);

// =====================================================================
// Types
// =====================================================================

export type EngagementActionStatus = {
  success?: boolean;
  status?: string;
  confirmed?: boolean;
  platform_id?: string | null;
  error?: string | null;
  dispatch_lease_id?: string | null;
  dispatch_lease_expires_at?: string | null;
  dispatch_acknowledged_at?: string | null;
  claimed?: boolean;
  lease_expired?: boolean;
  acknowledged?: boolean;
};

export type ExtensionCommandPollResult = {
  success?: boolean;
  commandCount?: number;
  dispatchedCount?: number;
  message?: string;
  error?: string;
};

export type PlatformSyncTrustState = {
  status: 'idle' | 'syncing' | 'fresh' | 'warning' | 'failed';
  lastSyncedAt: number | null;
  message: string | null;
};

export type ServerPlatformSyncCommand = {
  id: string;
  platform: string;
  status: string | null;
};

export type ServerPlatformSyncStart = {
  requested_at: string;
  commands: ServerPlatformSyncCommand[];
  unsupported_platforms?: string[];
};

export type ServerPlatformSyncStatus = {
  platforms: Record<string, {
    fresh: boolean;
    latest_thread_update: string | null;
    terminal_action: boolean;
    failed_action: boolean;
    failure_reason?: string | null;
  }>;
};

// =====================================================================
// Async helpers (pure — no component state closure)
// =====================================================================

export async function requestServerPlatformSync(
  organizationId: string,
  platforms: string[]
): Promise<ServerPlatformSyncStart> {
  const response = await fetch('/api/engagement/platform-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ organization_id: organizationId, platforms }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Unable to queue platform inbox sync');
  }
  return payload.data as ServerPlatformSyncStart;
}

export async function readServerPlatformSyncStatus(input: {
  organizationId: string;
  platforms: string[];
  requestedAt: string;
  actionIds: string[];
}): Promise<ServerPlatformSyncStatus> {
  const params = new URLSearchParams({
    organization_id: input.organizationId,
    platforms: input.platforms.join(','),
    since: input.requestedAt,
    action_ids: input.actionIds.join(','),
  });
  const response = await fetch(`/api/engagement/platform-sync?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || 'Unable to verify platform inbox sync');
  }
  return payload.data as ServerPlatformSyncStatus;
}

export async function waitForBrowserActionTerminalStatus(
  organizationId: string,
  actionId: string
): Promise<EngagementActionStatus | null> {
  let latestStatus: EngagementActionStatus | null = null;
  for (let attempt = 0; attempt < BROWSER_DELIVERY_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, BROWSER_DELIVERY_POLL_INTERVAL_MS));
    }
    const statusRes = await fetch(
      `/api/engagement/action-status?organization_id=${encodeURIComponent(organizationId)}&action_id=${encodeURIComponent(actionId)}`,
      { credentials: 'include' }
    );
    const statusJson = (await statusRes.json().catch(() => ({}))) as EngagementActionStatus;
    if (!statusRes.ok || statusJson.success !== true) continue;
    latestStatus = statusJson;
    if (['executed', 'sent_unverified', 'failed', 'skipped', 'blocked'].includes(String(statusJson.status || ''))) {
      return statusJson;
    }
  }
  return latestStatus;
}

export async function cancelUnclaimedQueuedAction(
  organizationId: string,
  actionId: string | null | undefined
): Promise<void> {
  if (!actionId) return;
  await fetch('/api/engagement/cancel-queued', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ organization_id: organizationId, action_id: actionId }),
  }).catch(() => {});
}

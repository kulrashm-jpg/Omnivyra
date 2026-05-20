import { getRpaAccountTier } from './rpaSessionStore';

/**
 * Resolve the caller's account tier for an (organization, platform).
 * Priority:
 *   1. rpa_sessions.account_tier (seeded at save-session time)
 *   2. action row's metadata.account_tier (ad-hoc override)
 *   3. null (unknown)
 *
 * Consumers must treat `null` as "unknown" — the Instagram DM guard
 * rejects unknown + instagram + dm; other (platform, action) pairs
 * continue to allow unknown.
 */
export async function resolveAccountTier(input: {
  organization_id: string;
  platform: string;
  action_metadata?: unknown;
}): Promise<string | null> {
  const platformLc = input.platform.toLowerCase();

  // 1. rpa_sessions table
  const fromSession = await getRpaAccountTier(input.organization_id, platformLc);
  if (fromSession) return fromSession.toLowerCase();

  // 2. action metadata
  if (input.action_metadata && typeof input.action_metadata === 'object') {
    const v = (input.action_metadata as Record<string, unknown>).account_tier;
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }

  return null;
}

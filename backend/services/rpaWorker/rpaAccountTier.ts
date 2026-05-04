import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getRpaAccountTier } from './rpaSessionStore';

/**
 * Resolve the caller's account tier for an (organization, platform).
 * Priority:
 *   1. rpa_sessions.account_tier (seeded at save-session time)
 *   2. platform_tokens.account_type (OAuth-registered tier, if present)
 *   3. action row's metadata.account_tier (ad-hoc override)
 *   4. null (unknown)
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

  // 2. platform_tokens.account_type (best-effort; tolerate missing column)
  try {
    const { data } = await supabase
      .from('platform_tokens')
      .select('account_type')
      .eq('organization_id', input.organization_id)
      .eq('platform', platformLc)
      .limit(1)
      .maybeSingle();
    const tier = (data as { account_type?: string | null } | null)?.account_type;
    if (tier) return String(tier).toLowerCase();
  } catch { /* table / column may not exist; fall through */ }

  // 3. action metadata
  if (input.action_metadata && typeof input.action_metadata === 'object') {
    const v = (input.action_metadata as Record<string, unknown>).account_tier;
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }

  return null;
}

/**
 * Resolve the canonical social_accounts.id for a given (organization, platform).
 *
 * The lock key for X token refresh is unified as `twitter:{account_id}` so
 * that any worker touching the same X identity contends on the same key.
 * This was originally introduced to coordinate the social_accounts refresh
 * path with the (now-removed) connector refresh path; the unified format is
 * preserved for forward compatibility with any future refresh source.
 */

import { supabase } from '../db/supabaseClient';

const X_PLATFORM_ALIASES = ['x', 'twitter'];

/**
 * Find the most recently updated social_accounts row for an X connection
 * within an organization. Returns null if no such row exists — the caller
 * should treat that as "cannot lock; skip refresh" rather than fall back to
 * an org-scoped lock (org-scoped locks defeat the unification goal).
 */
export async function resolveXAccountIdForOrg(
  organizationId: string,
): Promise<string | null> {
  if (!organizationId) return null;

  const { data: row } = await supabase
    .from('social_accounts')
    .select('id')
    .eq('company_id', organizationId)
    .in('platform', X_PLATFORM_ALIASES)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return row?.id ?? null;
}

/**
 * Build the canonical refresh lock key for an X social_accounts row.
 * Centralised here so the format cannot drift between callsites.
 */
export function buildXRefreshLockKey(accountId: string): string {
  return `twitter:${accountId}`;
}

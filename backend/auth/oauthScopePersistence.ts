import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { normalizePlatform } from '../constants/platforms';

export type ScopePersistInput = {
  socialAccountId: string;
  platform: string;
  grantedScopes: string[];
};

function parseScopes(raw: string | string[] | null | undefined, delimiter: RegExp): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return String(raw)
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Normalise the granted-scopes value returned by an OAuth provider into a
 * canonical string[] suitable for storage and snapshotting in consent_records.
 *
 * - LinkedIn / X / Reddit: space-separated string.
 * - Meta (Facebook / Instagram / Threads): comma-separated `scope` string.
 *
 * The OAuth callback is responsible for picking the right shape and passing
 * the array (or raw string + the right shape hint) to persistGrantedScopes().
 */
export function normaliseScopes(
  raw: string | string[] | null | undefined,
  shape: 'space' | 'comma' | 'array',
): string[] {
  if (shape === 'array') {
    return Array.isArray(raw) ? parseScopes(raw, /\s+/) : parseScopes(raw, /\s+/);
  }
  if (shape === 'space') {
    return parseScopes(raw, /\s+/);
  }
  return parseScopes(raw, /,\s*/);
}

export function computeScopeVersionHash(scopes: string[]): string {
  const sorted = [...new Set(scopes.map((s) => s.trim()).filter(Boolean))].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 24);
}

/**
 * Persist actually-granted OAuth scopes onto a social_accounts row. Does NOT
 * overwrite historical snapshots — those live in consent_records — so reading
 * social_accounts.granted_scopes returns the latest grant for that connection.
 *
 * Best-effort: schema-drift safe. If the column does not exist yet (migration
 * not yet applied), logs and returns without throwing so OAuth callbacks
 * cannot be bricked by deploy ordering.
 */
export async function persistGrantedScopes(
  input: ScopePersistInput,
): Promise<{ persisted: boolean; scope_version_hash: string }> {
  const normalisedPlatform = normalizePlatform(input.platform);
  const scopes = [...new Set(input.grantedScopes.map((s) => s.trim()).filter(Boolean))].sort();
  const hash = computeScopeVersionHash(scopes);
  const recordedAt = new Date().toISOString();

  try {
    const { error } = await ownedDbTable('social_accounts')
      .update({
        granted_scopes: scopes,
        granted_scopes_recorded_at: recordedAt,
        scope_version_hash: hash,
      })
      .eq('id', input.socialAccountId);

    if (error) {
      console.warn('[oauthScopePersistence] update failed:', {
        platform: normalisedPlatform,
        socialAccountId: input.socialAccountId,
        error: error.message,
      });
      return { persisted: false, scope_version_hash: hash };
    }
  } catch (err: any) {
    console.warn('[oauthScopePersistence] update threw:', {
      platform: normalisedPlatform,
      socialAccountId: input.socialAccountId,
      error: err?.message,
    });
    return { persisted: false, scope_version_hash: hash };
  }

  return { persisted: true, scope_version_hash: hash };
}

/**
 * Lookup-then-persist convenience for callbacks that don't directly hold the
 * social_accounts row id (e.g. Instagram/Threads, where account rows are
 * created downstream by metaDerivedAccountsService).
 *
 * If platformUserId is omitted, falls back to the most-recent active row for
 * (user, company, platform). This is required for Reddit-style connectors
 * that persist a row with platform_user_id=null at OAuth time.
 */
export async function persistGrantedScopesByPlatformUser(input: {
  userId: string;
  companyId: string | null;
  platform: string;
  platformUserId?: string | null;
  grantedScopes: string[];
}): Promise<{ persisted: boolean; social_account_id: string | null }> {
  const platform = normalizePlatform(input.platform);
  let query = ownedDbTable('social_accounts')
    .select('id')
    .eq('user_id', input.userId)
    .eq('platform', platform)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (input.platformUserId) {
    query = query.eq('platform_user_id', input.platformUserId);
  }
  if (input.companyId) {
    query = query.eq('company_id', input.companyId);
  } else {
    query = query.is('company_id', null);
  }
  const { data, error } = await query.maybeSingle();
  if (error || !data?.id) {
    return { persisted: false, social_account_id: null };
  }
  const result = await persistGrantedScopes({
    socialAccountId: data.id,
    platform,
    grantedScopes: input.grantedScopes,
  });
  return { persisted: result.persisted, social_account_id: data.id };
}

import { supabase } from '../db/supabaseClient';

type CommunityAiPlatformPolicy = {
  execution_enabled: boolean;
  auto_rules_enabled: boolean;
  require_human_approval: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

const DEFAULT_POLICY: CommunityAiPlatformPolicy = {
  execution_enabled: true,
  auto_rules_enabled: true,
  require_human_approval: false,
  updated_at: null,
  updated_by: null,
};

/**
 * Fail-closed policy used ONLY when the policy store cannot be read (the
 * query returned an error or threw). An unreadable policy must never
 * authorise automatic execution: execution is off, auto rules are off and
 * human approval is required. This is distinct from DEFAULT_POLICY, which
 * applies when the read succeeds and no policy row is configured (that
 * default is an owner decision and is deliberately left unchanged here).
 *
 * Not cached, so the next call retries the read.
 */
const UNREADABLE_POLICY: CommunityAiPlatformPolicy = {
  execution_enabled: false,
  auto_rules_enabled: false,
  require_human_approval: true,
  updated_at: null,
  updated_by: null,
};

const failClosed = (reason: 'query_error' | 'query_threw', code: unknown) => {
  // Log the reason and the driver error code only: no message, no payload.
  console.warn('COMMUNITY_AI_POLICY_UNREADABLE_FAIL_CLOSED', {
    reason,
    code: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
  });
  return { ...UNREADABLE_POLICY };
};

/** Test-only: clear the in-process policy cache. */
export const __resetCommunityAiPlatformPolicyCacheForTests = () => {
  cachedPolicy = null;
  cacheExpiresAt = 0;
};

const CACHE_TTL_MS = 60_000;
let cachedPolicy: CommunityAiPlatformPolicy | null = null;
let cacheExpiresAt = 0;

export const getCommunityAiPlatformPolicy = async (): Promise<CommunityAiPlatformPolicy> => {
  const now = Date.now();
  if (cachedPolicy && cacheExpiresAt > now) {
    return cachedPolicy;
  }

  try {
    const { data, error } = await supabase
      .from('community_ai_platform_policy')
      .select('execution_enabled, auto_rules_enabled, require_human_approval, updated_at, updated_by')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      return failClosed('query_error', (error as { code?: unknown })?.code);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      cachedPolicy = {
        execution_enabled:
          typeof row.execution_enabled === 'boolean'
            ? row.execution_enabled
            : DEFAULT_POLICY.execution_enabled,
        auto_rules_enabled:
          typeof row.auto_rules_enabled === 'boolean'
            ? row.auto_rules_enabled
            : DEFAULT_POLICY.auto_rules_enabled,
        require_human_approval:
          typeof row.require_human_approval === 'boolean'
            ? row.require_human_approval
            : DEFAULT_POLICY.require_human_approval,
        updated_at: row.updated_at ?? null,
        updated_by: row.updated_by ?? null,
      };
      cacheExpiresAt = now + CACHE_TTL_MS;
      return cachedPolicy;
    }
  } catch (error) {
    return failClosed('query_threw', (error as { code?: unknown })?.code);
  }

  // Read succeeded and no policy row is configured: DEFAULT_POLICY applies
  // (unchanged; see UNREADABLE_POLICY for the error case).
  cachedPolicy = DEFAULT_POLICY;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedPolicy;
};

export type { CommunityAiPlatformPolicy };

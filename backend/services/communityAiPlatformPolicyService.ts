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

    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) {
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
    console.debug('COMMUNITY_AI_POLICY_FETCH_FAILED', error);
  }

  cachedPolicy = DEFAULT_POLICY;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedPolicy;
};

export type { CommunityAiPlatformPolicy };

import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  AUTOMATABLE_ACTION_TYPES,
  DEFAULT_DAILY_LIMIT,
  isAutomatableActionType,
  isConfidenceFloor,
  type AutomatableActionType,
  type ConfidenceFloor,
} from './automationConstants';

/**
 * Per-org automation configuration access layer. Reads are cached
 * in-process for 30 seconds so the decision engine doesn't hit the DB
 * on every call; writes invalidate the cache entry.
 *
 * NO caller outside /api/automation/config.ts should be writing this
 * table. The service layer is read-only from here.
 */

export type AutomationConfig = {
  organization_id: string;
  enabled: boolean;
  auto_reply_enabled: boolean;
  auto_dm_enabled: boolean;
  min_confidence_level: ConfidenceFloor;
  allowed_actions: AutomatableActionType[];
  daily_limit: number;
  updated_at: string | null;
};

const CACHE_TTL_MS = 30 * 1000;
const cache: Map<string, { value: AutomationConfig; at: number }> = new Map();

export function invalidateConfigCache(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/**
 * Default config for an org that has never saved a row. Safe by
 * construction: enabled=false, no allowed actions override, confidence
 * floor = high.
 */
export function defaultAutomationConfig(orgId: string): AutomationConfig {
  return {
    organization_id: orgId,
    enabled: false,
    auto_reply_enabled: false,
    auto_dm_enabled: false,
    min_confidence_level: 'high',
    allowed_actions: [],
    daily_limit: DEFAULT_DAILY_LIMIT,
    updated_at: null,
  };
}

function normalizeAllowedActions(v: unknown): AutomatableActionType[] {
  if (!Array.isArray(v)) return [];
  const out: AutomatableActionType[] = [];
  for (const raw of v) {
    const s = (raw ?? '').toString().toLowerCase().trim();
    if (isAutomatableActionType(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function normalizeConfidenceFloor(v: unknown): ConfidenceFloor {
  const s = (v ?? '').toString().toLowerCase().trim();
  return isConfidenceFloor(s) ? s : 'high';
}

export async function getAutomationConfig(orgId: string): Promise<AutomationConfig> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const { data } = await supabase
      .from('automation_config')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!data) {
      const d = defaultAutomationConfig(orgId);
      cache.set(orgId, { value: d, at: Date.now() });
      return d;
    }
    const config: AutomationConfig = {
      organization_id: orgId,
      enabled: Boolean((data as any).enabled),
      auto_reply_enabled: Boolean((data as any).auto_reply_enabled),
      auto_dm_enabled: Boolean((data as any).auto_dm_enabled),
      min_confidence_level: normalizeConfidenceFloor((data as any).min_confidence_level),
      allowed_actions: normalizeAllowedActions((data as any).allowed_actions),
      daily_limit: Number((data as any).daily_limit ?? DEFAULT_DAILY_LIMIT),
      updated_at: (data as any).updated_at ?? null,
    };
    cache.set(orgId, { value: config, at: Date.now() });
    return config;
  } catch (err: any) {
    console.warn('[automationConfigStore] read failed, returning safe default:', err?.message || err);
    // Fail closed: any read failure → disabled config. The decision
    // engine will block every request until the store is healthy.
    const d = defaultAutomationConfig(orgId);
    return d;
  }
}

export type AutomationConfigPatch = {
  enabled?: boolean;
  auto_reply_enabled?: boolean;
  auto_dm_enabled?: boolean;
  min_confidence_level?: string;
  allowed_actions?: string[];
  daily_limit?: number;
};

/**
 * Upsert the org's config row. Every field is optional; missing fields
 * keep their prior value (or the default on first write).
 *
 * Safety on write:
 *   · allowed_actions is narrowed to the automatable whitelist BEFORE
 *     reaching the DB (the CHECK constraint would reject it anyway).
 *   · min_confidence_level falls back to 'high' on invalid input.
 *   · daily_limit is clamped to >= 0.
 */
export async function upsertAutomationConfig(
  orgId: string,
  patch: AutomationConfigPatch,
): Promise<{ ok: boolean; config?: AutomationConfig; error?: string }> {
  try {
    const current = await getAutomationConfig(orgId);

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };

    if (typeof patch.enabled === 'boolean') payload.enabled = patch.enabled;
    if (typeof patch.auto_reply_enabled === 'boolean') payload.auto_reply_enabled = patch.auto_reply_enabled;
    if (typeof patch.auto_dm_enabled === 'boolean') payload.auto_dm_enabled = patch.auto_dm_enabled;
    if (patch.min_confidence_level !== undefined) {
      payload.min_confidence_level = normalizeConfidenceFloor(patch.min_confidence_level);
    }
    if (patch.allowed_actions !== undefined) {
      payload.allowed_actions = normalizeAllowedActions(patch.allowed_actions);
    }
    if (typeof patch.daily_limit === 'number') {
      payload.daily_limit = Math.max(0, Math.floor(patch.daily_limit));
    }

    // First write for this org needs created_at; subsequent rows already
    // have it. Using upsert with the table's default NOW() is correct.
    const { error } = await supabase
      .from('automation_config')
      .upsert(payload, { onConflict: 'organization_id' });

    if (error) {
      return { ok: false, error: error.message };
    }
    invalidateConfigCache(orgId);
    const fresh = await getAutomationConfig(orgId);
    // Cross-check: if the caller tried to enable something without the
    // matching per-action toggle, we don't silently activate it — the
    // per-action boolean must be explicitly set.
    void current;
    return { ok: true, config: fresh };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'UPSERT_FAILED' };
  }
}

export function allowedActionsFromConfig(config: AutomationConfig): AutomatableActionType[] {
  // Intersect the org's configured whitelist with the per-action
  // toggles AND the global automatable list. All three must agree.
  const base = AUTOMATABLE_ACTION_TYPES.filter((a) => {
    if (!config.allowed_actions.includes(a)) return false;
    if (a === 'reply' && !config.auto_reply_enabled) return false;
    if (a === 'dm'    && !config.auto_dm_enabled)    return false;
    return true;
  });
  return base as AutomatableActionType[];
}

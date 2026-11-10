import { supabase } from '../db/supabaseClient';

/**
 * Prompt 3 (OD-1) — the community execution policy is TENANT-SCOPED and fails closed.
 *
 * The decision is made in the database by `community_execution_policy_decision(p_org,
 * p_tenant)` (migration 20270126000000), the same function the claim RPCs call, so the TS
 * gates and the claim boundary can never disagree about what a policy means. In order:
 *
 *   POLICY_SCOPE_INVALID      no org / tenant, or tenant ≠ org
 *   PLATFORM_KILL_SWITCH      the platform row (organization_id IS NULL) disables execution
 *   POLICY_MISSING            no row for this tenant, or no platform row — there is NO global fallback
 *   POLICY_AMBIGUOUS          more than one row for this tenant
 *   POLICY_TENANT_MISMATCH    the row belongs to another tenant
 *   POLICY_MALFORMED          a flag is null
 *   POLICY_EXECUTION_DISABLED the tenant's own row disables execution
 *
 * Here, additionally: POLICY_UNREADABLE (the RPC errored, threw, or returned a shape that
 * is not a decision). No row is ever auto-created, and no default ever allows execution.
 *
 * Cache: per `${organizationId}:${tenantId}`, up to 60 s, DEFINITE results only (an allow
 * or a refusal code the database returned). Unreadable and scope-invalid results are never
 * cached, so the next call reads again. The claim RPCs are authoritative; this cache only
 * lets the pre-claim gates avoid a read per action.
 */

export type CommunityExecutionPolicyScope = { organizationId: string; tenantId: string };

export type CommunityExecutionPolicy = {
  execution_enabled: true;
  auto_rules_enabled: boolean;
};

export type CommunityExecutionPolicyDecision =
  | { ok: true; policy: CommunityExecutionPolicy; version: string | null }
  | { ok: false; code: string };

/** The refusal codes the decision function returns (anything else is unreadable). */
export const COMMUNITY_POLICY_REFUSAL_CODES = [
  'POLICY_SCOPE_INVALID',
  'PLATFORM_KILL_SWITCH',
  'POLICY_MISSING',
  'POLICY_AMBIGUOUS',
  'POLICY_TENANT_MISMATCH',
  'POLICY_MALFORMED',
  'POLICY_EXECUTION_DISABLED',
] as const;

export const COMMUNITY_POLICY_UNREADABLE = 'POLICY_UNREADABLE';

const POLICY_DECISION_RPC = 'community_execution_policy_decision';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 2_000;

type CacheEntry = { value: CommunityExecutionPolicyDecision; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const cacheKey = (scope: CommunityExecutionPolicyScope) => `${scope.organizationId}:${scope.tenantId}`;

const unreadable = (reason: string, code: unknown): CommunityExecutionPolicyDecision => {
  // Reason and driver code only: no message, no payload.
  console.warn('COMMUNITY_AI_POLICY_UNREADABLE_FAIL_CLOSED', {
    reason,
    code: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
  });
  return { ok: false, code: COMMUNITY_POLICY_UNREADABLE };
};

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Map one RPC row to a decision; null when the row is not a well-formed decision. */
function toDecision(row: unknown): CommunityExecutionPolicyDecision | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { allowed?: unknown; code?: unknown; auto_rules_enabled?: unknown; policy_version?: unknown };
  const version = r.policy_version == null ? null : String(r.policy_version);
  if (r.allowed === true) {
    if (r.code != null) return null;
    if (typeof r.auto_rules_enabled !== 'boolean') return null;
    // Anything but an explicit true is not an authorisation to automate.
    return { ok: true, policy: { execution_enabled: true, auto_rules_enabled: r.auto_rules_enabled === true }, version };
  }
  if (r.allowed === false) {
    if (typeof r.code !== 'string' || !(COMMUNITY_POLICY_REFUSAL_CODES as readonly string[]).includes(r.code)) return null;
    return { ok: false, code: r.code };
  }
  return null;
}

/**
 * The execution policy of exactly one tenant. Never throws; every failure is a refusal.
 */
export const getCommunityExecutionPolicy = async (
  scope: CommunityExecutionPolicyScope,
): Promise<CommunityExecutionPolicyDecision> => {
  const organizationId = scope?.organizationId;
  const tenantId = scope?.tenantId;
  // Community scope is (org, tenant) with tenant = org (pages/api/community-ai/utils.ts).
  // Refused locally, not read and not cached.
  if (!nonEmpty(organizationId) || !nonEmpty(tenantId) || organizationId !== tenantId) {
    return { ok: false, code: 'POLICY_SCOPE_INVALID' };
  }

  const key = cacheKey({ organizationId, tenantId });
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (hit) cache.delete(key);

  let decision: CommunityExecutionPolicyDecision | null;
  try {
    const { data, error } = await supabase.rpc(POLICY_DECISION_RPC, { p_org: organizationId, p_tenant: tenantId });
    if (error) return unreadable('rpc_error', (error as { code?: unknown })?.code);
    const rows = Array.isArray(data) ? data : data == null ? [] : [data];
    if (rows.length !== 1) return unreadable('rpc_row_count', rows.length);
    decision = toDecision(rows[0]);
  } catch (error) {
    return unreadable('rpc_threw', (error as { code?: unknown })?.code);
  }
  if (!decision) return unreadable('rpc_malformed', null);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value: decision, expiresAt: now + CACHE_TTL_MS });
  return decision;
};

/** Drop cached decisions: one tenant, or all (a platform-row change affects every tenant). */
export const invalidateCommunityExecutionPolicyCache = (organizationId?: string | null) => {
  if (!organizationId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${organizationId}:`)) cache.delete(key);
  }
};

/** Test-only: clear the in-process policy cache. */
export const __resetCommunityAiPlatformPolicyCacheForTests = () => {
  cache.clear();
};

// ── Raw policy rows (super-admin route only) ─────────────────────────────────

export type CommunityPolicyRow = {
  id: string;
  organization_id: string | null;
  tenant_id: string | null;
  execution_enabled: boolean | null;
  auto_rules_enabled: boolean | null;
  require_human_approval: boolean | null;
  updated_at: string | null;
  updated_by: string | null;
  [column: string]: unknown;
};

export type CommunityPolicyRowRead =
  | { ok: true; row: CommunityPolicyRow | null }
  | { ok: false; code: 'POLICY_UNREADABLE' | 'POLICY_AMBIGUOUS' };

/**
 * Read the platform row (`organizationId` null) or one tenant's row, for the super-admin
 * policy route to display and edit. Never used to authorise execution (that is
 * getCommunityExecutionPolicy), never cached, never throws.
 */
export const readCommunityPolicyRow = async (
  organizationId: string | null,
): Promise<CommunityPolicyRowRead> => {
  try {
    const base = supabase.from('community_ai_platform_policy').select('*');
    const q = organizationId ? base.eq('organization_id', organizationId) : base.is('organization_id', null);
    const { data, error } = await q.limit(2);
    if (error) return { ok: false, code: 'POLICY_UNREADABLE' };
    const rows = Array.isArray(data) ? data : data == null ? [] : [data];
    if (rows.length > 1) return { ok: false, code: 'POLICY_AMBIGUOUS' };
    return { ok: true, row: (rows[0] as CommunityPolicyRow | undefined) ?? null };
  } catch {
    return { ok: false, code: 'POLICY_UNREADABLE' };
  }
};

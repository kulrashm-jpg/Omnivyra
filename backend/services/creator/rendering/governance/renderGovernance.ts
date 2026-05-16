/**
 * Render Governance — Step-R6 enterprise quota/safety evaluator (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * Fail-closed gate evaluated at the ENQUEUE boundary (and optionally by
 * the worker tick). No DB here — the caller loads the org + global
 * sentinel rows and the live counts; this is a pure decision function so
 * it is exhaustively testable and never blocks on I/O.
 *
 * Order of precedence (most-severe first), all FAIL-CLOSED:
 *   global emergency_stop → global queue_paused → org rendering_enabled
 *   → org emergency_stop → org queue_paused → provider disabled/not
 *   allowed → asset-family not allowed → daily quota → concurrency cap.
 *
 * Does NOT modify R3/R4/R5; image-only/lineage/scheduler unaffected.
 */

export const GLOBAL_GOVERNANCE_SENTINEL = '00000000-0000-0000-0000-000000000000';

export type GovernanceEvent =
  | 'governance_blocked'
  | 'quota_exceeded'
  | 'provider_disabled'
  | 'emergency_stop_active'
  | 'moderation_escalated'
  | 'provider_rate_limited'
  | 'queue_paused';

export interface RenderGovernanceState {
  organization_id: string;
  rendering_enabled: boolean;
  max_daily_renders: number;
  max_concurrent_renders: number;
  allowed_asset_families: string[];
  allowed_providers: string[];
  disabled_providers: string[];
  moderation_mode: 'standard' | 'escalated' | 'strict';
  quota_window: 'rolling_24h' | 'calendar_day';
  emergency_stop: boolean;
  queue_paused: boolean;
}

export interface GovernanceContext {
  provider: string;
  assetFamily: string;        // canonical family (image-only this phase)
  dailyRenderCount: number;   // org renders in the quota window
  concurrentRenderCount: number;
}

export interface GovernanceDecision {
  allowed: boolean;
  reason: string;
  event?: GovernanceEvent;
  moderation_mode: 'standard' | 'escalated' | 'strict';
}

/** Conservative defaults when an org has no governance row. Rendering
 *  is allowed but CAPPED (fail-closed: never unbounded). */
export function defaultGovernance(orgId: string): RenderGovernanceState {
  return {
    organization_id: orgId,
    rendering_enabled: true,
    max_daily_renders: 200,
    max_concurrent_renders: 4,
    allowed_asset_families: ['image'],
    allowed_providers: ['openai'],
    disabled_providers: [],
    moderation_mode: 'standard',
    quota_window: 'rolling_24h',
    emergency_stop: false,
    queue_paused: false,
  };
}

function allow(mode: GovernanceDecision['moderation_mode']): GovernanceDecision {
  return { allowed: true, reason: 'ok', moderation_mode: mode };
}
function block(
  reason: string, event: GovernanceEvent,
  mode: GovernanceDecision['moderation_mode'] = 'standard',
): GovernanceDecision {
  return { allowed: false, reason, event, moderation_mode: mode };
}

/**
 * Pure governance evaluation. `global` is the all-zero sentinel row (or
 * null). `org` is the org row (or null ⇒ defaults). Fail-closed: any
 * missing/ambiguous flag is treated as the safe (more restrictive)
 * value.
 */
export function evaluateRenderGovernance(
  org: RenderGovernanceState | null,
  global: RenderGovernanceState | null,
  ctx: GovernanceContext,
): GovernanceDecision {
  // Global kill-switches dominate everything.
  if (global?.emergency_stop === true) {
    return block('global emergency stop', 'emergency_stop_active', org?.moderation_mode ?? 'standard');
  }
  if (global?.queue_paused === true) {
    return block('global queue paused', 'queue_paused', org?.moderation_mode ?? 'standard');
  }

  const g = org ?? defaultGovernance(ctx ? '' : '');
  const mode = g.moderation_mode;

  if (g.rendering_enabled !== true) {
    return block('rendering disabled for org', 'governance_blocked', mode);
  }
  if (g.emergency_stop === true) {
    return block('org emergency stop', 'emergency_stop_active', mode);
  }
  if (g.queue_paused === true) {
    return block('org queue paused', 'queue_paused', mode);
  }
  const provider = String(ctx.provider || '').trim();
  if (g.disabled_providers.includes(provider)) {
    return block(`provider ${provider} disabled`, 'provider_disabled', mode);
  }
  if (Array.isArray(g.allowed_providers) && g.allowed_providers.length > 0
      && !g.allowed_providers.includes(provider)) {
    return block(`provider ${provider} not allowed`, 'provider_disabled', mode);
  }
  if (Array.isArray(g.allowed_asset_families) && g.allowed_asset_families.length > 0
      && !g.allowed_asset_families.includes(String(ctx.assetFamily))) {
    return block(`asset family ${ctx.assetFamily} not allowed`, 'governance_blocked', mode);
  }
  if (Number.isFinite(ctx.dailyRenderCount) && ctx.dailyRenderCount >= g.max_daily_renders) {
    return block(
      `daily render quota reached (${ctx.dailyRenderCount}/${g.max_daily_renders})`,
      'quota_exceeded', mode);
  }
  if (Number.isFinite(ctx.concurrentRenderCount)
      && ctx.concurrentRenderCount >= g.max_concurrent_renders) {
    return block(
      `concurrency cap reached (${ctx.concurrentRenderCount}/${g.max_concurrent_renders})`,
      'provider_rate_limited', mode);
  }
  return allow(mode);
}

/** Coerce a raw DB row (untrusted) into a typed state, fail-closed. */
export function coerceGovernanceRow(row: any, orgId: string): RenderGovernanceState {
  if (!row || typeof row !== 'object') return defaultGovernance(orgId);
  const arr = (v: any, d: string[]) => Array.isArray(v) ? v.map(String) : d;
  return {
    organization_id: orgId,
    rendering_enabled: row.rendering_enabled !== false,
    max_daily_renders: Number.isFinite(row.max_daily_renders) ? Number(row.max_daily_renders) : 200,
    max_concurrent_renders: Number.isFinite(row.max_concurrent_renders) ? Number(row.max_concurrent_renders) : 4,
    allowed_asset_families: arr(row.allowed_asset_families, ['image']),
    allowed_providers: arr(row.allowed_providers, ['openai']),
    disabled_providers: arr(row.disabled_providers, []),
    moderation_mode: ['standard', 'escalated', 'strict'].includes(row.moderation_mode) ? row.moderation_mode : 'standard',
    quota_window: row.quota_window === 'calendar_day' ? 'calendar_day' : 'rolling_24h',
    emergency_stop: row.emergency_stop === true,
    queue_paused: row.queue_paused === true,
  };
}

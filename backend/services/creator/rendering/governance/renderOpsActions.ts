/**
 * Render Ops Actions — Step-R7 pure operator-action builders.
 * ──────────────────────────────────────────────────────────────────────────
 * PURE. The ops console endpoint composes these with DB I/O. Every
 * builder is fail-closed: unknown/garbage input ⇒ a rejected decision
 * (no patch), never a silent unsafe write. NO immutable-lineage
 * mutation is ever produced (only governance config / provider config /
 * mutable queue state). Deterministic; no clock/RNG.
 */

export type OpsAction =
  | 'governance.set' | 'provider.disable' | 'provider.maintenance'
  | 'provider.priority' | 'queue.retry' | 'queue.cancel';

export interface OpsDecision<T = Record<string, unknown>> {
  ok: boolean;
  outcome: 'applied' | 'rejected' | 'noop';
  patch: T | null;
  reason?: string;
}

const QUEUE_TERMINAL = new Set(['completed', 'cancelled']);
const GOV_BOOL = ['rendering_enabled', 'emergency_stop', 'queue_paused'] as const;
const GOV_INT = ['max_daily_renders', 'max_concurrent_renders'] as const;
const GOV_ARR = ['allowed_providers', 'allowed_asset_families', 'disabled_providers'] as const;
const MOD_MODES = new Set(['standard', 'escalated', 'strict']);

/**
 * PHASE-3 governance mutation → a SAFE, whitelisted patch. Only known
 * fields; booleans must be real booleans; ints clamped ≥ 0; arrays
 * coerced to string[]; moderation_mode validated. Unknown keys are
 * dropped (not an error). Empty effective patch ⇒ noop.
 */
export function buildGovernancePatch(input: unknown): OpsDecision {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, outcome: 'rejected', patch: null, reason: 'invalid_input' };
  }
  const src = input as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of GOV_BOOL) {
    if (k in src) {
      if (typeof src[k] !== 'boolean') return { ok: false, outcome: 'rejected', patch: null, reason: `${k}_not_boolean` };
      patch[k] = src[k];
    }
  }
  for (const k of GOV_INT) {
    if (k in src) {
      const n = Number(src[k]);
      if (!Number.isFinite(n) || n < 0) return { ok: false, outcome: 'rejected', patch: null, reason: `${k}_invalid` };
      patch[k] = Math.trunc(n);
    }
  }
  for (const k of GOV_ARR) {
    if (k in src) {
      if (!Array.isArray(src[k])) return { ok: false, outcome: 'rejected', patch: null, reason: `${k}_not_array` };
      patch[k] = (src[k] as unknown[]).map((x) => String(x)).filter(Boolean);
    }
  }
  if ('moderation_mode' in src) {
    if (!MOD_MODES.has(String(src.moderation_mode))) {
      return { ok: false, outcome: 'rejected', patch: null, reason: 'moderation_mode_invalid' };
    }
    patch.moderation_mode = src.moderation_mode;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, outcome: 'noop', patch: null, reason: 'no_known_fields' };
  }
  return { ok: true, outcome: 'applied', patch };
}

/**
 * PHASE-4 provider control → creator_render_provider patch. disable ⇒
 * circuit_open; maintenance ⇒ maintenance; priority ⇒ clamped weight.
 */
export function buildProviderPatch(
  action: 'provider.disable' | 'provider.maintenance' | 'provider.priority',
  body: Record<string, unknown>,
): OpsDecision {
  const provider = String(body.provider_key || '').trim();
  if (!provider) return { ok: false, outcome: 'rejected', patch: null, reason: 'provider_required' };
  if (action === 'provider.disable') {
    return { ok: true, outcome: 'applied', patch: { health_state: 'circuit_open' } };
  }
  if (action === 'provider.maintenance') {
    return { ok: true, outcome: 'applied', patch: { health_state: 'maintenance' } };
  }
  // priority
  const w = Number(body.priority_weight);
  if (!Number.isFinite(w) || w < 0 || w > 1000) {
    return { ok: false, outcome: 'rejected', patch: null, reason: 'priority_weight_invalid' };
  }
  return { ok: true, outcome: 'applied', patch: { priority_weight: Math.trunc(w) } };
}

/**
 * PHASE-2/6 queue recovery. retry ⇒ ONLY a `failed` job → retry_scheduled
 * (operational re-attempt; immutable lineage untouched). cancel ⇒ any
 * NON-terminal job → cancelled. Anything else is rejected fail-closed.
 */
export function classifyQueueAction(
  action: 'queue.retry' | 'queue.cancel',
  currentState: string,
  nowIso: string,
): OpsDecision {
  const st = String(currentState || '');
  if (action === 'queue.cancel') {
    if (QUEUE_TERMINAL.has(st)) {
      return { ok: false, outcome: 'rejected', patch: null, reason: `terminal_${st}` };
    }
    return { ok: true, outcome: 'applied', patch: { queue_state: 'cancelled', lease_owner: null } };
  }
  // queue.retry
  if (st !== 'failed') {
    return { ok: false, outcome: 'rejected', patch: null, reason: `not_retryable_${st}` };
  }
  return {
    ok: true, outcome: 'applied',
    patch: { queue_state: 'retry_scheduled', next_retry_at: nowIso, last_error: null },
  };
}

/** Immutable audit row shape (endpoint inserts; never updates). */
export function buildOpsAuditRow(
  actor: string, action: OpsAction, target: string | null,
  outcome: 'applied' | 'rejected' | 'noop', payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    actor: String(actor || 'unknown'),
    action, target: target ? String(target) : null,
    outcome, payload: payload && typeof payload === 'object' ? payload : {},
  };
}

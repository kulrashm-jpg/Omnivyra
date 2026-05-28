/**
 * Phase 27B.6 — Production Runtime Rollout Stage Governor.
 *
 * Stages the production runtime activation across discrete safety
 * checkpoints. Each stage is more permissive than the prior one, and
 * forward transitions are validated to forbid unsafe jumps (e.g.
 * `disabled` → `full_runtime_live`). Downgrades (rollback) are
 * permitted from any stage.
 *
 * STAGES:
 *   0  disabled                    — no production runtime
 *   1  shadow_only                 — runtime mirrors but cannot publish
 *   2  replay_audit_only           — runtime audits replay safety, no publish
 *   3  publish_disabled            — runtime active, publish hooks no-op
 *   4  single_provider_live        — ONE provider on allowlist may publish
 *   5  staged_provider_rollout     — multi-provider, capped by allowlist
 *   6  full_runtime_live           — all whitelisted providers active
 *
 * Env: PRODUCTION_RUNTIME_ROLLOUT_STAGE=<stage_name>
 *
 * SCOPE: stage validation + transition rules ONLY. The governor does
 * NOT mutate runtime state — callers read the stage, ask whether a
 * transition is legal, and the boot/CI surfaces respect the verdict.
 */

// ────────────────────────────────────────────────────────────────────
// Stage definition
// ────────────────────────────────────────────────────────────────────

export type ProductionRolloutStage =
  | 'disabled'
  | 'shadow_only'
  | 'replay_audit_only'
  | 'publish_disabled'
  | 'single_provider_live'
  | 'staged_provider_rollout'
  | 'full_runtime_live';

export const STAGE_ORDINAL: Record<ProductionRolloutStage, number> = {
  disabled: 0,
  shadow_only: 1,
  replay_audit_only: 2,
  publish_disabled: 3,
  single_provider_live: 4,
  staged_provider_rollout: 5,
  full_runtime_live: 6,
};

export const ALL_STAGES: ReadonlyArray<ProductionRolloutStage> = [
  'disabled', 'shadow_only', 'replay_audit_only', 'publish_disabled',
  'single_provider_live', 'staged_provider_rollout', 'full_runtime_live',
];

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RolloutGovernorTelemetryEvent =
  | 'rollout_stage_set'
  | 'rollout_stage_transition_allowed'
  | 'rollout_stage_transition_refused'
  | 'rollout_stage_downgrade'
  | 'rollout_stage_freeze_recommended';

export interface RolloutGovernorTelemetrySink {
  emit(event: RolloutGovernorTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RolloutGovernorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'rollout_stage_transition_refused' || event === 'rollout_stage_freeze_recommended') {
        console.warn(`[rollout_governor] ${line}`);
      } else {
        console.log(`[rollout_governor] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class RolloutGovernorError extends Error {
  constructor(
    public readonly code:
      | 'UNKNOWN_STAGE'
      | 'FORBIDDEN_TRANSITION'
      | 'PROVIDER_STAGE_MISMATCH'
      | 'FROZEN',
    message: string,
  ) {
    super(`[RolloutGovernor] ${code}: ${message}`);
    this.name = 'RolloutGovernorError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Governor
// ────────────────────────────────────────────────────────────────────

export interface ProductionRuntimeRolloutGovernorOpts {
  /** Optional initial stage override (defaults to env). */
  initialStage?: ProductionRolloutStage;
  telemetry?: RolloutGovernorTelemetrySink;
}

export class ProductionRuntimeRolloutGovernor {
  private currentStage: ProductionRolloutStage;
  private frozen = false;
  private freezeReason: string | null = null;
  private readonly telemetry: RolloutGovernorTelemetrySink;
  private readonly transitions: Array<{
    fromStage: ProductionRolloutStage;
    toStage: ProductionRolloutStage;
    direction: 'forward' | 'downgrade' | 'same';
    atIso: string;
  }> = [];

  constructor(opts?: ProductionRuntimeRolloutGovernorOpts) {
    this.telemetry = opts?.telemetry ?? defaultTelemetrySink;
    this.currentStage = opts?.initialStage ?? parseStage(process.env.PRODUCTION_RUNTIME_ROLLOUT_STAGE);
    this.telemetry.emit('rollout_stage_set', { stage: this.currentStage });
  }

  getStage(): ProductionRolloutStage {
    return this.currentStage;
  }

  isFrozen(): { frozen: boolean; reason: string | null } {
    return { frozen: this.frozen, reason: this.freezeReason };
  }

  /**
   * Validate whether a transition is legal.
   *
   * RULES:
   *   - Forward transitions MUST advance ONE stage at a time
   *     (no skipping levels). This forbids `disabled` → `full_runtime_live`.
   *   - Downgrades (rollback) to ANY lower stage are always allowed.
   *   - Same-stage "transitions" are no-ops but allowed.
   *   - When frozen, only downgrades are allowed.
   */
  validateTransition(toStage: ProductionRolloutStage): {
    allowed: boolean;
    direction: 'forward' | 'downgrade' | 'same';
    reason: string;
  } {
    if (!ALL_STAGES.includes(toStage)) {
      return { allowed: false, direction: 'same', reason: `unknown stage '${toStage}'` };
    }
    const fromOrdinal = STAGE_ORDINAL[this.currentStage];
    const toOrdinal = STAGE_ORDINAL[toStage];

    if (fromOrdinal === toOrdinal) {
      return { allowed: true, direction: 'same', reason: 'same stage' };
    }
    if (toOrdinal < fromOrdinal) {
      // Downgrades always allowed (rollback-safe).
      return { allowed: true, direction: 'downgrade', reason: 'rollback-safe downgrade' };
    }
    // Forward transition
    if (this.frozen) {
      return {
        allowed: false,
        direction: 'forward',
        reason: `rollout frozen: ${this.freezeReason ?? 'no reason recorded'}`,
      };
    }
    if (toOrdinal - fromOrdinal > 1) {
      return {
        allowed: false,
        direction: 'forward',
        reason: `forbidden jump: '${this.currentStage}' → '${toStage}' (skip)`,
      };
    }
    return { allowed: true, direction: 'forward', reason: 'one-step advance' };
  }

  /**
   * Apply a transition. Throws RolloutGovernorError on illegal transitions.
   */
  applyTransition(toStage: ProductionRolloutStage): {
    fromStage: ProductionRolloutStage;
    toStage: ProductionRolloutStage;
    direction: 'forward' | 'downgrade' | 'same';
  } {
    const verdict = this.validateTransition(toStage);
    if (!verdict.allowed) {
      this.telemetry.emit('rollout_stage_transition_refused', {
        fromStage: this.currentStage,
        toStage,
        reason: verdict.reason,
      });
      const code = verdict.reason.includes('frozen') ? 'FROZEN' : 'FORBIDDEN_TRANSITION';
      throw new RolloutGovernorError(code, verdict.reason);
    }
    const fromStage = this.currentStage;
    this.currentStage = toStage;
    this.transitions.push({
      fromStage, toStage, direction: verdict.direction, atIso: new Date().toISOString(),
    });

    if (verdict.direction === 'downgrade') {
      this.telemetry.emit('rollout_stage_downgrade', { fromStage, toStage });
    } else {
      this.telemetry.emit('rollout_stage_transition_allowed', { fromStage, toStage, direction: verdict.direction });
    }
    return { fromStage, toStage, direction: verdict.direction };
  }

  /**
   * Freeze the rollout — refuses all further forward transitions.
   * Downgrades remain allowed so operators can roll back.
   */
  freeze(reason: string): void {
    this.frozen = true;
    this.freezeReason = reason;
    this.telemetry.emit('rollout_stage_freeze_recommended', {
      stage: this.currentStage, reason,
    });
  }

  /**
   * Lift a freeze. Used by operators after an incident is resolved.
   */
  unfreeze(): void {
    this.frozen = false;
    this.freezeReason = null;
  }

  /**
   * Validate provider-stage compatibility. E.g. `publish_disabled`
   * forbids ANY provider from being live.
   */
  validateProviderStageCompatibility(input: {
    provider: string;
    publishRequested: boolean;
  }): { allowed: boolean; reason: string } {
    if (!input.publishRequested) {
      return { allowed: true, reason: 'non-publish operation' };
    }
    const stagePermits =
      this.currentStage === 'single_provider_live' ||
      this.currentStage === 'staged_provider_rollout' ||
      this.currentStage === 'full_runtime_live';
    if (!stagePermits) {
      return {
        allowed: false,
        reason: `stage '${this.currentStage}' forbids publish for provider '${input.provider}'`,
      };
    }
    return { allowed: true, reason: 'stage permits publish' };
  }

  /**
   * Diagnostic snapshot.
   */
  snapshot(): {
    currentStage: ProductionRolloutStage;
    frozen: boolean;
    freezeReason: string | null;
    recentTransitions: Array<{
      fromStage: ProductionRolloutStage;
      toStage: ProductionRolloutStage;
      direction: string;
      atIso: string;
    }>;
  } {
    return {
      currentStage: this.currentStage,
      frozen: this.frozen,
      freezeReason: this.freezeReason,
      recentTransitions: this.transitions.slice(-32),
    };
  }
}

function parseStage(raw: string | undefined): ProductionRolloutStage {
  const cleaned = (raw ?? 'disabled').trim().toLowerCase();
  if (ALL_STAGES.includes(cleaned as ProductionRolloutStage)) {
    return cleaned as ProductionRolloutStage;
  }
  return 'disabled';
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let defaultGovernor: ProductionRuntimeRolloutGovernor | null = null;

export function getDefaultProductionRolloutGovernor(): ProductionRuntimeRolloutGovernor {
  if (!defaultGovernor) defaultGovernor = new ProductionRuntimeRolloutGovernor();
  return defaultGovernor;
}

export function setDefaultProductionRolloutGovernor(
  governor: ProductionRuntimeRolloutGovernor | null,
): void {
  defaultGovernor = governor;
}

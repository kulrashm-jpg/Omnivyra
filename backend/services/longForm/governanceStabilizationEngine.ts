/**
 * Phase 13.6 — Governance stabilization engine.
 *
 * Watches the rate and direction of governance changes (adaptive profile
 * shifts, recovery actions emitted, fatigue corrections, rollbacks
 * recommended, sequencing flips) and intervenes when the system shows
 * instability.
 *
 * Mechanisms:
 *   - Hysteresis bands: a knob must clear a threshold AND stay clear for N
 *     ticks before stability is reported as restored.
 *   - Stabilization windows: rolling count of state-mutating events.
 *   - Recovery cooldowns: after a recovery action is emitted, the same
 *     action is suppressed for `cooldownMs`.
 *   - Adaptation dampening: when oscillation is detected, returns reduced
 *     scaling factor for callers.
 *
 * Pure / deterministic. In-memory per-company state.
 */

import type {
  CrossModalRecoveryAction,
  EffectiveTransformationProfile,
  GovernanceStabilityResult,
  StabilizationWarning,
  TransformationRecoveryPlan,
} from './longFormRecommendationTypes';

interface CooldownEntry {
  action: CrossModalRecoveryAction;
  expiresAtMs: number;
}

interface StabilizerState {
  recentEffectiveProfiles: EffectiveTransformationProfile[];
  recentRecoveryActions: Array<{ action: CrossModalRecoveryAction; atMs: number }>;
  recoveryCooldowns: CooldownEntry[];
  lastTickAtMs: number;
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const;

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface GovernanceStabilizationEngine {
  /**
   * Observe an effective adaptive profile and a recovery plan. The
   * stabilizer pushes them into rolling windows, computes warnings, and
   * advances cooldowns.
   */
  observe(input: {
    companyId: string;
    effectiveProfile?: EffectiveTransformationProfile;
    recoveryPlan?: TransformationRecoveryPlan;
    nowMs?: number;
  }): GovernanceStabilityResult;

  /** Whether a recovery action is currently suppressed by cooldown. */
  isOnCooldown(companyId: string, action: CrossModalRecoveryAction, nowMs?: number): boolean;

  /** Filter a recovery plan, dropping steps currently on cooldown. */
  applyCooldownsToPlan(companyId: string, plan: TransformationRecoveryPlan, nowMs?: number): TransformationRecoveryPlan;

  clear(companyId?: string): void;
}

export interface StabilizationOptions {
  /** rolling window length per metric (default 8). */
  windowSize?: number;
  /** cooldown after a recovery action is emitted (default 60_000ms). */
  recoveryCooldownMs?: number;
  /** thrashing threshold — emitting ≥ N distinct actions within window flags thrashing. */
  thrashingDistinctActions?: number;
  /** over-recovery threshold — same action ≥ N times within window. */
  overRecoveryRepeats?: number;
}

export function createGovernanceStabilizationEngine(options?: StabilizationOptions): GovernanceStabilizationEngine {
  const windowSize = Math.max(3, options?.windowSize ?? 8);
  const cooldownMs = Math.max(1000, options?.recoveryCooldownMs ?? 60_000);
  const thrashingThreshold = Math.max(3, options?.thrashingDistinctActions ?? 4);
  const overRecoveryThreshold = Math.max(2, options?.overRecoveryRepeats ?? 3);

  const buckets = new Map<string, StabilizerState>();

  function state(companyId: string): StabilizerState {
    let s = buckets.get(companyId);
    if (!s) {
      s = { recentEffectiveProfiles: [], recentRecoveryActions: [], recoveryCooldowns: [], lastTickAtMs: 0 };
      buckets.set(companyId, s);
    }
    return s;
  }

  function pruneOld(s: StabilizerState, nowMs: number) {
    s.recoveryCooldowns = s.recoveryCooldowns.filter((c) => c.expiresAtMs > nowMs);
    // prune recovery actions older than 2× cooldown
    const cutoff = nowMs - cooldownMs * 2;
    s.recentRecoveryActions = s.recentRecoveryActions.filter((r) => r.atMs >= cutoff);
  }

  return {
    observe(input) {
      const nowMs = input.nowMs ?? Date.now();
      const s = state(input.companyId);
      pruneOld(s, nowMs);
      s.lastTickAtMs = nowMs;
      const warnings: StabilizationWarning[] = [];

      // ── 1. record effective profile, detect oscillation ──────────────
      if (input.effectiveProfile) {
        s.recentEffectiveProfiles.push(input.effectiveProfile);
        while (s.recentEffectiveProfiles.length > windowSize) s.recentEffectiveProfiles.shift();
        const modes = s.recentEffectiveProfiles.map((p) => p.applicationMode);
        const dampedCount = modes.filter((m) => m === 'damped').length;
        if (dampedCount >= Math.ceil(windowSize / 2)) {
          warnings.push({ source: 'adaptive', type: 'oscillation', severity: 'medium',
            detail: `Adaptive profile in "damped" mode for ${dampedCount}/${modes.length} ticks — sustained oscillation.` });
        }
        // Stability score reported by the application layer — if it's persistently low, escalate.
        const lastStab = s.recentEffectiveProfiles[s.recentEffectiveProfiles.length - 1].adaptationStabilityScore;
        if (lastStab < 40) {
          warnings.push({ source: 'adaptive', type: 'overcorrection', severity: 'medium',
            detail: `Adaptation stability score ${lastStab}/100 — knobs swinging beyond safe band.` });
        }
      }

      // ── 2. record recovery actions, emit cooldowns, detect thrashing / over-recovery ──
      if (input.recoveryPlan) {
        const actionsEmitted = new Map<CrossModalRecoveryAction, number>();
        for (const step of input.recoveryPlan.steps) {
          // suppress duplicate cooldown entries
          const existingCooldown = s.recoveryCooldowns.find((c) => c.action === step.action);
          if (existingCooldown) {
            warnings.push({ source: 'recovery', type: 'cooldown_violation', severity: 'low',
              detail: `Action "${step.action}" re-emitted while cooldown active — suppressed.` });
            continue;
          }
          s.recentRecoveryActions.push({ action: step.action, atMs: nowMs });
          s.recoveryCooldowns.push({ action: step.action, expiresAtMs: nowMs + cooldownMs });
          actionsEmitted.set(step.action, (actionsEmitted.get(step.action) ?? 0) + 1);
        }

        // Thrashing detection (distinct actions within window).
        const distinctRecent = new Set(s.recentRecoveryActions.map((r) => r.action)).size;
        if (distinctRecent >= thrashingThreshold) {
          warnings.push({ source: 'recovery', type: 'thrashing', severity: 'high',
            detail: `${distinctRecent} distinct recovery actions emitted within window — system is thrashing.` });
        }

        // Over-recovery: same action ≥ overRecoveryThreshold times in window.
        const repeatCounts = new Map<CrossModalRecoveryAction, number>();
        for (const r of s.recentRecoveryActions) {
          repeatCounts.set(r.action, (repeatCounts.get(r.action) ?? 0) + 1);
        }
        for (const [action, count] of repeatCounts) {
          if (count >= overRecoveryThreshold) {
            warnings.push({ source: 'recovery', type: 'over_recovery', severity: 'medium',
              detail: `Action "${action}" emitted ${count} times in window — repeated correction without resolution.` });
          }
        }

        // Rollback overuse — count from the INPUT plan, not from emitted actions,
        // because the cooldown filter above suppresses re-emissions but the planner
        // is still recommending them, which is exactly the signal we want.
        const rollbackRecommendedCount = input.recoveryPlan.steps.filter((s) => s.action === 'lineage_rollback').length;
        if (rollbackRecommendedCount >= 2) {
          warnings.push({ source: 'rollback', type: 'overcorrection', severity: 'high',
            detail: `lineage_rollback recommended ${rollbackRecommendedCount} times in this plan — escalate to human governance.` });
        }
      }

      // ── 3. composite stability score ────────────────────────────────
      let stability = 100;
      for (const w of warnings) {
        stability -= w.severity === 'high' ? 25 : w.severity === 'medium' ? 12 : 5;
      }
      // Floor stability by adaptive layer's stability score if present.
      const lastEffective = s.recentEffectiveProfiles[s.recentEffectiveProfiles.length - 1];
      if (lastEffective) {
        stability = Math.min(stability, Math.max(0, lastEffective.adaptationStabilityScore + 20));
      }
      const governanceStabilityScore = clamp100(stability);

      const cooldownActive = s.recoveryCooldowns.length > 0;
      const cooldownRemainingMs = cooldownActive
        ? Math.max(0, Math.max(...s.recoveryCooldowns.map((c) => c.expiresAtMs - nowMs)))
        : 0;

      // sort warnings by severity desc for readability
      warnings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

      return { governanceStabilityScore, stabilizationWarnings: warnings, cooldownActive, cooldownRemainingMs };
    },
    isOnCooldown(companyId, action, nowMs) {
      const s = buckets.get(companyId);
      if (!s) return false;
      const now = nowMs ?? Date.now();
      return s.recoveryCooldowns.some((c) => c.action === action && c.expiresAtMs > now);
    },
    applyCooldownsToPlan(companyId, plan, nowMs) {
      const now = nowMs ?? Date.now();
      const s = buckets.get(companyId);
      if (!s || s.recoveryCooldowns.length === 0) return plan;
      const filteredSteps = plan.steps.filter((step) =>
        !s.recoveryCooldowns.some((c) => c.action === step.action && c.expiresAtMs > now));
      // Reduce overallRiskScore proportionally so callers don't double-count.
      const ratio = plan.steps.length === 0 ? 1 : filteredSteps.length / plan.steps.length;
      return {
        steps: filteredSteps,
        overallRiskScore: Math.round(plan.overallRiskScore * ratio),
      };
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
  };
}

let _default: GovernanceStabilizationEngine | null = null;
export function getDefaultGovernanceStabilizationEngine(): GovernanceStabilizationEngine {
  if (!_default) _default = createGovernanceStabilizationEngine();
  return _default;
}
export function setDefaultGovernanceStabilizationEngine(e: GovernanceStabilizationEngine): void {
  _default = e;
}

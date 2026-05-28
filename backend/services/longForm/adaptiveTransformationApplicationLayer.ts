/**
 * Phase 13.1 — Adaptive transformation application layer.
 *
 * Wraps the read-only `AdaptiveTransformationProfile` and produces an
 * `EffectiveTransformationProfile` that callers fold into
 * `assessTransformation`, decomposition/expansion analyzers, the strategic
 * sequencer, cannibalization sensitivity, and fatigue sensitivity.
 *
 * Stability mechanics:
 *   - Smoothing: maintain a rolling window of recent profiles per company;
 *     emit the EWMA (alpha=0.4) of each knob.
 *   - Confidence gating: when source confidence is low, knobs are dampened
 *     proportionally (multiply by confidence/100, clamped 0.25..1.0).
 *   - Oscillation suppression: if successive raw profiles flip sign on the
 *     same knob ≥3 times within the window, emit "damped" mode and reduce
 *     the magnitude further.
 *   - Bounded adaptation: knobs clamped to original type ranges.
 *
 * Pure / deterministic. In-memory per-company rolling window.
 */

import type {
  AdaptiveTransformationProfile,
  EffectiveTransformationProfile,
} from './longFormRecommendationTypes';

interface SmoothedState {
  history: AdaptiveTransformationProfile[];
  ewmaCwm: number;
  ewmaRts: number;
  ewmaOsd: number;
  ewmaDad: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function signFlips(values: number[]): number {
  let flips = 0;
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    if (a === 0 || b === 0) continue;
    if ((a > 0) !== (b > 0)) flips += 1;
  }
  return flips;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
}

export interface AdaptiveTransformationApplicationLayer {
  apply(companyId: string, profile: AdaptiveTransformationProfile): EffectiveTransformationProfile;
  current(companyId: string): EffectiveTransformationProfile | null;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export interface ApplicationLayerOptions {
  /** alpha for EWMA (0..1). Higher = trust new samples more. Default 0.4. */
  ewmaAlpha?: number;
  /** rolling window size. Default 8. */
  windowSize?: number;
  /** confidence below which we always use 'idle' mode. Default 20. */
  idleConfidenceFloor?: number;
}

export function createAdaptiveTransformationApplicationLayer(options?: ApplicationLayerOptions): AdaptiveTransformationApplicationLayer {
  const alpha = clamp(options?.ewmaAlpha ?? 0.4, 0.05, 0.95);
  const windowSize = Math.max(3, options?.windowSize ?? 8);
  const idleFloor = clamp(options?.idleConfidenceFloor ?? 20, 0, 80);
  const buckets = new Map<string, SmoothedState>();
  const lastEffective = new Map<string, EffectiveTransformationProfile>();

  function getState(companyId: string): SmoothedState {
    let s = buckets.get(companyId);
    if (!s) {
      s = { history: [], ewmaCwm: 1.0, ewmaRts: 0, ewmaOsd: 0, ewmaDad: 0 };
      buckets.set(companyId, s);
    }
    return s;
  }

  return {
    apply(companyId, profile) {
      const state = getState(companyId);
      state.history.push(profile);
      while (state.history.length > windowSize) state.history.shift();

      // EWMA update for each knob.
      state.ewmaCwm = alpha * profile.compatibilityWeightMultiplier + (1 - alpha) * state.ewmaCwm;
      state.ewmaRts = alpha * profile.retentionThresholdShift + (1 - alpha) * state.ewmaRts;
      state.ewmaOsd = alpha * profile.oversimplificationSensitivityDelta + (1 - alpha) * state.ewmaOsd;
      state.ewmaDad = alpha * profile.decompositionAggressivenessDelta + (1 - alpha) * state.ewmaDad;

      // Oscillation detection on each knob across the window.
      const flipsRts = signFlips(state.history.map((p) => p.retentionThresholdShift));
      const flipsOsd = signFlips(state.history.map((p) => p.oversimplificationSensitivityDelta));
      const flipsDad = signFlips(state.history.map((p) => p.decompositionAggressivenessDelta));
      const totalFlips = flipsRts + flipsOsd + flipsDad;
      const oscillating = totalFlips >= 3;

      // Confidence gating.
      const sourceConf = profile.adaptiveTransformationConfidence;
      const confFactor = clamp(sourceConf / 100, 0.25, 1.0);

      let applicationMode: EffectiveTransformationProfile['applicationMode'];
      if (sourceConf < idleFloor) applicationMode = 'idle';
      else if (oscillating) applicationMode = 'damped';
      else if (sourceConf < 50) applicationMode = 'partial';
      else applicationMode = 'full';

      // Modal scaling (idle → 0, damped → 0.5×, partial → 0.75×, full → 1×).
      const modeScale = applicationMode === 'idle' ? 0
        : applicationMode === 'damped' ? 0.5
        : applicationMode === 'partial' ? 0.75
        : 1.0;

      // Effective values: EWMA × modeScale × confFactor, clamped to type ranges.
      const baseCwm = 1.0;
      const effectiveCwm = clamp(baseCwm + (state.ewmaCwm - baseCwm) * modeScale * confFactor, 0.6, 1.4);
      const effectiveRts = Math.round(clamp(state.ewmaRts * modeScale * confFactor, -15, 15));
      const effectiveOsd = Math.round(clamp(state.ewmaOsd * modeScale * confFactor, -20, 20));
      const effectiveDad = Math.round(clamp(state.ewmaDad * modeScale * confFactor, -20, 20));

      // Stability score:
      //   - low variance across window → +60
      //   - small history → less stability
      //   - oscillation → −20
      // Normalize each axis to roughly [-1..+1] so baselines don't masquerade as variance.
      const allValues = state.history.flatMap((p) => [
        (p.compatibilityWeightMultiplier - 1.0) / 0.4,
        p.retentionThresholdShift / 15,
        p.oversimplificationSensitivityDelta / 20,
        p.decompositionAggressivenessDelta / 20,
      ]);
      const v = variance(allValues);
      const varScore = clamp(100 / (1 + v * 20), 0, 100);
      const windowScore = Math.min(30, state.history.length * 4);
      const oscPenalty = oscillating ? 30 : 0;
      const adaptationStabilityScore = Math.round(clamp(varScore * 0.7 + windowScore * 0.3 - oscPenalty, 0, 100));

      const rationaleNotes: string[] = [];
      rationaleNotes.push(`Mode=${applicationMode} (source confidence ${sourceConf}/100${oscillating ? `, ${totalFlips} sign-flips detected` : ''}).`);
      if (applicationMode === 'idle') rationaleNotes.push('Adaptive knobs zeroed — confidence below idle floor.');
      if (applicationMode === 'damped') rationaleNotes.push('Knob magnitudes halved to suppress oscillation.');
      rationaleNotes.push(`Effective knobs: cwm=${effectiveCwm.toFixed(2)}, rts=${effectiveRts}, osd=${effectiveOsd}, dad=${effectiveDad}.`);

      const out: EffectiveTransformationProfile = {
        effectiveCompatibilityWeightMultiplier: Number(effectiveCwm.toFixed(2)),
        effectiveRetentionThresholdShift: effectiveRts,
        effectiveOversimplificationSensitivityDelta: effectiveOsd,
        effectiveDecompositionAggressivenessDelta: effectiveDad,
        sourceAdaptiveConfidence: sourceConf,
        applicationMode,
        adaptationStabilityScore,
        smoothingWindow: state.history.length,
        rationaleNotes,
      };
      lastEffective.set(companyId, out);
      return out;
    },
    current(companyId) { return lastEffective.get(companyId) ?? null; },
    clear(companyId) {
      if (!companyId) { buckets.clear(); lastEffective.clear(); return; }
      buckets.delete(companyId);
      lastEffective.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.history.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.history.length; });
      return total;
    },
  };
}

let _default: AdaptiveTransformationApplicationLayer | null = null;
export function getDefaultAdaptiveTransformationApplicationLayer(): AdaptiveTransformationApplicationLayer {
  if (!_default) _default = createAdaptiveTransformationApplicationLayer();
  return _default;
}
export function setDefaultAdaptiveTransformationApplicationLayer(l: AdaptiveTransformationApplicationLayer): void {
  _default = l;
}

/**
 * Phase 13.2 — Transformation chain health governor.
 *
 * Tracks the health of each transformation chain over time. Each tick
 * records a `ChainHealthSnapshot` derived from the latest
 * `MultiHopContinuityResult`. The governor surfaces stability bands,
 * volatility, recovery loops, and irreversible authority collapse.
 *
 * Pure / deterministic. In-memory per-company-and-chain history.
 */

import type {
  ChainHealthResult,
  ChainHealthSnapshot,
  ChainStabilityBand,
  DiagnosticTrend,
  MultiHopContinuityResult,
} from './longFormRecommendationTypes';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = average(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

function bandFor(score: number): ChainStabilityBand {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'watch';
  if (score >= 35) return 'unstable';
  return 'critical';
}

export interface TransformationChainHealthGovernor {
  recordTick(input: { companyId: string; multiHop: MultiHopContinuityResult; cumulativeFatigueScore?: number }): ChainHealthResult;
  current(companyId: string, chainId: string): ChainHealthResult | null;
  list(companyId: string): ChainHealthResult[];
  clear(companyId?: string): void;
}

interface ChainState {
  history: ChainHealthSnapshot[];
  lastResult: ChainHealthResult;
}

export interface ChainHealthGovernorOptions {
  /** rolling history per chain (default 12). */
  historyLimit?: number;
  /** how many recent snapshots indicate a "recovery loop"
   *  (alternating degrading→improving→degrading) (default 4). */
  recoveryLoopWindow?: number;
}

export function createTransformationChainHealthGovernor(options?: ChainHealthGovernorOptions): TransformationChainHealthGovernor {
  const limit = Math.max(3, options?.historyLimit ?? 12);
  const loopWindow = Math.max(3, options?.recoveryLoopWindow ?? 4);
  const buckets = new Map<string, Map<string, ChainState>>();

  function chainBucket(companyId: string, chainId: string): ChainState {
    let perCompany = buckets.get(companyId);
    if (!perCompany) { perCompany = new Map(); buckets.set(companyId, perCompany); }
    let state = perCompany.get(chainId);
    if (!state) {
      state = {
        history: [],
        lastResult: {
          chainId,
          chainHealthScore: 100,
          chainStabilityBand: 'healthy',
          branchRecoveryRisk: 0,
          authorityDecayTrend: 'unknown',
          volatilityScore: 0,
          cumulativeFatigueScore: 0,
          recoveryLoopDetected: false,
          irreversibleAuthorityCollapseDetected: false,
          history: [],
        },
      };
      perCompany.set(chainId, state);
    }
    return state;
  }

  return {
    recordTick(input) {
      const state = chainBucket(input.companyId, input.multiHop.chainId);
      const snap: ChainHealthSnapshot = {
        takenAt: new Date().toISOString(),
        chainContinuityScore: input.multiHop.chainContinuityScore,
        chainDriftSeverity: input.multiHop.chainDriftSeverity,
        cumulativeAuthorityRetention: input.multiHop.cumulativeAuthorityRetention,
      };
      state.history.push(snap);
      while (state.history.length > limit) state.history.shift();

      // ── chainHealthScore = current continuity adjusted by volatility ──
      const continuityValues = state.history.map((s) => s.chainContinuityScore);
      const v = variance(continuityValues);
      const volatilityScore = clamp100(100 / (1 + v * 0.02));
      const currentContinuity = input.multiHop.chainContinuityScore;
      const cumulativeFatigueScore = clamp100(input.cumulativeFatigueScore ?? 0);

      // health = 0.6 × current continuity + 0.3 × volatility + 0.1 × (100 − fatigue)
      const chainHealthScore = clamp100(currentContinuity * 0.6 + volatilityScore * 0.3 + (100 - cumulativeFatigueScore) * 0.1);

      // ── authority decay trend ──
      const authValues = state.history.map((s) => s.cumulativeAuthorityRetention);
      const mid = Math.max(1, Math.floor(authValues.length / 2));
      const authorityDecayTrend = authValues.length < 3
        ? 'unknown'
        : trendDirection(average(authValues.slice(0, mid)), average(authValues.slice(mid)), 4);

      // ── recovery loop: alternating high-low-high in last `loopWindow` ──
      let recoveryLoopDetected = false;
      if (state.history.length >= loopWindow) {
        const recent = state.history.slice(-loopWindow);
        let flips = 0;
        for (let i = 1; i < recent.length; i += 1) {
          const a = recent[i - 1].chainContinuityScore;
          const b = recent[i].chainContinuityScore;
          if (Math.abs(b - a) >= 15) flips += 1;
        }
        if (flips >= loopWindow - 1) recoveryLoopDetected = true;
      }

      // ── irreversible authority collapse ──
      // Cumulative authority retention has been < 30 for the last ≥3 ticks
      // AND last is not better than first by more than 5pts.
      const irreversibleAuthorityCollapseDetected =
        authValues.length >= 3
        && authValues.slice(-3).every((v2) => v2 < 30)
        && authValues[authValues.length - 1] <= authValues[0] + 5;

      // ── branch recovery risk ──
      // High when: low health + high fatigue + chain drift severity high + irreversible
      let branchRecoveryRisk = 0;
      branchRecoveryRisk += (100 - chainHealthScore) * 0.5;
      branchRecoveryRisk += cumulativeFatigueScore * 0.25;
      if (input.multiHop.chainDriftSeverity === 'high') branchRecoveryRisk += 25;
      else if (input.multiHop.chainDriftSeverity === 'medium') branchRecoveryRisk += 12;
      if (irreversibleAuthorityCollapseDetected) branchRecoveryRisk += 25;
      branchRecoveryRisk = clamp100(branchRecoveryRisk);

      const result: ChainHealthResult = {
        chainId: input.multiHop.chainId,
        chainHealthScore,
        chainStabilityBand: bandFor(chainHealthScore),
        branchRecoveryRisk,
        authorityDecayTrend,
        volatilityScore: clamp100(100 - volatilityScore), // present as drift (higher = more volatile)
        cumulativeFatigueScore,
        recoveryLoopDetected,
        irreversibleAuthorityCollapseDetected,
        history: [...state.history],
      };
      state.lastResult = result;
      return result;
    },
    current(companyId, chainId) {
      return buckets.get(companyId)?.get(chainId)?.lastResult ?? null;
    },
    list(companyId) {
      const out: ChainHealthResult[] = [];
      const inner = buckets.get(companyId);
      inner?.forEach((s) => out.push(s.lastResult));
      return out;
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
  };
}

let _default: TransformationChainHealthGovernor | null = null;
export function getDefaultTransformationChainHealthGovernor(): TransformationChainHealthGovernor {
  if (!_default) _default = createTransformationChainHealthGovernor();
  return _default;
}
export function setDefaultTransformationChainHealthGovernor(g: TransformationChainHealthGovernor): void {
  _default = g;
}

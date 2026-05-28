/**
 * Phase 13.5 — Real-time ecosystem coherence monitor.
 *
 * Maintains per-company scope-scoped cached coherence scores. Callers
 * signal what changed (e.g. "an asset's narrative was updated"); the
 * monitor invalidates only the scopes that depend on that mutation and
 * recomputes them on the next `tick()`. Other scopes return their cached
 * scores.
 *
 * Eliminates the full O(N×F²) recomputation pattern.
 *
 * Pure / deterministic. In-memory.
 */

import type {
  CrossModalAsset,
  EcosystemCoherenceTickResult,
  EcosystemInvalidationScope,
  EcosystemNarrativeResult,
} from './longFormRecommendationTypes';
import { governEcosystemNarrative } from './ecosystemNarrativeGovernor';

type ScopeScores = Record<EcosystemInvalidationScope, number>;

interface MonitorState {
  invalidated: Set<EcosystemInvalidationScope>;
  cachedScores: ScopeScores;
  lastFull?: EcosystemNarrativeResult;
  lastComputedAtMs: number;
}

const SCOPE_ORDER: Exclude<EcosystemInvalidationScope, 'all'>[] = [
  'narrative', 'authority', 'positioning', 'education', 'transformation',
];

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoresFromGovernor(g: EcosystemNarrativeResult): ScopeScores {
  // Each scope's score = ecosystem coherence minus the issue penalty for that scope.
  const base = g.ecosystemCoherenceScore;
  let narrativePenalty = 0;
  let authorityPenalty = 0;
  let positioningPenalty = 0;
  let educationPenalty = 0;
  let transformPenalty = 0;
  for (const i of g.detectedIssues) {
    const p = i.severity === 'high' ? 22 : i.severity === 'medium' ? 12 : 5;
    switch (i.type) {
      case 'NARRATIVE_FRAGMENTATION':       narrativePenalty   += p; break;
      case 'STRATEGIC_DIVERGENCE':          narrativePenalty   += p; break;
      case 'AUTHORITY_INCOHERENCE':         authorityPenalty   += p; break;
      case 'POSITIONING_CONTRADICTION':     positioningPenalty += p; break;
      case 'EDUCATIONAL_DISORIENTATION':    educationPenalty   += p; break;
    }
  }
  return {
    narrative:      clamp100(100 - narrativePenalty),
    authority:      clamp100(100 - authorityPenalty),
    positioning:    clamp100(100 - positioningPenalty),
    education:      clamp100(100 - educationPenalty),
    transformation: base, // proxy: overall ecosystem state for now
    all:            base,
  };
}

export interface RealTimeEcosystemCoherenceMonitor {
  /** Caller signals which scopes are dirty (e.g. when an asset is added or mutated). */
  invalidate(companyId: string, scopes: EcosystemInvalidationScope[] | 'all'): void;
  /** Recompute only invalidated scopes; cached otherwise. */
  tick(input: { companyId: string; assets: CrossModalAsset[] }): EcosystemCoherenceTickResult;
  /** Last cached snapshot for inspection / explanation. */
  currentScores(companyId: string): ScopeScores | null;
  clear(companyId?: string): void;
}

export interface MonitorOptions {
  /** if true, every tick performs a full recompute regardless of invalidation flags (debug). */
  alwaysRecomputeAll?: boolean;
}

export function createRealTimeEcosystemCoherenceMonitor(options?: MonitorOptions): RealTimeEcosystemCoherenceMonitor {
  const buckets = new Map<string, MonitorState>();
  const forceFull = !!options?.alwaysRecomputeAll;

  function state(companyId: string): MonitorState {
    let s = buckets.get(companyId);
    if (!s) {
      s = {
        invalidated: new Set(SCOPE_ORDER),
        cachedScores: { narrative: 100, authority: 100, positioning: 100, education: 100, transformation: 100, all: 100 },
        lastComputedAtMs: 0,
      };
      buckets.set(companyId, s);
    }
    return s;
  }

  return {
    invalidate(companyId, scopes) {
      const s = state(companyId);
      if (scopes === 'all') {
        SCOPE_ORDER.forEach((sc) => s.invalidated.add(sc));
        s.invalidated.add('all');
        return;
      }
      for (const sc of scopes) s.invalidated.add(sc);
    },
    tick(input) {
      const s = state(input.companyId);
      const invalidatedList: EcosystemInvalidationScope[] = Array.from(s.invalidated);
      const recomputedList: EcosystemInvalidationScope[] = [];
      let recomputed = false;

      if (forceFull || invalidatedList.length > 0) {
        const fresh = governEcosystemNarrative({ assets: input.assets });
        const next = scoresFromGovernor(fresh);
        // Only update scopes that were invalidated (incremental).
        if (forceFull || s.invalidated.has('all')) {
          s.cachedScores = next;
          SCOPE_ORDER.forEach((sc) => recomputedList.push(sc));
        } else {
          for (const sc of SCOPE_ORDER) {
            if (s.invalidated.has(sc)) {
              s.cachedScores[sc] = next[sc];
              recomputedList.push(sc);
            }
          }
          // Roll up `all` as the min of scope scores (worst-case bound).
          s.cachedScores.all = Math.min(
            s.cachedScores.narrative, s.cachedScores.authority,
            s.cachedScores.positioning, s.cachedScores.education,
            s.cachedScores.transformation,
          );
          recomputedList.push('all');
        }
        s.lastFull = fresh;
        s.invalidated.clear();
        s.lastComputedAtMs = Date.now();
        recomputed = true;
      }

      return {
        computedAtMs: s.lastComputedAtMs,
        scopesInvalidated: invalidatedList,
        scopesRecomputed: recomputedList,
        narrativeCoherenceScore: s.cachedScores.narrative,
        authorityCoherenceScore: s.cachedScores.authority,
        positioningConsistencyScore: s.cachedScores.positioning,
        educationalContinuityScore: s.cachedScores.education,
        transformationStabilityScore: s.cachedScores.transformation,
        overallCoherenceScore: s.cachedScores.all,
        recomputed,
      };
    },
    currentScores(companyId) {
      return buckets.get(companyId)?.cachedScores ?? null;
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
  };
}

let _default: RealTimeEcosystemCoherenceMonitor | null = null;
export function getDefaultRealTimeEcosystemCoherenceMonitor(): RealTimeEcosystemCoherenceMonitor {
  if (!_default) _default = createRealTimeEcosystemCoherenceMonitor();
  return _default;
}
export function setDefaultRealTimeEcosystemCoherenceMonitor(m: RealTimeEcosystemCoherenceMonitor): void {
  _default = m;
}

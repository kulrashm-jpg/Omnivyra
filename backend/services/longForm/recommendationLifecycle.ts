/**
 * Phase 8 — Recommendation lifecycle registry + state machine.
 *
 * In-memory registry that tracks the full lifecycle of every accepted
 * recommendation so the handoff route can:
 *   • look up the original recommendation by id,
 *   • assert valid state transitions,
 *   • track inheritance/continuity history across handoffs,
 *   • compute aging + cumulative degradation,
 *   • support diagnostics aggregation.
 *
 * NO DB persistence (per spec). The registry is a Map keyed by recommendationId
 * with a periodic cleanup pass. Each entry has a TTL (default 6h).
 *
 * The state machine validates transitions — invalid transitions throw and the
 * caller is expected to log and reject. This protects against UI bugs that
 * would otherwise corrupt diagnostics.
 */

import type {
  GenerationContinuityValidation,
  LongFormRecommendation,
  PlannerInheritanceContractResult,
  RecommendationLifecycleState,
  RecommendationLineageMetadata,
  SemanticContinuityResult,
} from './longFormRecommendationTypes';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;        // 6 hours
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const VALID_TRANSITIONS: Record<RecommendationLifecycleState, RecommendationLifecycleState[]> = {
  generated: ['validated', 'archived'],
  validated: ['selected', 'archived'],
  selected: ['handed_off', 'archived'],
  handed_off: ['planner_validated', 'planner_drifted', 'archived'],
  planner_validated: ['generation_ready', 'planner_ready', 'archived'],
  planner_drifted: ['handed_off', 'generation_rejected', 'archived'],
  generation_ready: ['planner_ready', 'archived'],
  generation_rejected: ['archived'],
  // ─── Phase 7 — orchestration-layer transitions ──────────────────────
  planner_ready: ['generation_validated', 'generation_blocked', 'archived'],
  generation_validated: ['generation_in_progress', 'section_generating', 'archived'],
  generation_blocked: ['generation_recovered', 'generation_rejected', 'archived'],
  generation_recovered: ['planner_ready', 'archived'],
  generation_in_progress: ['section_generating', 'generation_completed', 'generation_failed', 'archived'],
  generation_completed: ['archived'],
  generation_failed: ['generation_recovered', 'archived'],
  // ─── Phase 9 — execution-layer transitions ──────────────────────────
  section_generating: ['section_validated', 'section_failed', 'section_recovered', 'archived'],
  section_validated: ['section_generating', 'article_assembling', 'archived'],
  section_recovered: ['section_generating', 'section_validated', 'article_assembling', 'archived'],
  section_failed: ['section_recovered', 'article_failed', 'archived'],
  article_assembling: ['article_validated', 'article_failed', 'archived'],
  article_validated: ['article_completed', 'article_recovered', 'archived'],
  article_recovered: ['article_completed', 'article_failed', 'archived'],
  article_completed: ['archived'],
  article_failed: ['archived'],
  archived: [],
};

export class InvalidLifecycleTransitionError extends Error {
  constructor(public readonly from: RecommendationLifecycleState, public readonly to: RecommendationLifecycleState) {
    super(`Invalid lifecycle transition: ${from} → ${to}`);
    this.name = 'InvalidLifecycleTransitionError';
  }
}

interface RegistryEntry {
  recommendation: LongFormRecommendation;
  metadata: RecommendationLineageMetadata;
  expiresAt: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendationLifecycleRegistry {
  /** Register a freshly-generated recommendation. State is set to `generated`. */
  register(recommendation: LongFormRecommendation, companyId: string, foundationSignature: string, ttlMs?: number): RecommendationLineageMetadata;
  /** Transition an existing recommendation; throws on invalid transition. */
  transition(recommendationId: string, next: RecommendationLifecycleState, detail?: string): RecommendationLineageMetadata;
  /** Record continuity/inheritance evaluation outcome (after handoff). */
  recordHandoffOutcome(recommendationId: string, params: {
    continuity: GenerationContinuityValidation;
    semantic: SemanticContinuityResult;
    inheritance: PlannerInheritanceContractResult;
  }): RecommendationLineageMetadata;
  /** Look up an existing entry. Returns null if not found OR expired. */
  get(recommendationId: string): { recommendation: LongFormRecommendation; metadata: RecommendationLineageMetadata } | null;
  /** Snapshot of all live entries for the given company (or all when omitted). */
  snapshot(companyId?: string): Array<{ recommendation: LongFormRecommendation; metadata: RecommendationLineageMetadata }>;
  /** Force a cleanup sweep — drops expired entries. Returns number dropped. */
  sweep(now?: number): number;
  /** Removes all entries for a company (test/debug). */
  clear(companyId?: string): void;
}

function refreshAge(metadata: RecommendationLineageMetadata, now: number): RecommendationLineageMetadata {
  const generatedAt = Date.parse(metadata.generationTimestamp);
  return {
    ...metadata,
    ageInSeconds: Math.max(0, Math.floor((now - generatedAt) / 1000)),
  };
}

function createRegistry(options?: { ttlMs?: number; sweepIntervalMs?: number; auto?: boolean }): RecommendationLifecycleRegistry {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const sweepIntervalMs = options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const entries = new Map<string, RegistryEntry>();
  let lastSweep = Date.now();

  function maybeSweep(now: number): void {
    if (now - lastSweep < sweepIntervalMs) return;
    sweep(now);
    lastSweep = now;
  }

  function sweep(now = Date.now()): number {
    let dropped = 0;
    entries.forEach((entry, id) => {
      if (entry.expiresAt <= now) {
        entries.delete(id);
        dropped += 1;
      }
    });
    return dropped;
  }

  function register(recommendation: LongFormRecommendation, companyId: string, foundationSignature: string, entryTtlMs?: number): RecommendationLineageMetadata {
    const now = Date.now();
    maybeSweep(now);
    const generationTimestamp = new Date(now).toISOString();
    const metadata: RecommendationLineageMetadata = {
      recommendationId: recommendation.recommendationId,
      companyId,
      foundationSignature,
      generationTimestamp,
      ageInSeconds: 0,
      lifecycleStateHistory: [{ state: 'generated', timestamp: generationTimestamp }],
      inheritanceHistory: [],
      cumulativeDegradationPoints: 0,
    };
    entries.set(recommendation.recommendationId, {
      recommendation,
      metadata,
      expiresAt: now + (entryTtlMs ?? ttlMs),
    });
    return metadata;
  }

  function transition(recommendationId: string, next: RecommendationLifecycleState, detail?: string): RecommendationLineageMetadata {
    const entry = entries.get(recommendationId);
    if (!entry) throw new Error(`Recommendation ${recommendationId} not in lifecycle registry (expired or never registered).`);
    const current = entry.metadata.lifecycleStateHistory[entry.metadata.lifecycleStateHistory.length - 1].state;
    if (!VALID_TRANSITIONS[current].includes(next)) {
      throw new InvalidLifecycleTransitionError(current, next);
    }
    const now = Date.now();
    maybeSweep(now);
    const updated: RecommendationLineageMetadata = {
      ...entry.metadata,
      lifecycleStateHistory: [
        ...entry.metadata.lifecycleStateHistory,
        { state: next, timestamp: new Date(now).toISOString(), detail },
      ],
    };
    entry.metadata = refreshAge(updated, now);
    return entry.metadata;
  }

  function recordHandoffOutcome(recommendationId: string, params: {
    continuity: GenerationContinuityValidation;
    semantic: SemanticContinuityResult;
    inheritance: PlannerInheritanceContractResult;
  }): RecommendationLineageMetadata {
    const entry = entries.get(recommendationId);
    if (!entry) throw new Error(`Recommendation ${recommendationId} not in lifecycle registry.`);
    const now = Date.now();
    const degradationDelta =
      Math.max(0, 100 - params.continuity.continuityScore) * 0.4
      + Math.max(0, 100 - params.semantic.semanticContinuityScore) * 0.3
      + Math.max(0, 100 - params.inheritance.inheritanceCompletenessScore) * 0.3;
    const updated: RecommendationLineageMetadata = {
      ...entry.metadata,
      inheritanceHistory: [
        ...entry.metadata.inheritanceHistory,
        {
          timestamp: new Date(now).toISOString(),
          inheritanceCompletenessScore: params.inheritance.inheritanceCompletenessScore,
          continuityScore: params.continuity.continuityScore,
          semanticContinuityScore: params.semantic.semanticContinuityScore,
        },
      ],
      cumulativeDegradationPoints: Math.min(100, Math.round(entry.metadata.cumulativeDegradationPoints + degradationDelta * 0.1)),
    };
    entry.metadata = refreshAge(updated, now);
    return entry.metadata;
  }

  function get(recommendationId: string) {
    const entry = entries.get(recommendationId);
    if (!entry) return null;
    const now = Date.now();
    if (entry.expiresAt <= now) {
      entries.delete(recommendationId);
      return null;
    }
    entry.metadata = refreshAge(entry.metadata, now);
    return { recommendation: entry.recommendation, metadata: entry.metadata };
  }

  function snapshot(companyId?: string) {
    const now = Date.now();
    const out: Array<{ recommendation: LongFormRecommendation; metadata: RecommendationLineageMetadata }> = [];
    entries.forEach((entry) => {
      if (entry.expiresAt <= now) return;
      if (companyId && entry.metadata.companyId !== companyId) return;
      entry.metadata = refreshAge(entry.metadata, now);
      out.push({ recommendation: entry.recommendation, metadata: entry.metadata });
    });
    return out;
  }

  function clear(companyId?: string): void {
    if (!companyId) {
      entries.clear();
      return;
    }
    entries.forEach((entry, id) => {
      if (entry.metadata.companyId === companyId) entries.delete(id);
    });
  }

  return { register, transition, recordHandoffOutcome, get, snapshot, sweep, clear };
}

let _defaultRegistry: RecommendationLifecycleRegistry | null = null;

export function getDefaultRecommendationLifecycleRegistry(): RecommendationLifecycleRegistry {
  if (!_defaultRegistry) _defaultRegistry = createRegistry();
  return _defaultRegistry;
}

export function setDefaultRecommendationLifecycleRegistry(registry: RecommendationLifecycleRegistry): void {
  _defaultRegistry = registry;
}

export function createRecommendationLifecycleRegistry(options?: { ttlMs?: number; sweepIntervalMs?: number }): RecommendationLifecycleRegistry {
  return createRegistry(options);
}

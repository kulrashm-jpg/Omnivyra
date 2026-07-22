/**
 * Coordination Intelligence Layer — duplicate-INTENT detection (semantic).
 *
 * The core rule of this whole layer: we prevent repeated communication *intent*,
 * not repeated *wording*. Therefore this detector NEVER compares text. It decides
 * in two honest tiers:
 *
 *   1. root_id   — deterministic: a prior communication shares the candidate's
 *                  `semanticRootId` (same intent seed by construction).
 *   2. embedding — semantic: cosine over topic-seed embeddings, thresholded.
 *
 * If neither tier can speak — the candidate has no embedding and shares no root,
 * yet priors exist — the verdict is `not_evaluable`. We never claim uniqueness we
 * cannot substantiate (no text fallback, no fabricated score). Trivially, with no
 * priors at all, the verdict is `unique`.
 */
import type {
  CommunicationRecord,
  CommunicationIntent,
  DuplicateIntentVerdict,
  SemanticIntentComparator,
} from './coordinationContracts';

/** Cosine at/above which two intents are the same communication. */
export const DUPLICATE_INTENT_THRESHOLD = 0.90;
/** Cosine at/above which two intents are adjacent (related, not duplicate). */
export const RELATED_INTENT_THRESHOLD = 0.78;

export interface DuplicateIntentCandidate {
  semanticRootId: string;
  communicationIntent: CommunicationIntent;
  embedding: number[] | null;
}

/**
 * Pure evaluation. Deterministic given the same inputs; no I/O, no clock.
 */
export function evaluateDuplicateIntent(params: {
  candidate: DuplicateIntentCandidate;
  existing: CommunicationRecord[];
  comparator: SemanticIntentComparator;
}): DuplicateIntentVerdict {
  const { candidate, existing, comparator } = params;

  // Trivially unique — nothing prior to duplicate.
  if (existing.length === 0) {
    return {
      decision: 'unique',
      basis: 'none',
      maxSimilarity: null,
      candidatesConsidered: 0,
      note: 'no prior communications',
    };
  }

  // Tier 1 — deterministic root match (same intent seed by construction).
  const rootMatch = existing.find((r) => r.semanticRootId === candidate.semanticRootId);
  if (rootMatch) {
    return {
      decision: 'duplicate_intent',
      basis: 'root_id',
      maxSimilarity: 1,
      matchedRecordId: rootMatch.id,
      matchedRootId: rootMatch.semanticRootId,
      matchedIntent: rootMatch.communicationIntent,
      candidatesConsidered: existing.length,
      note: 'shared semantic root',
    };
  }

  // Tier 2 — semantic embedding cosine.
  if (candidate.embedding && candidate.embedding.length > 0) {
    let best: { sim: number; rec: CommunicationRecord } | null = null;
    let comparable = 0;
    for (const rec of existing) {
      const vec = rec.embedding?.vector;
      if (!vec || vec.length !== candidate.embedding.length) continue;
      comparable += 1;
      const sim = comparator.similarity(candidate.embedding, vec);
      if (!best || sim > best.sim) best = { sim, rec };
    }

    if (comparable > 0 && best) {
      const decision =
        best.sim >= DUPLICATE_INTENT_THRESHOLD ? 'duplicate_intent'
        : best.sim >= RELATED_INTENT_THRESHOLD ? 'related'
        : 'unique';
      return {
        decision,
        basis: 'embedding',
        maxSimilarity: best.sim,
        matchedRecordId: decision === 'unique' ? null : best.rec.id,
        matchedRootId: decision === 'unique' ? null : best.rec.semanticRootId,
        matchedIntent: decision === 'unique' ? null : best.rec.communicationIntent,
        candidatesConsidered: comparable,
        note: `embedding cosine (max ${best.sim.toFixed(3)})`,
      };
    }
    // Candidate embeddable but no prior carries a comparable vector.
    return {
      decision: 'not_evaluable',
      basis: 'none',
      maxSimilarity: null,
      candidatesConsidered: 0,
      note: 'no comparable prior embeddings',
    };
  }

  // No root match and no embedding for the candidate — cannot assess semantically.
  return {
    decision: 'not_evaluable',
    basis: 'none',
    maxSimilarity: null,
    candidatesConsidered: existing.length,
    note: 'candidate not embedded; semantic comparison unavailable',
  };
}

/**
 * Coordination Intelligence Layer — semantic comparator implementations.
 *
 * CONSUMES the frozen embedding seam (`signalEmbeddingService`) — it never
 * re-implements embedding or cosine. Two implementations of the port:
 *
 *  - `embeddingSeamComparator` (default): embeds topic seeds via the frozen seam,
 *    gated by `COORDINATION_SEMANTIC_EMBEDDING_ENABLED`. Fail-open: any failure
 *    (disabled flag, provider error, empty input) returns `null`, which the
 *    detector treats as `not_evaluable` — never a fabricated similarity.
 *  - `inertComparator`: never embeds (returns null), but still exposes cosine for
 *    callers that supply their own vectors. The safe default for tests and for
 *    the inert foundation state.
 */
import { generateTopicEmbedding, cosineSimilarity } from '../../signalEmbeddingService';
import { isCoordinationEmbeddingEnabled } from './coordinationFlags';
import type { SemanticIntentComparator } from './coordinationContracts';

export const embeddingSeamComparator: SemanticIntentComparator = {
  async embed(text: string, companyId: string): Promise<number[] | null> {
    if (!isCoordinationEmbeddingEnabled()) return null;
    if (!text || !text.trim() || !companyId) return null;
    try {
      // `system: true` attributes cost to the platform, not an end-user.
      return await generateTopicEmbedding(text, {
        companyId,
        system: true,
        metadata: { surface: 'coordination.intent' },
      });
    } catch {
      return null; // fail-open → not_evaluable; the layer never fabricates uniqueness
    }
  },
  similarity: (a: number[], b: number[]): number => cosineSimilarity(a, b),
};

/** Embedding-free comparator — safe default (foundation/tests). */
export const inertComparator: SemanticIntentComparator = {
  async embed(): Promise<number[] | null> { return null; },
  similarity: (a: number[], b: number[]): number => cosineSimilarity(a, b),
};

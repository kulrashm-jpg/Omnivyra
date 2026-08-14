/**
 * B7.8 — ON-DEMAND ASYNCHRONOUS EMBEDDING TRIGGER.
 *
 * Makes B7.7 operationally executable: an operator asks for one topic to be
 * embedded, the request returns immediately, and candidates become retrievable
 * once the provider call completes.
 *
 * ── WHY IN-PROCESS FIRE-AND-FORGET, NOT A QUEUE ────────────────────────────
 * BullMQ exists, but a NEW queue only does work if a consumer drains it, which
 * requires registration in workerTopologyManifest AND a Railway worker deploy.
 * B7.8 forbids deployment, so adding a queue would ship exactly the dead
 * infrastructure `automationTaskQueue` already documents ("NO producer and NO
 * consumer"). Deferring instead to the established in-repo `void promise`
 * pattern (aiGatewayProvidersOps logUsageEvent, boltScheduleBlockProcessor
 * enqueue) keeps the work executable today with no new infrastructure.
 *
 * RESIDUAL LIMITATION, stated rather than hidden: work started this way does
 * NOT survive a process restart, and there is no automatic retry. A topic whose
 * generation was interrupted simply keeps `embedding IS NULL` and is eligible
 * again on the next trigger — the operator re-triggers. That is acceptable
 * because embedding is enrichment, never a correctness gate.
 *
 * ── EMBEDDINGS REMAIN RECALL ONLY ──────────────────────────────────────────
 * This module starts an embedding and (on success) warms candidates. It never
 * writes canonical_topic_id or parent_topic_id, never merges, never deletes,
 * never rewrites a label, and never touches coverage. B7.5's curation writer,
 * driven by a human, remains the only path to identity.
 */

import { supabase } from '../../../db/supabaseClient';
import { generatePlatformEmbedding } from '../../signalEmbeddingService';

import {
  generateTopicEmbedding,
  findTopicCandidates,
  parseEmbedding,
  type EmbedderDeps,
} from './topicCandidateService';

const TABLE = 'platform_topic_node';

/** Dedicated operational flag, independent of every other knowledge-graph switch. */
export const PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV = 'PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENABLED';
const AFFIRMATIVE = /^(1|true|on|yes)$/;

/**
 * House convention: default DENY, evaluated at CALL TIME (not module load), so a
 * runtime change takes effect without a rebuild. Malformed ⇒ disabled.
 */
export function isTopicEmbeddingEnabled(): boolean {
  return AFFIRMATIVE.test(
    String(process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] ?? '').trim().toLowerCase(),
  );
}

export type TriggerOutcome =
  | { ok: true; status: 'accepted' }              // work started; poll for candidates
  | { ok: true; status: 'already_embedded' }      // nothing to do
  | { ok: true; status: 'in_flight' }             // a peer is already generating
  | { ok: false; status: 'disabled' | 'not_found' | 'missing_topic_id' | 'error'; reason?: string };

/**
 * In-flight guard: topic ids currently being embedded IN THIS PROCESS.
 *
 * This collapses the common double-click / double-request case into one
 * provider call. It is deliberately NOT presented as exactly-once: across
 * multiple server instances two processes could still each start a generation
 * for the same topic. The consequence is bounded and benign — one redundant
 * provider call for one short label, and the second write simply stores an
 * equivalent vector. A database-level lock would be needed for true
 * serialization, which would require schema this phase must not add.
 */
const inFlight = new Set<string>();

/** Exposed for tests; never used by production callers. */
export function _inFlightSize(): number { return inFlight.size; }

/**
 * B7.8-C.3 — the PRODUCTION dependency.
 *
 * Adapts generatePlatformEmbedding (B7.8-C.2) to the EmbedderDeps shape the
 * trigger was designed around in B7.7. The DI seam is preserved, not bypassed:
 * a test still injects a fake embedder and never touches OpenAI.
 *
 * `recordUsage` is deliberately LEFT UNDEFINED. generatePlatformEmbedding
 * already writes platform_usage_events itself; supplying a second recorder
 * here would double-count the same provider call.
 *
 * The provider path returns a typed failure (pricing_missing, provider_failed,
 * invalid_embedding_shape, ledger_failed). This adapter maps every one of them
 * to `null`, which generateTopicEmbedding treats as
 * `invalid_or_missing_embedding` and therefore does NOT persist — preserving
 * the C.2 guarantee that a vector is never stored without its spend record.
 */
export function platformEmbedderFor(topicId: string): EmbedderDeps {
  return {
    embed: async (text: string) => {
      const out = await generatePlatformEmbedding(text, {
        resourceType: 'platform_topic_node',
        resourceId: topicId,
      });
      return out.ok ? out.embedding : null;
    },
  };
}

/**
 * Request embedding + candidate warming for ONE topic. Returns immediately.
 *
 * Eligibility (all must hold): flag enabled · topic exists · no usable
 * embedding · not already in flight. Anything else short-circuits with a typed
 * status and NO provider call.
 */
export async function requestTopicEmbedding(
  topicId: string,
  deps?: EmbedderDeps,
): Promise<TriggerOutcome> {
  if (!topicId) return { ok: false, status: 'missing_topic_id' };

  // Flag first: a disabled system must make no query and no provider call.
  if (!isTopicEmbeddingEnabled()) return { ok: false, status: 'disabled' };

  try {
    const { data, error } = await supabase
      .from(TABLE).select('id, embedding').eq('id', topicId).maybeSingle();
    if (error || !data) return { ok: false, status: 'not_found' };

    // Already embedded ⇒ no provider call. generateTopicEmbedding is idempotent
    // too, but short-circuiting here avoids even starting the async work.
    if (parseEmbedding((data as { embedding: unknown }).embedding)) {
      return { ok: true, status: 'already_embedded' };
    }

    if (inFlight.has(topicId)) return { ok: true, status: 'in_flight' };
    inFlight.add(topicId);

    // ── fire-and-forget ──────────────────────────────────────────────────
    // Deliberately NOT awaited: the caller returns 202 while this continues.
    // The whole body is guarded so a rejection can never surface as an
    // unhandled promise, and the in-flight entry is always released.
    // Default to the production platform embedder; tests inject their own.
    const embedder: EmbedderDeps = deps ?? platformEmbedderFor(topicId);

    void (async () => {
      try {
        const result = await generateTopicEmbedding(topicId, embedder);
        // Warm candidates only on success. findTopicCandidates is READ-ONLY —
        // it returns evidence for a human and writes nothing, so this cannot
        // become an identity decision.
        if (!('reason' in result)) {
          await findTopicCandidates(topicId);
        }
      } catch {
        /* contained: a failure leaves embedding NULL and the topic retriggerable */
      } finally {
        inFlight.delete(topicId);
      }
    })();

    return { ok: true, status: 'accepted' };
  } catch (e) {
    inFlight.delete(topicId);
    return { ok: false, status: 'error', reason: (e as Error)?.message ?? 'unknown' };
  }
}

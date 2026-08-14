/**
 * B7.5 — CANONICAL TOPIC CURATION WRITER.
 *
 * The deterministic confirmation mechanism B7.4 found missing. An authorized
 * platform operator states that one existing topic identity is canonical under
 * another; nothing here infers, scores, or embeds.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * B7.3 measured that label-level embeddings cannot separate semantic
 * equivalence (0.6498–0.7906) from topical relatedness (0.2919–0.7594) — the
 * ranges overlap, and a genuinely distinct topic ("AI lead scoring models",
 * 0.7594) outscored five of six true equivalents. So no similarity threshold
 * may decide identity. B7.4 then found that every deterministic confirmation
 * mechanism is already exhausted by the exact-match stage, and that
 * `canonical_topic_id` had no writer at all.
 *
 * Human confirmation IS a deterministic rule. This module is that writer, and
 * it is the whole of B7.5: no embeddings, no ANN, no LLM, no threshold.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *   · never deletes a topic — a merge is reversible precisely because both
 *     rows survive; `canonical_topic_id = NULL` fully undoes it
 *   · never rewrites normalized_label (identity keys stay stable)
 *   · never touches parent_topic_id (hierarchy is a separate curation axis)
 *   · never migrates company_topic_coverage — coverage keeps pointing at the
 *     topic it was recorded against, so history stays truthful. Readers follow
 *     canonical_topic_id at query time instead.
 *   · never infers semantic equivalence
 *
 * ── PLATFORM SCOPE ─────────────────────────────────────────────────────────
 * platform_topic_node is tenant-less by construction (no company_id/campaign_id/
 * content_id). This module takes no tenant parameter, so a company-scoped
 * caller cannot use it to reach company data — there is none to reach.
 * Authorization is platform-tier and belongs to the route.
 */

import { supabase } from '../../../db/supabaseClient';

const TABLE = 'platform_topic_node';

/** How deep an alias chain may be walked before we refuse. Guards against a
 *  pre-existing cycle in data, not just cycles this write would create. */
const MAX_CHAIN_DEPTH = 32;

export type CurationFailure =
  | 'missing_topic_id'
  | 'missing_canonical_topic_id'
  | 'self_reference'
  | 'source_not_found'
  | 'canonical_not_found'
  | 'canonical_is_alias'
  | 'would_create_cycle'
  | 'chain_too_deep'
  | 'write_failed'
  | 'exception';

export type CurationResult =
  | { ok: true; action: 'confirmed' | 'already_confirmed' | 'rechained'; topicId: string; canonicalTopicId: string }
  | { ok: true; action: 'reversed' | 'already_reversed'; topicId: string; canonicalTopicId: null }
  | { ok: false; reason: CurationFailure; detail?: string };

type NodeRow = { id: string; canonical_topic_id: string | null };

async function loadNode(id: string): Promise<NodeRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, canonical_topic_id')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as NodeRow;
}

/**
 * Would setting `topicId.canonical_topic_id = canonicalTopicId` create a cycle?
 *
 * Walk the alias chain UP from the proposed canonical. If we reach the source
 * topic, the edge would close a loop (A→B plus B→A, or any longer ring).
 * Depth-bounded so a cycle already present in the data cannot spin forever.
 */
async function wouldCreateCycle(
  topicId: string,
  canonicalTopicId: string,
): Promise<{ cycle: boolean; tooDeep: boolean }> {
  let cursor: string | null = canonicalTopicId;
  const seen = new Set<string>();

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (cursor === null) return { cycle: false, tooDeep: false };
    if (cursor === topicId) return { cycle: true, tooDeep: false };   // closes a ring
    if (seen.has(cursor)) return { cycle: false, tooDeep: true };     // pre-existing loop
    seen.add(cursor);

    const node = await loadNode(cursor);
    if (!node) return { cycle: false, tooDeep: false };               // chain ends
    cursor = node.canonical_topic_id;
  }
  return { cycle: false, tooDeep: true };
}

/**
 * Confirm that `topicId` is an alias of `canonicalTopicId`.
 *
 * Idempotent: repeating the same confirmation reports `already_confirmed` and
 * writes nothing. Re-pointing an existing alias at a different canonical is
 * allowed but reported distinctly as `rechained`, so it is never mistaken for
 * a no-op in an audit trail.
 *
 * NEVER THROWS — returns a typed failure so a route can respond deterministically.
 */
export async function confirmCanonicalTopic(
  topicId: string,
  canonicalTopicId: string,
): Promise<CurationResult> {
  if (!topicId) return { ok: false, reason: 'missing_topic_id' };
  if (!canonicalTopicId) return { ok: false, reason: 'missing_canonical_topic_id' };
  // Rule 4. The database CHECK also forbids this; refusing here gives the
  // operator a precise reason instead of a constraint-violation string.
  if (topicId === canonicalTopicId) return { ok: false, reason: 'self_reference' };

  try {
    const source = await loadNode(topicId);
    if (!source) return { ok: false, reason: 'source_not_found' };

    const canonical = await loadNode(canonicalTopicId);
    if (!canonical) return { ok: false, reason: 'canonical_not_found' };

    // Rule 5: the target must be a real identity, not itself an alias.
    // Allowing alias→alias would build chains that readers must walk, and each
    // hop is a place for a stale or looping pointer to hide. Aliases stay flat.
    if (canonical.canonical_topic_id) {
      return {
        ok: false,
        reason: 'canonical_is_alias',
        detail: `target already aliases ${canonical.canonical_topic_id}; point at the identity instead`,
      };
    }

    // Rule 8: idempotency — same edge already present.
    if (source.canonical_topic_id === canonicalTopicId) {
      return { ok: true, action: 'already_confirmed', topicId, canonicalTopicId };
    }

    // Rule 6: cycle prevention.
    const { cycle, tooDeep } = await wouldCreateCycle(topicId, canonicalTopicId);
    if (cycle) return { ok: false, reason: 'would_create_cycle' };
    if (tooDeep) return { ok: false, reason: 'chain_too_deep' };

    // Rule 7: an existing but DIFFERENT canonical is re-chained deliberately,
    // and reported as such rather than silently overwritten.
    const action = source.canonical_topic_id ? 'rechained' : 'confirmed';

    // Concurrency: the update is conditioned on the canonical value we read.
    // A racing writer that changed it in between matches 0 rows, so the loser
    // re-reads rather than clobbering — no lost update.
    let q = supabase.from(TABLE).update({ canonical_topic_id: canonicalTopicId }).eq('id', topicId);
    q = source.canonical_topic_id === null
      ? q.is('canonical_topic_id', null)
      : q.eq('canonical_topic_id', source.canonical_topic_id);

    const { error } = await q;
    if (error) return { ok: false, reason: 'write_failed', detail: error.message };

    return { ok: true, action, topicId, canonicalTopicId };
  } catch (e) {
    return { ok: false, reason: 'exception', detail: (e as Error)?.message ?? 'unknown' };
  }
}

/**
 * Remove a previously confirmed relationship: `canonical_topic_id = NULL`.
 *
 * This is what makes a merge reversible, and it is why confirmation never
 * deletes a row or rewrites a label — the alias remains a full identity that
 * simply stops pointing anywhere. Idempotent; never throws.
 */
export async function reverseCanonicalTopic(topicId: string): Promise<CurationResult> {
  if (!topicId) return { ok: false, reason: 'missing_topic_id' };

  try {
    const source = await loadNode(topicId);
    if (!source) return { ok: false, reason: 'source_not_found' };

    if (source.canonical_topic_id === null) {
      return { ok: true, action: 'already_reversed', topicId, canonicalTopicId: null };
    }

    const { error } = await supabase
      .from(TABLE)
      .update({ canonical_topic_id: null })
      .eq('id', topicId)
      .eq('canonical_topic_id', source.canonical_topic_id);   // conditional: no lost update

    if (error) return { ok: false, reason: 'write_failed', detail: error.message };
    return { ok: true, action: 'reversed', topicId, canonicalTopicId: null };
  } catch (e) {
    return { ok: false, reason: 'exception', detail: (e as Error)?.message ?? 'unknown' };
  }
}

/**
 * B7.2 — PLATFORM TOPIC RESOLUTION.
 *
 * Resolves a content topic signal to a canonical identity in
 * `platform_topic_node` (B7.1). Platform-wide and tenant-less: this module has
 * no companyId parameter and never reads or writes one.
 *
 * ── DETERMINISTIC ONLY ─────────────────────────────────────────────────────
 * Resolution is normalize → exact normalized_label lookup → alias follow →
 * create. There is NO semantic-similarity branch, deliberately:
 *
 *   1. B7.0 left the similarity thresholds UNSET as calibration parameters.
 *      Choosing one here would be inventing a semantic — the exact thing the
 *      programme has refused at every prior phase.
 *   2. "Similar" is not "same". The platform topic graph is AUTHORITATIVE, so a
 *      wrong collapse is unrecoverable: it merges two distinct subjects and
 *      invalidates every coverage row pointing at them. Under-merging (two
 *      identities for one subject) is repairable later by setting
 *      canonical_topic_id; over-merging is not. B7.2 therefore fails toward
 *      under-merging.
 *   3. No content path supplies an embedding today — `originalityGate` accepts
 *      `options.embed` but NO production caller sets it, so the embedding
 *      dimension is inert in the content lane.
 *
 * A live embedding provider DOES exist (signalEmbeddingService,
 * text-embedding-3-small, 1536-dim). It is deliberately NOT called here: every
 * call is billed through usageLedgerService, and B7.2 must not attach a
 * per-acceptance cost to content creation. New nodes are stored with
 * `embedding = NULL`; B7.3 owns deliberate backfill + threshold calibration.
 *
 * ── WHAT THIS MODULE NEVER DOES ────────────────────────────────────────────
 *   · never mutates an existing canonical identity to improve matching
 *   · never creates a second identity for the same normalized label
 *   · never infers parent_topic_id (hierarchy stays curation-only, B7.1)
 *   · never fabricates an angle (B7.3 owns extraction)
 *   · never throws — every failure returns a typed 'error' resolution
 */

import { supabase } from '../../../db/supabaseClient';
import { normalizeText } from '../../../../lib/content/originality/fingerprint';

const TABLE = 'platform_topic_node';

/** Env flag, house convention: default DENY. */
export const PLATFORM_KNOWLEDGE_GRAPH_ENV = 'PLATFORM_KNOWLEDGE_GRAPH_ENABLED';
const AFFIRMATIVE = /^(1|true|on|yes)$/;

export function isPlatformKnowledgeGraphEnabled(): boolean {
  return AFFIRMATIVE.test(
    String(process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] ?? '').trim().toLowerCase(),
  );
}

/* ── contracts ─────────────────────────────────────────────────────────── */

/** B7.1 vocabulary, reused verbatim. No new persisted state is introduced. */
export type KnowledgeState = 'unknown' | 'observed' | 'inferred' | 'confirmed' | 'corrected';
export type KnowledgeConfidence = 'none' | 'low' | 'medium' | 'high';

/**
 * The six resolution outcomes B7.2 must distinguish. They are NOT collapsed:
 * an alias and a canonical hit produce the same topicId but are different
 * facts, and a caller (or a later phase) must be able to tell them apart.
 */
export type TopicResolutionKind =
  | 'existing_canonical'  // A — exact hit on an identity
  | 'existing_alias'      // B — exact hit on an alias; topicId is its CANONICAL
  | 'existing_child'      // C — exact hit on a node that has a parent; distinct identity
  | 'new_topic'           // D — no hit; created
  | 'ambiguous'           // E — cannot resolve deterministically; nothing created
  | 'error';              // F — resolution failed; nothing created

export interface TopicResolution {
  kind: TopicResolutionKind;
  /** Canonical topic id. Aliases resolve THROUGH to their canonical. Null for ambiguous/error. */
  topicId: string | null;
  normalizedLabel: string;
  state: KnowledgeState;
  confidence: KnowledgeConfidence;
  /** Machine-readable diagnostic; never surfaced to a tenant. */
  reason: string;
}

/**
 * Deterministic label normalization.
 *
 * Reuses lib/content/originality/fingerprint.normalizeText (the same function
 * the fingerprint pipeline uses) then collapses runs of whitespace, so
 * normalization can never diverge between the two subsystems.
 */
export function normalizeTopicLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return normalizeText(raw).replace(/\s+/g, ' ').trim();
}

const AMBIGUOUS = (normalizedLabel: string, reason: string): TopicResolution => ({
  kind: 'ambiguous', topicId: null, normalizedLabel, state: 'unknown', confidence: 'none', reason,
});
const ERROR = (normalizedLabel: string, reason: string): TopicResolution => ({
  kind: 'error', topicId: null, normalizedLabel, state: 'unknown', confidence: 'none', reason,
});

type NodeRow = {
  id: string;
  canonical_topic_id: string | null;
  parent_topic_id: string | null;
  state?: string | null;
  confidence?: string | null;
};

/* ── resolution ────────────────────────────────────────────────────────── */

/**
 * Resolve a raw topic signal to a canonical topic id, creating one when the
 * label is genuinely unseen.
 *
 * NEVER THROWS. A resolver failure must not be able to fail content acceptance,
 * so every error path returns kind:'error' and the caller continues.
 */
export async function resolveTopicIdentity(
  rawLabel: unknown,
  opts: { source?: string; allowCreate?: boolean } = {},
): Promise<TopicResolution> {
  const normalized = normalizeTopicLabel(rawLabel);

  // E — no usable signal. Nothing is invented from an empty topic.
  if (!normalized) return AMBIGUOUS('', 'empty_or_non_string_topic_signal');

  try {
    // ── exact identity lookup (the only matching rule in B7.2) ────────────
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, canonical_topic_id, parent_topic_id, state, confidence')
      .eq('normalized_label', normalized)
      .maybeSingle();

    if (error) return ERROR(normalized, `lookup_failed:${error.message}`);

    if (data) {
      const row = data as NodeRow;

      // B — an alias resolves THROUGH to its canonical identity.
      if (row.canonical_topic_id) {
        return {
          kind: 'existing_alias',
          topicId: row.canonical_topic_id,
          normalizedLabel: normalized,
          state: (row.state as KnowledgeState) ?? 'observed',
          confidence: (row.confidence as KnowledgeConfidence) ?? 'none',
          reason: 'alias_followed_to_canonical',
        };
      }

      // C — a child is a distinct identity in its own right. It resolves to
      // ITSELF, never to its parent: collapsing a child into its parent would
      // destroy exactly the discrimination the hierarchy exists to provide
      // ("lead scoring" is not "AI lead qualification").
      if (row.parent_topic_id) {
        return {
          kind: 'existing_child',
          topicId: row.id,
          normalizedLabel: normalized,
          state: (row.state as KnowledgeState) ?? 'observed',
          confidence: (row.confidence as KnowledgeConfidence) ?? 'none',
          reason: 'child_topic_is_its_own_identity',
        };
      }

      // A — plain canonical identity.
      return {
        kind: 'existing_canonical',
        topicId: row.id,
        normalizedLabel: normalized,
        state: (row.state as KnowledgeState) ?? 'observed',
        confidence: (row.confidence as KnowledgeConfidence) ?? 'none',
        reason: 'exact_normalized_label_match',
      };
    }

    // ── D — genuinely unseen label ────────────────────────────────────────
    if (opts.allowCreate === false) {
      return AMBIGUOUS(normalized, 'no_exact_match_and_creation_disallowed');
    }
    return await createTopicIdentity(normalized, String(rawLabel).trim(), opts.source ?? 'content');
  } catch (e) {
    return ERROR(normalized, `resolver_exception:${(e as Error)?.message ?? 'unknown'}`);
  }
}

/**
 * Create a canonical identity, race-safely.
 *
 * UNIQUE(normalized_label) is the serialization boundary: two concurrent
 * resolutions of the same label cannot both insert. The loser catches the
 * unique violation and re-selects the winner's row, so concurrency yields ONE
 * identity and both callers receive the same topicId.
 *
 * embedding is deliberately left NULL — see the module header.
 * state='observed' because the label was genuinely seen in accepted content;
 * it is NOT 'confirmed' (that requires curation) and NOT 'inferred' (nothing
 * was inferred — this is a deterministic observation).
 */
async function createTopicIdentity(
  normalized: string,
  canonicalLabel: string,
  source: string,
): Promise<TopicResolution> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      canonical_label: canonicalLabel || normalized,
      normalized_label: normalized,
      state: 'observed',
      confidence: 'low',
      source,
    })
    .select('id')
    .maybeSingle();

  if (!error && data && (data as { id?: string }).id) {
    return {
      kind: 'new_topic',
      topicId: String((data as { id: string }).id),
      normalizedLabel: normalized,
      state: 'observed',
      confidence: 'low',
      reason: 'created_new_identity',
    };
  }

  // Lost a concurrent race (or any insert failure): re-read. If the row now
  // exists, a peer created it and we adopt their identity — the correct
  // outcome, and the reason this is idempotent rather than merely retried.
  const { data: existing } = await supabase
    .from(TABLE)
    .select('id, canonical_topic_id')
    .eq('normalized_label', normalized)
    .maybeSingle();

  if (existing && (existing as NodeRow).id) {
    const row = existing as NodeRow;
    return {
      kind: 'existing_canonical',
      topicId: row.canonical_topic_id ?? row.id,
      normalizedLabel: normalized,
      state: 'observed',
      confidence: 'low',
      reason: 'adopted_concurrently_created_identity',
    };
  }

  return ERROR(normalized, `create_failed:${error?.message ?? 'unknown'}`);
}

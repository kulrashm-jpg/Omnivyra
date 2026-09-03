/**
 * B5 — PLATFORM-WIDE CONTENT UNIQUENESS (tier 0, advisory).
 *
 * The fifth uniqueness tier, above company → campaign → content-type →
 * individual. It answers "is this artifact novel across Omnivyra as a whole?"
 * without ever being able to say WHOSE content it resembles.
 *
 * ── THREE PROPERTIES THAT DEFINE THIS MODULE ───────────────────────────────
 *
 * 1. It cannot identify a tenant. `platform_content_fingerprint` has no
 *    company_id / campaign_id / content_id / user_id and no text column, so
 *    there is nothing in a row to attribute. This module therefore contains no
 *    tenant parameter at all — not even an optional one.
 *
 * 2. It can never block. There is no `throw` anywhere below, and every failure
 *    path returns a NOVEL signal. A platform collision produces advice, never a
 *    rejection: one tenant's corpus must never become a denial-of-service
 *    against another's generation. This is why CampaignDuplicateContentError is
 *    NOT reused — campaign scope legitimately throws, platform scope must not.
 *
 * 3. It is unreachable from any client API. No route imports this module (a
 *    test enforces that). Without that constraint, a caller who could submit
 *    chosen text and observe a collision would have a confirmation oracle over
 *    the whole platform corpus.
 *
 * ── WHAT MAY CROSS THE TENANT BOUNDARY ─────────────────────────────────────
 *   allowed : similarity score · collision band · abstract dimensions
 *   never   : content body · excerpt · source id · company id · campaign id
 *
 * `exact` and `normalized` are computed for storage dedup but are deliberately
 * EXCLUDED from the returned dimensions — surfacing them would make a
 * byte-identical probe distinguishable from a merely-similar one, which is the
 * oracle above.
 *
 * ── CALIBRATION, NOT SEMANTICS ─────────────────────────────────────────────
 * The collision threshold and retention window are deliberately UNSET. The
 * campaign tier's 0.82 is not carried over: a platform-wide corpus has a very
 * different similarity distribution than one campaign, and picking a number
 * without measuring it would be inventing a semantic. With no configured
 * threshold the tier is INERT — it reports a band of 'novel' and never advises
 * regeneration. See resolvePlatformConfig() below.
 */

import { supabase } from '../../db/supabaseClient';
import {
  simhashSimilarity,
  minhashJaccard,
  structuralSimilarity,
  cosine,
} from '../../../lib/content/originality/similarity';
// ContentFingerprint is declared in ./types (fingerprint.ts consumes it but does
// not re-export it), so the type import must come from there.
import type { ContentFingerprint } from '../../../lib/content/originality/types';

/** Reuses the gate's candidate cap; no second retrieval policy is introduced. */
export const DEFAULT_MAX_CANDIDATES = 50;

const TABLE = 'platform_content_fingerprint';
const MODALITY_TEXT = 'text';

/** Env flag. Default DENY, matching the house convention. */
export const PLATFORM_UNIQUENESS_ENV = 'PLATFORM_UNIQUENESS_ENABLED';
const AFFIRMATIVE = /^(1|true|on|yes)$/;

export function isPlatformUniquenessEnabled(): boolean {
  return AFFIRMATIVE.test(String(process.env[PLATFORM_UNIQUENESS_ENV] ?? '').trim().toLowerCase());
}

/* ── contracts ─────────────────────────────────────────────────────────── */

/**
 * The ONLY thing that crosses the tenant boundary.
 *
 * Structurally has no memoryId, no excerpt, no companyId, no contentId and no
 * campaignId — the omission is the security control, so this type must never
 * be merged with NearestMatch (which carries memoryId + excerpt by design for
 * the INTRA-company tiers).
 */
export interface PlatformNoveltySignal {
  band: 'novel' | 'adjacent' | 'saturated';
  score: number;
  dimensions: Partial<Record<'simhash' | 'semantic' | 'structural' | 'embedding', number>>;
}

/**
 * Evaluation input. Carries the candidate's OWN fingerprint and its format —
 * nothing that could identify a tenant. There is deliberately no companyId
 * parameter: a caller cannot pass one even by mistake.
 */
export interface PlatformEvaluationInput {
  fingerprint: ContentFingerprint;
  contentType: string;
  /** Present only when the caller already computed one; never fetched here. */
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: number | null;
  maxCandidates?: number;
}

/**
 * A neighbour row as this module sees it. Note what is NOT here: no id is
 * carried forward, because nothing downstream may reference a specific row.
 */
export interface PlatformNeighbour {
  simhash: string;
  minhash: number[] | null;
  structuralShape: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingVersion: number | null;
}

/** Injected so evaluation is testable with no database. */
export type PlatformNeighbourRetriever = (
  input: PlatformEvaluationInput,
) => Promise<PlatformNeighbour[]>;

/**
 * Calibration parameters. Both are intentionally unset until measured against a
 * real corpus in a non-production environment (B5 spec §23). `thresholds`
 * absent ⇒ the tier is inert.
 */
export interface PlatformConfig {
  /** Score at/below which a candidate is 'saturated'. Unset ⇒ inert. */
  collisionThreshold?: number;
  /** Score at/below which a candidate is 'adjacent'. Unset ⇒ inert. */
  adjacentThreshold?: number;
}

const INERT_CONFIG: PlatformConfig = {};

/**
 * Resolve calibration from env. Values are PROVISIONAL SIMULATION PARAMETERS
 * only — nothing here is a production-approved number, and absent env vars
 * (the default, including in production) yield an inert tier.
 */
export function resolvePlatformConfig(): PlatformConfig {
  const num = (k: string): number | undefined => {
    const raw = String(process.env[k] ?? '').trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
  };
  const collision = num('PLATFORM_UNIQUENESS_COLLISION_THRESHOLD');
  const adjacent = num('PLATFORM_UNIQUENESS_ADJACENT_THRESHOLD');
  if (collision === undefined && adjacent === undefined) return INERT_CONFIG;
  return {
    ...(collision !== undefined ? { collisionThreshold: collision } : {}),
    ...(adjacent !== undefined ? { adjacentThreshold: adjacent } : {}),
  };
}

/* ── stage 1+2: retrieval (DB-bound, replaceable) ──────────────────────── */

/**
 * Two-stage retrieval, mirroring the cascade the gate already uses.
 *
 *   stage 1  simhash / structural-shape blocking — B-tree, no vector scan
 *   stage 2  HNSW cosine ANN over embedding, only when one was supplied
 *
 * Fail-safe by contract: ANY error returns [] so the caller degrades to NOVEL
 * rather than failing. No tenant column is referenced because none exists.
 */
export const retrievePlatformNeighbours: PlatformNeighbourRetriever = async (input) => {
  const limit = Math.max(1, input.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const rows: Record<string, unknown>[] = [];

  // Stage 1 — cheap blocking on format + signature/shape.
  try {
    const orParts = [`simhash.eq.${input.fingerprint.simhash}`];
    if (input.fingerprint.structuralShape) {
      orParts.push(`structural_shape.eq.${input.fingerprint.structuralShape}`);
    }
    const { data, error } = await supabase
      .from(TABLE)
      .select('simhash, minhash, structural_shape, embedding, embedding_model, embedding_version')
      .eq('modality', MODALITY_TEXT)
      .eq('content_type', input.contentType)
      .or(orParts.join(','))
      .limit(limit);
    if (!error && Array.isArray(data)) rows.push(...(data as Record<string, unknown>[]));
  } catch {
    /* fail-safe: an unreachable store must degrade, never throw */
  }

  // Stage 2 — semantic neighbourhood. Only when the caller supplied a vector
  // AND we have room left; the blocking stage is always preferred.
  if (input.embedding && input.embedding.length > 0 && rows.length < limit) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('simhash, minhash, structural_shape, embedding, embedding_model, embedding_version')
        .eq('modality', MODALITY_TEXT)
        .eq('content_type', input.contentType)
        .not('embedding', 'is', null)
        .limit(limit - rows.length);
      if (!error && Array.isArray(data)) rows.push(...(data as Record<string, unknown>[]));
    } catch {
      /* fail-safe */
    }
  }

  return rows.map(mapNeighbour);
};

function mapNeighbour(row: Record<string, unknown>): PlatformNeighbour {
  const emb = row.embedding;
  return {
    simhash: String(row.simhash ?? ''),
    minhash: Array.isArray(row.minhash) ? (row.minhash as number[]) : null,
    structuralShape: row.structural_shape == null ? null : String(row.structural_shape),
    embedding: Array.isArray(emb) ? (emb as number[]) : null,
    embeddingModel: row.embedding_model == null ? null : String(row.embedding_model),
    embeddingVersion:
      row.embedding_version == null ? null : Number(row.embedding_version),
  };
}

/* ── similarity + classification (pure, deterministic) ─────────────────── */

/**
 * Maximum similarity per dimension across the neighbour set. Pure: no clock,
 * no randomness, no I/O — identical inputs always give identical output.
 *
 * exact/normalized hashes are NOT compared here. They exist only for storage
 * dedup; comparing them would put an exact-match signal one step from the
 * returned dimensions.
 */
export function computePlatformDimensions(
  input: PlatformEvaluationInput,
  neighbours: readonly PlatformNeighbour[],
): PlatformNoveltySignal['dimensions'] {
  const dims: PlatformNoveltySignal['dimensions'] = {};
  const fp = input.fingerprint;
  const best = (k: keyof typeof dims, v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    if (dims[k] === undefined || v > (dims[k] as number)) dims[k] = v;
  };

  for (const n of neighbours) {
    if (n.simhash) best('simhash', simhashSimilarity(fp.simhash, n.simhash));
    if (n.minhash && fp.minhash) best('semantic', minhashJaccard(fp.minhash, n.minhash));
    if (n.structuralShape && fp.structuralShape) {
      best('structural', structuralSimilarity(fp.structuralShape, n.structuralShape));
    }
    // Embeddings from different model generations are silently meaningless to
    // compare, so a mismatch SKIPS the dimension rather than producing a number.
    if (
      input.embedding && input.embedding.length > 0 &&
      n.embedding && n.embedding.length === input.embedding.length &&
      n.embeddingModel === (input.embeddingModel ?? null) &&
      n.embeddingVersion === (input.embeddingVersion ?? null)
    ) {
      best('embedding', cosine(input.embedding, n.embedding));
    }
  }
  return dims;
}

/**
 * Classify a novelty score into a band.
 *
 * With an INERT config (no thresholds measured yet — the default everywhere,
 * including production) this always returns 'novel', so an uncalibrated tier
 * can never advise regeneration or emit a warning.
 */
export function classifyBand(score: number, config: PlatformConfig): PlatformNoveltySignal['band'] {
  if (config.collisionThreshold !== undefined && score <= config.collisionThreshold) {
    return 'saturated';
  }
  if (config.adjacentThreshold !== undefined && score <= config.adjacentThreshold) {
    return 'adjacent';
  }
  return 'novel';
}

/** score = 1 − maxSimilarity, matching the gate's convention. */
export function scoreFromDimensions(dims: PlatformNoveltySignal['dimensions']): number {
  const vals = Object.values(dims).filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return 1;
  return Math.max(0, Math.min(1, 1 - Math.max(...vals)));
}

/** The signal returned whenever we cannot or should not judge. */
export function novelSignal(): PlatformNoveltySignal {
  return { band: 'novel', score: 1, dimensions: {} };
}

/* ── public evaluation entry point ─────────────────────────────────────── */

/**
 * Evaluate platform novelty. NEVER throws and NEVER blocks: every failure —
 * unreachable store, malformed row, missing embedding, unconfigured threshold —
 * degrades to a NOVEL signal and lets generation continue.
 */
export async function evaluatePlatformNovelty(
  input: PlatformEvaluationInput,
  deps: { retrieve?: PlatformNeighbourRetriever; config?: PlatformConfig } = {},
): Promise<PlatformNoveltySignal> {
  try {
    const retrieve = deps.retrieve ?? retrievePlatformNeighbours;
    const config = deps.config ?? resolvePlatformConfig();
    const neighbours = await retrieve(input);
    if (!Array.isArray(neighbours) || neighbours.length === 0) return novelSignal();

    const dimensions = computePlatformDimensions(input, neighbours);
    const score = scoreFromDimensions(dimensions);
    return { band: classifyBand(score, config), score, dimensions };
  } catch {
    // Fail-open. A platform-tier failure must be invisible to generation.
    return novelSignal();
  }
}

/* ── persistence (acceptance only) ─────────────────────────────────────── */

export interface PlatformFingerprintRecord {
  fingerprint: ContentFingerprint;
  contentType: string;
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: number | null;
}

/**
 * Record an ACCEPTED artifact's fingerprint.
 *
 * Called only after final acceptance — rejected candidates and superseded
 * regeneration attempts never reach here, so the platform corpus contains only
 * content that was actually kept.
 *
 * Deduplicated by (modality, content_type, normalized_hash): a repeat refreshes
 * last_seen_at and increments occurrence_count instead of adding a row.
 *
 * Returns true when a row was written or refreshed. Fail-safe: a write failure
 * is swallowed and returns false — the artifact is already accepted, and this
 * store is best-effort by design.
 */
export async function recordPlatformFingerprint(
  input: PlatformFingerprintRecord,
): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const fp = input.fingerprint;

    // Dedup path: refresh the existing row rather than inserting a duplicate.
    const { data: existing } = await supabase
      .from(TABLE)
      .select('id, occurrence_count')
      .eq('modality', MODALITY_TEXT)
      .eq('content_type', input.contentType)
      .eq('normalized_hash', fp.normalizedHash)
      .maybeSingle();

    if (existing && (existing as { id?: string }).id) {
      const prior = Number((existing as { occurrence_count?: number }).occurrence_count ?? 1);
      const { error } = await supabase
        .from(TABLE)
        .update({ occurrence_count: prior + 1, last_seen_at: nowIso })
        .eq('id', (existing as { id: string }).id);
      return !error;
    }

    const { error } = await supabase.from(TABLE).insert({
      modality: MODALITY_TEXT,
      content_type: input.contentType,
      exact_hash: fp.exactHash,
      normalized_hash: fp.normalizedHash,
      simhash: fp.simhash,
      minhash: fp.minhash ?? null,
      structural_shape: fp.structuralShape ?? null,
      embedding: input.embedding ?? null,
      embedding_model: input.embeddingModel ?? null,
      embedding_version: input.embeddingVersion ?? null,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    });
    return !error;
  } catch {
    /* fail-safe: the artifact is already accepted; this store is best-effort */
    return false;
  }
}

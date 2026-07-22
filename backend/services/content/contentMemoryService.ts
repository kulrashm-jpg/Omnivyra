/**
 * Content Memory Service — Wave 2 durable content-intelligence layer.
 *
 * The company-scoped, durable knowledge base that makes every new generation
 * aware of the company's historical content. Backs three tables introduced by
 * supabase/migrations/20260718000001_content_intelligence_originality.sql:
 *
 *   - content_memory      : one row per indexed content unit (master or variant);
 *                           what assertOriginality() queries.
 *   - content_originality : the per-record originality decision + metadata.
 *   - brand_memory        : one row per company; the reusable brand rollup.
 *
 * Design notes (mirror the Wave 1 canonical contentService):
 *  - Reuses the shared service-role admin client (backend/db/supabaseClient).
 *    The service role bypasses RLS, so EVERY method is explicitly company-scoped.
 *  - Rows are snake_case; this service maps them to/from camelCase DTOs. Callers
 *    never see snake_case.
 *  - FAIL-SAFE: every method that supports a live generation (index / retrieve /
 *    brand read-write) is best-effort. A memory read/write failure MUST NOT throw
 *    into the caller — it logs and returns empty / null. Memory is an assist, not
 *    a gate; it can never break content creation.
 */

import { supabase } from '../../db/supabaseClient';
import { computeFingerprint } from '../../../lib/content/originality/fingerprint';
import {
  extractIntelligence,
  type ContentIntelligence,
} from '../../../lib/content/originality/intelligenceExtractor';
import type { OriginalityDecision, NearestMatch, SimilarityDimension } from '../../../lib/content/originality/types';

const MEMORY_TABLE = 'content_memory';
const ORIGINALITY_TABLE = 'content_originality';
const BRAND_TABLE = 'brand_memory';

/** Short excerpt length stored for diagnostics / nearest-match display. */
const EXCERPT_LEN = 280;

// Brand-memory rollup caps — keep the aggregate bounded no matter the history.
const VOICE_HOOKS_CAP = 25;
const TERMINOLOGY_CAP = 200;
const THEMES_CAP = 50;
const MESSAGING_HISTORY_CAP = 100;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** A single remembered content unit, camelCase, as the gate consumes it. */
export interface ContentMemoryRecord {
  id: string;
  companyId: string;
  contentId: string | null;
  campaignId: string | null;
  contentType: string;
  platform: string | null;
  lifecycleStatus: string | null;
  exactHash: string;
  normalizedHash: string;
  simhash: string;
  minhash: number[];
  structuralShape: string;
  tokenSummary: { tokens: string[]; shingles: string[] };
  embedding: number[] | null;
  intelligence: ContentIntelligence | null;
  textExcerpt: string | null;
  createdAt: string;
}

/** The company-level reusable brand intelligence rollup. */
export interface BrandMemory {
  companyId: string;
  voice: Record<string, unknown> | null;
  terminology: Record<string, unknown> | null;
  style: Record<string, unknown> | null;
  audience: Record<string, unknown> | null;
  campaignThemes: Record<string, unknown> | null;
  messagingHistory: string[] | null;
  updatedAt: string | null;
}

export interface IndexContentInput {
  companyId: string;
  contentId?: string | null;
  campaignId?: string | null;
  contentType: string;
  platform?: string | null;
  lifecycleStatus?: string | null;
  text: string;
  intelligence?: ContentIntelligence;
}

export interface RetrieveRelevantOptions {
  contentType?: string;
  campaignId?: string | null;
  platform?: string | null;
  /** Explicit lifecycle set; when omitted, the committed-content default is used. */
  lifecycleStatuses?: string[];
  limit?: number;
}

export interface PersistOriginalityInput {
  companyId: string;
  contentId?: string | null;
  originalityScore: number;
  decision: OriginalityDecision;
  nearestMatches: NearestMatch[];
  similarityDimensions: Partial<Record<SimilarityDimension, number>>;
  regenerationCount: number;
  /** Fingerprint of the accepted output (stored as text; e.g. exactHash). */
  generationFingerprint: string;
}

// ── mappers ──────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapMemoryRow(row: any): ContentMemoryRecord {
  const ts = row.token_summary ?? {};
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id ?? null,
    campaignId: row.campaign_id ?? null,
    contentType: row.content_type,
    platform: row.platform ?? null,
    lifecycleStatus: row.lifecycle_status ?? null,
    exactHash: row.exact_hash ?? '',
    normalizedHash: row.normalized_hash ?? '',
    simhash: row.simhash ?? '',
    minhash: Array.isArray(row.minhash) ? row.minhash : [],
    structuralShape: row.structural_shape ?? '',
    tokenSummary: {
      tokens: Array.isArray(ts.tokens) ? ts.tokens : [],
      shingles: Array.isArray(ts.shingles) ? ts.shingles : [],
    },
    embedding: Array.isArray(row.embedding) ? row.embedding : null,
    intelligence: (row.intelligence ?? null) as ContentIntelligence | null,
    textExcerpt: row.text_excerpt ?? null,
    createdAt: row.created_at,
  };
}

function mapBrandRow(row: any): BrandMemory {
  return {
    companyId: row.company_id,
    voice: (row.voice ?? null) as Record<string, unknown> | null,
    terminology: (row.terminology ?? null) as Record<string, unknown> | null,
    style: (row.style ?? null) as Record<string, unknown> | null,
    audience: (row.audience ?? null) as Record<string, unknown> | null,
    campaignThemes: (row.campaign_themes ?? null) as Record<string, unknown> | null,
    messagingHistory: Array.isArray(row.messaging_history) ? row.messaging_history : null,
    updatedAt: row.updated_at ?? null,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── logging (fail-safe; never rethrows) ──────────────────────────────────────

function logMemoryError(op: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[contentMemoryService] ${op} (non-fatal): ${message}`);
}

// ── index ────────────────────────────────────────────────────────────────────

/**
 * Compute the fingerprint + intelligence for a content unit, insert a
 * content_memory row, and best-effort refresh the company brand rollup.
 * FAIL-SAFE: any failure logs and returns null — indexing never breaks the
 * caller's generation flow.
 */
export async function indexContentUnit(
  input: IndexContentInput,
): Promise<ContentMemoryRecord | null> {
  try {
    const text = input.text ?? '';
    const fp = computeFingerprint(text);
    const intelligence = input.intelligence ?? extractIntelligence(text);

    const insertRow = {
      company_id: input.companyId,
      content_id: input.contentId ?? null,
      campaign_id: input.campaignId ?? null,
      content_type: input.contentType,
      platform: input.platform ?? null,
      lifecycle_status: input.lifecycleStatus ?? null,
      exact_hash: fp.exactHash,
      normalized_hash: fp.normalizedHash,
      simhash: fp.simhash,
      minhash: fp.minhash,
      structural_shape: fp.structuralShape,
      token_summary: fp.tokenSummary,
      embedding: null, // embedding stage is flag-gated OFF this wave
      intelligence,
      text_excerpt: text.slice(0, EXCERPT_LEN),
    };

    const { data, error } = await supabase
      .from(MEMORY_TABLE)
      .insert(insertRow)
      .select('*')
      .single();
    if (error || !data) {
      logMemoryError('indexContentUnit(insert)', error);
      return null;
    }

    // Best-effort brand rollup — a failure here never fails the index.
    await refreshBrandMemory(input.companyId, intelligence, fp.tokenSummary.tokens);

    return mapMemoryRow(data);
  } catch (error) {
    logMemoryError('indexContentUnit', error);
    return null;
  }
}

// ── retrieve ─────────────────────────────────────────────────────────────────

/**
 * The committed-content lifecycle statuses that seed the default candidate set.
 * Published/approved/scheduled content is what a new generation must not repeat.
 */
const COMMITTED_LIFECYCLE = ['published', 'approved', 'scheduled'];

/**
 * Retrieve the company's relevant content memory (recent-first) for the gate to
 * compare against. By default returns committed content (published/approved/
 * scheduled) PLUS all platform variants; when `lifecycleStatuses` is provided it
 * filters strictly to that set. FAIL-SAFE: on error logs and returns [].
 */
export async function retrieveRelevant(
  companyId: string,
  options: RetrieveRelevantOptions = {},
): Promise<ContentMemoryRecord[]> {
  try {
    const limit = options.limit ?? 50;
    let query = supabase
      .from(MEMORY_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options.contentType) query = query.eq('content_type', options.contentType);
    if (options.campaignId) query = query.eq('campaign_id', options.campaignId);
    if (options.platform) query = query.eq('platform', options.platform);

    if (options.lifecycleStatuses && options.lifecycleStatuses.length > 0) {
      // Explicit set → strict filter.
      query = query.in('lifecycle_status', options.lifecycleStatuses);
    } else {
      // Default: committed statuses OR any platform variant (item 3).
      const committed = COMMITTED_LIFECYCLE.join(',');
      query = query.or(`lifecycle_status.in.(${committed}),platform.not.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      logMemoryError('retrieveRelevant', error);
      return [];
    }
    return (data ?? []).map(mapMemoryRow);
  } catch (error) {
    logMemoryError('retrieveRelevant', error);
    return [];
  }
}

// ── originality persistence ──────────────────────────────────────────────────

/**
 * Persist a per-record originality decision alongside a canonical Content
 * record. FAIL-SAFE: analytics/diagnostics only — a failure logs and returns
 * null rather than blocking the accepted generation.
 */
export async function persistOriginality(
  input: PersistOriginalityInput,
): Promise<{ id: string } | null> {
  try {
    const { data, error } = await supabase
      .from(ORIGINALITY_TABLE)
      .insert({
        company_id: input.companyId,
        content_id: input.contentId ?? null,
        originality_score: input.originalityScore,
        decision: input.decision,
        nearest_matches: input.nearestMatches,
        similarity_dimensions: input.similarityDimensions,
        regeneration_count: input.regenerationCount,
        generation_fingerprint: input.generationFingerprint,
      })
      .select('id')
      .single();
    if (error || !data) {
      logMemoryError('persistOriginality', error);
      return null;
    }
    return { id: data.id };
  } catch (error) {
    logMemoryError('persistOriginality', error);
    return null;
  }
}

// ── brand memory ─────────────────────────────────────────────────────────────

/** Fetch the company brand rollup, or null. FAIL-SAFE. */
export async function getBrandMemory(companyId: string): Promise<BrandMemory | null> {
  try {
    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) {
      logMemoryError('getBrandMemory', error);
      return null;
    }
    return data ? mapBrandRow(data) : null;
  } catch (error) {
    logMemoryError('getBrandMemory', error);
    return null;
  }
}

/**
 * Upsert a partial patch onto the company brand rollup. FAIL-SAFE: on error
 * logs and returns null.
 */
export async function upsertBrandMemory(
  companyId: string,
  patch: Partial<Omit<BrandMemory, 'companyId' | 'updatedAt'>>,
): Promise<BrandMemory | null> {
  try {
    const row: Record<string, unknown> = { company_id: companyId };
    if ('voice' in patch) row.voice = patch.voice ?? null;
    if ('terminology' in patch) row.terminology = patch.terminology ?? null;
    if ('style' in patch) row.style = patch.style ?? null;
    if ('audience' in patch) row.audience = patch.audience ?? null;
    if ('campaignThemes' in patch) row.campaign_themes = patch.campaignThemes ?? null;
    if ('messagingHistory' in patch) row.messaging_history = patch.messagingHistory ?? null;

    const { data, error } = await supabase
      .from(BRAND_TABLE)
      .upsert(row, { onConflict: 'company_id' })
      .select('*')
      .single();
    if (error || !data) {
      logMemoryError('upsertBrandMemory', error);
      return null;
    }
    return mapBrandRow(data);
  } catch (error) {
    logMemoryError('upsertBrandMemory', error);
    return null;
  }
}

// ── brand rollup aggregation (best-effort) ───────────────────────────────────

/** Order-preserving de-dupe capped to the last `cap` entries (rolling ledger). */
function capTail(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Iterate from the end so the most-recent duplicates win, then restore order.
  for (let i = values.length - 1; i >= 0 && out.length < cap; i--) {
    const v = values[i].trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.reverse();
}

/** Order-preserving de-dupe capped to the first `cap` entries. */
function capHead(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Merge a freshly-indexed unit's intelligence into the company brand rollup.
 * Best-effort: reads current brand memory, folds in the new signals under the
 * caps, and upserts. Never throws.
 */
async function refreshBrandMemory(
  companyId: string,
  intelligence: ContentIntelligence,
  tokens: string[],
): Promise<void> {
  try {
    const current = await getBrandMemory(companyId);

    const prevHooks = asStringArray(current?.voice?.['hooks']);
    const prevTerms = asStringArray(current?.terminology?.['terms']);
    const prevThemes = asStringArray(current?.campaignThemes?.['themes']);
    const prevMessages = current?.messagingHistory ?? [];

    const voice = { hooks: capHead([...prevHooks, ...intelligence.hooks], VOICE_HOOKS_CAP) };
    const terminology = { terms: capHead([...prevTerms, ...tokens], TERMINOLOGY_CAP) };
    const campaignThemes = {
      themes: capHead([...prevThemes, ...intelligence.narratives], THEMES_CAP),
    };
    const messagingHistory = capTail(
      [...prevMessages, ...intelligence.keyMessages],
      MESSAGING_HISTORY_CAP,
    );

    await upsertBrandMemory(companyId, {
      voice,
      terminology,
      campaignThemes,
      messagingHistory,
    });
  } catch (error) {
    logMemoryError('refreshBrandMemory', error);
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

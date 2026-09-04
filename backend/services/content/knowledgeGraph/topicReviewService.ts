/**
 * B7.6 — CANONICAL TOPIC REVIEW (read-only).
 *
 * Gives an authorized platform operator the minimum information needed to
 * answer one question: "are these two topic identities the same canonical
 * topic?" It is a READER — it never writes. `topicCurationService` (B7.5)
 * remains the ONLY mechanism that may change `canonical_topic_id`.
 *
 * ── CANDIDATE SOURCE ───────────────────────────────────────────────────────
 * There is no semantic candidate generator, and B7.6 must not invent one. So
 * this module exposes the graph's ACTUAL state rather than manufactured pairs:
 *
 *   · `identities`  — topics with canonical_topic_id IS NULL (pairable)
 *   · `aliases`     — topics with canonical_topic_id set (reviewable/reversible)
 *   · `byIds`       — explicit lookup, for an operator pairing two ids by hand
 *
 * Every row is real graph state. B7.7 becomes the candidate provider; until
 * then the operator supplies the pairing judgement, which is precisely the
 * deterministic confirmation B7.4 found missing.
 *
 * ── TENANT SAFETY ──────────────────────────────────────────────────────────
 * platform_topic_node is tenant-less: no company_id, campaign_id, content_id or
 * content text exists to return. This module takes no companyId parameter and
 * selects an explicit column list, so a future column addition cannot silently
 * widen the payload. Embeddings are never selected — they are large, useless to
 * a human reviewer, and carry residual reconstructive signal.
 */

import { supabase } from '../../../db/supabaseClient';

const TABLE = 'platform_topic_node';

/** Explicit allow-list. Never `select('*')` — a new column must be added here
 *  deliberately before it can reach an operator's screen. */
const REVIEW_COLUMNS =
  'id, canonical_label, normalized_label, canonical_topic_id, parent_topic_id, state, confidence, source, occurrence_count, first_seen_at, last_seen_at';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface ReviewTopic {
  id: string;
  canonicalLabel: string;
  normalizedLabel: string;
  canonicalTopicId: string | null;
  parentTopicId: string | null;
  state: string;
  confidence: string;
  source: string | null;
  occurrenceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export type ReviewFilter = 'identities' | 'aliases' | 'all';

export interface ReviewPage {
  items: ReviewTopic[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  filter: ReviewFilter;
}

function mapRow(row: Record<string, unknown>): ReviewTopic {
  return {
    id: String(row.id),
    canonicalLabel: String(row.canonical_label ?? ''),
    normalizedLabel: String(row.normalized_label ?? ''),
    canonicalTopicId: row.canonical_topic_id == null ? null : String(row.canonical_topic_id),
    parentTopicId: row.parent_topic_id == null ? null : String(row.parent_topic_id),
    state: String(row.state ?? 'unknown'),
    confidence: String(row.confidence ?? 'none'),
    source: row.source == null ? null : String(row.source),
    occurrenceCount: Number(row.occurrence_count ?? 0),
    firstSeenAt: row.first_seen_at == null ? null : String(row.first_seen_at),
    lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
  };
}

/**
 * List topics for review. Read-only; never throws.
 *
 * Ordering is DETERMINISTIC — `normalized_label` ascending, which is unique, so
 * pagination can never skip or repeat a row the way an ordering on a
 * non-unique column (created_at, occurrence_count) would.
 *
 * `hasMore` is computed by requesting pageSize+1 and trimming, so the caller
 * gets an accurate next-page signal without a second COUNT query.
 */
export async function listTopicsForReview(opts: {
  filter?: ReviewFilter;
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<ReviewPage> {
  const filter: ReviewFilter = opts.filter ?? 'identities';
  const page = Math.max(0, Math.floor(Number(opts.page ?? 0)) || 0);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(opts.pageSize ?? DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE));
  const empty: ReviewPage = { items: [], page, pageSize, hasMore: false, filter };

  try {
    let q = supabase.from(TABLE).select(REVIEW_COLUMNS);

    // `null` is meaningful here, so IS NULL / NOT IS NULL — never `= null`.
    if (filter === 'identities') q = q.is('canonical_topic_id', null);
    else if (filter === 'aliases') q = q.not('canonical_topic_id', 'is', null);

    const term = String(opts.search ?? '').trim().toLowerCase();
    if (term) q = q.ilike('normalized_label', `%${term}%`);

    const from = page * pageSize;
    const { data, error } = await q
      .order('normalized_label', { ascending: true })
      .range(from, from + pageSize);   // pageSize+1 rows

    if (error || !Array.isArray(data)) return empty;

    const rows = data as Record<string, unknown>[];
    const hasMore = rows.length > pageSize;
    return { items: rows.slice(0, pageSize).map(mapRow), page, pageSize, hasMore, filter };
  } catch {
    return empty;   // read-only surface; a failure shows an empty list, never an error page
  }
}

/**
 * Fetch specific topics by id — the manual-pairing path an operator uses to put
 * two known identities side by side before confirming. Read-only; never throws.
 */
export async function getTopicsByIds(ids: string[]): Promise<ReviewTopic[]> {
  const clean = Array.from(new Set((ids ?? []).map((s) => String(s ?? '').trim()).filter(Boolean))).slice(0, MAX_PAGE_SIZE);
  if (clean.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(REVIEW_COLUMNS)
      .in('id', clean)
      .order('normalized_label', { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map(mapRow);
  } catch {
    return [];
  }
}

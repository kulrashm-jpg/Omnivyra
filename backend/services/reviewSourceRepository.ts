/**
 * Canonical Review-Source Repository  (BETA-REPORT-EXEC-003, Phase 4)
 *
 * Durable persistence for AUTHENTICATED per-source review records — the raw store the ReviewSourceLoader
 * reloads for the TrustCoherence ReviewAggregator (which re-consolidates them via the canonical reputation
 * bridge). Intentionally SEPARATE from `provider_evidence`: that store holds CONSOLIDATED Evidence (lossy —
 * per-source ratings cannot be recovered), whereas the loader contract returns raw `ReviewSourcePayload[]`.
 * Guarded exactly like `providerEvidenceRepository`: never throws; a missing table / DB error yields null →
 * trust_coherence falls back unchanged. Deterministic reload: the latest snapshot per subject wins.
 */
import { supabase } from '../db/supabaseClient';
import type { ReviewSourcePayload } from './reputationProviderBridge';
import type { ReviewSourceSnapshot } from './intelligence/adapters/reputationReviewAggregator';

const TABLE = 'review_sources';

const numOrNull = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The persistence contract. Durable Supabase store by default; in-memory for tests/local. */
export interface ReviewSourceStore {
  save(subjectId: string, snapshot: ReviewSourceSnapshot): Promise<{ ok: boolean; error: string | null }>;
  load(subjectId: string): Promise<ReviewSourceSnapshot | null>;
}

interface ReviewSourceRow {
  subject_id: string; source: string; observed_at: string;
  average_rating: number | null; review_count: number | null; verified_count: number | null;
  recent_reviews: number | null; sentiment_positive: number | null; sentiment_neutral: number | null;
  sentiment_negative: number | null; owner_response_count: number | null; response_rate: number | null;
  avg_response_hours: number | null; last_review_at: string | null;
}

/** Pure: raw payload → row (testable without a DB). */
export function payloadToRow(subjectId: string, observedAt: string, s: ReviewSourcePayload): ReviewSourceRow {
  return {
    subject_id: subjectId, source: s.source, observed_at: observedAt,
    average_rating: numOrNull(s.averageRating), review_count: numOrNull(s.reviewCount),
    verified_count: numOrNull(s.verifiedCount), recent_reviews: numOrNull(s.recentReviews),
    sentiment_positive: numOrNull(s.sentimentPositive), sentiment_neutral: numOrNull(s.sentimentNeutral),
    sentiment_negative: numOrNull(s.sentimentNegative), owner_response_count: numOrNull(s.ownerResponseCount),
    response_rate: numOrNull(s.responseRate), avg_response_hours: numOrNull(s.avgResponseHours),
    last_review_at: s.lastReviewAt ?? null,
  };
}

/** Pure: row → raw payload (round-trips `payloadToRow`). */
export function rowToPayload(r: ReviewSourceRow): ReviewSourcePayload {
  return {
    source: r.source, averageRating: r.average_rating, reviewCount: r.review_count,
    verifiedCount: r.verified_count, recentReviews: r.recent_reviews,
    sentimentPositive: r.sentiment_positive, sentimentNeutral: r.sentiment_neutral,
    sentimentNegative: r.sentiment_negative, ownerResponseCount: r.owner_response_count,
    responseRate: r.response_rate, avgResponseHours: r.avg_response_hours, lastReviewAt: r.last_review_at,
  };
}

/**
 * Guarded Supabase-backed store (durable). Never throws — a missing table / DB error yields null on load and
 * `{ ok:false }` on save. Replace semantics: the latest snapshot per subject wins (no duplicate rows).
 */
export function createSupabaseReviewSourceStore(): ReviewSourceStore {
  return {
    async save(subjectId, snapshot) {
      try {
        const del = await supabase.from(TABLE).delete().eq('subject_id', subjectId);
        if (del.error) return { ok: false, error: del.error.message };
        if (snapshot.sources.length === 0) return { ok: true, error: null };
        const rows = snapshot.sources.map((s) => payloadToRow(subjectId, snapshot.observedAt, s));
        const { error } = await supabase.from(TABLE).insert(rows);
        return { ok: !error, error: error?.message ?? null };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unknown persistence error' };
      }
    },
    async load(subjectId) {
      try {
        const { data, error } = await supabase
          .from(TABLE)
          .select('subject_id, source, observed_at, average_rating, review_count, verified_count, recent_reviews, sentiment_positive, sentiment_neutral, sentiment_negative, owner_response_count, response_rate, avg_response_hours, last_review_at')
          .eq('subject_id', subjectId)
          .order('observed_at', { ascending: false });
        if (error || !data || data.length === 0) return null;
        const rows = data as ReviewSourceRow[];
        const latest = rows[0].observed_at;
        const current = rows.filter((r) => r.observed_at === latest);
        return { sources: current.map(rowToPayload), observedAt: latest };
      } catch {
        return null;
      }
    },
  };
}

/** Deterministic in-memory store (tests + local; no DB dependency). Latest snapshot per subject wins. */
export class InMemoryReviewSourceStore implements ReviewSourceStore {
  private readonly map = new Map<string, ReviewSourceSnapshot>();
  async save(subjectId: string, snapshot: ReviewSourceSnapshot): Promise<{ ok: boolean; error: string | null }> {
    this.map.set(subjectId, { sources: [...snapshot.sources], observedAt: snapshot.observedAt });
    return { ok: true, error: null };
  }
  async load(subjectId: string): Promise<ReviewSourceSnapshot | null> {
    const s = this.map.get(subjectId);
    return s ? { sources: [...s.sources], observedAt: s.observedAt } : null;
  }
  clear(): void { this.map.clear(); }
}

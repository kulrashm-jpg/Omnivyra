/**
 * Canonical Review Ingestion Pipeline  (BETA-REPORT-EXEC-003)
 *
 * The ONE missing layer between an authenticated review provider and the ReviewAggregator: it persists
 * AUTHENTICATED per-source review payloads (durably, via the guarded review-source repository) and exposes the
 * canonical `ReviewSourceLoader` that reloads them for the TrustCoherence ReviewAggregator (EXEC-002). It
 * REUSES the canonical reputation bridge for consolidation + Evidence conversion — NO new consolidation, NO
 * new trust math, NO fabrication. Unusable/synthetic sources are dropped; when nothing authenticated exists,
 * the loader returns null and trust_coherence falls back unchanged. Deterministic — `observedAt` is supplied.
 */
import {
  fetchReputationEvidence, isReputationProviderConfigured, type ReviewSourcePayload,
} from './reputationProviderBridge';
import type { Evidence } from './evidencePlatform';
import type { ReviewSourceLoader, ReviewSourceSnapshot } from './intelligence/adapters/reputationReviewAggregator';
import { createSupabaseReviewSourceStore, type ReviewSourceStore } from './reviewSourceRepository';

let activeStore: ReviewSourceStore = createSupabaseReviewSourceStore();

/** Override the persistence store (durable Supabase by default; in-memory for tests/local). */
export function setReviewSourceStore(store: ReviewSourceStore): void {
  activeStore = store;
}

/** Normalize a review subject key from domain (preferred) or brand name. Deterministic. */
export function subjectKeyFor(domain: string | null, brandName: string | null): string | null {
  const d = (domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
  if (d) return d;
  const b = (brandName ?? '').trim().toLowerCase();
  return b || null;
}

/** Keep only sources carrying a genuine rating or review-count signal (never persist fabricated data). */
function authenticatedSources(sources: ReviewSourcePayload[]): ReviewSourcePayload[] {
  return sources.filter((s) => {
    const hasRating = s.averageRating != null && s.averageRating !== '' && Number.isFinite(Number(s.averageRating));
    const hasCount = s.reviewCount != null && s.reviewCount !== '' && Number.isFinite(Number(s.reviewCount));
    return Boolean(s.source) && (hasRating || hasCount);
  });
}

export interface IngestResult {
  subjectId: string;
  persisted: number;      // authenticated per-source records stored
  evidence: Evidence[];   // canonical Evidence produced (for provider_evidence via the existing repository)
  ok: boolean;
  error: string | null;
}

/**
 * Persist authenticated review sources for a subject and return the canonical Evidence. Guarded — never
 * throws (persistence failures surface as `ok:false`, never as an exception). `observedAt` is supplied by the
 * caller (deterministic; no clock access here).
 */
export async function ingestReviewSources(
  subjectId: string, sources: ReviewSourcePayload[], observedAt: string,
): Promise<IngestResult> {
  const clean = authenticatedSources(sources);
  const saved = await activeStore.save(subjectId, { sources: clean, observedAt });
  // Reuse the canonical bridge for Evidence (consolidation + conversion) — never throws, never fabricates.
  const evidence = fetchReputationEvidence(subjectId, clean.length ? clean : null, observedAt);
  return { subjectId, persisted: clean.length, evidence, ok: saved.ok, error: saved.error };
}

/** Reload the latest authenticated review snapshot for a subject. Null when none/unavailable. */
export async function loadReviewSourceSnapshot(subjectId: string): Promise<ReviewSourceSnapshot | null> {
  const snap = await activeStore.load(subjectId);
  if (!snap || snap.sources.length === 0) return null;
  return snap;
}

/**
 * The canonical `ReviewSourceLoader` for the ReviewAggregator. Returns null (trust unchanged) unless the
 * reputation provider is credentialed AND a real snapshot exists — never synthesizes reviews/ratings/sentiment.
 */
export function createCanonicalReviewSourceLoader(): ReviewSourceLoader {
  return async ({ brandName, domain }) => {
    if (!isReputationProviderConfigured()) return null;
    const key = subjectKeyFor(domain, brandName);
    if (!key) return null;
    return loadReviewSourceSnapshot(key);
  };
}

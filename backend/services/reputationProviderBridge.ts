/**
 * Canonical Reviews & Reputation Provider Bridge  (BETA-PROVIDER-005) — REFERENCE IMPLEMENTATION #5
 *
 * Wires the FIFTH real external evidence provider — cross-platform Reviews & Reputation — into the
 * canonical BETA-ENGINE-004 framework, closing the platform's largest remaining trust gap (BETA-AUDIT-004:
 * brand trust is currently INFERRED from sparse `community_ai_actions` sentiment). It REUSES the anticipated
 * `reviews` descriptor (aggregator over Google · G2 · Trustpilot · Facebook · Yelp · Clutch · …) — no new
 * provider infrastructure is created.
 *
 * MULTI-PROVIDER by design: a company may have many review sources simultaneously. This bridge accepts N
 * per-source payloads and DETERMINISTICALLY CONSOLIDATES them (weighted by review volume, disagreement
 * surfaced as rating spread / parity) into a single normalised input the canonical adapter converts to
 * Evidence. No provider is hardcoded — the source list is data-driven.
 *
 * AUDIT NOTE (honest): no functional review/reputation integration existed (no Google Business Profile /
 * Trustpilot / Yelp / G2 connector). This builds the canonical reputation path from-scratch (shaped like
 * the backlink reference #1): descriptor reuse + registration + consolidation + canonical-Evidence
 * conversion + availability + failure governance. The reputation *ingestion* pipeline (per-source API auth
 * + fetch + persistence) does not yet exist and is called out as the remaining gap — this bridge provides
 * `fetchReputationEvidence` (payloads → consolidated canonical Evidence) ready for that pipeline.
 *
 * Backward compatible: with no `REVIEWS_API_KEY` the provider is UNAVAILABLE, so the trust engine keeps its
 * current INFERRED behaviour; confidence rises to MEASURED only when a real reputation provider connects.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  reviewsEvidenceAdapter, type ReputationEvidenceInput,
} from './evidencePlatform/providers/reputation/reviewsEvidenceAdapter';

const PROVIDER_ID = 'reviews';
const ENV_KEYS = ['REVIEWS_API_KEY'];
const RECENT_WINDOW_DAYS = 30;

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A single review source's supplied metrics (Google, Trustpilot, G2, Facebook, Yelp, Clutch, Capterra,
 * Glassdoor, App Store, Play Store, or any other). Every field nullable — only genuinely-supplied values
 * are consolidated. `source` is a free-form key (no hardcoded provider assumptions).
 */
export interface ReviewSourcePayload {
  source: string;
  averageRating?: number | string | null; // 0..5
  reviewCount?: number | string | null;
  verifiedCount?: number | string | null;
  recentReviews?: number | string | null; // reviews within the recent window (default 30d)
  sentimentPositive?: number | string | null; // counts, ONLY if the source supplies sentiment
  sentimentNeutral?: number | string | null;
  sentimentNegative?: number | string | null;
  ownerResponseCount?: number | string | null;
  responseRate?: number | string | null; // 0..1, provider-supplied
  avgResponseHours?: number | string | null;
  lastReviewAt?: string | null; // ISO
}

/** True when a reputation provider credential is present. */
export function isReputationProviderConfigured(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/** Register the canonical reviews provider with auth/connection derived from env (idempotent). */
export function registerReputationProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('reviews descriptor missing from anticipated providers');
  const configured = isReputationProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability engines consult to choose MEASURED vs INFERRED trust maturity. */
export function isReputationProviderAvailable(): boolean {
  registerReputationProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function reputationProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/**
 * DETERMINISTIC MULTI-PROVIDER CONSOLIDATION (Phase 6). Consolidates N per-source review payloads into a
 * single normalised reputation input. Rules — all deterministic + explainable:
 *   • Sources with no usable signal (no rating AND no review count) are dropped (unavailable/partial).
 *   • Duplicate source keys are de-duplicated — the LAST payload for a given source key wins (stable).
 *   • avg_rating = review-count-weighted mean of per-source ratings (equal weight if counts absent).
 *   • review_count / verified / recent / owner_responses = sums across sources.
 *   • response_rate / avg_response_hours = review-count-weighted means over sources that supplied them.
 *   • sentiment ratios = supplied positive/negative counts ÷ supplied sentiment total — ONLY when ≥1
 *     source supplied sentiment (else null; never generated).
 *   • rating_spread = max-min of per-source ratings; review_parity = 1 - spread/5 (cross-source agreement).
 *   • freshness = hours between the most-recent lastReviewAt and observedAt.
 *   • source_count = number of contributing sources (platform coverage).
 * Pure; no clock/random (timestamps compared are all passed in).
 */
export function consolidateReviewSources(
  sources: ReviewSourcePayload[],
  observedAt: string | null,
): ReputationEvidenceInput {
  // De-duplicate by source key (last wins) — deterministic handling of duplicate providers.
  const bySource = new Map<string, ReviewSourcePayload>();
  for (const s of sources) {
    const key = (s.source ?? '').trim().toLowerCase();
    if (key) bySource.set(key, s);
  }
  // Keep only sources with a usable signal.
  const usable = [...bySource.entries()]
    .map(([key, s]) => ({ key, rating: num(s.averageRating), count: num(s.reviewCount), s }))
    .filter((e) => e.rating != null || e.count != null);

  if (usable.length === 0) {
    return {
      subjectId: '', avgRating: null, reviewCount: null, sourceCount: null, verifiedReviews: null,
      recentReviews: null, reviewVelocityPerDay: null, sentimentPositiveRatio: null,
      sentimentNegativeRatio: null, responseRate: null, avgResponseHours: null, ownerResponses: null,
      ratingSpread: null, reviewParity: null, freshnessHours: null, observedAt,
      providerReliability: reputationProviderReliability(), contributingSources: [],
    };
  }

  // Weighted rating + weighted response metrics.
  let ratingWeightedSum = 0, ratingWeight = 0;
  let respRateWeightedSum = 0, respRateWeight = 0;
  let respHoursWeightedSum = 0, respHoursWeight = 0;
  let totalReviews = 0, hasReviewCount = false;
  let totalVerified = 0, hasVerified = false;
  let totalRecent = 0, hasRecent = false;
  let totalOwnerResponses = 0, hasOwnerResponses = false;
  let sentPos = 0, sentNeg = 0, sentNeu = 0, hasSentiment = false;
  const ratings: number[] = [];
  let mostRecentMs: number | null = null;

  for (const { rating, count, s } of usable) {
    const weight = count != null && count > 0 ? count : 1;
    if (rating != null) { ratingWeightedSum += rating * weight; ratingWeight += weight; ratings.push(rating); }
    if (count != null) { totalReviews += count; hasReviewCount = true; }
    const verified = num(s.verifiedCount); if (verified != null) { totalVerified += verified; hasVerified = true; }
    const recent = num(s.recentReviews); if (recent != null) { totalRecent += recent; hasRecent = true; }
    const owner = num(s.ownerResponseCount); if (owner != null) { totalOwnerResponses += owner; hasOwnerResponses = true; }
    const rr = num(s.responseRate); if (rr != null) { respRateWeightedSum += rr * weight; respRateWeight += weight; }
    const rh = num(s.avgResponseHours); if (rh != null) { respHoursWeightedSum += rh * weight; respHoursWeight += weight; }
    const sp = num(s.sentimentPositive); const sn = num(s.sentimentNegative); const su = num(s.sentimentNeutral);
    if (sp != null || sn != null || su != null) {
      hasSentiment = true;
      sentPos += sp ?? 0; sentNeg += sn ?? 0; sentNeu += su ?? 0;
    }
    if (s.lastReviewAt) {
      const ms = Date.parse(s.lastReviewAt);
      if (Number.isFinite(ms)) mostRecentMs = mostRecentMs == null ? ms : Math.max(mostRecentMs, ms);
    }
  }

  const sentimentTotal = sentPos + sentNeg + sentNeu;
  const ratingSpread = ratings.length >= 2 ? Math.max(...ratings) - Math.min(...ratings) : (ratings.length === 1 ? 0 : null);
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const freshnessHours = mostRecentMs != null && Number.isFinite(observedMs)
    ? Math.max(0, (observedMs - mostRecentMs) / 3_600_000)
    : null;

  return {
    subjectId: '',
    avgRating: ratingWeight > 0 ? ratingWeightedSum / ratingWeight : null,
    reviewCount: hasReviewCount ? totalReviews : null,
    sourceCount: usable.length,
    verifiedReviews: hasVerified ? totalVerified : null,
    recentReviews: hasRecent ? totalRecent : null,
    reviewVelocityPerDay: hasRecent ? totalRecent / RECENT_WINDOW_DAYS : null,
    sentimentPositiveRatio: hasSentiment && sentimentTotal > 0 ? sentPos / sentimentTotal : null,
    sentimentNegativeRatio: hasSentiment && sentimentTotal > 0 ? sentNeg / sentimentTotal : null,
    responseRate: respRateWeight > 0 ? respRateWeightedSum / respRateWeight : null,
    avgResponseHours: respHoursWeight > 0 ? respHoursWeightedSum / respHoursWeight : null,
    ownerResponses: hasOwnerResponses ? totalOwnerResponses : null,
    ratingSpread,
    reviewParity: ratingSpread != null ? Math.max(0, 1 - ratingSpread / 5) : null,
    freshnessHours,
    observedAt,
    providerReliability: reputationProviderReliability(),
    contributingSources: usable.map((e) => e.key),
  };
}

/**
 * Reference fetch → canonical Evidence. Consolidates N review-source payloads and converts them through the
 * canonical adapter. Every failure (no credentials, unauthorized, quota, rate limit, provider removed,
 * timeout, invalid response, empty history) becomes canonical Evidence — never throws, never fabricates.
 * `nowIso` is passed in (deterministic; no clock access).
 *
 * With no credential the provider is UNAVAILABLE and this returns a single UNAVAILABLE Evidence without
 * touching the network or the database (backward-compatible, test-verified).
 */
export function fetchReputationEvidence(
  subjectId: string,
  sources: ReviewSourcePayload[] | null,
  nowIso: string,
): Evidence[] {
  registerReputationProvider();
  if (!isReputationProviderConfigured()) {
    return reviewsEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'avg_rating',
      'Reputation provider not connected. Set REVIEWS_API_KEY and connect at least one review source.',
    ));
  }
  const consolidated = sources ? consolidateReviewSources(sources, nowIso) : null;
  if (!consolidated || consolidated.sourceCount == null || consolidated.sourceCount === 0) {
    return reviewsEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: 'Reputation provider is connected but returned no usable review data (empty history).',
      evidenceKey: 'avg_rating',
      observedAt: nowIso,
    });
  }
  return reviewsEvidenceAdapter.toEvidence({ ...consolidated, subjectId }, { observedAt: nowIso, subjectId });
}

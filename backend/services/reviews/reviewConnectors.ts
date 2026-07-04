/**
 * Canonical Review Connectors (BETA-PHASE2 — Reviews ingestion)
 * ------------------------------------------------------------
 * The per-provider FETCH layer the reputation bridge explicitly called out as
 * "the remaining gap". Each connector turns a provider's API response into the
 * EXISTING `ReviewSourcePayload` (reputationProviderBridge) — it does NOT define
 * a new payload, normalizer, or store. Consolidation + persistence stay with
 * `ingestReviewSources` (the existing normalizer + review store).
 *
 * CANONICAL PATH (no raw HTTP shortcut): every outbound call goes through
 * `fetchProduction` — which authorizes via the provider cost governor, records
 * usage + outcome, emits `logProviderCall` telemetry, and enforces timeout — and
 * is wrapped in `withRetry` (bounded exponential backoff, no retry on 4xx/auth).
 * So each connector inherits: governor → health → retry → backoff → telemetry.
 *
 * HONEST DEGRADATION: a connector returns `null` (no signal) when its credential
 * is absent or when it has no resolvable business id for the subject. It never
 * fabricates a rating/count. Providers with no public review API (Facebook page
 * ratings need partner tokens; G2 / Capterra have no public review endpoint) are
 * credential-gated unavailable stubs — declared, never faked.
 *
 * NOTE (verification): the parse logic follows each provider's documented API
 * shape but has NOT been exercised against a live credential in this phase — see
 * the phase report's limitations. All connectors are inert until keyed.
 */

import { fetchProduction, withRetry, reasonFromError } from '../intelligence/productionPrimitives';
import type { ReviewSourcePayload } from '../reputationProviderBridge';

const REVIEW_PROVIDER_ID = 'reviews'; // governor/catalog id shared by all review connectors
const TIMEOUT_MS = 15_000;

/** Per-tenant subject + optional provider business ids (resolved by the caller). */
export interface ReviewSubject {
  companyId: string;
  domain: string | null;
  brandName: string | null;
  /** Provider-specific business identifiers (e.g. Google place_id, Yelp business id). */
  providerIds?: Partial<Record<ReviewProviderKey, string>>;
}

export type ReviewProviderKey =
  | 'google_business'
  | 'yelp'
  | 'trustpilot'
  | 'facebook'
  | 'g2'
  | 'capterra';

export interface ReviewConnector {
  key: ReviewProviderKey;
  /** The `source` value written into ReviewSourcePayload (data-driven, not hardcoded downstream). */
  source: string;
  /** True when this connector's credential is present. */
  isConfigured(): boolean;
  /** Fetch the subject's aggregate review signal, or null when unavailable/no signal. Never throws. */
  fetch(subject: ReviewSubject): Promise<ReviewSourcePayload | null>;
}

const env = (k: string): string | null => {
  const v = process.env[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** Governed JSON GET via the canonical primitive (governor + telemetry + retry + timeout). */
async function governedGetJson(operation: string, url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const envelope = await withRetry(REVIEW_PROVIDER_ID, () =>
      fetchProduction(REVIEW_PROVIDER_ID, url, { method: 'GET', headers: { Accept: 'application/json', ...headers } }, TIMEOUT_MS),
    );
    return await envelope.json();
  } catch (error) {
    // reasonFromError already reflects governor-block / auth / rate-limit / timeout;
    // fetchProduction recorded the failure outcome + telemetry. Degrade to null.
    void reasonFromError(REVIEW_PROVIDER_ID, error);
    return null;
  }
}

// ── Google Business Profile (via Places API) ─────────────────────────────────
// Places Details returns `rating` (0..5) + `user_ratings_total`. Requires a
// place_id (subject.providerIds.google_business); no discovery is performed here.
const googleBusinessConnector: ReviewConnector = {
  key: 'google_business',
  source: 'google',
  isConfigured: () => Boolean(env('GOOGLE_PLACES_API_KEY')),
  async fetch(subject) {
    const apiKey = env('GOOGLE_PLACES_API_KEY');
    const placeId = subject.providerIds?.google_business;
    if (!apiKey || !placeId) return null;
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total&key=${encodeURIComponent(apiKey)}`;
    const json = await governedGetJson('google_business.details', url, {});
    const r = json?.result;
    if (!r || (r.rating == null && r.user_ratings_total == null)) return null;
    return { source: 'google', averageRating: r.rating ?? null, reviewCount: r.user_ratings_total ?? null };
  },
};

// ── Yelp Fusion ──────────────────────────────────────────────────────────────
// /businesses/{id} returns `rating` + `review_count`. Bearer YELP_API_KEY.
const yelpConnector: ReviewConnector = {
  key: 'yelp',
  source: 'yelp',
  isConfigured: () => Boolean(env('YELP_API_KEY')),
  async fetch(subject) {
    const apiKey = env('YELP_API_KEY');
    const businessId = subject.providerIds?.yelp;
    if (!apiKey || !businessId) return null;
    const url = `https://api.yelp.com/v3/businesses/${encodeURIComponent(businessId)}`;
    const json = await governedGetJson('yelp.business', url, { Authorization: `Bearer ${apiKey}` });
    if (!json || (json.rating == null && json.review_count == null)) return null;
    return { source: 'yelp', averageRating: json.rating ?? null, reviewCount: json.review_count ?? null };
  },
};

// ── Trustpilot Business Units ────────────────────────────────────────────────
// /business-units/{id} returns numberOfReviews + trustScore/stars. apikey header.
const trustpilotConnector: ReviewConnector = {
  key: 'trustpilot',
  source: 'trustpilot',
  isConfigured: () => Boolean(env('TRUSTPILOT_API_KEY')),
  async fetch(subject) {
    const apiKey = env('TRUSTPILOT_API_KEY');
    const businessUnitId = subject.providerIds?.trustpilot;
    if (!apiKey || !businessUnitId) return null;
    const url = `https://api.trustpilot.com/v1/business-units/${encodeURIComponent(businessUnitId)}`;
    const json = await governedGetJson('trustpilot.businessUnit', url, { apikey: apiKey });
    const stars = json?.score?.stars ?? json?.stars ?? null;
    const count = json?.numberOfReviews?.total ?? json?.numberOfReviews ?? null;
    if (stars == null && count == null) return null;
    return { source: 'trustpilot', averageRating: stars, reviewCount: count };
  },
};

// ── Providers with no public review API (declared, unavailable stubs) ─────────
// Facebook page ratings require a page access token + partner permissions; G2 and
// Capterra expose no public review-metrics API. These are credential-gated and
// return null (unavailable) — honest absence, never fabricated.
function unavailableStub(key: ReviewProviderKey, source: string, credKey: string): ReviewConnector {
  return {
    key,
    source,
    isConfigured: () => Boolean(env(credKey)),
    async fetch() {
      // No public review-metrics endpoint available for a governed fetch today.
      return null;
    },
  };
}

const facebookConnector = unavailableStub('facebook', 'facebook', 'FACEBOOK_REVIEWS_ACCESS_TOKEN');
const g2Connector = unavailableStub('g2', 'g2', 'G2_API_KEY');
const capterraConnector = unavailableStub('capterra', 'capterra', 'CAPTERRA_API_KEY');

/** The canonical review connector registry (intended providers only; no duplicates). */
export const REVIEW_CONNECTORS: ReviewConnector[] = [
  googleBusinessConnector,
  yelpConnector,
  trustpilotConnector,
  facebookConnector,
  g2Connector,
  capterraConnector,
];

/** Connectors whose credential is present (the only ones a run will fetch). */
export function configuredReviewConnectors(): ReviewConnector[] {
  return REVIEW_CONNECTORS.filter((c) => c.isConfigured());
}

/**
 * Provider Ingestion Specs  (BETA-ENGINE-007, Phase 3)
 *
 * Registers the normalised ingestion contract for each provider that has a `fetch<Provider>Evidence` entry
 * point but NO domain-specific ingestion of its own. REUSES the existing provider bridges (no new provider
 * code, no duplicated fetch) — each spec is a thin closure that maps the normalised `IngestionSubject` onto
 * the provider's fetch signature and returns canonical Evidence.
 *
 * Deliberately NOT registered (they already have domain-specific ingestion into canonical tables — reused,
 * not duplicated): `search_console` (gscIngestionService → keyword_metrics) and `analytics.ga4`
 * (ga4IngestionService → canonical_sessions / canonical_page_views).
 *
 * With no credentials configured every spec's `isConfigured()` is false, so the orchestrator skips the
 * fetch and engines fall back — backward compatible.
 */
import { registerIngestionSpec, type IngestionSubject } from './evidenceIngestionOrchestrator';
import { isBacklinkProviderConfigured, fetchBacklinkEvidence } from '../../backlinkAuthorityProviderBridge';
import { isBingProviderConfigured, fetchBingEvidence, type BingQueryRow, type BingCrawlStats } from '../../bingWebmasterProviderBridge';
import { isReputationProviderConfigured, fetchReputationEvidence, type ReviewSourcePayload } from '../../reputationProviderBridge';
import { isEntityProviderConfigured, fetchEntityEvidence } from '../../entityGraphProviderBridge';
import { isAIVisibilityProviderConfigured, fetchAIVisibilityEvidence } from '../../aiVisibilityProviderBridge';
import { isCommercialProviderConfigured, fetchCommercialEvidence, type CommercialSourcePayload } from '../../commercialProviderBridge';

let registered = false;

/** Register every fetch-only provider's ingestion spec (idempotent). */
export function registerProviderIngestionSpecs(): void {
  if (registered) return;
  registered = true;

  // Backlink authority — reuses the existing Ahrefs bridge; subject.domain is the target.
  registerIngestionSpec({
    providerId: 'backlink.authority',
    maxAgeHours: 24 * 7,
    providerReliability: 0.9,
    isConfigured: isBacklinkProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchBacklinkEvidence(s.domain ?? '', nowIso),
  });

  // Bing Webmaster — rows/crawl come from the (future) ingestion inputs; null here → honest UNAVAILABLE.
  registerIngestionSpec({
    providerId: 'bing_webmaster',
    maxAgeHours: 24 * 21,
    providerReliability: 0.8,
    isConfigured: isBingProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchBingEvidence(
      s.siteUrl ?? s.domain ?? '',
      (s.extra?.bingRows as BingQueryRow[] | undefined) ?? null,
      (s.extra?.bingCrawl as BingCrawlStats | undefined) ?? null,
      nowIso,
    ),
  });

  // Reviews & reputation — consolidates review sources; none supplied here → honest UNAVAILABLE.
  registerIngestionSpec({
    providerId: 'reviews',
    maxAgeHours: 24 * 30,
    providerReliability: 0.85,
    isConfigured: isReputationProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchReputationEvidence(
      s.subjectId,
      (s.extra?.reviewSources as ReviewSourcePayload[] | undefined) ?? null,
      nowIso,
    ),
  });

  // Entity / knowledge graph — reuses the existing Wikidata bridge; brand + domain drive the lookup.
  registerIngestionSpec({
    providerId: 'entity_graph',
    maxAgeHours: 24 * 60,
    providerReliability: 0.88,
    isConfigured: isEntityProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchEntityEvidence(s.brandName ?? '', s.domain ?? null, nowIso),
  });

  // AI visibility — reuses the existing LLM adapters + deterministic probes.
  registerIngestionSpec({
    providerId: 'llm_visibility',
    maxAgeHours: 24 * 7,
    providerReliability: 0.7,
    isConfigured: isAIVisibilityProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchAIVisibilityEvidence(s.brandName ?? '', s.category ?? null, nowIso),
  });

  // Commercial outcomes & revenue — reuses CRM revenue events + GA4 conversions-with-value + leads; the
  // measured sources come from the ingestion inputs. Closes the ROI Not-Determinable gap (BETA-ENGINE-012).
  registerIngestionSpec({
    providerId: 'commercial',
    maxAgeHours: 24 * 30,
    providerReliability: 0.9,
    isConfigured: isCommercialProviderConfigured,
    fetch: (s: IngestionSubject, nowIso: string) => fetchCommercialEvidence(
      s.subjectId,
      (s.extra?.commercialSources as CommercialSourcePayload[] | undefined) ?? null,
      nowIso,
    ),
  });
}

/** Test helper. */
export function __resetProviderIngestionSpecs(): void {
  registered = false;
}

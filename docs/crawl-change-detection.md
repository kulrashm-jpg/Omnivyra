# Crawl Lifecycle, Fingerprints & Change Detection (CKRE-001)

The deterministic, observable, cost-efficient crawl foundation the future
Company Knowledge Refresh Engine (CKRE) builds on. CKRE-001 **prepares** the
platform — it does not build the CKRE and does not gate any AI.

All new code lives under `backend/services/crawl/`. Nothing here replaces the
existing crawlers or Website Intelligence; it wraps and instruments them.

## Crawl lifecycle & reuse

Two existing HTML crawlers remain the substrate:
- `crawlWebsiteSources` (`companyProfile/refinementHelpers.ts`) — company-profile
  enrichment (root + ≤4 sub-pages).
- `crawlCompanyWebsite` (`crawlerService.ts`) — Website Intelligence BFS crawl.

**One fetch per workflow.** `crawl/crawlResultCache.ts` (`fetchPageCached`) is a
bounded, short-TTL (120 s) memo over the SSRF-safe `safeFetch`. Every page fetch
in the enrichment path routes through it, so a URL fetched earlier in the same
workflow is never fetched again:
- the within-call double root fetch (root, then root summary) collapses to one;
- onboarding's step-5 crawl and step-5b profile-refinement crawl share one root
  fetch (and any shared sub-pages).

Cache hits record `crawl.duplicate_prevented` + `crawl.network_requests_saved`.
Failures are never cached (a transient error must not stick).

## Fingerprint model (`crawl/websiteFingerprintService.ts`)

Pure, deterministic, no network, no AI. Reuses ONBOARD-001's
`extractWebsiteMetadata` output — no duplicate extraction. Every bundle carries
`{ algorithm: sha256, source: website_crawl, version: ckre-fp-v1, computedAt }`;
every field is a hash (or null when the signal is absent).

| Level | Signals |
|---|---|
| **0 — HTTP** | etag, last-modified, content-length |
| **1 — structural** | html (script/style-stripped), navigation, favicon, logo, openGraph, sitemap, robots |
| **2 — business** | company name, products, services, primary CTA, contact, social links, brand colours, structured data |

`computeWebsiteFingerprint(input, computedAt?)` — same inputs always yield
identical hashes (timestamp is metadata, never hashed). Dynamic script tokens do
not perturb the structural HTML hash.

## Fingerprint storage (`crawl/fingerprintStore.ts`)

Latest bundle persisted at `company_profiles.report_settings.website_fingerprint`
— **reuses the existing JSONB column, no new table, no migration**. Writes merge
into `report_settings` so siblings (`discovered_metadata`, `activation_latch`, …)
are preserved. Read/write is best-effort and fail-safe.

## Change decision engine (`crawl/changeDetectionService.ts`)

`decideWebsiteChange(prev, next)` — pure, deterministic, retry-safe.

| Verdict | Rule |
|---|---|
| `UNKNOWN` | no prior fingerprint |
| `UNCHANGED` | no structural and no business change (Level-0 match + unchanged html short-circuits) |
| `COSMETIC_CHANGE` | structural/HTTP changed, no business field changed |
| `BUSINESS_CHANGE` | 1–2 business fields changed |
| `MAJOR_CHANGE` | company name changed, or ≥3 business fields changed |

Deterministic score (0–100): Level-1 field = 5, Level-2 field = 20, company-name
change = +30, capped at 100. **The verdict is computed, emitted, and stored —
it does NOT gate enrichment (that is CKRE-002).**

## Event model (`crawl/crawlEventService.ts`)

**Reuses the AUTH-001 event infrastructure** — same immutable
`capability_audit_log` sink, same `SignupEventEnvelope` + `SIGNUP_EVENT_SCHEMA_VERSION`,
same correlation (`ensureSignupCorrelationId` → shared `resource_id`), same
metric registry. Only the `crawl.<Event>` vocabulary is new: `CrawlRequested`,
`CrawlStarted`, `CrawlCompleted`, `CrawlSkipped`, `CrawlFailed`,
`MetadataExtracted`, `SocialDiscoveryCompleted`, `EnrichmentTriggered`,
`EnrichmentSkipped`, `ChangeEvaluated`.

Instrumented crawls: the onboarding enrichment crawl (`setup-company.ts`), the
profile-refresh crawl (`companyProfileServiceRest1Rest2Competitors.ts`), and the
Website Intelligence crawl boundaries (`crawlerService.ts`). Instrumentation is
opt-in via the optional `CrawlContext` third arg to `crawlWebsiteSources` —
omitting it preserves the exact prior behaviour.

## Observability (event-derived)

Counters via the existing HARDEN-001 registry (`recordRawCounter`, `crawl.*`):
`crawl.count`, `crawl.skipped`, `crawl.failed`, `crawl.change_detected`,
`crawl.business_change`, `crawl.major_change`, `crawl.duplicate_prevented`,
`crawl.network_requests_saved`, plus `enrichment_triggered/_skipped`. Events are
the source of truth; counters are a fail-safe projection.

## Future CKRE extension points (CKRE-002+)

- **Gate enrichment on the verdict**: `decideWebsiteChange` returning `UNCHANGED`
  is the hook to skip the ~5–6 uncached LLM calls in the profile refiner. This
  mission deliberately does NOT wire that (no AI changes).
- **Versioning/history**: `fingerprintStore` currently keeps the latest bundle;
  a bounded history array under `report_settings` (or a dedicated table) enables
  rollback.
- **Byte-level asset fingerprints**: logo/favicon are URL-hashed today; fetching
  and hashing the bytes would strengthen brand-change detection.
- **Sitemap/robots**: `crawlerService` fetches these; passing them into
  `computeWebsiteFingerprint` (already supported as optional inputs) extends
  Level-1 coverage.

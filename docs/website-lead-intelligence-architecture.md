# OmniVyra Website → Lead Intelligence — Canonical Architecture

The single, canonical end-to-end path. Every website (OmniVyra's own and every customer/tenant) flows through the **same** pipeline after tenant resolution. There is one capture path, one ingestion path, one repository, one workspace.

```
Website
  ↓   (tracker installed: omnivera-tracker.js, data-website-id)
Tracking            → /api/website-events/track  → visitor_sessions, tracking_events
  ↓
Session             → resolveVisitorSession (server-authoritative anonymous/session id)
  ↓
Attribution         → extractAttributionPayload + buildAttributionContract (utm/referrer/first+last touch; nothing dropped)
  ↓
Lead Capture        → tenantResolutionService.resolveTenantForWebsite → captureWebsiteLead / /api/leads (form_embed / webhook)
  ↓
Identity            → createLead → ensureUnifiedPerson (unified_persons)
  ↓
Repository          → adoptLead → durableLeadIntelligenceSink → upsertCanonicalLead (lead_intelligence + lead_intelligence_events)
  ↓                    (reads bridge legacy sources via projectExistingRow when the durable row is absent — fail-open)
Lead Intelligence   → leadIntelligenceReadService: searchLeads / getLeadStats / getEnrichedLeadProfile
  ↓                    (+ buyingIntent, leadActions, companyIntelligence — deterministic, composed, no LLM)
Reports             → website-intelligence (health-score, signals, attribution, form-performance)
  ↓
Workspace           → /lead-intelligence (overview, list, profile) ; /website-health (operational command center)
  ↓
Exports             → exportLeads (CSV / Excel) ; profile JSON
```

## Tenant resolution (the only entry point)
`tenantResolutionService.resolveTenantForWebsite` — priority order, reusing existing infra (no parallel registry):
1. **Verified website domain** — origin host → `company_domains` (verified) → `websites`.
2. **Configured website id** — `websites.id`, origin-enforced via `checkWebsiteOrigin`.
3. **Configured host header** — host → `company_domains` → `websites` (unverified allowed).
4. **Signed integration key** — `validateWebhookAuth` (inbound webhook / SDK).
5. **Canonical site configuration** — `LEAD_CAPTURE_DEFAULT_COMPANY_ID` (deprecated fallbacks: `OMNIVYRA_LEAD_COMPANY_ID` / `OMNIVYRA_SITE_ORIGINS`).
Unknown websites resolve to `null` (rejected) unless a default site is configured.

## Canonical Tracker Specification (Part 3)
There are three distinct, intentional tracker artifacts under `public/`. Each has **external (installed) callers** — none may be deleted without breaking live customer installs.

| File | Purpose (canonical?) | Install attribute | Storage keys | Endpoint |
|---|---|---|---|---|
| **`omnivera-tracker.js`** | **CANONICAL website lead-capture tracker** | `data-website-id` | `omnivera_anonymous_id`, `omnivera_session_id`, `omnivera_landing_page`, `omnivera_first_touch`, `omnivera_last_touch`, `omnivera_consent`, `omnivera_event_queue` | `/api/website-events/track` |
| `omnivera-attribution.js` | Cross-domain attribution SDK (token tagging, conversion record) | n/a (`OmnivyraAttribution.init`) | `omnivyra_attr_token` (localStorage + cookie), `omnivyra_attr_queue` | `/api/leads` |
| `tracker.js` | Legacy blog-intelligence tracker | `data-account` | `omn_session`, `omn_tab_<id>`, `omnivyra_v_<id>` | `/api/track` |

**Canonical install snippet (website lead capture):**
```html
<script src="https://www.omnivyra.com/omnivera-tracker.js" data-website-id="<WEBSITE_ID>"></script>
```
- **Website id** is the `websites.id` shown in the Website Setup wizard (step "Visitor tracking").
- **Company id** is never exposed to the client — it is resolved server-side from the website id / verified domain.
- **Session id / visitor id** are minted client-side (`omnivera_session_id` / `omnivera_anonymous_id`) and re-resolved server-side (`resolveVisitorSession`); the server never trusts client identifiers.
- **Attribution / UTM persistence**: `omnivera_first_touch` + `omnivera_last_touch` persist UTM + landing page across the journey; creator link params (`omn_asset_id` / `omn_variant_id` / `omn_strategy_id`) are captured at landing and retained.
- **Consent**: `omnivera_consent === 'denied'` gates capture.

### Legacy / alias status (cleanup)
- `tracker.js` (blog-intelligence) and `omnivera-attribution.js` (cross-domain SDK) are **separate live products**, not aliases of the website tracker. They are **retained** (installed on customer sites; not callerless).
- **No tracker file is safely removable** — install snippets live in external sites, so callers are not visible in this repo. Cleanup is documentation-level only (this spec); no public tracker artifact was deleted.

## Canonical Website Intelligence Repository (Phase 18)
`backend/services/websiteIntelligence/websiteIntelligenceRepository.ts` is the **single repository-backed read surface** for every website-facing intelligence capability. It **composes** the canonical owner-services (it computes nothing itself) and is **fail-open** (a failing source degrades to null/[]; the snapshot still returns).

| Method | Composes |
|---|---|
| `getWebsiteHealth` | `computeWebsiteHealthScore` + `getWebsiteHealthSummary` |
| `getWebsiteReadiness` | `buildActivationReadiness` |
| `getWebsiteTracking` | `getWebsiteHealthSummary.tracking_last_seen_at` |
| `getWebsiteSignals` | `getWebsiteIntelligenceSignals` |
| `getWebsiteIntegrations` / `getWebsiteDiagnostics` | `getIntegrations` + `deriveIntegrationHealth` |
| `getWebsiteRecommendations` | health-score + signals + readiness next-actions, **deduped** (one read surface; source builders retained) |
| `getWebsiteValidation` | 21-check orchestration over the above (no readiness logic duplicated) |
| `getWebsiteIntelligence` | module registry + freshness (Last Updated + Source per module) |
| `getWebsiteSummary` | executive summary, sections, top risks/opportunities, recommended actions, freshness |
| `getWebsiteSnapshot` | all of the above in **one** read (the only call the UI makes) |

**Read surface:** `GET /api/website-intelligence/canonical?company_id&website_id` → `{ snapshot }`. The Website Health page (`/website-health`) is **presentation only** and consumes solely this endpoint. Engines that exist but are generated on demand (SEO, Performance, Competitive) are reported **available** (never "unavailable").

### Deterministic website intelligence engines (Phase 18)
Four deterministic engines (no LLM, no re-crawl — they read persisted crawl/brand data only) live in `backend/services/websiteIntelligence/` and are composed into `snapshot.intelligence` + the module registry + the report:

| Engine | Reads | Honest gaps (not_evaluable) |
|---|---|---|
| `contentIntelligenceEngine` | canonical_pages, page_content, page_links | ICP alignment (no stored ICP) |
| `technicalIntelligenceEngine` | canonical_pages (http_status, crawl_metadata.meta_tags), website_health_scores | canonical/schema/robots/sitemap/headers/compression/assets (need rendered DOM/headers) |
| `accessibilityIntelligenceEngine` | canonical_pages.headings, page_content, page_links | alt/ARIA/contrast/keyboard/focus (need rendered DOM) — WCAG level honest, `insufficient_data` below 30% coverage |
| `brandIntelligenceEngine` | company_brand_identity, company_profiles, community_ai_actions, canonical_pages | NPS/reviews/competitor sentiment |

Each returns score (0..100 | null), health, **confidence = evaluable checks / total** (so honest coverage, never fabricated), freshness + provenance.

**Report integration (Phase G):** the three existing reports (Digital Authority Snapshot, Performance Intelligence, Market & Growth) each attach the canonical projection additively at their API route (`pages/api/reports/{snapshot,performance,growth}.ts`) via `getWebsiteReportSafe(companyId)` — a new optional `website_intelligence` field on the response, fail-open, **no existing calculation/section touched, no new report, no schema/API change.** The rich visual rendering lives on `/website-health`; the shared server-HTML report viewer is intentionally left untouched to avoid regressions.

## Canonical ownership (Phase 19 consolidation) — DO NOT BYPASS
```
Crawler → Persisted Website Data → Website Intelligence Engines
       → websiteIntelligenceRepository (SINGLE OWNER) → Canonical Snapshot
       → Website Health UI + Digital Authority Snapshot + Performance Intelligence + Market & Growth
```
The repository is the **only** owner of website health, scores, readiness, recommendations, executive summary, business impact and roadmap. Enforced facts:
- **One canonical snapshot:** `buildCanonicalWebsiteReportSnapshot(companyId)` (= `getWebsiteSnapshot`) — every report consumes this one object.
- **Executive summary (Phase B):** `buildExecutiveSummary` lives only in the repository; reports/UI display it, never build it.
- **Business-impact / relationship graph (Phases C/D):** `businessImpactGraph.ts` — deterministic issue→dimension→cascade map. Unmapped keys derive impact from their module, so a **future engine surfaces in all reports by extending only the repository** (no report edits). Every recommendation carries `impact{dimensions,cascade,summary}`, `estimatedROI`, `dependencies`, `originEngine`, `businessImpact`.
- **One recommendation pipeline:** `buildRecommendations` (merge + dedupe + prioritise + categorise) → 30/60/90-day roadmap. Reports never merge.
- **Report APIs (Phase J):** `/api/reports/*` import **only** `getWebsiteReportSafe` — no engine/service is called directly.
- **Shared UI (Phase I):** `components/websiteIntelligence/` (WebsiteExecutiveSummary, WebsiteHealthSection, WebsiteModuleCard, WebsiteRecommendationPanel, WebsiteRoadmap, BusinessImpactGraph, ConfidencePanel) — every React report surface imports these; no widget recomputes anything.
- **No future feature may bypass the repository.** New website intelligence = a new engine wired into `loadSources` + `buildModules`; it then appears in the snapshot, all three reports, and the dashboard automatically.

### One presentation system (Phase 20)
```
Canonical Snapshot → WebsitePresentationModel → { React components | HTML renderer }
```
- **One presentation model:** `buildWebsitePresentationModel(snapshot)` (`websitePresentationModel.ts`) — the single render-ready interpretation. No renderer reads repository objects independently.
- **One styling registry:** `presentationStyles.ts` — semantic tokens (good/warn/bad/neutral/high/strategic) with `badgeStyle()` (React inline style) and `badgeCss()` (HTML CSS) from the SAME colour source. One system for badges/scores/confidence/severity/category/roadmap colours.
- **Two thin renderers, same model:** React = `components/websiteIntelligence/` (`WebsiteIntelligenceReport` + sub-components, model-driven, registry-styled); HTML = `websiteIntelligenceHtmlRenderer.renderWebsiteIntelligenceHtml(model)`. The repository exposes `getWebsitePresentationModel` + `getWebsiteIntelligenceHtml` adapters so any HTML report generator renders the identical model with one call.
- **Zero duplicated rendering:** shared components carry no inline colour maps; the model + registry are single-owned. A 20th/30th engine appears in every surface (health UI, all three reports, HTML) by repository registration only — no renderer, report, or UI edits. The single recommendation pipeline (`buildRecommendations`) merges all engines + health-score + signals + readiness, dedupes, categorises (critical/high/medium/low/quick_win/strategic), prioritises, and tags affected modules + impact/effort/confidence. `getWebsiteReport` projects all sections (zero calculation).

## Canonical visitor identity standardization (Phase 18)
One visitor → one identity → one timeline → one attribution chain. The **canonical** identifiers (used by all future installations, emitted by `omnivera-tracker.js`):

| Concept | Canonical key | Legacy / compat |
|---|---|---|
| Anonymous id | `omnivera_anonymous_id` (localStorage) | — |
| Session id | `omnivera_session_id` (sessionStorage) | blog tracker `omn_session` |
| Attribution token | `omnivyra_attr_token` (localStorage + cookie) | — |
| First / last touch | `omnivera_first_touch` / `omnivera_last_touch` | — |
| Consent | `omnivera_consent` | — |
| Event endpoint | `/api/website-events/track` | blog `/api/track` |

**Compatibility layer (no breaking changes):** identity is **server-authoritative** — `resolveVisitorSession` re-resolves the client `anonymous_id`/`session_id` into the canonical `visitor_sessions` lineage, so legacy snippets and the canonical snippet converge on one identity without the client being trusted or re-keyed. Deployed snippets keep working; only the documented canonical keys are used for new installs.

# OMNIVYRA — REPORT 1 (DIGITAL SNAPSHOT) CLOSURE & EXECUTION GAP AUDIT

**Date:** 2026-09-05
**Branch audited:** `preserve/creator-canonical-template-pool` (30 commits ahead of `main`; every Report 1 file audited below is present on `main`)
**Runtime env verified:** Vercel project `omnivyra`, Production environment (`vercel env ls production`)
**Mode:** AUDIT ONLY. No code, migration, schema or configuration was modified.

---

## 1. EXECUTIVE VERDICT

### 1.1 Current maturity

Report 1 is **not an empty shell and not a finished product**. It is a genuinely well-engineered
**evidence-acquisition and scoring layer** with a **disconnected presentation layer** for the
specific things Report 1 V1 is defined by.

Three things are true simultaneously and must not be collapsed:

1. **The public-domain evidence engine is real and works.** The crawler, the four Website
   Intelligence engines, the public-domain audit, the digital-experience assessor, the AI
   citation matrix and SERP competitor discovery all execute, produce observed evidence, and
   abstain honestly when they cannot. This was verified by *running* the suites, not by reading
   them — 90/90 tests pass, and the run made **live** OpenAI probe calls (`status: ok, 902ms`)
   and a **live** Wikidata lookup (`status: ok`).

2. **The Report 1 Opportunity Engine exists, is correct, is tested — and is never rendered.**
   `assembleDigitalSnapshot` produces cross-source opportunities, ranked top priorities and the
   30/60/90 plan exactly as the spec requires. It is assigned to
   `SnapshotReport.digital_snapshot` and then **read by nothing**. A repo-wide grep for
   `digital_snapshot` returns exactly two non-test hits: the assignment and the type
   declaration.

3. **Four whole Report 1 domains have no public-domain evidence path at all**: Search/SEO
   visibility (bound to private GSC), Social presence, Reputation, and Performance — the last
   three because their credentials/flags are absent in production, the first because no
   public-domain search measurement was ever built.

### 1.2 V1 finish-line assessment

> *"Give a real company a credible public-domain Digital Snapshot with evidence-backed diagnosis,
> opportunities and priorities."*

**Answer: PARTIAL — and it fails on the second half of the sentence.**

For a real company today, Omnivyra **can** produce an evidence-backed *diagnosis* of website
foundation, content extractability, entity clarity, competitive set and partial AI visibility.
It **cannot** deliver the *opportunities and priorities* half of the finish line, because the
component that produces spec-compliant opportunities and priorities is not connected to any
output surface. What the customer actually receives instead is a *different*, legacy
opportunity set (`action_playbook` + `improvement_todos`) derived from decision objects and
dimension scores — not from cross-source public evidence, and carrying no 30/60/90 plan.

### 1.3 Biggest blockers (ranked)

| # | Blocker | Why it blocks V1 |
|---|---------|------------------|
| 1 | `digital_snapshot` (opportunities, top priorities, 30/60/90 plan) is computed and discarded | The V1 finish line literally names these three outputs |
| 2 | Digital-experience findings, competitive tables, performance evidence and evidence coverage are all computed on `SnapshotReport` but absent from the export contract | The report's most concrete, most public, most credible evidence never reaches the customer |
| 3 | No public-domain search visibility measurement exists | Section D of Report 1 has zero evidence path; SERP is bought and paid for but used only for competitor discovery |
| 4 | Historical store defaults to `InMemoryHistoryStore`; `SUPABASE_HISTORY_ENABLED` is unset in production | Nothing Report 1 measures is durably persisted → no baseline for Report 2, and trajectory/change/forecast can never resolve |
| 5 | The public/private evidence boundary is a test-only vocabulary, not a runtime guard | `evidenceProvenance.ts` is imported by two test files and zero runtime modules |

### 1.4 Biggest reusable assets (do not rebuild any of these)

| Asset | Path | Why it is valuable |
|-------|------|--------------------|
| Crawler + report-triggered crawl | `backend/services/crawlerService.ts`, `backend/services/crawl/reportCrawlEvidenceService.ts` | Persists `canonical_pages` / `page_content` / `page_links` / `crawl_metadata.signals`; already wired into report generation; robots.txt + sitemap.xml + JSON-LD + `sameAs` + security headers already parsed |
| Technical Intelligence engine | `backend/services/websiteIntelligence/technicalIntelligenceEngine.ts` | 23 deterministic checks incl. canonical tags, structured data, robots, sitemap, redirects, broken links, hreflang, indexability, duplicate titles — each with `not_evaluable` honesty |
| Content / Accessibility / Brand engines | `backend/services/websiteIntelligence/*IntelligenceEngine.ts` | Deterministic, provenance-tagged (`provenance.sources`, `checksEvaluated/checksTotal`) |
| Public-domain audit | `backend/services/publicDomainAuditService.ts` (798 lines) | Site structure, geo/answer/entity coverage, declared evidence, 12 issue types — all crawl-derived |
| Digital experience assessor | `backend/services/digitalExperience.ts` | 4 pillars, every finding carries `evidence` + `measurement` + `action`; already spec-shaped |
| Report 1 assembler | `backend/services/digitalSnapshotAssembly.ts` | Cross-source rules, `Impact × Confidence ÷ Effort`, contradiction guard, evidence gate, honest empty horizons |
| AI citation matrix + adapters | `backend/services/intelligence/aiCitationMatrixService.ts`, `adapters/openaiAdapter.ts` | Real probes, real citation extraction, never synthesises a rate |
| Canonical export renderer | `backend/services/intelligence/exportRenderer*.ts` | Gates every number on `isMeasuredScore`; renders `—` rather than a fabricated value |
| Evidence provenance vocabulary | `backend/services/evidenceProvenance.ts` | The correct public/private taxonomy already exists; it only needs to be *enforced* |

### 1.5 Evidence-integrity risks

The system's evidence discipline is **above average and deliberately engineered** — but three
concrete leaks exist:

* **R1 — Numeric value survives an `insufficient_signal` state.** `aggregateOverallScore`
  (`canonicalReportBuilderInputs.ts:169-190`) returns `{ value: <number>, state:
  'insufficient_signal' }` when fewer than half the pillars are measured. The HTML renderer
  gates correctly (`isMeasuredScore`, `renderAuthorityBar`), but **Report 2 does not**:
  `performanceReportService.ts:541` reads `overview?.overall_score?.value ?? snapshot.score?.value`
  with no state check. This is a live `UNAVAILABLE → PRESENTED AS FACT` path across the report
  boundary.
* **R2 — GSC (private) can reach the "public-domain" report.** `visualIntelligenceHelpers.ts:312`
  tags rank evidence `['GSC']`; the impressions/clicks/ctr/avg_position fields it reads come from
  decision-object evidence. `evidenceProvenance.ts` correctly classifies `gsc` as
  `CONNECTED_SOURCE` / not-Report-1 — but nothing at runtime consults it.
* **R3 — Declared data presented under observed-sounding field names.**
  `company_context.homepage_headline` is populated from `profile.key_messages`
  (`narrativeHelpers.ts:45`), not from the crawled homepage. `primary_offering` comes from
  `profile.products_services`. These are `COMPANY_CONFIRMED`, rendered without that label.

---

## 2. CURRENT CAPABILITY MAP

Status vocabulary is exactly as specified. "Rendered" means *reaches the customer-visible
Digital Snapshot document*, which is `renderCanonicalReportHtml → buildCanonicalExport({shape:
'executive'}) → renderExportHtml`, the only surface `pages/reports/view/[reportId].tsx` shows
for `reportType === 'snapshot'`.

### A. Company Understanding

| Requirement | Implementation | Source | Public? | Provenance kept? | Normalized? | Downstream? | Rendered? | Status |
|---|---|---|---|---|---|---|---|---|
| Company identity (name, domain) | `reportInputResolver.resolved` | `company_profiles` + request payload | Declared | No provenance tag | Yes | Yes | Yes (cover) | **PARTIAL** |
| Products / services | `profile.products_services` → `companyContext.productServices` | Declared | Declared | No | Yes | Yes (AI `expertise` queries, competitor keywords) | Indirect | **PARTIAL** |
| Industry / market category | `resolved.businessType` | Declared | Declared | No | Yes | Yes (AI `category` queries) | Indirect | **PARTIAL** |
| Geography | `resolved.geography` | Declared | Declared | No | Yes | Yes (SERP geo) | No | **PARTIAL** |
| Target customers / ICP | `ReportCompanyContext.targetCustomer`, `idealCustomerProfile` | Declared | Declared | No | Yes | Competitor engine only | No | **DISCONNECTED** |
| Business model | Not collected for Report 1 | — | — | — | — | — | — | **NOT IMPLEMENTED** |
| Value proposition | `digitalExperience` `value_communication` pillar (H1 presence, word count, meta) | **Crawl (observed)** | **Yes** | Yes (`evidence` string) | Yes | `assembleDigitalSnapshot` only | **No** | **DISCONNECTED** |
| Offerings / use cases | `publicDomainAudit.structure.product_pages` | **Crawl** | Yes | Yes | Yes | Decisions | Indirect | **PARTIAL** |
| Customer problems | `publicDomainAudit` intent/awareness mention counts | Crawl | Yes | Weak | Yes | Decisions | Indirect | **PARTIAL** |
| Positioning | `profile.brand_positioning` → `strategicContext.positioningStrength` | Declared | No | No | Yes | Yes | Yes (`renderStrategicPosture`) | **PARTIAL** — declared rendered as position |
| Publicly discoverable objectives | Not collected | — | — | — | — | — | — | **NOT IMPLEMENTED** |
| Entity identity (Wikidata QID, `sameAs`) | `WikidataAdapter` + `crawl_metadata.signals.same_as` | **Wikidata + schema.org (observed)** | Yes | Yes | Yes | `entity_graph_strength` dimension | **Yes** | **IMPLEMENTED / PROVEN** (live lookup observed in test run) |

> **Headline for Section A:** the *observed* company understanding (crawl-derived value prop,
> offerings, entity identity) is real but under-rendered; the *rendered* company understanding
> is largely the customer's own onboarding form, presented without a declared-vs-observed label.

### B. Website Intelligence

| Capability | Implementation | Status | Rendered? |
|---|---|---|---|
| Crawlability | `technicalIntelligenceEngine` `crawlability` check (% HTTP 200) | **IMPLEMENTED** | Aggregated only |
| Indexability | `indexability` check (noindex meta) | **IMPLEMENTED** | Aggregated only |
| Technical structure | 23 checks incl. heading structure, page depth | **IMPLEMENTED** | Aggregated only |
| Metadata | `meta_tags`, `duplicate_titles`, `duplicate_descriptions` | **IMPLEMENTED** | Aggregated only |
| Canonical tags | `canonical_tags` check from `signals.canonical` | **IMPLEMENTED** | Aggregated only |
| Sitemap | `sitemap_xml` + `sitemap_url_count` (crawler fetches `/sitemap.xml`, follows `Sitemap:` in robots) | **IMPLEMENTED** | Aggregated only |
| robots.txt | `robots_txt` check | **IMPLEMENTED** | Aggregated only |
| Redirects | `redirect_chains` check (3xx count) | **PARTIAL** — counts redirecting pages, does not trace chains | Aggregated only |
| Broken links | `broken_links` check (4xx/5xx) + `digitalExperience` `information_accessibility` finding with example URLs | **IMPLEMENTED** | Aggregated only; the *finding with URLs* is **DISCONNECTED** |
| Structured data | `structured_data` check + `jsonld_types` from crawl | **IMPLEMENTED** | Aggregated only |
| Internal linking | `internal_linking` (avg links) + orphan detection in `publicDomainAudit` | **IMPLEMENTED** | Aggregated only |
| URL architecture | `crawl_depth` / `page_depth` | **PARTIAL** — depth only, no slug/taxonomy analysis | Aggregated only |
| Mobile readiness | `accessibilityIntelligenceEngine` `viewport` check only; PSI mobile form factor unavailable | **PARTIAL** | Aggregated only |
| Measurable performance | `performanceEvidence.ts` (PageSpeed Insights v5) | **UNAVAILABLE** — `PAGESPEED_API_KEY` and `PAGESPEED_ENABLED` both absent in production | Not rendered |
| UX | `digitalExperience` 4 pillars | **IMPLEMENTED** but **DISCONNECTED** | No |
| CTA quality | `digitalExperience` `conversion_readiness` (coverage % + action-verb analysis) | **IMPLEMENTED** but **DISCONNECTED** | No |
| Value proposition | `digitalExperience` `value_communication` | **IMPLEMENTED** but **DISCONNECTED** | No |
| Trust signals | `contentIntelligenceEngine` testimonials/social proof/case studies/legal checks | **IMPLEMENTED** | Aggregated only |
| Visible conversion friction | `digitalExperience` `technical_friction` (PSI-dependent) + `weak_conversion_path` decision | **PARTIAL / UNAVAILABLE** | No |

**Crawl budget note:** the report path crawls **15 pages** (`REPORT_CRAWL_MAX_PAGES` default,
unset in production), min-usable **3 pages**, 20s soft budget, 7-day free-tier cooldown. Every
percentage above is therefore computed over ≤15 URLs. That is defensible but must be stated in
the report; it currently is not.

### C. Content Intelligence

| Capability | Implementation | Status |
|---|---|---|
| Content inventory | `publicDomainAudit.structure` (home/product/pricing/blog/contact/geo/legal) | **IMPLEMENTED** |
| Content depth | `thinPages` (<120 words on important pages), `productPageWordAvg` | **IMPLEMENTED** |
| Topical coverage | `entityCandidates` + `topical_authority` dimension | **PARTIAL** — token-frequency heuristic, not a topic model |
| Intent alignment | `awarenessMentions` / `conversionMentions` / `comparisonMentions` regex counts → `intent_gap` decision | **PARTIAL** — keyword presence, not intent classification |
| Commercial alignment | `pricingExists`, `conversionMentions` | **PARTIAL** |
| Expertise / trust / freshness | `trustMentions`, `caseStudyMentions`; freshness via `signals.published_time` → `authority_velocity` (correctly relabelled "Content Freshness") | **IMPLEMENTED** |
| Content gaps | `content_gap`, `weak_content_depth`, `localized_content_gap` decisions | **IMPLEMENTED** |
| Missing use cases | Not detected | **NOT IMPLEMENTED** |
| Missing industry pages | Not detected | **NOT IMPLEMENTED** |
| Missing comparison pages | `comparisonMentions` counted; no explicit comparison-page gap decision | **PARTIAL** |
| Missing problem/solution content | Not detected as such | **NOT IMPLEMENTED** |
| Observable cannibalization | Not detected (duplicate *titles* only) | **NOT IMPLEMENTED** |
| Publishing patterns | `published_time` recency only; no cadence analysis | **PARTIAL** |

> **Does Omnivyra produce content *intelligence* or just collect content?** It produces genuine
> intelligence on depth, structure, answerability and trust signals. It does **not** produce
> gap intelligence in the shape Report 1 asks for (missing use-case / industry / comparison /
> problem-solution pages), because there is no offering-to-page coverage map.

### D. Search / SEO Visibility

| Capability | Implementation | Status |
|---|---|---|
| Search visibility | `visualIntelligence.seo_capability_radar.rank_tracking_score` | **UNAVAILABLE for Report 1** — derived from impressions/clicks/CTR whose source tag is literally `['GSC']` (`visualIntelligenceHelpers.ts:312`) |
| Branded vs non-branded | Not separated | **NOT IMPLEMENTED** |
| Search demand signals | None public | **NOT IMPLEMENTED** |
| Search gaps | `seo_gap` decisions from crawl (metadata, structure) — *on-page* gaps, not *search* gaps | **PARTIAL / mislabelled** |
| Ranking evidence | `serpAcquisitionService` exists (SerpApi, ScaleSERP, DataForSEO, manual import), writes `serp_snapshot` rows, has query seeding and provider health | **DISCONNECTED** — only callers are `pages/api/cron/serp-acquisition.ts` and `pages/api/super-admin/serp-acquisition.ts`. Not on the report path. Its query seeder `prioritySerpQueries(gsc)` takes **GSC** as input |
| Competitor visibility | `discoverCompetitorDomainsFromSerp` — live SerpApi keyword→domain discovery | **IMPLEMENTED / PROVEN** (credential present in production as `SERP_API_KEY`) |

> **This is the single largest true capability hole.** Omnivyra pays for SERP, calls SERP inside
> Report 1, and throws away everything except the competitor domain list. The company's own
> ranking positions, which are sitting in the same SERP responses, are never extracted.

### E. AEO / AIO / AI Visibility

| Question | Answer | Evidence |
|---|---|---|
| Are actual AI systems queried? | **YES** | Live `chatgpt probe status: ok, duration_ms: 902` observed during this audit's test run |
| Which systems? | **chatgpt only.** `AI_PROVIDERS` = chatgpt, gemini, claude, perplexity, copilot. Production has only `OPENAI_API_KEY` | `vercel env ls production` |
| Are responses captured? | Yes, in-process (`answer` → `extractCitation`) | `openaiAdapter.ts:281-292` |
| Are citations/mentions captured? | Yes as `CitationMention` with `appeared` + `prominence` | `aiCitationMatrixService.ts` |
| Is evidence retained? | **PARTIAL** — `AICitationMatrixSummary` (the persisted/rendered shape) drops `mentions` entirely; only `observed_count` and signal strings like `openai:branded:cited` survive | `canonicalReportTypes.ts:337-362` |
| Is it reproducible? | **NO** — the query text, the answer text and the matched span are not persisted anywhere |
| Does it ever claim a query happened when it did not? | **NO.** Verified: every unavailable path returns `state:'unavailable'` with a literal reason; `buildAggregateCanonicalScore` returns `value: null` when zero cells are measured | `providerRegistry.ts`, `aiCitationMatrixService.ts:92-100` |

**Coverage arithmetic in production:** 5 providers × 4 query classes = **20 cells**. Maximum
measurable = **4 cells (20%)**, and only when brand name, category, competitors *and*
product/services are all present. `renderAiDiscoverability` will therefore render a section
whose honest reading is "1 of 5 answer engines observed."

**Status: PARTIAL — evidence-honest, single-provider, non-reproducible.**

### F. Competitive Public-Domain Intelligence

| Capability | Implementation | Status |
|---|---|---|
| Competitor discovery | `discoverCompetitorDomainsFromSerp` — up to 10 keywords, blocked-host filter, expansion retry, `serp_status: live \| fallback` | **IMPLEMENTED / PROVEN** |
| Competitor identification | `competitorEngineService*` + `competitorIdentityHardening` | **IMPLEMENTED** |
| Competitor relevance | `competitorTaxonomy`, product-first classification gate | **IMPLEMENTED** |
| Public positioning | `competitorEnrichmentService` | **PARTIAL** |
| Content footprint | Not measured for competitors | **NOT IMPLEMENTED** |
| Search visibility (competitor) | `competitive_surface_share` in canonical | **PARTIAL** |
| Digital strengths/weaknesses | `positioning.strengths_vs_company` etc. | **PARTIAL** — enrichment-derived, not crawl-derived |
| Differentiation | `competitive_tables.productCompetition` two-axis model | **IMPLEMENTED** but the *tables* are **DISCONNECTED** (not in the export contract) |

Genuinely public-domain? **Discovery yes** (live SERP). **Enrichment partially** — it draws on
stored/LLM knowledge rather than a competitor crawl. `serp_status: 'fallback'` is tracked, which
is the right honesty primitive.

### G. Social / Public Presence

| Capability | Implementation | Status |
|---|---|---|
| Public profile discovery | `crawl_metadata.signals.same_as` from JSON-LD → `declared_evidence.same_as` (count, domains, `destination_types`) | **PARTIAL** — declared links only, never visited |
| Presence | `socialCount` from `resolved.socialLinks` (declared) → `supportingSources: ['social_links']` | **PARTIAL** |
| Activity | — | **NOT IMPLEMENTED** |
| Public engagement signals | — | **NOT IMPLEMENTED** |
| Messaging | — | **NOT IMPLEMENTED** |
| Content themes | — | **NOT IMPLEMENTED** |
| Consistency | — | **NOT IMPLEMENTED** |

**Platforms actually supported for public presence evidence: none.** The OAuth social
integrations that exist in the platform are *owned-account* connections (private, Report 2+),
not public-profile observation. `renderDeclaredEvidence` renders the `sameAs` **count and
destination types** — which is the honest thing to do and should not be mistaken for social
intelligence.

**Status: NOT IMPLEMENTED (beyond declared-link inventory).**

### H. Reputation

| Capability | Implementation | Status |
|---|---|---|
| Public reviews | `reviewConnectors.ts`: Google Places, Yelp, Trustpilot implemented; G2, Capterra are `unavailableStub` | **DISCONNECTED** |
| Ingestion | `reviewIngestionService` + `reviewSourceRepository` + migration `20260903000000_review_sources.sql` | **DISCONNECTED** — orchestrator is called only from `ingestionScheduler`, never from the report path |
| Trust provider wiring | `TrustCoherenceAdapter` registered only when `TRUST_COHERENCE_ENABLED === 'true'` | **UNAVAILABLE** — flag absent in production |
| Sentiment | Not computed | **NOT IMPLEMENTED** |
| Recurring praise / complaints | Not computed | **NOT IMPLEMENTED** |
| Questions / objections | `faqMentions` on own site only | **NOT IMPLEMENTED** |
| Trust signals (on-site) | `contentIntelligenceEngine` testimonials / social proof / case studies / legal pages | **IMPLEMENTED** |

Production credentials absent: `TRUST_COHERENCE_ENABLED`, `REVIEWS_API_KEY`,
`GOOGLE_PLACES_API_KEY`, `YELP_API_KEY`, `TRUSTPILOT_API_KEY`. The `trust_coherence` dimension
therefore always returns `unavailable` with the honest reason *"No review or reputation source
is connected yet."*

**Status: NOT IMPLEMENTED as a Report 1 capability. On-site trust signals only.**

---

## 3. END-TO-END BREAKPOINT ANALYSIS

### 3.0 The working spine (for reference)

```
UI  pages/reports/… → POST /api/reports/generate
 ↓  reportCardService.startAsyncReportGeneration
API ✓
 ↓
SVC generateReportPayload (reportCardServiceAssembly.ts:324)
 ├─ resolveInputForReportCategory        ✓
 ├─ ensureReportCrawlEvidence            ✓  (15 pages, 7d cooldown)
 ├─ runCompanyBlogIntelligence           ✓
 └─ composeSnapshotReport                ✓
DATA reports.data.composed_report        ✓  (whole SnapshotReport persisted)
 ↓
API GET /api/reports/[reportId]?format=html
 ↓  mapComposedReport → ReportViewPayload
 ↓  renderCanonicalReportHtml(payload)   ← reads ONLY payload.canonical
OUT 19-block Authority Intelligence Dossier
```

### 3.1 BREAK — Report 1 Opportunity Engine (P0)

```
UI ✓ → API ✓ → Service ✓ (assembleDigitalSnapshot runs, deterministic, tested 30/30)
      → Data ✓ (persisted inside composed_report JSON)
      → Mapper ✗ (ComposedReportData has no digital_snapshot field; grep count = 0)
      → Export contract ✗ (CanonicalExportPayload has no equivalent)
      → Renderer ✗ (renderExportHtml never references it)
      → OUTPUT UNAVAILABLE
```
**Exact break point:** `pages/api/reports/reportComposedMapper.ts:472` maps `canonical` via an
`as any` cast and nothing else from the Phase 2/3/4 layer.

### 3.2 BREAK — Digital Experience findings (P0)

```
UI ✓ → API ✓ → Service ✓ (assessDigitalExperience over the real crawl corpus)
      → Data ✓ (SnapshotReport.digital_experience)
      → Canonical builder ✗ (buildCanonicalReport never reads digital_experience)
      → Mapper ✗ → Renderer ✗ → OUTPUT UNAVAILABLE
```
**Cost of this break:** the most concrete customer-legible evidence in the entire product —
*"4 of 15 pages returned 4xx (e.g. /pricing → 404)"*, *"Only 3 of 15 pages expose a call to
action"*, *"the home page has NO H1"* — is computed and thrown away.

### 3.3 BREAK — Competitive tables (P1)

```
UI ✓ → API ✓ → Service ✓ (buildCompetitiveTables, two-axis canonical relation model)
      → Data ✓ (SnapshotReport.competitive_tables)
      → Export contract ✗ → OUTPUT UNAVAILABLE
```
A *different* competitive surface (`competitive_surface_share`, `buildCompetitorMatrix`) is
rendered from the canonical layer, so the customer sees competition — but not the two-axis
product-vs-customer distinction the taxonomy work built.

### 3.4 BREAK — Search / SEO visibility (P0)

```
UI ✓ → API ✓ → Service ✓ (serpAcquisitionService: 4 providers, seeding, health, cost governor)
      → Provider ✓ (SERP_API_KEY present in production)
      → Report path ✗ (runSerpAcquisition is not called by composeSnapshotReport)
      → Own-ranking extraction ✗ (never implemented — SERP results are filtered to competitor domains only)
      → OUTPUT UNAVAILABLE (and the slot it would fill is occupied by a GSC-derived, private-source metric)
```

### 3.5 BREAK — Performance evidence (P1)

```
UI ✓ → API ✓ → Service ✓ (performanceEvidence.ts, PSI v5, CrUX field + lab, form factors)
      → Provider ✗ (PAGESPEED_API_KEY / PAGESPEED_ENABLED both unset in production)
      → OUTPUT `state:'unavailable'` with an honest reason  ← correct behaviour, missing capability
```
Downstream consequence: `rulePerformanceFriction` in the assembler always abstains, and
`technical_friction` is permanently empty.

### 3.6 BREAK — Reputation (P1)

```
UI ✓ → API ✓ → Connectors ✓ (Google Places / Yelp / Trustpilot implemented)
      → Orchestrator ✗ (runReviewIngestion called only from ingestionScheduler, not the report)
      → Flag ✗ (TRUST_COHERENCE_ENABLED unset)
      → Credentials ✗ (all four review keys unset)
      → Migration ? (20260903000000_review_sources.sql — application to production UNVERIFIED)
      → OUTPUT `unavailable` with honest reason
```
**Four independent gates.** Removing any three still yields nothing.

### 3.7 BREAK — Durable baseline / history (P0 for Report 2, P1 for Report 1)

```
Service ✓ (persistCanonicalSnapshot builds the full record bundle every run)
      → Store ✗ (historicalPersistence.ts:233 — `let activeStore = new InMemoryHistoryStore()`)
      → Flag ✗ (SUPABASE_HISTORY_ENABLED unset → SupabaseHistoryStore never registered)
      → Schema ✓ (report_score_history + 5 sibling tables exist in migration 20260601000000)
      → OUTPUT: written:false / discarded at lambda teardown
```
Downstream: `change_intelligence` is hardcoded to `state:'insufficient_history'`
(`canonicalReportBuilderAssembly.ts:709`), `forecast` cannot resolve, `authority_trajectory`
cannot resolve, `renderTrajectoryMovement` always renders the empty state, and **Report 2 has no
Report 1 baseline to compare against**.

### 3.8 BREAK — Social / public presence (P1)

```
UI ✓ → API ✓ → Service: sameAs extraction ✓ (declared links)
      → Profile fetch ✗ (never implemented — no connector visits a public profile)
      → OUTPUT: link inventory only
```

### 3.9 DEFECT — orphan snapshot route (P2)

`pages/api/reports/snapshot.ts` has **zero callers** in the repo. It calls
`composeSnapshotReport(companyId)` with **no options**, so `resolvedInput` is `null` and
`buildCompetitorIntelligenceActive` falls back to the literal domain **`'your-site.com'`**
(`reportCompetitorIntelligenceServiceEngine.ts:427`). Any caller would pay for real LLM + SERP
requests and receive a report about a placeholder domain.

### 3.10 DEFECT — duplicated HTML render on every view (P2)

`pages/reports/view/[reportId].tsx` fetches `?format=html` on every snapshot load. That triggers
a full `buildCanonicalExport` + `renderExportHtml` server-side render in addition to the JSON
render already returned. Correct output, avoidable cost.

---

## 4. EVIDENCE & PROVENANCE AUDIT

### 4.1 What the four states map to today

| Spec class | Implementation | Verdict |
|---|---|---|
| **OBSERVED** | `ScoreState: 'measured'` + `EvidenceSourceKind` ∈ {crawler, public_audit, competitor_intelligence, wikidata, google_kg, schema_org, llm_probe, backlink_api, review_aggregator, social_links} | **IMPLEMENTED** |
| **INFERRED** | `ScoreState: 'inferred'`; sources {expertise_extractor, decisions, heuristic}. Explicitly downgraded: `authority_inflow` claiming `measured` without a real `backlink_api` tag is forced to `inferred` (`canonicalReportBuilderInputs.ts:110-111`) | **IMPLEMENTED — and notably well done** |
| **ESTIMATED** | Only `benchmark_dataset`. No `'estimated'` `ScoreState` exists | **PARTIAL** — the state machine has 4 states (`measured`/`inferred`/`insufficient_signal`/`unavailable`); ESTIMATED is folded into `inferred` |
| **UNAVAILABLE** | `ScoreState: 'unavailable'` / `'insufficient_signal'` + a literal `reason_unavailable` on every provider result | **IMPLEMENTED / PROVEN** |

### 4.2 The prohibited transition — `UNAVAILABLE → ESTIMATED → PRESENTED AS FACT`

Tested location by location:

| Location | Guard | Verdict |
|---|---|---|
| `renderAuthorityBar` (`visualPrimitives.ts:91`) | `measured = typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable'`; renders `—` otherwise | **SAFE** |
| `renderExecutiveRealitySnapshot` (`exportRendererAssembly.ts:235`) | `isMeasuredScore(...)` before printing the value | **SAFE** |
| `authorityPositionCard` (`insightCards.ts:85`) | `if (!isMeasured(overall)) return null` | **SAFE** |
| `buildAggregateCanonicalScore` (AI matrix) | returns `value: null` with zero measured cells | **SAFE** |
| `assembleDigitalSnapshot` | `passesEvidenceGate` requires ≥1 `measured`/`inferred` evidence item; `isUnmeasured` contradiction guard | **SAFE** |
| `aggregateOverallScore` (`canonicalReportBuilderInputs.ts:184-189`) | returns a **numeric value together with `state:'insufficient_signal'`** | **LEAK (R1)** — safe only because every current renderer re-checks state |
| `performanceReportService.ts:541` | `overview?.overall_score?.value ?? snapshot.score?.value ?? null` — **no state check** | **LIVE LEAK (R1)** — an insufficient-signal number crosses into Report 2 as `authority_score` |
| `canonicalExport` `snapshot_summary.overall_value` | ungated pass-through | **LATENT LEAK** — `shape:'snapshot'` is not currently used by the report route |

### 4.3 Public/private boundary enforcement

`backend/services/evidenceProvenance.ts` defines exactly the right taxonomy —
`PUBLIC_OBSERVED / INFERRED / ESTIMATED / UNAVAILABLE / COMPANY_CONFIRMED / OMNIVYRA_OBSERVED /
CONNECTED_SOURCE`, with `gsc → CONNECTED_SOURCE` explicitly called out as *"the single most
important entry in this table."*

**It has zero runtime consumers.** Grep result: imported by
`backend/tests/unit/digitalSnapshotAssembly.test.ts` and
`backend/tests/unit/reportEvidenceDiscipline.test.ts` only.

Consequence: the public-domain boundary is a **tested intention, not an enforced invariant**.
A tenant with Search Console connected will produce GSC-derived decision objects, which flow
into `visualIntelligenceHelpers` and are tagged `['GSC']` — inside a report the product calls
public-domain.

### 4.4 Source, timestamp, freshness, confidence, reliability, abstention

| Attribute | Implementation | Verdict |
|---|---|---|
| Source | `EvidenceTrace.sources: EvidenceSourceKind[]` on every score | **IMPLEMENTED** |
| Provenance (origin) | `evidenceProvenance` vocabulary exists, unenforced | **DISCONNECTED** |
| Timestamp | `EvidenceObservation.observed_at`; `freshnessFromTimestamp` | **IMPLEMENTED** |
| Freshness | `EvidenceTrace.freshness.{last_observed_at, age_hours}` | **PARTIAL** — `age_hours` is set to `null` by `mergeEvidence` and by `aggregateOverallScore` |
| Confidence | `ConfidenceBand` from evidence count + source quality (`confidenceBandFromCount`) | **IMPLEMENTED** |
| Evidence classification | `ScoreState` 4-state machine | **IMPLEMENTED** |
| Source reliability | `providerObservability`, `logProviderCall`, `SerpProviderHealth`, `providers_used`/`providers_unavailable` | **IMPLEMENTED** (but not persisted — see 3.7) |
| Abstention behaviour | Every provider returns `unavailable` + literal reason; the assembler returns fewer opportunities rather than weaker ones; `renderInsufficientReportHtml` holds the whole document open | **IMPLEMENTED / PROVEN** |

**Overall evidence-discipline grade: strong architecture, one real numeric leak (R1), one
unenforced boundary (R2/§4.3), one mislabelled surface (R3).**

---

## 5. REPORT OUTPUT AUDIT

The Digital Snapshot the customer sees is the 19-block document produced by
`renderExportHtml` (`exportRendererOutput.ts:380-537`). Assessment is
`data → intelligence → API → UI → rendered`, not "does a component exist".

| # | Required section | What actually renders | Data → Intel → API → UI | Status |
|---|---|---|---|---|
| 1 | **Executive Snapshot** | `renderExecutiveRealitySnapshot` + cover (Authority Shape, thesis, maturity stage, Authority Index bar) | ✓→✓→✓→✓ | **IMPLEMENTED** |
| 2 | **Company / Positioning** | `renderBrandBrief`, `renderStrategicPosture`, `renderMarketPosition` (§06) | ✓→✓→✓→✓ but inputs are **declared** profile data | **PARTIAL** — renders, but on unlabelled declared evidence |
| 3 | **Discoverability** | Folded into §03 AI Discoverability + `topical_authority` dimension | ✓→✓→✓→partial | **PARTIAL** — no organic-search half |
| 4 | **Website & Technical Health** | **No section.** Foundation-pillar *scores* appear inside §01/§02; the 23 technical checks, robots/sitemap/canonical/structured-data results and the digital-experience findings do not | ✓→✓→✗ | **DISCONNECTED** |
| 5 | **Content** | **No section.** `extraction_readiness` + `topical_authority` scores only; no depth/gap/freshness detail | ✓→✓→✗ | **DISCONNECTED** |
| 6 | **Search / SEO** | **No section.** `renderChannelStrategySection` is named for channels but `buildChannelLeverage` reads **only the AI citation matrix** (`intelligenceSurfacesFoundations.ts:410-412`) | ✗ at source | **NOT IMPLEMENTED** |
| 7 | **AI / AEO / AIO** | §03 `renderAiDiscoverability` + AI retrieval reliability, trajectory, competitive AI, absence risk, strategic unlock | ✓→✓→✓→✓ | **PARTIAL** — real, but 1 of 5 providers |
| 8 | **Social / Reputation** | §04 `renderTrustConsistency` — always `unavailable`; `renderDeclaredEvidence` shows `sameAs` counts + legal-page presence | partial→✓→✓ | **UNAVAILABLE** |
| 9 | **Competitive Position** | §07 `renderCompetitiveLandscapeSection` (matrix, pressure, peer gap, benchmark) | ✓→✓→✓→✓ | **IMPLEMENTED** (canonical surface); two-axis tables **DISCONNECTED** |
| 10 | **Evidence Coverage** | `renderExecutiveReadinessSummary` + §09 `renderDataConfidenceCoverageSection` + `renderReportDisclosures` + `renderMethodology` | ✓→✓→✓→✓ | **IMPLEMENTED / PROVEN** — the strongest section in the report |
| 11 | **Opportunities** | §11 `renderStrategicActionPlan` from `action_playbook`, built by `buildActionPlaybook` from **legacy decision summaries** (`seo_executive_summary.top_3_actions`, `geo_aeo…`, competitor, unified, top_priorities) | ✓→✓→✓→✓ | **PARTIAL** — renders, but is **not** the spec's cross-source opportunity engine |
| 12 | **Top Priorities** | Same source, leverage-ranked, maturity-aware | ✓→✓→✓→✓ | **PARTIAL** — `digital_snapshot.topPriorities` (Impact×Confidence÷Effort, evidence-gated) is discarded |
| 13 | **30/60/90-day recommendations** | **No section.** `CanonicalAction.timeline {short, mid, long}` is per-action prose; `improvement_todos` carry effort but no horizon | ✓ (built)→✗ | **DISCONNECTED** — `DigitalSnapshotPlan.days_0_30 / 31_60 / 61_90` exists and is discarded |

**Sections rendered that Report 1 does not require:** Momentum & Maturity (§08) and Trajectory
Movement — both permanently empty in production because the historical store is in-memory. They
render an honest empty state, which is acceptable, but they consume executive attention that
Sections 4/5/6 should own.

---

## 6. BASELINE / REPORT 2 CONTRACT AUDIT

*(Boundary check only — no Report 2 capability audit, no Report 2 implementation.)*

### 6.1 What Report 1 must persist, and whether it does

| Baseline object | Schema exists | Written at runtime | Readable by Report 2 | Status |
|---|---|---|---|---|
| Baseline metrics (authority, AI visibility, maturity) | `report_score_history` ✓ | **No** — `InMemoryHistoryStore` | No | **NOT PERSISTED** |
| Pillar baselines | `report_pillar_history` ✓ | No | No | **NOT PERSISTED** |
| Evidence | `report_evidence_history` ✓ | No | No | **NOT PERSISTED** |
| Source | `report_provider_history` ✓ (`providers_used` / `providers_unavailable`) | No | No | **NOT PERSISTED** |
| Timestamp | `observed_at` on every record ✓ | No | No | **NOT PERSISTED** |
| Confidence | inside `CanonicalScore` ✓ | No | No | **NOT PERSISTED** |
| Recommendations | `report_recommendation_history` ✓ (+ `classifyRecommendationStatus`) | No | No | **NOT PERSISTED** |
| Priority | `leverage_score` on `CanonicalAction` ✓ | Only inside the report JSON | Only by re-parsing JSON | **PARTIALLY PERSISTED** |
| Expected outcome | `expected_outcome` on `CanonicalAction` ✓ | Report JSON only | Re-parse | **PARTIALLY PERSISTED** |
| Content gaps | `content_gap` decisions in `decision_objects` | Yes (decisions table) | Yes | **PERSISTED** |
| Positioning gaps | `strategicContext.positioningGap` | Report JSON only | Re-parse | **PARTIALLY PERSISTED** |
| Search gaps | `seo_gap` decisions (on-page, not search) | Yes | Yes | **PERSISTED but mislabelled** |
| Channel gaps | Not modelled | — | — | **NOT IMPLEMENTED** |

**The whole report object *is* durably persisted** as `reports.data.composed_report` (JSONB) —
so nothing is truly lost. But it is persisted as an **opaque blob**, not as queryable baseline
rows, and the row-shaped schema that was designed for exactly this purpose is dormant.

### 6.2 Architectural decisions currently threatening the contract

| # | Threat | Evidence | Impact |
|---|---|---|---|
| T1 | **Report 2 re-runs Report 1 live instead of reading a baseline** | `performanceReportService.ts:529-533` calls `composeSnapshotReport` at Report-2 time | Report 2 compares against a *fresh* snapshot, so "have we improved since the baseline?" is structurally unanswerable. Also re-pays for crawl/SERP/LLM |
| T2 | **Report 2 consumes the legacy priority array** | `performanceReportService.ts:555` reads `snapshot.top_priorities`, not `digital_snapshot.topPriorities` | Connecting the Report 1 assembler later will silently *not* change Report 2 unless this line moves too |
| T3 | **Unstated-gate numeric crosses the boundary** | `performanceReportService.ts:541` (see §4.2 R1) | Report 2 can present an insufficient-signal authority score as its baseline fact |
| T4 | **`InMemoryHistoryStore` default** | `historicalPersistence.ts:233` | No delta, no trajectory, no forecast — ever |
| T5 | **`ComposedReportData` is the de-facto contract and is incomplete** | 0 occurrences of `canonical`, `digital_snapshot`, `evidence_coverage`, `digital_experience`, `competitive_tables` | Any consumer typed against it cannot see the Report 1 payload; `canonical` only survives via an `as any` cast |

### 6.3 Existing Report 2 code contaminating the Report 1 boundary

* `gscSeoIntelligenceService` (private, Report 2) supplies `prioritySerpQueries` /
  `buildSerpQuerySeeds` — so the **public** SERP acquisition service is architecturally
  dependent on a **private** source for its query set. This is the single most important
  structural fix for a public-domain search capability.
* `visualIntelligenceHelpers` search funnel is entirely GSC-shaped (impressions/clicks/CTR/
  avg-position) yet lives in the Report 1 composer.

---

## 7. V1 GAP MATRIX

| Requirement | Existing Implementation | Evidence | Status | Exact Gap | Dependency | Execution Required | Pri |
|---|---|---|---|---|---|---|---|
| Cross-source opportunities | `digitalSnapshotAssembly.ts` (6 rules, evidence gate, contradiction guard) | 30/30 tests pass; 0 non-test consumers | **DISCONNECTED** | Not in `ComposedReportData`, `CanonicalExportPayload`, or the renderer | none | Extend export contract + render section | **P0** |
| Top priorities (Impact×Conf÷Effort) | `priorityScore`, `MAX_TOP_PRIORITIES=5` | tests | **DISCONNECTED** | Same | GAP-01 | Render top-5 | **P0** |
| 30/60/90 plan | `DigitalSnapshotPlan` + `notes[]` for empty horizons | tests | **DISCONNECTED** | Same | GAP-01 | Render 3 horizons + notes | **P0** |
| Website & technical health section | 23 checks in `technicalIntelligenceEngine` + `digitalExperience` findings | engines execute; `provenance.checksEvaluated/Total` | **DISCONNECTED** | Aggregated to a score; check-level detail dropped | none | Carry checks into export; render section | **P0** |
| Content section | `contentIntelligenceEngine` checks + `publicDomainAudit` depth/gaps | executes | **DISCONNECTED** | Same | none | Render section | **P1** |
| Public-domain search visibility | `serpAcquisitionService` (4 providers, seeding, health, cost gov.) | `SERP_API_KEY` live in prod; SERP proven working in competitor discovery | **DISCONNECTED + NOT IMPLEMENTED** | (a) not called from the report; (b) own-domain rank extraction never written; (c) query seeder depends on GSC | none | Add public query seeder + own-rank extraction + report-path call | **P0** |
| Search gaps (real) | `seo_gap` decisions are on-page gaps | — | **PARTIAL / mislabelled** | No query→page→position gap model | GAP-06 | Derive from SERP snapshots | **P1** |
| AI visibility breadth | 1 of 5 providers configured | `vercel env ls production` | **PARTIAL** | 4 API keys absent | owner action | Provision keys OR state 1-of-5 explicitly | **P1** |
| AI evidence reproducibility | `mentions` dropped by `AICitationMatrixSummary` | type at `canonicalReportTypes.ts:337` | **PARTIAL** | Query/answer/matched-span not retained | none | Persist probe transcripts | **P1** |
| Performance evidence | `performanceEvidence.ts` PSI v5 complete | returns honest `unavailable` | **UNAVAILABLE** | `PAGESPEED_API_KEY` / `PAGESPEED_ENABLED` unset | owner action | Set one env var | **P1** |
| Reputation | connectors + ingestion + repository + migration | orchestrator off report path | **DISCONNECTED** | 4 gates: flag, keys, orchestrator wiring, migration application | owner action | Provision + wire + verify migration | **P2 for V1** |
| Social public presence | `sameAs` declared links only | `declared_evidence` | **NOT IMPLEMENTED** | No public profile fetch | none | Out of V1 — state as UNAVAILABLE | **P2** |
| Evidence coverage surfaced | `resolveEvidenceReadiness` → `renderExecutiveReadinessSummary` | renders | **IMPLEMENTED** | — | — | — | — |
| Provenance enforcement | `evidenceProvenance.ts` | 0 runtime consumers | **DISCONNECTED** | No runtime filter/label | none | Add a Report 1 provenance guard | **P0** |
| Declared-vs-observed labelling | `company_context.homepage_headline` ← `profile.key_messages` | `narrativeHelpers.ts:45` | **BROKEN** (mislabel) | Declared data under observed-sounding names | GAP-07 | Label or re-source from crawl | **P0** |
| Numeric-with-insufficient-state | `aggregateOverallScore` | `canonicalReportBuilderInputs.ts:184` | **BROKEN** (latent) | Value survives the state | none | Null the value or gate every consumer | **P0** |
| Durable baseline persistence | full record bundle + 6 tables | `written:false` | **DISCONNECTED** | `SUPABASE_HISTORY_ENABLED` unset; migration application unverified | owner action | Verify migration, set flag | **P1** (P0 for R2) |
| Report 1 → Report 2 contract | Report 2 recomposes live | `performanceReportService.ts:529` | **BROKEN** | No baseline read path | GAP-15 | Read persisted baseline | **P1** |
| Company understanding (observed) | crawl H1/meta/CTA/offering pages | `digitalExperience`, `publicDomainAudit` | **DISCONNECTED** | Not rendered as company understanding | GAP-01, GAP-09 | Render observed identity alongside declared | **P1** |
| Crawl breadth disclosure | 15-page default | `reportCrawlEvidenceService.ts:70` | **PARTIAL** | Sample size not stated in the report | none | Add to disclosures | **P0** (part of GAP-10) |
| Orphan `/api/reports/snapshot` | dead route, `'your-site.com'` fallback | 0 callers | **BROKEN** | Would emit a placeholder-domain report | none | Remove or pass `resolvedInput` | **P2** |
| Duplicate HTML render per view | `?format=html` fetched every load | `[reportId].tsx:79` | **PARTIAL** | Redundant server render | none | Cache or single-fetch | **P2** |

---

## 8. MINIMUM V1 CLOSURE SET

**Only these items are required to satisfy the finish line.** Everything else is post-V1.

| ID | Item | Why it is minimum |
|---|---|---|
| **GAP-01** | Extend the report contract (`ComposedReportData` → `ReportViewPayload` → `CanonicalExportPayload`) to carry `digital_snapshot`, `digital_experience`, `evidence_coverage`, `competitive_tables`, `performance` | Nothing else can be rendered until the contract carries it. This is the single unlock for 5 of the 13 sections |
| **GAP-02** | Render **Opportunities** from `digital_snapshot.opportunities` | Finish line names "opportunities" |
| **GAP-03** | Render **Top Priorities** from `digital_snapshot.topPriorities` (max 5) | Finish line names "priorities" |
| **GAP-04** | Render **30/60/90 plan** from `digital_snapshot.plan`, including `notes[]` for empty horizons | Finish line names recommendations; empty-horizon notes are what make it credible |
| **GAP-05** | Render **Website & Technical Health** section from the technical engine's `checks[]` + `digitalExperience.findings` | This is the concrete, public, verifiable evidence that makes the whole report credible |
| **GAP-06** | **Public-domain search visibility**: seed queries from crawl-derived topics (not GSC), run `runSerpAcquisition` on the report path, extract the company's **own** domain positions, expose as `measured`; abstain honestly when the SERP credential is absent | Section D currently has no public evidence path at all — a "public-domain snapshot" with no search reading is not credible to a CMO |
| **GAP-07** | **Runtime provenance guard**: apply `evidenceProvenance.isReport1Source` on the Report 1 evidence path; exclude or explicitly label `CONNECTED_SOURCE` / `COMPANY_CONFIRMED` evidence | Evidence integrity is a stated non-negotiable; today it is test-only |
| **GAP-08** | **Close the numeric/state leak**: `aggregateOverallScore` must not return a value with `insufficient_signal`, and `performanceReportService:541` must gate on state | Prohibited transition, live across the report boundary |
| **GAP-09** | **Label declared vs observed** in `company_context`: either re-source `homepage_headline` / `primary_offering` from the crawl, or tag them `COMPANY_CONFIRMED` and render the label | Prohibited transition in the section a CMO reads first |
| **GAP-10** | **Disclose the evidence envelope**: crawl page count, AI provider coverage (n of 5), SERP status (`live`/`fallback`), and every `unavailable` source with its reason, in `renderReportDisclosures` | The finish line word is *credible*; stating the sample is what makes abstention legible rather than evasive |

### POST-V1 ENHANCEMENTS (explicitly outside the execution path)

| ID | Item | Rationale for deferral |
|---|---|---|
| ENH-01 | Provision `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `PERPLEXITY_API_KEY` / `AZURE_COPILOT_API_KEY` | Owner action; V1 is credible with 1-of-5 **provided GAP-10 states it** |
| ENH-02 | Provision `PAGESPEED_API_KEY` | Report abstains honestly today |
| ENH-03 | Persist AI probe transcripts for reproducibility | Improves auditability, not V1 credibility |
| ENH-04 | Reputation activation (flag + 4 keys + orchestrator wiring + migration verification) | Four gates, owner-dependent; abstains honestly today |
| ENH-05 | Public social profile observation | Net-new capability |
| ENH-06 | Content gap intelligence (missing use-case / industry / comparison / problem-solution pages) | Net-new capability; requires an offering→page coverage map |
| ENH-07 | Cannibalization detection | Net-new |
| ENH-08 | Backlink provider (`AHREFS_API_KEY`) | `authority_inflow` correctly self-downgrades to `inferred` today |
| ENH-09 | Benchmark dataset | Explicitly disallowed to fabricate; abstains correctly |
| ENH-10 | Redirect **chain** tracing (vs. count) | Marginal |
| ENH-11 | Remove the orphan `/api/reports/snapshot` route | Hygiene |
| ENH-12 | Eliminate the duplicate per-view HTML render | Cost hygiene |

---

## 9. PRIORITIZED EXECUTION BACKLOG

---

### GAP-01 — Report 1 payload contract extension
**Capability.** The Report 1 payload (opportunities, plan, experience findings, coverage,
competitive tables, performance) must survive the journey from `SnapshotReport` to the rendered
document.

**Current state.** `composeSnapshotReport` produces all six fields and persists them inside
`reports.data.composed_report`. `pages/api/reports/reportComposedTypes.ts` declares none of them
(verified: grep count 0 for `canonical`, `digital_snapshot`, `evidence_coverage`,
`digital_experience`, `competitive_tables`). `reportComposedMapper.ts:472` rescues only
`canonical`, via `(report as any)`.

**Missing state.** Typed fields on `ComposedReportData` and `ReportViewPayload`; explicit mapping
in `mapComposedReport`; pass-through fields on `CanonicalExportPayload`; population in
`buildCanonicalExport` for the `executive` shape.

**Root cause.** The canonical consolidation (Phase 2) defined `canonical` as *the* export
contract; Phases 3/4 and the Report 1 assembler added sibling fields to `SnapshotReport` without
extending that contract. The `as any` cast on `canonical` hid the shape mismatch from the
compiler.

**Existing assets to reuse.** `SnapshotDigitalSnapshot` type (`snapshotReportTypes.ts:224`),
`CrossSourceOpportunity`, `DigitalSnapshotPlan`, `PillarAssessment`, `ExperienceFinding`,
`CanonicalExportPayload` optional-field convention already used for `authority_trajectory` /
`declared_evidence`.

**Exact execution.**
1. Add typed optional fields to `ComposedReportData`.
2. Add the same to `ReportViewPayload`; replace the `as any` cast with typed access.
3. Map them in `mapComposedReport` (pass-through, no derivation).
4. Add optional fields to `CanonicalExportPayload`, populated in `buildCanonicalExport` base.
5. Thread them through `renderCanonicalReportHtml` → `renderExportHtml`.

**Acceptance criteria.** For a report whose stored `composed_report` contains a non-empty
`digital_snapshot`, `GET /api/reports/{id}?type=snapshot` returns it in the JSON, and the
`format=html` render receives it. No existing field changes shape. Legacy reports without the
fields render identically to today.

**Test/proof.** Unit test asserting round-trip `SnapshotReport → composed_report → mapped payload
→ export payload` preserves all six fields; a legacy-payload regression test proving
byte-identical HTML when the fields are absent.

**Dependencies.** None. **Priority: P0.** **Report section:** enabler for 4, 5, 11, 12, 13.

---

### GAP-02 — Render Opportunities from the cross-source engine
**Capability.** Report 1 §11 must present evidence-backed, cross-source opportunities.

**Current state.** §11 renders `action_playbook`, built by `buildActionPlaybook`
(`canonicalReportBuilderInputs.ts:520`) from `seo_executive_summary.top_3_actions`,
`geo_aeo_executive_summary.top_3_actions`, competitor gaps, unified summary and legacy
`top_priorities` — i.e. from decision objects and dimension scores, not from cross-source public
evidence. `digital_snapshot.opportunities` is discarded.

**Missing state.** A rendered section driven by `CrossSourceOpportunity`, showing per
opportunity: `problem`, each `evidence[].statement` with its `source` and `state`,
`businessImplication`, `action`, `expectedImpact`, `priorityScore`, `confidence`, `effort`,
`measurement`, and an explicit marker when `measurementAvailable === false`.

**Root cause.** GAP-01. The assembler was built last and never given an output contract.

**Existing assets to reuse.** `assembleDigitalSnapshot`, `renderSectionHeader`,
`exportRendererCoreHtml` primitives, `escape`, `isMeasuredScore`.

**Exact execution.** Add `renderCrossSourceOpportunities(payload)` in `exportRendererSectionsB`;
insert into `renderExportHtml` as a new numbered section. **Do not delete `action_playbook`** in
this pass — render both and reconcile in a follow-up, so the change is additive and reversible.

**Acceptance criteria.** Given `digital_snapshot.opportunities.length > 0`, each opportunity
appears once with all its evidence statements and their `ScoreState`; `crossSource: true` items
show ≥2 distinct `sources`; `measurementAvailable: false` renders an explicit "outcome not
measurable from public evidence" line; `empty: true` renders the honest empty state and no
filler.

**Test/proof.** DOM/string test over a fixture with a full and a sparse assembly; a test proving
no opportunity renders whose `evidence` contains only `unavailable` states.

**Dependencies.** GAP-01. **Priority: P0.** **Section 11.**

---

### GAP-03 — Render Top Priorities
**Capability.** A ranked, capped top-5 the CMO reads first.

**Current state.** `digital_snapshot.topPriorities` (already sorted by `priorityScore` then `id`
for determinism, capped at `MAX_TOP_PRIORITIES = 5`) is discarded. The rendered priorities come
from the legacy playbook's leverage ranking.

**Missing state.** A rendered top-5 with the ranking key shown (`Impact × Confidence ÷ Effort`)
and each item's contributing evidence domains.

**Root cause.** GAP-01.

**Existing assets to reuse.** `priorityScore`, `CONFIDENCE_MULTIPLIER`, `effortDivisor`,
`MAX_TOP_PRIORITIES`.

**Exact execution.** Render `topPriorities` inside the Executive Snapshot block so priorities
appear before the detail sections.

**Acceptance criteria.** ≤5 items; order is deterministic across two runs on identical input
(the assembler already guarantees this — assert it end-to-end); each item names its
`sources[]`; empty assembly renders the honest empty state.

**Test/proof.** Determinism test at the render layer; cap test.

**Dependencies.** GAP-01. **Priority: P0.** **Section 12.**

---

### GAP-04 — Render the 30/60/90-day plan
**Capability.** Horizon-bucketed recommendations.

**Current state.** `DigitalSnapshotPlan { days_0_30, days_31_60, days_61_90, notes[] }` is built
by `horizonFor({impact, effort})` and discarded. `improvement_todos` (§12) carry effort and
projected point gain but no horizon.

**Missing state.** Three rendered horizons, each `PlanItem` showing `title`, `action`, `why`,
`measurement`, `measurementAvailable`, `effort`, `confidence`, `sources`; plus every
`plan.notes[]` entry verbatim.

**Root cause.** GAP-01.

**Existing assets to reuse.** `horizonFor`, `toPlanItem`, the `notes[]` generator (which already
writes *"The plan is deliberately left empty rather than filled with generic activity"* and
lists unmeasured dimensions).

**Exact execution.** `renderNinetyDayPlan(plan)` in `exportRendererSectionsB`; place immediately
after Top Priorities.

**Acceptance criteria.** An empty horizon renders its `notes[]` explanation and **no invented
item**. `unmeasuredDimensions` are listed as excluded-not-weak. Every item states its
measurement method, and flags where the measurement is not currently obtainable.

**Test/proof.** Fixture with one empty horizon asserting the note renders and no filler appears.

**Dependencies.** GAP-01. **Priority: P0.** **Section 13.**

---

### GAP-05 — Website & Technical Health section
**Capability.** A dedicated section presenting observed technical evidence.

**Current state.** `technicalIntelligenceEngine` produces 23 `CheckResult`s
(`{key,label,status,score,detail}`) with `not_evaluable` where a static crawl cannot observe;
`digitalExperience` produces findings carrying `evidence` + `measurement` + `action` + example
URLs. Both are reduced to a single dimension score before reaching the report.

**Missing state.** A rendered section grouping: reachability (broken pages, depth, orphans),
indexability (robots, sitemap, canonical, noindex), metadata (titles, descriptions, duplicates,
H1), structured data (JSON-LD presence + types), internal linking, and conversion path — each
with the observed count and example URLs, and `not_evaluable` shown as such.

**Root cause.** GAP-01 plus a design decision to expose engines only as dimension scores.

**Existing assets to reuse.** `TechnicalIntelligence.checks`, `AccessibilityIntelligence.checks`,
`ContentIntelligence.checks`, `provenance {sources, checksEvaluated, checksTotal, deterministic}`,
`DigitalExperienceAssessment.findings`, `engineEvidenceDigest` (already threaded into
`buildCanonicalReport`).

**Exact execution.** Carry `checks[]` + `findings[]` through the contract (GAP-01); add
`renderWebsiteTechnicalHealth(...)`; render `checksEvaluated / checksTotal` as the section's own
coverage statement.

**Acceptance criteria.** Every `not_evaluable` check renders as *not evaluable* with its reason
and **never** as a zero. Findings show real URLs from the crawl. The section states the crawl
sample size. With zero crawled pages the section renders the honest empty state.

**Test/proof.** Fixture-driven render test including a `not_evaluable` check and a 4xx finding.

**Dependencies.** GAP-01. **Priority: P0.** **Section 4.**

---

### GAP-06 — Public-domain search visibility
**Capability.** Measure the company's own visibility on public search results, with no private
source.

**Current state.** `serpAcquisitionService` is complete (SerpApi / ScaleSERP / DataForSEO /
manual import; `parseProviderResults` already extracts `position`, `url`, `domain`, `title`,
`result_type` including `featured_snippet`; `ingestSerpSnapshot` persists). It is not called by
the report. Its query seeder `prioritySerpQueries(gsc)` / `buildSerpQuerySeeds(gsc)` takes
`GscSeoIntelligence` — a private source. The report's search slot is filled by a GSC-derived
metric tagged `['GSC']`.

**Missing state.** (a) a **public** query seeder derived from crawl evidence; (b) extraction of
the company's **own** domain positions from the SERP responses (currently filtered away —
`discoverCompetitorDomainsFromSerp` keeps only non-own domains); (c) a report-path invocation
under the existing scan budget; (d) a `search_visibility` surface with `ScoreState`.

**Root cause.** SERP was introduced for competitor discovery; the search-visibility slot was
filled from GSC because analytics already had it, and no one closed the loop.

**Existing assets to reuse.** `serpAcquisitionService` (all of it), `fetchSerpDomainsForKeyword`,
`resolveProviderCredential('serpapi')`, `authorizeProviderCall` / `recordProviderUsage`,
`withinBudget` / `recordUsage` / `getActiveScanId`, `externalCompetitiveIntelligenceService`
snapshot tables, `publicDomainAudit.geo_aeo_context.queries` and `entityCandidates` (already
crawl-derived query candidates), `extractTopKeywords`.

**Exact execution.**
1. Add `buildPublicSerpQuerySeeds({ pages, entities, structure, businessType, geography })`
   sourced from `publicDomainAuditService` output — **no GSC parameter**.
2. Add own-domain position extraction alongside the existing competitor-domain filter (same
   response, no extra request).
3. Call it from `composeSnapshotReportFromDecisions` inside the existing scan-budget scope.
4. Expose `search_visibility { state, queries_run, queries_ranked, positions[], featured_snippets,
   provider, observed_at, reason_unavailable }`.
5. Replace the `searchVisibility` state fed to `assembleDigitalSnapshot` with this public source.

**Acceptance criteria.** With `SERP_API_KEY` set: ≥1 query returns a measured position or a
measured absence, `state: 'measured'`, `EvidenceSourceKind` is **not** `gsc`, and the scan-budget
ledger records the calls. With the credential absent: `state: 'unavailable'` with the real
reason, and no fallback to GSC. `provenanceForSource(...)` returns `PUBLIC_OBSERVED` for every
source in the surface.

**Test/proof.** `createManualSerpProvider` fixture test (the harness already exists in
`searchAndCompetitiveEvidence.test.ts`); a budget test proving no unbudgeted calls; a provenance
test asserting no `gsc` source appears.

**Dependencies.** None (may run in parallel with GAP-01). **Priority: P0.** **Sections 3, 6.**

---

### GAP-07 — Runtime provenance guard
**Capability.** Report 1 structurally cannot assert on private evidence.

**Current state.** `evidenceProvenance.ts` defines the taxonomy and the predicates. Zero runtime
consumers.

**Missing state.** A guard on the Report 1 evidence path that, for every `EvidenceTrace` reaching
the report, either excludes non-`REPORT1_PROVENANCE` sources or renders them with an explicit
provenance label; plus a report-level disclosure when any private source was excluded.

**Root cause.** The module shipped as vocabulary ahead of enforcement.

**Existing assets to reuse.** `isReport1Source`, `summarizeProvenance`, `PRIVATE_PROVENANCE`,
`EvidenceTrace.sources`.

**Exact execution.** Filter/label in `canonicalReportBuilderInputs` where `EvidenceTrace`s are
assembled; add the excluded set to `renderReportDisclosures`.

**Acceptance criteria.** For a tenant with GSC connected, the rendered Report 1 contains no
score whose evidence sources include `gsc`, **or** contains it with a visible
"connected-source" label; the disclosures name what was excluded. `summarizeProvenance(...)
.report1Clean === true` for every rendered score's sources.

**Test/proof.** Integration test with a GSC-tagged decision object asserting the boundary holds.

**Dependencies.** None. **Priority: P0.** **All sections.**

---

### GAP-08 — Close the numeric/state leak
**Capability.** A number may never outlive the state that authorises it.

**Current state.** `aggregateOverallScore` returns `{value: <number>, state:
'insufficient_signal'}` when `measured.length < ceil(pillars.length/2)`.
`performanceReportService.ts:541` reads that value with no state check.

**Missing state.** Either null the value when the state is insufficient, or make every consumer
gate. Prefer nulling at source — it is the only fix that cannot regress.

**Root cause.** `scoreFromAxis` was written as a pure struct builder; the state/value invariant
was enforced at each render site instead of at construction.

**Existing assets to reuse.** `emptyCanonicalScore(state)` already returns `value: null` —
`aggregatePillarScore` uses it correctly for the zero-measured case; the same discipline simply
does not extend to the partial case.

**Exact execution.** In `aggregateOverallScore`, when the computed `state` is
`insufficient_signal`, return `emptyCanonicalScore('insufficient_signal')` while preserving the
evidence trace. Independently, gate `performanceReportService:541` on state.

**Acceptance criteria.** No `CanonicalScore` anywhere in a produced report has a non-null `value`
with `state ∈ {insufficient_signal, unavailable}`. Report 2's `authority_score` is `null` when
Report 1 could not measure.

**Test/proof.** A property test over a built report asserting the invariant across all scores;
a Report 2 test asserting `null` propagation.

**Dependencies.** None. **Priority: P0.** **All sections + Report 2 boundary.**

---

### GAP-09 — Declared vs observed labelling in company context
**Capability.** A CMO must be able to tell what Omnivyra observed from what they told it.

**Current state.** `company_context.homepage_headline` ← `profile.key_messages`;
`primary_offering` ← `profile.products_services`; `positioning` ← `profile.brand_positioning`
(`narrativeHelpers.ts:41-46`). Rendered by `renderBrandBrief` / `renderStrategicPosture` with no
provenance marker.

**Missing state.** Either re-source these from the crawl (the crawler already captures H1s,
titles, meta descriptions and CTA text per page), or tag them `COMPANY_CONFIRMED` and render the
tag.

**Root cause.** Field naming preceded the provenance model.

**Existing assets to reuse.** `CrawlPageResult.headings` / `metaTags` / `ctas`,
`digitalExperience` `value_communication` findings, `EvidenceProvenanceClass`.

**Exact execution.** Add an observed-headline resolver from the crawled home page; render both
"what your site says" (observed) and "what you told us" (declared) where they differ.

**Acceptance criteria.** No field named for an observed artefact is populated from declared data
without a visible label. Where the crawl and the profile disagree, both are shown.

**Test/proof.** Render test with a crawl headline differing from `key_messages`.

**Dependencies.** GAP-07 (shares the labelling primitive). **Priority: P0.** **Section 2.**

---

### GAP-10 — Evidence-envelope disclosure
**Capability.** State the sample and the gaps so abstention reads as rigour.

**Current state.** `renderExecutiveReadinessSummary` shows connected/total sources and gaps;
`renderReportDisclosures` and `renderMethodology` exist. Not stated: pages crawled, AI providers
attempted vs configured (n of 5), SERP `live`/`fallback`, PSI unavailability reason.

**Missing state.** Those four facts, rendered.

**Root cause.** The facts are produced (`ReportCrawlEvidenceResult`, `matrix.coverage`,
`serp_status`, `performance.reasonUnavailable`) but not threaded into the payload.

**Existing assets to reuse.** `ReportCrawlEvidenceResult { pagesAfter, action, reason }`,
`AICitationMatrix.coverage {measured_cells, unavailable_cells, total_cells}`,
`competitor_intelligence.serp_status`, `PerformanceEvidence.reasonUnavailable`,
`scan_metadata.cost_summary.per_provider`.

**Exact execution.** Persist the crawl result into `composed_report`; extend
`renderReportDisclosures`.

**Acceptance criteria.** The rendered report states: pages crawled and when; "N of 20
provider × query-class cells measured"; SERP live or fallback; and every unavailable source with
its literal reason.

**Test/proof.** Render test asserting all four strings are present for a production-shaped
fixture.

**Dependencies.** GAP-01. **Priority: P0.** **Section 10.**

---

### P1 items (materially complete/credible, non-blocking)

| ID | Capability | Current → Missing | Reuse | Acceptance | Section |
|---|---|---|---|---|---|
| **GAP-11** | Content section | Engines run; not rendered → render `contentIntelligenceEngine.checks` + depth/gap/freshness | `contentIntelligenceEngine`, `publicDomainAudit` | Thin pages, missing page types and freshness render with counts + URLs; `not_evaluable` honest | 5 |
| **GAP-12** | Real search gaps | `seo_gap` = on-page → derive query→page→position gaps from GAP-06 snapshots | `serp_snapshot` rows, `queryCoverage` | Every gap names a query, the ranking page (or its absence) and the observed position | 6 |
| **GAP-13** | AI coverage honesty | 1 of 5 providers → state it prominently, not only in coverage counts | `matrix.by_provider` with `state:'unavailable'` per provider | The AI section names each unqueried provider and why | 7 |
| **GAP-14** | AI reproducibility | `mentions` dropped → persist query, answer hash/excerpt, matched span, `observed_at` | `CitationMention`, `report_evidence_history` | A rendered AI claim can be traced to the exact query and captured answer | 7 |
| **GAP-15** | Durable baseline | `InMemoryHistoryStore` → verify migration `20260601000000` applied in production, then set `SUPABASE_HISTORY_ENABLED=true` | `SupabaseHistoryStore`, `persistCanonicalSnapshot`, 6 tables | Two consecutive reports produce two `report_score_history` rows; `change_intelligence` resolves | 1, 8 |
| **GAP-16** | Report 1 → Report 2 baseline read | Report 2 recomposes live → read the persisted baseline | `report_score_history`, `composed_report` JSONB | Report 2 names the baseline `observed_at` it compares against and makes no fresh Report 1 provider calls | R2 boundary |
| **GAP-17** | Observed company understanding | Crawl-derived identity discarded → render alongside declared | `digitalExperience`, `publicDomainAudit.structure` | Offering pages, home H1 and CTA path render as observed | 2 |
| **GAP-18** | Performance evidence activation | `PAGESPEED_API_KEY` unset → set it (owner) | `performanceEvidence.ts` complete | `performance.state === 'measured'`; `rulePerformanceFriction` fires | 4 |

### P2 items — see POST-V1 ENHANCEMENTS (§8). Do not admit these to the V1 path.

---

## 10. DEPENDENCIES & SEQUENCING

```
WAVE 1 — fully parallel, no interdependencies
├── GAP-08  numeric/state leak            (smallest, highest integrity value — do first)
├── GAP-01  contract extension            (unlocks 02,03,04,05,10)
├── GAP-06  public search visibility      (independent vertical)
└── GAP-07  provenance guard              (independent)

WAVE 2 — requires GAP-01; the five tasks are parallel to each other
├── GAP-02  opportunities
├── GAP-03  top priorities
├── GAP-04  30/60/90 plan
├── GAP-05  website & technical health
└── GAP-10  evidence-envelope disclosure

WAVE 2b — requires GAP-07
└── GAP-09  declared vs observed labelling

WAVE 3 — P1, after V1 closure
├── GAP-11 content section                (needs GAP-01)
├── GAP-12 real search gaps               (needs GAP-06)
├── GAP-13 AI coverage honesty            (needs GAP-10)
├── GAP-14 AI reproducibility             (independent)
├── GAP-15 durable baseline               (owner: verify migration, then flag)
├── GAP-16 R1→R2 baseline read            (needs GAP-15)
├── GAP-17 observed company understanding (needs GAP-01, GAP-09)
└── GAP-18 PSI activation                 (owner: one env var)
```

**Critical path to V1:** `GAP-01 → {GAP-02, GAP-03, GAP-04, GAP-05, GAP-10}`.
Everything else in the minimum set runs beside it.

**Owner-only actions (agent cannot perform):** setting `PAGESPEED_API_KEY`,
`SUPABASE_HISTORY_ENABLED`, the four LLM keys, `TRUST_COHERENCE_ENABLED` and the review keys in
Vercel; and confirming that migrations `20260601000000_canonical_intelligence_platform.sql` and
`20260903000000_review_sources.sql` are applied in production.

**Verification that must precede GAP-15:** the Supabase MCP server failed to connect during this
audit (`CONNECTION_CLOSED`), so **no migration-application state was verified against the live
database**. Treat every "schema exists" statement in §6.1 as *"exists in the repo's migration
set"*, not *"applied in production"*.

---

## 11. OUT OF SCOPE

### OUT OF SCOPE — REPORT 2
* Any implementation of performance/connected-analytics intelligence.
* `gscSeoIntelligenceService`, `analyticsEnterpriseSnapshotService`, `analyticsHealthService`,
  `analyticsCorrelationService`, `crossDomainAttributionService`.
* Everything behind `CRM_ENABLED` / `COMMERCIAL_EVIDENCE_ENABLED` (`commercialAdapter`,
  `canonical_revenue_events`, ROI determinability).
* The Report 2 capability audit itself.
* **Only the boundary items GAP-15 and GAP-16 touch Report 2 at all, and both are P1 — they make
  Report 1's baseline durable and readable; they do not build Report 2.**

### OUT OF SCOPE — REPORT 3
* `authority_trajectory`, `forecastService`, `comparisonEngine`, `deltaIntelligence`,
  `changeAwareInsights` as *products* — multi-period trajectory and forecasting is Report 3
  territory. Report 1 needs only the **write** side (GAP-15).
* `benchmark` / `BenchmarkDatasetAdapter` peer-percentile positioning.
* `collaboration` (annotations, assignments, pinned findings, recommendation status).
* `manualOverrides` / `reportOverrideTransparency` as a workflow.
* `PlatformOperationsDashboard`, `AdminIntelligenceConsole`.

### Unrelated enhancements discovered and deliberately excluded
* Orphan route `pages/api/reports/snapshot.ts` (P2 hygiene).
* Duplicate per-view HTML render (P2 cost hygiene).
* `mozAdapter` / `majesticAdapter` restoration (files absent; noted in `providerRegistry.ts`).
* Repo hygiene: several hundred status/audit markdown files at the repository root.

---

## 12. FINAL VERDICT

# REPORT 1 NOT READY

**Not** because the intelligence is missing. Because the intelligence that exists does not reach
the customer, and because two of the eight required evidence domains have no public-domain path
at all.

### What is genuinely ready
* Public-domain evidence acquisition — crawl, technical/content/accessibility/brand engines,
  public-domain audit, digital-experience assessment. **Proven by execution**, not inspection.
* AI visibility for one provider — **proven live** during this audit (`chatgpt probe status: ok`).
* Entity intelligence via Wikidata — **proven live**.
* Competitor discovery via SERP — credential live in production, code paths proven.
* Evidence coverage and abstention discipline — the strongest part of the product.
* The cross-source opportunity engine — correct, deterministic, evidence-gated, 30/30 tests.

### Exact remaining work to declare V1 complete

**Ten items. Four can start immediately in parallel.**

1. **GAP-08** — stop `aggregateOverallScore` returning a number with `insufficient_signal`; gate
   `performanceReportService:541`. *(smallest, highest integrity value — do first)*
2. **GAP-01** — extend `ComposedReportData` / `ReportViewPayload` / `CanonicalExportPayload` to
   carry `digital_snapshot`, `digital_experience`, `evidence_coverage`, `competitive_tables`,
   `performance`.
3. **GAP-07** — enforce `evidenceProvenance` at runtime on the Report 1 path.
4. **GAP-06** — build public query seeding + own-domain rank extraction on the existing
   `serpAcquisitionService`, called from the report path, with no GSC dependency.
5. **GAP-02** — render Opportunities from `digital_snapshot.opportunities`.
6. **GAP-03** — render Top Priorities from `digital_snapshot.topPriorities`.
7. **GAP-04** — render the 30/60/90 plan including its empty-horizon notes.
8. **GAP-05** — render Website & Technical Health from the engines' `checks[]` + digital-experience
   findings.
9. **GAP-09** — label declared vs observed in company context.
10. **GAP-10** — disclose the evidence envelope: pages crawled, AI cells measured of 20, SERP
    live/fallback, and every unavailable source with its reason.

**Nothing in this list requires a new service, a new table, a new provider integration, or a new
architecture.** Nine of the ten are *connection and enforcement* work over components that already
exist and already run. GAP-06 is the only one requiring net-new logic, and it is two functions
(a public query seeder and an own-domain position extractor) over a service that is already
complete, already credentialed and already called during Report 1.

**After those ten, Report 1 can honestly answer its own question:** *"What does the public digital
footprint of this company tell us about its current marketing position?"* — with observed evidence,
labelled provenance, honest abstention, and a plan the CMO can act on.

---

*Audit performed against the repository at `preserve/creator-canonical-template-pool`. Every
finding is anchored to a file and, where behaviour was asserted, to an executed test run or a
verified production environment listing. Live database state was NOT verified — the Supabase MCP
connection failed during this session.*

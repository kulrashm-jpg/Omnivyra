# OMNIVYRA — POST-GAP-01 REPORT 1 CLOSURE AUDIT

**Date:** 2026-09-05
**Baseline:** working tree containing the completed GAP-01 implementation (branch `preserve/creator-canonical-template-pool`)
**Live verification:** Vercel `omnivyra` Production env listing; read-only Supabase REST probe against `klkiseupptzbecbxwrky` (production)
**Mode:** AUDIT ONLY. No code, migration, schema or configuration was modified.

---

## 1. EXECUTIVE VERDICT

### 1.1 What changed since the last audit

GAP-01 is **confirmed closed and not regressed**. Verified this session:

| Check | Result |
|---|---|
| `npm run typecheck:ci` | 3/3 projects clean, baseline 0, actual 0 |
| Report 1 / export / canonical / evidence suites | **64 suites, 673 tests pass**, 1 skipped |
| `as any` on the canonical Report 1 path | none (one unrelated `mapped_data` cast remains on the *performance* report path) |
| Rendered artifact | 16 sections + 6 disclosure blocks; **Top Priorities, Opportunities, The Next 90 Days, Website Evidence and Competitive Position all render** |
| Production `composed_report` rows | `digital_snapshot`, `digital_experience`, `evidence_coverage`, `competitive_tables`, `performance` **all PRESENT** on the 6 most recent completed reports |

The contract holds against real stored data, not only fixtures.

### 1.2 The finding that reframes everything

**The pipe is connected. In production it is currently carrying nothing — and where it does carry something, one value is actively false.**

Read-only probe of the six most recent completed Report 1 runs (all `requested_report_category: snapshot`, domain `calendly.com`, generated 2026-09-05):

```
digital_snapshot      opportunities=0  topPriorities=0  empty=true
digital_experience    findings=0       pagesEvaluated=0
competitive_tables    productCompetition=0  empty=true
evidence_coverage     coverage=22%     connected_sources=1/6
canonical.authority_overview.overall_score  = { value: 10, state: 'insufficient_signal' }
pillars: foundation=100 (inferred) · authority=null · discoverability=0 (inferred) · trust=null · momentum=null
canonical_pages for that company = 0
```

Three things are simultaneously true in that live document:

1. **The website was never crawled** — `canonical_pages = 0`, and the report's own evidence-coverage section says so: *"The website has not yet been fully scanned for this report."*
2. **The Foundation pillar reads 100/100.**
3. **The Authority Index reads 10 while its state says `insufficient_signal`.**

A CMO opening that report is told their technical foundation is perfect, on a page that also says nothing was measured. That is the prohibited `UNAVAILABLE → PRESENTED AS FACT` transition, live, in six production records.

### 1.3 Root cause of the false 100 — proven in code

[visualIntelligenceHelpers.ts:236-252](backend/services/snapshotReport/visualIntelligenceHelpers.ts#L236-L252):

```ts
const technicalPenalty = metadataIssues != null || structureIssues != null || ...
  ? ((metadataIssues ?? 0) * 2.5 + (structureIssues ?? 0) * 4 + ...)
  : null;
const technicalSeoScore = wiTechnicalUsable ? ... : technicalPenalty != null ? clamp(Math.round(100 - technicalPenalty), 0, 100) : null;
const technicalState: ScoreState = (wiTechnicalUsable || technicalPenalty != null) ? 'measured' : 'insufficient_signal';
```

Each counter is `publicAudit.decisions.filter(...).reduce(fn, **0**)`. With zero crawled pages `publicDomainAuditService` returns `decisions: []`, so every counter is **`0`, not `null`**. Therefore `technicalPenalty = 0`, `technicalSeoScore = 100 - 0 = 100`, and `technicalState = 'measured'`.

**Absence of evidence is scored as absence of defects.**

This propagates: `technical_seo_score` → `dimIndexIntegrity` → Foundation pillar → `aggregateOverallScore`. It is the only radar axis with this defect — `keywordResearchScore`, `rankTrackingScore`, `backlinksScore`, `competitorIntelligenceScore` and `contentQualityScore` all guard correctly with `.length > 0` or explicit null. That makes the fix **one expression in one file**.

### 1.4 Verdict

**REPORT 1 NOT READY.** Not for the reasons the previous audit gave — those were about disconnection, and GAP-01 fixed the disconnection. The remaining blockers are about **evidence integrity and evidence supply**: the report can now display its intelligence, but for a real company it currently has almost no intelligence to display, and the one prominent number it does show is fabricated from silence.

### 1.5 What is genuinely proven working

* Report 1 payload contract, mapper, sanitiser round-trip, HTML render — **PROVEN** (24 contract tests + executed artifact + live stored rows).
* SERP provider — **PROVEN live in production**: `scan_metadata.cost_summary.per_provider.serp = { requests: 8 }` on the real report.
* AI probe — **PROVEN**: 1 of 20 matrix cells measured in production; live OpenAI call observed in test execution.
* Evidence-coverage disclosure — **PROVEN informative**: states 22% resolved, 1 of 6 sources connected, 5% AI coverage, with per-gap why/impact/next-step.
* History schema — **PROVEN APPLIED IN PRODUCTION** (upgrade from the previous audit's UNPROVEN; see §7).

---

## 2. CURRENT REPORT 1 CAPABILITY MATRIX

### A. Company Understanding

| Requirement | Source | Public? | Persisted | Rendered | Status |
|---|---|---|---|---|---|
| Company identity | `company_profiles` (declared) | Declared | Yes | Yes (cover) | **PARTIAL** — unlabelled provenance |
| Products / services | `profile.products_services` | Declared | Yes | Indirect (AI queries) | **PARTIAL** |
| Industry / market category | `resolved.businessType` | Declared | Yes | Indirect | **PARTIAL** |
| Geography | `resolved.geography` | Declared | Yes | No | **PARTIAL** |
| Target customers / ICP | `ReportCompanyContext` | Declared | Yes | No | **DISCONNECTED** |
| Business model | — | — | — | — | **NOT IMPLEMENTED** |
| Value proposition | crawl H1 / word count | **Observed** | Yes | **Yes** (Website Evidence) | **IMPLEMENTED** (GAP-01) |
| Offerings / use cases | `publicDomainAudit.structure.product_pages` | Observed | Yes | Indirect | **PARTIAL** |
| Customer problems | regex mention counts | Observed | Yes | Indirect | **PARTIAL** |
| Positioning | `profile.brand_positioning` | Declared | Yes | Yes (§06) | **PARTIAL** — declared rendered as position |
| Publicly discoverable objectives | — | — | — | — | **NOT IMPLEMENTED** |
| Entity identity (Wikidata / `sameAs`) | Wikidata + schema.org | **Observed** | Yes | Yes | **IMPLEMENTED / PROVEN** |

### B. Website Intelligence

| Capability | Status | Note |
|---|---|---|
| Crawlability, indexability, metadata, canonical, sitemap, robots, redirects, structured data, internal linking, duplicate titles, hreflang, security headers, cache headers | **PARTIAL** | 23 deterministic checks computed by `technicalIntelligenceEngine`; compressed by `enrichRationale` into one sentence. `engineEvidence` is **not** on `CanonicalReport` — verified: zero references in `canonicalReportTypes.ts` / `canonicalExport.ts`. Check-level detail never reaches the customer |
| Broken links / crawl depth / orphan pages / CTA coverage / missing H1 / thin pages | **IMPLEMENTED** | Now rendered in **Website Evidence** with real URLs (GAP-01) |
| **Technical SEO score with zero evidence** | **BROKEN** | Returns a measured **100** — see §1.3, live in production |
| URL architecture | **PARTIAL** | depth only |
| Mobile readiness | **PARTIAL** | `viewport` meta only; PSI form factor unavailable |
| Measurable performance | **UNAVAILABLE** | `PAGESPEED_API_KEY` / `PAGESPEED_ENABLED` both absent in production (re-verified) |
| UX / value communication / conversion readiness | **IMPLEMENTED** | Rendered (GAP-01) |
| Trust signals (on-site) | **PARTIAL** | `contentIntelligenceEngine` checks computed, not rendered |

### C. Content Intelligence

| Capability | Status |
|---|---|
| Content inventory, depth, freshness, gaps (`content_gap`, `weak_content_depth`, `localized_content_gap`) | **PARTIAL** — computed, only reachable through decision-derived sections |
| Content engine checks rendered | **DISCONNECTED** — zero references to `contentIntelligence` in any export renderer or the canonical builder |
| Topical coverage | **PARTIAL** — token-frequency heuristic |
| Intent / commercial alignment | **PARTIAL** — regex mention counts |
| Missing use-case / industry / comparison / problem-solution pages | **NOT IMPLEMENTED** — no offering→page coverage map |
| Observable cannibalization | **NOT IMPLEMENTED** |
| Publishing patterns | **PARTIAL** — recency only |

### D. Search / SEO Visibility

| Stage | State | Evidence |
|---|---|---|
| Provider available | **YES** | `SERP_API_KEY` present in Vercel production |
| Acquired during Report 1 | **YES — PROVEN** | production `cost_summary.per_provider.serp.requests = 8` |
| Response contains own-domain rank | **YES** | SerpApi `organic_results[]` carries `position`, `link`, `title` |
| Processed | **NO** | `fetchSerpDomainsForKeyword` returns `string[]` of **domains only** — `position` discarded at `.map(normalizeDomain)` |
| Own domain retained | **NO** | `isBlockedSerpDomain`: `if (!normalized \|\| normalized === own) return true` |
| Depth | **num: 5** | only top-5 requested |
| Stored / exposed / rendered | **NO** | no `search_visibility` surface exists |
| Slot currently filled by | **GSC (private)** | `rankSourceTags = ['GSC']` — unchanged |

**Status: NOT IMPLEMENTED (processing + exposure).** Per the audit instruction, this is *not* UNAVAILABLE — the configured provider genuinely supplies the evidence and is already being paid for during every Report 1 run.

### E. AI / AEO / AIO

| Question | Answer |
|---|---|
| Providers configured | **1 of 5** — only `OPENAI_API_KEY` (re-verified in Vercel production) |
| Actually queried | **YES — PROVEN** in production: `citation_matrix.coverage = { measured_cells: 1, unavailable_cells: 19, total_cells: 20 }` |
| Coverage disclosed to customer | **YES** — "AI coverage 5%" appears in the readiness block |
| Responses / citations captured | Yes in-process |
| Evidence persisted | **NO** — `AICitationMatrixSummary` drops `mentions`; query text, answer text and matched span are not retained |
| Reproducible | **NO** |
| Ever claims an unqueried system | **NO** — every unavailable cell carries a literal reason |

**Status: PARTIAL** — honest, single-provider, non-reproducible. Note: production shows `ai_surface_presence.score = { value: 0, state: 'inferred' }` derived from **1 of 20 cells** — a headline 0 on 5% coverage.

### F. Competitive Intelligence

| Capability | Status |
|---|---|
| Discovery (SERP keyword → domain) | **IMPLEMENTED / PROVEN** — 8 live requests in production |
| **Discovery efficacy** | **BROKEN in the observed run** — 8 paid SERP requests produced `competitive_tables.empty = true`, `productCompetition = 0` |
| Two-axis tables (product vs market) | **IMPLEMENTED** — now rendered (GAP-01) |
| Unclassified handling | **IMPLEMENTED** — kept unclassified, never promoted |
| Content footprint / competitor crawl | **NOT IMPLEMENTED** — Report 3 territory |

### G. Social / Public Presence

| Capability | Status |
|---|---|
| Declared `sameAs` link inventory | **PARTIAL** — count + destination types rendered in Declared Evidence |
| Profile retrieval, activity, engagement, messaging, themes, consistency | **NOT IMPLEMENTED** — no connector visits a public profile |

**Platforms with retrievable public-presence evidence: none.**

### H. Reputation

| Gate | State |
|---|---|
| Connectors implemented | Google Places, Yelp, Trustpilot (G2 / Capterra are stubs) |
| `TRUST_COHERENCE_ENABLED` | **absent** in production |
| `REVIEWS_API_KEY` / `GOOGLE_PLACES_API_KEY` / `YELP_API_KEY` / `TRUSTPILOT_API_KEY` | **all absent** |
| Orchestrator on the report path | **No** — only `ingestionScheduler` |
| `review_sources` migration | **APPLIED IN PRODUCTION** (verified, 0 rows) |

**Classification: implemented but unconfigured + not wired to the report path.** Four independent gates; the schema is no longer one of them.

---

## 3. END-TO-END DATA FLOW AUDIT

### 3.1 The working spine (verified against production rows)

```
POST /api/reports/generate → reports row (generating)
  → generateReportPayload
      ├─ ensureReportCrawlEvidence   ✓ invoked (snapshot only)  ✗ produced 0 pages for the observed company
      ├─ runCompanyBlogIntelligence  ✓
      └─ composeSnapshotReport       ✓  (SERP 8 req, AI 1/20 cells)
  → reports.data.composed_report     ✓  ALL SIX Report 1 fields present in live rows
  → GET /api/reports/[id]?format=html
      → mapComposedReport            ✓  typed, no cast
      → attachProgressComparison     ✓
      → sanitizeReportViewPayload    ✓  JSON round-trip preserves all surfaces
      → renderCanonicalReportHtml    ✓  16 sections rendered
```

### 3.2 Rendered section inventory (executed artifact, 173,331 bytes)

```
[Digital Snapshot] Top Priorities          ← GAP-01
[Digital Snapshot] Opportunities           ← GAP-01
[Digital Snapshot] The Next 90 Days        ← GAP-01
[01] Authority Position
[02] Score Drivers & Limiters
[Public Evidence] Website Evidence         ← GAP-01
[03] AI Discoverability
[04] Trust & Consistency
[05] Strategic Constraints
[06] Market Position
[07] Competitive Landscape
[Public Evidence] Competitive Position     ← GAP-01
[08] Momentum & Maturity
[09] Data Confidence & Coverage
[10] Execution Channel Mix
[11] Strategic Action Plan
+ Report Readiness · Plan notes · Limits of this reading · Unclassified · Disclosures · Methodology
```

`[12] Improvement Plan` renders only when `improvement_todos` is non-empty — correctly absent when no dimension is measurably weak.

---

## 4. SILENT-DROP / DISCONNECTION AUDIT

| # | Data | Produced | Reaches | Drops at | Status |
|---|---|---|---|---|---|
| 1 | Technical/content/accessibility/brand **`checks[]`** (23+ deterministic checks) | every run | `engineEvidenceDigest` → `enrichRationale` (one sentence) | **`CanonicalReport`** — zero references to `engineEvidence` in `canonicalReportTypes.ts` / `canonicalExport.ts` | **DISCONNECTED** |
| 2 | `ReportCrawlEvidenceResult` (action, pagesBefore/After, durationMs, reason, error) | every snapshot run | `console.info` only | **never written to `composed_report`** | **DISCONNECTED** |
| 3 | `report1.performance` | carried by GAP-01 | export payload | **no renderer section** | **DISCONNECTED** (mine) |
| 4 | `report1.evidence_coverage` | carried by GAP-01 | export payload | **0 renderer refs** — the readiness block reads `payload.evidence_readiness` from canonical instead | **REDUNDANT CARRY** (mine, harmless) |
| 5 | SERP `position` / `link` / `title` | 8 live requests per run | discarded in `.map(normalizeDomain)` | **`fetchSerpDomainsForKeyword`** | **NOT IMPLEMENTED** |
| 6 | Own-domain SERP rows | present in response | filtered | **`isBlockedSerpDomain`** | **NOT IMPLEMENTED** |
| 7 | AI probe `mentions` (query, answer, matched span) | every probe | `observed_count` + signal strings | **`AICitationMatrixSummary`** | **PARTIAL** |
| 8 | `seo_executive_summary`, `geo_aeo_*`, `unified_intelligence_summary`, `competitor_*_summary`, `visual_intelligence`, `decision_snapshot`, `top_priorities` | every run | **JSON API yes / HTML no** | deliberate Phase-7 deprecation | **BY DESIGN** — but API and document now disagree on what the report contains |
| 9 | `pipeline_audit`, `primary_problem` | every run | not in `ComposedReportData` | internal diagnostics / deprecated | **ACCEPTABLE** |

Items 3 and 4 were introduced by GAP-01 and are recorded here rather than quietly fixed.

---

## 5. EVIDENCE & PROVENANCE AUDIT

### 5.1 Runtime enforcement — unchanged

`backend/services/evidenceProvenance.ts` still has **zero runtime consumers**. Verified by repo-wide grep excluding tests: only `digitalSnapshotAssembly.test.ts` and `reportEvidenceDiscipline.test.ts` import it.

**It is POLICY ONLY, not a runtime invariant.** `gsc → CONNECTED_SOURCE` is correctly declared and never consulted, while `rankSourceTags = ['GSC']` remains on the Report 1 path.

### 5.2 The prohibited transition — three confirmed instances

| # | Location | Behaviour | Reaches | Severity |
|---|---|---|---|---|
| **L1** | `visualIntelligenceHelpers.ts:236-252` | zero evidence → `technical_seo_score = 100`, `state = 'measured'` | Foundation pillar → overall → **customer document** | **CRITICAL — live in 6 production reports** |
| **L2** | `canonicalReportBuilderInputs.ts:169-190` | `aggregateOverallScore` returns `value` with `state:'insufficient_signal'` | stored record, **API JSON**, Report 2 baseline | **HIGH — live** (`value: 10, state: 'insufficient_signal'`) |
| **L3** | `performanceReportService.ts:541` | `overview?.overall_score?.value ?? snapshot.score?.value` — no state gate | Report 2 `authority_score` | **HIGH — the crossing point for L2** |

Latent: `canonicalExport.ts:150` `snapshot_summary.overall_value` is ungated (`shape:'snapshot'` unused by the report route today).

**Correctly gated (verified):** `renderAuthorityBar`, `isMeasuredScore`, `authorityPositionCard`, `classifyMaturity` (early-returns before interpolating `overall.value`), `buildAggregateCanonicalScore`, `assembleDigitalSnapshot` (`passesEvidenceGate` + contradiction guard), and the five non-technical radar axes.

### 5.3 Internal contradictions in a single document

| Contradiction | Production-real? |
|---|---|
| Foundation **100/100** vs *"The website has not yet been fully scanned for this report"* | **YES — observed in live rows** |
| §11 Strategic Action Plan *"No actions could be derived from the current evidence"* vs Digital Snapshot listing 5 opportunities and a populated 90-day plan | **YES — structurally real** (different inputs: legacy needs decision objects, new needs crawl/experience) |
| Canonical *"Competitor comparison — No observations"* vs rendered Competitive Position table | **NO — fixture-induced.** Both derive from `competitorIntelligence.detected_competitors` in production |

### 5.4 Attribute coverage

| Attribute | State |
|---|---|
| Source (`EvidenceSourceKind`) | IMPLEMENTED |
| Provenance (public/private origin) | **DISCONNECTED** — vocabulary only |
| Timestamp | IMPLEMENTED |
| Freshness | PARTIAL — `age_hours` nulled by `mergeEvidence` and `aggregateOverallScore` |
| Confidence band | IMPLEMENTED |
| Evidence state | IMPLEMENTED — **except L1** |
| Source reliability | IMPLEMENTED, not persisted |
| Abstention | IMPLEMENTED / PROVEN |

---

## 6. SEARCH / AI / PUBLIC-SOURCE AUDIT

Re-verified against Vercel **production** this session (not carried forward):

| Variable | State |
|---|---|
| `OPENAI_API_KEY` | **PRESENT** |
| `SERP_API_KEY` | **PRESENT** |
| `WIKIDATA_ENABLED` | absent → **default ON** (keyless) |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `AZURE_COPILOT_API_KEY` | absent |
| `AHREFS_API_KEY`, `MOZ_API_KEY`, `MAJESTIC_API_KEY` | absent |
| `PAGESPEED_API_KEY`, `PAGESPEED_ENABLED` | absent |
| `TRUST_COHERENCE_ENABLED`, `REVIEWS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `YELP_API_KEY`, `TRUSTPILOT_API_KEY` | absent |
| `SUPABASE_HISTORY_ENABLED`, `AUTHORITY_TRAJECTORY_ENABLED` | absent |
| `BENCHMARK_DATASET_PATH`, `GOOGLE_KG_API_KEY`, `SCALESERP_API_KEY` | absent |
| `REPORT_CRAWL_MAX_PAGES` | absent → **default 15** |
| `CRM_ENABLED`, `COMMERCIAL_EVIDENCE_ENABLED` | absent |

Classification per capability:

* Search visibility → **implemented provider, unimplemented processing**
* AI breadth → **implemented, unconfigured** (4 keys)
* Performance → **implemented, unconfigured** (1 key)
* Backlinks → **implemented, unconfigured** (1 key); `authority_inflow` correctly self-downgrades to `inferred`
* Reputation → **implemented, unconfigured + unwired**
* Durable history → **implemented, schema applied, disabled by one flag**
* Benchmark → **architecture only** — fabrication explicitly disallowed
* Social presence → **not implemented**

---

## 7. PERSISTENCE & REPORT 2 BOUNDARY AUDIT

### 7.1 Live database verification — UPGRADED FROM UNPROVEN

The Supabase MCP server remains unavailable. A **read-only REST probe against production** was used instead:

| Table | Live state |
|---|---|
| `report_score_history` | **EXISTS · 0 rows** |
| `report_pillar_history` | **EXISTS · 0 rows** |
| `report_provider_history` | **EXISTS · 0 rows** |
| `report_recommendation_history` | **EXISTS · 0 rows** |
| `report_evidence_history` | **EXISTS · 0 rows** |
| `report_benchmark_history` | **EXISTS · 0 rows** |
| `review_sources` | **EXISTS · 0 rows** |
| `canonical_pages` | EXISTS · **130 rows across 5 companies** |
| `reports` | EXISTS · **280 rows** |

**Migration `20260601000000` and `20260903000000` are APPLIED IN PRODUCTION.** The previous audit's "repo schema ≠ live schema" caveat is now resolved in the favourable direction.

Six empty history tables plus a live `persistCanonicalSnapshot` call path is direct empirical confirmation that `historicalPersistence.ts:233` (`let activeStore = new InMemoryHistoryStore()`) is still the active store — **the baseline gap is now a one-flag problem, not a schema problem.**

### 7.2 Report 1 → Report 2 contract

| Baseline object | Row-shaped persistence | JSONB persistence | Status |
|---|---|---|---|
| Baseline metrics / pillars / evidence / source / timestamp / confidence / recommendations | schema live, **0 rows written** | inside `composed_report` | **NOT PERSISTED as rows** |
| Priority, expected outcome | — | inside `composed_report` | **PARTIALLY PERSISTED** |
| Content gaps | `decision_objects` | yes | **PERSISTED** |
| Positioning gaps | — | `composed_report` | **PARTIALLY PERSISTED** |
| Search gaps | on-page only, mislabelled | yes | **PERSISTED but mislabelled** |
| Channel gaps | not modelled | — | **NOT IMPLEMENTED** |

**Threats:** Report 2 re-runs `composeSnapshotReport` live ([performanceReportService.ts:529](backend/services/performanceReportService.ts#L529)) instead of reading a baseline, consumes legacy `snapshot.top_priorities` rather than `digital_snapshot.topPriorities`, and ingests the L2 numeric without a state gate.

---

## 8. CUSTOMER OUTPUT AUDIT

| # | Required section | Rendered | Status | Change since GAP-01 |
|---|---|---|---|---|
| 1 | Executive Snapshot | Cover + Executive Reality Snapshot | **IMPLEMENTED** | — |
| 2 | Company / Positioning | §06 + Brand Brief + Strategic Posture | **PARTIAL** — declared data, unlabelled | — |
| 3 | Discoverability | §03 only | **PARTIAL** — no organic-search half | — |
| 4 | Website & Technical Health | **Website Evidence** | **PARTIAL** — findings yes, 23 checks no | **DISCONNECTED → PARTIAL** |
| 5 | Content | none | **DISCONNECTED** | — |
| 6 | Search / SEO | none (§10 is AI-matrix-derived) | **NOT IMPLEMENTED** | — |
| 7 | AI / AEO / AIO | §03 | **PARTIAL** — 1 of 5 providers, 1 of 20 cells | — |
| 8 | Social / Reputation | §04 (always unavailable) + Declared Evidence | **UNAVAILABLE** | — |
| 9 | Competitive Position | §07 + **Competitive Position** | **IMPLEMENTED** | **DISCONNECTED → IMPLEMENTED** |
| 10 | Evidence Coverage | Readiness + §09 + Disclosures + Methodology | **IMPLEMENTED / PROVEN** | — |
| 11 | Opportunities | **Opportunities** | **IMPLEMENTED** | **DISCONNECTED → IMPLEMENTED** |
| 12 | Top Priorities | **Top Priorities** | **IMPLEMENTED** | **DISCONNECTED → IMPLEMENTED** |
| 13 | 30/60/90 | **The Next 90 Days** | **IMPLEMENTED** | **DISCONNECTED → IMPLEMENTED** |

**5 of 13 sections improved. 8 remain incomplete.** Critically, sections 11–13 render *structurally* but are **empty for every real company in production today** because their upstream crawl evidence is absent.

---

## 9. DUPLICATE / LEGACY PATH AUDIT

| Item | Finding | Classification |
|---|---|---|
| Legacy `action_playbook` (§11) vs Digital Snapshot Opportunities | **Contradictory, not additive.** Different inputs — legacy needs decision objects, new needs crawl/experience. Observed in the executed artifact: §11 says *"No actions could be derived from the current evidence"* on the same page as 5 evidence-backed opportunities | **V1 BLOCKER** (credibility) |
| §10 "Execution Channel Mix" named for channels, sourced from `buildChannelLeverage` which reads **only** the AI citation matrix | Misleading section name; not a marketing-channel analysis | **P1** |
| Orphan `pages/api/reports/snapshot.ts` | Still **zero callers**; calls `composeSnapshotReport(companyId)` with no options → `resolvedInput = null` → competitor domain falls back to literal `'your-site.com'`; would pay for real LLM + SERP | **P2 cleanup** |
| `report_type = 'content_readiness'` for `requested_report_category = 'snapshot'` | Report 1 rows are stored under a legacy type name; `isSnapshotCategoryRow` compensates | **P2** — naming debt, works correctly |
| Duplicate per-view HTML render (`?format=html` fetched on every load) | Redundant server render | **P2** |
| JSON API returns deprecated summaries the HTML no longer renders | API and document disagree on report contents | **P2** |

No duplicate assemblers or duplicate intelligence producers were found. GAP-01 introduced none.

---

## 10. COMPLETE GAP REGISTER

---

### GAP-02 — Zero crawl evidence scores a measured Technical SEO 100

| Field | Value |
|---|---|
| **Capability** | Website & technical health scoring |
| **Spec requirement** | Evidence discipline; never `UNAVAILABLE → PRESENTED AS FACT` |
| **Current state** | `technicalPenalty` computed from `.reduce(fn, 0)` over an empty decision list yields `0`; `technicalSeoScore = 100 - 0 = 100`; `technicalState = 'measured'` |
| **Evidence** | [visualIntelligenceHelpers.ts:236-252](backend/services/snapshotReport/visualIntelligenceHelpers.ts#L236-L252); counters at :184-215. **Live production:** 6 completed reports show `foundation = 100 (inferred)` with `canonical_pages = 0` and evidence-coverage stating the site was never scanned |
| **Status** | **BROKEN** |
| **Exact breakpoint** | `metadataIssues != null` is `true` when the value is `0`, so the null-guard never fires |
| **Root cause** | `Array.reduce(fn, 0)` on an empty array returns `0`, not `null`. Absence of defect-decisions is indistinguishable from absence of evidence |
| **Existing assets** | The other five radar axes already implement the correct guard (`.length > 0` → value, else `null`) |
| **Required change** | Derive the counters as `null` when `publicAudit.decisions.length === 0` (or when no crawled pages exist), so `technicalPenalty` stays `null` and the axis reports `insufficient_signal` |
| **Acceptance criteria** | With `canonical_pages = 0`: `technical_seo_score === null`, `axis_states.technical_seo_score === 'insufficient_signal'`, `index_integrity` unavailable, Foundation pillar unmeasured, and no "100" anywhere in the rendered document. With real crawl rows the score is unchanged from today |
| **Test evidence** | Unit test over `buildSnapshotVisualIntelligence` with empty and populated audits; regression test asserting the existing measured path is byte-identical |
| **Priority** | **P0** |
| **Dependencies** | none |
| **Parallelizable** | **Yes** |
| **Report section** | 4, 1, 10 |
| **V1 blocking** | **Yes** |

---

### GAP-03 — Report 1 produces an empty decision layer for real companies

| Field | Value |
|---|---|
| **Capability** | Crawl evidence supply for the report path |
| **Spec requirement** | *"Give a real company a credible public-domain Digital Snapshot"* |
| **Current state** | `ensureReportCrawlEvidence` is wired and invoked, but the most recent 6 production Report 1 runs for `calendly.com` produced `canonical_pages = 0` → `digital_experience.findings = 0` → `digital_snapshot.empty = true` (0 opportunities, 0 priorities, empty 90-day plan) |
| **Evidence** | Live probe: that company has 0 `canonical_pages`; only **5 companies in the entire production database** have any crawl rows (88 / 15 / 12 / 11 / 4 pages) |
| **Status** | **BROKEN** (capability executes, produces materially incomplete output) |
| **Exact breakpoint** | Between `ensureReportCrawlEvidence` and `canonical_pages` — the crawl returns no persisted pages. Root cause not determinable from stored data because `ReportCrawlEvidenceResult` is `console.info` only (see GAP-09) |
| **Root cause** | Undiagnosed. Candidates: target site blocks the crawler UA, SSRF-guard rejection, 20s `REPORT_CRAWL_SOFT_BUDGET_MS` exhausted before first persist, or `action: 'failed'` |
| **Existing assets** | `crawlerService`, `reportCrawlEvidenceService`, `ReportCrawlEvidenceResult` (already carries `action` / `reason` / `error`) |
| **Required change** | Diagnose using the existing result object; make the failure visible and, where the cause is a bounded budget or a blocked fetch, addressable |
| **Acceptance criteria** | A Report 1 run for a real reachable domain yields `canonical_pages ≥ REPORT_CRAWL_MIN_PAGES`, non-empty `digital_experience.findings`, and `digital_snapshot.empty === false`. Where a crawl genuinely cannot succeed, the report states the reason |
| **Test evidence** | Executed Report 1 for a real domain; DB assertion on `canonical_pages`; artifact assertion on non-empty Opportunities |
| **Priority** | **P0** |
| **Dependencies** | GAP-09 (needed to diagnose) |
| **Parallelizable** | No — GAP-09 first |
| **Report section** | 4, 5, 11, 12, 13 |
| **V1 blocking** | **Yes** — without it the finish line is unreachable for any real company |

---

### GAP-04 — Numeric value survives an insufficient evidence state

| Field | Value |
|---|---|
| **Capability** | Score/state integrity across the report boundary |
| **Spec requirement** | Never present unavailable evidence as fact |
| **Current state** | `aggregateOverallScore` returns `{ value, state:'insufficient_signal' }` when fewer than half the pillars are measured; `performanceReportService:541` reads `.value` with no state gate |
| **Evidence** | [canonicalReportBuilderInputs.ts:169-190](backend/services/canonicalReport/canonicalReportBuilderInputs.ts#L169-L190); [performanceReportService.ts:541](backend/services/performanceReportService.ts#L541). **Live production:** `overall_score = { value: 10, state: 'insufficient_signal' }` in 6 stored reports |
| **Status** | **BROKEN** |
| **Exact breakpoint** | `scoreFromAxis({ value, state })` preserves the value; every renderer re-checks state, but the stored record, the JSON API and Report 2 do not |
| **Root cause** | The state/value invariant is enforced per-render-site instead of at construction. `aggregatePillarScore` already uses `emptyCanonicalScore` correctly for the zero-measured case; the partial case was missed |
| **Existing assets** | `emptyCanonicalScore(state)` returns `value: null` and preserves the shape |
| **Required change** | Return `emptyCanonicalScore('insufficient_signal')` (retaining the evidence trace) when the computed state is insufficient; independently gate `performanceReportService:541` on state |
| **Acceptance criteria** | No `CanonicalScore` in a produced report carries a non-null `value` with `state ∈ {insufficient_signal, unavailable}` — asserted as a property over the whole report object. Report 2's `authority_score` is `null` when Report 1 could not measure |
| **Test evidence** | Property test across all scores in a built report; Report 2 null-propagation test |
| **Priority** | **P0** |
| **Dependencies** | none |
| **Parallelizable** | **Yes** |
| **Report section** | 1, 10, Report 2 boundary |
| **V1 blocking** | **Yes** |

---

### GAP-05 — The report contradicts itself on whether actions exist

| Field | Value |
|---|---|
| **Capability** | Single coherent recommendation surface |
| **Spec requirement** | Observation → Interpretation → Opportunity → Recommended Action |
| **Current state** | Legacy `action_playbook` (§11) and the Digital Snapshot decision layer both render, from different inputs |
| **Evidence** | Executed artifact: §11 renders *"No actions could be derived from the current evidence"* on the same document as 5 opportunities, 5 priorities and a populated 90-day plan |
| **Status** | **BROKEN** (customer-visible contradiction) |
| **Exact breakpoint** | `buildActionPlaybook` consumes decision-derived summaries; `assembleDigitalSnapshot` consumes crawl/experience/competitive. A company with crawl evidence but no decision objects gets exactly this divergence |
| **Root cause** | GAP-01 rendered additively and deliberately deferred reconciliation |
| **Existing assets** | Both producers; `renderStrategicActionPlan`; the new Report 1 renderer |
| **Required change** | Make the Digital Snapshot decision layer authoritative and either suppress §11 when it is empty while the decision layer is populated, or merge the two into one ranked surface. **Do not build a third engine** |
| **Acceptance criteria** | No rendered Report 1 asserts "no actions" while also listing opportunities. One authoritative recommendation ordering per document |
| **Test evidence** | Render test over a payload with a populated `digital_snapshot` and an empty `action_playbook`, asserting no contradictory copy |
| **Priority** | **P0** |
| **Dependencies** | none |
| **Parallelizable** | **Yes** |
| **Report section** | 11, 12 |
| **V1 blocking** | **Yes** |

---

### GAP-06 — Public-domain search visibility

| Field | Value |
|---|---|
| **Capability** | Own-domain search visibility from a public source |
| **Spec requirement** | Report 1 §D — search visibility, ranking evidence, search gaps, public-domain only |
| **Current state** | SERP runs **8 live requests per Report 1** in production; the response's `position` is discarded and the own domain is explicitly filtered out; the search slot is filled by GSC (private) |
| **Evidence** | Production `cost_summary.per_provider.serp.requests = 8`; `fetchSerpDomainsForKeyword` returns `string[]` of domains; `isBlockedSerpDomain`: `normalized === own → true`; `num: 5`; `rankSourceTags = ['GSC']` |
| **Status** | **NOT IMPLEMENTED** (processing + exposure). **Not UNAVAILABLE** — the configured provider already supplies the evidence |
| **Exact breakpoint** | `.map((item) => normalizeDomain(item.link))` drops rank; `isBlockedSerpDomain` drops self |
| **Root cause** | SERP was introduced for competitor discovery only; the search-visibility slot was filled from GSC because analytics already had it |
| **Existing assets** | `serpAcquisitionService` (4 providers, seeding, health, cost governor), `fetchSerpDomainsForKeyword`, `resolveProviderCredential('serpapi')`, scan-budget primitives, `publicDomainAudit.geo_aeo_context.queries` + `entityCandidates` as crawl-derived public query seeds |
| **Required change** | Public query seeder (no GSC parameter); retain own-domain position from the **same** response (no extra request); raise `num` for a usable depth; expose `search_visibility { state, queries_run, queries_ranked, positions[], featured_snippets, provider, observed_at, reason_unavailable }`; feed it to the assembler in place of the GSC-derived state |
| **Acceptance criteria** | With `SERP_API_KEY` set, ≥1 query yields a measured position or measured absence with `state:'measured'` and no `gsc` source. Without the credential, `state:'unavailable'` with a literal reason and **no GSC fallback**. Budget ledger records the calls |
| **Test evidence** | `createManualSerpProvider` fixture (harness exists in `searchAndCompetitiveEvidence.test.ts`); budget test; provenance test asserting no `gsc` source |
| **Priority** | **P0** |
| **Dependencies** | none |
| **Parallelizable** | **Yes** |
| **Report section** | 3, 6 |
| **V1 blocking** | **Yes** |

---

### GAP-07 — Provenance is policy, not a runtime invariant

| Field | Value |
|---|---|
| **Capability** | Public-domain boundary enforcement |
| **Spec requirement** | Report 1 is public-domain only |
| **Current state** | `evidenceProvenance.ts` defines the full taxonomy and has **zero runtime consumers** |
| **Evidence** | Repo-wide grep excluding tests returns nothing; `gsc → CONNECTED_SOURCE` declared while `rankSourceTags = ['GSC']` remains live |
| **Status** | **DISCONNECTED** |
| **Exact breakpoint** | No call site anywhere in the runtime report path |
| **Root cause** | Module shipped as vocabulary ahead of enforcement |
| **Existing assets** | `isReport1Source`, `summarizeProvenance`, `PRIVATE_PROVENANCE`, `EvidenceTrace.sources` |
| **Required change** | Apply the guard where `EvidenceTrace`s are assembled: exclude or explicitly label non-`REPORT1_PROVENANCE` sources, and disclose exclusions |
| **Acceptance criteria** | For a tenant with GSC connected, no rendered Report 1 score has `gsc` in its evidence sources — or it appears with a visible connected-source label. `summarizeProvenance(...).report1Clean === true` for every rendered score |
| **Test evidence** | Integration test with a GSC-tagged decision object |
| **Priority** | **P0** |
| **Dependencies** | none (GAP-06 removes the main leak vector; the guard is still required) |
| **Parallelizable** | **Yes** |
| **Report section** | all |
| **V1 blocking** | **Yes** |

---

### GAP-08 — Declared data presented under observed field names

| Field | Value |
|---|---|
| **Capability** | Declared vs observed distinction |
| **Spec requirement** | Observed / Inferred / Estimated / Unavailable must be distinguishable |
| **Current state** | `company_context.homepage_headline` ← `profile.key_messages`; `primary_offering` ← `profile.products_services`; `positioning` ← `profile.brand_positioning`. Rendered by Brand Brief / Strategic Posture with no provenance marker |
| **Evidence** | [narrativeHelpers.ts:41-46](backend/services/snapshotReport/narrativeHelpers.ts#L41-L46) |
| **Status** | **BROKEN** (mislabel) |
| **Exact breakpoint** | Field naming predates the provenance model; the renderer has no label to show |
| **Root cause** | Same as GAP-07 — no provenance primitive at the render layer |
| **Existing assets** | `CrawlPageResult.headings` / `metaTags` / `ctas`; digital-experience `value_communication` findings; `EvidenceProvenanceClass` |
| **Required change** | Re-source from the crawl where possible, else tag `COMPANY_CONFIRMED` and render the label; show both when crawl and profile disagree |
| **Acceptance criteria** | No field named for an observed artefact is populated from declared data without a visible label |
| **Test evidence** | Render test with a crawl headline differing from `key_messages` |
| **Priority** | **P0** |
| **Dependencies** | GAP-07 (shares the labelling primitive) |
| **Parallelizable** | No |
| **Report section** | 2 |
| **V1 blocking** | **Yes** |

---

### GAP-09 — Crawl outcome is never persisted or disclosed

| Field | Value |
|---|---|
| **Capability** | Evidence-envelope disclosure |
| **Spec requirement** | State what was measured, what was not, and why |
| **Current state** | `ReportCrawlEvidenceResult` (`action`, `pagesBefore/After`, `durationMs`, `reason`, `error`) is `console.info` only |
| **Evidence** | [reportCardServiceAssembly.ts:364-371](backend/services/reportCardServiceAssembly.ts#L364-L371) — logged, never written to `composed_report` |
| **Status** | **DISCONNECTED** |
| **Exact breakpoint** | The result object is discarded after logging |
| **Root cause** | Added as an operational log, never promoted to report evidence |
| **Existing assets** | The result object; `renderReportDisclosures`; `AICitationMatrix.coverage`; `competitor_intelligence.serp_status`; `PerformanceEvidence.reasonUnavailable`; `scan_metadata.cost_summary` |
| **Required change** | Persist the crawl result into `composed_report` and disclose: pages crawled + when, AI cells measured of 20, SERP live/fallback, and every unavailable source with its reason |
| **Acceptance criteria** | The rendered report states all four facts. **Also the diagnostic precondition for GAP-03** |
| **Test evidence** | Render test asserting all four strings for a production-shaped fixture |
| **Priority** | **P1** — but **sequenced first** because GAP-03 cannot be diagnosed without it |
| **Dependencies** | none |
| **Parallelizable** | **Yes** |
| **Report section** | 10 |
| **V1 blocking** | **Yes** (as GAP-03's precondition) |

---

### GAP-10 — Website technical checks never reach the customer

| Field | Value |
|---|---|
| **Capability** | Website & technical health detail |
| **Current state** | 23 technical + content + accessibility + brand checks computed every run; `enrichRationale` compresses them into one rationale sentence; `engineEvidence` is not on `CanonicalReport` |
| **Evidence** | Zero references to `engineEvidence` in `canonicalReportTypes.ts` / `canonicalExport.ts`; `enrichRationale` emits "weakest X; strongest Y" |
| **Status** | **DISCONNECTED** |
| **Exact breakpoint** | `buildCanonicalReport` consumes `engineEvidence` for narrative only |
| **Existing assets** | `TechnicalIntelligence.checks`, `ContentIntelligence.checks`, `AccessibilityIntelligence.checks`, `provenance{checksEvaluated,checksTotal}`; the GAP-01 `report1` contract slot and renderer |
| **Required change** | Carry `checks[]` through the existing `report1` contract and render grouped (reachability / indexability / metadata / structured data / linking), with `not_evaluable` shown as such |
| **Acceptance criteria** | robots.txt, sitemap URL count, canonical coverage, JSON-LD types, duplicate titles and hreflang appear with observed counts. No `not_evaluable` check renders as a zero |
| **Test evidence** | Render test including a `not_evaluable` check |
| **Priority** | **P1** |
| **Dependencies** | GAP-02 (do not render a check-level 100 built on nothing) |
| **Parallelizable** | after GAP-02 |
| **Report section** | 4 |
| **V1 blocking** | No |

---

### GAP-11 — Content section

**Capability:** content depth / gaps / freshness as a rendered section. **Current:** `contentIntelligenceEngine` runs; zero references in any export renderer. **Status:** DISCONNECTED. **Reuse:** the `report1` contract slot, `publicDomainAudit`. **Acceptance:** thin pages, missing page types and freshness render with counts and URLs; `not_evaluable` honest. **Priority: P1.** **Depends on:** GAP-02. **Section 5.** **V1 blocking: No.**

### GAP-12 — AI coverage breadth and reproducibility

**Capability:** AI visibility. **Current:** 1 of 5 providers; **1 of 20 cells measured in production**; coverage disclosed as "5%"; `mentions` dropped by `AICitationMatrixSummary` so no claim is reproducible; `ai_surface_presence.score = {value: 0, state:'inferred'}` on 5% coverage. **Status:** PARTIAL. **Required:** name each unqueried provider and why; persist query/answer excerpt/matched span; reconsider emitting a headline 0 at 5% coverage. **Priority: P1.** **Parallelizable: Yes.** **Section 7.** **V1 blocking: No** (provided GAP-09 states the coverage).

### GAP-13 — Durable baseline

**Capability:** Report 1 baseline persistence. **Current:** `historicalPersistence.ts:233` defaults to `InMemoryHistoryStore`; `SUPABASE_HISTORY_ENABLED` absent. **Evidence:** all six history tables **exist in production with 0 rows** — schema applied, writes never landing. **Status:** DISCONNECTED. **Required:** set the flag (owner action); no migration needed. **Acceptance:** two consecutive reports produce two `report_score_history` rows; `change_intelligence` resolves. **Priority: P1** (P0 for Report 2). **Parallelizable: Yes.** **V1 blocking: No.**

### GAP-14 — Report 1 → Report 2 baseline read

**Capability:** longitudinal contract. **Current:** Report 2 re-runs `composeSnapshotReport` live; consumes legacy `snapshot.top_priorities`; ingests the GAP-04 numeric ungated. **Status:** BROKEN. **Required:** read the persisted baseline; consume `digital_snapshot.topPriorities`; gate on state. **Priority: P1.** **Depends on:** GAP-13, GAP-04. **V1 blocking: No.**

### GAP-15 — SERP discovery efficacy

**Capability:** competitor discovery yield. **Current:** 8 paid SERP requests produced `competitive_tables.empty = true` for the observed production run. **Status:** UNPROVEN (single observation; may be keyword-generation quality, `isBlockedSerpDomain` over-filtering, or a genuinely hard domain). **Required:** instrument yield per keyword (reuse `serp_status` / `liveKeywordCount`), then decide. **Priority: P1.** **Depends on:** GAP-09. **Section 9.** **V1 blocking: No.**

### GAP-16 — Residual carried-but-unrendered fields *(introduced by GAP-01)*

`report1.performance` has **0 renderer references**; `report1.evidence_coverage` has **0** (the readiness block reads `payload.evidence_readiness` from canonical instead). Harmless — performance is unavailable in production and coverage renders from the canonical copy — but recorded rather than hidden. **Priority: P2.** **V1 blocking: No.**

### GAP-17 — §10 "Execution Channel Mix" is not a channel analysis

`buildChannelLeverage` reads **only** the AI citation matrix ([intelligenceSurfacesFoundations.ts:410-412](backend/services/intelligence/dossier/intelligenceSurfacesFoundations.ts#L410-L412)). The section name promises marketing-channel intelligence and delivers AI-cell leverage. **Priority: P1** (rename/reframe) **/ P2** (build real channel analysis). **V1 blocking: No.**

### GAP-18 — Orphan snapshot route

`pages/api/reports/snapshot.ts`: zero callers; `composeSnapshotReport(companyId)` with no options → `resolvedInput = null` → competitor domain `'your-site.com'`; would pay for real LLM + SERP. **Priority: P2.** **V1 blocking: No.**

### GAP-19 — Social public presence

No connector visits a public profile; only declared `sameAs` inventory. **Status:** NOT IMPLEMENTED. **Priority: P2** for V1 — Report 1 abstains honestly today. **Section 8.**

### GAP-20 — Reputation activation

Connectors + ingestion + repository exist; `review_sources` **migration is applied in production**; four gates remain (flag, keys, report-path wiring). **Status:** implemented but unconfigured + unwired. **Priority: P2** for V1 — abstains honestly. **Section 8.**

---

## 11. CRITICAL PATH

```
GAP-09 (disclose + persist crawl outcome)
   └─► GAP-03 (diagnose and fix empty crawl evidence)   ← the finish line depends on this
          └─► Report 1 has real intelligence to display

GAP-07 (provenance guard)
   └─► GAP-08 (declared vs observed labelling)
```

Everything else in the P0 set is independent.

**The shortest sequential chain to V1 is `GAP-09 → GAP-03`.** Without crawl evidence the Digital Snapshot is structurally complete and substantively empty — every other fix improves a report that has nothing to say.

---

## 12. PARALLEL EXECUTION TRACKS

| Track | Items | Notes |
|---|---|---|
| **A — Evidence integrity** | GAP-02, GAP-04 | Fully independent. Smallest and highest-value: GAP-02 is one expression, GAP-04 is one return statement plus one consumer gate |
| **B — Evidence supply** | GAP-09 → GAP-03 | The critical path |
| **C — Public search** | GAP-06 | Fully independent vertical |
| **D — Boundary** | GAP-07 → GAP-08 | Independent of A/B/C |
| **E — Coherence** | GAP-05 | Independent |
| **F — Detail sections** *(P1)* | GAP-10, GAP-11 | Both wait on GAP-02 |
| **G — Baseline** *(P1)* | GAP-13 → GAP-14 | GAP-13 is an owner env change |
| **H — AI / SERP quality** *(P1)* | GAP-12, GAP-15 | GAP-15 waits on GAP-09 |

Five P0 tracks (A, B, C, D, E) can run concurrently. Only B and D carry internal ordering.

---

## 13. MINIMUM V1 CLOSURE SET

| ID | Item | Why minimum |
|---|---|---|
| **GAP-02** | Zero evidence must not score 100 | Live falsehood in the customer document; the purest form of the prohibited transition |
| **GAP-03** | Report 1 must have crawl evidence for a real company | Without it the finish line is unreachable — 0 opportunities, 0 priorities, empty plan |
| **GAP-04** | Numeric must not survive an insufficient state | Live in stored records, the API and the Report 2 baseline |
| **GAP-05** | One coherent recommendation surface | The document currently contradicts itself about whether actions exist |
| **GAP-06** | Public-domain search visibility | §D has no public evidence path; the provider is configured and already paid for on every run |
| **GAP-07** | Runtime provenance guard | The public-domain boundary is the product's core claim and is currently unenforced |
| **GAP-08** | Declared vs observed labelling | Prohibited transition in the section a CMO reads first |
| **GAP-09** | Evidence-envelope disclosure | Required in its own right and the diagnostic precondition for GAP-03 |

**Eight items. Five independently startable today.**

---

## 14. POST-V1 / REPORT 3 ITEMS

**Post-V1 (P1):** GAP-10 (technical checks section), GAP-11 (content section), GAP-12 (AI breadth + reproducibility), GAP-13 (durable baseline — one flag), GAP-14 (Report 2 baseline read), GAP-15 (SERP yield), GAP-17 (channel section reframe).

**Post-V1 (P2):** GAP-16 (residual carried fields), GAP-18 (orphan route), GAP-19 (social presence), GAP-20 (reputation activation), `report_type='content_readiness'` naming debt, duplicate per-view HTML render, API/document divergence on deprecated summaries.

**OUT OF SCOPE — REPORT 3:** competitive share of voice; competitor content-footprint crawling; authority trajectory / forecast / comparison as products (Report 1 needs only the *write* side, GAP-13); benchmark peer-percentile positioning; advanced AI-visibility trajectory; autonomous optimization and execution; collaboration and manual-override workflows.

**OUT OF SCOPE — REPORT 2:** all connected-analytics intelligence (GA/GSC/CRM); `gscSeoIntelligenceService` and the analytics services; commercial ROI. Only GAP-13 and GAP-14 touch the boundary, and both are P1.

---

## 15. FINAL REPORT 1 VERDICT

# REPORT 1 NOT READY

GAP-01 was necessary and is confirmed done: the contract is typed, the unsafe cast is gone, and five previously discarded surfaces now reach the customer — verified by 24 contract tests, an executed 173KB artifact, and the presence of all six fields in live production `composed_report` rows.

But restoring the pipe revealed that in production the pipe is dry, and that one prominent number in it is manufactured from silence.

| Measure | Count |
|---|---|
| **P0 items remaining** | **8** (GAP-02 … GAP-09) |
| **P1 items** | **7** (GAP-10, 11, 12, 13, 14, 15, 17) |
| **P2 items** | **5** (GAP-16, 18, 19, 20 + cleanup) |
| **Critical path** | `GAP-09 → GAP-03` |
| **Parallel work available immediately** | **5 P0 tracks** (A: GAP-02+GAP-04, B: GAP-09, C: GAP-06, D: GAP-07, E: GAP-05) |

**Evidence-integrity blockers (3):**
1. Zero crawl evidence scores a measured Technical SEO **100** — live in 6 production reports, contradicting the same document's own coverage statement.
2. Authority Index **10** carried with `state: 'insufficient_signal'` — live in stored records, the JSON API, and the Report 2 baseline.
3. The public-domain boundary is declared in `evidenceProvenance.ts` and enforced nowhere.

**Remaining customer-facing gaps (5 of 13 sections):** Content (5) absent; Search/SEO (6) absent; Website & Technical Health (4) partial — findings render, 23 checks do not; AI/AEO (7) partial at 1 of 20 cells; Social/Reputation (8) unavailable.

**The single fact that decides the verdict:** the most recent real Report 1 in production, for `calendly.com`, contains zero opportunities, zero priorities, an empty 90-day plan, and a Foundation score of 100 on a website that was never crawled. The report is now capable of being credible. It is not yet credible.

---

*Every finding is anchored to a file and line, an executed test run, a rendered artifact, a verified Vercel production environment listing, or a read-only production database probe. Live schema state was verified directly by REST probe after the Supabase MCP server remained unavailable; the six history tables and `review_sources` are confirmed APPLIED and EMPTY. No code, migration, schema or configuration was modified during this audit.*

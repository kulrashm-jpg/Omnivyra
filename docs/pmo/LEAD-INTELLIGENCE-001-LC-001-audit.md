# LEAD-INTELLIGENCE-001 — Phase 1 / LC-001
## Lead Capture & Lead Intelligence Foundation Audit

**Status:** Evidence-based audit (read-only). No code changed.
**Auditor role:** Principal Software Architect / Production Auditor.
**Method:** Traced the implementation end-to-end from repository source. Every claim below cites a concrete file. Assumptions are marked **[ASSUMPTION]**. Nothing here proposes implementation.

---

## 0. Executive summary

Omnivyra has **two distinct, independently-built "lead" systems** that the word "lead" collapses together. Separating them is the single most important framing for this program:

| System | What it is | Direction | Storage | Scoring |
|---|---|---|---|---|
| **A. Website Lead Capture** | Someone submits a form on a website → becomes a `leads` row | **Inbound** | `leads` (+ attribution/session/touchpoint spine) → mirrored to canonical `lead_intelligence` | Deterministic, **read-time** buying-intent engine |
| **B. Active-Leads / Social Listening** | Scans Reddit/LinkedIn/HN/etc. for public posts showing intent | **Outbound / prospecting** | `lead_jobs_v1`, `lead_signals` | **LLM** qualifier (`qualifyLead`) at write-time |

The audit scope (Website → Widget → API → Storage → Intelligence → UI) is **System A**. System B is adjacent, reuses some of the same intelligence read surface, and is a **major reuse asset** — but it is not the inbound capture pipeline.

**Headline findings:**
- The inbound capture pipeline (System A) is **architecturally clean and canonical** — one ingestion service, one identity gateway, one attribution model, no parallel write paths. This is a strong, extensible foundation.
- The **Lead Intelligence read layer is unusually mature**: a unified read service that fuses four sources, plus deterministic engines for buying-intent, decision-stage, BANT qualification, action plans, and account-level company intelligence — all explainable and reusable.
- The **gaps are concentrated in three areas**: (1) **workflow** — the workspace is read-only (no status editing, notes, assignment, bulk actions); (2) **write-time vs read-time scoring asymmetry** — website leads carry no stored score, so list sort/filter by intent silently excludes them; (3) **visitor technical intelligence** — no device/browser/OS parsing, no geolocation, and two parallel tracking pipelines write to different stores.

---

## 1. End-to-end architecture

```
                       ┌───────────────────────── PUBLIC WEB (customer or Omnivyra site) ─────────────────────────┐
                       │                                                                                          │
   WordPress / CMS ────┤  omnivera-tracker.js ──POST /api/website-events/track──► visitor_sessions + tracking_events
   (wordpress-plugin)  │      (public/omnivera-tracker.js)                            (behaviour: pageview, scroll,
                       │                                                              cta_click, form_*, outbound)
                       │  tracker.js v4 ─────────POST /api/track────────────────►  blog_analytics   ⚠ SEPARATE SILO
                       │      (public/tracker.js)
                       │  omnivera-attribution.js (universal SDK / _attr cross-domain token)
                       │
                       │  Lead forms (3 shapes):
                       │   • Omnivyra marketing form  ─POST /api/website/lead-capture─┐
                       │       components/website/LeadCaptureForm.tsx                 │
                       │   • Embed / HTML form         ─POST /api/leads (form_embed)──┤
                       │       generated in pages/leads.tsx                           │
                       │   • Inbound webhook / manual  ─POST /api/leads (webhook)─────┤
                       └──────────────────────────────────────────────────────────────┘
                                                                                      │
             ┌────────────────────────── SERVER (tenant-agnostic after this line) ────▼──────────────────────┐
             │  resolveTenantForWebsite()      backend/services/tenantResolutionService.ts                   │
             │     verified_domain → website_id → host_header → integration_key → site_config → null(reject)  │
             │            │                                                                                    │
             │  captureWebsiteLead()  backend/services/leadCaptureService.ts   (or /api/leads inline)          │
             │     validate → dedupe(10m) → extractAttribution → resolveVisitorSession                        │
             │            │                                                                                    │
             │  createLead()  backend/services/leadService.ts                                                 │
             │     ensureUnifiedPerson() ── lib/identity/identityGateway  (the ONE `leads` INSERT)            │
             │     trackEvent('lead.captured')  ── telemetry                                                  │
             │     adoptLead('website', row)  ── fire-and-forget, fail-open ──► canonical store               │
             │            │                                     │                                              │
             │  recordLeadAttribution() ─► lead_attributions    │  durableLeadIntelligenceSink                │
             │  stitchSessionToLead()   ─► visitor_sessions      │    upsertCanonicalLead → lead_intelligence  │
             │  persistCampaignTouchpoint() ─► campaign_touchpts │    appendLeadEvent   → lead_intelligence_events
             └──────────────────────────────────────────────────┴──────────────────────────────────────────┘
                                                                                      │
             ┌───────────────────────── READ / INTELLIGENCE (repository-owned) ───────▼──────────────────────┐
             │  leadIntelligenceReadService.ts  — collectViews() fuses 4 sources, dedupes (durable wins):     │
             │     lead_intelligence ∪ active_leads ∪ leads ∪ canonical_leads                                 │
             │  Deterministic engines (lib/leadIntelligence/*, NO LLM):                                       │
             │     buyingIntent.ts · recommendations.ts · leadActions.ts (BANT) · companyIntelligence.ts      │
             │     projections.ts · profileEnrichment.ts · query.ts · stats.ts · export.ts · timeline.ts      │
             └──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                      │
             ┌───────────────────────── UI ───────────────────────────────────────────▼──────────────────────┐
             │  /lead-intelligence            (index + [key])  — unified workspace (READ-ONLY)                 │
             │  /leads                         (pages/leads.tsx → LeadsView) — form builder + raw lead list    │
             │  /lead-capture                  business console: topology, funnel, journey, digest diagnostics │
             │  /engagement/leads, /command-center/active-leads — System B (social listening) surfaces         │
             └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Request lifecycle (inbound website form → persisted, scored lead)

```
Browser
  │  captureAttribution()  (lib/website/attributionCapture.ts)
  │     reads URL utm_*, omn_* ids, referrer, sessionStorage omn_session; persists FIRST touch in localStorage
  │  POST /api/website/lead-capture  { intent, name, email, …, company_website(honeypot), ...attribution }
  ▼
pages/api/website/lead-capture.ts
  │  1. method guard (POST only)
  │  2. HONEYPOT: if body.company_website set → return 200 success-shaped, leadId:null  (silent bot drop)
  │  3. resolveTenantForWebsite()  → tenant or 404 unrecognized_website
  ▼
backend/services/leadCaptureService.ts :: captureWebsiteLead()
  │  4. company_id present? else 503 NOT_CONFIGURED
  │  5. isLeadIntent()? else 400 INVALID_INTENT
  │  6. validateWebsiteLead(): name (unless lite intent) + email regex + consent → 400 VALIDATION{fields}
  │  7. findRecentLead(): same email in tenant within 10 min → return {status:'duplicate'} (no 2nd write)
  │  8. extractAttributionPayload(rawBody)      (server re-derives; client values = enrichment only)
  │  9. resolveVisitorSession()                  (server-authoritative session, upsert by anon_id+session_key)
  ▼
backend/services/leadService.ts :: createLead()
  │ 10. ensureUnifiedPerson({email,phone,companyId})  → identity or throw IDENTITY_REQUIRED_FOR_LEAD
  │ 11. INSERT leads (the ONE write)              (metadata carries company/jobTitle/size/industry/interest/message)
  │ 12. trackEvent('lead.captured')               (append-only telemetry, deduped by lead id)
  │ 13. adoptLead('website', row)                 (fire-and-forget → durable canonical lead_intelligence)
  ▼
back in captureWebsiteLead()
  │ 14. recordLeadAttribution()   → lead_attributions + form_conversions
  │ 15. stitchSessionToLead()     → visitor_sessions.unified_person_id + backfill campaign_touchpoints.lead_id
  │ 16. persistCampaignTouchpoint() → campaign_touchpoints (conversion)
  ▼
Response 201 { status:'created', leadId, intent, confirmation{mode,message,successPath|redirectUrl} }
Browser applies confirmation mode: inline | redirect | page (leadCaptureConfig.ts drives this)
```

**Notes / risks in the lifecycle:**
- Steps 14–16 are each independently `try/catch`-swallowed (best-effort). Attribution/touchpoint loss never blocks lead creation — good for resilience, but **silent** (no dead-letter, no metric on failure).
- Step 13 `adoptLead` is **fire-and-forget and not awaited**; a process kill between 11 and 13 leaves the lead only in legacy `leads` (recoverable because the read layer unions `leads`, but the canonical row + timeline event are lost until a re-ingest, which does not exist).
- **No CAPTCHA and no rate limiting** on `/api/website/lead-capture` — honeypot only (see Gap G1). Contrast `/api/website-events/track`, which *does* rate-limit.

---

## 3. Database model

### 3.1 Inbound capture spine (System A)

| Table | Origin migration | Role |
|---|---|---|
| `leads` | `database/leads.sql` + `20260677_website_intelligence_foundation_phase1.sql` (adds `website_id`, `visitor_session_id`, `attribution`, `consent_state`) + `20260506000001` / identity-spine (adds `unified_person_id`, later NOT NULL) | The single inbound lead row |
| `forms` | `database/leads.sql` + phase1 (adds `website_id`, `allowed_domains`) | SaaS form-builder definitions (embed/HTML) |
| `visitor_sessions` | phase1 + `20260678_..._phase2.sql` (adds `session_key`, `stitched_at`) | Server-authoritative anonymous session (first/last touch, UTMs, consent) |
| `tracking_events` | phase1 + phase2 (adds `dedupe_key`, `batch_id`, `user_agent`, `ip_hash`, `bot_flag`) | Clickstream: pageview, scroll, cta_click, form_* |
| `lead_attributions` | phase1 | Capture-time attribution snapshot (`capture_snapshot` model) |
| `form_conversions` | phase1 | Conversion event per form submit |
| `campaign_touchpoints` | phase1 | Multi-touch touchpoints (first/last/event/conversion) |
| `lead_capture_topologies` | `20260701005000_lead_capture_topology.sql` | Operator-declared capture topology (design artifact) |

### 3.2 Canonical intelligence store (additive, Phase-4 of prior work)

| Table | Migration | Role |
|---|---|---|
| `lead_intelligence` | `20260629000000_lead_intelligence_store.sql` | Canonical lead, upsert idempotent on `(company_id, dedupe_key)`. Columns: `scores/identity/attribution/campaign/content/metadata` jsonb, `unified_person_id`, `source`, `source_table/source_id`, `occurred_at` |
| `lead_intelligence_events` | same | Per-ingestion provenance timeline (FK → lead_intelligence) |

### 3.3 Outbound / social-listening (System B — reuse asset, not capture)

`lead_jobs_v1`, `lead_signals`, `lead_thread_*`, `active_leads` (`20260817_active_leads_object_model.sql`), `canonical_leads`, `leadGenerationAuthorityIntelligenceService`, plus archived `archive/legacy-lead-signals/*`.

### 3.4 Field inventory — `leads` + capture metadata

| Field | Classification | Source |
|---|---|---|
| `name`, `email`, `phone` | **Business** | form |
| `metadata.company_name / job_title / company_size / industry / country / primary_interest / message` | **Business** (self-reported) | form |
| `consent_state` | **Business/compliance** | form checkbox |
| `source`, `form_id`, `integration_id`, `is_test`, `created_by` | **Metadata** | server |
| `website_id`, `unified_person_id`, `visitor_session_id` | **Metadata / identity** | server |
| `attribution.utm_*`, `referrer`, `landing_page`, `current_page`, `first/last_touch` | **Tracking** | tracker + form hidden fields |
| `attribution.asset_id / variant_id / creator_strategy_id / anonymous_id / session_id` | **Tracking** (creator attribution) | omn_* link params |
| `lead_intelligence.scores{intent,urgency,icp,confidence,total}` | **Intelligence** | System B write-time; **empty for website leads** (see G3) |

**Tenant isolation:** every table is `company_id`-scoped; RLS enabled with `service_role` policies (all writes go through `ownedDbTable` / service role). Reads re-filter by `company_id` in `leadIntelligenceReadService`. No cross-tenant read path observed in System A.

---

## 4. Visitor Intelligence matrix

Legend: ✅ Implemented · ◐ Partial · ❌ Missing. "Where" = evidence.

| Category | Field | Status | Where |
|---|---|---|---|
| **Acquisition** | Referrer / first_referrer | ✅ | tracker `basePayload`, `visitor_sessions.first/last_referrer` |
| | Source / Medium / Campaign / Content / Term (UTM) | ✅ | `ATTRIBUTION_FIELDS`, `visitor_sessions`, `lead_attributions` |
| | Creator asset / variant / strategy ids | ✅ | `attributionResolverService`, omn_* normalization |
| **Journey** | Landing page / submission (current) page | ✅ | `visitor_sessions.first_landing_page/last_current_page` |
| | Previous pages / full clickstream | ◐ | `tracking_events` stores page_view per event, but only via `omnivera-tracker.js`→`/api/website-events/track`; **not** joined into the lead unless session ids line up |
| | Time on page | ◐ | `/api/track` v4 stores `time_on_page` in **blog_analytics** (separate silo); `websiteBehaviourProjection` reads `tracking_events` metadata — two different stores |
| | Scroll depth | ◐ | tracker emits `scroll_depth`; stored in `blog_analytics` and/or `tracking_events.metadata` — inconsistent (G4) |
| | Click events / CTA clicks | ✅ | tracker `cta_click`/`outbound_click` → `tracking_events` |
| | Downloads | ◐ | Inferred by `buyingIntent` from URL/behaviour heuristics; no explicit download event type in tracker |
| | Search terms | ❌ | not captured |
| **Session** | Session id / anonymous id | ✅ | tracker + `visitor_sessions.anonymous_id/session_key` |
| | Returning visitor / visit count | ◐ | `visitorJourneyProjection` exposes fields; population depends on multi-session stitch which is best-effort |
| | First / last visit | ✅ | `visitor_sessions.started_at/last_seen_at`, `first/last_touch` |
| **Technical** | Browser / Device / OS | ❌ | raw `user_agent` stored on `tracking_events`; **never parsed** into device/browser/OS |
| | IP handling | ◐ | `ip_hash` (hashed, privacy-preserving) on `tracking_events`; raw IP not stored |
| | Geolocation | ❌ | not captured anywhere |

---

## 5. Lead Intelligence matrix

| Capability | Status | Implementation | Reuse |
|---|---|---|---|
| Lead scoring (aggregate) | ✅ deterministic | `buyingIntent.ts` weighted evidence → 0–100 with full breakdown | High — pure, reusable by any channel |
| Intent scoring | ◐ split | System B: LLM `qualifyLead` → stored `intent_score`. System A (website): **no stored score**; derived read-time from behaviour | Reuse System B scorer for inbound? (gap) |
| Journey scoring / decision stage | ✅ deterministic | `classifyStage()` in `buyingIntent.ts` (awareness→customer) | High |
| Persona / role inference | ◐ | `companyIntelligence.ts` infers roles from contacts; no external enrichment | Medium |
| Buying stage | ✅ deterministic | `buyingIntent.decisionStage` + rationale | High |
| Topic / interest affinity | ✅ deterministic | `INTEREST_KEYWORDS` map → ranked `interestProfile` | High |
| AI summaries | ❌ (mislabeled) | UI shows "AI Summary" but `summarizeLead()` is **rule-based**, no LLM | Labeling gap G7 |
| Recommendations / next action | ✅ deterministic | `recommendations.ts`, `leadActions.ts` (BANT, cadence, CRM package) | High |
| Company enrichment (firmographic) | ❌ | only aggregation of *known* contacts; no Clearbit/etc. provider | Gap G6 |
| Contact enrichment | ❌ | self-reported form fields only | Gap G6 |
| Explainability | ✅ strong | every point traces to a named `EvidenceItem`; provenance array | Model asset |

**Critical asymmetry (G3):** `LeadListPanel` sorts/badges intent from `view.scores.intent ?? total ?? 0`; the query filter `buyingIntentMin` filters on the same stored score. Website leads have empty `scores`, so **they always show 0% intent in the list and are excluded by any intent filter**, even though their profile page computes a rich buying-intent score at read-time. List and detail disagree.

---

## 6. Processing pipeline

| Stage | Status | Evidence |
|---|---|---|
| Validation | ✅ | server-side in `validateWebsiteLead` + per-form required-field check in `/api/leads` |
| Deduplication | ◐ | 10-min same-email window (`findRecentLead`); canonical store dedupes on `(company_id, dedupe_key)`; **no cross-session identity dedupe at capture** |
| Enrichment | ❌ | no external enrichment step in the pipeline |
| Queues | ◐ | capture is **synchronous** (no queue). System B uses BullMQ (`leadJobProcessor`, `leadThreadRecomputeWorker`, `leadQueueHardening/Observability`) |
| Retry | ◐ | System B has queue retry/hardening; System A capture side effects are best-effort, **no retry/DLQ** |
| Error handling | ◐ | capture throws typed `LeadCaptureError`; side effects swallow errors silently |
| Logging | ◐ | `trackEvent`/telemetry on capture; `console.info` in System B processor |
| Metrics / Observability | ◐ | rich operator observability on `/lead-capture` (form funnel, drift, publish timeline) but **no metric on attribution/adopt failures** |

---

## 7. Lead Workspace audit (UI inventory)

**`/lead-intelligence` (canonical workspace, `pages/lead-intelligence/index.tsx` + `[key].tsx`):**

| Capability | Status | Evidence |
|---|---|---|
| Lead list | ✅ | `LeadListPanel.tsx` — table (Lead, Source, Campaign, Status, Intent, When) |
| Detail page | ✅ | `LeadProfileView.tsx` — buying intent, action plan, BANT, journey, company intel, timelines |
| Filters | ✅ | source chips, status, campaign, content, owner, date range, intent≥ |
| Search | ✅ | free-text (name/email/company/campaign/content/source/identity) |
| Sorting | ✅ | newest/oldest, highest/lowest intent |
| Export | ✅ | CSV / Excel via `exportLeads` |
| Overview panel | ✅ | `OverviewPanel.tsx` (stats) |
| **Bulk actions** | ❌ | none |
| **Notes** | ❌ | none |
| **Activity history / timeline** | ✅ (read) | `buildTimeline` + `lead_intelligence_events`; append-only, no user notes |
| **Manual editing** | ❌ | profile is read-only |
| **Status management** | ❌ | status is *filterable* but **not settable** from the UI (no write endpoint) |
| **Assignment / ownership** | ❌ | owner is *filterable* but not assignable |
| **Delete** | ❌ in UI | `deleteLead()` exists in service; no workspace control |

**`/leads` (`pages/leads.tsx` → `LeadsView`):** form builder (embed snippet + standalone HTML generator, brand theming), raw lead list, webhook connections. This is the operator's capture-setup surface.

**`/lead-capture` (`pages/lead-capture.tsx`):** business-facing topology/diagnostics console — 12 tabs (guide, topology, continuity, funnel, forms, abandonment, journey, lead digest, revenue, diagnostics). Read-only diagnostics; 7 additional tabs hidden by default.

**Verdict:** the workspace is an **excellent read/intelligence surface but has no lead-management workflow**. This is the largest functional gap for a "Lead Management UI."

---

## 8. API inventory

| Endpoint | Type | Auth | Notes |
|---|---|---|---|
| `POST /api/website/lead-capture` | Public | tenant resolution + honeypot | **No CAPTCHA, no rate limit** (G1) |
| `POST /api/leads` | Public/mixed | webhook secret \| form-origin \| session auth (3 modes) | embed, webhook, manual |
| `GET /api/leads` | Internal | `enforceCompanyAccess` | list (legacy path) |
| `POST /api/leads/job/create`, `/api/leads/signals` | Internal | company-scoped | System B jobs |
| `POST /api/website-events/track` | Public | website-origin enforce + in-memory rate limit + bot flag | clickstream → `tracking_events` |
| `POST /api/track` | Public | domain-allowlist + bot filter, CORS `*` | v4 tracker → **blog_analytics** silo |
| `GET /api/lead-intelligence/leads` | Internal | `resolveUserContext` + `enforceCompanyAccess` | unified read |
| `GET /api/lead-intelligence/{profile,stats,export,canonical}` | Internal | company-scoped | read/intelligence |
| `POST /api/internal/lead-webhook-handoff` | Isolated | HMAC (`CROSS_DOMAIN_ATTR_SECRET`) | conversion callback |
| `/api/wordpress-plugin/*` (register, sync, heartbeat, verify, token-*) | Plugin | token exchange/rotation | **CMS publishing + tracker injection, not native lead capture** |
| `/api/website-intelligence/*` (~20 routes) | Internal | company-scoped | funnel/journey/digest/revenue/topology diagnostics |
| `/api/active-leads/*` (~70 routes) | Internal | company-scoped | System B workspace (large, mostly latent) |

**Rate limiting:** present only on `/api/website-events/track` (in-memory, **per-instance — not distributed**, so weak under horizontal scale). Absent on the actual lead-capture endpoint.

---

## 9. Intelligence-readiness assessment (reusable foundations vs gaps — no implementation)

| Target intelligence | Reusable foundation that exists today | Architectural gap |
|---|---|---|
| **Visitor Intelligence** | `visitor_sessions` + `tracking_events` spine; `omnivera-tracker.js`; `websiteBehaviourProjection` | device/OS/geo not derived; two tracking silos not unified (blog_analytics vs tracking_events) |
| **Website Intelligence** | full `/api/website-intelligence/*` suite (funnel, journey, abandonment, revenue attribution, cohort funnels) | already substantial; depends on tracker adoption + single event store |
| **Prospect Intelligence** | System B (`qualifyLead`, `lead_signals`, connectors), `leadGenerationAuthorityIntelligenceService` | inbound leads not run through the same qualifier; no firmographic enrichment |
| **Audience Intelligence** | `companyIntelligence.ts` (account roll-up, roles, multi-threading), `unified_persons` identity spine | no external identity/firmographic enrichment; persona is heuristic |
| **Campaign Intelligence** | `campaign_touchpoints`, `lead_attributions`, `campaignAttributionProjection`, revenue-attribution route | multi-touch models are read-time only; `attribution_model` mostly `capture_snapshot` |
| **Autonomous GTM Intelligence** | `leadActions.ts` (action plan, cadence, CRM package), recommendation engines, BullMQ workers | action plans are *advisory only* — no execution/CRM-sync/outbound engine wired |

---

## 10. Gap register (prioritized)

| ID | Description | Evidence | Business impact | Technical impact | Dependencies | Existing reusable component |
|---|---|---|---|---|---|---|
| **G1** | No CAPTCHA / no rate limit on public capture endpoint (honeypot only) | `pages/api/website/lead-capture.ts` | Spam/abuse, poisoned lead data, cost | Unbounded writes; per-instance limiter elsewhere not distributed | Redis/Upstash (already in stack) | `checkInMemoryRateLimit`, `isLikelyBot` (already used on `/track`) |
| **G2** | Workspace is read-only — no status set, notes, assignment, bulk, delete | `LeadProfileView.tsx`, `LeadListPanel.tsx` | Cannot operate leads; teams export to a CRM instead | Need write endpoints + audit trail | — | `deleteLead()` exists; `lead_intelligence_events` for audit; `enforceCompanyAccess` |
| **G3** | Website leads carry no stored score → list intent = 0%, intent filter excludes them | `LeadListPanel` `intentPct`, `query.ts` `buyingIntentMin` vs empty `lead_intelligence.scores` | Undermines trust; high-intent inbound leads look cold in the list | Read-time score not materialized to sortable column | — | `buildBuyingIntentProfile` (already deterministic; could materialize) |
| **G4** | Two tracking pipelines to two stores (`/track`→blog_analytics, `/website-events/track`→tracking_events) | `public/tracker.js` vs `public/omnivera-tracker.js` | Fragmented behaviour data; intelligence sees partial signal | Duplicate ingestion, divergent schemas | — | `tracking_events` spine is the canonical target |
| **G5** | No device/browser/OS parsing; no geolocation | `tracking_events` stores raw `user_agent`, `ip_hash` only | Weak segmentation, no geo routing | Need UA parse + geo lookup at ingest | — | `ip_hash`/`user_agent` already captured (parse-ready) |
| **G6** | No firmographic/contact enrichment | no enrichment stage in `captureWebsiteLead`/`createLead` | Sparse ICP/persona; sales does manual research | Add enrichment port | safeFetch (SSRF-safe) | `IdentityResolverPort` pattern; `ensureUnifiedPerson` |
| **G7** | "AI Summary" label over a rule-based summary; no LLM summarization of inbound leads | `LeadProfileView` header vs `summarizeLead()` | Trust/labeling mismatch | Cosmetic + capability gap | AI gateway | `aiGateway`, `runAiExecution` (billing-safe seam) |
| **G8** | `adoptLead` fire-and-forget, not awaited; no re-ingest/backfill for canonical store | `leadService.createLead` line ~190; `leadIntelligenceRuntime.adoptLead` | Canonical row/timeline can silently lag legacy | Read layer masks it (unions `leads`) but timeline incomplete | — | Read-layer union already fail-open; needs a backfill job |
| **G9** | Capture side-effects (attribution/touchpoint/conversion) best-effort, silent on failure | `leadAttributionService`, `attributionResolverService` try/catch | Attribution loss under DB pressure, invisible | No DLQ/metric | observability harness (HARDEN-001) | bounded metrics seams already exist |
| **G10** | No consent lifecycle beyond storing a string; no DSAR/suppression/delete flow | `consent_state` column only | GDPR/compliance risk | Need erase + suppression | — | RLS + `deleteLead` primitive |
| **G11** | WordPress plugin does not natively capture leads (publish + tracker only) | `pages/api/wordpress-plugin/*`, `wordpressPluginService` | WP form users must add SDK/webhook manually | Onboarding friction | — | universal SDK (`omnivera-attribution.js`), webhook handoff |
| **G12** | Downloads / search-terms visitor events not captured; time-on-page split across stores | tracker event set; `/track` vs `/website-events/track` | Incomplete engagement scoring | Extend tracker event taxonomy | — | `tracking_events.event_category` taxonomy is extensible |

---

## 11. Reuse Inventory *(mandatory input to every subsequent implementation prompt)*

> Rule for downstream work: **extend these, do not build parallels.**

### Which existing services can be extended
- `backend/services/leadCaptureService.ts` — **the** inbound ingestion seam. All new capture modes extend `captureWebsiteLead`, never a new writer.
- `backend/services/leadService.ts::createLead` — the single `leads` INSERT + identity + telemetry + adoption. New sources add a `source` value here.
- `backend/services/tenantResolutionService.ts` — the only public-tenant resolver; add strategies here, don't fork.
- `backend/services/leadIntelligence/leadIntelligenceReadService.ts` — the single read surface; add sources as new `LeadSourceReaders`, not new endpoints.
- `backend/services/attributionResolverService.ts` + `leadAttributionService.ts` — session/attribution/touchpoint writers; reuse for any channel.

### Which AI pipelines already exist that can be reused
- `qualifyLead` / `qualifyPredictiveLead` (`backend/services/leadQualifier.ts`, `leadPredictiveQualifier.ts`) — LLM intent/ICP/urgency scoring (currently System B only; reuse for inbound scoring).
- AI gateway spine: `aiGatewayCore`, `runAiExecution`, `ai/safety/*` (safeParse, promptSafety, moderation) — the billing-safe, guarded LLM seam for any new summarization/enrichment.
- `runDiagnosticPrompt` (`llm/openaiAdapter`) — structured-JSON prompt runner with correlation/billing metadata.

### Which enrichment engines already exist
- `lib/identity/identityGateway::ensureUnifiedPerson` + `unified_persons` spine — identity resolution / person unification.
- `companyIntelligence.ts` — account-level roll-up (roles, multi-threading, account intent).
- `IdentityResolverPort` / `IngestionPorts` (`leadIntelligencePorts.ts`, `leadIntelligenceFacade.ts`) — the port pattern to plug a firmographic enricher into without touching capture.
- `lib/security/safeFetch` — SSRF-safe outbound for any third-party enrichment call.

### Which scoring infrastructure already exists
- `lib/leadIntelligence/buyingIntent.ts` — deterministic, fully-explainable 0–100 scorer (weights, evidence, decision stage, journey). **The** canonical scorer to materialize/extend.
- `lib/leadIntelligence/leadActions.ts` — BANT qualification, follow-up cadence, CRM package, channel readiness.
- `lib/leadIntelligence/recommendations.ts` — next-action + summary.
- `leadThreadScoring.ts`, `leadPlatformStats.ts` (conversion-rate platform weighting) — System B scoring adjuncts.

### Which UI components can be shared
- `components/lead-intelligence/LeadListPanel.tsx`, `LeadProfileView.tsx`, `OverviewPanel.tsx` — the workspace; extend with write controls rather than new pages.
- `components/lead-intelligence/leadIntelligenceClient.ts` — typed fetch/export/filter client.
- `components/website/LeadCaptureForm.tsx` + `lib/website/leadCaptureConfig.ts` — config-driven capture form (four intents, confirmation modes).
- `pages/leads.tsx` embed/HTML generators — reusable form-embed distribution.
- `components/engagement/ConversionFunnelStrip` — shared funnel visualization.

### Which observability & background-job frameworks can be leveraged
- BullMQ workers: `leadJobProcessor`, `leadThreadRecomputeWorker`, `backend/queue/leadQueueHardening.ts`, `leadQueueObservability.ts` — the queue + retry + observability pattern for any async lead processing (enrichment, re-scoring, backfill).
- HARDEN-001 bounded-metrics seams + `trackEvent`/`telemetryDispatcher` — fail-safe telemetry for the currently-silent side effects (G9).
- `/api/website-intelligence/operator-observability` + `/api/activation/readiness` — existing operator dashboards to extend, not replace.
- `dailyIntelligenceScheduler`, `recommendationScheduler` — cron seams for periodic re-scoring/backfill (G8).

---

## 12. Production-readiness assessment

| Dimension | Rating | Rationale |
|---|---|---|
| Inbound capture correctness | **Strong** | Single canonical path, tenant-isolated, identity-gated, dedupe, honeypot |
| Capture resilience | **Adequate** | Best-effort side effects never block; but silent failures, no DLQ (G8/G9) |
| Abuse resistance | **Weak** | No CAPTCHA/rate limit on the capture endpoint (G1) |
| Data model | **Strong** | Well-normalized spine, additive canonical store, RLS throughout |
| Visitor intelligence | **Partial** | Behaviour captured but fragmented (G4); no device/geo (G5) |
| Lead intelligence (read) | **Strong** | Mature, explainable, reusable engines |
| Write/read scoring consistency | **Weak** | Website leads unscored in list/filters (G3) |
| Workflow / management UI | **Missing** | Read-only workspace; no status/notes/assign/bulk (G2) |
| Enrichment | **Missing** | No firmographic/contact enrichment (G6) |
| Compliance | **Partial** | Consent stored; no DSAR/suppression (G10) |

**Overall:** The **foundation is production-grade for inbound capture and read-side intelligence**; it is **not yet a lead-management product** (no workflow) and has **three integrity gaps** (abuse controls, scoring materialization, tracking unification) that should anchor Phase-2 scoping. Every gap has a named reusable component to extend — no parallel system is warranted.

---

*Assumptions:* migrations `20260677`/`20260678`/`20260629000000` are applied in production **[ASSUMPTION — not verified against live schema]**; `omnivera-tracker.js` (not the legacy `tracker.js`) is the tracker deployed on customer sites **[ASSUMPTION]**. The `active-leads/*` route surface was sampled, not exhaustively read, and is treated as System B.

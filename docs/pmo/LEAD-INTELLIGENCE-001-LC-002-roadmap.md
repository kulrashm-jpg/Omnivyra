# LEAD-INTELLIGENCE-001 — Phase 2 / LC-002
## GTM Capability Mapping & Engineering Wave Planning

**Status:** Master engineering roadmap. No code, no re-audit, no redesign.
**Baseline:** [LC-001 audit](LEAD-INTELLIGENCE-001-LC-001-audit.md) is authoritative. Gap IDs `G1`–`G12` and the LC-001 Reuse Inventory are referenced, not restated.
**Author roles:** Principal Product Architect · Program Architect · Production Engineering Lead.

**How to read this document:** Every capability is scored against the four mandatory principles — **Reuse First**, **No Architecture Drift**, **Explainability First**, **Autonomous-by-Design**. The autonomy ladder (**Manual → Assisted → Semi-automated → Fully automated**) is the evolution axis for *every* capability; a capability is never "done," it *advances a rung*. The roadmap is structured so that each wave's exit state is the next wave's foundation, and so that independent tracks can be handed to parallel agents.

---

## 0. Operating model (the spine every wave inherits)

Three architectural spines from LC-001 are the non-negotiable extension points. All waves plug into these; none forks them.

| Spine | Single source of truth | Extension rule |
|---|---|---|
| **Ingestion** | `leadCaptureService.captureWebsiteLead` → `leadService.createLead` (the ONE `leads` write) | New capture modes add a `source`; never a new writer |
| **Read/Intelligence** | `leadIntelligenceReadService.collectViews` (durable ∪ active_leads ∪ leads ∪ canonical_leads) | New data appears as a `LeadSourceReader` or a pure `lib/leadIntelligence/*` engine |
| **Identity** | `identityGateway.ensureUnifiedPerson` + `unified_persons` | Every person-bearing capability resolves through this; never a second identity map |

**Autonomy ladder — canonical definition (applies to every capability):**
- **Manual** — the platform surfaces evidence; a human decides and acts.
- **Assisted** — the platform recommends (evidence-backed); a human approves each action.
- **Semi-automated** — the platform executes within guardrails; a human sets policy + reviews exceptions.
- **Fully automated** — closed-loop; the platform acts, measures, and self-corrects; human audits.

**Explainability invariant:** no capability may advance past **Manual** unless its output carries a provenance trail (the `EvidenceItem`/`scoreBreakdown`/`provenance` pattern already in `buyingIntent.ts`). This is a hard gate, not a preference.

---

## 1. GTM Capability Matrix

Legend — **Now:** ✅ present · ◐ partial · ❌ absent (from LC-001). **Ladder:** current highest rung reachable today → target rung for the wave.

### 1.1 Visitor Intelligence

| Capability | Now | Reusable components to extend | Missing functionality | Dependencies | Wave | Certification criteria |
|---|---|---|---|---|---|---|
| Session reconstruction | ✅ | `visitor_sessions`, `resolveVisitorSession` | — (verify multi-instance session_key collisions) | — | W1 | Session dedupe deterministic; 0 duplicate active sessions per (anon_id, session_key) |
| Journey reconstruction | ◐ | `tracking_events`, `campaign_touchpoints`, `visitorJourneyProjection` | Unified event store (G4); ordered clickstream join to lead | G4 | W1 | Journey rebuilt from ONE event store; touch order stable + reproducible |
| Journey evidence | ✅ | `buyingIntent.decisionJourney`, `EvidenceItem` | Persist evidence with the score (currently read-time only) | G3 | W1 | Every journey step cites a provenance source |
| Journey confidence | ◐ | `buyingIntent.confidence` (evidence breadth) | Confidence not surfaced/stored on the lead row | G3 | W1 | Confidence stored + explainable; list-visible |
| Topic affinity | ✅ | `INTEREST_KEYWORDS` → `interestProfile` | Learned (vs keyword) affinity is a later rung | — | W3 | Ranked interests reproducible from evidence |
| Visitor identity | ✅ | `ensureUnifiedPerson`, `stitchSessionToLead` | Cross-device stitch beyond anon_id | G5 | W3 | Anonymous→known stitch audited, no cross-tenant bleed |
| Returning visitors / visit count | ◐ | `visitorJourneyProjection`, `visitor_sessions` | Reliable multi-session rollup | G4 | W1 | visit_count correct across ≥2 sessions |
| Buying stage | ✅ | `classifyStage` (awareness→customer) | Stage transitions not timestamped/eventful | G3 | W1 | Stage + rationale materialized; transition audited |
| Device / Browser / OS | ❌ | raw `user_agent` on `tracking_events` (parse-ready) | UA parse at ingest | G5 | W3 | Parsed fields populated; PII-safe |
| Geolocation | ❌ | `ip_hash` present | Geo lookup at ingest | G5 | W3 | Geo derived from hashed IP; consent-gated |

**Ladder:** Manual (evidence visible) → **Assisted** (journey + stage recommended) is the W1/W3 target.

### 1.2 Website Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Navigation friction / dead-end pages | ◐ | `/api/website-intelligence/form-abandonment`, `customer-journey`, `high-dropoff` in lead-digest | Page-graph dead-end detection on unified events | G4 | W1→W3 | Dead-end list reproducible from one event store |
| Content gaps | ◐ | lead-digest `highDropoffPages`, `topLandingPages` | Gap = demand-vs-content diff (needs topic affinity) | topic affinity | W3 | Gap cites page + unmet interest evidence |
| CTA effectiveness | ✅ | `cta_click`/`form-performance`, `ConversionFunnelStrip` | CTA→conversion attribution join | G4 | W1 | CTA conversion rate reproducible |
| Conversion / funnel diagnostics | ✅ | `/api/website-intelligence/universal-funnel`, `cohort-funnel`, `orchestration-diagnostics` | — (extend to unified store) | G4 | W1 | Funnel stages consistent across pages |
| Journey optimization | ❌ | funnel + friction data above | Recommendation layer over diagnostics | W3 outputs | W4 | Each optimization cites a friction evidence item |

### 1.3 Prospect Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Lead scoring (aggregate) | ✅ | `buyingIntent.ts` | **Materialize** read-time score to sortable/filterable column | G3 | W1 | List/detail scores identical; intent filter includes website leads |
| Intent scoring | ◐ | `qualifyLead` (System B, LLM) + `buyingIntent` (System A, deterministic) | Unify: one scoring contract for inbound + outbound | G3 | W1→W3 | One score object; source of each point explainable |
| Persona / role inference | ◐ | `companyIntelligence` roles | Contact-level persona (needs enrichment) | G6 | W3 | Persona cites evidence (title/behaviour) |
| Company enrichment (firmographic) | ❌ | `IngestionPorts`/`IdentityResolverPort`, `safeFetch` | Enrichment port + provider | G6 | W3 | Enrichment provenance stored; fail-open |
| Contact enrichment | ❌ | same port pattern | Provider integration | G6 | W3 | Same as above |
| Explainable recommendations | ✅ | `recommendations.ts`, `leadActions.ts` | — | — | W2 | Every recommendation traces to evidence |
| AI summaries | ❌ (mislabeled) | `aiGateway`/`runAiExecution`, `ai/safety/*` | LLM summary grounded in `EvidenceItem` set | G7 | W3 | Summary cites the evidence it summarizes; no ungrounded claims |
| Opportunity scoring | ◐ | `opportunityProjection`, System B signals | Inbound opportunity object | G3, G6 | W3 | Opportunity score explainable |

### 1.4 Audience Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Dynamic audiences | ❌ | `query.ts` (`LeadQuery` filter engine), `searchLeads` | Persisted, re-evaluated query = segment | W1 scores | W4 | Segment membership reproducible from query + evidence |
| Saved segments | ❌ | `LeadFilterState`, `leadIntelligenceClient` | Segment persistence table + CRUD | dynamic audiences | W4 | Tenant-scoped; RLS enforced |
| Topic-based audiences | ❌ | `interestProfile` | Segment predicate on affinity | topic affinity (W3) | W4 | Members share cited topic evidence |
| Persona audiences | ❌ | `companyIntelligence` roles, persona (W3) | Predicate on persona | G6 | W4 | Persona predicate explainable |
| Journey / stage audiences | ❌ | `decisionStage`, buying-stage (W1) | Predicate on stage | G3 | W4 | Stage membership auditable |
| Campaign audiences | ❌ | `campaignAttributionProjection` | Predicate on attribution | W1 | W4 | Attribution predicate reproducible |

**Ladder:** these begin **Manual** (analyst builds a filter) → **Assisted** (platform suggests segments from clusters) in W4.

### 1.5 Campaign Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Campaign builder | ◐ | existing `campaigns` domain, `campaignAiOrchestrator`, `campaignRecommendationService` | Lead-audience → campaign bridge | W4 segments | W5 | Campaign cites target segment + rationale |
| Audience selection | ❌ | W4 segments | Selection UI over segments | W4 | W5 | Selected audience is a saved segment (no ad-hoc fork) |
| Message recommendation | ◐ | content-gen spine (`unifiedContentGenerationEngine`, `campaignPromptBuilder`) | Message keyed to segment evidence | W3/W4 | W5 | Message cites audience interest evidence |
| Channel recommendation | ◐ | `leadActions.readiness` (channel readiness), `getPostablePlatforms*` | Channel choice from lead reachability | W1 | W5 | Channel choice explainable per lead |
| Campaign execution | ◐ | scheduler/BullMQ, `MultiPlatformScheduler`, publish pipeline | Lead-targeted execution path | W5 builder | W6 | Execution idempotent, tenant-safe |
| Performance tracking | ✅ | `form_conversions`, `campaign_touchpoints`, revenue-attribution route | Close loop to segment | — | W5 | Performance attributable to segment |
| Optimization | ❌ | recommendation engines, learning (W5 learning tables) | Optimization loop | performance tracking | W6 | Each change cites a measured delta |

### 1.6 Revenue Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Revenue attribution | ◐ | `/api/website-intelligence/revenue-attribution`, `lead_attributions` | Multi-touch models beyond `capture_snapshot` | G4 | W5 | Model choice explainable; per-touch credit auditable |
| Conversion prediction | ◐ | `leadIntelligence/conversionPredictionRepository`, System B predictive qualifier | Inbound conversion model grounded in evidence | W1 scores | W5 | Prediction cites contributing evidence |
| Opportunity prioritization | ◐ | `opportunityProjection`, `leadActions` priority | Unified priority queue | G3 | W5 | Priority order reproducible |
| Pipeline intelligence | ❌ | `crmProjection`, status model (W2) | Pipeline rollup | W2 status | W6 | Pipeline stage transitions audited |
| Forecasting | ❌ | conversion prediction + pipeline | Forecast engine | above | W6 | Forecast cites prediction inputs |

### 1.7 Autonomous GTM Intelligence

| Capability | Now | Reusable components | Missing | Dependencies | Wave | Certification |
|---|---|---|---|---|---|---|
| Recommended actions | ✅ | `leadActions.buildLeadActionPlan` | — (advisory only today) | — | W2 | Actions evidence-backed |
| Automated follow-ups | ❌ | action plan cadence, `runAiExecution`, schedulers | Execution engine (guardrailed) | W2 workflow, W5 | Each auto-action logged w/ evidence + reversible |
| Channel orchestration | ❌ | `MultiPlatformScheduler`, channel readiness | Orchestrator over channels | W5 | W6 | Orchestration decisions explainable |
| AI execution planning | ◐ | `runAiExecution` (billing-safe seam), `campaignAiOrchestrator` | Plan → execute bridge with approval gates | W5 | W6 | Plan shows evidence + guardrail state |
| Learning engine | ◐ | System B learning (`/api/active-leads/learning`), prediction engines | Inbound closed-loop learning | performance data | W6 | Learning inputs/outputs auditable |
| Closed-loop optimization | ❌ | all of the above | Feedback loop wiring | full stack | W6 | Loop measurable; auto-changes reversible + logged |

---

## 2. Gap Reclassification Matrix

LC-001 gaps `G1`–`G12` reclassified into the mandated categories, with complexity (S/M/L/XL), priority (P0 critical → P3), and wave.

| Gap | Category | Business impact | Technical impact | Dependencies | Reusable components | Complexity | Priority | Wave |
|---|---|---|---|---|---|---|---|---|
| **G1** abuse controls on capture | **Platform Integrity** | Spam/poisoned data, cost | Unbounded writes; limiter not distributed | Redis/Upstash | `checkInMemoryRateLimit`, `isLikelyBot` | M | **P0** | W1 |
| **G3** unscored website leads | **Prospect Intelligence** / Platform Integrity | High-intent leads look cold; list/detail disagree | Read-time score not materialized | — | `buildBuyingIntentProfile` | M | **P0** | W1 |
| **G4** dual tracking pipelines | **Visitor Intelligence** / Scalability | Fragmented behaviour signal | Divergent schemas, duplicate ingest | — | `tracking_events` spine (canonical target) | L | **P0** | W1 |
| **G8** adopt fire-and-forget / no backfill | **Platform Integrity** | Canonical row/timeline lags legacy | Incomplete provenance | — | read-union (fail-open), BullMQ | M | **P1** | W1 |
| **G9** silent side-effect failures | **Observability** | Invisible attribution loss | No DLQ/metric | HARDEN-001 seams | bounded-metrics, `telemetryDispatcher` | M | **P1** | W1 |
| **G2** read-only workspace | **Workflow** | Cannot operate leads; export-to-CRM only | Needs write endpoints + audit | — | `deleteLead`, `lead_intelligence_events`, `enforceCompanyAccess` | L | **P0** | W2 |
| **G10** no consent lifecycle / DSAR | **Compliance** | GDPR risk | No erase/suppression | — | RLS, `deleteLead`, `consent_state` | M | **P1** | W2 |
| **G7** "AI Summary" mislabel | **Prospect Intelligence** | Trust/labeling mismatch | Cosmetic + capability gap | — | `aiGateway`, `runAiExecution`, `ai/safety/*` | M | **P2** | W3 |
| **G5** no device/OS/geo | **Visitor Intelligence** | Weak segmentation, no geo routing | UA parse + geo lookup | — | `user_agent`/`ip_hash` captured | M | **P2** | W3 |
| **G6** no firmographic/contact enrichment | **Prospect Intelligence** | Sparse ICP/persona | Add enrichment port | — | `IngestionPorts`/`IdentityResolverPort`, `safeFetch` | L | **P1** | W3 |
| **G12** missing event types / split time-on-page | **Visitor Intelligence** / Observability | Incomplete engagement scoring | Extend event taxonomy | resolves w/ G4 | `tracking_events.event_category` | S | **P2** | W1 (rides G4) |
| **G11** WP plugin no native capture | **Workflow** / Scalability | WP onboarding friction | Manual SDK/webhook add | — | universal SDK, webhook handoff | M | **P3** | W2 |

**New program-level gaps surfaced by the capability mapping** (not lead-level defects, but roadmap prerequisites):

| Gap | Category | Description | Wave |
|---|---|---|---|
| **G13** | Audience Intelligence | No segment persistence layer; `LeadQuery` is ephemeral | W4 |
| **G14** | Campaign Intelligence | No lead-audience → campaign bridge (campaigns don't consume lead segments) | W5 |
| **G15** | Automation | No guardrailed execution engine for lead actions (action plans are advisory) | W5/W6 |
| **G16** | Revenue Intelligence | Attribution limited to `capture_snapshot`; no multi-touch model selection | W5 |

---

## 3. Engineering Wave Plan

Waves are derived from the audit's dependency reality, not the example template. **W1 is a hard prerequisite for everything** — you cannot build audiences, campaigns, or automation on scores that disagree with themselves (G3) or on a fragmented event store (G4).

### Wave 1 — Platform Integrity & Trustworthy Signal *(foundation; blocks all)*
**Theme:** make the data and the score trustworthy and consistent before anything consumes them.
- **Scoring consistency (G3):** materialize the deterministic `buyingIntent` score to a queryable field on the canonical lead so list, filter, sort, and detail agree.
- **Tracking unification (G4, G12):** converge `/api/track`→`blog_analytics` and `/api/website-events/track`→`tracking_events` onto the single `tracking_events` spine; extend the event taxonomy (downloads, search terms) rather than adding a store.
- **Capture abuse controls (G1):** distributed rate-limit + bot heuristic on `/api/website/lead-capture`, reusing `checkInMemoryRateLimit`/`isLikelyBot` patterns backed by Redis.
- **Canonical durability (G8):** backfill job + reconcile for `adoptLead` (BullMQ), so the canonical store never silently lags legacy.
- **Side-effect observability (G9):** bounded metrics + DLQ signal on attribution/touchpoint/adopt failures (HARDEN-001 seams).

**Autonomy target:** Manual → **Assisted** (scores/journeys now reliable enough to recommend).

### Wave 2 — Lead Workspace & Workflow *(operability)*
**Theme:** turn the read-only intelligence surface into a management product.
- **Workflow (G2):** status set, assignment, notes, bulk actions, delete — as write endpoints behind `enforceCompanyAccess`, audited to `lead_intelligence_events`. Extend `LeadListPanel`/`LeadProfileView`, not new pages.
- **Compliance (G10):** consent lifecycle, suppression list, DSAR erase — reusing RLS + `deleteLead`.
- **WP capture ergonomics (G11):** native capture bridge for WordPress via existing SDK/webhook handoff.

**Autonomy target:** **Assisted** (human approves each status/action) with the audit trail that later enables Semi-automation.

### Wave 3 — Prospect & Visitor Depth *(enrichment & grounded AI)*
**Theme:** deepen who the lead is and why, with evidence-grounded AI.
- **Enrichment (G6):** firmographic + contact enrichment via a new `IngestionPort` implementation (no capture-path change), provenance stored.
- **Grounded AI summaries (G7):** LLM summaries via `runAiExecution`, strictly grounded in the `EvidenceItem` set (explainability gate).
- **Technical visitor intel (G5):** UA parse + geo-from-hashed-IP at ingest, consent-gated.
- **Topic affinity / persona uplift:** promote keyword affinity toward learned affinity where evidence supports it.

**Autonomy target:** **Assisted → Semi-automated** for enrichment (auto-enrich within policy).

### Wave 4 — Audience Intelligence *(segmentation)*
**Theme:** persisted, re-evaluated, explainable segments over the unified scored leads.
- **Dynamic + saved segments (G13):** persist `LeadQuery` as a segment; re-evaluate membership; tenant-scoped.
- Topic / persona / journey-stage / campaign audiences as segment predicates over W1–W3 outputs.

**Autonomy target:** **Assisted** (platform suggests segments from clusters; analyst confirms).

### Wave 5 — Campaign & Revenue Intelligence *(activation)*
**Theme:** point campaigns at segments; attribute revenue with real models.
- **Campaign bridge (G14):** consume W4 segments as campaign audiences via existing `campaignAiOrchestrator`; message + channel recommendation grounded in segment evidence.
- **Multi-touch attribution (G16):** extend `lead_attributions` beyond `capture_snapshot`; explainable per-touch credit.
- **Conversion prediction / prioritization:** inbound models grounded in W1 evidence; unified priority queue.

**Autonomy target:** **Assisted → Semi-automated** (guardrailed campaign execution).

### Wave 6 — Autonomous GTM *(closed loop)*
**Theme:** execution engine + learning loop; the platform acts, measures, self-corrects.
- **Execution engine (G15):** guardrailed auto-follow-ups and channel orchestration via `runAiExecution` + schedulers; every action reversible, logged, evidence-backed.
- **Pipeline + forecasting:** rollups over W2 status + W5 predictions.
- **Closed-loop optimization:** wire performance → learning → next-action; auto-changes auditable.

**Autonomy target:** **Semi-automated → Fully automated** with human audit.

---

## 4. Reuse Matrix (per wave — what gets extended, never forked)

| Wave | Services | APIs | DB tables | UI | AI | Queues | Observability |
|---|---|---|---|---|---|---|---|
| **W1** | `leadCaptureService`, `attributionResolverService`, `leadIntelligenceReadService`, `leadIntelligenceRuntime` | `/api/website/lead-capture`, `/api/website-events/track`, `/api/lead-intelligence/*` | `leads`, `lead_intelligence`, `tracking_events`, `visitor_sessions` | `LeadListPanel` (score column) | `buildBuyingIntentProfile` (materialize) | BullMQ (`leadQueueHardening/Observability`) for backfill | HARDEN-001 metrics, `telemetryDispatcher` |
| **W2** | `leadService` (`deleteLead`), `userContextService` (`enforceCompanyAccess`) | `/api/lead-intelligence/*` (add write) | `lead_intelligence_events` (audit), `leads` (status) | `LeadListPanel`, `LeadProfileView`, `leadIntelligenceClient` | — | — | `lead_intelligence_events` as audit substrate |
| **W3** | `leadIntelligenceFacade`/`Ports`, `identityGateway` | enrichment via port (no new public route) | `lead_intelligence` (enrichment jsonb), `tracking_events` (device/geo) | `LeadProfileView` cards | `runAiExecution`, `ai/safety/*`, `aiGateway` | BullMQ (async enrich) | provenance on enriched fields |
| **W4** | `leadIntelligenceReadService`, `query.ts` | `/api/lead-intelligence/leads` (segment eval) | new segment table (persist `LeadQuery`) | `LeadListPanel` filters → save | — | scheduled re-eval (cron seam) | segment membership audit |
| **W5** | `campaignAiOrchestrator`, `campaignRecommendationService`, `unifiedContentGenerationEngine`, `leadAttributionService` | `campaigns/*`, revenue-attribution | `campaigns`, `campaign_touchpoints`, `lead_attributions`, `form_conversions` | `MultiPlatformScheduler`, `ConversionFunnelStrip` | `campaignPromptBuilder`, `runAiExecution` | scheduler/publish workers | revenue/perf dashboards |
| **W6** | `runAiExecution`, `recommendationScheduler`, `dailyIntelligenceScheduler`, System B learning | `/api/active-leads/learning` (extend) | prediction/learning tables (reuse System B) | action/exec surfaces | prediction engines, `leadActions` | BullMQ orchestration | closed-loop metrics, reversibility log |

**Drift guard (applies to all waves):** any PR that introduces a new lead writer, a second event store, a parallel scoring engine, a second identity map, or a duplicate AI pipeline **fails the Architecture gate** (§7) by definition.

---

## 5. Capability Dependency Graph

```
                         ┌───────────────────────────── FOUNDATIONS (exist today) ─────────────────────────────┐
                         │ leads write │ ensureUnifiedPerson │ tracking_events │ buyingIntent │ readService     │
                         └───────┬───────────────┬───────────────┬───────────────┬───────────────┬─────────────┘
                                 │               │               │               │               │
   ┌─────────────────────────────▼───────────────▼───────────────▼───────────────▼───────────────▼──────────────┐
   │  W1  PLATFORM INTEGRITY  (CRITICAL PATH ROOT — blocks everything downstream)                                 │
   │   G4 tracking-unify ─┐   G3 score-materialize ─┐   G1 abuse ─┐   G8 backfill ─┐   G9 observability           │
   └─────────┬────────────┴──────────┬──────────────┴─────┬───────┴───────┬────────┴──────────────────────────────┘
             │                       │                    │               │
   ┌─────────▼──────────┐  ┌─────────▼──────────┐         │               │
   │ W2 WORKFLOW        │  │ W3 PROSPECT/VISITOR│         │               │   (G1/G8/G9 are integrity leaves —
   │  G2 status/notes/  │  │  G6 enrichment     │         │               │    unblock trust, not features)
   │  assign/bulk       │  │  G7 grounded AI    │◄────────┘               │
   │  G10 compliance    │  │  G5 device/geo     │                         │
   │  G11 WP capture    │  └─────────┬──────────┘                         │
   └─────────┬──────────┘            │                                    │
             │        ┌──────────────▼─────────────┐                      │
             │        │ W4 AUDIENCE INTELLIGENCE    │                      │
             │        │  G13 segments (needs W1     │                      │
             │        │  scores + W3 persona/topic) │                      │
             │        └──────────────┬─────────────┘                      │
             │                       │                                    │
   ┌─────────▼───────────────────────▼─────────────┐                      │
   │ W5 CAMPAIGN + REVENUE INTELLIGENCE             │                      │
   │  G14 campaign bridge (needs W4 segments)       │                      │
   │  G16 multi-touch attribution (needs W1 events) │◄─────────────────────┘
   └───────────────────────┬───────────────────────┘
                           │
                 ┌─────────▼─────────┐
                 │ W6 AUTONOMOUS GTM │  needs: W2 status, W5 execution+perf, W3 grounded AI
                 │  G15 exec engine  │
                 │  closed loop      │
                 └───────────────────┘
```

**Reading the graph for multi-agent execution:**
- **W2 and W3 are siblings** — both depend only on W1, neither on each other. Two agent teams can run them in parallel after W1.
- **W4 depends on W1 (scores) + W3 (persona/topic predicates)** — starts when W3's topic/persona land, not the whole of W3.
- **W5 depends on W4 (segments) + W1 (event store for attribution)**.
- **W6 depends on W2 (status/audit) + W5 (execution + performance) + W3 (grounded AI)** — the true convergence point.

---

## 6. Critical Path & Parallelization

### 6.1 Critical path (longest blocking chain)
```
W1(G4 tracking-unify) → W1(G3 score-materialize) → W3(topic/persona) → W4(G13 segments) → W5(G14 campaign bridge) → W6(G15 execution loop)
```
G4 → G3 is the **root of the critical path**: a materialized score is only trustworthy on a unified event store. Everything an autonomous GTM system does traces back to these two. Schedule the strongest team here first.

### 6.2 Parallelization opportunities
| Can run concurrently | After | Why safe |
|---|---|---|
| W1 sub-tracks: G1 (abuse), G8 (backfill), G9 (observability) | immediately | Independent of G3/G4; different files, no shared write path |
| W2 (workflow) ‖ W3 (enrichment/AI/geo) | W1 complete | Sibling waves; disjoint zones (workspace-write vs ingestion-enrich) |
| W3 sub-tracks: G6 (enrichment) ‖ G5 (device/geo) ‖ G7 (AI summary) | W1 complete | Three disjoint ports/engines |
| W2 sub-tracks: G2 (workflow) ‖ G10 (compliance) ‖ G11 (WP) | W1 complete | Different surfaces |
| W5 sub-tracks: G16 (attribution) ‖ campaign-bridge scaffolding | W4 partial | Attribution rides W1 event store, not W4 |

### 6.3 Serialization constraints (do NOT parallelize)
- G3 must land **after** G4 (score on unified events).
- G14 (campaign bridge) must land **after** G13 (segments exist to point at).
- G15 (execution) must land **after** G2 (status/audit) and W5 performance (something to close the loop on).

---

## 7. Production Readiness Gates (objective exit criteria per wave)

Every wave must pass **all eight gates**. These are pass/fail, not aspirational.

| Gate | Objective criterion (applies every wave) |
|---|---|
| **Architecture** | No new lead writer / event store / scoring engine / identity map / AI pipeline. PR diff proves extension of a §0 spine. |
| **Reuse** | Each new capability names the reused component(s) it extends (traceable to LC-001 Reuse Inventory). |
| **Explainability** | Every AI/derived output ships an evidence/provenance trail; no ungrounded score, recommendation, journey, or summary. |
| **Security** | Tenant isolation preserved — `company_id` scope + RLS on every new table/endpoint; verified by a cross-tenant negative test. |
| **Backward compatibility** | No breaking change to existing capture/read contracts; additive columns/routes only. |
| **Observability** | New failure modes emit bounded metrics; no silent catch on a new write path (closes the G9 pattern going forward). |
| **Performance** | No measurable regression on capture latency or read `collectViews` (bulk, anti-N+1 preserved). |
| **Testing** | Regression suite green; new capability has unit + one tenant-isolation + one explainability assertion. |

### Wave-specific exit criteria (in addition to the eight gates)
- **W1:** list intent == detail intent for 100% of website leads; single event store serves journey/funnel; capture endpoint rejects >N/min per (tenant, ip); backfill reconciles legacy↔canonical to 0 drift; attribution failures visible in metrics.
- **W2:** status/assignment/notes/bulk/delete all write + audit to `lead_intelligence_events`; DSAR erase provably removes lead + sessions + attribution; no read-only regression.
- **W3:** every enriched field carries a provider provenance; AI summary cites only supplied evidence (adversarial ungrounded-claim test passes); device/geo consent-gated.
- **W4:** segment membership reproducible from stored predicate; re-evaluation deterministic; tenant-scoped negative test passes.
- **W5:** campaign target is a saved segment (no ad-hoc audience); attribution model selectable + per-touch credit auditable.
- **W6:** every autonomous action reversible + logged with its evidence; closed-loop change traces to a measured delta; kill-switch honored.

---

## 8. Engineering Risk Register

| Risk ID | Risk | Likelihood | Impact | Mitigation (reuse-first) | Owner wave |
|---|---|---|---|---|---|
| **R1** | Tracking unification (G4) silently drops/duplicates events during cutover | Med | High | Dual-write + reconcile window; `dedupe_key` unique index already exists; metric on divergence | W1 |
| **R2** | Score materialization (G3) diverges from read-time engine over time | Med | High | Single source: materialize by calling the SAME `buildBuyingIntentProfile`; snapshot test list==detail | W1 |
| **R3** | Backfill (G8) double-counts or violates idempotency | Low | High | Upsert on `(company_id, dedupe_key)` (already idempotent); dry-run + row-count assertion | W1 |
| **R4** | Workflow writes (G2) bypass tenant guard | Low | Critical | All writes behind `enforceCompanyAccess`; mandatory cross-tenant negative test (Security gate) | W2 |
| **R5** | AI summary (G7) emits ungrounded claims (trust theater returns) | Med | High | Hard explainability gate: summary input == evidence set; `ai/safety` moderation; adversarial test | W3 |
| **R6** | Enrichment provider (G6) SSRF / data leakage / cost blowout | Med | High | `safeFetch` (SSRF seam) only; fail-open; per-tenant budget via existing credit seam | W3 |
| **R7** | Segment re-evaluation (G13) becomes an N+1 / full-scan cost sink | Med | Med | Reuse bulk `collectViews` (anti-N+1); cap + scheduled eval, not per-request | W4 |
| **R8** | Autonomous execution (G15) acts wrongly at scale | Low | Critical | Autonomy ladder enforced: Semi-auto (guardrail+review) before Fully-auto; reversible + kill-switch | W6 |
| **R9** | Compliance erase (G10) misses a shard (sessions/attribution) | Med | High | Erase traverses FK graph (`lead_attributions`, `visitor_sessions`, `campaign_touchpoints`); verified by test | W2 |
| **R10** | Wave creep — features pulled forward onto unmaterialized scores | High | Med | Critical-path discipline: W4+ blocked until W1 exit criteria signed off | program |
| **R11** | Multi-agent PRs collide on shared files (`createLead`, `readService`) | Med | Med | Zone partitioning per §6.2; touch shared seams via additive params only; serialize G3-after-G4 | program |
| **R12** | Distributed rate-limit (G1) mis-scoped → blocks real traffic | Low | Med | Per-(tenant, ip) key; shadow-count before enforce; reuse existing limiter contract | W1 |

---

## 9. Master Implementation Roadmap (execution summary)

| Wave | Name | Gaps | Autonomy target | Blocks | Parallel with | Exit gate owner |
|---|---|---|---|---|---|---|
| **W1** | Platform Integrity & Trustworthy Signal | G1, G3, G4, G8, G9, G12 | Manual → Assisted | everything | internal sub-tracks | list==detail; unified events; metrics live |
| **W2** | Lead Workspace & Workflow | G2, G10, G11 | Assisted | W6 | W3 | writes audited; DSAR proven |
| **W3** | Prospect & Visitor Depth | G5, G6, G7 | Assisted → Semi | W4, W6 | W2 | enrichment + AI provenance |
| **W4** | Audience Intelligence | G13 | Assisted | W5 | — | reproducible segments |
| **W5** | Campaign & Revenue Intelligence | G14, G16 | Assisted → Semi | W6 | internal sub-tracks | segment-targeted campaigns; auditable attribution |
| **W6** | Autonomous GTM | G15 | Semi → Fully | — | — | reversible closed loop |

**Sequencing rule for every downstream implementation prompt:** cite the target capability from §1, the reused components from §4, the wave + exit gate from §7, and the risk(s) from §8 it must mitigate. A prompt that cannot name its reused component or its evidence trail does not pass intake.

---

## 10. Alignment check against Omnivyra architectural principles

| Principle | How this roadmap enforces it |
|---|---|
| Single source of truth | §0 names three spines; §7 Architecture gate fails any fork |
| Reuse before replacement | §4 Reuse Matrix per wave; §9 intake rule requires a named reused component |
| Explainable AI | Explainability is a hard gate (§0, §7); no capability advances past Manual without provenance |
| Additive evolution | Every wave is additive columns/routes/engines; Backward-compat gate (§7) |
| Zero architectural drift | Drift guard (§4) + Architecture gate (§7) + risk R11 zoning |
| Multi-agent implementation readiness | §5 graph + §6 parallelization define disjoint zones and serialization constraints |
| Production-first | Objective exit criteria (§7) + risk register (§8) gate every wave |

---

*This roadmap consumes the LC-001 baseline and produces the sequencing, reuse, and certification contract for all subsequent LEAD-INTELLIGENCE-001 implementation prompts. It defines no new architecture and prescribes no code.*

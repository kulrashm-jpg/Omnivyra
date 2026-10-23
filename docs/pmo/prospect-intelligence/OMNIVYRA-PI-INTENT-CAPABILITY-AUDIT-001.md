# OMNIVYRA-PI-INTENT-001 — existing-capability audit

**Read-only.** No product edit, schema change, migration, provider call, production access, commit, push or deployment. This document is the only file created.

| | |
|---|---|
| Repository | `C:/tmp/r1-ctx` |
| Branch | `fix/r1-profile-context` — **matches** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches** |
| Worktree at start and close | **126 entries (67 M / 59 ??), 0 staged** — identical to the WP-6 close state; nothing disturbed |
| Audit start | **2026-10-17T14:28:27+05:30** |
| External wait before start | 11 min 47 s (WP-6 close 14:16:40 → 14:28:27), tracked separately |
| Business objective under audit | discover buying opportunities from explicit **and indirect** evidence, **including when the person with the requirement is not identified** |

Prior-workstream claims confirmed from artefacts by hash rather than by re-running suites: `PI-MILESTONE-A-EXECUTION-001.md` `1ad1105accdd5866`, `i2l_intake_to_list.test.ts` `92a343c9e868200f`, `ti_authenticated_tenant_isolation.test.ts` `ab4376ed17277204`, `20261128000000_pi_canonical_write_atomicity.sql` `3ce166ae2cb894d5`. WP-2, WP-3 and WP-6 stand as reported.

---

## 1. Executive findings

**F-1 — Omnivyra already has TWO opportunity systems, and they are not connected.** This is the single most consequential finding and it reframes the whole objective.

| | **Community Discovery / Opportunity Feed** | **Prospect Intelligence (PI)** |
|---|---|---|
| Spine | `lead_signals` → `signal_intent_clusters` → `opportunity_feed_items` → `active_leads` → `contacts` | `source_records`/`source_assertions` → `unified_persons`/`prospect_accounts` → `canonical_leads` → `prospect_lists` |
| Strength | **intent classification, clustering over time, explanation, suggested next action, company+role resolution without a named person** | **canonical identity, dedup, provenance, arbitration, consent/suppression, tenant-safe composite keys, atomic writes** |
| Weakness | no canonical identity, no provenance/arbitration, no consent spine | **no opportunity or need representation at all** |

Neither is a subset of the other. The business objective is largely a **bridge** problem, not a new-intelligence problem.

**F-2 — Opportunity-first discovery (Path B) already exists — in the wrong stack.** `opportunityFeedService.ts:204-207` returns `{ resolved_company, resolved_role, identity_confidence: 'high' | 'medium' }`. A company and a buying role are resolved **without a named individual**, which is exactly the required capability. It is read-time projection, not canonical PI state.

**F-3 — Inferred roles are NOT stored as verified people.** Searched for any write of `resolved_role` into `unified_persons` or `contacts`: **none**. `resolved_company`/`resolved_role`/`suggested_next_action` are not columns in any migration — they are derived fields on `OpportunityFeedItem`. The specific risk §3 warns about does not exist today.

**F-4 — The company-event intelligence engine is complete and has NO producer.** `engines/buyingSignal.ts` interprets `funding, exec_change, leadership, hiring, expansion, acquisition, tech_migration, tech_adoption, product_launch, pricing_change, partnership, customer_announcement, analyst, filing, news, website_change, social, community` with per-type strength weights and half-lives, decay, source weighting, and abstention. **Nothing populates `ctx.signals`.** `prospectContext.ts` refuses the bridge explicitly and says why:

> *"`lead_signals` DOES NOT become `ctx.signals`. `RawSignal.type` is a closed buying-signal vocabulary (`hiring`, `funding`, `exec_change`, …) and `lead_signals.source_type` is only `engagement` or `listening`. There is no bridge between them, and choosing one would invent a buying signal the platform never observed."*

That refusal is correct engineering. The consequence is that **`buyingSignal` always abstains in production**, so external company events — the richest source of indirect demand — are the one genuinely missing *input*.

**F-5 — No classifier for explicit requirements, dissatisfaction or requests for alternatives on the PI side; a good one on the Community side.** `opportunityClassifierService.ts` is deterministic, explainable, AI-free, specificity-first, and classifies into eight types including `buying_intent`, `competitor_dissatisfaction`, `product_research`, `integration_need`, `support_frustration`, `hiring_signal`, `migration_signal`. PI has no equivalent and no need/opportunity entity.

**F-6 — The tenant's offering IS represented, far better than its absence from PI suggests.** `company_profiles` carries ~70 columns; `prospectIcp/generator/evidence.ts` reads a deliberately closed buyer-relevant subset of 29 fields, including `products_services_list`, `core_problem_statement`, `pain_symptoms`, `problem_impact`, `desired_transformation`, `competitive_advantages`, `target_customer_segment`, `geography_list`. Confidence and sparsity travel with it (`field_confidence`, `overall_confidence`, `user_locked_fields`, `presentCount`).

**F-7 — Product/service → demand matching does not exist anywhere.** The tenant knows what it sells; the classifier knows what a post is about. **Nothing joins them.** No component matches an observed need against `products_services_list` or `core_problem_statement`. This is the second genuine gap, and it is the one that decides *relevance*.

**F-8 — No human-approval boundary on recommended actions.** `engines/recommendation.ts` synthesises next-best action, message, channel and timing with a full reasoning trace. Searched `leadUnderstanding/**` and `opportunityFeedService.ts` for `requiresApproval|humanApproval|approval_required|needs_review`: **none**. Approval exists elsewhere in the platform (billing/credit approvals) but not on this path.

**F-9 — Evidence honesty is a genuine, pervasive strength.** Abstention rather than zero (`absence is never a score`), `reasoningTrace` carrying claim/conclusion/because/confidence/method/**assumptions**/**unknowns**, freshness decay, `contradiction.ts`, `explainability.ts`, and a `gaps` channel so refusals travel with the answer. WP-6 proved unsupplied attributes stay NULL and invented fields never reach canonical rows. This is the hardest part of the objective and it is already done.

---

## 2. Capability matrix

### 2.1 Tenant offering and ICP understanding (§1)

| Capability | Status | Evidence |
|---|---|---|
| Products and services | **IMPLEMENTED** | `company_profiles.products_services_list`; `PROFILE_EVIDENCE_FIELDS` |
| Problems solved | **IMPLEMENTED** | `core_problem_statement`, `pain_symptoms`, `problem_impact`, `awareness_gap` |
| Customer outcomes | **IMPLEMENTED** | `desired_transformation`, `transformation_mechanism`, `goals_list` |
| Target industries / org characteristics / geographies | **IMPLEMENTED** | `industry_list`, `category_list`, `target_audience_list`, `target_customer_segment`, `geography_list`; structured in `prospect_icps` over 15 account + 9 person attributes |
| ICP criteria | **IMPLEMENTED** | `prospect_icps`, `prospect_icp_versions`, `prospectIcp/{criteria,evaluate}.ts`; `OPS_BY_KIND` binds predicates to data kinds |
| **Disqualifiers** | **PARTIAL — by design** | `kind: 'mandatory'` *is* disqualifying (`evaluate.ts`: `mandatoryUnsatisfied ? 0 : satisfied/evaluable`). But negation predicates (`not_one_of`, `excludes`) are **deliberately refused**: `types.ts:26` — *"An exclusion is a different product decision — 'never approach these' is suppression, which `contact_governance_records` … already own. An ICP describes who you WANT."* So "exclude this industry" is **not expressible** |
| Buying roles | **IMPLEMENTED** | `BUYING_ROLES` in `prospectIdentity/attributes.ts`; `unified_persons.buying_role`, `authority`, `influence`; `MAPPABLE_BUYING_ROLES` in `prospectContext.ts` |
| Buying committees | **PARTIAL** | `engines/personaIcp.ts:55-58` infers `buyingCommitteeRole` from title keywords (confidence 0.7, assumption recorded); `engines/relationship.ts:41-44` computes `buyingCommittee` + `buying_committee_coverage` from `person_account_relationships`. **No committee entity**, no per-deal committee, no completeness target |
| Competitive alternatives | **PARTIAL — present, excluded by design** | `company_profiles.competitors`/`competitors_list` exist but are **excluded** from ICP evidence: *"`field_confidence.competitors` is routinely 'Low' and a competitor set is not a statement about the buyer"*. Classifier has `competitor_dissatisfaction` |
| Use cases | **MISSING** | No `use_cases` field in the evidence surface; `campaign_purpose_intent` and `authority_domains` are adjacent, not equivalent |
| Differentiators | **IMPLEMENTED** | `unique_value`, `competitive_advantages`, `brand_positioning`, `key_messages` |

### 2.2 Signal discovery and interpretation (§2)

"Registered" and "operational" are separated throughout.

| Signal category | Interpretation logic | Producer | Status |
|---|---|---|---|
| Explicit product/service requirement | `opportunityClassifierService` → `buying_intent` | listening pipeline (operational) | **IMPLEMENTED (Community stack)** |
| Dissatisfaction with suppliers/products | → `competitor_dissatisfaction`, `support_frustration` | same | **IMPLEMENTED (Community stack)** |
| Requests for alternatives / recommendations | → `product_research`, `integration_need` | same | **IMPLEMENTED (Community stack)** |
| Requests for **quotations / proposals / RFPs** | — | — | **MISSING** — no RFP/quote class in the eight-type vocabulary |
| Company expansion, new markets/facilities/products | `buyingSignal` types `expansion`, `product_launch` | **none** | **MISSING producer** |
| Leadership appointments | `exec_change`, `leadership` (weights 0.75/0.7, half-life 120d) | **none** | **MISSING producer** |
| Funding, acquisitions, restructuring | `funding` (0.9/180d), `acquisition` (0.8/180d), `filing` | **none** | **MISSING producer** |
| Hiring patterns, new functions | `hiring` (0.65/90d) + classifier `hiring_signal` | classifier yes; `buyingSignal` no | **PARTIAL** |
| Technology modernization | `tech_migration`, `tech_adoption` + classifier `migration_signal` | classifier yes; `buyingSignal` no | **PARTIAL** |
| Market posts, public discussion, social engagement | `lead_signals` (`source_type` = `engagement` \| `listening`) → intent engine as **behavioural** observations | `listeningSignalPipeline` + `communitySignalService` + `moderationGateService`, with dedup (`listening_signal_dedup`) | **IMPLEMENTED and runtime-connected** |
| Company announcements | `customer_announcement`, `news`, `website_change`, `analyst` | **none** | **MISSING producer** |
| CRM, manual, CSV | adapters + orchestrator | routes call `registerBuiltInLeadSources()` at module scope | **IMPLEMENTED AND REAL-SCHEMA VERIFIED** (WP-6, 27 tests) |
| **Combinations of signals over time** | `signal_intent_clusters` (`cluster_key`, `signal_count`, `first_seen_at`/`last_seen_at`, `avg_intent_score`, `avg_urgency_score`); `engines/{convergence,fusion,crossEngine}.ts`; freshness decay everywhere | `intentClusteringService` | **IMPLEMENTED (Community stack)** |

### 2.3 Canonical PI, enrichment and governance (§4)

| Stage | Status | Evidence |
|---|---|---|
| Evidence and provenance | **IMPLEMENTED AND VERIFIED** | `source_records`, `source_assertions`, `canonical_attribute_decisions`; WP-6 tests 2, 11, 19 |
| Company/account resolution | **IMPLEMENTED AND VERIFIED** | `prospectIdentity/accountResolution.ts`; WP-6 test 10 |
| Person identity resolution | **IMPLEMENTED AND VERIFIED** | `identityResolutionService.resolveUnifiedPerson` (sole resolve-or-create path); real-schema `p11_resolver_race`, `w3_w4_identity_contracts` |
| **Opportunity / need representation in PI** | **MISSING** | No need, requirement, opportunity or demand entity anywhere in the PI schema. `canonical_leads` has no need field |
| **Tenant product/service → demand matching** | **MISSING** | Nothing reads `products_services_list` against an observed need (F-7) |
| Enrichment and freshness | **PARTIAL / BLOCKED** | `enrichment/**` (27 modules), 13 named outcomes, `NON_CALLING_OUTCOMES`, spend ceiling; **no provider credential in any env file**; Apollo adapter supports **one** attribute (`employee_count`) |
| ICP fit, intent, confidence | **IMPLEMENTED, runtime UNVERIFIED** | `engines/prospectIcpFit.ts`, `intent.ts`, `qualification.ts`; `evaluate.ts` returns `'unknown'` for missing numerics; `scoreState: 'scored' \| 'abstained' \| 'unevaluated'`. Production flag state **UNVERIFIED** |
| Suppression and consent | **IMPLEMENTED AND VERIFIED** | `contact_governance_records` + `contactGovernance.mayContact` (pure, canonical); nine governance types; WP-6 tests 23–25 incl. tenant-scoping and a positive control |
| Deduplication | **IMPLEMENTED AND VERIFIED** | `personDuplicates.detectAndParkDuplicates` — **parks, never merges**; WP-6 tests 6, 9, 10 |
| List eligibility | **IMPLEMENTED AND VERIFIED** | `prospect_lists`/`prospect_list_members`; real-schema 27/27; WP-6 tests 26–27 |
| Recommended next action | **IMPLEMENTED (both stacks)** | `engines/recommendation.ts`; `OpportunityFeedItem.suggested_next_action` |
| **Human-approval boundary** | **MISSING** | No approval gate on either path (F-8) |

### 2.4 Source and provider reality (§5)

| Source | Classification | Evidence |
|---|---|---|
| **Manual** | **IMPLEMENTED AND RUNTIME-CONNECTED** | `pages/api/lead-ingestion/manual.ts:47` registers at module scope; WP-6 real-schema verified |
| **CSV** | **IMPLEMENTED AND RUNTIME-CONNECTED** | `csv.ts:44`; WP-6 verified incl. malformed and duplicate rows |
| **CRM** | **IMPLEMENTED AND RUNTIME-CONNECTED** | `crm.ts:44`; `externalId` required; WP-6 verified. Note: `crm` is a **namespace, not an integration** — `leadIngestion/index.ts` says so, and it is unrelated to `crmIngestionService`. A prior audit proved the legacy CRM path dormant in production |
| **Social / market posts / community** | **IMPLEMENTED AND RUNTIME-CONNECTED** | `listeningSignalPipeline` (moderation → normalize → dedup → score → write), `communitySignalService`, `listeningExecutionService`. **Scoring is keyword density, length and moderation flags — not meaning** |
| **MarketPulse** | **PARTIAL — read-only, no company subject** | `marketPulse/prospectIntelligence.ts` is read-only by contract; `marketPulseV2ServiceEngine.ts:492` writes `entities: []` as the **only** writer, and every `market_pulse_*` table keys on `company_id` = **the tenant**. There is no external company to ingest. `marketpulse_opportunity_intelligence` exists but is MarketPulse-internal |
| **Active Leads** | **PARTIAL — operational, disconnected from PI** | `active_leads` rolls up `opportunity_feed_items` via `active_lead_id`, keyed `(organization_id, contact_id, opportunity_type)`, subject `contact_id → contacts` (tenant-safe). **Zero PI intake references** — no `ingestLeadBatch`/`ingestSourceRecord`/`resolveOrCreateProspect` in any active-leads or opportunity service |
| **Sales Navigator** | **BLOCKED — external** | No adapter, no connector; SNAP is partner-only |
| **Apollo (enrichment)** | **BLOCKED — credentials** | Adapter registered; `APOLLO_SUPPORTED_ATTRIBUTES = ['employee_count']`; **no `APOLLO` entry in any env file** |
| **Apollo (discovery)** | **BLOCKED — registry empty** | Discovery provider registry ships empty by design; 2 of 15 ICP attributes translatable |
| **Clearbit** | **DECLARED ONLY** | Adapter registered; no credential; no operational verification |

**Declared vs operationally verified, for every provider: zero providers are operationally verified.** No provider call was made in this audit.

### 2.5 Tenant safety and evidence quality (§6)

| Control | Status | Evidence |
|---|---|---|
| Composite tenant-safe foreign keys | **IMPLEMENTED AND VERIFIED** | Cross-tenant writes proven *unconstructible* (`23503`) — WP-6 tests 16, 27 |
| Authenticated-role RLS isolation | **IMPLEMENTED AND VERIFIED (local only)** | WP-3, 26 tests, two real sessions. `canonical_leads` has tenant-predicate policies; nine other PI surfaces are `service_role`-only, i.e. **isolation by total denial** |
| **Production isolation** | **UNVERIFIED** | Not claimed. The disposable replay baseline is ACL-free, so WP-3 granted production-*shaped* privileges; production ACLs were never read. **`service_role` holds `BYPASSRLS` and the application connects as `service_role`, so RLS is not what isolates tenants on the live path** |
| Runtime access path vs DB policy | **DISTINGUISHED** | WP-3 test 23: `auth.role()` is a session GUC, so the service-role predicate is enforced by a *setting*, not by the connected role |
| Provenance | **IMPLEMENTED AND VERIFIED** | every canonical value traces to an assertion and a decision row |
| Freshness | **IMPLEMENTED** | per-signal half-lives; `RawObservation.observedAt` **required** — undated evidence is excluded, never back-dated |
| Confidence handling | **IMPLEMENTED** | `statedConfidence` returns null not zero; `field_confidence`/`overall_confidence`; `identity_confidence: 'high' \| 'medium'` |
| Source permissions | **PARTIAL** | per-tenant `lead_ingestion` flag plus a global `ENABLE_LEAD_INGESTION` kill switch; **production values UNVERIFIED** |
| Moderation | **IMPLEMENTED** | `moderationGateService` gates every listening signal before persistence |

### 2.6 Test coverage (§7)

| Capability | Real-schema | Doubles only | Untested |
|---|---|---|---|
| Manual/CSV/CRM intake → list | **`i2l_intake_to_list` 27/27** | `piList002IntakeToListE2E` (explicitly not DB-backed) | — |
| Canonical write atomicity | **`ca_canonical_write_atomicity` 21/21** | — | — |
| Authenticated tenant isolation | **`ti_authenticated_tenant_isolation` 26/26** | — | production ACLs |
| Identity/dedup/arbitration | **`p11_resolver_race`, `b1b_arbitration`, `li4c_person_duplicates`, `w3_w4_identity_contracts`** | — | — |
| Suppression/governance | **`li3_contact_governance`, `li3d_governance_writer`, i2l 23–25** | — | — |
| Prospect lists | **`pl_prospect_lists` 27/27** | — | list policy (OD-3/OD-4) |
| **Opportunity classifier** | **none** | unit only | real-schema behaviour |
| **Intent clustering** | **none** | unit only | clustering over real data |
| **leadUnderstanding engines** | **none** | unit only; `shadowRuntime.ts`/`shadowValidation.ts` suggest shadow operation | **production enablement entirely UNVERIFIED** |
| **buyingSignal engine** | **none meaningful** | abstains on empty context | **cannot be tested end to end — it has no producer** |

Full real-schema suite at WP-6 close: **37 suites, 835/835 tests**. Scoped PI unit: 240/243 suites with 2 known pre-existing failures (`boltExecutionRecovery.ts`; `pages/prospects/index.tsx:108`).

**Untested production assumptions:** that `LEAD_UNDERSTANDING_ENABLED` and the ingestion flags are on; that the listening pipeline runs on a schedule in production; that production ACLs match the shapes tested locally; that the four PI migrations are applied (`UNVERIFIED`, prior blocker).

---

## 3. Traced flows

### Flow 1 — Community Discovery (OPERATIONAL, opportunity-first, no canonical identity)

```
social/community platform
  -> listeningExecutionService / communitySignalService
  -> moderationGateService.evaluateModeration      (blocked content rejected here)
  -> normalize (platform, content, contact_key, metadata)
  -> listening_signal_dedup  (org + platform + content_hash)
  -> heuristic score (keyword density, length, moderation flags)   <-- NOT meaning
  -> canonicalLeadSignalService.writeLeadSignal    (sole writer)
  -> lead_signals  (source_type = engagement | listening)
  -> opportunityClassifierService.classifyOpportunity(content_text)
       8 types, specificity-first, deterministic, no AI
  -> intentClusteringService -> signal_intent_clusters   (signals over TIME)
  -> opportunityFeedService -> opportunity_feed_items
       opportunity_score / confidence_score / urgency_score
       detected_reason, matched_keywords, explanation, recommendation_context
       resolved_company, resolved_role, identity_confidence (high|medium)  <-- PATH B
  -> active_leads  (roll-up per organization_id + contact_id + opportunity_type)
  -> GET /api/active-leads/opportunities  (via legacyOpportunityCompat)
```

### Flow 2 — Prospect Intelligence (OPERATIONAL, canonical, no opportunity)

```
manual | csv | crm record
  -> registerBuiltInLeadSources()  (called by each route at module scope)
  -> adapter.translate(raw, batchTenant)       tenant OVERRIDDEN, never honoured from the record
  -> validateNormalizedRecord                  externalId required
  -> source_records (upsert) -> source_assertions (dedup by unique index)
  -> identityResolutionService.resolveUnifiedPerson
  -> accountResolution.resolveOrCreateAccount
  -> pi_apply_canonical_decisions   (atomic: canonical + decision + stamp)
  -> resolveOrCreateProspect -> canonical_leads
  -> detectAndParkDuplicates        (parks, never merges)
  -> contactGovernance.mayContact   (allowed | blocked | deferred)
  -> listProspects -> prospect_list_members
```

### Flow 3 — Lead understanding (IMPLEMENTED, partly starved, runtime UNVERIFIED)

```
canonical PI spine
  -> prospectContext.ts  (the ONLY builder of LeadIntelligenceContext)
       reads: readProspectEngagementIntelligence (WS-5),
              aggregateAccountIntelligence (WS-7),
              getRatifiedIcp (D1)
       populates: observations (behavioural), relationships, qualification, ratifiedIcp
       DOES NOT populate: ctx.signals          <-- deliberate refusal, F-4
  -> assembleLeadUnderstanding (synchronous, no I/O in any engine)
       intent / behavioral / relationship / personaIcp / qualification /
       prospectIcpFit / quality / convergence / fusion / crossEngine /
       predictive / strategic / prioritization / explainability / recommendation
       buyingSignal  ->  ALWAYS ABSTAINS (no signals)
  -> combineScores (single scoring authority)
  -> scoreEvaluationStore -> score_evaluations
  -> listProspects: scoreState = scored | abstained | unevaluated
```

### The break

```
   Flow 1  opportunity_feed_items / active_leads / contacts
              |
              |   *** NO BRIDGE ***   0 references to ingestLeadBatch,
              |   ingestSourceRecord, resolveOrCreateProspect or
              |   resolveUnifiedPerson in any opportunity/active-leads service
              v
   Flow 2  source_records / unified_persons / canonical_leads / prospect_lists
```

---

## 4. Evidence references

| Concern | Path / symbol |
|---|---|
| Opportunity classification | `backend/services/opportunityClassifierService.ts`; `opportunity_feed_items.opportunity_type` CHECK (8 values) in `supabase/migrations/20260518_phase4_community_discovery_opportunities.sql` |
| Opportunity feed write | `backend/services/opportunityFeedService.ts:406` (classify), `:489` (insert), `:204-207` (`resolved_company`/`resolved_role`/`identity_confidence`) |
| Intent clustering | `backend/services/intentClusteringService.ts:96-124`; `signal_intent_clusters` |
| Signal persistence | `backend/services/canonicalLeadSignalService.ts:361,389-390` (`upsert` on `organization_id,source_type,source_id`); `CanonicalLeadSignalSourceType = 'engagement' \| 'listening'` |
| Listening pipeline | `backend/services/listeningSignalPipeline.ts` (5-step order in its header); `moderation/moderationGateService.ts` |
| Buying-signal engine | `backend/services/leadUnderstanding/engines/buyingSignal.ts` — `SIGNAL_WEIGHT`, `SIGNAL_HALFLIFE`, `SIGNAL_KIND`; `RawSignal` at `engines/engineTypes.ts:23` |
| The deliberate non-bridge | `backend/services/leadUnderstanding/prospectContext.ts` header, refusals 1–3 |
| Buying committee | `engines/personaIcp.ts:55-58`; `engines/relationship.ts:41-44` |
| Recommendation | `engines/recommendation.ts` (LI-C207) |
| Tenant offering | `backend/services/prospectIcp/generator/evidence.ts` — `PROFILE_EVIDENCE_FIELDS` (29), `PROFILE_TRUST_FIELDS` (5) |
| ICP contract | `backend/services/prospectIcp/{types,criteria,evaluate}.ts`; `prospect_icps`, `prospect_icp_versions`; exclusion refusal at `types.ts:26` |
| Active Leads | `supabase/migrations/20260817_active_leads_object_model.sql` (header lines 5, 16, 22-24) |
| MarketPulse non-subject | `backend/services/marketPulse/prospectIntelligence.ts`; `backend/services/marketPulseV2ServiceEngine.ts:492` (`entities: []`) |
| Tenant override | `backend/services/leadIngestion/adapters/manualAdapter.ts:302` |
| Atomic canonical write | `supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql`; `prospectIdentity/ingestionBoundary.ts` |
| Governance | `prospectIdentity/contactGovernance.ts:213` (`mayContact`, pure); `contact_governance_records` |
| Legacy opportunity read | `backend/services/leadIntelligence/legacyOpportunityCompat.ts` |

---

## 5. Duplicate-model and architectural risks

| # | Risk | Severity | Detail |
|---|---|---|---|
| **R-1** | **Two opportunity models** | **HIGH** | Community Discovery and PI both represent "a lead worth pursuing" with different identity, provenance and governance. A prospect can exist in `active_leads`/`contacts` and in `canonical_leads`/`unified_persons` with no link, so consent recorded in `contact_governance_records` **does not govern the Active Leads path** |
| **R-2** | **Two person models** | **HIGH** | `contacts` (keyed `organization_id, platform, platform_user_id`) and `unified_persons` (the canonical spine). Dedup, erasure and suppression apply to one, not both |
| **R-3** | **Consent coverage gap** | **HIGH** | Follows from R-1/R-2 and is the compliance-relevant one: the Community path reaches a human without passing `mayContact` |
| **R-4** | A third, legacy generation | MEDIUM | `leadIntelligence/legacyOpportunityCompat.ts` preserves a byte-identical legacy contract; `marketpulse_opportunity_intelligence` is a fourth opportunity-ish store |
| **R-5** | Starved engine looks healthy | MEDIUM | `buyingSignal` abstaining is indistinguishable from "no signals today" unless `gaps` is read. A reader could conclude a company has no events when nothing can produce events |
| **R-6** | Keyword-density scoring read as intent | MEDIUM | The listening score is density/length/moderation; the *type* comes from the classifier. Conflating the two would treat a long post as a strong intent |
| **R-7** | Company event ≠ purchase intent | **LOW today, HIGH if F-4 is closed naively** | Currently safe only because no producer exists. `buyingSignal` already emits `opportunity` + `urgency` contributions and **no independent buying score**, which is the right shape — the risk is a future producer that mints intent from a funding round |
| **R-8** | RLS is not the live isolation control | MEDIUM | `service_role` holds `BYPASSRLS` and the app uses it; isolation is application + composite FKs. A leaked key has no DB backstop |
| **R-9** | Reason-loss on projection | LOW | `detected_reason`, `explanation`, `matched_keywords`, `reasoningTrace` are all preserved. The risk is only that nothing carries them **into** PI, because PI has nowhere to put them |

---

## 6. Direct-person vs opportunity-first coverage (§3)

| | **Path A — explicit person and need** | **Path B — opportunity first** |
|---|---|---|
| Person identified | **YES** — `contact_key`/`author_metadata` in the Community stack; full canonical identity in PI | **N/A by design** |
| Need expressed | **YES, Community stack only** — eight classified types with matched keywords and reason | **YES, Community stack only** — `resolved_company` + `resolved_role` + `identity_confidence` |
| Canonical identity for that person | **PARTIAL** — PI has it for manual/CSV/CRM; the Community path resolves to `contacts`, not `unified_persons` | **N/A** |
| Need representation in PI | **MISSING** | **MISSING** |
| Buying-role inference without a person | — | **IMPLEMENTED** (`resolved_role`, `personaIcp` title inference, `relationship` committee coverage) |
| Contact discovery from a company-level opportunity | — | **BLOCKED** — discovery provider registry empty, no credential, 2 of 15 ICP attributes translatable |
| Roles wrongly stored as verified people | **NO** (F-3) | **NO** (F-3) |
| Company event auto-treated as intent | **NO** (R-7) | **NO** — no producer exists |

**Verdict.** Path A is implemented end to end in the Community stack and canonically in PI, but the two halves are not the same records. Path B is implemented in the Community stack for **listening-derived** opportunities and entirely absent for **company-event-derived** ones, because of F-4. Neither path produces an auditable opportunity inside PI.

---

## 7. Tenant offering / ICP representation gaps

1. **Use cases — MISSING.** No field; nothing to match a described situation against.
2. **Exclusion criteria — not expressible.** A defensible decision (`types.ts:26`), but "never target this industry" currently has to be written as suppression per contact, which does not scale to a segment. **Owner decision, not a bug.**
3. **Problem/outcome language is free text.** `core_problem_statement`, `pain_symptoms`, `desired_transformation` are prose, so matching them to an observed need needs either embeddings or a curated vocabulary. There is no vocabulary and no embedding of these fields.
4. **No link from ICP criteria to products.** An ICP says *who*; `products_services_list` says *what we sell*. Nothing says *which product suits this buyer*.
5. **Sparse profiles.** `presentCount` exists as the sparsity signal, and a prior finding records that sparse profiles can receive a fabricated identity elsewhere in the platform — so sparsity must gate matching, not just report it.
6. **Buying committee has no entity.** Computed per scoring run from title keywords and relationships; nothing persists an agreed committee for an opportunity.

---

## 8. Enrichment and contact-discovery limitations

- **No enrichment provider is operationally verified. Zero.** No credential exists in any environment file for Apollo or Clearbit.
- Apollo enrichment covers **one attribute** (`employee_count`) through `organizations/enrich`. Even fully authorized, it cannot populate person attributes.
- Apollo **discovery** is implemented but `not_operational`: the provider registry ships empty, and only `person.job_title` and `person.seniority` of 15 ICP attributes are translatable.
- Sales Navigator: **no permitted integration exists**; buying the product grants no API access.
- Consequence for Path B: once a company-level opportunity is identified, **there is no authorized way to discover a real candidate contact**. Role *inference* works; contact *discovery* does not.
- Cost governance is in place ahead of need (spend ceiling in calls, `NON_CALLING_OUTCOMES` marking non-billable outcomes, 13 named outcomes) — so authorization is the only blocker, not safety.

---

## 9. The smallest set of changes that would enable the intended intelligence

Ordered by value per unit of risk. **No implementation was started.**

| # | Change | Why it is the smallest | Effort | Confidence |
|---|---|---|---|---|
| **C-1** | **An opportunity/need entity in PI**, anchored on account **and optionally** person, carrying `opportunity_type`, the classifier's `detected_reason`, `matched_keywords`, confidence, urgency, freshness and an evidence reference | Everything else already exists on one side or the other; this is the missing *noun*. It is what lets a need be canonical, governed and auditable, and it is where `explanation` lands so the reason survives | **5–8 d** | **MEDIUM-HIGH** — shape is clear, the open question is person-optional keying |
| **C-2** | **Bridge Community → PI**: route `opportunity_feed_items` through `ingestSourceRecord`/`resolveOrCreateProspect` so an opportunity's company and (where present) person become canonical, and the opportunity attaches to C-1 | Closes R-1, R-2 and **R-3 (consent)** in one change, and turns the existing Path B into a *governed* Path B. Reuses the boundary WP-6 proved | **6–10 d** | **MEDIUM** — `contacts` ↔ `unified_persons` reconciliation is the risk, and it must park rather than merge |
| **C-3** | **A company-event signal producer** feeding `ctx.signals` with real `RawSignal`s, from an authorized source, with provenance | Unblocks F-4 and the whole indirect-evidence objective. The interpretation layer, weights, half-lives and abstention already exist — only the producer is missing | **8–15 d** + **external dependency** | **LOW** — no authorized source is identified; MarketPulse cannot supply it |
| **C-4** | **Need → offering matching**: score an observed need against `products_services_list` / `core_problem_statement`, emitting a contribution with its own reasoning trace | Decides *relevance*, which is what makes an opportunity actionable rather than merely detected (F-7) | **5–8 d** | **MEDIUM** — needs an owner decision on vocabulary vs embeddings |
| **C-5** | **A human-approval boundary** before any recommended action leaves the system | Small, and the one control that makes the rest safe to switch on (F-8) | **2–3 d** | **HIGH** |
| **C-6** | **Add an RFP/quote-request class** to the classifier vocabulary | One enum value, one pattern group, one migration; highest-intent signal currently unclassified | **1–2 d** | **HIGH** |
| **C-7** | **Verify runtime enablement** of `LEAD_UNDERSTANDING_ENABLED`, the ingestion flags and the listening schedule | Zero build cost; today nobody can say whether the understanding layer runs at all | **0 d** + operator | **HIGH** |
| **C-8** | **A `use_cases` field** in the offering surface and evidence list | Completes the §1 gap, feeds C-4 | **1–2 d** | **MEDIUM-HIGH** |

**Deliberately NOT recommended:** a second canonical prospect/person/account/suppression/MarketPulse repository (forbidden and unnecessary — C-2 reuses the existing spine); minting intent from company events (R-7); negation predicates in ICP (an owner product decision, not a gap); and any provider workaround.

---

## 10. Dependencies, decisions and confidence

### Owner / operator decisions required

| ID | Decision | Blocks |
|---|---|---|
| **D-A** | **Is the Community Discovery stack the intended front end for opportunities, with PI as the canonical spine behind it — or should PI own classification too?** This single answer determines whether C-2 is a bridge or a migration | C-1, C-2 |
| **D-B** | **Person-optional opportunity keying**: may an opportunity exist against an account with no person? (Required for Path B; it is the design crux of C-1) | C-1 |
| **D-C** | **`contacts` ↔ `unified_persons` reconciliation policy**: link, park as duplicate candidates, or leave separate | C-2 |
| **D-D** | **Authorized source for company events** (funding/hiring/exec change). Without one, C-3 has no date | C-3 |
| **D-E** | **Need→offering matching method**: curated vocabulary or embeddings | C-4 |
| **D-F** | **Exclusion criteria**: keep ICP positive-only, or admit segment-level exclusion | §7 item 2 |
| **D-G** | Enrichment credential (carried forward, OD-7) | §8 |
| **OD-3 / OD-4 / OD-5** | List permissions, `added_via`, erasure residue — **still open**, still blocking WP-4/WP-5 | WP-4, WP-5 |
| **OD-8** | Tenant-predicate RLS (design track; the deciding question remains which read paths could run as `authenticated`) | — |

### Estimate confidence

HIGH for C-5, C-6, C-7; MEDIUM-HIGH for C-1, C-8; MEDIUM for C-2, C-4; **LOW for C-3**, because it depends on an unidentified external source. Every estimate is engineering effort only and **excludes external waiting time**. They are not comparable to the frozen human-engineer-day baseline, for the reason recorded in the execution ledger §9.7.

### Schedule impact

**No OVERRUN RISK, and no deadline moved.** This audit is read-only and consumed no WP-7 budget. The frozen Milestone A′ baseline stands at **2026-11-25**; WP-7's baseline (Tue 2026-11-17, 4.0 engineer-days) is **untouched and not expanded**. C-1…C-8 are **new scope beyond Milestone A′** and are not folded into any existing work package; adopting any of them is an owner decision with its own baseline.

---

## 11. Prioritized genuine gaps

Ranked by distance between the stated business objective and what the evidence supports. Items absent *by deliberate, documented design* are marked, because they are decisions rather than defects.

| Rank | Gap | Why it ranks here |
|---|---|---|
| **1** | **No opportunity/need entity in PI** | Both stacks can detect a need; neither can record one canonically. Every other gap is downstream of this |
| **2** | **Community Discovery is not connected to PI** — so consent, dedup and erasure do not govern it | The compliance-relevant gap (R-3), and the one where a real human can be contacted outside `mayContact` |
| **3** | **No producer for company-event signals** | The richest source of *indirect* demand. Interpretation is complete; the input does not exist. Blocked on D-D |
| **4** | **No need → offering matching** | Without it, detection cannot become relevance |
| **5** | **No authorized contact discovery** | Path B can infer a role but never reach a person. Blocked on authorization, not engineering |
| **6** | **No human-approval boundary** | Cheap to add and it gates the risk of everything above |
| **7** | **Runtime enablement of the understanding layer UNVERIFIED** | The engines may be entirely dark in production; nobody can currently say |
| **8** | **No RFP/quote-request class** | Highest-intent signal, unclassified, one enum away |
| **9** | **Buying committee has no entity** | Recomputed per run; nothing agreed or persisted |
| **10** | **No use-case representation** | Blocks precise matching |
| **11** | Production tenant isolation **UNVERIFIED**, and `BYPASSRLS` means RLS is not the live control | Carried forward; local isolation is proven, production is not |
| **12** | Four PI migrations **UNVERIFIED** in production | Carried forward; pre-existing blocker |
| — | Exclusion predicates in ICP | **By design** (`types.ts:26`) — owner decision D-F |
| — | MarketPulse as a prospect source | **Not possible** as built: no external-company subject exists |
| — | Competitors excluded from ICP evidence | **By design** — low confidence, and not a statement about the buyer |

**Closing note.** The gap between this platform and the stated objective is narrower than a surface reading suggests, and it is concentrated in *joins*, not *intelligence*: a need entity, a bridge, a producer, and a matcher. The hardest parts — honest abstention, provenance, freshness, confidence, reasoning traces, consent and tenant safety — are already built and, for PI, verified against a real schema.

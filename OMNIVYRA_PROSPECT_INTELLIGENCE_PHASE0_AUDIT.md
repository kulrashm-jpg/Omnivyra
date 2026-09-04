# OMNIVYRA — Prospect Intelligence & Multi-Channel Engagement
## Master Architecture Audit — Phase 0

**Status:** AUDIT ONLY. No code written, no schema changed, no repository or database modified.
**Audit date:** 2026-08-12
**Scope of evidence:** repository `c:\virality` @ branch `main`, HEAD `d15f00ab`.
**Surface inspected:** 646 `CREATE TABLE` statements across 379 files in `supabase/migrations/`, 312 loose `.sql` files in `database/`, 1,183 files under `backend/services/`, 1,312 API route files under `pages/api/`.

> **Verification boundary — read this first.** Every finding below is derived from source in the repository. Production database state could **not** be verified: the Supabase MCP connector did not attach during this session, and `scripts/verify-schema-parity.js` fails against the live project (`information_schema` is not exposed to `service_role`). Wherever this report says a table "exists", it means *a definition exists in the repository*. Whether it is applied in production is an open BLOCKER (§35, B-1). This distinction matters most for the 312 unversioned `database/*.sql` files — including the entire WhatsApp schema.

---

# 1. Executive Summary

**Omnivyra can evolve into the target Prospect Intelligence & Engagement Orchestration architecture without a rewrite, and without creating a parallel lead database — but not without first resolving a canonical-ownership decision that the codebase has deferred five separate times.**

The platform already contains, in production-grade form, the three hardest components of the target architecture:

1. **A governed, provider-abstracted, append-only execution runtime** (`backend/services/leadOutreachExecution/`, "WS-3") that implements exactly the policy-enforcement model §13 and §26 demand: a five-gate governance engine evaluated in a frozen order, restrictive-by-default tenant enablement, DB-enforced immutable audit, two orthogonal outcome axes, deterministic provider idempotency keys, and a transport registry through which no channel can become sendable by import side effect. This is unusually well-built and is the single most valuable asset for this program.
2. **A tenant-scoped identity spine** (`unified_persons` + `unified_touchpoints`) already back-referenced from `canonical_leads`, `canonical_users`, `contacts`, `engagement_threads`, and `canonical_revenue_events`.
3. **A mature credit/usage economy** (`creditExecutionService*`, ~46 typed `CreditAction`s, hold→settle semantics) that new prospect operations can be priced into rather than around.

The blocking problem is **not capability. It is canonicality.** There are **six** concurrent representations of "a lead/person" and **two mutually contradictory suppression systems**. Specifically, `suppression_entries.company_id` defaults to the literal `'__global__'` with `scope IN ('global','tenant')` — a **platform-global DNC**, which §34 of the target brief explicitly forbids — while WS-3's `outreach_suppressions` is strictly tenant-scoped and append-only. Both are live definitions. Any Phase 1 that ships before this is resolved will produce cross-tenant suppression semantics that are extremely expensive to unwind after real contact data accumulates.

Three target capabilities are **genuinely absent**, not partial:

- **Account (company-as-prospect) entity — MISSING.** `companies` is the *tenant*. There is no third-party account entity anywhere. The closest artifact, `buyer_intent_accounts`, is an org-scoped social-author rollup with no FK, no domain, and no contact linkage. The target `Tenant → Account → Prospect` hierarchy has no Account level today.
- **Phone / voice — MISSING.** Zero telephony implementation. No Twilio/Vapi/Retell/Plivo/Exotel integration in non-test code. `voice_per_minute` exists as a `CreditAction` with no producer. The planner *recommends* a `phone` channel it cannot execute.
- **Contact-fatigue policy (quiet hours, cooldown, cross-channel frequency) — MISSING.** Zero occurrences of quiet-hours logic repo-wide. WS-3 provides only `daily_limit_tenant` / `daily_limit_lead`.

Marketing email is also **absent as distinct from transactional email**: `email_jobs` is constrained to `job_type IN ('magic_link','invite','reset')`, has **no tenant column at all**, and `email_events` tracks only pipeline states (`queued…dead_lettered`) — no `opened`, `clicked`, `bounced`, `unsubscribed`, and no inbound provider webhook.

WhatsApp is the pleasant surprise: **inbound and outbound both genuinely work**, with HMAC-verified webhooks, BullMQ dedup by payload hash, tenant resolution via `social_accounts.phone_number_id → company_id`, a durable two-layer rate limiter, and template versioning. Its weakness is governance, not capability — it bypasses the WS-3 policy engine entirely.

**Verdict: PROCEED, with a Phase 0.5 canonicalisation gate before any Phase 1 implementation.** Recommended minimum safe Phase 1 is read-only and additive: promote `unified_persons` to the canonical Prospect spine, introduce the missing Account entity, unify suppression under the tenant-scoped WS-3 model, and route **every** channel — including the already-live WhatsApp path — through the WS-3 governance engine. No new discovery, no new enrichment vendor, no phone, no marketing email in Phase 1.

---

# 2. Current Architecture Map

| Layer | Location | Notes |
|---|---|---|
| Web / API | `pages/api/**` (1,312 routes), Next.js Pages Router | Deployed to Vercel project `omnivyra` |
| Route factory | `lib/platform/routeFactory.ts` | Wraps handlers; used inconsistently |
| Tenant guards | `backend/security/TenantGuard.ts`, `backend/security/withTenantGuard.ts` | 518 files reference a guard helper |
| Services | `backend/services/**` (1,183 files) | Dominant business-logic layer |
| DB access | `backend/db/supabaseClient.ts` (**service-role, bypasses RLS**), `backend/db/writeOwner.ts` → `ownedDbTable()` | Single privileged client |
| Queues | `backend/queue/**` — BullMQ over Upstash Redis | Worker topology manifest; backpressure via `safeEnqueue` |
| Workers | Railway service `authentic-nature/Omnivyra` | Deploys from GitHub `main` |
| Scheduler / cron | `backend/scheduler/`, `backend/schedulers/`, `Dockerfile.cron` | |
| AI | `backend/services/aiGateway*.ts` (10 files) + `backend/services/ai/{safety,grounding}` | ~103 consumers; single egress seam |
| Credits | `backend/services/creditExecutionService*.ts` + ~35 credit services | hold → settle |
| Observability | `backend/observability/`, HARDEN-001 bounded metric registry | |
| Extension | `pages/api/extension/**` (12 routes), `modules/extension/`, `backend/services/rpaWorker/` (15 files) | Lease-based command dispatch |
| Migrations | `supabase/migrations/` (379 files) **and** `database/*.sql` (312 files, ungoverned) | See §24 — this is a real risk |

**Egress seams (single-chokepoint, verified):** AI → `aiGateway`; outbound HTTP → `lib/security/safeFetch` (SSRF gate `check:ssrf`); DB writes → `ownedDbTable`; HTML → `htmlSanitizer.ts`.

---

# 3. Current Prospect/Lead Architecture

There is no single prospect architecture. There are **six** lead/person representations, each with its own key, owner and lifecycle.

| # | Model | Definition | Key | Tenant col | What it actually is |
|---|---|---|---|---|---|
| 1 | `leads` | `database/leads.sql:20` | `id` | `company_id` | **Form-capture submissions.** name/email/phone/source/form_id. The only model with a real email+phone. Not in `supabase/migrations/`. |
| 2 | `contacts` | `supabase/migrations/20260419_contacts_spine.sql` | `(organization_id, platform, platform_user_id)` | `organization_id` | **Social identity only.** No email, no phone, no account link. |
| 3 | `active_leads` | `20260817_active_leads_object_model.sql` | `(organization_id, contact_id, opportunity_type)` | `organization_id` | **Social-listening lead workspace.** Rollup of `opportunity_feed_items`. Its own header comment documents the naming collision with `leads`. |
| 4 | `canonical_leads` | `20260409_canonical_intelligence_model.sql` | `id`, FK→`canonical_users` | `company_id` | **Analytics canonical model.** Only `source` + `qualification_score`. |
| 5 | `lead_intelligence` | `20260629000000_lead_intelligence_store.sql` | `(company_id, dedupe_key)` | `company_id` (**text**) | **Ingestion/dedup store.** JSONB scores/identity/attribution/campaign. Links to `unified_person_id` (**text**, not FK). |
| 6 | `lead_intelligence_profiles` | `20260907000000_lead_intelligence_profiles.sql` | `(company_id, lead_id)` | `company_id` (**text**) | **Generated intelligence envelope** (INT-001 Phase 4). Its header explicitly says it is a new table *because* reusing `lead_intelligence` would corrupt the read-union. |

Plus `unified_persons` (`20260621_unified_person_identity_spine.sql`) — a genuine identity spine with `primary_email`, `primary_phone`, `external_keys JSONB`, `company_id UUID` FK — which **all** of the above except `leads` and `active_leads` already point at.

**Canonical source of truth today: none.** `unified_persons` is the *designed* spine but is optional (`unified_person_id` nullable everywhere) and, on the `lead_intelligence*` side, is stored as untyped `text` with no foreign key.

**Type inconsistency is systemic:** `company_id` is `UUID` in models 1–4 and `text` in models 5–6, and `text` throughout every WS-3 table. Any unification must resolve this.

**The runtime lead pipeline (INT-001 / WS-2)** — `backend/services/leadIntelligenceEngine/` (14 modules: `pageClassifier`, `personaEngine`, `intentEngine`, `qualificationEngine`, `segmentationEngine`, `timelineEngine`, `evolutionEngine`, `recommendationEngine`, `snapshotAssembler`) — is driven by **own-site visitor sessions**, not by outbound prospecting. It produces a snapshot → persona → qualification → `qualificationPlanning/` (channel recommendations, outreach plan) → WS-3 execution. This is a *complete inbound* lifecycle. The target architecture's `DISCOVER → RESOLVE → ENRICH` outbound front-half has no equivalent.

---

# 4. Existing Capabilities — Reusable

| Capability | Location | State | Reuse verdict |
|---|---|---|---|
| Outreach execution runtime | `backend/services/leadOutreachExecution/` (22 modules, M0–M7 complete) | EXISTS | **Reuse as-is. This is the target execution layer.** |
| Governance/policy engine | `leadOutreachExecution/governance.ts` | EXISTS | **Reuse. Extend with fatigue/quiet-hours gates.** |
| Transport registry | `leadOutreachExecution/transport.ts`, `transportRegistry.ts` | EXISTS | **Reuse. This is the channel-provider abstraction §21 asks for.** |
| Identity spine | `unified_persons`, `unified_person_merges`, `unified_touchpoints` | PARTIAL | **Promote to canonical.** |
| Credit economy | `creditExecutionService*`, `CreditAction` (46 actions) | EXISTS | **Reuse. Add actions; never fork.** |
| AI gateway + safety | `aiGateway*`, `ai/safety/`, `ai/grounding/`, `aiRequestGuard.ts` | EXISTS | **Reuse for all extraction/scoring/generation.** |
| Company enrichment providers | `companyIntelligence/providers/` + 6 vendor adapters incl. Apollo | EXISTS (dormant) | **Reuse the pattern; extend to person-level.** |
| Engagement ingestion + threads | `engagement*Service.ts` (37 services), `engagement_threads/messages/authors` | EXISTS | **Reuse as the interaction substrate.** |
| WhatsApp in/out | `whatsappBroadcastService`, `whatsappTemplateService`, `whatsappRateLimiter`, webhook processor | EXISTS | **Reuse; must be brought under WS-3 governance.** |
| Extension command bus | `pages/api/extension/commands.ts` + `modules/extension/` | EXISTS | **Reuse as an RPA transport.** |
| Attribution capture | `attribution_handoffs` (HMAC nonce, DB-unique replay defence), `unified_touchpoints` | EXISTS | **Reuse for cross-channel attribution.** |
| Public capture page | `pages/capture/[id].tsx` | EXISTS | **Reuse as the pattern for the WhatsApp CTA page.** |
| Tenant guard | `withTenantGuard`, `enforceCompanyAccess`, `scripts/check-tenant-authz.js` gate | EXISTS | **Reuse unchanged.** |
| Observability registry | HARDEN-001 bounded metrics | EXISTS | **Reuse; no new monitoring stack.** |

---

# 5. Duplicate Systems

| Duplication | Instances | Severity | Disposition |
|---|---|---|---|
| **Lead/person entity** | `leads`, `contacts`, `active_leads`, `canonical_leads`, `lead_intelligence`, `lead_intelligence_profiles` | **CRITICAL** | Pick `unified_persons` as spine; the six become sources/projections. |
| **Suppression / DNC** | `suppression_entries` (**global scope allowed**) vs `outreach_suppressions` (tenant-only, append-only) | **CRITICAL** | Retire `suppression_entries`' global scope; WS-3 model wins. |
| **Kill switch** | `GLOBAL_AUTOMATION_DISABLED` (community), `outreach_governance_config.kill_switch` + global (WS-3), `execution_controls` (default-OFF layered) | HIGH | Three switches, three places to look during an incident. |
| **Rate limiting** | `whatsappRateLimiter` (2-layer durable), WS-3 quota (2-layer durable), community `DEFAULT_DAILY_LIMIT`, in-memory ingress limiter | HIGH | Same proven pattern implemented ≥3 times. |
| **Qualification engine** | `leadIntelligenceEngine/qualificationEngine.ts`, `qualificationPlanning/qualificationEngine.ts`, `leadUnderstanding/engines/qualification.ts`, `qualificationIntelligence/`, `competitor/qualification/` | HIGH | Five. See §11. |
| **Intent engine** | `leadIntelligenceEngine/intentEngine.ts`, `leadUnderstanding/engines/intent.ts`, `intentIntelligence/`, `intentIntelligenceService.ts`, `buyerIntentIntelligenceService.ts`, `intentClusteringService.ts` | HIGH | Six. |
| **Event store** | `domain_events`, `canonical_events`, `telemetry_events`, `webhook_events`, `engagement_thread_events`, `lead_intelligence_events`, `post_events`, `email_events`, `decision_events`, `free_credit_events`, `tracking_events` | MEDIUM | No unified bus. See §13. |
| **Schema location** | `supabase/migrations/` (379) vs `database/` (312) | HIGH | Two schema sources; one ungoverned. |
| **Outreach plan artifact** | `outreach_tasks` (WS-3) vs `outreach_plans` vs decommissioned `lead_outreach_plans` | MEDIUM | Already adjudicated in `docs/WS3-ARCHITECTURE.md` §5–6. Honour it. |

---

# 6. Data Model Assessment

**Target vs. actual:**

| Target node | Status | Evidence |
|---|---|---|
| Tenant | **EXISTS** | `companies` + `user_company_roles` |
| **Account (prospect company)** | **MISSING** | No third-party company entity. `companies` = tenant. `buyer_intent_accounts` is a social-author rollup with `organization_id UUID NOT NULL` but **no FK**, no domain, no contact link. |
| Prospect/Contact | **DUPLICATED** | Six models, §3 |
| Sources | **PARTIAL** | `lead_intelligence.source`, `canonical_leads.source`, `active_leads.source_platforms[]` — three shapes, no provenance record |
| Enrichment | **PARTIAL** | Company-level only (`company_context_enrichment_runs`, `competitor_enrichment_cache`); no person-level |
| Signals | **EXISTS** | `lead_signals`, `marketpulse_signals`, `competitor_signals`, `website_intelligence_signals`, `scheduling_intelligence_signals` |
| Scores | **DUPLICATED** | §11 |
| Memory | **PARTIAL/MISSING** | §12 |
| Events | **DUPLICATED** | §13 |
| Campaigns | **EXISTS** | `campaigns` + ~25 campaign_* tables — but content/social-publishing campaigns, not outreach sequences |
| Tasks | **EXISTS** | `outreach_tasks` (WS-3) — the strongest node in the model |
| Consent | **MISPURPOSED** | `consent_records.capability IN ('publish','listen','monitor_competitors','ingest_*')` — **tenant's consent to operate a platform integration**, not a prospect's consent to be contacted |
| Suppression | **CONFLICTING** | §5 |
| Engagement | **EXISTS** | `engagement_threads/messages/authors` + 37 services |

**Structural defects to carry into any target design:**

- `engagement_threads.organization_id` is **nullable with no FK**; `engagement_messages` has **no tenant column at all** — tenant scoping is by join through `thread_id` only.
- `contacts` has no email/phone/account — it cannot represent a prospect.
- `unified_persons.external_keys` is a free-form JSONB object with no shape constraint beyond `jsonb_typeof = 'object'`; there is no normalized-domain, LinkedIn-URN or E.164 column.
- `social_accounts` is `user_id`-anchored (`database/clean-unified-schema.sql:18`); `company_id` was added later by index-only migrations. The WhatsApp inbound path reads `social_accounts.company_id` — correct in practice, but the tenancy of that table is an accident of history, not a declared constraint.

---

# 7. Tenant Security Assessment — **CRITICAL**

**The model:** all backend DB access goes through one **service-role** Supabase client that *bypasses RLS* (`backend/db/supabaseClient.ts:6` — "Uses service role key (bypasses RLS)"). Tenant isolation is therefore **entirely application-enforced**.

**RLS measurement:**
- 646 `CREATE TABLE` statements in migrations; **168 distinct tables** have `ENABLE ROW LEVEL SECURITY`.
- 151 `CREATE POLICY` statements. **96 mention `service_role`. Exactly 4 use `auth.uid()`.**

RLS is therefore **not a second line of defence** — it is a formality that grants the one client that matters full access. If an application-layer tenant filter is omitted, nothing below it stops the query.

**Application-layer enforcement is measured and gated, but has known debt:**

```
scripts/check-tenant-authz.js →
  scanned: 1312 API route files
  grandfathered debt (baseline): 49
  currently matching pattern: 47
  RESULT: PASS — no NEW tenant-authz violations
```

47 routes still carry accepted tenant-authz debt. The gate prevents regression; it does not clear the backlog.

**Per-surface verdict against §4 of the brief:**

| Surface | Isolation | Verdict |
|---|---|---|
| accounts | n/a — entity missing | **MISSING** |
| contacts / prospects | `organization_id`/`company_id` present; app-enforced | PARTIAL |
| enrichment | company-scoped | PARTIAL |
| memory | no store | MISSING |
| events | mixed; `domain_events.company_id` **nullable** | PARTIAL |
| transcripts | none | MISSING |
| email | **`email_jobs` has NO tenant column** | **MISSING** |
| phone | none | MISSING |
| WhatsApp | resolved via `social_accounts.phone_number_id → company_id` | EXISTS |
| campaigns | `company_id` | EXISTS |
| **DNC** | **`suppression_entries` permits `scope='global'`, `company_id='__global__'`** | **CONFLICTING — violates the brief** |
| consent | org-scoped but wrong domain (§6) | MISPURPOSED |
| analytics | `company_id` | EXISTS |
| exports | 8 export routes; per-route guard | PARTIAL |
| AI context | `resolveCompanyGroundingGuard` exists (uncommitted per program memory) | PARTIAL |
| caches | `aiResponseCache`, `competitor_enrichment_cache`, `image_search_cache`, `domain_eligibility_cache` — **key-scoping not verified** | **UNKNOWN — must audit before Phase 1** |
| queues | BullMQ jobs carry tenant in payload; **no queue-level tenant partition** | PARTIAL |
| background jobs | per-job | PARTIAL |
| RPA | `rpa_sessions` unique on `(organization_id, platform)` | EXISTS |
| integrations | `integration_credentials`, `api_provider_accounts` | PARTIAL |

**Cross-tenant risk ranking:** (1) global DNC scope; (2) `engagement_messages` with no tenant column; (3) unverified cache key scoping; (4) 47 grandfathered routes; (5) RLS as decoration.

---

# 8. Identity & Deduplication Assessment

| Requirement | Status | Evidence |
|---|---|---|
| Account identity | **MISSING** | No account entity |
| Contact identity | PARTIAL | `unified_persons` (email/phone/external_keys), optional everywhere |
| Normalized domains | PARTIAL | `canonical_domains`, `company_domains`, `analytics_competitor_domains` exist — but for the **tenant's own** and competitor domains, not prospect accounts |
| LinkedIn identifiers | PARTIAL | `contacts.platform_user_id` where `platform='linkedin'`; `clearbit.linkedinHandle` in enrichment mapping; **no canonical URN column** |
| Email identifier | PARTIAL | `unified_persons.primary_email` — `CHECK (length(btrim(...)) > 0)` only; **no normalization, no lowercase constraint, no unique index** |
| Phone identifier | PARTIAL | `unified_persons.primary_phone` — **no E.164 normalization** |
| Duplicate detection | PARTIAL | `lead_intelligence.dedupe_key` unique per company; `listening_signal_dedup`; `duplicateIntentDetector` |
| Merge logic | PARTIAL | `unified_person_merges` table exists |
| Conflict resolution | MISSING | No precedence/conflict model for person fields |
| Historical preservation | PARTIAL | Strong in WS-3 (append-only triggers); absent elsewhere |
| Provenance | PARTIAL | Enrichment adapters carry per-field confidence + `asOf`; person records do not |

**Do multiple sources currently create duplicates? Yes, structurally and by design.** The same human arriving via a form (`leads`), a LinkedIn comment (`contacts` → `active_leads`), a website session (`lead_intelligence`) and a WhatsApp message (`engagement_threads`) produces **four rows in four tables with four keys**. `unified_persons` can link them but is nullable, unenforced, and typed inconsistently (`uuid` vs `text`) across the two halves of the platform. Nothing forces resolution.

---

# 9. Enrichment Assessment

**Current architecture — `backend/services/companyIntelligence/providers/`:** `contract.ts`, `registry.ts`, `orchestrator.ts`, `cache.ts`, `adapters/vendorAdapter.ts`, `adapters/index.ts`.

Six vendor adapters exist (Clearbit, **Apollo**, BuiltWith, + 3 more), each declaring `id`, `credentialEnv`, `host`, `capabilities[]`, `precedence`, `buildRequest`, `mapResponse`. `createVendorAdapter` supplies, generically: no-credential short-circuit, **SSRF-pinned egress**, status-code classification, never-throw, never-fabricate. Per-field output carries `(value, confidence, asOf)`.

The adapters' own header states: *"NONE OF THESE IS CONFIGURED IN ANY ENVIRONMENT TODAY. They register, report `no_credential`, and cost nothing until a key exists."*

| §7 requirement | Status |
|---|---|
| Field-level enrichment | **EXISTS** — `field(name, value, confidence, asOf)` |
| Provider selection | **EXISTS** — capability + `precedence` |
| Provider fallback | **EXISTS** — orchestrator |
| AI provider selection | MISSING — precedence is static |
| Freshness | PARTIAL — `asOf` per field; no refresh scheduler |
| Confidence | **EXISTS** — per field, per vendor |
| Verification | MISSING — no email/phone verification provider |
| Cost | MISSING — enrichment is not a `CreditAction` |
| Retry | PARTIAL — status classification, no policy |
| Rate limiting | MISSING at provider level |
| Partial enrichment | **EXISTS** |
| Enrichment history | PARTIAL — `company_context_enrichment_runs` (company only) |

**Verdict: the enrichment abstraction is genuinely good and Apollo is correctly NOT a domain dependency** — it is one adapter among six, behind a contract, with an honest confidence rating (the header explicitly notes Apollo's headcount is self-reported and rated lower than Clearbit's). **The gap is scope: it enriches companies, not people.** There is no `PersonEnrichmentProvider`, no email/phone verification port, and no cost/credit integration.

---

# 10. Readiness Engine Assessment — **MISSING**

There is **no** mutually-exclusive prospect readiness classifier.

What exists and must not be confused with it:
- `readinessScoreService.ts`, `customer_readiness_snapshots`, `commandCenterReadinessService.ts` — these classify the **tenant's own onboarding/activation readiness**, a different domain entirely.
- `campaign_readiness_leads` — a runtime contract table.
- `active_leads.status` — an 8-value **workflow** state (`new…dismissed`), user-owned, not derived.

The §8 categories (Excluded/DNC → Email Required → Phone Required → Contact Required → Company Required → Other → Ready) have **no implementation, no priority resolver, and no tenant-configurable ordering**. The inputs mostly exist (suppression tables, `unified_persons.primary_email/phone`, account entity would be new); the classifier does not.

This is a **greenfield build** — which is good news: it can be built correctly (single evaluator, first-match-wins, no double counting) without unwinding anything.

---

# 11. Scoring Assessment

**Target: six independent axes.** Actual:

| Axis | Status | Where |
|---|---|---|
| ICP / Fit | **DUPLICATED** | `leadUnderstanding/engines/personaIcp.ts`, `qualificationPlanning/companyFitEngine.ts`, `qualificationPlanning/behavioralFitEngine.ts`, `active_leads.icp_score` |
| Intent | **DUPLICATED ×6** | `leadIntelligenceEngine/intentEngine.ts`, `leadUnderstanding/engines/intent.ts`, `intentIntelligenceService.ts`, `intentIntelligence/`, `buyerIntentIntelligenceService.ts`, `intentClusteringService.ts`; stored in `active_leads.intent_score`, `buyer_intent_accounts.intent_score`, `signal_intent_clusters` |
| Engagement | EXISTS | `engagementScoreService.ts`, `leadThreadScoring.ts`, `engagementPriorityService.ts` |
| Opportunity / Priority | EXISTS | `active_leads.total_score`, `opportunity_feed_items`, `creditPriorityEngine.ts`, `decisionScoringService.ts` |
| Data Confidence | PARTIAL | Per-field in enrichment adapters; `active_leads.confidence_score`; **no person-level rollup** |
| Source Quality | PARTIAL | `marketpulse_signals.source_credibility`, `source_health_states`; **not applied to prospects** |

**Conflicting scales are a live defect:** `active_leads` constrains all four scores to `0–1` (`active_leads_score_bounds_check`); `canonical_leads.qualification_score` is constrained to `0–100`; `marketpulse_signals` scores are `NUMERIC(5,2)` on a 0–100 basis. Three numeric conventions for conceptually similar quantities.

**Five qualification engines exist.** `docs/` contains 20+ `LEAD-THREAD-CLAIM-*` correction documents, which is itself evidence of repeated rework in this area.

---

# 12. Prospect Memory Assessment — **MISSING** (the substrate is PARTIAL)

There is no structured prospect memory store. Nothing holds business context / needs / pain points / tools / competitors / preferences / objections / decision maker / commitments / timing / qualification / compliance state **per prospect**.

What exists:
- `brand_memory`, `content_memory`, `learning_memory`, `campaign_learnings`, `marketpulse_decision_memory` — all **tenant-side** memory.
- `lead_intelligence_profiles.intelligence JSONB` — a generated envelope keyed `(company_id, lead_id)`. **This is the closest existing structure** and is the natural home, but its contents are engine-derived and regenerated from a fingerprint, not accumulated facts.
- `companyKnowledgeGraph` / `CompanyUnderstanding` — a genuinely sophisticated evidence+confidence+provenance model, but scoped to the **tenant's own company** and competitors.

**Critically, the §10 requirement that every extracted fact retain `(source, evidence, confidence, timestamp, tenant)` has an excellent precedent in this codebase** — the `CompanyUnderstanding` spine and the enrichment `field()` helper both do exactly this. Prospect memory should be built by **applying that existing pattern to a new subject**, not by inventing a new one.

---

# 13. Event Architecture Assessment

**There is no unified event bus.** There are 11+ event tables (§5) and an in-process publisher set (`backend/events/listeningEvents*.ts`, 6 files) that is listening-domain-specific.

| §22 property | Status | Evidence |
|---|---|---|
| Tenant-scoped | PARTIAL | `canonical_events.company_id NOT NULL` ✅; `domain_events.company_id` **NULL-able** ❌; `email_events` **no tenant** ❌ |
| Immutable | PARTIAL | Strong where it matters most: WS-3's five audit tables have DB triggers (`ws3_reject_mutation`) that refuse any UPDATE/DELETE. Elsewhere, convention only. |
| Idempotent | PARTIAL | Excellent instances — WhatsApp webhook `jobId = sha256(rawBody)`; `attribution_handoffs UNIQUE(company_id, token_nonce)`; WS-3 `buildIdempotencyKey` (sha256 of identity, no clock/random); `api_idempotency_keys`. No general rule. |
| Provider-aware | PARTIAL | WS-3 attempts record provider; `webhook_events` generic |
| Auditable | PARTIAL | WS-3 yes; general no |
| Traceable | PARTIAL | `correlation_id` on `email_events`; trace continuity tests exist |
| Replayable | PARTIAL | `replay_operations`, `replay_partitions`, `replay_payloads`, `replay_lead_receipts` exist |

WS-3 defines the canonical outcome event `lead.outreach.outcome.recorded` with at-least-once semantics, per-task ordering only, additive-only evolution, and idempotency key `(company_id, task_id, outcome_type, occurred_at)`. **This is the correct contract shape and should be the template for the target event model** — but it currently exists as a WS-3-local convention, not a platform bus.

---

# 14. Email Assessment — **PARTIAL, effectively MISSING for outreach**

| Component | State | Evidence |
|---|---|---|
| Provider | AWS SES via Supabase Edge Function `send-transactional-email` | `emailService.ts:16` |
| Provider abstraction | **EXISTS in WS-3 only** — `EmailProviderPort { name, send() }` | `leadOutreachExecution/emailTransport.ts` |
| `email_jobs` | `job_type IN ('magic_link','invite','reset')`, **no tenant column** | `20260420_hardening_auth_email_invites.sql` |
| `email_events` | `queued/claimed/sending/sent/failed/retried/dead_lettered` — pipeline only | `20260639_email_jobs_async_invite_pipeline.sql` |
| Outreach send path | WS-3 email transport, **default OFF** behind `LEAD_OUTREACH_EMAIL_ENABLED` | `emailTransport.ts:30` |
| Message content | **PLACEHOLDER** — subject/body derived from `task.action` / `task.explanation` | `emailTransport.ts` header; WS-4 is the designated content owner |

**Against the §14 target lifecycle** (selection → campaign → execution → events → AI interpretation → prospect update):

| Event | Status |
|---|---|
| sent | PARTIAL — recorded as `sent_unverified` (correctly: acceptance ≠ delivery) |
| delivered | **MISSING** — no provider webhook |
| opened | **MISSING** — no tracking pixel; WS-3 explicitly marks it unobservable |
| clicked | **MISSING** — no link rewriting |
| replied | **MISSING** — no inbound mailbox |
| bounced | **MISSING** — no SES SNS handler |
| unsubscribed | **MISSING** — no unsubscribe endpoint or List-Unsubscribe header |
| failed | EXISTS |

The absence of bounce and unsubscribe handling is a **compliance blocker**, not a feature gap: `suppression_entries.reason` already enumerates `'unsubscribe'` and `'bounce'` and nothing writes them.

---

# 15. Phone / AI Agent Assessment — **MISSING**

Zero implementation. Verified by repo-wide search for `twilio|vapi|retell|bland\.ai|elevenlabs|plivo|exotel` across `**/*.ts(x)` excluding `node_modules`: **only two hits, both in test/script files** (`ws3Milestone*.test.ts` mentions of channel names, `scripts/audit-github-identity-impact.ts`).

- No transcript storage, no call record, no agent assignment, no outcome ingestion.
- `voice_per_minute` exists as a `CreditAction` (10 credits) with **no producer**.
- `qualificationPlanning/channelIntelligence.ts` **recommends** `phone` at confidence 0.5–0.7 when a phone number is present — a recommendation the platform cannot execute.
- WS-3's channel table classifies Phone as *"Manual only — transport: none."*

**Positive:** because WS-3 dispatch is transport-registry-driven, adding a `CallingProvider` is genuinely a plug-in — register a transport for `channel='phone'`, and governance/quota/attempts/evidence/outcome all apply unchanged. **Deferred, not blocked.**

---

# 16. WhatsApp Assessment — **EXISTS (the strongest existing channel), UNGOVERNED**

| §16 question | Answer | Evidence |
|---|---|---|
| Current API | **Meta Cloud API** (`graph.facebook.com`) | `whatsappBroadcastService.ts:279` |
| Webhook | **EXISTS, HMAC-SHA256 verified**, `timingSafeEqual`, prod-fails-closed if `WHATSAPP_APP_SECRET` unset | `pages/api/whatsapp/webhook/index.ts` |
| Async processing | Enqueued to BullMQ `whatsapp-webhook`, `jobId = 'wa-webhook-' + sha256(rawBody)` → replay-safe | same file |
| Tenant mapping | `social_accounts.phone_number_id → company_id` | `whatsappWebhookProcessor.ts:93-94` |
| WABA mapping | `social_accounts.waba_id`, `business_account_id`, `messaging_tier`, `quality_rating` | `database/whatsapp_system.sql:13-22` |
| Phone-number mapping | `social_accounts.phone_number_id`, `display_phone` | same |
| Templates | `whatsapp_templates` — versioned, `is_active`, `template_category`, `language_code`, `components JSONB` | same |
| Inbound | **EXISTS** — upserts `engagement_threads` on `(platform, platform_thread_id, organization_id)`, inserts `engagement_messages` | `whatsappWebhookProcessor.ts:102-129` |
| Outbound | **EXISTS** — `whatsappBroadcastService` + `whatsappBroadcastProcessor` | 402 + 37 lines |
| 24h session window | **EXISTS** — `engagement_threads.window_open`, `window_expires_at` + partial index | `whatsapp_system.sql:28-36` |
| Rate limiting | **EXISTS** — durable two-layer | `whatsappRateLimiter.ts` (202 lines) |
| Events | PARTIAL — `direction`, `status`, `status_at` on messages | |
| Attribution | **MISSING** — no campaign linkage on threads | |
| AI integration | PARTIAL — `engagementConversationIntelligenceService` classifies messages generically | |
| Compliance / DNC | **MISSING** — the WhatsApp send path does not consult **either** suppression table | |
| Campaign integration | PARTIAL — `whatsapp_broadcasts` exists; not linked to `campaigns` | |
| API routes | 5 (`/broadcasts`, `/broadcasts/[id]`, `/templates`, `/webhook`, `/analytics/whatsapp/broadcasts`) | |

**Two findings dominate:**

1. **Governance bypass — HIGH.** WhatsApp outbound reaches real people today, entirely outside the WS-3 policy engine. Neither `outreach_suppressions` nor `suppression_entries` is consulted; the WS-3 kill switch does not stop it. This is the single most urgent remediation in the entire audit and is **independent of the target program** — it applies to the platform as it exists.
2. **Schema is unversioned — HIGH.** `whatsapp_templates`, `whatsapp_broadcasts` and the `social_accounts`/`engagement_*` column additions live **only** in `database/whatsapp_system.sql`, which is not in `supabase/migrations/`. Production applicability is unverified (§35 B-1).

WhatsApp is *not* registered in the WS-3 transport registry — deliberately. Its header states WhatsApp "remain[s] undispatchable without the dispatcher knowing they exist." That is correct WS-3 discipline; it just means the live WhatsApp path runs on a parallel, ungoverned rail.

---

# 17. Campaign / CTA Landing Assessment — **PARTIAL (pattern exists)**

The brief forbids per-tenant applications and requires `tenant + campaign + token → dynamic experience → WhatsApp CTA → conversation → attribution`.

**What exists:**
- `pages/capture/[id].tsx` — a **public, unauthenticated, server-rendered, brand-configurable** landing page resolved by id from `lib/server/leadService`. Tenant/brand come from the form record. **This is exactly the right pattern**, at form granularity rather than campaign granularity.
- `attribution_handoffs` — HMAC token nonce, `UNIQUE(company_id, token_nonce)` giving provable exactly-once handoff, plus `expires_at`, `verified_at`, `tampered`.
- `external_landing_pages` (provider + `attribution_param`, default `_attr`) and `embedded_form_lineage` — registration of third-party pages/forms for attribution.
- `lead_capture_topologies` — per-company capture topology with a partial unique index enforcing one active row.
- Client-side attribution capture in `capture/[id].tsx` (`getAttribution()`: UTM params, anonymous id, landing page in sessionStorage).

**What's missing:** a campaign-scoped route (`/c/[token]` or `/go/[campaign]/[token]`), a WhatsApp click-to-chat CTA (`wa.me` / `https://api.whatsapp.com/send?phone=…&text=…` with a tracking preamble), and the join from an inbound WhatsApp thread back to the campaign that produced it.

**Verdict: no new application is needed.** One additional dynamic route reusing `attribution_handoffs` + the `capture/[id]` SSR pattern satisfies §17. The genuinely new work is the **inbound correlation**: matching an arriving WhatsApp message to the CTA token that generated it (conventionally via a message-prefill token echoed in the first message body).

---

# 18. Campaign Attribution Assessment — **PARTIAL**

| Hop | Status |
|---|---|
| Source → Campaign | EXISTS — `campaign_touchpoints`, `lead_attributions`, `attribution_summary_cache` |
| Campaign → Content | EXISTS — `campaign_topic_map`, `content` ↔ campaign |
| Content → CTA | PARTIAL — `form_conversions`, `attribution_handoffs` |
| CTA → Channel | **MISSING** for WhatsApp |
| Channel → Conversation | **MISSING** — `engagement_threads` has no campaign FK |
| Conversation → Opportunity | PARTIAL — `opportunity_feed_items`, `active_leads` |
| Opportunity → Conversion | EXISTS — `canonical_conversions`, `canonical_revenue_events` |

`unified_touchpoints` is the correct cross-channel spine: `(company_id, unified_person_id, source, touchpoint_type, reference_table, reference_id, occurred_at)` with a uniqueness constraint on the reference. **It can already represent every journey in §18** — Email→WhatsApp, MarketPulse→Email, Social→WhatsApp — provided each channel writes a touchpoint. Today, coverage of writers is sparse and `unified_person_id` is nullable.

---

# 19. Content Generation Assessment — **EXISTS for social/blog, MISSING for outreach**

Substantial infrastructure: `backend/services/content/` runtime with `taskPolicyRegistry`, `generationRuntime`, `canonicalPersistencePolicy`, `campaignUniquenessGuard`, `publicationLineageService`; `content_type`, `content_variant`, `content_asset`, `content_block`, `platform_content_slots`; creator/render pipeline (`creator_render_*`, ~20 tables) for images/infographics/video.

| §19 target | Status |
|---|---|
| Social / posts / stories | **EXISTS** |
| Images / infographics | **EXISTS** — creator render pipeline |
| Blog | **EXISTS** |
| Email (outreach body) | **MISSING** — WS-3 uses placeholders; `docs/WS4-BOUNDARY.md` designates WS-4 as the owner, unbuilt for this path |
| WhatsApp templates | PARTIAL — `whatsapp_templates` stores components; nothing generates them |
| WhatsApp-compatible media | PARTIAL — creator pipeline could produce; no WhatsApp format target |
| Phone scripts | **MISSING** |
| Campaign-specific personalization | PARTIAL — campaign content yes; **per-prospect personalization no** |

The insertion point is explicitly designed and documented: `EmailProviderRequest.subject` / `.body` in `emailTransport.ts` are marked *"THE WS-4 INSERTION POINT … the ONLY place generated content enters this runtime."* Content generation must produce those strings **before** dispatch and must never call the transport, dispatcher, governance or approval.

---

# 20. Analytics Assessment — **PARTIAL**

| §20 requirement | Status | Evidence |
|---|---|---|
| A. Prospect KPIs | PARTIAL | `active_leads` aggregates; no unified prospect count |
| B. Mutually-exclusive Readiness | **MISSING** | §10 |
| C. Funnel | PARTIAL | `campaign_analytics_daily`, `form_performance_daily`, `canonical_conversions` |
| D. Source performance | PARTIAL | `canonical_leads(company_id, source, created_at)` index; `lead_attributions` |
| E. Enrichment performance | **MISSING** | No enrichment metrics |
| F. Email performance | **MISSING** | No open/click/bounce data to report |
| G. Phone/Agent performance | **MISSING** | No channel |
| H. WhatsApp performance | PARTIAL | `pages/api/analytics/whatsapp/broadcasts.ts` — broadcast-level only |
| I. Cross-channel attribution | PARTIAL | `unified_touchpoints` capable; sparsely written |
| J. AI executive insights | **EXISTS** | `marketpulse_executive_overviews`, `marketPulseExecutiveExperienceService`, `investigation_ai_summaries` |
| K. Next-best-action | PARTIAL | `qualificationPlanning/recommendedActions.ts`, `intelligence_recommendations`, `decision_priority_queue` |

**"All readiness categories must reconcile" cannot be satisfied today** because no readiness taxonomy exists. Once built, reconciliation is straightforward only if the classifier is the single writer — which argues strongly for a materialized, derived, first-match-wins classification rather than per-view recomputation.

---

# 21. Provider Abstraction Assessment

| Provider port | Status | Location |
|---|---|---|
| DiscoveryProvider | **MISSING** | — |
| EnrichmentProvider | **EXISTS (company-level)** | `companyIntelligence/providers/contract.ts` + registry + 6 adapters |
| VerificationProvider | **MISSING** | — |
| EmailProvider | **EXISTS** | `EmailProviderPort` in `leadOutreachExecution/emailTransport.ts` |
| CallingProvider | **MISSING** | — |
| WhatsAppProvider | **MISSING as a port** — Meta Cloud API called directly | `whatsappBroadcastService.ts:279` `fetch(META_GRAPH/…)` |
| SocialProvider | **EXISTS** | `backend/services/platformAdapters/` (incl. `whatsappAdapter.ts` for *publishing*) |
| AutomationProvider | **EXISTS** | Extension command bus + `rpaWorker/` |
| AIProvider | **EXISTS** | `aiGateway*` — 103 consumers, one egress seam |

**Two strong, independent abstraction patterns already exist** — the enrichment `createVendorAdapter` and the WS-3 `OutreachTransport` registry. The target architecture needs no new abstraction *style*; it needs the missing ports written in these two existing styles.

**Vendor lock-in risk is concentrated in exactly one place: WhatsApp**, which calls Meta Graph directly with no port.

---

# 22. RPA / Extension Assessment — **EXISTS, well-architected**

| §31 question | Finding |
|---|---|
| Capabilities | LinkedIn/social actions: `reply_comment`, `like_message`, `continue_thread`, `create_post`, `open_thread`, `search_user`, `start_new_dm`, `sync_dm_inbox`, `sync_comments_inbox` |
| API vs RPA split | **Correct.** Business logic in Omnivyra; extension executes. `resolveEngagementCapability` gates every `(platform, action)` pair; unsupported pairs are never emitted |
| Authentication | `requireExtensionAuth`; per-session `hmacNonce`; sessions without one are rejected `401 SESSION_MISSING_HMAC_NONCE` |
| Tenant context | `(userId, orgId)` from session; lease holder = `sha256("lease-holder:" + userId:orgId:hmacNonce)` |
| Authorization | Capability map + `COMMAND_SCHEMA_VERSION` payload validation, both **before** the CAS claim |
| Version safety | `x-omnivyra-capability-version` mismatch → `409 CAPABILITY_VERSION_MISMATCH` |
| Event reporting | `/api/extension/action-result`, `/events`, `/events/dms`, `/events/comments` |
| Failure handling | `extensionReliabilityService.isCurrentlyDisabled`, `rpa_retry_queue`, `creator_dead_letter_jobs` |
| Retry | 90s lease TTL > 30s handler timeout + retries; only the same holder may submit a result |
| Audit | `creator_audit_log`, `rpa_artifacts`, `integration_activity_events` |
| Sessions | `rpa_sessions` — `storage_state JSONB` (browser cookies/tokens), `UNIQUE(organization_id, platform)` |

**Notable correctness detail:** validation runs *before* the compare-and-set claim, so a permanently-invalid row is not claimed-and-dropped every 90-second cycle. This is the kind of care the target program should preserve.

**Risk:** `rpa_sessions.storage_state` holds live authenticated browser sessions for tenants. RLS is enabled on the table, but the service-role client bypasses it (§7). Encryption-at-rest for this column is not evident in the migration.

---

# 23. Credit / Usage Assessment — **EXISTS, reuse mandatory**

`CreditAction` is a 46-value union (`backend/services/creditDeductionService.ts`) spanning `ai_reply`, `content_generation`, `lead_detection`, `lead_qualification`, `lead_predictive_scoring`, `voice_per_minute`, `image_generation`, `video_generation`, and more. `creditExecutionServiceRuntimeEntry.ts` exposes `executeWithEntryConsumption` with fixed / LLM / token-metered variants, `planEntryConsumptionSettlement`, and hold→settle semantics.

| §24 target op | Credit coverage |
|---|---|
| Enrichment | **MISSING** — no action |
| Verification | **MISSING** |
| AI extraction | PARTIAL — via generic AI actions |
| AI scoring | PARTIAL — `lead_predictive_scoring`, `lead_qualification` |
| AI selection | **MISSING** |
| AI generation | **EXISTS** |
| Voice | **DEFINED, no producer** (`voice_per_minute`) |
| WhatsApp | **MISSING** — broadcasts consume no credits |
| RPA | **MISSING** |

**Do not create parallel billing.** The correct move is additive `CreditAction` values plus `credit_cost_config` catalog rows — the existing pattern already used for the Phase-2 §C.4 and lead-capture batches. Note the standing operational caveat from prior programs: `ENTRY_CONSUMPTION` is **HELD** in production and the activity-economy catalog (migration `20260822`) is **unapplied** — new actions must be planned against that reality.

---

# 24. Data Quality / Freshness Assessment — **PARTIAL**

| §23 field property | Status |
|---|---|
| value | EXISTS |
| source | PARTIAL — enrichment adapters yes; person records no |
| confidence | PARTIAL — enrichment + `CompanyUnderstanding` yes; prospects no |
| last verified | PARTIAL — `rpa_sessions.last_verified_at`, `attribution_handoffs.verified_at`; not on prospect fields |
| freshness | PARTIAL — `marketpulse_signals.freshness_score`; `crawl/refreshPolicyEngine.ts` |
| next refresh | PARTIAL — `crawl/refreshPolicyConfig.ts`; `lead_intelligence_profiles.rebuild_requested_at` |

**Schema governance is the dominant data-quality risk.** 312 `.sql` files live in `database/` outside `supabase/migrations/`, including `leads.sql`, `whatsapp_system.sql`, `engagement_unified_model.sql`, `buyer_intent_accounts.sql`, `clean-unified-schema.sql` — i.e. **several of the tables most central to this program are defined outside migration governance**, with unverifiable production state. Prior program notes also record 157/316 date-prefix PK collisions breaking local migration replay.

---

# 25. Risks — Top 10

| # | Risk | Sev | Why |
|---|---|---|---|
| R1 | **Platform-global DNC** (`suppression_entries.scope='global'`, `company_id='__global__'`) | **CRITICAL** | Directly violates §34. Tenant A's suppression can silence Tenant B's outreach; conversely a "global" release lifts suppression across tenants. Unwinding after real data accumulates is near-impossible. |
| R2 | **WhatsApp sends bypass all governance** | **CRITICAL** | A live, real-person channel with no suppression check and no kill switch. Compliance exposure today, before this program starts. |
| R3 | **Six lead models, no canonical owner** | **CRITICAL** | Any Phase 1 that picks wrong creates a seventh. |
| R4 | **RLS is decorative** (service-role bypass; 4 `auth.uid()` policies of 151) | HIGH | One missing `.eq('company_id', …)` = cross-tenant read. 47 grandfathered routes remain. |
| R5 | **312 ungoverned SQL files**; production schema unverifiable | HIGH | Cannot state with confidence which tables exist in prod. |
| R6 | **`engagement_messages` has no tenant column** | HIGH | Message-level tenant isolation depends entirely on a join. |
| R7 | **`company_id` type split (`uuid` vs `text`)** | HIGH | Blocks FK enforcement between WS-3/lead_intelligence and the rest of the platform. |
| R8 | **No prospect consent model** | HIGH | `consent_records` is about integrations, not people. GDPR/DPDP lawful-basis is unrepresented. |
| R9 | **Scoring proliferation** (6 intent, 5 qualification engines) | MEDIUM | Contradictory scores on one prospect; unclear which drives action. |
| R10 | **Cache tenant-scoping unverified** | MEDIUM | `aiResponseCache`, `competitor_enrichment_cache`, `image_search_cache` key construction not audited; a tenant-blind key is a cross-tenant intelligence leak. |

Additional standing risks: `rpa_sessions.storage_state` holds live authenticated sessions with no evident column encryption; three independent kill switches complicate incident response; `email_jobs` has no tenant column at all.

---

# 26. Reuse Inventory

**Reuse unchanged:** WS-3 runtime (all 22 modules), `withTenantGuard`/`enforceCompanyAccess`/`ownedDbTable`, `aiGateway` + `ai/safety` + `ai/grounding` + `aiRequestGuard`, `lib/security/safeFetch`, credit execution runtime, HARDEN-001 observability registry, BullMQ topology + `safeEnqueue`, extension command bus + capability map, `rpaWorker`, `attribution_handoffs`, `htmlSanitizer`.

**Reuse extended:** `unified_persons`/`unified_touchpoints`/`unified_person_merges` (→ canonical spine), `companyIntelligence/providers` (→ add person-level + verification ports), `engagement_*` (→ interaction substrate), `whatsapp*` services (→ wrap in a `WhatsAppProvider` port + WS-3 transport), `pages/capture/[id].tsx` (→ campaign CTA route), `lead_intelligence_profiles` (→ prospect memory envelope), `CompanyUnderstanding` evidence/confidence pattern (→ apply to prospects and accounts).

**Reuse read-only (do not write from this program):** `campaigns` and content pipeline, MarketPulse, analytics canonical model, billing/subscription.

---

# 27. Modification Inventory

| Component | Modification | Risk |
|---|---|---|
| `suppression_entries` | Remove global scope; migrate to tenant-scoped; converge on `outreach_suppressions` | HIGH — needs data migration + a decision on existing global rows |
| WhatsApp send path | Route through WS-3 governance; register a WhatsApp transport | HIGH — touches a live channel |
| `unified_persons` | Add normalized identity columns (lowercased email, E.164 phone, LinkedIn URN, normalized domain) + uniqueness | MEDIUM |
| `engagement_threads` | `organization_id` → NOT NULL + FK; add `campaign_id` | MEDIUM — backfill required |
| `engagement_messages` | Add tenant column + backfill | MEDIUM |
| `lead_intelligence*` | `company_id` `text` → `uuid`; `unified_person_id` → real FK | MEDIUM |
| `governance.ts` | Add fatigue / quiet-hours / consent gates in the frozen order | LOW — additive, pure function |
| `transportRegistry.ts` | Register WhatsApp (and later phone) transports | LOW — explicit, caller-driven by design |
| `CreditAction` | Add enrichment/verification/WhatsApp/RPA/AI-selection actions | LOW — additive |
| `database/*.sql` | Promote program-relevant files into `supabase/migrations/` | MEDIUM |

**Explicitly not modified:** WS-2 engines/scores/envelopes, `communityAiActionExecutor*`, `automationService`, `AUTOMATABLE_ACTION_TYPES`, `outreach_plans`, `customerOperationsService`, the credit ledger, MarketPulse.

---

# 28. Missing Components

1. **Account entity** (prospect company) + account↔prospect relation
2. **Readiness classifier** — single evaluator, first-match-wins, tenant-configurable priority
3. **Prospect memory store** — structured facts with `(source, evidence, confidence, timestamp, tenant)`
4. **Prospect consent model** — lawful basis, channel consent, opt-in provenance
5. **Contact-fatigue policy** — quiet hours, cooldown, cross-channel frequency, max attempts
6. **Person-level enrichment port** + **VerificationProvider** (email/phone)
7. **DiscoveryProvider** port
8. **Email marketing events** — delivered/opened/clicked/bounced/replied/unsubscribed + SES SNS webhook + unsubscribe endpoint
9. **CallingProvider** + transcript store + call outcome ingestion
10. **WhatsAppProvider port** + WS-3 WhatsApp transport
11. **Interaction intelligence extractor** — one extractor producing the §11 fact set across email/transcript/WhatsApp/DM
12. **Follow-up intelligence** — temporary hold, follow-up date, preferred channel, evidence → future task
13. **Campaign CTA landing route** + WhatsApp click-to-chat + inbound correlation
14. **Unified event bus** (or an adopted convention modelled on WS-3's outcome contract)
15. **AI natural-language prospect selection** → structured criteria translator
16. **Two-sheet export** (Accounts / Contacts) with optional Engagement Events sheet

---

# 29. Recommended Target Architecture

**Principle: one spine, many sources, one policy gate, many transports.**

```
                 ┌──────────────── Tenant (companies) ────────────────┐
                 │                                                     │
   SOURCES  →  RESOLUTION  →  CANONICAL SPINE  →  POLICY  →  TRANSPORTS
   ───────     ──────────     ───────────────     ──────     ──────────
   leads            ┌──────────────────────────┐
   contacts         │  prospect_accounts (NEW) │
   active_leads     │        ▲                 │
   lead_intel   →   │  unified_persons (spine) │ →  WS-3 governance  →  transport
   engagement_*     │        ▲                 │    (frozen order)      registry
   visitor sess.    │  identity_claims (NEW)   │                        ├ internal ✅
   enrichment       │  prospect_memory (NEW)   │    + suppression       ├ email ⚑
   webhooks         │  prospect_scores (NEW)   │    + region            ├ whatsapp ✚
                    │  prospect_readiness (NEW)│    + approval          ├ linkedin ✚(ext)
                    └──────────────────────────┘    + rate limit        └ phone ✚(future)
                              ▲                     + fatigue (NEW)
                              │                     + consent  (NEW)
                    unified_touchpoints ◄──────── outcomes / events
```

**Ownership rules (normative):**
- `unified_persons` is the **only** canonical prospect identity. Every other lead table becomes either a *source* (writes identity claims) or a *projection* (reads the spine). Nothing else may assert identity.
- `prospect_accounts` is the **only** account entity, keyed on normalized domain per tenant. `companies` remains the tenant and is never a prospect.
- **Every** outbound contact — email, WhatsApp, LinkedIn, phone, internal — passes through `evaluateGovernance` before a transport is resolved. No exceptions, including the existing WhatsApp path.
- Suppression is **tenant-scoped only**. `outreach_suppressions` (append-only, revoke-not-delete) is the model.
- Every extracted fact carries `(source, evidence, confidence, timestamp, tenant)`. AI inference is never stored as fact without them.
- Outcomes remain **one-way**: they never re-enter scoring or the regeneration fingerprint (WS-3 §8.4). Preserve this.
- Events follow the WS-3 contract shape: at-least-once, per-subject ordering, additive-only, explicit idempotency key.

---

# 30. Migration Strategy

**Strangler-fig, read-first, never big-bang.**

| Stage | Action | Reversibility |
|---|---|---|
| S0 | Verify production schema; promote program-relevant `database/*.sql` into migrations | Read-only |
| S1 | Create `prospect_accounts`, `identity_claims`, `prospect_memory`, `prospect_scores`, `prospect_readiness` — **empty, additive, flag-dark** | Drop tables |
| S2 | **Shadow resolution:** resolver reads all six sources, writes `identity_claims` + `unified_persons` links. Existing readers untouched | Stop the job |
| S3 | **Parity observation:** compare shadow spine vs. existing reads; publish a parity report. No cutover until parity is proven | Read-only |
| S4 | Readiness classifier in shadow; reconciliation report must sum to 100% with zero double counting | Read-only |
| S5 | Suppression convergence: dual-read both tables (union = suppress), then retire global scope | Feature flag |
| S6 | **WhatsApp under governance:** register WhatsApp transport; dispatch through WS-3; keep legacy path behind a flag until parity | Flag flip |
| S7 | Read-path cutover: UI/API read the spine | Flag flip |
| S8 | Write-path cutover: sources write claims only | Flag flip |

**Non-negotiable gates:** no destructive migration until S3 parity passes; no channel goes live before its governance gate is independently proven (WS-3's own M3-before-M5 discipline); every stage additive and flag-dark by default.

---

# 31. Dependency Map

```
prospect_accounts ─────┐
                       ├──> readiness classifier ──> analytics (B, C)
unified_persons ───────┤                        └──> next-best-action
   ▲                   ├──> prospect_scores ────────> selection / AI selection
   │                   └──> prospect_memory ────────> personalization (WS-4)
identity_claims             ▲
   ▲                        │
sources (6)          interaction intelligence
                            ▲
                     engagement_messages (email / whatsapp / transcript / DM)
                            ▲
suppression (unified) ──> WS-3 governance ──> transport registry ──> channels
   ▲                          ▲                                        │
consent model ────────────────┤                                        ▼
fatigue policy ───────────────┘                                    outcomes
                                                                       │
                                                          unified_touchpoints
                                                                       │
                                                                 attribution
```

**Critical path:** production schema verification → canonical decision → `prospect_accounts` + spine → suppression convergence → governance for all channels → everything else.

**Hard blockers on downstream work:** person-level enrichment blocks readiness (Email/Phone Required categories are meaningless without it). Interaction intelligence blocks memory, follow-up, and DNC-from-conversation. Email events block funnel analytics (F) and bounce/unsubscribe suppression.

---

# 32. Phased Implementation Plan

| Phase | Scope | Gate |
|---|---|---|
| **0.5 — Canonicalisation (decision + verification)** | Verify prod schema; ratify canonical spine; ratify tenant-only DNC; freeze the ownership rules in a `docs/` architecture record | No code. Written decision of record. |
| **1 — Foundation (additive, flag-dark)** | `prospect_accounts`, `identity_claims`; shadow resolver; suppression convergence (dual-read); **WhatsApp under WS-3 governance**; normalized identity columns | Parity proven; WhatsApp kill switch drilled |
| **2 — Readiness & Scoring** | Readiness classifier (shadow → live); consolidate scoring to six declared axes; reconciliation report | Categories sum to 100%, zero double counting |
| **3 — Enrichment** | `PersonEnrichmentProvider` + `VerificationProvider` ports; Apollo as one adapter; credit integration; freshness/refresh policy | No vendor name outside `adapters/` |
| **4 — Interaction Intelligence & Memory** | One extractor across channels; `prospect_memory` with evidence/confidence; follow-up intelligence → future task with review | AI facts never stored without evidence |
| **5 — Email as a real channel** | SES SNS webhook, unsubscribe endpoint + List-Unsubscribe, link tracking, bounce→suppression; content via the WS-4 insertion point | Bounce and unsubscribe provably suppress |
| **6 — Campaign CTA & Attribution** | Campaign landing route, WhatsApp click-to-chat, inbound correlation, touchpoint coverage | Every channel writes a touchpoint |
| **7 — Analytics & NBA** | Executive dashboard A–K; NL prospect selection | All readiness reconciles |
| **8 — Phone (deferred)** | `CallingProvider` transport, transcript store, outcome ingestion | Governance proven before capability |

---

# 33. Phase 1 Scope (minimum safe) — **DO NOT IMPLEMENT YET**

**In scope:**
1. Promote program-relevant `database/*.sql` into `supabase/migrations/` (idempotent, no-op if already applied).
2. `prospect_accounts` (tenant-scoped, normalized domain unique per tenant) — created empty.
3. `identity_claims` (append-only: subject, claim type, value, source, evidence, confidence, timestamp, tenant) — created empty.
4. Normalized identity columns on `unified_persons` + uniqueness — additive, nullable.
5. Shadow identity resolver — reads all six sources, writes claims + spine links. **Writes nothing existing readers see.**
6. Suppression convergence, stage 1: dual-read helper (`isSuppressed()` = union of both tables) used by all send paths; **no data migration yet**.
7. **WhatsApp under WS-3 governance** — `WhatsAppProvider` port, WS-3 transport registration, dispatch through `evaluateGovernance`. Legacy path retained behind a flag.
8. Parity reporting for 5 and 6.

**Out of scope for Phase 1:** any new discovery/enrichment vendor; phone; marketing email; readiness classifier; prospect memory; campaign CTA page; any destructive migration; any change to WS-2, community runtime, `outreach_plans`, billing, or MarketPulse.

**Why item 7 is in Phase 1 despite being the riskiest:** it is the only item that reduces *current* compliance exposure. Every other item is preparation.

---

# 34. Acceptance Criteria

**Phase 0.5**
- A written decision of record naming the canonical prospect spine and the tenant-only DNC model, reviewed and approved.
- Production schema state for all program-relevant tables verified and documented.

**Phase 1**
- `scripts/check-tenant-authz.js` PASS with **no increase** in the 47-route baseline.
- Every new table: tenant column `NOT NULL` + FK, RLS enabled, and — because RLS is bypassed — an application-layer guard test proving cross-tenant reads fail.
- Shadow resolver: ≥ 99% of records from all six sources resolve to a spine entry or an explicit unresolved reason; zero cross-tenant links (asserted by test).
- `isSuppressed()` is called on **every** send path; a test proves an unsuppressed send is impossible when a matching suppression exists, for each channel.
- WhatsApp: a suppressed recipient provably cannot receive a broadcast; the WS-3 kill switch provably stops WhatsApp dispatch; drilled in a non-production environment.
- Idempotency: replaying any Phase-1 write produces no duplicate row (asserted per table).
- No existing behaviour changes with all flags off — proven by the existing suite passing unmodified.
- Rollback: every Phase-1 change reversible by flag flip or table drop; documented in a runbook.

**Standing criteria for all later phases**
- No AI-inferred fact persisted without `(source, evidence, confidence, timestamp, tenant)`.
- No readiness category double-counts; categories sum to the total population.
- No outcome enters any scoring path or regeneration fingerprint.
- No vendor name appears outside its adapter file.

---

# 35. BLOCKERS / INFORMATION REQUIRED

| # | Blocker | Why it blocks | Needed from |
|---|---|---|---|
| **B-1** | **Production schema state is unverifiable.** Supabase MCP did not attach; `verify-schema-parity.js` fails (`information_schema` not exposed to `service_role`). 312 SQL files sit outside migration governance, including `leads.sql` and the entire WhatsApp schema. | Cannot state EXISTS vs MISSING in production for the tables most central to this program. Any migration plan built on repo state alone may be wrong. | Ops: expose `information_schema` to `service_role`, or provide a schema dump. |
| **B-2** | **Canonical prospect entity — product decision required.** Six models exist. | Everything downstream depends on it. Choosing wrong creates a seventh model. | Product + architecture sign-off. |
| **B-3** | **Existing global suppression rows — legal/product decision.** `suppression_entries` permits `scope='global'`. Whether any exist, and what happens to them under a tenant-only model, is unknown. | Converting a global suppression to tenant-scoped either *silences* people who asked to be left alone in tenants that never heard from them, or *un-silences* them. Both are wrong without an explicit decision. | Legal + product. |
| **B-4** | **Lawful basis / consent model for prospects.** `consent_records` covers integrations, not people. Target markets (GDPR/DPDP/CAN-SPAM/TCPA) are unstated. | Determines whether cold outreach is permissible at all per channel per region, and what `restricted_regions` must contain. | Legal. |
| **B-5** | **WhatsApp Business Platform posture.** Whether the account is on-premise or Cloud API in production, which templates are Meta-approved, opt-in capture mechanism, and per-tenant vs shared WABA. | Determines whether outbound WhatsApp outreach to non-opted-in prospects is possible at all. | Ops + legal. |
| **B-6** | **Cache tenant-scoping.** Key construction in `aiResponseCache`, `competitor_enrichment_cache`, `image_search_cache`, `domain_eligibility_cache` not audited. | A tenant-blind cache key is a cross-tenant intelligence leak — the one failure §4 forbids absolutely. | Follow-up audit (small, mechanical). |
| **B-7** | **`ENTRY_CONSUMPTION` hold + unapplied activity-economy catalog.** Prior programs record consumption HELD in production and migration `20260822` unapplied. | New `CreditAction`s cannot be priced until resolved. | Ops. |
| **B-8** | **Tenant-configurable readiness priority — is it required in v1?** §8 says "eventually". | Determines whether the classifier ships with a constant or a config table. | Product. |

---

# FINAL DECISION

**1. Can current Omnivyra support the target architecture?**
**Yes — as an evolution, not a rewrite.** The execution, governance, credit, AI, identity-spine and engagement substrates all exist. The front half of the lifecycle (`DISCOVER → RESOLVE → ENRICH`) and the Account level of the domain model do not. No architectural property of the platform prevents them.

**2. What can be reused?**
The WS-3 outreach runtime in full; the tenant guard model; `aiGateway` + safety/grounding; the credit execution runtime; the enrichment provider pattern; `unified_persons`/`unified_touchpoints`; the engagement ingestion stack; WhatsApp in/out; the extension/RPA command bus; `attribution_handoffs`; the public capture-page pattern; the HARDEN-001 observability registry. See §26.

**3. What must change?**
Suppression must become tenant-only. WhatsApp must come under WS-3 governance. `unified_persons` must become mandatory and normalized. `company_id` typing must be unified. `engagement_threads`/`engagement_messages` must carry enforced tenant columns. Program-relevant schema must move into migrations. See §27.

**4. What is duplicated?**
Six lead models; two suppression systems with contradictory scope semantics; three kill switches; three-plus rate limiters; five qualification engines; six intent engines; eleven-plus event tables; two schema locations. See §5.

**5. Top 10 architectural gaps**
(1) No Account entity. (2) No canonical prospect owner. (3) No readiness classifier. (4) No prospect memory. (5) No prospect consent model. (6) No contact-fatigue/quiet-hours policy. (7) No person-level enrichment or verification port. (8) No email delivery/engagement events. (9) No phone channel. (10) No unified event bus.

**6. Top 10 risks** — §25 (R1 global DNC and R2 ungoverned WhatsApp are the two that are dangerous *today*, independent of this program).

**7. What must be fixed before implementation?**
B-1 (verify production schema), B-2 (ratify canonical spine), B-3 (decide the fate of global suppression rows), B-4 (lawful basis), B-6 (audit cache keys). B-1, B-2 and B-3 are hard gates.

**8. What can be implemented immediately (after the gates)?**
Phase 1 §33 — all additive, all flag-dark, all reversible.

**9. What should be deferred?**
Phone/voice entirely. Marketing email until bounce/unsubscribe handling exists. Discovery providers. NL prospect selection. Cross-channel executive analytics. Prospect memory until interaction intelligence lands.

**10. Minimum safe Phase 1** — §33. In one line: *make identity resolvable, make suppression tenant-only, and put the one live external channel behind the governance engine that already exists.*

**11. What must NOT be touched?**
WS-2 engines, scores, envelopes and versions · `communityAiActionExecutor*`, `automationService`, `automationConstants`, `AUTOMATABLE_ACTION_TYPES` · `outreach_plans` and the decommissioned `lead_outreach_plans` · the credit ledger and settlement path · `customerOperationsService` · MarketPulse services · `enforceCompanyAccess` / `withTenantGuard` semantics · the WS-3 frozen dispatch order and one-way outcome rule · applied migration files.

**12. What exact implementation prompt should follow this audit?**

> **OMNIVYRA PROSPECT INTELLIGENCE — PHASE 0.5: CANONICALISATION & VERIFICATION (DECISION ONLY, NO CODE)**
>
> Acting as Principal Architect and Multi-Tenant Security Architect, and **without writing production code or modifying any schema**, produce a written architecture decision record covering, in order:
>
> 1. **Production schema verification.** Determine, for every table named in the Phase-0 audit §3, §5, §16 and §24, whether it exists in the production database. Resolve the 312 ungoverned `database/*.sql` files: which are applied, which are dead, which must be promoted into `supabase/migrations/`. Output a table: file → tables → applied? → disposition.
> 2. **Canonical prospect spine decision.** Choose between `unified_persons` and an alternative. State the chosen key, the `company_id` type resolution (`uuid` vs `text`), the normalized identity columns and their constraints, and the disposition of each of the six existing lead models as *source*, *projection*, or *retire*. Justify against the audit evidence.
> 3. **Account entity specification.** Define `prospect_accounts`: key, tenant scoping, normalized-domain uniqueness, relation to `unified_persons`, and its explicit non-relation to `companies` (the tenant).
> 4. **Suppression convergence decision.** Specify the tenant-only DNC model, the migration path for any existing `scope='global'` rows (with the legal decision from B-3 recorded), the dual-read contract, and the retirement plan for `suppression_entries`.
> 5. **Governance unification specification.** Specify exactly how the WhatsApp send path is brought under `evaluateGovernance`, where the `WhatsAppProvider` port sits, and how the legacy path is retired. State the drill that proves the kill switch stops WhatsApp.
> 6. **Readiness taxonomy specification.** The seven categories, the first-match-wins priority resolver, the inputs each category reads, and the reconciliation proof obligation. No implementation.
> 7. **Fact contract.** The normative shape for every stored prospect fact: `(value, source, evidence, confidence, timestamp, tenant)`, and the rule that AI inference is never stored without it.
> 8. **Phase 1 work breakdown** against §33, each item with: files touched, migration (additive only), feature flag, rollback, acceptance test, and the guard test that proves cross-tenant isolation.
>
> Constraints: reuse the WS-3 runtime and its frozen dispatch order unchanged; create no parallel lead database, billing system or event system; keep DNC tenant-scoped; keep Apollo and WhatsApp behind ports; every change additive, flag-dark and reversible. Do not implement. Stop after the decision record.

---

**END OF PHASE 0 AUDIT — awaiting review and approval before any implementation.**

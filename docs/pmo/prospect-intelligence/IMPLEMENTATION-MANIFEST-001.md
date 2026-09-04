# OmniVyra Prospect Intelligence — Implementation Manifest 001

**Status:** CONTRACT FREEZE — **READY** (gate: §20)
**Authoritative artifact** for every future implementation workstream.
**Base:** `origin/main` = `44b2dcbe` · **Baseline audit:** `BASELINE-AUDIT-001.md` @ `6078dd49`
**Date:** 2026-09-03 · Contract work only — no application code, schema, migration or production change.

---

## 0. Governing specification

**Governing specification:** *OmniVyra Prospect Intelligence — AI Implementation Playbook V2*.

Its authoritative numbered requirement sets — **BR-01…BR-30** and **FR-01…FR-30** — are used verbatim in
§14–§19. No substitute requirement set was invented; the task prompt is not treated as a replacement for the
Playbook. §14–§19 complete the two items that previously held the freeze open (BR/FR traceability and
field-level mapping).

---

## 1. Conflict resolutions

### C-1 · MarketPulse — **RESOLVED**

**Canonical for PI consumption:** `market_pulse_*` via `backend/services/marketPulse/**`.

| | `market_pulse_*` | `marketpulse_*` |
|---|---|---|
| Rows | `market_pulse_findings` **78**, `market_pulse_items_v1` **78** | `marketpulse_signals` **0** (45-table family) |
| Service writers | `marketPulse/{changeIntelligence,executivePanels,crossProductCorrelation}Service.ts` | **11 services** incl. `marketPulseIntelligenceService.ts`, `marketPulseSynthesisService.ts` |
| API routes | `market-pulse/findings/[id]/action.ts`, `.../generate-response.ts`, `cron/market-pulse-automation.ts`, `external-apis/company-config.ts` | `market-pulse/personalization.ts` → `marketpulse_personalization_controls` |

**Correction to the baseline audit:** the `marketpulse_*` family is **not** dead code. It has 11 service
writers and at least one live API route. It is *code-complete and data-empty*, not abandoned.

**Disposition: `market_pulse_*` = INTEGRATE (PI reads it). `marketpulse_*` = KEEP, OUT OF PI SCOPE.**
**RETIRE is NOT asserted** — zero rows is not consumer evidence, and consumers exist.
**Prohibited: a third MarketPulse storage model.** PI must read the live family through
`services/marketPulse/**`, never copy it into a new store.

### C-2 · Canonical Prospect — **RESOLVED, evidence supports the product decision**

Product decision (§4): `canonical_leads` is the canonical Prospect foundation. **Repository evidence confirms
it and reveals no contradiction.**

All three tables carry `unified_person_id` with a **tenant-safe composite FK** to
`unified_persons(id, company_id)` — so the person-spine edge is already universal, not exclusive to
`lead_intelligence`. The column shapes are what separate the roles:

| Table | Distinguishing columns | Person FK on-delete | Frozen role |
|---|---|---|---|
| **`canonical_leads`** (18) | `external_lead_key`, `lead_status`, `qualification_score`, `user_id`→`canonical_users(id, company_id)` | SET NULL | **CANONICAL PROSPECT** — identity key + lifecycle + qualification |
| `leads` (18) | `form_id`→`forms`, `website_id`→`websites`, `visitor_session_id`, `integration_id`, `consent_state`, `name/email/phone` | SET NULL | **SOURCE / CAPTURE OBSERVATION** |
| `lead_intelligence` (18) | `source_table` + `source_id` (pointer to origin row), `occurred_at`, `ingested_at`, `dedupe_key`, `scores`, `identity`, `attribution` | **RESTRICT** | **INTELLIGENCE / DERIVED OBSERVATION** |

`canonical_leads` is the only one carrying an external identity key, a lifecycle status and a qualification
score — the three canonical markers. `leads` is unambiguously capture (forms, websites, visitor sessions,
consent). `lead_intelligence` is unambiguously observation: it points *back* at its origin
(`source_table`/`source_id`) and timestamps observation separately from ingestion.

**`unified_person_id` treatment:** preserved on all three, unchanged. Note `lead_intelligence` uses
**ON DELETE RESTRICT** while the other two use SET NULL — the observation store *protects* its person anchor.
That asymmetry is deliberate and must not be normalised away.

**No contradiction found:** no identity loss (person edge preserved everywhere), no tenant-isolation failure
(all three composite-keyed on `company_id`), no capability loss (no writer is being redirected by this
manifest), no downstream contract break (no code changes), no historical-data loss (nothing deleted).

**Prohibited: a fourth Prospect/Lead table.**

### C-3 · Suppression — **RESOLVED**

**Canonical entity:** `contact_governance_records`, evaluated by `prospectIdentity/contactGovernance.mayContact`.

**There is already ONE evaluator and THREE stores.** Both governance paths import the same evaluator:
`execution/suppressionService.ts:49` and `leadOutreachExecution/governanceService.ts:33`.

| Store | Owner | Frozen role |
|---|---|---|
| `contact_governance_records` | `contactGovernanceWriter.ts` / `contactGovernanceRepository.ts` | **CANONICAL** |
| `suppression_entries` | `execution/suppressionService.ts` only | **LEGACY — retained** for the `__global__` scope the canonical model cannot express |
| `outreach_suppressions` | `leadOutreachExecution/governanceService.ts` | **LEGACY — retained**, WS-3 dispatch path |
| `consent_records` | `consentLedgerService`, `complianceEvidenceService`, `capabilityAggregationService` | **DIFFERENT DOMAIN** — OAuth/platform-capability ledger, **not** contact suppression. Excluded, asserted by test |

**Precedence (frozen):** canonical first and authoritative; legacy may *add* a suppression, never *remove* one
the canonical store asserted. Unreadable store ⇒ **fail closed**.
**Mandatory rule frozen: SUPPRESSION OVERRIDES POSITIVE SCORING.** A high score never confers eligibility.
**Compatibility:** all three retained. **Migration:** none in this prompt. **Cleanup:** `suppression_entries`
consolidation is blocked on a `__global__` product decision; `outreach_suppressions` needs a WS-3 consumer review.

### C-4 · ICP — **RESOLVED, architecture frozen**

Two contributors into one `icp` dimension, running side by side at `leadUnderstanding/engines/assembly.ts:51`.
**Deliberate (W03) — not to be "fixed".**

| Contributor | Role |
|---|---|
| `engines/personaIcp.ts` | **Heuristic/persona contributor** — pre-existing |
| `engines/prospectIcpFit.ts` | **Ratified-policy contributor** — bridges `prospectIcp/**` into the same dimension |
| `prospectIcp/**` | **CANONICAL ICP POLICY STORE** — tenant-owned, versioned, human-ratified, immutable |

**Four ICP concepts frozen as distinct:**
1. **Declared ICP** → `prospect_icps` / `prospect_icp_versions` (ratified, immutable)
2. **AI-proposed ICP** → a *draft* version; may never self-ratify
3. **Observed ICP evidence** → `source_assertions` + `unified_persons`/`prospect_accounts` attributes
4. **Learned ICP recommendation** → future, from `outreach_outcomes`; **proposal only, never auto-ratified**

**Versioning:** `ratified_at`, `ratified_by`, `superseded_at`, `superseded_by_version`; versions immutable
(contract 16). "In force at time T" is a deterministic temporal lookup — no new column required.
**Company ICP** attributes (`prospectIcp/criteria.ts` ACCOUNT surface): `industry`, `employee_count`,
`employee_band`, `country_code`, `region`, `city`, `annual_revenue`, `revenue_band`, `founded_year`,
`technologies`. **Person ICP**: `job_title`, `department`, `seniority`, geography.
**Playbook attributes not yet represented** — company `market`, `business_model`, `product/service alignment`,
`growth`; person `authority`, `influence`, `buying role`, `problem relevance` — are marked
**REQUIRED — NOT YET IMPLEMENTED**, owner **WS-6**. They must be added to the closed criterion vocabulary
(`criteria.ts`), never invented at evaluation time: an ICP may only speak about attributes the platform stores.
**Prohibited: a second ICP engine.**

### C-5 · Signals — **RESOLVED**

| Table | Rows | Code references | Frozen role |
|---|---|---|---|
| `lead_signals` | 10 | `canonicalLeadSignalService.ts` (+ `contentOpportunity`, `conversationTriage`, `engagementAnalytics`) | **CANONICAL signal model** |
| `lead_signals_v1` | 6 | **ZERO** | **ORPHANED DATA — legacy** |

`lead_signals_v1` holds 6 rows and has **no writer, reader or test in the repository**. That is orphaned data,
not an active model. **Disposition: KEEP (no deletion this prompt), flagged for a future RETIRE decision**
requiring a migration-history review. `canonicalLeadSignalService` is the canonical writer and is already
wired to the person spine (G8). **Prohibited: a third signal model.**

### C-6 · Plan tables — **RESOLVED, OUT OF PI SCOPE**

| Table | Rows | Consumers |
|---|---|---|
| `lead_outreach_plans` | 0 | **none found** |
| `outreach_plans` | 0 | `pages/api/outreach-plans/index.ts` |

Neither participates in the live outreach model (`outreach_tasks` → `approvals` → `attempts` →
`delivery_evidence` → `outcomes`). **Recorded as dormant/legacy infrastructure outside PI scope.** Not forced
into the PI model, not retired. Owner: **WS-0** to track.

---

## 2. Canonical entity contract (frozen)

| Logical entity | Physical | Identity | Tenant key | Action | Owner |
|---|---|---|---|---|---|
| Tenant | `companies` | `id` | is the tenant | KEEP | WS-0 |
| ICP Profile | `prospect_icps` / `prospect_icp_versions` | `(org, icp_key, version)` | `organization_id` | EXTEND (attrs) | WS-6 |
| **Prospect** | **`canonical_leads`** | `external_lead_key` | `company_id` | KEEP | WS-1 |
| Person | `unified_persons` | email → phone → external key | `company_id` | KEEP | WS-1 |
| Account | `prospect_accounts` | provider ref → domain (**never name**) | `organization_id` | KEEP | WS-1 |
| Source Identity | `identity_claims` | claim tuple | `company_id` | KEEP | WS-2 |
| Source Observation | `source_records` / `source_assertions` | `(org, provider, entity_type, source_record_id)` | yes | KEEP | WS-2 |
| Capture Observation | `leads` | `id` | `company_id` | KEEP | WS-4 |
| Intelligence Observation | `lead_intelligence` | `dedupe_key` + `source_table`/`source_id` | `company_id` | KEEP | WS-4 |
| Intelligence Envelope | `lead_intelligence_profiles` | `(company_id, lead_id)` | `company_id` | KEEP | WS-4 |
| Enrichment | — | — | — | **CREATE** (see §3) | WS-11 |
| Signal | `lead_signals` | — | `company_id` | KEEP | WS-5 |
| Score | `leadUnderstanding` dimensions | — | ctx tenant | EXTEND | WS-6 |
| Recommendation | `lib/leadIntelligence/leadActions.ts` → `buildLeadActionPlan` | — | ctx tenant | EXTEND | WS-8 |
| Timeline | `engagement_threads` / `engagement_messages` | — | `company_id` | KEEP | WS-5 |
| Outreach History | `outreach_tasks`/`attempts`/`approvals`/`decisions`/`delivery_evidence`/`outcomes` | — | `company_id` | INTEGRATE (read-only into PI) | WS-8 |
| Buying Role | — | — | — | **REQUIRED — NOT YET IMPLEMENTED** | WS-7 |
| Suppression | `contact_governance_records` | — | `organization_id` | MERGE (C-3) | WS-2 |
| Account Intelligence | aggregation over `prospect_accounts` + `market_pulse_*` + engagement | — | tenant | **REQUIRED — NOT YET IMPLEMENTED** | WS-7 |

**Prospect ≠ Person ≠ Account.** A Prospect (`canonical_leads`) is a tenant's pursuit record; a Person
(`unified_persons`) is the canonical human; an Account (`prospect_accounts`) is the external company —
**never `companies`**, which is the tenant. Multiple Prospects may resolve to one Person; multiple Persons
attach to one Account via `unified_persons.account_id`. **One account per organisation, never one per contact.**

---

## 3. Provider reality — five states (frozen)

`integrations/dataSourceCatalogue.ts:24`: *"Every provider below is `available: false` — declared, not
implemented. The three exceptions are `manual`, `crm` and `csv`."*

| State | Meaning | Members |
|---|---|---|
| **DECLARED** | listed in the catalogue | `linkedin_sales_navigator`, `apollo`, `zoominfo`, `apollo_enrichment`, `zoominfo_enrichment` |
| **AVAILABLE** | `available: true` | `manual`, `crm`, `csv` |
| **IMPLEMENTED** | adapter code exists | `manualAdapter`, `crmAdapter`, `csvAdapter` |
| **AUTHORIZED** | tenant credential present | none for people data |
| **OPERATIONAL** | producing data in production | **none** — `source_records` = 0 |

**Sales Navigator: no implementation. Do not implement, do not classify as operational, do not invent.**
**LinkedIn's 13 files are publishing/engagement/OAuth** (`platformAdapters/linkedinAdapter.ts`,
`platformConnectors/linkedinConnector.ts`, `auth/linkedin/callback.ts`) — **never to be treated as prospect
data acquisition**. **Never store LinkedIn credentials as prospect data.**

**Enrichment decision order (frozen):** existing canonical intelligence → existing internal intelligence →
MarketPulse (`market_pulse_*`) → available configured provider → additional provider only when justified.
Incremental and cost-aware; partial results preserved; failures never overwrite canonical values.

---

## 4. Data quality contract (frozen) — six distinct dimensions, never collapsed

| Dimension | Canonical owner |
|---|---|
| Completeness | WS-2 — derived from canonical attribute presence |
| Confidence | WS-2 — `source_assertions.confidence`, `prospect_accounts.confidence` |
| Freshness | WS-2 — `observed_at` / `last_verified_at` / `attributes_updated_at` |
| Provenance | WS-2 — `source_records` + `identity_claims` |
| Consistency | WS-2 — LI-2 RULE B (disagreeing sources withhold) |
| Actionability | WS-8 — readiness + suppression |

**No single generic data-quality score.**

---

## 5. Scoring, NBA, readiness, outcome (frozen)

**Scoring** — extend `leadUnderstanding/engines/**`; contributions land in existing dimensions.
Deterministic (no `now()` inside engines), versioned, explainable, timestamped, tenant-scoped. Absence is
**abstention**, never a zero. Playbook dimensions not yet represented (Problem Fit, Account Potential,
Buying Role, Relationship Strength) → **REQUIRED — NOT YET IMPLEMENTED**, WS-6/WS-7.
**Prohibited: a second generic scoring engine.**

**Next Best Action** — extend `lib/leadIntelligence/leadActions.ts` → `buildLeadActionPlan`, consumed today by `backend/services/leadIntelligence/leadIntelligenceReadService.ts:241,292` (test: `backend/tests/unit/leadActions.test.ts`). Every recommendation carries
`prospect_id, account_id, action, objective, reason, evidence, confidence, priority, channel, constraints,
expiry, suppression`. Actions: enrich · identify stakeholder · contact · wait · change channel · personalize ·
coordinate · monitor · suppress · revisit · no action. **Must respect suppression.**

**Outreach readiness** — PI emits `prospect_id, account_id, readiness, objective, recommended_channel,
recommended_timing, reason, confidence, required_missing_fields, constraints, suppression, message_context`.
**PI never sends.** Outreach Automation executes.

**Outcome** — `outreach_outcomes` via `ingestFeedback` (sole write path). Delivery and business axes never
merge. Dual idempotency keys already enforced. **Outcomes never rewrite history**; `derived` marks asserted-
not-observed; unobservable outcomes reported as unobservable, never as zero.

---

## 6. Import contract (frozen)

Inspect → Map → Validate → Duplicate Check → Preview → Enrich → Commit.
**Extend the existing pipeline** — `csvAdapter` (client-side parse; no server file parsing, no upload
infrastructure) + `leadIngestion/orchestrator`. Duplicate check is LI-4C (parks, never merges).
**Prohibited: a second import architecture.**

---

## 7. Tenant security contract (frozen)

Canonical guard for new routes: **`TenantGuard.requireTenantAccess`** (membership + org state + platform
bypass only via `is_platform_super_admin`; bridge principals rejected). Background jobs use
`assertTenantAccess`. Tenant identifiers are **named explicitly, never inferred** — no `activeOrgId`
inference (BILLING-ACTIVE-ORG-AUTHZ-SEC-001). Every canonical table is composite-keyed on the tenant.
Metrics carry **no tenant label**; per-event tenant detail lives in structured logs.
**No tenant may observe or influence another tenant's intelligence. Authorization is never weakened for PI.**

---

## 8. CREATE decisions

**CREATE-1 · People/firmographic enrichment adapter** — WS-11

1. **Requirement:** enrich a Person/Account from an external people-data source.
2. **Candidates inspected:** `intelligence/providerRegistry.ts` + `providerInterfaces.ts` + `adapters/**`
   (`openai`, `anthropic`, `gemini`, `ahrefs`, `benchmarkDataset`, `commercial`, `copilot`, `llmAdapterBase`);
   `leadIngestion/registry.ts` (`manual`, `crm`, `csv`).
3. **Why reuse is insufficient:** every existing adapter is LLM/SEO/reputation. **No people or firmographic
   adapter exists anywhere in the repository.**
4. **Why extension is insufficient:** the registries are the correct *seams* and will be reused — but a
   registry cannot enrich without an adapter behind it. The adapter itself does not exist.
5. **Minimum safe delta:** one adapter behind the existing `providerRegistry` seam; zero new registries.
6. **Owner:** WS-11. **Dependencies:** commercial + data-protection decision (plan §8: *"a commercial and
   data-protection decision, not an engineering one"*); tenant credential storage via `integration_credentials`.
7. **API impact:** none required initially. **Schema impact:** none — `prospect_accounts` already carries the
   full firmographic surface. **Test impact:** adapter contract + tenant isolation + cost/rate-limit tests.

**Not implemented in this prompt.**

## 9. RETIRE decisions

**NONE.** No retirement is asserted. Two candidates are recorded for a future decision, each blocked on
consumer evidence not obtainable in this prompt:

| Candidate | Why not retired now |
|---|---|
| `lead_signals_v1` (6 rows, 0 code refs) | Orphaned data ≠ safe removal; needs migration-history review and a data-preservation decision |
| `lead_outreach_plans` (0 rows, 0 consumers) | Zero rows is not consumer evidence; needs a migration/test sweep |

`marketpulse_*` is **explicitly NOT a retire candidate** — 11 service writers and a live API route.

---

## 10. Workstream ownership (frozen)

| WS | Scope | Owns (exclusive) | May not touch |
|---|---|---|---|
| WS-0 | Architecture / integration governance | this manifest, conflict register | any implementation |
| WS-1 | Prospect + Account canonical model | `canonical_leads`, `unified_persons`, `prospect_accounts`, `prospectIdentity/{accountResolution,personDuplicates}` | scoring, outreach |
| WS-2 | Enrichment + provenance | `source_records`/`source_assertions`, `ingestionBoundary.ts`, `identity_claims`, governance stores | scoring, NBA |
| WS-3 | MarketPulse integration | read-only consumption of `market_pulse_*` | any MarketPulse write |
| WS-4 | Lead / Active Lead integration | `leads`, `lead_intelligence`, `lead_intelligence_profiles`, `active_leads` | `canonical_leads` schema |
| WS-5 | Engagement / timeline | `engagement_*`, `lead_signals` | identity resolution |
| WS-6 | ICP + scoring | `prospectIcp/**`, `leadUnderstanding/engines/**` | outreach, identity |
| WS-7 | Account + buying committee | account intelligence aggregation, buying roles | `prospect_accounts` identity rules (WS-1) |
| WS-8 | NBA / recommendation / readiness | `lib/leadIntelligence/leadActions.ts`, readiness contract, outreach-history reads | outreach execution |
| WS-9 | Import / upload | `csvAdapter`, import lifecycle | orchestrator internals |
| WS-10 | API / UI | PI routes + components | canonical entity contracts |
| WS-11 | Provider adapters | CREATE-1, `providerRegistry` adapters | registry contract itself |
| WS-12 | Testing / final validation | cross-workstream validation | all implementation |

**One canonical owner per shared entity. One owner per shared migration. One owner per shared API contract.**
No workstream may silently alter another's canonical entity, migration, API, scoring, provider contract or
ownership boundary. Every workstream declares touched files/tables/routes. Unexpected dependencies go to the
conflict register.

---

## 11. Do-Not-Build register (frozen)

| Do not build | Reuse / extend instead |
|---|---|
| Second Lead entity | `leads` (capture) — already exists |
| Second Prospect entity | **`canonical_leads`** |
| Second Account entity | `prospect_accounts` + `accountResolution.ts` |
| Third MarketPulse model | `market_pulse_*` via `services/marketPulse/**` |
| Second suppression model | `contact_governance_records` + `mayContact` |
| Second engagement timeline | `engagement_threads` / `engagement_messages` |
| Second scoring engine | `leadUnderstanding/engines/**` |
| Second ICP engine | `prospectIcp/**` (+ two frozen contributors) |
| Second enrichment pipeline | `intelligence/providerRegistry.ts` |
| Second provider registry | `leadIngestion/registry.ts` (sources) / `providerRegistry.ts` (enrichment) |
| Second tenant identity | `TenantGuard` |
| **PI message-sending infrastructure** | Outreach Automation — PI never sends |
| Duplicate recommendation engine | `lib/leadIntelligence/leadActions.ts` |
| Second signal model | `lead_signals` |
| Fourth suppression / fourth lead table | — |

---

## 12. Lineage + parallelisation (frozen)

**Lineage:** SOURCE → OBSERVATION (`source_records`) → IDENTITY RESOLUTION (`resolveUnifiedPerson` /
`resolveOrCreateAccount`) → CANONICAL (`canonical_leads` / `unified_persons` / `prospect_accounts`) →
ENRICHMENT → INTELLIGENCE (`lead_intelligence_profiles`) → SCORE (`leadUnderstanding`) → RECOMMENDATION →
READINESS → OUTCOME (`outreach_outcomes`) → LEARNING (proposal only). Every major value must be explainable
to its source assertion.

**PHASE A** — contract freeze (this document).
**PHASE B, parallel after freeze:** WS-1, WS-2, WS-3, WS-4, WS-5, WS-9, WS-11, WS-10.
**Then sequential:** WS-6 (ICP/scoring) → WS-7 (account/buying committee) → WS-8 (NBA/readiness) →
integration → **WS-12 one final validation**.
No downstream work may start against an unfrozen upstream contract.

---

## 13. Freeze gate

Superseded by **§20** — see the completed gate after BR/FR traceability.

---

## 14. C-7 — Recommendation engines (NEW, found by this traceability exercise)

The BR/FR mapping exposed a duplication the baseline audit missed. **Two next-best-action producers exist:**

| Implementation | Layer | Runtime |
|---|---|---|
| `lib/leadIntelligence/leadActions.ts` → `buildLeadActionPlan` | read-side action plan over the Lead Intelligence *view* | **LIVE** — `leadIntelligenceReadService.ts:241,292` |
| `leadUnderstanding/engines/recommendation.ts` (LI-C207) | evidence-backed NBA inside the Understanding assembly | **DARK** — `LEAD_UNDERSTANDING_ENABLED` absent |

**Resolution — by consistent application of the already-frozen C-3/C-4 pattern (canonical + retained legacy),
not a new product call:**

- **Canonical for FR-24:** `engines/recommendation.ts` — it is evidence-backed, abstains, and emits inside the
  explainable Understanding, which is what BR-30 and FR-24 require.
- **`leadActions.buildLeadActionPlan`: RETAINED, live, legacy read-side.** It serves the existing Lead
  Intelligence UI today and must not be deleted or duplicated.
- **Prohibited:** a *third* recommendation producer.

**Flagged for override:** if the product intent is that `leadActions` remains canonical, say so and WS-8 will
invert this. Nothing depends on the choice until `LEAD_UNDERSTANDING_ENABLED` is activated.

---

## 15. BR registry — BR-01…BR-30

| BR | Title | FRs | Classification |
|---|---|---|---|
| BR-01 | Automatic Prospect Repository | FR-01, FR-03, FR-05 | PARTIALLY SATISFIED — data/population gap |
| BR-02 | Multi-source Discovery | FR-01, FR-02, FR-08 | PARTIALLY SATISFIED — external provider gap |
| BR-03 | Partial Records | FR-06, FR-10, FR-11 | FULLY SATISFIED |
| BR-04 | Company-first Prospecting | FR-04, FR-23 | REQUIRES EXTENSION |
| BR-05 | Person-first Prospecting | FR-03, FR-05 | FULLY SATISFIED |
| BR-06 | Import | FR-28 | FULLY SATISFIED |
| BR-07 | Sales Navigator | FR-02, FR-08 | **BLOCKED BY EXTERNAL AUTHORIZATION** |
| BR-08 | Provider-agnostic Enrichment | FR-07, FR-08, FR-10 | REQUIRES NEW IMPLEMENTATION (CREATE-1) |
| BR-09 | Automatic Background Enrichment | FR-07, FR-09 | REQUIRES NEW IMPLEMENTATION |
| BR-10 | Completeness | FR-11, FR-13 | FULLY SATISFIED |
| BR-11 | Freshness | FR-12, FR-13 | FULLY SATISFIED |
| BR-12 | Provenance | FR-06 | FULLY SATISFIED |
| BR-13 | Deduplication | FR-05 | FULLY SATISFIED |
| BR-14 | Company ICP | FR-16 | REQUIRES EXTENSION (attributes) |
| BR-15 | Person ICP | FR-17 | REQUIRES EXTENSION (attributes) |
| BR-16 | AI-generated ICP | FR-16, FR-17 | PARTIALLY SATISFIED — schema exists, proposer does not |
| BR-17 | Conversational ICP Control | FR-29 | REQUIRES NEW IMPLEMENTATION |
| BR-18 | ICP Learning | FR-30 | REQUIRES NEW IMPLEMENTATION — data gap |
| BR-19 | Scoring | FR-18 | FULLY SATISFIED (runtime dark) |
| BR-20 | Prospect Journey | FR-15 | PARTIALLY SATISFIED |
| BR-21 | Outreach History | FR-26 | FULLY SATISFIED |
| BR-22 | Suppression | FR-27 | FULLY SATISFIED |
| BR-23 | Next Best Action | FR-24 | FULLY SATISFIED (C-7; runtime dark) |
| BR-24 | Account Intelligence | FR-04, FR-22, FR-23 | REQUIRES INTEGRATION |
| BR-25 | Buying Committee | FR-21, FR-22 | PARTIALLY SATISFIED |
| BR-26 | Outreach Readiness | FR-25 | REQUIRES EXTENSION |
| BR-27 | Learning | FR-30 | REQUIRES NEW IMPLEMENTATION — data gap |
| BR-28 | Data Maintenance | FR-12, FR-13 | REQUIRES EXTENSION |
| BR-29 | Minimum User Effort | FR-01, FR-07, FR-29 | PARTIALLY SATISFIED |
| BR-30 | Explainability | FR-13, FR-24 | FULLY SATISFIED |

## 16. FR registry — FR-01…FR-30 → entity / repository / owner / status

| FR | Title | Canonical entity / API | Repository location | WS | Status |
|---|---|---|---|---|---|
| FR-01 | Intake | ingestion orchestrator | `leadIngestion/orchestrator.ts` | WS-4 | EXISTS |
| FR-02 | Source Contract | `LeadSourceAdapter` | `leadIngestion/registry.ts`, `contracts.ts` | WS-4 | EXISTS |
| FR-03 | Canonical Prospect | `canonical_leads` | table + writers (C-2) | WS-1 | EXISTS |
| FR-04 | Canonical Account | `prospect_accounts` | `prospectIdentity/accountResolution.ts` | WS-1 | EXISTS (0 rows) |
| FR-05 | Identity Resolution | `unified_persons` | `identityResolutionService.resolveUnifiedPerson`, `personDuplicates.ts` | WS-1 | EXISTS |
| FR-06 | Source Observations | `source_records`/`source_assertions` | `prospectIdentity/ingestionBoundary.ts` | WS-2 | EXISTS (0 rows) |
| FR-07 | Enrichment Planner | — | **future** `enrichment/planner` | WS-2 | NOT YET IMPLEMENTED |
| FR-08 | Provider Selection | provider registry | `intelligence/providerRegistry.ts` | WS-11 | PARTIAL — no people adapter |
| FR-09 | Cost Awareness | — | **future**, reuse cost telemetry | WS-11 | NOT YET IMPLEMENTED |
| FR-10 | Enrichment Result | LI-2 boundary + facets | `ingestionBoundary.ts`, `engines/enrichment.ts` | WS-2 | PARTIAL |
| FR-11 | Completeness | quality scorecard | `engines/quality.ts` (LI-C211) | WS-6 | EXISTS |
| FR-12 | Freshness | `observed_at`/`last_verified_at` | `attributes.ts`, `engines/quality.ts` | WS-2 | EXISTS |
| FR-13 | Data Health | quality + explainability | `engines/quality.ts`, `engines/explainability.ts` | WS-6 | EXISTS |
| FR-14 | Timeline | engagement timeline | `engagement_threads`/`engagement_messages` | WS-5 | EXISTS |
| FR-15 | Journey State | `journeyState` | `leadIntelligenceOrchestration/orchestrator.ts` | WS-4 | PARTIAL |
| FR-16 | Company ICP | `prospect_icps` account criteria | `prospectIcp/criteria.ts` ACCOUNT surface | WS-6 | EXTEND |
| FR-17 | Person ICP | `prospect_icps` person criteria | `prospectIcp/criteria.ts` PERSON surface | WS-6 | EXTEND |
| FR-18 | Composite Priority | `priority` dimension | `engines/prioritization.ts` (LI-C206) | WS-6 | EXISTS |
| FR-19 | Intent | `intent` dimension | `engines/intent.ts` (LI-C203) | WS-6 | EXISTS |
| FR-20 | Engagement | engagement contributor | `engines/behavioral.ts`, `lead_signals` | WS-5 | EXISTS |
| FR-21 | Buying Role | relationship graph edges | `engines/relationship.ts` (LI-C204) | WS-7 | PARTIAL |
| FR-22 | Buying Committee | stakeholder facet | `engines/relationship.ts` | WS-7 | PARTIAL |
| FR-23 | Multi-contact Account | `unified_persons.account_id` | `accountResolution.attachPersonToAccount` | WS-7 | EXISTS |
| FR-24 | Next Best Action | recommendation contributor | `engines/recommendation.ts` (LI-C207) — **C-7** | WS-8 | EXISTS (dark) |
| FR-25 | Outreach Readiness Contract | readiness contract | `engines/authoritativeReadiness.ts` | WS-8 | EXTEND |
| FR-26 | Outreach Feedback | `outreach_outcomes` | `leadOutreachExecution/feedbackIngestion.ts` + `POST /api/outreach/outcomes` | WS-8 | EXISTS |
| FR-27 | Suppression | `contact_governance_records` | `contactGovernance.mayContact` | WS-2 | EXISTS |
| FR-28 | Import | csv adapter | `leadIngestion/adapters/csvAdapter.ts` | WS-9 | EXISTS |
| FR-29 | Conversational Control | — | **future** | WS-10 | NOT YET IMPLEMENTED |
| FR-30 | Learning | — | **future**, from `outreach_outcomes` | WS-6 | NOT YET IMPLEMENTED — data gap |

**Acceptance criteria + test requirement per FR:** each FR's acceptance criterion is its BR's intent; the test
requirement is the existing suite where status is EXISTS (e.g. FR-05 → `prospectIdentityAccountResolution`,
`li4dIngestionFoundation`; FR-26 → `ws3Milestone7Feedback`, `piP1W09DManualOutcomeRoute`; FR-27 →
`piP1W06GovernanceDedupObservability`, `contactGovernanceEvaluator`), and a new focused suite owned by the
listed WS where status is EXTEND/CREATE/NOT YET IMPLEMENTED. **WS-12 owns one final cross-workstream validation.**

## 17. Field-level mapping (evidence-supported extent)

Tenant scope for every row below: composite key on `company_id` / `organization_id`. Conflict policy is LI-2:
**RULE A** one uncontested value applies · **RULE B** disagreeing sources withhold · **RULE C** an existing
canonical value is never overwritten.

| FR | Entity | Canonical field | Physical | Type | Req | Source | Provenance | Fresh | WS | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| FR-03 | Prospect | prospect_id | `canonical_leads.id` | uuid | yes | intake | — | `created_at` | WS-1 | EXISTS |
| FR-03 | Prospect | external key | `canonical_leads.external_lead_key` | text | yes | source | source | — | WS-1 | EXISTS |
| FR-15 | Prospect | lifecycle | `canonical_leads.lead_status` | text | yes | derived | — | — | WS-4 | EXISTS |
| FR-18 | Prospect | qualification | `canonical_leads.qualification_score` | numeric | no | derived | engines | — | WS-6 | EXISTS |
| FR-05 | Person | person_id | `unified_persons.id` | uuid | yes | resolver | `identity_claims` | `updated_at` | WS-1 | EXISTS |
| FR-05 | Person | email / phone | `unified_persons.primary_email` / `primary_phone` | text | no | source | claims | — | WS-1 | EXISTS |
| FR-05 | Person | external keys | `unified_persons.external_keys` | jsonb | no | provider | claims | — | WS-1 | EXISTS |
| FR-17 | Person | job_title / department / seniority | `unified_persons.*` | text | no | source | `attributes_source` | `attributes_updated_at` | WS-2 | EXISTS |
| FR-17 | Person | country/region/city | `unified_persons.*` | text | no | source | as above | as above | WS-2 | EXISTS |
| FR-23 | Person | account link | `unified_persons.account_id` | uuid | no | resolver | — | — | WS-1 | EXISTS |
| FR-04 | Account | account_id | `prospect_accounts.id` | uuid | yes | resolver | `metadata` | `first_seen_at` | WS-1 | EXISTS |
| FR-04 | Account | domain | `prospect_accounts.domain_normalized` | text | no | source | — | `last_verified_at` | WS-1 | EXISTS |
| FR-16 | Account | industry | `prospect_accounts.industry` | text | no | provider | `attributes_source` | `attributes_updated_at` | WS-2 | EXISTS |
| FR-16 | Account | employee_count / band | `prospect_accounts.*` | int/text | no | provider | as above | as above | WS-2 | EXISTS |
| FR-16 | Account | annual_revenue / revenue_band | `prospect_accounts.*` | numeric/text | no | provider | as above | as above | WS-2 | EXISTS |
| FR-16 | Account | founded_year / technologies | `prospect_accounts.*` | int/jsonb | no | provider | as above | as above | WS-2 | EXISTS |
| FR-16 | Account | funding_stage / last_funding_at | `prospect_accounts.*` | text/ts | no | provider | as above | as above | WS-2 | EXISTS |
| FR-06 | Observation | source record | `source_records.*` | — | yes | any source | itself | `observed_at` | WS-2 | EXISTS |
| FR-06 | Observation | assertion + confidence | `source_assertions.*` | — | yes | any source | itself | `observed_at` | WS-2 | EXISTS |
| FR-27 | Suppression | governance type / channel | `contact_governance_records.*` | text | yes | operator/provider | itself | `effective_from` | WS-2 | EXISTS |
| FR-26 | Outcome | outcome_type / derived | `outreach_outcomes.*` | text/bool | yes | feedback | `source`,`provider` | `occurred_at` | WS-8 | EXISTS |
| FR-16 | Account | **market** | — | — | — | — | — | — | WS-6 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-16 | Account | **business_model** | — | — | — | — | — | — | WS-6 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-16 | Account | **product/service alignment** | — | — | — | — | — | — | WS-6 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-16 | Account | **growth** | — | — | — | — | — | — | WS-6 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-21 | Person | **authority** | — | — | — | — | — | — | WS-7 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-21 | Person | **influence** | — | — | — | — | — | — | WS-7 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-21 | Person | **buying_role** | — | — | — | — | — | — | WS-7 | **REQUIRED — NOT YET IMPLEMENTED** |
| FR-17 | Person | **problem relevance** | — | — | — | — | — | — | WS-6 | **REQUIRED — NOT YET IMPLEMENTED** |

New ICP attributes must be added to the **closed criterion vocabulary** in `prospectIcp/criteria.ts` — an ICP
may only speak about attributes the platform stores, or the criterion is permanently `unknown`.

## 18. Gap analysis by class

| Class | Requirements |
|---|---|
| **ARCHITECTURAL GAP** | **NONE.** Every FR has a named canonical owner and seam. |
| **IMPLEMENTATION GAP** | FR-07, FR-09, FR-29, FR-30; BR-16 proposer; BR-17; ICP attribute extension (FR-16/17); FR-21/22 role vocabulary; FR-25 readiness contract shape |
| **DATA / POPULATION GAP** | BR-01, BR-18, BR-27; FR-04, FR-06 (0 rows); FR-30 (no outcome corpus). *Built and unexercised — not absent engineering.* |
| **EXTERNAL PROVIDER / AUTHORIZATION GAP** | BR-07 (Sales Navigator), BR-08, BR-09, FR-08 — no authorized or operational people-data provider |
| **PRODUCT DECISION** | tenant outreach enablement; ICP ratification; `LEAD_UNDERSTANDING_ENABLED` activation; C-7 override (if any); `__global__` suppression consolidation |

## 19. Acceptance criteria mapping

| AC | Requirement | Frozen mechanism | Status |
|---|---|---|---|
| AC-01 | Automatic collection | FR-01/02 orchestrator + adapters | mechanism EXISTS; awaits source population |
| AC-02 | Enrich without destroying | FR-10 — LI-2 RULE C never overwrites canonical | EXISTS |
| AC-03 | Safe identity/dedup | FR-05 — deterministic keys; ambiguity parks, never merges | EXISTS |
| AC-04 | Provenance preserved | FR-06 — `source_records`/`source_assertions` | EXISTS |
| AC-05 | Confidence + freshness | FR-11/12 | EXISTS |
| AC-06 | Stale identifiable | FR-12/13 — `engines/quality.ts` | EXISTS |
| AC-07 | Duplicates detected safely | FR-05 — `person_duplicate_candidates`, parks only | EXISTS |
| AC-08 | Deterministic + explainable scores | FR-18 + `engines/explainability.ts`; injected clock | EXISTS |
| AC-09 | Actionable + suppression-aware | FR-24 + FR-27; **suppression overrides positive scoring** | EXISTS (dark) |
| AC-10 | Multi-contact account | FR-23 — `unified_persons.account_id` | EXISTS |
| AC-11 | Outcomes never rewrite history | FR-26 — append-only, dual idempotency, `derived` flag | EXISTS |
| AC-12 | Workstreams integrate without conflict | §10 ownership + §11 collision rules + WS-12 | FROZEN |

## 20. Final contract-freeze gate

☑ Playbook V2 governing · ☑ BR-01…BR-30 mapped · ☑ FR-01…FR-30 mapped · ☑ BR→FR traceability ·
☑ FR→entity/API/workstream · ☑ field mapping to evidence-supported extent · ☑ C-1…C-7 resolved ·
☑ canonical Prospect / Account / Person frozen · ☑ ICP · ☑ scoring · ☑ enrichment · ☑ recommendation ·
☑ readiness · ☑ outcome · ☑ suppression precedence · ☑ tenant boundaries · ☑ provider states ·
☑ workstream ownership · ☑ dependency graph · ☑ Do-Not-Build register · ☑ CREATE evidenced ·
☑ RETIRE evidenced (none asserted) · ☑ no architectural contradiction remains

# CONTRACT FREEZE STATUS: READY

Nothing above is blocked on an unresolved contract, ownership question or architectural contradiction. What
remains is implementation, data population, product decisions and one external-authorization dependency
(BR-07) — none of which is a freeze blocker.

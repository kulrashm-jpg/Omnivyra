# OmniVyra Prospect Intelligence — Implementation Manifest 001

**Status:** CONTRACT FREEZE — **BLOCKED** (one condition; see §16)
**Authoritative artifact** for every future implementation workstream.
**Base:** `origin/main` = `44b2dcbe` · **Baseline audit:** `BASELINE-AUDIT-001.md` @ `6078dd49`
**Date:** 2026-09-03 · Contract work only — no application code, schema, migration or production change.

---

## 0. Governing specification — status

The task states the *Prospect Intelligence AI Implementation Playbook V2* is "supplied with this task".
**No document was attached.** The task body itself, however, carries substantive contract content, and it is
treated as governing for everything it defines:

| Contract content taken as governing | From |
|---|---|
| Target product contract, intelligence loop | §2 |
| Product boundary (PI decides WHAT / Outreach decides HOW-WHEN) | §3 |
| C-2 product decision (`canonical_leads` canonical) | §4 |
| Canonical entity list | §10 |
| ICP dimensions (company + person) | §7 |
| Scoring dimensions | §15 |
| NBA / readiness / outcome / import contracts | §16–§19 |
| Acceptance criteria AC-01…AC-12 | §31 |
| Workstreams WS-0…WS-12, collision rules, Do-Not-Build | §26–§29 |

**What remains genuinely missing:** a numbered **BR/FR set**. §30 requires *"Every BR must map to one or more
FRs"* and every FR to an owner, location, acceptance criterion and test. There are no BR/FR identifiers to map.
This is the sole outstanding freeze condition (§16). Every other contract below is frozen.

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

All conditions met **except one**:

- ☑ baseline audit incorporated · ☑ C-1…C-6 resolved · ☑ canonical Prospect / Account / Person defined
- ☑ source-observation model · ☑ API + DB ownership · ☑ provider status · ☑ enrichment / ICP / scoring /
  recommendation / readiness / outcome contracts · ☑ tenant boundaries · ☑ CREATE and RETIRE evidenced
- ☑ dependency graph · ☑ workstream ownership · ☑ collision rules · ☑ Do-Not-Build register
- ☑ no critical architectural contradiction remains
- ☐ **Playbook V2 incorporated** — no document supplied; body content used
- ☐ **Traceability established** — §30 requires BR→FR→owner→location→acceptance→test; **no BR/FR set exists**
- ☐ **Field-level mapping complete** — §24 requires mapping to the Playbook's canonical fields; the
  evidence-supported half is in §2/§C-4 above, but the Playbook-side field list is unavailable

**CONTRACT FREEZE STATUS: BLOCKED** — on the BR/FR requirement set.

---

*Contract work only. No application code, schema, migration, API, provider, UI, production data or
deployment was modified.*

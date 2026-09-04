# OmniVyra Prospect Intelligence — Baseline Audit 001

**Type:** AUDIT ONLY — no application behaviour changed
**Audited at:** `origin/main` = `44b2dcbe90e64e407f5665f1a7f2dedc3c2c7af9`
**Date:** 2026-09-03
**Production evidence:** read-only queries against `klkiseupptzbecbxwrky`

---

## 0. Two blocking conditions, stated first

### 0.1 The governing specification is not available

The audit brief names *"the OmniVyra Prospect Intelligence AI Implementation Playbook V2"* as the governing
specification. **It does not exist in this repository and was not supplied.**

Searched: filenames matching `*playbook*`, `*BRS*`, `*FRS*`; and file contents for
`implementation playbook` / `prospect intelligence.*playbook` across all `.md`.
Every hit is an unrelated feature — `customerSuccessPlaybookService.ts`,
`engagementPlaybookService.ts`, `community-ai/playbooks`, `viralityPlaybookContract.ts`.

**Consequence:** required artifact **§23.K Gap Analysis** cannot be produced. It requires mapping
*"every BRS/FRS requirement"* to EXISTS/PARTIAL/MISSING/CONFLICTING/UNKNOWN, and there is no requirement
set to map. Producing it from the brief's prose would be inventing the specification, which §3 forbids
(*"Do not treat documentation as proof"*) and which would silently become the contract at freeze.

Sections 2–22 audit **what exists in the repository** and are largely answerable without the Playbook.
Those are covered below.

### 0.2 Scope versus a single audit pass

| Surface | Count |
|---|---|
| Tracked files | 11,184 |
| `backend/services` files (112 subdirs) | 3,012 |
| `pages/api` routes | 1,329 |
| Migrations | 397 |
| **Public tables (production)** | **832** |
| Test files | 1,496 |
| Components | 711 |

This document is an **honest partial baseline**: the PI-critical spine is audited to the evidence standard
the brief demands, and the wider surface is audited at reconnaissance depth with findings marked as such.
Coverage is declared per section. Nothing is asserted without a repository path or a production count.

---

## 1. Executive summary — what OmniVyra already has

**The canonical prospect spine already exists and is largely shipped.** It was built across W1–W6 plus
LI-1…LI-5 and WS-3/WS-6A. The dominant finding of this audit is **not** that capability is missing — it is
that capability is **built and unexercised**, and that several **duplicate generations** of the same concept
coexist, one live and one dormant.

Three facts frame everything below:

1. **The write path is complete and the data is absent.** `prospect_accounts`, `source_records`,
   `source_assertions`, `prospect_icps`, `contact_governance_records`, `outreach_tasks`,
   `outreach_outcomes`, `lead_intelligence_profiles` are **all 0 rows** with fully implemented writers.
2. **Duplicate generations are the main architectural risk**, not missing engines. MarketPulse, leads,
   suppression, and person identity each have 2–4 competing representations.
3. **No people/firmographic enrichment provider exists at all.** The provider abstraction exists; every
   people-data provider is `available: false` by explicit declaration.

---

## 2. Canonical entity registry (§4, §23.B)

**Coverage: high — production table inventory + writer tracing.**

| Entity | Existing implementation | Canonical? | Tenant scoped? | Rows | Proposed role |
|---|---|---|---|---|---|
| Tenant / Organization | `companies` | **canonical** | is the tenant | 40 | KEEP — never a prospect |
| Person (canonical) | `unified_persons` | **canonical** | `company_id` | 23 | KEEP — the spine |
| Person (social) | `contacts` | source-specific | yes | 10 | KEEP — `unified_person_id` edge exists |
| Person (engagement) | `engagement_authors` | source-specific | yes | 13 | EXTEND — resolve to spine |
| Person (candidate) | `engagement_identity_candidates` | derived | yes | 3 | KEEP |
| Prospect account | `prospect_accounts` | **canonical** | `organization_id` | **0** | KEEP — dormant |
| Lead (capture) | `leads` | partially canonical | yes | 18 | see §3 conflict |
| Lead (canonical) | `canonical_leads` | ambiguous | yes | 18 | see §3 conflict |
| Lead (signal) | `lead_intelligence` | derived | yes | 18 | see §3 conflict |
| Lead (envelope) | `lead_intelligence_profiles` | **canonical** for PI | yes | **0** | KEEP — authoritative for outreach |
| Lead (rollup) | `active_leads` | derived | yes | **0** | KEEP |
| Identity claim | `identity_claims` | **canonical** | yes | 42 | KEEP |
| Provenance | `source_records` / `source_assertions` | **canonical** | yes | **0 / 0** | KEEP — dormant |
| ICP | `prospect_icps` / `prospect_icp_versions` | **canonical** | yes | **0 / 0** | KEEP — immutable, versioned |
| Suppression | 4 competing tables | **ambiguous** | yes | all 0 | see §3 conflict |
| Outreach task | `outreach_tasks` | **canonical** | yes | **0** | KEEP |
| Outcome | `outreach_outcomes` | **canonical** | yes | **0** | KEEP |
| Opportunity | `opportunity_feed_items` + `opportunity_lifecycle_states` | source-specific (MarketPulse) | yes | 0 / 0 | **NOT a prospect opportunity** |
| Engagement | `engagement_threads` / `engagement_messages` | **canonical** | yes | **126 / 125** | KEEP — the only live signal source |

**Source of truth for `materializeOutreachForLead`** is `lead_intelligence_profiles`, not `lead_intelligence`.
Evidence: `leadOutreachActivation.ts:145` → `getPersistedLeadIntelligence` →
`leadIntelligenceOrchestration/persistence.ts:104` → `LEAD_INTELLIGENCE_PROFILES_TABLE`.

---

## 3. Conflict register (§23.H) — the material findings

### C-1 · MarketPulse exists in two generations, one live and one dormant — **HIGH**

| Family | Writers | Rows |
|---|---|---|
| `market_pulse_*` (live) | `backend/services/marketPulse/**` (`changeIntelligenceService`, `executivePanelsService`, `crossProductCorrelationService`) | `market_pulse_findings` **78**, `market_pulse_items_v1` **78** |
| `marketpulse_*` (dormant) | `marketPulseIntelligenceService.ts`, `marketPulseSynthesisService.ts` | `marketpulse_signals` **0** — and **45 tables** in this family |

**Authoritative: `market_pulse_*`** — it is the one with data and an actively maintained service directory.
The `marketpulse_*` family is a 45-table declared-but-unpopulated schema.
**Disposition: INVESTIGATE before any PI consumption.** PI must read the live family. Do **not** populate the
dormant family for convenience. Retirement is a separate decision requiring consumer analysis not done here.

### C-2 · Three co-populated lead tables at exactly 18 rows — **HIGH**

`leads` (18), `canonical_leads` (18), `lead_intelligence` (18) — identical cardinality, different writers:

- `leads` — broad consumers (`activationReadinessService`, `campaignBlueprintAdapter`, `campaignRecommendationService`)
- `canonical_leads` — `crmIngestionService`, `ingestionScheduler`, `advancedRevenueAttributionIntelligenceService`
- `lead_intelligence` — `leadIntelligence/leadIntelligenceRepository.ts`, `websiteIntelligence/websiteIntelligenceRepository.ts`

**Unresolved: which is the source of truth for a "lead".** The name `canonical_leads` asserts canonicality that
the writer set does not obviously support, and `lead_intelligence` carries `unified_person_id` (the spine edge)
while `leads` carries the capture record. **This must be resolved before contract freeze** — it is the single
most consequential open question in this audit.

### C-3 · Four competing suppression models, all empty — **HIGH**

`consent_records` (0), `contact_governance_records` (0), `outreach_suppressions` (0), `suppression_entries` (0).

`execution/suppressionService.ts` already reconciles two of them: canonical
(`contact_governance_records` via `mayContact`) first, then legacy (`suppression_entries`) — the legacy store
retained because it holds the `__global__` scope the canonical model cannot express. `consent_records` is
explicitly **excluded** as an OAuth/platform-capability ledger (a different domain), asserted by test.

**Authoritative: `contact_governance_records`** via `prospectIdentity/contactGovernance.mayContact` — the
single evaluator. **Disposition: MERGE (`suppression_entries` → canonical) pending the `__global__` product
decision; `outreach_suppressions` needs a consumer check not performed here.**

### C-4 · Two ICP contributors into one scoring dimension — **MEDIUM, by design**

`leadUnderstanding/engines/personaIcp.ts` (pre-existing) and `engines/prospectIcpFit.ts` (W03) both emit into
the `icp` dimension and run side by side at `engines/assembly.ts:51`. This was deliberate — W03 chose to land
in *"the dimension that already exists rather than opening a second one"*. **Not a defect; record it so a
future reader does not "fix" it.**

### C-5 · Versioned duplication in lead signals — **MEDIUM**

`lead_signals` (10) and `lead_signals_v1` (6) are both populated. Also present: `lead_jobs_v1` (8),
`lead_intent_clusters_v1` (0), `lead_platform_stats_v1` (0). A `_v1` family coexisting with an unsuffixed
family, both live. **Unresolved.**

### C-6 · Two outreach plan tables — **MEDIUM**

`lead_outreach_plans` (0) and `outreach_plans` (0), alongside the live `outreach_tasks` model. Both empty.
**Unresolved; low urgency because both are dormant.**

---

## 4. Provider / connection map (§23.F, §9, §10)

**Coverage: high — the repository has an authoritative availability registry.**

`backend/services/integrations/dataSourceCatalogue.ts:24-25` states it plainly:

> *"Every provider below is `available: false` — declared, not implemented. The three exceptions are
> `manual`, `crm` and `csv`, which are genuinely released"*

| Source | Group | `available` | Reality |
|---|---|---|---|
| `manual` | prospect_discovery | **true** | LI-5E.2 adapter, released |
| `crm` | crm_import | **true** | LI-5E.4 adapter, released |
| `csv` | crm_import | **true** | W02 adapter, released |
| `linkedin_sales_navigator` | prospect_discovery | **false** | **declared only** |
| `apollo` / `apollo_enrichment` | discovery / enrichment | **false** | **declared only** |
| `zoominfo` / `zoominfo_enrichment` | discovery / enrichment | **false** | **declared only** |

**Sales Navigator: no implementation exists** — no scraping, no credential storage, no client. This is the
correct posture and must not be "fixed" by adding one. Classify as **POSSIBLE FUTURE INTEGRATION**, and any
approach relying on session-credential storage or scraping is **UNSUPPORTED**.

**LinkedIn does exist — for the wrong purpose.** 13 files (`platformAdapters/linkedinAdapter.ts`,
`platformConnectors/linkedinConnector.ts`, `postDiscoveryConnectors/linkedinConnector.ts`,
`pages/api/auth/linkedin/callback.ts`) serve **publishing, engagement and OAuth**, not people enrichment.
Do not mistake this for prospect-data capability.

**A provider abstraction already exists and must not be rebuilt:**
`intelligence/providerInterfaces.ts` + `intelligence/providerRegistry.ts` + `intelligence/adapters/**`.
Its adapters are **LLM/SEO/reputation only** (`openaiAdapter`, `anthropicAdapter`, `geminiAdapter`,
`ahrefsAdapter`, `benchmarkDatasetAdapter`). **There is no people/firmographic adapter anywhere.**

**Provider-neutrality is actively enforced.** `leadIngestion/orchestrator.ts:14`: *"There is no
`if (source === 'apollo')` here and there never may be"* — with a guard test asserting no provider name
appears in the file. Any future provider must arrive behind `LeadSourceAdapter.translate`.

---

## 5. Extension point register (§23.J)

The exact seams PI should extend rather than replace:

| Concern | Extension point | Rule |
|---|---|---|
| New source | `leadIngestion/registry.ts` → `registerLeadSourceAdapter` | `translate` is **synchronous** by contract |
| Person identity | `identityResolutionService.resolveUnifiedPerson` | the **sole** resolve-or-create path |
| Account identity | `prospectIdentity/accountResolution.ts` | provider-ref or domain only; **never name** |
| Provenance | `prospectIdentity/ingestionBoundary.ts` → `ingestSourceRecord` | the **sole** evidence writer |
| Dedup | `prospectIdentity/personDuplicates.ts` | parks, **never merges** |
| Governance | `prospectIdentity/contactGovernance.mayContact` | pure evaluator; **no I/O, no second engine** |
| ICP policy | `prospectIcp/**` | versioned, immutable, human-ratified |
| Scoring | `leadUnderstanding/engines/**` + `assembly.ts` | contribute to an existing dimension |
| Outreach | `leadOutreachActivation.ts` | **adds no queue** — the lifecycle is the state machine |
| Feedback | `leadOutreachExecution/feedbackIngestion.ts` → `ingestFeedback` | **sole** outcome write path |
| Observability | `prospectIdentity/telemetry.ts`, `leadOutreachExecution/telemetry.ts` | HARDEN-001 registry; bounded labels, no tenant |
| Tenant authz | `backend/security/TenantGuard.requireTenantAccess` | canonical for new routes |

---

## 6. DO NOT BUILD register (§24)

| Capability | Existing authority — reuse this | Evidence |
|---|---|---|
| Prospect / Person entity | `unified_persons` + `identityResolutionService` | 23 rows, 42 claims |
| Account entity | `prospect_accounts` + `accountResolution.ts` | tenant-safe composite FK in prod |
| Lead entity | **UNRESOLVED — see C-2** | do not add a fourth |
| MarketPulse storage | `market_pulse_*` via `services/marketPulse/**` | 78 rows |
| Engagement timeline | `engagement_threads` / `engagement_messages` | 126 / 125 |
| Scoring engine | `leadUnderstanding/engines/**` (5 dimensions) | `SCORE_DIMENSIONS` |
| ICP engine | `prospectIcp/**` | immutable versioned policy |
| Enrichment abstraction | `intelligence/providerRegistry.ts` | exists; lacks people adapters |
| Provider framework | `leadIngestion/registry.ts` | closed-list, guard-tested |
| Tenant identity | `TenantGuard` | canonical |
| Outreach history | `outreach_tasks`/`attempts`/`approvals`/`decisions`/`delivery_evidence`/`outcomes` | complete model |
| Suppression | `contact_governance_records` + `mayContact` | canonical evaluator |
| Dedup mechanism | `person_duplicate_candidates` + DB unique indexes | never merges |
| Outcome corpus | `outreach_outcomes` | dual idempotency keys |

---

## 7. Gap classification for the PI spine (§22 disposition)

| # | Capability | Status | Blocker type | Disposition |
|---|---|---|---|---|
| G1 | Canonical identity | shipped | — | KEEP |
| G2 | Provenance | built, 0 rows | **input population** | KEEP |
| G3 | Ingestion orchestration | shipped, flag ON | **input population** | KEEP |
| G4 | Source adapters | 3 of N released | commercial (providers) | EXTEND |
| G5 | Account population | built, 0 rows | **input population** | KEEP |
| G6 | Dedup | built, 0 rows | **input population** | KEEP |
| G7 | Governance | built, 0 rows | **input population** | MERGE (C-3) |
| G8 | Social → person | shipped + wired | — | KEEP |
| G9 | ICP storage | shipped, 0 ratified | **operational** | KEEP |
| G10 | ICP → scoring | shipped, **runtime dark** | **operational** (`LEAD_UNDERSTANDING_ENABLED`) | KEEP |
| G11 | Outreach producer | shipped + reachable | **operational** (tenant enablement) | KEEP |
| G12 | People/firmographic enrichment | **absent** | **commercial decision** | CREATE (post-decision) |
| G13 | Learning from outcomes | absent | needs outcome corpus | defer |
| G14 | Buying committee | absent | needs G5 data | defer |

**Not one PI-spine gap is classified "missing engineering."** Every gap is input population, an operational
decision, or a commercial decision.

---

## 8. Coverage declaration — what this audit does NOT yet cover

Stated explicitly so the freeze decision is informed rather than assumed:

| Brief section | Status |
|---|---|
| §23.C Field-level mapping | **NOT DONE** — requires the Playbook's canonical field list |
| §23.K Gap analysis vs BRS/FRS | **BLOCKED** — no BRS/FRS (§0.1) |
| §23.D Full DB map (832 tables) | **PARTIAL** — PI-relevant tables only; indexes/FKs/triggers not exhaustively mapped |
| §23.E API map (1,329 routes) | **PARTIAL** — PI routes traced; full inventory not built |
| §23.G Full lineage map | **PARTIAL** — PI spine traced end to end; other domains not |
| §23.I Dependency graph | **PARTIAL** |
| §23.L / §23.M Parallel plan + ownership | **NOT DONE** — depends on C-2 resolution |
| §21 Dormant/dead code | **PARTIAL** — the dormant `marketpulse_*` family identified; no repo-wide sweep |
| §17 Data quality | **NOT DONE** |
| §19 Full lineage per field | **NOT DONE** |
| A, E–H, N, O, AB, AI (UI/cache/etc.) | **RECONNAISSANCE ONLY** |

---

## 9. Highest risks

1. **C-2 — the lead triple.** Three tables, 18 rows each, three writer families, one named "canonical".
   Freezing a contract before this is resolved risks binding PI to the wrong source of truth.
2. **C-1 — 45 dormant MarketPulse tables.** A large declared schema with no data invites accidental adoption.
3. **C-3 — four suppression models.** Compliance-bearing. Currently reconciled in code but not in schema.
4. **The whole spine is unexercised.** Every writer is unproven against real data; correctness is asserted by
   tests, not by production behaviour.
5. **No people-data provider exists**, and the three released sources are all operator-supplied — so PI
   currently has no way to *discover* a prospect, only to *record* one.

---

## 10. Recommended sequence before contract freeze

1. Supply the **Playbook V2 / BRS / FRS** — without it §23.C and §23.K cannot exist.
2. Resolve **C-2** (lead source of truth) — blocks the canonical entity contract.
3. Resolve **C-1** and **C-3** dispositions.
4. Complete field-level mapping against the supplied spec.
5. Then, and only then, freeze.

---

*Audit only. No application code, schema, migration, configuration, deployment or production data was
modified in producing this document.*

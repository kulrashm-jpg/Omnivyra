# Prospect Intelligence — Phase-1 Derived Execution Plan

**Parent:** [`../PI-ADR-001.md`](../PI-ADR-001.md) · **Supersedes for scheduling:** [`PHASE-1-ROSTER.md`](./PHASE-1-ROSTER.md)
**Status:** PROPOSED · **Derived:** 2026-09-02 against `origin/main` `9049215a` and production `klkiseupptzbecbxwrky`

---

## 1. What this document is

The twelve original Phase-1 identifiers (`PI-A2`…`PI-G1`) remain `BLOCKED — DEFINITION UNAVAILABLE`; their objectives were never committed and are not recoverable. This document does **not** attempt to recover them.

Instead it derives a **new** Phase-1 plan from two things that *are* verifiable: the frozen architecture in PI-ADR-001 §3, and the measured gap between that architecture and what production actually does today.

Every work package below traces to a cited file, line, flag, or row count. Nothing is inferred from an identifier.

The new packages use the namespace **`PI-P1-W##`**. They do not map onto the old identifiers, and no attempt should be made to align them.

---

## 2. Verified baseline

Measured against production, not repeated from prior reports.

| Table | Rows | Reading |
|---|---|---|
| `companies` / `users` | 40 / 131 | tenant + user base is real |
| `engagement_threads` / `engagement_messages` | **126 / 125** | genuine social/engagement activity exists |
| `leads` / `canonical_leads` / `lead_intelligence` | 18 / 18 / 18 | legacy lead model populated |
| `contacts` / `lead_signals` | 10 / 10 | social chain populated |
| `unified_persons` / `identity_claims` | 23 / 42 | canonical spine seeded (W3) |
| `prospect_accounts` | **0** | account layer never populated |
| `source_records` / `source_assertions` | **0 / 0** | **no provenance has ever been recorded** |
| `contact_governance_records` | **0** | no governance record exists |
| `person_duplicate_candidates` | **0** | no dedup candidate ever parked |
| `consent_records` | **0** | unused |
| `outreach_tasks` / `outreach_decisions` | **0 / 0** | no outreach ever materialised |
| `prospect_icps` / `prospect_icp_versions` | **0 / 0** | no ICP ever defined |
| `active_leads` | 0 | derived snapshot, empty (expected) |

**The shape of the problem:** the platform has real engagement data (126 threads) and a fully built canonical spine, but **nothing flows between them**. This is not missing code. It is three closed gates.

---

## 3. Why the spine is empty — three gates, all cited

### Gate 1 — ingestion is flag-dark

`backend/services/leadIngestion/orchestrator.ts:63` reads `process.env.ENABLE_LEAD_INGESTION`.

**`ENABLE_LEAD_INGESTION` is ABSENT on Railway *and* Vercel production.** The whole ingestion path — `pages/api/lead-ingestion/{crm,manual}.ts` → `leadIngestion/orchestrator.ts` → `prospectIdentity/**` → `source_records` / `source_assertions` / `unified_persons` / `prospect_accounts` — is built, merged, deployed, and unreachable.

This single fact explains `source_records = 0` and `prospect_accounts = 0`.

### Gate 2 — outreach has no producer

`backend/queue/workerTopologyManifest.ts:69` states it plainly:

> `enqueuedBy: 'NONE YET — WS-6F wires the orchestrator enqueue (leadIntelligenceOrchestration/orchestrator.ts:378, gated AUTOMATION_RUNTIME_ENABLED)'` … `Runtime stays DARK until WS-6F.`

The `automation-tasks` consumer is registered and healthy; nothing enqueues to it. `AUTOMATION_RUNTIME_ENABLED` is also ABSENT in production. This explains `outreach_tasks = 0` and `outreach_decisions = 0`, and it means A3's person-anchoring — shipped and verified — has never executed on a real row.

### Gate 3 — the source adapter registry is empty of providers

`backend/services/leadIngestion/registry.ts:9`:

> `No provider is registered here, because no provider adapter is implemented.`

Two adapters exist as files (`crmAdapter.ts`, `manualAdapter.ts`). The architecture in PI-ADR-001 requires ingestion from Active Leads, communities, social listening, MarketPulse, LinkedIn/Sales Navigator, CSV/manual, and later Apollo/ZoomInfo. Most of that surface is absent.

### And one wiring gap — a ratified ICP influences nothing

`backend/services/prospectIcp/evaluate.ts` is consumed only by its own module and the two API routes. `personaIcp` contains **0** references to `prospectIcp`.

D1's migration said this explicitly and deliberately: *"No producer, no AI proposer, no scoring wiring."* That was correct scoping for D1. It is now the gap.

---

## 4. Gap inventory

Classification per PI-ADR-001: **shipped** · **structurally present but unused** · **partial** · **absent** · **blocked**.

| # | Capability | State | Evidence |
|---|---|---|---|
| G1 | Canonical person/account identity | **shipped** | `prospectIdentity/**` (20 modules), 23 persons, 42 claims |
| G2 | Provenance (`source_records`/`source_assertions`) | **structurally present but unused** | `ingestionBoundary.ts` complete; 0 rows — Gate 1 |
| G3 | Ingestion orchestration | **structurally present but unused** | orchestrator + 2 API routes live; Gate 1 |
| G4 | Source adapters (the named sources) | **absent** | `registry.ts:9`; Gate 3 |
| G5 | Account layer population | **structurally present but unused** | `accountResolution.ts` exists; 0 rows |
| G6 | Deduplication / parking | **structurally present but unused** | `personDuplicates.ts` exists; 0 candidates |
| G7 | Consent / suppression / governance | **structurally present but unused** | `contactGovernance*.ts`, `suppressionService.ts`; 0 records |
| G8 | Social chain → canonical person | **shipped and wired** | `canonicalLeadSignalService.ts:5` imports `resolveSocialContactIdentity` |
| G9 | Tenant versioned ICP (storage + ratification) | **shipped** | D1; migration applied and certified |
| G10 | ICP → scoring influence | **absent** | `personaIcp` ↔ `prospectIcp` = 0 refs |
| G11 | Outreach materialisation / producer | **blocked** | `workerTopologyManifest.ts:69` — WS-6F |
| G12 | Enrichment via existing providers | **partial** | `intelligence/adapters/**` is LLM/SEO/reputation; no people/firmographic provider |
| G13 | Learning ICP from outcomes | **absent** | no module; `outreach_decisions` empty so no outcome corpus exists |
| G14 | Buying committee / account intelligence | **absent** | requires G5 first |
| G15 | Next-best-action | **partial (reuse target)** | `leadActions.buildLeadActionPlan` exists per LEAD-INTELLIGENCE PHASE-A |

Documentation-only gaps are excluded, per instruction, except where absence blocks safe execution — which applies to none of the above now that PI-ADR-001 is committed.

---

## 5. Work packages

Ordering principle: **open the gates before building on them.** Every package downstream of a closed gate cannot be validated on real data until that gate opens, so gate work comes first and is cheap.

---

```text
ID:              PI-P1-W01
Name:            Activate lead ingestion in production
Objective:       Set ENABLE_LEAD_INGESTION so the already-deployed ingestion path can
                 write source_records, source_assertions and canonical identity.
Schema scope:    NONE
Existing impl:   backend/services/leadIngestion/orchestrator.ts (flag read at :63)
Code/file scope: NONE — configuration only
API scope:       NONE (pages/api/lead-ingestion/{crm,manual}.ts already deployed)
Upstream deps:   none
Downstream:      W02, W03, W05, W06, W07
Collision:       production environment variables (orchestrator-only per PI-ADR-001 §5.2)
Migration:       NO
Deployment:      YES — Railway + Vercel redeploy
Parallelisation: SERIAL (ORCHESTRATOR-ONLY)
Acceptance:      flag present on both platforms; one controlled manual ingestion produces
                 >=1 source_record and >=1 source_assertion; identity spine row counts
                 change only as the conservative resolver permits; no cross-tenant row.
Non-goals:       registering new adapters; backfilling history (PI-ADR-001 §3.1.6).
```

```text
ID:              PI-P1-W02
Name:            First real source adapter
Objective:       Implement and register one adapter for an existing internal source so
                 ingestion has a real producer rather than manual API calls.
Schema scope:    NONE (writes via ingestionBoundary only)
Existing impl:   leadIngestion/registry.ts, contracts.ts, adapters/manualAdapter.ts as the
                 reference shape; ingestionBoundary.upsertSourceRecord / recordAssertions
Code/file scope: backend/services/leadIngestion/adapters/**, registry registration site
API scope:       NONE
Upstream deps:   W01 (otherwise unverifiable)
Downstream:      W05, W06, W07
Collision:       leadIngestion/registry.ts (single registration site — serialise if two
                 adapters are built concurrently)
Migration:       NO
Deployment:      YES
Parallelisation: SERIAL with other adapter work; PARALLEL with W03/W04
Acceptance:      adapter registered; a real source batch produces source_records with
                 correct provenance; re-ingesting the same payload yields outcome
                 'unchanged' (hash stability); no person minted on ambiguous evidence.
Non-goals:       external paid providers (Apollo/ZoomInfo) — separate commercial decision.
```

```text
ID:              PI-P1-W03
Name:            Wire the ratified ICP into scoring
Objective:       Make a ratified ICP version influence lead/person scoring, so ratification
                 has a consequence.
Schema scope:    NONE — read-only against prospect_icp_versions
Existing impl:   prospectIcp/evaluate.ts (evaluator exists, unconsumed); the existing
                 scoring/intelligence infrastructure (PI-ADR-001 §3.7 requires reuse)
Code/file scope: the scoring consumer only; prospectIcp/** stays unchanged
API scope:       NONE
Upstream deps:   none (D1 shipped) — validation improves after W01
Downstream:      W06 (learning), W07
Collision:       backend/services/prospectIcp/** (read-only), scoring module
Migration:       NO
Deployment:      YES
Parallelisation: PARALLEL with W02/W04
Acceptance:      with a ratified version, scoring reflects it; with none, the evaluator
                 ABSTAINS and scoring is unchanged (PI-ADR-001 §3.6); a draft or proposed
                 version never influences scoring (§3.5).
Non-goals:       AI proposal generation; changing the ratification contract.
```

```text
ID:              PI-P1-W04
Name:            Outreach producer (WS-6F)
Objective:       Wire the orchestrator enqueue to automation-tasks so outreach
                 materialises, behind AUTOMATION_RUNTIME_ENABLED.
Schema scope:    NONE
Existing impl:   leadIntelligenceOrchestration/orchestrator.ts:378; automationTaskWorker
                 and automationTaskProcessor already registered and healthy
Code/file scope: the enqueue site only
API scope:       NONE
Upstream deps:   none structurally; meaningful only once W01 supplies prospects
Downstream:      W06, W07
Collision:       backend/queue/** topology, workerTopologyManifest.ts
Migration:       NO
Deployment:      YES — Railway (worker)
Parallelisation: SERIAL (queue topology)
Acceptance:      manifest updated from 'NONE YET'; with the flag off nothing enqueues;
                 with it on, one task materialises, A3 anchors a person_id, and governance
                 fails closed on a suppressed contact.
Non-goals:       new channels; changing governance semantics.
```

```text
ID:              PI-P1-W05
Name:            Account layer activation
Objective:       Populate prospect_accounts through the existing resolver so the account
                 layer stops being empty.
Schema scope:    prospect_accounts (write via existing resolver; no DDL expected)
Existing impl:   prospectIdentity/accountResolution.ts, attributes.ts
Code/file scope: prospectIdentity/** (ORCHESTRATOR-SERIALISED — canonical identity)
API scope:       NONE
Upstream deps:   W01, W02
Downstream:      W07 (buying committee)
Collision:       canonical identity modules — PI-ADR-001 §5.1
Migration:       NO expected — confirm before starting
Deployment:      YES
Parallelisation: SERIAL
Acceptance:      accounts created only from provider ref or domain, never from name;
                 tenant-safe composite FK holds; no cross-tenant account.
Non-goals:       firmographic enrichment; historical backfill.
```

```text
ID:              PI-P1-W06
Name:            Governance and dedup observability
Objective:       Make contact_governance_records and person_duplicate_candidates actually
                 populate, and surface both.
Schema scope:    read/write via existing writers only
Existing impl:   contactGovernanceWriter.ts, contactGovernanceRepository.ts,
                 personDuplicates.ts, execution/suppressionService.ts
Code/file scope: prospectIdentity/** (serialised), plus a read surface
API scope:       possibly one read-only route — justify before adding (§3.7)
Upstream deps:   W01, W02
Downstream:      W07
Collision:       canonical identity modules; mayContact governance path
Migration:       NO
Deployment:      YES
Parallelisation: SERIAL
Acceptance:      a suppressed contact produces a governance record and fails closed; an
                 ambiguous identity parks a duplicate candidate rather than merging (§3.1.5).
Non-goals:       repurposing consent_records (PI-ADR-001 §4 binding decision).
```

```text
ID:              PI-P1-W07
Name:            Outcome corpus for ICP learning
Objective:       Establish the outcome record that ICP learning will later consume.
Schema scope:    read-only over outreach_decisions / outreach_tasks
Existing impl:   leadOutreachExecution/feedbackIngestion.ts, feedbackSummary.ts
Code/file scope: read-side only
API scope:       NONE
Upstream deps:   W04 (no outcomes exist until outreach runs)
Downstream:      future ICP-learning package
Collision:       leadOutreachExecution/**
Migration:       NO
Deployment:      NO (read-side; ships with the next deploy)
Parallelisation: PARALLEL once W04 lands
Acceptance:      outcomes are attributable to the ratified ICP version in force at decision
                 time; abstention is recorded as abstention, never as a negative outcome.
Non-goals:       automatic ICP mutation — ratification stays human (§3.5.13).
```

---

## 6. Dependency graph

```
W01 (flag)  ──┬──> W02 (adapter) ──┬──> W05 (accounts) ──> W07 corpus
              │                    └──> W06 (governance/dedup)
              └──> (validates W03, W05, W06)

W03 (ICP -> scoring)   independent of W01; validation improves after it
W04 (outreach producer) independent structurally ──> W07
```

**Critical path:** `W01 → W02 → W05/W06`. W01 is a configuration change with no code, and it unblocks five packages.

---

## 7. Parallelisation

| Group | Packages | Note |
|---|---|---|
| **Gate (orchestrator-only)** | W01 | config + deploy; nothing else proceeds meaningfully first |
| **Parallel-safe after W01** | W03, W04 | disjoint file scopes: scoring consumer vs queue enqueue |
| **Serial** | W02 → W05 → W06 | all touch `prospectIdentity/**` or the single adapter registry |
| **Deferred** | W07 | needs real outcomes from W04 |

Serialisation of W02/W05/W06 is forced by PI-ADR-001 §5.1: they share canonical identity modules and the closed-allow-list tests that have already caused one post-merge failure in this programme.

---

## 8. What remains genuinely blocked

- The twelve original `PI-*` identifiers — unchanged, still `BLOCKED — DEFINITION UNAVAILABLE`.
- **G12 external enrichment providers** — Apollo/ZoomInfo/RapidAPI is a commercial and data-protection decision, not an engineering one.
- **G14 buying committee** — cannot be specified until W05 shows what account data actually resolves.

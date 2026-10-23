# PI-MILESTONE-A-CLOSURE-AUDIT-001

**Milestone A — Initial Prospect Intelligence Capability · evidence audit and completion plan**

| | |
|---|---|
| Mode | READ-ONLY baseline audit. No source, test, migration, config or database change. |
| Repository | `C:/tmp/r1-ctx` |
| Branch | `fix/r1-profile-context` |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches expected** |
| Worktree at audit | **115 entries — 63 modified, 52 untracked, 0 staged** (unchanged at close) |
| Date | 2026-10-17 |
| Assumed start date for all schedules | **Mon 2026-10-20** (stated assumption; no start date was supplied) |
| Audit contract | The Milestone A scope in the commissioning prompt. **The definitive PI BRS/FRS is NOT in this repository** — see §2.1. No claim of full BRS/FRS coverage is made. |

---

## 1. Executive verdict

**NOT CLOSABLE on the agreed scope as written. Closable on a reduced, explicitly approved scope.**

Two of the nine Milestone A requirements cannot be met with what exists, and neither is an engineering gap that effort alone closes:

1. **Requirement 1 — discovery/intake from MarketPulse, Active Leads and social engagement: `MISSING`.** None of the three is an ingestion source. MarketPulse is **read-only consumption** by PI; Active Leads does not feed PI at all; no social→PI intake path exists. Building any of them is new integration work, not completion work.
2. **Requirement 5 — approved provider-based enrichment: `BLOCKED_BY_EXTERNAL_DEPENDENCY`.** The Apollo enrichment adapter exists and is registered, but **no Apollo credential exists anywhere in the repository**, and the adapter supports exactly **one** attribute (`employee_count`). Requirement 5 says "only where the integration is genuinely implemented, configured and authorized" — it is implemented, **not configured, not authorized**.

**What is genuinely strong:** canonical identity, deduplication, tenant-safe persistence, provenance, ICP evaluation with honest abstention, prospect lists (certified against real PostgreSQL), suppression/consent, and an application-chain end-to-end test from intake to ranked list. Requirement 7 is the most complete item in the milestone.

**The honest reduced scope that is closable:** manual + CSV + CRM intake → identity → lists → ICP → governance → end-to-end, with enrichment declared out of scope or deferred. That is **Milestone A′**, and it needs your explicit scope exception under closure gate §8.1.

**Earliest defensible target for Milestone A′: Wed 2026-11-19** (see §7), gated on two owner/operator actions that are not engineering work.

---

## 2. Repository baseline and preservation evidence

### 2.1 Source-of-truth limitation

The commissioning prompt refers to "the supplied definitive PI BRS/FRS". **It is not in this repository.** Searched: filenames (`*definitive*`, `*BRS*`, `*business_requirement*`) — absent; content (`BR-nn` identifiers) — four PMO documents carry them, none named as the definitive spec. The governing specification named by `IMPLEMENTATION-MANIFEST-001.md` §0 is the *AI Implementation Playbook V2*, which is **absent from disk and from every commit on every ref**.

**This audit therefore uses the Milestone A scope in the commissioning prompt as its bounded contract, and makes no claim of BRS/FRS coverage.** Requirement IDs below are `MA-n`, local to this audit.

### 2.2 Hashes verified before relying on prior reports (§6)

All prior-report artifacts are byte-identical to the values those reports recorded, so WS-2 … WS-3H evidence is reliable:

| Artifact | SHA-256 (abbrev.) |
|---|---|
| `supabase/migrations/20261127000000_pi_prospect_lists.sql` | `01315600d26291f7` |
| `backend/services/prospectLists/index.ts` | `11a79994ecbdde3d` |
| `backend/services/prospectLists/store.ts` | `0878bcdf103dae0c` |
| `backend/services/prospectLists/audience.ts` | `77d1a6da6cedb632` |
| `pages/api/prospect-lists/index.ts` | `ce30f10e75816791` |
| `pages/api/prospect-lists/members.ts` | `4af0e47b95740834` |
| `backend/tests/realschema/pl_prospect_lists.test.ts` | `4705bdf87a7ec153` |
| `backend/tests/realschema/setup.ts` | `0009381f06d9d6af` |
| `backend/tests/realschema/dl_relationship_decisions.test.ts` | `dfa2e1e3ba4c7d7a` |
| `backend/services/prospectIdentity/ingestionBoundary.ts` | `cc27942da2f61a60` |
| `backend/services/prospectIdentity/relationshipAttributeIngestion.ts` | `47cbdffbf758d990` |
| `backend/services/prospectIcp/evaluate.ts` | `50b8b039d627fe2f` |
| `backend/services/prospectIcp/criteria.ts` | `c5752aca75938fc1` |
| `backend/services/prospectIdentity/contactGovernance.ts` | `8a0b51ce6b26b13e` |
| `backend/apiHandlers/prospects/prospectIntelligenceRead.ts` | `0206db1cc5eef659` |
| `backend/tests/unit/piList002IntakeToListE2E.test.ts` | `6e2c5caca657a601` |

### 2.3 Evidence-layer definitions used throughout

- **unit** — jest with doubles. Proves rules. Proves nothing about PostgreSQL.
- **chain** — real services wired together, database doubled. Proves the application chain.
- **real-schema** — live PostgreSQL 17 in a disposable container. Proves constraints, cascades, concurrency, RLS-enabled.
- **runtime** — observed production execution. **None obtained. No database was accessed in this audit.**

---

## 3. Milestone A closure matrix

Effort is **focused engineering time**, estimated only where the implementation was inspected. Owner column names one accountable mutation owner per overlapping code area.

### MA-1 · Discovery/intake from MarketPulse, Active Leads, social engagement

| Field | Content |
|---|---|
| Implementation | **None as intake.** MarketPulse: `backend/services/marketPulse/**`, consumed read-only (`piWs3MarketPulseConsumption.test.ts` — *"PI's read-only consumption of `market_pulse_*`"*). Active Leads: ~40 routes under `pages/api/active-leads/`, **none** referencing `ingestLeadBatch`, `ingestSourceRecord` or `resolveOrCreateProspect`; `active_leads` has exactly one writer, `intelligence/snapshotRouteHandler.ts`, unrelated to PI prospects. Social: no `engagement*`/`social*` service calls PI intake |
| Evidence | Grep for PI intake symbols across `pages/api/active-leads/` → **0 files**. `engagement_identity_candidates` → **0 service references**. MarketPulse test header states read-only consumption |
| **Status** | **`MISSING`** |
| Remaining work | Three distinct new integrations: a MarketPulse→`LeadSourceAdapter`, an Active-Leads→adapter, and a social-engagement→adapter, each with provenance mapping, identity inputs and a registered source key |
| Blockers | None technical — but each is **new integration**, not completion. Semantics undecided: MarketPulse is tenant-market data, not person data; whether a market finding yields a *prospect* is a product question |
| Acceptance | For a named source, a record ingested through `ingestLeadBatch` with that `source` key is afterwards visible via `listProspects` with provenance attributing it to that source |
| Effort | **3–5 days per source**, 8–12 days total. Confidence **LOW** — no target schema mapping exists to estimate against |
| Owner | WS-MA-1 · `leadIngestion/adapters` |
| Predecessors | Product decision on prospect semantics per source |
| Authorization | **Needs owner decision** — scope, and which source(s) if any |

### MA-2 · Sales Navigator ingestion

| Field | Content |
|---|---|
| Implementation | **None.** No adapter, no connector |
| Evidence | `IMPLEMENTATION-MANIFEST-001.md` §14 BR-07 **"BLOCKED BY EXTERNAL AUTHORIZATION"**. Prior vendor research: purchasing Sales Navigator grants **no** API access; SNAP is partner-only |
| **Status** | **`BLOCKED_BY_EXTERNAL_DEPENDENCY`** |
| Remaining work | None available. The requirement is conditional — *"where an actual permitted integration exists"* — and none does |
| Acceptance | **Unreachable.** Recommend a formal scope exception |
| Effort | **N/A** |
| Authorization | **Needs owner decision** — record the exception |

### MA-3 · Manual, CSV/file and CRM import

| Field | Content |
|---|---|
| Implementation | `leadIngestion/adapters/{manualAdapter,csvAdapter,crmAdapter}.ts`; `registerBuiltInLeadSources()` at `leadIngestion/index.ts:90-98`; **registered at runtime** by `pages/api/lead-ingestion/{manual,csv,crm}.ts` (module scope, lines 44–47) and by `pages/api/prospect-sources/discovery.ts:104` |
| Evidence | **unit** — `li4eManualAdapter`, `li5e2ManualIngestionRoute`, `li5e4CrmIngestionRoute`, `piP1W02CsvIngestionRoute`, `li4dIngestionFoundation`. **chain** — `piList002IntakeToListE2E` drives the real manual adapter through the real orchestrator to the real list reader |
| **Status** | **`IMPLEMENTED_BUT_NOT_INTEGRATION_VERIFIED`** |
| Remaining work | No real-schema proof of the intake chain. The E2E test states plainly it is *"NOT database-backed … cannot prove PostgREST behaviour, RLS, CHECK constraints or real uniqueness"* |
| Blockers | Depends on MA-9 real-schema intake test |
| Acceptance | A CSV batch ingested against real PostgreSQL produces canonical prospects with provenance, and the list reader returns them |
| Effort | **2 days** to add a real-schema intake→list test. Confidence **HIGH** — pattern established by `pl_prospect_lists.test.ts` |
| Owner | WS-MA-9 |
| Authorization | **Already authorized** in principle as test-only work; confirm |

### MA-4 · Canonical identity, deduplication, tenant-safe persistence

| Field | Content |
|---|---|
| Implementation | `identityResolutionService.resolveUnifiedPerson` (sole resolve-or-create path) · `prospectIdentity/accountResolution.ts` · `prospectResolution.ts` · `personDuplicates.ts` (parks, never merges) · `ingestionBoundary.ts` as the **only** canonical-attribute writer |
| Evidence | **real-schema** — `p11_resolver_race`, `w3_w4_identity_contracts`, `li4c_person_duplicates`, `w5_tenant_isolation`, `li1_attribute_surface`, `li2_source_records`. Full real-schema suite **34/34 suites, 761/761 tests** (WS-2E) |
| **Status** | **`IMPLEMENTED_AND_VERIFIED`** — with two caveats below |
| Remaining work | (a) the **non-atomic canonical write** (MA-10); (b) the **unsigned arbitration warrant** (MA-11); (c) **sole-writer enforcement appears absent** — WS-3H searched tests, scripts and CI and located no test enforcing it, contrary to the module header's claim |
| Blockers | MA-10, MA-11 |
| Acceptance | Already met for identity/dedup/tenancy; MA-10 and MA-11 are separate rows |
| Effort | 0 for this row |
| Owner | WS-MA-10 · `prospectIdentity` |

### MA-5 · Approved provider-based enrichment (Apollo)

| Field | Content |
|---|---|
| Implementation | `enrichment/**` (27 modules): `planner.ts`, `providers/{contract,registry,selection,cost,spendCeiling,credentials,execute}.ts`, adapters `apollo.ts` and `clearbit.ts`, both registered via `providers/adapters/index.ts`. 13 named outcomes; `NON_CALLING_OUTCOMES` marks non-billable |
| Evidence | **real-schema** — `a4y_attribute_set_identity`, `a4u_abandoned_recovery`, `a6a_retry_horizon`, `a5_execution_status`. **Decisive negative:** `apollo.ts:59` `APOLLO_SUPPORTED_ATTRIBUTES = ['employee_count']` — **one** attribute, via `api.apollo.io/api/v1/organizations/enrich`. A search of every env file for `APOLLO` returns **nothing** |
| **Status** | **`BLOCKED_BY_EXTERNAL_DEPENDENCY`** |
| Remaining work | An Apollo credential provisioned through the operator A3P route. No code work identified |
| Blockers | **No credential anywhere.** Even once configured, enrichment covers **only `employee_count`** — materially narrower than "provider-based enrichment" implies |
| Acceptance | For an authorized tenant, an enrichment request returns `enriched` with `employee_count` persisted through the provenance boundary, cost recorded, and no other attribute claimed |
| Effort | **0 engineering days**; **operator action + external wait**. If broader coverage is wanted, each additional attribute needs its own semantic verification — nine hard gates are already open from the 3F–3L provider research |
| Owner | Operator / owner |
| Authorization | **BLOCKED** — needs owner decision on whether one-attribute enrichment satisfies MA-5 |

### MA-6 · ICP qualification, scoring-state transparency, truthful missing-attribute handling

| Field | Content |
|---|---|
| Implementation | `prospectIcp/criteria.ts` (15 account + 9 person attributes, `OPS_BY_KIND` predicate binding) · `evaluate.ts` (sole evaluator; `value = mandatoryUnsatisfied ? 0 : satisfied / evaluable`) · `prospectIcp/generator/**` (proposer) · `leadUnderstanding/scoring.ts` → `intelligence/canonical/scoring` · `prospectIntelligenceRead.ts` `scoreState: 'scored' | 'abstained' | 'unevaluated'` |
| Evidence | **unit** — `prospectIdentityAttributes`, `piList001RankedProspectList`, ICP suites. **Honesty is structural:** `evaluate.ts:116` *"`null` means ABSENT — which is `unknown`, never a failed match"*; absence is excluded from the denominator |
| **Status** | **`IMPLEMENTED_BUT_NOT_INTEGRATION_VERIFIED`** |
| Remaining work | No real-schema ICP evaluation test; scoring is **runtime dark** (`LEAD_UNDERSTANDING_ENABLED` exists in code; its production value is `UNVERIFIED` — no database or runtime access) |
| Acceptance | A prospect with a known attribute gap evaluates to `abstained` (not 0), the API reports `scoreState` truthfully, and no fabricated value appears |
| Effort | **2 days** real-schema ICP test. Confidence **HIGH** |
| Owner | WS-MA-9 |

### MA-7 · Prospect list creation, membership, filtering, usable audience

| Field | Content |
|---|---|
| Implementation | `supabase/migrations/20261127000000_pi_prospect_lists.sql` · `prospectLists/{index,store,audience}.ts` · `pages/api/prospect-lists/{index,members}.ts` · `prospectIntelligenceRead.listProspects` (ranked, filtered, `RANK_WINDOW = 500`) |
| Evidence | **real-schema 27/27** (`pl_prospect_lists.test.ts`) — both composite tenant-safe FKs, the partial unique index, the removal-coherence CHECK, both cascades, keyset pagination over tied timestamps, **two genuine sessions** proving `57014` lock then `23505`. **unit 88/88**. Full suite **34/34 · 761/761** |
| **Status** | **`IMPLEMENTED_AND_VERIFIED`** — strongest item in the milestone |
| Remaining work | **The migration is unapplied everywhere** (`UNVERIFIED`); authenticated-role RLS isolation unverified; two open policy decisions (`PL-DEC-001` permissions/archive, `PL-DEC-002` `added_via`) |
| Blockers | MA-12 migration application; `PL-DEC-001`, `PL-DEC-002` |
| Acceptance | Already met at the schema/service layer. Closure needs the migration applied to the target environment |
| Effort | **0 engineering days**; operator migration application |
| Owner | WS-MA-12 |

### MA-8 · Tenant isolation, consent/suppression, provenance, data quality, failure handling

| Field | Content |
|---|---|
| Implementation | Tenant: composite tenant-safe FKs throughout; `requireTenantAccess`; RLS enabled on PI tables. Suppression: `contact_governance_records` + `contactGovernance.mayContact`, canonical; legacy `suppression_entries`/`outreach_suppressions` write-dead and never read. Provenance: `source_records`/`source_assertions`/`canonical_attribute_decisions`. Quality: `engines/quality.ts`. Failure: 13 enrichment outcomes; `readiness.ts` fails closed on unreadable governance |
| Evidence | **real-schema** — `w5_tenant_isolation`, `li3d_governance_writer`, `li2_source_records`, `rls_anon_exposure`, `pi_wsf_person_erasure`. **unit** — `piP1W06GovernanceDedupObservability`, `contactGovernanceEvaluator` |
| **Status** | **`IMPLEMENTED_BUT_NOT_INTEGRATION_VERIFIED`** |
| Remaining work | **Authenticated-role RLS isolation is not verified** — RLS is verified *enabled*, and isolation is verified by composite FKs and `23503` refusals, which is not the same claim. The disposable container provisions no JWT or authenticated role. Also: the governing LI-3 contact-governance ADR's **authority is unverified** and its D-3 legal escalation (L-1…L-4) is open |
| Acceptance | Two tenants, two authenticated roles: tenant B cannot read or write tenant A's prospects, lists or governance rows, proven against real PostgreSQL under those roles |
| Effort | **3–4 days** for a role-provisioning harness plus tests. Confidence **MEDIUM** — no precedent in this repo; the earlier D-5 certification hit the same limitation |
| Owner | WS-MA-13 · `backend/tests/realschema` |

### MA-9 · End-to-end reproducible acceptance path

| Field | Content |
|---|---|
| Implementation | `backend/tests/unit/piList002IntakeToListE2E.test.ts` — *"the only test in the repository that proves a prospect ingested through the real orchestrator is afterwards visible to the real list reader"*. Real: `ingestLeadBatch`, manual adapter, provenance boundary, identity resolver, account resolution, `resolveOrCreateProspect`, duplicate parking, `listProspects`, batched score read. Doubled: **exactly two** — `ownedDbTable` (one shared in-memory store) and `featureFlagService` |
| Evidence | **chain** layer. Its own header: *"NOT database-backed. A shared in-memory store cannot prove PostgREST behaviour, RLS, CHECK constraints or real uniqueness."* |
| **Status** | **`PARTIALLY_IMPLEMENTED`** |
| Remaining work | A real-schema equivalent: CSV/manual intake → identity → canonical → list → API read, against PostgreSQL, including dedup, a provider failure path and ICP abstention |
| Blockers | MA-12 (migrations applied in the disposable container — already proven by `real-schema-ci.sh`) |
| Acceptance | One command produces a reproducible pass covering intake → list → API read against real PostgreSQL, with tenant isolation and suppression assertions |
| Effort | **4–5 days**. Confidence **MEDIUM-HIGH** — the harness exists; the intake half is new |
| Owner | WS-MA-9 |

### MA-10 · Canonical write / decision-log atomicity *(defect, not a gap)*

| Field | Content |
|---|---|
| Implementation | `ingestionBoundary.ts:1029` canonical UPDATE → `:1037` provenance → `:893` decision INSERT → `:904` throw. **No transaction** (`rpc(`/`BEGIN`/`COMMIT`/`.transaction` → 0; `catch` → 0) |
| Evidence | **CODE-PROVEN.** Retry cannot repair: `:690` `canonicalMatches → continue` empties `decision.apply`, and `:1024` returns before provenance. Design complete in WS-3C/3G: `pi_apply_canonical_decisions`, reusing the `pi_relationship_set_primary` plpgsql precedent |
| **Status** | **`IMPLEMENTED_BUT_NOT_INTEGRATION_VERIFIED`** (the defect is proven; the fix is designed, not built) |
| Remaining work | Implement the RPC + migration; replace the call site; delete `recordCanonicalProvenance` (**no external callers** — WS-3H); real-schema rollback/concurrency tests; resolve UQ-1 allowlist sub-option |
| Blockers | **D-3C-1** operator evidence; **D-3C-4** arbitration scope; **D-3C-5** authorization. Readiness **0/11** |
| Acceptance | With the decision insert forced to fail, the canonical column is **unchanged** — proven against real PostgreSQL |
| Effort | **4–6 days** (function + call site + 14 real-schema tests). Confidence **MEDIUM-HIGH** — design complete, precedent exists |
| Owner | WS-MA-10 · `prospectIdentity/ingestionBoundary.ts` |
| Authorization | **Design authorized; implementation NOT authorized** |

### MA-11 · Source-arbitration warrant

| Field | Content |
|---|---|
| Evidence | `PI-ARB-RERAT-001` **UNSIGNED** — no `*RERAT*`/`*PI-ARB*` file on disk, **0** such files in any commit on any ref. Original `D22-B1A-SOURCE-ARBITRATION-OWNER-DECISION.md` `NOT_FOUND_IN_INSPECTED_SOURCES` (searched 2,180 commits / 373 refs / 209 dangling commits / `.md` content on all refs) |
| **Status** | **`BLOCKED_BY_AUTHORIZATION`** |
| Remaining work | One signature: ratify R-1…R-10 (R-3b deferred), **or** authorize atomicity-only with arbitration byte-frozen |
| Acceptance | A signed record exists; or a scope authorization exists and the implementation report proves `decideCanonicalUpdates` unchanged by hash |
| Effort | **0 engineering days** |
| Authorization | **Needs owner decision (D-3C-4)** |

### MA-12 · Migration state

| Field | Content |
|---|---|
| Evidence | `20261119000000` (`e8b9d614449121f9`), `20261123000000` (`5c7e8aa18f0c8742`), `20261124000000`, `20261127000000` (`01315600d26291f7`) — all **`UNVERIFIED`**. `baseline.json` is silent (committed 2026-08-13, `ledgerMax 20260916000000`; the migrations were authored 2026-10-08). The repo's own reconciliation plan records the production ledger holding **4 of 145** files with **72 applied despite ledger absence** — so ledger membership is neither necessary nor sufficient. **All four are reachable only from `fix/r1-profile-context`, not `main`** |
| **Status** | **`UNVERIFIED`** |
| Remaining work | Operator catalogue queries (relation existence is determinative); then a release plan addressing reachability from `main` |
| Blockers | **D-3C-1 PENDING.** The denied migration-history operation was not retried and no access path was switched |
| Acceptance | Operator output confirms relation existence and the environment, and a reviewed release plan exists |
| Effort | **0 engineering days**; operator action + external wait |
| Authorization | **Needs operator action (D-3C-1)** |

### MA-13 · Person-erasure membership residue

| Field | Content |
|---|---|
| Evidence | **real-schema proven** (`pl_prospect_lists.test.ts` test 19): deleting `unified_persons` leaves `canonical_leads` with `unified_person_id IS NULL` and the membership **active**. `canonical_leads_person_tenant_fk` is `ON DELETE SET NULL (unified_person_id)`; nothing deletes `canonical_leads` |
| **Status** | **`BLOCKED_BY_AUTHORIZATION`** |
| Remaining work | Decide `PL-DEC-003`: **A** accept · **B-1** hard delete · **B-2** soft remove. B-1/B-2 need a fail-closed step before `deletePersonRow`, tenant-scoped on both legs, handling N `canonical_leads` rows per person, with an affected-row count — and amendment of test 19, which currently asserts survival |
| Acceptance | Per the chosen option, proven against real PostgreSQL |
| Effort | A: **0** · B-1/B-2: **3–4 days**. Confidence **MEDIUM** |
| Owner | WS-MA-13 · `prospectIdentity/personErasure.ts` |

### MA-14 · Relationship-path atomicity *(separate scope)*

| Field | Content |
|---|---|
| Evidence | `relationshipAttributeIngestion.ts`: `:309` assertion INSERT → `:404` canonical UPDATE → `:428` decision INSERT → `:448` stamp. **Three** committed stages, no transaction, no `catch`. Reuses `decideCanonicalUpdates`, so it inherits the identical retry short-circuit at `:385` |
| **Status** | **`OUT_OF_SCOPE_FOR_MILESTONE_A`** — recorded as adjacent scope per **D-3C-3** (separate batches, person/account first) |
| Remaining work | A sibling RPC; **cannot reuse** MA-10's function — different canonical table, different subject identity, earlier assertion write, six primary/current invariants |
| Effort | **4–6 days** when authorized. Confidence **MEDIUM** |

### Explicitly out of scope for Milestone A

Outreach sequence execution · automated message sending (only `internal` and `email` transports are routable; WhatsApp/SMS/voice are `NOT_OPERATIONAL`, social is network-scoped) · full buying-committee intelligence (FR-22 partial) · the PI learning loop (FR-30 / BR-18 / BR-27 `MISSING`, needs an outcome corpus) · workflow definitions/versions/executions (`MISSING` entirely) · AI decision records (`MISSING`).

---

## 4. Source-to-list path findings (§5)

Path tested: **source → adapter → source record/assertion → identity → canonical → enrichment → ICP → list → API/UI**.

| Source | Adapter | Registered at runtime | Provenance | Identity | Canonical | Enrichment | ICP | List | API | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **Manual** | ✅ `manualAdapter.ts` | ✅ `pages/api/lead-ingestion/manual.ts:47` | ✅ | ✅ | ✅ | ⛔ no credential | ✅ | ✅ | ✅ | **OPERATIONAL (application layer); real-schema intake unproven** |
| **CSV/file** | ✅ `csvAdapter.ts` | ✅ `csv.ts:44` | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ | **OPERATIONAL (same caveat)** |
| **CRM** | ✅ `crmAdapter.ts` | ✅ `crm.ts:44` | ✅ | ✅ | ✅ | ⛔ | ✅ | ✅ | ✅ | **OPERATIONAL (same caveat).** Prior finding: the legacy CRM path was proven dormant in production |
| **Apollo discovery** | ✅ `apolloAdapter.ts` + `prospectDiscovery/adapters/apolloDiscovery.ts` | adapter registered (`prospectDiscovery/adapters/index.ts:52`); **discovery provider registry ships EMPTY by design** | n/a | n/a | n/a | n/a | 2 of 15 ICP attributes translatable | n/a | route exists | **MERELY DECLARED.** No provider reachable; `OPERATIONAL_VERIFICATIONS` empty |
| **MarketPulse** | ❌ none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **NOT A SOURCE — read-only consumption only** |
| **Active Leads** | ❌ none | n/a | — | — | — | — | — | — | — | **NOT A SOURCE.** 0 of ~40 routes touch PI intake |
| **Social engagement** | ❌ none | n/a | — | — | — | — | — | — | — | **NOT A SOURCE** |
| **Sales Navigator** | ❌ none | n/a | — | — | — | — | — | — | — | **BLOCKED — no permitted integration exists** |
| **Apollo enrichment** | ✅ `providers/adapters/apollo.ts` | ✅ registered | ✅ | n/a | ✅ | **`employee_count` only** | n/a | n/a | n/a | **IMPLEMENTED, NOT CONFIGURED, NOT AUTHORIZED** |

**Smallest realistic supported source set meeting Milestone A without inventing integrations or making unauthorized provider calls: `manual` + `csv` + `crm`.** All three are implemented, registered at runtime by their routes, and carried end-to-end by the chain test. No provider call is involved.

---

## 5. Critical blocker register

| ID | Blocker | Evidence | Type |
|---|---|---|---|
| **B1** | **Migration state `UNVERIFIED`** for all four PI migrations | §3 MA-12. Operator queries pending; denied operation not retried | Operator |
| **B2** | **Arbitration warrant unsigned** | 0 files in 2,180 commits / 373 refs / 209 dangling commits | Owner |
| **B3** | **No Apollo credential anywhere** → MA-5 unmeetable | env-file search for `APOLLO` → empty; adapter supports 1 attribute | External + owner |
| **B4** | **MarketPulse / Active Leads / social are not sources** → MA-1 `MISSING` | 0 PI-intake references in any of the three | Owner (scope) |
| **B5** | **Sales Navigator has no permitted integration** → MA-2 unreachable | BR-07; SNAP partner-only | External |
| **B6** | **Canonical write non-atomic**, retry cannot repair | CODE-PROVEN, `:1029`→`:1037`, `:690`, `:1024` | Owner authorization |
| **B7** | **Authenticated-role RLS isolation unverified** | Disposable container provisions no JWT/role | Engineering |
| **B8** | **Person-erasure residue policy undecided** | real-schema proven (test 19) | Owner |
| **B9** | **Sole-writer enforcement not located** | WS-3H searched tests/scripts/CI; module header's claim appears inaccurate | Engineering |
| **B10** | **Migrations unreachable from `main`** | All four only on `fix/r1-profile-context` | Release |

---

## 6. Owner / operator decisions needed

**None is made here.**

| ID | Decision | Blocks |
|---|---|---|
| **D-3C-1** | Authorize an operator to run the catalogue queries; name the environment | B1, MA-12, MA-7 closure |
| **D-3C-4** | Arbitration: ratify, or authorize atomicity-only with arbitration byte-frozen | B2, MA-10, MA-11 |
| **MA-SCOPE-1** | **Does Milestone A close without MarketPulse / Active Leads / social intake?** | B4, MA-1 |
| **MA-SCOPE-2** | **Does Milestone A close without provider enrichment** — or is `employee_count`-only enrichment sufficient once a credential exists? | B3, MA-5 |
| **MA-SCOPE-3** | Record the Sales Navigator exception | B5, MA-2 |
| **PL-DEC-003** | Erasure residue: A / B-1 / B-2 | B8, MA-13 |
| **PL-DEC-001** | List permissions, archive/un-archive, super-admin bypass | MA-7 |
| **PL-DEC-002** | `added_via` policy | MA-7 |
| **D-3C-5** | Authorize the MA-10 implementation batch | B6 |
| **MA-SCOPE-4** | Authorize the B9 sole-writer enforcement test | B9 |

**MA-SCOPE-1 and MA-SCOPE-2 together decide whether Milestone A is closable at all.** If both must be met as written, the milestone is **not closable** and needs re-scoping, not scheduling.

---

## 7. Dependency-ordered delivery schedule

**Assumed start: Mon 2026-10-20.** Single engineer on PI mutation work (one mutation owner per code area, per §7). Focused effort and calendar duration reported separately; overlapping work is **not** summed.

### A. Critical blockers — no engineering effort, all external

| # | Action | Effort | Wait | Target | Blocks closure? |
|---|---|---|---|---|---|
| A1 | **D-3C-1** operator catalogue queries | 0 | 1–3 days | **Wed 2026-10-22** | **YES** |
| A2 | **D-3C-4** arbitration signature | 0 | owner | **Wed 2026-10-22** | **YES** |
| A3 | **MA-SCOPE-1/2/3** scope exceptions | 0 | owner | **Fri 2026-10-24** | **YES — decides closability** |
| A4 | **PL-DEC-001/002/003** | 0 | owner | Fri 2026-10-24 | YES for MA-7/MA-13 |
| A5 | Apollo credential provisioning, **if** MA-SCOPE-2 requires enrichment | 0 | **external, unbounded** | **unknown** | YES if required |

**A1–A4 are days of owner/operator time, not engineering. A5 has no defensible date.**

### B. Implementation backlog — dependency-ordered

| # | Task | Effort | Confidence | Predecessors | Start | Finish | Blocks closure? |
|---|---|---|---|---|---|---|---|
| B1 | **MA-10 atomicity RPC** + migration + call site + 14 real-schema tests | **5d** | MEDIUM-HIGH | A1, A2, D-3C-5 | Mon 2026-10-27 | **Fri 2026-10-31** | **YES** |
| B2 | **B9 sole-writer enforcement test** (tree-walking scan + negative control + grant check) | **1.5d** | HIGH | MA-SCOPE-4 | Mon 2026-10-27 | Tue 2026-10-28 | NO (recommended with B1) |
| B3 | **MA-7 list policy** — archive/un-archive gate + bypass handling, if `PL-DEC-001` approves | **2d** | HIGH | A4 | Mon 2026-11-03 | Tue 2026-11-04 | YES if approved |
| B4 | **MA-13 erasure residue**, if B-1/B-2 chosen | **3.5d** | MEDIUM | A4 | Wed 2026-11-05 | Mon 2026-11-10 | YES if chosen |
| B5 | **MA-8 authenticated-role RLS harness** + two-tenant isolation tests | **4d** | MEDIUM | — (independent) | Mon 2026-10-27 | Thu 2026-10-30 | **YES** |
| B6 | **MA-3/MA-6 real-schema intake + ICP tests** | **3d** | HIGH | B1 | Mon 2026-11-03 | Wed 2026-11-05 | **YES** |

**B5 is independent and runs in parallel with B1** — different code area (`backend/tests/realschema`), no shared mutation surface. B2 may run alongside B1 under the same owner.

### C. Final acceptance — one integrated certification

| # | Task | Effort | Confidence | Predecessors | Start | Finish |
|---|---|---|---|---|---|---|
| C1 | **MA-9 integrated real-schema acceptance suite** | **5d** | MEDIUM-HIGH | B1, B5, B6 | Mon 2026-11-11 | **Fri 2026-11-14** |
| C2 | Full regression + typecheck + migration-quality; closure report | **1.5d** | HIGH | C1 | Mon 2026-11-17 | **Tue 2026-11-18** |
| C3 | Owner review of the closure package | 0 | — | C2 | Wed 2026-11-19 | **Wed 2026-11-19** |

**Totals: focused effort ≈ 25.5 engineer-days. Calendar duration ≈ 4.5 weeks from 2026-10-20, i.e. Milestone A′ closable Wed 2026-11-19** — assuming A1–A4 land by 2026-10-24 and B-1/B-2 is chosen for MA-13.

**This date is contingent, not an engineering estimate alone.** It assumes: one engineer; A1–A4 answered within four working days; MA-SCOPE-1/2 grant exceptions for MA-1, MA-2 and MA-5. **If MA-SCOPE-2 requires working enrichment, the date depends on A5 and is undefined.**

---

## 8. Final acceptance plan (single integrated certification)

One suite, run via the existing disposable real-PostgreSQL harness (`scripts/ci/real-schema-ci.sh`, standalone Docker, loopback-only, `FORBIDDEN` guard refusing managed hosts).

| # | Assertion | Layer |
|---|---|---|
| 1 | **Source→list:** CSV batch → canonical prospects with provenance → `listProspects` returns them, correctly ranked | real-schema |
| 2 | **Dedup:** a repeated record yields one person; an ambiguous one is **parked, never merged** | real-schema |
| 3 | **Tenant isolation:** two tenants under **two authenticated roles** — B cannot read or write A's prospects, lists or governance | real-schema |
| 4 | **Suppression/consent:** a suppressed prospect is `not_ready`; unreadable governance fails closed | real-schema |
| 5 | **Provenance:** every canonical value traces to a `source_assertions` row and a `canonical_attribute_decisions` row | real-schema |
| 6 | **Atomicity:** decision insert forced to fail ⇒ canonical column unchanged | real-schema |
| 7 | **Provider failure:** `credential_missing` and `cost_denied` are distinguishable and **never billed** | unit + real-schema |
| 8 | **ICP honesty:** a missing attribute ⇒ `abstained`, excluded from the denominator, never 0 | real-schema |
| 9 | **List membership:** add/remove/re-add, multi-list, soft removal retained, duplicate refused (`23505`) | real-schema (**27/27 passing**) |
| 10 | **Erasure:** per the chosen `PL-DEC-003` option | real-schema |
| 11 | **Regression:** full suite stays **34/34 · 761/761**; `npm run typecheck` 3/3; migration-quality 0 violations | all |

**Evidence artifact:** one report with command lines, exit codes, suite counts, and an explicit limitations section.

---

## 9. Milestone A closure definition

Closed only when **all** hold:

1. Every mandatory requirement is `IMPLEMENTED_AND_VERIFIED` **or** carries an explicitly approved, written scope exception. **MA-1, MA-2 and MA-5 currently require exceptions.**
2. At least one approved acquisition path works end to end **against real PostgreSQL** — candidate: CSV/manual/CRM.
3. Enrichment and ICP qualification demonstrated through an authorized operational path. **If Apollo remains unauthorized, MA-5 cannot be demonstrated, and the agreed scope as written is impossible to close** — this must be an explicit exception or the milestone re-scoped.
4. Prospect lists usable and tenant-safe, with the migration **applied to the target environment**.
5. Consent/suppression, provenance and data-quality acceptance tests pass.
6. MA-10 atomicity and MA-13 erasure resolved and verified **for the agreed scope**.
7. The §8 integrated suite passes.
8. The closure report states remaining limitations and **does not overclaim** RLS, provider or production verification.

---

## 10. Confidence and limitations

| Estimate | Confidence | Basis |
|---|---|---|
| B1 atomicity 5d | MEDIUM-HIGH | Design complete; `pi_relationship_set_primary` precedent; 14 tests specified |
| B2 enforcement test 1.5d | HIGH | Tree-walking precedent exists (`no_campaign_company_id_usage.test.ts`) |
| B3 list policy 2d | HIGH | Small, localised; `canDeclareAuthority` pattern exists |
| B4 erasure 3.5d | MEDIUM | Ordering is load-bearing; N `canonical_leads` per person; test 19 must change |
| B5 RLS harness 4d | MEDIUM | **No precedent**; the earlier D-5 certification hit the same wall |
| B6 intake/ICP tests 3d | HIGH | `pl_prospect_lists.test.ts` is a direct template |
| C1 integrated suite 5d | MEDIUM-HIGH | Harness exists; breadth is the risk |
| **MA-1 per source 3–5d** | **LOW** | No target mapping exists to estimate against |
| **A5 Apollo credential** | **NONE** | External; no defensible date |

**Not verified in this audit:** any database state (no connection) · production migration status · authenticated-role RLS isolation · production runtime behaviour of any flag · the definitive BRS/FRS and the Playbook V2 (both absent) · whether `pi_canonical_attribute_set`-style SQL validation could carry the attribute allowlist (shape-only today; UQ-1 open).

**Audit completeness is not milestone completeness.** This report establishes status; it closes nothing.

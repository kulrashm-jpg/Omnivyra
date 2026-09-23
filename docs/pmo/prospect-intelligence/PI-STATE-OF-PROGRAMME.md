# PI-STATE-OF-PROGRAMME

**Living document. This is the authoritative current state of Prospect Intelligence.**
Every other document in this directory is a frozen point-in-time artifact and is historical evidence only.

| | |
|---|---|
| **Base SHA** | `a07477e4` (`origin/main`, merge of PR #269) |
| **Established** | 2026-09-23 |
| **Method** | Six parallel read-only structural surveys over a clean worktree at the base SHA, plus orchestrator verification of every load-bearing claim |
| **Implementation status** | **IN PROGRESS.** WS-A1 and WS-B integrated and T2-passed on `integrate/pi-t2-001`. Nothing pushed, nothing deployed, no migration authored or applied, no flag or provider changed |

**Verification legend.** `VERIFIED` = observed directly at this SHA or against a live platform API in this session. `UNVERIFIED` = not observed; may be true. A prior report is not verification.

---

## 0. The one-paragraph summary

Prospect Intelligence can **record** a prospect end to end — identity, provenance, governance, ICP, scoring, recommendation, readiness — and can **execute one outreach task** through a human approval gate and faithfully write down what happened to it. It cannot **discover** a prospect, and it cannot **decide what to do second**. Those two absences, plus the absence of any prospect lifecycle state, are the programme. Almost everything else is either already built, or small.

---

## 1. Architecture — preserved as baseline

The frozen spine in `PI-ADR-001.md` stands and is **not** being redesigned:

```
SOURCE → OBSERVATION → IDENTITY RESOLUTION → CANONICAL PROSPECT
       → ENRICHMENT → SCORING → RECOMMENDATION/NBA → READINESS
       → OUTCOME → LEARNING (proposal only)
```

Canonical entities, unchanged: `companies` = tenant · `unified_persons` = canonical person · `prospect_accounts` = external employer · `canonical_leads` = prospect/pursuit record · `leads` = web-form capture · `lead_intelligence` = derived observation · `active_leads` = derived snapshot.

The Do-Not-Build register stands. No second lead/person/account model, no second ICP engine, no second suppression engine, no PI message-sending infrastructure.

**One frozen decision has changed**, by owner decision on 2026-09-23: see `PI-ADR-002-reassessment-seam.md`. Outcomes become evidence into the intelligence context and its fingerprint; they do not become decisions. PI still never sends, learning still proposes only, ratification stays human, suppression still overrides everything.

---

## 2. Ground truth

### 2.1 Repository and deployment — VERIFIED

| Fact | Value |
|---|---|
| `origin/main` | `a07477e4`, 2026-09-23 |
| Local `main` | `fef34178` — **229 commits behind**; do not analyse against it |
| Orchestration worktree | `C:/tmp/pi-base` @ `a07477e4`, `node_modules` junctioned, `.env.test` present |
| User working tree `C:/virality` | branch `preserve/creator-canonical-template-pool`, 29 modified + 62 untracked — **untouched, and to remain so** |
| T1 harness in worktree | working — `npx jest piIcpProposalTargets` → 38/38 pass |
| Test env safety | `backend/tests/setupEnv.ts:39` refuses to run without a non-production env file; `.env.local` is never loaded by tests |
| PI migrations authored | 13, `20261011000000` → `20261022000000` |
| Last PI-touching merge | PR #248, 2026-09-16 |

### 2.2 Production flags — VERIFIED via platform CLIs

| Flag | Vercel prod | Railway prod | Effect |
|---|---|---|---|
| `ENABLE_LEAD_INGESTION` | present (15d) | **`true`** | outer ingestion kill switch OPEN |
| `ENABLE_ENRICHMENT_SPEND_CEILING` | present | absent | ceiling enforced on Vercel only |
| `LEAD_UNDERSTANDING_ENABLED` | **absent** | **absent** | shadow runtime dark (PI read path does not need it) |
| `LEAD_UNDERSTANDING_AUTHORITATIVE` | **absent** | **absent** | authoritative flip not taken |
| `PI_RETRY_SCHEDULER_ENABLED` | **absent** | **absent** | enrichment retry job inert |
| `PI_RETRY_SCHEDULER_ORG_IDS` | **absent** | **absent** | second gate also closed |
| Any provider API key | **absent** | **absent** | credentials are per-tenant, encrypted store |
| `CRON_INTERVAL_SECONDS` | — | `1800` | cron ticks every 30 min |

The inner gate — a per-tenant `lead_ingestion` row in `feature_flags` — is **UNVERIFIED** (requires a DB read).

### 2.3 Production database — UNVERIFIED, and currently unverifiable

Two independent obstacles, both needing the operator:

1. **The permission classifier denies production reads.** A read-only row-count probe was refused.
2. **The pooler credential in `.env.local` is rejected:** `password authentication failed for user "postgres"` for `postgres.klkiseupptzbecbxwrky@aws-1-ap-southeast-1.pooler.supabase.com`. Almost certainly stale since the 2026-09-12 credential rotation.

Consequently **UNVERIFIED**: which of the 13 PI migrations are applied; every PI table row count; whether any tenant holds the `lead_ingestion` flag; whether any tenant holds an `outreach_governance_config` row; whether any provider credential is stored.

### 2.4 The schema-parity gate does not cover PI — VERIFIED, and this corrects the record

PR #234 (`d98b3b7f`, 2026-09-13) genuinely fixed `scripts/verify-schema-parity.js`: it previously read `information_schema` through PostgREST, exited 2 on every run in every environment, and `predeploy-check.js` mapped that to "SKIPPED (env unavailable)" — so the gate **reported an environmental excuse forever and never compared a single column**. It is now a direct `pg` connection, is test-guarded against exiting 0 on failure, and I confirmed it exits 2 rather than 0.

That commit records the first real verdict: *"71 columns checked, 32 missing (0 BLOCKING / 16 WARN / 16 INFO), ledger 54 recorded vs 398 local files, exit 3 … none is PI-related."*

**"None is PI-related" must not be read as "the PI schema is healthy."** `REQUIRED_COLUMNS` in that script covers **21 tables, none of them a PI table**:

```
bolt_execution_runs, queue_jobs, scheduled_posts, active_leads, opportunity_feed_items,
content, content_variant, content_revision, content_asset, content_memory,
content_originality, brand_memory, content_quality, content_block, content_recommendation,
content_approval_history, content_performance, publication_lineage,
learning_intelligence, learning_memory, content_prediction
```

`generated/schema-column-manifest.json` is narrower still — `watched_tables` is `["companies","users"]`.

**So the PI schema has zero deploy-gate coverage.** Not one of `unified_persons`, `prospect_accounts`, `source_records`, `source_assertions`, `prospect_enrichment_attempts`, `prospect_icps`, `prospect_icp_versions`, `canonical_leads`, `outreach_tasks`, `outreach_outcomes`, `contact_governance_records`, `identity_claims` is checked before a deploy. Fixing the credential alone would still verify nothing about PI.

---

## 3. Current state by capability

Verdicts are `BUILT` / `PARTIAL` / `ABSENT`, all at `a07477e4`.

### 3.1 Discovery — **ABSENT where it matters**

| Capability | State |
|---|---|
| Ingestion contract, registry, orchestrator, dual gate, 3 HTTP routes | **BUILT** |
| Registered sources | `manual`, `crm`, `csv` — **all operator-supplied**. Zero provider adapters |
| Engagement → PI prospect | **ABSENT** — engagement yields `lead_signals` + `contacts` + one `external_id` claim, then stops |
| Problem/buying-situation discrimination | **BUILT but disconnected** — `leadDetectionService`, `engagementOpportunityService` (incl. `problem_discussion`), `opportunityClassifierService`, `buyerIntentIntelligenceService` all exist and none reaches the PI spine |
| Community/listening → PI prospect | **ABSENT** — full pipeline exists, terminates in `lead_intelligence` |
| MarketPulse as discovery | **ABSENT, structurally** — every `market_pulse_*` row is keyed to the tenant; `entities` is `[]` on every finding; `marketPulseAttributeCoverage()` returns `[]` |
| Sales Navigator adapter boundary | **ABSENT** — catalogue declaration only |
| Extension → PI evidence (the real people-data path, incl. Sales Navigator `raw_context`) | **BUILT, NO RUNTIME CALLER** — `extensionBridge.ts` is written and tested; `pages/api/extension/events.ts` never calls it |

**The structural finding.** `canonical_leads` — the PI Prospect — is written by exactly one path: `leadIngestion/orchestrator.ts:349`. Every discovery mechanism in the platform (`engagement`, `community`, `marketpulse`, `website`, `crm`) instead calls `adoptLead(...)`, which writes `lead_intelligence`. There are two parallel lead systems, and **PI is on the side with no discovery**.

### 3.2 Identity, provenance, governance — **BUILT**

Conservative resolution with deterministic tenant-scoped keys; ambiguity parks and never merges (a merge executor exists in SQL and is refused in code). Provenance retains value + source + `observed_at` + confidence. RULE A/B/C is implemented: one uncontested value applies, disagreeing sources withhold, an existing canonical value is never overwritten. Suppression is 4 stores / 3 evaluators with a frozen precedence, and fails closed at every read.

Two structural weaknesses, both **BUILT-but-incomplete**:
- **No arbitration.** Disagreement withholds permanently. `source_assertions.superseded_at` is read but **never written by any production file**, so an assertion can never be retired — and RULE C makes the first canonical value permanent.
- **No freshness column.** Freshness is a caller-supplied window, not stored evidence.

### 3.3 Enrichment — **BUILT and UNREACHABLE**

27 files, ~7,400 lines, 13 migrations: registry, contract, selection, cost, per-tenant credentials, execution, spend ceiling, observations, persistence, attempt records, leases, provider call state, retry candidates, retry consumer, cron job. Apollo and Clearbit adapters exist. Safety is genuinely good — one provider call per authorised request, cost authorised before egress, a durable pre-transport marker so a crash mid-call is provable, `unknown` transport never auto-retried.

It cannot be reached in production — see `DEFECT-001`. Also: no proactive scheduler exists (by design, stated in five places); the retry job is doubly flag-dark; **enrichment emits no telemetry at all**; and there is no UI that triggers enrichment.

### 3.4 Offering & understanding — **the orphan**

`backend/services/offeringIntelligence/**` is a complete 24-facet offering ontology — `customerProblems`, `valueProposition`, `outcomes`, `differentiators`, `capabilities`, `personas`, `industries`, `icpAlignment` — with ten engines and tests. It has **zero consumers, no database table, and no writer** (`persistence.ts:1-5`: "NO writer wired in Phase B").

Every prior document called the offering model "its own programme with its own discovery." That is wrong. The **sell side is built and orphaned**. What is genuinely missing is the **buy side**: nothing in intake, enrichment or engagement captures a prospect's problem. Timeline entries carry no text; `lead_signals.content_text` exists and is never projected into the scoring context.

`prospectIcp/generator/prompt.ts:32` already names the gap: `UNREPRESENTABLE_CONCEPTS = ['problem_relevance', 'product_service_alignment']`.

### 3.5 ICP — **BUILT**

Closed criterion vocabulary (14 account + 9 person attributes), abstention-correct evaluator, AI proposer wired to a route and a workspace UI, ranked-shortlist targets collapsed into one union criterion (avoiding the 1/5 = 0.2 scoring defect), and human ratification enforced at three layers — route, service, and a database CHECK. This is the programme's best work and the pattern the AI control plane should copy.

### 3.6 Scoring — **PARTIAL, and thinner in practice than on paper**

`SCORE_DIMENSIONS = ['intent','icp','urgency','opportunity','priority']`. Nineteen engines, deterministic, abstention-correct, no fabricated zeroes. Four further dimensions (Problem Fit, Account Potential, Buying Role, Relationship Strength) report `not_implemented` with a reason.

**But on the production path, `opportunity` and `urgency` always abstain**, because `prospectContext` never populates `ctx.signals` (no bridge from `lead_signals.source_type ∈ {engagement, listening}` to the 18-value `BuyingSignalType` — deliberately, to avoid inventing a trigger event) and never populates `ctx.qualification`. Of five dimensions, only `intent`, `icp` and `priority` can produce a value.

`engines/explainability.ts` is fully built — `whyNow`, `whatChanged`, `uncertainty`, per-claim contradictions — and **is surfaced nowhere**.

### 3.7 NBA, readiness, execution — **BUILT for one shot**

Readiness is genuinely good: four states, fails closed at four distinct points, exact channel matching, canonical evaluator. Execution is a complete per-task ledger — materialize → approve (compare-and-set, audited) → dispatch (governance-gated, quota-reserved) → delivery evidence → outcome.

The canonical NBA vocabulary is **three actions**: `personalized_outreach | nurture_sequence | monitor`. It is computed at read time, **never persisted** (`lead_understanding_shadow` has a migration and no writer), and there is a third, undocumented producer (`leadIntelligenceEngine/recommendationEngine.ts`) which is the only thing in the repo that reasons about dormancy — driven entirely by website-visit recency, never by outreach.

### 3.8 Lifecycle — **ABSENT**

There is no prospect lifecycle state machine. Seven status vocabularies exist; none is authoritative for a PI prospect:

- `canonical_leads.lead_status` — free text, **no CHECK, no vocabulary**; PI's own resolver writes `null` to it and PI never reads it
- `journeyState` — website telemetry, emitted only as a metric
- `FunnelStage` — a recomputed label, not a machine
- `active_leads` — has `bucket` and `change_status`, **no `status` column at all**
- `operational_states` — the only real lead state machine (`new → qualified → working → meeting_scheduled → proposal → won/lost/archived`), **entirely manual and PI-disconnected**
- `outreach_tasks.status` — a real 17-state machine, but **per-task, not per-prospect**
- `prospect_accounts.status` — identity status, not sales

**And there is a deliberate, test-enforced one-way wall.** `feedbackIngestion.ts` states it and guard tests enforce it: *"business outcomes are observational and do not drive lifecycle state."* The scoring fingerprint contains no outreach table. No activation reason references an outcome. Consequently: a prospect who replied, booked a meeting, converted, or ignored five emails is — from PI's point of view — in exactly the same state as one never contacted.

Downstream of that: no-response intelligence **ABSENT** (the `no_response` derivation rule is documented in four places and implemented in none); follow-up sequencing exists but is **open-loop and response-blind** (a static delay ladder; `depends_on_plan_task_id` is stored and never read); meeting/handoff **ABSENT** (`meeting_booked` is classified unobservable — there is no booking integration); nurture and reactivation are **display strings with no mechanism**.

### 3.9 AI control plane — **ABSENT for prospects; the machinery exists**

Zero prospect references in any chat, agent, or copilot surface. But the reusable machinery is substantial and built: an agent runtime with approval gates and deterministic recovery, a capability registry with a tool orchestrator, an LLM gateway, and a grounded, audited, deterministic copilot (`active-leads/copilot.ts`) that already refuses autonomous LLM calls. **Native LLM function-calling is absent repo-wide.**

PI touches an LLM in exactly one place: the ICP generator.

### 3.10 Learning — **ABSENT**. The outcome corpus is a read seam that proposes nothing, by explicit contract.

### 3.11 Observability — **PARTIAL**

Identity and outreach telemetry are rich and correctly bounded (no tenant labels, no PII). **Enrichment telemetry does not exist** — no counter for provider call, refusal, spend-ceiling hit, lease claim, or retry outcome. **There is no operator surface for PI anywhere** — 15 super-admin pages, 6 admin pages, 9 admin components, and the monitoring directory contain zero PI references.

### 3.12 Tests — **BUILT (unit), PARTIAL (real-schema), ABSENT (e2e)**

~132 PI test files; 25 real-schema tests that verify DDL invariants against a live Postgres container. **No end-to-end PI lifecycle test exists.** The nearest thing is a script, not a suite.

Per an existing programme note, the real-schema harness is raw `pg` while ingestion writes via PostgREST — so **the application write path has never executed against real constraints**.

---

## 4. Defect register

| ID | Severity | Statement | Verification |
|---|---|---|---|
| **DEFECT-001** | **High** · **CLOSED** by WS-B | `executeProspectEnrichment` (`prospectIntelligenceRead.ts:613`) plans with `ingestionEnrichmentCoverage()` — no tenant statuses, and "absent means none" — while computing `tenantSourceStatuses(organizationId)` at `:632` for a different callee. Every field resolves `no_available_source`; the `action !== 'enrich'` guard at `:622` returns `not_planned` before execution. **The entire enrichment subsystem is unreachable in production.** | VERIFIED by orchestrator |
| **DEFECT-002** | **High** | `leads.unified_person_id` is `NOT NULL` in the production baseline with **no committed migration creating it** — the `20260506*` series skips `…000006`, and a committed rollback *drops* a constraint nothing creates. Documented in-repo as known drift. | VERIFIED |
| **DEFECT-003** | **High** | `leads_person_tenant_fk` carries `ON DELETE SET NULL (unified_person_id)` against that `NOT NULL` column → `23502`. Person deletion behaves as RESTRICT. `w5_tenant_isolation` misses it because `contacts` (nullable) is the control. | VERIFIED |
| **DEFECT-004** | **High (compliance)** | The unsubscribe → suppression seam is **absent**. `POST /api/outreach/outcomes` deliberately rejects `unsubscribed` because of it. No live exposure (an unsubscribe cannot be recorded) — and no way to honour one. | VERIFIED |
| **DEFECT-005** | **High (integrity)** | **All six** `postDiscoveryConnectors` (instagram, facebook, twitter, reddit, hackernews, linkedin) return hard-coded fabricated posts with fake `source_url`s (`https://linkedin.com/feed/update/mock-…`). They are registered in `CONNECTORS` and reachable via `getConnector(platform)` from `leadJobProcessor`, which is wired to the `engine-jobs` worker on `type === 'LEAD'` and iterates tenant-configured `platforms` with **no allow-list check**. A separate, genuinely real listening registry (`connectors/listeningConnectorRegistry.ts` — reddit, HN, github) exists alongside it. Production reachability is **UNVERIFIED** (depends on DB rows). | Code path VERIFIED |
| **DEFECT-006** | **Medium** | `source_assertions.superseded_at` is read but never written. No arbitration exists. Combined with RULE C, the first canonical value for an attribute is permanent and a disagreement withholds forever. | VERIFIED |
| **GAP-007** | **High** | The deploy-time schema gate covered 21 tables, **none of them PI**. See §2.4. **CLOSED** by WS-A1 — now 36 tables / 174 entries, all 13 PI tables covered. | VERIFIED · CLOSED |
| **DEFECT-008** | **High (latent)** | `contact_governance_records.person_id` carries `ON DELETE SET NULL (person_id)` — deliberately, "so governance outlives the person" — against CHECK `contact_governance_has_anchor` (`person_id IS NOT NULL OR target_normalized IS NOT NULL`). Postgres validates CHECKs on the UPDATE that `SET NULL` performs, so a **person-anchored-only** governance record makes that person undeletable with `23514`, defeating the very design intent. Structurally identical to DEFECT-003, one constraint class over. Latent: governance is believed empty (UNVERIFIED) and no deletion path exists. **Makes POLICY-1's anchor decision load-bearing for POLICY-4.** | VERIFIED |

---

## 5. Decisions required from the operator

| ID | Decision | Why it cannot be inferred |
|---|---|---|
| **ARCH-1** | **May the outcome ledger inform the intelligence layer?** The target product (lifecycle, no-response intelligence, reassessment, reactivation, post-meeting) requires it. The current architecture forbids it by explicit contract and guard test. This is the single largest decision in the programme and needs a superseding ADR, not an inference. | The wall is deliberate and documented; removing it silently would violate the programme's own governance |
| **PROD-1** | Production read access — reissue the pooler credential, grant the probe permission, or both | Operator-only |
| **PROD-2** | Is `DEFECT-005` live? i.e. do any tenants have `lead_jobs` rows with platforms configured | Needs a DB read |
| **POLICY-1** | Unsubscribe scope and anchor: channel-scoped or `*`; person- or target-anchored; revocable. **Contract prepared: `PI-CONTRACT-001`.** Two sub-questions are foreclosed by the schema (no time-limited unsubscribe; duplicates already idempotent). ⚠ Interacts with POLICY-4 via DEFECT-008 — person-only anchoring makes every unsubscribed person undeletable | Compliance decision |
| **POLICY-2** | Does an engagement/community signal deserve a PI **prospect**, a **candidate**, or nothing? Three code sites record this as "a product decision nobody has made" | Determines the entire discovery design |
| **POLICY-3** | Contact-frequency / fatigue policy — quiet hours and fatigue "do not exist anywhere yet" | Product + compliance |
| **POLICY-4** | Data lifecycle: retention, erasure, subject access. **Contract prepared: `PI-CONTRACT-002`, 8 decision points, 6 work items.** No PI table is in any retention policy; there is **no person-deletion path at all**, and the FK topology actively blocks one (`lead_intelligence` RESTRICT, `leads` 23502) while CASCADE would destroy `identity_claims` and the merge audit trail | Legal/compliance; gets harder once rows exist |
| **POLICY-5** | Score dimension weights for Account Potential and Buying Role (the facts exist; the weighting is policy) | Product |

---

## 6. Workstream plan

Contract-first per the execution protocol. **No implementation has started.**

| WS | Scope | Owns | Depends on | Parallel class |
|---|---|---|---|---|
| **WS-A** | Schema & safety baseline: extend the preflight to PI tables (GAP-007); close DEFECT-002 and DEFECT-003 while tables are empty | `scripts/verify-schema-parity.js`, `supabase/migrations/*` (new, additive) | PROD-1 for verification | SERIAL (migration authoring) |
| **WS-B** | Enrichment reachability: DEFECT-001; enrichment telemetry | `prospectIntelligenceRead.ts` execute path, enrichment telemetry module | none | PARALLEL-SAFE |
| **WS-C** | Discovery fabric: prospect-candidate contract; engagement/community → PI spine; extension bridge activation (Sales Navigator people-data); quarantine DEFECT-005 | `leadIngestion/**`, `extensionBridge` caller, new candidate model | POLICY-2, contract freeze | SERIAL with WS-E on the candidate contract |
| **WS-D** | Offering activation: persist `offeringIntelligence`, wire it to Problem Fit; prospect-side problem evidence (project `lead_signals.content_text` into context) | `offeringIntelligence/**`, `prospectContext.ts` | contract freeze | PARALLEL-SAFE |
| **WS-E** | Lifecycle & reassessment: prospect state machine; outcome interpretation; no-response derivation; reassessment trigger | new lifecycle module, `prospectContext` fingerprint | **ARCH-1**, contract freeze | SERIAL (core) |
| **WS-F** | Compliance: unsubscribe seam (DEFECT-004); data lifecycle and erasure path | `feedbackIngestion` → governance seam, retention targets | POLICY-1, POLICY-4 | PARALLEL-SAFE |
| **WS-G** | AI control plane over PI + operator observability surface | new PI copilot intents, admin surface | WS-E contracts | LAST |

**Contracts to freeze before parallel implementation** (§28): Prospect · Candidate · Signal · Evidence · Enrichment Attribute · Decision · NBA · Lifecycle Event · Prospect State · Outreach Outcome · Learning Proposal. Where one exists it is reused; `SectionState`, `FIELD_STATES`, `ENRICHMENT_OUTCOMES`, `GOVERNANCE_TYPES`, `SCORE_DIMENSIONS` and the ICP criterion vocabulary are already frozen and authoritative.

---

## 7. Classification of the target specification

Per the "do not build for the sake of completion" rule.

| Target capability | Class |
|---|---|
| Ingestion contract, identity, provenance, governance, ICP, readiness, execution ledger, flags, tenant isolation | **ALREADY BUILT** |
| Enrichment provider fabric | **ALREADY BUILT** — blocked by DEFECT-001 |
| PI schema deploy coverage; DEFECT-002/003 | **REQUIRED NOW** — cheapest while tables are empty |
| Enrichment reachability + telemetry | **REQUIRED NOW** |
| Unsubscribe seam | **REQUIRED NOW** (before any dispatch) |
| Discovery → PI spine; candidate model | **REQUIRED NOW** — this is the product |
| Offering activation + Problem Fit | **REQUIRED NOW** — sell side already built |
| Lifecycle state + reassessment + no-response | **REQUIRED NOW**, gated on ARCH-1 |
| Data lifecycle / erasure | **REQUIRED NOW** — POLICY-4; hardest after rows exist |
| Buying-signal vocabulary bridge | **POLICY DECISION REQUIRED** — do not invent a mapping |
| Account Potential / Buying Role as dimensions | **POLICY DECISION REQUIRED** (weights only) |
| Relationship Strength dimension | **REQUIRED LATER** — no interaction-depth evidence exists anywhere |
| Meeting/handoff | **REQUIRED LATER** — needs a booking integration; `meeting_booked` is unobservable today |
| FR-30 learning | **DEFERRED UNTIL DATA EXISTS** — zero outcome rows |
| ZoomInfo / Crunchbase / RapidAPI adapters | **EXTERNAL DEPENDENCY** |
| Sales Navigator official integration | **EXTERNAL DEPENDENCY** — the extension bridge is the supported path and needs no new legal posture |
| AI control plane | **REQUIRED LATER** — after lifecycle contracts exist |

---

## 8. Validation status

| Gate | State |
|---|---|
| T1 | PASS for WS-A1 (54/54) and WS-B (179/179), each re-run by the orchestrator in its own worktree |
| T2 | **PASS** on `integrate/pi-t2-001` — 115 PI suites / 3299 tests, 0 failures; `check:authz`, `check:migrations`, `check:db-conventions`, `check:route-policy` all exit 0 |
| T3 | not run — not a release candidate |
| Production deploy | **not authorized, not attempted** |
| Pushed | **no** — all four branches are local |

**PI baseline at `origin/main` for comparison:** 114 suites / 3239 tests with **2 failures**, both stale assertions that Apollo has no adapter. The integrated tree is +1 suite, +60 tests, 0 failures.

**One caveat carried forward from WS-A1:** the extended schema gate has never been run against a real database. Once PROD-1 lands it may turn a currently-green predeploy **red** — that is the intent of the change, not a regression, but it must be run and triaged before it is treated as shippable.

---

## 9. Next actions, in dependency order

1. **Operator: PROD-1.** Restore production read access. Everything about applied-migration state is blocked on it.
2. **Operator: ARCH-1.** Decide whether the outcome ledger may inform intelligence. WS-E cannot start without it; WS-A, WS-B, WS-D, WS-F can.
3. **Orchestrator: freeze the contracts** in §6.
4. **WS-A, WS-B, WS-F** may begin immediately in parallel — none depends on a pending decision.
5. **WS-C, WS-D** begin after contract freeze.
6. **WS-E** begins after ARCH-1.
7. First real-data exercise only after WS-A closes and PROD-1 is resolved.

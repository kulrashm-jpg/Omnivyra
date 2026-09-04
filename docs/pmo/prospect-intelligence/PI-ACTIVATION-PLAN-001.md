# PI ACTIVATION PLAN 001 — product decisions + operations

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes` · **Baseline:** WS-12 @ `bf956201`
**Status of engineering:** IMPLEMENTATION COMPLETE — ACTIVATION BLOCKED (WS-12)

Documentation only. No code, schema, migration, flag, provider, merge or deploy.

---

## 1. Executive summary

**None of the eight product decisions blocks initial Prospect Intelligence activation.**

That is the central finding. The activation path is far shorter than the blocker count suggests, because the
blockers were never all the same kind of thing:

- **Four operational prerequisites** genuinely gate activation. All four are executable this week.
- **Eight product decisions** gate *specific later capabilities*. Seven can be deferred without making PI
  unsafe or misleading, because the implementation already reports every one of them as
  `not_implemented` / `not_evaluated` rather than fabricating a value.
- **One product decision is compliance-bearing** — unsubscribe → suppression — and it gates the **first
  outreach dispatch**, not PI activation. It cannot bite before outreach runs, because zero outreach rows
  exist. It must be closed before that changes.
- **One external authorization** gates enrichment execution only. Planning already works and answers
  `no_available_source` honestly.

### Two corrections to WS-12, found while building this plan

**1. The unapplied migration is a HARD prerequisite, not a graceful degradation.** WS-12 stated the columns
"read as absent … no crash, no fabrication." That is true for `prospect_accounts` (read with `select('*')`,
so missing columns are simply `undefined`) but **false for `unified_persons`**:

`accountIntelligence.ts:335-341` selects an **explicit** column list — `['id', ...CONTACT_COLUMNS]` where
`CONTACT_COLUMNS` includes `authority`, `influence`, `buying_role`. Against a database without those columns
PostgREST returns `42703`, and the port's next line is `if (error) throw`. So Account Intelligence does not
degrade — it **fails**, and the WS-10 API reports its account section as `state: 'failed'`.

**Blast radius:** account intelligence · the buying-committee roster · WS-6's `relationships` (built from
`account.contacts`, so the relationship engine abstains) · the account half of ICP fit.
**Not affected:** prospect list, engagement/timeline, enrichment plan, outcomes, readiness/NBA, and person ICP
fit — WS-6's `PERSON_IDENTITY_COLUMNS` is `job_title, department, seniority`, all pre-existing under LI-1.

This raises the migration from "operational tidiness" to **gate condition #2**.

**2. `LEAD_UNDERSTANDING_ENABLED` is NOT an activation blocker.** It gates exactly one call site —
`shadowRuntime.ts:53`. The WS-10 read path, WS-6 context, WS-8 readiness and `assembleLeadUnderstanding` are
all flag-independent (verified: zero references across `apiHandlers/prospects/`, `pages/api/prospects/`,
`prospectContext.ts`, `prospectOutreach/`, `engines/assembly.ts`). PI activates with the flag **OFF**.

---

## 2. Current validated state

| Fact | Evidence |
|---|---|
| 1,739 / 1,739 PI tests pass, 64 suites | WS-12 §20 |
| Typecheck 3/3 clean; certification net-new 0 | WS-12 §20 |
| Zero test-only seams | WS-12 §2 — all ten have production callers |
| Canonical uniqueness verified by write-site scan | WS-12 §5 |
| Tenant isolation proven at every boundary | WS-12 §7 |
| `prospect_accounts`, `source_records`, nine `outreach_*` tables | **0 rows** (A3 migration check, 2026-09-01) |
| Providers `available: true` | `manual`, `crm`, `csv` only. AUTHORIZED: none. OPERATIONAL: none |
| `LEAD_UNDERSTANDING_ENABLED` | OFF (absent) |
| `ENABLE_LEAD_INGESTION` | default OFF |

---

## 3. Product decision matrix

| # | Decision | Class | Blocks initial activation? | Recommended action | Sequence |
|---|---|---|---:|---|---|
| 1 | FR-30 learning algorithm | C | **No** | **DEFER UNTIL DATA EXISTS** | Later maturity |
| 2 | Four score dimensions | B/C | **No** | 2 represent-not-score · 2 defer | After activation |
| 3 | Buying-signal vocabulary | B | **No** | Defer; revisit when signals are populated | After activation |
| 4 | Offering model | C | **No** | Future capability | Later maturity |
| 5 | unsubscribe → suppression | **B — compliance** | **No** — but gates first outreach dispatch | **DECIDE BEFORE OUTREACH ENABLEMENT** | Before outreach, not before PI |
| 6 | Outreach History contact-frequency | C | **No** | tasks + outcomes sufficient | Later maturity |
| 7 | `LEAD_UNDERSTANDING_ENABLED` ownership | E | **No** — PI is flag-independent | **DO NOT ACTIVATE YET** | Separate programme |
| 8 | `__global__` suppression consolidation | C | **No** | Frozen 1-evaluator/3-store model is sufficient | Later maturity |

**Class key:** A = required before any activation · B = required before a specific capability ·
C = enhancement/later maturity · D = external dependency · E = operational prerequisite.

---

## 4. FR-30 learning — decision

**Decision required:** what a learner proposes, over what window, at what confidence — or whether to build one
at all yet.

**Why it exists:** BR-18, BR-27 → FR-30 (WS-6). Frozen lineage §12: *"OUTCOME → LEARNING (**proposal only**)"*.

**Current state:** `prospectOutcomes/corpus.ts` reads the corpus, person-anchored, tenant-scoped, with
provenance, observability flags and observed-vs-derived separation. **It is an input seam, not learning.**

**What is blocked:** BR-18 ICP learning, BR-27 learning. Nothing else.

**Minimum viable decision — and the recommendation:**

> ### DEFER: NOT ACTIVATED UNTIL DATA EXISTS
>
> Production outcome volume is **zero**. Any learner built now would be validated against fabricated data,
> and its first real proposals would come from a corpus it was never tested on. Building it now buys nothing
> and creates a component nobody can trust.

**When data exists, the minimum acceptable mechanism** (recorded so the decision is not re-derived later):

| Property | Requirement |
|---|---|
| Output | An **unratified** `prospect_icp_versions` draft — never a write to a ratified version |
| Ratification | Human only. `ratifyIcpVersion` already requires `ratifiedByUserId` with no default |
| Explainability | Each proposed criterion cites the outcome rows that suggested it |
| Versioning | Reuses the existing immutable version chain; no new store |
| Tenant isolation | Proposals derived only from that tenant's own outcomes |
| Auditability | Proposal recorded with its input window and corpus size |
| Data floor | A stated minimum outcome count below which it declines to propose |

**Consequence of deferring:** none today — nothing can learn from zero rows.
**Risk of deferring:** none. **Risk of NOT deferring:** a learner tuned on synthetic data proposing ICP
criteria to real tenants.

---

## 5. Four scoring dimensions — analysed separately

The objective is to avoid **fake precision**. Each is judged on whether the *evidence* exists, not whether the
slot exists.

| Dimension | Evidence available today | Verdict | Reason |
|---|---|---|---|
| **Problem Fit** | none | **4 — dependent on another model** | Requires the offering model (§7). It is a relation between a tenant's offering and a prospect's problem; neither side is represented |
| **Account Potential** | partial — `prospect_accounts.{employee_count, annual_revenue, funding_stage, revenue_band}` exist | **2 — represented, not scored** | The *facts* exist and are already surfaced by WS-7 and the WS-10 API. What is missing is the **weighting** that turns "5,000 employees" into a potential score — pure product policy. Surfacing the facts is honest; scoring them is invention |
| **Buying Role** | **attribute exists and is populated-capable** | **2 — represented, not scored** | Already the case, and correct. `unified_persons.buying_role` carries a closed vocabulary; WS-7 aggregates it; WS-10 displays it. The *dimension* would need a role→score mapping (is a `champion` worth more than an `evaluator`?), which is policy. **This is already the shipped behaviour — no change needed** |
| **Relationship Strength** | **none** | **3 — deferred** | `engines/relationship.ts` exists but `ctx.relationships` carries only *roster membership and role*, never interaction strength. There is no reciprocity, tenure or depth signal anywhere. Scoring it would rank on data that does not exist |

**Recommendation: change nothing.** The current behaviour — all four reported `not_implemented` with a
reason, never `0` — is already the correct answer for all four. Two are blocked on policy, two on evidence.

**Critical distinction to preserve:** observed Buying Role (available) must never be silently converted into a
Buying Role score dimension. WS-10 already renders them as separate things, and WS-12 verified it.

---

## 6. Buying-signal vocabulary — decision

**The gap:** `lead_signals.source_type ∈ {engagement, listening}`; `BuyingSignalType` expects
`hiring | funding | exec_change | product_launch | …`. No bridge exists.

**Who consumes it:** `engines/buyingSignal.ts` only, which feeds the `intent` and `opportunity` dimensions.

**Does it block initial activation? NO.** `buyingSignal.ts` abstains without typed signals, and abstention is
already carried correctly to the API as `not_evaluated`. Intent still receives behavioural evidence through
`behavioral.ts`, which WS-6 wires from the engagement timeline.

**What it costs to defer:** intent and opportunity are scored from engagement alone, not from trigger events.
Recommendations skew toward `monitor`/`nurture` and away from `personalized_outreach`. That is a *weaker*
answer, not a *wrong* one.

**Recommendation: DEFER.** Revisit only when a source actually produces typed buying signals. **Do not invent
a mapping** — reinterpreting `engagement` as `hiring` would fabricate a trigger event the platform never
observed, and would make the recommendation engine confidently wrong rather than honestly quiet.

---

## 7. Offering model — decision

**Minimum representation needed** for Problem Fit, product/service alignment and problem relevance:

1. A tenant-owned offering entity (what we sell)
2. The problems each offering addresses
3. A way to express a prospect's problem — which requires evidence PI does not currently capture

**Recommendation: FUTURE CAPABILITY. Not required for activation.**

This is not a small addition. Item 3 in particular has no data source: nothing in intake, enrichment or
engagement captures a prospect's *problems*. Building 1 and 2 without 3 would produce an offering catalogue
that no scoring path could use.

**Do not design a product catalogue as part of PI activation.** If it is wanted, it is its own programme with
its own discovery.

---

## 8. Unsubscribe → suppression — the compliance decision

**⚠ This is a PRODUCT / COMPLIANCE decision that must precede any engineering. Nothing here implements it.**

**The gap, precisely:** `outreach_outcomes.outcome_type` accepts `unsubscribed` (WS-3 M7 migration
`20260915000000`), `feedbackSummary.ts` counts it, and **nothing translates it into
`contact_governance_records`** — so `mayContact` cannot see it.

**Why it is not blocking today:** zero outreach rows exist, so no `unsubscribed` outcome can exist, so
`mayContact` is not currently missing anything. **The exposure opens the moment outreach dispatches its first
message.**

**What already exists** (so the decision is smaller than it looks):

- The canonical vocabulary `GOVERNANCE_TYPES` **already contains `unsubscribe`** (`contactGovernance.ts:53`)
- The canonical writer `contactGovernanceWriter.ts` can already write it
- Precedence is already frozen by C-3: canonical first and authoritative; legacy may *add* a suppression,
  never *remove* one; unreadable ⇒ fail closed

**The decision the product/compliance owner must make:**

| # | Question | Options |
|---|---|---|
| 1 | Must `outcome_type = 'unsubscribed'` **automatically** create canonical suppression? | yes / operator-confirmed / no |
| 2 | **Scope** | the channel it arrived on, or `*` (all channels) |
| 3 | **Anchor** | `person_id`, `target_normalized`, or both |
| 4 | **Tenant vs global** | tenant-scoped (matching the canonical model), or `__global__` (which the canonical model cannot express — see §11) |
| 5 | **Revocable?** | may a person re-subscribe, and by whom |
| 6 | **Audit** | what evidence is retained linking the suppression to the outcome that caused it |
| 7 | **Legacy path** | may `suppressionService.unsubscribe()` (which writes legacy `suppression_entries`) remain as a compatibility path, or must it be redirected |

**Recommended sequence: DECIDE BEFORE OUTREACH ENABLEMENT.** It is **not** a PI activation gate; it **is** an
outreach-dispatch gate. Recorded as **Activation Gate #8**.

**Risk of deferring past that point:** a person who asked not to be contacted could be surfaced as
`readiness: ready` and contacted again. That is a regulatory exposure, not a product-quality one.

---

## 9. Outreach History — decision

**Current PI consumption:** `outreach_tasks` and `outreach_outcomes` (via `prospectOutcomes/corpus.ts`).
**Not consumed:** `attempts`, `approvals`, `decisions`, `delivery_evidence`.

**Are tasks + outcomes sufficient for initial activation? YES.**

- Outcomes give the business axis — what happened
- Tasks give the person anchor (`person_id`, the A3 composite FK) and the channel

The remaining four serve a **contact-frequency / recency** policy that does not exist. A PI reader for them
would have no consumer.

**Recommendation: DEFER the four. Do not create the policy as part of activation.**
The policy question — *"how recently is too recently to contact someone again"* — is a product judgement with
compliance overtones, and it should be decided alongside §8 rather than separately.

---

## 10. `LEAD_UNDERSTANDING_ENABLED` — decision

## Recommendation: **DO NOT ACTIVATE YET** — and it does not block PI

**Verified fact that changes this decision's urgency:** the flag gates exactly one call site,
`shadowRuntime.ts:53` (`computeLeadUnderstandingShadow`). It is referenced nowhere in the WS-10 read path,
WS-6 context, WS-8 readiness or the assembly. **Prospect Intelligence activates with the flag OFF.**

What the flag actually governs is the **shadow/authoritative runtime** that would eventually replace the
legacy lead read layer — a different programme with its own parity requirements
(`engines/authoritativeReadiness.ts` exists precisely to assess that flip: projection parity, deterministic
stability, contradiction handling, tenant isolation, observability).

| Question | Recommendation |
|---|---|
| **Owner** | The Lead Understanding programme owner, **not** PI. §18 of the manifest names it a product decision and names no owner — that naming is the actual outstanding item |
| **Evidence required before activation** | `assessAuthoritativeReadiness` passing all five gates over a real lead corpus, at the documented parity threshold (default 0.9) |
| **Global or staged** | **Staged.** Shadow first (`LEAD_UNDERSTANDING_ENABLED`), observe parity, then the separate authoritative flip (`LEAD_UNDERSTANDING_AUTHORITATIVE`) |
| **Tenant canary** | **Yes** — but note the flag is currently process-wide (`process.env`), not per-tenant. A tenant canary would require a per-tenant gate that does not exist. Record as a prerequisite, not an assumption |
| **Rollback** | Unset the variable; the shadow returns `null` and consumers keep the legacy read layer. No data migration, no cleanup |

---

## 11. `__global__` suppression consolidation — decision

**Recommendation: NOT REQUIRED for activation. The frozen model is sufficient.**

C-3 froze **one evaluator, three stores**:

| Store | Role |
|---|---|
| `contact_governance_records` | **CANONICAL** — `contactGovernanceWriter.ts` |
| `suppression_entries` | LEGACY, retained for the `__global__` scope the canonical model cannot express |
| `outreach_suppressions` | LEGACY, retained, WS-3 dispatch path |
| `consent_records` | **DIFFERENT DOMAIN** — OAuth/platform capability, excluded, asserted by test |

Both governance paths import the same evaluator (`execution/suppressionService.ts:49`,
`leadOutreachExecution/governanceService.ts:33`). Precedence is frozen: canonical is authoritative; legacy may
add a suppression but never remove one; unreadable ⇒ fail closed.

**Why consolidation is not needed:** there is no correctness gap. The only thing the canonical store cannot
express is `__global__` scope, and that is exactly why `suppression_entries` is retained. Consolidating would
require deciding what `__global__` means in a tenant-scoped model — which is the blocked product question, and
it does not need answering to activate PI.

**One dependency worth noting:** §8's question 4 (tenant vs global unsubscribe scope) touches this. If the
answer is "global", §11 becomes coupled to §8. If "tenant", they stay independent.

---

## 12. Operational activation sequence

**Nothing below was executed.** Each phase states its stop condition.

### PHASE A — Environment
| | |
|---|---|
| **Prerequisite** | none |
| **Action** | Ensure production carries `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `REDIS_URL`, `ENCRYPTION_KEY` |
| **Owner** | Platform / DevOps |
| **Evidence** | `npm run build` completes; `predeploy-check` passes |
| **Stop condition** | Build fails for any reason other than missing env |

### PHASE B — Database
| | |
|---|---|
| **Prerequisite** | Phase A |
| **Action** | Apply `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` — six additive nullable columns with closed-vocabulary CHECKs. Purely additive; no backfill; no rewrite |
| **Owner** | Database owner (**agent may not apply migrations**) |
| **Evidence** | The six columns present on `prospect_accounts` and `unified_persons`; `GET /api/prospects/:id` returns `account.state: "available"` rather than `"failed"` |
| **Stop condition** | Any CHECK constraint rejects existing data — would indicate values outside the frozen vocabularies |
| **Rollback** | `ALTER TABLE … DROP COLUMN` — additive nullable columns, nothing depends on them being populated |

### PHASE C — Data population
| | |
|---|---|
| **Prerequisite** | Phase B |
| **Action** | Enable ingestion for **one** pilot tenant and run a real CSV or CRM import |
| **Owner** | Product + the pilot tenant |
| **Evidence** | Non-zero `canonical_leads`, `prospect_accounts`, `source_records`, `source_assertions` for that tenant |
| **Stop condition** | `ingestLeadBatch` reports `identity_failed` or `provenance_failed` on a material share of rows |

### PHASE D — Feature flag
| | |
|---|---|
| **Prerequisite** | Phase C |
| **Action** | Set `ENABLE_LEAD_INGESTION=true`. **Leave `LEAD_UNDERSTANDING_ENABLED` OFF** — PI does not need it (§10) |
| **Owner** | Platform, on product sign-off |
| **Evidence** | Ingestion routes return `ok`; the capability gate no longer reports `ingestion_disabled` |
| **Rollback** | Unset the variable — read on every call, so it takes effect on the next request |

### PHASE E — Controlled tenant activation
| | |
|---|---|
| **Prerequisite** | Phase D |
| **Action** | Expose `/prospects/[id]` to the pilot tenant. Ratify one ICP via `POST /api/prospect-icp/ratify` (a tenant act, not a platform one) |
| **Owner** | Product + pilot tenant |
| **Evidence** | `GET /api/prospects` returns rows; `GET /api/prospects/:id` returns `available` for engagement, account, scoring, readiness |
| **Stop condition** | Any section returns `failed`; any cross-tenant row appears |

### PHASE F — Verification
| | |
|---|---|
| **Prerequisite** | Phase E |
| **Action** | Verify against the pilot tenant: ICP fit non-abstaining; the four dimensions report `not_implemented`; readiness reflects real governance; a suppressed prospect is `blocked` |
| **Owner** | Engineering + product |
| **Evidence** | The Activation Gate (§16) satisfied in production, not only in tests |
| **Stop condition** | **Any fabricated value** — a score where evidence is absent, a `0` where `not_implemented` is correct, a provider claimed operational |

### PHASE G — Wider activation
| | |
|---|---|
| **Prerequisite** | Phase F + §8 decided **if outreach is to be enabled** |
| **Action** | Extend to further tenants |
| **Owner** | Product |
| **Evidence** | Phase F repeated per tenant |
| **Stop condition** | Any tenant sees another tenant's data |

---

## 13. Minimum production data requirements

**No records are to be fabricated.** The minimum viable populated chain, and what each unlocks:

| Link | Minimum | Unlocks | Today |
|---|---|---|---|
| source → Prospect | 1 CSV/CRM import | prospect list, detail | `canonical_leads` populated (legacy); PI-created: 0 |
| Prospect → Person | records with an email/phone/provider key | identity, dedup | 0 PI-resolved |
| Person → Account | records with a domain or provider account ref | **account intelligence, company ICP fit, buying committee** | **`prospect_accounts` = 0** |
| → source records | automatic via LI-2 | provenance, completeness, consistency | **`source_records` = 0** |
| → engagement | existing threads linked to `unified_person_id` | timeline, intent, engagement dimension | populated (legacy engagement exists) |
| → ICP | 1 ratified ICP per tenant | icp dimension stops abstaining | **0 ratified** |
| → score | derived | 5 dimensions | derives from the above |
| → recommendation | derived | NBA | derives |
| → readiness | derived + governance | eligibility | works today (fails closed) |
| → outcome | requires outreach to run | corpus, FR-30 input | **all 9 outreach tables = 0** |

### Capabilities that cannot produce meaningful results until data exists — stated explicitly

- **Account Intelligence** — zero accounts. Correct and empty.
- **Company ICP fit** — no accounts to evaluate.
- **Buying committee roster** — no accounts, therefore no roster.
- **Provenance / consistency** — zero source assertions, so nothing can be contested or attested.
- **Outcome corpus** — zero rows.
- **FR-30 learning** — zero corpus. This is the hard floor, not a policy choice.

---

## 14. Provider authorization dependency

| | |
|---|---|
| **Current state** | DECLARED: `apollo`, `zoominfo`, `apollo_enrichment`, `zoominfo_enrichment`, `linkedin_sales_navigator`. AVAILABLE: `manual`, `crm`, `csv`. IMPLEMENTED: those three adapters. **AUTHORIZED: none. OPERATIONAL: none** |
| **Authorization requirement** | A commercial contract and a data-protection assessment — the manifest is explicit this is *"a commercial and data-protection decision, not an engineering one"* |
| **Prerequisites** | contract · DPA/lawful-basis assessment · tenant credential storage via `integration_credentials` · rate/cost limits |
| **What FR-08 needs afterwards** | One adapter conforming to `providerRegistry`, mapping provider fields to the LI-1 attribute surface, with cost reported as `{kind:'known'}` so the planner's cheapest-known ordering is meaningful |
| **Blocks** | BR-02, BR-07, BR-08, BR-09, FR-08 — and every enrichment plan that would otherwise select a source |
| **Does NOT block** | PI activation. Enrichment **planning** works today and answers `no_available_source` honestly |

**FR-08 remains sequenced behind this. Do not implement it now.**

---

## 15. Shortest safe activation path

### Required before ANY activation
1. **Production environment configuration** (Phase A)
2. **Apply `20261013000000`** (Phase B) — **hard prerequisite**, see §1 correction

### Required for initial Prospect Intelligence
3. `ENABLE_LEAD_INGESTION=true` for the pilot tenant
4. One real import (Phase C)
5. One ratified ICP per participating tenant
6. Phase F verification passed

### Can be deferred — with no loss of safety
- FR-30 learning · the four score dimensions · buying-signal vocabulary · offering model ·
  Outreach History's four unread tables · `__global__` consolidation · `LEAD_UNDERSTANDING_ENABLED`

### Requires external authorization
- People-data provider → then FR-08

### Later maturity
- Shadow → authoritative Lead Understanding flip · per-tenant flag gating · contact-frequency policy

### Required before OUTREACH (not before PI)
- **§8 unsubscribe → suppression decision.** PI may be activated read-only and intake-only without it.

**Why this is safe:** every deferred item is already reported by the implementation as
`not_implemented`, `not_evaluated` or `no_available_source`, with a reason. WS-12 verified across eight
collapse paths that nothing degrades into `0`, `false` or a fabricated value. Deferring them produces a
**quieter** product, not a misleading one.

**Where the line is drawn:** the two items that would create unsafe or misleading intelligence are the
migration (§1 — would show account intelligence as `failed`) and the unsubscribe decision (§8 — would surface
a suppressed person as contactable). Both are gates, not deferrals.

---

## 16. Activation Gate

All must be true before production activation:

1. Production environment carries all six required variables; `npm run build` succeeds.
2. `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` **applied**; the six columns exist.
3. `GET /api/prospects/:id` returns `account.state: "available"` — not `"failed"` — for a prospect with an account.
4. `ENABLE_LEAD_INGESTION` enabled **only** for tenants that have consented to participate.
5. At least one real import has produced non-zero `canonical_leads`, `prospect_accounts` and `source_records` for the pilot tenant.
6. At least one ratified ICP exists for each participating tenant.
7. A cross-tenant probe returns 404/empty for every PI endpoint, verified in production.
8. **If outreach is to be enabled:** §8 unsubscribe → suppression decided, and the seam built and tested.
9. No PI surface displays a score, confidence or provider status that the services did not produce — verified by inspection of a real prospect, not only by test.
10. Rollback rehearsed: unsetting `ENABLE_LEAD_INGESTION` halts intake at the next request.

**Gates 1–3 are operational. 4–7 are pilot conditions. 8 is compliance. 9–10 are verification.**

---

## 17. Deferred / future capabilities

| Capability | Why deferred | Revisit when |
|---|---|---|
| FR-30 learning | zero corpus | outcome volume is material |
| Problem Fit | needs offering model | offering programme exists |
| Account Potential (scored) | needs weights | product defines them |
| Buying Role (scored) | needs role→score policy | product defines it |
| Relationship Strength | **no relationship-strength evidence exists** | an interaction-depth signal is captured |
| Buying-signal vocabulary | no typed signals produced | a source emits them |
| Offering model | own programme | prioritised separately |
| Outreach History ×4 | no consumer without a frequency policy | policy decided |
| `__global__` consolidation | no correctness gap | `__global__` semantics decided |
| Authoritative Lead Understanding | separate programme | parity gates pass |

---

## 18. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Activating without the migration | **High** — account intelligence returns `failed`; users see a broken panel | Gate #2 and #3 |
| Enabling outreach before §8 | **High — regulatory** | Gate #8; PI read activation does not require outreach |
| Interpreting empty results as broken | Medium | Every empty state carries a reason string; brief operators that empty ≠ failed |
| Pressure to fill the four dimensions | Medium | They are `not_implemented` with a reason by design; filling them creates fake precision |
| Per-tenant flag expectation | Medium | `LEAD_UNDERSTANDING_ENABLED` is process-wide; a tenant canary needs a gate that does not exist |
| Legacy/canonical suppression divergence | Low | One evaluator; canonical authoritative; fail closed |
| Provider pressure | Low | Planner reports `no_available_source`; nothing claims operational |

---

## 19. Ownership

| Item | Owner |
|---|---|
| Environment configuration | Platform / DevOps |
| Migration application | Database owner — **not the agent** |
| `ENABLE_LEAD_INGESTION` | Platform, on product sign-off |
| Pilot tenant selection · ICP ratification | Product + tenant |
| §8 unsubscribe → suppression | **Product + Compliance** |
| §5 four dimensions · §6 vocabulary · §7 offering model | Product |
| §9 contact-frequency policy | Product + Compliance |
| §10 `LEAD_UNDERSTANDING_ENABLED` | **Unassigned — naming an owner is itself an outstanding decision** |
| Provider authorization | Commercial + Data Protection |
| FR-08 adapter | Engineering, **after** authorization |

---

## 20. No-code confirmation

- **No application code changed**
- **No schema changed**
- **No migration created**
- **No migration applied**
- **No feature flag changed** — `LEAD_UNDERSTANDING_ENABLED` and `ENABLE_LEAD_INGESTION` both untouched
- **No provider activated**
- **No deployment**
- **No merge**

This document is the decision record. **It implements nothing.**

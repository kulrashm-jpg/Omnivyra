# PI MANIFEST-RECONCILIATION-001 — ownership freeze

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes` · **HEAD at reconciliation:** `30188682`
**Scope:** documentation only. No application code, schema, migration, provider or flag was touched.
**Status:** the manifest is NOT self-correcting — §3 below lists corrections requiring PMO application, and
§5 lists three items that are PRODUCT DECISIONS and are deliberately left unassigned.

This artifact does **not** edit `IMPLEMENTATION-MANIFEST-001.md`. It states the exact minimal corrections
required so a single authoritative contract can be restored by whoever owns that document.

---

## 0. Correction to the WS-9 report

WS-9 reported "a direct contradiction" between its assigned scope and its prompt. Re-verified against the
manifest text, that framing is **imprecise and is corrected here**:

> The manifest is **internally consistent** about WS-9. §10 line 304, §16 line 449 and §15 line 392 all agree:
> WS-9 owns FR-28 Import, and it is satisfied. The divergence was between the **prompt's title** and the
> manifest — not between two parts of the manifest.

WS-9's substantive findings are otherwise confirmed by direct inspection. The genuine *internal* manifest
contradictions are I-1 and I-3 below, neither of which WS-9 reported.

---

## 1. Authoritative ownership matrix

| Requirement | Canonical owner | Current status | Canonical implementation | Remaining gap | Dependency |
|---|---|---|---|---|---|
| **FR-24** Next Best Action | **WS-8** | COMPLETE (runtime dark) | `leadUnderstanding/engines/recommendation.ts` (C-7). `lib/leadIntelligence/leadActions.ts` RETAINED legacy read-side | none | `LEAD_UNDERSTANDING_ENABLED` activation |
| **FR-25** Outreach Readiness | **WS-8** | COMPLETE | `services/prospectOutreach/readiness.ts` | manifest pointer is wrong — see **I-1** | none |
| **FR-26** Outreach Feedback | **WS-8** | **COMPLETE** | `leadOutreachExecution/feedbackIngestion.ts` + `pages/api/outreach/outcomes.ts`; persistence `outreach_outcomes` | **none — no further integration required** | none |
| **FR-28** Import | **WS-9** | **COMPLETE** | `leadIngestion/adapters/csvAdapter.ts` | **none — no remaining WS-9 work exists** | none |
| **FR-30** Learning | **WS-6** | NOT IMPLEMENTED | — (`future`, from `outreach_outcomes`) | algorithm undefined **and** zero outcome rows | see **§2 B** |
| **Outreach History** (INTEGRATE read-only into PI) | **WS-8** | **PARTIAL — 2 of 6 tables** | `services/prospectOutcomes/corpus.ts` reads `outreach_tasks` + `outreach_outcomes` | `attempts`, `approvals`, `decisions`, `delivery_evidence` have no PI reader — see **I-4** | product policy (contact frequency/recency) |
| **unsubscribe → suppression** | **UNASSIGNED** | not implemented | canonical vocabulary already supports it (`GOVERNANCE_TYPES` includes `unsubscribe`); writer exists (`contactGovernanceWriter.ts`) | the connecting seam only | **PRODUCT/COMPLIANCE DECISION** — see **§5 E** |
| **Problem Fit** (score dimension) | WS-6 | NOT IMPLEMENTED | — | not in `SCORE_DIMENSIONS`; no representation or weight defined | product decision |
| **Account Potential** (score dimension) | WS-6 | NOT IMPLEMENTED | — | same | product decision |
| **Buying Role** (score dimension) | WS-6 / WS-7 | NOT IMPLEMENTED **as a dimension** | *attribute* delivered: `unified_persons.buying_role` | dimension not in `SCORE_DIMENSIONS` — see **I-5** | product decision |
| **Relationship Strength** (score dimension) | WS-6 / WS-7 | NOT IMPLEMENTED | — | same | product decision |
| **Buying-signal vocabulary** | WS-5 (`lead_signals`) / WS-6 (consumer) | GAP | `lead_signals.source_type ∈ {engagement, listening}`; `BuyingSignalType` expects `hiring \| funding \| exec_change \| …` | no bridge exists; none may be inferred | product decision: extend the signal model, or accept that `buyingSignal.ts` abstains |
| **product/service alignment** | WS-6 (FR-16) | NOT IMPLEMENTED | — | relational tenant-specific fit concept, not an intrinsic company fact | requires an **offering model** |
| **problem relevance** | WS-6 (FR-17) | NOT IMPLEMENTED | — | same | requires an **offering model** |
| **`LEAD_UNDERSTANDING_ENABLED`** | **named in manifest §18 as a PRODUCT DECISION** | **OFF** (absent from environment) | `leadUnderstanding/flags.ts` | activation gate | product decision — owner not named in the manifest |

---

## 2. Reconciliation targets, resolved

### A. FR-26 Outreach Feedback — **COMPLETE, no further work**

- **Owner:** WS-8 (§16 line 447). Not WS-9.
- **Canonical implementation:** `feedbackIngestion.ts` (`ingestFeedback`) + `POST /api/outreach/outcomes`.
- **Canonical persistence:** `outreach_outcomes`, with **two** idempotency keys —
  `outreach_outcomes_idempotent UNIQUE (company_id, task_id, outcome_type, occurred_at)` and the partial
  unique `uq_outreach_outcomes_provider_event (company_id, provider, provider_event_id)`.
- **§19 AC-11** already records it EXISTS: *"Outcomes never rewrite history — append-only, dual idempotency,
  `derived` flag."*
- **Remaining integration required: NONE.** A second feedback ingestion path is prohibited.

### B. FR-30 Learning — **owner WS-6; blocked on TWO independent dependencies**

- **Owner:** WS-6 (§16 line 451). BR-18 and BR-27 both map to it.
- **Status:** NOT IMPLEMENTED.
- **The new outcome corpus (`services/prospectOutcomes/corpus.ts`) is an INPUT SEAM ONLY.** It reads;
  it proposes nothing, trains nothing and mutates no policy. It does not implement FR-30 or any part of it.
- **Exactly what remains, separated by dependency class:**
  1. **ALGORITHM DEFINITION** *(product + engineering)* — what a learner proposes, over what window, and at
     what confidence. Undefined. The frozen lineage constrains it to *"LEARNING (**proposal only**)"* (§12):
     a learner may propose; only a human ratifies.
  2. **DATA VOLUME** *(operational)* — the A3 migration records that, verified read-only against production
     on 2026-09-01, **all nine outreach tables held zero rows.** No corpus content exists to learn from.
- **The data gap has changed shape and the manifest is now stale about it** — see **I-2**.

### C. FR-28 Import — **WS-9 ownership confirmed; FULLY SATISFIED**

- §10 line 304: `WS-9 | Import / upload | csvAdapter, import lifecycle | orchestrator internals`.
- §16 line 449: FR-28 → `leadIngestion/adapters/csvAdapter.ts` → WS-9 → EXISTS.
- §15 line 392: BR-06 Import → FULLY SATISFIED.
- **Repository evidence:** `csvAdapter.ts` present; `jest csvAdapter piP1W02Csv` → **52/52 pass**.
- **Recorded explicitly: no remaining WS-9 work exists.**

### D. Outreach History — **owner WS-8; PARTIAL; the blocker is a MISSING PRODUCT POLICY**

- **Owner:** WS-8 (§2 line 163). **Boundary:** read-only into PI; PI never writes the outreach family.
- **Verified reader inventory:**

  | Table | Read into PI | Read inside Outreach Automation |
  |---|---|---|
  | `outreach_tasks` | ✅ `prospectOutcomes/corpus.ts` | `governanceService.ts`, `quota.ts` |
  | `outreach_outcomes` | ✅ `prospectOutcomes/corpus.ts` | — |
  | `outreach_attempts` | ❌ | `governanceService.ts`, `quota.ts` |
  | `outreach_approvals` | ❌ | — |
  | `outreach_decisions` | ❌ | — |
  | `outreach_delivery_evidence` | ❌ | — |

- **Classification:** the unread four are **not an implementation gap**. A PI reader for them has no consumer
  until a contact-frequency / recency policy exists, and WS-8 correctly declined to invent one. The
  requirement is therefore **blocked on product policy**, not on engineering.

### E. Unsubscribe → suppression — **NOT required by the frozen contract; PRODUCT/COMPLIANCE DECISION**

- **The manifest never uses the word "unsubscribe."** Verified: zero occurrences in
  `IMPLEMENTATION-MANIFEST-001.md`. The frozen contract therefore does **not** require this translation, and
  per the reconciliation rules ownership is **not assigned by inference**.
- **A mechanism partly exists, and this is the material finding:**
  - The **canonical** vocabulary `GOVERNANCE_TYPES` (`contactGovernance.ts:50`) **already includes
    `unsubscribe`**, alongside `bounce_hard` and `complaint`.
  - The **canonical writer** `contactGovernanceWriter.ts` can write it.
  - `execution/suppressionService.ts:329` exports `unsubscribe(...)`, but it writes the **LEGACY**
    `suppression_entries` store (C-3), and its only production caller is the operator-initiated
    `suppress` action at `pages/api/lead-intelligence/execution.ts:76`.
  - **Nothing connects an `outreach_outcomes` row of `outcome_type = 'unsubscribed'` to either writer.**
- **Smallest missing seam, if the decision is taken:** one call from the feedback path to
  `contactGovernanceWriter` with `governanceType: 'unsubscribe'`. No new store, no new evaluator.
- **The decision required is not engineering.** It is: (1) does an unsubscribe on one channel suppress that
  channel or all channels (`*`)? (2) is the record anchored to the person or the target? (3) is it revocable?
  C-3 already fixes precedence and fail-closed behaviour, so only scope and anchor are open.
- **⚠️ This is a live compliance exposure, not merely an integration gap:** `unsubscribed` outcomes are
  recorded and counted by `feedbackSummary.ts` while `mayContact` remains unaware of them.

---

## 3. Contradictions found, with required corrections

### I-1 · FR-25 points at the wrong module *(genuine internal contradiction)*

- **Section:** §16 line 446 — `| FR-25 | Outreach Readiness Contract | readiness contract | engines/authoritativeReadiness.ts | WS-8 | EXTEND |`
- **Conflict:** §18 simultaneously lists *"FR-25 readiness contract shape"* under **IMPLEMENTATION GAP** —
  i.e. the manifest asserts both that the implementation exists and that its shape is missing.
- **Repository evidence:** `assessAuthoritativeReadiness(cases, opts)` returns
  `{ leads, meanParity, stable, contradictionHandled, tenantIsolated, observable, gates, ready }`. It assesses
  whether the **platform** is ready for an authoritative flip. It carries no `prospect_id`, no channel, no
  suppression and no per-prospect concept of any kind. It is a different question that shares a word.
- **Required correction:**
  - §16 line 446 → `| FR-25 | Outreach Readiness Contract | readiness contract | `services/prospectOutreach/readiness.ts` | WS-8 | EXISTS |`
  - §18 IMPLEMENTATION GAP → remove `FR-25 readiness contract shape`.
  - Add to §11 Do-Not-Build: `| Second readiness model | services/prospectOutreach/readiness.ts — engines/authoritativeReadiness.ts assesses PLATFORM flip-readiness, a different question |`

### I-2 · FR-30's data gap is described in stale terms

- **Section:** §18 DATA / POPULATION GAP — `FR-30 (no outcome corpus)`.
- **Conflict:** FR-30 is listed under **both** IMPLEMENTATION GAP and DATA / POPULATION GAP without
  distinguishing what each class blocks.
- **Repository evidence:** `outreach_outcomes` has existed with a full schema since migration
  `20260910000000`, was extended by `20260915000000`, and is now PI-readable. The corpus is not absent; it is
  **empty** (A3 migration, production check 2026-09-01: all nine outreach tables zero rows).
- **Required correction:** §18 DATA / POPULATION GAP → replace `FR-30 (no outcome corpus)` with
  `FR-30 (outcome corpus exists and is PI-readable; zero rows in production)`. Leave FR-30 in IMPLEMENTATION
  GAP, since the algorithm remains undefined.

### I-3 · §2 and C-7/§16 disagree on the canonical Recommendation implementation *(genuine internal contradiction)*

- **Sections:** §2 line 161 — `| Recommendation | lib/leadIntelligence/leadActions.ts → buildLeadActionPlan | … | EXTEND | WS-8 |`
  versus §14 (C-7) — *"Canonical for FR-24: `engines/recommendation.ts`"* — and §16 line 445, which names
  `engines/recommendation.ts`.
- **Conflict:** the entity table names the **retained legacy** module as the Recommendation implementation;
  C-7 and the FR registry name the **canonical** one.
- **Repository evidence:** both exist. `engines/recommendation.ts` runs inside `assembly.ts:56`;
  `buildLeadActionPlan` is consumed by `leadIntelligenceReadService.ts:241,292`. C-7 froze the first as
  canonical and the second as retained legacy read-side, and recorded that no override was requested.
- **Required correction:** §2 line 161 →
  `| Recommendation | leadUnderstanding/engines/recommendation.ts (C-7 canonical); lib/leadIntelligence/leadActions.ts RETAINED legacy read-side | — | ctx tenant | EXTEND | WS-8 |`

### I-4 · Outreach History INTEGRATE has no PI consumer for four of six tables

- **Section:** §2 line 163.
- **Conflict:** status is asserted as an integration action with no completion criterion; four tables have no
  PI reader and no consumer.
- **Required correction:** §2 line 163 Action →
  `INTEGRATE (read-only into PI) — tasks + outcomes DONE (prospectOutcomes/corpus.ts); attempts/approvals/decisions/delivery_evidence BLOCKED ON PRODUCT POLICY (contact frequency/recency)`.

### I-5 · §2 "Buying Role — REQUIRED, NOT YET IMPLEMENTED" is stale and ambiguous

- **Section:** §2 line 164.
- **Repository evidence:** migration `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` added
  `unified_persons.buying_role` with a closed CHECK vocabulary mirrored by `BUYING_ROLES`; WS-7's
  `accountIntelligence.ts` aggregates it. The **attribute** is implemented; the **score dimension** is not.
- **Required correction:** split the row —
  `| Buying Role (attribute) | unified_persons.buying_role | … | EXISTS | WS-7 |` and
  `| Buying Role (score dimension) | — | — | REQUIRED — NOT YET IMPLEMENTED | WS-6 |`

### I-6 · §2 "Account Intelligence — REQUIRED, NOT YET IMPLEMENTED" is stale

- **Section:** §2 line 166.
- **Repository evidence:** `services/prospectIdentity/accountIntelligence.ts` (commit `fd3e9268`) aggregates
  `prospect_accounts` + engagement + tenant MarketPulse, tenant-scoped, deriving without storing.
- **Required correction:** Action → `EXISTS (services/prospectIdentity/accountIntelligence.ts)`.

### I-7 · Section-numbering note

The manifest contains **§0–§20**. Requests referring to a §22 have no target. §13 is a stub reading
*"Superseded by §20."* No correction is required; recorded so future references resolve.

---

## 4. Implementation sequencing after reconciliation

**Genuinely next (engineering, unblocked):**
- **WS-10 — API / UI.** Every read seam it needs now exists (WS-3, WS-5, WS-6, WS-7, WS-8, outcome corpus) and
  none of the open items blocks surfacing them.
- **WS-12 — final cross-workstream validation.** Deferred by instruction, but no longer blocked by a
  contract question once §3's corrections are applied.

**Blocked on PRODUCT DECISION (do not start):**
- FR-30 learning algorithm · the four scoring dimensions · buying-signal vocabulary ·
  product/service alignment + problem relevance (need an offering model) ·
  unsubscribe → suppression scope and anchor · Outreach History contact-frequency policy ·
  `LEAD_UNDERSTANDING_ENABLED` activation · `__global__` suppression consolidation (C-3).

**Blocked on OPERATIONAL / DATABASE action:**
- Applying the authored, unapplied migration `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql`.
- Outcome-corpus volume: zero rows across the outreach family; no learning input exists until outreach runs.
- `prospect_accounts` and `source_records` populations (§18 DATA gap, unchanged).

**Blocked on EXTERNAL AUTHORIZATION (unchanged):**
- BR-07 Sales Navigator; BR-08/BR-09; FR-08 — no authorized people-data provider.

**Should wait for WS-12:**
- Any merge of `feat/pi-ws6-ws7-icp-attributes`; any flag activation; any deployment.

---

## 5. Decisions required from the product team

These are stated, not resolved. None is assigned an implementation owner by inference.

1. **Unsubscribe → suppression** — channel-scoped or `*`; person- or target-anchored; revocable or not.
   *Compliance-bearing: `unsubscribed` outcomes exist today and `mayContact` cannot see them.*
2. **FR-30 learning** — what a learner proposes, over what window, at what confidence. Constrained by §12 to
   proposal-only; ratification stays human.
3. **The four scoring dimensions** — representation and weights, or an explicit decision to leave
   `SCORE_DIMENSIONS` at five.
4. **Buying-signal vocabulary** — extend `lead_signals`, or accept that `buyingSignal.ts` abstains for
   spine-derived contexts.
5. **Offering model** — required before product/service alignment and problem relevance can be facts rather
   than fabrications.
6. **`LEAD_UNDERSTANDING_ENABLED` activation** — §18 names it a product decision but names no owner.

---

## 6. No-code confirmation

- **No application code changed.**
- **No schema changed.**
- **No migration created or applied.**
- **No provider activated.**
- **No feature flag changed** — `LEAD_UNDERSTANDING_ENABLED` remains absent from the environment (OFF).
- **`SCORE_DIMENSIONS` unchanged** — verified `['intent', 'icp', 'urgency', 'opportunity', 'priority']`.
- **`IMPLEMENTATION-MANIFEST-001.md` NOT edited** — corrections are stated in §3 for PMO application.
- **No merge. No deploy. WS-12 not run.**

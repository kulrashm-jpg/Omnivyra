# OMNIVYRA-PI-INTENT-004 — opportunity spine design and owner decisions

**Design and decision-preparation only.** No product change, schema change, migration, provider call, production access, commit, push or deployment. This document is the only file created.

| | |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` / `fix/r1-profile-context` — **matches** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches** |
| Worktree at start | **127 entries (67 M / 60 ??), 0 staged** — identical to the capability-audit close state; nothing reset, cleaned, stashed or discarded |
| Controlling audit | `OMNIVYRA-PI-INTENT-CAPABILITY-AUDIT-001.md` · SHA-256 `37dda8956cc81b03` — **verified unchanged** |
| Execution ledger | `PI-MILESTONE-A-EXECUTION-001.md` · `1ad1105accdd5866` — **verified unchanged** |
| Start | **2026-10-17T15:03:36+05:30** |
| External wait before start | 26 min 51 s (audit close 14:36:45 → 15:03:36), tracked separately |

**Schedule, unchanged and not expanded.** WP-7 remains the Active-Leads-to-PI integration work package at **4.0 engineer-days, baseline Tue 2026-11-17**. Milestone A′ remains frozen at **2026-11-25**. Everything proposed in this document is **new scope beyond Milestone A′** with its own baseline, and is **not** folded into WP-7. No OVERRUN RISK: this task is design-only and consumed no WP-7 budget.

**Note on scope.** The brief as received ends after §3. This document answers §1 (baseline), §2 (evaluate D-A) and §3 (minimum canonical opportunity model), and raises the decisions those two sections surface. No section beyond §3 is assumed.

---

## 1. One new piece of evidence that bears directly on D-A

The audit recorded two opportunity models. Inspecting the schema for this design found **six** lead/opportunity-shaped models, and one of them is a tenant-safety outlier.

| Model | Tenant key | Live? |
|---|---|---|
| `canonical_leads` (PI prospect) | `company_id uuid NOT NULL REFERENCES companies(id)` | **yes** — WP-6 verified |
| `opportunity_feed_items` (Community) | `organization_id uuid NOT NULL REFERENCES companies(id)` | **yes** — `opportunityFeedService:489` |
| `active_leads` (roll-up) | `organization_id uuid NOT NULL REFERENCES companies(id)` | **yes** |
| `lead_signals` (signal store) | `organization_id uuid NOT NULL REFERENCES companies(id)` | **yes** — `canonicalLeadSignalService` sole writer |
| `contacts` (Community person) | `organization_id uuid NOT NULL REFERENCES companies(id)` | **yes** |
| **`lead_intelligence`** | **`company_id text NOT NULL` — no FK, not a uuid** | repository exists (`leadIntelligenceRepository.ts:27`), no observed producer |
| plus | `lead_intelligence_profiles`, `marketpulse_signals`, legacy `leads` (web-form/visitor attribution, a different entity) | — |

`lead_intelligence`'s own header is explicit that it touches nothing else: *"Existing lead tables (leads, active_leads, canonical_leads, lead_signals, opportunity_feed_items, marketpulse_signals, …) are untouched."* It is the clearest available demonstration of what happens when a new parallel store is added to solve a modelling gap: a seventh table, with a weaker tenant contract than every neighbour, and no adoption.

**Design consequence, and it is the dominant one: the correct move is to add the missing *noun* to PI and bridge, never to add a seventh parallel store.** This constrains both options below, and it is why the model in §3 reuses four existing tables and adds as little as possible.

---

## 2. D-A evaluated — who owns discovery, and who owns canonical opportunity data

### 2.1 What each option actually means, given the code

**Option A — Community Discovery is the discovery front end; PI is the canonical spine.**
`lead_signals` → `opportunityClassifierService` → `intentClusteringService` → `opportunity_feed_items` all stay exactly as they are. PI gains a canonical opportunity entity and receives each qualified detection through the existing approved intake boundary, with provenance.

**Option B — PI owns classification as well as canonical opportunity data.**
The eight-type classifier, the clustering service, the scoring breakdown and the feed read contract move into PI-owned services, and Community Discovery becomes a source adapter or is retired.

### 2.2 Comparison on the audit's evidence

| Criterion | Option A | Option B |
|---|---|---|
| **Reuse of working functionality** | **Keeps all of it.** `opportunityClassifierService` is deterministic, AI-free, specificity-first, with `matched_keywords`, `detected_reason`, `explanation` and `score_breakdown`; `signal_intent_clusters` already provides signals-over-time; `resolved_company`/`resolved_role`/`identity_confidence` already provide Path B | **Rebuilds or relocates all of it** for no new capability. The classifier is the single most valuable asset the audit found, and moving it is pure rework |
| **Canonical ownership / duplication** | PI owns identity, provenance, consent and the opportunity noun; Community owns detection. One canonical opportunity, no new parallel store | Also ends with one owner — but **passes through a transitional state with both a Community and a PI classifier live**, which is a seventh model in all but name, exactly the `lead_intelligence` failure mode |
| **Consent, suppression, provenance, auditability** | **Closes R-3 at the bridge.** Every detection that names or resolves a person passes `contactGovernance.mayContact` before any action, and lands with `source_records`/`source_assertions` provenance | Closes R-3 too, but only once migration completes. Until then the Community path keeps reaching people outside `mayContact` — the compliance gap stays open longer |
| **Migration risk / compatibility** | **Additive.** `GET /api/active-leads/opportunities` keeps reading `opportunity_feed_items` through `legacyOpportunityCompat`, whose projection is deliberately *field-preserving and byte-identical*. Nothing existing changes shape | **High.** That byte-identical legacy contract must be preserved across a classifier change, and `active_leads` is keyed `(organization_id, contact_id, opportunity_type)` on the Community vocabulary — so the enum, the roll-up and the UI move together |
| **Tenant isolation and data access** | Canonical side inherits PI's composite tenant-safe FKs, proven unconstructible cross-tenant (WP-6 tests 16, 27). Community side keeps its existing `organization_id` FKs | Same end state, but every migrated write is a new tenant-safety surface needing its own proof |
| **Future Active Leads / MarketPulse / market-post / social integrations** | **One intake seam.** Each future source targets the PI boundary WP-6 already verified; MarketPulse keeps its read-only contract and would contribute *market context*, never a fabricated company subject | Each future source must be re-platformed into PI-owned classification first, so every integration pays the migration cost again |
| **Testability** | The real-schema harness pattern exists and is proven (`i2l_intake_to_list` 27/27, `pl_prospect_lists` 27/27). A bridge is testable with exactly that pattern | The classifier currently has unit coverage only; relocating it requires building real-schema coverage for classification *and* for the bridge |
| **Operational complexity** | Two services with one clear seam. The cost is a seam to keep honest | One service eventually; two classifiers and a dual-write window during migration |
| **Effort / schedule risk** | **≈ 11–18 engineer-days** (C-1 5–8 d + C-2 6–10 d), additive, independently shippable | **≈ 25–40 engineer-days** plus legacy-contract risk, and the consent gap stays open throughout |

### 2.3 Recommendation

**Option A is recommended.** This is a recommendation only and is **NOT** recorded as an owner-approved decision; D-A remains open.

The reasoning in one line: the audit found that Omnivyra's intent intelligence already works and its canonical governance already works, and that the only missing thing between them is a noun and a seam — so the change that adds a noun and a seam dominates the change that relocates working code, on every criterion including the compliance-relevant one.

Two honest caveats against the recommendation, stated because they are the strongest arguments the other way:

1. **Option A institutionalises two systems.** The seam must be maintained, and a reader looking at `opportunity_feed_items` and `prospect_opportunities` must be able to tell which is detection and which is canonical. §3 addresses this with a one-way rule and a `detection_ref`, but it is a real ongoing cost.
2. **Classification stays outside PI's governance.** Under Option A the classifier remains the authority on *what a signal means*, while PI is the authority on *who it is about and whether we may act*. If the owner's intent is that PI should own meaning too, Option B is the honest route and should be chosen deliberately rather than arrived at later by drift.

**If Option A is approved, one rule should be approved with it:** the bridge is **one-way**. Community detection writes to PI; PI never writes back into `opportunity_feed_items`. Without that rule the two models will diverge and R-1 returns in a worse form.

---

## 3. The minimum canonical opportunity model

### 3.1 What already satisfies the requirements — reuse first

Inspected before proposing anything. Four existing structures genuinely satisfy large parts of §3 and are reused unchanged or nearly so.

| Requirement | Satisfied by | Verdict |
|---|---|---|
| Separate **fit, intent, confidence, qualification** state | `prospect_score_evaluations`: `score_icp`, `score_intent`, `score_urgency`, **`score_opportunity`**, `score_priority`, `score_overall`, `confidence` | **REUSE** — `score_opportunity` already exists. Needs one ALTER (§3.4) |
| **Evaluation version** | same: `icp_id`, `icp_version`, `rules_version`, `input_digest`, with a unique key on `(organization_id, prospect_id, icp_version, rules_version, input_digest)` | **REUSE** |
| **Reasoned explanation** | same: `reasoning`, `contributions`, `facets`, **`context_gaps`** jsonb | **REUSE** — `context_gaps` is already the channel that carries refusals with the answer |
| **Supporting signals and evidence** | `lead_signals`: tenant-safe, `source_id` + `UNIQUE (organization_id, source_type, source_id)` for idempotency, `detected_at` for freshness, `content_text`, `platform`, `metadata`, and intent/urgency/icp/confidence scores | **REUSE as the signal store.** `source_type` CHECK is `('engagement','listening')` and would need widening only when company-event signals arrive (C-3), not now |
| **Suppression / consent** | `contact_governance_records` + `contactGovernance.mayContact` (pure, nine governance types, tenant-scoped — WP-6 tests 23–25) | **REUSE UNCHANGED** |
| Company / person subjects | `prospect_accounts`, `unified_persons` | **REUSE UNCHANGED** |
| Audit / append-only decisions | `canonical_attribute_decisions` + its append-only trigger, and the `20261124000000` precedent for widening an `entity_type` CHECK | **REUSE the pattern** |
| Atomic multi-table write | `pi_apply_canonical_decisions` (WP-2) and the `pi_relationship_set_primary` plpgsql precedent | **REUSE the pattern** |

### 3.2 What genuinely does not exist, and why each gap is real

| Gap | Evidence it cannot be reused |
|---|---|
| **The opportunity noun** | `canonical_leads` is `(id, company_id, user_id, source, created_at, qualification_score, unified_person_id, external_lead_key)` — no need, no account, no reason. It is a *prospect*, not an opportunity |
| **An account-anchored subject with no person** | `canonical_leads` has **no account column at all**; the person→account link runs through `unified_persons.account_id` / `person_account_relationships`. So an opportunity keyed on `canonical_leads` cannot be account-anchored without a person |
| **An inferred buying role with no person** | `person_account_relationships` carries `buying_role` but requires **`person_id NOT NULL` AND `account_id NOT NULL`**. It cannot hold an inferred role, which is exactly the Path B requirement |
| **Signal → opportunity linkage** | nothing links `lead_signals` to any canonical entity. `opportunity_feed_items.signal_id` is 1:1 to a single signal; an opportunity needs many, over time |
| **Need ↔ tenant offering** | nothing anywhere reads `products_services_list` / `core_problem_statement` against an observed need (audit F-7) |

`source_assertions` was considered and **rejected** as the evidence carrier: it requires `attribute` + `value_hash` with `entity_type IN ('person','account')`, so it models *an attribute claim about a subject*. A signal is not an attribute claim, and forcing one into that shape would corrupt the arbitration model WP-2 just made atomic.

### 3.3 Proposed new objects — three tables

Minimal, additive, following existing PI conventions exactly (uuid tenant FK, composite tenant-safe FKs, closed CHECK vocabularies, nullable subjects with a coherence CHECK).

**(1) `prospect_opportunities` — the noun**

| Column | Purpose |
|---|---|
| `id uuid PK` | opportunity identity |
| `organization_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE` | **tenant-scoped identity** |
| `account_id uuid` + composite FK `(account_id, organization_id) → prospect_accounts(id, organization_id)` | company relationship **where known** |
| `person_id uuid` + composite FK `(person_id, organization_id) → unified_persons(id, company_id)` | **optional** person relationship |
| `opportunity_type text NOT NULL` | CHECK over the **existing eight-value Community vocabulary**, so the two models speak one language |
| `need_statement text` | the inferred need or business problem, as stated by evidence |
| `need_source text NOT NULL` | CHECK `('classified_signal','company_event','manual','crm')` — **how** the need was arrived at, so an inference is never read as a declaration |
| `detected_reason text NOT NULL` | carried verbatim from `opportunity_feed_items.detected_reason` — the reason survives the bridge |
| `detection_ref uuid` | the originating `opportunity_feed_items.id`, so provenance points back without a circular FK |
| `status text NOT NULL DEFAULT 'open'` | CHECK `('open','qualified','disqualified','acted','closed','superseded')` — **lifecycle, not score** |
| `dedupe_key text NOT NULL` + `UNIQUE (organization_id, dedupe_key)` | **duplicate detection and updates**: re-detection updates one row rather than minting a second |
| `first_detected_at`, `last_detected_at timestamptz NOT NULL` | freshness, and the window a cluster spans |
| `created_at`, `updated_at` | — |
| CHECK | `account_id IS NOT NULL OR person_id IS NOT NULL` — an opportunity about nobody and no company is not an opportunity |

RLS enabled with the existing `service_role` policy for parity, plus the `omnivyra_touch_updated_at` trigger, matching `20261127000000`.

**(2) `prospect_opportunity_signals` — the evidence links**

`(id, organization_id, opportunity_id, signal_id, contribution text, linked_at)`, with composite tenant-safe FKs onto `prospect_opportunities` and `lead_signals`, and `UNIQUE (organization_id, opportunity_id, signal_id)`.

This is what makes "one or more supporting signals" and **"preserve the evidence behind each opportunity"** true: the opportunity never copies signal content, it references it, so freshness and provenance stay with the signal and cannot drift.

**(3) `prospect_opportunity_roles` — the inferred buying role, with no fictitious person**

`(id, organization_id, opportunity_id, buying_role text NOT NULL, inferred_from text NOT NULL, confidence numeric, person_id uuid NULL, created_at)`.

- `buying_role` CHECK over the existing `BUYING_ROLES` vocabulary, so it means the same thing it means on `unified_persons.buying_role`.
- `inferred_from` CHECK `('title_keyword','resolved_role','relationship_graph','manual')` — **the role is always labelled as inferred**, which is the control that stops it being read as verified.
- `person_id` **nullable**: null is the Path B case (a role with no person). When a real person is later discovered, the row is linked rather than replaced, so the inference and its confirmation are both auditable.
- **No row here ever creates a person.** This table is the reason the audit's F-3 property ("inferred roles are not stored as verified people") survives the new model.

### 3.4 Proposed ALTERs — two, both small

| Target | Change | Why |
|---|---|---|
| `prospect_score_evaluations` | add `opportunity_id uuid` (+ composite tenant-safe FK); relax `prospect_id` to nullable; add CHECK `num_nonnulls(prospect_id, opportunity_id) = 1` | **One evaluation authority.** Fit, intent, confidence, qualification, `rules_version` and `reasoning` already live here; adding a second scoring store would be a second scoring model, which `prospectContext.ts` and `combineScores` explicitly exist to prevent. The pattern mirrors `canonical_attribute_decisions`' nullable subjects plus coherence CHECK |
| `lead_signals` | widen `source_type` CHECK beyond `('engagement','listening')` | **Deferred, not part of the minimum.** Needed only when a company-event producer exists (C-3, blocked on D-D). Recorded here so the eventual change is one CHECK rather than a new table |

### 3.5 Requirement-by-requirement coverage

| §3 requirement | How it is met | New or reused |
|---|---|---|
| Tenant-scoped opportunity identity | `prospect_opportunities.organization_id` uuid FK | new |
| Company/account relationship where known | nullable `account_id` + composite tenant-safe FK | new |
| Optional person relationship | nullable `person_id` + composite tenant-safe FK | new |
| Inferred buying role without a fictitious person | `prospect_opportunity_roles` with nullable `person_id` and mandatory `inferred_from` | new |
| One or more supporting signals and evidence refs | `prospect_opportunity_signals` → `lead_signals` | new link, reused store |
| The inferred need or business problem | `need_statement` + `need_source` + `detected_reason` | new |
| **The tenant offering that may address the need** | **NOT MET — see §3.6** | — |
| Evidence provenance, timestamps, freshness | `lead_signals.detected_at`; `first_detected_at`/`last_detected_at`; `detection_ref` | reused + new |
| Separate fit, intent, confidence, qualification | `prospect_score_evaluations` (`score_icp`, `score_intent`, `confidence`, …) + `status` for lifecycle | reused + ALTER |
| Evaluation version and reasoned explanation | `rules_version`, `icp_version`, `input_digest`, `reasoning`, `context_gaps` | reused |
| Duplicate detection and updates | `UNIQUE (organization_id, dedupe_key)` + `last_detected_at` | new |
| Suppression, consent, permitted next action | `contact_governance_records` + `mayContact` at the bridge and before any action | reused unchanged |
| Auditability, retention, erasure interactions | see §3.7 | reused pattern |

### 3.6 The one requirement this model does not meet, and why that is deliberate

**"The tenant offering that may address the need" is NOT represented in the minimum model, on purpose.**

The honest reason: the audit established (F-7) that nothing joins a detected need to `products_services_list` or `core_problem_statement`, and (§7.3) that those fields are **free prose** with no vocabulary and no embedding. A column such as `matched_offering text` could be added in an hour and would be **fabricated data** until a matcher exists — which is precisely the failure this programme has spent four work packages avoiding.

The model therefore leaves a clean place for it: when C-4 (need→offering matching) is authorized and a method is chosen under **D-E**, the match becomes either a column on `prospect_opportunities` or its own evidence-bearing table, with its own confidence and its own reasoning trace. Until then the field is absent rather than empty-and-misleading.

### 3.7 Retention and erasure interactions, stated rather than assumed

Three behaviours need an explicit decision because the existing erasure path does not know about opportunities:

1. **Person erasure.** `personErasure.deletePersonRow` deletes `unified_persons`; `canonical_leads.unified_person_id` is `ON DELETE SET NULL`, which WP-2's real-schema test 19 proved leaves a membership active. An opportunity's `person_id` should behave the same way — `ON DELETE SET NULL`, so the **opportunity survives as account-anchored** and the evidence is not destroyed by erasing a person. That is almost certainly the right answer for an audit trail, and it is still a decision.
2. **Account deletion.** `ON DELETE SET NULL` on `account_id` would leave an opportunity with neither subject, violating the §3.3 CHECK. Either cascade the opportunity or forbid account deletion while open — **a decision, not a default.**
3. **Signal retention.** If `lead_signals` rows are ever pruned, `prospect_opportunity_signals` loses the evidence behind an opportunity. Either the link cascades (and the opportunity keeps `detected_reason` but loses its evidence) or signals referenced by an open opportunity are retained.

These are the same class of question as the still-open `PL-DEC-003` erasure-residue decision, and should be answered the same way: by the owner, with the options named.

### 3.8 The bridge, in one traced flow

```
lead_signals (engagement | listening)                       [existing, live]
  -> opportunityClassifierService.classifyOpportunity       [existing, deterministic]
  -> intentClusteringService -> signal_intent_clusters      [existing]
  -> opportunity_feed_items                                 [existing, DETECTION record]
         |
         |  === THE BRIDGE (C-2) — one way only ===
         v
  resolveOrCreateAccount / resolveUnifiedPerson             [existing PI boundary, WP-6 verified]
  -> source_records / source_assertions                     [existing provenance]
  -> prospect_opportunities        (dedupe_key, detected_reason, detection_ref)   [NEW]
  -> prospect_opportunity_signals  (-> lead_signals)                              [NEW]
  -> prospect_opportunity_roles    (inferred_from, person_id NULLABLE)            [NEW]
  -> prospect_score_evaluations    (opportunity_id, rules_version, reasoning)      [ALTER]
  -> contactGovernance.mayContact  BEFORE any action                [existing, unchanged]
  -> prospect_lists / next action
```

Written atomically through a plpgsql function on the `pi_apply_canonical_decisions` / `pi_relationship_set_primary` precedent, so an opportunity, its signal links and its roles commit together or not at all — the same property WP-2 established for canonical attributes.

---

## 4. Decisions required

| ID | Decision | Status | Blocks |
|---|---|---|---|
| **D-A** | Option A (recommended) or Option B | **OPEN — not approved here** | everything below |
| **D-A.1** | If Option A: approve the **one-way bridge rule** (PI never writes back to `opportunity_feed_items`) | OPEN | §3.8 |
| **D-B** | **Person-optional opportunity keying** — may an opportunity exist against an account with no person? §3.3 assumes **yes**, with the CHECK `account_id IS NOT NULL OR person_id IS NOT NULL`. This is the design crux of Path B | OPEN | `prospect_opportunities` |
| **D-C** | `contacts` ↔ `unified_persons` reconciliation: link, park as duplicate candidates, or leave separate. Recommend **park**, reusing `personDuplicates` which parks and never merges | OPEN | the bridge |
| **D-E** | Need→offering matching method: curated vocabulary or embeddings | OPEN | §3.6, C-4 |
| **D-H (new)** | **Opportunity retention and erasure**: the three behaviours in §3.7 | OPEN | the migration |
| **D-I (new)** | **Roles table vs jsonb.** A smaller variant stores inferred roles as jsonb on the opportunity: one fewer table, but a buying committee stops being queryable and linking a later-discovered real person becomes an in-place rewrite rather than an auditable link. Recommend the table | OPEN | `prospect_opportunity_roles` |
| D-D | Authorized source for company-event signals | OPEN | C-3 only, not the minimum model |
| OD-3 / OD-4 / OD-5 | List permissions, `added_via`, erasure residue | **still open** | WP-4 / WP-5 |

## 5. Effort and confidence

Engineering effort only; external waiting excluded. Not comparable to the frozen human-engineer-day baseline, for the reason in execution ledger §9.7.

| Item | Effort | Confidence | Basis |
|---|---|---|---|
| `prospect_opportunities` + 2 link tables + migration | **3–5 d** | **MEDIUM-HIGH** | `20261127000000_pi_prospect_lists.sql` is a direct template: composite tenant-safe FKs, partial unique index, RLS, touch trigger |
| `prospect_score_evaluations` ALTER + coherence CHECK | **1–2 d** | **HIGH** | `20261124000000` did exactly this to `canonical_attribute_decisions` |
| Atomic write function + real-schema tests | **3–4 d** | **MEDIUM-HIGH** | WP-2's function and its 21-test suite are the pattern |
| **C-1 subtotal** | **5–8 d** | MEDIUM-HIGH | matches the audit estimate |
| **C-2 bridge** (incl. `mayContact` enforcement and dedupe) | **6–10 d** | **MEDIUM** | `contacts`↔`unified_persons` reconciliation (D-C) is the risk |
| C-4 need→offering matching | 5–8 d | MEDIUM | blocked on D-E |
| C-3 company-event producer | 8–15 d | **LOW** | no authorized source identified; blocked on D-D |

**Milestone A′ (2026-11-25) and WP-7 (2026-11-17, 4.0 d) are untouched.** C-1 and C-2 are new scope requiring their own owner-approved baseline. WP-7 as chartered is Active-Leads-to-PI integration; **if D-A selects Option A, WP-7 becomes the first consumer of this model rather than a separate integration** — which is an argument for sequencing C-1 before WP-7, and itself an owner decision, not one taken here.

## 6. What this design deliberately does not do

- No second canonical prospect, person, account, suppression or MarketPulse repository — and, on the §1 evidence, no seventh lead model.
- No change to WP-2 atomicity, WP-3 security behaviour, arbitration, or the canonical write semantics.
- No decision on OD-3 / OD-4 / OD-5, which stay with WP-4 / WP-5.
- No `matched_offering` field until a matcher exists (§3.6).
- No intent minted from a company event: `need_source` records how a need was arrived at, and `buyingSignal` already contributes `opportunity` and `urgency` with **no independent buying score**, which is the shape to preserve.
- No implementation. Nothing in §3 was built.

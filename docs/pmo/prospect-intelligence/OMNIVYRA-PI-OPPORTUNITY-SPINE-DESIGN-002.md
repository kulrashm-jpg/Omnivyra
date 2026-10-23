# OMNIVYRA-PI-INTENT-005 — design completion and C-1 implementation gate

**Design-only.** No product change, schema change, migration, provider call, production access, commit, push or deployment. This document is the only file created.

Continuation of **`OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md`** (`257185e621fa0b80`), which remains in force and is not edited. Governed by **`OMNIVYRA-PI-INTENT-CAPABILITY-AUDIT-001.md`** (`37dda8956cc81b03`). Schedule authority: **`PI-MILESTONE-A-EXECUTION-001.md`** (`1ad1105accdd5866`).

| | |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` / `fix/r1-profile-context` — **matches** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches** |
| Worktree at start | **128 entries (67 M / 61 ??), 0 staged** — identical to the DESIGN-001 close state |
| Start | **2026-10-17T15:23:53+05:30** |
| External wait before start | 15 min 05 s (15:08:48 → 15:23:53), tracked separately |

**Scope note.** The brief as received is truncated mid-sentence at *"Do not create another canonical prospect, person,"*. The completed constraint is the one already established and in force across this programme: **no second canonical prospect, person, account, suppression or MarketPulse repository**, and — on the DESIGN-001 §1 evidence of six existing lead models — no seventh parallel lead store. Nothing beyond the received text is assumed.

---

## 0. Owner-decision status — RECORDED SEPARATELY, NONE APPROVED

The brief lists D-A, D-A.1, D-B, D-C, D-E, D-H, D-I with descriptions, and separately instructs: *"Do not mark recommendations as approved unless explicit owner authorization is present."* **No explicit authorization accompanies that list.** Every item below is therefore recorded as a **recommendation awaiting decision**, exactly as in DESIGN-001 §4. This document is designed so that no section depends on treating any of them as settled.

| ID | Recommendation as stated | Status |
|---|---|---|
| **D-A** | Community Discovery remains discovery/classification; PI owns canonical opportunities and qualification | **OPEN — recommended, not approved** |
| **D-A.1** | One-way bridge; PI never writes back to `opportunity_feed_items` | **OPEN — recommended, not approved** |
| **D-B** | Opportunities may exist without a named person | **OPEN — recommended, not approved** |
| **D-C** | Park `contacts`/`unified_persons` reconciliation; reuse existing dedup, never merge | **OPEN — recommended, not approved** |
| **D-E** | Evidence-backed matching against the tenant's products and services | **OPEN — recommended, not approved.** Method (vocabulary vs embeddings) still unspecified — see §3.4 |
| **D-H** | Retention, deletion and erasure behaviour | **OPEN — recommended, not approved.** Three sub-cases, §6 |
| **D-I** | Relational buying-role records rather than JSONB | **OPEN — recommended, not approved** |
| **OD-3 / OD-4 / OD-5** | List governance, `added_via`, erasure residue | **OUTSTANDING** — still block WP-4/WP-5 |

**What is blocked, and the smallest decision that unblocks it** — stated rather than guessed:

| Blocked item | Smallest decision needed |
|---|---|
| `prospect_opportunities` CHECK shape (§5.1) | **D-B only.** If opportunities may be account-only, the CHECK is `account_id IS NOT NULL OR person_id IS NOT NULL`. If not, `person_id` becomes `NOT NULL` and Path B is abandoned — a different product |
| Offering-match storage (§3) | **D-E method.** A column is safe under a vocabulary; an embedding needs its own table and freshness. **Not guessed** — §3.4 gives both shapes and the decision between them |
| `account_id` FK delete action (§6.2) | **D-H case 2 only.** The other two sub-cases have safe defaults; this one does not |
| Role storage (§4.3) | **D-I.** Both shapes are specified; the table is recommended |

---

## 1. Community Discovery → PI bridge contract

### 1.1 One-way ownership

| Owns | Authority |
|---|---|
| **Community Discovery** | what a signal *means* — `opportunity_type`, `matched_keywords`, `detected_reason`, `score_breakdown`, clustering |
| **Prospect Intelligence** | who it is *about*, whether we *may act*, and what we *decided* — identity, provenance, consent, qualification, lifecycle |

**Rule (D-A.1, recommended):** the bridge is one-way. PI reads `opportunity_feed_items` and writes `prospect_opportunities`. **PI never writes to `opportunity_feed_items`, `signal_intent_clusters`, `lead_signals` or `active_leads`.** Enforced by a tree-walking test, not by convention — §9 test B-7, following the `caCanonicalSoleWriter` precedent that already enforces PI's canonical sole-writer property with negative controls.

`GET /api/active-leads/opportunities` keeps reading `opportunity_feed_items` through `legacyOpportunityCompat`, whose projection is deliberately field-preserving. **The bridge changes no existing contract.**

### 1.2 Source identity and idempotency

The bridge must be safely re-runnable, because the Community side re-detects continuously.

| Concern | Mechanism | Reused from |
|---|---|---|
| Which detection produced this opportunity | `prospect_opportunities.detection_ref` = `opportunity_feed_items.id` | new column, DESIGN-001 §3.3 |
| Is this the same opportunity as last time | `dedupe_key` + `UNIQUE (organization_id, dedupe_key)` | `lead_intelligence_dedupe_unique` and `lead_signals_source_unique` precedents |
| **`dedupe_key` composition** | `sha256(organization_id | opportunity_type | account_id ?? 'no_account' | person_id ?? 'no_person')` — **deliberately excludes the signal id**, so repeated signals of the same type about the same subject converge on one opportunity instead of minting one per post | — |
| Re-detection | `INSERT … ON CONFLICT (organization_id, dedupe_key) DO UPDATE` setting `last_detected_at` and appending a signal link. **`first_detected_at` is never updated** | `source_records` upsert + `observation_count` pattern |
| Evidence accumulation | `prospect_opportunity_signals` with `UNIQUE (organization_id, opportunity_id, signal_id)` — re-linking the same signal is a no-op (`23505`) | `source_assertions` dedupe index |
| Route-level replay | `withIdempotency(handler, { scope: 'pi_opportunity_bridge' })` — defaults to POST/PUT/PATCH/DELETE with a stale-lock | `backend/middleware/withIdempotency.ts:219-226` |

**Retries.** The bridge is idempotent by the keys above, so a retry is safe by construction rather than by a retry counter. Partial-batch semantics follow the orchestrator precedent WP-6 verified: **one bad detection fails that detection and no other**, the batch resolves rather than throwing, and each outcome reports `ok` plus a rejection reason. Any failure after the canonical write is impossible because the write is atomic (§8.3).

### 1.3 What crosses the bridge, and what does not

**Crosses:** `opportunity_type`, `detected_reason`, `matched_keywords`, confidence/urgency/opportunity scores, `signal_id` references, `resolved_company`, `resolved_role` + `identity_confidence`, cluster reference, `detected_at`.

**Does not cross:** raw `content_text` (it stays on `lead_signals`, referenced not copied, so freshness and moderation state cannot drift), the Community heuristic `total_score` (PI re-evaluates through `combineScores`, the single scoring authority), and **any `resolved_role` as a person** — §4.3.

---

## 2. Consent, suppression and the human-approval boundary

### 2.1 Where consent is enforced

**Reuse `contactGovernance.mayContact` unchanged** — pure, no I/O, nine governance types, three decisions (`allowed` | `blocked` | `deferred`), tenant-scoped (WP-6 tests 23–25 prove storage → read-back → decision, with a positive control so `blocked` cannot be a default).

Two enforcement points, and the distinction matters:

| Point | Rule |
|---|---|
| **At the bridge** | An opportunity **is still created** for a suppressed subject. Suppression governs *contact*, not *knowledge* — discarding the opportunity would destroy evidence and make the same detection recur forever. The opportunity records that it is not actionable |
| **Before any action** | `mayContact` is evaluated and must return `allowed`. `blocked` and `deferred` both refuse the action; `deferred` is backpressure, not a standing instruction |

This closes audit risk **R-3**: today the Community path can reach a human without passing `mayContact`. Under this design every action on an opportunity passes it.

**Fail-closed:** if governance records cannot be read, the answer is refusal, matching the existing `readiness.ts` behaviour.

### 2.2 The human-approval boundary — reuse, do not invent

Audit F-8 found no approval gate on this path. The platform already has the machinery, so **no new approval table is proposed**:

| Need | Existing mechanism |
|---|---|
| Authorization for an action | `requireCapability(req, res, { capability, organizationId, resourceId })` — `backend/security/requireCapability.ts:81` |
| Elevated confirmation | `AuthorizationService` `StepUpRequirement` / `evaluateStepUp`; `STEP_UP_REQUIRED` → **401** so the UI can prompt; `stepUpStatus: 'not_required' \| 'required' \| 'satisfied' \| 'not_applicable'` |
| Audited denial | `logSecurityEvent` → **`capability_audit_log`** (`requireCapability.ts:144`), which already audits unauthenticated attempts against the capability |

**Proposal:** one new capability for acting on an opportunity, carrying a **step-up requirement**, and `permitted_action_state` on the opportunity as a *derived read* (`actionable` | `suppressed` | `deferred` | `awaiting_approval` | `not_permitted`) rather than a stored flag that can go stale.

**Why derived, not stored:** a stored "approved" flag outlives the evidence that justified it. Consent can be withdrawn a second after approval, and a stale `true` is the worst possible value for this field.

**Not decided here:** whether a *second human* must approve (two-person rule) as opposed to a step-up by the same operator. That is a product/compliance decision — recorded as **D-J (new)**, §10.

---

## 3. Tenant offering profile and need-to-offering matching

### 3.1 The offering profile already exists

No new offering store is proposed. `company_profiles` carries it, and `prospectIcp/generator/evidence.ts` already defines the legitimate read surface: **`PROFILE_EVIDENCE_FIELDS`** (29 buyer-relevant fields, including `products_services_list`, `core_problem_statement`, `pain_symptoms`, `problem_impact`, `desired_transformation`, `competitive_advantages`) and **`PROFILE_TRUST_FIELDS`** (`field_confidence`, `overall_confidence`, `user_locked_fields`, `source`, `last_refined_at`).

**Reuse that surface verbatim.** It is already a closed list with a documented rationale for every exclusion, and re-deriving a second offering view would be exactly the "second spelling" problem this codebase repeatedly avoids.

Two gaps carried from the audit remain **unfixed by this design**: there is no `use_cases` field (audit §7.1), and `competitors` is deliberately excluded because `field_confidence.competitors` is routinely "Low".

### 3.2 The matching contract

| Property | Requirement |
|---|---|
| Inputs | the opportunity's `need_statement` + its linked signals; the tenant's `PROFILE_EVIDENCE_FIELDS` subset |
| Output | zero or more `(offering, confidence, method, matched_on)` tuples — **zero is a valid, common answer** |
| Abstention | **no match must never score as a poor match.** It is `unmatched`, which is the `scoreState: 'abstained'` discipline the ICP evaluator already enforces (`value = mandatoryUnsatisfied ? 0 : satisfied / evaluable`, missing → `'unknown'`) |
| Sparsity gate | if `presentCount` is below a threshold, matching **refuses** rather than matching against near-empty prose. The audit records that sparse profiles elsewhere in the platform received a fabricated identity; this is the control against repeating that |
| Trust propagation | a match against a field whose `field_confidence` is "Low" cannot produce a high-confidence match. `user_locked_fields` are higher trust than AI-refined |
| Explanation | every match carries `matched_on` (which offering field, which need text) so the reason survives, consistent with `reasoningTrace` carrying claim/because/confidence/assumptions/unknowns |

### 3.3 Where the match is scored

**Not a new scoring model.** The match emits a **contribution** into the existing single scoring authority (`combineScores`), and the result is persisted in `prospect_score_evaluations` alongside `score_icp`, `score_intent` and `score_opportunity`, with the existing `rules_version`, `contributions`, `reasoning` and `context_gaps` channels. An unmatched opportunity records the reason in `context_gaps`.

### 3.4 The storage shape depends on D-E, and is NOT guessed

| If D-E selects | Shape | Why |
|---|---|---|
| **Curated vocabulary** | nullable `matched_offering_key text` + `match_confidence numeric` + `match_method text` on `prospect_opportunities` | A vocabulary term is a single stable value; a column is sufficient and cheapest |
| **Embeddings** | a separate `prospect_opportunity_offering_matches` table | A vector match yields *ranked multiple* candidates with their own freshness and model version; forcing that into one column would discard the ranking and hide the model version |

**Both shapes are specified; neither is built.** DESIGN-001 §3.6 deliberately omitted `matched_offering` because a column added before a matcher exists is fabricated data. That still holds.

---

## 4. Person-first and opportunity-first discovery

### 4.1 Path A — person-first

Unchanged and already verified. Manual/CSV/CRM → canonical identity → `canonical_leads` → lists (WP-6, 27 real-schema tests). Under this design an opportunity may additionally attach to that person, so a declared need becomes canonical with the person already resolved.

### 4.2 Path B — opportunity-first

```
company-level evidence (classified signals, later company events)
  -> resolveOrCreateAccount           (existing PI boundary)
  -> prospect_opportunities           account_id SET, person_id NULL
  -> prospect_opportunity_roles       buying_role SET, person_id NULL, inferred_from SET
  -> prospect_score_evaluations       fit / intent / confidence, abstaining where unknown
  -> [contact discovery: BLOCKED — audit §8]
```

Path B is viable **up to contact discovery**, which is blocked on authorization, not engineering: the discovery provider registry ships empty, no credential exists in any environment file, and only 2 of 15 ICP attributes are translatable. **Role inference works; contact discovery does not.** The model is deliberately shaped so that when discovery is authorized, a discovered person is *linked* to an existing inferred role rather than replacing it.

### 4.3 Role inference without fictitious people

The constraint is verified, not assumed: `person_account_relationships` requires **`person_id NOT NULL` AND `account_id NOT NULL`**, so it cannot hold an inferred role. Hence `prospect_opportunity_roles`.

Three properties make the no-fictitious-person guarantee structural rather than procedural:

1. **`person_id` is nullable**, and null is the normal Path B state.
2. **`inferred_from` is NOT NULL** with CHECK `('title_keyword','resolved_role','relationship_graph','manual')` — a role is *always* labelled with how it was arrived at, so an inference can never be read as a verified fact.
3. **No write path from this table creates a person.** Enforced by the same tree-walking test style as the canonical sole-writer check (§9 test B-8).

When a real person is later discovered, the row is **linked** (`person_id` set) rather than replaced, so the inference and its confirmation are both auditable. `buying_role` uses the existing `BUYING_ROLES` vocabulary so it means the same thing it means on `unified_persons.buying_role`.

**D-I alternative (jsonb on the opportunity):** one fewer table, but a buying committee stops being queryable and linking a later-discovered person becomes an in-place rewrite rather than an auditable link. **Table recommended; decision open.**

---

## 5. Lifecycle, freshness, deduplication and contradictions

### 5.1 Lifecycle — state, never score

`status` CHECK `('open','qualified','disqualified','acted','closed','superseded')`.

| Transition | Trigger | Rule |
|---|---|---|
| → `open` | first detection | — |
| `open` → `qualified` / `disqualified` | ICP evaluation | **Qualification is a state; the score stays in `prospect_score_evaluations`.** An opportunity with no evaluation is `open`, never `disqualified` — absence is not a negative verdict |
| → `acted` | an approved action | requires `permitted_action_state = actionable` |
| → `closed` | operator, or terminal outcome | — |
| → `superseded` | merged into another opportunity | the loser is **retained**, never deleted |

**Scores never change `status` automatically.** A low score is not a disqualification; it is a low score with a reason. This mirrors the existing discipline that a company event is not purchase intent.

### 5.2 Evidence freshness

| Mechanism | Source |
|---|---|
| Per-signal observation time | `lead_signals.detected_at` — authoritative, never back-dated. `RawObservation.observedAt` is **required** and undated evidence is *excluded*, not given `asOf` |
| Per-signal-type decay | `buyingSignal.ts` `SIGNAL_HALFLIFE` (funding 180d … social/community 14d) and `SIGNAL_WEIGHT` |
| Intent decay | `intent.ts` `INTENT_HALFLIFE_DAYS = 21` |
| Opportunity-level recency | `last_detected_at`; `first_detected_at` immutable |
| Evidence lifecycle states | `EvidenceRef.lifecycle` already carries `superseded` / `expired`, which `contradiction.ts` filters on |

**Staleness is reported, not auto-closed.** An opportunity whose newest signal is older than its type's half-life is *stale*, surfaced as such with declining confidence. Auto-closing would delete the evidence trail that makes recurrence visible.

### 5.3 Deduplication

`dedupe_key` (§1.2) converges repeated detections. Where two opportunities are later found to be the same (e.g. an account merge), one is marked `superseded` with a pointer to the winner — **parked, never merged**, consistent with `personDuplicates.detectAndParkDuplicates`, which parks and never auto-merges, and with D-C's recommendation to park `contacts`/`unified_persons` reconciliation.

### 5.4 Contradictory signals — already solved, reuse it

`contradiction.ts` (LI-B107) is a complete, pure, deterministic engine covering **conflicting sources, stale-vs-fresh (30d gap), confidence divergence (0.25), stated-vs-observed and AI conflict**. Its governing property is exactly what is wanted here:

> *"Contradictions become explicit objects that LOWER confidence — evidence is NEVER silently overwritten or deleted; the loser is retained and the resolution recorded."*

**Design decision: reuse it; add nothing.** Contradictions among an opportunity's signals flow through `detectEvidenceContradictions` and land in the `reasoning` / `context_gaps` channels of `prospect_score_evaluations`. A contradicted opportunity is **lower-confidence, not deleted and not auto-disqualified**.

A worked case: `competitor_dissatisfaction` at T0 and a `customer_announcement` naming that same competitor at T1 is a genuine contradiction. The correct outcome is one opportunity with reduced confidence and both signals retained — not two opportunities, and not the silent loss of the earlier one.

---

## 6. Retention and erasure

Three sub-cases. Two have safe defaults; **one does not and is the blocking decision.**

### 6.1 Person erasure — safe default available

`personErasure.deletePersonRow` deletes `unified_persons`; `canonical_leads.unified_person_id` is `ON DELETE SET NULL`, and WP-2's real-schema test 19 proved that leaves a membership active.

**Recommended:** `prospect_opportunities.person_id` and `prospect_opportunity_roles.person_id` both `ON DELETE SET NULL`. The opportunity **survives as account-anchored**; the inferred role survives as an inference. Erasing a person removes the person, not the knowledge that a company has a need — which is both the correct audit behaviour and the correct privacy behaviour, because the remaining record names no individual.

### 6.2 Account deletion — **NO safe default; this is the blocking sub-case**

`ON DELETE SET NULL` on `account_id` would leave an opportunity with **neither** subject, violating the §5.1 CHECK and producing a row that is about nobody.

| Option | Consequence |
|---|---|
| **(a) CASCADE** the opportunity | Deleting an account destroys its opportunity history and its evidence trail |
| **(b) RESTRICT** while an opportunity is `open` | Account deletion can be blocked by a stale opportunity nobody is working |
| **(c) SET NULL + relax the CHECK**, marking the opportunity `closed` with a tombstone reason | Keeps the audit trail; admits subject-less rows, which weakens the model's central invariant |

**No option is chosen here.** This is **D-H case 2**, and it is the smallest decision that blocks a safe FK definition — exactly the situation the brief says not to guess.

### 6.3 Signal retention — safe default available

If `lead_signals` rows are pruned, `prospect_opportunity_signals` loses the evidence behind an opportunity.

**Recommended:** signals referenced by a non-terminal opportunity are **retained**; the link cascades only when the signal is legitimately gone, and the opportunity keeps `detected_reason` so the reason survives even if the evidence does not. This mirrors the existing rule that the loser of a contradiction is retained.

---

## 7. Security, tenant isolation, source permissions, auditability

### 7.1 Tenant isolation — inherit, do not reinvent

| Control | Applied to the new objects |
|---|---|
| Tenant key | `organization_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE` on all three tables — matching every neighbour except the `lead_intelligence` outlier (DESIGN-001 §1) |
| **Composite tenant-safe FKs** | `(account_id, organization_id) → prospect_accounts(id, organization_id)` and `(person_id, organization_id) → unified_persons(id, company_id)`. This is what made cross-tenant writes **unconstructible** (`23503`) in WP-6 tests 16 and 27, and it is the strongest control in the stack |
| RLS | enabled, with the existing `service_role` policy for parity — matching `20261127000000` |
| Honest statement of what RLS buys | **Isolation on the live path is application + composite FKs, not RLS.** `service_role` holds `BYPASSRLS` and the application connects as `service_role` (WP-3 test 5). Nine of ten PI surfaces are service-role-only, i.e. isolation by total denial of `authenticated`. Any claim of production isolation remains **UNVERIFIED** — production ACLs were never read |
| OD-8 | tenant-predicate RLS stays a separate design track; **not** part of C-1 |

### 7.2 Source permissions

Reuse, unchanged: the per-tenant `lead_ingestion` feature flag plus the global `ENABLE_LEAD_INGESTION` kill switch checked *before* the tenant flag (the trap that broke WP-6's first run). Production values for both remain **UNVERIFIED** — audit C-7, zero engineering cost to settle.

The bridge is a **write** surface, so it is gated by `requireCapability` with a platform-authority requirement, following the CLOSURE-series finding that write routes need real authority rather than a VIEW-tier capability.

### 7.3 Auditability

| Event | Sink |
|---|---|
| Capability check, allow or **deny** | `capability_audit_log` via `logSecurityEvent` (`requireCapability.ts:144`) — already audits unauthenticated attempts |
| Why a canonical value is what it is | `canonical_attribute_decisions` (append-only by trigger) |
| Why an opportunity scored as it did | `prospect_score_evaluations` — `rules_version`, `contributions`, `reasoning`, `context_gaps` |
| Why an opportunity exists at all | `detected_reason` + `detection_ref` + `prospect_opportunity_signals` |

**No new audit table.** The repository already carries at least four (`audit_events`, `audit_log`, `audit_logs`, `auth_audit_logs`) plus `capability_audit_log`; adding a sixth would repeat the duplication this programme is trying to reduce.

---

## 8. API / service contracts, failure semantics, canonical write boundary

### 8.1 Services

| Service | Responsibility | Notes |
|---|---|---|
| `prospectOpportunities/` (new) | create, update, read, status transitions | Ports-based with an injectable store, following `prospectLists/` which WP-2/WP-6 certified |
| `prospectOpportunities/bridge.ts` (new) | read `opportunity_feed_items` → PI canonical | The **only** writer of the new tables |
| existing, unchanged | `ingestSourceRecord`, `resolveOrCreateAccount`, `resolveUnifiedPerson`, `mayContact`, `combineScores`, `detectEvidenceContradictions` | reused, not wrapped |

### 8.2 Routes

`GET /api/prospect-opportunities` (list, tenant-scoped, keyset pagination following `prospectLists`), `GET /api/prospect-opportunities/[id]`, `PATCH …/[id]` (status transition), `POST /api/prospect-opportunities/bridge` (operator-triggered reconciliation).

All write methods: `withIdempotency` + `requireCapability` + tenant scoping. `GET` is **not** idempotency-wrapped — `withIdempotency` defaults to POST/PUT/PATCH/DELETE and does not block GET.

### 8.3 Canonical write boundary and failure semantics

**One atomic function** on the proven precedent (`pi_apply_canonical_decisions`, `pi_relationship_set_primary`): plpgsql, tenant as first parameter, `FOR UPDATE`, invoker rights (**not** `SECURITY DEFINER`), `RAISE EXCEPTION` on a missing or wrongly-tenanted subject. It writes the opportunity, its signal links and its roles **together or not at all**.

| Failure | Semantics |
|---|---|
| Subject missing or wrongly tenanted | refuse — `RAISE EXCEPTION`, nothing written |
| Any write in the set fails | **all roll back** — the WP-2 property |
| One detection in a batch fails | that detection fails alone; the batch resolves with `ok: false` and a reason |
| Governance unreadable | fail closed — no action permitted |
| Replay | no-op by `dedupe_key` / link uniqueness |
| Error messages | **never carry attribute values** — a need statement can contain personal data, and refusals travel into logs (the WP-2 rule) |

---

## 9. Acceptance criteria and test matrix

Following the pattern that produced `i2l_intake_to_list` (27/27), `ca_canonical_write_atomicity` (21/21) and `ti_authenticated_tenant_isolation` (26/26). Counts read from the runner, never a wrapper exit code — `scripts/ci/real-schema-ci.sh` exits 0 even when the suite fails.

### 9.1 Real-schema tests (the properties a fake store would grant falsely)

| # | Assertion |
|---|---|
| A-1 | A detection creates one opportunity with `detected_reason` preserved verbatim |
| A-2 | Re-running the bridge creates **no second opportunity**; `last_detected_at` advances, `first_detected_at` does not |
| A-3 | Re-linking the same signal is refused by the unique index (`23505`) and is a no-op |
| A-4 | An account-only opportunity is accepted with `person_id` NULL **(requires D-B)** |
| A-5 | An opportunity with neither subject is refused by the CHECK |
| A-6 | A cross-tenant `account_id` is **unconstructible** (`23503`) |
| A-7 | A cross-tenant `person_id` is unconstructible (`23503`) |
| A-8 | A cross-tenant signal link is unconstructible (`23503`) |
| A-9 | A role row persists with `person_id` NULL and `inferred_from` set |
| A-10 | Linking a later-discovered person **updates** the role row; the inference is not erased |
| A-11 | Atomicity: a forced failure on the signal-link insert leaves **no opportunity** |
| A-12 | Atomicity: a forced failure on the role insert leaves no opportunity and no links |
| A-13 | Person erasure leaves the opportunity account-anchored with `person_id` NULL |
| A-14 | A suppressed subject still yields an opportunity, and its action state is **not** `actionable` |
| A-15 | Governance is tenant-scoped: tenant B's unsubscribe does not suppress tenant A |
| A-16 | An opportunity with no evaluation reads `open`, never `disqualified` |
| A-17 | Contradictory signals yield **one** opportunity with reduced confidence, **both signals retained** |
| A-18 | A stale opportunity is reported stale, **not auto-closed** |
| A-19 | Error messages contain no need text or attribute values |
| A-20 | `superseded` dedup retains the loser with a pointer to the winner |

### 9.2 Negative controls — the harness must catch a real failure

| # | Control |
|---|---|
| B-1 | Drop the tenant-safe composite FK in the disposable container → A-6 **must fail** → restore → A-6 passes |
| B-2 | Replace the `dedupe_key` unique index with a non-unique one → A-2 **must fail** → restore |
| B-3 | Make the atomic function non-atomic → A-11 **must fail** → restore |
| B-4 | Stub `mayContact` to always `allowed` → A-14 **must fail** → restore |
| B-5 | Remove the subject CHECK → A-5 **must fail** → restore |
| B-6 | Detectors must not fire on prose — comments stripped, string literals handled (the lesson learned three times in WP-2) |
| B-7 | **One-way bridge:** scan for any PI write to `opportunity_feed_items` / `lead_signals` / `signal_intent_clusters` / `active_leads`; plant a violation and prove it is caught |
| B-8 | **No fictitious people:** scan for any write to `unified_persons` or `contacts` from the opportunity services; plant a violation and prove it is caught |

### 9.3 Unit tests

Lifecycle transition legality; `dedupe_key` composition stability; sparsity gate refusal; abstention (`unmatched` ≠ poor match); contradiction reduces confidence; `permitted_action_state` derivation for all five values.

### 9.4 Gates

Full real-schema suite (currently **37 suites / 835 tests**) with no new failures; `npm run typecheck` 3/3; backend-tests project with **0 diagnostics in new files** (against its 551 pre-existing baseline); scoped PI unit regression with no new failures beyond the 2 known pre-existing (`boltExecutionRecovery.ts`; `pages/prospects/index.tsx:108`); control-byte scan clean.

### 9.5 Definition of done for C-1

All of A-1…A-20 PASS; all of B-1…B-8 demonstrate detection then restore; §9.4 gates green with counts read from the runner; WP-2 and WP-3 artefacts unchanged by hash; no product source outside the new services changed; **no decision in §0 treated as approved**.

---

## 10. Work packages, effort, schedule and approvals

### 10.1 Breakdown

| WP | Scope | Effort | Confidence | Depends on |
|---|---|---|---|---|
| **C-1a** | 3 tables + migration (tenant-safe composite FKs, CHECKs, RLS, touch trigger) | **2–3 d** | **HIGH** | **D-B**, **D-H case 2**, D-I |
| **C-1b** | `prospect_score_evaluations` ALTER (`opportunity_id`, relax `prospect_id`, coherence CHECK) | **1–2 d** | **HIGH** | — |
| **C-1c** | Atomic write function + service + routes | **2–3 d** | MEDIUM-HIGH | C-1a, C-1b |
| **C-1d** | Real-schema tests A-1…A-20 + negative controls B-1…B-8 | **3–4 d** | MEDIUM-HIGH | C-1c |
| **C-1 total** | | **8–12 d** | MEDIUM-HIGH | revised **up** from DESIGN-001's 5–8 d — see §10.2 |
| **C-2** | Bridge, consent enforcement, dedup reconciliation | **6–10 d** | MEDIUM | C-1, D-A, D-A.1, D-C |
| **C-5** | Approval boundary (capability + step-up + derived action state) | **2–3 d** | **HIGH** | **D-J** |
| **C-4** | Need→offering matching | **5–8 d** | MEDIUM | **D-E method** |
| **C-3** | Company-event signal producer | **8–15 d** | **LOW** | **D-D** — no authorized source identified |

### 10.2 A corrected estimate, flagged rather than absorbed

DESIGN-001 put C-1 at **5–8 d**. Completing §9 raises it to **8–12 d**, because the earlier figure did not price the **eight negative controls** — and WP-2/WP-3 both showed that a detector which silently matches nothing is worse than no detector. The increase is in test rigour, not scope.

**This is reported as a revision to a recommendation, not a re-baselining**: C-1 has no owner-approved baseline to move. Stated explicitly so the figure is not quietly swapped.

### 10.3 Schedule

| | |
|---|---|
| **Milestone A′** | **FROZEN at 2026-11-25.** Not revised, not extended |
| **WP-7** | **4.0 engineer-days, baseline Tue 2026-11-17. Untouched and not expanded.** C-1…C-5 are **not** folded into it |
| This task | design-only; **zero WP-7 budget consumed** |
| **OVERRUN RISK** | **NOT RAISED.** Nothing in this document moves a deadline or a budget |

**Sequencing point for the owner, not a decision taken here.** WP-7 is chartered as Active-Leads-to-PI integration. `active_leads` is keyed `(organization_id, contact_id, opportunity_type)` on the Community vocabulary and rolls up `opportunity_feed_items`. If D-A selects Option A, **WP-7 is the first consumer of this model**, which argues for C-1 landing first. Re-sequencing is an owner call with its own baseline.

### 10.4 Approvals required before any implementation

| Needed to start | Items |
|---|---|
| **C-1a** | **D-B** (CHECK shape), **D-H case 2** (account-delete FK action), **D-I** (roles table vs jsonb) |
| **C-1c / C-2** | **D-A** + **D-A.1** (architecture and one-way rule) |
| **C-2** | **D-C** (reconciliation policy) |
| **C-5** | **D-J (new)** — does acting on an opportunity require a *second* human, or a step-up by the same operator? |
| **C-4** | **D-E method** (vocabulary vs embeddings) |
| **C-3** | **D-D** (authorized company-event source) |
| Unrelated but still blocking WP-4/WP-5 | **OD-3, OD-4, OD-5** |

**Nothing in this document is authorization to implement.** C-1 is specified to the point where it could begin the moment D-B, D-H case 2 and D-I are answered — and not before.

### 10.5 What this design still does not do

No second canonical prospect, person, account, suppression or MarketPulse repository, and no seventh lead store. No change to WP-2 atomicity, WP-3 security, arbitration or canonical write semantics. No decision on OD-3/OD-4/OD-5. No `matched_offering` until a matcher exists. No intent minted from a company event. No claim of production tenant isolation. **No implementation.**

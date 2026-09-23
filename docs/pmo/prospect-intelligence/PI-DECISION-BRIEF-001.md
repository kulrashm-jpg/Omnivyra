# PI-DECISION-BRIEF-001 — the four open judgements

**Status:** AWAITING OWNER DECISION. Nothing here has been changed or decided.
**Base:** `integrate/pi-t2-001` @ `6fe97748` · **Prepared:** 2026-09-23

Four judgements were taken by workstreams and flagged rather than buried. Each is reversible: **neither migration has been applied anywhere.** For each: what exists, what keeping or changing costs, what it touches, whether changing it invalidates the real-schema verification, a recommendation grounded in repository contracts, and the smallest decision needed.

**Real-schema baseline this is measured against:** 27 suites / 505 tests / 505 passed, 41 migrations replayed on a disposable PostgreSQL 17.

---

## J-1 · A tenant hard-delete is now blocked by the lifecycle ledger

**Current implementation.** `prospect_lifecycle_transitions.organization_id` is `uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE` (`20261028000000:110`), and `prospect_lifecycle_block_delete` raises unconditionally on `TG_OP = 'DELETE'` (`:283-284, :330`). So deleting a `companies` row cascades into the ledger, the trigger refuses, and the whole delete aborts.

**Keeping it.** A tenant with any lifecycle history cannot be hard-deleted. Offboarding must become a deliberate workflow rather than a `DELETE`. This is **not novel**: `opportunity_lifecycle_states` has had exactly this property since `20260520`, so the platform already contains a table that blocks tenant deletion. The append-only guarantee — which is what makes "why did this prospect move" auditable — is preserved absolutely.

**Changing it.** Two options, both costly. Exempt `DELETE` when it originates from a cascade: PostgreSQL gives the trigger no reliable way to distinguish that, so it would mean trusting a session variable — an append-only guarantee defeatable by a `SET`. Or drop the delete trigger: then any caller can erase lifecycle history, and the ledger stops being evidence.

**Affected migration:** `20261028000000` (trigger only). **Affected tests:** the WS-C real-schema suite asserts the trigger refuses DELETE; that assertion would invert.

**Invalidates real-schema verification?** **Yes, partially** — the append-only DB invariant is one of the verified properties. A re-run of the WS-C suite would be required.

**Recommendation: KEEP.** `PI-CONTRACT-002` already identifies tenant offboarding as an undefined lifecycle needing its own controlled workflow. Weakening an append-only audit guarantee to make a `DELETE` convenient inverts the priority, and precedent already exists in the same repository.

**Smallest decision:** *Is a tenant hard-`DELETE` a requirement the platform must satisfy today?* If no, keep and document the invariant. If yes, that is a controlled offboarding workstream, not a trigger change.

---

## J-2 · An index was added to another domain's table

**Current implementation.** `20261028000000:91-92` adds `CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_outcomes_id_company ON public.outreach_outcomes (id, company_id);`

**Why it exists.** A lifecycle transition cites its evidence with a **tenant-safe composite FK** — `REFERENCES public.outreach_outcomes (id, company_id)` (`:164`). PostgreSQL requires a unique index on the referenced column pair. Verified: `outreach_outcomes` has no such index. Its existing ones are `outreach_outcomes_idempotent UNIQUE (company_id, task_id, outcome_type, occurred_at)`, the partial `uq_outreach_outcomes_provider_event`, and two non-unique indexes. **So this is not a duplicate, and without it a tenant-safe citation is impossible.**

It is also the established pattern, not an innovation — `uq_unified_persons_id_company`, `uq_prospect_accounts_id_org` and `uq_source_records_id_org` all exist for exactly this purpose.

**Keeping it.** One additive, idempotent unique index on a table verified empty at `20261011000000`, whose `company_id` was already retyped to `uuid` by that same migration. Cost is negligible; the FK type-checks.

**Changing it.** The composite FK must go, and the evidence citation degrades to an untyped id with no tenant guarantee — reintroducing exactly the cross-tenant class that W4/W5 closed across the spine. Or the lifecycle table stops citing outcomes, which breaks `PI-ADR-002` §4's requirement that every transition cite its evidence.

**Affected migration:** `20261028000000` (index + FK). **Affected tests:** the WS-C real-schema FK assertions.

**Invalidates real-schema verification?** **Yes** — the FK is one of the verified invariants.

**Recommendation: KEEP**, subject to Outreach's owner being *informed* rather than asked. It is additive, idempotent, non-duplicating, against an empty table, and follows the pattern four other tables already use.

**Smallest decision:** *Does a cross-domain additive index require the owning domain's sign-off, or only notification?*

---

## J-3 · `ON DELETE NO ACTION` as an alternative to the CHECK change

**Current implementation.** The person FK stays `ON DELETE SET NULL (person_id)` (ratified decision **D-3**), and `20261027000000` widens `contact_governance_has_anchor` to admit a row whose anchors are gone **only when it is revoked**.

**The alternative.** Change the FK to `NO ACTION`. Both defects become structurally impossible with no CHECK change, and it is LI-4C.1's own remedy for the identical `23514` shape.

**What changing it actually costs — and this is decisive.** `NO ACTION` means the delete is **refused** while any governance row references the person. It does not preserve the record past the person; it prevents the person from being deleted at all. So:

1. **It reverses D-3, which is a product guarantee, not a mechanism.** `li3_contact_governance.test.ts:310` is a `describe` block literally titled *"LI-3B — D-3: the instruction outlives the person"*, and three real-schema assertions encode it: `:73` (the constraint definition must read `SET NULL (person_id)`), `:323` (`person_id` nulled after delete), and `li3d_governance_writer.test.ts:236`.
2. **It does not remove the erasure procedure — it makes it worse.** Under `NO ACTION` the procedure must clear `person_id` **itself**, by `UPDATE`, before deleting. Governance is append-only and ADR §16 permits updating only `revoked_at`/`revoked_reason`. So the alternative forces the procedure to do the one thing the append-only contract forbids.
3. **It buys nothing the current model lacks.** Both defects are already proven resolved on real PostgreSQL: `DEFECT-010 resolved: revoking the person-anchored row first lets the delete through`, and Capability B passes across all four record shapes.

**Affected migration:** would replace `20261027000000` entirely. **Affected tests:** three real-schema assertions invert, plus the whole WS-F suite.

**Invalidates real-schema verification?** **Yes, substantially** — this is the most disruptive of the four.

**Recommendation: KEEP the current model.** The bar set for reversing D-3 was five conditions; the alternative fails at least three — it does not preserve person-scoped suppression's survival guarantee, the existing tests should *not* legitimately change, and erasure semantics are made worse rather than better (deletion becomes refusal).

**Smallest decision:** *Ratify that D-3 stands.* No code change either way; this closes the question.

---

## J-4 · Is `closed/disqualified` one state or two?

**Current implementation.** One state, `closed_disqualified`, terminal with no exits. Six resting states plus an initial.

**Evidence searched for a split — none found, and evidence against it.** `disqualified` occurs in two places, neither a prospect resting state: `companyMissionContext.disqualified_signals` (signals to *ignore*, a different domain), and `prospectIcp/evaluate.ts:41`, where `disqualified` is the **ICP evaluator's computed verdict** when a mandatory criterion is unsatisfied.

That second occurrence argues actively against a split. Per `PI-ADR-004` §4.1, a computed verdict must never be stored as prospect state — a stored copy drifts from the live computation. Introducing `disqualified` as a resting state would create exactly the duplication the ADR bans, and it would collide in meaning with the evaluator's existing output.

**Keeping it.** Six states. A close carries its reason as an attribute, which is where reasons belong.

**Changing it.** Seven states, the migration's `state` and `previous_state` CHECKs change, the transition graph gains edges, and the platform gains a second meaning for `disqualified`.

**Affected migration:** `20261028000000` (two CHECKs). **Affected tests:** the WS-C vocabulary-parity guard, which asserts the migration's CHECKs equal the TypeScript consts.

**Invalidates real-schema verification?** **Yes** — the DB-level vocabulary assertions.

**Recommendation: KEEP one state.** No repository evidence requires a split, and `prospectIcp/evaluate.ts` provides evidence against. This is also already closed by the standing instruction not to reopen the six-state vocabulary absent new evidence; this brief records that the search was done and came back empty.

**Smallest decision:** none required unless you have product evidence the search could not see.

---

## Two minor judgements, recorded for completeness

**J-5 · The chain trigger and advisory lock exceed the stated deliverable.** WS-C added `pg_advisory_xact_lock(hashtextextended(prospect_id))` plus a `previous_state`-must-match-latest check, beyond the brief's "append-only trigger, CHECKs, partial unique index". Its argument: without it, "current state = latest row" is not coherent under concurrency and "deterministic state reconstruction" is a claim rather than a property. Both are verified on real PostgreSQL. **Recommendation: KEEP** — it is the difference between an ordered ledger and a set of rows.

**J-6 · `origin='human'` requires `actor_user_id` by CHECK.** Makes the flag meaningful rather than decorative, consistent with `PI-ADR-001` §3.5.13 ("a model has no user id"). Consequence: a human-initiated transition arriving through a service path with no user id is rejected. **Recommendation: KEEP**, and treat a rejection as the signal that the path is not actually carrying a human identity.

---

## Summary

| # | Judgement | Recommendation | Re-verification if changed |
|---|---|---|---|
| J-1 | Tenant hard-delete blocked | **KEEP** — precedent exists; offboarding is its own workflow | WS-C suite |
| J-2 | Index on Outreach's table | **KEEP** — not a duplicate, required by the composite FK | WS-C suite |
| J-3 | `SET NULL` + CHECK vs `NO ACTION` | **KEEP** — the alternative reverses D-3 and worsens erasure | WS-F suite, substantially |
| J-4 | `closed_disqualified` one state | **KEEP** — no evidence for a split, evidence against | WS-C vocabulary guard |
| J-5 | Chain trigger + advisory lock | KEEP | WS-C suite |
| J-6 | `origin='human'` needs an actor | KEEP | unit only |

**If all six are ratified as-is, no code changes and no re-verification are required**, and the decision surface is frozen for the pre-apply gate.

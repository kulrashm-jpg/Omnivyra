# Authorization D-2: bridge handoffs and person erasure (A6-10)

**Status: UNSIGNED. Nothing here is approved or assumed approved.** Prepared 2026-11-01. Supersedes D-2 v3 where they differ, and reflects branch `feat/orchestration-recovery`.

## What you are deciding

Whether an erased person's link on `outreach_bridge_handoffs` is nulled by the erasure flow (keeping a non-identifying attribution row), rather than deleted with the person or left blocking the erasure.

**Recommendation: Option B, SET NULL, admitted only for the erasure flow.** It matches the existing rule for `outreach_tasks.person_id`, which keeps the audit row and its tenant.

| Option | Effect | Assessment |
|---|---|---|
| A: CASCADE | Handoff deleted with the person | Destroys the record of who authorized contact |
| **B: SET NULL, erasure only** | Handoff survives with no person id | Recommended |
| C: Keep NO ACTION | A bridged person cannot be erased | Blocks a legal obligation |

## Exact changes

**Already on the recovery branch, unmerged:**

| File | Change |
|---|---|
| `supabase/migrations/20270113000000_outreach_bridge_handoffs_person_erasure_set_null.sql` | 3 changes below |
| `supabase/migrations/rollbacks/outreach_bridge_handoffs_person_erasure_set_null_rollback.sql` | Rollback, slug-only name per erratum A10-1 |
| `backend/services/outreachBridge/outreachBridgeStore.ts` | `personId` becomes `string \| null` in the read model; comments |
| `backend/tests/realschema/a6_10_bridge_person_erasure.test.ts` | New suite |

**The migration does exactly three things, in one transaction:**
1. Replaces `outreach_bridge_handoffs_guard()` so it admits exactly one kind of UPDATE, and requires a person at INSERT.
2. `person_id DROP NOT NULL`, only so the FK action can null it.
3. FK `outreach_bridge_handoffs_person_fk` becomes `ON DELETE SET NULL`.

**The one UPDATE admitted, all conditions required:** nested inside the FK action (`pg_trigger_depth() > 1`); `person_id` goes from non-null to NULL; every other column unchanged; the person row is already gone; and `pi_erasure_authorization_held('bridge_handoffs', tenant, person)` returns true in this transaction.

Source commits: `1cea7cf2`, `79f7b9ae`, `33c414be`, merged at `6fd8f899`.

## Scope

**In scope:** only the handoff row's person link.

**Not in scope, and needed for a working erasure.** This is the most important thing to understand before signing. D-2a alone does not make a bridged person erasable:

| Item | What | Where | Status |
|---|---|---|---|
| D-2b | `leads.unified_person_id` NOT NULL under SET NULL | RC `20270112000001` | Unsigned; recommend option i |
| D-2c | Score evaluations immutability | RC `20270112000002` | Unsigned; recommend option i |
| D-2d | Erasure ledger and finalize transaction | RC `20270112000003` | Unsigned; recommend ledger |
| D-2e | Lead `subject_id` and legacy fields | RC `20270112000004` | Unsigned; recommend S for leads, R for prospects |
| D-2f | `outreach_decisions.person_id` | RC `20270112000005` | Unsigned; owner's call |
| **New, E-1** | `email_outreach_content_evidence` personal text | Not built; see the erasure design | **Must be decided before email is enabled** |

The authorization function lives in RC `20270112000000`. **On the recovery branch without the RC, a bridged person stays unerasable by design.** The delete fails 23503 naming the handoff; it does not half-complete. Combined with the RC, the erasure suites pass (section "Evidence").

## Security implications

| Question | Answer |
|---|---|
| Can a client detach a live person? | No. Requires the FK action, the person gone, and an authorization signal no client role can hold |
| Could a person merge silently lose a handoff? | No. That was a real defect (J1 A6-1), now closed: a merge deleting the loser fails 23503. Merging a person who has handoffs therefore **requires re-pointing or erasing first**, an accepted limitation |
| What remains after erasure? | Surrogate ids, `subject_kind`, `subject_id`, mode, policy, time. No name, address or free text |
| Is `subject_id` identifying? | It is the key of the lead or prospect. For leads, D-2e severs the target; for prospects it is retained. D-2e decides this |
| New privileges? | None. Guard stays SECURITY INVOKER; column set, indexes, RLS and grants unchanged |
| If the authorization function is missing or denied? | Fails closed: nothing is admitted |

## Rollback

`rollbacks/outreach_bridge_handoffs_person_erasure_set_null_rollback.sql` restores the exact prior guard, FK and NOT NULL, in one transaction.

- **Refuses if any handoff has `person_id IS NULL`.** Measure first: `SELECT count(*) FROM public.outreach_bridge_handoffs WHERE person_id IS NULL`. If non-zero, stay forward. Restoring would mean inventing a person, or deleting attribution.
- **Order:** this rollback runs before the RC's erasure family: 15 → 13 → 05..00.
- **Re-run hazard:** re-executing `20261229000000` after this migration restores the old guard and fails its own postcondition. Do not re-run it out of order.

## Evidence

Disposable PostgreSQL 17.6 only. Production untouched; whether the table exists in production is unmeasured.

| Check | Result |
|---|---|
| `a6_10_bridge_person_erasure` on the recovery schema | Pass, in the full real-schema run |
| Same, plus `pi_person_erasure_api_wiring`, on recovery + RC 7bdd76ae | Pass, 5/5 suites with the orchestration suites |
| Migration-quality gate after the rollback rename | Pass |
| Earlier A6-10 validation, chain replay and rollback | `final-closure-20261031T164000Z/db/A6-10-VALIDATION.md` |

**Known from that earlier report and not re-run here:** on the fully combined stack, `pi_person_erasure_ledger` had one failure recorded as F-1 and unrelated to A6-10. I ran 5 suites on the combined schema, not the full set.

## If declined

Do not ship any erasure entry point covering bridged persons. Options A and C each need a new migration and a re-test.

## Signature

D-2a: ☐ A  ☐ B  ☐ C

Conditions, if any: ______________________________________

Name: ______________  Signature: ______________  Date (UTC): ______________

Privacy owner: ______________

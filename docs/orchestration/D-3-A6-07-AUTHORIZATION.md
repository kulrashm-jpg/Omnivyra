# Authorization D-3: gate-contract test change for the orchestration stack (A6-07)

**Status: UNSIGNED. Nothing here is approved or assumed approved.** Prepared 2026-11-01, reflecting branch `feat/orchestration-recovery`.

## What you are deciding

Whether `backend/tests/unit/piProvSchemaGateContract.test.ts`, a suite owned by main's provenance programme, may change so it runs against the verifier once it also checks the orchestration stack.

**Recommendation: approve.** This is test-only with no runtime effect. It keeps main's assertions and adds independent pins, so a shrink in either manifest still fails.

## Why it is needed

`scripts/verify-schema-parity.js` gains the ORCH-STACK manifest. Main's suite pins `checked_columns` and `checked_indexes` to main's own list, so with the stack present it fails, even though nothing is wrong. Weakening the assertion would be wrong too: a test that derives its expectation from the verifier cannot catch the verifier shrinking.

## Exact changes

Source commit `d9548c3d`, merged at `d5a15a4e`. One file, **6 lines replaced and about 240 added**. No `it` or `describe` removed or skipped.

| Line in original | Change |
|---|---|
| 117, 119, 122, 127 | The pg stub's data builder also serves stack objects |
| 232 | `checked_columns`: `COLUMNS.length` → `COLUMNS.length + ORCH_STACK_PIN.columns` |
| 233 | `checked_indexes`: `INDEXES.length` → `INDEXES.length + ORCH_STACK_PIN.indexes` |

Added: literal pins, a non-tautological fake catalog, and an exit-code contract.

**The pins have moved since `d9548c3d`**, because the recovery branch added tables and an index to the stack. You are authorizing the current values, not the original ones:

| Pin | `d9548c3d` | Now | Why |
|---|---|---|---|
| tables | 18 | 20 | `execution_journey_decisions`, `email_outreach_content_evidence` |
| columns | 208 | 228 | Their 12 + 8 columns |
| indexes | 45 | 49 | Decision record 2, evidence 1, WhatsApp key 1 |
| unique indexes | 18 | 19 | WhatsApp key |
| functions | 27 | 29 | The two append-only guards |
| triggers | 17 | 19 | Same |
| CHECK constraints | 7 | 7 | Unchanged |

`verifySchemaParityCoverage.test.ts` and `predeployStrictSchema.test.ts` carry matching pins and moved with them.

## Scope

**In scope:** the three test files above.

**Not in scope:** verifier logic, any migration, any route, any authorization suite. Separately, `scripts/verify-schema-parity.js` itself changed on this branch by adding manifest entries for the new objects; those entries come with the stack release, not with this decision.

## Security implications

None at runtime: no production code path imports this test. The security-relevant question is whether a gate got weaker, and it did not:

- Main's literal term is kept; the stack term is added on top.
- The added terms are literals not derived from the verifier, so a shrink fails.
- The earlier negative control stands: applied without the stack, the suite aborts loudly rather than passing.

## Rollback

`git revert` of the test change. It has no database or runtime effect. If the stack remains, the suite then fails, which is the correct signal. If the stack is removed, revert this too: the suite is valid only with the stack.

## Dependency

Valid **only with the orchestration stack**. On main alone the new assertions fail by design.

**Open finding A7-1, still not fixed.** `docs/release/release-gate-production-verification-plan.md:538` pins `scripts/verify-schema-parity.js` to `97dfe3a2…`, a candidate blob from before the rebase. The verifier's current hash starts `87a75ec0…`, and it will change again at merge. **Re-pin at the merge commit, not before.**

## Evidence

| Check | Result |
|---|---|
| `piProvSchemaGateContract` on the recovery branch | Pass, with the updated pins, in the affected-suites run at `f7ff85d0` |
| All three pinned suites, whole-repo run at `f7ff85d0` | No failure in any of them; full result in `VERIFICATION-AND-BLOCKERS.md` |
| Earlier run: merged stack / RC only / negative control | 312/312, 300/300, aborts as designed: `final-closure-20261031T164000Z/db/A6-07-VALIDATION.md` |

## If declined

The stack cannot land with main's suite as it stands, because the suite fails against the extended verifier. The alternatives are to move the stack's assertions into a separate suite and keep main's file byte-identical, which needs main's suite to stop asserting totals, or to stop folding the stack into the verifier's totals.

## Signature

☐ Approve at the pins above  ☐ Decline  ☐ Approve with conditions

Conditions, if any: ______________________________________

Name: ______________  Signature: ______________  Date (UTC): ______________

# PI-ADR-006 — outcome assertion authority

**Status:** ACCEPTED by the programme owner, 2026-09-25.
**Base SHA:** `6db34fa0` · **Authorises:** contract #13 in `PI-CONTRACT-REGISTER.md`.
**Requires:** `PI-ADR-002` (outcomes are evidence, not decisions). **Affirms** `PI-ADR-004` §5, conditionally — see §4.
**Does not change:** `PI-ADR-001`, the Do-Not-Build register, or `ARCH-1`, which remains open — see §7.

---

## 1. The decision

`meeting_booked` remains an **evidence/outcome** concept. Manual admission of it is **removed**.

Concretely, and this is the whole of the decision:

- `meeting_booked` stays in the outcome vocabulary — `BusinessOutcomeType`, `UNOBSERVABLE_BUSINESS_OUTCOMES`, `FEEDBACK_SIGNALS`, `BUSINESS_SIGNALS`, the outcome corpus, and the `outreach_outcomes_type_valid` DB CHECK. **Nothing was removed from the vocabulary.**
- It is no longer a member of `MANUAL_OUTCOME_SIGNALS` (`pages/api/outreach/outcomes.ts`), which is now exactly `['replied', 'converted', 'no_response']`. Since that route is the only production caller of `ingestFeedback`, no production path can create a `meeting_booked` row.
- `meeting_scheduled` remains a **lifecycle state**, distinct from the outcome, and remains contract-only: it stays in `PROSPECT_STATES`, in the graph, in the DB CHECK, and in `PROSPECT_STATES_UNREACHABLE_TODAY` (`stateModel.ts:103`).
- Stage-1 **Outcome Provenance** is retained as an audit/attribution capability. It is carried, not consulted — see §5.
- **No lifecycle authorization redesign occurs.** The writer's refusals, the `human | derived` origin axis, and the origin/actor CHECK are untouched.

## 2. What was contradictory, and is now not

Two halves of the repository disagreed, and both were current. `meeting_booked` was classified unobservable because no machine can witness a booking; the manual route nevertheless admitted it, so an operator could create one. "Unobservable" was precise but narrower than it read: no *machine* observes a booking, but an operator could assert one.

That gap — a state declared contract-only whose only cause was manually creatable — is what this ADR closes. It is closed by narrowing the *manual surface*, not by narrowing the *vocabulary*.

## 3. The alternative considered, and why it was not selected

**Option (b):** accept an authorized human assertion of `meeting_booked` as sufficient to advance `qualified | engaged → meeting_scheduled`, dropping `meeting_scheduled` from `PROSPECT_STATES_UNREACHABLE_TODAY` and proposing the transition with `origin: 'human'` and the operator attached.

Option (b) is coherent and was mechanically feasible — both graph edges already exist (`stateModel.ts:115-116`), and the ledger can already express an `origin='human'` row citing the outcome. It was not selected on the following established grounds, each of which is a fact about the repository at this Base SHA rather than a preference:

| Ground | Fact |
|---|---|
| It extends a ratified ADR | `PI-ADR-002` §3 makes outcomes *"a first-class EVIDENCE input … They do not become decisions."* Granting an assertion authority to **decide** a lifecycle advance extends that clause, which is an owner act, not an implementation detail. |
| "Authorized" is undefined at the needed level | `requireTenantAccess` is called with no options, so any active member of the named tenant qualifies at any role; `user_company_roles.role` carries no CHECK. No capability in `ALL_CAPABILITIES` has lifecycle, outcome or feedback as its subject. |
| The state would have no exit semantics | No outcome expresses cancellation, reschedule or no-show. Of the four outbound edges, two have no production write path and `no_response` from `meeting_scheduled` abstains by design (`SILENCE_NEEDS_POLICY_FROM`). The ledger is append-only, so a wrong row is unrepairable. |
| Aboutness is not enforced at the write seam | The evidence citation proves tenancy, never which prospect the outcome concerns. |

## 4. Relationship to `PI-ADR-004` §5

`PI-ADR-004` §5 states, verbatim:

> **Blocked, not decided here:** `meeting-scheduled`, `meeting-proposed` and `meeting-completed` all depend on `meeting_booked`, which is in `UNOBSERVABLE_BUSINESS_OUTCOMES` — there is no booking integration. That cluster is contract-only until one exists.

That paragraph is **AFFIRMED as written — conditionally on a future booking integration, not as a permanent prohibition.** The condition is "until one exists", and it is unchanged. Lifting the block remains removing the state from `PROSPECT_STATES_UNREACHABLE_TODAY`, which is what that list is for. This ADR does not foreclose a booking integration and does not decide anything about one.

## 5. Outcome Provenance — retained, carried, not consulted

`backend/services/prospectLifecycle/outcomeProvenance.ts` (Stage 1) classifies who asserted an outcome into a closed six-member `AssertionAuthority`: `authorized_human`, `provider`, `webhook`, `import`, `system`, `unauthorized`. Its source axis is the canonical six-value `FeedbackSource`, which agrees exactly with the runtime `FEEDBACK_SOURCES` array and with the `outreach_outcomes_source_valid` DB CHECK. It is pure — one type-only import, no clock, no I/O, no database — and it fails closed: absent, unrecognised or internally inconsistent provenance yields `unauthorized` with a stated reason.

Its purpose under this ADR is **audit and attribution**: it answers *who asserted this outcome*. It is **not** an authorization mechanism for lifecycle state, and `interpretOutcome` does not consult it. `InterpretableOutcome.provenance` remains optional and carried. Fail-closed semantics are retained as already established; this ADR introduces no new provenance semantics.

## 6. Namespace clarification — "A1" and "ARCH-1"

Four existing identifiers share the token, and none is renamed by this ADR. It records only the namespaces, so that this decision's "option (a)" is not read as any of them:

1. **WS-A1** — the PI schema-and-safety-baseline workstream increment that closed GAP-007 (`PI-STATE-OF-PROGRAMME.md` §2.4).
2. **A1 — the AI ICP Generator** — a code lane in `backend/services/prospectIcp/generator/**`, also baked into the runtime constants `pi.a1.icp_generator` and `a1.1`.
3. **A1 — Generation Spine** — an ownership zone in the *content* programme (`OMNIVYRA-PMO-001.md`), a different programme entirely.
4. **A1** — an appendix-section label inside `PI-CONTRACT-001`.

**This decision is `PI-LIFECYCLE-003B` option (a).** It is not an "A1" in any of the four senses above, and it should be cited as PI-LIFECYCLE-003B or as this ADR.

Separately, **`ARCH-1`** is an operator-decision id in `PI-STATE-OF-PROGRAMME.md` §5 — *"May the outcome ledger inform the intelligence layer?"* It is not a lane, not a workstream, and not this decision.

## 7. What this does not decide

- **`ARCH-1` is untouched and remains open.** This ADR does not answer whether the outcome ledger may inform the intelligence layer, and nothing here wires the lifecycle module to a runtime caller; it still has none.
- Whether a booking integration should be built, and what it would be.
- Whether provider, webhook, import or system evidence may ever carry lifecycle authority. Human authority was not granted, so no source class inherits anything; each remains a separate decision.
- Any correction, cancellation, retraction or compensation model for the lifecycle ledger. None exists and none is created.
- Any change to the lifecycle authorization model, the role/capability model, or the aboutness of an outcome to a prospect.
- The `meeting-proposed` and `meeting-completed` concepts named by `PI-ADR-004` §4.1, which remain unmodelled.

## 8. Code and verification confirmation

Unlike `PI-ADR-002`, `PI-ADR-003` and `PI-ADR-004`, this ADR is **not** contract-first: it records a decision that lands with its implementation. Stated precisely:

**Changed:** `pages/api/outreach/outcomes.ts` (one member removed from `MANUAL_OUTCOME_SIGNALS`, plus documentation); `backend/services/prospectLifecycle/outcomeInterpreter.ts` (**comment only** — the non-comment projection is byte-identical and `OUTCOME_TRANSITION_MAP` is unchanged); two test suites, updated to assert the resolved state rather than the contradiction.

**Not changed:** no schema, no SQL, no migration — the `supabase/migrations` tree hash is unchanged. No state vocabulary, no transition graph, no lifecycle authorization, no provenance implementation, no provider integration, no authentication or authorization architecture, no flag, and no production data. No provider call was made.

**Verification at decision:** the three affected suites pass — 3 suites / 96 tests. Wider subsystem convergence: 76 suites / 2203 tests, with one pre-existing environmental suite failure (`ENCRYPTION_KEY` absent from the test environment). Static gates `check:authz`, `check:route-auth`, `check:secrets`, `check:route-policy`, `check:rbac-binding`, `check:orgaccess-binding`, `check:migrations`, `check:db-conventions`, `check:schema-drift` all exit 0. `typecheck:backend-tests` remains at its 260-diagnostic pre-existing baseline with **zero net-new diagnostics**, proven by diagnostic-set equality against a clean worktree at this Base SHA.

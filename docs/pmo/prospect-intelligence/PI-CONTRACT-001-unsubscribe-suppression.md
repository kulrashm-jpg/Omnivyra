# PI-CONTRACT-001 — unsubscribe → suppression

**Status:** CONTRACT PREPARED — **AWAITING POLICY DECISION.** Nothing is implemented.
**Base SHA:** `a07477e4` · **Prepared:** 2026-09-23
**Governing:** `IMPLEMENTATION-MANIFEST-001.md` §C-3 (suppression precedence, frozen) and `PI-ADR-002` (which does not change suppression).

This document states the seam, the decision space, and exactly where a decision enters the **existing** canonical suppression architecture. **No second suppression mechanism is proposed, and none may be built.**

---

## 1. The gap, stated precisely

`outreach_outcomes.outcome_type` accepts `unsubscribed`. `feedbackSummary.ts` counts it. **Nothing translates it into `contact_governance_records`, so `mayContact` cannot see it.**

Verified at `a07477e4`:

| Fact | Evidence |
|---|---|
| `unsubscribe` is already in the canonical closed vocabulary | `prospectIdentity/contactGovernance.ts:50-61`; DB CHECK `contact_governance_type_valid` |
| The canonical writer can already write it | `contactGovernanceWriter.recordContactGovernance:146` |
| That writer has exactly **one** non-test caller | `execution/suppressionService.ts:264` inside `addSuppression` |
| `addSuppression` has exactly **one** non-test caller | `pages/api/lead-intelligence/execution.ts:107` — a **manual operator** action |
| `suppressionService.unsubscribe(...)` exists and has **zero** callers | `execution/suppressionService.ts:329` |
| `feedbackIngestion.ts` imports only `./storage`, `./lifecycle`, `./telemetry`, `./types` | `:41-56` — no governance import exists to remove |
| `ingestFeedback` terminates at `appendOutcome` | `:298-301` |

**There is no live compliance exposure today**, and this is the important nuance: `pages/api/outreach/outcomes.ts:80-85` restricts `MANUAL_OUTCOME_SIGNALS` to `replied | meeting_booked | converted | no_response`, and its comment at `:74-75` says why — *"`unsubscribed` is compliance-bearing and does not yet feed suppression, so accepting it would record an obligation the platform will not act on."*

So the platform currently **refuses to record an unsubscribe** rather than recording one it would ignore. That is the correct posture and it is the reason this is not yet an incident. It is also the reason the seam must exist **before** any provider webhook or external transport is wired, because such a path would not route through that route's allow-list.

---

## 2. What the schema has already decided

These are not open. The DB constraints in `20261003000000_li3_contact_governance.sql` foreclose them:

| Question | Answer, and why |
|---|---|
| Can an unsubscribe be **time-limited**? | **No.** `contact_governance_until_only_deferred` permits `effective_until` only on `governance_type = 'deferred'`. An unsubscribe is in force or revoked; there is no expiry. |
| Can an unsubscribe be **revoked** (re-subscribe)? | **Yes, structurally.** Records are revoked, never deleted (`contactGovernanceWriter.ts:263`), and `uq_contact_governance_identity` is partial on `revoked_at IS NULL`, so revoke-then-re-record is representable. *Who* may revoke is still a policy decision (§3.3). |
| Must it be anchored? | **Yes.** `contact_governance_has_anchor` requires `person_id` or a non-blank `target_normalized`. |
| Can it be `*` (all channels)? | **Yes.** The all-channels and specific-channel constraints bind only `dnc_permanent` and `dnc_channel`. `unsubscribe` may carry either. |
| Is a second identical unsubscribe safe? | **Yes.** `uq_contact_governance_identity (organization_id, channel, governance_type, coalesce(person_id::text, target_normalized))` makes it a no-op — but it is **partial**, so `ON CONFLICT` cannot infer it (`42P10`). Persistence must INSERT and catch `23505`. |

---

## 3. The decision space — three questions, and only three

### 3.1 Scope — channel-specific, or `*`?

Both are representable. The trade is stated, not resolved:

- **Channel-scoped** (`email`) honours precisely what the person asked and leaves other channels open. It matches the literal act: an email unsubscribe link is about email.
- **`*` (all channels)** is the conservative reading. It over-suppresses, which costs commercial reach and never costs compliance.

⚠ **Note an interaction with the evaluator.** `mayContact`'s channel filter matches `channel === requested || '*'` (`contactGovernance.ts:152-154`). A channel-scoped unsubscribe on `email` therefore does **not** block `phone` or `whatsapp`. If the product intent is "unsubscribe means stop contacting me", `*` is the only spelling that achieves it — a channel-scoped record will not.

### 3.2 Anchor — person, target, or both?

`anchorMatches` deliberately matches on **person OR target** (`contactGovernance.ts:158-169`, recorded as decision D-3), so either anchor alone is honoured by the evaluator.

⚠ **Writing both is not free.** The idempotency key uses `coalesce(person_id::text, target_normalized)`, so a person-anchored row and a target-anchored row for the same human are **two distinct rows**, both of which survive. `contactGovernance.ts:239-256` already records this as a known limitation. Choosing "both" means deliberately accepting duplicate governance records per person, and the revocation path must then revoke both or the suppression partially survives.

- **Person-anchored** survives an email address change and follows identity resolution. It fails when the person is unresolved — and an unsubscribe frequently arrives from someone the platform has not resolved.
- **Target-anchored** always works because the target is what the message was sent to. It does not follow the human across addresses.

### 3.3 Revocation — may a person re-subscribe, and by whom?

Structurally supported (§2). The policy question is whether re-subscription is permitted at all, and if so whether it requires the person's own verified act, an operator action with evidence, or both. Note `contact_governance_revocation_coherent` requires a `revoked_reason` whenever `revoked_at` is set, so whatever is decided must produce a stated reason.

---

## 4. Where the decision enters the architecture — the exact seam

**One call. No new store, no new evaluator, no new table, no migration.**

```
pages/api/outreach/outcomes.ts        ← widen MANUAL_OUTCOME_SIGNALS to admit
  │                                      'unsubscribed' ONLY once the seam exists
  ▼
leadOutreachExecution/feedbackIngestion.ts
  ingestFeedback → ingestBusinessSignal → appendOutcome   ← unchanged, still the
  │                                                          sole outcome writer
  └──► NEW: on outcome_type === 'unsubscribed', call
       prospectIdentity/contactGovernanceWriter.recordContactGovernance({
         governanceType: 'unsubscribe',
         channel:        <§3.1 decision>,
         personId:       <§3.2 decision — resolved via personAnchor.ts>,
         targetNormalized: <§3.2 decision>,
         source:         'outreach_outcome',
         evidence:       { outcomeId, taskId, provider, providerEventId, occurredAt },
       })
```

Then, unchanged and already correct: `mayContact` reads the canonical store, `unsubscribe` sits in GATE_BAND 4 (`contactGovernance.ts:74-86`), and `assessOutreachReadiness` returns `blocked`.

### 4.1 Five properties the implementation must preserve

1. **`recordContactGovernance` stays the sole writer.** Do not call the legacy `suppressionService.unsubscribe()` — it writes the **legacy** `suppression_entries` store. Under C-3 the legacy stores may *add* a suppression but never *remove* one; routing a canonical obligation through a legacy store inverts that.
2. **The outcome write must not depend on the governance write, and the governance write must not be silently swallowed.** These are two different failure modes and both are wrong. The precedent to follow is `approval.ts:18-28`: state first, then audit, and a successful transition whose audit append failed is *reported*, not swallowed. Here the analogue is: the outcome is recorded, and a failed governance write is surfaced as a distinct, alarmed failure — never as success.
3. **PI-ADR-002 does not license this.** ADR-002 lets an outcome become *evidence* that changes what the platform knows. This seam is different in kind: it changes what the platform is **permitted to do**. It is justified by the compliance obligation, not by ADR-002, and it must remain the only such crossing.
4. **No business outcome may advance a TASK state.** `stateAdvanced: false` for business signals stays exactly as it is. A suppression is not a lifecycle transition.
5. **Idempotency by `23505`, never `ON CONFLICT`.** The index is partial and cannot be inferred.

### 4.2 Tests the seam must carry

- An `unsubscribed` outcome produces exactly one canonical governance record, and a replay of the same provider event produces no second record.
- `mayContact` blocks the next send for that person, on the decided scope.
- A governance-write failure does not report success, and does not lose the outcome.
- No import of `execution/suppressionService` appears in the feedback path.
- The existing guard that no business signal advances a task state still passes.

---

## 5. Decisions required — `POLICY-1`

| # | Question | Options | Owner |
|---|---|---|---|
| 1 | Scope | channel-scoped · `*` | Product + Compliance |
| 2 | Anchor | person · target · both (accepting duplicate rows) | Product + Compliance |
| 3 | Revocation | not permitted · person's verified act · operator with evidence | Compliance |

Two are foreclosed and need no decision: an unsubscribe cannot be time-limited, and duplicate unsubscribes are already idempotent.

**Recommendation, offered as input and not as a decision:** `*` scope and **both** anchors is the only combination in which "this person asked not to be contacted" is actually true across channels and survives both an unresolved identity and an address change. Its costs are commercial reach and duplicate governance rows — both recoverable. The costs of the narrower choices are regulatory and are not.

---

## 6. No-code confirmation

No application code, schema, migration, flag, provider or production data was changed. This document prepares an implementation; it implements nothing, and the seam must not be built until §5 is answered.

---

# ADDENDUM — 2026-09-23: what the repository determines, and the one decision left

## A1. The canonical anchor, as the system actually behaves, is TARGET

Verified directly, not inferred:

- `execution/suppressionService.addSuppression` — the **only** non-test caller of `recordContactGovernance` (`:264`) — passes `target` and **no `personId`**. There is no person-resolution step in the function.
- `suppressionService.unsubscribe(companyId, target, channel, actor)` is target-keyed by signature.
- `pages/api/lead-intelligence/execution.ts:107` accepts a `target` and has **no person parameter**.
- `canonicalVerdict` documents it: *"No person anchor is supplied: this seam is reached with a raw recipient and no identity."*

**Every governance record this system can currently create is target-anchored.** POLICY-1, as a question about what the platform does, is already settled by implementation — it had simply never been written down, which is why it resurfaced as an open question.

## A2. But person-only is a designed, tested capability — and that is the whole problem

`backend/tests/unit/li3eGovernanceChain.test.ts:175` writes a person-only record and asserts the evaluator blocks contact at **`anything@example.com`**:

```ts
await recordContactGovernance({ organizationId: ORG_A, governanceType: 'dnc_permanent',
                                channel: '*', personId: PERSON_A, source: 'manual' });
const g = await decide({ org: ORG_A, channel: 'email', target: 'anything@example.com', personId: PERSON_A });
expect(g.decision).toBe('blocked');
```

That **is** "suppress this human across every address". It is built, wired end to end, and covered by four tests across two suites.

**And it is exactly the shape that makes a person undeletable** (DEFECT-008): `person_id` is nulled on delete, a row left with no anchor violates `contact_governance_has_anchor`, and the delete aborts.

So the tension is **real and not dissolvable by forbidding the shape**.

## A3. A remediation was attempted and withdrawn — recorded because the failure is the evidence

The proposed fix was to refuse person-only writes at the writer, on the reasoning that it "forbids nothing the system can currently express". That is true of the production *writers* and **false of the designed contract**: implementing it broke 4 tests across `li3eGovernanceChain` and `li3dGovernanceWriter`, including the person-anchored end-to-end chain and the `coalesce(person_id, target)` idempotency resolution.

The change was **reverted**; the suite is green again at 43/43. It would have deleted a capability, not tightened an invariant. Recorded so the same fix is not re-proposed from the same reasoning.

## A4. The decision matrix

| Question | Existing evidence | Engineering consequence | Human decision required? |
|---|---|---|---|
| Is an unsubscribe time-limited? | `contact_governance_until_only_deferred` permits `effective_until` only on `deferred` | Not representable | **No — foreclosed by schema** |
| Are duplicate unsubscribes safe? | `uq_contact_governance_identity`, partial | No-op; INSERT and catch `23505`, never `ON CONFLICT` (`42P10`) | **No — already solved** |
| What anchor do writers use today? | Every writer is target-keyed (A1) | Target is the de-facto canonical anchor | **No — determined by the repository** |
| Does the platform keep person-scoped suppression? | Built and tested (A2); **zero production writers produce it** | If kept: DEFECT-008 is live the moment erasure exists, and erasure needs a mechanism other than forbidding the shape. If dropped: deprecate the LI-3E capability and its tests | **YES — this is the decision** |
| Can a target be recovered from an outreach outcome? | **No.** Zero recipient/address columns in `outreach_tasks`, `outreach_delivery_evidence`, `outreach_outcomes` — verified against both the migration and the baseline. The recipient exists only as an ephemeral runtime argument | A person-attributable unsubscribe from an outcome would carry a person and **no** target — precisely the DEFECT-008 shape | Contingent on the row above |
| Erasure semantics per table | No PI table is in any retention policy; no person-deletion path exists | DL-2 blocked | **YES — POLICY-4** |
| Does erasure leave a suppression tombstone? | Nothing implements it | Without it, erasure is temporary: identity resolution is deterministic on email/phone, so the next import recreates the person | **YES — POLICY-4** |

## A5. The one decision, stated as narrowly as it can be

> **Does the platform keep person-scoped suppression — "never contact this human at any address" — as a capability?**

- **If NO:** target anchoring is already complete and correct. Deprecate the person-only write path and its four tests, ratify target as canonical, and DEFECT-008 becomes unreachable by construction. Cheapest, and matches every production writer today.
- **If YES:** the capability stays, and **erasure must be solved without forbidding the shape** — the options are a durable person-independent anchor retained at delete time, or an erasure path that explicitly handles governance before deleting. It also makes persisting a recipient on the outreach family a prerequisite, since an unsubscribe from an outcome otherwise has no target to pair with the person.

Everything else in this contract is determined. **This is the only genuine human call**, and it is a compliance-posture judgement — the narrow reading follows the address, as email unsubscribe law generally does; the broad reading honours the wish as stated.

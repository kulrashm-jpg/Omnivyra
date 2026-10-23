# RECRUITMENT_DELTA — what the second enumerator changes, and what it does not

**Classification: PREPARATION.** Not evidence. **No person has been recruited. Both enumerator slots
are UNFILLED, and every other role remains UNFILLED as far as this package is concerned.** This
document compares two *packages*, not two sets of people.

Unfilled-marker convention: `<<UNFILLED: ...>>` and `UNASSIGNED` are markers, never data.

- Protocol basis: §4A.1, §4A.2, §4A.3, §19.3 item 3 — `CPG_U1_PROTOCOL_004.md` sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified by recomputation in
  two trees).
- Instrument basis: `lib/personnel.mjs` in the registered instrument, aggregate
  `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` / 593 files (verified by
  recomputation). The file is byte-identical in the worktree this package was written in.
- Compared against: the seven-role preparation package at `research/deeptech-operations/people/`
  (9 documents, 7 tools), which this package **does not modify**.

---

## 1. The delta in one line

**Exactly one more person, of a role type that already exists.** A second holder of `enumerator`.
No new role type, no new declaration, no new protocol clause, no new tooling.

---

## 2. Headcount

| | Seven-role package | This package |
|---|---|---|
| Independent role **types** | 7 | **7 — unchanged** |
| Independent **persons** | 7 | **8** |
| Operator (not independent) | 1 | 1 |
| Total humans | 8 | **9** |
| `enumerator` holders | 1 | **2** |
| Holders of every other independent role | 1 each | 1 each — unchanged |

§4A.3 authorises this directly, without any amendment:

> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
> - **Several enumerators are permitted; each holds no other role.**

"Minimum 7" is a floor, not a target. Eight independent persons, two of them enumerators, satisfies
§4A.3 and §19.3 item 3 as written.

**Naming caution for the owner.** "Seven-person" in the earlier package counts *independent
role-holders* (the operator is a further human, deliberately outside the independent set). This
directory is called `eight-person`, which on the same convention means **eight independent
role-holders** — i.e. nine humans including the operator. If anyone has been reading "eight-person"
as "seven independent + operator", the two readings differ by a whole person. See §9, Q1.

---

## 3. What is identical — the declaration set

**The same declaration set, unchanged, for the new person.** `DECLARATION_KEYS` is a single frozen
array of seven keys used for **every** role; there is no enumerator-specific variant and no
per-role branch anywhere in `checkPersonnelRegister`. The code says so in its own comment
(`lib/personnel.mjs:7`):

> `/** §4A.1 items 1–4 and 6, and §4A.2 (a)/(b) for enumerators and all roles alike. Every answer must be "no". */`

So the second enumerator signs the same seven questions, to the same standard (`"no"` only; *"An
unknown answer is not 'no'"*), with the same two hash fields:

| Per-person evidence, §4A.1 "Recorded per person" | Changed? |
|---|---|
| signed declaration answering items 1–4 and 6 and §4A.2(a)–(b) with "no" | no — same seven keys |
| the fee-agreement hash (or none) — `study_fee_agreement_sha256`, 64 hex or literal `null` | no — same field, same rule, **one more instance** |
| the developing organisation's written confirmation of no item 1–4 relationship — `organisation_confirmation_sha256`, 64 hex, required | no — same field, same rule, **one more instance** |

The operational consequence is arithmetic, not structural: **one more** declaration to obtain, **one
more** organisation confirmation to obtain and hash, **one more** fixed-fee agreement to sign before
any material is released, **one more** eligibility check to run.

---

## 4. No new role type

`INDEPENDENT_ROLES` is unchanged, and must stay unchanged (`lib/personnel.mjs:6`):

```js
export const INDEPENDENT_ROLES = Object.freeze(['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator']);
```

Seven entries. The second enumerator is a second **assignment** with `role: "enumerator"`, not an
eighth entry in this list. An unrecognised role is refused per assignment with
`assignment <i> (<role>): unknown role` (`lib/personnel.mjs:31`), so inventing a label such as
`enumerator-2` would **break** the register. Both assignments carry the literal string `enumerator`
and are distinguished only by `person_id`.

Nothing follows in §9 (reference truth) or §12 (rating): no new packet type, no new record format, no
new adjudication path. The frame is one CSV whichever number of people produced it.

---

## 5. The register-structure consequence — verified at `lib/personnel.mjs:26`

This is the one place in the instrument where "two of a role" is decided, and it permits it for
**`enumerator` and for no other role**. Read from the registered 593-file instrument, lines 23–27:

```js
  for (const role of INDEPENDENT_ROLES) {
    const n = assignments.filter((a) => a.role === role).length;
    if (n === 0) blockers.push(`role ${role} is UNFILLED`);
    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
  }
```

**Line 26** is the `else if`, and `role !== 'enumerator'` is the whole of the exception. Verified by
`grep -n "enumerator' && n > 1" lib/personnel.mjs` → `26:`. Therefore:

| Register shape | `check-personnel` result |
|---|---|
| 2 assignments with `role: "enumerator"`, distinct `person_id`s | **accepted** — no error, no blocker for that role |
| 2 assignments with any other role | `role <role> must be held by exactly one person` — **ERROR**, register refused |
| 0 assignments for any of the seven roles | `role <role> is UNFILLED` — **BLOCKED** (separate exit path) |
| the same `person_id` twice, in any roles | `ROLE COLLISION — <id> already holds <role>; all independent roles are mutually exclusive` — **ERROR** |
| the operator's `person_id` in any assignment | `ROLE COLLISION — the operator may hold no independent role` — **ERROR** |

Two consequences worth stating flatly:

1. **The register needs no schema change.** `PERSONNEL_SCHEMA` stays `cpg-u1-personnel/v1`;
   `assignments` is already an array; the second enumerator is one more element.
2. **`check-personnel` will not notice anything special about the second enumerator.** It counts
   assignments and compares `person_id` strings. It cannot tell whether the two pseudonyms denote two
   people (the tooling README is explicit that it does not prove *"that pseudonymous IDs denote
   distinct real people"*), and it cannot see any relationship between them. See §6.

---

## 6. What is genuinely new, and unenforceable

Four obligations exist in the eight-person configuration that did not exist in the seven-role one.
**None of them is checkable by any tool.**

| # | New obligation | Why it is new | Enforced by |
|--:|---|---|---|
| 1 | **A-to-B relational independence.** Each enumerator is *"a holder of another §4A.3 role"* with respect to the other, so §4A.1 item 6 applies **between them**, in both directions: spouse or partner, family member, household member, current or former direct reporting relationship. | With one enumerator there was no pair to check. | **nobody** — two declarations and the operator's own knowledge. `ENUMERATOR_ELIGIBILITY_CHECK.md` §3. |
| 2 | **Distinctness of the two persons.** Two pseudonyms must denote two humans. | Same reason. | **nobody** — `check-personnel` compares strings only. |
| 3 | **A deterministic, pre-registered work partition**, fixed before release, independent of findings, with disjoint `candidate_id` prefixes. | One enumerator needs no partition. | partly — `loadFrame` refuses a duplicate `candidate_id` (`cpg_u1_data.mjs:99`), which catches a *collision* but not a *bad rule*. The rule itself is unchecked. |
| 4 | **Per-row attribution via `enumerated_by`.** With two enumerators this is the only thing that says which person authored which row, and it matters because §4A.1's consequence for a false enumerator declaration lands on the frame. | With one enumerator every row was trivially attributable. | **nobody** — `checkFrameRow` requires `enumerated_by` to be non-blank (`lib/schema.mjs:124`) and nothing more. It does not check the value against the register. |

Item 4 deserves emphasis. `enumerated_by` is validated as *non-blank text*, full stop. A row carrying
the wrong enumerator's pseudonym, or a value that is in no register at all, passes every automated
check in the instrument. **The operator must reconcile `enumerated_by` against the register by hand**
after merging the two files, and record having done so.

---

## 7. What does *not* change

| Unchanged | Note |
|---|---|
| The protocol | **No protocol edit is required or permitted here.** §4A.3 already authorises several enumerators. No byte of `CPG_U1_PROTOCOL_004.md` is touched by this package. |
| `DECLARATION_KEYS` | seven keys, same for every role |
| `INDEPENDENT_ROLES` | seven role types |
| `PERSONNEL_SCHEMA` | `cpg-u1-personnel/v1` |
| The frame format | the same 22 `FRAME_COLUMNS`, the same `checkFrameRow` |
| `FRAME_COLUMNS` count | 22 — verified; two enumerators add no column |
| The tooling | no new command, no changed command, no new library. The registered aggregate is unaffected. |
| The registration fields | no new field; the registration carries protocol, tooling aggregate and registry hashes as before |
| §9 and §12 material | no new packet, record or adjudication path |
| Frame sufficiency | `FRAME_MINIMUM` is a property of the frame, not of how many people built it |
| The mutual-exclusion rule | still absolute: each enumerator holds exactly one role, and **neither may be the reference adjudicator** (§4A.3) |

---

## 8. Operational delta, itemised

| Act | Seven-role package | This package |
|---|---|---|
| Role descriptions to issue | 1 per role | **2** for `enumerator` |
| Declarations to obtain | 7 | **8** |
| Organisation confirmations to obtain and hash | 7 | **8** |
| Fixed-fee agreements to sign before any release | up to 7 | up to **8** |
| Per-slot eligibility checks | 7 | **8** |
| Pairwise relational checks between role-holders of the *same* type | 0 | **1 (A↔B)** |
| Partition rule to design, hash and pre-register | 0 | **1** |
| Frame files to merge before running `frame` | 1 | **2** |
| `enumerated_by`-to-register reconciliations | trivial | **1 manual reconciliation over the merged frame** |
| Register assignments | 7 | **8** |
| `check-personnel` schema changes | — | **none** |

---

## 9. Open questions for the owner

| # | Question |
|--:|---|
| Q1 | Does "eight-person" mean **eight independent role-holders** (two enumerators, plus the operator as a ninth human) — the reading this package is written to — or "seven independent plus the operator"? The two readings differ by one whole person, and the answer changes the recruitment count. |
| Q2 | Is the second enumerator intended to **increase frame coverage** (disjoint partitions) or to **cross-check** it (deliberate overlap)? The partition-rule agent needs this decided; the two designs have different reconciliation consequences, and §5.9's no-replacement rule constrains overlap reconciliation sharply. |
| Q3 | Will the operator disclose each enumerator's identity to the other, in order to make declaration question 5 honestly answerable about "any holder of another §4A.3 role"? If not, how is that coverage gap closed and recorded? (`ENUMERATOR_ELIGIBILITY_CHECK.md` §4.) |
| Q4 | Who reconciles `enumerated_by` against the register after the merge, and where is that reconciliation recorded? No tool does it. |
| Q5 | The §5.3 / §19.2 H2 **registry-completeness attestation is still not obtained**. Until it is, every `no` in the four contamination columns — from both enumerators — rests on an unattested list. (`ENUMERATOR_CONTAMINATION_RULES.md` §7.) |
| Q6 | Does adding a second enumerator change the fee budget or the schedule in a way that would push the fee agreements past the §4A.1 item 5 deadline ("agreed in writing **before** any role material is released")? Two agreements must both be signed before **either** release. |

---

## 10. Honest summary of the delta's methodological weight

Adding a second enumerator costs one more set of paperwork and buys more frame throughput, or a
cross-check, depending on Q2. It adds **no** new machine-checked guarantee. Everything genuinely new —
that A and B are two unrelated people, that the partition was fixed before anyone looked, that each
row is attributed to the person who really wrote it — rests on declarations and on the operator's
record-keeping, exactly the class of evidence §4A.1 calls *"procedural evidence, not proof"*.

The instrument's position has not moved: `lib/personnel.mjs:3` — **"It cannot verify that
declarations are true."** With two enumerators there is simply one more declaration it cannot verify,
and one relationship — the one between them — that it was never able to see at all.

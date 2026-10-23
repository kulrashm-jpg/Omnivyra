# MATERIAL_RELEASE_JOINT_GATE — no study material reaches either enumerator until the conditions for BOTH are satisfied

**CLASSIFICATION: PREPARATION. FAIL-CLOSED GATE, ENTIRELY UNFILLED.** No person exists. **No one has
been recruited, approached, engaged or named. No material has been released to anyone.** Every box
below is unchecked and every person-specific field is an unfilled marker. No protocol byte and no
instrument byte modified.

**Marker convention:** `[ ]` unchecked, `<<PENDING_…>>` and `UNASSIGNED` are markers, never data.
**A box is checked only by the operator, against a document, on a date. Nothing here checks itself.**

Baseline: `origin/main` `33bceb1f919113c622587fa7c6403a0d4596bbad`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`.

**Relation to `prereg-008/C-enumerators/MATERIAL_RELEASE_GATE.md`.** That file is the per-enumerator
gate and settled the textual reading. This file adds the **one thing it did not make operational: the
joint, cohort-level ordering rule for a pair**, as a single fail-closed checklist with an explicit
both-or-neither release act. It does not restate the eligibility or fee-agreement templates; read them
there.

---

## 1. THE RULE

> **No study material reaches EITHER enumerator until the §4A.1 declaration conditions and the
> §4A.1 item 5 fee conditions are satisfied for BOTH enumerators.**
>
> **Release is a single joint act. Any unchecked box in §3 blocks release for BOTH.** There is no
> partial release, no provisional release, no "A can start while B's paperwork completes", and no
> release of a subset of the material.

"Study material" here means everything on §4A.2's receive-list — *public sources; the frame template;
§4A, §5.1–§5.4; the jurisdiction-family list; the development-only registry* — plus the jurisdiction
assignment and any instruction text. Release of **any one** of those items is release.

---

## 2. THE GROUNDING, AND THE READING THAT WAS SETTLED

### 2.1 §4A.1 item 5, verbatim

> 5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
>    material is released, **not contingent** on any result, finding or future engagement; the
>    agreement's SHA-256 is recorded;

Two facts about this sentence, both established by exhaustive search of `CPG_U1_PROTOCOL_004.md` in
the prior wave and re-checked here: **"role material" occurs exactly once in the whole protocol**, at
this line, and is never defined; **"release"/"released" occurs exactly once**, the same occurrence.
There is no release procedure, no release log requirement, and no scoping language anywhere to read it
against. So the scope of "released" is genuinely open on the text.

### 2.2 The reasoning already established — carried forward, not re-litigated

Two readings were identified:

- **Reading P (per-person)** — material released **to that person**; the fee must precede *that
  person's* packet.
- **Reading S (study-wide)** — material released **to anyone in the study**; no role material may reach
  any person until every person's fee agreement is in writing.

**Reading S, taken literally across all roles, contradicts §19.3(3).** §19.3(3), verbatim:

> 3. **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference
>    Author, Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — **before the respective
>    stage** (or a recorded absence of raters with the §12 ceiling). Seven mutually exclusive
>    independent persons.

*"before the respective stage"* expressly contemplates **staged** recruitment, and §4A.3 confirms the
staging in terms: the rater / rating-adjudicator label assignment is fingerprinted *"before the
**held-out commitment** transaction is broadcast (§12.1)"* — which is §5.5 step 9, long after
enumerators need their packets at §5.5 step 3. Under a literal Reading S, **no enumerator could receive
a packet until the rating adjudicator's fee was signed**, collapsing §19.3(3)'s staging permission. A
reading that contradicts an express staging permission is the weaker reading.

### 2.3 THE RULE THAT RESULTS

> **Synchronise within a cohort; per-person across cohorts.**
>
> - **Within the enumerator cohort:** joint. Both enumerators' conditions complete before either
>   receives anything. Reading S is applied *inside* the cohort.
> - **Across cohorts:** per-person. A cohort's material is released once that cohort's conditions are
>   complete; a later cohort's incompleteness does **not** block an earlier cohort. Reading P governs
>   between cohorts, as §19.3(3) requires.

**Why the joint rule inside the cohort is cheap, and why it is right.** Both enumerators receive the
**same** §4A.2 packet, at the **same** step of §5.5, for the **same** kind of work. "Both before
either" therefore costs **one synchronisation point, not a schedule**. And it is forced independently
of item 5 by protocol line 145:

> An unknown answer is not "no".

If A's packet is released before B is a role holder, A's item-6 declaration **cannot** have covered B —
because B was not yet *"any holder of another §4A.3 role"* — and **no later signature by B repairs
A's**. The only cure is a re-declaration round by A, at the cost the earlier wave priced as capable of
**reversing the eighth person's entire benefit**. The joint gate is what keeps a second enumerator
net-positive.

### 2.4 Why release is irreversible, and therefore why this is a gate and not an audit

Once the frame template, §5.1–§5.4, the jurisdiction-family list or the development-only registry has
reached a person:

- it cannot be un-reached, so a fee agreed **afterwards** can never satisfy item 5 for that person; the
  payment falls back under items 2–3 and the person may hold **no** §4A.3 role;
- §4A.2(b) ineligibility (*"not have run CPG or seen any CPG output … before completing the frame"*) is
  likewise unrecoverable for that person;
- §4A.1 states the consequence for the study, not just the person: *"**enumerator work:** the frame is
  not independent (§20.18)"* — and the frame is single and frozen, so the damage is **study-level**,
  not row-level.

**There is no tool that detects a premature release.** `check-personnel` sees a register, not a
mailbox. This checklist is the only control that exists.

---

## 3. THE GATE — fail-closed checklist

**Read the whole list before checking anything. Any unchecked box in §3.1, §3.2 or §3.3 means NO
RELEASE TO EITHER ENUMERATOR.**

### 3.1 Per-enumerator conditions — the SAME nine boxes, twice, independently

| # | Condition | Authority | ENUMERATOR_A | ENUMERATOR_B |
|---|---|---|---|---|
| 1 | Roster **fixed at eight** independent persons before any declaration is signed | line 145; §4A.3 | `[ ]` | `[ ]` |
| 2 | §4A.1 declaration signed, all **seven** `DECLARATION_KEYS` answered the literal `"no"` | §4A.1; `lib/personnel.mjs:37` | `[ ]` | `[ ]` |
| 3 | Declaration **dated on or after** the date the last of the eight became a role holder | line 145 | `[ ]` | `[ ]` |
| 4 | §4A.2 (a)–(e) eligibility confirmed: not an implementer; has not run or seen CPG output; not the operator; holds no other §4A.3 role; satisfies §4A.1 | §4A.2 | `[ ]` | `[ ]` |
| 5 | Item-6 **relational schedule** supplied to the operator alone | DR-8 A5 step 1 | `[ ]` | `[ ]` |
| 6 | Developing organisation's written no-relationship confirmation obtained and hashed (64 lowercase hex; **mandatory**, `lib/personnel.mjs:39`) | §4A.1 recording block | `[ ]` | `[ ]` |
| 7 | Fee agreement **signed and hashed**, OR `study_fee_agreement_sha256: null` recorded as a deliberate no-fee engagement | §4A.1 item 5; `lib/personnel.mjs:38` | `[ ]` | `[ ]` |
| 8 | Fee **not contingent** on any result, finding or future engagement — and not on the other enumerator's output | §4A.1 item 5; C-1d | `[ ]` | `[ ]` |
| 9 | Fee agreement dated **before** this release act (the ordering that item 5 actually requires) | §4A.1 item 5 | `[ ]` | `[ ]` |

### 3.2 Pair-level conditions — checked once, for the pair

| # | Condition | Authority | Status |
|---|---|---|---|
| 10 | Operator's `pairwise_item6_check` performed and recorded, covering **both** enumerators and every other pair | DR-8 A5 steps 3–4 | `[ ]` |
| 11 | `non_dependence_attestation` complete: C-1 … C-5 of `NON_DEPENDENCE_CONDITION.md` | this package | `[ ]` |
| 12 | **The two fee-agreement hashes differ** (or both are `null`). `check-personnel` gives **0 errors** on a duplicated hash — **verified** — so only this box catches a shared agreement | C-1b | `[ ]` |
| 13 | Both carry the **literal** role string `enumerator` (not `enumerator-2`, which is refused as `unknown role` — **verified**) | `lib/personnel.mjs:6,31` | `[ ]` |
| 14 | Neither enumerator is the reference adjudicator, the operator, or any other role holder | §4A.3 | `[ ]` |
| 15 | Jurisdiction partition assigned and **disjoint**; `candidate_id` prefixes assigned and **disjoint** | `ENUMERATOR_WORK_ALLOCATION.md` | `[ ]` |
| 16 | Knowledge-window exclusion list applied to the packet contents, and the §4A.2 conflict question in `KNOWLEDGE_WINDOW_RULE.md` §4 **decided by the owner** | this package | `[ ]` |

### 3.3 The instrument gate — run it, do not assume it

| # | Condition | Status |
|---|---|---|
| 17 | `check-personnel --personnel <register>` run against the frozen instrument at `C:/tmp/dt002/research/cpg-u1/tooling` (aggregate `f7699f05…`, 593 files — **not** the 587-file stale tree) | `[ ]` |
| 18 | It reported **0 errors and 0 blockers** and exited **0** | `[ ]` |
| 19 | The instrument aggregate was recomputed **after** the run and is unchanged at `f7699f05…` | `[ ]` |

**What box 18 means, stated so no one can misread it.** A register that **passes** `check-personnel` is
a register containing **eight real, declared, organisation-confirmed people**. The file shipped in this
package, `PENDING_PERSONNEL_REGISTER.json`, is built so that it **cannot** pass; its real observed
result is `9 error(s)`, `exit 1`. **Box 18 is therefore unreachable today, by construction, and that
is the correct state.**

---

## 4. THE RELEASE ACT

Only if **every** box in §3.1 (both columns), §3.2 and §3.3 is checked:

```
JOINT RELEASE RECORD — ENUMERATOR COHORT

  Boxes 1–19 all checked:                 [ ]  (unchecked)
  Released by:            <<PENDING_PERSONNEL: OPERATOR — NO PERSON ASSIGNED>>
  Release date/time:      <<PENDING_DATE — NOT RELEASED>>
  Released to:            <<PENDING_PERSONNEL: ENUMERATOR_A>> and <<PENDING_PERSONNEL: ENUMERATOR_B>>
                          — simultaneously, in one act
  Material released:      public sources · frame template · §4A, §5.1–§5.4 ·
                          jurisdiction-family list · development-only registry ·
                          that enumerator's jurisdiction assignment and candidate_id prefix
  Material NOT released:  everything on the KNOWLEDGE_WINDOW_RULE.md exclusion list
  Register state at release: <<PENDING_HASH — sha256 of the register file at the moment of release>>

  CURRENT STATE: NOT RELEASED. NOTHING HAS BEEN RELEASED TO ANYONE.
```

Recorded in the restricted register under the `material_release` key, which the instrument ignores
(`lib/personnel.mjs:16–41` has no key allow-list), so it costs no instrument byte:

```
"material_release": {
  "enumerator_cohort_gate_satisfied": false,
  "released_to_enumerator_a_on": null,
  "released_to_enumerator_b_on": null
}
```

Both dates are `null` and the flag is `false`. **`null` here means "not released", not "no fee" —
unlike `study_fee_agreement_sha256`, where `null` is a positive assertion.** Do not copy the
convention across.

---

## 5. What the gate does NOT govern

| Out of scope | Where |
|---|---|
| The rating cohort's gate | §19.3(3) per-cohort; raters recruited by §5.5 step 9 / §4A.3's §12.1 fingerprint deadline. **Their incompleteness must not block this release** — that is the whole point of §2.3 |
| The reference cohort's gate | Same per-cohort rule; a separate checklist, not this one |
| What either enumerator is later *told* | `KNOWLEDGE_WINDOW_RULE.md` — release is a one-time act, the knowledge window is continuous |
| Who reconciles cross-partition entity duplicates | **Still DECISION REQUIRED** (DR-8 §(e), OQ-5). An enumerator may not (they would see the other partition); the reference adjudicator may not (§4A.3) |

---

## 6. Risks

| # | Risk | Severity | Mitigation / residual |
|---|---|---|---|
| R-1 | A is onboarded and given the packet, then B is added later | **Highest** — A's item-6 declaration cannot cover B (line 145), and re-declaration can reverse the whole benefit of a second enumerator | Box 1 fixes the roster at eight **before** any signature |
| R-2 | Partial release ("just the jurisdiction-family list, to get started") | High, and it looks harmless | §1: release of **any one** listed item is release. No provisional category exists |
| R-3 | Premature release happens and is never noticed | **Unmitigable by tooling** — `check-personnel` sees a register, not a mailbox | This checklist plus the dated release record is the only control |
| R-4 | Box 18 is checked against the **stale 587-file** tooling tree, which runs fine and gives a self-consistent wrong aggregate | Medium | Box 17 names the path; box 19 recomputes the aggregate afterwards |
| R-5 | A shared fee agreement passes because the register check is clean | Medium | Box 12; **verified** that a duplicated hash yields 0 errors |
| R-6 | The joint rule is over-generalised to all eight persons (literal Reading S) and collapses §19.3(3) staging | Medium | §2.3 states the cohort scope explicitly; §5 lists what is out of scope |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1 (items 5, 6, recording block, line 145), §4A.2,
  §4A.3, §5.5, §12.1, §19.3(3), §20.18
- `C:/tmp/dt002/research/cpg-u1/tooling/lib/personnel.mjs`, `cpg_u1_data.mjs` (`cmdCheckPersonnel`,
  `EXIT`), `lib/aggregate.mjs`
- `C:/tmp/dt008-prereg/C-enumerators/MATERIAL_RELEASE_GATE.md`, `FEE_AGREEMENT_TEMPLATE.md`,
  `ENUMERATOR_DEADLINES.md`, `ENUMERATOR_AB_DIFFERENCES.md`
- `C:/tmp/dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` (rules A3, A4, A5, A7)

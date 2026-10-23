# ENUMERATOR_B_AUTHORIZATION — the operator's authorisation record for adding a second enumerator

**Classification: PREPARATION. Authorisation of a SLOT, not of a person.** No person exists in this
file. **No one has been recruited, approached or named, and nothing here is a claim that anyone has
been.** Every person-specific field is an unfilled marker.

**What this file authorises:** that the study may have a **second enumerator slot** at all, on the
protocol's own terms, and that the instrument accepts it without modification. **What it does not
authorise:** the onboarding of any particular person — that is
`F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` — or the release of any material — that is
`MATERIAL_RELEASE_GATE.md`.

**Marker convention:** `<<UNFILLED: …>>` and `UNASSIGNED` are markers, never data.

Baseline, recomputed by the author of this file:

| Basis | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified** |
| Instrument | aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, **593** files, at `C:/tmp/dt002/research/cpg-u1/tooling` — **verified** |
| Stale tree in this worktree, not to be used | `research/cpg-u1/tooling`, **587** files, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` |

---

## 1. The protocol authority — §4A.3, verbatim

> **Roles:**
> - operator (key custodian; not independent);
> - **enumerator (≥ 1)**;
> - reference Author;
> - reference Confirmer;
> - reference adjudicator;
> - rater 1;
> - rater 2;
> - rating adjudicator.
>
> **Every independent role is held by a different person, and no independent role is held by the
> operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
> - **Several enumerators are permitted; each holds no other role.**
> - An enumerator may not be the reference adjudicator. …

Two sentences carry the authorisation:

1. **`enumerator (≥ 1)`** in the role list — the only role with a cardinality annotation.
2. **"Several enumerators are permitted; each holds no other role."**

No amendment, no waiver and no decision is required to add a second enumerator. It is permitted on the
face of the protocol. What **is** required is the additional paperwork §4A.1 demands per person, and the
pairwise item-6 checks in §5 below, which grow with the head count.

§19.3 item 3 names the personnel prerequisite as *"enumerator(**s**), reference Author, Confirmer and
adjudicator, ≥ 2 raters and a rating adjudicator — before the respective stage … **Seven mutually
exclusive independent persons.**"* Seven is the **minimum**; a second enumerator makes it eight
independent persons, plus the operator as a ninth human.

---

## 2. The instrument already permits it — verified in the frozen code

### 2.1 The single line that does the work

`C:/tmp/dt002/research/cpg-u1/tooling/lib/personnel.mjs:26`, verbatim:

```js
    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
```

in context (`:23-27`):

```js
  for (const role of INDEPENDENT_ROLES) {
    const n = assignments.filter((a) => a.role === role).length;
    if (n === 0) blockers.push(`role ${role} is UNFILLED`);
    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
  }
```

`enumerator` is the **only** role excluded from the "exactly one person" rule. Every other role in
`INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is capped at one holder. So the cardinality asymmetry
§4A.3 states in prose is implemented, exactly, in one clause.

### 2.2 The instrument asserts it in its own self-test

`C:/tmp/dt002/research/cpg-u1/tooling/test/selftest.mjs:829`, verbatim:

```js
  { const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' }); ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
```

and the line immediately after it, `:830`:

```js
  { const r = personnel(); r.assignments.push({ ...r.assignments[4], person_id: 'SYN-P-R1B' }); ok(chk(r).errors.some((e) => e.includes('exactly one')), 'a second rater-1 refused'); }
```

The two lines are a matched pair, and they settle the question without interpretation:

| Assertion | Line | Expectation |
|---|---|---|
| `'multiple distinct enumerators permitted'` | `test/selftest.mjs:829` | a second `enumerator` yields **`errors.length === 0`** |
| `'a second rater-1 refused'` | `test/selftest.mjs:830` | a second `rater-1` yields an error containing `exactly one` |

**Re-verified by execution**, by constructing a synthetic register (seven roles, all declarations
`"no"`, a placeholder 64-hex organisation confirmation, fee `null`) and calling
`checkPersonnelRegister` from the frozen module:

| Register | `errors` | `blockers` |
|---|---|---|
| seven roles, one enumerator | `[]` | `[]` |
| seven roles **plus a second assignment with role `enumerator`** and a distinct `person_id` | `[]` | `[]` |
| seven roles plus a second assignment with role `enumerator-2` | `["assignment 7 (enumerator-2): unknown role"]` | `[]` |

No synthetic value from that probe is recorded anywhere; it exercised the checker in memory only, and
nothing was written into `C:/tmp/dt002`.

### 2.3 Both enumerators carry the literal role string `enumerator`

This is the single most likely register-authoring mistake, and it is a hard refusal.

`INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is a frozen list of exactly seven literal strings:

```js
export const INDEPENDENT_ROLES = Object.freeze(['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator']);
```

and `lib/personnel.mjs:31`:

```js
    if (!INDEPENDENT_ROLES.includes(a.role)) { errors.push(`${where}: unknown role`); continue; }
```

Consequences, all verified:

| `role` value on B's assignment | Outcome |
|---|---|
| `"enumerator"` | **accepted** — this is the only correct value |
| `"enumerator-2"` | `assignment N (enumerator-2): unknown role` — **refused** |
| `"enumerator-b"`, `"enumerator_2"`, `"Enumerator"`, `"enumerators"` | refused, same error — the comparison is exact and case-sensitive |

Note the second effect of `continue` on that line: an assignment with an unknown role is **skipped
entirely**, so its declarations, fee hash and organisation confirmation are **never checked**, and its
`person_id` is never entered into the collision map. A mis-spelled role therefore produces **one**
error while silently suppressing every other check for that person. It is not a cosmetic defect.

**A and B are distinguished by `person_id`, never by the role string.** Where a human-readable label is
needed — allocation documents, the release log, this package — the operator uses "Enumerator A" and
"Enumerator B" as **operational labels outside the register**. `ENUMERATOR_AB_DIFFERENCES.md` states
what may and may not differ between them.

| Field | A | B |
|---|---|---|
| Register `role` | `enumerator` | `enumerator` — **identical string** |
| `person_id` | `UNASSIGNED` | `UNASSIGNED` |
| Slot label (operational only) | `Enumerator A` | `Enumerator B` |

---

## 3. What adding B does **not** change

| | |
|---|---|
| Role types | none added. B is an **instance** of an existing role, not a new role. |
| Schema | unchanged. `PERSONNEL_SCHEMA` stays `cpg-u1-personnel/v1`; the frame's `FRAME_COLUMNS` already carry `enumerated_by` per row (`lib/schema.mjs:31-33`), so per-row attribution of two enumerators needs no schema change (`B-partition/PARTITION_DESIGN.md` §0). |
| Declaration set | unchanged — the same seven `DECLARATION_KEYS`, one more instance (`RECRUITMENT_DELTA.md` §3). |
| Frame minimum, admissibility, contamination, identifier rules | unchanged. §5.7.2, §5.1, §5.3 and A3 are untouched; two enumerators produce **one** frame. |
| `frame_hash` | unchanged in definition. `hashRecords(frame, 'candidate_id')` sorts before hashing (`lib/canonical.mjs:17-22`), so the merge needs no negotiated row order — **while `candidate_id`s are unique**; see `ENUMERATOR_AB_DIFFERENCES.md` §4. |
| Exclusions | unchanged and now applied twice: neither enumerator may be the operator (§4A.2(c)), hold any other role (§4A.2(d), §4A.3) or be the reference adjudicator (§4A.3). |

---

## 4. What adding B does change, and what is newly unmachine-checkable

1. **Head count** rises from seven independent persons to **eight**, plus the operator.
2. **One more** of each §4A.1 artefact: declaration, organisation confirmation, fee agreement (or a
   recorded no-fee), eligibility check.
3. **A pairwise relational check that did not exist with one enumerator.** With two enumerators, each is
   *"a holder of another §4A.3 role"* with respect to the other, so §4A.1 item 6 now applies **between
   A and B**. No tool can see it. See §5.
4. **A partition becomes mandatory**, with disjoint `candidate_id` prefixes fixed before release
   (`B-partition/PARTITION_DESIGN.md`; `ENUMERATOR_AB_DIFFERENCES.md`). One enumerator needs no
   partition.
5. **`enumerated_by` reconciliation** against the register after the merge — no tool does it
   (`RECRUITMENT_DELTA.md` §9 Q4).
6. **Enumerator/family confounding** if the partition is by jurisdiction: any enumerator-specific
   systematic error lands on one whole family and is indistinguishable from a jurisdiction effect
   (`PARTITION_DESIGN.md` risk R-1). Declared in advance, not fixed.

**No new machine-checked guarantee is acquired.** `lib/personnel.mjs:3` — *"It cannot verify that
declarations are true."* — now applies to one more declaration, and to one relationship it was never
able to see at all.

---

## 5. §4A.1 item 6 — the pairwise check, run against **every** other role-holder

§4A.1 item 6, verbatim:

> 6. is the spouse or partner, a family member or a household member of, or has a current or former
>    direct reporting relationship with, **any person who developed CPG, the operator (key custodian),
>    or any holder of another §4A.3 role**.

Item 6's counterparty set is **three sets unioned**, and it is not symmetric with the declaration key
alone: `close_relationship_with_developer_operator_or_role_holder` = `"no"` is **one string** covering
all of it. The operator must therefore run the matrix, because the declarant frequently cannot: the
other role-holders' identities are held by the operator, not by the declarant. This is the coverage gap
`F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §4 requires the operator to close and to record the
closure **method** for.

### 5.1 B against every §4A.3 role-holder — both directions

Run for **each** relationship type: spouse or partner; family member; household member; **current**
direct reporting relationship; **former** direct reporting relationship. Answer each cell `no`, `yes`
or `unknown` — and **`unknown` is not a `no`** (§4A.1).

| Counterparty | Spouse/partner | Family | Household | Current reporting | Former reporting |
|---|---|---|---|---|---|
| **Enumerator A** (the other enumerator) | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| reference Author | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| reference Confirmer | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| reference adjudicator | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| rater 1 | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| rater 2 | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| rating adjudicator | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **the operator (key custodian)** | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |
| **each person who developed CPG** — one row per developer | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED>>` |

Number of CPG developers in scope: `<<UNFILLED: integer — the operator enumerates them; item 6 names "any person who developed CPG", with no size limit>>`.

**Direction.** Item 6's wording ("is the spouse or partner … of") and "current **or former** direct
reporting relationship **with**" reach both directions of a reporting line. Run each reporting cell as
*"B reported to X at any time in the exclusion period"* **and** *"X reported to B at any time in the
exclusion period"*, and record both.

**Period.** Every cell is asked over the whole §4A.1 exclusion period — *"from the first repository
commit of the developing organisation's product until publication of this study's results"* — not as of
today. Family and household status can change inside the period; a relationship that ended is still a
`yes` for "former".

**Adjacent facts that are not themselves item-6 exclusions, recorded anyway** (mirroring
`ENUMERATOR_ELIGIBILITY_CHECK.md` §3, which records them because they are the common route into a
former reporting relationship):

| Fact | Value |
|---|---|
| B shared an employer with any counterparty above at any time in the exclusion period | `<<UNFILLED>>` — record which, and the operator's reasoning |
| B shared a team or a line manager with any counterparty above | `<<UNFILLED>>` |
| B co-authored, co-founded or was in a business relationship with any counterparty | `<<UNFILLED>>` — not an item-6 term; record it and the reasoning |

### 5.2 Verdict, and the direction of the check

The pairwise matrix is run **for B against everyone**, and also **for everyone against B** — adding B
re-opens the item-6 question for every already-cleared role-holder, because B is now *"a holder of
another §4A.3 role"* from their side too. A previously completed declaration that predates B's
existence **cannot have answered question 5 about B.**

| Field | Value |
|---|---|
| B's item-6 matrix complete, no cell `unknown` | `<<UNFILLED: yes / no>>` |
| Every **other** role-holder's question 5 re-asked, or otherwise closed, **with B in scope** | `<<UNFILLED: yes / no — and by which method, per `ENUMERATOR_ELIGIBILITY_CHECK.md` §4>>` |
| Item-6 verdict for B | `<<UNFILLED: independent / NOT independent>>` |
| Operator's closure signature | `<<UNFILLED>>` |

---

## 6. What `check-personnel` establishes, and the staleness it cannot see

`check-personnel` (`cpg_u1_data.mjs:712`, `:1085`) calls `checkPersonnelRegister`. Against the register
it establishes, mechanically:

- the schema is `cpg-u1-personnel/v1`;
- each of the seven roles has **at least one** holder, and every role except `enumerator` has **exactly
  one** (`lib/personnel.mjs:24-26`);
- every `role` string is one of the seven literals (`:31`);
- every `person_id` matches `^[A-Za-z0-9_-]{1,64}$` (`:32`);
- no `person_id` equals the operator's (`:33`);
- no `person_id` appears twice (`:34-35`);
- for each of the seven `DECLARATION_KEYS`, the stored value **is the string `"no"`** (`:37`);
- `study_fee_agreement_sha256` is 64 lower-case hex or the literal `null` (`:38`);
- `organisation_confirmation_sha256` is 64 lower-case hex — **no `null` path** (`:39`).

**What it cannot establish — stated plainly, because it is the crux of adding a person:**

> **`check-personnel` cannot detect a stale declaration.** It reads a register **as it stands now** and
> establishes only that **each of the seven strings is `"no"`**. It cannot see:
>
> - **when** the declaration was signed, or whether it was signed at all — there is no date field and no
>   signature field in the register structure it validates;
> - whether the answer was true **when signed**;
> - whether the answer is **still** true — item 6 relationships and §4A.2(b) exposure both move with
>   time, and §4A.2(b) reaches *"before completing the frame"*, not "before release";
> - whether the declaration was taken **before B existed**, and therefore could not have covered B under
>   question 5;
> - whether anything has been **re-asked** after B joined;
> - whether the `"no"` was copied forward from an earlier register revision without anyone re-reading it.
>
> A register in which all seven strings read `"no"` and every declaration behind them is two years old
> and never re-confirmed passes `check-personnel` with **zero errors**. The check is a **string check**,
> not a currency check. `lib/personnel.mjs:3`: *"It cannot verify that declarations are true."*

Two further blind spots that adding B makes material:

- **Near-collision of `person_id`s is not detected.** `lib/personnel.mjs:34` compares strings for
  **equality** only. Verified: `person_id`s `P0` and `P0-EXTRA` in one register yield `errors: []`,
  `blockers: []`. A prefix relationship between A's and B's ids is therefore an **operational**
  obligation, enforced by `ENUMERATOR_PACKET_VALIDATOR.mjs`, not by the instrument.
- **Two pseudonyms for one human pass everything.** `ENUMERATOR_ELIGIBILITY_CHECK.md` §3 records the
  same point; it is an operator attestation (`MATERIAL_RELEASE_GATE.md` G2.4), not a check.

Expected output at this package's stage, with the other five roles unrecruited: six `BLOCKED role …
UNFILLED` lines and exit `EXIT.BLOCKED` (`cpg_u1_data.mjs:716`). **That is the expected state, not a
defect** (`ENUMERATOR_ELIGIBILITY_CHECK.md` §6). Any line beginning `ERROR` is a real register defect.

---

## 7. The authorisation record — blank

| Field | Value |
|---|---|
| A second enumerator slot is authorised under §4A.3 ("Several enumerators are permitted") | **yes — authorised by the protocol itself; no operator decision creates it** |
| Instrument change required | **none** — `lib/personnel.mjs:26`; `test/selftest.mjs:829` |
| Protocol amendment required | **none** |
| Reason the operator is adding B | `<<UNFILLED: frame coverage (disjoint partitions) or cross-check (deliberate overlap) — `RECRUITMENT_DELTA.md` §9 Q2 is still open, and the answer changes the reconciliation design>>` |
| Partition rule identifier and sha256 | `<<UNFILLED>>` |
| Slot A `person_id` | `UNASSIGNED` |
| Slot B `person_id` | `UNASSIGNED` |
| Register `role` for both | `enumerator` (literal, identical) |
| B's item-6 matrix verdict (§5) | `<<UNFILLED>>` |
| Every other role-holder's question 5 re-asked with B in scope | `<<UNFILLED>>` |
| `check-personnel` ERROR count | `<<UNFILLED: integer, must be 0>>` |
| `ENUMERATOR_PACKET_VALIDATOR.mjs` verdict | `<<UNFILLED: PASS / REFUSED>>` |
| `MATERIAL_RELEASE_GATE.md` state | **`BLOCKED`** — every box in that file is unchecked |
| Operator signature | `<<UNFILLED>>` on `<<UNFILLED: YYYY-MM-DD>>` |

**Slot B is UNFILLED. Slot A is UNFILLED. No person has been recruited or approached. This file
authorises the existence of the slot and nothing else.**

---

## 8. Honest statement of what this authorisation is worth

Adding a second enumerator is **structurally free** — the protocol permits it in one sentence and the
instrument implements it in one clause, asserted by its own self-test. Everything that makes the
addition *sound* is **not** free and **not** checkable: that A and B are two unrelated people, that the
partition was fixed before anyone looked, that each row is attributed to the person who really wrote it,
and that neither declaration is stale. All four are the class of evidence §4A.1 calls *"procedural
evidence, not proof"*, and §20.18 places the frame's unbiasedness entirely on them: independent
candidate selection *"rests on enumerator independence only"*.

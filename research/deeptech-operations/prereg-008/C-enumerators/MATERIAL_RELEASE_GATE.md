# MATERIAL_RELEASE_GATE — the one checklist the operator runs before releasing ANY study material to ANY enumerator

**Classification: PREPARATION. Fail-closed gate, entirely unfilled.** No person exists. No material has
been released. **No one has been recruited, approached or named.** Every box below is unchecked and
every person-specific field is an unfilled marker.

**This is the critical-path artefact of this package.** Everything else in
`prereg-008/C-enumerators/` and in `eight-person/F-recruitment/` feeds this gate. The gate is what
converts a pile of templates into an act the operator may or may not perform.

**Marker convention:** `<<UNFILLED: …>>`, `UNASSIGNED` and `[ ]` are markers, never data.

Baseline, recomputed by the author of this file:

| Basis | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified** |
| Instrument | aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, **593** files, at `C:/tmp/dt002/research/cpg-u1/tooling` — **verified** |
| Stale tree to avoid | this worktree's `research/cpg-u1/tooling`: **587** files, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` |

---

## 1. Why a gate, and why it is the thing that cannot be redone

§4A.1 item 5's exception depends on an **order of two acts**: the fee agreed in writing, then the
material released. Release is a one-way act. Once the frame template, §5.1–§5.4, the jurisdiction-family
list or the development-only registry has reached a person:

- it cannot be un-reached, so a fee agreed afterwards **can never** satisfy item 5 for that person;
  the payment falls back under items 2–3 and the person may hold no §4A.3 role;
- if the person turns out to be ineligible under §4A.2(b) — *"not have run CPG or seen any CPG output
  … before completing the frame"* — that ineligibility is likewise unrecoverable for them;
- the consequence for enumerator work is stated by §4A.1 itself: *"**enumerator work:** the frame is
  not independent (§20.18)"*, and §20.18 records that independent candidate selection *"rests on
  enumerator independence only"*.

There is no tool that detects a premature release. `check-personnel` sees a register, not a mailbox.
This checklist is the only control.

---

## 2. The textual question this gate had to settle

§4A.1 item 5, verbatim:

> 5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
>    material is released, **not contingent** on any result, finding or future engagement; the
>    agreement's SHA-256 is recorded;

**Two facts about the protocol text, both verified by exhaustive search of
`CPG_U1_PROTOCOL_004.md`:**

1. The phrase **"role material"** occurs **exactly once** in the entire protocol — at line 137, inside
   item 5. It is **never defined**.
2. The words **"release" / "released"** occur **exactly once** in the entire protocol — the same
   occurrence. There is no release procedure, no release log requirement, and no scoping language
   anywhere else to read item 5 against.

So the ordering question is genuinely open on the text, and it has two readings:

| Reading | Text it relies on | Rule it yields |
|---|---|---|
| **Permissive (per-person)** | Item 5 sits inside a **per-person** test: *"A person is **not independent** … if at any time in the exclusion period **the person**: … 5. — permitted exception: a fixed fee for the study role…"*. The whole of §4A.1 is a test applied to one person at a time, so "any role material" most naturally means *any role material released to that person*. Item 5's subject is "the study role" — singular, that person's role. | Each person's own agreement must precede their own release. A may receive material while B's agreement is still unsigned. |
| **Conservative (study-wide)** | Item 5 says *"**any** role material"*, not "their role material" and not "the material for that role". Taken at face value, "any" ranges over the study's role material as a whole, not over one person's copy of it. §4A.1's "Recorded per person" list is explicitly per-person; item 5's "any" is not qualified that way. | **Every** role-holder's fee agreement and declaration must be complete before **any** role material reaches **anyone**. |

**This gate adopts the conservative reading, restricted to the two enumerators, as its operating
rule.** Stated precisely:

> **ADOPTED RULE (GATE-R1).** No study material is released to Enumerator A or Enumerator B until
> **both** slots have: a signed §4A.1 independence declaration with all seven `DECLARATION_KEYS` =
> `"no"`; a fee position settled under §4A.1 item 5 (a signed fixed non-contingent agreement, hashed —
> or a recorded decision that there is no fee); the developing organisation's written no-relationship
> confirmation, hashed; and an `ELIGIBLE` verdict from
> `F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §2. A single unchecked box in §4 below blocks release
> to **both**.

### Why the conservative reading, given that the permissive one is textually the stronger of the two

The gate adopts the conservative rule **not** because the permissive reading is wrong. On the grammar,
the permissive reading is the better-supported one: item 5 is embedded in a sentence whose subject is
"the person". The gate adopts the conservative rule because of an **asymmetry of consequences**, and
because the conservative rule is safe under **both** readings:

1. **The conservative rule satisfies the permissive reading automatically.** If per-person is correct,
   study-wide compliance is a superset and nothing is lost but time. The converse fails: if study-wide
   is correct and the operator released to A first, item 5 is breached for A retrospectively and
   **cannot be cured** — A's payment is then an item-3 payment and A's frame contribution is
   non-independent.
2. **The cost of the conservative rule is bounded and known; the cost of being wrong is not.** The
   conservative rule costs sequencing delay, which `ENUMERATOR_DEADLINES.md` absorbs by keeping the
   whole schedule relative. Being wrong costs the frame's independence, which §20.18 identifies as the
   *sole* basis for believing the frame is unbiased.
3. **The two enumerators are not two independent cases.** They build **one** frame under **one**
   pre-registered partition. `B-partition/PARTITION_DESIGN.md` requires the partition rule and its
   sha256 to be fixed *before* material reaches either enumerator, precisely so the partition cannot
   move because of what someone found. Releasing to A while B is unsettled means the partition is in
   force for A and still contingent for B — and if B never signs, the operator must either re-partition
   (with A already enumerating) or run a one-enumerator frame whose partition was designed for two.
   That is a study-level defect independent of item 5.
4. **`RECRUITMENT_DELTA.md` §9 Q6 already reached the same instinct** — *"Two agreements must both be
   signed before **either** release."* — but recorded it as an open question for the owner. This gate
   turns that instinct into the operating default so the package is executable, without pretending the
   question is closed.

### This is an operating default, not a ruling — DR-8

> **The permissive reading exists and is not disposed of here.** Agent 1 of DEEPTECH-PARALLEL-008 is
> producing the formal **DR-8** ruling on the scope of *"before any role material is released"*. Until
> DR-8 is decided and recorded:
>
> - GATE-R1 above is the rule the operator runs, and it is safe under either outcome;
> - the gate is **not** evidence that the study-wide reading is correct;
> - if DR-8 rules **permissive**, GATE-R1 may be relaxed to per-person by a recorded decision citing
>   DR-8 — and the relaxation is recorded in §7 of this file, not applied silently;
> - if DR-8 rules **study-wide**, GATE-R1 is already compliant and §7 records that no change was needed;
> - **nothing here may be read as pre-empting DR-8.** This file states a conservative operating rule
>   and the reason for it. The ruling is Agent 1's.

---

## 3. What counts as "study material" for this gate

Because the protocol never defines "role material", the gate uses §4A.2's exhaustive receive-list as
the definition for enumerators, and treats anything on it as material:

**MATERIAL — release is gated.** §4A.2, verbatim: *"Enumerators receive only: public sources; the frame
template; §4A, §5.1–§5.4; the jurisdiction-family list; the development-only registry."* Concretely:

| Item | Gated |
|---|---|
| the frame template (the 22-column CSV template) | **yes** |
| §4A and §5.1–§5.4 of the protocol | **yes** |
| the jurisdiction-family list (`US-SEC` / `FR-SIRENE` / `BR-CNPJ` / `LEI-ONLY`) | **yes** |
| the **development-only registry** (frozen, at the registered `registry_sha256`) | **yes** |
| `ENUMERATOR_A_ALLOCATION.md` / `ENUMERATOR_B_ALLOCATION.md`, once the partition is filled in | **yes** — the filled allocation *is* the work instruction |
| `ENUMERATOR_SUBMISSION_PROCEDURE.md`, `ENUMERATOR_CONTAMINATION_RULES.md`, `ENUMERATOR_EVIDENCE_HANDLING.md` | **yes**, treated as material by this gate — they are role instructions even though they contain no company |

**NOT MATERIAL — releasable before the gate closes**, because none of it is a role instruction and none
of it contains a company or any CPG output:

| Item | Reason |
|---|---|
| `ENUMERATOR_ROLE_DESCRIPTION.md` | it is the invitation-level description; a candidate cannot consent to a role they may not read about |
| `ENUMERATOR_INDEPENDENCE_DECLARATION.md` (blank) | it is the instrument by which the gate is passed |
| `FEE_AGREEMENT_TEMPLATE.md` (blank) and the draft agreement | likewise |
| `people/INVITATION_PACKET.md` §1, §2.1, §3, §4, §6.1, §7 | invitation-level, and §6.1 tells the candidate what they will *not* be told |
| this file | it is the operator's own control |

`F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §0 states the same split: *"Steps 1–6 release nothing
except this package's own instruction papers, which contain no company and no CPG output."*

**Always prohibited, at every stage, gate or no gate** (§4A.2, §5.5, §5.5.3, §5.7.2): pilot results;
sizing output; quotas, per-class counts or per-class ratios; any CPG output including the development
pilot and the instrument check; the frame-sufficiency requirement itself; the other enumerator's rows,
partition content or findings. The gate does not authorise any of these. Passing the gate does not
unlock them.

**If in doubt, an item is material.** The gate is fail-closed on classification too.

---

## 4. THE GATE — every box must be checked before any release to either enumerator

**Fail-closed.** Any box left `[ ]`, any `<<UNFILLED>>`, any `no`, any `unknown`, any `FAIL`, any
`mismatch` **blocks release to BOTH enumerators**. There is no partial pass, no waiver line, and no
"release to A while B completes". A box is checked only against a **document the operator is holding**,
never against memory, an expectation, an email promise or a verbal assurance.

### 4.0 Prerequisites that are not about people

- `[ ]` **G0.1** The OSF registration is **published**, and the enumeration window has opened.
  Registration reference: `<<UNFILLED: registration_id>>`, published `<<UNFILLED: YYYY-MM-DD>>`.
  (`ENUMERATOR_ROLE_DESCRIPTION.md` §9: *"study material may not be released before R"*.)
- `[ ]` **G0.2** The development-only registry is **frozen** (§5.3) and the copy to be released hashes
  to the registered `registry_sha256`. Recorded hash: `<<UNFILLED: 64 lowercase hex>>`. Copy hashed
  today: `<<UNFILLED: 64 lowercase hex>>`. Equal: `<<UNFILLED: yes / no>>`.
- `[ ]` **G0.3** The **partition rule** and its sha256 are recorded, and the rule is fixed and
  independent of any finding (`B-partition/PARTITION_DESIGN.md` §1, tests T1 and T2).
  Rule identifier: `<<UNFILLED>>`; sha256: `<<UNFILLED: 64 lowercase hex>>`.
- `[ ]` **G0.4** The two `candidate_id` **prefixes** are recorded and are **disjoint, and neither is a
  prefix of the other** (`ENUMERATOR_AB_DIFFERENCES.md` §3).
  A's prefix: `<<UNFILLED>>`; B's prefix: `<<UNFILLED>>`.
- `[ ]` **G0.5** The instrument to be used is the **593-file** tree at aggregate
  `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` — **not** a 587-file tree.
  Recomputed today: `<<UNFILLED: 64 lowercase hex>>`; file count `<<UNFILLED: integer>>`.
- `[ ]` **G0.6** The protocol copy to be released (§4A, §5.1–§5.4) is from the file hashing to
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.
  Recomputed today: `<<UNFILLED: 64 lowercase hex>>`.

### 4.1 Per-slot, run twice — once for A, once for B

Both columns must be complete. **A complete A column with an incomplete B column is a BLOCK.**

| # | Condition | A | B |
|--:|---|---|---|
| G1.1 | A real, named person occupies the slot, recorded in the restricted register | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |
| G1.2 | `person_id` pseudonym assigned, matching `^[A-Za-z0-9_-]{1,64}$` | `UNASSIGNED` | `UNASSIGNED` |
| G1.3 | Signed §4A.1 independence declaration **in hand** (not promised, not verbal) | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |
| G1.4 | All **seven** `DECLARATION_KEYS` answered exactly `"no"` — see §5 for the list | `<<UNFILLED: 7/7 / count>>` | `<<UNFILLED: 7/7 / count>>` |
| G1.5 | No answer is `unknown`, blank, `n/a`, `probably not` or a qualified `no` (§4A.1: *"An unknown answer is not 'no'."*) | `<<UNFILLED: confirmed / breach>>` | `<<UNFILLED: confirmed / breach>>` |
| G1.6 | Fee position **settled**: a signed fixed non-contingent agreement exists and is hashed, **or** the operator has recorded that there is no fee for this slot | `<<UNFILLED: fee-hashed / no-fee / UNSETTLED>>` | `<<UNFILLED: fee-hashed / no-fee / UNSETTLED>>` |
| G1.7 | `study_fee_agreement_sha256` is **64 lower-case hex** or the JSON literal `null` — nothing else (`lib/personnel.mjs:38`) | `UNASSIGNED` | `UNASSIGNED` |
| G1.8 | If a fee: the agreement's **signature date is strictly earlier** than today, and no material has yet reached this person — verified against the **release log** | `<<UNFILLED: yes / n-a>>` | `<<UNFILLED: yes / n-a>>` |
| G1.9 | If a fee: fixed **and** not contingent on any result, finding or future engagement (`FEE_AGREEMENT_TEMPLATE.md` §4 term list checked) | `<<UNFILLED: yes / n-a>>` | `<<UNFILLED: yes / n-a>>` |
| G1.10 | Developing organisation's **written** no-relationship confirmation in hand and hashed; `organisation_confirmation_sha256` is 64 lower-case hex (`lib/personnel.mjs:39` — **no `null` path here**) | `UNASSIGNED` | `UNASSIGNED` |
| G1.11 | `F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §1.1 — §4A.2 (a)–(e) all PASS | `<<UNFILLED: PASS / FAIL>>` | `<<UNFILLED: PASS / FAIL>>` |
| G1.12 | `F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §2 slot verdict is `ELIGIBLE` | `<<UNFILLED: ELIGIBLE / not>>` | `<<UNFILLED: ELIGIBLE / not>>` |
| G1.13 | This person is **not** the operator (key custodian) — §4A.2(c) | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |
| G1.14 | This person holds **no other** §4A.3 role and will not become the reference adjudicator — §4A.2(d), §4A.3 | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |
| G1.15 | Register role string is the **literal** `enumerator` — not `enumerator-2`, not `enumerator-b` (verified: any other string is refused as `unknown role`) | `<<UNFILLED: confirmed>>` | `<<UNFILLED: confirmed>>` |
| G1.16 | Allocation document for this slot is filled from the recorded partition rule, with **no invented** partition, row target or prefix | `<<UNFILLED: yes / no>>` | `<<UNFILLED: yes / no>>` |

### 4.2 Pairwise and register-wide

- `[ ]` **G2.1** `F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §3 A-to-B pairwise verdict is
  *"A and B are relationally independent"*, with **all nine** cells answered and none `unknown`.
  Verdict: `<<UNFILLED>>`.
- `[ ]` **G2.2** §4A.1 item 6 run **pairwise against every other §4A.3 role-holder**, in both
  directions — see `ENUMERATOR_B_AUTHORIZATION.md` §5 for the full matrix. Result: `<<UNFILLED>>`.
- `[ ]` **G2.3** The §4 question-5 **coverage gap** (`ENUMERATOR_ELIGIBILITY_CHECK.md` §4) is closed and
  the closure **method is recorded**. Method: `<<UNFILLED: (i) / (ii) / (iii)>>`; residual the operator
  could not close: `<<UNFILLED: describe, or "none">>`.
- `[ ]` **G2.4** A and B are **distinct real people**, operator-attested, not one person holding two
  slots. Two pseudonyms for one human passes every structural check
  (`ENUMERATOR_ELIGIBILITY_CHECK.md` §3). Attested: `<<UNFILLED: yes / no>>`.
- `[ ]` **G2.5** A's and B's `person_id`s are **distinct, and neither is a prefix of the other**.
  Verified by running the checker: `person_id`s `P0` and `P0-EXTRA` produce **zero** errors from
  `checkPersonnelRegister` — the register does **not** catch near-collisions. This is an operational
  obligation. Checked by `ENUMERATOR_PACKET_VALIDATOR.mjs`. Result: `<<UNFILLED: distinct / collision>>`.
- `[ ]` **G2.6** `node cpg_u1_data.mjs check-personnel --personnel <register>.json` has been run
  against the **593-file** instrument, and prints **zero lines beginning `ERROR`**. `BLOCKED role …
  UNFILLED` lines for the five not-yet-recruited roles are expected at this stage
  (`ENUMERATOR_ELIGIBILITY_CHECK.md` §6) and do **not** block this gate. `ERROR` lines do.
  Output recorded at: `<<UNFILLED: path in the restricted register>>`; ERROR count:
  `<<UNFILLED: integer, must be 0>>`.
- `[ ]` **G2.7** `node ENUMERATOR_PACKET_VALIDATOR.mjs <candidate-packet-dir>` exits `0` for the
  candidate packet. Result: `<<UNFILLED: PASS / REFUSED, with the refusal reasons>>`.
- `[ ]` **G2.8** The **release log** exists, is append-only, and currently records **no** release of
  any §3-MATERIAL item to either slot. Log at: `<<UNFILLED>>`.

### 4.3 The single release decision

- `[ ]` **G3.1** Every box in 4.0, 4.1 and 4.2 is checked, with no `<<UNFILLED>>` remaining anywhere in
  this file above this line.
- `[ ]` **G3.2** The operator records the DR-8 position in force at release: `<<UNFILLED: DR-8 UNDECIDED, GATE-R1 conservative rule applied / DR-8 decided — cite the ruling>>`.
- `[ ]` **G3.3** Release to **A and B together**, in one act, and append to the release log: the exact
  item list, each item's sha256, the two `person_id`s, and the timestamp.
- `[ ]` **G3.4** Operator signature on this gate: `<<UNFILLED>>`; date `<<UNFILLED: YYYY-MM-DD>>`.

**GATE STATE: `BLOCKED`.** Every box above is unchecked. **No material may be released.**

---

## 5. The seven `DECLARATION_KEYS`, verified in the frozen code

Read from `C:/tmp/dt002/research/cpg-u1/tooling/lib/personnel.mjs:8-12` and confirmed by executing the
module (`DECLARATION_KEYS.length === 7`). Each must be the exact string `"no"` — lower-case, no
whitespace, a JSON string, not a boolean:

| # | Key | §4A.1 / §4A.2 item |
|--:|---|---|
| 1 | `employed_by_developing_organisation` | item 1 |
| 2 | `contract_or_work_for_developing_organisation` | item 2 |
| 3 | `payment_other_than_study_fee` | item 3 — the fee in item 5 is the only exception |
| 4 | `financial_interest_in_developing_organisation` | item 4 |
| 5 | `close_relationship_with_developer_operator_or_role_holder` | item 6 |
| 6 | `implemented_cpg_protocol_tooling_or_registry` | §4A.2(a) |
| 7 | `ran_or_saw_cpg_output` | §4A.2(b) |

`lib/personnel.mjs:37` enforces it: `if (d[k] !== 'no') errors.push(…'not independent')`. The
instrument's self-test walks all seven and asserts each `'yes'` is refused, and `test/selftest.mjs:833`
asserts that `'unknown'` is refused too — *"A-5: an unknown relationship answer is not independence"*.

**There is no item-5 declaration key.** Item 5 is recorded only as a hash. That is precisely why this
gate carries G1.6–G1.9: the one item-5 condition that is a fact about ordering has **no** machine
check anywhere in the instrument.

---

## 6. What this gate blocks, and what it cannot

### It blocks

1. Release of any §3-MATERIAL item to **either** enumerator while **either** slot is incomplete.
2. Release before the OSF registration is published and the enumeration window has opened (G0.1).
3. Release of a development-only registry copy that does not hash to the registered `registry_sha256`
   (G0.2) — which would make every contamination answer rest on the wrong list.
4. Release before the partition rule and its hash are fixed (G0.3) — closing the route by which a
   partition could move because of what an enumerator found.
5. Release with colliding or prefix-overlapping `candidate_id` namespaces (G0.4) or `person_id`s
   (G2.5) — both of which the instrument accepts and neither of which it detects.
6. Release against the **stale 587-file** tooling tree (G0.5).
7. Release while any declaration key is anything other than `"no"`, including `unknown` (G1.4, G1.5).
8. Release while a fee is intended but unsigned or unhashed, or hashed in upper case, or recorded as
   `"none"` / `""` / `"pending"` (G1.6, G1.7).
9. Release while the developing organisation's confirmation is missing — it has **no `null` path**,
   unlike the fee (G1.10).
10. Release while the A-to-B pairwise item-6 check, the wider pairwise matrix, or the question-5
    coverage gap is open (G2.1–G2.3).
11. Release while `check-personnel` prints any `ERROR` line (G2.6), or while
    `ENUMERATOR_PACKET_VALIDATOR.mjs` refuses the packet (G2.7).
12. **Piecemeal release** of any kind: there is no path through §4.3 that releases to one enumerator
    only.

### It cannot

- Verify that any declaration is **true**. `lib/personnel.mjs:3`: *"It cannot verify that declarations
  are true."*
- Verify that two `person_id`s denote two **people**. G2.4 is an attestation, not a check.
- Verify any §4A.1 item-6 relationship, in either slot or between the slots.
- Verify that the fee agreement was signed **before** release. G1.8 checks the operator's release log
  against the operator's own agreement — both of the operator's own making. This is the residual §4A.1
  calls *"procedural evidence, not proof"*.
- Detect a release that happened outside the log, or CPG output seen somewhere the operator cannot
  observe.
- Detect a **stale** declaration. See `ENUMERATOR_B_AUTHORIZATION.md` §6: `check-personnel` establishes
  only that each of the seven strings **is** `"no"` today in the register — not that it was true when
  signed, not that it is still true, and not that anything has been re-asked.

---

## 7. DR-8 disposition record — blank

| Field | Value |
|---|---|
| DR-8 status at the time this gate was last run | `<<UNFILLED: UNDECIDED / decided>>` |
| If decided: the ruling | `<<UNFILLED: per-person (permissive) / study-wide (conservative)>>` |
| If decided permissive: does the operator relax GATE-R1 to per-person? | `<<UNFILLED: yes — with reason / no, retain the conservative rule>>` |
| Recorded by | `<<UNFILLED>>` on `<<UNFILLED: YYYY-MM-DD>>` |

**Until this table is filled, GATE-R1 (study-wide across the two enumerators) is the rule in force.**
No relaxation is applied by anyone reading this file; a relaxation exists only once it is written in
this table, with a citation to Agent 1's DR-8 ruling.

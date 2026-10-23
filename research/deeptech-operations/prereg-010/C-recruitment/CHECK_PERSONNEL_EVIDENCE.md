# CHECK_PERSONNEL_EVIDENCE — four real runs of the frozen `check-personnel`, pasted verbatim

**Every output below was produced by running the command shown, against the frozen candidate
instrument, during this wave.** Nothing is reconstructed from memory or from a prior wave's notes.

`check-personnel` is a pure JSON structure check with no network, no chain and no compute cost; it
returns instantly. **No selftest, no mutation run and no rebuild was performed** — the 404-mutant
certification suite holds exclusive priority on expensive compute.

## The instrument under test

```
cwd:       C:/tmp/dt009-merge/tooling
aggregate: 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
files:     594
```

Recomputed in this wave, read-only:

```
$ node -e "import('./lib/aggregate.mjs').then(m=>{const r=m.toolingManifest('.');console.log('files',r.files.length);console.log('aggregate',r.aggregate);})"
files 594
aggregate 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
```

The stale 587-file tree (`640510…`) at any worktree's own `research/cpg-u1/tooling` was **not opened**.
It runs fine and lies.

Exit-code vocabulary, from `cpg_u1_data.mjs`: `EXIT.REFUSED = 1` (errors present), `EXIT.BLOCKED = 4`
(a role UNFILLED), `0` (structure accepted). `cmdCheckPersonnel` is `cpg_u1_data.mjs:750-757`.

---

## EXPERIMENT 1 — the deliverable `PENDING_PERSON_REGISTER.json` MUST be refused

This is the required demonstration. The register covers all eight roles with `PENDING_PERSON`
placeholders, and it is built to be refused.

### Command

```
$ cd C:/tmp/dt009-merge/tooling
$ node cpg_u1_data.mjs check-personnel --personnel C:/tmp/dt4-people/research/deeptech-operations/prereg-010/C-recruitment/PENDING_PERSON_REGISTER.json
```

### Output (verbatim, stderr and stdout interleaved as the terminal showed them)

```
  ERROR   operator.person_id missing or malformed
  ERROR   assignment 0 (enumerator): person_id missing or malformed
  ERROR   assignment 1 (enumerator): person_id missing or malformed
  ERROR   assignment 2 (reference-author): person_id missing or malformed
  ERROR   assignment 3 (reference-confirmer): person_id missing or malformed
  ERROR   assignment 4 (reference-adjudicator): person_id missing or malformed
  ERROR   assignment 5 (rater-1): person_id missing or malformed
  ERROR   assignment 6 (rater-2): person_id missing or malformed
  ERROR   assignment 7 (rating-adjudicator): person_id missing or malformed
ERROR: personnel register refused (9 error(s))
```

### Exit code

```
EXIT=1
```

### Reading it

- **9 errors: the operator plus all eight assignments.** Every `person_id` is a `<<PENDING_PERSON: …>>`
  token containing `:`, spaces and `,`, and over 64 bytes long, so it fails
  `PERSON = /^[A-Za-z0-9_-]{1,64}$/` (`lib/personnel.mjs:14`) several times over.
- **0 blockers, hence exit 1 and not 4.** All seven role strings in `INDEPENDENT_ROLES` appear at least
  once, so the `n === 0` blocker at `:25` never fires. The register is *refused* for incompleteness,
  not *blocked* for an unfilled role. That distinction matters: an operator who reads exit 4 as "worse
  than exit 1" has it backwards here.
- **No declaration error is listed, although not one of the 56 declaration answers is `"no"`.** `:32`
  executes `continue` after a malformed `person_id`, so `:33`–`:39` are never reached for any
  assignment. See experiment 4 for how far that goes.
- **Two enumerator rows both carrying `role: "enumerator"` produced no "must be held by exactly one
  person" error**, confirming `:26`'s exemption independently of the self-test.

**A register that PASSES is a register with eight real, declared, organisation-confirmed people in it.
This one must never pass. If it ever exits 0, it has been tampered with.**

---

## EXPERIMENT 2 — an identical fee-agreement hash in BOTH enumerator assignments PASSES

### The probe
A structural probe written to the session scratchpad, **not** into this package and **not** into the
instrument tree. Its `person_id` values are tokens (`PROBE_ENUM_A`, `PROBE_REF_AUTHOR`, …) that name no
person; its declarations, fee hashes (`aaa…`, `ccc…`) and organisation confirmations (`bbb…`) are
repeated single characters and are not real evidence. It exists only to exercise
`lib/personnel.mjs`.

Both enumerator assignments carry the **same** `study_fee_agreement_sha256` =
`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.

### Command and output

```
$ node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_shared_fee.json
personnel register: seven independent roles filled, mutually exclusive, operator in none, declarations complete
EXIT=0
```

### Reading it

**0 errors, 0 blockers, exit 0.** `lib/personnel.mjs:38` validates each hash's *shape* in isolation and
never compares one assignment's hash with another's. There is no cross-assignment comparison anywhere
in `checkPersonnelRegister`.

So the instrument cannot distinguish:

- two enumerators with **separate** fee agreements that happen to be recorded correctly, from
- two enumerators sharing **one** agreement — which makes each one's fee contingent on the other's
  performance, contrary to §4A.1(5)'s *"a fixed fee for **the study role**"* and to dt009
  `NON_DEPENDENCE_CONDITION.md` C-1.

**Only the operator's own hash comparison catches it.** Concretely: extract every
`study_fee_agreement_sha256` from the register and assert that the non-`null` values are pairwise
distinct. That assertion lives nowhere in the instrument and must be run by hand. It is recorded as a
gate item in `PROHIBITED_RELATIONSHIPS.md` §6 (Gap 3).

Note also the success message's wording: *"declarations complete"*. Every declaration in the probe is
the literal `"no"`, which is all `:37` asks. Complete is not true.

---

## EXPERIMENT 3 — the role string `enumerator-2` is REFUSED as `unknown role`

### The probe
Identical to experiment 2's, with the second enumerator row's `role` changed from `enumerator` to
`enumerator-2`.

### Command and output

```
$ node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_enumerator2.json
  ERROR   assignment 1 (enumerator-2): unknown role
ERROR: personnel register refused (1 error(s))
EXIT=1
```

### Reading it

- `INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is a frozen seven-member array. `enumerator-2` is not in
  it, so `:31` pushes `unknown role` and executes `continue`.
- **The role `enumerator` is still reported as filled** — `PROBE_ENUM_A` holds it — so no blocker
  fires and the exit is 1, not 4.
- **Only one error is reported.** Because `:31` also `continue`s, that assignment's collision,
  declaration, fee and organisation-confirmation checks are never reached either. `enumerator-2` is
  effectively an assignment the register asserts and the instrument declines to examine.

**The operational rule: both enumerator slots carry the literal role string `enumerator`.** Slot
identity is carried in a `$slot` key, which `checkPersonnelRegister` ignores (see below) and which
therefore costs no instrument byte.

---

## EXPERIMENT 4 — ONE malformed `person_id` hides nine further defects

This is the sharpest available demonstration that **a refusal list understates incompleteness**.

### The probe
Seven assignments, one per role. Assignment 0 is deliberately built with **four** independent defects
at once:

1. `person_id` = `PROBE ENUM A (malformed: contains spaces)` — malformed;
2. all seven declaration keys = `"yes"` — the opposite of what §4A.1 requires;
3. `study_fee_agreement_sha256` = `"not-a-hash"` — neither 64 hex nor `null`;
4. `organisation_confirmation_sha256` **absent entirely**.

That is 1 + 7 + 1 + 1 = **10 defects** in one assignment. The other six assignments are structurally
clean.

### Command and output

```
$ node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_understated.json
  ERROR   assignment 0 (enumerator): person_id missing or malformed
ERROR: personnel register refused (1 error(s))
EXIT=1
```

### Reading it

**Ten defects. One reported error.** `:32`:

```js
if (!PERSON.test(a.person_id ?? '')) { errors.push(`${where}: person_id missing or malformed`); continue; }
```

The `continue` skips `:33` (operator collision), `:34` (role collision), `:36-37` (the seven
`DECLARATION_KEYS`), `:38` (fee hash) and `:39` (organisation confirmation) for that assignment.

**Consequences an operator must internalise:**

1. **Fixing the reported errors can reveal more errors than were fixed.** Correcting one
   `person_id` in experiment 4's probe would turn 1 error into 9.
2. **The error count is not a progress metric.** It is not monotone in the register's completeness, so
   "we are down to 3 errors" says nothing about how close the register is to valid.
3. **`check-personnel` must be re-run after *every* amendment**, not only after amendments that were
   expected to matter.
4. Experiment 1's own output is an instance of this: 9 reported errors, 9 × 7 = **63** unreached
   declaration checks plus 9 unreached fee and 9 unreached confirmation checks behind them.

---

## What `checkPersonnelRegister` ignores, and why that is useful

`checkPersonnelRegister` (`lib/personnel.mjs:16-41`) reads exactly three things from the root:
`reg.schema` (`:18`), `reg.operator?.person_id` (`:19`) and `reg.assignments` (`:20`). Per assignment it
reads `role`, `person_id`, `declaration`, `study_fee_agreement_sha256` and
`organisation_confirmation_sha256`.

**Every other key, at the root and per assignment, is ignored.** So
`PENDING_PERSON_REGISTER.json`'s `$comment_*`, `$baseline`, `$slot`, `$authority`,
`$role_string_warning`, `$fee_hash_warning`, `$declaration_date`, `$deliverables_ref`,
`$confidentiality_ref`, `$replacement_ref`, `$role_count_note`, `$fingerprint_ordering_gate`,
`$confidentiality`, `$acceptance`, `$replacement`, `$material_release` and `$status` blocks:

- **cost no instrument byte** — the aggregate stays
  `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, because the register is not part
  of the tooling tree and the instrument was not modified;
- and are **not checked** by anything. They are recorded evidence in §4A.1's sense: *"procedural
  evidence, not proof."*

Verified by experiment 1: adding all of them changed nothing about the output.

## The four commands, in one place

```
cd C:/tmp/dt009-merge/tooling
node cpg_u1_data.mjs check-personnel --personnel C:/tmp/dt4-people/research/deeptech-operations/prereg-010/C-recruitment/PENDING_PERSON_REGISTER.json   # 9 errors, exit 1
node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_shared_fee.json                                                                     # 0 errors, exit 0
node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_enumerator2.json                                                                    # 1 error,  exit 1
node cpg_u1_data.mjs check-personnel --personnel <scratchpad>/probe_understated.json                                                                    # 1 error,  exit 1
```

The three probes live in the session scratchpad and are disposable. Only experiment 1's register is a
deliverable of this package.

## What was NOT run

- `test/selftest.mjs` — **not run.**
- Any mutation run — **not run.**
- Any clean rebuild — **not run.**
- Any network call, any credential, any CPG execution, any registration — **none.**
- The instrument tree was **not written to**; its aggregate is unchanged.

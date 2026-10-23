# ENUMERATOR_B_ROLE_AUTHORIZATION — standing authorisation of a second enumerator slot

**CLASSIFICATION: PREPARATION. This authorises a SLOT, never a person.** No person exists in this
file. **No one has been recruited, approached, engaged or named, and nothing here is a claim that
anyone has been.** No protocol byte and no instrument byte modified. Nothing registered, committed,
pushed or executed.

**Marker convention:** `<<PENDING_…>>` and `UNASSIGNED` are markers, never data.

**Filename note.** This file is deliberately *not* called `ROLE_AUTHORIZATION.md`: `.gitignore:77`
`ROLE_*.md` would swallow it. See §7.

## Baseline recomputed by the author of this file

| Basis | Value | How |
|---|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` | `git rev-parse origin/main` (a worktree's `main` is stale) |
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` |
| `research/cpg-u1` tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | `git rev-parse HEAD:research/cpg-u1` |
| **Instrument aggregate** | **`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files** | `toolingManifest()` run in-place at `C:/tmp/dt002/research/cpg-u1/tooling`, read-only; **recomputed after every command below and unchanged** |
| Stale tree deliberately NOT read as the instrument | this worktree's `research/cpg-u1/tooling`, **587** files, `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` | it runs, and returns a self-consistent **wrong** aggregate |

---

## 1. The protocol authority — §4A.3, verbatim

> - **Several enumerators are permitted; each holds no other role.**

and in the same role list:

> - **enumerator (≥ 1)**;

Those two lines are the whole authorisation. **No amendment, no waiver and no owner decision is
required to open a second enumerator slot.** What a second slot *does* require is the extra §4A.1
paperwork per person and the pairwise item-6 checks, which grow with the head count — and the four
conditions added by this package (§§3–6 of the wave: non-dependence, joint release, knowledge window,
work allocation).

§4A.3 also fixes two hard constraints that carry over to **both** slots, not just one:

- *"Every independent role is held by a different person, and no independent role is held by the
  operator."*
- *"An enumerator may not be the reference adjudicator."* — this binds Enumerator A **and**
  Enumerator B.

§19.3(3) names the prerequisite as *"enumerator(**s**) … **before the respective stage** … Seven
mutually exclusive independent persons."* Seven is a **minimum**; two enumerators make the roster
**eight independent persons plus the operator as a ninth human**.

---

## 2. The instrument permits it — three independent pieces of frozen evidence

### 2.1 The code itself: `lib/personnel.mjs:26`

```
26    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
```

This is the *only* cardinality rule in the register check, and `enumerator` is the *only* role
excluded from it. The exclusion is explicit, not incidental: every other role in
`INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is capped at one holder by this very line.

Context, `lib/personnel.mjs:23–27`:

```
23  for (const role of INDEPENDENT_ROLES) {
24    const n = assignments.filter((a) => a.role === role).length;
25    if (n === 0) blockers.push(`role ${role} is UNFILLED`);
26    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
27  }
```

### 2.2 The frozen instrument's own passing self-test: `test/selftest.mjs:829`

```
829  { const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' }); ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
```

The assertion is `chk(r).errors.length === 0` — **zero errors**. This is not documentation about the
instrument; it is a test the frozen instrument ships and passes, so the permission is part of what the
instrument is certified to do.

Immediately beside it, `test/selftest.mjs:830`, the **contrast case**:

```
830  { const r = personnel(); r.assignments.push({ ...r.assignments[4], person_id: 'SYN-P-R1B' }); ok(chk(r).errors.some((e) => e.includes('exactly one')), 'a second rater-1 refused'); }
```

`assignments[4]` is `rater-1` (index 4 of `INDEPENDENT_ROLES`). A second `rater-1` is an **error**; a
second `enumerator` is **not**. The pair `:829`/`:830` is the instrument stating the asymmetry in its
own voice, and it maps exactly onto `:26`.

### 2.3 Independently confirmed here: an eight-person register is accepted

Run against the frozen instrument at `C:/tmp/dt002/research/cpg-u1/tooling`, on a synthetic
`SYN-`-prefixed register (the instrument's own fixture shape, **no person, no real value**):

```
assignments: 8  distinct people: 8  + operator
errors:    0  []
blockers:  0  []
```

**Verified: 0 errors, 0 blockers on eight independent persons plus the operator.** The aggregate was
recomputed afterwards and is unchanged at `f7699f05…`, 593 files.

---

## 3. THE ROLE STRING IS THE LITERAL `enumerator` — FOR BOTH

**Both enumerators carry `"role": "enumerator"`.** There is no `enumerator-2`, no `enumerator-a`, no
`enumerator/B`. `INDEPENDENT_ROLES` (`lib/personnel.mjs:6`) is a frozen closed list:

```
['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator', 'rater-1', 'rater-2', 'rating-adjudicator']
```

and `lib/personnel.mjs:31` rejects anything else:

```
31    if (!INDEPENDENT_ROLES.includes(a.role)) { errors.push(`${where}: unknown role`); continue; }
```

**Demonstrated, not assumed.** Taking the accepted eight-person register above and changing only the
second enumerator's role string to `enumerator-2`:

```
errors:   ["assignment 7 (enumerator-2): unknown role"]
blockers: []
```

Note what else that single character change does: `blockers` is `[]` only because the *first*
enumerator still carries the literal string. Had **both** been renamed, `:25` would also have raised
`role enumerator is UNFILLED`. So the mistake is doubly fatal and is caught either way — but it is
caught as a *malformed register*, at a point where re-issuing declarations may be expensive.
**Write the literal string.**

**Where A and B are distinguished instead.** The register distinguishes them by `person_id`
(`^[A-Za-z0-9_-]{1,64}$`, `:14`) and by the pseudonym used in study artifacts (§4A.1's recording
block). `lib/personnel.mjs:34` makes two identical `person_id`s a `ROLE COLLISION` regardless of role,
so two enumerators are necessarily two distinct persons in two distinct assignments — which is what
forces 2 × 7 declaration answers and 2 organisation confirmations (DR-8 Rule A2). Anything else the
study needs to say about the split — jurisdiction families, `candidate_id` prefix — goes in
**unknown keys the instrument ignores** (see §5), not in the role string.

---

## 4. What this authorisation does NOT authorise

| Not authorised here | Where it lives |
|---|---|
| Onboarding any particular person | `eight-person/F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` — **no person exists** |
| Release of any study material | `MATERIAL_RELEASE_JOINT_GATE.md` (this package) — fail-closed, every box unchecked |
| Any economic relationship between A and B | `NON_DEPENDENCE_CONDITION.md` (this package) — **forbidden**, and not mechanically checkable |
| Telling either enumerator anything | `KNOWLEDGE_WINDOW_RULE.md` (this package) — and see its §4 conflict flag |
| Assigning work to a person | `ENUMERATOR_WORK_ALLOCATION.md` (this package) — partition fixed, persons unfilled |
| A third enumerator | Permitted by §4A.3 on the same authority; **not** covered by this package's arithmetic (`eight-person/` prices two) |

---

## 5. The register fields for the split, and why they cost no instrument byte

`checkPersonnelRegister` validates `schema`, `operator.person_id` and the `assignments` array, and
**ignores every unknown root-level key and every unknown per-assignment key** — read at
`lib/personnel.mjs:16–41`; there is no key allow-list and no `additionalProperties` rejection
anywhere in the function. So the following are accepted with **no change to the instrument and no
change to the aggregate** (names are ours; every value is a marker):

```
"role": "enumerator",
"$slot": "ENUMERATOR_A",
"$jurisdiction_families": ["US-SEC", "LEI-ONLY"],
"$candidate_id_prefix": "<<PENDING_DECISION: see ENUMERATOR_WORK_ALLOCATION.md>>",
"person_id": "<<PENDING_PERSONNEL: ENUMERATOR_A — NO PERSON RECRUITED>>"
```

**Caveat the operator must weigh, and it is not this file's to settle.** `$`-prefixed keys are ours,
not the protocol's. They are safe for the *register check*, but the register is an input to other
frozen code — `lib/assignment.mjs:35` calls `checkPersonnelRegister` on it — and the §4A.3
person-to-label assignment **fingerprint** is published (§12.1). If that fingerprint is taken over
the register file's bytes, then our extra keys are inside the published fingerprint. **DECISION
REQUIRED:** whether these annotation keys belong in the fingerprinted register or in a separate
restricted operator file. Recommended: a separate operator file, with the register kept to the
protocol's own fields, because the annotations disclose the partition and the partition is exactly
what §4A.2 keeps from each enumerator.

---

## 6. Standing authorisation — the operative text

> **AUTHORISED (slot).** Under §4A.3 (*"Several enumerators are permitted; each holds no other
> role"*; *"enumerator (≥ 1)"*), CPG-U1 may engage **two** enumerators, designated
> **ENUMERATOR_A** and **ENUMERATOR_B**. Both are entered in the restricted personnel register with
> the literal role string `enumerator`. Each holds no other §4A.3 role, neither is the operator, and
> neither may be the reference adjudicator.
>
> **NOT AUTHORISED (persons).** No person is authorised by this record. Both slots are
> `<<PENDING_PERSONNEL>>`. Onboarding of either is gated on, cumulatively and without exception:
> `NON_DEPENDENCE_CONDITION.md`, `MATERIAL_RELEASE_JOINT_GATE.md`, `KNOWLEDGE_WINDOW_RULE.md`,
> `ENUMERATOR_WORK_ALLOCATION.md`, and a clean `check-personnel` run.
>
> Authorised by: `<<PENDING_PERSONNEL: OPERATOR — NO PERSON ASSIGNED>>`
> Date: `<<PENDING_DATE — NOT AUTHORISED>>`

---

## 7. `.gitignore` hazard actually encountered

`git check-ignore -v` was run on every filename in this package. Result: **none of the six
deliverables is ignored.** But the check caught a live trap:

```
$ git check-ignore -v research/deeptech-operations/prereg-009/F-enumerators/ROLE_DESCRIPTIONS.md
.gitignore:77:ROLE_*.md    research/deeptech-operations/prereg-009/F-enumerators/ROLE_DESCRIPTIONS.md
```

`ROLE_*.md` anchors at the **start of the basename**, so `ENUMERATOR_B_ROLE_AUTHORIZATION.md` (this
file) passes while a required package file named `ROLE_DESCRIPTIONS.md` would be **silently dropped**.
Any package that owes a `ROLE_DESCRIPTIONS.md` must either rename it (e.g.
`ENUMERATOR_ROLE_DESCRIPTIONS.md`) or have `.gitignore:77` narrowed by the owner. Recorded, not fixed
— `.gitignore` is outside this stream's write scope.

---

## 8. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | The role string is written as `enumerator-2` | Low likelihood, high cost | §3; caught by `check-personnel` as `unknown role`, but only after declarations may already be dated |
| R-2 | Annotation keys land inside the published §12.1 fingerprint and disclose the partition | Medium | §5 — owner decision pending; recommended: separate operator file |
| R-3 | A second enumerator is added **after** the first has declared, invalidating the first's item-6 answer (line 145) | High if unmanaged | Fix the roster at **eight** before any declaration is signed; `MATERIAL_RELEASE_JOINT_GATE.md` §3 box 1 |
| R-4 | The slot is read as a person | Low | Every person field is `<<PENDING_PERSONNEL…>>`, and `PENDING_PERSONNEL_REGISTER.json` is built to be **refused** |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1, §4A.2, §4A.3, §19.3, §20.18, §22 row 31, §23
- `C:/tmp/dt002/research/cpg-u1/tooling/lib/personnel.mjs` (whole file), `lib/aggregate.mjs`,
  `lib/assignment.mjs`, `lib/schema.mjs`, `cpg_u1_data.mjs` `cmdCheckPersonnel` + `EXIT`
- `C:/tmp/dt002/research/cpg-u1/tooling/test/selftest.mjs:813–838`
- `C:/tmp/dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` (rules A1–A7)
- `C:/tmp/dt008-prereg/C-enumerators/ENUMERATOR_B_AUTHORIZATION.md`, `MATERIAL_RELEASE_GATE.md`
- `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md`

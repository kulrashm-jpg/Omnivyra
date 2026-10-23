# NON_DEPENDENCE_CONDITION — Enumerator A and Enumerator B must not become financially or contractually dependent on one another

**CLASSIFICATION: PREPARATION. A condition on slots, not a finding about persons.** No person exists.
**No one has been recruited, approached, engaged or named.** No fee figure, declaration, signature or
date appears anywhere below. No protocol byte and no instrument byte modified.

**Marker convention:** `<<PENDING_…>>` and `[ ]` are markers, never data.

Baseline: `origin/main` `33bceb1f919113c622587fa7c6403a0d4596bbad`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`, recomputed unchanged after every command.

---

## 0. The one sentence this file exists to make operational

> **Enumerator A and Enumerator B must not be, and must not become, financially or contractually
> dependent on one another for the duration of the §4A.1 exclusion period.**

This is **new**. It is not in §4A.1, it is not in §4A.2, and the earlier waves did not cover it:

- **§4A.1 items 1–4** are exclusively about the **developing organisation** — *"is or was employed by
  the developing organisation"*, *"any contract, engagement or other work … **for it**"*, *"received
  any payment or benefit **from it**"*, *"holds equity … **in it**"*. All four run **A → developing
  organisation**. None runs **A → B**.
- **§4A.1 item 6** is the only clause that runs between *persons*, and it is **relational**, not
  economic: spouse or partner, family member, household member, or a current or former **direct
  reporting relationship**.
- **DR-8 rule A1** settled that item 6 applies **between** co-enumerators. That closes the relational
  channel. It leaves the **economic** channel open: two strangers, neither related to the other, one
  of whom sub-contracts the other, are fully compliant with §4A.1 as written and with DR-8 A1.
- **DR-8 rule A3** recommended separate fee agreements, but on a *disclosure* ground ("a shared
  agreement … would leak the pairing"). It did not state a non-dependence requirement, and did not
  forbid the A → B economic relationships below.

**Why it matters, in the protocol's own terms.** §20.18 records that independent candidate selection
*"rests on enumerator independence only"*, and §22 row 31 names *"Enumerator independence (§4A.2,
§19.3)"* as the sole control against a globally biased frame. Two enumerators produce a frame carrying
**two distinct `enumerated_by` values** (`FRAME_COLUMNS`, `lib/schema.mjs:32`), which *looks* like two
independent judgements. If B is economically dependent on A, that appearance is false: one economic
will authored both halves, and the frame's apparent redundancy is worth nothing. The register would
still pass `check-personnel` with 0 errors, because nothing in `lib/personnel.mjs` looks at A-to-B
economics.

---

## 1. THE BINDING LIMIT — stated first, because everything below rests on it

`lib/personnel.mjs`'s own file header, verbatim (lines 1–3):

```
// Personnel register checks (CPG_U1_PROTOCOL_004 §4A). The register itself is restricted; the tooling checks its
// STRUCTURE: every independent role filled, seven roles mutually exclusive, the operator in none, every §4A.1
// declaration answered "no", and the §4A.1 evidence fingerprints present. It cannot verify that declarations are true.
```

> **"It cannot verify that declarations are true."**

§4A.3 repeats it: *"Tooling: `check-personnel` verifies structure … **It cannot verify that
declarations are true.**"* §4A.1 repeats it again: *"These are **procedural evidence, not proof**."*
And §23 (protocol line 1055) already records enumerator independence as **"Not cryptographic"**;
§20 limitation 23 (line 987) as *"rests on declarations and organisational confirmation … not on
verifiable proof."*

**Therefore: NONE of the five conditions in §2 is mechanically checkable.** Not one. There is no tool,
and there cannot be one, that detects that B invoices A. Every condition below is an **operator
check against documents plus a warranty from each declarant**, and the register records that the
check was performed — never that it was true. Any reader of the registration must be told this in
these words, and the registration narrative should say so (carrying forward DR-8's third open
question, recommended: yes).

The **one** thing that is mechanically visible is condition C-1 — see C-1 below — and it
is visible only as a hash comparison the **operator** performs, not as a check the instrument runs.

---

## 2. The five conditions, concretely

### C-1 — Separate fee agreements, never one shared agreement

**The rule.** If either enumerator is paid, each has their **own** written fee agreement with the
study, with its **own** SHA-256, and the two hashes **differ**. A single instrument covering both
enumerators is forbidden. If either is unpaid, that is recorded as `study_fee_agreement_sha256: null`
— a deliberate no-fee engagement, not an omission.

**Protocol basis.** §4A.1 item 5 is the *permitted exception* that cures item 3 for **the person**;
the recording block records *"the fee-agreement hash (**or none**)"* **per person**. The frozen field
is per assignment, and `null` is explicitly allowed — `lib/personnel.mjs:38`:

```
38    if (a.study_fee_agreement_sha256 !== null && !HEX64.test(a.study_fee_agreement_sha256 ?? '')) errors.push(`${where}: study_fee_agreement_sha256 must be 64 hex or null (no fee)`);
```

and the instrument's own self-test confirms the `null` branch — `test/selftest.mjs:835`: *"no study
fee (null) permitted"*, asserting zero errors.

**Two independent reasons a shared agreement fails.**

1. **Dependence.** One instrument binding both enumerators makes their consideration, their term and
   their termination a single economic object. Each then has a stake in the other's performance: if
   the agreement is severable only as a whole, A's payment depends on B delivering. That is the
   dependence this file forbids, in its purest form.
2. **Disclosure — and this one is visible on the face of the register.** A shared agreement has one
   hash, so the **same 64-hex string appears in both assignments**. §4A.1 makes the register
   *restricted* precisely so that *"a pseudonymous ID is used in study artifacts"*; a duplicated
   `study_fee_agreement_sha256` tells anyone with register access — including either enumerator, if
   they see their own row and the hash of their own agreement — that a **second person is party to
   the same instrument**. It thereby discloses the pairing that DR-8 Rule A5 exists to withhold, and
   it does so without anyone deciding to disclose it.

**Operator check (the only quasi-mechanical one in this file).**

```
[ ] C-1a  Two distinct agreement documents exist, or `null` is recorded, for each enumerator.
[ ] C-1b  sha256(agreement_A) != sha256(agreement_B)   — compute both; compare the strings.
[ ] C-1c  Neither agreement names, references, incorporates by reference, or is conditional on the
          other enumerator, that enumerator's work, or any second enumerator.
[ ] C-1d  Neither fee is contingent on "any result, finding or future engagement" (§4A.1 item 5) —
          including on the *other* enumerator's output, row count, or agreement with this one.
```

C-1b is a string comparison the operator performs. It is **not** performed by `check-personnel`:
`lib/personnel.mjs` validates each `study_fee_agreement_sha256` in isolation and never compares two,
so two assignments carrying the identical hash produce **0 errors**. Recorded as a defect of the
check, not of the protocol.

### C-2 — No sub-contracting, in either direction

**The rule.** Neither enumerator may engage the other — as sub-contractor, delegate, assistant,
reviewer, translator, research aide or under any other description — for the study work or for any
other work during the exclusion period. Neither may hold a right of direction, approval or sign-off
over the other's output.

**Why the protocol does not already say this, and why it must be said.** §4A.1 item 2 excludes a
person who *"has or had any contract, engagement or other work (paid or unpaid) **for it**"* — "it"
being the developing organisation. A contract **A → B** is outside item 2 entirely. Meanwhile §4A.2(d)
(*"hold no other §4A.3 role"*) does not help either: B sub-contracting to A holds exactly one role.
Yet the effect is precisely the one §4A.3's mutual-exclusion rule forbids — *"Every independent role is
held by a different person"* — because the work of two roles is being **performed under one direction**
while the register shows two persons. Sub-contracting is role collision that `lib/personnel.mjs:34`
cannot see.

Note also the ordinary-language trap: a sub-contract is also a **direct reporting relationship**, which
*is* item 6 — so under DR-8 Rule A1 a **current** sub-contract is already excluded. C-2 is therefore
belt-and-braces for the current case, and load-bearing for the cases item 6 misses: a one-off
engagement with no reporting line, a professional-services invoice, a partnership rather than a
hierarchy.

```
[ ] C-2a  Neither enumerator engages the other for the study work.
[ ] C-2b  Neither engages the other for any other work during the exclusion period.
[ ] C-2c  Neither holds approval, direction or sign-off rights over the other's rows.
[ ] C-2d  Neither has delegated any part of their own assignment to any third party either
          (a shared sub-contractor is dependence by another route, and is worse: it is a single
          undisclosed author of both halves).
```

C-2d is the non-obvious one. A and B each independently hiring the *same* research assistant would
satisfy C-2a–c and destroy the frame's independence completely. It is checkable only by asking.

### C-3 — Neither pays nor employs the other

**The rule.** No employment, no salary, no consulting fee, no honorarium, no expense reimbursement, no
in-kind benefit, no loan and no guarantee flows between the two enumerators during the exclusion
period. Neither is the other's employer, partner in a firm sharing profits, landlord, or creditor on
terms that give leverage.

**Basis.** This is item 3's logic (*"received any payment or benefit from it"*) transposed from the
A → developing-organisation axis onto the A → B axis, where the protocol does not place it. The reason
to transpose it is §20.18: the frame's independence rests on enumerator independence *only*, so any
lever one enumerator holds over the other is a lever over the frame.

```
[ ] C-3a  No employment relationship, current or during the exclusion period, in either direction.
[ ] C-3b  No payment, fee, honorarium, reimbursement or in-kind benefit in either direction.
[ ] C-3c  No loan, guarantee, security or debt in either direction.
[ ] C-3d  Neither is a partner, member or shareholder in an entity through which the other is
          remunerated.
```

### C-4 — No shared economic interest in a common entity

**The rule.** The two enumerators do not share a material economic interest in the same entity where
that interest could be affected by the study — including being co-owners of the same firm, co-partners,
or both remunerated by a common third party for this work.

**Why it is separate from C-3.** C-3 catches A → B flows. C-4 catches A → X ← B: two people with no
dealings between them, both dependent on the same X. If X is the developing organisation, §4A.1
items 1–4 already exclude both. If X is anyone else, nothing in the protocol looks. C-4 is the
weakest-grounded of the five conditions — it is an extension, not a reading — and it is flagged as
such: **the owner may reasonably scope it to "material" interests only, or drop it.** It is included
because it is the gap C-2d and C-3d point at from two directions.

```
[ ] C-4a  No common entity remunerates both for this work.
[ ] C-4b  No co-ownership or co-partnership between them in an entity whose position the study
          could affect.
```

### C-5 — §4A.1 item 6's relational exclusions, applied **between** them

**The rule.** Each enumerator's item-6 answer covers **the other enumerator**: not a spouse or
partner, not a family member, not a household member, and no current or former direct reporting
relationship — in either direction.

**Basis, and it needs no amendment.** DR-8 Rule A1 established the reading; this file only records
that C-5 is a **precondition of the non-dependence condition**, because a household member is
financially entangled by default. The decisive point is that the **frozen declaration key already asks
the broader question** — `lib/personnel.mjs:10`:

```
'close_relationship_with_developer_operator_or_role_holder',
```

"role_holder", **unqualified**. A person answering `"no"` to that key has, on the form as implemented,
denied a close relationship with *any* role holder, co-enumerator included. And
`lib/personnel.mjs:37` requires the literal string `"no"` for every assignment:

```
37    for (const k of DECLARATION_KEYS) if (d[k] !== 'no') errors.push(`${where}: declaration ${k} must be "no" (got ${JSON.stringify(d[k])}) — not independent`);
```

with protocol line 145 closing the escape: *"**An unknown answer is not 'no'**."* The instrument's own
self-test confirms the refusal of a non-`no`: `test/selftest.mjs:833`, *"A-5: an unknown relationship
answer is not independence"*.

**How C-5 is answered without either enumerator learning the other's identity.** By DR-8 Rule A5,
unchanged and adopted here: each declarant gives the **operator alone** a relational schedule; each
answers item 6 as a warranty ("I have no relationship of the kinds in item 6 with any person engaged
in this study in any §4A.3 role, and the schedule I have supplied is complete"); the operator performs
the pairwise comparison and records `pairwise_item6_check` as an unknown register key the instrument
ignores. C-1 to C-4 are answered the same way: **schedule to the operator, warranty from the
declarant, comparison by the operator.**

```
[ ] C-5a  Each enumerator's relational schedule is held by the operator.
[ ] C-5b  The operator's pairwise comparison covers the A–B pair specifically.
[ ] C-5c  Each item-6 answer is the literal string "no", and is dated on or after the date the
          other enumerator became a role holder (line 145).
```

---

## 3. The non-dependence attestation block

Recorded as a root-level key in the restricted register. `checkPersonnelRegister` ignores unknown
root-level keys (`lib/personnel.mjs:16–41` — no allow-list, no `additionalProperties` rejection), so
this costs **no instrument byte and no aggregate change**. Present in
`PENDING_PERSONNEL_REGISTER.json` with every value a marker:

```
"non_dependence_attestation": {
  "between": ["ENUMERATOR_A", "ENUMERATOR_B"],
  "separate_fee_agreements":                         "<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "distinct_fee_agreement_hashes_confirmed":         "<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "no_subcontracting_either_direction":              "<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "neither_employs_nor_pays_the_other":              "<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "no_shared_economic_interest_in_a_common_entity":  "<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "item6_relational_exclusions_applied_between_them":"<<PENDING_ATTESTATION — NOT PERFORMED>>",
  "performed_by": "<<PENDING_PERSONNEL: OPERATOR — NO PERSON ASSIGNED>>",
  "performed_on": "<<PENDING_DATE — NOT PERFORMED>>"
}
```

**This block is an operator attestation and must be described as one.** It is not evidence that the
conditions hold. Its only force is that, if a condition is later found false, §4A.1's consequence
applies in terms: *"**enumerator work:** the frame is not independent (§20.18)"*, and the finding is
published.

---

## 4. Consequence if a condition is breached

§4A.1, verbatim: *"If a declaration is later found false, that person's work is non-independent, and
the finding is published: … **enumerator work:** the frame is not independent (§20.18)."*

The frame is **single and frozen** (CPG-042 B-1). There is no partial remedy: a breach found after the
commitment does not invalidate one enumerator's rows and leave the other's standing, because
`frame_hash` binds all rows as one object (`hashRecords(frame, 'candidate_id')`,
`lib/canonical.mjs:21`) and §20.18 attaches independence to *the frame*. **The breach is
study-level.** That is the reason the conditions are checked **before** release (see
`MATERIAL_RELEASE_JOINT_GATE.md`) and not audited afterwards.

---

## 5. What remains open for the owner

| # | Open question | Recommendation |
|---|---|---|
| OQ-1 | Should the non-dependence condition be recorded as a **reading** of §4A.1 (like DR-8 A1) or as an **added operational rule**? It is not a reading: no §4A.1 clause runs A → B. | Record it as an **added operational condition** in the decision log, and say so. Do not present it as protocol text. |
| OQ-2 | Is C-4 (shared economic interest in a common entity) in or out? It is the one condition with no textual anchor. | In, scoped to "material and capable of being affected by the study". Owner may drop it; record the choice. |
| OQ-3 | Does the exclusion period for A→B dependence run for the full §4A.1 period (*first repository commit … until publication of results*)? That period is long and partly historical. | Prospective conditions (C-2, C-3, C-4) from engagement to publication; relational C-5 for the full §4A.1 period, since item 6 already says "current or former". |
| OQ-4 | Whether the registration narrative discloses that all of this is operator attestation. | **Yes.** Carried forward from DR-8's third open question. Without it a reader will mistake `non_dependence_attestation` for a verified fact. |

---

## 6. Risks

| # | Risk | Severity | Mitigation / residual |
|---|---|---|---|
| R-1 | A shared fee agreement is signed because it is administratively easier, duplicating the hash in both assignments | Medium likelihood, high cost | C-1; and note `check-personnel` gives **0 errors** on duplicate hashes, so only the operator's C-1b comparison catches it |
| R-2 | A→B dependence exists and is simply not declared | **Unmitigable** | `lib/personnel.mjs` header: *"It cannot verify that declarations are true."* Residual, disclosed, not smoothed. §4A.1's published-finding consequence is the only deterrent |
| R-3 | A and B share a sub-contractor (C-2d) | Low likelihood, total cost — one undisclosed author of both halves | C-2d asks it explicitly; nothing detects it |
| R-4 | The condition is presented as protocol text and later read as an amendment | Medium | OQ-1: record it as an added operational condition, in the decision log, not in the protocol |
| R-5 | Conditions checked once at onboarding, then a dependence arises mid-study | Medium | Re-attest on any roster change (DR-8 A5 step 6) and at the held-out commitment; **no tool prompts for this** |

## Sources read (all read-only)

- `research/cpg-u1/CPG_U1_PROTOCOL_004.md` §4A.1 (lines 125–150), §4A.2, §4A.3, §19.3(3), §20.18,
  §20 limitation 23, §22 row 31, §23
- `C:/tmp/dt002/research/cpg-u1/tooling/lib/personnel.mjs` (whole file, incl. header lines 1–3),
  `lib/canonical.mjs`, `lib/schema.mjs` `FRAME_COLUMNS`
- `C:/tmp/dt002/research/cpg-u1/tooling/test/selftest.mjs:813–838`
- `C:/tmp/dt008-prereg/A-decisions/DR8_OPERATIONAL_RULE.md` (rules A1, A2, A3, A5)
- `C:/tmp/dt008-prereg/C-enumerators/FEE_AGREEMENT_TEMPLATE.md`, `MATERIAL_RELEASE_GATE.md`

# FEE_AGREEMENT_TEMPLATE — the §4A.1 item 5 fixed-fee agreement, blank

**Classification: PREPARATION. This is a blank template.** No person exists in it, no fee figure
exists in it, no signature exists in it. **No one has been recruited, approached or named.** Every
person-specific field below is an unfilled marker and stays one until a real operator fills it with a
real agreement outside this repository.

**Marker convention** (inherited from `eight-person/F-recruitment/`): `<<UNFILLED: …>>` and
`UNASSIGNED` are markers, never data. A filled-looking value in this file would be a fabrication.

Baseline, recomputed by the author of this file:

| Basis | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified** |
| Instrument | tooling aggregate `<NEW_AGG>`, **<NEW_N>** files, read at `C:/tmp/dt002/research/cpg-u1/tooling` — **verified** via `lib/aggregate.mjs` `toolingManifest()` |
| Do **not** read the instrument from this worktree | `research/cpg-u1/tooling` here is a **stale 587-file tree**, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` — not the registered instrument |

**Relationship to what already exists.** `eight-person/F-recruitment/ENUMERATOR_INDEPENDENCE_DECLARATION.md`
§C already records *the four facts about* the fee (is there one; its hash; the signature date; the
fixed/non-contingent confirmation). It does **not** contain the agreement whose hash that field
records. This file is that missing document. §C stays the register-facing record; this file is the
instrument that gets hashed.

---

## 1. The clause this document exists to satisfy

§4A.1 item 5, verbatim, quoted in full because every operative word in it is a condition:

> 5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
>    material is released, **not contingent** on any result, finding or future engagement; the
>    agreement's SHA-256 is recorded;

Item 5 is an **exception to items 2 and 3**, not a free-standing permission. Read against the list it
sits in:

- item 2 excludes *"any contract, engagement or other work (paid or unpaid) for it, **other than the
  engagement in item 5**"*;
- item 3 excludes *"any payment or benefit from it, **other than the fee in item 5**"*.

So a fee that fails **any** of item 5's conditions is not a permitted fee with a defect. It is an
ordinary payment and an ordinary engagement, and items 2 and 3 then make the person **not
independent, and they may hold no role in §4A.3**. There is no partial credit. The conditions:

| # | Condition | Where it is discharged below |
|--:|---|---|
| C1 | the fee is **fixed** | §3 clause 2, §5 row 1 |
| C2 | agreed **in writing** | this document, signed — §3 |
| C3 | agreed **before** any role material is released | §3 clause 5, and `MATERIAL_RELEASE_GATE.md` |
| C4 | **not contingent** on any result, finding or future engagement | §3 clause 3, §5 row 3 |
| C5 | the agreement's **SHA-256 is recorded** | §6 |

C3 is the one condition this document cannot discharge by itself, because it is a fact about the
*order of two acts*. It is discharged by the gate in `MATERIAL_RELEASE_GATE.md`, which is the
critical-path artefact of this package.

---

## 2. It binds exactly one named role

**One agreement, one role, one person.** This template is instantiated once per role-holder. It is
never used as a joint agreement covering two people, and never as a single agreement covering two
roles held by one person — §4A.3 makes the seven independent roles mutually exclusive, so a two-role
agreement would describe an arrangement the protocol forbids.

| Field | Value |
|---|---|
| Role this agreement binds — exactly one of the §4A.3 independent roles | `<<UNFILLED: one of enumerator / reference-author / reference-confirmer / reference-adjudicator / rater-1 / rater-2 / rating-adjudicator>>` |
| Register role string, exactly as `INDEPENDENT_ROLES` spells it (`lib/personnel.mjs:6`) | `<<UNFILLED: copy the literal string. For either enumerator this is the literal `enumerator` — never `enumerator-2`, which the checker refuses as `unknown role`>>` |
| Slot label used in this package (operational only; not a register value) | `<<UNFILLED: Enumerator A / Enumerator B / other>>` |
| `person_id` — pseudonym, the **only** identifier permitted in any study artefact, `^[A-Za-z0-9_-]{1,64}$` (`PERSON`, `lib/personnel.mjs:14`) | `UNASSIGNED` |
| Legal name of the role-holder — **restricted register only; never in a study artefact and never in this repository** | `<<UNFILLED: recorded only in the operator's restricted register>>` |
| Developing organisation, as §4A.1 defines it ("the entity that develops, owns or operates CPG or Omnivyra, and any affiliate") | `<<UNFILLED: the entity's name>>` |
| Signing party for the developing organisation | `<<UNFILLED: name and position>>` |
| Exclusion period, as §4A.1 defines it ("from the first repository commit of the developing organisation's product until publication of this study's results") | from `<<UNFILLED: first-commit date>>` until `<<UNFILLED: results-publication date — necessarily in the future at signature>>` |

> If a role is to be performed **without any fee**, this document is **not** instantiated for that
> role. The register records `study_fee_agreement_sha256: null`. See §6, Path 2.

---

## 3. Agreement text — blank

The clauses below are the substance. They are drafted so that item 5's conditions are readable on the
face of the document, because a later auditor sees only this document and its hash.

> **STUDY ROLE FEE AGREEMENT — CPG-U1**
>
> This agreement is made between `<<UNFILLED: developing organisation>>` ("the Organisation") and
> `<<UNFILLED: the role-holder, by legal name, in the restricted register only>>` ("the Role-Holder"),
> in respect of the role `<<UNFILLED: role>>` in the study registered under protocol
> `CPG_U1_PROTOCOL_004`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.
>
> **1. Role.** The Role-Holder will perform the role of `<<UNFILLED: role>>` as described in the role
> material for that role, and **no other role** in the study.
>
> **2. Fee — fixed.** The Organisation will pay the Role-Holder a **single fixed fee** of
> `<<UNFILLED: amount and currency — a real figure agreed between two real parties. Inventing one here would be a fabrication.>>`.
> The fee is **fixed at signature**. It is **not** an hourly, daily, per-row or per-candidate rate; it
> is **not** a range, a minimum, a maximum, a budget, a cap or an estimate; it does **not** vary with
> the volume, duration or difficulty of the work; and it is **not** subject to revision, bonus,
> uplift, reduction, withholding, deduction or set-off for any reason.
>
> **3. Not contingent.** The fee is payable in full on completion of the role as described in the role
> material, **irrespective of**:
> (a) any result, value, score or finding the Role-Holder produces or records;
> (b) any outcome of the study, including whether its outcome is SUCCESS, is a falsification of H₁, is
>     INCONCLUSIVE, or is VOID;
> (c) whether the study is published, and what it concludes;
> (d) whether any party is satisfied with the *content* of the Role-Holder's work, as distinct from
>     whether the role was performed;
> (e) any future engagement, contract, employment, referral, introduction or other benefit, none of
>     which is offered, promised, implied or held out as available.
>
> **4. No other consideration.** No payment, benefit, gift, equity, option, discount, expense
> reimbursement beyond `<<UNFILLED: none, or the pre-agreed and itemised expense basis>>`, or
> consideration of any kind other than the fee in clause 2 passes from the Organisation (or any
> affiliate) to the Role-Holder in the exclusion period. The parties record that a payment outside
> clause 2 would engage §4A.1 item 3 and end the Role-Holder's eligibility.
>
> **5. Order of acts.** The parties record that this agreement is signed by both parties **before any
> role material is released to the Role-Holder**, as §4A.1 item 5 requires, and that on the date of
> signature the Role-Holder has received **no** role material, **no** CPG output, **no** pilot result,
> **no** sizing output and **no** quota information.
>
> **6. No direction of content.** The Organisation will not direct, review, revise, approve, reject or
> influence the substance of the Role-Holder's study work, and gives no instruction as to what any
> result should be. Nothing in this agreement makes payment depend on the Organisation's agreement
> with the Role-Holder's judgements.
>
> **7. Independence declaration.** The Role-Holder has separately signed the §4A.1 independence
> declaration. If that declaration is later found false, §4A.1's published consequences follow for the
> Role-Holder's work; this agreement does not alter them, and the fee is not a reason to withhold that
> publication.
>
> **8. Publication of this agreement's hash.** The parties record that the SHA-256 of the signed
> agreement is recorded in the study's personnel register and may be published. The agreement's
> **content** is not published by this clause.
>
> **9. Withdrawal.** `<<UNFILLED: the parties' agreed withdrawal terms. Any withdrawal term must not make the fee contingent on a finding — a term forfeiting the fee where the Role-Holder's findings are unwelcome would breach clause 3 and §4A.1 item 5.>>`
>
> **10. Whole arrangement.** This agreement is the whole of the arrangement between the parties in
> respect of the study role. There is no side agreement, side letter, oral understanding or collateral
> promise.
>
> Signed:
> Organisation: `<<UNFILLED: signature>>`   Date: `<<UNFILLED: YYYY-MM-DD>>`
> Role-Holder: `<<UNFILLED: signature>>`    Date: `<<UNFILLED: YYYY-MM-DD>>`

**Clause 2 is the field an operator is most likely to fill prematurely.** A "representative" or
"placeholder" figure written as if agreed is exactly the failure this package exists to prevent: the
hash of a document containing an invented fee is a real 64-hex string recorded against a fee nobody
agreed to.

---

## 4. Terms that void the exception — refuse them at drafting, not at hashing

Each of the following looks commercially ordinary and destroys item 5. After signature there is no
remedy other than re-drafting and re-signing, and that re-signature must still precede release.

| Term | Which condition it breaks |
|---|---|
| An hourly or daily rate; a per-row or per-candidate rate | C1 — not fixed |
| "Up to X", "approximately X", "a budget of X", "X subject to scope" | C1 |
| A bonus, uplift, success fee, completion bonus or milestone payment | C1 and C4 |
| Payment "on acceptance of the work" where acceptance depends on content | C4 — contingent on a finding |
| Payment conditional on the study being published, or on its outcome | C4 |
| "Further work may be available"; a right of first refusal; a stated intention to engage again | C4 — contingent on future engagement |
| Equity, options, tokens, credits, a discount or free use of the product | §4A.1 item 4, independently of item 5 |
| Unitemised or open-ended expenses | item 3 — a benefit other than the fee |
| A non-disparagement term, or approval-of-publication rights | C4 in substance: it prices the finding |
| Signature **after** the frame template, §5.1–§5.4, the jurisdiction-family list or the development-only registry has reached the person | C3 — and this one is **unrecoverable**, because release cannot be undone |

---

## 5. The confirmations the register-facing declaration will ask for

These mirror `F-recruitment/ENUMERATOR_INDEPENDENCE_DECLARATION.md` §C and
`F-recruitment/ENUMERATOR_ELIGIBILITY_CHECK.md` §1.4, repeated here so the agreement and its record
cannot drift apart.

| Confirmation | Value |
|---|---|
| The fee is **fixed** | `<<UNFILLED: yes / no>>` |
| Agreed **in writing** and **signed by both parties** | `<<UNFILLED: yes / no>>` |
| **Not contingent** on any result, finding or future engagement | `<<UNFILLED: yes / no>>` |
| Signature date | `<<UNFILLED: YYYY-MM-DD>>` |
| Date any role material was first released to this person — must be **strictly later** than the signature date, verified against the **release log**, not against memory | `<<UNFILLED: YYYY-MM-DD, or "not yet released">>` |

A `no` in any of the first three rows means item 5 does not apply and items 2–3 exclude the person.
An `unknown` is not a `no` — §4A.1: *"An unknown answer is not 'no'."*

---

## 6. Recording the SHA-256 — the exact procedure, and both permitted register values

§4A.1 item 5 ends *"the agreement's SHA-256 is recorded"*, and §4A.1's "Recorded per person" list
names *"the fee-agreement hash (or none)"*. `checkPersonnelRegister` implements that as **two**
permitted values and nothing else (`lib/personnel.mjs:38`, verbatim):

```js
if (a.study_fee_agreement_sha256 !== null && !HEX64.test(a.study_fee_agreement_sha256 ?? ''))
  errors.push(`${where}: study_fee_agreement_sha256 must be 64 hex or null (no fee)`);
```

with `const HEX64 = /^[0-9a-f]{64}$/;` (`lib/personnel.mjs:13`).

### Path 1 — there is a fee: record 64 lower-case hex

1. Both parties sign. Produce **one** file that is the definitive signed agreement — one file, one
   byte sequence, for all time. If the signature is wet-ink, the definitive artefact is the scan, and
   the scan is not re-scanned, re-compressed, re-flattened or re-exported afterwards.
2. Hash the **exact bytes** of that file:

   ```bash
   sha256sum "<signed-agreement-file>"
   # Windows: certutil -hashfile "<signed-agreement-file>" SHA256
   ```

3. Lower-case the digest. **`HEX64` is lower-case only** — verified by running the checker against a
   64-character upper-case digest, which is refused with
   `study_fee_agreement_sha256 must be 64 hex or null (no fee)`. `certutil` and several Windows tools
   emit upper-case; convert before recording.
4. Record the 64 lower-case hex characters as `study_fee_agreement_sha256` on **that person's**
   assignment in the personnel register — not on the register as a whole, and not on a shared record.
5. Store the file itself under the restricted register, unmodified. **Any later edit — even correcting
   a typo — changes the hash and makes the recorded hash false.** A corrected agreement is a new
   agreement: sign it, re-hash it, re-record it, and, because the signature date moves, re-run
   `MATERIAL_RELEASE_GATE.md` before any further release.

### Path 2 — there is no fee: record the JSON literal `null`

```json
"study_fee_agreement_sha256": null
```

Verified by the instrument's own self-test: `test/selftest.mjs:835` asserts
`'no study fee (null) permitted'` with zero errors. `null` means **no fee at all**. It does not mean
"unknown", "not yet", "pending", "waived" or "to be agreed". Using `null` while a fee is in fact
intended is a false register entry, and it destroys the only record item 5 requires.

### Refused values — verified against the code, not assumed

| Value | Outcome |
|---|---|
| `null` (JSON literal) | **accepted** — no fee |
| 64 lower-case hex | **accepted** |
| 64 **upper**-case hex | refused — `HEX64` is `/^[0-9a-f]{64}$/` |
| `""` | refused |
| field absent / `undefined` | refused — `?? ''` then fails `HEX64` |
| `"none"`, `"n/a"`, `"pending"`, `"TBD"`, `"0"` | refused |
| the string `"null"` | refused — `!== null` is true for a string |
| a 40-hex (SHA-1) or 128-hex (SHA-512) digest | refused — the length is exact |
| a digest with a leading or trailing space or newline | refused |

### What recording the hash proves, and does not

It proves that **some** document existed at recording time whose bytes hash to that value, and it
binds the operator to producing that document on audit. It does **not** prove the document is an
agreement, that the fee in it is fixed, that it is non-contingent, that it was signed, or that it was
signed before release. `lib/personnel.mjs:3` states the instrument's position for the whole register:
*"It cannot verify that declarations are true."* Item 5's conditions rest on the operator's
record-keeping and the parties' signatures — **procedural evidence, not proof**, in §4A.1's own words.

---

## 7. Instantiation record — blank

| Role-holder slot | Fee? | `study_fee_agreement_sha256` | Signed on | Material released on | Item 5 satisfied |
|---|---|---|---|---|---|
| Enumerator A | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| Enumerator B | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| reference-author | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| reference-confirmer | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| reference-adjudicator | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| rater-1 | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| rater-2 | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |
| rating-adjudicator | `<<UNFILLED: yes / no>>` | `UNASSIGNED` | `<<UNFILLED>>` | `<<UNFILLED>>` | `<<UNFILLED: yes / no>>` |

**Every row is unfilled. No role-holder exists. Nothing in this table asserts that anyone has been
recruited, approached or agreed to anything.**

The operator is **not** free to fill this table role by role and release to each as its row
completes — see `MATERIAL_RELEASE_GATE.md` §3 for the ordering rule this package adopts.

---

## 8. What this document is not

- Not legal advice, and not a legal determination. §4A.1 closes with *"This is a methodological rule;
  it is not a legal determination."* The same applies here.
- Not a fee proposal. It contains no figure and recommends none.
- Not evidence that any fee was agreed, or that any person exists.
- Not a substitute for the independence declaration
  (`F-recruitment/ENUMERATOR_INDEPENDENCE_DECLARATION.md`) or for the developing organisation's
  written no-relationship confirmation, both of which §4A.1 requires **in addition** to the
  fee-agreement hash.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.


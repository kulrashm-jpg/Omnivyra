# CPG-U1 — Operator evidence request form

**This is a collection form, not a report.** Every field below is intentionally blank. Please complete the fields that fall to you and return this document together with the required attachments.

Nothing in this form registers or starts anything. It gathers the inputs that CPG-U1 needs from people and from public external sources before registration can even be proposed.

**Who completes what**

| Section | Who completes it |
|---|---|
| HP-1 | Study owner |
| HP-2 | Study owner (naming the custodian), countersigned by the custodian |
| HP-4 | An officer of the developing organisation |
| HP-3 | Study owner, using each role holder's signed declaration |
| HP-5 | The independent enumerator |
| HP-6 | The custodian (public data only) |
| HP-7 | Study owner |
| HP-8 | Nobody — see that section |

---

## Reference anchors (for your information only — nothing to complete here)

| Anchor | Value |
|---|---|
| Repository main | `083dcea45dc9b4a83b14ea01129866ec7c74f50f` |
| Protocol SHA-256 | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Treatment | `f01a7eb4...` |
| Instrument | `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` |
| Provider configuration SHA-256 | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` |

The provider configuration hash is derived automatically from the frozen code. **It needs no human input**, and it must not be replaced with a supplied value.

---

# HP-1 — Accountable OSF identity

Accountable OSF identity: ______________________________________________

PID type: ______________________________________________

PID value: ______________________________________________

Evidence / source: ______________________________________________

**Security instruction:** DO NOT provide passwords, credentials, API tokens, or other secrets.

All three fields are needed together. An identity supplied without the persistent identifier leaves HP-1 incomplete.

---

# HP-2 — Study operator (key custodian)

Custodian identity / name: ______________________________________________

Role: ______________________________________________

Acceptance: ______________________________________________

**Required role value:** `STUDY_OPERATOR`

Exactly one custodian. The custodian must **not** be any of the seven independent role holders in HP-3.

**Security instruction:** DO NOT provide private keys, seed phrases, wallet passwords, or credentials.

---

# HP-4 — Developing organisation

Organisation identity / legal name: ______________________________________________

**Required records statement** — please confirm in writing that the organisation maintains the records needed to attest to items 1–4 (employment; contract, engagement or other work; payment or benefit; equity, options or other financial or organisational interest):

______________________________________________________________________

______________________________________________________________________

Confirmation document 1: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 2: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 3: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 4: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 5: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 6: ______________________________________________
SHA-256: ______________________________________________

Confirmation document 7: ______________________________________________
SHA-256: ______________________________________________

> ## ATTACH THE ACTUAL SEVEN DOCUMENTS.
>
> **Do not provide hashes alone.** The validator will calculate the SHA-256 of each supplied document and compare it with the value you submit here. A hash without its document cannot be checked, and will not be accepted.

One confirmation per independent role holder, issued by the organisation **from its records**, stating that those records show no item 1–4 relationship.

The organisation confirmation is **mandatory for every person** — it can never be left empty or null.

---

# HP-3 — Seven independent role holders

Seven records follow, one per person. **Please do not write real names in this form.**

**The seven roles**, each held by a different person: `enumerator`, `reference-author`, `reference-confirmer`, `reference-adjudicator`, `rater-1`, `rater-2`, `rating-adjudicator`.

**The seven declarations**, in order, are answers about the person:

1. employed by the developing organisation, in any capacity
2. has or had any contract, engagement or other work (paid or unpaid) for it, other than this study engagement
3. received any payment or benefit from it, other than the study fee
4. holds equity, options or any other financial or organisational interest in it
5. is the spouse or partner, a family member or household member of, or has a current or former direct reporting relationship with, anyone who developed CPG, the operator, or any other role holder
6. implemented CPG, this protocol, the tooling or the registry
7. ran CPG or saw any CPG output before completing their role work

### Person 1
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 2
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 3
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 4
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 5
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 6
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Person 7
- pseudonymous person_id: ______________________________________________
- role: ______________________________________________
- independence basis: ______________________________________________
- declaration 1: ____________
- declaration 2: ____________
- declaration 3: ____________
- declaration 4: ____________
- declaration 5: ____________
- declaration 6: ____________
- declaration 7: ____________
- fee SHA-256 or null: ______________________________________________
- organisation confirmation SHA-256: ______________________________________________

### Rules for HP-3 — please read before completing

- **Each declaration must be `"no"`.** An unknown answer is not "no". A person who cannot answer confidently is not eligible.
- **The seven persons must satisfy the protocol's independence requirement**, and the seven roles are mutually exclusive — no person may hold two of them.
- **The `STUDY_OPERATOR` is in none of these seven roles.** Seven independent role holders plus the operator means eight distinct people.
- **Real identities do not belong in the study artifact.** Use a pseudonymous `person_id` here.
- **Real identities remain in the restricted register**, held by you, outside the repository. Please do not send them.
- **The organisation confirmation SHA-256 is mandatory** for every person.
- **The fee SHA-256 may be null** — use `null` where there is genuinely no fee. Where a fee exists, it must have been agreed in writing before any role material was released, and must not be contingent on any result or future engagement.

Also note: the enumerator may not be the reference adjudicator, and the enumerator must not have run CPG or seen any CPG output before completing the frame.

---

# HP-5 — Independent frame

Independent enumerator: ______________________________________________

Frame CSV path / attachment: ______________________________________________

**Required sufficiency:** E >= 126 / 52 / 32 = 210 admissible rows, one row per legal entity.

> ## ATTACH THE ACTUAL COMPLETED CSV.
>
> Please do not paste 210 rows into this document — send the file.

The frame must be produced by the independent enumerator. It will not be constructed or modified on your behalf.

> ## THE FRAME MUST BE VALIDATED BEFORE ANY COMMITTING STAGE.
>
> An insufficient frame can trigger **`STAGE_VOID_FRAME_INSUFFICIENT`** and **consume the protocol slot**, with no retry. This is why the frame is validated first, separately, and why no committing stage may be run against an unvalidated frame.

---

# HP-6 — Funding

## Output 1
txid: ______________________________________________

vout: ____________

checkpoint height: ____________

checkpoint hash: ______________________________________________

## Output 2
txid: ______________________________________________

vout: ____________

checkpoint height: ____________

checkpoint hash: ______________________________________________

**Required:**

- two distinct outputs;
- single-use P2WPKH;
- each >= 6 confirmations at the checkpoint.

> ## ONLY PUBLIC BLOCKCHAIN DATA IS REQUIRED.
>
> **DO NOT PROVIDE:**
>
> - private keys;
> - seed phrases;
> - wallet passwords.

The two outputs will be named publicly before any frame exists, and each must be spent only as its own stage's commitment.

---

# HP-7 — Frozen as_of

as_of: ______________________________________________

**Required format:** `YYYY-MM-DDTHH:MM:SSZ`

The owner must choose this value. No timestamp is suggested here, and none will be chosen on your behalf. The validation stage will check it against the protocol's timing constraints.

---

# HP-8 — Registry-issued fields (do not complete)

registration_id:
**NOT YET ISSUED**

registration_timestamp:
**NOT YET ISSUED**

These values are issued by the OSF registry only after actual registration.

**The operator must NOT invent or pre-populate them.** There is nothing to fill in here, and a value supplied for either field would assert that registration had already happened.

---

# Dependency map

```
HP-4 Organisation
        +
HP-2 Study Operator
        ↓
HP-3 Personnel
        +
HP-5 Independent Frame
        ↓
HP-6 Funding
        +
HP-7 as_of
        ↓
EXPLICIT REGISTRATION AUTHORIZATION
        ↓
REGISTRATION
        ↓
HP-8 Registry-issued fields
```

**Protocol ordering:**

```
funding → registration → frame
```

A frame may be **prepared and validated before registration** — that is encouraged, because validating it early is how the slot is protected. But **no committing stage may consume the frame slot prematurely**. Preparation and validation are safe; committing is not, and committing waits until after registration.

---

# Submission checklist

- [ ] HP-1 complete
- [ ] HP-2 complete
- [ ] HP-4 organisation supplied
- [ ] HP-4 seven confirmation documents attached
- [ ] HP-3 seven personnel records complete
- [ ] HP-5 completed independent frame CSV attached
- [ ] HP-6 two public outpoints + checkpoints supplied
- [ ] HP-7 as_of supplied

HP-8 intentionally remains:

- [ ] NOT APPLICABLE BEFORE REGISTRATION

Partial submissions are welcome. HP-4 and HP-2 unblock the most downstream work, so they are the most useful to send first.

---

# SECURITY

## NEVER SUBMIT:

- passwords
- API keys
- access tokens
- private Bitcoin keys
- seed phrases
- wallet passwords
- authentication secrets

Nothing in CPG-U1 requires any of the above. If a field appears to ask for one, that reading is wrong — please ask before sending anything.

**Use pseudonymous `person_id` in study artifacts. Real identities remain in the restricted register**, held outside the repository and not submitted with this form.

Filler words used in place of real values — such as the words synthetic, placeholder, example, test, fake or dummy — will be **rejected automatically** and cannot be used to complete a field. Please leave a field blank rather than filling it with a stand-in value.

---

# CURRENT STATUS

**U1 HUMAN/EXTERNAL EVIDENCE GATE — BLOCKED**

This document is a collection form only.

No registration has occurred.

No U1 execution has occurred.

No deployment is authorized.

No repository modification is authorized by this task.

# CPG-U1 — HOW ENUMERATOR B IS REPRESENTED AT REGISTRATION

**CLASSIFICATION: PREPARATION.** No person is named, recruited, contacted, invented or pseudonymised anywhere
in this document. No registration, submission, commit or push. The instrument was read read-only from
`C:/tmp/dt002/research/cpg-u1/tooling` (aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`,
593 files) and never written.

**The prior question this document had to settle first:** does the registration record contain **any** personnel
field at all? It does not. Everything else follows from that.

---

## 1. THE FINDING — the machine record has NO personnel field of any kind

**Established by reading `C:/tmp/dt002/research/cpg-u1/tooling/lib/registration.mjs` in full, not by search
alone.**

### 1.1 `registrationTemplate()` (lines 33-57) emits no personnel key

The template was imported and its keys enumerated mechanically. It returns **20 top-level keys** and **39 leaf
paths**:

```
schema · study_id · protocol_version · protocol_sha256 · tooling_aggregate_sha256 · registry_sha256 ·
registry · registration_id · registration_timestamp · accountable_identity · persistent_identifier ·
bitcoin_key_custodian · network · outpoints · checkpoint · parameters · as_of ·
provider_configuration_sha256 · authority_rule · verification_procedure
```

**Not one of them is a personnel field.** The three that name a human role are not personnel in the section 4A
sense:

| Key | What it is | Is it a section 4A independent person? |
|---|---|---|
| `accountable_identity.value` | the identity under which the registration is filed, and the identity `checkAuthority` compares across the registry listing | **No.** It is the accountable registrant, not an independent role holder. |
| `bitcoin_key_custodian.value` (+ `.role`, pinned to `STUDY_OPERATOR`) | the study operator, who holds the wallet keys | **No — the opposite.** `lib/personnel.mjs` explicitly refuses an operator who also holds any independent role (`ROLE COLLISION — the operator may hold no independent role`). |
| `persistent_identifier.type` / `.value` | an identifier for the accountable identity | **No.** |

### 1.2 `checkRegistration()` (lines 66-115) never mentions personnel

Read line by line. What it validates, in order: `schema`; `study_id`; `protocol_version`; the three
64-hex digests (`protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`); `network`; `parameters` as
an **exact key set** with every pinned value; `bitcoin_key_custodian.role` and `.value`; then, past the
`phase === 'funding'` early return, `registry.name`/`.public`/`.embargo`; `accountable_identity.value`;
`persistent_identifier.type`/`.value`; `registration_id`; `registration_timestamp`; `outpoints`; `checkpoint`;
`as_of`; `provider_configuration_sha256`.

**No enumerator. No rater. No role. No count of persons. No reference to the personnel register, to a personnel
schema, to a declaration or to a fingerprint.** A case-insensitive search of the whole module for
`personnel|enumerat|rater|person` returns **exactly one** line, and it is a prose comment on `checkAuthority`
("as enumerated from the registry by the verifier") that concerns registration listings, not people.

### 1.3 Corroboration from the other direction

- `checkPersonnelRegister()` lives in a **different module**, `lib/personnel.mjs`, over a **different schema**,
  `cpg-u1-personnel/v1`, and is invoked by a **different command**, `check-personnel`. There is no import of
  `personnel.mjs` in `registration.mjs` and no import of `registration.mjs` in `personnel.mjs`.
- `SAMPLING_FIELDS` — the only fields `checkAuthority()` compares between the registry copy and the supplied
  record — are `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256`, `network`, `outpoints`,
  `checkpoint`, `parameters`. **No personnel field, so no roster change can ever make a registration
  non-authoritative or VOID.**
- `verify-registration` reports **nine** blockers (`VERIFIER_STATE.md`) and not one of them is a person other
  than the accountable identity and the key custodian. It would exit **0** with an empty personnel register.

### 1.4 The consequence, stated plainly

**Enumerator B does not appear in the machine record, and neither does Enumerator A, nor any rater, author,
confirmer or adjudicator.** This is not a gap to be filled. The record's shape is fixed by
`registrationTemplate()`, and `REGISTRATION_PACKAGE.md` section 6(1) requires the OSF submission to carry the
record "as `registration-fields` produced it" — so **adding a personnel key would break the package's own
requirement**, and the recommendation carried forward from DR-7 section 6 stands: **add no key.**

---

## 2. WHERE ENUMERATOR B *DOES* APPEAR — the answer is a combination, of three places, none of which is the machine record

| Place | Does Enumerator B appear? | What appears |
|---|---|---|
| **The `cpg-u1-registration/v1` machine record** | **NO — and no other role holder does either** | Nothing. No key is added. |
| **The personnel register (`cpg-u1-personnel/v1`)** — a separate, restricted artefact, not part of the registration | **YES — this is B's only machine representation** | A **second assignment with `role: 'enumerator'`**, carrying its own `person_id`, its own complete declaration set with every key answered `"no"`, its own `study_fee_agreement_sha256` (or `null`), and its own `organisation_confirmation_sha256`. |
| **The section 19.3 prerequisite list** (a protocol requirement the operator must satisfy, not a record field) | **YES — as part of item 3** | Item 3 already reads "enumerator(**s**)", plural. B is one of the persons that item requires to exist before the enumeration stage. **Nothing is added to the protocol text**; the plural already accommodates B. |
| **The OSF free-text narrative** | **YES — one sentence, already drafted** | The DR-7 sentence carried forward in section 5 below. |

### 2.1 Why the personnel register accepts B with no change to the instrument

`INDEPENDENT_ROLES` is `['enumerator', 'reference-author', 'reference-confirmer', 'reference-adjudicator',
'rater-1', 'rater-2', 'rating-adjudicator']` — seven role **labels**. The "exactly one holder" rule is
`else if (role !== 'enumerator' && n > 1) errors.push(...)`: it applies to every role **except** `enumerator`.
A second enumerator assignment is accepted; a second `rater-1`, for instance, is not. The mutual-exclusion
check is per `person_id`, so B must be a different person from every other role holder and from the operator,
which is exactly the intended constraint. **No instrument change is needed to represent B.**

### 2.2 What B's presence does NOT do

- It does not change `tooling_aggregate_sha256`. (That moves for DR-1 and DR-10 only.)
- It does not change `protocol_sha256`, `registry_sha256` or any parameter.
- It does not affect `SAMPLING_FIELDS`, so it cannot make the registration non-authoritative.
- It does not affect the rater assignment fingerprint, which covers `rater-1`, `rater-2` and
  `rating-adjudicator` and not enumerators.
- It does not add a registration blocker. `verify-registration`'s exit code is identical with one enumerator
  or two.

---

## 3. THE ONE PLACE B's REPRESENTATION INTERACTS WITH THIS WAVE'S CODE CHANGES

`DECISION_RECORD.md` authorises a fourth change alongside DR-1 and DR-10 — the **`enumerated_by` personnel
binding**. Quoted:

> **Finding this rests on** (verified by me in DEEPTECH-PARALLEL-008): `enumerated_by` appears in only three
> places across all 593 files — `lib/schema.mjs:32` as a column name, `:124` as a non-blank check, and the CSV
> template header — and **nothing cross-references the personnel register**. Yet the pattern already exists in
> the same instrument: `lib/assignment.mjs:10/19/34-35` binds rater labels to the register via
> `checkPersonnelRegister`, and `cpg_u1_data.mjs:945` supplies `--personnel`. `cmdFrame` has no equivalent.
> **The gap is an asymmetry in application, not a missing capability**, so the fix follows the instrument's own
> idiom.

**Corroborated read-only by this agent.** `enumerated_by` occurs in exactly those three non-test places (plus
two self-test fixtures, one of which is deliberately named `cpg-implementer-NOT-INDEPENDENT` to exercise the
absent check), and `lib/schema.mjs:124` is `if (!r.enumerated_by.trim()) errors.push('enumerated_by is
required')` — a non-blank string and nothing more.

### Consequence for Enumerator B, and it is a real operational one

Once that binding lands, **the `enumerated_by` value on every frame row must resolve to a person in the
personnel register.** With two enumerators that becomes load-bearing rather than cosmetic:

1. **Both A's and B's identifiers must be in the register before either enumerates a single row.** A frame row
   written under an identifier the register does not know will be refused. The register is therefore complete
   before enumeration starts, not assembled afterwards.
2. **The two identifiers must be distinct and stable.** Whatever string convention is chosen for `person_id` in
   the register must be the same string used in the `enumerated_by` column, exactly, for the whole run.
3. **This is why B must enter the *original* roster.** Section 4A.1 item 6 cannot be answered retrospectively
   — "An unknown answer is not 'no'" (protocol line 145) — so a declaration signed before the eighth role
   holder existed cannot cover that person, and a late addition forces a **second declaration round for
   everyone**. DR-8 rule A7 (no material to either enumerator until both sets of paperwork are complete) has
   the same effect. Combined with the `enumerated_by` binding, adding B after enumeration has begun would
   require re-declaring **and** would make already-written rows unattributable.

**None of this is a registration-record matter.** It is a sequencing constraint on the personnel register and
the frame, and it is the reason the eighth person is a recruitment-schedule decision rather than a
registration-document decision.

---

## 4. WHAT THE OPERATOR ACTUALLY DOES — the complete representation of B, in order

| # | Act | Artefact | Registration field touched |
|---|---|---|---|
| 1 | Decide the roster is eight persons (operator + 7 independent, of whom **2** enumerators). Already authorised; publish the DR-7 disposal text. | decision log | **none** |
| 2 | Record the DR-8 A1 reading: section 4A.1 item 6 is applied **between co-enumerators**, and generally between any two holders of section 4A.3 roles including two holders of the same label. **Record this before the roster is fixed.** | decision log | **none** |
| 3 | Recruit A and B **in the same round**, with **two separate complete declaration sets** and **two separate organisation confirmations** (DR-8 A2 — mechanically enforced, not a judgement call). | personnel register | **none** |
| 4 | Keep A and B mutually blind: neither learns the other's identity; declarants supply relational schedules; the operator performs and records the pairwise item-6 check (DR-8 A5). | register + operator attestation | **none** |
| 5 | Release no study material to either until both sets of paperwork are complete and `check-personnel` is clean (DR-8 A7). | release gate | **none** |
| 6 | Run `check-personnel` against the register. Expect it to accept two `enumerator` assignments and to report the seven roles filled, mutually exclusive, operator in none. | `check-personnel` exit 0 | **none** |
| 7 | Use each enumerator's register identifier, verbatim, as the `enumerated_by` value on that enumerator's frame rows. | frame CSV | **none** |
| 8 | Publish the DR-7 sentence (section 5 below) in the OSF narrative. | OSF free text | **none** |
| 9 | Optionally (DR-8 open item iii, **recommended**) disclose in the narrative that the item-6 pairwise check between co-enumerators is an **operator attestation**, not a mechanically verified property. | OSF free text | **none** |

**Registration fields touched by the entire eight-person arrangement: zero.**

---

## 5. THE SECTION 19.3(3) "seven ... persons" DISPOSAL — carried forward, not rewritten

Quoted verbatim from `C:/tmp/dt008-prereg/A-decisions/DR7_DECISION_MEMO.md` section 4.1. **Owner ruling
between reading M (minimum) and reading C (cap) is still required; the memo recommends M and everything here
presumes it.**

```
DR-7 — §19.3(3) "Seven mutually exclusive independent persons" is a MINIMUM.
Decided: <<UNFILLED: YYYY-MM-DD>>   By: <<UNFILLED: accountable identity>>
Status: CLOSED — recorded interpretation. No protocol amendment; no re-freeze.

Question: does §19.3(3) (CPG_U1_PROTOCOL_004, line 959, final sentence) cap the number of
independent persons at seven, so that an eight-person roster with two enumerators would fail a
§19 freeze requirement?

Decision: it does not. §19.3(3) states a floor, not a cap, and eight independent persons
satisfy it.

Grounds:
 1. §19.3's heading reads "Named prerequisites (not decisions; must exist before the stated
    act)" — a prerequisite is a floor, and the section disclaims deciding anything.
 2. §4A.3 line 185, the closed rule to which §19.1 defers, reads "The seven independent roles
    are mutually exclusive: minimum 7 independent persons." Line 959's sentence is a
    compression of it and inherits "minimum". "Mutually exclusive" is a property of roles.
 3. The same sentence writes "enumerator(s)", and §4A.3 line 176 writes "enumerator (>= 1)" and
    line 186 "Several enumerators are permitted; each holds no other role." A cap reading voids
    all three.
 4. No mechanism implements a cap: lib/personnel.mjs:26 permits n > 1 for enumerator and for no
    other role; test/selftest.mjs:829 is a passing test named "multiple distinct enumerators
    permitted" inside the registered instrument; check-personnel reports in role-count language
    (cpg_u1_data.mjs:662); no §5.10 VOID state, no §15.5 condition and no §21 step counts
    persons; and the registration record has no personnel field (lib/registration.mjs:33-57,
    checkRegistration :66-114).

Contrary reading recorded and rejected: line 959's "Seven" carries no minimum marker where the
same sentence writes ">= 2 raters", so expressio unius could yield an exact count. Rejected on
grounds 1-4; noted here so that it is disposed of on the record rather than argued later.

Objects affected: NONE. protocol_sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
unchanged; tooling_aggregate_sha256 f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
unchanged; registry_sha256 unchanged; no field of cpg-u1-registration/v1 added, removed or altered.
```

**Ground 4's final clause is the finding this document independently re-verified in section 1, and it holds
exactly as written:** `lib/registration.mjs:33-57` emits no personnel key and `checkRegistration` at `:66-114`
never mentions personnel. The only correction, and it is to a fact rather than to the reasoning: the closing
paragraph quotes `tooling_aggregate_sha256 f7699f05...` as unchanged, which was true when the entry was
drafted and is no longer, because DR-1 and DR-10 move it. **DR-7 still affects no object.** Publish the entry
with the "Objects affected: NONE" clause intact and the aggregate value **omitted** rather than quoted, or
quote whatever value DR-1/DR-10 produce.

OSF narrative sentence — quoted verbatim from `DR7_DECISION_MEMO.md` section 4.2:

> §19.3(3)'s closing words "Seven mutually exclusive independent persons" are read as a minimum, not a cap:
> §4A.3 states "minimum 7 independent persons", lists "enumerator (≥ 1)", permits "Several enumerators", and
> the registered instrument accepts and positively tests a register with two enumerators
> (`lib/personnel.mjs:26`; `test/selftest.mjs:829`), so this study's eight independent persons satisfy
> §19.3(3) with no amendment to the protocol at
> `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

**Timing:** section 5.5's ordered pipeline puts registration at step 2 and enumeration at step 3, so this
sentence can be written and published **before any enumerator exists and before any personnel identity is
known**. Nothing about DR-7 is on the recruitment critical path. The **roster-size** decision is — B must be in
the original roster (section 3 above).

---

## 6. ANSWER, in one paragraph

**The registration record contains no personnel field at all**, so Enumerator B cannot and does not appear in
the machine record — and neither can any other independent role holder. B is represented in **three places, in
combination, none of them the registration record**: as a second `role: 'enumerator'` assignment in the
separate `cpg-u1-personnel/v1` register, which the frozen instrument already accepts without modification; as
part of section 19.3(3)'s item 3, whose existing plural "enumerator(s)" already accommodates a second
enumerator with no protocol amendment; and as one sentence of OSF free-text narrative, already drafted as the
DR-7 disposal, optionally joined by a second sentence disclosing that the co-enumerator item-6 check is an
operator attestation. The only way B's existence reaches the registered instrument at all is indirectly,
through the authorised `enumerated_by` personnel binding, which makes it mandatory that **both** enumerators
are in the register **before** either writes a frame row — and that, with section 4A.1 item 6's rule that an
unknown answer is not "no", is the whole reason B must join the original roster rather than be added later.

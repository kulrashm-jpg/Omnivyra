# RATING_MATERIAL_RELEASE_GATE — fail-closed operator checklist for the three rating roles

**Classification: PREPARATION ONLY. NOT REGISTERED. NOT RECRUITED. NO IDENTITY EXISTS.**
DEEPTECH-PARALLEL-008, Agent 5. No protocol byte and no instrument byte changed. Baseline: protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument
`<NEW_AGG>`, <NEW_N> files, recomputed read-only.

**Fail-closed means:** every gate below defaults to **BLOCK**. A gate passes only on positive, recorded
evidence. An absent answer, an `unknown`, a blank, a "will follow", a verbal assurance, a partially signed
document or a hash that does not recompute is a **BLOCK**, not a warning. Nothing is released on a
best-effort basis and nothing is released "pending paperwork".

**Scope:** the three §4A.3 labels `rater-1`, `rater-2`, `rating-adjudicator`. Each gate is evaluated
**per person** unless marked *(program-level)*.

**Machine check:** run `RATING_PACKET_VALIDATOR.mjs` (this directory) over the candidate package. It
refuses the file-set, the declaration keys, the hash formats and the three-distinct-`person_id`s
mechanically. It does **not** replace gates 1, 5, 6 or 7, which are about *when* and *whether* things
happened and are not decidable from the artefacts alone.

---

## Gate summary

| # | Gate | Default | Blocks |
|---|---|---|---|
| 1 | Fee agreement signed **and hashed before** any role material is released | BLOCK | all release of role material to that person |
| 2 | Declaration complete, every key exactly `"no"` | BLOCK | that person's assignment and all material |
| 3 | Developing organisation's written no-relationship confirmation present and hashed | BLOCK | that person's assignment and all material |
| 4 | §4A.1 item 6 pairwise check across every role holder *(program-level)* | BLOCK | the whole assignment artefact |
| 5 | Three distinct `person_id`s, mutually exclusive with every other role and with the operator | BLOCK | the assignment artefact |
| 6 | **Assignment recorded and its SHA-256 fingerprint PUBLISHED before the held-out commitment transaction is broadcast** | BLOCK | **the commitment broadcast itself — and therefore the entire held-out stage** |
| 7 | Package completeness: no `<<UNFILLED:` marker remains, no required file missing | BLOCK | release of that person's package |

---

## 1. Fee agreement — signed and hashed BEFORE any role material is released

§4A.1 item 5, quoted in full:

> 5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
>    material is released, **not contingent** on any result, finding or future engagement; the
>    agreement's SHA-256 is recorded;

This is the only permitted payment from the developing organisation to a role holder. **The ordering is
part of the rule, not administrative hygiene:** a fee negotiated after the person has seen the material is
a fee negotiated with knowledge of what the material contains.

| Check | PASS requires | Evidence |
|---|---|---|
| 1.1 | A written fee agreement exists, **or** there is no fee at all and `study_fee_agreement_sha256` is exactly `null` | `<<UNFILLED>>` |
| 1.2 | It is **signed** by the person and by the study side | `<<UNFILLED: date signed>>` |
| 1.3 | Its SHA-256 is recorded, 64 lowercase hex, and **recomputes from the stored document** | `<<UNFILLED: 64 hex>>` |
| 1.4 | The fee is **fixed** and **not contingent** on any result, finding, endpoint outcome or future engagement | `<<UNFILLED: quote the non-contingency clause>>` |
| 1.5 | **The signature date is strictly on or before the first release of any role material to this person** | `<<UNFILLED: sign date ≤ material release date>>` |
| 1.6 | No other payment or benefit from the developing organisation exists (cross-check gate 2, key `payment_other_than_study_fee`) | `<<UNFILLED>>` |

`lib/personnel.mjs:38` enforces only the *shape*: `study_fee_agreement_sha256` must be 64 hex or exactly
`null`. **It cannot see 1.2, 1.4 or 1.5.** Those are operator attestations, and 1.5 is the one that is
irrecoverable once broken — there is no way to un-release material.

**BLOCK effect:** no instruction sheet, no onboarding package, no §10.1/§10.2 material, no packet. Note
that the blank declaration template and the invitation are *not* role material in this sense; they carry
no protocol content. Everything in this directory **is** role material.

---

## 2. Declaration complete, every key exactly `"no"`

§4A.1 "Recorded per person", quoted in full:

> **Recorded per person** (restricted register; a pseudonymous ID is used in study artifacts):
> - a signed declaration answering items 1–4 and 6 and §4A.2(a)–(b) with "no";
> - the fee-agreement hash (or none);
> - the developing organisation's written confirmation that its records show no item 1–4 relationship.
>
> An unknown answer is not "no".

`DECLARATION_KEYS` (`lib/personnel.mjs:8-12`) — all seven must be present and exactly the string `"no"`:

| Key | §4A.1 / §4A.2 item |
|---|---|
| `employed_by_developing_organisation` | item 1 |
| `contract_or_work_for_developing_organisation` | item 2 |
| `payment_other_than_study_fee` | item 3 |
| `financial_interest_in_developing_organisation` | item 4 |
| `close_relationship_with_developer_operator_or_role_holder` | item 6 |
| `implemented_cpg_protocol_tooling_or_registry` | §4A.2(a) |
| `ran_or_saw_cpg_output` | §4A.2(b) |

| Check | PASS requires | Evidence |
|---|---|---|
| 2.1 | All seven keys present | `<<UNFILLED>>` |
| 2.2 | Every value is the exact string `"no"` — not `"No"`, `"NO"`, `false`, `null`, `""`, `"n/a"` or `"unknown"` | `<<UNFILLED>>` |
| 2.3 | The declaration is **signed** | `<<UNFILLED: date>>` |
| 2.4 | Any note or caveat attached to an answer has been read and does not qualify the `"no"` | `<<UNFILLED>>` |
| 2.5 | The declaration is filed in the restricted register, not in any study artefact | `<<UNFILLED>>` |

`lib/personnel.mjs:37` refuses anything other than `"no"`, naming the key and the offending value.
`RATING_PACKET_VALIDATOR.mjs` applies the same rule to a candidate package's declaration files.

**A caveat that softens an answer is a BLOCK.** §4A.1: *"An unknown answer is not \"no\"."* The operator
does not adjudicate whether a caveat matters; a caveated answer is resolved to a clean `"no"` or the
person does not hold the role.

---

## 3. Organisation confirmation present

§4A.1 requires *"the developing organisation's written confirmation that its records show no item 1–4
relationship"* for **every** role holder. `lib/personnel.mjs:39` makes it **mandatory and never
nullable** — unlike the fee hash, which may be `null`.

| Check | PASS requires | Evidence |
|---|---|---|
| 3.1 | A written confirmation from the developing organisation exists for this person | `<<UNFILLED>>` |
| 3.2 | It states that **its records** show no item 1–4 relationship | `<<UNFILLED>>` |
| 3.3 | Its SHA-256 is recorded, 64 lowercase hex, and recomputes from the stored document | `<<UNFILLED: 64 hex>>` |
| 3.4 | It names the same pseudonymous `person_id` used in the register | `<<UNFILLED>>` |
| 3.5 | It is dated on or before the assignment fingerprint publication | `<<UNFILLED>>` |

This is a **second, independent** source on items 1–4: the person says no, and the organisation's records
say no. §4A.1's honest framing applies to both: *"These are **procedural evidence, not proof**."*

---

## 4. §4A.1 item 6 — the pairwise check *(program-level)*

§4A.1 item 6, quoted in full:

> 6. is the spouse or partner, a family member or a household member of, or has a current or former
>    direct reporting relationship with, any person who developed CPG, the operator (key custodian), or
>    any holder of another §4A.3 role.

**This is not a per-person question.** "Any holder of another §4A.3 role" makes it a **relation over
pairs**, and no per-person declaration can close it alone: person X may honestly answer `"no"` because X
does not know who else holds a role.

| Check | PASS requires | Evidence |
|---|---|---|
| 4.1 | Every **ordered pair** of role holders has been considered: with 7 independent roles plus the operator, 8 people → **28 unordered pairs** | `<<UNFILLED: 28 of 28 considered>>` |
| 4.2 | Every pair involving `rater-1`, `rater-2` or `rating-adjudicator` is explicitly recorded — the three rating labels against each other (**3 pairs**) and against the other 5 people (**15 pairs**), i.e. **18 pairs** touch this stage | `<<UNFILLED: 18 of 18 recorded>>` |
| 4.3 | Every CPG developer, not only the operator, is in the comparison set | `<<UNFILLED: developer list and its provenance>>` |
| 4.4 | The method by which each `"no"` was closed is recorded: mutual disclosure, operator-held disclosure, or a recorded operator judgement | `<<UNFILLED>>` |
| 4.5 | Where a pair could only be closed by disclosing one person's identity to another, **that disclosure is recorded** — and was not made to a rater about the other rater unless it was unavoidable, because it weakens §12 blinding | `<<UNFILLED>>` |
| 4.6 | No pair is left "presumed fine" | `<<UNFILLED>>` |

**The unavoidable tension, stated rather than resolved.** §12 blinds each rater to the other's identity;
§4A.1 item 6 asks each person about relationships with *other role holders*. Closing item 6 with full
certainty for the rater–rater pair requires one rater to know the other. The available options, in
decreasing order of preference:

1. **Operator-held closure** — the operator compares the two people's disclosed relationship sets and
   records the finding. Neither rater learns the other's identity. Preferred. Depends on the disclosed
   sets being complete.
2. **Third-party closure** — an independent party holds both identities and attests. Adds a person.
3. **Mutual disclosure** — closes item 6 fully, at the cost of §12 blinding. **Record it as a declared
   limitation if used.**

`role_conflict_check.mjs` (`C:/tmp/dt004-operations/people/tools/`) exists for the structural half of
this. The relational half is irreducibly an operator judgement, and `lib/personnel.mjs:3` says so:
*"It cannot verify that declarations are true."*

---

## 5. Three distinct people, mutually exclusive with everything else

§4A.3, quoted in full:

> "**Every independent role is held by a different person, and no independent role is held by the
> operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.
> - Several enumerators are permitted; each holds no other role.
> - An enumerator may not be the reference adjudicator. …"

| Check | PASS requires | Enforcement |
|---|---|---|
| 5.1 | `rater-1`, `rater-2` and `rating-adjudicator` are **three distinct `person_id`s** | `lib/assignment.mjs:33` — *"ROLE COLLISION: rater-1, rater-2 and the rating adjudicator must be three different people (§4A.3)"* |
| 5.2 | None of the three equals the operator's `person_id` | `lib/personnel.mjs:33` |
| 5.3 | None of the three holds any other independent role (enumerator, reference author, reference confirmer, reference adjudicator) | `lib/personnel.mjs:34` |
| 5.4 | Each of the three labels is held by **exactly one** person | `lib/personnel.mjs:26` |
| 5.5 | The assignment artefact's three labels match the personnel register's role holders one-for-one | `lib/assignment.mjs:37-40` |
| 5.6 | The assignment carries a 256-bit `nonce`, so the published fingerprint cannot be brute-forced from a small id set | `lib/assignment.mjs:26`, and the design note at `lib/assignment.mjs:5-7` |
| 5.7 | Re-checked at adjudication time, not only at assignment time | `lib/ratings.mjs:97` and `:98` |

`RATING_PACKET_VALIDATOR.mjs` mirrors 5.1 as its own refusal.

---

## 6. THE HARD GATE — fingerprint published BEFORE the commitment is broadcast

§4A.3, final paragraph, quoted in full:

> The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded in
> the personnel register, and its SHA-256 fingerprint is published, **before the held-out commitment
> transaction is broadcast** (§12.1). Tooling: `check-personnel` verifies structure (roles filled, mutual
> exclusion, operator in none, declarations "no", confirmation present). It cannot verify that
> declarations are true.

§12.1, final line, quoted in full:

> **Remaining discretion removed procedurally.** The person-to-label assignment is fixed and fingerprinted
> before the held-out commitment (§4A.3).

### 6.1 Why the ordering is the whole point

Presentation order and the Label A / Label B position derive from `ho_record_sha256`, the held-out
sampling record hash (§12.1). That record contains the commitment txid, the Bitcoin heights, the
randomness block hash and the drand round — so, in §12.1's words:

> **Unknowable in advance:** `ho_record_sha256` cannot be known before the held-out drand round exists.

Therefore: **before the commitment is broadcast, nobody can know any order or any Label A/B position.**
Fix the person-to-label assignment at that moment and the assignment cannot have been chosen to give a
particular person a particular order or blind position. Fix it afterwards and the assignment becomes a
free choice made with knowledge of the orders — and no artefact would show it.

The fingerprint's `nonce` (`lib/assignment.mjs:26`) exists so the published hash reveals nothing about
who was assigned while still binding the operator to it irrevocably.

### 6.2 The gate

| Check | PASS requires | Evidence |
|---|---|---|
| 6.1 | The assignment artefact exists and `checkRaterAssignment` returns **zero** errors, including against the personnel register | `<<UNFILLED>>` |
| 6.2 | Gates 1, 2, 3, 4 and 5 all PASS for all three people **first** — an assignment naming an ineligible person is not a valid assignment | `<<UNFILLED>>` |
| 6.3 | `fingerprint = sha256(canonicalJson(assignment))` computed with `rater-assignment-fingerprint` (`lib/assignment.mjs:46`) | `<<UNFILLED: 64 hex>>` |
| 6.4 | The fingerprint is **published** — publicly, at a location that cannot be silently edited, with an independently attestable timestamp | `<<UNFILLED: publication record id + timestamp>>` |
| 6.5 | **The publication timestamp is strictly earlier than the held-out commitment transaction's broadcast** | `<<UNFILLED: publication timestamp < broadcast timestamp>>` |
| 6.6 | The commitment transaction's own identity and broadcast time are recorded independently of the operator's word | `<<UNFILLED: txid + first-seen evidence from ≥ 2 independent Bitcoin header sources (§19.3)>>` |
| 6.7 | The assignment artefact is retained unchanged and `verify-rater-assignment` reproduces 6.3 at rating time | `<<UNFILLED>>` |

### 6.3 What a BLOCK here stops

**A BLOCK on gate 6 stops the held-out commitment broadcast.** Consequences, stated exactly:

- **The held-out draw cannot be made.** §5.5 binds the draw to the commitment.
- **Therefore held-out execution cannot begin**, no evaluation artefact exists, no rater packet can be
  built, and no rating can occur.
- **The rating stage is not merely delayed — the whole held-out stage is.** Everything downstream of the
  commitment waits.

This gate is therefore **the earliest hard dependency the rating roles impose on the study**, and the only
one whose violation cannot be repaired later. `lib/assignment.mjs:6-7` states the limit plainly:

> "The tooling cannot check WHEN the fingerprint was published — that is the publication record's
> timestamp (procedural) — only that the artifact matches it."

**So gate 6.5 is unverifiable by any tool in the instrument.** No validator in this directory can check
it either. It is an operator act witnessed by a publication timestamp, and if it is done out of order
there is no artefact that will ever reveal it. That is why it is stated as the hard gate, at the top of
the operator's attention rather than the bottom.

### 6.4 The one thing that must not be done to work around it

If the three people are not ready when the operator wants to commit, the permitted move is to **wait**.
The impermissible moves are: broadcasting the commitment first and publishing the fingerprint after;
publishing a fingerprint of a placeholder assignment and revising it; or publishing a fingerprint of an
assignment naming people who have not passed gates 1–5. §12's closing sentence governs: *"The protocol is
not weakened to accommodate unavailability."* The lawful fallback is the recorded absence of raters with
the **Rung 2** ceiling (§19.3 item 3), not an out-of-order fingerprint.

---

## 7. Package completeness

| Check | PASS requires | Enforcement |
|---|---|---|
| 7.1 | No `<<UNFILLED:` marker remains anywhere in the released package | `RATING_PACKET_VALIDATOR.mjs` |
| 7.2 | No `UNASSIGNED` remains in a `person_id` or `rated_by` / `adjudicated_by` field | `RATING_PACKET_VALIDATOR.mjs` |
| 7.3 | Every required file is present for the role (see the validator's `REQUIRED_FILES`) | `RATING_PACKET_VALIDATOR.mjs` |
| 7.4 | The instruction sheet is released **with** the onboarding package, never separately | operator |
| 7.5 | The run `asOf` and derived cutoff accompany the §10.2 rules | operator |
| 7.6 | No forbidden material is in the release: no tally, no pilot output, no class prediction, no other person's pseudonym beyond what the sealed reference record unavoidably carries (§4.1 of the adjudicator package) | operator; `verify-rater-packet` / `verify-adjudication-packet --type rating` for the packets themselves |

---

## 8. Release order, as a single sequence

```
gate 2 (declaration)  ─┐
gate 3 (confirmation) ─┼→ gate 1 (fee signed + hashed)  ──→ E
gate 4 (pairwise)     ─┘                                     │
                                                             ├→ M: role material may be released
gate 5 (three distinct, mutual exclusion) ───────────────────┤
                                                             └→ gate 6: fingerprint PUBLISHED  ──→ A
                                                                                                  │
                                                                              A < C  (HARD GATE)  │
                                                                                                  ▼
                                                                        C: commitment broadcast
                                                                                  ↓
                                                                        held-out draw → execution → X
                                                                                  ↓
                                            gate 7 → rater packets released (P) → both sheets accepted (S)
                                                                                  ↓
                                                            rating-adjudicator packet released (W)
```

**Read the diagram as a set of constraints, not a calendar:** `E ≤ M`, `E ≤ A`, **`A < C`**, `C < X`,
`X ≤ P`, `P < S`, `S ≤ W`. Only `A < C` is irrecoverable once violated.

---

## 9. What this gate cannot do

| Cannot establish | Why |
|---|---|
| That any declaration is **true** | §4A.1 — *"procedural evidence, not proof"*; `lib/personnel.mjs:3` |
| **When** the fingerprint was published | `lib/assignment.mjs:6-7`; only the publication record's timestamp shows it |
| That the fee was truly non-contingent | the text can be read; the intent cannot be verified |
| That item 6 has no undisclosed instance | it depends on facts only the people hold |
| That a rater did not consult the other rater | §12 blinding is procedural; the tooling checks packet contents, not human conduct |
| That no AI was used | a standing prohibition, unenforceable by artefact |

Each of these is a **declared limitation**, not a gap this checklist pretends to close. §4A.1's own
sentence is the right summary: *"This is a methodological rule; it is not a legal determination."*

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


# RECRUITMENT_PACKAGE_REFERENCE — the twelve items, for Reference Author, Confirmer and Adjudicator

**CLASSIFICATION: PREPARATION.** No person exists. All three slots are UNFILLED. Nobody has been
recruited, approached or engaged, and no fee figure, signature, declaration, confirmation or calendar
date appears anywhere below.

Register role strings: `reference-author`, `reference-confirmer`, `reference-adjudicator`
(`lib/personnel.mjs:6`). Each is held by **exactly one** person — `:26` exempts only `enumerator` from
that rule, so a second holder of any of these three is an error, not a permitted addition.

---

## 1. Role descriptions

§9.1, verbatim in its "Who" column:

| Slot | Role |
|---|---|
| **Author** | *"Independent person; constructs a blind record for every drawn company × field"* |
| **Confirmer** | *"Different independent person; constructs a **separate blind** record for every company × field"* |
| **Reference adjudicator** | *"Third independent person (§4A)"* — decides the disagreements only |

Reference truth covers **both stages**, development and held-out (dt008 `REFERENCE_WORKLOAD_NOTE.md`
§1.1 — a point an earlier tool understated by 30 records per recorder).

The adjudicator's decision is a **choice between two records**, never a value: §9.5 — *"The adjudicator
chooses between the two records or declares a conflict, and **cannot supply a third value**."*

## 2. Eligibility requirements

§9.1's "Must not" column, verbatim:

| Slot | Must not |
|---|---|
| **Author** | *"Have implemented CPG, the protocol or the tooling; see any CPG output (including the development pilot); communicate with the Confirmer before both have submitted"* |
| **Confirmer** | *"Same as Author; see the Author's record before submitting"* |
| **Adjudicator** | *"Hold any other §4A.3 role (including enumerator); introduce a new value"* |

Plus, for all three: §4A.1 in full; §4A.3 mutual exclusion; not the operator. §9.5 restates two of the
distinctness rules independently — *"The author and confirmer must be different people, and the
adjudicator must differ from both."*

## 3. Prohibited relationships

`PROHIBITED_RELATIONSHIPS.md` for the three families and the 36 + 9*d* pair set. Reference-specific
additions:

- The adjudicator may hold **no** other §4A.3 role, *"including enumerator"* — §4A.3 names the
  enumerator case explicitly and gives its reason (§9.2, §9.7 publish the enumerator's class-prediction
  mismatches, which the adjudicator's decisions feed).
- Author ↔ Confirmer is additionally governed by the §9.1 **no-communication** condition, which is a
  conduct rule and not only a relationship rule.

**§3.3 of `PROHIBITED_RELATIONSHIPS.md` applies with particular force to the adjudicator**: §9.2.1
forbids the adjudicator from receiving *"the identities or pseudonyms of Author and Confirmer"*, so the
adjudicator **cannot** enumerate the counterparties their own declaration key 5 is about. The pairwise
item-6 check is therefore the operator's, not the declarant's.

## 4. Independence declaration

The seven frozen `DECLARATION_KEYS`, every answer the literal `"no"`. Keys 6 and 7 carry §9.1's
"implemented" and "see any CPG output" conditions, which is why the reference roles need no extra
register key. The §9.1 role-specific **undertakings** (no communication; not seeing the Author's record;
not introducing a value) have no register key at all — they are recorded in the declaration form's
role-specific section (dt008 `REFERENCE_INDEPENDENCE_DECLARATION.md` §C) and are unverifiable by any
tool.

## 5. Fee / contract conditions

§4A.1(5), as for every role: fixed fee, in writing, **before any material is released**, not contingent
on any result, finding or future engagement, SHA-256 recorded. Template: dt008
`FEE_AGREEMENT_TEMPLATE.md` (written for the enumerator slots but binding *"exactly one named role"* by
its §2, so it instantiates per reference slot unchanged).

**Three separate agreements with three distinct hashes.** The shared-hash defect demonstrated in
`CHECK_PERSONNEL_EVIDENCE.md` experiment 2 is not enumerator-specific — nothing in
`checkPersonnelRegister` compares any two assignments' fee hashes, whatever their roles.

## 6. Material-release conditions

dt008 `REFERENCE_MATERIAL_RELEASE_GATE.md`: fee signed and hashed before release; every declaration key
the literal `"no"`; the organisation confirmation present; the §4A.1 item-6 pairwise check against every
other role holder in both directions; the §9.1 no-communication undertaking; and the material-specific
checks. Its §8 records the re-run triggers — **a passed gate does not stay passed**, which is the hook
`REPLACEMENT_PROCEDURE.md` trigger T-2 hangs on.

## 7. Permitted information

§9.2 — the Author and Confirmer *"each receive only"*:

> *company name, canonical domain, jurisdiction family, decisive identifier, the three field
> definitions, the value-format rules (§9.3), and the authority table (§9.4).*

§9.2.1 — the adjudicator receives, **for each disagreeing company × field only**: company name,
canonical domain, jurisdiction family and decisive identifier; the field definition, §9.3 formats and
§9.4 authority table; and the two blind records presented **unlabelled** as "Record 1" and "Record 2",
*"each carrying only its value, source and search content (no recorder identity or timestamps)"*.

Record 1 is the Author's **iff the first hexadecimal digit of
`order_key("reference-adjudicator-record-1", candidate_id, field)` is even** — scrambled per item, so no
pattern is learnable across items. The packet is built deterministically
(`reference-adjudication-packet`) and verified by rebuilding (`verify-adjudication-packet`).

## 8. Prohibited information

§9.2, Author and Confirmer: *"They never receive CPG output, each other's records, or the class
prediction."*

§9.2.1, the adjudicator *"never receives"*:

> *any CPG output (including pilot and instrument check); class predictions, identity-hazard notes,
> stratum or split; screening logs, attestations or contamination bases; agreeing records; the
> identities or pseudonyms of Author and Confirmer; any count or tally of adjudication outcomes.*

**"Any count or tally"** is the clause most easily breached by a well-meaning covering note. It also
means no acceptance criterion for this role may be expressed as a rate — see
`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §3.

§9.2.1 states the residual honestly: *"What the adjudicator learns outside the packet is controlled
procedurally (§4A)."*

## 9. Confidentiality requirements

`CONFIDENTIALITY_REQUIREMENTS.md` K-1…K-7 plus the role's K-8. For this trio:

- **Author**: no communication with the Confirmer about anything concerning this study before both have
  submitted; no disclosure of records to the adjudicator at any time.
- **Confirmer**: the same, plus not seeking or reading the Author's record before submitting.
- **Adjudicator**: not seeking record authorship, not accepting any count or tally, not asking for
  agreeing records.

**K-3 (no-preview) applies here too**, and §11 sharpens it: the pilot's outputs are *"held by the
operator, **never** shown to the reference team"*. A reference role holder who is shown a pilot result
answers declaration key 7 `yes` and is disqualified.

## 10. Deliverables

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §2 and §3:

| Slot | Deliverable |
|---|---|
| Author | one blind record per drawn company × field, both stages — 13 `BLIND_RECORD_COLUMNS` (`lib/schema.mjs:201`), `constructed_without_cpg` = `yes` |
| Confirmer | a **separate**, independently constructed record set over the same items, same 13 columns |
| Adjudicator | one decision per disagreeing item — 6 `ADJUDICATION_COLUMNS` (`lib/schema.mjs:207`), decision ∈ `RECORD_1` / `RECORD_2` / `REFERENCE-CONFLICT`, `rationale` required |

**Nobody writes the reconciled reference file.** §9.5: it is *"produced **only** by `reconcile`"*, and
`seal` *"refuses any reference file that is not byte-identical to the reconciliation of the blind
records"*.

## 11. Acceptance criteria

`DELIVERABLES_AND_ACCEPTANCE_CRITERIA.md` §2 (R-1…R-9) and §3 (RA-1…RA-7). The three points worth
repeating:

1. **Disagreement is not a defect.** §9.5 routes every difference to adjudication by design. Neither
   recorder may be marked down for it, and neither may be told the rate.
2. **`NOT_AVAILABLE_FROM_SOURCE` is not a defect.** §5.9: *"A reference value of
   `NOT_AVAILABLE_FROM_SOURCE` is a valid outcome, not inadmissibility."*
3. **An unadjudicated difference is fatal**, so the adjudicator's completeness is the one criterion with
   no tolerance (dt008 `REFERENCE_ADJUDICATION_NOTE.md` §2: refused in both commands that matter).

One recorded defect the adjudicator should know and **must not design around**: a `REFERENCE-CONFLICT`
row publishes the **Author's** value (dt008 `REFERENCE_ADJUDICATION_NOTE.md` §4). It does not corrupt an
endpoint — conflicts are excluded from every denominator (§9.5) — and it must not change any decision.

## 12. Replacement if a slot holder becomes ineligible

`REPLACEMENT_PROCEDURE.md` §2.2, the three reference rows. In summary:

| When | Outcome |
|---|---|
| **Before the seal** | Replaceable, but the replacement re-does **the whole set**, not the remainder: a set part-authored by two people is neither one person's independent record, and §9.5 compares *the Author's* record with *the Confirmer's*. For the adjudicator, the whole disagreement set must be re-decided, because `verify-adjudication-packet` refuses a packet built over a subset |
| **After the seal** | **Not replaceable.** §9.6: *"Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face."* `author`, `confirmer` and `adjudicated_by` are all `REFERENCE_COLUMNS` members (`lib/schema.mjs:213`), so the identities are inside the sealed bytes |
| **A false declaration (T-1), at any point** | §4A.1: *"reference work: the reference truth is not independent"* — and the finding is **published** |

---

## What remains blocked on the operator for these three slots

| # | Blocked | Why |
|---|---|---|
| R-1 | Three people | No candidate exists. §19.3(3) names reference Author, Confirmer and adjudicator as prerequisites before the stage |
| R-2 | Three separately hashed fee agreements, and a hand comparison proving the hashes are pairwise distinct | Nothing in the instrument compares them |
| R-3 | Three organisation confirmations | Issued by the developing organisation |
| R-4 | Who runs `reconcile`, given that the operator must not see reference values before the seal (§9.6) | Running it reveals reconciled values. The separation needs a named holder |
| R-5 | The pseudonym↔person mapping holder, since the adjudicator must not learn Author/Confirmer identities | §4A.1 says "restricted"; it does not say by whom |
| R-6 | The three anchor dates, and the sequencing so the window is sized against the right phase (dt008 `REFERENCE_WORKLOAD_NOTE.md` §4) | No calendar date may appear in this package |

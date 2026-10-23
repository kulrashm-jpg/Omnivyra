# DR-8 — §4A.1 item 6 between co-enumerators: the operational rule

**CLASSIFICATION: PREPARATION. This memo presents options and a recommendation; it decides nothing.**
No protocol byte, no instrument byte, no hashed object modified. No identity, pseudonym, hash or date
invented. Nothing registered, committed, pushed or executed.

**Baseline recomputed for this memo.** `main` `33bceb1f919113c622587fa7c6403a0d4596bbad`;
`research/cpg-u1` tree `2d66f68088e6f230d8ae92b180b6db53c49502b4`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`<NEW_AGG>` (<NEW_N> files) read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`. The worktree's own tooling tree (587 files,
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`) was neither read as the instrument
nor written.

---

## 0. The clause under examination

§4A.1 item 6, protocol line **138**:

> 6. is the spouse or partner, a family member or a household member of, or has a current or former
>    direct reporting relationship with, any person who developed CPG, the operator (key custodian),
>    or any holder of **another** §4A.3 role.

And, line **145**:

> An unknown answer is not "no".

The frozen declaration key, `lib/personnel.mjs:10`:

```
'close_relationship_with_developer_operator_or_role_holder',
```

— "role_holder", **unqualified**, with no "another role" restriction. `lib/personnel.mjs:37` requires
that key to be the literal string `"no"` for **every** assignment.

---

## (a) Must Enumerator A and Enumerator B be mutually independent under item 6?

### RULE A1 — YES. Two co-enumerators must be mutually independent under §4A.1 item 6, and each declares it.

**Basis, in descending force.**

1. **The frozen instrument already asks the broader question.** The declaration key is
   `close_relationship_with_developer_operator_or_role_holder` (`lib/personnel.mjs:10`) — no "another
   role" qualifier. A person who answers `"no"` to that key has, on the form as implemented, denied a
   close relationship with **any** role holder, co-enumerator included. **Adopting the strict reading
   therefore adds no rule to the protocol and needs no amendment**: it is what the register already
   records.
2. **§4A.3 line 184** frames the section around distinct persons: "**Every independent role is held by
   a different person**, and no independent role is held by the operator." Item 6's list is a list of
   *persons to be independent of*, and the co-enumerator is a person holding a §4A.3 role.
3. **Purpose.** §20.18 (line 982) — "Cryptographic sampling integrity … is **not** independent
   candidate selection (the frame is unbiased); the latter rests on enumerator independence only" —
   and §22 row 31 (line 1041) make enumerator independence the *sole* control against a globally
   biased frame. Two spouses co-enumerating would defeat that control while passing every mechanical
   check, which is the worst possible outcome for a study whose value is adversarial verifiability.

**The contrary reading, stated and rejected.** "another §4A.3 role" read strictly-literally means "a
role other than the one I hold", so a co-enumerator (same label `enumerator`) is outside item 6's
list. On that reading two spouses could co-enumerate and `check-personnel` would exit 0. The reading is
available on the words; it is rejected because it makes the frozen declaration key broader than the
clause it implements, and because it empties the only control §20.18 names.

**DECISION REQUIRED — this is textual ambiguity in a NORMATIVE section, so the owner records the
reading. It is not an amendment.** Recommended disposal: one decision-log entry, in the same form as
DR-7 §4.1, stating that item 6 is applied **between co-enumerators** and generally between any two
holders of §4A.3 roles including two holders of the same label. **Record it before the roster is fixed:**
line 145 ("An unknown answer is not 'no'") means a declaration signed before the eighth role-holder
existed cannot cover that person, so a late addition forces a second declaration round.

---

## (b) Do A and B need separate independence declarations?

### RULE A2 — YES. Two complete, separate declaration sets, plus two separate organisation confirmations. This is mechanically enforced; it is not a judgement call.

`checkPersonnelRegister` (`lib/personnel.mjs:16–41`) iterates **every element of `reg.assignments`**
and, for each:

```
36    const d = a.declaration ?? {};
37    for (const k of DECLARATION_KEYS) if (d[k] !== 'no') errors.push(`${where}: declaration ${k} must be "no" …`);
38    if (a.study_fee_agreement_sha256 !== null && !HEX64.test(a.study_fee_agreement_sha256 ?? '')) errors.push(…);
39    if (!HEX64.test(a.organisation_confirmation_sha256 ?? '')) errors.push(`${where}: organisation_confirmation_sha256 … required`);
```

`DECLARATION_KEYS` (`:8–12`) is the seven keys
`employed_by_developing_organisation`, `contract_or_work_for_developing_organisation`,
`payment_other_than_study_fee`, `financial_interest_in_developing_organisation`,
`close_relationship_with_developer_operator_or_role_holder`,
`implemented_cpg_protocol_tooling_or_registry`, `ran_or_saw_cpg_output`.

Two enumerators are **two assignments** (they cannot be one: `:34` raises `ROLE COLLISION` on a repeated
`person_id` whatever the role). Therefore: **2 × 7 = 14 declaration answers, all `"no"`, and 2
`organisation_confirmation_sha256` values of 64 lowercase hex.** A missing or non-`"no"` answer, or a
missing confirmation hash, is an **error** and `check-personnel` refuses.

**Operator check:** run `check-personnel` and require zero errors and zero blockers. Note the known
limit (`C:/tmp/dt007-eight-person/orchestrator/RECONCILIATION_LOG.md`): the check tests only that each
string is `"no"`, so it **exits 0 on a methodologically stale register** — a declaration signed before
the eighth person existed still reads `"no"`. Nothing mechanical catches that. Rule A5 below closes it.

---

## (c) Separate fee agreements — and the ordering question

### (c-i) Separate agreements

### RULE A3 — Each enumerator's fee agreement is separate, or explicitly absent, and each is recorded per person.

§4A.1 item 5, line **137**:

> 5. — *permitted exception:* a fixed fee for the study role, agreed in writing **before** any role
>    material is released, **not contingent** on any result, finding or future engagement; the
>    agreement's SHA-256 is recorded;

and the "Recorded per person" block (lines 140–143): "the fee-agreement hash (**or none**)".

Mechanically, `study_fee_agreement_sha256` is per assignment and may be `null`
(`lib/personnel.mjs:38`: `!== null` before the hex test), so an unpaid volunteer is conformant with
**no** agreement — and then item 5's ordering rule has nothing to bite on, because there is no fee.
A **shared** agreement covering both enumerators is not forbidden, but it would put the same hash in
both assignments and thereby disclose to each, on the face of the register, that a second person is
party to their agreement — so **separate agreements are recommended** for the same reason as (d): to
keep the restricted register restricted.

### (c-ii) THE ORDERING QUESTION — "before any role material is released"

**The ambiguity.** "any role material" is unqualified. Two readings:

- **Reading P (per-person).** Material released **to that person**. The fee agreement must precede
  that person's receipt of their packet.
- **Reading S (study-wide).** Material released **to anyone in the study**. No role material may reach
  any person until every person's fee agreement is in writing.

**Verdict: Reading P is the better reading of the text; Reading S is the conservative operational
rule; and the two can be satisfied together at essentially no cost for a co-enumerator pair.**

Why Reading P is the better *reading*:

1. **Grammar and subject.** Item 5 sits inside a list whose subject is fixed by line 131 — "A person
   is **not independent** … if at any time in the exclusion period **the person**: …". Items 1–4 are
   all about that person's own employment, contracts, payments and interests; item 5 is the *permitted
   exception* that cures item 3 ("received any payment or benefit from it, other than **the fee in item
   5**") **for that person**. The whole list is per-person, and item 5 is the per-person carve-out.
2. **Purpose.** The ordering exists so the fee cannot be negotiated with knowledge of what the role
   involves — i.e. so it cannot become informed by, or contingent on, the material. That hazard is
   wholly personal: another person's sight of their own packet cannot influence this person's fee
   negotiation.
3. **Reading S, taken literally across all roles, contradicts §19.3(3).** Line 959 requires personnel
   "**before the respective stage** (or a recorded absence of raters with the §12 ceiling)", which
   expressly contemplates **staged** recruitment — raters exist by the held-out commitment (§4A.3:189,
   §5.5 step 9), long after enumerators have their packets (§5.5 step 3). Under Reading S no enumerator
   could receive a packet until the rating adjudicator's fee was signed, which would collapse §19.3(3)'s
   staging. A reading that contradicts an express staging permission is the weaker reading.

### RULE A4 — the conservative operational rule (satisfies P and S simultaneously)

> **No role material is released to either enumerator until both enumerators' fee agreements (or both
> recorded absences of a fee) are signed in writing, hashed, and entered in the restricted register.
> Across role cohorts, the rule is per-person: a cohort's material is released once that cohort's
> agreements are complete, and a later cohort's incompleteness does not block an earlier cohort.**

*Why this is cheap and why it is right.* Both enumerators receive the **same** §4A.2 packet, at the
same step of §5.5, for the same work — so "both before either" costs one synchronisation, not a
schedule. It removes the ambiguity entirely for the pair that DR-8 is about, and it simultaneously
answers **(f)** below. Applying the *same* synchronisation across the whole eight-person roster would
be Reading S taken literally, and is **not** recommended, on ground 3 above.

---

## (d) May one enumerator learn the other's identity — and is that required to answer item 6 honestly?

### The tension, stated exactly

Item 6 requires a `"no"` about "any holder of another §4A.3 role". Line 145: "**An unknown answer is
not 'no'**." But §4A.1's recording block (line 140) makes the register **restricted** and puts a
pseudonym in study artifacts:

> **Recorded per person** (restricted register; a pseudonymous ID is used in study artifacts):

So a declarant who does not know who else holds a role is, strictly, answering item 6 about an unknown
set — and an unknown answer is not "no". **This tension is general to all seven roles and pre-exists
the eight-person model entirely**; the second enumerator makes it visible, it does not create it.

### RULE A5 — NO. Neither enumerator learns the other's identity. The operator performs and records the pairwise item-6 check.

**Procedure — six steps, no judgement required.**

1. **Each declarant supplies a relational schedule to the operator alone**, on the same occasion as the
   declaration: the persons who are their spouse or partner, family members and household members, and
   their current and former direct reporting lines (both directions). This is disclosed **only** to the
   operator, who already holds the restricted register, and it never enters any study artifact.
2. **Each declarant answers item 6 `"no"` as a warranty**, in these terms: *"I have no relationship of
   the kinds in §4A.1 item 6 with any person engaged in this study in any §4A.3 role, and the schedule
   I have supplied to the operator is complete."* The declarant's `"no"` is then not an answer about an
   unknown set — it is a complete disclosure plus a warranty, and the operator's check in step 3 is
   what converts it into a checked fact. **The frozen instrument is satisfied unchanged**, because the
   stored value is still the literal string `"no"` (`lib/personnel.mjs:37`).
3. **The operator performs the pairwise comparison** across every unordered pair of role holders —
   including the operator itself and every person who developed CPG — and records the result. For eight
   independent persons plus the operator plus the development team of size *d*, the pair count is
   `C(9 + d, 2)`; for the eight independent persons and the operator alone it is **36**, of which the
   two-enumerator pair is one.
4. **The operator records the attestation in the restricted register**, as a root-level field. The
   frozen `checkPersonnelRegister` validates `schema`, `operator.person_id` and the `assignments`
   array and **ignores unknown root-level and unknown per-assignment keys** — inspected at
   `lib/personnel.mjs:16–41` — so this field is accepted with **no change to the instrument and no
   change to the aggregate**. Suggested shape (names are ours; no value invented):

   ```
   "pairwise_item6_check": {
     "performed_by": "<operator person_id>",
     "performed_on": "<<UNFILLED: YYYY-MM-DD>>",
     "pairs_checked": <<UNFILLED: integer>>,
     "roles_in_scope": ["operator", "enumerator", "reference-author", "reference-confirmer",
                        "reference-adjudicator", "rater-1", "rater-2", "rating-adjudicator",
                        "cpg-developers"],
     "result": "no pair exhibits a §4A.1 item 6 relationship",
     "method_statement_sha256": "<<UNFILLED: 64 hex>>",
     "relational_schedules_held": "restricted; not published; not in any study artifact"
   }
   ```

5. **No identity crosses between declarants.** Each enumerator is told only that the check was
   performed and its outcome — never who else is in the study. Enumerators address each other, if at
   all, only by pseudonymous register ID (§4A.1:140), and per Rule A6 they do not address each other at
   all.
6. **Re-run the check whenever a role holder is added or replaced**, and require every affected
   declaration to be re-signed on or after that date. This is the only defence against the stale-register
   defect in (b): `check-personnel` cannot see that a declaration predates a role holder, so the
   **dates** must be checked by the operator against `pairwise_item6_check.performed_on`.

**Is disclosure *required* for honesty? No — but only because of step 1.** Without the relational
schedule, a bare `"no"` about an unenumerated set would be an unknown answer dressed as a negative,
which line 145 forbids. With it, the declarant discloses everything they can know and the operator
supplies the only thing they cannot. **Step 1 is therefore not optional.**

**The rejected alternative, and why.** Disclose all eight identities to all eight declarants so each
answers item 6 against the actual list. Textually the most direct, and it is not forbidden. Rejected:
it defeats the restricted register (line 140) and, specifically for enumerators, it opens the exact
channel §22 row 31 names — two enumerators who know each other can coordinate frame composition, and
`PARTITION_GOVERNANCE.md` §5 shows that regime is **worse than a single enumerator** because the frame
then carries two independent-looking `enumerated_by` values while its composition was jointly authored.

**Residual, disclosed not smoothed:** under Rule A5 the truth of the item-6 pairwise check rests on the
operator, who is **not independent** (§4A.3:174). That is not a new dependency — the operator already
holds the restricted register, and §23 line 1055 already records enumerator independence as
"Not cryptographic" — but the registration narrative should say that the pairwise check is an operator
attestation, so that no reader mistakes it for a verified fact.

---

## (e) May one enumerator see the other's rows or progress?

### RULE A6 — NO, to both, and no exchange is operationally necessary.

**§4A.2's receive-list is exhaustive** (lines 163–168):

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, §5.1–§5.4;
> - the jurisdiction-family list;
> - the development-only registry.

A co-enumerator's rows, identity, volume, running count or progress are **not on that list**. Line 170
adds: "**They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)."

**A genuine disagreement in the prior waves, resolved here.** `PARTITION_GOVERNANCE.md` P6 records that
*nothing forbids* enumerator-to-enumerator communication (contrast §9.1:563–564, which bars it
expressly for the reference Author/Confirmer, and §9.2:569, "They never receive … each other's
records"); `INFORMATION_BARRIER_ANALYSIS.md` §5 records the opposite, that another enumerator's rows
are "not on the exhaustive receive-list". **Both are right about different things**, and the
distinction is *who does the giving*:

- The receive-list governs **what the study releases to an enumerator**. On that, the answer is closed:
  the operator may not hand A anything of B's. **FORBIDDEN.**
- Nothing in the protocol governs **what two enumerators say to each other** once engaged. That is
  silence, and silence is design space, not permission.

**So the rule is an operational one, and it is easy, because the exchange has no purpose.** Split by
sub-question:

| Item | Rule | Why |
|---|---|---|
| The other's **rows** (identifiers, domains, company names) | **No exchange.** | The only reason to exchange rows is duplicate avoidance, and the design removes that need *ex ante*: disjoint jurisdiction families; the "assign the most specific accessible family, `LEI-ONLY` only for an entity outside the three accessible national families" rule; and disjoint `candidate_id` prefixes. The *ex post* guard is the operator's, not theirs: `assertUnique` (`lib/select.mjs:44–51`) refuses a duplicate `scheme:value` or a duplicate `canonical_domain` at `check-frame-sufficiency`, per §5.7:380 "**Uniqueness** [enforced]: one row per legal entity." |
| The other's **progress, volume or running count** | **No exchange, and no operator disclosure.** | This is the DR-9 leak channel. Two enumerators comparing counts reconstruct the combined running count, and over two rounds the combined count localises the §5.7.2 threshold. Barred by line 170's "quotas … (§5.5, §5.7.2)". |
| The other's **identity** | **No exchange** (Rule A5). | Restricted register, line 140. |
| Their **own** rows, own running count, own `frame` row-level results | **Permitted.** | §4A.2 constrains what an enumerator *receives*; it does not constrain knowledge of their own work. Row-level `MALFORMED_ROW` diagnostics and per-row admissibility exclusion reasons are `checkFrameRow`'s enforcement of §5.1–§5.4, which they already have, and carry no count. |

**One hazard this rule does not close, and it is the operator's:** two enumerators may record the
**same legal entity** with a *different* decisive identifier **and** a *different* canonical domain.
`assertUnique` compares only `idKey(c)` and `canonical_domain`, so it is blind to that, and §5.7:380's
"one row per legal entity" is then silently violated. Cross-partition entity reconciliation must be
done by someone, an enumerator may not do it (they would see the other partition) and the reference
adjudicator may not (§4A.3:187). **DECISION REQUIRED — who reconciles?** (Carried forward from
`INFORMATION_BARRIER_ANALYSIS.md` OQ-5; not resolved here.)

---

## (f) May either enumerator receive study material before the other's paperwork is complete?

### RULE A7 — NO. The release gate is joint for the enumerator cohort, and it is a checklist, not a judgement.

**No role material is released to either enumerator until, for BOTH, all six of the following are
complete and recorded in the restricted register:**

1. the signed §4A.1 declaration, all seven `DECLARATION_KEYS` answered `"no"`, dated on or after the
   date the other enumerator became a role holder;
2. the item-6 relational schedule supplied to the operator (Rule A5 step 1);
3. the developing organisation's written confirmation, hashed —
   `organisation_confirmation_sha256`, 64 lowercase hex, mandatory (`lib/personnel.mjs:39`);
4. the fee agreement signed and hashed, **or** `study_fee_agreement_sha256: null` recorded as a
   deliberate no-fee engagement (Rules A3/A4);
5. the operator's `pairwise_item6_check` performed and recorded, covering both (Rule A5 steps 3–4);
6. `check-personnel` run and reporting **zero errors and zero blockers**.

**Grounds.**

- **Item 5's ordering, under either reading.** Reading S requires it outright. Reading P requires it for
  each person's own material, and Rule A4 makes the pair joint, so both are satisfied.
- **Line 145 forces it.** "An unknown answer is not 'no'." If A's packet is released before B is a role
  holder, A's item-6 declaration **cannot** have covered B, and no later signature by B repairs A's.
  The only cure is a re-declaration round by A — which is the late-addition cost that
  `VERIFIED_BASELINE.md` §6b prices as capable of **reversing** the eighth person's entire benefit
  (negative in 252 of 648 grid cells at central late-addition cost). **This rule is what keeps the
  eighth person net-positive.**
- **§4A.2(b) is unaffected either way** — "not have run CPG or seen any CPG output … before completing
  the frame" — because no packet contains CPG output.

**Note the asymmetry the rule deliberately keeps.** The gate is joint **within** the enumerator cohort
and per-cohort **across** cohorts (Rule A4). Raters are recruited by §5.5 step 9 and §4A.3:189, long
after enumeration; their incompleteness must not block step 3, and §19.3(3)'s "before the respective
stage" says so in terms.

---

## Summary — the seven rules

| # | Rule | Status |
|---|---|---|
| **A1** | A and B must be mutually independent under §4A.1 item 6; each declares it. | **DECISION REQUIRED** (record the reading; no amendment — the frozen declaration key already asks it) |
| **A2** | Two separate, complete declaration sets and two organisation confirmations. | **MECHANICALLY ENFORCED** — `lib/personnel.mjs:36–39` |
| **A3** | Separate fee agreements, or a recorded absence; per person. | **RECOMMENDED** (a shared agreement is permitted but leaks the pairing) |
| **A4** | Fee-ordering: joint within the enumerator cohort, per-person across cohorts. | **RECOMMENDED** — satisfies both readings of item 5 |
| **A5** | Neither learns the other's identity; declarants supply relational schedules; the operator performs and records `pairwise_item6_check`; re-run on any roster change. | **RECOMMENDED** — no instrument change; unknown register keys are ignored |
| **A6** | No exchange of rows, progress, counts or identities; own work only; operator de-duplicates. | **RECOMMENDED** — receive-list closed for what the study releases; operational rule for the rest |
| **A7** | No material to either until both sets of paperwork are complete and `check-personnel` is clean. | **RECOMMENDED** — and it is what keeps the eighth person net-positive |

**Still DECISION REQUIRED after this memo:** (i) the owner's ruling on A1's reading; (ii) who performs
cross-partition entity reconciliation (§(e) hazard / OQ-5); (iii) whether the registration narrative
should disclose that the item-6 pairwise check is an operator attestation (recommended: yes).

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


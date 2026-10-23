# AMENDMENT_VERDICT — does an eighth person, as a second enumerator, require a protocol amendment?

DEEPTECH-PARALLEL-007, AGENT A. **METHODOLOGY REVIEW ONLY. No frozen byte changed.**
Protocol `research/cpg-u1/CPG_U1_PROTOCOL_004.md` @ sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.
Instrument aggregate `<NEW_AGG>` (<NEW_N> files) — both recomputed.

## 1. THE VERDICT

> **NO PROTOCOL AMENDMENT IS REQUIRED.** An eighth independent person, added as a **second
> enumerator**, is permitted by CPG_U1_PROTOCOL_004 as frozen, and is accepted by the frozen
> instrument as frozen. Neither the protocol sha256 nor the tooling aggregate needs to change; there
> is no re-freeze, and no registration field is affected.

Authority, in descending order of force:

1. **§4A.3 line 186** — "Several enumerators are permitted; each holds no other role." An express
   permission in a NORMATIVE, APPROVED section.
2. **§4A.3 line 185** — "The seven independent roles are mutually exclusive: **minimum 7 independent
   persons**." The headcount rule is a floor, in terms.
3. **§4A.3 line 176** — "enumerator (≥ 1)". A floor with no ceiling.
4. **`lib/personnel.mjs:26`** — `else if (role !== 'enumerator' && n > 1) errors.push(…)`: the
   instrument rejects a plurality for every role *except* enumerator.
5. **`test/selftest.mjs:824`** — a **passing self-test named "multiple distinct enumerators
   permitted"**, inside the <NEW_N>-file tree whose aggregate is a registration object. The freeze *as
   implemented* asserts the eight-person register is conformant. (`:825` refuses a second `rater-1`,
   showing the distinction is deliberate.)

The added person must satisfy §4A.2(a)–(e) (lines 156–161), §4A.1 (131–145) including the signed
declaration and the developing organisation's confirmation (140–143), and §4A.3:187 (may not be the
reference adjudicator). No new clause is needed to impose any of that; it already applies to "every
person performing a §5 task" (line 194).

## 2. THE ONE CLAUSE THAT CREATES DOUBT — named, not softened

> **§19.3(3), protocol line 959, final sentence: "Seven mutually exclusive independent persons."**

This is the only clause in the frozen text under which an eighth person can be argued to fail a
**freeze requirement** (§19 is titled "Freeze (registration) requirements", line 923). The contrary
reading is: it is a bare cardinal with no minimum marker, in the same sentence in which the author
*did* write "≥ 2 raters" where a minimum was meant; by *expressio unius* within one sentence, "Seven"
is exact; an eight-person roster therefore does not satisfy §19.3(3) as written; and §15.5(7)
("A protocol violation discovered mid-run … this also **halts** — §18") supplies the consequence.

**I judge that reading wrong.** §19.3's own heading says its items are "**not decisions**; must exist
before the stated act" — a prerequisite is a floor by nature and cannot be the source of a cap absent
from §4A, which §19.1:935 names as the closed rule. "Mutually exclusive" is a property of *roles*, not
persons, so the sentence is grammatically a compression of §4A.3:185, whose numeral is expressly a
minimum. The exact-count reading makes both "enumerator(s)" in the same sentence and "Several
enumerators are permitted" (186) dead letters. Nothing implements a cap: no registration field
(`lib/registration.mjs:33–57`; `checkRegistration`, `:66–114`, never mentions personnel), no §5.10
VOID state (420–439), no §15.5 condition (859–868), and no §21 step (991–1002) counts persons; the
only personnel command counts *roles* (`cpg_u1_data.mjs:656–663`, success line at `:662`). And the
registered instrument tests the eight-person case as conformant.

**But the doubt is real and it is the owner's to dispose of.** A hostile outsider who has read §19 and
not §4A can raise the cap reading; they cannot mechanise it, but a study whose value rests on
adversarial verifiability should not have that exchange for the first time after registration.
**This is reported as a STOP-class item, per the brief, and must not be reported as clean.**

**Disposal options** (my recommendation is A):

- **A — Recorded interpretation (no amendment, no re-freeze).** One entry in the decision log, and one
  line in the OSF registration narrative, stating that §19.3(3) is read as a minimum, citing lines
  176, 185, 186 and `test/selftest.mjs:824`. Changes no frozen byte; costs nothing; pre-empts the
  objection in the public record. **Recommended.**
- **B — Amendment.** Touches the protocol sha256 and therefore the whole freeze; the clause to edit
  would be line 959 ("Seven mutually exclusive independent persons." → "**At least** seven mutually
  exclusive independent persons."). **Disproportionate to a wording tidy, and it re-opens the entire
  re-freeze cost** (see `human-min/G-amendment/REFREEZE_COST.md`, which is a different stream's
  product and which I did not modify).
- **C — Avoid the question: register with one enumerator.** Available, and it forfeits the only
  evidentially positive effect the eight-person model has (`PARTITION_GOVERNANCE.md` §6).

## 3. A SECOND CLAUSE NEEDING AN OWNER DECISION — also no amendment

> **§4A.1 item 6, protocol line 138:** "is the spouse or partner, a family member or a household
> member of, or has a current or former direct reporting relationship with, any person who developed
> CPG, the operator (key custodian), or any holder of **another** §4A.3 role."

Whether "another §4A.3 role" reaches a **co-enumerator** (who holds the *same* role label) is textually
ambiguous. Under the strict-literal reading two spouses could co-enumerate and pass every mechanical
check — which would eliminate the entire frame-independence benefit of the eighth person while
appearing to deliver it.

**No amendment is needed to close it.** The frozen instrument's declaration key is
`close_relationship_with_developer_operator_or_role_holder` (`lib/personnel.mjs:10`) — "role_holder",
unqualified — so the stricter reading is already what the declaration form asks, and adopting the
stricter of two readings adds no rule to the protocol. **Record, before the roster is fixed, that item
6 is applied between co-enumerators.**

## 4. What must be pre-registered about the partition — nothing

Three regimes must be distinguished, and the protocol treats them differently:

| Regime | Meaning | What it covers for enumeration |
|---|---|---|
| **REGISTERED** | in the OSF record before enumeration begins (§5.5.1:291–302, §19.1:927–941) | **Nothing about enumerators.** §19.1 has no personnel item; it registers the *rules* ("personnel independence and blinding … **closed** (… §4A …)", line 935), not the *people*. The registration template has no personnel field (`lib/registration.mjs:33–57`) and `checkRegistration` never mentions personnel (`:66–114`). §19.3(3):959 requires personnel to **exist** "before the respective stage", not to be registered — and for enumerators that stage *follows* registration (§5.5 steps 2→3, lines 264–266), so the roster **cannot** be a registration item by construction. |
| **COMMITTED** | inside the on-chain `OP_RETURN` digest before the randomness block exists (§5.5.3:313–317) | **Per-row enumerator attribution is committed**, because `enumerated_by` is one of the 22 `FRAME_COLUMNS` and `frame_hash = hashRecords(frame,'candidate_id')` serialises the whole row (`cpg_u1_data.mjs:94`, `lib/canonical.mjs:16–21`). It cannot be retro-assigned. Its *truth* is not proven (`lib/schema.mjs:124` checks only non-emptiness; nothing joins the frame to the register). |
| **PUBLISHED** | in the mandatory archive (§13.2:809–811, §13.2A:813–815) | **"the single frame F"** is in the mandatory sampling archive (line 815), so every row's `enumerated_by` reaches the §21 outsider. The only *personnel* publication duty in the protocol is the §4A.3:189 fingerprint of the `rater-1` / `rater-2` / `rating-adjudicator` label assignment, published before the held-out commitment, and repeated in §13.2:811 — **enumerators are not in that list.** |

**Therefore: neither the enumerator roster, nor the frame's provenance, nor any work allocation must
be registered.** The frame's provenance is committed and published; the roster and the allocation are
neither required nor forbidden anywhere.

**Recommended (optional, not required):** publish the partition rule in the OSF registration narrative
*before enumeration begins*. The registration record's top-level key set is not exhaustively
constrained (`checkRegistration` validates required fields and only `parameters` is exact-key,
`lib/registration.mjs:81`), and the OSF narrative is free text, so this costs nothing and touches no
frozen object. It is what converts the partition from unrecorded operator discretion into a
pre-committed rule — and that is exactly the premise the row-31 argument in
`PARTITION_GOVERNANCE.md` §6 depends on. **Confirm the registration-narrative mechanics with the
registration stream before relying on it; I did not modify `registration/`.**

## 5. Summary table

| Question | Answer | Clause |
|---|---|---|
| Is an 8th person as 2nd enumerator permitted with no amendment? | **YES** | §4A.3:176, 185, 186; `personnel.mjs:26`; `selftest.mjs:824` |
| Is §19.3(3)'s "Seven …" a minimum or an exact count? | **Minimum** (my verdict) — but a contrary reading exists and is named | §19.3(3), line 959 |
| Does any reading put an 8th person in breach of a **freeze** requirement? | **YES — one.** §19.3(3) line 959, final sentence, read as an exact count. Reported as STOP-class; owner to dispose of; disposal A costs no frozen byte. | line 959 |
| What governs how two enumerators divide work? | Nothing divides it; 15 REQUIRED constraints bound it, 6 express permissions enable it, 12 silences are open — 2 of them decisive | `PARTITION_GOVERNANCE.md` §2–§4 |
| Must Enumerator A be independent of Enumerator B? | §4A.2(e)→§4A.1 applies to each; item 6's reach between co-enumerators is **ambiguous** and must be resolved on the record (strict reading needs no amendment) | line 138; `personnel.mjs:10` |
| Is communication between enumerators forbidden, or blinding required? | **No** — and the contrast with §9.1's express Author/Confirmer bar is deliberate and methodologically coherent: enumeration is a union, not a double-entry reliability structure | 563–564, 569 vs whole-document silence |
| Must anything about the partition be pre-registered? | **No.** Registered: nothing. Committed: per-row `enumerated_by`. Published: the frame F. | §19.1, §19.3(3); §5.5.3; §13.2A:815 |
| Attack-matrix effect of a 2nd enumerator? | **Conditionally positive** (criterion-defined disjoint partitions, self-sourced candidates, mutually independent enumerators); **neutral** unstructured; **negative** if the operator allocates candidates. Row 31 stays UNRESOLVED; claim (2) never becomes cryptographic. | 1041, 1046, 982, 1055, 1067 |
| Amendment needed? | **NO.** Two recorded interpretations are advisable (§19.3(3) as a minimum; §4A.1 item 6 between co-enumerators) and one operational rule is necessary (no operator-allocated candidate lists). None is an amendment. | — |

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


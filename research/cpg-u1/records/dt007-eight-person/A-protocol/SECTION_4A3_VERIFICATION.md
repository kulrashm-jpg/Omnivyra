# SECTION_4A3_VERIFICATION — multiple enumerators in the frozen text

DEEPTECH-PARALLEL-007, AGENT A. **METHODOLOGY REVIEW ONLY. No frozen byte changed.**

All line numbers are lines of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` (1098 lines) at
main `af2fb6e99ce461894bf16f18c2251f75088eba18`, protocol sha256
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.
Tooling line numbers are lines of the corresponding file under `research/cpg-u1/tooling/`.

## 0. Baseline re-verified independently

| Object | Expected | Recomputed | Result |
|---|---|---|---|
| worktree HEAD (`C:/tmp/dt4-reg`) | `af2fb6e99ce461894bf16f18c2251f75088eba18` | same | MATCH |
| `research/cpg-u1` tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | `git rev-parse HEAD:research/cpg-u1` → same | MATCH |
| protocol sha256 | `c50fc680…00b719` | `sha256sum` → same | MATCH |
| instrument aggregate, <NEW_N> files | `<NEW_AGG>` (`<NEW_AGG>`) | ran the frozen `lib/aggregate.mjs` read-only over `C:/tmp/dt002/research/cpg-u1/tooling` → <NEW_N> files, `<NEW_AGG>` | MATCH |

Note for the record: the **worktree's own** `research/cpg-u1/tooling` is a *different, smaller* tree —
587 files, aggregate `b11e0066a4a64a2203605061a3a8c1109da4a2dab88465f6985c7030c0c9e11d`. The
registered instrument is the <NEW_N>-file tree in `C:/tmp/dt002` (uncommitted), exactly as
`registration/REGISTRATION_PACKAGE.md:20` states. Nothing was written to `dt002`; the aggregate was
recomputed by importing the frozen module with the process CWD set to that tree.

## 1. The orchestrator's three claims — each confirmed verbatim

### 1.1 §4A.3 — CONFIRMED, with one wording correction

Line 176 (role list):

> - enumerator (≥ 1);

Line 185:

> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**.

Line 186:

> - Several enumerators are permitted; each holds no other role.

Line 187:

> - An enumerator may not be the reference adjudicator. The adjudicator decides contested reference
>   values, and the enumerator authored the class predictions whose mismatches with reference truth
>   are published (§9.2, §9.7).

Line 184, the sentence those bullets qualify:

> **Every independent role is held by a different person, and no independent role is held by the operator.**

**Correction to the brief:** the orchestrator's paraphrase "§4A.3 … states 'Several enumerators are
permitted; each holds no other role.' and 'An enumerator may not be the reference adjudicator.'" is
exact. The only correction needed is one of emphasis: line 185 does **not** say "seven persons" — it
says the seven **roles** are mutually exclusive, and derives from that a **minimum** of 7 **persons**.
The numeral seven is a count of *role labels* (exact, and exactly the seven in
`lib/personnel.mjs:6`); the headcount it implies is a *floor*. That distinction is the whole of the
§19.3(3) question and is treated in §2 below.

### 1.2 `lib/personnel.mjs:26` — CONFIRMED verbatim

```
26    else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
```

Context (lines 23–27): each of the seven `INDEPENDENT_ROLES` (line 6) is counted; `n === 0` is a
**blocker** ("role … is UNFILLED"), and `n > 1` is an **error for every role except `enumerator`**.
So the instrument permits a plurality for enumerator and for no other role — exactly as stated.

Two further facts the brief did not mention, both load-bearing:

- `lib/personnel.mjs:34` raises `ROLE COLLISION` on a repeated `person_id` **regardless of role**, so
  the same person listed twice as enumerator is refused. A second enumerator must be a second person.
- The frozen instrument contains a **positive self-test for exactly this case** —
  `test/selftest.mjs:824`:
  ```
  { const r = personnel(); r.assignments.push({ ...r.assignments[0], person_id: 'SYN-P-ENUM2', pseudonym: 'e2' }); ok(chk(r).errors.length === 0, 'multiple distinct enumerators permitted'); }
  ```
  and its 7-person counterpart at `selftest.mjs:816` ("personnel: 7 distinct independent people …
  accepted"), with `selftest.mjs:825` refusing a **second rater-1**. An **8-person register with two
  enumerators is an asserted, tested conformance case of the instrument whose aggregate is a
  registration object.** This is the strongest single piece of evidence in the whole review.
- `cpg_u1_data.mjs:662`, the `check-personnel` success line, reads "seven independent **roles**
  filled, mutually exclusive, operator in none, declarations complete" — role-count language, which
  remains literally true with eight persons.

### 1.3 Frame columns and `enumerated_by` — CONFIRMED, and stronger than stated

`lib/schema.mjs:12,32–34` — `FRAME_COLUMNS` ends with `enumerated_by`, `enumerated_at`,
`enumeration_source_url`. `lib/schema.mjs:124–126`:

```
124   if (!r.enumerated_by.trim()) errors.push('enumerated_by is required');
125   if (!isCalendarDate(r.enumerated_at)) errors.push('enumerated_at must be YYYY-MM-DD');
126   if (!isHttpsUrl(r.enumeration_source_url)) errors.push('enumeration_source_url must be an https URL');
```

**Confirmed: nothing validates `enumerated_by` against the personnel register.** Grepping the whole
instrument, `enumerated_by` appears only in `lib/schema.mjs` (declaration + the non-empty check) and
in `test/selftest.mjs` fixtures. There is no join between the frame CSV and
`cpg-u1-personnel/v1`, in either direction.

Three facts the brief did not state, all of which matter downstream:

1. **`enumerated_by` is inside the on-chain commitment.** `cpg_u1_data.mjs:94` computes
   `frameHash = hashRecords(frame, 'candidate_id')`, and `lib/canonical.mjs:16–21` serialises the
   **whole row object** (all 22 `FRAME_COLUMNS`). `frame_hash` is a payload key
   (`lib/commitment.mjs:12`) and the payload digest is the 32 bytes in the `OP_RETURN`
   (protocol §5.5.3, lines 313–317). Therefore **per-row enumerator attribution is committed before
   the randomness block exists** and cannot be retro-assigned. The same holds for the append-only
   proof's `development_row_hashes_sha256` (`cpg_u1_data.mjs:80–81`, `lib/commitment.mjs:15,69`).
2. **The frame column set is exact — a partition column cannot be added.** `cpg_u1_data.mjs:64–69`
   (`loadCsv`) fails on *missing or extra* headers: "columns must match the template exactly". Any
   partition metadata must therefore live outside the frame CSV, or be encoded in the free-text
   `enumerated_by` value.
3. **The screening log's `screened_by` is one scalar per stage, not per row.** `cpg_u1_data.mjs:131`
   declares `screened_by` in `LOG_COLUMNS`; `:146` writes the single CLI value `need(o,'screened-by')`
   into every row (`:418` development, `:513` held-out). So §15.3's log does **not** record which
   enumerator produced which row — only the frame does.

## 2. Question 1 — is the eighth person permitted with NO amendment?

### 2.1 Every clause bearing on it

| Line | Clause (quoted) | Bearing |
|---|---|---|
| 176 | `- enumerator (≥ 1);` | Express lower bound, **no upper bound**. |
| 184 | "**Every independent role is held by a different person, and no independent role is held by the operator.**" | Distinctness; says nothing about a cap. |
| 185 | "The seven independent roles are mutually exclusive: **minimum 7 independent persons**." | The headcount rule, expressly a **minimum**. |
| 186 | "Several enumerators are permitted; each holds no other role." | **Express permission** for the eighth person, plus the constraint it carries. |
| 187 | "An enumerator may not be the reference adjudicator. …" | Applies to each enumerator; satisfied by construction. |
| 189 | "The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded in the personnel register, and its SHA-256 fingerprint is published … **before the held-out commitment transaction is broadcast** (§12.1). Tooling: `check-personnel` verifies structure …" | The only personnel *publication* duty; enumerators are **not** in its list. |
| 156–161 | "An enumerator must: (a) not have implemented CPG, this protocol, the tooling or the development-only registry; (b) not have run CPG or seen any CPG output … before completing the frame; (c) not be the operator (key custodian); (d) hold no other §4A.3 role; (e) satisfy §4A.1." | Applies to **each** enumerator separately; a second enumerator must satisfy all five. |
| 163–170 | "**Enumerators receive only:** public sources; the frame template; §4A, §5.1–§5.4; the jurisdiction-family list; the development-only registry." / "**They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)." | Applies per enumerator; constrains what a partition instruction may contain (see `PARTITION_GOVERNANCE.md`). |
| 194 | "Every person performing a §5 task satisfies §4A." | Closes the loop: a second enumerator is a §5 performer and is bound. |
| 131 | "A person is **not independent**, and may hold no role in §4A.3, if at any time in the exclusion period the person: …" | §4A.1 binds each enumerator. |
| 149 | "**enumerator work:** the frame is not independent (§20.18);" | Consequence of a false declaration is **frame-level**, no per-row carve-out. Doubles the exposure with two enumerators (a cost, not a bar). |
| 959 | §19.3(3), incl. "Seven mutually exclusive independent persons." | The **only** clause under which eight could be argued to fail. §3 below. |
| 1046 | §22 row 34: "Role conflicts … | PREVENTED structurally in the register; truthfulness PROCEDURAL | §4A; `check-personnel`" | The control is mutual exclusion, which `check-personnel` enforces over any number of enumerators. |

### 2.2 Verdict

**The eighth person, added as a second enumerator, is PERMITTED BY THE FROZEN TEXT WITH NO PROTOCOL
AMENDMENT.** Line 186 is an express permission in a NORMATIVE, APPROVED section; line 176 states a
floor with no ceiling; line 185's headcount is expressly a minimum; the frozen instrument permits it
at `personnel.mjs:26` and *asserts* it as conformant at `selftest.mjs:824`. No clause caps the
enumerator count, and no VOID state in §5.10 (lines 420–439) or INCONCLUSIVE condition in §15.5
(lines 859–868) refers to a personnel count.

**One clause creates residual interpretive doubt and must be reported, not smoothed: §19.3(3), line
959, final sentence.** See §3.

## 3. Question 2 — §19.3(3), line 959: minimum or exact count?

### 3.1 The text, in its heading's context

Line 955 (heading):

> ### 19.3 Named prerequisites (not decisions; must exist before the stated act)

Line 959 (item 3, verbatim):

> 3. **Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference
>    Author, Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective
>    stage (or a recorded absence of raters with the §12 ceiling). Seven mutually exclusive
>    independent persons.

### 3.2 VERDICT: MINIMUM. Eight satisfies §19.3(3).

I reached this independently and it agrees with the orchestrator's reading; the orchestrator's four
grounds (a)–(d) all survive testing. I add four more that the brief did not have, and then state the
contrary reading without softening it.

**(a) The heading forecloses the cap reading.** "Named prerequisites (**not decisions**; must exist
before the stated act)". A section that disclaims being a decision cannot be the source of a
normative cap absent from §4A — if "Seven" were an exact count, §19.3 would be *deciding* a
personnel ceiling that §4A.3:185/186 does not impose, in a section that says it decides nothing.
§19.1:935 confirms the direction of authority: "personnel independence and blinding … **closed**
(CPG-043 approvals; §4A, …)" — §4A is the closed rule, §19.3 the prerequisite tally.

**(b) "enumerator(s)" is in the same sentence.** Under the exact-count reading the plural marker can
*never* be exercised: 1 enumerator + 3 reference + 2 raters + 1 rating adjudicator = 7 exactly, so any
second enumerator breaches the cap. That reading makes both line 176's "≥ 1" unable to exceed 1 and
line 186's "Several enumerators are permitted" a dead letter. A reading that voids two express
permissions in a NORMATIVE, APPROVED section, in order to give a summary tally cap force, is the
weaker reading.

**(c) "mutually exclusive" is a property of roles, not of persons.** Persons are not "mutually
exclusive" of one another in any meaningful sense; *roles* are. Line 959's final sentence is
therefore a compression of line 185 — "The seven independent **roles** are mutually exclusive:
**minimum 7 independent persons**" — and line 185's numeral is expressly a floor. Read as a
restatement (which its grammar forces), §19.3(3) inherits "minimum".

**(d) Same-sentence minimum notation cuts both ways, and the asymmetry is explicable.** The brief's
ground (c) — "≥ 2 raters" shows the author writes minima explicitly — is the *strongest contrary
argument* and I do not dismiss it. But the asymmetry has a reason: "≥ 2 raters" is a **normative
floor imported from §12:725** ("**≥ 2 independent**"), which is a rule about how many raters a
*scored observation* needs (§12:731). The trailing sentence is not a rule at all; it is the arithmetic
sum of the roles just listed, present to tell the reader the list cannot be satisfied by fewer people
wearing several hats. Its function is anti-conflation, not anti-addition.

**(e) The registered instrument resolves it in practice.** The tooling aggregate is itself a freeze
object (§19.1:930, §5.5.1:297, and the registration record's `tooling_aggregate_sha256`). The
instrument at that aggregate (i) permits a plurality of enumerators only
(`lib/personnel.mjs:26`), (ii) contains a passing self-test named "**multiple distinct enumerators
permitted**" (`selftest.mjs:824`), and (iii) reports success in role-count language
(`cpg_u1_data.mjs:662`). **The freeze as implemented admits eight.** For the exact-count reading to
win, one must hold that the registered instrument contradicts the registered protocol on a point the
instrument explicitly tests — and then explain why `selftest.mjs:825` bothers to refuse a second
rater-1 while `:824` accepts a second enumerator.

**(f) No mechanism implements a cap.** §5.10 (420–439) enumerates every VOID/abandonment state:
none concerns personnel counts. §15.5 (859–868) enumerates every run-level INCONCLUSIVE condition:
none concerns personnel counts. §21 (991–1002) is the outsider procedure: its personnel-touching
step is nothing — `check-personnel` is not even in the §21 list, and where it is invoked
(`cpg_u1_data.mjs:656–663`) it counts roles, not persons. The registration record contains **no
personnel field at all** (`lib/registration.mjs:33–57`; `checkRegistration`, `:66–114`, never
mentions personnel). An exact-count freeze requirement with no registration field, no verifier check
and no VOID state would be a freeze requirement that the protocol's own machinery cannot express.

### 3.3 The contrary reading, stated plainly — this is the STOP item

**There is a reading under which an eighth person breaches a freeze requirement, and the clause is
§19.3(3), protocol line 959, final sentence: "Seven mutually exclusive independent persons."**

The argument for it: it is a **bare cardinal with no minimum marker**, in a section titled "Freeze
(registration) requirements" (§19, line 923), in the same sentence in which the author *did* write
"≥ 2" where a minimum was meant. Applying *expressio unius* inside a single sentence — the author
marked one bound and not the other — yields "exactly seven". Under that reading an eight-person
roster does not satisfy §19.3(3) as written, and by §15.5(7) ("A protocol violation discovered
mid-run … this also **halts** — §18") a violation of a §19 requirement discovered mid-run is a halt
condition. That is the full chain, and it is not nonsense.

**What I judge, and what I will not soften:**

- I judge the minimum reading correct, on grounds (a)–(f), with the role/person distinction (c) and
  the tested instrument (e) as the decisive ones.
- A hostile outsider verifying under §21 **cannot mechanise** the objection: there is no check, no
  field and no VOID state that counts persons; the only routes are rhetorical (a published critique)
  or §15.5(7)/§18 via an argued textual violation.
- I therefore expect a hostile outsider to take the **minimum** reading once shown lines 176, 185, 186
  and `selftest.mjs:824` — but an outsider who has read only §19 and not §4A could reasonably raise
  the cap reading first, and a study whose whole value proposition is adversarial verifiability
  should not want that exchange to happen after registration.
- **This is a genuine residual doubt on a freeze requirement, and it is the owner's to dispose of,
  not mine.** The disposal options are set out in `AMENDMENT_VERDICT.md` §4. The cheapest disposal is
  a recorded interpretation (a one-line entry in the decision log / registration narrative citing
  lines 176, 185, 186, 959 and `selftest.mjs:824`), which changes no frozen byte. It is not a
  protocol amendment and does not touch the protocol sha256 or the tooling aggregate.

## 4. Question 4 — independence between the two enumerators

### 4.1 §4A.1 applies to each enumerator

§4A.2(e), line 161: "(e) satisfy §4A.1." §4A.1's opening, line 131: "A person is **not independent**,
and may hold no role in §4A.3, if at any time in the exclusion period the person: …". Line 194
repeats it for all §5 work. So each enumerator is separately bound by items 1–6.

### 4.2 §4A.1 item 6, quoted verbatim (line 138)

> 6. is the spouse or partner, a family member or a household member of, or has a current or former
>    direct reporting relationship with, any person who developed CPG, the operator (key custodian),
>    or any holder of **another** §4A.3 role.

### 4.3 Does it bind between two enumerators? AMBIGUOUS — and this is a real gap

- **Strict-literal reading:** "another §4A.3 role" = a role *other than the one I hold*. A
  co-enumerator holds the *same* role label (`enumerator`). On that reading item 6 does **not** reach
  a co-enumerator, and two spouses could co-enumerate and pass `check-personnel`.
- **Purposive reading:** "any holder of another §4A.3 role" = any *other person holding a role under
  §4A.3*. On that reading it plainly reaches the co-enumerator.

I find the purposive reading correct, and the frozen instrument supports it: the declaration key is
`close_relationship_with_developer_operator_or_role_holder` (`lib/personnel.mjs:10`) — "**role_holder**",
unqualified, with no "another role" restriction — and §4A.3:184 frames the section around distinct
persons ("Every independent role is held by a different person"). §4A.1:141 requires the signed
declaration to answer item 6 "no", and the instrument's key is the broader one, so **the conservative
reading is already implementable with the frozen instrument and needs no amendment**: adding a
constraint the declaration form already asks about is not a protocol change.

**But the protocol text is ambiguous on the one relational exclusion that matters most for the
eight-person model's only evidential benefit.** Two co-enumerators who are spouses would destroy the
frame-independence argument of `PARTITION_GOVERNANCE.md` §5 while passing every mechanical check.
**Named for the owner: §4A.1 item 6, protocol line 138.** Disposal: record, before the roster is
fixed, that item 6 is applied between co-enumerators (the stricter reading). No frozen byte changes.

### 4.4 Communication and blinding between enumerators: nothing forbids either

The protocol forbids communication **expressly, and only, for the reference pair.** §9.1, line 563
(Author, "Must not" column):

> Have implemented CPG, the protocol or the tooling; see any CPG output (including the development
> pilot); **communicate with the Confirmer before both have submitted**

line 564 (Confirmer):

> Same as Author; **see the Author's record before submitting**

and §9.2, line 569: "**They never receive CPG output, each other's records, or the class
prediction.**" Raters are separately blinded to each other (§12:728). An exhaustive grep of the
protocol for `enumerat*` (lines 62, 66, 68, 149, 154, 156, 163, 176, 186, 187, 218, 266, 288, 390,
409, 565, 959, 982, 986, 1041, 1046, 1055) returns **no bar on enumerator-to-enumerator
communication, no blinding requirement between enumerators, and no requirement that one enumerator
not see another's rows.** Against §9.1's express bar for the analogous pair, that silence reads as
deliberate (*expressio unius*).

**That is methodologically coherent, because enumeration is not a double-entry reliability
structure.** The Author/Confirmer pair exists to produce two *independent records of the same
object*, whose disagreement is measured and adjudicated (§9.5, §9.2.1) — communication would
destroy the very quantity being measured. Enumeration produces a **union**, not a comparison: no
inter-enumerator agreement statistic exists anywhere in §10, §12 or §15; there is no enumeration
adjudicator; and §9.7:635 explicitly refuses to treat a class-prediction/reference mismatch as an
error. Blinding two enumerators from each other would buy no statistic and would actively obstruct
two hard requirements: §5.7:380 refuses duplicate identifiers and duplicate canonical domains
("**Uniqueness** [enforced]: one row per legal entity"), and §5.7.2:385–387 demands per-class
coverage (E ≥ 126/52/32) while §5.7:379 needs all four jurisdiction families populated for the D-A
round-robin. Meeting those with two blind enumerators would require an intermediary — and the only
available intermediary is the operator, which is precisely the channel §22 row 31 is about.

**The coherence is conditional, and the condition is the crux of this whole review:** coordination
between enumerators must be about **coverage** (which families, which strata, which public sources),
never about **which specific companies** each contributes from a list someone else supplied. See
`PARTITION_GOVERNANCE.md` §4–§5.

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


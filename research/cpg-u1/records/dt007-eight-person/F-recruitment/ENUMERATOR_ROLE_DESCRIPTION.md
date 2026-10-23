# ENUMERATOR_ROLE_DESCRIPTION — the enumerator role (CPG-U1, eight-person configuration)

**Classification: PREPARATION.** This document is not evidence. It records no identity, no
recruitment, no commitment and no result. **No person has been recruited. No person named,
numbered or implied anywhere in this package exists as a recruited participant.** "Enumerator A"
and "Enumerator B" are *slot labels* for two positions that are currently **UNFILLED**.

**Unfilled-marker convention (used in every file of this directory).** Every field that a real
person, or the operator, must supply is written as

```
<<UNFILLED: what belongs here>>
```

and identity slots reuse the register's own token `UNASSIGNED`. Neither is data. **A document that
still contains any `<<UNFILLED: ...>>` marker is not a completed record and must never be filed,
hashed or cited as one.**

---

## 0. Baseline, verified by the author of this document

| Thing | Value | How verified |
|---|---|---|
| Protocol | `research/cpg-u1/CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum` recomputed, matches, in **both** `C:/tmp/dt4-people` and `C:/tmp/dt004-frozen-instrument` |
| Registered instrument | aggregate sha256 `<NEW_AGG>` over **<NEW_N>** files | recomputed with the instrument's own `lib/aggregate.mjs` against `C:/tmp/dt004-frozen-instrument/research/cpg-u1/tooling` → exact match, <NEW_N> files |

**Recorded baseline discrepancy (not hidden, not worked around).** The worktree this package was
written in — `C:/tmp/dt4-people`, detached at `af2fb6e99ce461894bf16f18c2251f75088eba18` — carries a
tooling tree of **587** files whose aggregate is
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`, i.e. **not** the registered
instrument. It is an older revision: it lacks `lib/analysis.mjs`, `lib/assignment.mjs`,
`lib/evaluation.mjs`, `lib/evidenceBundle.mjs`, `lib/ratings.mjs` and `rules/analysis_decisions.json`,
and 12 of its 587 shared files differ (`README.md`, `cpg_u1_data.mjs`, `lib/aggregate.mjs`,
`lib/bitcoin.mjs`, `lib/commitment.mjs`, `lib/drand.mjs`, `lib/packets.mjs`, `lib/raterPackets.mjs`,
`lib/registration.mjs`, `lib/sampling.mjs`, `test/mutate.mjs`, `test/selftest.mjs`).

**Every file this package derives a rule from is byte-identical in both trees** — `lib/personnel.mjs`,
`lib/schema.mjs`, `lib/frame.mjs`, `lib/identifiers.mjs`, `lib/csv.mjs` (verified by per-file sha256
comparison). Every citation below is read from, and is to, the **registered <NEW_N>-file tree**.

**Correction to the brief that commissioned this package:** `checkFrameRow` is **not** in
`lib/frame.mjs`. It is exported from **`lib/schema.mjs:93`**, together with `FRAME_COLUMNS`
(`lib/schema.mjs:12`). `lib/frame.mjs` contains the *frame-sufficiency* rule
(`frameSufficiency`, `FRAME_MINIMUM`), which enumerators never run and never see the output of.

**Where the protocol and the tooling disagree, the protocol wins and the tooling is defective.**

---

## 1. The rule that governs the role before anything else

> **No AI system, agent or language model may hold this role.** An enumerator is a **real,
> independent human being**. An AI may not stand in for one, may not "assist" by producing the
> frame row the human then signs, and may not be the source of any value entered in the frame.
> A role performed or ghost-written by an AI is not independent work; the §4A.1 consequences for a
> false declaration apply, and the frame is published as non-independent (§20.18).
> **The preparer of this document is an AI and therefore holds no role in this study.**

> **The operator (key custodian) may hold no independent role.** `check-personnel` refuses the
> register with `ROLE COLLISION — the operator may hold no independent role` if the operator's
> `person_id` appears in any assignment (`lib/personnel.mjs:33`).

---

## 2. What the role is

The enumerator builds the **candidate frame**: a CSV, one row per legal entity, from **public,
registry-anchored sources only**. Per row the enumerator:

- records the entity, its canonical domain, its jurisdiction family and its decisive identifier;
- answers each admissibility criterion `yes` / `no` / `unknown` (§5.1 — tri-state);
- answers each CPG-C1 contamination attestation `yes` / `no` / `unknown` (§5.3);
- records the **class prediction** `expected_outcome_class`, made **before any reference research**
  (§5.2), and names the collision when the class is `identity-hazard`;
- supplies `enumerated_by` (a pseudonym from the restricted register), `enumerated_at` and
  `enumeration_source_url`.

The class prediction is used for **sampling balance only**. Labels are always determined by
reference truth, never by the class (§5.2, §9.7). The enumerator does **not** produce reference
truth, does **not** rate, does **not** adjudicate anything, and does **not** run any tooling
command.

Two enumerator slots exist in this configuration. §4A.3: *"Several enumerators are permitted; each
holds no other role."* `check-personnel` permits more than one holder of `enumerator` and of **no
other** role (`lib/personnel.mjs:26`).

---

## 3. What an enumerator receives — the exhaustive list, quoted

§4A.2, verbatim:

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, §5.1–§5.4;
> - the jurisdiction-family list;
> - the development-only registry.

Concretely, and nothing beyond it:

| # | Item | Concretely |
|--:|---|---|
| 1 | public sources | Whatever the enumerator finds in public. Not supplied by the operator, not curated by the operator, not a list of companies from the operator. |
| 2 | the frame template | `templates/candidate_frame.template.csv` — the 22-column header, no data rows. |
| 3 | §4A, §5.1–§5.4 | Those protocol sections only. Not the whole protocol. |
| 4 | the jurisdiction-family list | `US-SEC` (CIK or LEI), `FR-SIRENE` (SIREN or LEI), `BR-CNPJ` (CNPJ or LEI), `LEI-ONLY` (LEI) — §5.1. |
| 5 | the development-only registry | `rules/development_only_registry.json` at the **registered** `registry_sha256`, frozen at registration (§5.3). |

Plus the operational papers of this package (this file, the declaration, the allocation, the
submission procedure, the contamination rules, the evidence handling). Those are *instructions*,
not study content; they contain no company and no CPG output.

---

## 4. What an enumerator never receives — the exhaustive list, quoted

§4A.2, verbatim:

> **They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2).

§4A.2(b) makes the same fence a condition of *eligibility*: an enumerator must

> not have run CPG or seen any CPG output (including the development pilot and instrument check)
> before completing the frame

Read together with §5.5 / §5.7.2, the closed list of what is withheld is:

| Withheld | Why |
|---|---|
| Pilot results | They would reveal how CPG performs and could steer candidate choice. |
| Sizing output | Same, and it is derived from the pilot. |
| Quotas — development quotas, held-out quotas, frame minimums | Knowing how many rows of each class are needed lets an enumerator shape the class mix. |
| Any CPG output whatsoever — including the development pilot and the instrument check | §4A.2(b). Seeing any of it makes the person ineligible and the frame non-independent (§20.18). |
| The development / held-out **split** | Drawn after the frame is committed; an enumerator must never know which side a row lands on. |
| Reference truth, blind records, adjudications | §9 material; the enumerator's class prediction is compared against it (§9.7). |
| The other enumerator's rows | See `ENUMERATOR_A_ALLOCATION.md` §4. |
| The repository, the resolver SHA clone, the scan | The scan is an **operator** task; it reads the repository, which enumerators never see. |

---

## 5. What an enumerator must not do

1. **Must not run CPG, or look at any CPG output, at any point before the frame is complete**
   (§4A.2(b)). Not a demo, not a screenshot, not a colleague's description of a result.
2. **Must not contact CPG, Omnivyra, the developing organisation, or any of its people or systems**
   for any purpose connected to this work. See `ENUMERATOR_EVIDENCE_HANDLING.md` §5.
3. **Must not contact any company in the frame.** Every fact comes from a public source, cited.
4. **Must not use an AI system, agent or language model** to find candidates, decide an
   attestation, write a note, or check a row. See §1.
5. **Must not leave a cell blank.** A blank cell is *always* malformed (`lib/schema.mjs:105`).
   "Not established" is written as the explicit token `UNKNOWN` or `unknown`.
6. **Must not answer `no` to a contamination attestation on the basis of not knowing.**
   `unknown` is treated exactly like `yes` (§5.3, `lib/schema.mjs:167–169`). See
   `ENUMERATOR_CONTAMINATION_RULES.md`.
7. **Must not guess at an identifier.** An identifier that is not established is recorded by
   setting `identifier_scheme` to `UNKNOWN` and leaving `identifier_value` empty — the one place
   where an empty cell is *required* (`lib/schema.mjs:112`).
8. **Must not add, remove or edit rows after submission is accepted.** The frame is frozen before
   the development commitment; `draw-held-out` refuses with `FRAME_CHANGED` if the frame hash moves
   (`cpg_u1_data.mjs:458`).
9. **Must not share, discuss or publish any part of this work** before the study's results are
   published.
10. **Must not accept any payment or benefit from the developing organisation** other than the one
    fixed, non-contingent study fee of §4A.1 item 5.

---

## 6. The role is exclusive, and it excludes reference adjudication in particular

§4A.3:

- *"Every independent role is held by a different person, and no independent role is held by the
  operator."*
- *"The seven independent roles are mutually exclusive: minimum 7 independent persons."*
- *"Several enumerators are permitted; each holds no other role."*
- *"An enumerator may not be the reference adjudicator. The adjudicator decides contested
  reference values, and the enumerator authored the class predictions whose mismatches with
  reference truth are published (§9.2, §9.7)."*

So an enumerator holds **exactly one** role: `enumerator`. Not reference Author, not reference
Confirmer, **not reference adjudicator**, not rater-1, not rater-2, not rating adjudicator, and not
the operator. `check-personnel` enforces mutual exclusion mechanically
(`ROLE COLLISION — <person> already holds <role>`, `lib/personnel.mjs:35`), and it enforces that
`enumerator` is the only role permitted more than one holder (`lib/personnel.mjs:26`).

The adjudicator exclusion is the one a recruiter is most likely to fumble, because an experienced
company-research person is exactly who you would also want adjudicating reference values. **It is
prohibited, and for a stated reason:** the enumerator wrote the class predictions whose mismatches
against reference truth get published, so letting that person settle contested reference values
would let the predictor grade the prediction.

---

## 7. What the role does *not* prove

The declaration and the organisation's confirmation are **procedural evidence, not proof** (§4A.1).
`check-personnel` verifies **structure only** — that each declaration key is present and equals the
string `"no"`, that the hashes are well-formed, that roles are filled and mutually exclusive, that
the operator holds none. Its own header says it plainly (`lib/personnel.mjs:1–3`):

> It cannot verify that declarations are true.

Nothing in this package changes that. If a declaration is later found false, the enumerator's work
makes the **frame** non-independent (§4A.1, §20.18), and the finding is published.

**This is a methodological rule; it is not a legal determination.** (§4A.1)

---

## 8. Slot state

| Slot | `person_id` | Declaration | Org confirmation | Fee agreement | State |
|---|---|---|---|---|---|
| Enumerator A | `UNASSIGNED` | `<<UNFILLED: not obtained>>` | `<<UNFILLED: not obtained>>` | `<<UNFILLED: not agreed>>` | **UNFILLED — no candidate approached** |
| Enumerator B | `UNASSIGNED` | `<<UNFILLED: not obtained>>` | `<<UNFILLED: not obtained>>` | `<<UNFILLED: not agreed>>` | **UNFILLED — no candidate approached** |

---

## 9. Relative schedule

No calendar date appears in this package. Two operator-supplied anchors govern everything:

- **S** = `<<UNFILLED: operator-supplied start date (YYYY-MM-DD)>>` — the date the operator issues
  this role description and the declaration to a candidate.
- **R** = `<<UNFILLED: operator-supplied date the OSF registration is published and the
  development-only registry is frozen (YYYY-MM-DD)>>` — study material may not be released before R.

| Day | Act | Owner |
|---|---|---|
| S+0 | Issue this file, `ENUMERATOR_INDEPENDENCE_DECLARATION.md`, and the draft fixed-fee agreement. **No study material.** | operator |
| S+0 … S+5 | Candidate returns the signed declaration and the signed fee agreement (or declares no fee). | candidate |
| S+3 … S+10 | Operator obtains the developing organisation's written confirmation per person and records its sha256. | operator |
| S+10 | Operator runs `ENUMERATOR_ELIGIBILITY_CHECK.md` for A and B, **including the A↔B relational check**. | operator |
| S+11 | Operator adds both assignments to the register and runs `check-personnel`. It will report `BLOCKED` while any of the other five roles is unfilled — that is expected, not a failure of this package. | operator |
| **max(S+11, R)** | **Gate.** Release of study material. Not before R, and not before the fee agreement is signed (§4A.1 item 5: agreed in writing **before** any role material is released). | operator |
| R+0 | Release: frame template, §4A, §5.1–§5.4, the jurisdiction-family list, the frozen development-only registry, `ENUMERATOR_{A,B}_ALLOCATION.md`, `ENUMERATOR_SUBMISSION_PROCEDURE.md`, `ENUMERATOR_CONTAMINATION_RULES.md`, `ENUMERATOR_EVIDENCE_HANDLING.md`. | operator |
| R+0 … R+**N** | Enumeration. **N** = `<<UNFILLED: enumeration window in days; depends on the partition the partition-rule agent designs and on the per-enumerator row target>>`. | enumerator |
| R+N | Submission deadline. | enumerator |
| R+N+2 | Operator runs `node cpg_u1_data.mjs frame --frame <file>` and returns every `MALFORMED` line verbatim. | operator |
| R+N+5 | Corrections returned. Repeat until zero malformed rows. | enumerator |

Deadlines are relative by design: the operator supplies S and R, and **no calendar date is invented
anywhere in this package.**

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


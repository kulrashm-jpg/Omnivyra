# INDEPENDENCE_ANALYSIS — DEEPTECH-HUMAN-MIN-001 / AGENT E

**CLASSIFICATION: METHODOLOGY REVIEW.** Not U1 evidence. No protocol byte changed, no registration, no
frame, no execution, no person named, no declaration produced. Nothing here is an approval.

- Protocol read: `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (1098 lines).
- Instrument read: `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`.
- Prior artefacts read: `C:/tmp/dt004-operations/people/` (`HUMAN_DEPENDENCY_MAP.md`, `tools/role_conflict_check.mjs`).

**Two layers are kept apart throughout.** Layer 1 is what the text forbids, by quotation. Layer 2 is
whether an overlap damages validity, and in which direction. Layer 2 is this agent's argument, not
protocol text, and every Layer-2 verdict is labelled as inference.

---

## 0. Headline

| Question | Answer |
|---|---|
| Does §4A leave any role pair unspecified? | **No.** All 21 unordered pairs of the seven independent roles, and all 7 pairs with the operator, are FORBIDDEN-BY-TEXT. PERMITTED: 0. UNSPECIFIED: 0. |
| Is a two-human design a reading of the protocol? | **No.** It is an amendment. §4A.3 line 185 states a floor of seven. |
| Would a two-human design be *methodologically* defensible if the text were amended? | **No.** Independently of the text, no partition of the seven roles into 1, 2 or 3 persons avoids a DISQUALIFYING overlap (computed, `exclusion_matrix.mjs`). |
| Minimum persons on methodological grounds alone? | **4** — and at 4, either Krippendorff's α stops measuring inter-coder reliability, or the enumerator must also rate. Both cannot be avoided until **5**. |
| Would a two-human register pass the instrument? | **No.** Refusal is mechanical, not procedural: `personnel.mjs:34`, `assignment.mjs:33`, `reconcile.mjs:52,59-60`, `ratings.mjs:97-98`. |

---

## 1. Layer 1 — the formal rules, as written

### 1.1 The seven roles and the operator

§4A.3 lines 174–182:

> **Roles:**
> - operator (key custodian; not independent);
> - enumerator (≥ 1);
> - reference Author;
> - reference Confirmer;
> - reference adjudicator;
> - rater 1;
> - rater 2;
> - rating adjudicator.

Eight labels; seven independent. `personnel.mjs:6` encodes exactly these seven as
`INDEPENDENT_ROLES`, and `role_conflict_check.mjs:28` re-derives the same list from the text and
**refuses to run** if the instrument's list has drifted from it.

### 1.2 Every exclusion clause, quoted

| # | Where | Quotation | Reach |
|---|---|---|---|
| X1 | §4A.3 L184 | "**Every independent role is held by a different person, and no independent role is held by the operator.**" | All 21 independent pairs + all 7 operator pairs |
| X2 | §4A.3 L185 | "The seven independent roles are mutually exclusive: **minimum 7 independent persons**." | Restates X1 as a head-count floor |
| X3 | §4A.3 L186 | "Several enumerators are permitted; each holds no other role." | The one permitted multiplicity is *within* the enumerator role |
| X4 | §4A.3 L187 | "An enumerator may not be the reference adjudicator. The adjudicator decides contested reference values, and the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7)." | enumerator ↔ reference adjudicator, **with a stated rationale** |
| X5 | §4A.2 L159–160 | enumerator must "(c) not be the operator (key custodian); (d) hold no other §4A.3 role" | enumerator ↔ all |
| X6 | §12 L726 | Rater eligibility: "Must not have implemented CPG, the protocol or the tooling; **must hold no other §4A.3 role**; must satisfy §4A.1" | rater ↔ all |
| X7 | §9.1 L565 | Reference adjudicator must not "Hold any other §4A.3 role (**including enumerator**)" | reference adjudicator ↔ all |
| X8 | §9.5 L623 | "The author and confirmer must be different people, and the adjudicator must differ from both." | A↔C, A↔RA, C↔RA |
| X9 | §9.1 L563–564 | Author/Confirmer must not "communicate with the Confirmer before both have submitted"; Confirmer must not "see the Author's record before submitting" | A↔C, as an information rule on top of the identity rule |
| X10 | §4A.1 L138 | not independent if the person "is the spouse or partner, a family member or a household member of, or has a current or former direct reporting relationship with, any person who developed CPG, the operator (key custodian), or **any holder of another §4A.3 role**" | A **relational** exclusion: distinct persons are not enough; they must also be unrelated to each other |
| X11 | §19.3(3) L959 | "**Seven mutually exclusive independent persons.**" | Restates the floor as a registration prerequisite |

**X10 is the clause a head-count reduction most easily overlooks.** §4A.1 item 6 excludes not only the
same person in two roles but any two role-holders who are partners, family, household members, or who
stand or stood in a direct reporting relationship. A reduced-headcount design recruited from one
household or one team fails X10 while satisfying X1 — and no tool detects it: `personnel.mjs:37` only
requires the *declaration answer* `close_relationship_with_developer_operator_or_role_holder` to be the
string `"no"`.

### 1.3 The exclusion matrix

Roles: `EN` enumerator · `A` reference Author · `C` reference Confirmer · `RA` reference adjudicator ·
`R1` rater 1 · `R2` rater 2 · `TA` rating adjudicator · `OP` operator.

`F` = FORBIDDEN-BY-TEXT (clause cited) · `—` = diagonal. There is no other cell value in this matrix.

|      | OP | EN | A | C | RA | R1 | R2 | TA |
|------|----|----|---|---|----|----|----|----|
| **OP** | — | F X1,X5 | F X1 | F X1 | F X1,X7 | F X1,X6 | F X1,X6 | F X1 |
| **EN** | F X1,X5 | *see note* | F X1,X5 | F X1,X5 | **F X1,X4,X5,X7** | F X1,X5,X6 | F X1,X5,X6 | F X1,X5 |
| **A**  | F X1 | F X1,X5 | — | F X1,X8,X9 | F X1,X7,X8 | F X1,X6 | F X1,X6 | F X1 |
| **C**  | F X1 | F X1,X5 | F X1,X8,X9 | — | F X1,X7,X8 | F X1,X6 | F X1,X6 | F X1 |
| **RA** | F X1 | **F X1,X4,X5,X7** | F X1,X7,X8 | F X1,X7,X8 | — | F X1,X6,X7 | F X1,X6,X7 | F X1,X7 |
| **R1** | F X1,X6 | F X1,X5,X6 | F X1,X6 | F X1,X6 | F X1,X6,X7 | — | F X1,X6 | F X1,X6 |
| **R2** | F X1,X6 | F X1,X5,X6 | F X1,X6 | F X1,X6 | F X1,X6,X7 | F X1,X6 | — | F X1,X6 |
| **TA** | F X1 | F X1,X5 | F X1 | F X1 | F X1,X7 | F X1,X6 | F X1,X6 | — |

*Note (EN↔EN):* the only PERMITTED multiplicity in the whole design — X3 allows several enumerators,
each holding no other role. It adds people; it never removes any.

**Counts: 28 pairs, 28 FORBIDDEN-BY-TEXT, 0 FORBIDDEN-BY-IMPLICATION, 0 UNSPECIFIED, 0 PERMITTED.**

There is nothing to infer. X1 is a universal quantifier over the seven roles, so every pair is reached
by text directly, and X4–X8 are named special cases that happen to restate three of the pairs with
their reasons. This matters for the amendment question in §2.4: the protocol's exclusivity does **not**
rest on the special cases, so deleting X1 would not leave a coherent residue.

### 1.4 The one inference worth recording

**INFERENCE E-1 (a finding, not a rule).** X4's stated rationale — "the enumerator authored the class
predictions whose mismatches with reference truth are published (§9.2, §9.7)" — applies verbatim to the
reference **Author** and **Confirmer**, who are the people who produce the reference truth that the
class predictions are compared against. §9.2 L569 confirms the concern: Author and Confirmer "never
receive CPG output, each other's records, or **the class prediction**." An enumerator who later
authors reference truth does not *receive* the class prediction; they *wrote* it.

Yet X4 names only the reference adjudicator. Under X1 this under-inclusiveness is harmless, because
X1 already forbids EN↔A and EN↔C. **It becomes live the moment anyone relaxes X1/X2 while keeping the
named special cases** — a drafter who deleted the universal rule and kept X4 would produce a rule set
that permits an enumerator to author reference truth, which X4's own rationale forbids. Any amendment
must restate the class-prediction exclusion over all three reference roles, not just the adjudicator.

---

## 2. Layer 2 — which overlaps damage validity, and in which direction

Layer 1 settles legality. It does not settle whether an amendment would be defensible. That is Layer 2.

### 2.1 Where a rater actually has discretion

This is the pivot for every reference↔rating verdict, so it is established first, from §10.1 L649–656
and the instrument.

§10.1's decision procedure is largely **not** a judgement:

- the first branch (CPG returned a value?) is read off the archived response, and `ratings.mjs:36-38`
  mechanically refuses a fill label when `cpg_value === null` and an abstention label when a value is
  present;
- the branch "reference holds an authoritative value?" is read off the sealed row's `value_kind`
  (`STATED` vs `NOT_AVAILABLE_FROM_SOURCE`, §9.3 L596). The rater does not decide it;
- §10.2 L662–668 agreement is arithmetic: same four-digit year; |CPG − reference| ≤ 10%; currency
  parse plus 10%.

A rater's genuine discretion is therefore confined to exactly three places:

| ID | Discretion | Consequence |
|---|---|---|
| **D1** | "value attributable to the EXPECTED entity?" (§10.1 L652) | MISATTRIBUTED-FILL — in P1's numerator **and** P3, where "any > 0 fails the run outright" (L679, L688) |
| **D2** | "Reference insufficient to decide → REFERENCE-AMBIGUOUS" (L655) | Excluded from every denominator and published (L690) |
| **D3** | the temporal rule: is the reference `as_of_date` within 24 months of run `asOf`? (L668) | REFERENCE-STALE (excluded) vs INCORRECT-FILL sub-reason `STALE_VALUE` |

**D2 is the escape hatch, and it is the whole of the contamination surface.** Everything a
reference-observer-turned-rater could distort, they distort through D1, D2 or D3.

### 2.2 Reference role → rating role: the objection is not leakage

The coordinator's point is **correct and I confirm it.** §12 L727 specifies the rater packet as
"Field; CPG's value or null; the source URLs CPG cited for that value (§12.3); **the sealed reference
record**", and the instrument makes this exact: `raterPackets.mjs:60` requires
`reference_record` to be **exactly** `REFERENCE_COLUMNS` (`schema.mjs:213-217`) — the whole reconciled
row, including `expected_value`, `source_url`, `search_note` and `as_of_date`.

So a reference observer who later rates learns **nothing they would not have received anyway**. Every
rater sees the reference value by design. Information leakage is not the objection, and any analysis
that rests on it is wrong.

**The residual objection is motivational, and it can act only through D1/D2/D3.** A person who
recorded a value and then judges CPG against it has a stake in that record being adequate, and the
label that concedes inadequacy is D2 (REFERENCE-AMBIGUOUS) or D3 (REFERENCE-STALE). Self-consistency
bias therefore manifests as **suppression of the exclusion labels**.

One channel makes the stake explicit rather than merely remembered, and it is a defect in its own
right. `REFERENCE_COLUMNS` carries `author`, `confirmer`, `resolution` and `adjudicated_by`
(`schema.mjs:216`, populated at `reconcile.mjs:72` from each record's `recorded_by`). Because the whole
row goes into the rater packet verbatim, **every rater and the rating adjudicator receive the
pseudonyms of the reference Author, Confirmer and adjudicator, and the per-row contest status**
(`AGREED` / `ADJUDICATED_AUTHOR` / `ADJUDICATED_CONFIRMER` / `REFERENCE_CONFLICT`). §12 L728 blinds
raters only "to each other's labels, to running tallies and aggregates, and to the development pilot",
so this is not a violation — but no §12 rule authorises it either. In the seven-person design it is a
gratuitous leak. In any merged design it becomes a **self-identification channel**: the rater reads
`author: <own pseudonym>` and `resolution` on every row, and so knows, without relying on memory,
whether the sealed reference is their own record and whether their value beat their colleague's.

### 2.3 Direction of the self-consistency bias (requested; established, not assumed)

Endpoints, from §10.3 L676–680: **G1** all fills ≥ 20 · **P1 EFR** = (UNSUPPORTED + INCORRECT +
MISATTRIBUTED) ÷ all fills ≤ 0.05 · **P2 AR** = CORRECT-ABSTENTION ÷ (CORRECT-ABSTENTION +
UNSUPPORTED-FILL) ≥ 0.90 · **P3 II** = count(MISATTRIBUTED-FILL) = 0 · **R1 FR** reported, no
threshold. SUCCESS requires G1 and all of P1, P2, P3 (L713).

Cell by cell, for a rater whose own record became the sealed row. "Independent options" is what an
uninvolved rater might reach; "self-defending choice" is what suppression of D2/D3 produces.

| Sealed row (their own) | CPG | Independent options | Self-defending choice | Endpoint effect | Net |
|---|---|---|---|---|---|
| STATED `v`, CPG fills `≠ v` | fill | REFERENCE-AMBIGUOUS (excluded) / INCORRECT-FILL / MISATTRIBUTED-FILL | INCORRECT-FILL, or MISATTRIBUTED-FILL via D1 | P1 numerator ↑; if MISATTRIBUTED, **P3 > 0 fails outright**; FR ↓ | **AGAINST SUCCESS** |
| STATED `v`, CPG fills `= v` | fill | SUPPORTED-FILL / REFERENCE-AMBIGUOUS | SUPPORTED-FILL | EFR ↓, FR ↑ | toward SUCCESS |
| STATED `v` | abstains | MISSED-FILL / REFERENCE-AMBIGUOUS | MISSED-FILL | FR ↓ only; absent from P1, P2, P3 | neutral (FR has no threshold, L680–682) |
| `NOT_AVAILABLE_FROM_SOURCE` | fill | UNSUPPORTED-FILL / REFERENCE-AMBIGUOUS | UNSUPPORTED-FILL | P1 numerator ↑ **and** P2 denominator ↑ (AR ↓) | **AGAINST SUCCESS (both P1 and P2)** |
| `NOT_AVAILABLE_FROM_SOURCE` | abstains | CORRECT-ABSTENTION / REFERENCE-AMBIGUOUS | CORRECT-ABSTENTION | P2 numerator ↑ (AR ↑) | toward SUCCESS |
| STATED, stale `as_of_date` | fill matching an older value | REFERENCE-STALE (excluded) / INCORRECT-FILL `STALE_VALUE` | INCORRECT-FILL | P1 numerator ↑ | **AGAINST SUCCESS** |

**Result. Self-consistency bias runs predominantly AGAINST a SUCCESS finding**, and the asymmetry is
structural rather than merely numerical:

1. The three against-SUCCESS cells are the cells where **CPG and the sealed reference disagree**, or
   where CPG fills against a `NOT_AVAILABLE_FROM_SOURCE` record. Disagreement between CPG and
   reference is the *prime* trigger for an uninvolved rater to reach for D2 — so these cells carry the
   large share of the mass that D2 would otherwise have removed.
2. The two toward-SUCCESS cells are the cells where **CPG agrees with the rater's own record**. There
   the self-defending choice is also the choice an uninvolved rater makes: the §10.1 branch is forced
   by `value_kind`, and the only alternative was D2. The bias magnitude in these cells equals the rate
   at which an uninvolved rater would call a reference ambiguous *while CPG independently concurred
   with it* — rare by construction, since concurrence of two sources is the paradigm of an
   unambiguous reference.
3. Suppressing D2/D3 also **raises** the G1 fill count (L676 counts only the four fill labels;
   excluded observations are not fills), making the run more likely to be conclusive. Combined with
   1, the merge makes the study more likely to reach a verdict **and** more likely to fail it.

**Consequences for the amendment question.** A reference↔rating overlap is therefore *conservative*: a
**SUCCESS obtained under it is not inflated by it**, and remains reportable if the overlap is declared.
The converse must be stated with equal force: a **FAILURE or FALSIFIED outcome obtained under it is
confounded**, because the bias runs in exactly that direction, and a FALSIFIED finding (§10.5 L711,
"Recorded and reported as evidence against the verified-only claim") would be the least trustworthy
result the design could produce.

**Two caveats that limit how much comfort to take (both inferences).**

- *The direction result is conditional on which motive dominates.* It assumes self-consistency. The
  competing motive runs the other way: §4A.1 item 5 L137 permits "a fixed fee for the study role",
  and a sponsor-aligned rater would use D2 to *hide* CPG errors, which inflates SUCCESS. The only
  control is that the fee be "**not contingent** on any result, finding or future engagement" with its
  SHA-256 recorded. The two motives push oppositely, and nothing in the artefacts reveals which acted.
- *Reducing head-count strengthens the sponsor-aligned motive.* A person holding several roles has
  more invested in the study completing and publishing than one holding a single role. So the merge
  that makes the conservative motive available also amplifies the permissive one, and the direction
  result should not be leaned on as a safety argument for a two-human design.

**Verdict: CONTAMINATING, conservative in direction, disqualifying for a FAILURE/FALSIFIED finding.**
Not DISQUALIFYING for a SUCCESS. This is the coordinator's point 2 sustained, with its limits.

### 2.4 The overlaps that are genuinely DISQUALIFYING

Nine pairs. In each, the later act **reviews or validates the same person's earlier work**, or the
control is the existence of two things that one person cannot produce.

| Pair | Why DISQUALIFYING | Mechanical refusal |
|---|---|---|
| **A↔C** | Not contamination — **non-existence**. The control is two independent constructions; one person makes one. Self-agreement would make every row `AGREED`, and §9.5 L620 makes `AGREED` unoverridable ("an adjudication may not override it"), so reference truth becomes one person's unreviewed values and the adjudicator's packet approaches empty. | `reconcile.mjs:52` |
| **A↔RA**, **C↔RA** | §9.2.1 L576 presents the two records "**unlabelled** as 'Record 1' and 'Record 2'". A person who wrote one recognises it instantly from its own `search_note` and `source_url`, identifies the other by elimination, and adjudicates in their own favour. The blind *is* the mechanism, so defeating it removes the control entirely. No ordering escapes it: §9.2.1 L590 fixes adjudication *after* both record sets. | `reconcile.mjs:59-60` |
| **R1↔R2** | §12 L731 requires "≥ 2 **independent** ratings"; α would measure intra-rater consistency, and the §15.5(3) gate (α < 0.667 → INCONCLUSIVE) would be passed trivially. The differing derived orders (§12.1, separate labels) disguise re-encounter only slightly. | `ratings.mjs:97` |
| **R1↔TA**, **R2↔TA** | §12.2 L762 shows the two labels "**unlabelled** as 'Label A' and 'Label B'". With seven possible labels and one's own decision in memory, self-identification is near-certain, and every disagreement resolves in the rater-adjudicator's favour — biasing the endpoint by the entire disagreement mass. | `ratings.mjs:98`, `assignment.mjs:33` |
| **EN↔A**, **EN↔C**, **EN↔RA** | §9.7 L635 publishes reference-vs-class-prediction mismatches. One person on both sides makes that published statistic self-fulfilling: they search the same public sources from which they formed the prediction. EN↔RA is X4 by name; EN↔A and EN↔C are the same rationale (INFERENCE E-1). | EN↔RA in `role_conflict_check.mjs`; EN↔A, EN↔C only via the universal rule |

### 2.5 Computed head-count floor

`exclusion_matrix.mjs` encodes the 21 pairs (9 DISQUALIFYING, 12 CONTAMINATING) and enumerates every
canonical partition of the seven roles.

```
k=1,2,3 : NO partition avoids a DISQUALIFYING pair
k=4     : 24 partitions;  α-valid 12;  enumerator-clean 6;  BOTH 0;  fewest contaminating edges 3
k=5     : 60 partitions;  α-valid 42;  enumerator-clean 24; BOTH 12; fewest contaminating edges 2
k=6     : 72 partitions;  α-valid 54;  enumerator-clean 33; BOTH 21; fewest contaminating edges 1
k=7     : 73 partitions;  α-valid 55;  enumerator-clean 34; BOTH 22; fewest 0 — the protocol's design
```

- **k ≤ 3 is impossible.** {A, C, RA} are pairwise disqualifying and so need three distinct people;
  {R1, R2, TA} likewise; and EN is disqualifying with all three reference roles, so at k=3 — where all
  three people already hold reference roles — EN necessarily collides with one. **A two-human design
  fails on methodological grounds alone, before the text is consulted.**
- **k=4 is the methodological floor**, reached only by cross-matching the two triads (e.g.
  A=P2, C=P3, RA=P4 with R1=P3, R2=P4, TA=P2), and it costs at least three contaminating edges.
- **At k=4 the two desiderata are provably incompatible (BOTH = 0):** either both raters are drawn
  from the reference-role holders — which invalidates α (§2.6) — or the enumerator also rates.
- **k=5 is the smallest design that keeps α meaningful *and* the enumerator out of rating.**
- Only **one** of the 73 partitions at k=7 is fully clean: the protocol's own.

### 2.6 Krippendorff's α under merged raters (requested; plain answer)

**No. α stops measuring what §12 intends, and no tooling fixes it.**

α = 1 − D_o/D_e is a **reliability** coefficient: its interpretation presupposes coders that are
exchangeable draws from a population of competent coders, independent of each other. §12 L732 adopts
"≥ 0.667 [NORMATIVE — Krippendorff's own floor for tentative conclusions]", which is a claim about
*procedure* reproducibility, not about two particular individuals.

First, a bound that must be stated so the merge is not over-blamed: **in the seven-person design the
two raters' inputs are already identical.** Both receive the same CPG value, the same cited URLs and
the same sealed reference row; the only difference between their packets is presentation order
(§12.1, `raterPackets.mjs:74`). α already measures nothing but the variance of human application of
§10.1/§10.2 to identical inputs, and most of §10.1 is mechanically forced (§2.1). Its discriminating
power already sits almost entirely in D1/D2/D3. The merge does not create this; it removes what little
is left.

Two channels then act, and they do not cancel:

1. **Shared reference authorship.** Both raters know, per row, whether the sealed reference is their
   own record — from memory and, explicitly, from `author` / `confirmer` / `resolution` in the packet
   (§2.2). On `AGREED` rows both independently recorded the same value, so both have the same stake
   and both suppress D2: **correlated suppression of the same escape hatch → D_o falls → α rises.**
   On adjudicated rows the incentives oppose (the winner defends, the loser doubts), so D_o rises
   locally. `AGREED` rows are the majority in any functioning reference process, so the inflating term
   dominates. **α is inflated.**
2. **Shared enumeration** (in the chain of coordinator point 3). Two people who jointly built the
   frame share a prior about every company's identity resolution and findability — precisely the input
   to D1. **Correlated D1 → D_o falls → α rises.**

The deeper problem is not the value but the meaning. Two coders who jointly built the coding material
are not exchangeable draws from a coder population, so α no longer estimates "how reproducibly does
§10.1 map this evidence to a label across independent competent coders". It becomes a consistency
statistic for one jointly-primed pair — a strictly weaker claim, and not the claim §12 makes.

**This is the worst failure mode in the whole analysis.** `analyze` computes α correctly from two
sheets and cannot know the sheets' authors shared a prior. §15.5(3) L863 makes α < 0.667 an
INCONCLUSIVE condition, so the merge makes a guard **easier to pass**: the artefact goes green, the
gate stops gating, and nothing in any published artefact records that the coefficient changed meaning.
`ratings.mjs:97` checks `sheet1.rated_by !== sheet2.rated_by` — distinctness of *strings*, never
independence.

**The α-invalidating condition is precise and worth stating as a design rule:** α retains its meaning
iff **at least one rater held no reference role**. If exactly one rater is reference-primed, α is not
inflated and may even be depressed (the two coders' D2 incentives differ), which is conservative. The
census in §2.5 counts partitions by this predicate.

### 2.7 Testing the forward-only chain (coordinator point 3)

The proposed chain: two people P and Q both enumerate, then act as Author/Confirmer, then as
rater-1/rater-2. Tested hard, as asked.

**It cannot be closed.** It assigns four of seven roles. The reference adjudicator and rating
adjudicator have only three possible homes, and all three fail:

- **RA = P (the Author)** — adjudicates its own record against Q's. §2.4, fatal, and
  `reconcile.mjs:59-60` refuses it.
- **RA = the operator** — §18.3 L916 makes "**the operator having seen reference truth**" a halt
  condition: "The run is **void, not repaired**." Textually fatal, and it is the sharpest single
  sentence against operator absorption of reference roles.
- **RA = a third person** — then it is not a two-human design.

Identically for the rating adjudicator. So the chain is not a two-human design at all; it is a
five-human design with two roles unassigned.

**Four backward edges, taking the chain at face value for the roles it does assign.** "Backward" in
the dependency sense: later knowledge or anticipation reaching an artefact that must be fixed earlier.

**B1 — enumeration anticipates the enumerator's own later work. (The most damaging, and the one that
runs TOWARD SUCCESS.)** The enumerator controls frame composition: which companies enter F (≥ 210
admissible rows, §20.22 L986) and the class prediction per row. A person who knows they will
personally hand-construct reference truth for every drawn company, and then rate every held-out
observation, has a direct workload incentive to enumerate companies that are **easy to look up** —
registry-rich, single-jurisdiction, unambiguous identity, well-documented. Those are exactly the
companies on which CPG's registry and Wikidata grounding performs best. §20.18 L982 already concedes
the residual ("Cryptographic sampling integrity ... is **not** independent candidate selection ... the
latter rests on enumerator independence only"), and attack #31 L1041 classes "Operator authors a
globally biased frame" as **UNRESOLVED**. Anticipation travels backwards through time, so **no
ordering rule addresses B1**; only the enumerator's separation from the downstream workload does. It
is the one merge effect that biases toward SUCCESS, and it is created precisely by the chain that
point 3 proposes as safe.

**B2 — class prediction → the same person's reference lookup.** INFERENCE E-1 in operation: §9.7 L635
publishes reference-vs-prediction mismatches; one person on both sides suppresses that statistic and
makes the frame's calibration look better than it is. It propagates: class predictions drive sizing
(§5.6 pilot yield over fill-expected companies) and the CAP-60 fill-expected held-out quota (H1 L947).
A frame whose fill-expected predictions are self-fulfilled by the same person's reference work yields
more STATED reference rows, more scored fills and an easier G1 — and where "the value is easy to find"
drives both the prediction and the reference, CPG tends to find it too. **Also toward SUCCESS.**

**B3 — joint enumeration destroys the blindness of the Author/Confirmer pair.** §9.1 L563–564 requires
that they "never communicate before both have submitted". Two people who jointly built the frame have
already agreed — *by design, because the frame is one artefact* — on every company's identity
resolution, decisive identifier, jurisdiction family and class prediction. Their later "independent"
constructions are two draws from a **shared, self-authored prior**, not two independent draws. §9.5's
`AGREED` rate and §9.8's independence class both assume independence. **`AGREED` is inflated, the
disagreement rate collapses, the adjudicator's packet approaches empty, and the reconciliation control
does no work** — while every artefact check passes. This is the reference-side twin of §2.6, and
arguably worse, because §9.5 L620 makes `AGREED` rows unoverridable. The frame must precede reference
truth, so **no ordering fixes B3 either.**

**B4 — the register cannot be kept truthful across the CPG-output boundary.** `personnel.mjs:8-12`
requires every declaration key to be `"no"` (line 37), including `ran_or_saw_cpg_output`, and the
comment at line 7 applies the §4A.2(a)/(b) keys "for enumerators **and all roles alike**". §4A.2(b)
L158 scopes the condition — "before completing the frame" — but **the machine does not scope it**. A
rater necessarily sees CPG output in order to rate. So:

- a person who enumerates and later rates is representable in the register only while it is evaluated
  *before* they rate; re-run `check-personnel` afterwards and it exits 1;
- §4A.3 L189 publishes the person-to-label fingerprint "**before the held-out commitment transaction
  is broadcast**" — i.e. long before rating — so the published fingerprint attests to a register state
  that later becomes false;
- an outsider re-running `check-personnel` on the archived register (§13.2 L811 publishes the
  fingerprint) gets a result whose meaning depends on *when* the declarations were true, and no
  artefact carries that time.

Strictly, this already bites in the seven-person design — no rater can truthfully answer
`ran_or_saw_cpg_output = "no"` after rating. It is tolerable there because the register is fixed once,
early. It becomes structural in any design where one person's roles span the CPG-output boundary, and
it yields a clean mechanical statement of the ordering constraint: **reference roles require
`ran_or_saw_cpg_output` to be false at the time they act; rating roles necessarily make it true;
therefore any reference role performed after any rating role is unrepresentable in a truthful
register.** Forward-only ordering is *necessary* — coordinator point 3 is right about that — but B1,
B2 and B3 show it is nowhere near *sufficient*.

### 2.8 Order dependence, stated explicitly

The task asks where order matters. The evidence chain is fixed: **enumerate → draw → pilot → reference
records → reference adjudication → seal → authorised run → rate → rating adjudication** (§9.2.1 L590,
§6.5 L460–463, §12.2 L776). Within it:

- **EN → R/TA is CONTAMINATING; R/TA → EN is DISQUALIFYING and impossible.** §4A.2(b) L158 forbids an
  enumerator who has "seen any CPG output ... before completing the frame", and a rater has seen CPG
  output for every held-out observation. A frame built afterwards is attack #31 / §20.18 exactly. The
  chain also makes it temporally impossible within one study. **This is the clearest order asymmetry
  in the design** — and note it is asymmetric in *contamination* only, not in B1, which runs backwards
  regardless.
- **A/C → RA has no safe order.** §9.2.1 L590 fixes adjudication after both record sets, so the
  adjudicator's own record is always already written. There is no ordering in which the reverse holds.
- **Reference → rating has no safe reverse.** Reference truth is sealed before execution (§9.6 L628)
  and rating follows execution, so a reference role is always the earlier one. The conservative
  direction of §2.3 is therefore the only direction this overlap ever takes.

---

## 3. The operator (task 4)

### 3.1 Textual basis for the exclusion

Three clauses, and they are declaratory rather than derived:

- §4A.3 L175 lists "operator (key custodian; **not independent**)" — a stipulated status, not a
  finding about the person's relationships;
- §4A.3 L184: "**no independent role is held by the operator**";
- §4A.2 L159: an enumerator must "not be the operator (key custodian)".

And the operator's exclusion radiates outward through §4A.1 item 6 L138, which disqualifies any
person who is a partner, family or household member of, or in a reporting relationship with, "the
operator (key custodian)".

### 3.2 What the operator may legitimately do

| Act | Textual authority |
|---|---|
| Hold the wallet key; create `O_dev`, `O_ho`, the checkpoint | §19.1 L938–939 (role `STUDY_OPERATOR`); §19.3(2) L958; §5.5 L262 |
| Broadcast the commitment transactions | §5.5; §23 L1058 |
| Hold pilot outputs | §11 L719: "Its outputs are held by the operator, **never** shown to the reference team, and never used for any purpose except sizing and harness debugging" |
| Receive the seal hash — and only that | §9.6 L629: "**The operator receives the seal hash only.** The reference file stays with the reference team until execution and archiving are complete" |
| Choose when to start the run after the window opens | §6.5 L464: "The operator chooses when to start after the window opens" |
| Execute the single authorised held-out run | §6.5 L462–463 |
| Sign the no-preview declaration | §6.5 L481 |
| Run the tooling and the analysis | Implied throughout; §21 has an outsider run the same commands. §9.6 L631 states the guarantee this rests on: "**the operator therefore cannot choose reference values after seeing CPG output:** the values are sealed first and never visible to the operator" |

The boundary is coherent: the operator may hold keys, custody, money, timing and compute, and may run
any deterministic command whose output an outsider can rebuild — because none of that is an act of
**judgement about an observation**. What the operator may never do is supply a reference value, a
label, or an adjudication.

### 3.3 Four places where a strict reading forbids what is currently done

**OP-FLAG-1 — `reconcile` and `seal` have no named runner. (The most consequential gap.)** §9.5 L623
says the reconciled file "is produced **only** by `reconcile`" and §9.6 L627 that "`seal` binds ..." —
neither names *who runs them*. Both require the three blind-record files as input. If the operator runs
`reconcile`, the operator sees every reference value **before** the seal, which §9.6 L629/L631 asserts
cannot happen and which §18.3 L916 makes a halt condition: "a protocol violation is found mid-run —
for example ... **the operator having seen reference truth**. The run is **void, not repaired**." So the
protocol simultaneously forbids the outcome and leaves the step unassigned. In the seven-person design
the reference team can run it; **in any reduced-headcount design this is the hole through which the
operator inevitably sees reference truth pre-seal, and it voids the study.** This should be closed by
naming the runner before registration, not after.

**OP-FLAG-2 — §6.5's "reading" limb, read strictly, voids every study.** §6.5 L466 defines a
prohibited preview as "Any execution of CPG ... **or any reading of stored CPG output (logs, persisted
results)**" where the input identifies a frame company and it is "performed by study personnel"
(L468). L471(a) then fixes the window for a held-out company as "at any time before the authorised run
starts, **or after it completes**."

Raters read CPG's value and cited URLs for held-out companies **after the run completes** — that is
the §12 task. The rating adjudicator does the same. The operator does it to run `evaluation-items`,
`rater-packet` and `analyze`. §13.1 L806 archives "The complete `lookupGroundedCompanyFacts` response
per company" and §13.2 L811 **publishes** the CPG response set. Under a strict reading all of this is a
preview, and §6.5 L497 makes the consequence absolute: "**The study is VOID**, not flagged."

The intended reading must be that the limb targets execution and out-of-band reading, not the
protocol's own downstream artefacts — but the text carves out nothing. This is head-count-independent
and worth a correction before registration; it is also the clause a hostile reviewer would reach for
first. **Owner decision needed** (see §5, Q3).

**OP-FLAG-3 — §5 L194 read strictly forbids the operator from drawing the sample.** "Every person
performing a §5 task satisfies §4A." §5.5 tasks include broadcasting the commitments and running
`draw-development` / `draw-held-out`, which the key custodian performs (§19.1 L938–939). If "satisfies
§4A" means "satisfies §4A.1's independence conditions", the operator fails and a strict reading forbids
the operator from performing the draw — leaving nobody able to, since only the custodian can spend the
outpoints. The §5 heading L192 ("executed by independent people, not by this document") suggests the
sentence is aimed at *dataset construction* rather than at custody acts, but the text does not say so.

**OP-FLAG-4 — §4A.1's opening sentence, applied to the operator, is self-defeating.** L131: "A person
is **not independent, and may hold no role in §4A.3**, if ..." — and the operator *is* a §4A.3 role
(L175) whose holder is explicitly "not independent". Read literally, the operator may not be the
operator. The carve-out lives in L175/L184 rather than in L131. Drafting only, with no practical
consequence — but it is the kind of seam an amendment would tear.

---

## 4. Blinding under a two-human design (task 5)

Detailed in `INFORMATION_FLOW_GRAPH.md` §4 and `OUTSIDER_VERIFIABILITY_DELTA.md`. The essentials:

**What the packets actually withhold** — the machine definition, from `packets.mjs`:

- Reference-adjudication items carry exactly `REFERENCE_ITEM_KEYS` (`packets.mjs:12`) and each record
  exactly `RECORD_KEYS` (`packets.mjs:14` = `BLIND_RECORD_COLUMNS` minus `candidate_id`, `field`,
  `recorded_by`, `recorded_at`, `constructed_without_cpg`). **No recorder identity, no timestamps**,
  and agreeing records are never released (`packets.mjs:31`). Verified by rebuild (`:55-56`).
- Rating-adjudication items carry `RATING_ITEM_KEYS` (`:16`) = the rater item plus `label_a`,
  `label_b`. No rater identity, no other items' labels, no class, split or pilot.

**What blinding survives two humans: only the *position* assignment, and only against third parties.**
Record 1/2 and Label A/B positions derive from `order_key` over `ho_record_sha256` (§12.1 L745), which
"cannot be known before the held-out drand round exists" (L752). That makes the position **unguessable
in advance**. It does not make the content **unrecognisable afterwards by its own author** — and the
blind's whole purpose is to stop the adjudicator knowing which item is whose. A participant who wrote
one item identifies it by content and the other by elimination. Precisely: **position-blinding
protects a third party's ignorance of authorship; it cannot protect a participant's ignorance of their
own authorship.** That is the crux, and no packet change reaches it, because the evidence the
adjudication rests on (`search_note`, `source_url`, `expected_value`) is the same evidence that
identifies its author.

**Recognition: when it is disqualifying and when it is a nuisance.** The rule that emerges is simple —
recognition is a **nuisance** where the later act does not judge the earlier work, and
**disqualifying** where it does. §12.2 L778 already concedes the nuisance category: "U1 is single-arm,
so the company and the CPG output for the item are necessarily visible."

| Sequence | What is recognised | Verdict |
|---|---|---|
| A/C → RA | own record body in Record 1 or 2 | **DISQUALIFYING** — the blind is the control |
| R1/R2 → TA | own label as Label A or B | **DISQUALIFYING** — resolution collapses to self-affirmation |
| A/C/RA → R1/R2/TA | own reference row: `search_note` prose from memory, plus `author`/`confirmer`/`resolution`/`adjudicated_by` explicitly | **CONTAMINATING**, conservative in direction (§2.3); disqualifying for a FAILURE/FALSIFIED finding |
| A → C (one person) | — | **DISQUALIFYING** — not recognition but non-existence of a second construction |
| R1 → R2 (one person) | the same item twice, in two derived orders | **DISQUALIFYING** — α becomes intra-rater |
| EN → A/C | the company (nuisance) **and** own class prediction (contaminating) | **DISQUALIFYING for §9.7**, which the same person would then sit on both sides of |
| EN → R/TA | the company (nuisance, necessarily visible anyway) and frame/class context | **CONTAMINATING** — class and split are excluded from the packets (`raterPackets.mjs:55`), and the person carries them in memory |

**Blinding does not survive two humans in any useful sense.** With two people the reference triad and
the rating triad each collapse (§2.5, k ≤ 3 impossible), and both collapses are precisely the
recognition cases marked DISQUALIFYING above.

---

## 5. Risks and owner questions

**Risks**

1. **A two-human design cannot produce a sealable study.** `reconcile.mjs:52` refuses `recorded_by`
   collision and `:59-60` refuses an adjudicator equal to either recorder. Passing would require
   different strings for the same human — fabricated identities, which §4A.1 L147 turns into a
   published finding of non-independence. The floor is mechanical, not procedural.
2. **The green-artefact failure mode is the real danger.** α, the packet rebuilds, `check-personnel`
   and the rating-resolution bindings all continue to pass byte-identically while their semantics
   drain away. Nothing published records the change. This is worse than a refusal.
3. **B1 and B2 run toward SUCCESS** — the direction that damages the claim — and they are created by
   the very "forward-only" chain that looks safest.
4. **OP-FLAG-1 and OP-FLAG-2 are live now**, independent of head-count, and OP-FLAG-2 admits a
   reading under which any completed study is VOID.
5. **X10 (§4A.1 item 6) is unenforceable and easy to breach** when recruiting few people, since a
   reduced roster is likelier to come from one household or team.

**Open owner questions**

- **Q1.** Is a head-count amendment even on the table? If not, the rest is moot: the floor is seven
  by X1/X2/X11, and the instrument enforces it.
- **Q2.** If it is: does the owner accept **five** independent persons (the computed floor at which α
  stays meaningful and the enumerator stays out of rating), rather than two? Four is reachable only by
  giving up one of those two properties (BOTH = 0 at k=4).
- **Q3 (needed regardless).** §6.5's "reading of stored CPG output" limb — does it carve out the §12
  and §13 artefacts? A strict reading voids every study, including a clean one (OP-FLAG-2).
- **Q4 (needed regardless).** Who runs `reconcile` and `seal`? Unassigned today, and if it is the
  operator, §18.3 L916 voids the run (OP-FLAG-1).
- **Q5.** Should `author`, `confirmer`, `resolution` and `adjudicated_by` be stripped from the rater
  packet's `reference_record`? *Offered as an option, not done here.* It would close the explicit
  self-identification channel of §2.2 cheaply and mechanically, but only partially — memory of
  `search_note` remains — and it changes a sealed artefact's shape, so it is a protocol-level decision.
- **Q6.** Any amendment must restate the class-prediction exclusion over all three reference roles,
  not only the adjudicator (INFERENCE E-1). Does the owner accept that as a drafting requirement?

---

*AGENT E, DEEPTECH-HUMAN-MIN-001. Methodology review. No protocol edit, no registration, no frame, no
execution, no network. `research/cpg-u1/**` and `C:/tmp/dt002` unmodified.*

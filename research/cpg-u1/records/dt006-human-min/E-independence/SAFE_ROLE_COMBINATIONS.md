# SAFE_ROLE_COMBINATIONS — DEEPTECH-HUMAN-MIN-001 / AGENT E

**CLASSIFICATION: METHODOLOGY REVIEW.** Not U1 evidence, not an approval, not an amendment.

**Read this first.** Every combination discussed below is **FORBIDDEN-BY-TEXT** today. §4A.3 L184–185
forbids all 28 pairs, and `INDEPENDENCE_ANALYSIS.md` §1.3 gives the matrix. This document answers the
*separate* question the task poses: **if the text were amended, which overlaps would still be
methodologically defensible?** Nothing here licenses anything.

---

## 1. Direct answers to the three questions asked

### 1.1 Can one person be both a reference observer and a rater?

**Methodologically: yes, with a declared limitation — but only for a SUCCESS finding, and only if the
other rater held no reference role.** Textually: no (§12 L726, §4A.3 L184).

The obvious objection — leakage — is **wrong**, and this must be stated clearly because it changes the
verdict. §12 L727 gives every rater "the sealed reference record", and `raterPackets.mjs:60` requires
it to be exactly `REFERENCE_COLUMNS`. **A reference observer who later rates learns nothing they would
not have received anyway.**

The real objection is motivational and narrow. §10.1 is mostly forced: the fill/abstain branch is
mechanically checked (`ratings.mjs:36-38`), the "reference holds an authoritative value?" branch is read
off the sealed `value_kind`, and §10.2 agreement is arithmetic. A rater's discretion lives in exactly
three places — **D1** attributability (→ MISATTRIBUTED-FILL), **D2** REFERENCE-AMBIGUOUS, **D3**
staleness. Self-consistency bias therefore appears as **suppression of D2/D3**: a person defends the
adequacy of their own record.

**Its direction is established, not assumed** (`INDEPENDENCE_ANALYSIS.md` §2.3): three of six
discretion cells run **against** SUCCESS — including both P1-numerator cells — two run toward it, one
is neutral. The against-SUCCESS cells are those where CPG and the reference **disagree**, which is
precisely where an uninvolved rater would have reached for D2, so they carry the large mass. The
toward-SUCCESS cells are those where CPG **agrees** with the rater's own record, where the
self-defending choice is also the uninvolved choice and only the rare "ambiguous despite independent
concurrence" case differs.

| | Verdict |
|---|---|
| A **SUCCESS** obtained under this overlap | **not inflated by it**; reportable if the overlap is declared and published |
| A **FAILURE** or **FALSIFIED** obtained under this overlap | **confounded** — the bias runs in exactly that direction. FALSIFIED (§10.5 L711, "evidence against the verified-only claim") would be the least trustworthy result the design could produce |
| G1 conclusiveness | suppressing D2 **raises** the fill count (L676), so the run is more likely conclusive **and** more likely to fail |

**Two limits on that comfort.** The direction result assumes self-consistency dominates; the competing
sponsor-aligned motive (§4A.1 item 5 L137 permits a fixed study fee) pushes the opposite way, using D2
to *hide* CPG errors. And a person holding more roles has more invested in the study completing, so the
merge that makes the conservative motive available also amplifies the permissive one. **The direction
result is a reason not to fear an inflated SUCCESS; it is not a safety argument for the merge.**

**Binding side condition.** This overlap is acceptable only if **at least one rater held no reference
role**. If both did, Krippendorff's α stops being a reliability coefficient (§1.4 below) — a separate
and unfixable defect.

### 1.2 Can one person be both a rater and the reference adjudicator?

**No — DISQUALIFYING.** Two independent reasons.

1. **Self-review through D2.** The reference adjudicator *chose* the reference value on contested rows.
   Rating against it means judging whether CPG matches a value they selected, with D2 available to
   declare their own selection inadequate. `reconcile.mjs:72` writes `adjudicated_by` into the
   reconciled row, and `raterPackets.mjs:60` carries the whole row into the rater packet — so the rater
   reads `adjudicated_by: <own pseudonym>` and needs no memory.
2. **Direction reverses.** Unlike the Author/Confirmer case, an adjudicator's stake is in their *choice
   between two candidate values*. Where CPG agrees with the record they rejected, the self-consistent
   label is INCORRECT-FILL; where CPG agrees with the one they chose, SUPPORTED-FILL. The adjudicator
   thus has a live interest in the *rating* vindicating the *adjudication*, which is a closed loop the
   conservative-direction argument of §1.1 does not cover.

The related pair **rater ↔ rating adjudicator** is worse still and is refused mechanically
(`ratings.mjs:98`, `assignment.mjs:33`): §12.2 L762 shows the two labels "unlabelled as 'Label A' and
'Label B'", and with seven labels and one's own decision in memory, self-identification is near-certain.
Every disagreement would resolve for the rater-adjudicator, biasing the endpoint by the entire
disagreement mass.

### 1.3 Can one person be both an enumerator and a reference observer?

**No — DISQUALIFYING**, and this is the combination most likely to be mistaken for safe, because the
temporal order is clean (T1 before T7) and §4A.3 L187 names only the *adjudicator*.

§9.2 L569: the Author and Confirmer "never receive ... **the class prediction**." An enumerator did not
*receive* it — they **wrote** it. §9.7 L635 publishes the mismatch between reference truth and the class
prediction. One person on both sides makes that published statistic **self-fulfilling**: they search the
same public sources from which they formed the prediction, so they find a STATED value where they
predicted fill-expected.

This is exactly X4's stated rationale — "the enumerator authored the class predictions whose mismatches
with reference truth are published (§9.2, §9.7)" — applied to the roles X4 does not name. Recorded as
**INFERENCE E-1**: the special case is under-inclusive relative to its own reason. Harmless under the
universal rule; **live the moment anyone relaxes the universal rule while keeping the special case.**

It also propagates. Class predictions drive sizing (§5.6 pilot yield over fill-expected companies) and
the CAP-60 fill-expected held-out quota (H1 L947). A frame whose fill-expected predictions are
self-fulfilled by the same person's reference work yields more STATED reference rows, more scored fills
and an easier G1 — and where "the value is easy to find" drives both the prediction and the reference,
CPG tends to find it too. **This biases toward SUCCESS** (edge B2), the dangerous direction.

**Contrast, because it is the design's sharpest order asymmetry.** `EN → rater` is only
CONTAMINATING — the enumerator's own work is not what the rater judges, and §4A.2(b) L158 scopes its
prohibition to "before completing the frame", which an enumerate-then-rate sequence satisfies. The
reverse, `rater → EN`, is DISQUALIFYING and temporally impossible: a frame built after seeing CPG output
is attack #31 L1041 / §20.18 L982 exactly.

### 1.4 The α side condition, stated once

Krippendorff's α is a **reliability** coefficient: it presupposes coders that are exchangeable draws
from a population of competent coders, independent of each other. §12 L732 adopts "≥ 0.667 [NORMATIVE —
Krippendorff's own floor for tentative conclusions]", a claim about the reproducibility of the
*procedure*.

**If both raters previously worked the same rows as Author and Confirmer, α is inflated and no longer
measures what §12 intends.** On `AGREED` rows — the majority in any functioning reference process — both
independently recorded the same value, both have the same stake, and both suppress D2: correlated
suppression of the same escape hatch lowers observed disagreement and raises α. On adjudicated rows the
incentives oppose and α falls locally, but that mass is the minority.

Beyond the value, the meaning changes: two coders who jointly built the coding material are not
exchangeable draws, so α becomes a consistency statistic for one jointly-primed pair.

**No tooling fixes this.** `analyze` computes α correctly from two sheets and cannot know their authors
shared a prior. §15.5(3) L863 makes α < 0.667 an INCONCLUSIVE condition, so the merge makes a guard
**easier to pass**: the artefact goes green, the gate stops gating, and no published artefact records
that the coefficient changed meaning. `ratings.mjs:97` checks `sheet1.rated_by !== sheet2.rated_by` —
distinctness of *strings*, never independence.

**Design rule.** α retains its meaning **iff at least one rater held no reference role.** If exactly one
rater is reference-primed, α is not inflated and may be depressed (the coders' D2 incentives differ),
which is conservative.

---

## 2. Summary table: every pair, both layers

`F` = forbidden by text (all pairs) · Layer-2 verdict is this agent's inference.

| Pair | Text | Method | Decisive reason |
|---|---|---|---|
| EN ↔ EN (several enumerators) | **PERMITTED** (§4A.3 L186) | **HARMLESS** | The only permitted multiplicity; it adds people, never removes any |
| A ↔ C | F | **DISQUALIFYING** | Non-existence of a second construction; `AGREED` unoverridable (§9.5 L620); `reconcile.mjs:52` |
| A ↔ RA · C ↔ RA | F | **DISQUALIFYING** | Own record recognised inside the Record 1/2 blind; no reverse order exists; `reconcile.mjs:59-60` |
| R1 ↔ R2 | F | **DISQUALIFYING** | α becomes intra-rater; §15.5(3) gate trivially passed; `ratings.mjs:97` |
| R1 ↔ TA · R2 ↔ TA | F | **DISQUALIFYING** | Own label recognised inside the Label A/B blind; `ratings.mjs:98` |
| EN ↔ A · EN ↔ C | F | **DISQUALIFYING** | §9.7 mismatch self-fulfilling (INFERENCE E-1); biases toward SUCCESS |
| EN ↔ RA | F (§4A.3 L187 **by name**) | **DISQUALIFYING** | The protocol's own stated rationale |
| A ↔ R1/R2 · C ↔ R1/R2 · RA ↔ R1/R2 | F | **CONTAMINATING** (conservative) | No information edge; D2/D3 suppression; direction against SUCCESS. Disqualifying for FAILURE/FALSIFIED. RA variant worse (§1.2) |
| A ↔ TA · C ↔ TA · RA ↔ TA | F | **CONTAMINATING** (worst of class) | As above, and the disputed axis is often the reference's own adequacy |
| EN ↔ R1/R2/TA | F | **CONTAMINATING** | Class and split carried in memory past packets built to exclude them; plus backward edge B1 |
| OP ↔ anything | F | **DISQUALIFYING** | §4A.3 L184; for reference roles, §18.3 L916 voids the run outright |

---

## 3. Computed head-count floors

From `exclusion_matrix.mjs` (9 DISQUALIFYING pairs, 12 CONTAMINATING; every canonical partition
enumerated):

```
k=1,2,3 : NO partition avoids a DISQUALIFYING pair
k=4     : 24 partitions;  α-valid 12;  enumerator-clean 6;  BOTH 0;  fewest contaminating edges 3
k=5     : 60 partitions;  α-valid 42;  enumerator-clean 24; BOTH 12; fewest contaminating edges 2
k=6     : 72 partitions;  α-valid 54;  enumerator-clean 33; BOTH 21; fewest contaminating edges 1
k=7     : 73 partitions;  α-valid 55;  enumerator-clean 34; BOTH 22; fewest 0 — the protocol's design
```

| Floor | Value | Basis |
|---|---|---|
| Textual | **7 independent + operator = 8 humans** | §4A.3 L185, §19.3(3) L959 |
| Methodological, no DISQUALIFYING pair | **4 independent** | computed; reached only by cross-matching the two triads |
| Methodological, also α-valid **and** enumerator out of rating | **5 independent** | computed; BOTH = 0 at k=4, 12 at k=5 |
| Fully clean (no contaminating edge either) | **7 independent** | exactly one of the 73 partitions: the protocol's |

**Why k ≤ 3 is impossible.** {A, C, RA} are pairwise DISQUALIFYING, so they need three distinct people;
{R1, R2, TA} likewise; and EN is DISQUALIFYING with all three reference roles. At k=3 all three people
already hold reference roles, so EN necessarily collides with one. **A two-human design fails on
methodological grounds alone, before the text is consulted** — which is the central answer this stream
was asked for.

**The k=4 trade-off is provable, not a matter of taste.** BOTH = 0 means every 4-person partition either
draws both raters from the reference-role holders (α dies, §1.4) or puts the enumerator in a rating role
(edge B1 — and B1 biases toward SUCCESS). A 4-person design must choose which to give up, and must say
which in the registration.

An example 5-person partition with neither defect (from the census):

```
enumerator=P1  reference-author=P2  reference-confirmer=P3  reference-adjudicator=P4
rater-1=P2     rater-2=P5           rating-adjudicator=P3
```
Residual contaminating edges: `reference-author|rater-1` (P2) and `reference-confirmer|rating-adjudicator`
(P3) — both of the conservative class, and rater-2 (P5) held no reference role, so α survives.

---

## 4. The two-human chain, tested

The chain proposed for testing: two people P and Q both enumerate, then act as Author/Confirmer, then
as rater-1/rater-2 — argued safe because information flows only forward.

**It cannot be closed.** It assigns four of seven roles. The reference adjudicator and the rating
adjudicator have three possible homes and all three fail:

- **RA = P (the Author)** — adjudicates its own record against Q's. `reconcile.mjs:59-60` refuses it.
- **RA = the operator** — §18.3 L916: a halt condition is "**the operator having seen reference
  truth**. The run is **void, not repaired**."
- **RA = a third person** — then it is not a two-human design.

Identically for the rating adjudicator. **The chain is a five-human design with two roles unassigned.**

**And forward-only is not sufficient even for the roles it does assign.** Four backward edges
(`INFORMATION_FLOW_GRAPH.md` §4.3):

- **B1** — frame composition anticipates the same person's later reference and rating workload, pushing
  toward easy-to-look-up companies, which are exactly where CPG's grounding performs best. **Toward
  SUCCESS.** §20.18 L982 and attack #31 L1041 already class frame bias as UNRESOLVED. Anticipation runs
  backwards through time; **no ordering rule reaches it.**
- **B2** — class prediction and reference lookup by one person makes §9.7's published mismatch
  self-fulfilling, and propagates into sizing and the CAP-60 quota. **Toward SUCCESS.**
- **B3** — joint enumeration destroys the Author/Confirmer blind before it starts. Two people who built
  one frame have already agreed on every company's identity resolution, decisive identifier and class
  prediction *by design*. Their later "independent" records are two draws from a shared, self-authored
  prior, so `AGREED` is inflated, the disagreement rate collapses, and the reconciliation control does
  no work — while §9.5 L620 makes `AGREED` unoverridable and every artefact check passes.
- **B4** — `ran_or_saw_cpg_output` is unscoped in `personnel.mjs:11` though §4A.2(b) L158 scopes it to
  "before completing the frame". A rater necessarily sees CPG output, so **any reference role performed
  after any rating role is unrepresentable in a truthful register.** This is the clean mechanical
  statement of why forward-only ordering is *necessary*; B1–B3 are why it is not *sufficient*.

**Verdict.** Forward-only ordering is a genuine and necessary insight — it is what makes `EN → rater`
merely contaminating rather than disqualifying, and it is why reference→rating overlap is conservative.
It does not rescue a two-human design, because the two adjudicator roles cannot be placed and because
B1–B3 run backwards regardless of order.

---

## 5. If the owner reduces head-count anyway

Not recommendations to act, and not work done. Ordered by how much they buy.

1. **Do not go below five.** Four costs α or the enumerator's separation, provably (BOTH = 0).
2. **Keep the two triads intact.** {A, C, RA} pairwise distinct and {R1, R2, TA} pairwise distinct are
   the nine DISQUALIFYING pairs; every safe partition cross-matches the triads rather than collapsing
   either.
3. **Keep at least one rater free of every reference role** — the α side condition (§1.4).
4. **Keep the enumerator out of all three reference roles** (INFERENCE E-1) and, if possible, out of
   rating too (edge B1, the only merge effect that biases toward SUCCESS).
5. **Name the runner of `reconcile` and `seal`** before registration. Unassigned today, and if the
   operator runs it, §18.3 L916 voids the run (`INFORMATION_FLOW_GRAPH.md` F1).
6. **Restate the class-prediction exclusion over all three reference roles**, not only the adjudicator,
   in any amended §4A.3 (INFERENCE E-1).
7. **Declare every overlap in the registration, with its direction**, and state which outcomes it
   permits: a SUCCESS under a reference→rating overlap is reportable; a FAILURE or FALSIFIED is
   confounded and should be labelled so on its face.
8. *Option, not done:* strip `author`, `confirmer`, `resolution` and `adjudicated_by` from the rater
   packet's `reference_record`. It closes the explicit self-identification channel
   (`INFORMATION_FLOW_GRAPH.md` F2) cheaply and mechanically, but only partially — memory of
   `search_note` remains — and it changes a sealed artefact's shape, so it is a protocol decision.
9. **Amend `personnel.mjs`'s declaration model to carry a scope or an as-of time** for
   `ran_or_saw_cpg_output`, or the register cannot be truthfully maintained past the first rating (B4).

**What no measure buys back.** α's meaning as a reliability coefficient once both raters share a
reference prior; the Record 1/2 blind once the adjudicator wrote one of the records; the Label A/B blind
once the adjudicator cast one of the labels; and the independence of two reference constructions once
one person makes both. Those are properties of who the people are, not of what the artefacts contain.

---

*AGENT E, DEEPTECH-HUMAN-MIN-001. Methodology review. Every combination above is forbidden by
§4A.3 L184–185 as the protocol stands. `research/cpg-u1/**` and `C:/tmp/dt002` unmodified.*

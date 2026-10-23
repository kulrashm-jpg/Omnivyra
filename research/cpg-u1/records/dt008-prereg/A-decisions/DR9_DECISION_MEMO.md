# DR-9 — What an enumerator may know about counts

**CLASSIFICATION: PREPARATION. This memo presents options and a recommendation; it decides nothing.**
No protocol byte, no instrument byte, no hashed object modified. `C:/tmp/dt004-operations/` was read and
**not written**. No real frame, no enumeration, no network, no credentials, no company named.

**Baseline recomputed for this memo.** `main` `33bceb1f919113c622587fa7c6403a0d4596bbad`;
`research/cpg-u1` tree `2d66f68088e6f230d8ae92b180b6db53c49502b4`; protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; instrument aggregate
`<NEW_AGG>` (<NEW_N> files) read-only from
`C:/tmp/dt002/research/cpg-u1/tooling`. Worktree tooling tree (587 files,
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`) not used as the instrument, not
written.

---

## 1. The three clauses that decide everything below

**§4A.2, lines 163–168 — the receive-list, and it is exhaustive ("receive only"):**

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, **§5.1–§5.4**;
> - the jurisdiction-family list;
> - the development-only registry.

**§5.7.2 IS NOT IN THAT LIST.** §5.1–§5.4 stops at §5.4; §5.5, §5.6, §5.7, §5.7.1 and §5.7.2 are all
outside it.

**§4A.2, line 170 — the never-receive clause, and its parenthetical is decisive:**

> **They never receive:** pilot results, sizing output, quotas or any CPG output **(§5.5, §5.7.2)**.

The parenthetical names **§5.7.2**, which is the section that states `E ≥ 126 / 52 / 32` (line 385) and
"At least 210 eligible admissible rows" (line 409). **Those numbers are therefore expressly on the
barred side of the clause, by the protocol's own cross-reference.**

**§5.5, line 288 — the barrier restated as a NORMATIVE bullet under "Single frozen frame":**

> - **Enumerator barrier.** Enumerators never receive pilot, sizing or quota information (§4A.2).

Two further facts that shape every verdict below:

- **An enumerator physically cannot compute sufficiency.** `check-frame-sufficiency` requires `--scan`,
  and `scan` requires a clean clone at the frozen resolver SHA, which §4A.2 does not give them
  (verified by Agent E, `INFORMATION_BARRIER_ANALYSIS.md`). Every count in the table below can reach
  them **only by disclosure**.
- **The floor is a constant, so the barrier is not time-limited.** During enumeration (§5.5 step 3) no
  pilot has run and no sizing output exists, so the "pilot results / sizing output" limbs are
  temporally vacuous — but `126/52/32` is fixed before the study starts, so the **quota** limb is live
  throughout.

---

## 2. THE CLASSIFICATION TABLE

**(A)** necessary to perform the task · **(B)** could bias candidate selection · **(C)** no
methodological risk.

| # | Item | (A) necessary? | (B) could bias selection? | (C) risk-free? | **VERDICT** | Clause |
|---|---|---|---|---|---|---|
| 1 | **Target frame size — 210** | **No.** It is expressed in *eligible admissible* rows, which the enumerator cannot compute; a scope assignment plus a batch schedule plus a global CONTINUE/STOP signal is sufficient to do the job. | **Yes.** A fixed-fee worker who knows the finish line has an incentive to stop at it, so the tail of the frame is composed of whatever was cheapest to find near the end. And with three classes known from §5.2, a single total invites apportionment guesses. | No | **FORBIDDEN** | §4A.2:163–168 (receive-list exhaustive, §5.7.2 absent); §4A.2:170 "quotas … (§5.5, **§5.7.2**)" — 210 is stated at §5.7.2:409; §5.5:288 |
| 2 | **Per-class thresholds — 126 / 52 / 32** | **No.** Nothing in §5.1–§5.4, which is the enumerator's normative material, refers to a class count. | **Yes — the strongest case in the table.** §5.2 defines the class as "the enumerator's **prediction**, made before any reference research", i.e. an evidential judgement. An enumerator told a class is short has every incentive to lower the evidential bar for that prediction — and §9.7 makes class-prediction-vs-reference-truth mismatch a **published** quantity. The disclosure would bias precisely the judgement whose accuracy the study publishes, making the published mismatch rate an artefact of the instruction. | No | **FORBIDDEN** — the clearest case | §5.7.2:385 states them; §4A.2:170's parenthetical names §5.7.2 expressly; §4A.2:163–168; §5.5:288; aggravated by §5.2:216–224 and §9.7 |
| 3 | **A per-jurisdiction quota** (e.g. 34 / 15 / 10 per family, 59 per family, 236 total) | **No.** The *scope* — which families are mine — **is** necessary and **is** permitted, because the jurisdiction-family list is on the receive-list. The *count* attached to the scope is not necessary for any step of §5.1–§5.4. | **Yes, and it is arithmetically invertible.** × 4 recovers the per-class plan, and the plan's stated margins recover the floor exactly. It is a per-class number wearing a geographic label, so it carries every hazard of row 2. | No | **FORBIDDEN** | As row 2. A per-class count divided by a permitted partition key is still a per-class count. |
| 4 | **The number of candidates to submit** (the "ask") | **Yes, in practice.** With no number at all the enumerator has no planning horizon; the operator ends up supplying one verbally and the record shows neither the number nor its provenance. | **Only if it is protocol-derived or tightly tuned.** An ask of "210 ÷ 2" inverts immediately. An ask stated in **raw candidates submitted** (not eligible admissible rows), **over-provisioned by a wide margin**, and **fixed in advance in writing**, does not invert: the enumerator knows neither the admissibility attrition, nor the ineligibility rate, nor how many enumerators there are (§4A.2 does not tell them). | Not risk-free, but the risk is controllable and bounded | **DECISION REQUIRED** — see §3. Recommended: **PERMITTED** in the form of a batch size that is *not* a protocol-derived quantity (option c); **FORBIDDEN** as any function of 210 or 126/52/32 | §4A.2:163–168 (not on the list); §4A.2:170 ("quotas"); §5.7.2:387 ("enumeration continues first") makes iteration prescribed, not tolerated |
| 5 | **The current running count** — split in two | | | | | |
| 5a | *their own* submitted-row count | Not necessary, but **unavoidable**: they wrote the rows. | No — it is their own work, and it carries no information about any threshold or about anyone else. | **Yes** | **PERMITTED** | §4A.2 constrains what an enumerator *receives*; nothing constrains knowledge of their own output. Their own `frame` row-level diagnostics are likewise permitted, being §5.1–§5.4 enforcement on their own rows. |
| 5b | the **combined** per-class eligible-admissible count | **No.** | **Yes.** Over two rounds it enumerates the threshold: "we have 118 fill-expected, get 8 more" discloses 126. It is quota information in all but name, and it is also the output of a command the enumerator may not run. | No | **FORBIDDEN** | §4A.2:170; §4A.2:163–168; it is `check-frame-sufficiency` output, and §5.7.2 is off-list |
| 6 | **The remaining count** (threshold − current) | **No.** | **Yes — and worst of all, because no inference is needed.** Given an enumerator's own count (row 5a, permitted), a remaining count *is* the threshold minus a quantity they already have. It discloses the floor in one step, with certainty, and it discloses the combined state of the frame. | No | **FORBIDDEN under every option, including the permissive one** | §4A.2:170; §4A.2:163–168. Even under option (b), where the *floor* is pre-registered and disclosed, a *remaining* count still discloses the live combined composition, which is 5b by subtraction. |

**The one unavoidable residual, recorded so nobody mistakes it for compliance.** §5.7.2:387 requires
iteration — "If unmet, **no development commitment may be made; enumeration continues first**" — so
something must say "continue". A **global** CONTINUE/STOP signal, naming no class, leaks **≤ 1 bit of
§5.7.2 per round**: after `k` rounds of batch size `b`, the enumerator has localised the total floor to
within `b`. This is irreducible, it is not what §4A.2 aims at (the bit is about the total, never a
class), and it is bounded to irrelevance by (i) fixing the batch schedule in advance and in writing, so
"continue" is expected rather than informative, (ii) making every round's ask identical and symmetric
across enumerators, and (iii) never naming a class, an accepted-row count or a residual.

**PERMITTED per-class instruction of any kind: none numeric.** Every weaker variant of row 2 — "your
abstention-expected count is low", "we have enough fill-expected", "stop submitting identity-hazard
rows" — is barred for the same reason as row 2: **any instruction whose content varies with a class is
barred**, because the class is the enumerator's published prediction.

---

## 3. The live conflict: does `JURISDICTION_PARTITIONS.md` breach §4A.2?

The section, `C:/tmp/dt004-operations/dataset/JURISDICTION_PARTITIONS.md` (187 lines,
sha256 `e3f9ae01faf329ee7f470a0b5ad4746c9e108254628f4a5998811828a868b589`, **read only, unmodified**),
heading at line **166**:

> ### What an enumerator should therefore target
>
> **Target ≈ 236 rows expected to be eligible admissible — 136 / 60 / 40, split evenly across the four
> families (34 / 15 / 10 per family).**

### VERDICT: **YES. Handing that section to an enumerator breaches §4A.2.** Five grounds, each independent.

1. **It is §5.7.2 content, and §5.7.2 is not on the receive-list.** The receive-list is "receive
   **only** … §4A, §5.1–§5.4". The section's numbers are derived, by arithmetic the document itself
   sets out at its §1 and in the table at lines 132–145, from `E ≥ 126/52/32`.
2. **The never-receive clause names §5.7.2 expressly.** "quotas **(§5.5, §5.7.2)**". `136/60/40` and
   `34/15/10` are quotas in the ordinary sense of the word and in the protocol's own sense.
3. **They are per-class**, which is the aggravated category of row 2: they bias the §5.2 *prediction*
   whose mismatch with reference truth §9.7 publishes.
4. **They are trivially invertible back to the floor.** The section's own preceding table gives the
   floor beside the target and the margin as percentages (+7.9 % / +15.4 % / +25.0 %), and
   `34 × 4 = 136`, so an enumerator holding the section can recover `126/52/32` and `210` without
   effort. Redaction of the numerals alone would not help: the ratios and the margins carry the same
   information.
5. **§5.5:288 repeats the bar as a NORMATIVE bullet**, so the breach is not a technicality of one list.

### Three things that verdict does **not** mean

- **The document is not defective.** It is an **operator** planning artefact, classified PREPARATION,
  and as such its numbers are exactly right and necessary — the operator must size the ask, and §5.7.2
  is operator material. Its own "Why margin" text already states that enumerators never see quota
  information. **Nothing in it should be deleted or edited on account of DR-9.**
- **The breach is realised only on release.** It occurs when the section reaches an enumerator, not by
  the section existing.
- **Redacting the named heading is NOT sufficient, and an operator who does only that has not fixed
  it.** The floor `126/52/32` appears in the document's **§1** ("The floor, and where it comes from",
  lines 12–90) and again in the plan table at lines **132–145**. **The whole document is operator-only.**
  The correct control is a release classification on the file, not a redaction inside it.
- One incidental correction, unrelated to DR-9 but found while reading the enumerator-facing material:
  `ENUMERATOR_WORKSPACE.md` §6 says "the **23** template columns". `FRAME_COLUMNS` has **22** entries
  and `templates/candidate_frame.template.csv`'s header has 22 fields (verified by import from the
  frozen instrument). Reported, not edited.

---

## 4. The three options

### Option (a) — STRICT: scope only, no number at all

Enumerators receive the §4A.2 packet, a family scope, a `candidate_id` prefix and the quota-free class
sentence. No count of any kind. The operator runs `check-frame-sufficiency` and says "continue" or
"stop".

| | |
|---|---|
| **Barrier** | Preserved absolutely for every numeric item. |
| **Cost** | The operator must be available to iterate every round; the enumerator has no planning horizon and cannot quote or schedule their own work. |
| **Failure mode** | The number gets supplied informally anyway — verbally, or invented by the enumerator — and **nothing is on the record**. That is strictly worse than option (c), because the barrier is then breached without a trace. |
| **Reversible?** | Yes, at any time, in either direction. |
| **This is what the frozen-adjacent tooling already implements** | `C:/tmp/dt007-eight-person/C-partition-tooling/partition/partition.mjs` emits scope with no count, and its §4A.2 barrier *refuses* any input carrying `quota`, `target`, `count`, `minimum`, `pilot`, `sizing` or a bare number. |

### Option (b) — PERMISSIVE: pre-register the §5.7.2 floor as execution-independent

Pre-register, before any enumeration, that the §5.7.2 floor and the planned margin form part of the
enumerator packet, on the ground that they are protocol constants derived from `CAP 60` over all 4096
permitted pilot outcomes and carry **zero** information about any CPG execution.

| | |
|---|---|
| **The argument for it is real** | `126/52/32` is `2·Qmax + Dev` per class, computed by `lib/frame.mjs` from the frozen sizing rule over all 4096 outcomes. It is a constant fixed before the study begins, is public in the registered protocol, and reveals nothing about what CPG did. |
| **Why it still fails on the merits** | The barrier is not only an information-leak rule. §20.18 and §22 row 31 make enumerator independence the sole control against a *globally biased frame*, and a per-class target is the single most composition-shaping input that exists: it converts the §5.2 prediction from a judgement into a budget line, and §9.7 publishes the consequence. The information is public; the *instruction* is what biases. |
| **And it buys the least** | Against option (c) it saves only the writing of a batch schedule. It does not remove the need for a stop signal, because attrition is still unknown. |
| **Irreversible** | **Option (b) cannot be adopted after enumeration begins.** It is a pre-registration act; retrofitting it would mean disclosing a threshold mid-run to an enumerator whose earlier rows were produced blind, which is a mid-run change to the enumeration instruction and a §15.5(7)-class problem. §5.5 puts registration at step 2 and enumeration at step 3, so the window closes at registration. |

### Option (c) — SPLIT: scope, plus an over-provisioned batch size that is not a protocol-derived quantity — **RECOMMENDED**

Enumerators receive the §4A.2 packet, a family scope, a `candidate_id` prefix, the quota-free class
sentence, and a **batch schedule**: a batch size `B` in *raw candidates submitted*, and a maximum number
of batches, both fixed in writing before enumeration begins and both chosen as round working numbers
that are **not** any function of `210`, `126`, `52`, `32`, `236`, `136`, `60` or `40`, and not divided by
the number of enumerators.

| | |
|---|---|
| **Barrier** | Every item in §2's table stays on its correct side. No protocol-derived quantity crosses. Row 4 becomes PERMITTED because the number is not the protocol's. |
| **Cost** | Writing down a batch schedule, once. Some over-collection — which `JURISDICTION_PARTITIONS.md` already shows is the cheap direction: over-enumerating costs screening effort only, while under-enumerating after the commitment is `STAGE_VOID_FRAME_INSUFFICIENT`, unrecoverable. |
| **Auditability** | The schedule is hashed and published before enumeration, so an outsider can confirm that the number the enumerator worked to was not derived from the floor. **This is the reason to prefer (c) over (a):** (a) leaves the number undocumented; (c) documents that it is not protocol-derived. |
| **Reversible?** | Yes. Batch size may be revised upward between rounds provided the revision names no class and is symmetric across enumerators. |
| **Two constraints on `B`** | (i) It must be **generous** — an ask tuned near the floor would invert (`210 / 2 = 105`); over-provision by a wide factor destroys that inference *and* serves convergence, and the two requirements point the same way. (ii) It must be counted in **candidates submitted**, never in eligible admissible rows, because the latter would require the enumerator to know the scan outcome. |
| **What it does not solve** | The ≤ 1 bit per round of the global CONTINUE/STOP signal (§2, residual). Bounded by publishing the maximum batch count in advance. |

### RECOMMENDATION

> **Adopt option (c).** It preserves the barrier exactly as option (a) does, costs one written schedule
> more, and converts the one unavoidable number from undocumented operator discretion into a
> pre-published, auditably non-protocol-derived quantity. **Reject option (b)** — it pays the largest
> evidential price (a per-class budget handed to the person whose per-class *prediction* the study
> publishes) for the smallest operational gain, and it is the only option that cannot be undone.
>
> **DECISION REQUIRED, and it is on the critical path:** option (b)'s window closes at registration
> (§5.5 step 2 → step 3), so the owner must rule between (a)/(c) and (b) **before** the OSF submission,
> not before enumeration.

The replacement wording under option (c) is in **`DR9_ENUMERATOR_INSTRUCTION_TEXT.md`**, verbatim and
ready to paste. Under option (a) the same file applies with §5 (Volume) deleted; under option (b) §5
would instead state the floor and margin, and that variant is deliberately **not** drafted here, so that
adopting (b) requires a positive act by the owner rather than a copy-paste.

---

## 5. The quota-free class sentence, priced at ≈ 98.6 h (−36.6 %)

The sentence (from `C:/tmp/dt007-eight-person/B-partition/PARTITION_DESIGN.md` §4 item 6; priced in
`WORKLOAD_ARITHMETIC.md` §3):

> Rows must cover all three outcome classes of §5.2. `fill-expected` will be the commonest; deliberately
> seek candidates of the other two kinds as well.

### Does it disclose a number? **NO — verified at character level.**

The only numeral-bearing token in the sentence is the word **"three"**, and it is the count of classes
in §5.2, which the enumerator receives as part of §5.1–§5.4 and can therefore already count for
themselves. No digit appears. No ratio, no percentage, no threshold, no total, no margin, no per-family
figure. `126`, `52`, `32`, `210`, `236`, `136`, `60`, `40` do not appear and are not recoverable from it:
the sentence is compatible with any frame size whatsoever.

### Admissible under the recommended option? **YES — admissible under (a), (b) and (c) alike.**

Grounds: it states a qualitative property of the *population*, not of the *plan*; it names no class
count and no mix; and it does not vary with the state of the frame, so it can be given once, at the
start, and never revisited — which is exactly what distinguishes it from the forbidden variants in §2
("your abstention-expected count is low"), all of which are functions of the live composition.

### One honest wrinkle, named not smoothed

"`fill-expected` will be the commonest" discloses the **rank order** of the three classes — at most
log₂3 ≈ 1.58 bits — and that rank order happens to coincide with the order of the floors
(126 > 52 > 32). Three reasons it is nevertheless admissible, and one fallback if the owner disagrees:

1. **It is independently derivable from §5.1–§5.4, which the enumerator has.** §5.2 makes
   `fill-expected` a **disjunction** ("at least one of the three fields"), `abstention-expected` a
   **conjunctive negative** over all three fields, and `identity-hazard` a requirement that a *second*
   real confusable entity exist and be named. In any population of admissible companies the disjunction
   is commonest by construction. The sentence states a fact about the world that the enumerator would
   reach unaided, not a fact about §5.7.2.
2. **It is not invertible to any magnitude.** A rank order constrains no count, no ratio and no total.
3. **It is static.** It carries no information about the frame being built.

**Fallback variant, if the owner prefers to disclose nothing ordinal:**

> Rows must cover all three outcome classes of §5.2. Seek candidates of each kind deliberately; do not
> aim for any particular mix.

This drops "commonest" and keeps the load-bearing part — *deliberate* pursuit of the two scarcer kinds,
which is where the saving comes from, since the alternative is accepting natural incidence and then
converging on the scarcest class through blind rounds. The saving is substantially but not wholly
preserved; the residual cost is that the enumerator may over-invest early in the two harder classes.
**DECISION REQUIRED (low stakes): primary sentence, or fallback?** Recommended: **the primary
sentence**, on grounds 1–3.

### A caution about the ≈ 98.6 h figure itself

`WORKLOAD_ARITHMETIC.md`'s pricing rests on stated per-row time assumptions (25 / 40 / 55 minutes) and
a stated incidence shift (0.50 / 0.28 / 0.22 under the qualitative instruction), and
`RECONCILIATION_LOG.md` records that the orchestrator accepted those **as argument, not independently
re-derived**. This memo does not re-derive them either. **The sentence's admissibility does not depend
on the figure**, and the recommendation stands on the barrier analysis alone — the figure is the reason
to bother, not the reason it is lawful.

---

## 6. What remains DECISION REQUIRED

| # | Question | Deadline |
|---|---|---|
| **D9-1** | Option (a), (b) or (c)? **Recommended: (c).** | **Before OSF registration** — (b)'s window closes there |
| **D9-2** | The batch size `B` and the maximum batch count, as round numbers unrelated to any protocol quantity, published and hashed before enumeration | Before enumeration (§5.5 step 3) |
| **D9-3** | Primary class sentence or the fallback without "commonest"? **Recommended: primary.** | Before enumeration |
| **D9-4** | Release classification on `JURISDICTION_PARTITIONS.md` — operator-only, whole file | Before any packet is assembled |
| **D9-5** | May the operator return **scan-derived** row-level feedback ("these five of your rows are held-out-ineligible")? Not a quota and not CPG output, but it reveals which companies the CPG developers touched (§4A.2(b)). Carried forward from `INFORMATION_BARRIER_ANALYSIS.md` OQ-1; recommendation there, which this memo endorses: **withhold it**, since ineligible rows are useful anyway (§5.8 development surplus) and there is no operational need | Before enumeration |
| **D9-6** | Who performs cross-partition entity reconciliation (same entity, different identifier *and* different domain — invisible to `assertUnique`)? Not an enumerator, not the reference adjudicator. Carried forward from OQ-5 | Before the frame is merged |

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


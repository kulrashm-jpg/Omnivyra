# PROPOSED AMENDMENT — two independent humans

# ⚠ PROPOSED — NOT FROZEN, NOT REGISTERED, NOT APPROVED, NOT APPLIED ⚠

**This is a draft for the study owner to read and reject or adopt. It is not a protocol.**
It was written in a disposable worktree. **No byte of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` was modified**,
and no byte of `C:/tmp/dt002` was modified. Protocol-004 remains frozen at
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. Nothing is registered. If this draft is
ever adopted it becomes **a new protocol version in a new file**, per §6.2 (line 446) and §7.1 (line 534) — it
is **not an amendment to protocol-004**, which must stay byte-identical (§0, line 5, does exactly this for
protocol-003).

All "BEFORE" text is quoted from the file at `c50fc680...` with its line number. All "AFTER" text is proposed.

---

## 1. What this draft can and cannot do — read this first

**It preserves, in full:**

| Invariant | Preserved? | How |
|---|---|---|
| ≥ 2 independent ratings per scored observation | **YES** | Both humans rate every held-out observation; §12's "Minimum valid ratings" row is untouched |
| `pending` never imputed, never scored | **YES** | §12's row is untouched; `lib/packets.mjs:81` and `lib/ratings.mjs:147` already skip pending |
| Krippendorff's α, nominal, ≥ 0.667 | **YES** | α is computed over the raters' **own** labels before any resolution (`lib/analysis.mjs:178-181`), so the resolution rule cannot inflate it. §15.5(3) unchanged |
| No synthesised consensus value | **YES** | §3 below picks one of the two labels actually given; §2 below excludes rather than invents. Nothing new is ever produced |
| The §15.5 INCONCLUSIVE conditions | **YES — all eight unchanged** | Lines 861–868 are not amended |
| The outcome ladder (§10.5) | **STRUCTURE YES, with one declared change** | Four outcomes, checked in the same order. SUCCESS is made strictly harder; FALSIFIED is made strictly harder. See §3.4 and the honesty note in §7 |
| The no-preview rule (§6.5) | **YES — untouched** | Headcount-independent |
| Outsider verifiability | **YES** | The resolution rule is deterministic, takes no operator input, and is recomputable from the two published rater sheets |

**It does not preserve, and this draft does not pretend otherwise:**

1. **Seven mutually exclusive independent persons** (§4A.3, line 185). Five independent checks are gone.
2. **The reference recorder's blindness to the class prediction** (§9.2, line 569). One of the two blind
   records is written by the person who authored that company's class prediction. Unfixable by any packet rule.
3. **The rater's independence from the reference truth being scored** (§12 Eligibility, line 726). The two
   raters are the two reference recorders.
4. **Rung 3.** Every primary endpoint is `UNADJUDICATED`, the evidence rung cannot exceed Rung 2, and **no
   claim of independent validation may be made** (§4A.4-NEW below). This is the price.
5. **§22 attack #34** drops from **PREVENTED** to **UNRESOLVED**.
6. **§23 claim (2)** — "independent candidate selection — the frame is unbiased" — is no longer supported.
   §23 claim (1), cryptographic sampling integrity, survives completely intact.

See `CLAUSE_IMPACT_TABLE.md` §5 (rows D1–D11) for why each of these is unrecoverable.

---

## 2. Reference truth: remove the third recorder, keep the double-blind pair

### 2.1 §9.1 Roles table — delete the reference adjudicator row

**BEFORE (line 565):**

> | **Reference adjudicator** | Third independent person (§4A) | Hold any other §4A.3 role (including enumerator); introduce a new value |

**AFTER:** row deleted. Add below the table:

> **There is no reference adjudicator in this version.** Protocol-004 §9.1 and §9.2.1 defined one; a
> two-person study cannot seat a third independent person, and seating one of the two recorders would let a
> recorder decide between their own record and the other's. The consequence is §2.3 below: an unresolved
> disagreement becomes `REFERENCE_CONFLICT` and is excluded, never resolved by anyone.

### 2.2 §9.2.1 — delete the subsection

**BEFORE (lines 571–592):** the whole subsection `#### 9.2.1 Reference-adjudicator packet [NORMATIVE; APPROVED
CPG-043]`, including "Record 1 is the Author's record iff the first hexadecimal digit of
`order_key("reference-adjudicator-record-1", candidate_id, field)` is even" and "**Decisions** are `RECORD_1`,
`RECORD_2` or `REFERENCE-CONFLICT`."

**AFTER:**

> #### 9.2.1 Reference adjudication — removed in this version
>
> Protocol-004 §9.2.1 specified a blinded reference-adjudicator packet (`reference-adjudication-packet`,
> `verify-adjudication-packet`, `resolve-reference-adjudication`). No third independent person exists in this
> version, so the packet is never built and those three commands are never run. The blind-position assignment
> label `reference-adjudicator-record-1` remains defined in §12.1 and in the tooling, unused, so that §12.1's
> derivation and the `cpg-u1-rater-order/v1` domain are unchanged.

### 2.3 §9.5 Reconciliation — the disagreement row

**BEFORE (line 621):**

> | Different | **Must** be adjudicated: `AUTHOR` → `ADJUDICATED_AUTHOR`; `CONFIRMER` → `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` → `REFERENCE_CONFLICT` (excluded from every denominator, published) |

**AFTER:**

> | Different | `REFERENCE_CONFLICT` — **excluded from every denominator, counted and published.** There is no adjudicator; no one chooses between the records and no third value is ever produced. The Author's and the Confirmer's values are both published beside the exclusion |

**BEFORE (line 623):**

> The adjudicator chooses between the two records or declares a conflict, and **cannot supply a third value**.
> The author and confirmer must be different people, and the adjudicator must differ from both. The reconciled
> reference file is produced **only** by `reconcile`: `seal` refuses any reference file that is not
> byte-identical to the reconciliation of the blind records.

**AFTER:**

> The author and confirmer must be different people. No one chooses between their records and no third value
> is ever produced; a difference is a `REFERENCE_CONFLICT`. The reconciled reference file is produced **only**
> by `reconcile`: `seal` refuses any reference file that is not byte-identical to the reconciliation of the
> blind records.
>
> **Declared consequence.** Every scored reference value in this version is a double-blind **agreement**. That
> is a stronger basis per value than protocol-004's adjudicated values. The cost is statistical power, not
> integrity: more `REFERENCE_CONFLICT` exclusions reduce the VALID count and therefore raise the risk of
> INCONCLUSIVE under §15.5(2) and of G1 failure under §15.5(1). **The elevated INCONCLUSIVE risk is declared
> in advance and is not a reason to relax any threshold.**

*Why this is cheap:* `REFERENCE-CONFLICT` is already in §15.1's closed disposition list (line 836) with
exactly these semantics. No new disposition is needed. Only the routing changes — `lib/reconcile.mjs:58`
currently makes an unadjudicated difference a refusal, not a conflict.

### 2.4 §4A.3 — delete the enumerator/reference-adjudicator sentence

**BEFORE (line 187):**

> An enumerator may not be the reference adjudicator. The adjudicator decides contested reference values, and
> the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7).

**AFTER:** deleted (no such role exists).

**⚠ This deletion does not cure the hazard the sentence names.** In this version the enumerator is a reference
**recorder**, which is worse: an adjudicator would have seen only contested items, whereas a recorder writes
every value. See §6 (D-acknowledgement) — this is class D, not class C.

---

## 3. Rating: remove the third rater, add a two-sided deterministic resolution rule

This is the expensive half. `REFERENCE-CONFLICT` has no counterpart for rater disagreement: §15.1's closed
list (line 836) has **no** disposition for "the raters disagreed", and `lib/ratings.mjs:136` throws
`RATING_ADJUDICATION_MISSING` rather than falling through. Two roads exist; this draft takes the second.

- **Road A, rejected:** a new *excluded* disposition. It spends the §15.5(2) 90 %-VALID budget **and** — far
  worse — removes contested fills from both the numerator and the denominator of EFR. Disagreement correlates
  with difficulty, and difficulty correlates with CPG error, so systematically deleting contested fills biases
  P1 **downward**, i.e. toward a false SUCCESS. At the G1 floor (20 fills, θ_EFR = 0.05 → at most 1 erroneous
  fill) the §15.5(2) cap is nowhere near tight enough to contain this. **Road A is a class-D weakening and is
  not drafted.**
- **Road B, taken:** a pre-registered deterministic rule that keeps the observation VALID, never invents a
  label, and is applied in **both** directions so that neither SUCCESS nor FALSIFIED can be manufactured.

### 3.1 §12 Rater disagreement row

**BEFORE (line 733):**

> | **Rater disagreement** | Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of §12.2; adjudicated values are flagged |

**AFTER:**

> | **Rater disagreement** | Resolved by the **pre-registered deterministic rule of §12.4**. There is no rating adjudicator. No person makes the choice, no label is invented, and the rule takes no operator input. Both raters' labels are published for every resolved observation, and the observation carries the flag `RATER-DISAGREEMENT-RESOLVED` |

### 3.2 §12.2 — delete the subsection

**BEFORE (lines 757–780):** the whole subsection `#### 12.2 Rating-adjudicator packet [NORMATIVE; APPROVED
CPG-043]`, including "Label A is rater 1's label iff the first hexadecimal digit of
`order_key("rating-adjudicator-label-a", …)` is even" and "**The rating adjudicator never receives:** which
rater gave which label, or rater identities".

**AFTER:**

> #### 12.2 Rating adjudication — removed in this version
>
> Protocol-004 §12.2 specified a blinded rating-adjudicator packet. No third independent person exists, and
> seating one of the two raters would defeat the subsection's own first prohibition — an adjudicator who is a
> rater knows which label is theirs. The packet is never built; `rating-adjudication-packet`,
> `resolve-rating-adjudication` and `verify-adjudication-packet --type rating` are never run. The label
> `rating-adjudicator-label-a` remains defined in §12.1, unused.

### 3.3 §12.4 — NEW: the deterministic disagreement rule

**AFTER (new subsection):**

> #### 12.4 Disagreement resolution without an adjudicator [NORMATIVE; DERIVED]
>
> Applied to every held-out observation both raters labelled (neither `pending`). It is arithmetic; there is no
> discretion and no input beyond the two published sheets.
>
> **(a) Agreement.** Identical labels: the final label is that label. Unchanged from protocol-004.
>
> **(b) Disagreement.** The two labels are ranked by the fixed **adversity order** below, most adverse first.
> The **adverse label** is whichever of the two ranks earlier; the **favourable label** is the other. Nothing
> outside the two labels the raters actually gave is ever used.
>
> ```
> 1. MISATTRIBUTED-FILL     the only label that fails an endpoint outright (P3 = 0)
> 2. INCORRECT-FILL         P1 numerator; R1 denominator
> 3. UNSUPPORTED-FILL       P1 numerator; P2 denominator
> 4. REFERENCE-AMBIGUOUS    excluded from every denominator: spends the §15.5(2) VALID budget and lowers the G1 fill count
> 5. MISSED-FILL            R1 only (no threshold)
> 6. SUPPORTED-FILL         favourable: raises fills and R1, enters no error numerator
> 7. CORRECT-ABSTENTION     most favourable: P2 numerator
> ```
>
> The order is fixed here, before any data, and is justified by acceptance impact alone. Because every
> observation's **pair** of labels is published (§13.2), any reader may re-score the study under any other
> order; the order is a pre-registration, not a hiding place.
>
> **(c) Disposition follows the chosen label**, exactly as §15.1–§15.2 already prescribe. In particular, where
> the adverse label is `REFERENCE-AMBIGUOUS`, the observation is excluded — the same outcome protocol-004's
> adjudicator could have reached, since §12.2 (line 766) allowed the decision `REFERENCE-AMBIGUOUS`.
>
> **(d) Flag.** Every resolved observation carries `RATER-DISAGREEMENT-RESOLVED`. The count and the full pair
> list are published. An unflagged resolution is a protocol violation (§18.3).
>
> **(e) Two scorings, both published.** The study is scored twice and both scorings are published side by side:
> the **adverse scoring** (every disagreement takes its adverse label) and the **favourable scoring** (every
> disagreement takes its favourable label). They are identical when the raters never disagree.
>
> **(f) No discretion.** The operator supplies nothing. `analyze` computes both scorings from the two sheets
> and refuses to run if the flag count does not equal the disagreement count.

### 3.4 §10.5 Outcome vocabulary — the two-sided ladder

**BEFORE (lines 708–713):**

> | **INCONCLUSIVE** | Any §15.5 condition, or G1 fails. Checked first |
> | **FALSIFIED** | II > 0, **or** EFR > 2 × θ_EFR. Recorded and reported as evidence **against** the verified-only claim |
> | **FAILURE** | Conclusive, not falsified, and any of P1, P2 or P3 missed — **explicitly including a near miss** |
> | **SUCCESS** | G1 holds and P1, P2 and P3 are all met |

**AFTER:**

> | **INCONCLUSIVE** | Any §15.5 condition, or G1 fails **under the adverse scoring**. Checked first |
> | **FALSIFIED** | II > 0 **or** EFR > 2 × θ_EFR **under BOTH scorings** — that is, falsification must hold even when every rater disagreement is resolved in CPG's favour. Recorded and reported as evidence **against** the verified-only claim |
> | **FAILURE** | Conclusive, not falsified, and any of P1, P2 or P3 missed **under the adverse scoring** — **explicitly including a near miss** |
> | **SUCCESS** | G1 holds and P1, P2 and P3 are all met **under the adverse scoring** |
>
> Exactly one outcome is reported, as before. Where the two scorings would give different outcomes, the
> **discrepancy is published** alongside the reported outcome and the number of observations responsible.
>
> **Why both directions.** A one-sided worst-case rule would make SUCCESS harder (good) but could manufacture
> FALSIFIED out of mere rater disagreement (bad), and FALSIFIED is published as evidence *against* the product
> claim. Requiring FALSIFIED under **both** scorings and SUCCESS under the **adverse** one means neither rung
> can be reached by the resolution rule alone. FAILURE takes the residue, as it already did.

### 3.5 §15.1 — add the flag

**BEFORE (line 836):**

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and
> `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the primary
> analysis; §5.3). `INCONCLUSIVE` is **run-level only**.

**AFTER:**

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and
> `REFERENCE-STALE`; and the flags `CONTAMINATION-DISCLOSED` (observation remains VALID in the primary
> analysis; §5.3) and **`RATER-DISAGREEMENT-RESOLVED`** (the final label came from the §12.4 rule; the
> disposition is whatever that label implies, and the observation is not excluded merely for having been
> resolved). `INCONCLUSIVE` is **run-level only**.

**The disposition list itself is unchanged.** Only a flag is added, exactly parallel to
`CONTAMINATION-DISCLOSED`. This is the whole reason Road B is cheaper than Road A.

### 3.6 §4A.3 — the label triple becomes a pair

**BEFORE (line 189, first sentence):**

> The assignment of individuals to the labels `rater-1`, `rater-2` and `rating-adjudicator` is recorded in the
> personnel register, and its SHA-256 fingerprint is published, **before the held-out commitment transaction is
> broadcast** (§12.1).

**AFTER:**

> The assignment of individuals to the labels `rater-1` and `rater-2` is recorded in the personnel register,
> and its SHA-256 fingerprint is published, **before the held-out commitment transaction is broadcast**
> (§12.1).

*(Tooling: `lib/assignment.mjs:13` `ASSIGNED_LABELS` and its three-distinct-people check at `:33`.)*

---

## 4. The tables that must be rewritten because they now say something false

### 4.1 §20.8

**BEFORE (line 972):** "Rater availability unproven; without raters, Rung 2 at most."

**AFTER:** "Personnel are role-fused: the enumerator is also a reference recorder, and the two raters are the
two reference recorders. The rating step is therefore not an independent check on the reference truth it
scores. **The evidence rung cannot exceed Rung 2 in any outcome**, and no claim of independent validation may
be made (§4A.4)."

### 4.2 §20.18

**BEFORE (line 982):** "…the latter rests on enumerator independence only."

**AFTER:** "…the latter rests on enumerator independence only. **In this version the enumerator also authors
reference truth, so enumerator independence from the developing organisation survives while enumerator
independence from the reference truth does not.** Claim (2) of §23 is therefore not supported by this version."

### 4.3 §20 — new limitation

**AFTER (append):** "**24. Role fusion.** Seven independent roles are held by two people (§4A.4). The
reference adjudicator and the rating adjudicator do not exist. One blind reference record per company is
written by the author of that company's class prediction. Both raters authored the reference truth they score.
None of this is detectable by the tooling: `check-personnel` verifies the amended structure, not the
independence the original structure bought."

### 4.4 §22 #34, #35, #36

**BEFORE (line 1046):** "| 34 | Role conflicts (enumerator adjudicating reference truth; shared or
operator-held roles) | PREVENTED structurally in the register; truthfulness PROCEDURAL | §4A; `check-personnel` |"

**AFTER:** "| 34 | Role conflicts (shared roles) | **UNRESOLVED for shared independent roles** (they are the
design); PREVENTED for operator-held roles | §4A.4; `check-personnel` still refuses any operator-held
independent role |"

**BEFORE (lines 1047–1048):** rows #35 and #36 (reference and rating adjudication leakage), both PREVENTED.

**AFTER:** both deleted, with a recorded note: "Rows 35 and 36 of protocol-004 concerned leakage into
adjudication packets. Neither adjudicator exists in this version, so neither attack is available; the rows are
deleted rather than silently dropped."

### 4.5 §23 rows

**BEFORE (line 1056):** "| Reference Author / Confirmer / adjudicator | Independent blind records | Share
errors; collude | Role assignment |"

**AFTER:** "| Reference Author / Confirmer (no adjudicator) | Two independent blind records; **only agreements
are scored** | Share errors; collude; one of them knows the class prediction | **No role-assignment mitigation
remains** |"

**BEFORE (line 1057):** "| Raters + rater adjudicator | Independent labels | Label bias | Without raters:
Rung ≤ 2 |"

**AFTER:** "| Raters (role-fused with the reference recorders) | Labels applied by the §10.1 procedure;
disagreements resolved by the §12.4 rule | Label bias; self-assessment of their own reference records | **Rung
≤ 2 always** |"

**BEFORE (line 1067, last sentence):** "Protocols 003–004 strengthen (1); protocol-004 additionally specifies
the personnel rules on which (2) rests, without making (2) cryptographic."

**AFTER:** "Protocols 003–004 strengthen (1), and **this version leaves (1) completely intact — every
Bitcoin, drand, commitment, frame-freeze and no-preview mechanism is unchanged.** Protocol-004 specified the
personnel rules on which (2) rests; **this version reduces them to two people and therefore does not support
(2) at all.** A result from this version may state that no one chose the sample. It may not state that the
frame and the reference truth were built by mutually independent people."

### 4.6 §24 rater-order canonicalization

**BEFORE (line 1092):** "Rater order | `order_key` over the sealed held-out record with domain
`cpg-u1-rater-order/v1`; separate assignment labels for Record 1/2 and Label A/B | …"

**AFTER:** "Rater order | `order_key` over the sealed held-out record with domain `cpg-u1-rater-order/v1`; the
assignment labels `reference-adjudicator-record-1` and `rating-adjudicator-label-a` remain defined and unused
(no adjudicator exists) | …"

*The literal `cpg-u1-rater-order/v1` is `PROTOCOL_MARKERS[16]` and must survive verbatim.*

### 4.7 §19.1 and §19.2

§19.1's closed-decisions row (line 935) must stop citing §9.2.1 and §12.2 and must stop calling the personnel
decisions "closed"; §19.3(3) (line 959) must stop saying "Seven mutually exclusive independent persons".
**§19.2 requires a new row recording a fresh owner approval** — CPG-042 A-1…A-6 were *approved*, and this
version partially reverses them. A protocol version cannot un-approve a recorded human decision by drafting;
only the owner can, on the record, with the forfeited claim named. See `AMENDMENT_ORDERING.md` step 1.

---

## 5. §4A.4 — NEW: the honest statement of what this version is

**AFTER (new subsection, replacing the amended §4A.3 headcount rules):**

> ### 4A.4 Reduced personnel independence [NORMATIVE; requires a fresh owner approval]
>
> **Roles:** operator (key custodian; not independent) · enumerator · reference Author · reference Confirmer ·
> rater 1 · rater 2. **There is no reference adjudicator and no rating adjudicator.**
>
> **Minimum: two independent persons.** No independent role is held by the operator; `check-personnel` still
> refuses any operator-held independent role. The two independent persons hold the remaining roles as follows,
> and the assignment is recorded in the personnel register and fingerprinted before the held-out commitment:
>
> | Person | Roles |
> |---|---|
> | P1 | enumerator · reference Author · rater 1 |
> | P2 | reference Confirmer · rater 2 |
>
> **Mandatory ordering (the clarification that makes the fusion safe as far as it can be made safe).** A
> person holding both a reference role and a rater role must have submitted every blind record, and the
> reconciliation must be sealed (§9.6), **before** the held-out run begins. Receiving CPG output as a rater
> after the seal is not a §9.1 violation. Receiving it before is a §6.5 preview and voids the study.
>
> **What is forfeited, stated once and not repeated as a caveat:**
>
> 1. **Five independent checks.** Protocol-004 required seven mutually exclusive independent persons. This
>    version has two.
> 2. **Class-prediction blindness.** P1 authored the class prediction for every company and also writes one of
>    the two blind reference records. §9.7's publication of class/reference mismatches therefore measures
>    nothing about independence in this version.
> 3. **Rater independence from the reference truth.** Both raters authored it. `REFERENCE-AMBIGUOUS` is a
>    rater discretion that excludes an observation from every denominator, so a record's own author holds a
>    lever over that exclusion. The §12.4 rule constrains disagreements; it does not constrain agreement on an
>    ambiguity declaration.
> 4. **The evidence rung.** Every primary endpoint is reported as **UNADJUDICATED**, the evidence rung
>    **cannot exceed Rung 2**, and **no claim of independent validation may be made** — in every outcome,
>    including SUCCESS. Protocol-004 §12 stated this consequence for absent raters and added "The protocol is
>    not weakened to accommodate unavailability"; that sentence is carried unchanged into this version and
>    applies here.
> 5. **§22 attack #34** is UNRESOLVED, and **§23 claim (2)** is unsupported.
>
> **What is retained in full:** every mechanism of §5.5–§5.10 (registration, single-use Bitcoin commitments,
> drand randomness, seed derivation, VOID rules), §5.7.2 frame sufficiency, §6.5 the execution window and
> no-preview rule, §7.1 the evaluation-tree pin, §9.6 operator separation from reference truth, §12.1 the
> derived presentation order, §12.3 the cited-URL rule, §13 the archive, §15.5's eight INCONCLUSIVE
> conditions, and §21's outsider verification procedure. **The cryptographic claim is untouched. The human
> claim is what this version spends.**

---

## 6. D-acknowledgement — the clauses this draft does NOT draft around

Per the brief: where an invariant cannot be preserved, say so instead of drafting around it.

| Clause | What it protected | Why no text fixes it |
|---|---|---|
| §4A.3 (184, 185, 186), §4A.2(d) (160), §19.3(3) (959) | Seven mutually exclusive independent persons | The number is the evidence. Writing "two" is the loss, not a repair |
| §9.2 (569) "never receive … the class prediction" | The reference value not being anchored to the sampling-balance prediction | The enumerator must be one of the two, so the knowledge is in-head. No packet, ordering or blinding removes it. The harm is directional: an `abstention-expected` prediction followed by `NOT_AVAILABLE_FROM_SOURCE` manufactures `CORRECT-ABSTENTION`, the P2 numerator |
| §12 Eligibility (726) "must hold no other §4A.3 role" | Rating being an independent check on reference truth | Both raters authored it. §12.4 constrains disagreement, not shared blind spots |
| §12 (736) + §20.8 (972) | The evidence rung | §12's own closing sentence forbids weakening the rule to escape the ceiling. §4A.4(4) states the ceiling rather than evading it |
| §22 #34 (1046) | PREVENTED classification | The attack is the design. UNRESOLVED is the only honest class |
| §23 (1056, 1067) | Claim (2) and the collusion mitigation | Nothing substitutes for a third person |

---

## 7. One honesty note about the outcome ladder

§10.5's four outcomes, their order and their names are unchanged, and no threshold moves: θ_EFR = 0.05,
θ_AR = 0.90, II = 0, G1 ≥ 20 are all as protocol-004 sets them.

What does change is what a rung means when the raters disagreed. Under protocol-004 a disagreement was
resolved by a blinded third person and the resulting label was a judgement. Under §12.4 it is resolved by
arithmetic, applied twice, so that **SUCCESS must survive the worst resolution and FALSIFIED must survive the
best**. That is a strictly more conservative ladder in both directions than protocol-004's, and it invents
nothing — but it is not the same ladder, and a reader of the results must be told which one produced them.
That is why §12.4(e) publishes both scorings and §10.5 publishes the discrepancy.

**Nothing in this draft makes SUCCESS easier to reach than protocol-004 makes it.** That is the one property
this draft would not trade away, and it is the reason Road A in §3 was rejected rather than drafted.

---

## 8. Status, restated

**PROPOSED. NOT FROZEN. NOT REGISTERED. NOT APPROVED. NOT APPLIED.** Protocol-004 is unmodified at
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. The tooling is unmodified at
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`. Adopting this draft costs the two SHAs and
the full re-verification set measured in `REFREEZE_COST.md`, and — before any of that — a fresh owner approval
partially reversing CPG-042 A-1…A-6, which this draft cannot give itself.

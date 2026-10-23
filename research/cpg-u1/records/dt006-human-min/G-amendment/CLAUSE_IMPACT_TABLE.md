# CLAUSE IMPACT TABLE — reducing CPG-U1 to two independent humans

**CLASSIFICATION: ANALYSIS. Nothing here is frozen, registered, approved or applied.**
No byte of `research/cpg-u1/**` was modified. No commit, no registration, no execution, no network call.

**Protocol under analysis:** `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **recomputed in this task and VERIFIED**
(`sha256sum`, 1098 lines). Every line number below is a line of the file at that hash.

**Instrument:** `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files — **recomputed and VERIFIED**
(`lib/aggregate.mjs` `toolingManifest()`). The instrument tree was never written to; every experiment ran on a
copy in the session scratchpad which reproduced the aggregate byte-for-byte before any edit.

---

## 0. What "two independent humans" means against this protocol

§4A.3 lists **eight** roles (protocol lines 175–182): operator (not independent) plus **seven independent
roles** — enumerator, reference Author, reference Confirmer, reference adjudicator, rater 1, rater 2, rating
adjudicator. The target is therefore: map seven mutually exclusive independent roles onto **two** people.

The protocol does not merely fail to anticipate this. It states the opposite, normatively (§4A is headed
`[NORMATIVE; APPROVED CPG-043]`, line 123). **No row below is class B on the headcount question.**

Two structural facts constrain every mapping:

1. The enumerator must be one of the two, because §4A.2(c) forbids the operator from enumerating ("not be the
   operator (key custodian)", line 159) and §4A.2(a) forbids anyone who implemented CPG, the protocol or the
   tooling (line 157). So the enumerator is also a reference recorder or a rater.
2. Three-person structures are unsatisfiable twice over: {Author, Confirmer, reference adjudicator} and
   {rater 1, rater 2, rating adjudicator}. Two humans fill the pairs and leave **both adjudicator seats empty**.

The best-case mapping, used throughout this analysis:

| Human | Roles |
|---|---|
| **H-A** | enumerator, reference Author, rater 1 |
| **H-B** | reference Confirmer, rater 2 |
| — | reference adjudicator: **NO ONE**; rating adjudicator: **NO ONE** |
| OP | operator / key custodian (not independent; holds no independent role) |

`check-personnel` refuses this mapping with five ROLE COLLISION **errors** (exit 1), and refuses the
adjudicator-less variant with three errors plus two BLOCKED lines. Real output in `REFREEZE_COST.md` §5.
Role fusion is a **refusal**, not a degradation: the protocol provides no ceiling clause for it, unlike §12's
rater-unavailability paragraph.

---

## 1. Classification key

- **A — no change needed.** The text already permits a two-human design, exactly as written.
- **B — clarification only.** The text is silent or ambiguous; a pre-registered interpretation suffices.
- **C — substantive amendment.** The text must change.
- **D — cannot be amended without weakening the endpoint.** Amending it *is* the loss of evidentiary strength.

---

## 2. Class A — no change needed (18 rows)

| # | CLAUSE (line) | QUOTED TEXT | WHY IMPLICATED | MINIMAL CHANGE |
|---|---|---|---|---|
| A1 | §4A.2(b) (158) | "not have run CPG or seen any CPG output (including the development pilot and instrument check) **before completing the frame**" | H-A is enumerator and later a rater, so H-A does see CPG output | **None.** The bar is temporal ("before completing the frame") and the frame precedes execution (§5.5 steps 3 and 13, lines 266 and 278) |
| A2 | §4A.2 (170) | "**They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)." | Same fusion | **None** — read as a constraint on the enumerator packet, which §5.5's ordering already satisfies. Sequencing made explicit in B1 |
| A3 | §9.1 Author row (563) | "Independent person; constructs a blind record for every drawn company × field / ... see any CPG output (including the development pilot); communicate with the Confirmer before both have submitted" | H-A is also rater 1 | **None** — all reference work completes and seals (§5.5 step 12, line 277) before execution (step 13) |
| A4 | §9.1 Confirmer row (564) | "**Different independent person**; constructs a **separate blind** record for every company × field" | Needs exactly two people | **None.** Satisfied exactly — this is the one three-way structure that degrades to two cleanly |
| A5 | §9.5 AGREED row (620) | "Same `value_kind` and same value (whitespace-collapsed, case-insensitive) / `AGREED` — **an adjudication may not override it**" | The two-human design leans entirely on this path | **None.** Unaffected, and stronger under the draft: every scored reference value is a double-blind agreement |
| A6 | §9.6 (629–631) | "**The operator receives the seal hash only.** ... **The operator therefore cannot choose reference values after seeing CPG output**" | Operator separation | **None.** Headcount-independent |
| A7 | §12 Raters row (725) | "**Raters** / **≥ 2 independent** [NORMATIVE]" | Two humans = exactly two raters | **None.** Met at the floor |
| A8 | §12 Blinding row (728) | "Raters are blind to each other's labels, to running tallies and aggregates, and to the development pilot. There is no arm label to blind" | Both raters authored reference records | **None** for the literal text (each item is still enforceable). The independence loss is D6, not this row |
| A9 | §12 Minimum valid ratings (731) | "Every scored observation needs **≥ 2 independent ratings**; ≥ 90% of held-out observations must be completely rated, else INCONCLUSIVE" | Core invariant | **None.** Two humans rate every observation |
| A10 | §12 Agreement row (732) | "Krippendorff's α, **nominal**, **≥ 0.667** [NORMATIVE — Krippendorff's own floor for tentative conclusions]; per-label agreement also published" | α is computed pairwise | **None.** `lib/analysis.mjs:181` already computes α over exactly `[rater_1_label, rater_2_label]` |
| A11 | §12 Missing ratings (734) | "`pending` — never imputed, never scored" | Core invariant | **None** |
| A12 | §12 unavailability paragraph (736) | "**If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent validation may be made.** The protocol is not weakened to accommodate unavailability." | Literal trigger is "raters unavailable"; two raters ARE available | **None — do not amend.** Its literal trigger is not met, but its last sentence forbids weakening the rule, and its ceiling is imported by D11. See §5 |
| A13 | §12.1 (738–755) | "Order derives from the approved Bitcoin + drand randomness through the **held-out sampling record**." ... "`order_key(label, candidate_id, field) = SHA-256( UTF-8( "cpg-u1-rater-order/v1\|" + ho_record_sha256 + "\|" + label + "\|" + candidate_id + "\|" + field ) )`" | Order derivation | **None.** Wholly headcount-independent; outsider-recomputable as before |
| A14 | §12.1 label set (743) | "`label` ∈ {`rater-1`, `rater-2`, `rating-adjudicator`, `reference-adjudicator`} for ordering, and {`reference-adjudicator-record-1`, `rating-adjudicator-label-a`} for blind-position assignment." | Two of the four ordering labels become unused | **None — deliberately do not amend.** Retaining the full label set leaves `lib/raterOrder.mjs` `ORDER_LABELS`/`ASSIGNMENT_LABELS` (lines 9, 11) untouched, avoiding one more aggregate-moving edit. Unused labels are harmless |
| A15 | §15.2 (853) | "**No observation may be excluded because its result is unfavourable.** The exclusion table and both screening logs are published. Exclusion rules may not change after any held-out result is seen." | The draft changes a resolution rule | **None.** The amendment is pre-registration, so "after any held-out result is seen" is not engaged |
| A16 | §15.5(3) (863) | "Nominal α < 0.667, **fewer than 2 independent raters**, or < 90% of observations completely rated [NORMATIVE]" | Headcount condition | **None — CONFIRMED class A.** Two distinct humans satisfy it; `lib/analysis.mjs:199` implements it as `sheet1.rated_by === sheet2.rated_by`, which is false for H-A ≠ H-B. *Caveat recorded:* "independent" here means §4A.1 independence from the developing organisation, which both satisfy; it does **not** certify independence from the reference truth (D6) |
| A17 | §6.5 (466–473) | "Any execution of CPG, in any environment ... or any reading of stored CPG output (logs, persisted results), where: the input identifies a company in F ...; it is performed by study personnel" | Study personnel now hold more roles | **None.** The prohibition is per-person-per-time and does not count people |
| A18 | §5 (194) | "Every person performing a §5 task satisfies §4A." | Cross-reference | **None** once §4A is amended |

---

## 3. Class B — clarification only (3 rows)

| # | CLAUSE (line) | QUOTED TEXT | WHY IMPLICATED | MINIMAL CHANGE |
|---|---|---|---|---|
| B1 | §9.1 Author + Confirmer "Must not" cells (563–564) | "...**see any CPG output** (including the development pilot)..." | When one person is both a reference recorder and a rater, the text does not say the reference work must be finished first. §5.5's step list (lines 277–279) implies it but does not bind the person | **Pre-registered interpretation:** a person holding both a reference role and a rater role must have submitted, reconciled and sealed every reference record **before** the held-out run starts; after the seal, receiving CPG output as a rater is not a §9.1 violation. Add as a §4A.4 note. No other clause changes |
| B2 | §5.5 step list (272, 277–279) | " 9. record and fingerprint the rater / rating-adjudicator label assignment (§4A.3)" ... "12. blind reference construction for BOTH stages → blinded adjudication (§9.2.1) → reconcile → seal (§9)" | Step 9 names a label triple; step 12 names an adjudication that no longer exists | **Clarification plus one deletion** of the "→ blinded adjudication (§9.2.1)" clause in step 12. The ordering itself is unchanged and is what makes B1 safe |
| B3 | §13.2 (811) | "rater order artifacts (§12.1) and **the person-to-label assignment fingerprint** (§4A.3) · per-rater sheets · adjudication artifacts" | The fingerprint now covers two labels, and "adjudication artifacts" may be empty | **Clarification:** state that the assignment artifact covers `rater-1` and `rater-2`, and that where no adjudicator exists the adjudication-artifact slot is published as explicitly empty (never silently absent) |

---

## 4. Class C — substantive amendment (18 rows)

| # | CLAUSE (line) | QUOTED TEXT | WHY IMPLICATED | MINIMAL CHANGE |
|---|---|---|---|---|
| C1 | §4A.3 (187) | "**An enumerator may not be the reference adjudicator.** The adjudicator decides contested reference values, and the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7)." | The role it protects against ceases to exist | Delete. Replace with the §9.5 fall-through rule (C5). **Note:** deleting this does *not* cure the harm it names — see **D5**, which is the same hazard arriving through the Author seat instead of the adjudicator seat |
| C2 | §4A.3 (189) | "The assignment of individuals to the labels `rater-1`, `rater-2` **and `rating-adjudicator`** is recorded in the personnel register, and its SHA-256 fingerprint is published, **before the held-out commitment transaction is broadcast** (§12.1)." | Triple becomes a pair | Strike "and `rating-adjudicator`". **Tooling consequence:** `lib/assignment.mjs:13` `ASSIGNED_LABELS` and its three-distinct-people check at `:33` must change → aggregate moves |
| C3 | §9.1 Reference adjudicator row (565) | "**Reference adjudicator** / **Third independent person** (§4A) / Hold any other §4A.3 role (including enumerator); introduce a new value" | "Third independent person" cannot exist | Delete the row |
| C4 | §9.2.1 (571–592) | "**Reference-adjudicator packet** [NORMATIVE; APPROVED CPG-043]" ... "**Record 1 / Record 2 assignment.** Record 1 is the Author's record iff the first hexadecimal digit of `order_key("reference-adjudicator-record-1", candidate_id, field)` is even." ... "**Decisions** are `RECORD_1`, `RECORD_2` or `REFERENCE-CONFLICT`." | The whole subsection presupposes a third person | Delete the subsection; retain a one-line record that protocol-004 had it and why it is unavailable. `reference-adjudication-packet`, `verify-adjudication-packet`, `resolve-reference-adjudication` become inapplicable commands |
| C5 | §9.5 Different row (621) | "Different / **Must** be adjudicated: `AUTHOR` → `ADJUDICATED_AUTHOR`; `CONFIRMER` → `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` → `REFERENCE_CONFLICT` (excluded from every denominator, published)" | **A difference does not fall through to `REFERENCE_CONFLICT` by default.** `lib/reconcile.mjs:58` makes an unadjudicated difference a hard refusal: "author and confirmer disagree (...) — independent adjudication required" | Replace with: "Different / `REFERENCE_CONFLICT` (excluded from every denominator, published). No adjudication exists and none is synthesised." **This is the cheap adjudicator:** `REFERENCE-CONFLICT` already exists in §15.1's closed list, so no new disposition is needed |
| C6 | §9.5 (623) | "The adjudicator chooses between the two records or declares a conflict, and **cannot supply a third value**. The author and confirmer must be different people, and **the adjudicator must differ from both**. The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any reference file that is not byte-identical to the reconciliation of the blind records." | Sentence 1 and the "adjudicator must differ from both" clause presuppose a third person | Keep "The author and confirmer must be different people" (class A within the row) and the `reconcile`/`seal` byte-identity sentence. Delete the adjudicator sentences. **`lib/reconcile.mjs` must change (lines 34–41, 52–72) → aggregate moves.** Because `seal` refuses anything not byte-identical to `reconcile`'s output, there is no way to change this rule without changing the tooling |
| C7 | §12 Rater disagreement row (733) | "**Rater disagreement** / Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of §12.2; adjudicated values are flagged" | No third person exists. `lib/ratings.mjs:136` throws `RATING_ADJUDICATION_MISSING: <n> disagreement(s) need the rating adjudicator's resolution` — there is **no** fall-through | Replace with the pre-registered deterministic two-sided resolution rule of `PROPOSED_AMENDMENT_TWO_HUMAN.md` §3. **Retaining the role with two humans is class D** (see §5 D-note) |
| C8 | §12.2 (757–780) | "**Rating-adjudicator packet** [NORMATIVE; APPROVED CPG-043]" ... "**Label A / Label B assignment.** Label A is rater 1's label iff the first hexadecimal digit of `order_key("rating-adjudicator-label-a", ...)` is even." ... "**The rating adjudicator never receives:** which rater gave which label, or rater identities" | Presupposes a third person; a rater-adjudicator would know their own label | Delete the subsection; record why. `rating-adjudication-packet`, `resolve-rating-adjudication`, `verify-adjudication-packet --type rating` become inapplicable |
| C9 | §15.1 (836) | "`VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the primary analysis; §5.3). `INCONCLUSIVE` is **run-level only**." | **The list is closed and holds no disposition for "the raters disagreed."** | Add the **flag** `RATER-DISAGREEMENT-RESOLVED` (observation remains VALID, like `CONTAMINATION-DISCLOSED`), not a new excluded disposition. **This is the asymmetry:** removing the *reference* adjudicator needs nothing new (C5 reuses `REFERENCE-CONFLICT`); removing the *rating* adjudicator needs either a new excluded disposition — which spends the §15.5(2) 90%-VALID budget **and** deletes contested fills from both sides of the EFR ratio — or a rule that keeps the observation VALID. The draft takes the second road |
| C10 | §19.1 (935) | "Frame sufficiency rule, single frozen frame, registry freeze, execution window and no-preview rule, **personnel independence and blinding**, rater-order derivation / **closed** (CPG-043 approvals; §4A, §5.3, §5.5, §5.7.2, §6.5, **§9.2.1**, §12.1, **§12.2**)" | Cites two deleted subsections and declares the personnel rules closed | Rewrite the row; state that the personnel rules are **re-opened** by this version and re-approved at a reduced independence level |
| C11 | §19.2 (953) | "**CPG-042 A-1…A-6, B-1, B-2, X-1** / Personnel independence and blinding, single frozen frame, registry freeze, execution window / no-preview / **Approved for CPG-043**; implemented in protocol-004 and tooling v4" | A-1…A-6 are **recorded owner approvals**. A two-human design *partially reverses an approved decision* | Add a new row (e.g. `CPG-0xx A-7`) recording a **fresh, explicit owner approval to reduce personnel independence**, with the forfeited claim named. This is a governance act, not a drafting act: an amendment cannot silently un-approve A-1…A-6 |
| C12 | §20.8 (972) | "Rater availability unproven; without raters, Rung 2 at most." | The ceiling now binds always, not only when raters are absent | Rewrite: "Personnel are role-fused: the two raters are the two reference recorders. The rating step is therefore not an independent check on reference truth, and the evidence rung cannot exceed Rung 2 in any outcome." (Substance is **D11**) |
| C13 | §20.18 (982) | "Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate selection (the frame is unbiased); the latter rests on **enumerator independence only**." | The enumerator now also authors reference truth | Extend: enumerator independence from the developing organisation survives; enumerator independence *from the reference truth* does not. (Substance is **D5**, **D10**) |
| C14 | §20.23 (987) | "**Personnel independence rests on declarations and organisational confirmation** (§4A.1), not on verifiable proof. The tooling checks the register's structure only." | Still true, but no longer the whole limitation | Add a new numbered limitation: role fusion, with the fused pairs named and the forfeited separations listed |
| C15 | §22 #35 (1047) | "Reference adjudication leakage (class, split, CPG output, recorder identity, tallies) / PREVENTED in the packet; other channels PROCEDURAL / §9.2.1; deterministic packet verification" | The attack disappears with the role | Delete the row (no adjudication to leak into). Do **not** silently drop it — record the deletion |
| C16 | §22 #36 (1048) | "Rating adjudication leakage (rater identity, tallies, class, split, pilot) / PREVENTED in the packet; other channels PROCEDURAL / §12.2; deterministic packet verification" | Same | Delete the row; record the deletion |
| C17 | §23 Raters row (1057) | "Raters + rater adjudicator / Independent labels / Label bias / **Without raters: Rung ≤ 2**" | The adjudicator is gone and the ceiling is unconditional | Rewrite: "Raters (role-fused with the reference recorders) / Labels applied by the §10.1 procedure / Label bias; self-assessment of own reference record / **Rung ≤ 2 always**" |
| C18 | §24 Rater-order canonicalization (1092) | "Rater order / `order_key` over the sealed held-out record with domain `cpg-u1-rater-order/v1`; **separate assignment labels for Record 1/2 and Label A/B** / No discretionary seed; unknowable before `R_ho`; outsider-recomputable" | The Record 1/2 and Label A/B assignments vanish with C4/C8 | Amend the middle clause only. **Keep the literal string `cpg-u1-rater-order/v1`** — it is `PROTOCOL_MARKERS[16]` (`cpg_u1_data.mjs:283-285`) and removing it makes `verify-protocol` fail |

---

## 5. Class D — cannot be amended without weakening the endpoint (11 rows)

**These are the answer to the question this agent was asked.** They are not softened below.

| # | CLAUSE (line) | QUOTED TEXT | WHY IMPLICATED | WHY NO AMENDMENT PRESERVES IT |
|---|---|---|---|---|
| **D1** | §4A.3 (184) | "**Every independent role is held by a different person, and no independent role is held by the operator.**" | Two humans, seven roles | The clause *is* the separation. Its second half survives; its first half cannot be amended, only abandoned. `lib/personnel.mjs:34` enforces it and refuses (exit 1) |
| **D2** | §4A.3 (185) | "The seven independent roles are mutually exclusive: **minimum 7 independent persons**." | 2 ≠ 7 | The number is the evidentiary content. Replacing "7" with "2" removes five independent checks; no compensating mechanism exists, cryptographic or procedural |
| **D3** | §4A.3 (186) | "Several enumerators are permitted; **each holds no other role**." | H-A is enumerator, Author and rater 1 | Same as D1/D2 at the enumerator seat, which is the seat §20.18 and §23 say claim (2) rests on |
| **D4** | §4A.2(d) (160) | "hold no other §4A.3 role" | Enumerator fusion | Unamendable for the same reason; and unlike §12's raters there is **no ceiling clause** for a fused enumerator |
| **D5** | §9.2 (569) | "The Author and Confirmer each receive only: company name, canonical domain, jurisdiction family, decisive identifier, the three field definitions, the value-format rules (§9.3), and the authority table (§9.4). **They never receive CPG output, each other's records, or the class prediction.**" | With two humans the enumerator is necessarily one of the two reference recorders (§0 fact 1), so at least one blind record is written by the person who wrote that company's class prediction | **In-head knowledge cannot be withheld by a packet rule.** No deterministic packet, no ordering, no blinding removes it. The harm is directional: a recorder who predicted `abstention-expected` and then records `NOT_AVAILABLE_FROM_SOURCE` manufactures `CORRECT-ABSTENTION`, the **numerator of P2** (§10.3, line 678). §9.7 (line 635) publishes class/reference mismatches precisely because the two were meant to be independent; under fusion that publication measures nothing |
| **D6** | §12 Eligibility row (726) | "**Eligibility** / Must not have implemented CPG, the protocol or the tooling; **must hold no other §4A.3 role**; must satisfy §4A.1" | Both raters are the two reference recorders | The rating step exists to check CPG's output **against** reference truth. When the rater authored that reference truth, the check is self-assessment. It is not merely a blinding loss: `REFERENCE-AMBIGUOUS` is a rater discretion that **excludes the observation from every denominator** (§10.3, line 690), so the record's own author holds a lever that removes inconvenient observations. No packet rule reaches it |
| **D7** | §19.3(3) (959) | "**Independent candidate / reference / rater personnel** satisfying §4A: enumerator(s), reference Author, Confirmer and adjudicator, ≥ 2 raters and a rating adjudicator — before the respective stage (or a recorded absence of raters with the §12 ceiling). **Seven mutually exclusive independent persons.**" | The named prerequisite | This is the registration-time restatement of D1/D2. Note what the parenthesis does and does not offer: a degradation path for *absent raters*, and **none** for *fused roles* |
| **D8** | §22 #34 (1046) | "Role conflicts (enumerator adjudicating reference truth; shared or operator-held roles) / **PREVENTED** structurally in the register; truthfulness PROCEDURAL / §4A; `check-personnel`" | The attack this row claims to PREVENT becomes the design | The row must be downgraded **PREVENTED → UNRESOLVED**. A downgrade in the attack matrix is, by the matrix's own definitions (line 1006), a reduction in evidentiary strength. The tooling control named in the row (`check-personnel`) is exactly what refuses the design |
| **D9** | §23 (1056) | "Reference Author / Confirmer / adjudicator / Independent blind records / **Share errors; collude** / Remaining limitation: **Role assignment**" | The stated mitigation for collusion is role assignment | With two people the mitigation named in the "Remaining limitation" column no longer exists. There is nothing to substitute: two blind records by two people, one of whom set the class prediction, with no third judge |
| **D10** | §23 (1067) | "**Two claims, never merged:** (1) cryptographic sampling integrity — given the committed frame, no one chose the sample; (2) **independent candidate selection — the frame is unbiased**. Protocols 003–004 strengthen (1); protocol-004 additionally specifies the personnel rules on which (2) rests, without making (2) cryptographic." | Claim (2) rests entirely on the personnel rules being amended | Claim (1) survives untouched — every Bitcoin/drand mechanism is headcount-independent. **Claim (2) does not.** The personnel rules it rests on are D1–D6. A two-human study can still say "no one chose the sample"; it can no longer say "the frame and the reference truth were built by mutually independent people" |
| **D11** | Derived: §12 (736) + §20.8 (972) + §14 R5 (830) | §12: "**no claim of independent validation may be made.** The protocol is not weakened to accommodate unavailability." · §20.8: "Rater availability unproven; without raters, Rung 2 at most." · §14: "R5 independent re-rating. **None has occurred.**" | Whether the whole design silently caps the rung | **THE CEILING BINDS, AND IT IS THE MOST IMPORTANT LINE IN THIS TABLE.** In order: (i) §12's paragraph is triggered by raters being *unavailable*; two raters are available, so its literal trigger is **not** met — removing the *adjudicator* does not by itself fire it. (ii) But the two raters fail §12's own Eligibility row (D6), so the ratings are not the independent ratings §12 contemplates; the rating step is a check by the authors of the thing checked. (iii) §12's closing sentence — "The protocol is not weakened to accommodate unavailability" — forbids amending the rule so the ceiling does not apply. (iv) Therefore a two-human version must **state** the ceiling itself (C12, C17): endpoints labelled **UNADJUDICATED**, **evidence rung ≤ 2**, **no claim of independent validation**. A two-human CPG-U1 cannot produce the Rung-3 evidence protocol-004 was built to produce. **That is the cost, and drafting cannot recover it.** |

---

## 6. Counts

| Class | Count |
|---|---|
| **A — no change needed** | **18** |
| **B — clarification only** | **3** |
| **C — substantive amendment** | **18** |
| **D — cannot be amended without weakening the endpoint** | **11** |
| **Total rows** | **50** |

Two C rows are governance, not drafting: **C11** (a recorded owner approval, CPG-042 A-1…A-6, is partially
reversed and needs a fresh one) and **C10** (§19.1's "closed" table must admit that the personnel decisions
are re-opened).

## 7. What is NOT implicated — checked and clear

Every sampling-integrity mechanism is headcount-independent and needs no change: §5.1–§5.4 admissibility and
scan (lines 198–257), §5.5–§5.5.3 registration and commitments (259–327), §5.6 sizing (329–351), §5.7.1
randomness and seed (355–381), §5.7.2 frame sufficiency (383–409) — including the literal `E ≥ 126 / 52 / 32`,
which is `PROTOCOL_MARKERS[18]` and must not be reworded — §5.8–§5.10 (412–439), §6.5 window and no-preview
(450–501), §7 and §7.1 treatment and evaluation tree (503–538), §8.5 instrument check (551–553), §9.3–§9.4
record format and authority (594–614), §9.7–§9.8 (633–639), §10.1–§10.5 labels, agreement, endpoints and the
outcome ladder (645–713), §11 pilot (717–719), §12.3 cited URLs (783–795), §13 archive (797–826), §15.3
screening log (855–857), §16–§18 (872–919), §21 verification procedure (991–1002), §22 rows 1–33 and 37, and
every §24 row other than the rater-order row.

In §23, the rows for the study operator, OSF, Bitcoin, miners, drand, the vendored BLS library, tooling v4 and
the archive are unchanged. **The cryptographic claim is untouched; the human claim is what is spent.**

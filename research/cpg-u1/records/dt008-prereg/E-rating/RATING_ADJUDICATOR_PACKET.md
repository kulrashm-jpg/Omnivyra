# RATING_ADJUDICATOR_PACKET — onboarding package, label `rating-adjudicator`

**Classification: PREPARATION ONLY. NOT REGISTERED. NOT RECRUITED. NO IDENTITY EXISTS.**
DEEPTECH-PARALLEL-008, Agent 5. No protocol byte and no instrument byte was changed. No registration, no
frame, no held-out draw, no execution, no network call, no company data.

**Nobody holds this role.** Every person-specific field below is an unfilled marker; `<<UNFILLED: …>>` and
`UNASSIGNED` are markers, never data.

| Baseline | Value |
|---|---|
| Protocol | `CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (recomputed by this agent) |
| Instrument | `C:/tmp/dt002/research/cpg-u1/tooling`, **<NEW_N> files**, aggregate `<NEW_AGG>` (recomputed with `lib/aggregate.mjs`, read-only) |
| Sections governing this role | §4A.1, §4A.3, §10.1, §10.2, §10.3, §10.5, §12, §12.1, §12.2, §12.3, §15.1, §15.2, §15.5 |
| Working instructions already written | `C:/tmp/dt004-operations/people/RATING_ADJUDICATION_PACKET.md` — the task sheet and the operator commands. **This file does not replace it; it is the onboarding wrapper, and the two are released together.** |

> **This work must be done by a human.** No AI system, language model or agent may produce, draft,
> suggest or check any decision returned under this label.

---

## 1. Slot identity — UNFILLED

| Field | Value |
|---|---|
| Study label | `rating-adjudicator` (one of `ASSIGNED_LABELS`, `lib/assignment.mjs:13`) |
| `person_id` (pseudonym; the only identifier in any study artefact) | `UNASSIGNED` |
| Register role | `rating-adjudicator` (`INDEPENDENT_ROLES`, `lib/personnel.mjs:6`) |
| `adjudicated_by` written in **every** decision row | `UNASSIGNED` — this person's own pseudonym (`lib/ratings.mjs:106`) |
| Legal identity | **never in any study artefact.** Restricted register only (§4A.1) |
| Eligibility verdict | `<<UNFILLED: from RATING_MATERIAL_RELEASE_GATE.md — all gates PASS>>` |
| Signed declaration, all seven keys `"no"` | `<<UNFILLED: date received; the declaration itself is restricted>>` |
| Fee agreement sha256 (§4A.1 item 5), or `null` | `<<UNFILLED: 64 lowercase hex, or null — agreed in writing BEFORE any role material is released>>` |
| Developing organisation's no-relationship confirmation, sha256 | `<<UNFILLED: 64 lowercase hex — required, never null>>` |
| Assignment artefact fingerprint this label appears in | `<<UNFILLED: sha256(canonicalJson(assignment)), published BEFORE the held-out commitment is broadcast>>` |
| Presentation-order label | `rating-adjudicator` (§12.1; `ORDER_LABELS`, `lib/raterOrder.mjs:9`) |
| Blind-position label | `rating-adjudicator-label-a` (`ASSIGNMENT_LABELS`, `lib/raterOrder.mjs:11`) — *"Separate labels keep order and position unrelated"* (§12.1) |
| Number of items this person will receive | **unknown until both rater sheets are accepted**, and never disclosed as a count in advance (§12.2) |

**This is not the reference adjudicator.** They are two different roles held by two different people
(§4A.3). The reference adjudicator decides contested *reference values* before the seal (§9.2.1); this
role decides contested *labels* after execution (§12.2). A person may hold one, never both.

---

## 2. Eligibility — every condition, and who checks it

§12's Eligibility row applies to this role as it does to the raters, quoted in full:

> **Eligibility** — "Must not have implemented CPG, the protocol or the tooling; must hold no other
> §4A.3 role; must satisfy §4A.1"

§12's Rater-disagreement row, quoted in full:

> **Rater disagreement** — "Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of
> §12.2; adjudicated values are flagged"

§4A.3, quoted in full:

> "**Every independent role is held by a different person, and no independent role is held by the
> operator.**
> - The seven independent roles are mutually exclusive: **minimum 7 independent persons**."

| # | Condition | Source | Checked by |
|---|---|---|---|
| 1–4 | No employment, contract, payment or financial interest with the developing organisation in the exclusion period | §4A.1 items 1–4 | declaration keys `employed_by_developing_organisation`, `contract_or_work_for_developing_organisation`, `payment_other_than_study_fee`, `financial_interest_in_developing_organisation`, each `"no"` |
| 5 | No spouse/partner/family/household relationship and no current or former direct reporting relationship with any CPG developer, the operator, **or any holder of another §4A.3 role — including either rater** | §4A.1 item 6 | `close_relationship_with_developer_operator_or_role_holder` = `"no"` — **pairwise**, and for this role the rater pairs are the ones that matter most (`RATING_MATERIAL_RELEASE_GATE.md` §4) |
| 6 | Has not implemented CPG, the protocol, the tooling or the development-only registry | §12 Eligibility | `implemented_cpg_protocol_tooling_or_registry` = `"no"` |
| 7 | Has not run CPG or seen any CPG output | §4A.2(b) as carried into the register | `ran_or_saw_cpg_output` = `"no"` |
| 8 | **Is neither rater**, holds no other §4A.3 role, and is not the operator | §4A.3 | `lib/ratings.mjs:98` (*"the rating adjudicator must be neither rater (§4A.3)"*), `lib/assignment.mjs:33`, `lib/personnel.mjs:33-34` |
| 9 | Fee agreed in writing **before** any role material is released, not contingent on any result, hash recorded | §4A.1 item 5 | `lib/personnel.mjs:38` |
| 10 | Developing organisation's written no-relationship confirmation | §4A.1 | `lib/personnel.mjs:39` |

**"An unknown answer is not \"no\"."** (§4A.1). These are **"procedural evidence, not proof"**. If a
declaration is later found false, §4A.1 applies the **§12 UNADJUDICATED consequences** to the rater work
this person resolved, and the finding is published.

---

## 3. Exactly what this person receives

§12.2's Contents list, quoted in full:

> **Contents, for each disagreeing held-out observation only:**
> - the identical §12 rater packet (field; CPG's value or null; the source URLs CPG cited (§12.3); the
>   sealed reference record);
> - the §10.1 decision procedure and §10.2 agreement rules;
> - the two raters' labels shown **unlabelled** as "Label A" and "Label B".

Mechanically, `RATING_ITEM_KEYS` (`lib/packets.mjs:16`) is exactly `EVALUATION_ITEM_KEYS` plus
`label_a` and `label_b`, i.e. `candidate_id, field, cpg_value, cpg_source_urls, reference_record,
label_a, label_b`. `checkRatingAdjudicationPacket` (`lib/packets.mjs:94-96`) refuses any other key:
*"keys must be exactly … (forbidden information present or field missing)"*, and then requires the packet
to be byte-identical to the deterministic rebuild (`lib/packets.mjs:98-99`).

| Received | Source |
|---|---|
| **Only the disagreeing held-out items** — agreeing items are never released (`lib/packets.mjs:82`), and `pending` items are never released (`lib/packets.mjs:81`) | `rating-adjudication-packet` |
| For each: the identical rater-packet content — `field`, `cpg_value` or `null`, `cpg_source_urls` (§12.3 Rule A), the sealed `reference_record` | `buildRatingAdjudicationPacket`, `lib/packets.mjs:84` |
| `label_a` and `label_b` — the two raters' labels, **unlabelled** | same |
| Items in `order_key("rating-adjudicator", …)` order | §12.1; `lib/packets.mjs:86` |
| The §10.1 decision procedure and the §10.2 agreement rules (§5, §6 below) | §12.2 Contents |
| The run `asOf` and the derived 24-month cutoff — supplied alongside the rules, never inside a packet item | operator |
| This person's own pseudonym, and the published assignment fingerprint | operator |
| `RATING_ADJUDICATION_PACKET.md` and this file | this package |

## 4. Exactly what this person **never** receives

§12.2's never-receive list, quoted in full:

> **The rating adjudicator never receives:**
> - which rater gave which label, or rater identities;
> - other observations' labels;
> - tallies, aggregates or provisional endpoint values;
> - class prediction, stratum, split or identity-hazard note;
> - pilot outputs;
> - the number of disagreements.

| Never received | Enforcement |
|---|---|
| Which rater gave which label; rater identities or pseudonyms | Label A / Label B assignment is derived **per item** from `order_key("rating-adjudicator-label-a", …)` (`lib/raterOrder.mjs:51`), so the mapping flips item by item and cannot be inferred from position. No rater identity appears in `RATING_ITEM_KEYS` |
| Other observations' labels | the packet carries only the disagreeing items; agreeing labels never leave the sheets (`lib/packets.mjs:82`) |
| Tallies, aggregates, provisional endpoint values | `RATING_ITEM_KEYS` has no such key; the packet is a bare item list |
| Class prediction, stratum, split, identity-hazard note | `checkItem` and `checkRatingAdjudicationPacket` refuse those keys |
| Pilot outputs | §11 — held by the operator |
| **The number of disagreements** | this is the one item on the list that the packet's own shape reveals. See §4.1 |

### 4.1 The honest limit of the never-receive list

§12.2 also states, quoted in full:

> **What cannot be hidden:** U1 is single-arm, so the company and the CPG output for the item are
> necessarily visible, and no arm identity exists.

Two further limits follow from the artefact itself, and are stated rather than concealed:

1. **"The number of disagreements" is withheld only as an advance disclosure.** The packet has as many
   items as there are disagreements, so on receipt this person knows that count exactly. What §12.2
   prevents is telling them the count *before* or *apart from* the work, and telling them how it relates
   to the total number of observations — which they are never given.
2. **The reference record is the sealed row in full**, so it carries `author`, `confirmer`, `resolution`
   and `adjudicated_by` (`REFERENCE_COLUMNS`, `lib/schema.mjs:213`; `checkItem`,
   `lib/raterPackets.mjs:60` requires *exactly* the sealed row). So this person sees the reference team's
   pseudonyms and whether each row was contested at reference time. That is a property of the frozen
   instrument, recorded here and in `RATING_INTEGRITY_NOTES.md` §5, and **not** designed around in this
   package. §8 forbids acting on it.

---

## 5. The §10.1 decision procedure, reproduced verbatim

§12.2 requires this person to have it. It is the frame within which Label A and Label B are to be judged.

> ```
> CPG returned a value?
> ├─ no  → reference holds an authoritative value?  yes → MISSED-FILL          no → CORRECT-ABSTENTION
> └─ yes → value attributable to the EXPECTED entity? no → MISATTRIBUTED-FILL
>          └─ yes → reference holds an authoritative value? no → UNSUPPORTED-FILL
>                   └─ yes → value agrees (§10.2)?          yes → SUPPORTED-FILL   no → INCORRECT-FILL
> Reference insufficient to decide → REFERENCE-AMBIGUOUS (excluded; published)
> ```
>
> `INVALID` is machine-assigned for observations that could not be scored (§15).

## 6. The §10.2 agreement rules, reproduced verbatim

> | Field | Agrees when | Else |
> |---|---|---|
> | `founded_year` | same four-digit year | INCORRECT-FILL |
> | `employee_count` | \|CPG − reference\| ≤ 10% of reference | INCORRECT-FILL |
> | `revenue_range` | CPG states a currency (`$` = USD) equal to the reference currency, **and** the parsed amount (K=10³, M=10⁶, B=10⁹) is within 10% of reference | a value with **no currency marker** → UNSUPPORTED-FILL (sub-reason `CURRENCY_NOT_STATED`); a stated but different currency or amount → INCORRECT-FILL |
>
> **Temporal rule** for `employee_count` and `revenue_range`: reference truth is the most recent
> authoritative value with `as_of_date` no more than **24 months** before the run `asOf` [NORMATIVE]. If
> none exists that recent, the observation is `REFERENCE-STALE` (excluded; published). A CPG value that
> matches only an *older* authoritative value is INCORRECT-FILL, sub-reason `STALE_VALUE`.

---

## 7. What this person returns

### 7.1 The decision space is exactly three values

§12.2's Decisions line, quoted in full:

> **Decisions** are `LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS`. They are mapped mechanically to the
> chosen label.

`resolveRatingDecisions` (`lib/packets.mjs:104-113`) accepts nothing else and throws
*"decision must be LABEL_A|LABEL_B|REFERENCE-AMBIGUOUS"*.

| Decision | Resulting label | Code |
|---|---|---|
| `LABEL_A` | whichever rater's label was presented as Label A on **this** item | `lib/packets.mjs:110` |
| `LABEL_B` | whichever rater's label was presented as Label B on **this** item | `lib/packets.mjs:111` |
| `REFERENCE-AMBIGUOUS` | `REFERENCE-AMBIGUOUS`, **unconditionally** — regardless of whether either rater offered it | `lib/packets.mjs:109` |

**Consequence, stated plainly** (confirmed in `RATING_INTEGRITY_NOTES.md` §4): this person **can** assign
a label neither rater gave — but only `REFERENCE-AMBIGUOUS`, which is an **exclusion**, not a scoring
label. §10.3: REFERENCE-AMBIGUOUS is *"excluded from every denominator, counted and published"*. There is
no decision value that produces a new *scoring* label, and `LABEL_A`/`LABEL_B` always resolve to a label
one of the raters actually wrote.

Choosing `REFERENCE-AMBIGUOUS` spends the §15.5(2) exclusion budget. It is the right decision when the
sealed reference record genuinely does not permit a decision — and only then.

### 7.2 The sub-reason is not this person's to write

`resolveRatingAdjudication` (`lib/ratings.mjs:114-117`) takes the sub-reason from the **chosen rater's**
row, and sets it empty for a `REFERENCE-AMBIGUOUS` decision. This person writes no sub-reason.

### 7.3 Required columns

| Column | Written |
|---|---|
| `candidate_id`, `field` | exactly as the packet item gives them |
| `decision` | `LABEL_A` \| `LABEL_B` \| `REFERENCE-AMBIGUOUS` |
| `rationale` | **required and non-empty** — `lib/ratings.mjs:107` refuses *"rationale is required"* |
| `adjudicated_by` | `UNASSIGNED` — this person's pseudonym; `lib/ratings.mjs:106` refuses any other |
| `adjudicated_at` | `YYYY-MM-DD`; `lib/ratings.mjs:108` |

`resolveRatingAdjudication` refuses the submission **whole** on any of: an item that is not in the packet
(*"agreeing, pending or unknown item"*), a duplicate decision, a missing decision
(*"disagreement without a decision"*, `lib/ratings.mjs:110`), a wrong `adjudicated_by`, an empty
rationale, or a malformed date. **Every disagreement needs a decision; there is no `pending` here.**

### 7.4 What this person's decisions do not touch

§12: *"adjudicated values are flagged"* — `finalRatings` returns `adjudicated: true` for every resolved
item (`lib/ratings.mjs:151`), and the published row carries the flag.

**Krippendorff's α is computed on the raters' own labels and is untouched by these decisions.**
`lib/analysis.mjs:181` feeds `alphaNominal` the pair `[r.rater_1_label, r.rater_2_label]`. §12's Agreement
row, quoted in full:

> **Agreement** — "Krippendorff's α, **nominal**, **≥ 0.667** [NORMATIVE — Krippendorff's own floor for
> tentative conclusions]; per-label agreement also published"

So this person cannot rescue a low α, and cannot damage a high one. Resolving a disagreement does not
make it disappear from the agreement statistic. This is by design, and it is why the role has no
incentive to resolve in any particular direction.

---

## 8. Conflict rules

| Rule | Basis |
|---|---|
| **Is neither rater.** Mechanically refused at `lib/ratings.mjs:98` and `lib/assignment.mjs:33` | §4A.3 |
| **Is not the reference adjudicator**, nor any other §4A.3 role, ever | §4A.3 |
| **Not the operator**, and no work for the developing organisation beyond the item-5 fee | §4A.1, §4A.3 |
| **No contact with either rater**, before, during or after — and no attempt to learn which label was whose | §12.2 never-receive list |
| **No request for tallies, counts, totals or endpoint status**, and none is to be accepted if offered | §12.2 |
| **Do not act on the reference record's `author` / `confirmer` / `resolution` / `adjudicated_by`**; none is an input to §10.1 or §10.2 | §10.1, §10.2; §4.1 above |
| **No new label, no new value, no new sub-reason.** The decision space is the three values of §7.1 | §12.2; `lib/packets.mjs:112` |
| **No revision after submission.** The resolution is hashed and bound to the packet, both sheets, the evaluation artefact and the seal (`lib/ratings.mjs:119-124`) | §13.2 |
| **A fee may not be contingent** on any result, finding or future engagement | §4A.1 item 5 |
| **No AI**, in any part of the work | standing prohibition of this package |
| **If forbidden material arrives, stop and tell the operator.** A protocol violation discovered mid-run halts the run (§18) and triggers §15.5(7) | §15.5(7), §18 |
| **If any declaration answer changes**, say so immediately | §4A.1 |

---

## 9. Deadline — relative to operator-supplied anchors only

§12.2's Timing line, quoted in full:

> **Timing:** after both raters submit complete sheets.

**No calendar date appears in this package.** Anchors **E**, **M**, **A**, **C**, **X** are the same
anchors as in the rater packages; this role adds **S** and **W**.

| Anchor | Meaning | Value |
|---|---|---|
| **E** | Eligibility complete: declaration all-`"no"`, fee agreement signed **and hashed**, organisation confirmation received | `<<UNFILLED: YYYY-MM-DD>>` |
| **M** | Role material released (this file, `RATING_ADJUDICATION_PACKET.md`, §10.1/§10.2). **M ≥ E, always** (§4A.1 item 5) | `<<UNFILLED: YYYY-MM-DD, on or after E>>` |
| **A** | Person-to-label assignment recorded and its SHA-256 fingerprint **published** | `<<UNFILLED: YYYY-MM-DD, on or after E>>` |
| **C** | Held-out commitment transaction broadcast. **A < C is a hard gate** (§4A.3, §12.1) | `<<UNFILLED: YYYY-MM-DD, strictly after A>>` |
| **S** | **Both** rater sheets accepted by `ingest-ratings` and hashed. Nothing in this role starts before S | `<<UNFILLED: YYYY-MM-DD>>` |
| **W** | This person's packet released; `verify-adjudication-packet --type rating` rebuilds it byte-identically | `<<UNFILLED: YYYY-MM-DD, on or after S>>` |
| **K** | Adjudication window in days. **Cannot be set before S**, because the item count is not knowable until then (see `RATING_WORKLOAD_NOTE.md` §5) | `<<UNFILLED: integer days, set at S>>` |

| Relative day | Act |
|---|---|
| E+0 | Declaration, fee agreement and organisation confirmation complete. **Nothing is released before this.** |
| M+0 | Role material released. This person reads §4A, §10.1, §10.2, §10.3, §12, §12.2, §15.1–§15.2, this file and `RATING_ADJUDICATION_PACKET.md`. |
| M+1 | Written confirmation of having read them; questions resolved **before** W. |
| A+0 | Assignment fingerprint published; this person may confirm it names them for `rating-adjudicator` and nothing else. |
| S+0 | Both rater sheets accepted. The operator builds the packet and runs `verify-adjudication-packet --type rating`. **K is set here.** |
| W+0 | Packet released with the run `asOf` and the derived cutoff. This person may verify the packet hash. |
| W+0 … W+K | Adjudication. Every item gets a decision and a rationale. |
| **W+K** | **Submission deadline.** |
| W+K+1 | Operator runs `resolve-rating-adjudication`. Refusal is all-or-nothing. |
| W+K+2 | Operator returns refusal messages verbatim; this person corrects **their own** rows. |
| W+K+4 | Corrections returned. Repeat until accepted. |

**Ordering constraints that are not negotiable:** `E ≤ M`, `E ≤ A`, `A < C`, `C < X`, `X < S`, `S ≤ W`.
`S ≤ W` is §12.2's Timing requirement; releasing this packet before both sheets are accepted would break
the raters' blinding as well.

### 9.1 A scheduling honesty note

This role's workload is **unknowable in advance**, because it is the disagreement count, and §12.2 forbids
disclosing that count in advance. The consequence for planning: **K must be reserved as capacity, not
estimated as a duration.** Reserve the window for the worst case bounded in
`RATING_WORKLOAD_NOTE.md` §5 and release it early if the packet turns out small. Do not ask this person
to commit to a fixed number of items, and do not tell them one.

---

## 10. If this role is unavailable

§12 says only that *"Rater disagreement … resolved by the rating adjudicator"*. The instrument is harder:
`finalRatings` throws `RATING_ADJUDICATION_MISSING` (`lib/ratings.mjs:136`) whenever a disagreement exists
and no verified resolution does, so **`analyze` cannot run at all**. There is no fallback path, no
default, no majority rule and no operator override. The consequences:

- if the two raters happen to agree on every completely rated item, no packet is built and no
  adjudication is needed — and supplying one anyway is refused (`lib/ratings.mjs:144`);
- otherwise, **no endpoint can be computed** until an eligible, distinct third person adjudicates.

§12's closing paragraph applies to the whole rating stage:

> **If independent raters are unavailable:** execution may occur, but every primary endpoint is labelled
> **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of independent
> validation may be made.** The protocol is not weakened to accommodate unavailability.

## Human dependency

| Item | Class |
|---|---|
| Packet construction, Label A/B assignment, order derivation, decision→label mapping, resolution hashing | **H0** — fully mechanical, deterministic, rebuildable |
| Deciding LABEL_A / LABEL_B / REFERENCE-AMBIGUOUS on a contested item | **H2** — reserved to a human |
| That this person is **distinct from both raters** | **H0 given the artefacts** — `lib/ratings.mjs:98`, `lib/assignment.mjs:33`; **H3** for the underlying fact that three separate people exist |
| Blinding to rater identity, tallies and the pilot | **H2** — procedural for conduct; **H0** for packet contents |
| Truth of the declaration | **H3** — unverifiable by any tool (§4A.1) |

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


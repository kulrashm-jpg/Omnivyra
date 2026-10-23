# CPG-U1 — Rating adjudication packet (rating adjudicator)

**Classification: HUMAN-REQUIRED INPUT.** Instruction sheet, blank return format, and the operator
commands that build, verify and resolve the packet. It contains **no company, no value, no label and
no identity**.

- Protocol: `CPG_U1_PROTOCOL_004.md` §10.1, §10.2, §12, §12.1, §12.2, §12.3, §15
  (sha256 `c50fc680…df00b719`).
- Instrument: tooling v6, aggregate `<NEW_AGG>`
  (`lib/packets.mjs` — `buildRatingAdjudicationPacket`, `checkRatingAdjudicationPacket`,
  `resolveRatingDecisions`; `lib/ratings.mjs` — `resolveRatingAdjudication`;
  `lib/raterOrder.mjs` — `rater1IsLabelA`).

> **This work must be done by a human.** No AI system, language model or agent may make, draft or
> suggest any decision here. A third independent human choosing between two blind labels is the
> whole content of this role.

---

## PART A — For the adjudicator

## A1. Your task

Two people rated the same observations independently, following the same fixed procedure, and on some
items they chose **different labels**. You will see, for each such item, the same material they saw
plus **the two labels, unlabelled as Label A and Label B**, and you choose one — or declare the
reference material insufficient.

You are **not** told which rater gave which label. You are **not** told how many items you have.

## A2. Exactly what the packet contains (§12.2)

> **Contents, for each disagreeing held-out observation only:**
> - the identical §12 rater packet (field; CPG's value or null; the source URLs CPG cited (§12.3); the
>   sealed reference record);
> - the §10.1 decision procedure and §10.2 agreement rules;
> - the two raters' labels shown **unlabelled** as "Label A" and "Label B".

Mechanically, each item carries **exactly** these seven keys (`RATING_ITEM_KEYS`) and nothing else:

```
candidate_id · field · cpg_value · cpg_source_urls · reference_record · label_a · label_b
```

You receive alongside it, unchanged, the **full §10.1 decision procedure and §10.2 agreement rules** —
including the currency rule, the 10% tolerances and the temporal rule with its owner-approved calendar
arithmetic (`rules/analysis_decisions.json` **AD-5** `"value": "CALENDAR_MONTHS"`, **AD-6**
`"value": "STATED_REFERENCE_VALUES_ONLY"`). Use `RATER_PACKET_INSTRUCTIONS.md` §1, §2, §3 and §5 as
your reference text: **you judge against exactly the standard the raters were given, not a standard of
your own.**

## A3. What the packet must **never** contain (§12.2, verbatim)

> **The rating adjudicator never receives:**
> - which rater gave which label, or rater identities;
> - other observations' labels;
> - tallies, aggregates or provisional endpoint values;
> - class prediction, stratum, split or identity-hazard note;
> - pilot outputs;
> - **the number of disagreements.**

Any added key is refused by `checkRatingAdjudicationPacket` with
*"keys must be exactly … (forbidden information present or field missing)"*. If forbidden material
reaches you outside the packet, **stop and tell the operator**: a protocol violation discovered
mid-run makes the run VOID (`rules/analysis_decisions.json` **AD-7**) and halts it (§18).

**What cannot be hidden** (§12.2): the study is single-arm, so the company and the software's output
for the item you are judging are **necessarily visible**, and no arm identity exists. The protocol
states this limitation rather than pretending otherwise.

## A4. Label A / Label B are unlabelled, and scrambled per item

> **Label A / Label B assignment.** Label A is rater 1's label iff the first hexadecimal digit of
> `order_key("rating-adjudicator-label-a", …)` is even. Items are presented in
> `order_key("rating-adjudicator", …)` order.

So:

1. **"Label A" is not a person.** Whether Label A came from rater 1 or rater 2 is decided
   **independently per item** by a hash of the published held-out sampling record. There is no pattern
   to detect, and systematically preferring Label A is meaningless.
2. **Nobody can steer it.** The derivation comes from a Bitcoin commitment plus a drand round nobody
   chose, and cannot be known before the held-out draw (§12.1). Ordering and position use **separate**
   labels, so the item order tells you nothing about which position is whose.
3. The mapping back to the chosen label is **recomputed** from the held-out record after your decision
   (`resolveRatingDecisions`, `lib/packets.mjs:104`; `lib/ratings.mjs:115`) — there is no mapping file
   for anyone to trust or alter.

## A5. Pending items never reach you

An observation where **either** rater wrote `pending` is **not a disagreement**: `pending` items are
*"never adjudicated, never scored (§12)"* (`lib/packets.mjs:81`). Items where both raters chose the
**same** label are also excluded — *"agreement is never adjudicated"* (`lib/packets.mjs:82`).

Your packet therefore contains **only** items that are (a) completely rated by both raters and (b)
labelled **differently**. `resolve-rating-adjudication` refuses a decision on anything else:
*"not an item of the rating-adjudicator packet (agreeing, pending or unknown item)"*.

You cannot tell from your packet how many items were rated in total, how many agreed, or how many were
pending — and you are not told.

## A6. The three permitted decisions

`LABEL_A` · `LABEL_B` · `REFERENCE-AMBIGUOUS`

| Decision | Use it when |
|---|---|
| `LABEL_A` | Applying §10.1 and §10.2 to this item, Label A is the correct label |
| `LABEL_B` | Label B is |
| `REFERENCE-AMBIGUOUS` | The **reference material is insufficient to decide** the item at all — neither label can be established from it |

> **§12.2: "Decisions are `LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS`. They are mapped mechanically
> to the chosen label."**

What this forbids:

- **You may not supply a new label.** `lib/ratings.mjs:9-10`: decisions are
  *"`LABEL_A | LABEL_B | REFERENCE-AMBIGUOUS` — **never a new label** — by the assigned rating
  adjudicator, who is neither rater."* If you believe the correct label is a **third** one that
  neither rater chose, your options are still only these three; that situation is what
  `REFERENCE-AMBIGUOUS` exists for when the reference cannot settle the item, and otherwise you choose
  the nearer of the two labels on the record.
- **You may not split, qualify or annotate a label.** Your rationale is prose; the decision is one of
  three tokens.
- **You may not change a sub-reason.** The chosen label **keeps the sub-reason its rater recorded**
  (`lib/ratings.mjs:10`, `:117`). A `REFERENCE-AMBIGUOUS` decision carries an empty sub-reason.
- **You may not touch agreeing items.** Where both raters agreed, the label stands; if they agreed on
  the label but recorded **different** sub-reasons, the machine records `SUB_REASON_DISAGREED`
  (`lib/ratings.mjs:150`) without involving you.

How to decide: walk **§10.1 in order** on the item exactly as a rater would (`cpg_value === null`
puts you on the abstention branch; a value puts you on the fill branch — this is mechanical), apply
the §10.2 rules for the field, and see which of the two offered labels that procedure produces. If the
procedure produces neither because the reference record cannot settle the question, choose
`REFERENCE-AMBIGUOUS`. A `REFERENCE-AMBIGUOUS` outcome is **excluded from every denominator, counted
and published** (§10.3) — an honest outcome, always available.

## A7. Timing

> **§12.2 Timing:** after **both raters submit complete sheets.**

Both sheets must be complete — every packet item labelled or explicitly `pending` — and verified
against the sealed evaluation artifact before your packet can even be built. You never see a partial
rating set.

## A8. What you return

Exactly these six columns (`ADJUDICATION_COLUMNS`, `templates/adjudication.template.csv`):

```
candidate_id,field,decision,rationale,adjudicated_by,adjudicated_at
```

| Column | You write |
|---|---|
| `candidate_id` | exactly as the packet item gives it |
| `field` | exactly as the packet item gives it |
| `decision` | `LABEL_A` \| `LABEL_B` \| `REFERENCE-AMBIGUOUS` — nothing else |
| `rationale` | why, referring to the §10.1 branch and the §10.2 rule you applied; **required** and must be non-blank |
| `adjudicated_by` | your **pseudonym** — must equal the person the published assignment fingerprint names for `rating-adjudicator` |
| `adjudicated_at` | `YYYY-MM-DD` |

`resolveRatingAdjudication` refuses the set if: an item is not in the packet; a decision is duplicated;
`adjudicated_by` is not the assigned adjudicator; a `rationale` is blank; `adjudicated_at` is not
`YYYY-MM-DD`; or **any packet item has no decision** — *"disagreement without a decision"*. The set is
refused whole and nothing is written.

Never write a rater's name or number, and never write `rater-1` / `rater-2` in any column. You do not
know which is which.

## A9. Standing prohibitions

- **No AI**, in any part of the work.
- **No contact with either rater**, the reference team or the enumerators about any item.
- **No request for tallies, counts, other items' labels, or the number of disagreements.**
- **No new label, no third value, no altered sub-reason.**
- **No revision after submission.** Your resolution is hashed and bound to both rater sheets, the
  deterministic packet, the sealed evaluation artifact and the seal.
- **No legal name** in the returned file.

---

## PART B — Operator commands

Shared argument groups (from the tooling README):

```sh
SEALED="--seal SEAL.json --held-out-manifest ho/manifest.json --evaluation evaluation.json"
RATED="$SEALED --assignment assignment.json --assignment-fingerprint <published fp> \
       --sheet-1 sheet_r1.json --sheet-2 sheet_r2.json"
```

Building `$RATED` already enforces, for **both** sheets (`ratingInputs`):

- the sheet hash recomputes (not altered after ingestion);
- the sheet is bound to **this** evaluation artifact and **this** seal;
- the sheet rates **exactly** that rater's deterministic packet, **in packet order**;
- every row still passes `checkRating` (label, sub-reason, §10.1 first branch, dates);
- `rated_by` equals the person the **published assignment fingerprint** names for that label, else
  `RATER_SHEET_REFUSED (<label>): not rated by the person the published assignment names`.

### B1. Build the packet

```sh
node cpg_u1_data.mjs rating-adjudication-packet $RATED --out rating_packet.json
```

- Prints: `rating adjudication packet: <n> disagreeing item(s); Label A/B unlabelled; no rater identity, class, split or tally`
- Exit `0` ok, `1` refused (nothing written). Output is **write-once**.
- Contains **only** completely-rated disagreements: agreeing items and any item either rater marked
  `pending` are excluded by construction.
- **Do not tell the adjudicator the item count** printed by this command (§12.2: never the number of
  disagreements). Deliver the packet, not the console output.

### B2. Verify the packet before it goes to the adjudicator

```sh
node cpg_u1_data.mjs verify-adjudication-packet --type rating $RATED --packet rating_packet.json
```

- Exit `0`: `rating adjudication packet verified against the deterministic build`.
- Exit `1`: `FORBIDDEN_OR_ALTERED_PACKET: …` — an added key, an extra or **agreeing** item, a
  reordering, or a reassigned Label A/B.
- §12.2 Enforcement: *"The packet is built deterministically and verified by rebuilding."* It is a
  rebuild-and-compare, not an inspection.

### B3. Resolve the blind decisions

```sh
node cpg_u1_data.mjs resolve-rating-adjudication $RATED \
  --packet    rating_packet.json \
  --decisions rating_decisions.csv \
  --out       rating_resolution.json
```

- Re-verifies the packet against the deterministic build first (`FORBIDDEN_OR_ALTERED_PACKET` on
  failure).
- Resolves the adjudicator identity from the **published assignment fingerprint**, and refuses if the
  two sheets were rated by the **same** person (*"≥ 2 independent raters are required"*) or if the
  adjudicator **is** either rater (*"the rating adjudicator must be neither rater (§4A.3)"*).
- Maps `LABEL_A` / `LABEL_B` to the actual labels by recomputing `rater1IsLabelA` from the held-out
  record; `REFERENCE-AMBIGUOUS` maps to itself. The chosen label **keeps its rater's sub-reason**.
- Prints: `resolved <n> blind decision(s) to the chosen labels; resolution_sha256 <hash>`.
- Exit `0` ok, `1` `RATING_ADJUDICATION_REFUSED (<n>): …` (nothing written).

### B4. Downstream binding

`analyze` recomputes the final label per observation (`finalRatings`) and refuses unless everything
lines up:

- disagreements exist but no resolution → `RATING_ADJUDICATION_MISSING: <n> disagreement(s) need the
  rating adjudicator's resolution`;
- a resolution supplied when the raters never disagreed → `RATING_RESOLUTION_REFUSED`;
- an altered resolution, a resolution bound to other sheets or another evaluation, a resolution made
  on a packet other than the deterministic one, or one that does not decide **exactly** the
  disagreements → `RATING_RESOLUTION_REFUSED`.

So the adjudication cannot be swapped, trimmed or regenerated after the fact.

### B5. What the operator must not do

- Not adjudicate, not rate, not stand in for an unavailable adjudicator (§4A.3; `check-personnel`
  refuses the operator in any independent role).
- Not pass the adjudicator anything on the §12.2 forbidden list — including the disagreement count
  from B1's output.
- Not use an AI as the adjudicator.
- Not re-run the adjudication with a different person to obtain a different outcome; the resolution is
  bound to the assignment fingerprint published before the held-out commitment.

---

## Human dependency

| Item | Class |
|---|---|
| Packet build, Label A/B assignment, presentation order, decision mapping, all validation and binding | **H0** — fully mechanical, deterministic and rebuildable |
| The decision on each disagreeing item | **H2** — reserved to a human; no new label may be introduced |
| That the adjudicator is a third person, **neither rater** and not the operator | **H3** — enforced structurally by `lib/assignment.mjs` and `lib/ratings.mjs`, but the underlying fact is a real independent person |
| Blinding to rater identity, other items, tallies and the disagreement count | **H2** — procedural; the tooling controls the artifact, not what a person is told beside it |

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


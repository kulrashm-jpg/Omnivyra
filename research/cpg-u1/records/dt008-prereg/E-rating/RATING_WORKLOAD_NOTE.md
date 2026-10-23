# RATING_WORKLOAD_NOTE — how much work each rating role owes, and how little of it is judgement

**Classification: PREPARATION ONLY. RESOURCING PROJECTION, NOT U1 EVIDENCE.** DEEPTECH-PARALLEL-008,
Agent 5. No protocol byte and no instrument byte changed. No registration, no frame, no draw, no
execution, no network call, no company data. **No person holds any role.**

| Baseline | Value |
|---|---|
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (recomputed) |
| Instrument | `<NEW_AGG>`, <NEW_N> files, at `C:/tmp/dt002/research/cpg-u1/tooling` (recomputed read-only; the worktree's 587-file tree was **not** used) |
| Derived, not typed | every count in §1 and §2 comes from `lib/sizing.mjs` `heldOutQuotas`, `lib/schema.mjs` `DEVELOPMENT_QUOTA` / `HELD_OUT_BASE` / `FIELDS`, evaluated over **all 4⁶ = 4096 permitted pilot outcomes** |

---

## 1. Rating covers held-out only — VERIFIED, with the claim's two halves separated

### 1.1 The protocol text

§12.1, "Items per list", quoted in full:

> **Items per list:** a rater's list is every held-out company × field; the rating adjudicator's list is
> the disagreeing held-out items; the reference adjudicator's list is the disagreeing items of both
> stages.

One sentence carries both halves of the claim:

- **rating is held-out only** — "a rater's list is every **held-out** company × field", and the rating
  adjudicator's list is "the disagreeing **held-out** items";
- **reference truth covers both stages** — the reference adjudicator's list is "the disagreeing items of
  **both stages**", which presupposes reference records for both.

### 1.2 Corroboration, so the claim does not rest on one sentence

| Evidence | Source |
|---|---|
| The Author *"constructs a blind record for **every drawn** company × field"*; the Confirmer *"a **separate blind** record for every company × field"* — "drawn" includes the development draw | §9.1 |
| The development pilot runs CPG over the 6 development fill-expected companies and its outputs are *"never used for any purpose except sizing and harness debugging"* — so nothing from the development stage is rated | §11 |
| Every §10.3 endpoint is defined "pooled across held-out"; P1 explicitly so | §10.3 |
| §15.5(2) and §15.5(3) are stated over *"held-out company × field observations"* and *"held-out observations"* | §15.5 |
| §12's Minimum-valid-ratings row: *"≥ 90% of **held-out** observations must be completely rated"* | §12 |

**Verdict: CONFIRMED.** Rating is held-out only. The reference stage is the asymmetric one.

### 1.3 Therefore each rater rates 60–300 observations — VERIFIED MECHANICALLY

`FIELDS` = `['founded_year', 'employee_count', 'revenue_range']` → **3 observations per company**
(`lib/schema.mjs`).

Held-out company count is the frozen §5.6 sizing rule applied to the pilot. Enumerating **every** permitted
pilot outcome with the instrument's own `heldOutQuotas`:

- 4096 outcomes total; **1** is the all-zero HALT (*"CPG produced zero fills across every development
  fill-expected company"*); **4095** are permitted;
- floor: `fill-expected 12 / abstention-expected 5 / identity-hazard 3` = **20 companies** → **60
  observations**;
- cap: `60 / 25 / 15` = **100 companies** → **300 observations**;
- `MAX_HELD_OUT_QUOTAS` (`lib/frame.mjs:27`) independently reports `{60, 25, 15}`, matching the cap.

**So: 60 ≤ observations per rater ≤ 300. CONFIRMED.**

The range is not continuous. Exactly **13** values are reachable:

| Held-out companies | quotas fe/ab/ih | **Observations per rater** | Reference records **per reference observer** (dev 10 + held-out) × 3 | Reference : rating |
|---|---|---|---|---|
| 20 | 12/5/3 | **60** | 90 | 1.50× |
| 23 | 13/6/4 | 69 | 99 | 1.43× |
| 24 | 14/6/4 | 72 | 102 | 1.42× |
| 26 | 15/7/4 | 78 | 108 | 1.38× |
| 30 | 17/8/5 | 90 | 120 | 1.33× |
| 31 | 18/8/5 | 93 | 123 | 1.32× |
| 34 | 20/9/5 | 102 | 132 | 1.29× |
| 39 | 23/10/6 | 117 | 147 | 1.26× |
| 44 | 26/11/7 | 132 | 162 | 1.23× |
| 51 | 30/13/8 | 153 | 183 | 1.20× |
| 60 | 36/15/9 | 180 | 210 | 1.17× |
| 76 | 45/19/12 | 228 | 258 | 1.13× |
| 100 (cap) | 60/25/15 | **300** | 330 | 1.10× |

`DEVELOPMENT_QUOTA` is `{fill-expected 6, abstention-expected 2, identity-hazard 2}` = **10 companies**
(§5.6 [NORMATIVE]), so the reference stage carries **30 observations that rating never sees**, at both
stages, for **both** the Author and the Confirmer.

**Both raters rate the same item set** — identical membership, different order (§12.1). The rating stage
therefore consumes `2 × (60…300)` = **120–600 human rating acts**, plus adjudication.

### 1.4 The operator cannot choose where in the range to sit

The held-out size is a *"pre-registered deterministic function of the development pilot, fixed now and
applied before the held-out draw"* (§5.6). Higher pilot yield → **fewer** held-out companies. The cap of
60 fill-expected *"requires human approval (H1)"* as a resourcing commitment, and §5.6 adds: *"If
`capped`, the run proceeds at the cap and the elevated risk of an INCONCLUSIVE result is declared in
advance."* So the rating workload is a consequence of the pilot, not a lever.

---

## 2. What the count means for each role

| Role | Items | Floor | Cap |
|---|---|---|---|
| `rater-1` | every held-out company × field | 60 | 300 |
| `rater-2` | the same item set, different order | 60 | 300 |
| `rating-adjudicator` | the **disagreeing** completely-rated held-out items | **0** | 300 |

The adjudicator's count is **not knowable in advance** — see §5. Its floor is genuinely zero: if the two
raters agree on every completely rated item, `buildRatingAdjudicationPacket` returns no items, no
adjudication occurs, and `lib/ratings.mjs:144` refuses a resolution supplied anyway.

---

## 3. The asymmetry a prior wave established — CONFIRMED

`C:/tmp/dt006-human-min/orchestrator/VERIFIED_GROUND_TRUTH.md` §5 states it. I re-derived it against the
frozen instrument rather than accepting it.

### 3.1 The claim

> §10.1's decision procedure is mechanical given CPG's value, the sealed reference record and §10.2:
> four-digit year equality; |CPG − reference| <= 10% for `employee_count`; a currency-marker check plus
> ±10% parsed amount for `revenue_range`; a 24-month `as_of_date` window. §12.3 Rule A's URL set is
> derived mechanically and byte-verified by `verify-rater-packet`. The genuinely judgemental nodes are
> only two: *is the value attributable to the EXPECTED entity?* and *is the reference insufficient to
> decide (REFERENCE-AMBIGUOUS)?*

### 3.2 Node-by-node confirmation against the instrument

| §10.1 node | Mechanical or judgemental | Evidence |
|---|---|---|
| **"CPG returned a value?"** | **Mechanical, and machine-enforced.** `cpg_value === null` decides it; `checkRating` (`lib/ratings.mjs:37-38`) refuses a sheet that crosses the branch. There is no discretion and no exception | `lib/ratings.mjs:36-38`, whose own comment says *"§10.1 first branch is mechanical"* |
| **"Reference holds an authoritative value?"** | **A lookup, not a judgement.** `value_kind` is `STATED` or `NOT_AVAILABLE_FROM_SOURCE` in the sealed row; the authority tier is fixed per field by §9.4; the temporal window is arithmetic on `as_of_date` | §9.3, §9.4, §10.2; `REFERENCE_COLUMNS` `lib/schema.mjs:213` |
| **"Value agrees (§10.2)?"** | **Arithmetic.** Year equality; a ±10% band; a currency-marker test plus a K/M/B parse and a ±10% band. The 24-month cutoff is supplied by the operator as a date, and AD-5 fixes the arithmetic as `CALENDAR_MONTHS` | §10.2; `rules/analysis_decisions.json` AD-5, AD-6 |
| **"Value attributable to the EXPECTED entity?"** | **JUDGEMENTAL.** No field of the packet answers it. It requires reading the cited URLs and the reference record and deciding whether the number is a fact about *this* entity rather than a parent, subsidiary, or same-named company elsewhere. The instrument enforces nothing here | §10.1; no corresponding check exists in `lib/ratings.mjs` |
| **"Reference insufficient to decide (REFERENCE-AMBIGUOUS)?"** | **JUDGEMENTAL.** An open-ended assessment of whether the sealed record supports *any* decision. `RATING_LABELS` admits the label; nothing constrains when it is right | `lib/packets.mjs:8` |

### 3.3 §12.3's contribution confirmed

The URL set is derived by `extractCitedUrls` (`lib/raterPackets.mjs:31-49`) from `sourceUrl` of the
field's final evidence records only, deduplicated in response order, and `verifyRaterPacket`
(`lib/raterPackets.mjs:84-89`) rebuilds the packet and requires `Buffer.compare(...) === 0`. §12.3's own
enforcement line: *"`verify-rater-packet` rebuilds the packet and requires byte identity, so a
hand-edited URL set is refused."* **Nothing about assembling the evidence set is a rater task.**

### 3.4 Verdict, and the consequence for scheduling

**CONFIRMED, unmodified. Exactly two judgemental nodes.** Three consequences:

1. **Per-row rating time is much lower than per-row reference time**, because nothing is looked up:
   everything the rater needs is in the item. The reference observer does open-ended source work.
2. **Per-row time is not uniform.** A row that reaches neither judgemental node (most rows: a null value
   against a `NOT_AVAILABLE_FROM_SOURCE` record, or a matching four-digit year) is fast. A row that
   reaches "attributable to the EXPECTED entity?" is slow. **The mix is unknowable in advance**, because
   it depends on CPG's held-out behaviour, which no one may preview (§6.5).
3. **The narrowness is a reason the two-rater requirement is affordable, not a reason to drop it.** The
   two judgemental nodes are exactly where reliability must be *estimated* rather than assumed, and α is
   computed on precisely those disagreements.

---

## 4. Per-row time — every figure is an ASSUMPTION

> **Every time figure in this section is an ASSUMPTION.** None is derived from the protocol; none is
> measured; no measurement of any of them exists; none is a commitment; none may be cited as a finding.
> They exist so the operator can reserve capacity, and they must be replaced by observation at the first
> opportunity.

| Quantity | ASSUMPTION | Basis for the assumption | Why it could be wrong |
|---|---|---|---|
| One rating (one packet item, walk §10.1 once) | **6 minutes** | The `RATES.rating_observation_minutes` value already used by `workload_scheduler.mjs:49` (`C:/tmp/dt004-operations/people/tools/`), itself flagged there as an assumption: *"Cheaper than a reference record: nothing is looked up, everything is supplied."* Reused here for continuity rather than invented, so two waves do not carry two different numbers | It averages over a mix (§3.4 point 2) that nobody has seen. A held-out set rich in identity hazards pushes many rows onto the attributable-entity node |
| One rating adjudication (one §12.2 item + rationale) | **8 minutes** | `RATES.rating_adjudication_minutes`, `workload_scheduler.mjs:51`. Higher than a rating because a written rationale is mandatory (`lib/ratings.mjs:107`) and the item is by construction one two qualified people split on | Contested items are the hardest items; 8 minutes may be optimistic for a genuine entity-attribution dispute |
| One reference record, for the contrast only | **25 minutes** | `RATES.reference_record_minutes`, `workload_scheduler.mjs:43` — open-ended source work | not this note's subject; quoted only to show the ratio |
| Onboarding read-through per person (§4A, §10.1, §10.2, §10.3, §12, §15, the packages) | **2–3 hours, once** | An ASSUMPTION with no basis in any measurement. `RATER_PACKET_INSTRUCTIONS.md` is ~355 lines of normative detail and the onboarding package adds more; the protocol sections are dense | If it is wrong it is wrong low; front-loaded comprehension is what prevents a refused sheet |
| Sustainable rating rate per person per day | **an operator judgement, not asserted here** | The protocol sets no rate, and fatigue on a repetitive categorical task is exactly the kind of thing a made-up number would misrepresent | — |

### 4.1 What follows arithmetically, with the assumption carried through

At 6 min/observation, per rater:

| Observations | Rating hours per rater | Both raters |
|---|---|---|
| 60 (floor) | 6.0 | 12.0 |
| 180 (mid of the reachable set) | 18.0 | 36.0 |
| 300 (cap) | 30.0 | 60.0 |

**These are the assumption × a verified count. The count is solid; the hours are not.** State them to the
candidate as "we have reserved X" and never as "this will take you X".

---

## 5. The adjudicator's workload is structurally unknowable — and that is a protocol requirement

§12.2's never-receive list includes, quoted:

> - the number of disagreements.

So the count cannot be disclosed to the adjudicator in advance, and until both sheets are accepted it does
not exist even for the operator. Bounds:

- **Floor 0.** Total agreement builds no packet.
- **Ceiling = the number of completely rated items ≤ 300.** Every completely rated item could in principle
  disagree — though α would then be far below 0.667 and §15.5(3) would make the run INCONCLUSIVE anyway.
- **`pending` items never enter.** `lib/packets.mjs:81` skips any item either rater marked `pending`; they
  are *"never adjudicated, never scored"*.

**The planning consequence, stated as a rule rather than a number:** reserve the adjudication window as
**capacity**, sized against a worst case the operator is willing to absorb, and release it early if the
packet is small. Do not estimate a duration, do not ask the person to commit to an item count, and do not
tell them one (`RATING_ADJUDICATOR_PACKET.md` §9.1).

A useful upper bound on the operator's own exposure, using the 8-minute ASSUMPTION: an implausible
all-disagree packet at the cap is 300 × 8 min = **40 hours**. A high-but-plausible 15% disagreement rate at
the cap is 45 items = **6 hours**. Both figures inherit the assumption's weakness; only the *shape* of the
bound is solid.

---

## 6. What this note does not do

- It proposes **no** reduction in sample size, fields, raters, reference constructions or adjudication.
  `workload_scheduler.mjs` refuses `--reduce-sample` outright and that refusal stands here.
- It sets **no** deadline. Deadlines are relative to operator anchors; see each package's §9.
- It asserts **no** measured rate, and it does not present any assumption as a finding.
- It names **no** person and claims **no** recruitment.

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


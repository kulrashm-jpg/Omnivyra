# INFORMATION_BARRIER_ANALYSIS — §4A.2, the Enumerator barrier, and reaching 126/52/32

**Agent:** AGENT E of DEEPTECH-PARALLEL-007.
**The problem.** §5.7.2 requires the complete frame to hold ≥ 126 / 52 / 32 eligible admissible
rows per outcome class before the development commitment. §4A.2 forbids enumerators from
receiving quotas. So somebody must know how close the frame is, and nobody who is enumerating may
be told. Is that a coordination blocker, and does a second enumerator make it worse?

**Verdict in one line: the barrier forbids CLASS-DIRECTED coordination, not coordination. It is
not a blocker, it pre-exists at one enumerator, and the eight-person model adds exactly one new
leak channel which is closable at the price of over-asking. This was always awkward; this model
does not break it.**

---

## 1. The two verified details (confirmed, with one correction of emphasis)

The coordinator asked me to confirm both. I read both clauses in
`research/cpg-u1/CPG_U1_PROTOCOL_004.md` (sha256 `c50fc680…f00b719`).

**(1) Enumerators are not given the thresholds. CONFIRMED, and it is stronger than stated.**
§4A.2 verbatim:

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, §5.1–§5.4;
> - the jurisdiction-family list;
> - the development-only registry.
>
> **They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2).

§5.7.2 is not in the "receive" list. The correction of emphasis: §5.5, §5.6 and §5.7 are also
absent. So an enumerator does not receive the sizing rule, the two-stage structure, the rank key,
the pool minimum **or** the sufficiency rule. And the "never receive" clause's parenthetical cites
`(§5.5, §5.7.2)` — which puts §5.7.2's *content*, the 126/52/32 numbers, expressly on the barred
side. §5.5.3 restates it: "**Enumerator barrier.** Enumerators never receive pilot, sizing or
quota information (§4A.2)." So an instruction naming a class shortfall is barred by both clauses.

**(2) The frame must be complete before any pilot exists. CONFIRMED.**
§5.5.3: "**Complete before the development commitment.** The complete frame F must exist and meet
the sufficiency rule (§5.7.2) before the development commitment." And "**No changes after the
development commitment.** Rows may never be added, removed, edited, re-identified or reclassified
(enforced: CLI refusal before the held-out commitment; VOID at chain verification)."
The §5.5 sequence puts it beyond doubt — step 3 is "enumerate the COMPLETE frame F → frame → scan
→ check-frame-sufficiency (§5.7.2) — NO LATER ADDITIONS", step 4 is the development commitment,
step 8 is the pilot. **No pilot result exists when sufficiency is checked.** The enumerator load
is therefore size-independent: it is always 126/52/32, whatever the pilot later yields. §20.22
already declares this ("A frame sufficient for the maximum quota is enumerated even when the
pilot later yields a small held-out quota").

**One further clause the coordinator did not name, and it resolves the crux.** §5.7.2:

> If unmet, **no development commitment may be made**; enumeration continues first (enforced:
> `check-frame-sufficiency`, `commitment-payload`).

**The protocol expressly authorises iteration.** "Enumeration continues first" is not a
loophole — it is the normative instruction for the unmet case. The question is therefore never
*whether* the operator may go back for more, only *what the operator may say when doing so*.

---

## 2. (a) Who may compute sufficiency mid-enumeration?

**The operator, and in practice only the operator.** This is a mechanical fact, not just a policy
one.

`check-frame-sufficiency` takes `--frame`, `--scan`, `--registry`. It does **not** go through
`registered()`, so it needs no registration and can be run at any moment during enumeration. But
`--scan` must be a report produced by `scan`, and `scan` requires:

- `--repo` pointing at a **clean clone of the resolver repository**, and
- `git rev-parse HEAD` equal to `--expect-sha`, the frozen resolver SHA.

I proved both guards fire (`repo HEAD … != --expect-sha …`, exit 1; `repo has working-tree
changes — scan a clean clone only`, exit 1). §4A.2 gives the enumerator the frame template, public
sources, §4A/§5.1–§5.4, the jurisdiction-family list and the registry. **It does not give them the
repository.** So an enumerator physically cannot produce a scan, and therefore cannot compute
sufficiency, even if they wanted to. The barrier on this point is enforced by the absence of an
input, which is the strongest kind of barrier the protocol has.

Could a third party do it? §4A.3 lists eight roles: operator, enumerator(s), reference Author,
Confirmer, adjudicator, rater 1, rater 2, rating adjudicator. There is **no frame-custodian role**.
Adding one would be a protocol amendment, so it is not available. The reference roles must not
receive the frame before their packets (§9.2.1) and an enumerator may not be the reference
adjudicator (§4A.3). **So the computation falls to the operator by elimination.**

This has a consequence that §20.18 already half-declares and which deserves to be said plainly:
the operator is **not independent** (§4A.3: "operator (key custodian; not independent)"), so the
person deciding *when the frame is finished* is a member of the developing organisation. See §6.

## 3. (c) Does the operator computing and acting on sufficiency create a §5.5.3, §6.5 or §18.3 problem?

**No, on all three — but each for a reason worth recording.**

**§5.5.3.** No conflict. The Enumerator barrier constrains what the operator *tells enumerators*,
not what the operator *computes*. The operator is in fact **required** to compute it:
`commitment-payload` refuses an insufficient frame (the frozen self-test asserts "no development
commitment payload for an insufficient frame (fail closed)"), and a development commitment to an
insufficient frame is `STAGE_VOID_FRAME_INSUFFICIENT` at `draw-development` — slot consumed, no
retry. The only §5.5.3 hazard is temporal: all iteration must finish **before** the development
commitment. It does, by the §5.5 ordering (step 3 precedes step 4).

**§6.5.** No. The preview prohibition requires "**any execution of CPG**, in any environment …
**or any reading of stored CPG output** (logs, persisted results)" for a company in F. Neither
`scan` nor `check-frame-sufficiency` executes CPG or reads CPG output: `scan` is `git ls-files`
plus regexes over file text; sufficiency is set arithmetic over CSV rows. §6.5 says so itself:
"the registered tooling runs no CPG." **The live §6.5 hazard is different and is aggravated by
iteration**: an operator repeatedly reviewing candidate names and domains over several rounds is
in continuous temptation to check a borderline candidate in the CPG UI or in stored lookups. Under
§6.5(c) that is a preview for "any other frame company … before the held-out drand round's
scheduled time", and its consequence is **study VOID, not flagged**. Each additional iteration
round is an additional exposure to this, and the protection is only §20.20's procedural and
audit-based one. **This is the strongest argument for a single large ask over many small rounds,
and it is stronger than the disclosure argument.**

**§18.3.** No. §18 halt condition 3 is "a protocol violation is found **mid-run**", exemplified by
"a company admitted after execution began". Enumeration and iteration precede the run by the whole
commitment, draw, seal and authorisation sequence. Adding rows after the development commitment
would trip §5.5.3's CLI refusal and VOID-at-chain-verification, and hence §18 condition 5 ("any
§5.10 VOID state") — but that is the *post*-commitment case, which iteration by construction is
not.

**§9.6.** Checked for completeness: operator separation is about **reference truth** ("the
operator receives the seal hash only"), not about the frame. No conflict.

## 4. (b) What may be communicated back? The largest quota-free instruction set

### 4.1 Forbidden — the assignment's test case

> **"Keep going, we need more abstention-expected rows in your partition."**
> **This is a quota disclosure and it is forbidden.** Plainly.

It is forbidden three times over:

1. **By §4A.2's letter.** It communicates a per-class requirement. A per-class requirement is a
   quota. §4A.2 bars "quotas", and its parenthetical names §5.7.2 as the barred source.
2. **By §5.5.3's Enumerator barrier**, which repeats the rule in the frame-freeze clause,
   [NORMATIVE; APPROVED CPG-043].
3. **And — this is the part that matters more than the compliance point — it corrupts the
   measurement it was meant to enable.** `abstention-expected` means, per §5.2, "No authoritative
   source is expected to state any of the three fields". It is an *evidential judgement* made by
   the enumerator before any reference research. An enumerator told that this class is short has
   every incentive to lower the bar for the prediction. And §9.7 makes class-prediction-vs-
   reference-truth mismatch a **published** quantity: "If reference truth contradicts a company's
   class prediction … the mismatch is recorded in the seal and published." So the disclosure
   biases exactly the judgement whose accuracy the study publishes. §5.2 says the class "serves
   sampling balance only", which limits the damage to the endpoint, but the published mismatch
   rate would be an artefact of the instruction rather than of the enumerator's judgement.

**Weaker variants are also forbidden**, for the same reason: "your abstention-expected count is
low", "we have enough fill-expected now", "stop submitting identity-hazard rows". Any instruction
whose content varies with a class is barred.

### 4.2 The largest quota-free instruction set

Everything below is either already in §4A.2's "receive" list, or is derivable by the enumerator
from material they have, or carries no information about §5.7.2.

| # | Permitted | Why it is quota-free |
|--:|---|---|
| 1 | §4A, §5.1–§5.4 verbatim, the frame template, the jurisdiction-family list, the frozen development-only registry | §4A.2's own list |
| 2 | **Which jurisdiction families are this enumerator's partition** | The family list is already disclosed; a subset assignment says nothing about §5.7.2. It is a division of labour, not a quota |
| 3 | **A disjoint `candidate_id` prefix** | Purely clerical; closes the S-6 duplicate-id defect |
| 4 | **A fixed, pre-agreed minimum number of rows to submit — TOTAL, not per class**, set before enumeration begins and deliberately over-provisioned | See §4.3: a single total, decoupled from the threshold by a large margin, carries no usable information about 126/52/32 |
| 5 | "Submit rows in all three classes as you encounter them; do not aim for any mix" | Explicitly withholds the mix, and states that no target exists |
| 6 | **Row-level `MALFORMED` diagnostics from `frame`** — e.g. `enumerated_at must be YYYY-MM-DD`, `canonical_domain must be lowercase`, `identity_hazard_note is required for identity-hazard` | These are `checkFrameRow`'s enforcement of §5.1–§5.4, which the enumerator already has. No aggregate, no class count |
| 7 | **Row-level admissibility exclusion reasons** (`A3_NOT_ESTABLISHED`, `A4_NO_INDEPENDENT_TIE`, …) | Same: §5.1's own table, which the enumerator has |
| 8 | "Enumeration is not yet complete; continue" — **the one unavoidable bit** | See §4.4 |

### 4.3 (c of the coordinator's list) Is a per-partition candidate-count target itself quota information?

**A per-partition TOTAL count is not quota information. A per-partition PER-CLASS count is.**

- A per-class target is the frame minimum divided by the number of enumerators. It is §5.7.2
  content, arithmetically recoverable. **Barred.**
- A total count is not recoverable to the per-class thresholds: an enumerator told "submit at
  least 250 candidates" cannot decompose 250 into 126/52/32, and cannot even infer 210, because
  they do not know the admissibility attrition rate the operator assumed, the ineligibility rate,
  or how many enumerators there are (§4A.2 does not tell them).
- **The leak is real but bounded, and the mitigation is to over-ask.** If the ask were tuned
  tightly to the threshold — "submit exactly 105 each" — then an enumerator who guessed there were
  two of them would recover 210. Deliberate over-provision by a factor well above 1 destroys that
  inference: an ask of 250 each, against a 210-row floor, tells the enumerator nothing except that
  the operator wants a lot of rows. **So the ask must be generous not only for convergence (§4.5)
  but for barrier reasons.** The two requirements point the same way, which is fortunate.
- One nuance for the owner: the ask should be in *candidates submitted*, not in *eligible
  admissible rows*, because the latter would require the enumerator to know the scan outcome.

### 4.4 (d of the coordinator's list) May the operator iterate at all?

**Yes. §5.7.2 instructs it: "enumeration continues first."** Iteration is not tolerated, it is
prescribed. What iteration costs is information:

**The stop/continue signal is itself one bit of §5.7.2 per round.** If the operator says "continue"
after batch 1 and "stop" after batch 2, the enumerator learns that the threshold lies between the
two cumulative totals. Over `k` rounds of batch size `b`, the enumerator localises the frame
minimum to within `b`. This is unavoidable — an enumerator who is asked for more rows necessarily
learns that the previous number was not enough — and it is not what §4A.2 is aimed at, since the
bit is about the *total* floor, not about a class.

**Bounding it is easy, and should be an owner decision:**
- Fix the batch schedule **in advance and in writing** ("you will be asked for up to three batches
  of 100"), so the continue-signal is expected rather than informative.
- Make every round's ask **identical and symmetric across enumerators** (see §5).
- Never name a class, a count of accepted rows, or a residual.

**Iteration is therefore permitted; class-directed iteration is not.** Which means every round
after the first is **blind**: the operator can ask for more rows but cannot ask for more rows *of
the class that is short*.

### 4.5 The consequence for sizing the initial ask — and a gap in §20.22

Because rounds are blind, each additional round increases every class roughly in proportion to its
natural incidence. If one class is scarce, blind rounds converge on it slowly and the operator
over-collects the abundant classes massively in the process.

`abstention-expected` is the class most likely to bind: §5.2 defines it as "No authoritative source
is expected to state **any** of the three fields", which for a company that has already passed A1
(real operating entity), A2 (controlled HTTPS domain), A3 (checksum-valid decisive identifier in an
accessible family) and A6 (reference truth obtainable for all three fields) is a demanding
conjunction. The threshold is 52.

So the initial ask must be sized **from the scarcest class**, not from the 210 total:

> `N_ask ≈ FRAME_MINIMUM[scarcest] / (p_admissible × p_eligible × p_scarcest)`, with margin.

With, say, `p_abstention ≈ 0.15` among admissible candidates and ~5% scan/registry ineligibility,
52 abstention-expected rows needs on the order of 360–400 submitted candidates — **roughly 1.8–2×
the 210 floor**, before any allowance for blind-round variance. And the prior `p_abstention` cannot
be estimated from the frame under construction without the operator looking at the class mix, which
is exactly the look that motivates the forbidden instruction.

**§20.22 understates this.** It says: "Frame enumeration is larger (≥ 210 eligible admissible rows
before the development commitment)." That is the *floor on the accepted frame*, not the *ask*. With
the barrier respected, the enumeration **effort** is materially larger than 210 rows, and the
multiplier is governed by an unstated prior on class incidence. **Owner question OQ-3 below.**

---

## 5. (a of the coordinator's list) Does the second enumerator create the tension, or does it pre-exist?

**It pre-exists in full at one enumerator. I confirm the coordinator's belief.** Every element is
present at n = 1:

| Element | Present at n=1? |
|---|---|
| Enumerator may not be told 126/52/32 | Yes — §4A.2's list is per person, not per team |
| Somebody must compute sufficiency, and it can only be the operator | Yes — the enumerator has no repository |
| The operator must choose an initial ask without telling the enumerator the threshold | Yes |
| If the frame is short, the operator must say "continue" without naming the class | Yes — §5.7.2's unmet case |
| The stop/continue signal leaks one bit per round | Yes |
| The stop decision is a frame-composition decision made by a non-independent person | Yes |

So **the eight-person model does not create the problem and does not make it structurally worse.**

**But it adds exactly one new leak channel, and it is worth naming precisely.**

> **The ASYMMETRY of a continue-instruction is itself quota information.**

If the frame is short on `abstention-expected`, and the operator's per-class tally shows that
partition B is the weaker contributor (as in fixture C/D: abstention 60 vs 5 — real output in
`SUFFICIENCY_COMPOSITION.md` §2.3), the natural act is to ask **only** enumerator 2 to continue.
Enumerator 2 then learns something enumerator 1 does not: *my partition is the short one*. With a
jurisdiction partition, "my partition is short" is close to "the class that correlates with my
jurisdictions is short". The disclosure is indirect but it is real, and it exists only because
there are two enumerators. At n = 1 there is no asymmetry to leak.

**It is closable.** Always ask **both** enumerators to continue, by the **same** amount, in every
round. Then the continue-signal carries no partition-specific information, and the residual leak is
the same single bit as at n = 1. The price is over-collection in the partition that was already
adequate — which, given that surplus admissible eligible rows are harmless (they simply sit in the
frame and are never drawn; §5.8 `NOT_DRAWN` / `DEVELOPMENT_SURPLUS`), is a cost in enumerator fees,
not in validity.

**One thing the model does make genuinely harder.** Because a jurisdiction partition correlates
with class composition, a symmetric ask does *not* equalise class yields. Asking both enumerators
for 100 more rows when `abstention-expected` is short may deliver most of the shortfall from one
partition and almost none from the other. Blind symmetric iteration is therefore *less efficient*
under a jurisdiction partition than under a random partition. **If the owner wants cheap
convergence, partition by something class-neutral** (e.g. alphabetical range within every family,
or an interleaved candidate list), not by jurisdiction family. That is a real design
recommendation the eight-person model produces.

---

## 6. The thing that is actually wrong here, and it is not the barrier

The barrier is survivable. What the analysis exposes is a different, larger gap, and it deserves
the owner's attention more than the coordination question does.

**The operator decides when the frame is finished, and the operator is not independent.**

- §4A.3: the operator is "not independent".
- Only the operator can compute sufficiency (§2).
- §5.7.2 permits enumeration to continue until sufficiency is met, and the operator chooses when
  to stop.
- The operator sees, at every round, the scan output — which **names** the held-out-ineligible
  rows — and the per-class eligible counts.

The cryptographic sampling machinery does not cover this. §5.5's "Why this stops rank-aware
selection" argument protects against choosing *which rows are drawn* from a fixed frame: the frame
hash is inside the on-chain digest before the randomness block exists. It says nothing about
choosing *which frame*. §20.18 declares the gap but attributes it to the wrong party:

> "Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate
> selection (the frame is unbiased); the latter rests on enumerator independence only."

**"Enumerator independence only" is incomplete.** The frame is the union of the enumerators'
submissions **truncated at a moment the operator chooses**, with per-class eligible counts visible
to the operator at that moment. Frame unbiasedness rests on enumerator independence **and on the
operator's stopping rule**. This is true at one enumerator and at eight; two enumerators make it
sharper only because the operator additionally chooses *whose* rows to stop taking.

**Mitigation available without a protocol change:** the operator commits, in the public
registration or in a hashed pre-agreed operating note, to a **pre-specified stopping rule** — the
batch schedule, the symmetric-ask rule, and "stop at the first round at which
`check-frame-sufficiency` exits 0, accepting every row submitted in that round". A mechanical
stopping rule removes the discretion. Under that rule the operator's per-class visibility becomes
irrelevant, because nothing the operator sees can change what happens next.

**Mitigation requiring a protocol change (for a future version, not this one):** make §20.18 name
the operator's stopping rule, and add the stopping rule to §19.1's registration content.

---

## 7. Verdict, stated plainly as asked

**The barrier does NOT make coordination impossible, and it does not require a quota disclosure.**

- **Possible, quota-free:** a pre-agreed batch schedule; symmetric, class-blind "continue"
  instructions; a generously over-provisioned total ask per partition; row-level `MALFORMED` and
  admissibility diagnostics; and one sufficiency computation per round, by the operator alone.
- **Impossible without a disclosure:** any efficient, targeted coordination. The operator can
  never say which class is short, which partition is short, or how many more rows are needed. The
  cost is over-enumeration, paid in enumerator fees.
- **Not a blocker.** No clause is unsatisfiable. No two clauses conflict. §5.7.2's "enumeration
  continues first" and §4A.2's "never receive … quotas" are jointly satisfiable by a blind,
  symmetric, pre-scheduled iteration.
- **This was always awkward. This model does not break it.** The n = 1 case has every element of
  the tension. The two-enumerator model adds one new channel (asymmetric asks), which symmetry
  closes, and one new inefficiency (jurisdiction partitions correlate with class), which a
  class-neutral partition would avoid.
- **The genuine finding is elsewhere:** §20.18 under-declares the operator's stopping rule as a
  source of frame bias, and §20.22 under-states the enumeration ask. Neither is caused by the
  second enumerator; both become more visible because of it.

---

## 8. Open owner questions

| # | Question | Why it needs an owner |
|--:|---|---|
| **OQ-1** | May the operator return **scan-derived** row-level feedback to an enumerator — "these five of your rows are held-out-ineligible"? It is not a quota disclosure and not CPG output, but it reveals which companies the CPG developers touched, which §4A.2(b) arguably means to keep from someone who must never have seen CPG | It is the one item in §4.2's table I could not place with confidence. My recommendation: **withhold it.** Ineligible rows stay in the frame and are useful (§5.8 development surplus), so there is no operational need to tell the enumerator |
| **OQ-2** | Is the batch schedule and symmetric-ask rule to be **written down and hashed** before enumeration begins? | Without it, the stopping rule is discretionary and §6 applies |
| **OQ-3** | What prior on class incidence sizes the initial ask, and should §20.22 be amended to declare the ask rather than the floor? | The ask is materially larger than 210; the number is currently nowhere |
| **OQ-4** | Should the partition be **class-neutral** (interleaved list) rather than by jurisdiction family? | §5 — a jurisdiction partition makes blind iteration converge slowly and correlates partition with class |
| **OQ-5** | Who performs cross-partition **entity reconciliation** before the merge? `assertUnique` catches a shared identifier or a shared canonical domain, but not the same entity recorded with a different decisive identifier *and* a different domain by two enumerators (`SUFFICIENCY_COMPOSITION.md` U-1). An enumerator may not do it (they would see the other partition); the reference adjudicator may not (§4A.3) | This is the one merge hazard the instrument cannot detect, and it is created by the second enumerator |
| **OQ-6** | Should `cmdScan` refuse a duplicate `candidate_id` rather than silently collapsing it (`SCAN_COMPOSITION_ANALYSIS.md` S-6)? | It is a tooling change and the tooling is frozen at registration, so it must be decided before registration or not at all |

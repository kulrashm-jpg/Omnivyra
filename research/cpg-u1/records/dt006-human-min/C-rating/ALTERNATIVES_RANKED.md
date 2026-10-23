# CPG-U1 — four alternatives to a third human, assessed and ranked

**Classification: METHODOLOGY REVIEW. PROPOSAL, NOT REGISTERED.** No protocol byte changed. No
registration, no frame, no execution. DEEPTECH-HUMAN-MIN-001, Agent C.

Three tests are applied to each option:

1. **Principled or a disguised choice?** Does the rule follow from something the protocol already
   fixes, or does it smuggle in a preference that someone picked?
2. **Pre-registrable?** Can it be written down, in full, before any held-out label exists, such that
   no later discretion remains?
3. **Free of any use of the software's output?** Does the rule read CPG's value, its cited URLs, its
   response or any derived aggregate?

A fourth, decisive test emerged from the analysis and is applied alongside: **does the rule have a
home in §15.1's disposition list, or does it require a new disposition that consumes the §15.5(2)
90 % budget?**

---

## 1. Option (a) — exclude disagreements

**Rule.** A disagreement stays `DISAGREEMENT`, is excluded from every denominator, is counted and
published; the endpoints are computed over agreed observations only.

| Test | Verdict |
|---|---|
| Principled? | **Partly.** It is the same treatment §10.3 already gives `REFERENCE-CONFLICT`, `REFERENCE-AMBIGUOUS` and `REFERENCE-STALE`: "excluded from every denominator, counted and published". But those exclusions are *reference*-driven; this one is *rater*-driven, which is a different kind of thing. |
| Pre-registrable? | **Yes**, trivially — one sentence, no parameters. |
| Uses the software's output? | **No.** The rule reads two labels. |
| Home in §15.1? | **No — and this is decisive.** |

**§15.1 has no disposition for a rater disagreement.** Quoted in full:

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS`
> and `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the
> primary analysis; §5.3). `INCONCLUSIVE` is **run-level only**.

and §15.2's first row:

> | Scored into a §10.1 label from sealed reference truth | VALID |

Every exclusion in that list is reference-driven or `INVALID` (no response, harness error, post-draw
inadmissibility). **Option (a) therefore requires an amendment creating a new exclusion disposition,
and that new disposition then competes for the same §15.5(2) 90 % budget** — a budget that is
**8.70 %–10.00 %** of observations across *all* exclusion causes, i.e. as few as six observations at
the smallest permitted held-out configuration. I have verified this reading of §15.1/§15.2 directly
and I agree with it. It is an asymmetry with the reference adjudicator, whose removal has a lawful
home: `REFERENCE-CONFLICT` already exists as a sealed disposition.

**And (a) is anti-conservative.** Excluding a disagreement removes an item on which two qualified
people split — a *hard* item, and hard items are where erroneous fills live. Because P1's test is
`20·bad ≤ fills`, removing a contested fill reduces `fills` by one and `bad` by zero, so EFR falls.
Pinned as a live test (`test_twoRaterRating.mjs` T12.3–T12.6): on the same 31 observations — 28 agreed
`SUPPORTED-FILL`, 1 agreed `CORRECT-ABSTENTION`, 2 contested `{SUPPORTED-FILL, INCORRECT-FILL}` —
option (a) reports 28 fills, EFR exactly 0 and **every endpoint met**, while option (c) reports 30
fills, `20·bad − fills = 10` and **P1 not met**. §15.2 says "No observation may be excluded because
its result is unfavourable"; (a) does not do that, but it selects on difficulty, which is correlated
with the outcome, in the claim's favour.

**Verdict: available only with a new exclusion disposition, and it moves the estimand toward the
claim. Not recommended as the primary analysis.** It remains worth *reporting* as a secondary
(agreement-conditional) figure, precisely because the gap between (a) and (c) measures how much of the
result rests on contested items.

---

## 2. Option (b) — conservative resolution by a label ordering

**Rule.** Resolve each disagreement to the label "less favourable to the claim under test", under a
total order over the seven labels fixed in advance.

### 2.1 The mechanical ordering, and why it cannot be built

The natural ordering, most-unfavourable first, is:

`MISATTRIBUTED-FILL ≺ INCORRECT-FILL ≺ UNSUPPORTED-FILL ≺ MISSED-FILL ≺ REFERENCE-AMBIGUOUS ≺ CORRECT-ABSTENTION ≺ SUPPORTED-FILL`

**It does not work, and no other total order does either.** Consider the admissible contested pair
`{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}` — admissible because `lib/ratings.mjs` `checkRating` refuses
a fill label only where the software returned nothing and an abstention label only where it returned a
value, and `REFERENCE-AMBIGUOUS` is in neither list, so it is the one label admissible on both sides.
Per-endpoint contributions:

| statistic (unfavourable direction) | `UNSUPPORTED-FILL` | `REFERENCE-AMBIGUOUS` | which is unfavourable |
|---|---|---|---|
| P1: maximise `20·bad − fills` | `20·1 − 1 = +19` | `0` | `UNSUPPORTED-FILL` |
| P2: minimise `CA − 9·U` | `−9` | `0` | `UNSUPPORTED-FILL` |
| G1: minimise `fills` | `+1` | `0` | `REFERENCE-AMBIGUOUS` |
| §15.5(2): minimise `valid` | `+1` | `0` | `REFERENCE-AMBIGUOUS` |

**The two halves of the table want opposite labels.** Any total order must place one below the other,
and **either orientation can inflate SUCCESS.** Both counterexamples are pinned as live tests
(`test_twoRaterRating.mjs` T13.1–T13.5):

- **Rank `REFERENCE-AMBIGUOUS` lowest.** 29 agreed `SUPPORTED-FILL` + 1 agreed `INCORRECT-FILL` + 1
  contested `{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}`. The ordering picks `REFERENCE-AMBIGUOUS`: 30
  fills, 1 bad, `20·1 = 20 ≤ 30` → **P1 met**. The exact worst case picks `UNSUPPORTED-FILL`: 31
  fills, 2 bad, `20·2 − 31 = +9 > 0` → **P1 not met**. The ordering reports a pass the data does not
  support.
- **Rank `UNSUPPORTED-FILL` lowest.** 19 agreed `SUPPORTED-FILL` + 1 contested
  `{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}`. The ordering picks `UNSUPPORTED-FILL`: 20 fills →
  **G1 holds**. The exact worst case picks `REFERENCE-AMBIGUOUS`: 19 fills → **G1 fails**. Again a
  pass the data does not support.

There is a second, milder conflict inside `{INCORRECT-FILL, UNSUPPORTED-FILL}`: P2 is worse under
`UNSUPPORTED-FILL` (it enters the AR denominator) while R1 is worse under `INCORRECT-FILL` (it enters
the FR denominator). R1 has no threshold, so this one affects reporting rather than SUCCESS.

**Conclusion: the brief's requirement — "define the ordering mechanically over the seven labels and
show it cannot inflate SUCCESS" — cannot be met by an ordering.** A single total order is a disguised
choice about *which endpoint to be pessimistic about*, and whichever choice is made, there exist data
on which it reports a pass that some admissible resolution refuses.

### 2.2 The per-endpoint form, which does work

Replace "one order over labels" with "one extremisation per endpoint". Every §10.3 threshold is an
**integer linear inequality** in the label counts:

```
G1        fills >= 20
P1        20*bad - fills <= 0           (and fills > 0)
P2        CA - 9*U >= 0                 (and CA + U > 0)
P3        M === 0
§15.5(2)  10*valid - 9*total >= 0
```

so for each endpoint the extremum over all `2^D` resolutions is reached by choosing, **independently
per disagreement**, the option that extremises *that endpoint's own* statistic. No ordering is
required, and the result is exact rather than heuristic. That construction **is** option (c)'s
unfavourable branch. So option (b), made rigorous, collapses into option (c).

| Test | Verdict |
|---|---|
| Principled? | **As a single total order: no — a disguised choice, provably able to inflate SUCCESS.** As a per-endpoint extremisation: yes, and it is (c). |
| Pre-registrable? | Yes in either form. |
| Uses the software's output? | No. |
| Home in §15.1? | **Yes — the best of the four.** A rule-chosen label is still one of the raters' §10.1 labels derived from sealed reference truth, so §15.2's existing first row makes the observation `VALID`. No new disposition, no charge against the §15.5(2) budget. |

**Verdict: the right *disposition* treatment, the wrong *selection* rule.** Keep its §15 fit; replace
its ordering with (c)'s per-endpoint extremisation.

---

## 3. Option (c) — the sensitivity interval

**Rule.** Compute every endpoint twice: once with all disagreements resolved as favourably as
possible to the claim, once as unfavourably as possible. Publish both. **Assert SUCCESS only if the
unfavourable bound meets every threshold.** Publish α, raw agreement, the disagreement count and the
contested items. Never synthesise a consensus label.

**The guarantee, stated exactly.** If the unfavourable bound meets every threshold, then **every one
of the `2^D` possible resolutions meets every threshold**, so no adjudicator's decision — however
made — could have produced the pass. Conversely, if the favourable bound fails, **no** resolution
could have produced a pass, so the adjudicator would have been irrelevant. Between the two lies the
band in which the third human's judgement is outcome-relevant, and (c) reports that band explicitly
(`outcome_depends_on_disagreements`).

Verified by brute force in `prototype/test_twoRaterRating.mjs` T5.1: 250 random cases, **8035
enumerated resolutions**, asserting that every achievable value of `fills`, `20·bad − fills`,
`CA − 9U`, `CA + U`, `M`, `valid`, EFR and R1 lies inside the reported interval, and that
`success_robust_to_every_resolution ⇒ every resolution passes` and
`¬success_possible_under_some_resolution ⇒ no resolution passes`. 0 violations.

| Test | Verdict |
|---|---|
| Principled? | **Yes.** It makes no choice at all. It reports the range the evidence permits and requires the claim to hold across it. The rule follows from the endpoint algebra the protocol already fixes. |
| Pre-registrable? | **Yes** — the extremisation is a function of the frozen endpoint definitions, with no free parameters. But §10.5's "exactly one" outcome must be amended in advance to say what happens when the interval straddles a threshold (it must be INCONCLUSIVE — see below). |
| Uses the software's output? | **No**, and this is proved mechanically: T7.1 scans the module's code (comments stripped) for every field name of the software output and finds none; T7.2 injects `cpg_value`, `cpg_source_urls`, `reference_record`, `machine_state` and rater identities into every input and proves the output is byte-identical. |
| Home in §15.1? | **Yes for the disposition** — every observation stays `VALID`-eligible and nothing is excluded, so the §15.5(2) budget is untouched except where a contested label is `REFERENCE-AMBIGUOUS`. **No** for the *reporting*: an interval is not "exactly one" outcome until §10.5 says which it is. |

**The costs, honestly.**

- **It cannot produce a clean SUCCESS whenever any contested item could be a bad fill beyond the
  budget.** P1 tolerates `⌊F/20⌋` erroneous fills in total, which is **one** at the run's ~30 fills,
  so one contested possible-bad fill is survivable and two are not. P3 tolerates **zero** contested
  possible-misattributions. See `DISAGREEMENT_COST_ARITHMETIC.md` §5.
- **It needs a §10.5 amendment.** A straddling interval must map to INCONCLUSIVE, recorded as a new
  AD-class decision *before* registration with the same discipline as AD-1..AD-9. Otherwise the
  operator picks the outcome after seeing results, which is worse than any of the four options.
- **It reports more than the adjudicated design.** That is a cost politically and a benefit
  epistemically: a reader learns whether the verdict rested on contested items. The adjudicated design
  never tells them that.

**Verdict: the only option that is principled, exactly computable, pre-registrable with no free
parameter, provably unable to inflate SUCCESS, and free of the software's output. Recommended.**

---

## 4. Option (d) — a third rating from the same two humans at a later time

**Rule.** After the disagreements are known, ask rater 1 (or rater 2, or both) to re-rate the
contested items; use the later reading as the tie-break.

**This is not independence, on three separate grounds.**

1. **The protocol's own definition is person-level, and the tooling refuses it by name.** §12 requires
   "Raters | **≥ 2 independent** [NORMATIVE]"; §15.5(3) triggers on "fewer than 2 independent
   raters"; §4A.3 [NORMATIVE, under "## 4A. Study personnel and independence [NORMATIVE; APPROVED
   CPG-043]"] says "**Every independent role is held by a different person**" and "The seven
   independent roles are mutually exclusive: **minimum 7 independent persons**". And
   `resolveRatingAdjudication` refuses in two places: `'the two sheets were rated by the same person —
   ≥ 2 independent raters are required'` and `'the rating adjudicator must be neither rater (§4A.3)'`.
   A rater re-rating their own contested item is the same person twice; the second refusal applies
   verbatim.
2. **Statistically it is test–retest reliability of one coder, not inter-coder agreement.** The
   second reading's errors are correlated with the first reading's, because they come from the same
   person's reading of the same procedure and the same reference record. It therefore adds close to
   zero bits about which label is right — precisely the quantity a tie-break must supply.
3. **It breaks §12's blinding and §12.2's information rules.** §12 requires "Raters are blind to each
   other's labels, to running tallies and aggregates". A rater asked to re-rate an item learns that
   the item was **contested** — that is, learns something about the other rater's label. §12.2 goes
   further and denies even the adjudicator "the number of disagreements"; a re-rating request reveals
   exactly which items are contested and, by counting the requests, how many. And it happens *after*
   results exist, which §15.2 guards against in the adjacent case: "Exclusion rules may not change
   after any held-out result is seen."

| Test | Verdict |
|---|---|
| Principled? | **No.** It presents a correlated second reading as an independent one. |
| Pre-registrable? | Formally yes, but pre-registering it does not repair (1)–(3). |
| Uses the software's output? | The re-rating legitimately sees the rater packet (raters must), but the *timing* is post-hoc and the request itself leaks the disagreement structure. **Fails on information hygiene.** |
| Home in §15.1? | Yes — the observation becomes `VALID` — but only by mislabelling a non-independent reading as an independent one. |

**Verdict: worst of the four. It is the only option that makes the run look stronger than it is.** If
a second reading by the same person is wanted, it can be reported as a **test–retest diagnostic under
§10.4** ("never an acceptance basis") and nothing else.

---

## 5. Ranking

| Rank | Option | One-line basis |
|---|---|---|
| **1** | **(c) sensitivity interval** | The only option that makes no choice, is exactly computable over all `2^D` resolutions, provably cannot inflate SUCCESS, leaves the §15.5(2) budget and G1 untouched, and reports whether the third human would have mattered. Needs a §10.5 reporting amendment, not a new disposition. |
| **2** | **(b) conservative resolution** | Best fit to §15's frozen disposition vocabulary (the observation stays `VALID`, no budget charge), but a single total order over the seven labels is provably able to inflate SUCCESS in both orientations (T13). Adopt its §15 treatment; replace its ordering with (c)'s per-endpoint extremisation — at which point it **is** (c). |
| **3** | **(a) exclude disagreements** | Simplest and clearly pre-registrable, but has no home in §15.1, so it needs a **new exclusion disposition** that consumes the 8.70 %–10.00 % budget, and it is **anti-conservative**: it drops the hardest items and lowers EFR (T12). Keep it as a published secondary figure, not as the primary analysis. |
| **4** | **(d) later re-rating by the same humans** | Not independence by the protocol's own definition, refused by name in the tooling, statistically near-worthless as a tie-break, and it leaks the disagreement structure to a rater after results exist. Admissible only as a §10.4 diagnostic. |

**Recommended composite.** Adopt **(c)** as the primary analysis with **(b)'s** disposition treatment
(observations stay `VALID`-eligible; no new exclusion disposition), publish **(a)'s**
agreement-conditional figures alongside as a secondary so the reader can see how much rests on
contested items, and refuse **(d)** outright. Then, as §5.3 of `RATING_TWO_HUMAN_ANALYSIS.md` argues,
label every primary endpoint **UNADJUDICATED**, cap the evidence rung at **Rung 2**, and make no claim
of independent validation — the treatment Protocol-004 itself prescribes for a thinner human
apparatus.

**And record what none of the four can do.** All four require an amendment, because §4A ([NORMATIVE])
requires seven independent persons and names `rating-adjudicator` twice, and `checkPersonnelRegister`
blocks a register without it. The choice here is which amendment to make, not whether one is needed.

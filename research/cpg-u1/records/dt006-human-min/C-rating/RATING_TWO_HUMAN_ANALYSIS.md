# CPG-U1 — can rating run with two humans and no rating adjudicator?

**Classification: METHODOLOGY REVIEW. PROPOSAL, NOT REGISTERED.** Nothing here amends
`CPG_U1_PROTOCOL_004.md`, registers anything, frames anything or executes U1. No protocol byte is
changed. DEEPTECH-HUMAN-MIN-001, Agent C.

- Protocol read: `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256
  `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — §4A.3, §10.1, §10.2, §10.3,
  §10.4, §10.5, §12, §12.1, §12.2, §14, §15.1, §15.2, §15.3, §15.5.
- Instrument read (read-only, never written): `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
  recomputed with `lib/aggregate.mjs` → `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`
  (593 files) — matches the aggregate this task names. Files read: `lib/analysis.mjs`,
  `lib/ratings.mjs`, `lib/packets.mjs`, `lib/raterOrder.mjs`, `lib/personnel.mjs`, `lib/sizing.mjs`,
  `lib/frame.mjs`, `lib/schema.mjs`, `lib/aggregate.mjs`, `rules/analysis_decisions.json`.
- Prior artefacts read: `C:/tmp/dt004-operations/people/RATER_PACKET_INSTRUCTIONS.md`,
  `C:/tmp/dt004-operations/people/RATING_ADJUDICATION_PACKET.md`.
- Recorded decisions relied on (`rules/analysis_decisions.json`, status
  `"DECIDED — the values below are owner-approved methodological decisions, recorded before registration"`):
  **AD-1** `"value": "EXCLUDE_INVALID_CONFLICT_AND_STALE"`, **AD-2** `"value": "INCONCLUSIVE"`,
  **AD-8** `"value": "INCONCLUSIVE"`. AD-5 `CALENDAR_MONTHS` and AD-6 `STATED_REFERENCE_VALUES_ONLY`
  are quoted only where the staleness branch is discussed.

---

## 1. What the rating adjudicator actually contributes

### 1.1 What they see

`buildRatingAdjudicationPacket` (`lib/packets.mjs`) admits an item only if both raters supplied a
label, neither is `pending`, and the labels differ:

```js
if (l1 === PENDING || l2 === PENDING) continue; // not completely rated: never adjudicated, never scored (§12)
if (l1 === l2) continue; // agreement is never adjudicated
const aFirst = rater1IsLabelA(recordSha, ev.candidate_id, ev.field);
items.push({ ...pick(ev, EVALUATION_ITEM_KEYS), label_a: aFirst ? l1 : l2, label_b: aFirst ? l2 : l1 });
```

Each item carries exactly `RATING_ITEM_KEYS` = `candidate_id · field · cpg_value · cpg_source_urls ·
reference_record · label_a · label_b`. `label_a` / `label_b` **are the two raters' own labels**,
blind-permuted by `rater1IsLabelA`. §12.2 forbids the adjudicator from receiving rater identities,
other items' labels, tallies, provisional endpoints, class predictions, pilot outputs or **the number
of disagreements**.

### 1.2 What their decision produces

`resolveRatingDecisions` (`lib/packets.mjs`) is a three-way mechanical map:

```js
if (r.decision === 'REFERENCE-AMBIGUOUS') return { ...r, label: 'REFERENCE-AMBIGUOUS' };
if (r.decision === 'LABEL_A') return { ...r, label: it.label_a };
if (r.decision === 'LABEL_B') return { ...r, label: it.label_b };
throw new Error(`... decision must be LABEL_A|LABEL_B|REFERENCE-AMBIGUOUS`);
```

`resolveRatingAdjudication` then copies the **chosen rater's own sub-reason** (`source ?
source.sub_reason : ''`), and `finalRatings` hands the result to `analyze` marked `adjudicated: true`.
In `analyze` the adjudicated label is treated exactly like an agreed one: disposition `VALID` unless
the label is `REFERENCE-AMBIGUOUS`, in which case the observation is excluded.

### 1.3 The precise answer

**They cannot invent a scoring label.** Two of the three decisions return a label one of the raters
already wrote. The third, `REFERENCE-AMBIGUOUS`, *can* be a label neither rater chose — so the claim
"the adjudicator can only pick one of the two labels" is not exactly true — but that third option is
the **excluding** label: §10.3 says reference ambiguity is "excluded from every denominator, counted
and published", and `analyze` gives it disposition `REFERENCE-AMBIGUOUS`. So the adjudicator's reach
is: *one of the two labels on the table, or nothing.* No new scoring label exists anywhere in the
decision space.

**So does adjudication add information, or only convert an excluded observation into a scored one?**
Both, and it matters which part is which:

1. **Conversion.** Without a resolution the observation has no label and therefore no scored
   disposition. Adjudication converts it into a scored observation (or confirms its exclusion). That
   part is pure bookkeeping — it moves an observation from "not counted" to "counted".
2. **Direction.** *Which* of the two labels it is counted as is a fresh human judgement, worth at
   most log₂3 ≈ 1.585 bits per disagreement. That part is not bookkeeping: on a contested fill,
   `LABEL_A = SUPPORTED-FILL` and `LABEL_B = INCORRECT-FILL` give different EFR numerators, and with
   only ~30 fills in the run (§3 below) one such decision can decide SUCCESS versus FAILURE.

**The thing adjudication does not add is any measurement of rating quality.** The three numbers that
measure the rating apparatus — Krippendorff's α, raw agreement, and the completely-rated share — are
all computed on the raters' own labels, *before* any resolution, and are arithmetically untouched by
adjudication. In `lib/analysis.mjs`:

```js
const alphaPop = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending'
  && (D['AD-1'] === 'ALL_COMPLETELY_RATED_ITEMS' || !['INVALID', 'REFERENCE-CONFLICT', 'REFERENCE-STALE'].includes(r.disposition)));
const alpha = { population: D['AD-1'], ...alphaNominal(alphaPop.map((r) => [r.rater_1_label, r.rater_2_label])), threshold: 0.667 };
...
const completelyRated = rows.filter((r) => r.rater_1_label !== 'pending' && r.rater_2_label !== 'pending').length;
```

`alphaNominal` is fed `[r.rater_1_label, r.rater_2_label]` — the raters' labels, not the final ones.
`completelyRated` tests only for `pending`. **Confirmed: α is unaffected by adjudication.** So is
§15.5(3)'s 90 %-completely-rated clause, because a disagreeing observation *is* completely rated.

**The structural criticism this exposes.** Every item that reaches the adjudicator is, by
construction, an item on which two independently qualified people following the same published
procedure reached different conclusions — the hardest items in the run. Those items are then decided
by **one** person, with **no** second reading, **no** agreement statistic and **no** α. The rating
stage therefore applies its strongest reliability machinery to the easy items and its weakest to the
hard ones. The adjudicator's bit is the only judgement in the whole rating stage that is not itself
subject to an agreement check, and §12 provides no way to audit it beyond the required `rationale`
string.

---

## 2. The no-adjudicator design

### 2.1 What happens today

`finalRatings` (`lib/ratings.mjs`) refuses:

```js
if (packet.items.length) {
  if (!resolution) throw new Error(`RATING_ADJUDICATION_MISSING: ${packet.items.length} disagreement(s) need the rating adjudicator's resolution`);
```

`analyze` calls `finalRatings` immediately after the VOID branch, so **handed two verified sheets and
no resolution, the current tooling throws `RATING_ADJUDICATION_MISSING` and produces no results
artifact and no endpoint at all** — not an INCONCLUSIVE outcome, an abort. That is the current
behaviour and the baseline for everything below.

Two adjacent refusals are worth recording, because they bound what a "workaround" could look like:

- `finalRatings` also throws `RATING_RESOLUTION_REFUSED: a resolution was supplied but the raters did
  not disagree on any completely rated item` — a resolution cannot be carried past a run with no
  disagreements.
- `resolveRatingAdjudication` throws if `[sheet1.rated_by, sheet2.rated_by].includes(adjudicator)`
  ("the rating adjudicator must be neither rater (§4A.3)") and if
  `sheet1.rated_by === sheet2.rated_by` ("the two sheets were rated by the same person — ≥ 2
  independent raters are required"). **A rater cannot adjudicate their own disagreement**, so
  "two humans, one of whom also adjudicates" is not available; it is refused by name.
- `checkPersonnelRegister` (`lib/personnel.mjs`) lists `'rating-adjudicator'` in `INDEPENDENT_ROLES`
  and pushes a **blocker** `role rating-adjudicator is UNFILLED` when nobody holds it. The register
  cannot pass with six people.

### 2.2 The design, as a PROPOSAL

A disagreement stays `DISAGREEMENT`, is not scored, and the analysis reports raw agreement, α, the
disagreement count and each endpoint over agreed observations only. Exactly these code paths change:

| # | File / path | Change | Note |
|---|---|---|---|
| 1 | `lib/ratings.mjs` `finalRatings` | replace the `RATING_ADJUDICATION_MISSING` throw with a tri-state: when `resolution` is absent, return `{ r1, r2, final: null, disagreement: true }` for disagreeing items | keep the throw when a resolution *is* supplied, so the adjudicated design still works unchanged |
| 2 | `lib/analysis.mjs` disposition ladder | insert `else if (f.disagreement) disposition = 'DISAGREEMENT';` **between** the `REFERENCE-STALE` branch and `else if (f.final === null) disposition = 'PENDING';` | order is load-bearing: the inadmissible / machine-`INVALID` / `REFERENCE-CONFLICT` / `REFERENCE-STALE` branches must still win, or an unscorable observation is mis-reported as a rater disagreement |
| 3 | `lib/analysis.mjs` row mapping | nothing: `label`, `sub_reason` and `independence` are already gated on `valid`, and `adjudicated` on `f.final` | a `DISAGREEMENT` row automatically carries `label: null`, `sub_reason: null`, `independence: null` |
| 4 | `lib/analysis.mjs` `dispositions` | add `'DISAGREEMENT'` to the reported list | |
| 5 | `lib/analysis.mjs` `exclusion_table` | already emits every non-`VALID` row with `reason`; set `reason = 'RATER_DISAGREEMENT_UNRESOLVED'` | §10.3 and §15.2 require every exclusion to be published |
| 6 | `lib/analysis.mjs` α population | **do not touch.** `'DISAGREEMENT'` must stay out of the AD-1 exclusion list `['INVALID','REFERENCE-CONFLICT','REFERENCE-STALE']` | see §2.3 — this is the one change that would destroy the design |
| 7 | `lib/analysis.mjs` endpoints | **no formula change.** `G1/P1/P2/P3/R1` are all computed from `valid = rows.filter((r) => r.disposition === 'VALID')`, so making `DISAGREEMENT` non-`VALID` restricts every endpoint to agreed observations automatically | the endpoint code is already written for this |
| 8 | `lib/analysis.mjs` condition 2 | code unchanged (`10 * valid.length < 9 * total`), **meaning changed**: disagreements now consume the 90 % VALID budget | the whole cost lives here — see `DISAGREEMENT_COST_ARITHMETIC.md` |
| 9 | `lib/analysis.mjs` condition 3 | code unchanged. `completelyRated` counts non-`pending` pairs, so disagreements do not breach the 90 %-completely-rated clause. α and the `sheet1.rated_by === sheet2.rated_by` check still bite | |
| 10 | new reported fields | `disagreement_count`, `raw_agreement`, and the per-item disagreeing list | §12 already requires "per-label agreement also published"; this extends it |
| 11 | `lib/personnel.mjs` | remove `'rating-adjudicator'` from `INDEPENDENT_ROLES` (six roles, minimum 6 persons) | **this is a §4A amendment, not a tooling tidy-up** — see §5 |
| 12 | `buildRatingAdjudicationPacket` | keep, unchanged, as the **deterministic definition of "disagreeing item"** | reusing it guarantees the two designs never disagree about *what counts as* a disagreement, and it is already verified by rebuilding |

`base.rating_resolution_sha256` is already `resolution ? resolution.resolution_sha256 : null`; no
change. `lib/raterOrder.mjs`'s `'rating-adjudicator'` and `'rating-adjudicator-label-a'` labels, and
`§12.1`/`§12.2` generally, become **vacuous** rather than violated: they specify machinery for an act
that no longer occurs.

### 2.3 The one implementation slip that would be fatal

AD-1 is recorded as `"value": "EXCLUDE_INVALID_CONFLICT_AND_STALE"`, so the α population is
`rows.filter(... && !['INVALID','REFERENCE-CONFLICT','REFERENCE-STALE'].includes(r.disposition))`. It
would look tidy to add `'DISAGREEMENT'` to that list "because it is excluded from scoring". **That
would set α to 1.0 by construction**, because the remaining population is exactly the set of
observations on which the raters agreed. The run would then always clear the ≥ 0.667 floor and the
only reliability measure in the protocol would become a tautology. Any implementation of this design
must keep disagreements inside the α population, and a test must pin it.

### 2.4 Two second-order effects the endpoints inherit for free

- **§15.5(5) SOURCE-COINCIDENT** is `10 * sc > 6 * valid.length`, and `independence` is assigned only
  when `valid`. Excluding disagreements shrinks the denominator, so the 60 % condition becomes
  *easier* to trigger. A run with 6 disagreements out of 60 raises the source-coincident share of the
  scored set unless the disagreements happen to be source-coincident in the same proportion.
- **§15.5(4) registry availability** and the S1–S8 diagnostics are per-company or per-response and are
  unaffected.

---

## 3. Whether two raters suffice — the answer

**Statistically: yes, for everything the protocol uses to judge the rating apparatus.** α, raw
agreement and the completeness share are two-rater statistics and are arithmetically identical with
and without an adjudicator. §12's "Raters | **≥ 2 independent** [NORMATIVE]" and §15.5(3)'s "fewer
than 2 independent raters" are both satisfied by two raters.

**For the endpoints: yes, provided disagreements are handled by the sensitivity design (c), not by
exclusion.** See `DISAGREEMENT_COST_ARITHMETIC.md` and `ALTERNATIVES_RANKED.md`. The headline: under
exclusion the run dies on the §15.5(2) 90 % budget at a disagreement rate of about **8.70 %–10.00 %**
of observations (and lower once any other exclusion exists); under the sensitivity design the
§15.5(2) budget and G1 are barely touched at all, and the binding constraint becomes P1's **absolute
budget of one erroneous fill** at the run's ~30 fills.

**Procedurally, under Protocol-004 as frozen: no.** Two independent obstacles, neither of which is
about statistics:

1. **§4A is [NORMATIVE]** — "## 4A. Study personnel and independence [NORMATIVE; APPROVED CPG-043]" —
   and §4A.3 under it enumerates "rating adjudicator" among the roles and states: "**Every
   independent role is held by a different person, and no independent role is held by the
   operator.** — The seven independent roles are mutually exclusive: **minimum 7 independent
   persons**." It then requires that "The assignment of individuals to the labels `rater-1`,
   `rater-2` and `rating-adjudicator` is recorded in the personnel register, and its SHA-256
   fingerprint is published, **before the held-out commitment transaction is broadcast**".
   `checkPersonnelRegister` enforces this with a blocker.
2. **§15.1's disposition list has no home for an unresolved disagreement** (see §5.2).

So the design requires an amendment either way. The question is not *whether* to amend but *which*
amendment to make, and §5 and `ALTERNATIVES_RANKED.md` answer that.

---

## 4. What is lost by removing the adjudicator

| Lost | Severity | Why |
|---|---|---|
| The tie-break itself: one human's judgement on the hardest items | **High, but unverifiable** | It is real judgement (§1.3), yet it is the one judgement in the rating stage with no second reading and no agreement statistic. Losing it removes an input whose quality was never measured. |
| A single reported point value per endpoint | **High** | §10.5 requires "exactly one" outcome. Under design (c) each endpoint becomes an interval, and the outcome vocabulary must be amended to say what happens when the interval straddles a threshold. That must be INCONCLUSIVE, decided in advance, not the operator's pick. |
| `REFERENCE-AMBIGUOUS` as a *third-party* escape | Medium | Today a disagreement can be resolved by a neutral party declaring the reference insufficient. Without the adjudicator, that declaration can only come from a rater, on their own sheet. |
| The sub-reason of a contested `UNSUPPORTED-FILL`/`INCORRECT-FILL` | Low | `resolveRatingAdjudication` copies the chosen rater's `sub_reason`; with no choice there is none. S3's `CURRENCY_NOT_STATED` / `STALE_VALUE` diagnostic loses the contested items. Diagnostic only (§10.4: "never an acceptance basis"). |
| Nothing at all from α, raw agreement, completeness, §15.5(3), §15.5(4), or S1/S6/S7/S8 | — | Confirmed in code (§1.3). |
| One independent person of headcount, and the §12.2 packet, §12.1 adjudicator order, and the pre-commitment fingerprint of `rating-adjudicator` | — | These are the savings. |

**And one thing is gained.** With the adjudicator, a reader cannot tell whether SUCCESS depended on
one unaudited person's calls. Under design (c) the run reports `outcome_depends_on_disagreements`
explicitly: it states, mechanically, whether any resolution of the contested items could have changed
the reported outcome. That is strictly more information than the adjudicated design publishes.

---

## 5. Does removing the adjudicator break a NORMATIVE clause?

### 5.1 Is the §12 "Rater disagreement" row normative?

Protocol-004 tags normativity inline. Inside the §12 table:

- `| **Raters** | **≥ 2 independent** [NORMATIVE] |`
- `| **Randomisation** | Presentation order is **derived, not seeded** (§12.1) [NORMATIVE; APPROVED CPG-043] |`
- `| **Agreement** | Krippendorff's α, **nominal**, **≥ 0.667** [NORMATIVE — Krippendorff's own floor for tentative conclusions]; per-label agreement also published |`

The row in question carries **no tag**:

> | **Rater disagreement** | Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of §12.2; adjudicated values are flagged |

Neither does the row beside it:

> | **Missing ratings** | `pending` — never imputed, never scored |

**On the document's own tagging convention the "Rater disagreement" row is not marked normative.**
That is a narrow and, on its own, weak result: the row is untagged, and §12.2 — the machinery it
points at — *is* tagged "[NORMATIVE; APPROVED CPG-043]". But §12.2 specifies what the packet contains,
not that a packet must exist; it is vacuous if no adjudication occurs.

### 5.2 The clause that does break — and the coordinator's §15.1/§15.2 reading

**§4A.3 breaks.** §4A is headed "[NORMATIVE; APPROVED CPG-043]" and §4A.3 falls under it. It names
the rating adjudicator in the role list, asserts "**minimum 7 independent persons**", and requires the
`rating-adjudicator` label to be fingerprinted before the held-out commitment. A six-person design
contradicts all three, and `checkPersonnelRegister` refuses the register. **This, not the §12 table
row, is the normative obstacle.**

**On §15.1/§15.2 I agree with the coordinator, and would put it slightly more sharply.** §15.1 reads,
in full:

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS`
> and `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (observation remains VALID in the
> primary analysis; §5.3). `INCONCLUSIVE` is **run-level only**.

and §15.2's first row reads:

> | Scored into a §10.1 label from sealed reference truth | VALID |

There is no disposition for "the raters disagreed", and every exclusion in the list is
reference-driven (`REFERENCE-CONFLICT`, `REFERENCE-AMBIGUOUS`, `REFERENCE-STALE`) or `INVALID` (no
response, harness error, post-draw inadmissibility). **So design (a) — exclude disagreements — is not
available under the frozen text; it requires an amendment creating a new exclusion disposition, and
that disposition then consumes the same §15.5(2) 90 % budget.** I agree, and I have priced it on that
basis.

The sharper point is that the frozen text has no disposition for an unadjudicated disagreement in
*either* direction. Under the adjudicated design the observation *is* "scored into a §10.1 label"
(the adjudicator's choice), so it is `VALID`. Remove the adjudicator and the observation is neither
scored nor excluded by any listed rule — **§15 simply assumes adjudication always happens.** That is
why every option here, including (b) and (c), needs *some* amendment. The options differ in which
amendment:

- **(a)** needs a **new exclusion disposition** → consumes the §15.5(2) budget.
- **(b)** needs nothing new in §15: a rule-chosen label is still one of the raters' §10.1 labels
  derived from sealed reference truth, so the observation is `VALID` under §15.2's existing first
  row. **(b) fits the frozen disposition vocabulary best of the four.** Its problem is elsewhere
  (`ALTERNATIVES_RANKED.md` §2).
- **(c)** keeps every observation `VALID`-eligible and so also needs no new disposition, but needs a
  **reporting amendment**: §10.5 requires "exactly one" outcome, and an interval that straddles a
  threshold is not one outcome until the protocol says which it is.
- **(d)** needs a §4A/§12 amendment on independence and blinding, which is the least defensible place
  to amend.

**I also confirm the coordinator's §15.5(3) point.** §15.5(3) is "Nominal α < 0.667, fewer than 2
independent raters, or < 90% of observations completely rated [NORMATIVE]". In code,
`completelyRated` tests only for `pending`, so a disagreement *is* completely rated and the
completeness clause is untouched. Only α and any newly created exclusion disposition bite.

### 5.3 The "If independent raters are unavailable" paragraph and the Rung-2 ceiling

Quoted in full from §12:

> **If independent raters are unavailable:** execution may occur, but every primary endpoint is
> labelled **UNADJUDICATED**, **the evidence rung cannot exceed Rung 2**, and **no claim of
> independent validation may be made.** The protocol is not weakened to accommodate unavailability.

Its trigger is the unavailability of *independent raters*. A two-rater design **has** independent
raters: it satisfies the "≥ 2 independent [NORMATIVE]" row and §15.5(3)'s rater-count clause. **So on
its face this paragraph does not apply, and it grants no authority for a no-adjudicator design.**

Two readings of its bearing, both of which I record because they point the same way:

1. **Narrow.** It does not apply; the design stands or falls on §4A.3. The Rung-2 ceiling is not
   engaged, and a two-rater run would not automatically be capped at Rung 2 by this paragraph.
2. **Purposive.** Its final sentence — "The protocol is not weakened to accommodate unavailability."
   — is a general anti-erosion rule. Dropping the seventh person *because he cannot be found* is
   precisely accommodating unavailability by weakening. On this reading the paragraph is an argument
   **against** justifying the design by scarcity.

**Where the ceiling does have a bearing: as the protocol's own template for the price of a thinner
human apparatus.** The paragraph shows what Protocol-004 does when the rating apparatus is weaker
than designed: it does not relax a threshold, it **labels the output and caps the rung**. That is the
natural shape of the amendment — endpoints labelled `UNADJUDICATED`, evidence rung capped at Rung 2,
no claim of independent validation — and it can be written in the protocol's existing vocabulary
without inventing anything. §14 records that of R1–R5 replication levels "**None has occurred**", so a
Rung-2 ceiling costs nothing that has already been earned.

**Bottom line for §5.** Removing the adjudicator breaks §4A ([NORMATIVE]), not the §12 table row, and
leaves §15.1's disposition list without a rule for the contested observation. It is therefore an
amendment, not an interpretation, and the honest form of that amendment is: adopt design (c), keep the
observation `VALID`-eligible, report intervals, assert SUCCESS only on the unfavourable bound, publish
α / raw agreement / the disagreement list, label endpoints `UNADJUDICATED`, and cap the evidence rung
at Rung 2.

---

## 6. Prototype

`prototype/twoRaterRating.mjs` (PROPOSAL, not registered, not part of the instrument) implements the
classification and the design-(c) bounds; `prototype/test_twoRaterRating.mjs` and
`prototype/mutate.mjs` are the suite and the mutation harness; `prototype/costArithmetic.mjs` derives
the cost table from the frozen sizing rule. Results are in `DISAGREEMENT_COST_ARITHMETIC.md` §5 and
the task report. The prototype never reads the software's output: `classify` takes the observation
grid and two label sheets, and a test injects `cpg_value` / `cpg_source_urls` / `reference_record`
into every input and proves the output is byte-identical.

One stated boundary: `lib/ratings.mjs` `checkRating` already refuses a fill label where the software
returned nothing and an abstention label where it returned a value, so a disagreement can never
straddle the fill/abstention boundary (`REFERENCE-AMBIGUOUS` is the only label admissible on both
sides). That check needs the software's output, so it stays at ingest and the prototype does not
re-perform it. The prototype's bounds are therefore **sound but not tight** for label pairs the ingest
would have refused — which is the safe direction.

---

## 7. Open questions for the owner

1. **Is the seventh person unavailable, or merely expensive?** If merely expensive, §5.3's purposive
   reading says do not amend.
2. **Which amendment?** (b) fits §15's existing dispositions; (c) is epistemically stronger but needs
   §10.5 to define the straddling outcome. They are not mutually exclusive: (c) can be the reported
   analysis with (b)'s per-endpoint choice *being* its unfavourable branch.
3. **When the sensitivity interval straddles a threshold, is the outcome INCONCLUSIVE?** This must be
   recorded as a new AD-class decision **before** registration, with the same discipline as AD-1..AD-9,
   or it becomes an operator's discretion exercised after seeing results.
4. **Are endpoints labelled `UNADJUDICATED` and the evidence rung capped at Rung 2?** §5.3 argues yes.
5. **Does the α population keep disagreements?** §2.3 — must be yes, and must be pinned by a test.
6. **Is the shrunken §15.5(5) denominator acceptable?** §2.4 — the 60 % SOURCE-COINCIDENT condition
   becomes easier to trigger under design (a); under (c) it does not.

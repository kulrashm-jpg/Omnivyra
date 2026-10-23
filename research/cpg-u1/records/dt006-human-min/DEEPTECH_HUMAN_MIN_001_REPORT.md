# DEEPTECH-HUMAN-MIN-001 — can U1 run on two independent humans?

**Status: METHODOLOGY REVIEW. Nothing registered, committed, pushed or executed. No frozen byte changed.**
Protocol-004 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` and the instrument aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) were re-verified unchanged after all
eight analyses. `origin/main` = `af2fb6e99ce461894bf16f18c2251f75088eba18`.

Eight concurrent analyses (A role minimisation, B reference truth, C rating, D enumeration, E independence,
F statistics, G amendment, H timeline) in disposable worktrees; 70 artefacts preserved to `C:/tmp/dt006-human-min/`.

---

## 1. Executive result

**Two independent humans cannot run U1 while preserving its evidentiary strength. The request's two goals are
incompatible, and the incompatibility is not a matter of degree.**

Three findings decide it, each verified in the frozen text or the frozen code:

1. **The protocol states the opposite explicitly.** §4A.3: "The seven independent roles are mutually exclusive:
   **minimum 7 independent persons**." This is `[NORMATIVE]` and is enforced in code — `checkPersonnelRegister`
   rejects any register where one `person_id` holds two roles. A two-human design is not an interpretation; it is a
   new frozen protocol version.
2. **The evidence rung falls to 2 and the independent-validation claim is forfeited — and it does not come back at
   three, four or five people.** §12's ceiling paragraph is triggered by raters being *unavailable*, which is not the
   case here; but in any design below seven, both raters necessarily hold reference roles and therefore fail §12's own
   Eligibility row ("must hold no other §4A.3 role"). Their ratings are not the independent ratings §12 contemplates.
   §12's closing sentence — "**The protocol is not weakened to accommodate unavailability**" — forbids drafting around
   it. So a reduced-headcount U1 must declare **endpoints UNADJUDICATED, evidence rung ≤ 2, no claim of independent
   validation, in every outcome including SUCCESS.** The ceiling lifts only near seven.
3. **It buys almost no time, which removes the motive.** Every blind-pair phase is *already* an exactly-two-worker
   phase in which each worker does 100% of the rows (`reconcile` refuses `author === confirmer`; `ratings` refuses two
   sheets with the same `rated_by`). Cutting headcount removes adjudicators, not throughput. **No phase shortens.** The
   only saving is recruitment search, 0.29–3.43 weeks.

**The recommendation is the opposite of the request.** Keep seven and **add an eighth person as a second enumerator**
— §4A.3 already permits several enumerators ("Several enumerators are permitted; each holds no other role"). That
captures 2.63–2.92 weeks post-recruitment, with the protocol unchanged, no amendment, no re-freeze and zero
independence cost. It is the only free saving found anywhere in this programme.

If the owner's real constraint is that seven independent people cannot be recruited, the honest options are to accept
Rung ≤ 2 explicitly and publish it, or not to run U1 yet. Both are defensible. Presenting a reduced-headcount run as
independent validation would not be.

---

## 2. The current seven-role model

Roles (§4A.3): operator (key custodian, **not** independent, holds no independent role) · enumerator (≥ 1) ·
reference Author · reference Confirmer · reference adjudicator · rater 1 · rater 2 · rating adjudicator.

The evidence chain is serial and cannot be parallelised:

```
OSF registration → registered frame → contamination scan → frame sufficiency → development commitment →
randomness → draw → pilot → held-out sizing → commitment → randomness → draw → reference truth (both stages) →
reference adjudication → seal → single authorised execution → blind rating → rating adjudication → analysis
```

Independence is defended by §4A.1 (exclusion period, signed declarations, the developing organisation's written
confirmation; "An unknown answer is not 'no'"), §4A.2 (enumerator eligibility), and §4A.3 (mutual exclusion).
§4A.1 item 6 is *relational* — it excludes partners, family, household members and reporting relationships between
role-holders, so a roster drawn from one team or household fails it while satisfying the distinctness rule. **No tool
detects that**, which is a pre-existing gap independent of this task.

---

## 3. The two-human model that was analysed

The strongest construction found (Agent A's "Model E", as modified by the other analyses):

| Function | Who | Mechanism |
|---|---|---|
| Frame | no human | hash-pinned public register snapshots; admissibility from register-only fields under §5.1 tri-state; membership by the existing §5.7.1 rank key on chain + drand; snapshot and predicate digests in the registration |
| Reference truth (both stages) | **H-A = Author, H-B = Confirmer** | unchanged — `reconcile`, `agreementKey`, `seal` untouched |
| Reference adjudication | no human | §9.4 authority-tier dominance; residual same-tier ties → `REFERENCE-CONFLICT` |
| Rating branches 1/3/4 + temporal rule | no human | already mechanical or pinned arithmetic |
| Rating branch 2 (entity attribution) + REFERENCE-AMBIGUOUS | **H-A and H-B independently** | the only human judgement in the scoring path |
| Rating adjudication | no human | pre-registered two-sided sensitivity bound (§12.4) |

Two variants were considered and **both rejected on analysis**:

- **Machine-generated reference truth — rejected as circular.** The extractor would be the developing organisation's
  own software producing the values by which its product is judged, while `constructed_without_cpg`
  (`schema.mjs:257`) would still read `'yes'` — the artefact would attest to the property it violates. §9.1's Author
  row forbids the human equivalent.
- **Folding enumeration into the two humans — rejected as dominated.** §4A.2(b)'s bar is temporal ("before completing
  the frame"), so the ordering works. But the class prediction would flow from the enumerator's memory into a
  labelling role, and §9.2.1/§12.2 exclude the class from both packets precisely so it cannot act. It saves exactly
  what elimination saves (7 → 6) and is strictly worse methodologically. **Blinding a packet cannot blind a memory.**

---

## 4. Role-elimination table

| Role | What it protects | Can machine enforcement replace it | Cost | Human required |
|---|---|---|---|---|
| **Operator** | — (not independent) | n/a | n/a | yes, unavoidable — key custody, funding, the single run |
| **Enumerator** | selection-set unbiasedness (§20.18, §22 #31, §23) — a property commitment does **not** protect | **Partly.** A derivation `frame = D(snapshot, predicates)` converts §22 #31 from an unauditable declaration into a recomputable function. It does **not** establish unbiasedness: someone still chooses source, pin instant and predicates. Discretion is compressed and published (≥ 3 150 private cell-decisions → 41 published predicate leaves + 1 source + 1 instant), not eliminated | `abstention-expected` 52 requires the *absence* of documentation, which a presence-based snapshot cannot establish — and that is the class P2 is computed over | **No**, if a source and predicates are pre-registered |
| **Reference Author** | first independent observation | No — irreducible judgement (§9.4's tiers are unstructured documents; §9.3 requires discriminating a stated actual from a target/projection/run-rate/estimate) | — | **YES** |
| **Reference Confirmer** | second independent observation; the only in-study detector of transcription error | No — a deterministic second pass gives α = 1, which attests to determinism, not correctness | — | **YES** |
| **Reference adjudicator** | recovers disagreements into the scored set | **Yes, cheaply.** `REFERENCE-CONFLICT` already exists in §15.1 with the needed semantics; only the routing in `reconcile.mjs:58` must change | coverage, against a 6-of-60 budget | No |
| **Rater 1** | scoring judgement + one half of α | No — attribution (§10.1 branch 2) is irreducible and carries P3's zero threshold | — | **YES** |
| **Rater 2** | second scoring judgement + the other half of α | No — mechanically enforced in two places | — | **YES** |
| **Rating adjudicator** | resolves rating disagreements | **Yes, but expensively.** §15.1 has **no** disposition for "the raters disagreed" and `ratings.mjs:136` throws with nothing to fall through to. Requires a §12.4 deterministic rule plus a flag | the outcome ladder's semantics change and must be declared | No |

**Correction to a claim both Agent A and I first made:** adjudicators are *not* purely coverage instruments. The
rating adjudicator may assign `REFERENCE-AMBIGUOUS` even when neither rater gave it (`packets.mjs:109`), and the
choice between two labels is worth up to log₂3 ≈ 1.585 bits. With ~30 expected fills and P1 tolerating exactly one
erroneous fill, a single adjudicated choice can decide SUCCESS versus FAILURE.

---

## 5. Reference truth

**Two humans suffice for reference truth itself** — double entry *is* a two-person structure (§9.1: the Author must
not "communicate with the Confirmer before both have submitted"; the Confirmer must not "see the Author's record
before submitting"). The pressure above two comes from adjudication and role exclusivity, not from double entry.

**One human does not suffice**, for a specific reason. §9's double entry defends three failures, unequally
substitutable: transcription error (**not** substitutable — `VALUE_FORMAT` accepts any four-digit year, so `3682` vs
`3862` is a full disagreement today and the second observer is the only detector); single-source error (partly
substitutable by `AUTHORITY`, which already refuses AGGREGATOR/PRESS/ENCYCLOPAEDIA/JOB_BOARD); and motivated or lazy
reading (**not substitutable at all** — `NOT_AVAILABLE_FROM_SOURCE` is a claim about a *search*, evidenced only by a
free-text `search_note`, with no URL to re-fetch). **P2, threshold 0.90, is built on exactly those records.**

**Removing the reference adjudicator is the cheap elimination**, but it is not free: §9.5 says a difference "**Must**
be adjudicated", and `REFERENCE-CONFLICT` is one of three outcomes an adjudicator *declares*, not a fall-through.
Today `reconcile.mjs:58` makes an unadjudicated difference a **hard refusal**.

Defensible replacement rules, assessed for whether they read anything from CPG (which would be circular):

- **More recent `as_of_date`, for `employee_count`/`revenue_range` only — strongest.** §10.2 already *defines*
  reference truth as "the most recent authoritative value" for exactly those fields, so applying it completes a
  definition rather than resolving a dispute. Must abstain on `founded_year`, on ties, and on any pair involving
  `NOT_AVAILABLE_FROM_SOURCE` — otherwise a fresher *absence* defeats an older stated value, turning a positive into
  a missing.
- **Tier 1 over Tier 2 — defensible but narrow.** §9.4 is frozen, per-field and already executable. Cost: double
  entry collapses to single entry on the items it fires, and that count must be published.
- **A round-2 re-observation by the same two people — recommended first step.** It reduces disagreement before any
  exclusion rule fires, needs no new normative content, and attacks transcription error directly.
- **Rejected: any rule preferring a `value_kind`** (no grounding in §9.4 or §10.2; preferring STATED is
  missing→positive by construction) **and any "less favourable to the claim" rule** (definable only relative to CPG's
  output, so it cannot be evaluated before execution — §9.6 would have nothing to seal).

Engineering constraint: §9.6 — `seal` refuses any reference file not byte-identical to `reconcile`'s output — so any
new rule must live **inside** `reconcile`. A side-car resolver can never be sealed.

---

## 6. Rating

**Statistically, two raters suffice and always did.** α, raw agreement and the completely-rated share are computed on
the raters' **own** labels (`analysis.mjs:181` pairs `rater_1_label`/`rater_2_label`, never `resolution`), so
adjudication cannot change α. It is the one quantity the adjudicator never protected.

**Two distinct raters is an enforced floor, not a documented one** — `ratings.mjs:97` and `analysis.mjs` condition 3
(`sheet1.rated_by === sheet2.rated_by`) both refuse one person rating both sheets, and `ratings.mjs:98` refuses an
adjudicator who is either rater. So "two humans, one of whom adjudicates" is refused *by name*.

**My own proposed replacement rule was unsound and has been withdrawn.** I suggested a total order over the seven
labels, taking the label less favourable to the claim. The pair `{UNSUPPORTED-FILL, REFERENCE-AMBIGUOUS}` has no
conservative direction: UNSUPPORTED-FILL adds an erroneous fill (hurting P1) but adds a fill (helping G1 and
§15.5(2)), while REFERENCE-AMBIGUOUS is excluded from every denominator, so it helps P1 and hurts G1. No single
ordering is conservative for all endpoints, so an ordering can inflate SUCCESS in either orientation.

**The correct replacement is the two-sided sensitivity bound.** Because every §10.3 threshold is an integer *linear*
inequality, the exact extremum over all 2^D resolutions is reached by extremising each disagreement independently, per
endpoint — no ordering needed. Compute each endpoint twice and require the **unfavourable** bound to pass. Proven and
tested: if the unfavourable bound passes, **all** 2^D resolutions pass; if the favourable bound fails, **none** does.
It excludes nothing, so it spends neither the §15.5(2) budget nor G1, and it makes no choice, so it cannot be steered.
It needs a §10.5 **reporting** amendment, not a new disposition.

**The price is severe, not mild.** For P1 the unfavourable bound tolerates at most **one** contested possible-bad fill
— zero if an agreed bad fill already exists. For P3 it tolerates **zero** contested possible-misattributions, because
one such observation both fails P3 and satisfies FALSIFIED.

**An implementation trap that must be pinned by a test:** adding `'DISAGREEMENT'` to AD-1's exclusion list would set
**α = 1.0 by construction**, since the surviving population would be exactly the agreements. The study's only
reliability measure would become a tautology while still reading green.

**Textual note:** in the §12 table the "Rater disagreement — resolved by the rating adjudicator" row carries **no
`[NORMATIVE]` tag**, unlike the Raters, Randomisation and Agreement rows beside it. That row is therefore not the
normative obstacle; §4A is.

---

## 7. Enumeration

**The enumerator protects a property the commitment scheme does not.** A commitment binds `sha256(F)` before the
randomness block exists, establishing only that *given F*, nobody chose the draw. It says nothing about how F was
authored — a violation that occurs *before* the commitment. The protocol says so itself in §20.18, §22 #31
("UNRESOLVED by sampling integrity") and §23's "Two claims, never merged".

Of the four manipulations, two are fully unprotected today: cherry-picking an easy population (publication makes it
*visible, not falsifiable* — there is no pre-registered comparison population and no outsider can run CPG to score
easiness) and choosing a flattering sector mix (**sector is not a protocol concept at all** — no column, no stratum,
no quota, unpublished and unauditable).

**The decisive finding, and the sharpest of the wave: an independent enumerator cannot honestly answer the
contamination criteria either.** §5.3 states "For every contamination attestation, `unknown` is treated exactly like
`yes`. An unestablished contamination question makes a company ineligible [enforced]." But C1(2)–C1(5) ask about the
*implementers'* own history — whether a company was used in developing CPG, whether values derive from CPG output,
whether CPG was ever run on it, whether it is the implementers' own entity. Someone who has never seen CPG **must**
write `unknown`, which makes every company ineligible and renders §5.7.2 unsatisfiable. The only way they write `no`
is if the organisation discloses its history — and that disclosure *is* the frozen development-only registry, which
§4A.2 hands them. **Those cells already carry operator knowledge under an independent signature.**

Mechanising the frame is therefore a genuine *upgrade* on §22 #31 (from declaration to recomputable function) while
being honest that authorship discretion survives. The binding obstacle is not circularity but **feasibility**:
`abstention-expected` 52 requires the *absence* of documentation, which a presence-based snapshot cannot establish.
Whether ≥ 210 rows (126/52/32) survive register-only screening across the four jurisdiction families is
**UNVERIFIED** and was correctly out of scope.

A baseline coupling already exists and is not caused by mechanisation: §5.1 A3 admits only CIK/SIREN/CNPJ/LEI and
§9.4 makes REGISTRY_RECORD/REGULATORY_FILING the Tier 1 authorities, so every U1 frame is already tied to the
registries CPG resolves.

---

## 8. Independence and information flow

All **28** role pairs (7 independent roles + operator) are **FORBIDDEN-BY-TEXT** — none is merely implied. §4A.3's
sentence is a universal quantifier; the named special cases restate three of those pairs with reasons.

**The obvious contamination objection to a reference observer later rating is wrong, and this matters.** §12's rater
packet already contains "the sealed reference record", and `checkItem` (`raterPackets.mjs:60`) requires it to be
*exactly* the sealed row. So a reference observer who later rates learns **nothing they would not have received
anyway**. Leakage is not the objection.

The real objection is motivational and narrow. §10.1 is mostly forced; discretion lives in three places —
attributability, REFERENCE-AMBIGUOUS, and staleness. Self-consistency bias means suppressing the latter two. Of six
discretion cells, **three run against SUCCESS** (including both P1-numerator cells) — the cells where CPG and the
reference disagree, which carry the large mass — two run toward it, one is neutral. **So a SUCCESS under this overlap
is not inflated by it; a FAILURE or FALSIFIED under it is confounded.** That is a reason not to fear an inflated
SUCCESS, not a safety argument for the merge.

**A forward-only ordering does not rescue the design.** Four backward edges survive, and the two worst bias *toward*
SUCCESS: frame composition anticipating the same person's later workload pushes toward easy-to-look-up companies,
which is exactly where grounding performs best (anticipation runs backwards through time; no ordering rule reaches
it); and **joint enumeration destroys the Author/Confirmer blind before it starts** — two people who built one frame
have already agreed on every company's identity resolution and class prediction by design, so their later
"independent" records are two draws from a shared, self-authored prior, and §9.5 makes `AGREED` unoverridable.

A cleanly mechanical statement of why ordering is *necessary but not sufficient*: `personnel.mjs` requires
`ran_or_saw_cpg_output = "no"` for **all** roles, while §4A.2(b) scopes it to "before completing the frame". A rater
necessarily sees CPG output, so **any reference role performed after any rating role is unrepresentable in a truthful
register.**

**α stops being a reliability coefficient.** On agreed rows — the majority — two ex-recorders have the same stake and
suppress the same discretion, so correlated suppression *raises* α. Beyond that, α presupposes coders exchangeable
with a population of competent coders; two people who built the coding material are not. No tooling detects this:
`analyze` computes α correctly and cannot know the authors shared a prior, and `ratings.mjs:97` checks string
distinctness, never independence. **§15.5(3) makes α < 0.667 INCONCLUSIVE, so the merge makes a guard easier to pass
— the artefact goes green and the gate stops gating.** Design rule: **α holds its meaning only if at least one rater
holds no reference role.**

The characteristic harm is not refusal but **silent semantic drift**: `check-personnel`, `verify-adjudication-packet`,
`verify-rater-packet` and `analyze` all keep exiting 0 on a design whose human controls have collapsed, and **no
published artefact differs.**

---

## 9. Statistical consequences

**The observation budget** (13 reachable configurations, not 49 — `fe` is the image of `min(60, max(12, ceil(180/T)))`
over integer pilot totals `T ∈ 1..18`, giving {12,13,14,15,17,18,20,23,26,30,36,45,60}):

| | floor | tightest | cap |
|---|---|---|---|
| companies / observations | 20 / 60 | 23 / 69 | 100 / 300 |
| reference records **per recorder** (both stages) | 90 | 99 | 330 |
| max excluded (§15.5(2)) | 6 (10.00%) | **6 (8.70%)** | 30 (10.00%) |

Exactly 90% **passes** — `analysis.mjs:198` is `10 * valid < 9 * total`, strictly.

**The binding constraint is a count of ONE, not a rate.** Without adjudicators, `reconcile.mjs:58` errors on the
*first* Author/Confirmer difference and `cmdReconcile` exits 1 — no reference file, nothing to seal — and
`finalRatings` throws `RATING_ADJUDICATION_MISSING` on the first rater disagreement, so no analysis runs. And
`REFERENCE-CONFLICT` is reachable **only** when an adjudicator actively declares it (`reconcile.mjs:65`), so removing
the role removes the ability to *declare* a conflict, not merely to resolve one. **A two-human design with the
adjudicators simply deleted requires perfect agreement across 90–330 reference records and 60–300 rating items.**

Once resolution rules are substituted, the ordering of constraints is:

| Handling | Budget spent | Ceiling |
|---|---|---|
| disagreements **excluded** (needs a disposition §15.1 lacks) | the §15.5(2) 10%, **shared** with INVALID / REFERENCE-CONFLICT / REFERENCE-STALE / REFERENCE-AMBIGUOUS / PENDING | 6 of 60 at the floor |
| disagreements **resolved by rule** (observation stays VALID) | none | α only |

**α is more fragile than its threshold suggests.** Computed against the frozen `alphaNominal`/`alphaBelow`: with an
otherwise-unanimous set, **one** disagreement gives **α = 0** (units=60: num=238, den=238) — the skewed-marginal
pathology. Full unanimity makes α **undefined**, which the recorded AD-2 = INCONCLUSIVE turns into an INCONCLUSIVE
run: **perfect agreement is fatal.** Tolerance by label spread (share of agreements on the majority label): 50% →
16.7%, 80% → 11.7%, 90% → 6.7%, 95% → 3.3%, 100% → **none**.

**The class quotas are what keep α usable** — a previously unstated dependency. At the quota-derived label mix the
majority share is 40.9%–60.0%, in the tolerant band, so α tolerates 16.7%–21.8% and **§15.5(2) binds first at every
permitted configuration.** Collapse the mix onto two labels — which §9.7 explicitly anticipates — and α's tolerance
falls below the exclusion budget, flipping which constraint binds.

**Pre-existing hazards surfaced, independent of the human question:** `T ≤ 2` configurations already fail G1 at zero
human error (expected fills 10 < 20 at T=1); the sizing rule cannot grow to absorb exclusions (it is a function of the
pilot alone, with no exclusion term); and each exclusion lowers the tolerated SOURCE-COINCIDENT count by 0.6
observations, so exclusions can trigger §15.5(5) with no change in coincidence at all.

---

## 10. Protocol clauses affected — A / B / C / D

**A = 18 · B = 3 · C = 18 · D = 11** across 50 quoted rows (full table in `G-amendment/CLAUSE_IMPACT_TABLE.md`).

**The eleven class-D clauses — changes that cannot be made without losing evidentiary strength:**

1. §4A.3 "Every independent role is held by a different person…"
2. §4A.3 "minimum 7 independent persons"
3. §4A.3 "Several enumerators are permitted; each holds no other role"
4. §4A.2(d) "hold no other §4A.3 role"
5. §9.2 "They never receive … the class prediction" — unfixable; the knowledge is in-head
6. §12 Eligibility "must hold no other §4A.3 role" — both raters would author the reference truth they score
7. §19.3(3) "Seven mutually exclusive independent persons"
8. §22 #34 goes PREVENTED → **UNRESOLVED**, and the control it names is `check-personnel`, the very thing that
   refuses the design
9. §23's collusion mitigation "Role assignment" ceases to exist
10. §23 claim (2) "independent candidate selection — the frame is unbiased" becomes unsupported.
    **Claim (1), cryptographic sampling integrity, survives completely intact**
11. **The Rung ceiling** (§12 + §20.8 + §14) — endpoints UNADJUDICATED, rung ≤ 2, no independent-validation claim

Class A confirmations worth recording: §9.5's unoverridable `AGREED`, §12.1's derived presentation order, and
§15.5(3)'s "fewer than 2 independent raters" all survive untouched.

---

## 11. Human counts

| | Count | Basis |
|---|---|---|
| **Current** | **7** independent + operator = 8 | §4A.3, enforced by `checkPersonnelRegister` |
| **Enforced pairwise floor** | **2** | only two machine checks are substantive: `author ≠ confirmer` (`reconcile.mjs:52`) and `rater-1 ≠ rater-2` (`ratings.mjs:97`). One human is refused in three independent places |
| **Theoretical minimum preserving α's meaning** | **3** | α requires at least one rater holding no reference role. With two people both holding reference roles, no unprimed rater exists. Reached as Author + Confirmer + one unprimed rater, the second rater drawn from the reference pair |
| **Minimum with all seven roles retained** | **4**, or **5** to keep both α's meaning and the enumerator's separation from rating | computed census over canonical partitions: k=4 → 24 partitions with no disqualifying pair but **0** satisfying both side conditions; k=5 → 12 |
| **Proposed ≤ 2** | **not defensible** | fails on §12 Eligibility, on α's meaning, and on the Rung ceiling |
| **Recommended** | **8** (7 + a second enumerator) | §4A.3 already permits it; no amendment, no re-freeze |

The apparent disagreement between the analyses resolves cleanly: those computing a floor of 4–5 were partitioning
**all seven roles** (where adjudicators are third parties by construction), while the two-human proposal **deletes**
five roles. Applying the α side condition to the reduced design gives **three**, and even three still sits under the
Rung ceiling.

---

## 12. Timeline, before and after

Post-recruitment elapsed weeks (baseline assumptions; every time-per-row figure is an **assumption**, not a measurement):

| Phase | 7-human | 8-human (2 enumerators) | 2-human |
|---|---|---|---|
| enumeration | 5.83 | 2.92 | 2.92 |
| reference truth (both stages) | 6.88 | 6.88 | 6.88 |
| reference adjudication | 0.83 | 0.83 | **BLOCKED** |
| rating | 1.11 | 1.11 | 1.11 |
| rating adjudication | 0.40 | 0.40 | **BLOCKED** |
| **total at cap** | **15.41** | **12.50** | never completes |
| **total at floor** | **8.60** | **5.69** | never completes |

**No phase lengthens and none shortens** — the blind-pair phases are already exactly-two-worker phases. Even granting
a future version that permitted self-adjudication, the two-human counterfactual is 12.50 weeks at the cap, *identical*
to three-human and to eight-human: **self-adjudication buys 0.00 weeks.** The 2.92-week advantage attributed to a
small team is not a headcount effect at all — it is the second enumerator, available today at seven.

Irreducible serial delay, headcount-independent: **61.5 h ≈ 2.56 days** at the cap, of which ~78% is the two registry
publication latencies; the drand Δ rule (5.17 h per stage) binds, not block depth.

**The prior "≈ 9–13 weeks after registration" figure is corrected to 8.6–15.4 weeks post-recruitment,
configuration-dependent** — and 15.4 is the figure to plan against, because the capped configurations arise exactly
when CPG performs *badly* in the pilot. Sweeping productive hours per day (2–8) widens this to 7.9–30.5 weeks, a
fourfold range; no single point estimate is defensible.

---

## 13. Risks

**Introduced by a reduced-headcount design:** α silently inflated and no longer a reliability coefficient, with the
gate still passing · the class-prediction channel that no packet can blind · frame-composition anticipation biasing
*toward* SUCCESS · fewer independent participants means fewer potential whistleblowers, and nothing detects a
violation automatically · the heaviest person's load rises to 1.71× the seven-human peak across four roles, while
timestamps are only **day-granular**, so 330 records in two evenings is indistinguishable from careful work · every
artefact pinned to `f7699f05…` is invalidated, including the two human packets.

**Removed:** the reference and rating adjudicators' single-point-of-judgement problem — every item reaching an
adjudicator is one on which two qualified people split, and it is then decided by **one** person with no second
reading and no agreement statistic. The rating stage currently applies its strongest reliability machinery to the
easy items and its weakest to the hard ones.

**Eleven head-count-independent defects surfaced, which matter regardless of this decision:**

1. **§6.5's "reading" limb, read strictly, voids every study.** It prohibits "any reading of stored CPG output" for a
   frame company by study personnel, with the held-out window being "before the authorised run starts, **or after it
   completes**" — which catches the entire rating stage, the archive and the published response set. "The study is
   VOID, not flagged." Needs an explicit carve-out.
2. **`reconcile` and `seal` have no named runner**, while §18.3 halts on "the operator having seen reference truth —
   void, not repaired". The protocol forbids the outcome and leaves the step unassigned.
3. A sixth disposition `PENDING` exists in code (`analysis.mjs:150`) and not in §15.1, and it spends the budget.
4. `REFERENCE-CONFLICT` rows publish the **Author's** value as the established one (`src` is never reassigned).
5. Conflicts manufacture permanent false §9.7 class-prediction mismatches, which §9.7 forbids correcting.
6. `T ≤ 2` configurations fail G1 at zero human error.
7. The rater packet leaks the reference team's pseudonyms and each row's contest status.
8. §12.2 over-claims that the adjudicator "never receives the number of disagreements" — the packet *is* that list.
9. §4A.1 item 6's relational exclusions are unenforceable and no tool detects them.
10. `.gitignore:77` (`ROLE_*.md`) silently ignores a mandated deliverable — the third instance of this class.
11. Two prior documents misstate the frame header as 23 columns; `FRAME_COLUMNS.length === 22`. And
    `workload_scheduler.mjs` understates reference load by 30 records per recorder, because reference covers both stages.

---

## 14. Tests required

Executed in this wave (real counts, all re-run by me): reference resolver **73/73**, 28 mutants **28 killed**; rating
prototype **98/98** with 8 035 enumerated resolutions, 70 mutants **70 killed**; frame derivation **58/58**, 24
mutants **24 killed**; exclusion-matrix census reproduced exactly. Two agents reported honest first-pass survivors
(27/28 and 18/24) and closed them by adding coverage or removing dead code rather than excusing them.

Required before any real re-freeze and **not run**: the full 389-anchor mutation suite and the adapter conformance
run. New personnel and reconciliation guards are worthless unkilled.

Must be pinned by new tests: that `DISAGREEMENT` never enters the α population (α = 1.0 trap); that the unfavourable
bound is never better than the favourable one; that no resolution path consults CPG's output; that a conflict cannot
silently become consensus; and that a missing row is never read as an abstention.

---

## 15. Exact protocol amendments

Drafted as a **PROPOSED** new version (`G-amendment/PROPOSED_AMENDMENT_TWO_HUMAN.md`), never applied.

**This is not an amendment at all — it is a new frozen version.** §6.2: a rule may change "except by a new protocol
version as a new file". §7.1: "A study of a later resolver is a new protocol version and a new registration." Because
nothing is registered yet, **no identity binding is broken by creating one — and this is the only window.** After
registration every sampling command aborts on a hash mismatch; re-registering is study VOID because both hashes sit in
`SAMPLING_FIELDS`; after the development commitment the aggregate is inside the OP_RETURN digest.

**A new version cannot give itself the governance it needs.** CPG-042 A-1…A-6 are recorded owner approvals (§19.2),
and a reduced-headcount design partially reverses them. **A fresh owner approval is required first.**

**Re-freeze cost, measured on a scratch copy that first reproduced `f7699f05…` exactly:**

- protocol text changed, version literal kept → protocol sha moves, aggregate **unchanged**;
- protocol renamed to `_005`, tooling untouched → `ERROR: protocol does not state: CPG_U1_PROTOCOL_004`, exit 1;
- **one line in one file** (`lib/registration.mjs:9`) → aggregate `f7699f05…` → `ca976f1a…`, and **the selftest goes
  RED (1021 passed, 2 failed)**, because the version literal is **duplicated in the test fixture**. A one-line
  instruction leaves the instrument red with a message pointing at the protocol when the defect is the fixture.
  **The true functional minimum is two files**, giving aggregate `d4cb0522…` with the selftest green at 1022/0.

I verified independently that the protocol sha is pinned **nowhere** in the tooling (0 hits) while the version literal
appears **31 times across 26 files**, of which only `lib/registration.mjs:9` and two `test/selftest.mjs` lines are
functional. The recorded "two SHAs re-freeze" claim is **confirmed**.

Real refusals, for the record: `check-personnel` on a two-human register gives 5 × `ROLE COLLISION`, exit 1; the
adjudicator-less variant gives `BLOCKED role reference-adjudicator is UNFILLED`. **Read the asymmetry — an unfilled
role is BLOCKED, a wait the protocol has an idiom for; a fused role is an ERROR, a refusal it has none for.**

---

## 16. Is two humans scientifically defensible?

**No — not if the study is to support a claim of independent validation.**

It is defensible as a *transparent, lower-rung* exercise: cryptographic sampling integrity (§23 claim 1) survives
completely intact, the seal-before-execution ordering survives, the no-preview rule survives, and the outsider can
still recompute the whole cryptographic spine. What does not survive is the claim the study exists to make. §23's
claim (2) — the frame is unbiased through independent candidate selection — becomes unsupported; §22 #34 moves from
PREVENTED to UNRESOLVED; α stops measuring inter-rater reliability while still reporting a passing number; and the
endpoints must be labelled UNADJUDICATED at rung ≤ 2.

The honest formulation: **a two-human U1 would produce a real result about CPG's truthfulness, verifiable by an
outsider on its sampling and its arithmetic, but it could not be described as independently validated.** Since §14
records that none of R1–R5 has occurred, a Rung-2 ceiling costs nothing already earned — but it forecloses what U1 was
designed to earn.

---

## 17. Is a third human necessary?

**Yes, and it is the first thing that buys anything.** A third person is required for α to mean what §12 says it
means, because α needs at least one rater who holds no reference role, and two people both holding reference roles
cannot supply one.

But a third person restores only **one** adjudicator, not both — and the **rating** adjudicator is worth more, since
removing the reference one is cheap (`REFERENCE-CONFLICT` already exists) while removing the rating one forces a
§12.4 rule and a rewrite of the outcome ladder's semantics.

**The critical caveat: class-D clauses 5 and 6 survive at three people, so the Rung ≤ 2 ceiling still binds.** Three
buys back α's integrity. It does not buy back independent validation. **The ceiling lifts only near seven.**

---

## 18. What I verified myself, versus what I am relaying

Verified by reading the frozen text or running the frozen code myself: the §4A.3 minimum-7 sentence and every
exclusivity clause · §15.5's eight conditions verbatim · the 90% boundary in code · the 13 reachable configurations ·
the α pathology and its spread-dependent grid · the enforced pairwise floor in `personnel.mjs`, `reconcile.mjs`,
`ratings.mjs` and `analysis.mjs` · `coincident()` being exact URL identity · `PENDING` as a sixth disposition · the
`REFERENCE-CONFLICT` src asymmetry and the manufactured §9.7 mismatches · `FRAME_COLUMNS.length === 22` · the
contamination `unknown` = `yes` rule · that the protocol sha is pinned nowhere and the version literal 31 times ·
`cmdReconcile` reading both manifests · the rater packet's exact-keys enforcement · and three agents' test suites
re-run to green.

**Relayed as argument, not independently re-derived:** the §22 row-by-row tallies; the claim that mutual exclusion is
load-bearing in only 4 of 37 attack rows; the six-discretion-cell bias-direction analysis; the partition censuses
beyond the one script I re-ran; and every elapsed-time figure, all of which rest on unmeasured per-row assumptions.

**Corrections the agents made to my own briefing, which I accepted:** 13 configurations not 49 · reference work is
90–330 records per recorder, not 60–300 · my claim that the two-human design "must serialise reference and rating"
was refuted, since the chain forces that ordering at every headcount · "adjudicators add no information" was too
strong · my conservative-ordering rule was unsound · folding enumeration into the two humans is dominated · α's
tolerance is wider than I stated.

---

## 19. The next single operator decision

**Decide whether a U1 result at evidence rung ≤ 2, with endpoints labelled UNADJUDICATED and no claim of independent
validation, is acceptable.**

Everything else is downstream of that one answer, and answering it costs nothing:

- **If no** — stop here at zero cost. Keep the seven-person design, and take the one free saving: authorise a
  **second enumerator** (eight people, protocol unchanged, no amendment, no re-freeze), which removes 2.63–2.92 weeks.
  Then the open questions are the ones already on the table: DR-1, DR-2, the 23 DT decisions, and recruiting seven.
- **If yes** — the ordering matters, because decisions taken separately move the tooling aggregate repeatedly. Settle
  the Rung ceiling, then obtain a fresh owner approval partially reversing CPG-042 A-1…A-6 (the version cannot approve
  itself), then settle DR-1, DR-2 and the §12.4 adversity order **in one sitting**, then write the new protocol file
  once and change the tooling once. DR-1(a) + DR-2(a) + no change = **0** aggregate movements; all three together =
  **1** movement and **1** mutation run; one at a time = **3** and **3**.

Two further items need an answer regardless of this decision, because a strict reading of the current text is fatal:
**does §6.5's "reading" limb carve out the §12/§13 artefacts**, and **who runs `reconcile` and `seal`**?

# DEEPTECH-HUMAN-MIN-001 / Agent A — Separation of information vs judgement

**Classification: PREPARATION (design analysis). Nothing in this document is evidence.**

Protocol `c50fc680…df00b719` (**VERIFIED**). Instrument aggregate `f7699f05…4e5cc5dd` (**VERIFIED** by recomputation).
Definitions, the three admissible/inadmissible kinds of "machine enforcement", and the circularity entry points **C1/C2/C3** are set out in `ROLE_ELIMINATION_TABLE.md` §0 and are used here without restatement.

---

## 1. Question 1 — which functions are separation-of-information problems, and which are judgement?

**The test.** A function is a *separation-of-information* problem iff its output is determined by information already present in artefacts the protocol pins, and the only reason a human is involved is to control **who knows what, when**. It is a *judgement* problem iff its output requires a proposition about the external world that no pinned artefact entails — in which case blinding, derivation and commitment can control the conditions of the judgement but cannot produce it.

| # | Function | Class | Decisive reason |
|---|---|---|---|
| 1 | Frame **membership** (which companies are in F) | **SEPARATION** | A set can be *drawn* instead of composed. §5.7.1's rank key `sha256("<seed>|<scheme>:<identifier>")` already does exactly this one level down; applied to a hash-pinned public register snapshot it does it one level up. The only reason a human composes F today is that no one has pinned a register. |
| 2 | Frame **admissibility screening** (A1–A6, C1.2–C1.5) | **MIXED, and safely so** | A2 (`domain_controlled_https`) is machine-testable; A1 is largely register-resident; **A4** (identifier↔domain tie, evidence fields `lib/schema.mjs:20-21`) and **A6** (`a6_reference_obtainable`) are judgements. But §5.1's tri-state semantics make the failure mode benign: "UNKNOWN … never satisfies a criterion", enforced by `checkFrameRow` (`lib/schema.mjs:93`) over an exhaustive 81-combination test. A mechanism that cannot establish a criterion records `unknown` and the row becomes inadmissible. **Judgement is therefore avoidable at the cost of pool size, never at the cost of a guessed `yes`.** |
| 3 | Frame **class prediction** (`expected_outcome_class`) | **SEPARATION** | Because the protocol has already denied it evidentiary weight. `lib/reconcile.mjs:81-82`, verbatim: *"The stratum is the enumerator's PREDICTION for sampling balance; reference truth, not the stratum, determines every label. Mismatches are recorded and reported, never 'fixed.'"* §9.7 says the same. A pinned deterministic proxy over register-only fields is admissible **because its errors are published rather than corrected** — with one caveat in §6 below. |
| 4 | Reference **value construction** (Author) | **JUDGEMENT — irreducible** | §9.4's authoritative classes are unstructured documents, and §9.3 requires discriminating a stated actual from a target, projection, run-rate, order book or estimate (`FORBIDDEN_KINDS`, `lib/schema.mjs:189`) — a proposition about a sentence's claim status. No pinned artefact entails it. And the mechanised alternative is *already refused by the protocol*: see §2 below. |
| 5 | Reference **second construction** (Confirmer) | **JUDGEMENT — irreducible, and irreducibly a second person** | Separation-of-information techniques redistribute existing information; they cannot manufacture a second independent observation of an external fact. Proof in §2. |
| 6 | Reference **agreement comparison** | **SEPARATION — already mechanised** | `agreementKey` (`lib/schema.mjs:264`): whitespace-collapsed, case-insensitive compare of `value_kind|expected_value`. |
| 7 | Reference **adjudication** | **SEPARATION** | The adjudicator's entire marginal information is the pairwise contrast (proved in `ROLE_ELIMINATION_TABLE.md` §4) and §9.4 already supplies a normative total order over source classes, exposed as `authorityOf` (`lib/schema.mjs:198`). A contrast plus a fixed ordering is a function. §9.5's ban on a third value means no external proposition is ever required of this role. |
| 8 | Rating **branch 1** ("CPG returned a value?") | **SEPARATION — already mechanised** | `lib/ratings.mjs:36-38`; `lib/evaluation.mjs:181`. |
| 9 | Rating **branch 3** ("reference holds an authoritative value?") | **SEPARATION** | A function of two sealed fields: `value_kind === 'STATED'` and `authorityOf(field, source_class)`. |
| 10 | Rating **branch 4** ("value agrees?", §10.2) | **SEPARATION** | Arithmetic over formats §9.3 pins exactly (`VALUE_FORMAT`, `lib/schema.mjs:192`): year equality; `|cpg − ref| ≤ ref/10`; the pinned currency/magnitude parse with `CURRENCY_NOT_STATED` already a typed rule (`lib/ratings.mjs:21-24`). |
| 11 | Rating **temporal rule** (§10.2, REFERENCE-STALE) | **SEPARATION — already mechanised outside the rater** | `lib/analysis.mjs:134, 149` under decision AD-5. |
| 12 | Rating **branch 2** ("attributable to the EXPECTED entity?") | **JUDGEMENT — irreducible** | The instrument says so in its own voice: `lib/analysis.mjs:225` reports S1 `computed: false`, *"needs a registry-identity comparison rule not implemented by this tooling."* Requires reading the §12.3 cited URLs (`extractCitedUrls`, `lib/raterPackets.mjs:31-49`) and forming a view about entity identity. |
| 13 | **REFERENCE-AMBIGUOUS** (rater) | **JUDGEMENT — irreducible** | A meta-judgement that the sealed reference cannot decide the item. |
| 14 | Rating **adjudication** | **SEPARATION** | Marginal information is again only the pairwise contrast (`ROLE_ELIMINATION_TABLE.md` §7); a pinned severity order over `RATING_LABELS` resolves it without discretion. |
| 15 | **Presentation order, Record 1/2 and Label A/B blinding** | **SEPARATION — already mechanised, and exemplary** | §12.1's `order_key` and `lib/raterOrder.mjs` derive every order and blind position one-way from `ho_record_sha256`, which cannot be known before the held-out drand round exists. `lib/packets.mjs:34, 83` apply it. **This is the model every mechanism proposed here imitates.** |
| 16 | α, endpoints, dispositions, exclusion table, outcome | **SEPARATION — already mechanised** | `lib/analysis.mjs:81-92, 141-214`; exact integer threshold comparisons at `:171-176`. |

**Verdict.** Of sixteen functions, **thirteen are separation-of-information problems** (eight of them already mechanised in the verified instrument), **one is mixed but safely resolvable toward exclusion**, and **exactly three are irreducible judgements**: reference value construction, its independent second instance, and entity attribution (with REFERENCE-AMBIGUOUS as its meta-case). The three judgements are carried by **two** people, because the second and third are instances of the first and second respectively.

---

## 2. Proof that at least two humans are indispensable

Not an assertion. Four steps, each resting on a protocol rule or an instrument behaviour.

1. **The study's claim requires at least one *estimated*, not assumed, reliability for an irreducibly judgemental quantity.** §9.5 mandates double-entry reference construction and reconciliation; §12 mandates α ≥ 0.667 and §15.5(3) makes a missing α or fewer than two raters a run-level INCONCLUSIVE condition (`lib/analysis.mjs:199`). §20.6 concedes reference independence is *bounded*, and the bound is produced by the Author/Confirmer comparison and by §9.8's SOURCE-COINCIDENT count — there is no other source of it.
2. **Reference value construction is irreducibly judgemental** (§1 row 4 above) **and its mechanised substitute is refused by protocol-004 as written.** Any extractor able to run at scale reads the structured sources CPG itself reads (registries, Wikidata — §10.2's own rationale cites `wikidataAdapter.ts:172`). §9.8 then classes those observations SOURCE-COINCIDENT, and `lib/analysis.mjs:202` makes the run INCONCLUSIVE above 60 % of scored observations. That is entry point **C2**, and it requires no new argument: **the protocol already contains the rule that defeats the mechanised reference.** Escaping via the non-overlapping authority classes (`ENTITY_OWN_PAGE`, `ENTITY_OWN_FINANCIAL_STATEMENT`, `AUDITED_FINANCIAL_FILING`) is closed too, because those are exactly the unstructured documents in which `FORBIDDEN_KINDS` discrimination (`lib/schema.mjs:189`) is required.
3. **The reliability of a judgement cannot be estimated from one instance of it.** A single record has no comparand: `agreementKey` has nothing to compare and `lib/reconcile.mjs:51` refuses with "missing confirmer record". A *deterministic* second pass is vacuous — the same pinned rule over the same inputs reproduces the first output by definition, so α = 1 attests to the function's determinism and to nothing about correctness. Two *different* rules would compare two of the developing organisation's own opinions: circularity **C1**.
4. Therefore at least **two independent instances** of an irreducibly human judgement are required, therefore at least **two distinct independent humans**. The operator cannot be one of them (§4A.3; `lib/personnel.mjs:33`), and an AI cannot be one of them (prior analysis X-5; not machine-checkable). **∎**

**Corollary — one human is impossible, and the impossibility is mechanised, not merely stated.** `lib/reconcile.mjs:52` refuses `author.recorded_by === confirmer.recorded_by`; `lib/ratings.mjs:97` refuses two sheets from one person; `lib/analysis.mjs:199` makes one rater an INCONCLUSIVE condition. With one human there is no replication of any judgement, so **neither** reference reliability **nor** label reliability is estimable, §12's ceiling applies (every endpoint UNADJUDICATED, rung ≤ 2, no independent-validation claim), and §20.6's "bounded" becomes unbounded. **Two is a hard floor; the owner's "at most two" is exactly attainable and not improvable.**

---

## 3. Question 2 — §22 attack by attack: what does §4A.3's mutual exclusion defeat, and does a mechanism defeat the same attack?

§4A.3's mutual exclusion is cited as a control in exactly four rows of the §22 matrix. The other thirty-three are chain, derivation or registry controls to which personnel count is orthogonal. Taking them in order.

| § | Attack | §22 class today | What mutual exclusion contributes | Does a deterministic mechanism defeat the same attack? |
|---|---|---|---|---|
| 31 | **Operator authors a globally biased frame** | **UNRESOLVED by sampling integrity**; control = "Enumerator independence (§4A.2, §19.3)" | The whole of the control. §4A.2(c)(d) keep the enumerator off the operator's and every other role. | **YES, and strictly more strongly.** A register-snapshot frame drawn by the §5.7.1 rank key from chain+drand randomness means **no one composes the frame**: §23 claim (2) becomes an instance of claim (1) and the row moves from UNRESOLVED to PREVENTED. Today's control is procedural and §20.23 admits it "rests on declarations … not on verifiable proof"; `lib/personnel.mjs:1-3` says the tooling "cannot verify that declarations are true." A snapshot digest anyone can re-fetch and re-hash is a cryptographic control. **Mechanism wins.** |
| 34 | **Role conflicts** (enumerator adjudicating reference truth; shared or operator-held roles) | **PREVENTED structurally in the register; truthfulness PROCEDURAL** | This is mutual exclusion's own row: `lib/personnel.mjs:33-34` refuse the operator in any role and any person in two roles. | **YES, a fortiori — by elimination rather than separation.** A role that does not exist cannot be conflated. Deleting the enumerator and both adjudicators removes three of the five conflict pairs the row contemplates. The residual — the two survivors each holding a reference role *and* a rating role — is **not** this attack: it is a *declared, published* dual role whose cost is quantified in §4, not a concealed conflict. The row's own residual ("truthfulness PROCEDURAL") shrinks, because fewer declarations are needed: two persons' declarations instead of seven. **Mechanism wins on the eliminated roles; the surviving overlap must be disclosed, not hidden.** |
| 35 | **Reference adjudication leakage** (class, split, CPG output, recorder identity, tallies) | **PREVENTED in the packet; other channels PROCEDURAL** | Mutual exclusion supplies the "other channels" control — the adjudicator is a stranger to the Author, the Confirmer and the enumerator. | **YES, by eliminating the channel.** The packet control is already mechanical (`lib/packets.mjs:12, 14, 31, 45-57`); what remains is what a human learns outside the packet. Delete the human and the residual is not mitigated but **absent**. The §9.4 tier rule (`lib/schema.mjs:183, 198`) reads only the two sealed records' `source_class`, so there is no channel to leak into. **Mechanism wins.** |
| 36 | **Rating adjudication leakage** (rater identity, tallies, class, split, pilot) | **PREVENTED in the packet; other channels PROCEDURAL** | Same structure. | **YES, identically.** `RATING_ITEM_KEYS` exactness (`lib/packets.mjs:16, 94-99`) already handles the artefact; the pinned severity order reads only the two labels. **Mechanism wins.** |
| 32 | Private preview of held-out candidates | DETECTABLE (procedural/audit only) → VOID if detected | **Nothing.** This is operator discipline (§6.5), and §20.20 concedes the protocol "cannot prove that no unlogged private CPG query occurred." | Neither more nor fewer independent humans changes the control. **But see the warning below: role reduction makes this attack *less* likely to be detected.** |
| 1–30, 33, 37 | Seed, list, commitment, randomness, chain, registry, execution-window and rater-order attacks | PREVENTED / DETECTABLE as tabulated | **Nothing.** Personnel count is orthogonal. | Already mechanised. Unaffected by role minimisation in either direction. |
| 19 | Multiple registrations under different identities | **UNRESOLVED (identity-level)** | Nothing. | No. Unaffected (§20.13). |

### The direct answer: **no attack in §22 is defeated only by a distinct human.**

Every row where mutual exclusion carries weight (31, 34, 35, 36) is defeated at least as well, and in rows 31/35/36 **better**, by a deterministic mechanism. Row 31's control is the protocol's own weakest link by its own admission; rows 35 and 36 keep a procedural residual that role deletion removes outright.

### And the thing that a distinct human *does* defeat, which §22 does not contain

§22 is an **attack** matrix — a catalogue of adversarial manipulations of sampling and procedure. The reason distinct humans are nonetheless indispensable is that the threat they address **is not an attack**: it is **unmodelled common-mode error in a judgement**, and §22 has no row for it because no adversary is required. §23's trust model names it in the "Can still" column and nowhere else:

- Reference Author / Confirmer / adjudicator — *"Share errors; collude."*
- Raters + rater adjudicator — *"Label bias."*

No mechanism detects a judgement's unreliability; only a second independent instance of that judgement estimates it. So the honest formulation, which is also the answer to Question 2:

> **The requirement for distinct humans in protocol-004 does not come from §22 at all. It comes from §9.5's double entry and §12's α — which are *reliability measurements*, not attack controls. Mutual exclusion, considered purely as an attack control, is dominated by deterministic mechanism on every row where it appears.**

That distinction is what makes the owner's target reachable: the roles that exist **only** as attack controls (enumerator, both adjudicators) can be mechanised, and the roles that exist as **reliability measurements** (Author, Confirmer; rater 1, rater 2) cannot — but they are only two people's worth of work.

### One cost of role reduction that no mechanism repays

Reducing seven independent participants to two **reduces the number of people positioned to notice and declare a protocol violation.** The prior analysis logs this as X-1: nothing detects a violation automatically; AD-7 (`lib/analysis.mjs:127`, `:205`) and §15.5(7) act only on a *declared* one. §22 row 32's detectability likewise depends on someone speaking up. **Seven independent observers are seven potential whistleblowers; two are two.** This cost is real, is not mitigable by any mechanism proposed here, and should be recorded as a limitation in the amended protocol's §20 rather than argued away.

---

## 4. Question 3 — does the adjudicator function add evidence?

**Verdict: NO. Both adjudicators add *coverage*, not evidence. Precisely: they convert observations that would be excluded into observations that are scored, and they do so using strictly less information than the two primaries held.**

**What the reference adjudicator knows that the Author and Confirmer do not — exactly one thing.** Read off `lib/packets.mjs:36-38`: each item carries the drawn company's public identifiers (name, canonical domain, jurisdiction family, identifier scheme and value — all of which both primaries already had, §9.2) plus `pick(a, RECORD_KEYS)` and `pick(c, RECORD_KEYS)`. `RECORD_KEYS` (`lib/packets.mjs:14`) strips `candidate_id`, `field`, `recorded_by`, `recorded_at` and `constructed_without_cpg`. §9.2.1 then withholds: any CPG output including pilot and instrument check; class predictions, identity-hazard notes, stratum, split; screening logs, attestations, contamination bases; **agreeing records** (`lib/packets.mjs:31` — they are never released); the identities or pseudonyms of Author and Confirmer; and **any count or tally of adjudication outcomes**. Therefore the marginal information is **the pairwise contrast on that one item** — the very contrast §9.1 deliberately blinded the primaries from — and nothing else. The adjudicator receives **no source document either primary lacked**, and §9.5 forbids supplying a third value, so no fresh lookup is even authorised.

**What the rating adjudicator knows that the raters do not — exactly one thing.** `lib/packets.mjs:72-86`: the *identical* §12 rater packet, plus `label_a` and `label_b` shown unlabelled. §12.2 withholds rater identity, other observations' labels, tallies, aggregates, provisional endpoint values, class, split, identity-hazard note, pilot outputs, and **the number of disagreements**. Again: the pairwise contrast, and nothing else.

**What follows, stated as evidence accounting.**

- **Not a third measurement.** A third independent measurement would require a third construction (reference) or a third rating, and both are structurally forbidden: §9.5 "cannot supply a third value"; `lib/ratings.mjs:9` "never a new label". The decision spaces are `RECORD_1|RECORD_2|REFERENCE-CONFLICT` and `LABEL_A|LABEL_B|REFERENCE-AMBIGUOUS` — **selections, not observations**.
- **No contribution to α.** α is computed over the raters' **own** labels *before* adjudication (`lib/analysis.mjs:179-182`). Adjudication is invisible to the reliability estimate by design. So the rating adjudicator cannot, even in principle, improve M.
- **No contribution to reference independence.** SOURCE-COINCIDENT compares the sealed reference's `source_url` against CPG's cited URLs (`lib/analysis.mjs:135-139`); an adjudicated row carries whichever primary's URL was selected. No new source path enters.
- **The whole contribution is coverage.** Without reference adjudication a disagreement is `REFERENCE_CONFLICT`, excluded from every denominator (§10.3, §15.2) and counted against §15.5(2)'s ≥ 90 % VALID floor. Without rating adjudication a disagreeing item has no final label — `lib/ratings.mjs:136` throws `RATING_ADJUDICATION_MISSING` — so it fails §15.5(3)'s ≥ 90 % completely-rated rule and shrinks G1.

### 4A. The two adjudicators are coverage instruments of *different* cost

They are equivalent in evidentiary contribution (nil) and **not** equivalent in removal cost, because §15.1's disposition list is closed and asymmetric:

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · `REFERENCE-AMBIGUOUS` · `REFERENCE-STALE` (+ the `CONTAMINATION-DISCLOSED` flag).

- **`REFERENCE-CONFLICT` already means "the Author and Confirmer disagreed and it was not resolved."** §15.2 dispositions it explicitly: "excluded, published". So the **reference** adjudicator can be deleted with no new vocabulary — unresolved disagreements fall into a home the protocol already built for them.
- **No disposition means "the raters disagreed."** The instrument proves the gap by *refusing* rather than dispositioning: `lib/ratings.mjs:136` throws `RATING_ADJUDICATION_MISSING` when the deterministic packet is non-empty and no resolution exists. So deleting the **rating** adjudicator requires **either** a new §15.1 disposition **or** a deterministic resolution rule. Re-using `REFERENCE-AMBIGUOUS` should be rejected as semantically false: it means the sealed reference cannot decide the item, not that two people read it differently.

§5 below shows why this asymmetry resolves in favour of **resolution** in both cases: a new exclusion disposition spends a budget of six, and adverse resolution spends nothing.

---

## 5. The exclusion budget — the quantitative bound on every elimination in this analysis

Any mechanism that converts a judgement into an exclusion is spending a scarce, shared resource, and the resource is much smaller than it first appears.

| Configuration | Quotas (§5.6; `lib/sizing.mjs:41-45`) | Companies | Observations (× 3 fields) | Max non-VALID under §15.5(2) |
|---|---|---|---|---|
| **Floor** | 12 / 5 / 3 | 20 | **60** | **6** |
| **Cap** (§19.2 H1) | 60 / 25 / 15 | 100 | **300** | **30** |

§15.5(2) requires ≥ 90 % of held-out observations VALID, compared exactly at `lib/analysis.mjs:198` (`10 × valid < 9 × total`). The budget is **shared across every cause**: `lib/analysis.mjs:164` counts only `disposition === 'VALID'`, so `INVALID` (no response, harness error, post-draw identity inadmissibility), `REFERENCE-CONFLICT`, `REFERENCE-STALE`, `REFERENCE-AMBIGUOUS` and `PENDING` all draw on the same six places at the floor.

**Three consequences, each of which changed a recommendation in this analysis.**

1. **Pure exclusion is not the "conservative" option at small N; it is the infeasible one.** An Author/Confirmer disagreement rate of 10 % on 60 observations consumes all six places unaided, leaving nothing for a single harness error, and §15.5(2) fires INCONCLUSIVE. I had written that deleting reference adjudication with no tier rule was "evidentially stronger still"; **at the floor that is wrong and it is withdrawn.** The §9.4 tier-dominance rule is load-bearing precisely because it *resolves* — the observation stays VALID and the budget is untouched.
2. **Resolution rules dominate exclusion rules as a design principle.** This is why the recommended rating mechanism is adverse severity resolution rather than a new `RATER-DISAGREED` disposition: adverse resolution costs **zero** budget, a new exclusion disposition costs from the same six.
3. **The budget also prices the mechanised frame.** A register-derived frame raises the rate of companies with no findable reference value. Those become `NOT_AVAILABLE_FROM_SOURCE` reference records — which are a *valid outcome*, not an exclusion (§5.9: "A reference value of `NOT_AVAILABLE_FROM_SOURCE` is a valid outcome, not inadmissibility"), and abstentions are "**never excluded**" (§15.2). So the frame change pressures **G1** (≥ 20 fills) rather than §15.5(2). **Two different failure modes, two different budgets — they must not be conflated.**

**Rule of thumb for the owner:** the study can afford to *resolve* as many judgements as it likes and to *exclude* six. Every role elimination must therefore be paid for in resolution rules, not in exclusions — and where no defensible pre-registered ordering exists, the human stays.

**The consequence the owner should weigh.** An adjudicator's selection resolves some fraction of disputes *in the software's favour* and some against, and a reader cannot verify which way discretion ran. A pinned rule — §9.4 tier dominance for reference, adverse severity order for rating — resolves them the same way every time, in a direction fixed before the frame existed. So replacing both adjudicators does not lose evidence; it **removes unverifiable favourable discretion while keeping the coverage.** The correct summary is blunt: *the two adjudicators are error-correctors that, on average, correct in the developing organisation's favour.*

---

## 6. Question 4 — is the enumerator's independence protecting the same property as the two-stage commitment and the frame-sufficiency rule?

**Verdict: NO — three different properties, and protocol-004 states the difference in three separate places rather than leaving it to inference.**

| Control | Property it establishes | What it leaves entirely open |
|---|---|---|
| **Two-stage commitment** (§5.5, §5.5.3) | **Immutability and freshness.** `frame_hash` and `scan_sha256` are inside the on-chain digest before `H_rand` exists; each outpoint is spendable once; the held-out payload must carry the development payload's `frame_hash` and `scan_sha256` and the registered `registry_sha256`. Defeats §22 rows 2, 8, 9, 10, 25, 26, 26a, 27, 27a, 30. | **Whether the frozen composition was favourable to begin with.** A perfectly committed frame can be perfectly biased. Immutability of a biased set preserves the bias. |
| **Frame sufficiency** (§5.7.2) + **pool minimum** (§5.7) | **Non-degeneracy.** `E_c ≥ 2·Qmax_c + Dev_c`, i.e. 126/52/32, with `Qmax` derived by evaluating the frozen sizing function over all 4096 permitted pilot outcomes (`lib/frame.mjs` per §5.7.2 step 9); the pool must hold ≥ 2× the quota per class "so the draw is a genuine selection rather than a hand-picked set". | **Whether the large pool is uniformly favourable.** 210 rows every one of which the developing organisation knows CPG handles well passes `check-frame-sufficiency` and `pool-check` and every chain verification. Sufficiency constrains *cardinality*, never *composition*. |
| **Enumerator independence** (§4A.2) | **Selection-set unbiasedness** — the property named below. | Everything cryptographic; it is purely procedural and §20.23 says so. |

**The property enumerator independence protects, named exactly.**

> **Selection-set unbiasedness** — the protocol's own term is **"independent candidate selection"** (§23, final paragraph): *the frame is unbiased.* Formally: the frame's realised composition is statistically independent of CPG's per-company performance, i.e. F was produced by a process whose outcome does not depend on how well the software does on the companies it contains.

Protocol-004 states the separation three times, and each statement is dispositive:

- **§20.18**, verbatim: *"Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate selection (the frame is unbiased); the latter rests on enumerator independence only."*
- **§22 row 31**: "Operator authors a globally biased frame — **UNRESOLVED by sampling integrity** — Control: Enumerator independence (§4A.2, §19.3)."
- **§23**, closing: *"Two claims, never merged: (1) cryptographic sampling integrity … (2) independent candidate selection … protocol-004 additionally specifies the personnel rules on which (2) rests, **without making (2) cryptographic**."*

**The exact gap, stated once:** the commitment makes the frame *immutable*; sufficiency makes it *non-degenerate*; **neither makes it unbiased**, and no combination of them ever will, because both are properties of the frame's hash and cardinality while bias is a property of its membership. Only the *provenance* of the membership can establish unbiasedness — which is why today the control is a person's declaration, and why replacing that person with a hash-pinned public register snapshot plus the §5.7.1 rank key is the one substitution in this whole analysis that makes the evidence **stronger**: it moves claim (2) inside claim (1).

**One caveat that must travel with that substitution.** The stratum (`expected_outcome_class`) determines the per-class quotas and therefore *which* companies are drawn, so a self-serving stratum proxy would reintroduce bias one level down — loading `fill-expected` with easy companies while every hash verifies. Two things contain it: the proxy must be a pre-registered total function of **register-only** fields with its bytes inside `tooling_aggregate_sha256`, so it cannot be tuned to the drawn sample (frame hash committed before randomness, §22 row 2); and `lib/reconcile.mjs:81-82` with §9.7 already publish every stratum/reference mismatch without correcting it, so a systematically wrong proxy is **visible in the published record**. The irreducible residual is that the proxy could be tuned to general beliefs about CPG's behaviour — which is the same residual §20.11 already concedes for the pilot's optimistic bias. It should be carried forward as a limitation, not presented as closed.

---

## 7. Where the two surviving humans cannot be helped, and the coupling that cannot be escaped

**An impossibility result the owner needs before choosing a model.** With two humans and two double-entry judgements (reference construction, attribution rating), each person must perform one instance of **each**. Therefore in *every* two-human model that preserves both reliability measurements, the two tasks are correlated within each person:

- For items where the two reference records **AGREED**, both raters hold a reference value they each independently produced and know to be corroborated. Their agreement on the resulting label is then partly explained by their prior agreement on the value. **α is inflated: it becomes an upper bound on scoring reliability, not an estimate of it.**
- Each rater has an unmeasured incentive to label in defence of their own reference record (**own-work defence bias**), in either direction.

Neither is repairable by blinding: the information is inside the person, and §12.1's derived orders and §12.2's blind positions cannot un-know it. **This coupling is the true price of two humans**, and no model in `MODEL_RANKING.md` escapes it except by abandoning one of the two reliability measurements.

**It can, however, be bounded rather than merely declared** — and the instrument already produces the raw material. Three measures, all computable from artefacts the verified tooling emits, all recommended as mandatory in any amended protocol:

1. **Restrict the human rating task to branch 2 (entity attribution).** Attribution is judged from CPG's §12.3 cited URLs and the pre-registered decisive identifier (`extractCitedUrls`, `lib/raterPackets.mjs:31-49`), **not** from the reference *value*. So the shared prior agreement on the value contributes far less to agreement on this label than it would to agreement on SUPPORTED vs INCORRECT. This is the largest available reduction of the coupling, and it falls out of the same decomposition that mechanises branches 1/3/4.
2. **Publish α stratified by reference resolution** — separately over items whose reference records AGREED and items that were resolved (or excluded). If the coupling is material, the two α values diverge, and a reader can see it. This is a restriction of `alphaPop` (`lib/analysis.mjs:179-181`); `rater_label_coincidence` (`lib/analysis.mjs:182`) already carries a full 7×7 confusion matrix per stratum.
3. **Declare α as an upper bound in the results artefact itself**, not only in prose, and state the dual-role assignment in the published personnel record. §12's α threshold of 0.667 is "Krippendorff's own floor for tentative conclusions" — a threshold met by an inflated statistic must be reported as such or the reader is misled.

**Stated plainly, as instructed.** Two humans is attainable; two humans *at no evidentiary cost* is not. The costs are: an inflated α (bounded but not eliminated by the three measures above), an undeclarable own-work defence bias, two fewer independent observers to notice a violation (§3's warning), and — for the mechanised frame — a live risk of honest INCONCLUSIVE via G1. Every one of these is smaller than the cost the study currently carries by not existing, but that is the owner's judgement to make and not mine.

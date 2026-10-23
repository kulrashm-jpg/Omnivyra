# DEEPTECH-HUMAN-MIN-001 / Agent A — Ranking of the candidate two-human models

**Classification: PREPARATION (design analysis). Nothing in this document is evidence.**

Protocol `c50fc680…df00b719` (**VERIFIED**). Instrument aggregate `f7699f05…4e5cc5dd` (**VERIFIED** by recomputation).
Terms **S / F / T / M / C**, the three kinds of "machine enforcement", and the circularity entry points **C1 / C2 / C3** are defined in `ROLE_ELIMINATION_TABLE.md` §0. The exclusion-budget arithmetic is in `SEPARATION_VS_JUDGEMENT.md` §5.

**Ranked by evidentiary strength, not by convenience.** Cost, schedule and recruitment difficulty are recorded separately at §8 and are not inputs to the ranking.

---

## 1. The four tests each model must pass

| Test | Statement | Basis |
|---|---|---|
| **T1 — Executable** | The verified instrument does not refuse it, or the refusal is a named amendment rather than a design flaw. | `lib/reconcile.mjs:51-52`; `lib/ratings.mjs:97-98`; `lib/analysis.mjs:199` |
| **T2 — Non-circular** | No path by which the developing organisation's artefacts determine a value CPG is scored against. Tested against **C1**, **C2**, **C3**. | §9.3; §9.8; §5.5.1 |
| **T3 — Reliability-preserving** | At least one *estimated* (not assumed) reliability survives for each irreducible judgement. | §9.5; §12 α; §15.5(3) |
| **T4 — Solvent** | The eliminations do not overspend the exclusion budget: **6 non-VALID of 60 at the floor**, 30 of 300 at the cap, shared across all causes. | §5.6; §15.5(2); `lib/analysis.mjs:164, 198` |

**A model failing T2 is rejected outright**, not ranked. A model failing T3 is capped by §12's own fallback ("every primary endpoint **UNADJUDICATED**, the evidence rung **cannot exceed Rung 2**, **no claim of independent validation**"). **T4 is the test I initially omitted** and it changes the ordering of A against C.

Common to every model below: the **operator** remains, is **not independent** (§4A.3), and can absorb neither human — so "two humans" means **three people**. No human may be an AI, and no mechanism named is a model inference.

---

## 2. Model D — two raters with mechanised reference truth · **REJECTED (circular)**

Not ranked. Rejected at T2, on two independent grounds, the second of which requires no new argument because protocol-004 already contains the rule that kills it.

**Where the circularity enters — exactly.**

1. **Entry point C1, at the extractor.** The reference extractor would be software written by the developing organisation, producing the values by which that organisation's software is judged. `constructed_without_cpg` (`lib/schema.mjs:257`) would remain machine-`'yes'` while being substantively false, which is worse than an honest failure: the artefact would *attest* to the property it violates. §9.1's Author row already forbids the human equivalent ("Must not: have implemented CPG, the protocol or the tooling"); a machine built by the implementers is that same disqualification in another form.
2. **Entry point C2, at the sources — and this is the decisive one.** Any extractor able to run at scale must read the *structured* sources: registries and Wikidata. Those are exactly CPG's own inputs — §10.2's own rationale cites `wikidataAdapter.ts:172` for the adapter's currency behaviour. §9.8 then classifies each such observation `SOURCE-COINCIDENT` ("reference and CPG cite the same document"), and **`lib/analysis.mjs:202` makes the run INCONCLUSIVE once SOURCE-COINCIDENT exceeds 60 % of scored observations.** A mechanised reference drives that ratio toward 1 by construction. **Protocol-004 as written already refuses Model D; no amendment, no argument and no engineering is needed to defeat it.**

**The escape is closed too.** One might mechanise only the source classes CPG does *not* cite — `ENTITY_OWN_PAGE`, `ENTITY_OWN_FINANCIAL_STATEMENT`, `AUDITED_FINANCIAL_FILING` (§9.4). But those are precisely the unstructured documents in which §9.3's discrimination is required: is this figure a stated actual, or a target, projection, run-rate, order book or estimate (`FORBIDDEN_KINDS`, `lib/schema.mjs:189`)? That is a judgement about a sentence's claim status, not a parse. So the escape route runs directly into the irreducible judgement it was meant to avoid.

**Also fails T3 on the reference side.** Two raters estimate scoring reliability (M); nothing estimates reference reliability (T). §20.6's "reference independence is bounded" would have no bound, since both the Author/Confirmer comparison and a meaningful SOURCE-COINCIDENT count are gone.

**Verdict: REJECTED.** Model D trades the study's one anti-circularity property for headcount. It is the only candidate that makes the study *worse than not running it*, because it would produce a SUCCESS that a competent reader must discard.

---

## 3. Model E (mine) — "Sealed-reference dual role, machine-scored except attribution" · **RANK 1**

**Two humans: H-α and H-β. Five of the seven roles deleted, not relabelled.**

| Function | Who | Mechanism |
|---|---|---|
| Frame | **no human** | Hash-pinned public register snapshots per §5.7's four families; admissibility from register-only fields under §5.1 tri-state (unestablished → `unknown` → inadmissible, `lib/schema.mjs:93`); membership drawn by the existing rank key `sha256("<seed>|<scheme>:<identifier>")` (§5.7.1) on chain + drand randomness; stratum by a pre-registered total function of register-only fields. Snapshot digests in the OSF registration (§5.5.1). |
| Reference truth | **H-α = Author, H-β = Confirmer** | Unchanged. `reconcile`, `agreementKey`, `seal` untouched. |
| Reference adjudication | **no human** | §9.4 authority-tier dominance via `authorityOf` (`lib/schema.mjs:198`); residual ties → `REFERENCE_CONFLICT`, a disposition §15.1 already provides. |
| Rating branches 1, 3, 4 + temporal rule | **no human** | Already-mechanical or pinned arithmetic: `lib/ratings.mjs:36-38`; `value_kind`/`authorityOf`; §10.2 over `VALUE_FORMAT` (`lib/schema.mjs:192`); `lib/analysis.mjs:134, 149`. |
| Rating branch 2 (entity attribution) + REFERENCE-AMBIGUOUS | **H-α and H-β, independently** | The only human judgement in the scoring path. Three-way: attributable / not attributable / cannot tell. Items restricted to those where CPG returned a value. |
| Rating adjudication | **no human** | Pre-registered adverse severity order over `RATING_LABELS`; the observation stays **VALID**, so **zero** exclusion-budget cost. Mandatory published sensitivity with disagreements excluded instead. |

**T1 — Executable?** Not under protocol-004 as written: §4A.3 requires "**minimum 7 independent persons**" and every role's eligibility text repeats "no other §4A.3 role". Requires amending §4A.2, §4A.3, §9.1, §9.2.1, §9.5, §12, §12.2 and the `reconcile` / `resolve-rating-adjudication` behaviour. **This is the largest amendment burden of any model ranked**, and it is the honest price of rank 1.

**T2 — Non-circular?** **Passes.** Reference values remain human and non-CPG (no C1, and SOURCE-COINCIDENT keeps its meaning as a real measurement rather than a tautology, so no C2). Every mechanism is a deterministic rule whose bytes enter `tooling_aggregate_sha256` before frame construction and therefore before `H_rand` exists (§22 row 2) and before any CPG outcome (§22 row 26a) — entry point **C3**, which protocol-004's architecture already closes. **This is the model's core claim: mechanising the *scoring rule* is non-circular; mechanising the *reference value* is not.**

**T3 — Reliability-preserving?** **Passes, and better than Model B.** Reference reliability survives intact (double entry). Scoring reliability survives as α computed on the attribution judgement — and that α is **less contaminated** than Model B's, because attribution is judged from CPG's §12.3 cited URLs and the pre-registered decisive identifier (`extractCitedUrls`, `lib/raterPackets.mjs:31-49`) rather than from the reference *value* the two raters jointly produced. The coupling proved unavoidable in `SEPARATION_VS_JUDGEMENT.md` §7 is present but minimised.

**T4 — Solvent?** **Passes, and it is the most solvent model.** The rating-adjudicator replacement spends **zero** budget (resolution, not exclusion). The reference tier rule resolves most disagreements and excludes only genuine same-tier conflicts. No elimination creates a new exclusion class.

**Why rank 1.** It is the only model that simultaneously (a) keeps both reliability estimates, (b) keeps P3 — the endpoint whose failure FALSIFIES (§10.5; `lib/analysis.mjs:212`) — by keeping the attribution judgement human, (c) **upgrades** an evidentiary property rather than merely preserving it, by moving §23's claim (2) from procedural to cryptographic and closing §22 row 31 (today **UNRESOLVED**) along with §20.18 and §20.23-for-enumerators, (d) eliminates rather than merely packet-controls the two adjudication leakage channels (§22 rows 35, 36, both of which retain a "PROCEDURAL" residual today), and (e) spends the least exclusion budget.

**Its two real weaknesses, stated plainly.** First, the amendment burden above. Second, an **empirical gate I did not test and could not test here** (enumeration is prohibited in this task): §5.7.2 requires ≥ 126 / 52 / 32 admissible held-out-eligible rows, and whether ≥ 210 such rows survive *register-only* screening across the four families is **UNVERIFIED**. It is answerable by counting over four public files before any commitment. If it fails, the frame mechanisation fails and Model E degrades to Model B. Third, a consequence rather than a weakness: a register-random frame fills less often, which pressures **G1 (≥ 20 fills)** against the hard ceiling CAP H1 = 60 (§19.2) — risk shifted from *biased success* to *honest INCONCLUSIVE*.

---

## 4. Model B — reference + reference/rating · **RANK 2**

**Two humans, each performing one instance of both double-entry judgements: H-α = Author then rater-1, H-β = Confirmer then rater-2.** Rating stays a full seven-label §10.1 application; both adjudicators and the enumerator are mechanised as in Model E (or the enumerator is retained, in which case the model needs three humans and misses the target).

**T1:** same amendment class as E, slightly smaller (no change to the rating task's scope).
**T2:** **Passes** — identical argument to E; reference values remain human.
**T3:** **Passes, but weakest among the passing models.** Both reliabilities survive, and the scoring one is measurably degraded: for items where the two reference records **AGREED**, both raters hold a value each independently produced and knows it corroborated, so label agreement is partly explained by prior value agreement. **α becomes an upper bound rather than an estimate**, and must be published as such — §12's threshold of 0.667 is "Krippendorff's own floor for tentative conclusions", and a floor met by an inflated statistic misleads. The contamination is larger than in E because the full seven-label judgement leans on the reference value, whereas E's attribution judgement does not.
**T4:** **Passes** with the same mechanisms as E.

**Additional cost, correctly framed.** Not leakage — §12's rater packet already contains "the sealed reference record", so a reference observer who later rates gains **no new information**. The residual is **self-consistency bias**, and it is *explicitly cued*: `REFERENCE_COLUMNS` (`lib/schema.mjs:213-218`) carries `author`, `confirmer`, `resolution` and `adjudicated_by` into the very record the rater reads, so a dual-role rater sees their own pseudonym in the `author` field. **Mitigation:** omit those four from the reference record as presented in the rater packet — none is an input to §10.1 or §10.2 — which de-cues without hiding any scoring input (narrows `checkItem`, `lib/raterPackets.mjs:60`). The bias can be de-cued and declared, never eliminated.

**Why rank 2, not 1.** It keeps everything E keeps except the two things that make E stronger: the uncontaminated per-branch α, and the cryptographic frame. It is, however, **the cheapest of the ranked models to reach** — fewer tooling changes, no register-snapshot engineering, no empirical pool gate — and if the §5.7.2 register-only count fails, B is where E lands anyway. **If the owner wants one recommendation that survives an unfavourable pool count, it is B.**

---

## 5. Model C — two reference observers with deterministic rating · **RANK 3**

Two humans do reference double-entry; rating is entirely mechanical; both adjudicators and the enumerator mechanised.

**T1:** **Executable with the smallest amendment on the reference side** — and it has no *dual* role, so §4A.3's mutual exclusion is not violated for the surviving two; the amendment is only to §12 (raters) and §4A.3's headcount.
**T2:** **Passes.** Reference stays human; the scoring rule is pinned pre-registration (C3 closed).
**T3:** **FAILS on the scoring side, and the protocol prices the failure itself.** No α exists — `alphaNominal` (`lib/analysis.mjs:81-92`) needs pairs of human labels, and a deterministic rule's agreement with itself is vacuous (`SEPARATION_VS_JUDGEMENT.md` §2 step 3). More seriously, **branch 2 is unmechanisable**, so `MISATTRIBUTED-FILL` cannot be assigned and **P3 — the only endpoint whose breach FALSIFIES (§10.3, §10.5) — cannot be assessed.** §12's fallback then applies verbatim: every primary endpoint **UNADJUDICATED**, evidence rung **≤ 2**, **no claim of independent validation may be made**, and "the protocol is not weakened to accommodate unavailability."
**T4:** **Passes most comfortably of all** — nothing human remains at rating to disagree, so no rating exclusions arise at all.

**Why rank 3 above A.** C is *honest*: it is non-circular, it keeps the anti-circularity core intact, it has nothing to argue about on α because it claims none, and it is self-capped by the protocol's own text rather than by a reader's suspicion. A Rung-2 result that is clean is worth more than a Rung-3 claim that is contested.

**The refinement that converts C into E, and the reason E exists.** Let the same two reference humans judge **only** branch 2 — a small set (filled observations only, at most 3 × 60) — with everything else machine-labelled. That single addition restores P3 *and* restores a two-rater α on the one judgemental branch, at a fraction of Model B's rating workload. **C is therefore best understood as E minus its cheapest component**, which is why I do not recommend stopping at C.

---

## 6. Model A — reference + rating · **RANK 4 (last among ranked)**

Read as: one human does reference, the other does rating. Both double-entry structures collapse to single entry.

**T1: FAILS outright — the verified instrument refuses it, and not as an amendable technicality.** With no Confirmer file, `lib/reconcile.mjs:51` refuses with "missing confirmer record"; §9.5 states the Author and Confirmer "must be different people" and `lib/reconcile.mjs:52` enforces it; with one rater, `lib/ratings.mjs:97` refuses ("≥ 2 independent raters are required") and `lib/analysis.mjs:199` makes `sheet1.rated_by === sheet2.rated_by` a §15.5(3) INCONCLUSIVE condition.
**T2:** Passes — but on a claim so thin it barely matters: the reference is human, and there is nothing to be circular *with*.
**T3: FAILS on both sides simultaneously.** No reference reliability (nothing to reconcile) and no scoring reliability (no α). §20.6's "reference independence is bounded" has no bound; §12's ceiling applies.
**T4:** Vacuously passes, and the pass is meaningless — a model with no replication generates no disagreements to exclude. **This is why T4 must never be read alone: perfect solvency can indicate an absence of measurement rather than an efficient design.**

**Why last.** Model A spends exactly the same two humans as B, C and E and buys **strictly less** with them: it is the only two-human arrangement that estimates *no* reliability at all. It is dominated by C on every test at identical headcount. There is no configuration of the study in which A is the right choice.

---

## 7. Ranking

| Rank | Model | T1 Executable | T2 Non-circular | T3 Reliability | T4 Solvent | Ceiling |
|---:|---|---|---|---|---|---|
| **1** | **E — sealed-reference dual role, machine-scored except attribution** | amendment (largest) | **PASS** | **PASS** (both; α least contaminated) | **PASS** (best) | Rung 3 achievable; frame claim *upgraded* to cryptographic |
| **2** | **B — reference + reference/rating** | amendment (moderate) | **PASS** | **PASS** (both; α inflated, must be declared an upper bound) | **PASS** | Rung 3 achievable with a declared α caveat |
| **3** | **C — two reference observers, deterministic rating** | amendment (smallest) | **PASS** | **FAIL** (no α; **P3 unassessable**) | **PASS** (vacuous at rating) | **Rung ≤ 2** by §12's own text |
| **4** | **A — reference + rating** | **FAIL** (instrument refuses) | pass (vacuously) | **FAIL** (neither) | vacuous | **Rung ≤ 2**, and not executable |
| — | **D — two raters, mechanised reference** | — | **FAIL: C1 + C2** | FAIL (no reference reliability) | — | **REJECTED — circular** |

**Recommendation to the owner, in one line each.** Pursue **E**, with **B** as the pre-agreed fallback if the §5.7.2 register-only pool count fails. Do not settle for **C** without first trying its branch-2 refinement, which is what makes it E. Never adopt **A**. **Reject D** — and reject it on the protocol's own §9.8 cap rather than on argument, so the rejection needs no defending.

---

## 8. What is *not* an input to the ranking, recorded so it is not smuggled in

- **Recruitment difficulty.** Two independent people are easier to find than seven. That is the owner's motive and it is legitimate — but it justified none of the ordering above. E outranks B on α quality and frame strength, not on headcount; both use two people.
- **Amendment effort.** E needs the most protocol surgery and still ranks first. C needs the least and ranks third.
- **Schedule.** Not considered.

## 9. Risks the ranking does not price, and open questions for the owner

1. **Fewer independent participants means fewer potential whistleblowers.** Nothing detects a protocol violation automatically; §15.5(7) and AD-7 (`lib/analysis.mjs:127, 205`) act only on a **declared** one, and §22 row 32's detectability depends on someone speaking up. Seven independent observers are seven potential declarers; two are two. **Unmitigable by any mechanism proposed here**; it belongs in the amended §20.
2. **The empirical pool gate is unanswered.** Whether ≥ 210 register-only-admissible rows exist across the four families is **UNVERIFIED / NOT RUN**. It gates E's frame component and nothing else.
3. **Adverse rating resolution can falsify the run on one rater's call.** With P3's threshold at 0 (`lib/analysis.mjs:212`), a single spurious `MISATTRIBUTED-FILL` yields FALSIFIED. That is a false-negative risk borne by the developer, not a false-positive risk borne by the reader — which is the correct direction, but the owner should choose it knowingly. The mandatory exclusion sensitivity is what keeps the report honest in both directions.
4. **α must be published as an upper bound in B, and per-branch in E.** In both models this is a change to the results artefact, not only to prose.
5. **The stratum proxy retains a residual.** A register-only stratum function cannot be tuned to the drawn sample (frame hash committed before randomness) but could be tuned to general beliefs about CPG — the same residual §20.11 already concedes for the pilot's optimistic bias. Carry it forward as a limitation; do not present it as closed.
6. **Three questions only the owner can answer.** (a) Is a new protocol version acceptable, given that every model here requires one? (b) Is a higher INCONCLUSIVE risk from an unbiased register frame preferable to a defensible-but-curated enumerated frame? (c) Is the owner willing to accept adverse resolution, which makes a SUCCESS harder to obtain and stronger when obtained?

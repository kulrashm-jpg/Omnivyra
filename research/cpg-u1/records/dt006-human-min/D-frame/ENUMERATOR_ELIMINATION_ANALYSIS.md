# ENUMERATOR_ELIMINATION_ANALYSIS — what the independent enumerator protects, and whether a machine can

**Classification: METHODOLOGY REVIEW (PROPOSAL).** Not a protocol change, not an amendment for adoption, not a
registration. **No U1 frame is constructed here and none may be** — the accompanying prototype runs on synthetic
fixtures only. No frozen byte was modified: `research/cpg-u1/**`, `C:/tmp/dt002` and
`research/deeptech-operations/dataset/` are untouched and were read only.

**Sources read.** `CPG_U1_PROTOCOL_004` (`sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`)
§4A.1–§4A.3, §5.1–§5.10 (esp. §5.3, §5.4, §5.5, §5.5.1, §5.5.3, §5.7, §5.7.2, §5.8, §5.9), §6, §6.5, §9.2, §9.6,
§9.7, §9.8, §10.2–§10.5, §11, §12.1–§12.3, §15.1–§15.5, §19.1–§19.3, §20 (esp. 20.12, 20.13, 20.18, 20.20,
20.21, 20.22, 20.23), §21, §22, §23, §24. Instrument (read-only) `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
recomputed **`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`** over 593 files — matches the
brief: `lib/frame.mjs`, `lib/sizing.mjs`, `lib/scan.mjs`, `lib/schema.mjs`, `lib/commitment.mjs`,
`lib/sampling.mjs`, `lib/canonical.mjs`, `lib/aggregate.mjs`, `cpg_u1_data.mjs`. Prior artefacts (read-only)
`C:/tmp/dt004-operations/dataset/` — `ENUMERATOR_WORKSPACE.md`, `ADMISSIBILITY_CHECKLIST.md`,
`JURISDICTION_PARTITIONS.md`, `CONTAMINATION_PROCEDURE.md`, `_rehearsal/`.

Companion documents: `MECHANICAL_FRAME_DESIGN.md` (design, criterion-by-criterion verdicts, sufficiency
arithmetic, prototype), `ATTACK_MATRIX_ENUMERATOR.md` (§22 row by row).

---

## 1. The distinction the brief asks for, stated precisely

Let

- `F` be the frame — the **population**: the complete set of admissible rows, frozen before the development
  commitment (§5.5 "Single frozen frame");
- `S = draw(F, seed)` be the **sample**, with `seed` derived inside the draw commands from a Bitcoin block hash
  at `H_commit + 12` and a drand round fixed by that block's successors (§5.7.1).

The commitment scheme establishes exactly one implication:

> **C:** `sha256(F)` is inside an OP_RETURN digest in a transaction that spends a single-use outpoint, confirmed
> at depth ≥ 6, *before the block at `H_rand` exists* (§5.5.3, §22 rows 1–5). Therefore, **given `F`**, no person
> chose `S`.

`C` is a statement about the **mapping from `F` to `S`**. It says nothing whatever about `F`. A commitment is a
*binding to a value*, not a *derivation of it*: the payload's eleven keys (`lib/commitment.mjs` `PAYLOAD_KEYS`)
carry `frame_hash`, `scan_sha256` and `registry_sha256` — three digests of three authored artefacts — and
nothing that witnesses **how** any of them came to be. Hash `F`, and you have proved that `F` did not change.
You have proved nothing about who wrote it or why those rows and not others.

The protocol says this itself, in three places, and the wording should be quoted rather than paraphrased:

- §20.18: "Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate
  selection (the frame is unbiased); the latter rests on enumerator independence only."
- §23: "**Two claims, never merged:** (1) cryptographic sampling integrity — given the committed frame, no one
  chose the sample; (2) independent candidate selection — the frame is unbiased. Protocols 003–004 strengthen
  (1); protocol-004 additionally specifies the personnel rules on which (2) rests, **without making (2)
  cryptographic**."
- §22 row 31: "Operator authors a globally biased frame · **UNRESOLVED by sampling integrity** · Enumerator
  independence (§4A.2, §19.3)".

**Name the unprotected property.** Call it `P_pop`: *the population was not selected in a way correlated with
the endpoint*. `P_pop` is a property of an **authorship act**, not of a bitstring. That is precisely why no
commitment can carry it: commitments quantify over *changes after the commitment*; `P_pop` is violated *before*
it. Every §22 row of the form "X changed after commitment" (8, 9, 10, 25, 26, 26a) has an unprotected
pre-commitment twin, and all those twins collapse into row 31.

One further precision, because it is easy to overstate what the enumerator delivers. Enumerator independence
does **not** establish that `F` is representative, random or unbiased in any statistical sense — §20.1 already
concedes "no population, customer or jurisdiction generalisation", and §5.7.1 publishes the realised
jurisdiction composition as a limitation rather than controlling it. What §4A.2 delivers is narrower and should
be stated in exactly these terms: **the person who chose the population had no interest in the endpoint and no
knowledge of CPG's behaviour** (§4A.1 items 1–6; §4A.2(b) "not have run CPG or seen any CPG output … before
completing the frame"). It is the *removal of an endpoint-correlated motive*, not the *creation of
representativeness*.

---

## 2. Item 1 — the specific manipulations enumerator independence defeats

For each, what already defeats it and what is left over. "Residual" means: what survives every mechanism in the
protocol **other than** the enumerator's independence.

### M1 — cherry-picking a population where CPG happens to perform well

| Mechanism | Does it defeat M1? | Exactly why / why not |
|---|---|---|
| Commitment (§5.5.3) | **No** | Binds `sha256(F)` after `F` exists. M1 is committed *by* the commitment, not prevented by it |
| Contamination scan (§5.4, `lib/scan.mjs`) | **No** | Detects repository/registry *presence*, which is orthogonal to easiness |
| Sufficiency (§5.7.2, `lib/frame.mjs` → 126/52/32) | **Partially, as a cost** | Forces ≥ 210 eligible admissible rows. A targeted easy population must be built at scale, which raises effort but constrains composition not at all: 210 uniformly easy rows satisfy the rule exactly as well as 210 hard ones |
| Pool minimum (§5.7, `POOL_MULTIPLIER = 2`) | **No** | Guarantees the draw is a *selection* from ≥ 2× quota. Selection from a uniformly easy pool is still easy |
| Publication (§13.2, §15.3 screening log, §5.7.1 realised composition) | **Makes it visible, not falsifiable** | Everything is published — frame, per-row `a1`–`a6`, exclusion reasons, jurisdiction mix. But "these 210 companies are unusually easy for CPG" is not decidable from that: there is no pre-registered comparison population, and no outsider can run CPG at the resolver SHA (§7.1) to measure easiness. §14's replication levels do not include it |
| **Residual** | — | **Full.** M1 is exactly §22 row 31, class UNRESOLVED. Enumerator independence is the only control, and it is a declaration (§4A.1: "These are **procedural evidence, not proof**") |

### M2 — excluding companies known to be hard

This is the sharpest of the four, because the protocol provides a *compliant, cost-free, undetectable* exclusion
channel, and it is the enumerator who operates it.

| Mechanism | Does it defeat M2? | Exactly why / why not |
|---|---|---|
| Commitment | **No** — for pre-commitment exclusion | §22 rows 26/26a/27a close *post-commitment* and *post-pilot* exclusion (frozen frame, frozen registry, held-out scan = development scan). Exclusion at authoring time is untouched |
| Contamination scan | **No, and it helps the attacker** | C1(1)/C1(6) hits move a company to development-only. An operator who wants a company out of held-out and can arrange for its name to appear anywhere in scan scope achieves exclusion mechanically. The scan is deliberately "conservative: a false positive only moves a company to development" (§5.4) — conservative *for contamination*, permissive *for exclusion* |
| C1(2)–C1(5) attestations (§5.3) | **No — this is the channel** | "**For every contamination attestation, `unknown` is treated exactly like `yes`.**" Writing `unknown` on a specific company removes it from held-out, requires no evidence, is not a false statement, and is indistinguishable from honest uncertainty. §15.3 publishes `held_out_ineligible_basis`, so the *count* is visible; the *motive* is not |
| Sufficiency | **Bounds mass exclusion only** | Excluding many companies costs enumeration effort to restore 126/52/32. Excluding ten specific companies costs nothing |
| No-replacement (§5.9) | **Defeats post-draw exclusion, which is a different attack** | "A drawn company is **never replaced**… replacement after the draw lets the reference team reject hard-to-document companies" |
| §6.5 no-preview | **Only if the knowledge came through a logged run** | §20.20: "**Nothing in this protocol can prove that an unlogged private query did not occur** in another environment." Knowledge of which companies are hard can be entirely undocumented |
| **Residual** | — | **A targeted, evidence-free, protocol-compliant exclusion channel with no detection path.** Enumerator independence is what makes it implausible that the person writing `unknown` *wants* a particular company out — and §4A.2 guarantees that person cannot even know which companies are hard, since they have never seen CPG output. **This is the single strongest argument for a human enumerator anywhere in the protocol.** See §5 below for why it nonetheless does not survive scrutiny |

### M3 — including companies already seen in development

| Mechanism | Does it defeat M3? | Exactly why / why not |
|---|---|---|
| Contamination scan C1(1) (§5.4) | **Yes, mechanically, for repository evidence** | `git ls-files` at the resolver SHA over TEST and CPG_IMPLEMENTATION scopes; name variants, domain and identifier at word boundaries; `scan_sha256` committed in both payloads. Outsider-recomputable (§21 step 9) |
| Registry C1(6) (§5.3) | **Yes, for the 13 seeded entries**, frozen at registration | Matching is mechanical; the *list* is complete only by attestation **H2** (§19.2), declared at §20.12: "The development-only registry's completeness rests on an attestation (H2), not on a mechanical proof" |
| C1(3)/C1(4) attestations | Nominally yes; **unverifiable** | §22 row 27: "attestation truthfulness not cryptographic" |
| Held-out commitment binding (§5.5.3) | **Yes, for post-hoc change** | Held-out `registry_sha256` must equal the registered value; differing → `STAGE_VOID_BINDING_MISMATCH` |
| Late discovery (§5.3) | Handled, not prevented | Recorded, published, flagged `CONTAMINATION-DISCLOSED`; "The company is **never excluded, removed or replaced**" |
| **Residual** | — | **Mostly closed, and the closure is mechanical rather than personnel-based.** The gap is a company touched by an *unlogged* private run and absent from the registry — i.e. H2 incompleteness (§20.12) plus §20.20, neither of which the enumerator can see or fix. **Enumerator independence contributes almost nothing here** |

### M4 — choosing a sector mix that flatters the product

| Mechanism | Does it defeat M4? | Exactly why / why not |
|---|---|---|
| Commitment | **No** | As M1 |
| Jurisdiction balance (§5.7.1 D-A) | **No** | Round-robin `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY` *within* the frame; "An exhausted family stops contributing and the others continue". No family quota is enforced anywhere — prior artefacts confirm "Nothing refuses a frame whose `LEI-ONLY` queue is empty" |
| Sector | **Not a protocol concept at all** | No column, no stratum, no quota. `FRAME_COLUMNS` (22 columns) has no sector field. Strata are the three §5.2 outcome classes only |
| Publication (§5.7.1) | **Discloses jurisdiction, not sector** | "The realised jurisdiction composition is published, and missing families are declared as a scope limitation" |
| §20.1 / §20.3 limitations | **Concede rather than defeat** | "no population, customer or jurisdiction generalisation"; "Four accessible jurisdiction families" |
| **Residual** | — | **Full, and invisible.** Sector composition is unconstrained, unpublished as such, and cannot even be audited from the published artefacts without re-classifying every row by hand. The only control is that an independent enumerator has no reason to skew it. Note the interaction with M1: sector is a convenient *proxy* for easiness (disclosure-rich large filers), so M4 is the low-visibility way to execute M1 |

### Summary of item 1

| Manipulation | Closed mechanically | Enumerator load-bearing | Residual severity |
|---|---|---|---|
| M1 cherry-pick easy population | No | **Yes — solely** | High; §22 row 31 UNRESOLVED |
| M2 exclude known-hard companies | No (scan helps the attacker) | **Yes — solely** | **Highest**; targeted, free, undetectable via `unknown` = `yes` |
| M3 include development-seen companies | Largely yes (scan + frozen registry) | Marginal | Low, bounded by H2 (§20.12) and §20.20 |
| M4 flattering sector mix | No | **Yes — solely** | High and *unaudited*: sector is not even a recorded field |

---

## 3. Item 3 — the one-shot pre-registration alternative

**The proposal.** Publish `F` itself inside the registration, before any randomness, before reference truth,
before any rating. The operator would commit to a population knowing nothing about which companies will be
drawn, what the reference values are, or how CPG performs on them.

**What it actually adds over today's ordering.** Today: funding → registration → enumerate `F` → `frame` → `scan`
→ `check-frame-sufficiency` → development commitment (§5.5 steps 0–4). The frame hash is *already* frozen before
any randomness exists (§22 row 2). So publishing `F` in the registration adds **no integrity** against rows 1–5:

| Property | Today | With `F` in the registration |
|---|---|---|
| `F` fixed before `R_dev` exists | Yes (on-chain digest) | Yes (registry timestamp *and* on-chain digest) |
| `F` fixed before reference truth exists | Yes (§9 follows the draws) | Yes |
| `F` visible to outsiders before any result | **No** — `F` is archived and published later (§13.2) | **Yes** |
| `F` open to challenge before results exist | No | **Yes** — this is the one real gain |
| Authority against substitution | Chain (single-use outpoint) | Chain **plus** §5.5.1 authority rule (a second registration with different sampling fields → study VOID) |

So the gain is a **pre-result adversarial-review window**: outsiders can object to the population while no
outcome exists to argue about, which is a genuine methodological improvement in *social* terms. It is not a
cryptographic improvement.

**What residual attack survives? Exactly the one the brief names, and it survives intact.** The operator picks
a population they *expect* to be easy. Publication does not defeat it, for four reasons that should be stated
separately because they fail for different causes:

1. **No outsider can evaluate ex-ante easiness.** Easiness is defined relative to CPG's behaviour at the
   resolver SHA (§7.1 `lookupGroundedCompanyFacts`, the U1 evaluation tree `f01a7eb4…`). Outsiders cannot run
   it. §14's replication levels do not offer it. So the published frame is *inspectable* but not *scoreable*.
2. **Expectation is enough.** The operator need not know outcomes. A population biased in expectation moves
   EFR and AR in expectation. §5.6's own SAFETY = 1.5 is the protocol *conceding* this mechanism in the other
   direction: "Development companies are disproportionately well-known (contaminated), so their pilot yield is
   expected to overstate held-out yield." If the protocol accepts that well-known firms yield more fills, it
   has accepted that composition moves the endpoint.
3. **Legitimate-looking proxies exist.** "Large filers in accessible jurisdictions with rich disclosure" is a
   defensible enumeration strategy *and* an easiness filter. Nothing in §5.1 forbids it; A6 ("reference truth
   obtainable for all three fields") positively *rewards* it.
4. **Absence of a null.** There is no pre-registered universe against which `F` can be compared, so no
   distributional claim can be tested. A published list with nothing to compare it to cannot be falsified.

**What would an outsider need in order to falsify it?** Three candidate instruments, in increasing
practicability:

| Instrument | What it would prove | Feasible? |
|---|---|---|
| Re-run the endpoint on an independently built frame | Composition sensitivity of the endpoint — the direct test | **No.** Requires CPG access at the resolver SHA; U1 is single-arm and the software is not public |
| Publish the **universe** plus the **inclusion rule**, and let outsiders recompute `F` and re-derive from an alternative admissible source | That `F` is not a *hand-picked* subset of the universe, and that a different admissible source yields a comparable population | **Yes** — and this is exactly what mechanisation provides, and what a published `F` alone does not |
| Publish distributional statistics of `F` against the universe on difficulty-correlated features (entity age, disclosure richness, jurisdiction, collision incidence) | That `F` is not visibly skewed on proxies for difficulty | **Yes**, and cheap, but requires a universe definition — i.e. again the mechanical route |

**Conclusion for item 3.** One-shot pre-registration of `F` is **necessary but insufficient**. It buys pre-result
scrutiny; it does not make authorship falsifiable, because there is nothing to check `F` against. The missing
ingredient is not publication of the *result* of enumeration but publication of the *function* that produced it.

---

## 4. Item 2 in brief — can a mechanical construction protect `P_pop`?

Full treatment in `MECHANICAL_FRAME_DESIGN.md`. The answer in one paragraph:

`frame = D(snapshot, predicates)` with both inputs pinned in the public registration converts §22 row 31 from
*"trust an unauditable declaration"* into *"recompute a published function and compare bytes"*. The prototype
demonstrates the computational half: byte-reproducible across runs, refuses an altered snapshot, changes hash on
a predicate change, has **no** run-time parameter, ignores the environment, uses no clock/RNG/network, refuses
any input carrying CPG output — **58 checks, all passing; 24 mutants on the predicate and ordering lines, 24 killed, 0 survived** (the first run killed 18/24; six fixture-coverage gaps were closed and re-run).

But mechanisation **compresses discretion; it does not remove it**. Of §5.1's criteria, A3 and A5 are fully
mechanical (and already computed, not attested); A2 and A4 are mechanical only by *delegating their substance to
the source*; A1, A6 and both class rules are human judgements that can be replaced by *declared proxies*; and
**C1(2)–C1(5) are irreducible** — no external artefact contains facts about the developing organisation's own
history. The honest accounting: **≥ 3 150 private, unauditable human cell-decisions** (≥ 210 rows × 15
judgement-bearing cells of 22) become **41 published predicate parameters plus one source choice and one pin
instant**.

The decisive sub-finding, developed in `MECHANICAL_FRAME_DESIGN.md` §5: **an independent enumerator cannot
honestly answer C1(2)–C1(5) at all.** Someone who has never implemented or run CPG cannot know whether a company
was used in CPG work. Answering honestly they must write `unknown`, and `unknown` = ineligible — which would make
`E_c = 0` and §5.7.2 unsatisfiable. The only way an enumerator writes `no` is if the developing organisation
discloses its history, and that disclosure *is* the frozen development-only registry. So the contamination cells
are **already** operator knowledge carrying an independent signature. Fixing them to `no` in a pre-registration
and delegating ineligibility entirely to the mechanical C1(1) scan and the frozen C1(6) registry is therefore not
a loss of independence — it is the removal of the M2 exclusion channel, at the price of making H2 (§20.12) the
sole safeguard.

---

## 5. The orchestrator's five points, checked

**(1) §4A.2 text.** Verified verbatim against the protocol, lines 154–171. Items (a)–(e) and the
receives/never-receives lists are quoted correctly, including "before completing the frame" in (b) and the five
things an enumerator receives (public sources, frame template, §4A and §5.1–§5.4, jurisdiction-family list,
development-only registry). No correction.

**(2) The temporal reading of (b), and enumerator-as-cheapest-role-to-fold.** The reading of (b) is **correct**:
the bar is temporal, enumeration is first on the evidence chain (§5.5 step 3), and a person who enumerates and
*later* sees CPG output still satisfies (b) literally. The blocking rule is §4A.3: "Every independent role is
held by a different person… The seven independent roles are mutually exclusive: **minimum 7 independent
persons**. Several enumerators are permitted; **each holds no other role**."

**But the conclusion does not follow, and I would not recommend the fold.** Three reasons:

1. **It is not information-clean, even though it is §4A.2(b)-clean.** The information that leaks is not CPG
   output flowing *to* the enumerator; it is the **class prediction** flowing *from* the enumerator into a
   labelling or value-deciding role. §9.2.1 and §12.2 are built to keep the class out of both adjudication
   packets ("Reference adjudication leakage (**class**, split, CPG output…)" and "Rating adjudication leakage
   (rater identity, tallies, **class**, split, pilot)", §22 rows 35–36). A rater who enumerated the row
   *remembers* its class. Blinding the packet cannot blind a memory. So the fold defeats a control the protocol
   implements deterministically, by a channel the protocol cannot inspect.
2. **It does not touch the load-bearing property.** Folding roles changes headcount from 7 to 6. `P_pop` is
   still protected by exactly the same unfalsifiable declaration. §22 row 31 stays UNRESOLVED.
3. **The headcount saving is the same as elimination's.** Removing the enumerator role also gives 6 — without
   introducing a new leakage channel. So the fold is dominated: same cost saving, strictly worse methodology.

**Which is methodologically stronger?** Mechanisation, and not by a small margin. Role-folding is *neutral* on
row 31 and *negative* on rows 35–36. Mechanisation is *positive* on row 31 (class change: declaration →
re-derivable computation), *positive* on row 27 (removes the M2 attestation channel), *vacuous-positive* on rows
35–36 (a derived class has no human author to leak from), and *negative* on exactly two identified axes: H2
becomes the sole contamination safeguard, and the A6/class proxies couple the frame to the source base
(point 4). Those two negatives are **nameable, publishable and bounded**; row 31 is not.

**(3) Does §4A.3's stated reason extend beyond the reference adjudicator?** §4A.3 says: "An enumerator may not be
the reference adjudicator. The adjudicator decides contested reference values, and **the enumerator authored the
class predictions whose mismatches with reference truth are published (§9.2, §9.7)**."

Taking the protocol's own rationale as the guide, the reason generalises to **every role that decides a value or
a label for a company whose class that person predicted** — because §9.7 makes the prediction/truth mismatch a
*published* artefact, which gives its author a stake in the comparison:

| Role | Does the §4A.3 rationale extend? | Why |
|---|---|---|
| Reference **adjudicator** | Yes (explicit) | Decides contested values whose mismatch with the author's own prediction is published |
| Reference **Author** / **Confirmer** | **Yes** | They *originate* the values the mismatch is computed against (§9.4 authority by field). An author who predicted `abstention-expected` and then searches for that company's values has a documented interest in finding none. §9.3's `constructed_without_cpg` attestation does not cover this |
| **Rater 1 / 2** | **Yes** | §10.2's judgement calls (`REFERENCE-AMBIGUOUS`, the 10 % and 24-month rules) are where a remembered class would act, and §12.2 excludes the class from the packet precisely because it must not influence labelling |
| **Rating adjudicator** | **Yes**, a fortiori | Same as the reference adjudicator, one level up |
| **Operator** | Moot | §4A.3: no independent role may be held by the operator, and the operator is not independent |

So the rationale does **not** stop at the reference adjudicator; the explicit clause is the sharpest instance
rather than the whole rule. The one role where it genuinely does not bite is a second **enumerator** — hence
§4A.3's "Several enumerators are permitted". This is a second, independent argument against folding the
enumerator into a rating or reference role, and it comes from the protocol's own reasoning rather than from this
review's preference.

**(4) §15.5 condition 5 / SOURCE-COINCIDENT.** Verified: §9.8 "each observation is classified `INDEPENDENT` or
`SOURCE-COINCIDENT` (reference and CPG cite the same document). **If SOURCE-COINCIDENT exceeds 60% of scored
observations, the run is INCONCLUSIVE**", restated as §15.5 condition 5. The point is well taken and the analysis
is in `MECHANICAL_FRAME_DESIGN.md` §6. Three findings in short: (i) a baseline coupling already exists and is
not caused by mechanisation — §5.1 A3 admits only `CIK`/`SIREN`/`CNPJ`/`LEI` identifiers and §9.2 makes
`REGISTRY_RECORD` and `REGULATORY_FILING` the TIER_1 authorities, so every U1 frame is already tied to the
registries CPG resolves; (ii) mechanisation adds coupling at exactly two predicates, the **A6 proxy** and the
**fill/abstention class proxy**, both of which would read "does this source record field-bearing filings?" and so
select for companies whose facts live in CPG's own source base; (iii) the mitigation is to use the snapshot for
*identity, order, identifier and domain* but to take the class/A6 proxy from a **different** pre-registered
source, or to leave the class as the one surviving human judgement. Given that §15.5(5) can void the entire run,
this is a live design risk and not a footnote.

**(5) Sizing.** Verified and reconciled with the code, not from memory: `lib/sizing.mjs`
`SIZING = {MIN_FILLS: 20, SAFETY: 1.5, CAP_FILL_EXPECTED: 60}`; `HELD_OUT_BASE = {12, 5, 3}`;
`DEVELOPMENT_QUOTA = {6, 2, 2}`; `POOL_MULTIPLIER = 2`. `enumeratePilotOutcomes()` over all 4 096 permitted
pilot outcomes returns `{"outcomes":4096,"halts":1,"refused":0,"maxQuotas":{60,25,15}}`, and `FRAME_MINIMUM`
computes to `{126, 52, 32}` = 210. Drawn-sample range 12/5/3 = 20 companies = **60 observations** up to
60/25/15 = 100 companies = **300 observations** (3 fields). The frame floor is larger for two independent
reasons — the §5.7 pool minimum (`2 × Q`) and the §5.8 development consumption (`+ Dev`) — giving
`E_c ≥ 2·Qmax_c + Dev_c`. `MIN_FILLS = 20 = 1 ÷ θ_EFR` (θ_EFR = 0.05, §10.3 P1) is the same 20 as G1's
assessability gate. Full table, per-`T`, in `MECHANICAL_FRAME_DESIGN.md` §7. No correction to the orchestrator's
figures.

---

## 6. Verdict

**Is a human irreducible at the enumerator position?** Two answers, and they must not be merged:

1. **For constructing the population: no.** A1–A6, the class rules, uniqueness, C1(1) and C1(6) can all be
   decided from a pinned external snapshot plus pre-registered predicates, with zero run-time discretion, and
   the result is byte-reproducible by any outsider. A3, A5, C1(1), C1(6) and uniqueness are *fully* mechanical;
   A2 and A4 become the source's claims; A1, A6 and the class rules become declared proxies whose fidelity must
   be published as a limitation.
2. **For the property the position exists to protect: a human judgement remains, one level up, and it is the
   operator's.** Someone chooses the source, the pin instant and 41 predicate parameters, knowing what CPG is
   good at. `P_pop` is therefore **not** established by mechanisation either. What changes is its *class*: from
   an unfalsifiable declaration by a person an outsider cannot audit, to a published function an outsider can
   recompute, disagree with, and re-derive from an alternative admissible source.

**Recommendation (for the owner, not for adoption here).**

- Do **not** fold the enumerator into another role. It saves nothing that elimination does not, and it defeats
  §9.2.1 / §12.2 blinding through memory (§22 rows 35–36), against §4A.3's own stated rationale.
- If the enumerator is to be eliminated, eliminate the *role*, not the *independence*: replace it with a
  pre-registered derivation whose **source admissibility criterion S1 (not controlled or influenced by the
  developing organisation) is non-negotiable**. A re-derivable frame built from a source the organisation
  controls is *worse* than today, because it wears a proof.
- Adopt the one-shot publication as well, not instead: register the snapshot digest, the predicate set and the
  pin instant, and publish the derived frame. Re-derivability is what makes the publication falsifiable.
- Keep one human judgement deliberately, if one must be kept: the **class prediction**, because that is where
  mechanisation risks §15.5(5) INCONCLUSIVE by coupling the strata to CPG's own source base. This is the single
  most defensible place for a residual independent human, and it is *not* where the protocol currently places
  the weight of the argument.
- Accept explicitly, in writing, that fixing C1(2)–C1(5) to `no` makes H2 (§20.12) the sole contamination
  safeguard — and note that this is the *honest* description of the status quo as well.

**Two open owner questions arising** (neither resolvable in this stream): (a) §15.3's `screened_by`, §4A.3's
"minimum 7 independent persons" and `check-personnel` all expect *people* where a derivation identity would sit —
that is a protocol amendment, not a patch; (b) if the class prediction is retained as a human judgement while
everything else is derived, the person holding it is an enumerator in all but name, and §4A.3's mutual-exclusion
arithmetic must be restated rather than quietly reinterpreted.

---

## 7. Incidental correction to prior artefacts (read-only; not edited)

`C:/tmp/dt004-operations/dataset/ENUMERATOR_WORKSPACE.md` (twice: §1 and §6) and `ADMISSIBILITY_CHECKLIST.md`
(Part A check 1) state that the frame header is "exactly the **23** columns". The frozen instrument has **22**:
`FRAME_COLUMNS.length === 22` in `lib/schema.mjs`, and `templates/candidate_frame.template.csv`'s header has 22
fields. Both documents' own tables list 22 numbered rows, so the prose count is an off-by-one, not a schema
disagreement. Recorded here rather than corrected, because those artefacts are outside this stream's write
scope.

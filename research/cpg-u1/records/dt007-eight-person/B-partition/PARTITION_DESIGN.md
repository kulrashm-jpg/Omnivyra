# DEEPTECH-PARALLEL-007 · AGENT B · PARTITION_DESIGN

**Objective.** Design the partition by which **two enumerators build ONE protocol-valid frame**, under
`CPG_U1_PROTOCOL_004` (sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`) and the
frozen instrument (aggregate `<NEW_AGG>`, <NEW_N> files).

**Status.** METHODOLOGY + DESIGN only. No protocol byte changed, no frame, no enumeration, no company,
no registration. Nothing here reduces the frame minimum (§5.7.2), admissibility (§5.1), contamination
(§5.3) or identifier (A3) requirements.

---

## 0. What the instrument already permits, verified in code

| Fact | Where | Consequence for a partition |
|---|---|---|
| `frame_hash = hashRecords(frame, 'candidate_id')`, and `canonicalRecords` **sorts by `candidate_id` before hashing** | `lib/canonical.mjs:17-22` | The frame hash is **order-independent**. Two enumerators' CSVs can be concatenated in any order and the committed `frame_hash` is identical. The merge needs no negotiated row order. This is the single most important enabling fact. |
| `FRAME_COLUMNS` carries `enumerated_by`, `enumerated_at`, `enumeration_source_url`; `enumerated_by` is enforced non-empty | `lib/schema.mjs:31-33`, `checkFrameRow` | Per-row attribution of two enumerators needs **no schema change**. |
| §4A.3: "Several enumerators are permitted; each holds no other role." | protocol §4A.3 | Two enumerators are already protocol-valid; each adds one person to the ≥ 7 independent minimum. |
| `assertUnique` refuses a duplicate `scheme:identifier` **or** a duplicate `canonical_domain`, and it is called from `frameSufficiency` | `lib/select.mjs:44-51`, `lib/frame.mjs:44` | A cross-enumerator duplicate does not merely waste work: it makes `check-frame-sufficiency` **throw**. Duplicate prevention is a hard precondition, not an efficiency concern. |
| `loadFrame` marks a repeated `candidate_id` as a malformed row | `cpg_u1_data.mjs:99` | The `candidate_id` namespace must be partitioned before work starts. |
| The screening log's `screened_by` comes from a **single** `--screened-by` argument for the whole log | `cpg_u1_data.mjs:142`, `:427`, `:522` | §15.3's `screened_by` **cannot express two screeners per row**. See §6 below. |
| `check-frame-sufficiency`, `frame`, `scan`, `pool-check` are whole-frame commands that run no CPG | `cpg_u1_data.mjs:615-623`, `:200-264`, `:471-481`; header "Creates no key, transaction, registration or seed input" | The operator can compute sufficiency without any §6.5 preview exposure. |

---

## 1. The two structural tests a partition must pass

A partition of enumeration work must be:

* **T1 — ex-ante computable.** The assignment key must be knowable *before* a candidate is researched.
  A key that is an *output* of enumeration is not a partition; it is a post-hoc stratification, and it
  guarantees wasted work.
* **T2 — quota-silent.** §4A.2's receive-list is **exhaustive**: "Enumerators receive only: public
  sources; the frame template; §4A, §5.1–§5.4; the jurisdiction-family list; the development-only
  registry." §5.7.2 is **not** on it, and §5.5.3's Enumerator barrier adds "Enumerators never receive
  pilot, sizing or quota information." So the *instruction that defines each enumerator's share* must
  carry no per-class number and no per-class ratio.

T2 is sharper than it first looks. 126 : 52 : 32 reduces to 2.42 : 1 : 0.615. **Any proportional
per-class instruction discloses the quota structure**, because the ratio *is* the quota ratio.

---

## 2. The five candidate schemes

### (a) By jurisdiction family — `US-SEC` / `FR-SIRENE` / `BR-CNPJ` / `LEI-ONLY`

| Test | Verdict |
|---|---|
| Deterministic and pre-registrable | **Yes.** The four families are frozen in `JURISDICTION_FAMILIES` / `FAMILY_ORDER` (`lib/schema.mjs:41-49`) and the family list is already material the enumerator receives (§4A.2). A two-line assignment ("A works US-SEC and LEI-ONLY; B works FR-SIRENE and BR-CNPJ") is fully pre-registrable. |
| T1 ex-ante computable | **Yes.** The family follows from the *search locus*: a candidate found in a US filing register is `US-SEC`. The enumerator never researches a candidate only to discover it belongs to the other enumerator. |
| Prevents duplicate work | **Almost.** Disjoint at the national families, but **not automatically at `LEI-ONLY`**: a US, French or Brazilian registrant that also holds an LEI could be written as its national family by one enumerator and as `LEI-ONLY` by the other — two rows for one entity, which `assertUnique` turns into a thrown `check-frame-sufficiency`. Closed by one operational instruction (§4 below), grounded in §5.1's own sentence "A company from an inaccessible jurisdiction is admissible only as `LEI-ONLY`". |
| Keeps each enumerator independent | **Yes**, and with no information flow between them at all. |
| Lets sufficiency be computed | **Yes**, but only by the operator on the merged frame — neither enumerator can see it (§5). |
| Shortfall coverable without seeing the other's rows | **Yes.** A top-up instruction is "produce more rows in *your* families", which references nothing of the other's work. |
| T2 quota-silent | **Yes.** "Work these families, produce ≥ M rows" carries no class information. |

**The one real cost, which no other scheme has:** enumerator identity becomes **perfectly confounded with
jurisdiction family**. §5.7's decision D-A publishes the realised jurisdiction composition, and §4A.1
provides that a false declaration makes "the frame ... not independent (§20.18)". Under (a), any
enumerator-specific systematic error — a lax reading of A4, a habit of answering a contamination
question `unknown` — lands on **one whole family** and is indistinguishable from a jurisdiction effect.

### (b) By outcome class — fill-expected / abstention-expected / identity-hazard

**Rejected, on three independent grounds; the first is fatal.**

1. **Fails T1.** §5.2 defines the class as "the enumerator's **prediction**". `expected_outcome_class`
   is a column the enumerator *fills in*; `checkFrameRow` even provides `unknown` →
   `OUTCOME_CLASS_NOT_ESTABLISHED` for the case where the enumerator cannot decide. The class is an
   **output** of the work. An enumerator assigned `abstention-expected` who researches a candidate and
   concludes `fill-expected` has produced a row they may not keep and may not hand over. This is not a
   partition.
2. **Fails T2.** The three per-class asks are unequal (126 / 52 / 32 before gross-up). A class partition
   forces the operator to hand each enumerator *their class's own volume*, which is the §5.7.2
   threshold up to the yield factor. That is quota information delivered to an enumerator, in
   substance — a §5.5.3 Enumerator-barrier breach however it is worded. A jurisdiction instruction
   discloses nothing, because "produce M rows across your families" is one number with no class content.
   *(This is the coordinator's argument; I confirm the conclusion but on the stronger ground that the
   per-class VOLUME, not the mere naming of a class, is what leaks. Enumerators already know the three
   classes exist and that they "serve sampling balance only" — §5.2 is inside the §5.1–§5.4 material
   they receive. The leak is arithmetic, not nominal.)*
3. **Maximises unrecoverable shortfall.** Sufficiency is per class. Under (b), a shortfall in a class can
   be covered only by the one enumerator who works that class — the other has no competence in it and
   no rows to give. It removes the only redundancy parallelisation offers.

### (c) Alphabetical / registry-order split of a shared candidate list

Passes T1 and T2 and prevents duplicates perfectly. **Blocked by a prerequisite the protocol does not
provide:** it requires a *shared candidate list to exist before enumeration*, and there is no such
artefact.

* If the **operator** builds the list, the operator has chosen the frame's candidates. §20.18 already
  concedes that "the frame is unbiased ... rests on enumerator independence only"; an operator-built
  candidate list hollows that out entirely. Unacceptable.
* If the **enumerators** build it jointly, they are co-authoring and each sees the other's candidate
  choices — and §4A.2's receive-list does not include another enumerator's material.
* If it is built **mechanically from a named public register in register order**, it is clean — but that
  definition would have to be a registered artefact, and §19.1's registration contents and §19.3's
  named prerequisites contain no candidate-universe definition. Adding one is a protocol change, which
  is out of scope here.

Also: alphabetical order is not neutral. It correlates with language and country, so an A–M / N–Z split
partially reproduces (a)'s confounding without (a)'s clarity.

### (d) Hash-derived split of identifiers

**Analytically the best scheme, and unavailable.** A hash split over `sha256(seed | scheme:identifier)`
would be family-blind, so each enumerator receives ~half of every family: effort-balanced by
construction (**exact 2.00× before serial cost**, see `WORKLOAD_ARITHMETIC.md` §5) and with enumerator
error spread evenly across families and classes, which is exactly the confounding that defeats (a).

It **fails T1**. The decisive identifier is established by A3 *during* enumeration — you cannot hash an
identifier you do not yet have. Hashing a name instead needs the name first, i.e. a shared candidate
list, so (d) collapses into (c) and inherits (c)'s blocking prerequisite.

### (e) Both enumerate everything, rows cross-checked

**Not a saving, and probably not permitted.**

* Two people doing the whole frame is 2× the effort for a **1.00× makespan** — a quality measure, not a
  parallelisation. It is the right answer to a different question.
* Worse, the cross-check step appears to be **forbidden as written**. To cross-check B's row, A must
  *receive* B's row, and §4A.2's receive-list is exhaustive and does not include another enumerator's
  rows. A bounded version (each re-screens a pre-registered 10% sample of the other's rows, to publish
  an inter-enumerator agreement rate against §20.18) is the most valuable thing on this page that I
  cannot recommend, because its permissibility turns on that reading. **Open owner question OQ-3.**

---

## 3. Recommendation

> **Scheme (a), jurisdiction-family partition, in the effort-balanced pairing
> A = {`US-SEC`, `LEI-ONLY`}, B = {`FR-SIRENE`, `BR-CNPJ`}, with a qualitative quota-free class
> instruction, a +30% base over-ask, a +15% per-half straggler over-ask, two integration rounds, and a
> *global* (never per-class) continue signal.**

Reasons, in order of weight:

1. It is the **only scheme that passes T1 and T2 and needs no new registered artefact**. (b) fails T1
   and T2; (c) and (d) need a candidate-universe definition the registration does not have; (e) is not
   a saving.
2. **The pairing matters and is counter-intuitive: pair the hardest family with the easiest.**
   `{US-SEC, LEI-ONLY}` vs `{FR-SIRENE, BR-CNPJ}` gives 100.4 h vs 96.1 h — **4.3 h of idle time and
   97.9% efficiency**. The obvious geographic pairing `{US-SEC, FR-SIRENE}` vs `{BR-CNPJ, LEI-ONLY}`
   gives 89.7 h vs 106.8 h — **17.1 h idle, 92%**. Same work, same protocol, 17 hours of difference
   from the pairing alone.
3. It puts `LEI-ONLY` — the catch-all that `§5.1` assigns to *inaccessible* jurisdictions — in the same
   head as `US-SEC`, which removes the largest single source of cross-enumerator entity collision
   (a US registrant holding an LEI) by construction rather than by adjudication.
4. Shortfall is coverable by a top-up instruction that references nothing of the other enumerator's work.

**What I am not pretending.** Recommendation (a) accepts the enumerator/family confounding described
above. It is the price of the only workable scheme, it must be **declared in advance as a scope
limitation alongside §20.18 and §20.3**, and the realised per-family `enumerated_by` composition should
be published next to the D-A jurisdiction composition so a reader can see the confounding rather than
having to infer it. That publication costs nothing — `enumerated_by` is already a frame column.

---

## 4. The instructions, verbatim-ready

Each enumerator receives **exactly** the §4A.2 material, plus:

1. **Family assignment.** "You enumerate candidates in these jurisdiction families only: *<their two>*."
2. **The disjointness rule** (grounded in §5.1's "A company from an inaccessible jurisdiction is
   admissible only as `LEI-ONLY`"): "Assign the **most specific accessible family**. Use `LEI-ONLY`
   only for an entity whose jurisdiction is not one of the three accessible national families." This
   makes the partition disjoint at the entity level and prevents the `assertUnique` throw.
3. **`candidate_id` namespace.** "Your `candidate_id` values begin `E1-` / `E2-`." (Satisfies
   `/^[A-Za-z0-9_-]{1,64}$/` and makes a `candidate_id` collision impossible.)
4. **`enumerated_by`.** "Write your pseudonymous register ID in `enumerated_by` on every row."
5. **Volume.** "Produce at least **M** rows." One number. No class content.
6. **The class instruction — qualitative only.** "Rows must cover all three outcome classes of §5.2.
   `fill-expected` will be the commonest; deliberately seek candidates of the other two kinds as well."
   No number, no ratio, no threshold. *This one sentence is worth 98.6 h — see
   `WORKLOAD_ARITHMETIC.md` §3.*

---

## 5. What each enumerator may be told about progress — and who computes sufficiency

**A timing fact that dissolves most of the apparent conflict.** §5.5's ordered pipeline puts
enumeration at **step 3** and the development pilot and sizing at **steps 7–8**. During enumeration the
pilot has not run and the sizing function has not been applied, so **there is no pilot result and no
sizing output in existence to leak**. §4A.2's prohibitions on "pilot results, sizing output ... or any
CPG output" are, during enumeration, temporally vacuous. The live prohibitions are §4A.2(b) — the
enumerator must not have seen any CPG output *before completing the frame* — and the barrier on **quota
information**, which is not time-dependent because 126 / 52 / 32 is a constant.

| May be told | Why permitted |
|---|---|
| Their own running count of submitted rows, and which of their own rows were malformed | Their own work; §4A.2 constrains what they *receive*, not what they know of themselves. |
| Their own rows' `checkFrameRow` result (`frame` run on their batch alone) | The command reports admissibility and contamination per row. It reveals nothing about the other enumerator and nothing about quotas. This is the single most valuable feedback available and it should be given every round: it is what stops an enumerator repeating a systematic A4 mistake 200 times. |
| A **global** "CONTINUE" / "STOP" signal | §5.7.2 itself requires it: "If unmet, no development commitment may be made; **enumeration continues first**." Something must say *continue*. A global signal names no class and carries ≤ 1 bit. |
| Their own family assignment and their own volume ask | No class content (§4 above). |
| **Not** told: the combined per-class eligible-admissible counts | Not a §4A.2 breach by the letter, but it is the number from which 126 / 52 / 32 is trivially inferred over two rounds ("we have 118 fill-expected, get 8 more"). It is quota information in all but name. Withhold it. |
| **Not** told: a **per-class** CONTINUE/STOP signal | Over rounds this enumerates the thresholds. This is the grey case the owner must close explicitly — **OQ-1**. I recommend against it, and the arithmetic shows the global signal costs little because a properly buffered ask needs at most one top-up. |
| **Not** told: anything of the other enumerator's rows, identities or volume | Not on the exhaustive receive-list. |
| **Not** told: pilot, sizing, quotas, any CPG output | §4A.2, §5.5.3 explicitly. |

**Who computes sufficiency: the operator, and this creates no §5.5.3 or §6.5 problem.**

* §5.7.2 names the tooling that enforces it — `check-frame-sufficiency`, `commitment-payload` — and
  those are operator commands. The operator is the key custodian, is explicitly **not independent**
  (§4A.3), and is barred from *no* frame information. The Enumerator barrier runs one way.
* **No §6.5 preview.** `check-frame-sufficiency` (`cpg_u1_data.mjs:615`) loads the frame CSV, runs
  `checkFrameRow`, applies the scan and registry, and counts. The tool's own header records that it
  "Contains no company and no fact ... Creates no key, transaction, registration or seed input", and
  §6.5 states "the registered tooling runs no CPG". A count is not an execution of CPG and not a
  reading of stored CPG output. The operator must separately abstain from looking up frame companies in
  stored CPG logs, which §6.5(c) covers for *every* frame company until the held-out round — but that
  obligation exists with one enumerator too and is not created by the partition.
* **No §9.6 problem.** §9.6's operator separation is about *reference values* ("the operator receives
  the seal hash only"), which are produced at step 12, long after the frame. Frame counts are not
  reference truth.
* **The residual risk is real and the partition makes it worse.** The operator sees the whole frame
  before the commitment and decides when to stop enumerating. §5.5's cryptographic answer is that
  `frame_hash` enters the commitment digest before the randomness block exists, so the operator cannot
  select *against the draw*. It does **not** stop the operator steering *composition* through top-up
  instructions. Under a jurisdiction partition, a top-up instruction is inherently targeted ("more
  rows in *your* families"), so the steering channel is wider than with a single enumerator. Mitigation
  that costs nothing: pre-register the top-up rule as mechanical — *"if the merged frame is
  insufficient in any class, every enumerator continues in their assigned families in the same manner
  until the next barrier"* — so the operator's only degree of freedom is **stop / continue**, not
  *what*. **OQ-2** asks the owner to adopt that wording.

---

## 6. Two instrument frictions the design must live with (neither needs a frozen byte changed)

**F-1. `screened_by` cannot name two screeners.** §15.3 lists `screened_by` per row, but the writer
takes one `--screened-by` string for the whole log (`cpg_u1_data.mjs:142`, `:427`, `:522`). With two
enumerators the value must be a **panel designator** (e.g. `ENUM-PANEL-01`) whose membership is in the
personnel register, and per-row attribution is recovered by joining the sealed screening log to the
sealed frame on `candidate_id` — the frame's `enumerated_by` is per-row and is inside `frame_hash`.
Both artefacts are in §13.2A's sampling archive, so the join is available to any outside verifier. No
information is lost; it is one join away. This should be stated in the registration so a verifier is
not surprised.

**F-2. The merge must be validated before it is hashed.** The order-independence of `frame_hash` makes
the merge trivial, but `assertUnique` operates on **canonical domains and `scheme:identifier` pairs**,
which the `candidate_id` prefixing does *not* protect. The operator's per-round barrier must therefore
run, in this order: concatenate → `frame` (structural + duplicate `candidate_id`) → dedupe check on
domain and identifier → `scan` → `check-frame-sufficiency`. A collision found here is resolved by the
**operator dropping one row under a pre-registered tie-break** (e.g. keep the row with the earlier
`enumerated_at`, then the lexically smaller `candidate_id`), because the alternative — asking an
enumerator to arbitrate — would require showing them the other's row. Pre-register the tie-break.

---

## 7. Risks

| # | Risk | Severity | Mitigation available now |
|---|---|---|---|
| R-1 | Enumerator/family confounding: an enumerator-specific error becomes a jurisdiction effect (§20.18, §20.3) | **High** — intrinsic to the recommendation | Declare in advance; publish realised `enumerated_by` × family composition next to the D-A composition |
| R-2 | Cross-family entity collision (national registrant also entered as `LEI-ONLY`) makes `frameSufficiency` **throw** | High, fully preventable | §4's most-specific-family rule + operator dedupe before `scan` + pre-registered tie-break |
| R-3 | Operator steers composition through targeted top-up instructions | Medium; widened by the partition | Pre-register the mechanical top-up rule (OQ-2); global continue signal only |
| R-4 | A per-class continue signal leaks the thresholds over rounds | Medium | Global signal only; buffer the ask so one top-up suffices |
| R-5 | Straggler: a disjoint partition gives neither enumerator sight of the other, so no in-flight covering | Medium | +15% per-half over-ask (quantified as a 10% speedup tax in `WORKLOAD_ARITHMETIC.md` §7b) |
| R-6 | An enumerator's §4A.1 declaration later found false ⇒ "the frame is not independent" — and under (a) the taint maps onto named families | High, unmitigable by design | §4A.1 declarations and organisational confirmation before any material is released; this is the argument for (d) if the owner can supply a registered candidate universe |
| R-7 | A second enumerator adds a person to the ≥ 7 independent minimum and a further §4A.1 exclusion-period check; one failed check blocks the frame | Medium | Vet both enumerators before releasing any material (§4A.1 item 5 requires the fee agreement *before* release) |
| R-8 | `unknown` on any contamination attestation makes a row ineligible (§5.3, enforced) — a second enumerator doubles the chance of a systematic `unknown` habit | Medium | Give each enumerator their own `frame` output every round (§5); it surfaces the habit in round 1, not at the barrier |

## 8. Open owner questions

* **OQ-1.** Is a **per-class** CONTINUE/STOP signal to an enumerator a §5.5.3 Enumerator-barrier breach?
  I recommend treating it as one and using a global signal. Needs an explicit decision because §5.7.2's
  "enumeration continues first" presupposes *some* signal.
* **OQ-2.** Adopt a mechanical, pre-registered top-up rule so the operator's only choice is
  stop/continue, not composition? (Closes R-3.)
* **OQ-3.** May one enumerator receive a **sample of another enumerator's rows** for a blind
  re-screen, to publish an inter-enumerator admissibility agreement rate against §20.18? §4A.2's
  receive-list is exhaustive and does not include it. If permitted, it is the best available answer to
  R-1 and R-6, at roughly +10% effort.
* **OQ-4.** Is the **protocol document itself public during enumeration**? §13.2 lists it among
  published artefacts and §5.5.1 requires a public registration naming `protocol_sha256`; §4A.2 permits
  "public sources". If the full text is attached at registration, `E ≥ 126 / 52 / 32` (a
  `PROTOCOL_MARKERS` string, `cpg_u1_data.mjs:285`) is a public source and the quota barrier is porous
  for any enumerator who reads it. Either the text is withheld until results publication, or the
  barrier must be restated as a *delivery and use* rule with an enumerator declaration not to consult
  §5.5 onwards.
* **OQ-5.** Confirm the panel designator for `--screened-by` (F-1) and record the frame↔log join in the
  registration.
* **OQ-6.** Approve the pre-registered domain/identifier collision tie-break (F-2).

---

## Sources read

Protocol `CPG_U1_PROTOCOL_004.md` §4A.1–§4A.3, §5.1, §5.2, §5.3, §5.4, §5.5 (pipeline), §5.5.1, §5.5.3,
§5.6, §5.7, §5.7.1, §5.7.2, §5.8, §5.9, §5.10, §6.5, §9.6, §9.7, §13.2, §13.2A, §15.3, §15.5,
§20.3/§20.18/§20.20/§20.21/§20.22.
Instrument: `lib/schema.mjs`, `lib/frame.mjs`, `lib/sizing.mjs`, `lib/scan.mjs`, `lib/select.mjs`,
`lib/canonical.mjs`, `lib/identifiers.mjs`, `rules/development_only_registry.json` (13 entries),
`cpg_u1_data.mjs:93-104` (`loadFrame`), `:106-125` (`contamination`), `:140-158` (screening log),
`:204-220` (`cmdFrame`), `:222-264` (`cmdScan`), `:427`, `:471-481` (`pool-check`), `:522`,
`:615-623` (`cmdCheckFrameSufficiency`).

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


# INFORMATION_ACCESS_MATRIX — six phases × what each enumerator may know

**CLASSIFICATION: PREPARATION. A rule about MATERIAL, not about persons.**
DEEPTECH-PARALLEL-010 · STREAM D · directive §7

**No person exists. No one has been recruited, approached, engaged or named, and nothing has been
released to anyone.** `SYN-ENUM-A` / `SYN-ENUM-B` are synthetic slot tokens. **Nothing here amends the
protocol.** §4 raises conflicts and refers them; every referred item says so explicitly.

Baseline: `CPG_U1_PROTOCOL_004.md`
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; candidate instrument aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files), read-only.

---

## 1. The governing wording, quoted exactly

§4A.2, protocol lines 163–170, verbatim:

> **Enumerators receive only:**
> - public sources;
> - the frame template;
> - §4A, §5.1–§5.4;
> - the jurisdiction-family list;
> - the development-only registry.
>
> **They never receive:** pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2).

§5.5 step 6, protocol line 288: *"**Enumerator barrier.** Enumerators never receive pilot, sizing or
quota information (§4A.2)."*

**Two structural facts that govern the whole matrix, carried forward from
`C:/tmp/dt009-closure/F-enumerators/KNOWLEDGE_WINDOW_RULE.md` §1:**

1. **The receive-list is CLOSED.** The operative word is *"only"*. Anything not on those five lines is
   already unreceivable, so adding to the never-receive list adds no restriction.
2. **The never-receive clause is a specification, not the boundary.** It names the four categories
   someone might otherwise think helpful, and cites §5.5 and §5.7.2 accurately.

**The consequence for a phase matrix, and it is the single most important line in this document:**

> **§4A.2 has no phase qualifier. The permitted set does not grow from phase to phase.** The five
> permitted items are the same in every phase of the study. What changes across phases is only:
> (a) whether the material has been **released** (a single joint act — `MATERIAL_RELEASE_JOINT_GATE.md`);
> (b) whether the **registered** protocol hash and `registry_sha256` exist yet to re-check the material
> against (§5.3 freeze; P1-3); and (c) whether a formerly-withheld artefact has since become a
> **public source** by §18 publication (see §4, scope note S-1).
>
> So this matrix is not a widening staircase. It is one closed envelope, plus a release event, plus one
> publication effect.

---

## 2. THE MATRIX

`P` = permitted · `W` = withheld (not on the closed list) · `R` = permitted but **not yet released**
· `—` = no such object exists in this phase.

| Object | PRE-REGISTRATION | REGISTRATION | **ENUMERATION** | REFERENCE | RATING | ANALYSIS |
|---|---|---|---|---|---|---|
| Public sources (registers, filings, entity sites) | P | P | **P** — this is the work | P | P | P |
| The frame template (`FRAME_COLUMNS`, 22 columns, **no values**) | R | P | **P** | P | P | P |
| §4A (independence, eligibility, roles) | R | P | **P** | P | P | P |
| §5.1 admissibility · §5.2 classes · §5.3 held-out ineligibility · §5.4 scan scope | R | P | **P** | P | P | P |
| The jurisdiction-family **list** (`US-SEC / FR-SIRENE / BR-CNPJ / LEI-ONLY`) | R | P | **P** | P | P | P |
| The **development-only registry** (13 seeded entries) | R — and must be re-checked against the **registered** `registry_sha256` once it exists (P1-3) | P | **P** — C1(6) is unanswerable without it | P | P | P |
| Their **own** rows, their own running count, their own per-row `checkFrameRow` diagnostics | — | — | **P** — not a §4A.2 grant; §4A.2 governs what an enumerator *receives*, not knowledge of their own work (DR-8 A6) | P (their own, historical) | P | P |
| **Their own** jurisdiction assignment and `candidate_id` prefix | R | **NOT on the §4A.2 list** — see K-3, **DECISION REQUIRED** | **operationally unavoidable** | — | — | — |
| The declaration form, the fee agreement | R (prepared, not released; §4A.1 item 5 ordering bites on release) | P (§4A is granted) | P | P | P | P |
| The submission channel, format, deadline | R | **not on the list** — K-3 | operationally unavoidable | — | — | — |
| §5.5 onward — commitments, randomness, ordering, tie-breaking, pool minimum | W | W | **W** | W | W | W |
| §5.7.2 frame sufficiency, i.e. `E ≥ 126 / 52 / 32` | W | W | **W — expressly cited in the never-receive clause** | W | W | W |
| Aggregate quality of the accumulating pool; "how close are we" | W | W | **W** (X-1; K-2 ambiguity) | W | W | W |
| Any statistic over the **combined** frame (counts, class distribution, coverage report) | — | W | **W** | W | W | W |
| **The other enumerator's** rows, identifiers, domains, names, volume, count, progress, identity | — | W | **W — the strongest item on the list** (X-3; §22 row 31 channel) | W | W | W |
| The other enumerator's **scope** (that someone holds the other two families) | — | **disclosed as a side-effect of the assignment** — bounded to scope, never identity, never rows | disclosed | disclosed | disclosed | disclosed |
| §5.4 **scan output** — the scan artefact, `scan_sha256`, C1(1)/C1(6) determinations over the frame | — | W | **W — but see K-4, CONFLICT AS WRITTEN** | W | W | W (public after §18 — S-1) |
| Late-discovered contamination recorded under §5.3 after registration | — | — | W | W | W | W |
| Pilot results, the instrument check | — | — | **W — never-receive, expressly** | W | W | W |
| Sizing output, held-out quotas | — | — | **W — never-receive, expressly** | W | W | W |
| Any CPG output whatsoever | W | W | **W — doubly grounded: never-receive *and* §4A.2(b)** | W | W | W |
| Reference truth — any §9 value, source, blind record, adjudication, reconciled file | — | — | **W** (X-5) | **W** — and this is what their class predictions are scored against (§9.2, §9.7) | W | W |
| Rater packets, per-rater sheets, ratings, agreement statistics | — | — | W | — | **W** (X-7) | W |
| Which rows were drawn — development or held-out — before the draw | — | W | **W** (X-8, prospective only) | W | W | W |
| Post-draw sampling records, seal, manifests **after §18 publication** | — | — | — | — | — | **public → arguably "public sources"; see S-1** |
| Analysis output, endpoint results, α, the §10.5 outcome | — | — | W | W | W | **W** as a *receipt*; public once published |

### Phase-by-phase, in words

**PRE-REGISTRATION.** Nothing is released. Material may be **prepared** — a packet, a training deck, a
declaration form, a fee-agreement template — because preparation is not release. Three conditions
follow from things already frozen: prepared material must itself contain nothing withheld (deciding not
to send a page is not a control); it must be **re-checked against the registered protocol hash and
`registry_sha256`** once those exist, because §5.3 freezes the registry at registration and *"No
changes apply after registration"*; and preparing is not recruiting.

**REGISTRATION.** The registered hashes now exist, so the permitted material becomes checkable and
releasable. Release is a **single joint act for the cohort** — fail-closed, so any unchecked gate item
blocks release for **both** enumerators. This is also the phase in which the partition assignment is
communicated, and therefore the phase in which the one unavoidable leak occurs: telling A *"your
families are `US-SEC` and `LEI-ONLY`"* discloses that **someone else** holds `FR-SIRENE` and `BR-CNPJ`.
Bounded to scope; never identity, never rows.

**ENUMERATION.** The enumerator holds the five permitted items, their own assignment and prefix, and
their own work. They must exercise judgement the protocol requires of them: answer A1/A2/A4/A6 (§5.1),
assign `expected_outcome_class` (§5.2 — *"the enumerator's prediction"*), and answer `c1_2`…`c1_5`
(§5.3). They learn **nothing** about the other partition, nothing aggregate, nothing downstream. The
rehearsal confirms this is operable: each submission validates **alone** against the shared register —
`frame --frame enum_a_submission.csv --personnel personnel_ok.json` exits 0 on A's 112 rows without
reading a byte of B's — because `checkEnumerationAttribution` asks whether each row's `enumerated_by`
is *an* eligible registered enumerator, never *which* partition is being checked.

**REFERENCE.** The enumerator's role is over; the envelope does not widen. The specific new exclusion is
reference truth, and §4A.3 explains why it is sharp: *"An enumerator may not be the reference
adjudicator"*, because *"the enumerator authored the class predictions whose mismatches with reference
truth are published (§9.2, §9.7)"*. Reference truth is the thing their work is scored against.

**RATING.** Rater packets, per-rater sheets, ratings and agreement statistics are withheld — not on the
closed list, and downstream CPG output besides.

**ANALYSIS.** Nothing is *received*. Anything the study **publishes** under §18 is thereafter a public
source and reachable by anyone, enumerators included — which is the one place the boundary genuinely
relaxes, and it relaxes by publication, not by grant. See S-1.

---

## 3. THE CONFLICT ALREADY ON THE RECORD — carried forward, not re-litigated, not amended

**K-4 — the directive's exclusion of "contamination findings" collides with §4A.2. This is recorded as
a referred OWNER DECISION. It is restated here exactly as it stands and is NOT re-argued, NOT narrowed,
and NOT amended.**

The collision, precisely:

1. **Protocol line 226 is `### 5.3 Held-out ineligibility (CPG-C1)` — §5.3 *is* the contamination
   section.** It contains C1(1)–C1(6), the rule *"For every contamination attestation, `unknown` is
   treated exactly like `yes`"*, and the four attestation columns the enumerator must fill.
2. **§4A.2 expressly grants §5.1–§5.4** — third bullet of the receive-list, *"§4A, §5.1–§5.4"* — **and**
   expressly grants **the development-only registry** — fifth bullet. Without the registry, **C1(6) is
   unanswerable**; without §5.3, `c1_2`…`c1_5` are unanswerable.
3. **§5.3 treats `unknown` exactly like `yes`.** So applying the exclusion literally does not merely
   degrade the frame — it converts every unanswerable row into a held-out-ineligible one. That is
   mass ineligibility produced by an access rule, and it would look like diligence.

**Status: CONFLICT AS WRITTEN. DECISION REQUIRED OF THE OWNER. Nothing amended here.** The wording
already recommended to the owner (to adopt, vary or reject — this stream endorses nothing and changes
nothing) is that *"contamination findings"* means the **outputs** of the §5.4 scan — the scan artefact
and its `scan_sha256`, the scanner's C1(1)/C1(6) determinations over the frame, any aggregate count of
contaminated or ineligible rows, and any late-discovered contamination recorded under §5.3 after
registration — and does **not** include §5.3 itself or the development-only registry.

**Also still open and carried forward unchanged:** K-1 (*"expected eligibility outcomes"* versus §5.2,
which §4A.2 expressly grants and the frame template requires), K-2 (the per-row / aggregate
distinction), K-3 (*"operational information necessary to perform their assigned work"* is plainly
**broader** than the closed list on a grant reading; narrower on a ceiling reading — and the
jurisdiction assignment and `candidate_id` prefix need separate disposal either way). **This stream
resolved none of them and altered none of them.**

### S-1 — scope note on the referred K-4 decision (a consequence, not a new decision)

§18 publishes the scan among the verification artefacts. After publication the scan artefact and
`scan_sha256` are **public**, and "public sources" is the first item on §4A.2's receive-list. The
exclusion of scan output is therefore **prospective** in exactly the way F-enumerators already records
for X-8 (*"the post-draw artifacts are published (§18) — the exclusion is prospective only"*). Whoever
decides K-4 should say whether the wording adopted is time-bounded, because otherwise it forbids an
enumerator from reading a published study artefact. **Flagged as part of the referred K-4 decision. Not
decided here.**

---

## 4. A FURTHER CONTRADICTION FOUND — reported, never amended

**FC-1 — §4A.1's per-person declaration requires every registered person to answer §4A.2(b) "no", but
a rater's assigned task under §12 *consists of* receiving CPG output.**

Exact wording, in the order it bites:

- **§4A.1, "Recorded per person", protocol line 141:**
  > "- a signed declaration answering items 1–4 and 6 **and §4A.2(a)–(b)** with "no";"

  This is unqualified by role: it is what is recorded for **every** person in the register.
- **§4A.1 line 145:** *"An unknown answer is not "no"."*
- **§4A.2(b):**
  > "(b) not have run CPG or seen any CPG output (including the development pilot and instrument check)
  > **before completing the frame**;"

  The time bound *"before completing the frame"* has a referent only for an **enumerator**. A rater
  completes no frame, so for a rater the bound is undefined.
- **§4A.1, "Exclusion period":** *"from the first repository commit of the developing organisation's
  product **until publication of this study's results**."*
- **§12, Rater packet:** *"Field; **CPG's value or null**; the source URLs CPG cited for that value
  (§12.3); the sealed reference record"* — i.e. the rating task **is** the receipt of CPG output.
- **§12, Eligibility** lists only: *"Must not have implemented CPG, the protocol or the tooling; must
  hold no other §4A.3 role; must satisfy §4A.1"* — it does **not** bar having seen CPG output, while
  §4A.1 (which it invokes) requires §4A.2(b) answered "no".
- **§4A.1 consequence clause, line 147:** *"If a declaration is later found false, that person's work is
  non-independent, and the finding is published: … **rater work:** the §12 UNADJUDICATED consequences
  apply"*.
- **The frozen instrument enforces the broad reading.** `lib/personnel.mjs` `DECLARATION_KEYS` includes
  `ran_or_saw_cpg_output` and `checkPersonnelRegister` requires it to be `"no"` for **all seven**
  independent roles, raters and the rating adjudicator included. Observed in this rehearsal: setting it
  to `"yes"` on one assignment produces
  `assignment 1 (enumerator): declaration ran_or_saw_cpg_output must be "no" (got "yes") — not
  independent`, and the same rule applies verbatim to `rater-1`, `rater-2` and `rating-adjudicator`.

**The contradiction.** Read literally and together: a rater must declare "no" to having seen any CPG
output; the exclusion period runs until publication of the results; and the rating work the protocol
assigns them consists of receiving CPG output during that period. The declaration therefore becomes
false through the performance of the assigned task, and §4A.1's own consequence clause routes that to
UNADJUDICATED — the exact outcome §12 says *"the protocol is not weakened to accommodate"*.

**A resolving reading exists** — that the declaration speaks **as at the date of signature**, and that
§4A.2(b)'s bound attaches to the enumerator role alone, so a rater's "no" means "not before signing"
— **but the protocol nowhere states it**, and §4A.1 expressly forecloses filling the gap with an
unknown: *"An unknown answer is not "no"."*

**Status: REPORTED. NOT AMENDED. NOT RESOLVED. An owner decision, distinct from K-1…K-4.** The
narrowest disposal available without touching the frozen instrument is a registration-narrative
statement of the as-at-signature reading, since `DECLARATION_KEYS` is protocol and any change to it
would move the tooling aggregate.

### Checked and found NOT to be contradictions

| Checked | Why it is not one |
|---|---|
| §4A.2's citation *"(§5.5, §5.7.2)"* | Accurate: §5.5 is the two-stage / commitment / randomness section, §5.7.2 is frame sufficiency (`E ≥ 126 / 52 / 32`) |
| §4A.2(d) *"hold no other §4A.3 role"* vs §4A.3 *"Several enumerators are permitted; each holds no other role"* | Consistent; and the instrument implements it — `lib/personnel.mjs:26` exempts only `enumerator` from the exactly-one rule |
| §4A.2 granting §5.4 (scan **scope**) while withholding the scan **output** | Consistent: §5.4 defines the path classes; the artefact is a different object. This is the distinction K-4's recommended wording turns on |
| §4A.2 granting the development-only registry while §5.3 freezes it at registration | Consistent, and it is exactly why P1-3 requires prepared material to be re-checked against the registered `registry_sha256` |
| Reference Author / Confirmer also declaring `ran_or_saw_cpg_output: "no"` | Consistent, and required: §9.3 anti-circularity makes `constructed_without_cpg` = `"yes"` a hard condition on every blind record |
| `dt007` C-partition allocating **family × class** cells vs F-enumerators allocating **families only** | Not a protocol contradiction — an inconsistency between two live *preparation* artefacts. Flagged in `ENUMERATOR_AB_MODEL.md` H-6 so the owner picks one axis before publishing the allocation. This rehearsal used the family axis |

---

## 5. Two operational consequences of this matrix, from the rehearsal

1. **The coverage gate is an OPERATOR artefact.** `REHEARSAL_FIXTURES/partition_coverage.mjs` prints
   per-enumerator, per-family **row counts**. Those are aggregate facts about the combined frame, so
   showing its output to an enumerator would breach the matrix twice over (X-1 aggregate quality, X-3
   the other enumerator's volume). It must be run by the operator and published only after the frame is
   frozen.
2. **Early validation does not require the boundary to bend.** Each enumerator's submission can be
   checked against the frozen `frame` command **alone**, exit 0, before any merge — so there is no
   operational argument for showing either enumerator the other's work in order to validate. That
   removes the most likely pressure on the boundary before it can be applied.

---

## Sources read (all read-only, nothing modified)

- `C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md` — §4A.1 (lines 125–152), §4A.2 (154–170),
  §4A.3 (172–192), §5.1 (198), §5.2 (216–222), §5.3 (**226**–248), §5.4 (250), §5.5 (259–290, incl.
  line 288), §5.7.2 (383), §9, §12 (721–737), §18, §19.3, §20.18, §22 row 31
- Candidate instrument `C:/tmp/dt009-merge/tooling` — `lib/enumeration.mjs`, `lib/personnel.mjs`,
  `lib/schema.mjs`, `lib/frame.mjs`, `lib/canonical.mjs`, `lib/select.mjs`, `lib/scan.mjs`,
  `lib/aggregate.mjs`, `cpg_u1_data.mjs` (`cmdFrame`, `cmdScan`, `cmdCheckFrameSufficiency`)
- `C:/tmp/dt009-closure/F-enumerators/` — `KNOWLEDGE_WINDOW_RULE.md` (§1–§6, K-1…K-4),
  `ENUMERATOR_WORK_ALLOCATION.md` (§1–§3), `PENDING_PERSONNEL_REGISTER.json`
- `C:/tmp/dt007-eight-person/C-partition-tooling/partition/partition.mjs`,
  `C:/tmp/dt007-eight-person/D-merge/merge/` (`README.md`, `merge_frame.mjs`)

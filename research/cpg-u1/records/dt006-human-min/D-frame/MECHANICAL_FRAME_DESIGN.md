# MECHANICAL_FRAME_DESIGN — can the frame be *defined* instead of *enumerated*?

**Classification: PROPOSAL / METHODOLOGY REVIEW.** Not registered, not a protocol change, not an amendment
proposal for adoption. **No real U1 frame is constructed here and none may be**: every input in the prototype is
a synthetic fixture. No frozen byte was modified; `research/cpg-u1/**`, `C:/tmp/dt002` and
`research/deeptech-operations/dataset/` are untouched.

**Sources.** `CPG_U1_PROTOCOL_004` (`c50fc680…`) §4A.2, §5.1–§5.4, §5.5–§5.5.3, §5.7, §5.7.2, §6.5, §9.2, §9.8,
§15.3, §15.5, §19.1–§19.3, §20.18, §21, §22, §23, §24. Instrument (read-only) `C:/tmp/dt002/research/cpg-u1/tooling`,
aggregate recomputed as `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) —
`lib/frame.mjs`, `lib/sizing.mjs`, `lib/scan.mjs`, `lib/schema.mjs`, `lib/commitment.mjs`, `lib/sampling.mjs`,
`lib/canonical.mjs`, `lib/aggregate.mjs`. Prior artefacts (read-only) `C:/tmp/dt004-operations/dataset/`.

---

## 1. The design under test

```
frame  =  D( snapshot_bytes , predicate_bytes )

snapshot_bytes    one pinned external source snapshot, content-addressed by sha256, fixed at a
                  pre-registered instant, with a stable and total enumeration order
predicate_bytes   the pre-registered predicate set: one mechanically decidable rule per §5.1 column,
                  plus the ordering rule and the candidate_id rule
D                 a total, deterministic, side-effect-free function — no clock, no RNG, no network,
                  no environment, no run-time parameter
```

Both digests go into the public registration (§5.5.1 "Content"), and `sha256(frame)` continues into the
commitment payload exactly as today (`frame_hash`, `lib/commitment.mjs` `PAYLOAD_KEYS`). Nothing about the
commitment, seed, draw or sizing machinery changes. What changes is only **who authored the population, and
whether an outsider can recompute it**.

The claim being tested is narrow and should not be overstated: *re-derivability is not unbiasedness.* It
converts §22 row 31 from "trust a declaration by a person you cannot audit" into "recompute a published
function and compare bytes". That is a change of *class*, not a proof of representativeness.

---

## 2. What makes a source admissible for this purpose

Nine criteria. The first four are the hard ones; failing any one of them makes the whole design worthless,
because the snapshot is the root of the derivation and everything downstream inherits its defects.

| # | Criterion | Why it is necessary | How an outsider checks it |
|--:|---|---|---|
| S1 | **Not controlled or influenced by the developing organisation**, under §4A.1's definition of that organisation (including affiliates) | If the organisation can edit the source before the pin instant, it authors the population *through* the source and the derivation launders the choice. A re-derivable frame derived from a controlled source is strictly worse than a human frame, because it looks verified | Publish the source's identity and governance; the outsider inspects who operates it |
| S2 | **Content-addressable and pinnable**: one byte-exact artefact with a sha256 recorded in the registration | Without a pinned digest there is no "the snapshot"; the derivation is not reproducible and the frame is not frozen | Recompute sha256 of the artefact |
| S3 | **Obtainable by third parties at that digest** — redistributable, or independently archived (§13.1-style) | §21 verification requires the outsider to re-derive. A pin nobody else can fetch is an assertion, not a proof | Fetch from the archive; compare digest |
| S4 | **Derived in no part from CPG output** (§5.3 C1(3), §4A.2(b)) | A snapshot carrying CPG output contaminates every row derived from it, and contamination would be structural rather than per-row | Marker refusal in the harness (prototype test T7) plus source provenance |
| S5 | **Stable, total enumeration order** with a unique key per record | The order participates in the frame bytes. Without uniqueness the order is not total and the derivation is not a function | The harness refuses a non-unique or non-string order key |
| S6 | **Each record states, in one record, the decisive identifier and the entity's domain** | A4 requires the identifier↔domain tie to be evidenced. If two sources must be joined, the join rule becomes a discretionary parameter | Read the record schema |
| S7 | **Identifier schemes cover §5.1's accessible families** (`CIK`, `SIREN`, `CNPJ`, `LEI`; `JURISDICTION_FAMILIES` in `lib/schema.mjs`) | A source that carries none of the four decisive identifiers can produce no admissible row at all (A3/A5) | Derive and read the A3/A5 screening tally |
| S8 | **Pin instant pre-registered before the snapshot is inspected**, and disclosed | The *choice of instant* is a selection channel: the same source at two instants is two populations | Registration timestamp vs the snapshot's own `as_of` / `pinned_at` |
| S9 | **Large enough for §5.7.2 after screening attrition** (see §7) | A source that cannot reach 126/52/32 eligible admissible rows makes `STAGE_VOID_FRAME_INSUFFICIENT` a live risk with no remedy (§5.5, §5.10) | Derive and read `frame_sufficiency` |

**Must the source be independent of the developing organisation? Yes — S1 is not negotiable.** It is the
mechanical analogue of §4A.1, and it is the only criterion that carries the property enumerator independence
was protecting. Re-derivability without S1 gives an attacker a *stronger* position than the status quo:
verifiable derivation from a population they authored upstream.

**S8 is the criterion most easily overlooked.** Commitment freezes the frame; nothing freezes *when* the
snapshot was taken. An operator who pins "the index as of a date I chose after looking at it" has re-created
attack 31 one level up. The mitigation is ordering: the pin instant must be named in the registration, and the
registration must precede the derivation, exactly as §5.5.1 already orders registration before enumeration.

---

## 3. What the predicates must look like to be mechanically decidable

| Requirement | Consequence if violated |
|---|---|
| **Total** on every snapshot record — an explicitly named verdict for every input, including missing fields | A missing field silently becomes a default, and the default is a hidden parameter |
| **Closed over the snapshot** — a predicate may read only pinned snapshot fields and its own constants | Any external lookup re-introduces a live, unpinnable input |
| **No free text derived at run time** — notes are pre-registered templates with substitutions from pinned values only | §5.1 requires a non-blank A4 note and a named collision for `identity-hazard`; free text is unbounded discretion |
| **Deterministic string handling** — declared canonical form (lowercase, no scheme/port/path/`www.`), declared Unicode normalisation, byte comparison, never locale collation | Locale-dependent ordering makes the frame hash platform-dependent, so re-derivation fails on a different machine |
| **Integer arithmetic only**, no floating-point thresholds | Rounding differences change verdicts across platforms |
| **Refuse rather than default** on anything unexpected: unknown status value, absent order key, record-count mismatch | Silent tolerance is the channel through which a hand-edited snapshot passes |
| **`unknown` must be reachable and must never be a pass** (§5.1: "UNKNOWN means 'not established'… It never means false, and it never satisfies a criterion") | The tri-state collapses to two states and absent evidence becomes admission |
| **No run-time parameter at all** | Every flag is a post-registration discretion channel. The prototype takes three paths and refuses everything else (test T5, 10 checks) |

A non-obvious consequence: **liveness and re-derivability are in direct conflict.** A2 ("reachable over HTTPS")
and A6 ("reference truth obtainable") are statements about the world *now*. Any live check makes the derivation
non-reproducible; taking them from the snapshot makes them the *source's* claim as of the pin instant. A
mechanical frame must choose the second, and must declare it.

---

## 4. Mechanisation verdict, criterion by criterion (§5.1, §5.2, §5.3)

**MECHANICAL** = decidable from pinned bytes with no human judgement left.
**MECHANICAL (delegated)** = decidable, but the *substance* of the claim is now the source's claim, not a
study-personnel judgement.
**JUDGEMENT → PRE-REGISTRABLE PROXY** = the protocol's criterion is a human judgement; a declared proxy can be
pre-registered, and then run-time discretion is zero, but the proxy's fidelity to the criterion is an
unverified assumption that must be published as a limitation.
**JUDGEMENT-REQUIRED (irreducible)** = no pinned external artefact can decide it.

| §5.1 / §5.2 / §5.3 item | Protocol wording (abbrev.) | Verdict | Mechanical form used in the prototype | What is lost |
|---|---|---|---|---|
| **A1** | "Real, currently operating legal entity" | **JUDGEMENT → PRE-REGISTRABLE PROXY** | `status ∈ {active}` → yes; `status ∈ {dissolved, struck-off, liquidated}` → no; else `unknown` | Registry status ≠ trading. Dormant shells read `active`; recently-ceased entities lag. The proxy's error rate is unknown and unmeasurable within U1 |
| **A2** | "Canonical domain controlled by the entity, reachable over HTTPS" | **MECHANICAL (delegated)** — liveness is delegated to the snapshot | canonicalise `website`; `https_observed === true` → yes, `false` → no, absent → `UNKNOWN` + `unknown` | "Controlled by the entity" becomes "the source records this website for this entity". HTTPS reachability becomes a pinned observation that may be stale at run time |
| **A3** | "Decisive identifier, checksum-valid and permitted for the jurisdiction family" | **MECHANICAL** (fully) | copied from the record; validated by the instrument's own `validateIdentifier` + `JURISDICTION_FAMILIES` | Nothing. This criterion was already computed, not attested (there is no `a3_` column) |
| **A4** | "Identifier↔domain tie evidenced independently of CPG (URL + note required)" | **MECHANICAL (delegated)** | `yes` iff one record states identifier **and** website; evidence URL = the record URL; note = pre-registered template naming the snapshot digest | The tie's *correctness* becomes the source's correctness. "Independently of CPG" is discharged once, at source admissibility (S4), instead of per row |
| **A5** | "Jurisdiction family accessible at the resolver SHA" | **MECHANICAL** (fully) | pre-registered `jurisdiction_code → family` map, refused unless every target is in `JURISDICTION_FAMILIES` | Nothing |
| **A6** | "Reference truth obtainable for all three fields" | **JUDGEMENT → PRE-REGISTRABLE PROXY** | `yes` iff an https record URL exists and A1 = yes | A6 is a *forecast about third-party documentation*. The proxy tests "a researchable authoritative record exists", which is weaker, and it couples the frame to the source base — see §6 (SOURCE-COINCIDENT) |
| **Class `fill-expected` / `abstention-expected`** | "An authoritative source is expected to state at least one of the three fields" / "no authoritative source is expected to state any" | **JUDGEMENT → PRE-REGISTRABLE PROXY**, and the most consequential one | `identity-hazard` first; else `fill-expected` iff the record's `filing_classes` intersect the three field-bearing classes; else `abstention-expected` | An *expectation over all authoritative sources* is replaced by *presence in one source*. `abstention-expected` becomes "absent from this snapshot", which is absence of evidence in one artefact, not absence in the world |
| **Class `identity-hazard`** | "A different real entity shares the name or a confusable domain (the collision must be named)" | **JUDGEMENT → PRE-REGISTRABLE PROXY** | normalised-name collision group with more than one record in the pinned snapshot; note auto-generated naming the group and its size | "Confusable domain" needs a pre-registered confusability metric (e.g. Unicode skeleton, or edit distance ≤ 1 on the registrable label). Choosing that metric is itself a discretion knob. Cross-source collisions invisible to the snapshot are missed |
| **C1(1)** repository scan | "Name, domain or identifier appears in a committed path within scan scope at the resolver SHA" | **MECHANICAL** (already) | unchanged: `lib/scan.mjs` over `git ls-files` at the resolver SHA, `scan_sha256` committed | Nothing. This is the model the rest should imitate: conservative, recomputable, hash-bound |
| **C1(6)** registry match | "Matches the development-only registry by name (whole word) or domain (exact or parent)" | **MECHANICAL** (already), on **operator-authored content** | unchanged: frozen `rules/development_only_registry.json`, `registry_sha256` registered | The *matching* is mechanical; the *list* is the organisation's own, complete only by attestation H2 (§19.2, §20.12) |
| **C1(2)–C1(5)** attestations | used in CPG work / values derived from CPG / prior CPG execution / internal or owned | **JUDGEMENT-REQUIRED (irreducible)** — **no external source can decide these** | fixed to `no` in the pre-registration; all held-out ineligibility delegated to C1(1) + C1(6) | Discussed at length in §5 below. This is the sharpest finding of the whole design |
| **Uniqueness** (§5.7) | "one row per legal entity… Duplicate identifiers or duplicate canonical domains are refused" | **MECHANICAL** (already) | instrument refusal, unchanged | Nothing |
| `enumerated_by`, `enumerated_at`, `enumeration_source_url` | provenance columns | **MECHANICAL** | derivation identity + predicate id; `enumerated_at` = snapshot `as_of` (never a clock); URL = pre-registered template | §15.3's `screened_by` and `check-personnel` expect *people*. A protocol amendment would be needed to accept a derivation identity — an owner question, not something to patch |

### Counting the discretion, honestly

- **Status quo.** ≥ 210 eligible admissible rows (§5.7.2 "Resourcing consequence"), plus every screened-out
  row, each carrying **15 judgement-bearing cells** of the 22 in `FRAME_COLUMNS` (jurisdiction family, scheme,
  identifier value, evidence URL, evidence note, class, hazard note, A1, A2, A4, A6, C1(2)–C1(5)). That is
  **≥ 3 150 individual human decisions**, none individually auditable, none re-derivable, defended only by a
  declaration under §4A.1.
- **Mechanical.** One source choice, one pin instant, and **41 named predicate leaves** in the prototype's
  predicate set (36 semantic parameters + 2 note templates + 3 snapshot-pin fields) — every one of them
  published, hashed into the registration, and re-derivable byte-for-byte by any outsider.

**So: can judgement be pushed into the pre-registration so the operator's later discretion is zero?**
For *run-time* discretion, yes, and the prototype demonstrates it: three path arguments, no flags, no
environment influence, no clock, no RNG, no network (tests T5, T6 — 13 checks, all passing). For *authorship* discretion, no.
The predicate set is written by someone who knows what CPG is good at. Discretion is **compressed and published,
not eliminated** — from ≥ 3 150 private decisions to 41 public ones. That is the entire honest claim.

---

## 5. The irreducible human input: C1(2)–C1(5)

C1(2)–C1(5) ask whether a company was used in CPG work, whether a value came from a CPG output, whether it was
ever passed through CPG, and whether it is the implementers' own. **These are facts about the developing
organisation's own history.** No external registry, index or snapshot contains them. Three options exist, and
they are not equally good:

| Option | Mechanism | Effect on §22 row 31 / 27 | Cost |
|---|---|---|---|
| (i) **Delegate** (prototype) | Fix all four to `no` in the pre-registration; held-out ineligibility comes *only* from the mechanical C1(1) scan and the frozen C1(6) registry | **Best.** Removes a free, undetectable, protocol-compliant per-row *exclusion* channel entirely | Registry completeness (H2) becomes the sole safeguard. A contaminated company neither in the repository nor in the registry enters held-out |
| (ii) **Keep as operator attestations** | The operator (or the enumerator, informed by the operator) answers per row | Worst. Since **`unknown` is treated exactly like `yes`** (§5.3), writing `unknown` on any specific company excludes it from held-out at zero cost, with no evidence required, and it is not even a false statement | No gain |
| (iii) **Require an exhaustive public list** | The organisation publishes every company it ever touched | Equivalent to (i): that list *is* the development-only registry | Same as (i) |

**This is the argument that an independent enumerator does not, in fact, protect C1(2)–C1(5).** An enumerator
who satisfies §4A.2 — never implemented CPG, never ran it, never saw its output — *cannot know* whether a
company was used in CPG work. Answering honestly, they must write `unknown`, and `unknown` = ineligible. If
every row reads `unknown`, then `E_c = 0` for every class and §5.7.2 can never be satisfied, so no development
commitment is possible. The only way an independent enumerator can write `no` is if the developing organisation
tells them what its history is — and that disclosure *is* the frozen registry (§4A.2 lists it among the five
things an enumerator receives). So in the status quo the contamination cells are already a restatement of
operator-supplied knowledge, wearing an independent enumerator's signature. Option (i) simply stops pretending
otherwise, and in doing so removes the discretion channel that §22 row 27 concedes is "not cryptographic".

*Owner decision required:* accepting (i) makes H2 (§19.2, §20.12) load-bearing alone. That is a real
weakening on the contamination axis and must be declared as such, against a real strengthening on the
composition axis.

---

## 6. Coupling risk: does a registry-derived frame raise SOURCE-COINCIDENT? (§9.8, §15.5 condition 5)

§9.8: "each observation is classified `INDEPENDENT` or `SOURCE-COINCIDENT` (reference and CPG cite the same
document). **If SOURCE-COINCIDENT exceeds 60% of scored observations, the run is INCONCLUSIVE**". §15.5
condition 5 repeats it.

Three findings, in order of importance:

1. **A baseline coupling already exists and is not caused by mechanisation.** §5.1 A3 admits only `CIK`, `SIREN`,
   `CNPJ` and `LEI` identifiers, and §9.2's authority table makes `REGISTRY_RECORD` the TIER_1 source for
   `founded_year` and `REGULATORY_FILING` TIER_1 for `employee_count`. The reference team is therefore *directed*
   to the same registries CPG resolves. Every U1 frame, human or derived, sits inside that coupling.
2. **Mechanisation adds coupling at exactly two predicates: A6 and the fill/abstention class.** Both are proxied
   by "does this source record field-bearing filings?". If the pinned snapshot is the same registry family CPG
   queries, then `fill-expected` becomes, approximately, "companies whose facts live in CPG's own source base" —
   which raises the probability that the reference document and CPG's cited document are the same document. The
   human enumerator, using "public sources" plurally (§4A.2), has no such systematic pull.
3. **Mitigation is available and cheap.** Use the snapshot as the *sampling universe* (entity identity, order,
   identifier, domain) but do **not** proxy A6 or the class from the same source's filing metadata; pre-register
   a distinct, independent metadata source for the class proxy, or accept the class as the one place a human
   judgement survives. Alternatively, publish the realised `independence_class` distribution as a pre-declared
   risk, given that §15.5(5) can void the whole run at 60 %.

Also worth noting against mechanisation: `abstention-expected` derived as "absent from this snapshot" is
positively *anti*-correlated with source coincidence (no document to share) but is also the weakest proxy in the
design, and it feeds P2's denominator (§10.3: AR = CORRECT-ABSTENTION ÷ (CORRECT-ABSTENTION + UNSUPPORTED-FILL)).
A systematically wrong `abstention-expected` stratum does not corrupt labels — §5.2 and §9.7 keep labels with
reference truth — but it does change which companies P2 is computed over.

---

## 7. Sufficiency and cost: what a mechanical frame must deliver

All arithmetic below is **recomputed from the frozen instrument**, not recalled. Commands run in this stream:

```
node -e "import('./lib/frame.mjs').then(f => { … })"        # in C:/tmp/dt002/research/cpg-u1/tooling
enumeratePilotOutcomes() → {"outcomes":4096,"halts":1,"refused":0,
                            "maxQuotas":{"fill-expected":60,"abstention-expected":25,"identity-hazard":15}}
MAX_HELD_OUT_QUOTAS     → {"fill-expected":60,"abstention-expected":25,"identity-hazard":15}
FRAME_MINIMUM           → {"fill-expected":126,"abstention-expected":52,"identity-hazard":32}   (total 210)
```

`FRAME_MINIMUM` is not typed in: `lib/frame.mjs` computes `POOL_MULTIPLIER × MAX_HELD_OUT_QUOTAS[c] + DEVELOPMENT_QUOTA[c]`
with `POOL_MULTIPLIER = 2` and `DEVELOPMENT_QUOTA = {6, 2, 2}` from `lib/schema.mjs`, and `MAX_HELD_OUT_QUOTAS`
by evaluating `heldOutQuotas` on all 4 096 permitted pilot outcomes.

### The sizing rule, evaluated (`lib/sizing.mjs`, `SIZING = {MIN_FILLS:20, SAFETY:1.5, CAP_FILL_EXPECTED:60}`)

`MIN_FILLS = 20 = 1 ÷ θ_EFR` with θ_EFR = 0.05 (§10.3 P1); `raw = ⌈(20 × 1.5) ÷ y⌉ = ⌈180 ÷ T⌉` where `T` is total
pilot fills over the 6 development fill-expected companies and `y = T ÷ 6`.

| Pilot `T` | `y` | `raw` | `N_fill` | `N_abst` | `N_hazard` | companies | observations (×3 fields) | source |
|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 0 | — | — | — | — | — | — | — | `heldOutQuotas` → `halt: true` (1 of 4096) |
| 1 | 0.1667 | 180 | **60** | **25** | **15** | 100 | 300 | run output, `capped: true` |
| 2 | 0.3333 | 90 | 60 | 25 | 15 | 100 | 300 | run output, `capped: true` |
| 3 | 0.5 | 60 | 60 | 25 | 15 | 100 | 300 | run output, at the cap |
| 4 | 0.6667 | 45 | 45 | 19 | 12 | 76 | 228 | run output |
| 6 | 1.0 | 30 | 30 | 13 | 8 | 51 | 153 | run output |
| 9 | 1.5 | 20 | 20 | 9 | 5 | 34 | 102 | run output |
| 12 | 2.0 | 15 | 15 | 7 | 4 | 26 | 78 | run output |
| 18 | 3.0 | 10 | **12** | **5** | **3** | 20 | 60 | run output, floors bind |

**Reconciliation of the two numbers.** The *drawn sample* ranges from 12/5/3 = **20 companies = 60 observations**
(when the pilot fills well) to 60/25/15 = **100 companies = 300 observations** (when it fills badly). The *frame*
requirement is larger for two independent reasons: the §5.7 **pool minimum** demands `pool_c ≥ 2 × Q_c` so the
draw is a selection rather than a hand-picked set, and the §5.8 **development draw** consumes exactly 6/2/2
first. Hence `E_c ≥ 2 · Qmax_c + Dev_c`:

```
fill-expected        2 × 60 + 6 = 126
abstention-expected  2 × 25 + 2 =  52
identity-hazard      2 × 15 + 2 =  32
                                 ----
                                  210 eligible admissible rows, before any screening attrition
```

The worst case for frame size is **CPG performing badly in the pilot** (`T ≤ 3` → `Qmax`), which is why the
frame must be sized for 300 observations even though 60 may suffice. G1 (§15.5(1), §10.3) independently requires
≥ 20 fills for the run to be assessable at all, which is the same θ_EFR-derived 20.

### Does a snapshot-derived frame plausibly meet it?

| Class | Floor | Mechanical feasibility | Judgement |
|---|--:|---|---|
| `fill-expected` | 126 | A large regulatory index yields filers with field-bearing filings in volume | **Plausible**, with margin, in `US-SEC` and `LEI-ONLY` |
| `abstention-expected` | 52 | Requires *absence* of authoritative documentation for all three fields. A presence-based snapshot can only report absence *within itself* | **The binding constraint.** Mechanically the weakest claim in the design, and it is the class P2 is computed over |
| `identity-hazard` | 32 | Needs ≥ 16 name-collision groups of 2 detectable in the pinned snapshot, plus a pre-registered confusable-domain metric | **Plausible in a large index**, and *easier* mechanically than by hand — a normalised-name group-by finds collisions a human enumerator must stumble upon (prior artefacts call this "the hardest class to source") |
| Jurisdiction balance | none enforced | §5.7.1 D-A interleaves `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY` round-robin; "an exhausted family stops contributing". No family quota is refused anywhere | A single-jurisdiction source silently produces a single-family sample and a published scope limitation. A mechanical design must pre-register **per-family** floors or accept that weakness in writing |

The prototype demonstrates the floor being met on synthetic data: **136 / 61 / 40 eligible admissible from 246
records**, `frame_sufficiency.ok = true` against `required = 126 / 52 / 32` as computed by the frozen
`lib/frame.mjs`. It demonstrates nothing about any real source's yield.

---

## 8. Prototype

`prototype/` — **PROPOSAL, not registered.** Synthetic fixtures only; no network; no real company; no CPG
execution; the instrument is imported read-only and its aggregate verified before use.

| File | Role |
|---|---|
| `derive_frame.mjs` | The harness. `node derive_frame.mjs --snapshot <f.json> --predicates <p.json> --out <dir>`; exit 0 derived / 1 refused (nothing written) |
| `predicates/PREREGISTERED_PREDICATES_v1.json` | The pre-registered predicate set, pinning the snapshot digest |
| `predicates/PREREGISTERED_PREDICATES_v1_ALT.json` | Same snapshot, one predicate changed (`fill_expected_min_fields` 1 → 3) — used to prove a predicate change moves the frame hash |
| `fixtures/SYNTHETIC_SNAPSHOT_V1.json` | 246 synthetic records; `sha256 de9dc2d5…` |
| `fixtures/SYNTHETIC_SNAPSHOT_V1_ALTERED.json` | Identical but for **one** record's `filing_classes` — the "silent edit" case |
| `fixtures/SYNTHETIC_SNAPSHOT_V1_CPG_TAINTED.json` | Carries CPG output; must be refused |
| `make_synthetic_snapshot.mjs` | Generator for the fixture (deterministic; identifier check digits from the instrument) |
| `test_derive_frame.mjs` | 58 checks in 15 groups |
| `mutate.mjs` | Mutation runner over the predicate and ordering lines |

**Outputs.** `frame.csv` (the 22 `FRAME_COLUMNS`, loadable by the instrument's own `checkFrameRow`) and
`derivation_transcript.json` (canonical JSON: instrument aggregate, predicate digest, snapshot digest, ordering
rule, per-record decision with its admissibility tri-state and exclusion reason, screening tally, §5.7.2
sufficiency verdict, `frame_hash`, `frame_csv_sha256`). Outputs are write-once.

**Recorded derivation** (synthetic):

```
records_in 246 · rows_emitted 246
screening {"ADMISSIBLE":237,"A1_NOT_OPERATING_ENTITY":1,"A1_NOT_ESTABLISHED":1,"A2_NOT_ESTABLISHED":1,
           "A2_NO_CONTROLLED_DOMAIN":1,"A3_INVALID_IDENTIFIER":2,"A3_NOT_ESTABLISHED":1,
           "A4_NOT_ESTABLISHED":1,"A4_NO_INDEPENDENT_TIE":1}
eligible_admissible_by_class {"fill-expected":136,"abstention-expected":61,"identity-hazard":40}
frame_sufficiency ok=true required={126,52,32}
predicates_sha256 bad6f70c3c8cccfdd0fa9da1f9e9797e60b13f35e3ee6541643d425aba9e4151
snapshot_sha256   de9dc2d5bcfa33ed2c7012136b584f126e60c11b766362c72c23e6861933d4f8
frame_hash        912e7ed4429b89cdd4929e74758d0664d364ece1922fc11ace4f8cea8d8c8e58
ALT predicate set frame_hash 222efd7a8a6110d48e56815600b9d9850bb31b761cdc52cd0be65be08ed10a88  (sufficiency ok=false)
```

`frame_hash` is computed with the instrument's own `hashRecords(rows, 'candidate_id')`, i.e. the same
definition the commitment payload binds (`cpg_u1_data.mjs:103`), so a derived frame is commitment-compatible
without any change to §5.5.3.

**Test results (real counts, `node test_derive_frame.mjs`): 58 checks, 58 passed, 0 failed.**

| Group | Checks | What it proves |
|---|--:|---|
| T1 reproducibility | 4 | Two runs of the same snapshot + predicates give byte-identical `frame.csv` **and** byte-identical transcript |
| T2 golden pinning | 5 | `frame_hash`, `frame.csv` sha256, recorded input digests and the 1:1 record→row count match recorded goldens |
| T3 altered snapshot | 4 | A single-record edit is refused `SNAPSHOT_HASH_MISMATCH`; nothing is written; the edit really is one record |
| T4 predicate change | 5 | The ALT predicate set derives, its `frame_hash` differs, only the predicate digest changed, and sufficiency flips `true → false` |
| T5 no discretion | 10 | `--seed --quota --limit --as-of --class --allow-synthetic --force` each refused `DISCRETIONARY_ARGUMENT`; duplicate and missing arguments refused; source contains no clock, RNG or network call |
| T6 environment | 3 | Identical bytes under `SEED`, `QUOTA`, `D_FRAME_AS_OF`, a hostile `TZ` and a Turkish locale; `enumerated_at` comes from the snapshot |
| T7 CPG output | 4 | A snapshot carrying CPG output is refused `CPG_OUTPUT_IN_INPUT` (before the digest check), nothing written; a predicate set that *reads* a CPG-derived field is refused too |
| T8 sufficiency | 6 | Instrument aggregate is the pinned one; `required` = 126/52/32 from `lib/frame.mjs`; counts 136/61/40; `ok = true`; no malformed row; screened-out rows retained |
| T9 ordering recorded | 3 | Decisions ascend by `registry_key`; `candidate_id` follows without gaps; the ordering rule is in the transcript |
| T10 write-once | 1 | A second run into the same output directory is refused |
| T11 unloadable frame | 2 | A predicate set producing malformed rows is refused `DERIVED_ROW_MALFORMED`, nothing written |
| T12 snapshot integrity | 2 | A truncated snapshot is refused, and refused even when correctly re-pinned (`record_count` must match) |
| T13 order normalisation | 3 | A reversed input file yields the same frame once the cited snapshot digest is normalised, and the same `candidate_id → registry_key` mapping |
| T14 total order | 2 | A duplicated order key is refused; nothing written |
| T15 tri-state | 4 | An unestablished scheme yields `UNKNOWN` with a blank value and `A3_NOT_ESTABLISHED`; a non-https record URL yields `A4_NO_INDEPENDENT_TIE` rather than a pass; non-field-bearing filings yield `abstention-expected` |

**Mutation results (real counts, `node mutate.mjs`): 24 mutants on the predicate and ordering lines, 24 killed,
0 survived.** By class: ordering 5/5, A1 2/2, A2 2/2, A4 2/2, A6 2/2, class assignment 4/4, identifier and
jurisdiction mapping 3/3, contamination attestation 1/1, input guards (digest pin, CPG refusal, argument
refusal) 3/3. Each mutant is a single textual change applied to a full copy of the prototype, whose own suite is
then run; the baseline suite is verified to pass first.

*Method note, since it matters for credibility:* the **first** mutation run killed only 18 of 24. All six
survivors were fixture-coverage gaps rather than test-logic gaps — the snapshot contained no record that
distinguished them (no out-of-order file, no duplicate order key, no non-https record URL, no non-field-bearing
filing class, no unestablished identifier scheme). Three records were added to the fixture and two test groups
(T13, T14) written, after which all 24 died. The intermediate 18/24 is reported because it is the evidence that
the mutants were not chosen to be easy.

**Known prototype limitations.** (a) Ordering uses JavaScript `<` on ASCII keys; a real design must pre-register
Unicode normalisation and byte comparison explicitly. (b) The CPG-output refusal is a substring marker scan —
sound for refusing obvious contamination, not a proof of cleanliness. (c) `frameSufficiency` is called with the
attestation-derived ineligible set only; a real derivation must also feed it the C1(1) scan and C1(6) registry
results. (d) The synthetic snapshot is generated to be well-behaved; no claim is made about real-source yield.

**One protocol property worth recording, because it removes a worry.** The frame's *ordering* does **not**
affect the draw. §5.7's rank key is `sha256("<seed>|<scheme>:<identifier>")` — keyed on the identifier, not on
`candidate_id` or row position ("Keying on the identifier means renaming a row cannot re-roll it"). So the
pre-registered enumeration order affects the frame bytes, the frame hash and the `candidate_id` labels, but it
is **not** a sampling-bias channel. It still must be pinned, for reproducibility.

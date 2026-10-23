# CPG-036 — Protocol/Tooling Decision Closure Report

**FINAL VERDICT: B. ONE OR MORE EXPLICIT DECISIONS STILL REQUIRE HUMAN APPROVAL**

Every methodological decision is closed, and no tooling behaviour remains outside the protocol. Three items need a human, because they are resourcing, history or role assignments rather than methodology:

| ID | Decision requiring human approval |
|---|---|
| **H1** | **Approve the held-out CAP**: 60 fill-expected companies, i.e. at most 100 held-out companies, 300 reference records, each constructed blind twice |
| **H2** | **Attest completeness of the development-only registry**: every company ever run through CPG (smoke, live, pilot, production) or used in its development. 13 entries are seeded from the history I could evidence |
| **H3** | **Name the seed custodian** — someone who is neither the operator nor an enumerator — who generates both seeds and publishes their commitments at freeze |

Once H1–H3 are recorded, the protocol is ready for CPG-037: **"Formal preregistration freeze and hash."** This step did not freeze anything.

---

## 0. A defect I found in my own earlier work

The CPG-033 integrity review said abstention recall "closes the all-abstention loophole". **That was false.** The candidate-001 AR formula excluded missed fills, so a system that abstained almost everywhere scored AR ≈ 1.0. **One correct fill plus universal abstention would have produced EFR = 0, AR = 1.0, II = 0 — a false SUCCESS.**

Candidate-002 fixes this in three ways:

- an **assessability gate**, G1: all fills ≥ 20. The value is derived from θ_EFR, since below 20 fills one error already exceeds 0.05;
- a **corrected AR**: CORRECT-ABSTENTION ÷ (CORRECT-ABSTENTION + UNSUPPORTED-FILL);
- **mandatory fill recall** reported with every EFR, with no threshold.

## 1. Omnivyra — closed

Omnivyra is recorded permanently (candidate-002 §17) as a real-company integration/development/smoke case. It is contaminated for U1, never held-out eligible, not an independent reference-truth case, and never a source of U1 statistics.

Three independent mechanisms keep it out of held-out, whatever any scanner says: C1(5) (own company), C1(2) (CPG work), and registry entry DEV-001. **The blocked production lookup is not a U1 failure.** No lookup was attempted.

## 2. UNKNOWN — adopted

| Semantics | Enforcement |
|---|---|
| `unknown` / `UNKNOWN` = **not established / insufficient evidence** — never false | Separate exclusion reasons `A1_NOT_ESTABLISHED` … `A6_NOT_ESTABLISHED`, `OUTCOME_CLASS_NOT_ESTABLISHED`, distinct from the false reasons |
| **Never satisfies an admissibility requirement** | Exhaustive test: all 81 combinations of {yes, no, unknown} over A1/A2/A4/A6 are admissible **iff all yes** |
| For contamination attestations, **unknown = contaminated** | C1(2)–C1(5) `unknown` → held-out-ineligible |
| An UNKNOWN domain cannot pass A2 even if attested `yes`; an UNKNOWN identifier cannot pass A3 | Tested |
| **Blank is always malformed** — omission ≠ "not established" | Tested for every tri-state column |
| Mis-cased (`Unknown`) or ambiguous (`maybe`) values are malformed | Tested |

**Regression:** the CPG-035 Omnivyra record — honest unknowns, no invented values — is now **representable**. It is excluded as `A1_NOT_ESTABLISHED` rather than rejected as malformed or mislabelled "not operating".

## 3. The four CPG-034 interpretations

Full analysis in `CPG_U1_DECISION_REGISTER_FINAL.md` §B.

| | Final rule | Decision | Key bias finding |
|---|---|---|---|
| **A** Jurisdiction turns | Round-robin, fixed order US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY; realised composition published | **ADOPT** | Alternatives let one registry regime dominate, or let enumeration effort set composition |
| **B** Flagged → development | Ineligible first, **exact** quota; surplus = `DEVELOPMENT_SURPLUS`, never held-out | **MODIFY** | Unbounded version made development size depend on the enumerator; pilot yield optimism handled by SAFETY |
| **C** Ranking | `sha256("<seed>\|<scheme>:<identifier>")` + identifier tie-break + **commit–reveal**, stage-separated seeds + unique id and domain | **ADOPT + HARDEN** | **A seed known before the frame is complete lets an enumerator choose which companies to add** — closed by commit–reveal |
| **D** "Committed test fixture" | TEST ∪ **CPG_IMPLEMENTATION** path classes + development-only registry | **MODIFY** | Test-only scope **misses companies in CPG source**: Cloudflare in `discoveredSource.ts:232`, Tesco in `entityResolution.ts:223` |

All four must be frozen before candidate selection. **No tooling behaviour now acts as protocol without being named in candidate-002.**

## 4. Dataset design — closed, not constructed

| Item | Decision |
|---|---|
| Classes | fill-expected / abstention-expected / identity-hazard — the enumerator's *prediction*, used for sampling balance only |
| Development | Exactly 6 / 2 / 2 |
| Held-out size | **Pre-registered function of the development pilot yield** y: `N_fill = min(CAP, max(12, ceil(30 ÷ y)))`; abstention-expected and identity-hazard scaled with floors 5 / 3; **y = 0 → HALT** |
| Candidate-pool minimum | ≥ 2 × quota per class per stage, verified **without the seed** |
| Sampling | Two stages under commit–reveal; held-out frame an **append-only** extension |
| Ordering / tie-break | Rank key + identifier string (total order) |
| Replacement | **None.** Post-draw identity inadmissibility → INVALID, published. Replacement would let reference difficulty choose companies |
| Negative cases | abstention-expected and identity-hazard strata; plus the evidence-free **instrument check** (any fill halts) |
| Required identity | Name, canonical domain, jurisdiction family, decisive identifier, independent identifier↔domain evidence |
| Required reference facts | 3 fields × blind double entry, in fixed formats |
| Screening | Write-once screening log per stage, sealed |

## 5. Held-out integrity

A company is held-out-ineligible under **C1(1)** repository scope, **C1(2)** any CPG resolver/protocol/tooling/reference-truth work, **C1(3)** values from CPG output, **C1(4)** any prior smoke/live/pilot/production CPG execution, **C1(5)** own or internal entity, or **C1(6)** the development-only registry.

**Own company is automatically development-only.**

## 6. Reference-truth independence — closed

- **Blind double entry.** An Author and a Confirmer each record every company × field independently. They may not communicate before both submit.
- **Inputs.** Each receives the identity packet and rules only — never CPG output (including the pilot), never the other's record.
- **Disagreement.** A third adjudicator picks one record or declares REFERENCE-CONFLICT, and **cannot supply a new value**.
- **Agreement is final.** No adjudication may override it.
- **Enforced separation.** Author ≠ Confirmer ≠ adjudicator.
- **Sealing.** The reference file is produced only by `reconcile`, and `seal` refuses any hand-edited file. The seal hash is published before execution.
- **Operator.** The operator receives **only the seal hash**, so cannot choose reference values after seeing CPG output.

## 7. Raters — closed

| Item | Decision |
|---|---|
| Raters | ≥ 2 independent, plus a rater adjudicator |
| Exclusions | Operator, seed custodian, enumerators and every reference role are excluded |
| Agreement | Nominal Krippendorff α ≥ 0.667 (Krippendorff's own floor), plus per-label agreement |
| Scale | Categorical: SUPPORTED, UNSUPPORTED, INCORRECT, **MISATTRIBUTED**, CORRECT-ABSTENTION, MISSED, REFERENCE-AMBIGUOUS, applied by an ordered decision procedure |
| Completeness | ≥ 2 ratings per scored observation; ≥ 90% of observations complete |
| Blinding | Re-specified for a single arm: blind to other labels, tallies and the pilot |

**If independent raters are unavailable, U1 cannot exceed Rung 2, endpoints are UNADJUDICATED, and no independent-validation claim may be made.** The protocol was not weakened to fit current availability.

## 8. Source truth and live sources — closed

**Archive.**

- Raw documents for all traffic through a recording fetcher. Every first-party, identity and registry request passes the injectable fetcher.
- Wikidata **adapter snapshots**, via a recording `wikidataLookup`, with a cold or recorded adapter cache.
- Full CPG responses and run metadata.
- Hashes, a Merkle root, and the seal.

**Independent offline re-scoring: POSSIBLE.** Replaying the resolver on recorded evidence is also possible, but requires a replay harness to exist before execution. **Not replicable:** that Wikidata returned the recorded values (only adapter output is archived), and byte-identical live re-runs.

The treatment is `lookupGroundedCompanyFacts`, driven by harness wrappers. **No CPG code change** is needed.

## 9. Endpoints — final review

| Check | Result |
|---|---|
| All-abstention cannot produce a misleading success | **Fixed** — G1 (fills ≥ 20) + corrected AR + mandatory FR. Zero or near-zero fills → INCONCLUSIVE |
| Zero-fill companies explicit | Contribute nothing to EFR; fully scored for AR/FR; counted and published |
| Identity errors not hidden | **Fixed** — MISATTRIBUTED-FILL is its own label; counted in EFR **and** in II (zero tolerance) |
| Unavailable sources observable | Machine-recorded per observation; abstentions split by cause; **never excluded** |
| Reference ambiguity not silently adjudicated | REFERENCE-CONFLICT / AMBIGUOUS / STALE excluded from every denominator and published; raters cannot convert them |
| No unjustified weighted score | None; unsupported, incorrect and misattributed reported separately |
| Executable agreement rules | **New** — year exact; employees ±10%; revenue currency-match + ±10%. **No currency marker → UNSUPPORTED**, because the adapter drops non-USD currency (`wikidataAdapter.ts:172`). 24-month temporal window |
| Outcome vocabulary | INCONCLUSIVE → FALSIFIED (II > 0 or EFR > 2θ) → FAILURE (incl. near miss) → SUCCESS |

Secondary metrics — identity correctness, abstention precision, provenance completeness, evidence depth, conflict detection (structurally limited), field coverage and latency — are **diagnostic only**. No statistic was calculated.

## 10. Control arm — final

**B: U1 = independent reference-truth evaluation of CPG's fact-resolution/abstention behaviour. U9 = separate comparison of the deterministic CPG stack against an appropriate direct-model architecture.** They are not conflated.

## 11. U4 / U8 / U9 — frozen

- **U4:** its own held-out companies; no reuse of any U1 company; its own sampling and generalisation protocol.
- **U8:** no validated score from exposed metadata. The minimum future evidence is a pre-registered formula, U1 labels used for calibration only, a separate labelled held-out set, and per-source freshness.
- **U9:** a separate experiment, model arm and non-production credential; its own hypotheses and endpoints; sharing U1's dataset and reference truth only where justified in its own protocol.

## 12. Verification

| Check | Result |
|---|---|
| Self-test (final bytes) | **243 passed, 0 failed** — `selftest_final.log` |
| Mutations (final bytes) | **37 / 37 killed** — `mutation_run_3_final.log` |
| Earlier runs, kept for the record | Run 1: 35/36 (M13 survived — a test used "Mercurial", which does not actually contain "Mercury"; test fixed). Run 2: 37/37 after adding value-format enforcement (M37) |
| Detector against the clean clone at `f01a7eb4` | Cloudflare, Tesco, Calendly and Omnivyra flagged; synthetic negative control not flagged; TEST = 1,797 and CPG_IMPLEMENTATION = 116 files scanned |
| No real companies or facts inserted | The only real company names are in the development-only registry (the implementers' own history). The self-test detector probe uses names CPG-032–035 already established as contaminated, and asserts nothing about them. Real-looking probe names and two real identifiers carried over from v1 (`CIK 320193`, `Q42`) were replaced with synthetic values before the final run |
| No production files changed | Clean clone `C:/tmp/cpg025_main`: 0 working-tree changes |
| No production data or credentials accessed | None. No lookup, no database, no model call, no network access beyond read-only `git` in the local clone |
| Prior artifacts preserved | CPG-031, 033, 034 and 035 `SHA256SUMS.txt` all verify; CPG-032 draft still `3c7be3abfa506032` |
| Control bytes | None in any tooling file |

## 13. Artifacts

`C:/tmp/cpg036_protocol_close/` — hashes in `SHA256SUMS.txt`:

- `CPG036_FINAL_REPORT.md` — this report
- `CPG_U1_PREREGISTRATION_CANDIDATE_002.md`
- `CPG_U1_DECISION_REGISTER_FINAL.md` — 54-row freeze-readiness audit + D-A…D-D analyses
- `tooling_v2/` — new tooling. **CPG-034 tooling is untouched** in its original location
- `mutation_run_1.log`, `mutation_run_2.log`, `mutation_run_3_final.log`, `selftest_final.log`

**Not committed. Not pushed.**

## 14. Next action

Record decisions **H1, H2 and H3**. Then **CPG-037: "Formal preregistration freeze and hash."**

---

**Safety:** no experiment, U1 execution, production lookup, production DB, production change, external model, candidate-company research, reference-answer research, rater recruitment, dataset fabrication, deployment, commit or push.

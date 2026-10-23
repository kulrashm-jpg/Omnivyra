# VP-2 operator-side pre-commit gate, and `enumerated_by` verification — DEEPTECH-PARALLEL-013

**Stream:** VP-2 / `enumerated_by`. **Classification: OPERATOR-SIDE PREPARATION.** Nothing here is part
of the registered instrument. No instrument byte was written.

- Protocol read: `C:/tmp/dt004-frozen-instrument/research/cpg-u1/CPG_U1_PROTOCOL_004.md`,
  sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — the frozen protocol,
  verified by hash, **not modified**.
- Instrument read (read-only): `C:/tmp/dt009-merge/tooling`. Touched by exactly three ESM imports
  (`lib/canonical.mjs`, `lib/enumeration.mjs`, `lib/personnel.mjs`) and four file reads. Sizes and
  mtimes of those files are byte-identical before and after; `lib/enumeration.mjs`
  `b0bfdef33efc496ed5545f30e8dc76d30897d3c7140374decaccac1b1ebaaa31` and `lib/personnel.mjs`
  `6ba23dcf02b4574509dbf84cc9d2da4cb19f456af4037fcb1f2ff5ef4965d216` before and after.
- **No write under `C:/tmp/dt009-merge` or `C:/tmp/dt013-candidate`.** The running 404-mutant process
  was not started, stopped, inspected or interpreted. **No mutation suite and no `test/selftest.mjs`
  was run.**

---

## 1. What the protocol actually says about jurisdiction coverage

`CPG_U1_PROTOCOL_004.md` §5.7.1, line 379, verbatim:

> - **Jurisdiction balance** (decision D-A) [NORMATIVE]: within each class, families are interleaved
> round-robin in the fixed order `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY`, each family's queue in rank
> order. An exhausted family stops contributing and the others continue. **The realised jurisdiction
> composition is published**, and missing families are declared as a scope limitation.

Three clauses: (a) round-robin interleaving, (b) publication of the realised composition, (c) missing
families **declared as a scope limitation**. Clause (c) *permits* missing families — it prescribes a
disclosure, not a refusal. Clause (a) even anticipates exhaustion explicitly ("An exhausted family
stops contributing and the others continue").

§20 "Known limitations" confirms the reading:

> 1. Small, clustered, exploratory; no population, customer or jurisdiction generalisation.  *(:965)*
> 3. Four accessible jurisdiction families; identity resolution is under-tested elsewhere.  *(:967)*

I grepped the whole protocol for `jurisdiction`: hits at `:167, :206, :208, :212, :214, :379, :569,
:574, :830, :857, :965, :967`. **None states a family-count minimum, a per-family row minimum, or any
refusal condition.** Wave 012's finding is confirmed independently: the frozen protocol does not
require VP-2 to be in the registered instrument, so §11's instruction to keep it operator-side is
correct, and a per-family floor inside `frameSufficiency` would contradict clause (c) and need an
amendment (§6 `:446`) against clauses closed at registration (§19.1 `:936`).

**Consequence for this gate's threshold.** Because no minimum is registered, the gate asserts the
weakest non-vacuous one: **at least one distinct legal entity per allocated family**. Any higher value
is available via `--min-entities-per-family` but is stamped into the certificate as
`OPERATOR-CHOSEN, WITHOUT PROTOCOL BASIS`.

---

## 2. The five checks as implemented

`vp2_coverage_gate.mjs`. Every check is computed from a different direction, so no single mistake can
make two of them wrong the same way.

| id | requirement | implementation |
|---|---|---|
| `C1_EVERY_ALLOCATED_JURISDICTION_REPRESENTED` | every allocated jurisdiction is represented | frame side: for each family in the expected set, count **distinct entities whose every row lies in that family**; fail on any below the minimum. Reports the inclusive count too, so a reader sees what a laxer count would have given. |
| `C2_NO_ALLOCATED_JURISDICTION_COMPLETELY_ABSENT` | no allocated jurisdiction completely absent | allocation side: set difference `expected \ realised`, where `realised` is built from the exclusive-entity map. Also **fails when the expected set is empty**, which would otherwise make C1 vacuously true. |
| `C3_EXCESS_VOLUME_ELSEWHERE_CANNOT_COMPENSATE` | excess volume elsewhere cannot compensate | the verdict quantity is `min` over allocated families, never a sum. The certificate additionally records `aggregate_only_test_would_have_passed` and the per-family surplus that was **ignored**, so the compensation is visible and provably not counted. |
| `C4_DUPLICATES_CANNOT_MANUFACTURE_COVERAGE` | duplicates cannot manufacture coverage | see §3. Fails if any entity spans two families, or if any family reaches the minimum on **row** count but not on **distinct-entity** count. |
| `C5_EXPECTED_SET_IS_THE_AB_ALLOCATION` | the A/B allocation is the authoritative expected set | see §4. Also fails on any family present in the frame but outside the partition (`unexpected_jurisdictions`). |

A sixth entry, `A1_ENUMERATION_ATTRIBUTION_AT_THE_SAME_MOMENT`, appears only when `--tooling` and
`--personnel` are given; it is **not** one of the five (see §8).

---

## 3. How duplicates are prevented from manufacturing coverage

Coverage is counted in **entities**, not rows. Rows are clustered by union-find; two rows join if they
share **any** of five link keys, each derived only from columns the frame already carries:

| key | value | why |
|---|---|---|
| `ident` | `identifier_scheme` `:` `identifier_value` upper-cased with `. - / whitespace` removed | this is exactly `idKey` in `lib/select.mjs:6`, the first key `assertUnique` uses |
| `domain` | `canonical_domain` | the second key `assertUnique` uses |
| `reg` | last two labels of `canonical_domain` | catches `eu.acme.example` vs `acme.example`, which `assertUnique` treats as two entities |
| `qid` | `wikidata_qid` when it matches `^Q[0-9]+$` | a secondary identifier **of the entity itself** (`FRAME_COLUMNS[6]`), so it survives a changed primary identifier |
| `name` | `company_name` normalised: NFKD, combining marks stripped, `&`→`and`, non-alphanumerics collapsed, leading `the` dropped, trailing legal-form tokens dropped | catches `The Acme Ltd` vs `Acme Holdings` |

An absent, empty or `UNKNOWN` value yields **no key at all**, so two rows never join on a shared blank.

**Why this is the sound identity key here.** Wave work established that the same legal entity entered
under a *different* identifier **and** a *different* domain passes `assertUnique` (`lib/select.mjs:44-51`)
silently — it compares only those two keys, and both differ. `qid`, `reg` and `name` are exactly the
three further pieces of entity evidence the frame already holds, so adding them is strictly stronger
than the instrument's own uniqueness test and invents no new data. The certificate proves the
strictness claim per run: `duplicates.assert_unique_equivalent_would_pass` was **`true`** in the S4
scenario that this gate fails.

**Cross-family entities credit nobody.** A cluster whose rows sit in two families is counted toward
**neither**: which family it belongs to is precisely what the duplicate put in doubt. That is why S4's
LEI-ONLY drops from `1 row / 1 inclusive entity` to **0 coverage-bearing entities**, and US-SEC drops
from 3 to 2.

**The honest residue.** A duplicate whose identifier, `wikidata_qid`, `canonical_domain` **and**
normalised `company_name` all differ leaves no column-level evidence and is invisible to any check that
reads only the frame. The certificate therefore lists
`duplicates.rows_with_no_corroborating_link_key` and sets `unresolvable_duplicate_risk`. This gate
narrows the hole; it does not close it.

---

## 4. Where the A/B allocation is read from

Not from `FAMILY_ORDER`. `lib/schema.mjs:50` `FAMILY_ORDER` is the round-robin *order within a class*
(consumed only by itself and `lib/select.mjs:29`); it says nothing about who was asked to enumerate
what, and it cannot detect an allocation that omitted or added a family.

The expected set is read from the **pre-registered two-enumerator partition**:

- artefact schema `cpg-u1-enumeration-allocation/v1`, as produced by the DEEPTECH-PARALLEL-007
  partition proposal `C:/tmp/dt007-eight-person/C-partition-tooling/partition/partition.mjs`
  (`buildAllocation`), whose worked example is `partition/example/allocation.json`;
- the expected set is `union over enumerators[].allocated_cells[].jurisdiction_family`;
- the gate **recomputes** `allocation_digest = sha256("cpg-u1-enumeration-partition-digest/v1|" +
  canonicalJson(body))` and **refuses** (exit 3, no certificate) on a mismatch — so a hand-edited
  allocation cannot be passed off as the pre-registered one;
- it refuses an allocation with fewer than two enumerators, with a duplicated `person_id` across slots,
  or with an enumerator holding no cell;
- `FAMILY_ORDER_MIRROR` is kept **only** to report set divergence; if the allocation names a different
  set, the certificate records `DIVERGENCE: … the ALLOCATION governs`.

The slot-level governance this rests on is
`C:/tmp/dt007-eight-person/F-recruitment/ENUMERATOR_A_ALLOCATION.md` / `..._B_...`, both of which still
record `person_id: UNASSIGNED` and `<<UNFILLED>>` for the partition. **The real allocation does not
exist yet.** The rehearsal therefore uses a synthetic allocation with slot labels
`SYNTHETIC-ENUM-A/B`, and the gate's contract is: it consumes the real allocation artefact when there
is one, and refuses rather than guessing.

---

## 5. Synthetic rehearsal results

Full output: `rehearsal/REHEARSAL_RESULTS.txt`. Certificates: `rehearsal/S1..S5.certificate.json`.
Fixtures are generated by `rehearsal/make_fixtures.mjs` — all synthetic, `.example` domains,
`SYNTHETIC-` candidate ids, fixed literal `enumerated_at`. **The real frame was not constructed.**
`as_of` is the synthetic literal `2000-01-01T00:00:00Z`.

| scenario | verdict | C1 | C2 | C3 | C4 | C5 | key numbers |
|---|---|---|---|---|---|---|---|
| S1 full coverage | **PASS** | PASS | PASS | PASS | PASS | PASS | 12 rows / 12 entities; 3 per family |
| S2 one family absent | **FAIL** | FAIL | FAIL | FAIL | PASS | PASS | LEI-ONLY 0r/0e; missing `[LEI-ONLY]` |
| S3 absent but compensated | **FAIL** | FAIL | FAIL | FAIL | PASS | PASS | US-SEC 15r/15e, total 21 entities, `aggregate_only_test_would_have_passed: true`, surplus `US-SEC:+14` ignored |
| S4 coverage faked by duplicates | **FAIL** | FAIL | FAIL | FAIL | **FAIL** | PASS | 10 rows / 9 entities; `SYNTHETIC-0001+SYNTHETIC-0100` spans `LEI-ONLY+US-SEC`; `assert_unique_equivalent_would_pass: true` |
| S5 unexpected family present | **FAIL** | PASS | PASS | PASS | PASS | **FAIL** | `DE-HRB` 1r/1e flagged `*UNALLOCATED`; `unexpected_jurisdictions: ["DE-HRB"]` |

Determinism: every scenario was run twice and the serialised bytes compared —
`ALL SCENARIOS BYTE-DETERMINISTIC: true`.

S4 is the load-bearing one. `SYNTHETIC-0100` is `SYNTHETIC-0001` re-entered under `LEI-ONLY` with a
**different** identifier scheme (`LEI` vs `CIK`), a **different** identifier value and a **different**
canonical domain — exactly the case the instrument's `assertUnique` passes. It shares `wikidata_qid`
and the normalised name, so this gate links them, credits neither family, and fails C1–C4.

Two further runs exercise the optional §12 check at the same moment:
`rehearsal/S1_with_attribution.certificate.json` (PASS, exit 0) and
`rehearsal/S1F_forged_enumerator.certificate.json` (**FAIL**, exit 2, one error:
`SYNTHETIC-0001: enumerated_by SYNTHETIC-ENUM-FORGED is not an eligible enumerator …`).

---

## 6. Exactly where the barrier is mechanical and where it is procedural

### MECHANICAL — and it is real, but it is about *truth*, not *refusal*

1. **The composition is on-chain.** `jurisdiction_family` is `FRAME_COLUMNS[3]`
   (`lib/schema.mjs:15`), so it is inside `frame_hash = hashRecords(frame, 'candidate_id')`
   (`cpg_u1_data.mjs:104`), which is a committed payload field (`cpg_u1_data.mjs:372`). A certificate
   that misstates the realised composition is therefore **mechanically falsifiable** against the
   archived frame, and a frame silently swapped after the certificate is mechanically detectable
   (`cpg_u1_data.mjs:441` `VERIFY_ABORT_HASH_MISMATCH`; `lib/sampling.mjs:151`
   `STAGE_VOID_BINDING_MISMATCH`).
2. **The allocation is digest-bound.** The gate refuses unless the declared `allocation_digest`
   recomputes. An operator cannot retro-fit the expected set to the frame they got **and** keep the
   pre-registered digest.
3. **The certificate is self-verifying.** `certificate_digest` covers every field including
   `frame_hash`, `allocation_digest` and `as_of`.
4. **Attribution, when the check is run, is mechanical inside the instrument too** — refused at
   `cpg_u1_data.mjs:222`.

### PROCEDURAL — and this is where it stops

5. **Nothing consumes the certificate.** Independently re-verified in this wave:
   - `cmdFrame` (`cpg_u1_data.mjs:205-225`) is `console.log` plus one refusal; there is **no
     `writeOnce`** in it, so there is no frame-stage artefact a verdict could be written into;
   - all three sufficiency chokepoints — `cpg_u1_data.mjs:659-660` (`check-frame-sufficiency`),
     `:369-370` (`commitment-payload --stage development`, before the payload is written) and
     decisively `:444-445` (`draw-development` re-derives sufficiency **from the committed frame** and
     exits `EXIT.VOID` with `STAGE_VOID_FRAME_INSUFFICIENT`) — reach the rows only via
     `sufficiencyOf` → `frameSufficiency` (`lib/frame.mjs:41-50`), whose body reads
     `expected_outcome_class` and `candidate_id` **and nothing else**. The string `jurisdiction` does
     not occur in `lib/frame.mjs`.
   So a coverage FAIL cannot reach any chokepoint.
6. **Therefore "the development commitment must be prohibited while this gate fails" is NOT
   mechanically true, and this gate does not claim it is.** The strongest honest statement is:

   > **PROCEDURAL, with a published pre-commitment artefact whose absence and whose ordering are
   > externally detectable.**

   The prohibition rests on one human act: the key custodian declining to spend `O_dev`. The tooling
   says so itself (`cpg_u1_data.mjs:393`: *"Spend ONLY <outpoint> … The tooling creates no
   transaction."*). A custodian who ignores a FAIL suffers **no** machine consequence and **no** VOID.
7. **What the ordering mechanism does and does not buy.** Publishing the certificate as a public
   record linked to the registration, with a **registry-issued timestamp**, *before* broadcasting the
   `O_dev` spend gives a checkable ordering: registry timestamp < commitment block time. The protocol
   already relies on exactly this mechanism — the seal record is "a public record linked to the
   registration on OSF Registries … with a registry-issued timestamp" (`:456`), and that timestamp is
   already load-bearing for when the execution window opens (`:461`, §21 mapping `:1089`). So ordering
   becomes **mechanically checkable**. But ordering is not enforcement: it proves the certificate
   existed first, not that a failing certificate would have stopped anything.

**Making it mechanical would require** editing `lib/frame.mjs` plus `cpg_u1_data.mjs:369-370` and
`:444-445`, which moves `tooling_aggregate_sha256`, **and** a protocol amendment as a new file,
which moves `protocol_sha256`. Both are `SAMPLING_FIELDS` members (`lib/registration.mjs:119`), so
post-registration that is a restart, not a patch — and the refusal would contradict §5.7.1 clause (c).
**Not proposed. Not done.**

---

## 7. What an outsider can and cannot verify

**CAN:**
- that the tally in the certificate is **true**, by recomputing it from the archived frame (§13.2A
  `:815` lists the single frame F) and checking it against the on-chain `frame_hash`;
- that the expected set is the **pre-registered** one, by recomputing `allocation_digest` from the
  published allocation artefact;
- that the certificate is internally intact, by recomputing `certificate_digest`;
- that the certificate **predates** the commitment, by comparing the registry-issued timestamp of the
  published record with the commitment block;
- that the gate is deterministic, by re-running it on the published frame and allocation with the
  published `as_of` and comparing bytes;
- that the gate's duplicate test is **stronger** than the instrument's, from
  `assert_unique_equivalent_would_pass` plus the published link-key definitions.

**CANNOT:**
- that any threshold was *enforced* — nothing mechanically refuses at any point;
- that a **failing** frame would have been rejected;
- that the certificate was not written to match a frame already chosen;
- that **no other frame was enumerated and discarded** before this one. The registration precedes
  enumeration (§5.5 steps 2→3, `:264`, `:266`), so nothing binds the *first* frame enumerated;
- that the operator ran the gate at all, beyond the absence of a published certificate. Absence is
  externally detectable **only if** the operator has published, in the registration record, an
  undertaking that a certificate will exist — otherwise a reader cannot distinguish "no certificate"
  from "no gate was ever promised". **That undertaking is an owner act, not something this gate can
  supply.**

---

## 8. `enumerated_by` — §12 verification

Runner: `enumerated_by_verify.mjs --tooling <dir>`. Output: `ENUMERATED_BY_RESULTS.txt`.
**No instrument code changed; the implemented mechanism is preserved and exercised, not replaced.**
The instrument's own `checkEnumerationAttribution` / `checkPersonnelRegister` are imported read-only;
nothing is reimplemented. **Result: 22 assertions, 22 passed, 0 failed** (3 positive controls, the 8
required checks, 11 static/dynamic confirmations).

| # | required check | result |
|---|---|---|
| 1 | every row requires `enumerated_by` | **PASS** — one missing row among valid ones is caught; 3 missing rows → **3** errors (per-row, not first-only) |
| 2 | the id resolves to personnel | **PASS** — exact roster membership (`lib/enumeration.mjs:45`, Set built at `:15-17`). A value satisfying `PERSON` but absent is refused; a value violating `PERSON` is refused **for absence, not for shape** |
| 3 | the person holds the ENUMERATOR role | **PASS** — `registeredEnumerators` → exactly the 2 enumerator slots out of 8 assignments; the 6 other roles are not in the eligible set |
| 4 | **missing id fails** | **PASS** — all five shapes: absent field, `""`, `"   "` (trimmed at `:29`), `null`, non-string |
| 5 | **unknown id fails** | **PASS** — 2 rows → 2 errors, each naming the register's actual holders |
| 6 | **inactive id fails** | **see §9 — "inactive" does not exist in the model.** The three implemented proxies all fail: a §4A.1 declaration not `"no"`; a missing `organisation_confirmation_sha256`; removal from the register (→ `role enumerator is UNFILLED`) |
| 7 | **wrong role fails** | **PASS** — for all 6 non-enumerator roles |
| 8 | **A and B must be distinct** | **PASS** — one person in both slots → `ROLE COLLISION: one person occupies both enumerator slots` (`lib/enumeration.mjs:42`), and independently from `checkPersonnelRegister` |

Established facts, each re-confirmed at the exact line:

- `lib/enumeration.mjs:45` — `if (a.id && !eligible.has(a.id)) errors.push(…)`: **exact roster
  membership, not a shape regex**; the Set comes from `registeredEnumerators` at `:15-17`.
- `lib/personnel.mjs:14` — `const PERSON = /^[A-Za-z0-9_-]{1,64}$/;`. The token `PERSON` **never
  appears** in `lib/enumeration.mjs`: it constrains **the register**, never `enumerated_by`.
- `lib/personnel.mjs:32` — pushes `person_id missing or malformed` and then `continue`s.
- `lib/enumeration.mjs:35` — `errors.push(...reg.errors.map(…))`: **unconditional** propagation
  (blockers are deliberately not propagated; `:37-40` states why).
- `cpg_u1_data.mjs:220` / `:222` — single call site, then
  `ENUMERATION_ATTRIBUTION_REFUSED` on any error. Confirmed end to end: a malformed register
  `person_id` arrives as `personnel register: assignment 0 (enumerator): person_id missing or
  malformed` and would fail at `:222`.
- Mutants **M424–M430** exist in `test/mutate.mjs` and target this mechanism (M424 forged accepted,
  M425 §4A.1 errors dropped, M426 any role accepted, M427 missing identity accepted, M428 both slots
  one person accepted, M429/M430 positive controls). **Not executed — no mutation suite was run.**

---

## 9. Does "inactive" exist at all?

**No.** Stated plainly rather than invented:

- `lib/personnel.mjs` (42 lines, read in full) contains **no** `active`, `inactive`, `revoked`,
  `withdrawn` or `status` token. Its model is: schema, one operator, an array of `{role, person_id,
  declaration, study_fee_agreement_sha256, organisation_confirmation_sha256}`.
- Nothing in `lib/` anywhere carries an active/inactive concept for personnel. The only `"active"` in
  the tree is `registryStatus: 'active'` in an unrelated selftest fixture about a *company* registry
  record (`test/selftest.mjs:1132`).
- The protocol's only adjacent notion is **withdrawal of the registration** (`:300`, `:427`, `:1030`),
  which is about the OSF record, not about a person's standing.
- `test/selftest.mjs:891` labels a declaration failure "inactive / not eligible", but that is a
  **comment**; the mechanism it tests is a §4A.1 declaration that is not `"no"`.

So "inactive id fails" cannot be a test result. What **is** implemented and does fail: a person whose
§4A.1 declaration is not `"no"`; a person without the developing organisation's confirmation; and a
person absent from the register. What is **not** representable: a person who was eligible when they
enumerated and whose standing was later revoked, or vice versa — the register has no validity interval
and `enumerated_by` resolution is evaluated against whatever register the operator passes at
`frame --personnel` time. **OWNER DECISION REQUIRED** (item D-1 below).

---

## 10. The one-caller fail-open, and whether this gate closes it

Re-verified by counting from source: `loadFrame` has **7** callers (`cpg_u1_data.mjs:206, 365, 435,
490, 655, 762, 810`) while `checkEnumerationAttribution` has **1** (`:220`, inside `cmdFrame`). Also
re-verified dynamically: with no register supplied, resolution is **not attempted at all** — a forged
id yields 0 errors — while presence of *some* value is still required. So a fabricated-but-unregistered
`enumerated_by` is refused **only if** the operator runs `frame --personnel`.

**Can this gate close it?** Both live at the same pre-commitment moment, so the gate *can run the same
function*: `--tooling <dir> --personnel <file>` imports the instrument's own
`checkEnumerationAttribution` read-only, records `module_sha256`, the registered enumerators and every
error into the certificate, and **binds the verdict** (check `A1`). Demonstrated: the forged-enumerator
frame yields `verdict: FAIL`, exit 2.

**But it does not close it mechanically**, and for exactly the same reason as VP-2 itself: skipping the
gate is as easy as skipping `frame --personnel`. It converts *one* skippable step into *two*
independent skippable steps recording the same fact, one of which leaves a digest-bound published
artefact. That is a real improvement in detectability and **no** improvement in enforceability. The
only mechanical fix is a second in-instrument call site — an instrument change, out of scope here and
**not** proposed.

---

## 11. OWNER DECISION REQUIRED

- **D-1. No active/inactive concept for personnel.** Decide whether the register needs a validity
  interval (and therefore whether `enumerated_by` should resolve against the register *as it stood when
  the row was enumerated*), or whether the §4A.1 declaration plus register membership is the intended
  and sufficient model. Adding one is an instrument change. Recommendation: **document the absence as
  the model** rather than add a field after registration.
- **D-2. §11's wording.** "The development commitment must be prohibited while this gate fails" is not
  mechanically achievable operator-side (§6). Either accept the wording
  *"PROCEDURAL, with a published pre-commitment artefact whose absence and ordering are externally
  detectable"*, or accept a re-registration to make it mechanical. No approval is inferred here.
- **D-3. Publication undertaking.** For the certificate's *absence* to be externally detectable, the
  registration record must say that a VP-2 certificate will be published before the `O_dev` spend. That
  is an owner act; the gate cannot supply it. Without it, an outsider cannot distinguish "no
  certificate" from "no gate promised".
- **D-4. Clause (b) of §5.7.1.** Whether *"the realised jurisdiction composition is published"* is
  discharged by this certificate plus the recomputable sealed artefacts, or requires a tooling-emitted
  tally inside the seal. A reading question, unchanged from wave 012.
- **D-5. The minimum.** Whether to keep the minimum at 1 (the only value with no invented threshold) or
  record a higher operator-chosen one, knowing it will be stamped
  `OPERATOR-CHOSEN, WITHOUT PROTOCOL BASIS`.
- **D-6. The allocation does not exist.** Both enumerator slots are `UNASSIGNED` and the partition is
  `<<UNFILLED>>`. The gate cannot be used for real until a real `cpg-u1-enumeration-allocation/v1`
  artefact exists and is pre-registered with its digest.

---

## 12. Risks

1. **Advisory mistaken for a barrier.** The dominant risk. Mitigated by refusing to call it a gate in
   the artefact: `classification`, `barrier.kind`, `barrier.mechanically_enforced: false` and
   `limitations[1]` all say so, and stderr prints the reminder on every run.
2. **Operator discretion.** The operator chooses whether to run it, whether to publish the certificate,
   and whether to proceed on FAIL. The frame is pre-outcome, so the discretion is not yet
   outcome-dependent — but it is unbounded.
3. **Name-based linking can over-merge.** Two genuinely distinct entities with the same normalised name
   would be merged and *understate* coverage. The direction is conservative (it can only cause a FAIL,
   never a false PASS), and the cluster's `candidate_ids` and `shared_link_keys` are printed so an
   operator can see and contest it.
4. **Duplicate residue.** A duplicate differing in all four evidence columns is invisible; declared via
   `unresolvable_duplicate_risk`.
5. **Admissibility is not recomputed.** Coverage is over the frame as enumerated unless the operator
   supplies `--exclude-ids` from the instrument's own output. Deliberate: reimplementing
   `checkFrameRow` would create a second, divergable admissibility rule.
6. **Optional attribution check depends on the instrument path.** If `--tooling` points at a modified
   tree, the check means whatever that tree means; mitigated by recording `module_sha256`.
7. **Synthetic-only evidence.** Nothing here has been exercised on a real frame or a real allocation,
   because neither exists. The rehearsal shows the gate's behaviour, not the study's.
8. **`as_of` is operator-supplied.** It carries no authority; ordering authority comes only from the
   external registry timestamp (§6.7).

---

## 13. Deliverables in this directory

| file | what |
|---|---|
| `vp2_coverage_gate.mjs` | the gate (standalone; outside every instrument tree) |
| `ARTEFACT_SCHEMA.md` | certificate schema and the determinism argument |
| `VP2_GATE_RECORD.md` | this record |
| `enumerated_by_verify.mjs` | §12 targeted verification runner |
| `ENUMERATED_BY_RESULTS.txt` | its real output (22/22) |
| `rehearsal/make_fixtures.mjs` | synthetic fixture generator |
| `rehearsal/run_rehearsal.mjs` | five-scenario runner, twice each, byte-compared |
| `rehearsal/allocation.json`, `personnel_synthetic.json`, `S1..S5*.csv` | synthetic inputs |
| `rehearsal/S1..S5.certificate.json`, `S1_with_attribution…`, `S1F_forged_enumerator…` | real outputs |
| `rehearsal/REHEARSAL_RESULTS.txt` | the rehearsal transcript |

**DISPOSABLE.** Nothing here is registered, committed, pushed or referenced by any instrument.

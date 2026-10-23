# DEEPTECH-PARALLEL-009 — owner decision record

**Recorded before any code change, as the directive requires.** This record is the authorisation under which the
engineering changes in this wave are permitted. Nothing here is registered, committed, pushed, published or broadcast.

## Baseline identities, verified by me at task start

| Item | Value | Result |
|---|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` | verified |
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | verified — **must not change** |
| Treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | verified, clone clean — **must not change** |
| Evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | verified — **must not change** |
| Development registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | verified — **must not change** |
| Instrument aggregate **before** this wave | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) | verified — **expected to change, and only this** |

---

## DR-1 — drand relay floor · OWNER DECISION: ADOPT OPTION (B)

**Decision.** Implement a ≥ 2 independent-relay floor with explicit per-relay attribution.

**Findings this decision rests on** (established in DEEPTECH-PARALLEL-008 and verified there):
`lib/evidenceBundle.mjs:35` rebuilds each beacon from exactly `{round, randomness, signature}`, so **relay identity is
discarded** and a one-relay bundle and a ten-relay bundle can be byte-identical. `lib/sampling.mjs:180` needs only one
beacon. §19.3 asks for "≥ 2 drand relays for verification", so the requirement is procedural today. Two earlier
candidate patches were measured and **neither aggregate is registrable**, because neither carried the required test
changes — the registrable value is unknowable until the implementation and tests are rewritten and green.

**The ten requirements are adopted verbatim and no additional requirement is inferred:** ≥ 2 distinct relays per
bundle · relay identity survives into the evidence representation · duplicate use of one relay does not satisfy the
floor · the verification result distinguishes the relays · a one-relay bundle fails closed · a two-relay bundle
passes · malformed or missing relay identity fails closed · relay identity enters the deterministic evidence path so
one-relay and two-relay bundles cannot hash alike · the test suite proves the distinction explicitly · no cryptographic
authenticity weakening.

**Scope limit.** Protocol semantics must not change. If the floor cannot be implemented without changing them, that is
a STOP condition.

## DR-2 — §19.3 certenv wording · OWNER DECISION: ADOPT OPTION (A)

**Decision.** Keep the frozen protocol wording unchanged. "certenv with a fixture tenant" is a **procedural
description**, not an assertion that a persistent fixture tenant exists in the resolver clone.

**Consequences, recorded rather than implemented:** no fixture tenant is created · the protocol SHA does not change ·
no new protocol version is created · the implementation reality is disclosed in the registration supporting note —
certenv is isolated, the fixture-company identifier is a test label, no production database is accessed, no real tenant
is required for the resolver clone, the harness refuses unsafe `.env` construction, and this wording alters neither
treatment nor measurement.

**This decision requires no code change.** It is a documentation and disclosure act only.

## DR-10 — `cmdScan` duplicate collapse · OWNER DECISION: FIX BEFORE REGISTRATION

**Decision.** Fix the defect before registration.

**Finding this rests on** (established and verified in DEEPTECH-PARALLEL-008): `cpg_u1_data.mjs:233` builds a `Map`
keyed on `candidate_id`, which keeps only the last row for a repeated key, and it is reachable because line 230 loads
with `loadCsv`, not `loadFrame`. With a **divergent** duplicate the collapse **hides real contamination** — the control
frame flags the row with two repository hits and a registry match, while the duplicate frame reports
`held_out_ineligible_by_scan=false` (control flagged 6, duplicate frame 5) — and `scan.frame_hash` still matches the
full frame, so the artefact attests to rows it never assessed. Ten downstream commands refuse it and both bypasses are
closed, so it is not evidence-bearing; it is fixed because it is cheap now and impossible after registration.

**The twelve requirements are adopted verbatim:** preserve every occurrence needed for contamination detection ·
normalisation may serve efficiency but must not erase provenance-bearing occurrences · a duplicate stays attributable to
source file, source location where available, matched identifier/name/domain, and contamination reason · a contaminated
occurrence must never vanish because an identical one was seen first · fail-closed behaviour is retained · a regression
fixture proves the historical failure mode · negative controls prove benign duplicates are still handled · scan
semantics are not broadened beyond the defect · admissibility rules, the development registry, the frozen protocol and
frame-construction rules are all unchanged.

## Additional authorised change — `enumerated_by` personnel binding

**Decision.** Implement the minimum control analogous to the one that already exists for rater assignment.

**Finding this rests on** (verified by me in DEEPTECH-PARALLEL-008): `enumerated_by` appears in only three places
across all 593 files — `lib/schema.mjs:32` as a column name, `:124` as a non-blank check, and the CSV template header —
and **nothing cross-references the personnel register**. Yet the pattern already exists in the same instrument:
`lib/assignment.mjs:10/19/34-35` binds rater labels to the register via `checkPersonnelRegister`, and
`cpg_u1_data.mjs:945` supplies `--personnel`. `cmdFrame` has no equivalent. **The gap is an asymmetry in application,
not a missing capability**, so the fix follows the instrument's own idiom.

**Explicitly an integrity control, not a protocol amendment.** No new scientific rule; no change to sampling,
admissibility or frame-construction semantics. If it would change any of those, that is a STOP condition.

## Decisions explicitly NOT reopened

The no-rater path stays **NOT IMPLEMENTED**; S1 and S5 stay **NOT COMPUTED**; sub-reason disagreement stays
**diagnostic only**; INVALID items remain in packets and are excluded per AD-1; and the nine recorded AD values stand
unchanged (`rules/analysis_decisions.json`, status `DECIDED`, sha256
`a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`).

## Integrity gate for this wave

Only the **tooling aggregate** may change. Protocol, treatment, evaluation tree, development registry and provider
configuration must all be byte-identical before and after. Anything else changing is a STOP.

## Method note — why each change gets its own tree

DR-1, DR-10 and the `enumerated_by` binding are implemented in **three separate isolated copies** of the instrument and
merged centrally afterwards, rather than by several agents editing one tree. The directive warns to stop overlapping
work rather than allow conflicting edits; separate trees make a conflicting edit impossible by construction, and the
merge is then a reviewable step rather than a race.

**The frozen working instrument at `C:/tmp/dt002` is not modified by any agent in this wave.** It remains the "before"
baseline for the integrity gate.

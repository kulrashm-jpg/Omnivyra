# DEEPTECH-PARALLEL-009 — registration-critical decision closure

**Nothing registered, committed, pushed, merged to any branch, published, or broadcast. No OP_RETURN. No U1
execution. No real frame. No dataset executed. No independent validation claimed. No result here is U1 evidence.**

Evidence classes used below: **VERIFIED** (I ran it myself), **REHEARSED** (run on synthetic fixtures),
**PREPARED** (document only), **EXTERNAL INPUT REQUIRED**, **NOT EXECUTED**.

Artefacts: `C:/tmp/dt009-closure/` · candidate instrument: `C:/tmp/dt009-merge/tooling`.

---

## 1. BASELINE IDENTITIES — VERIFIED

Recorded in `orchestrator/DECISION_RECORD.md` **before any code changed**, with a per-file manifest of the instrument
(`BEFORE_manifest.txt`, 593 lines) so the integrity gate could be exact rather than aggregate-only.

| Item | Value |
|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` |
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| Treatment | `f01a7eb4199be4e04d4fee7fc0116303949dc553` (clean) |
| Evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` (= the treatment's root tree) |
| Treatment content aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files) |
| Development registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` |
| Instrument **before** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) |

Instrument health before any change, my own runs: selftest **1022 / 0**, anchors **389/389**.

## 2. DR-1 DECISION — RECORDED

Option (B) adopted: a ≥ 2 **distinct**-relay floor with per-relay attribution. Ten requirements adopted verbatim,
nothing inferred. Recorded before implementation began.

## 3. DR-1 IMPLEMENTATION — VERIFIED

Six files: `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs`,
`README.md`. Isolated aggregate `24b03c606b78e2a6867edf0294e7db420f6957556ae001ec8ccb1d8e48d7939c`.

**The root cause was worse than "no floor":** `evidenceBundle.mjs` rebuilt each beacon from exactly
`{round, randomness, signature}`, **discarding relay identity**, so a one-relay and a ten-relay bundle were
byte-identical. The fix carries a sorted, de-duplicated `relays[]` into the deterministic evidence representation and
enforces the floor at **both** builder and verifier.

**Requirement 8, proved by reproducing the defect first — REHEARSED on synthetic beacons:**

```
OLD representation: one-relay 073aa5bb…   two-relay 073aa5bb…   identical: true    <- the defect
NEW representation: one-relay 62def2a4…   two-relay b999df9a…   identical: false
```

One relay rejected · two distinct relays accepted · **same relay duplicated rejected** · missing and malformed relay
identity rejected · absence still yields `WAITING_DRAND_ROUND` rather than a floor error, so the §5.7.1 state machine
is untouched.

## 4. DR-1 FULL VERIFICATION — VERIFIED

Selftest **1050 passed, 0 failed, 0 skipped**; anchors **392/392 occur exactly once**; adapter **18 / 0**;
`verify-protocol` PASS with the protocol unchanged; evaluation tree PASS. **392 rather than the audited 391** because a
third mutant covers the builder-side dedup guard, which would otherwise be mutation-uncovered — the right trade.

## 5. DR-10 DECISION — RECORDED

Fix before registration. Twelve requirements adopted verbatim.

## 6. DR-10 IMPLEMENTATION — VERIFIED

Three files: `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs`. Isolated aggregate
`c6869ff561a3a92271508391467e6fc95cedd67233bda85b5d72505c3d6c51de`.

Strategy chosen deliberately: **scan every occurrence, report each with full attribution, then refuse.** Retention was
rejected because the resulting artefact is unconsumable *and* would push the identical last-value-wins hazard
downstream into `contamination()`; refusing before the scan was rejected because no matched identifier or contamination
reason exists until the scan has run.

## 7. DR-10 FULL VERIFICATION — VERIFIED

Selftest **1035 / 0**; anchors **394/394**; adapter **18 / 0**; protocol PASS. On a **well-formed** frame the artefact is
**byte-identical** to the old instrument's — the right proof that nothing was broadened. The historical failure mode is
now asserted **inside the suite**, so it is checked on every future run without the old binary.

**One honest correction to my own brief:** I asked for confirmation that *ten* commands refuse a duplicate frame.
`verify-commitment` never reads `--frame`, so it cannot be induced by one at all. It is **nine refusals plus an upstream
fence** at `commitment-payload`.

## 8. `enumerated_by` PERSONNEL BINDING — VERIFIED

Five paths including the new `lib/enumeration.mjs`. Isolated aggregate
`ff7ec4a7841c64831c4c8aa56f5ca511b7df7b3a6857f53d05d2a1f06e22cee3` (594 files). Selftest **1041 / 0**; anchors
**396/396**; **all seven mandated mutation cases KILLED**, including both positive controls.

The gap was an **asymmetry**, not a missing capability: `lib/assignment.mjs` already binds rater labels to the register
and `cpg_u1_data.mjs:945` already supplies `--personnel`; `cmdFrame` had no equivalent. The fix follows that idiom.

Three design judgements I endorse: `--personnel` is **mandatory in the CLI** (an integrity control reachable only by
remembering a flag is not one); register **blockers are deliberately not propagated**, because §4A stages appointments
and enumeration is the *first* stage — the literal mirror would have forced inventing rater identities to screen a
frame, a prohibition and a stop condition; and **no `active` field was invented**, "eligible" being read as good
standing under §4A.1.

Attribution was **already** inside `frame_hash` (`enumerated_by` is `FRAME_COLUMNS[19]`, and `canonicalJson` serialises
every key), so no redundant hashing was added — proved by assertion rather than asserted.

## 9. ENUMERATOR A/B STATUS — PREPARED · EXTERNAL INPUT REQUIRED

Six artefacts. The register holds **eight `PENDING_PERSONNEL` placeholders and no person**. **VERIFIED by me:**
`check-personnel` **refuses it — exit 1, 9 errors** — because the placeholders cannot match the frozen
`person_id` pattern. No name, pseudonym, signature, fee, declaration, confirmation or date was invented anywhere.

**Two instrument limitations I verified myself:** a **shared fee-agreement hash in both enumerator assignments passes
with 0 errors, 0 blockers** — nothing compares the two, so the non-dependence requirement is unmechanised and only an
operator's own hash comparison catches it; and a malformed `person_id` **masks every later check on that assignment**
(`lib/personnel.mjs:32` ends with `continue`), so a refusal list understates how incomplete a register is.

The non-dependence requirement is **genuinely new** — §4A.1 items 1–4 all run *person → developing organisation* and
item 6 is relational, not economic, so two strangers with one sub-contracting the other pass everything already
recorded.

## 10. REGISTRATION PACKAGE STATUS — PREPARED

Five artefacts recording DR-1, DR-2 and DR-10, and representing Enumerator B. **VERIFIED by me:** the registration
record contains **no personnel field at all**, and `SAMPLING_FIELDS` has none either — so **no roster change can ever
void a registration**, and Enumerator B touches **zero registration fields**.

**VERIFIED:** a provisional placeholder **fails closed and louder than a blocker** — `tooling_aggregate_sha256` set to
`<<PROVISIONAL: …>>` gives exit 1 with `must be 64 lowercase hex characters`. **But the corollary matters more: a
plausible wrong 64-hex digest would pass silently**, because `registered()` reports blockers first so the comparison
against a registered value is unreachable. **The aggregate is the one registration field with no independent guard** —
which is exactly why two clean rebuilds are required before it is quoted.

## 11. PROVISIONAL TOOLING AGGREGATE — VERIFIED, PROVISIONAL

```
files 594   aggregate 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
```

**Seven changed paths**, the union of the three streams, one of them new (`lib/enumeration.mjs`): 593 → 594 files.

**This is NOT the final registrable aggregate.** Section 10 requires the complete mutation suite first. It is currently
running (§13).

## 12. CLEAN-REBUILD REPRODUCTION — VERIFIED

| Computation | Result |
|---|---|
| My manifest recipe, clean rebuild 1 | `638d68e6…`, 594 files |
| My manifest recipe, clean rebuild 2 | `638d68e6…`, 594 files |
| **The instrument's own `lib/aggregate.mjs`** | `638d68e6…`, 594 files |

The third line is the important one — the instrument's own definition agrees with mine, not merely my recipe with
itself. (A naive `xargs sha256sum | sha256sum` yields a different value and must never be used.)

## 13. COMPLETE MUTATION RESULT — IN PROGRESS, NOT COMPLETE

**Started**, `--jobs 4`, log at `orchestrator/MUTATION_RUN.log`. First line confirms
**`anchors: 404/404 occur exactly once`**.

**404 = 389 baseline + 15 new** (3 DR-1, 5 DR-10, 7 enumeration). Every mutant runs the entire selftest; the last full
389-anchor run took **17 h 36 m**, so this will take roughly that again. **No result may be claimed until it returns**,
and a run that stops early is invalid.

### The integration defect the merge caught

All three streams independently claimed **M416 onwards** for different mutants — a three-way ID collision.

| ID | DR-1 | DR-10 | enumeration |
|---|---|---|---|
| M416 | beacon without a named relay | scan state keyed on `candidate_id` | forged/unregistered enumerator |
| M417 | single-relay round accepted | duplicate `candidate_id` not refused | not eligible under §4A.1 |
| M418 | same relay counted twice | pair not counted as duplicate | any role accepted as enumerator |

**Every existing check would have passed it**, because anchors key on the *search text*, not the ID — so `392/392`,
`394/394` and `396/396` are each true in isolation and stay true after a careless merge. What breaks is `--only`
selection and result attribution. Resolved deterministically: DR-1 keeps **M416–418**, DR-10 becomes **M419–423**,
enumeration becomes **M424–430**. Result: **404/404 unique anchors, zero duplicate IDs**, `node --check` clean.

`cpg_u1_data.mjs`, `test/selftest.mjs` and `README.md` all **auto-merged cleanly** — the streams worked in different
regions. Only `test/mutate.mjs` conflicted, and the harness reported it rather than picking a side.

## 14. FROZEN-IDENTITY COMPARISON — VERIFIED. Only the aggregate moved.

| Object | Before | After | Verdict |
|---|---|---|---|
| Protocol | `c50fc680…` | `c50fc680…` | **unchanged** (`verify-protocol` PASS) |
| Treatment | `f01a7eb4…` | `f01a7eb4…` | **unchanged**, clone clean |
| Evaluation tree | `3b4811fc…` / `ffe4f603…` | identical | **unchanged** (`verify-evaluation-tree` PASS, 11552 files) |
| Development registry | `a1392952…` | `a1392952…` | **unchanged** |
| Provider configuration | `c9a7e9aa…` | `c9a7e9aa…` | **unchanged** |
| **Tooling aggregate** | `f7699f05…` | `638d68e6…` | **changed — the only permitted change** |

Also on the merged candidate: adapter **18 / 0**; full selftest **1082 passed, 0 failed, 0 skipped**
(= 1022 + 28 + 13 + 19, exactly as predicted).

## 15. EXTERNAL REGISTRATION LEAVES — EXTERNAL INPUT REQUIRED

`verify-registration` still refuses: **exit 4, nine BLOCKED lines, zero errors**. Eleven unresolved leaves —
accountable identity · PID type · PID value · Bitcoin wallet-key custodian · `as_of` · OSF `registration_id` · OSF
`registration_timestamp` · `outpoints.development` · `outpoints.held-out` · `checkpoint.height` · `checkpoint.hash`.
**None manufactured.** Plus `tooling_aggregate_sha256`, unresolved for a different reason: provisional until §13 returns.

## 16. REMAINING HUMAN ACTIONS

1. **Four aggregate-moving decisions, to be taken in one sitting** so the aggregate moves once more at most:
   **DR-11** — the same last-value-wins collapse at `cpg_u1_data.mjs:113`, `new Map(scan.results.map(...))`, inside
   `contamination()` which nine commands use; **VERIFIED to exist by me**; one line closes it; needs a hand-edited
   artefact, so a different threat model from DR-10. **`EVIDENCE_SCHEMA` /v1 → /v2** — the beacon input shape is now a
   breaking change. **`TOOL_VERSION`** and the **README enforcement row**.
2. **K-4, which blocks enumerator packet assembly and is not aggregate-related** (§17).
3. Recruit eight independent persons into the **original** roster; name the custodian; supply identity, PID and `as_of`;
   fund the two outputs and choose the checkpoint.
4. Rule on DR-7's minimum reading and DR-8's item-6 reading; both cost no frozen byte.
5. Correct the six documents that still quote `f7699f05…`, and DR-7's "Objects affected: NONE" clause, which DR-1 and
   DR-10 now falsify.
6. Assign an owner for **cross-partition entity reconciliation** — the same entity under a different identifier *and*
   domain passes `assertUnique` silently. Open since DR-8; raised independently by three streams.

## 17. PROTOCOL IMPACT — none made; one conflict referred

**No protocol byte changed and no new version was created.** DR-2 was adopted as option (A) — a documentation and
disclosure act, changing no hashed object.

**K-4 — a genuine conflict between the directive's §4 rule and the frozen protocol, CONFIRMED BY ME, not amended.**
The directive's exclusion list contains "contamination findings". But protocol line 226 is
`### 5.3 Held-out ineligibility (CPG-C1)` — **§5.3 *is* the contamination section** — and §4A.2's receive-list
expressly grants "§4A, **§5.1–§5.4**" **and** "**the development-only registry**". Applied literally the exclusion
withholds what the protocol grants, and since §5.3 treats `unknown` **exactly like** `yes`, every unanswerable
attestation becomes a held-out ineligibility. **The rule as written would make enumeration impossible while looking
like diligence.** Narrower wording is proposed for your ruling; nothing was changed. K-1, K-2 and K-3 are referred the
same way — K-3's core point being that "operational information necessary to perform their assigned work" is genuinely
**broader** than a closed "receive only" list and must be read as a ceiling, not a grant.

## 18. INTEGRITY / CONTAMINATION RESULT — VERIFIED

Frozen identities unchanged (§14). No production change, no database migration, no credentials, no network call, no
relay contacted, no fabricated identity or external value. Every fixture synthetic (`SYN-*`, `SYNTHETIC-CO-*`,
`.example` per RFC 2606). Three isolated trees meant a conflicting edit was impossible by construction; the frozen
working instrument at `C:/tmp/dt002` was **never written to** and re-verifies at `f7699f05…`.

**A measurement trap I walked into myself, recorded rather than glossed:** I appended `grep -ci "skip"` to a selftest
command, and grep exits **1** when it finds no matches — so a *clean* result produced a failure exit code and the run
was reported as failed. The selftest had passed 1082/0. **Never let a diagnostic command supply the exit status of a
verification run.**

## 19. EXACT NEXT OPERATOR ACTION

**Take the four aggregate-moving decisions now, in one sitting** (DR-11, `EVIDENCE_SCHEMA` /v1→/v2, `TOOL_VERSION`,
README row), because the mutation suite must then be re-run once over the final byte set — and re-running it costs
another ~18 hours each time the aggregate moves. **Rule on K-4 in the same sitting**, since it blocks enumerator packet
assembly independently of the aggregate.

Then, once §13 returns with zero survivors, timeouts and errors, and two clean rebuilds still agree, the aggregate may
be reported as final — and only then, with your explicit authorisation, committed.

**The tooling is not registered. The dataset is not executed. No result here is U1 evidence, and no independent
validation exists.**

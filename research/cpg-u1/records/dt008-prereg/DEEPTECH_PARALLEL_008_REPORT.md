# DEEPTECH-PARALLEL-008 — pre-registration acceleration and execution lock

**Status: PREPARATION. Nothing registered, committed, pushed, executed or broadcast. No frozen byte changed.**
All artefacts at `C:/tmp/dt008-prereg/` (59 files). Evidence classes are marked throughout; **no preparation artefact is
evidence, no synthetic rehearsal is U1 evidence, and no claim of independent validation is made.**

---

## 1. VERIFIED BASELINE

All seven frozen identities re-verified by me at task start, not assumed:

| Item | Value | Result |
|---|---|---|
| `origin/main` | `33bceb1f919113c622587fa7c6403a0d4596bbad` | moved since the last wave (PR #271, unrelated PI work) |
| `origin/main:research/cpg-u1` | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | **identical at the old and new tip** |
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | matches |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | 593 files, matches; re-verified after every stream |
| Treatment | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | matches, clone clean |
| Evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | confirmed = the treatment's **root tree** |
| Treatment content aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` | 11552 files, matches |
| Development registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | matches |
| Provider configuration | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | re-verified unchanged |

**Instrument health, my own runs:** frozen selftest **1022 passed, 0 failed** (exit 0, with
`CPG_U1_RESOLVER_CLONE` set); `mutate.mjs --anchors` → **389/389 occur exactly once** (exit 0).

**Four re-verification traps, all confirmed by me** — each has already misled an agent in this programme:
1. The worktrees' own `research/cpg-u1/tooling` is a **stale 587-file tree** (`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`). It imports and runs cleanly and yields a self-consistent **wrong** aggregate. Nothing warns you.
2. `git rev-parse main` in a worktree returns a **stale ref** (`fef341785dffcbaf4c3a5ac715a6ce63b58e58c2`). Use `origin/main`.
3. The frozen selftest exits **2** without `CPG_U1_RESOLVER_CLONE`, and `test_tools.mjs` exits **1** without it. Neither is a failure.
4. A naive `xargs sha256sum | sha256sum` over the same 593 files gives `b5f63446…`, **not** the registered aggregate, which reproduces only via the instrument's own `toolingManifest()`.

## 2. EIGHT-PERSON MODEL STATUS

**Authorised, unchanged, and confirmed by my own test:** I constructed an eight-person register (two enumerators) and
`checkPersonnelRegister` accepted it with **0 errors, 0 blockers**. I also confirmed it tolerates unknown root-level and
unknown per-assignment keys with 0/0 — which is what allows a restricted-register field such as a pairwise-check record
to be added with **no instrument change and no aggregate change**.

No role was merged, removed or weakened. Both enumerators carry the literal role string `enumerator`.

## 3. ENUMERATOR B STATUS

**PREPARATION complete; HUMAN INPUT outstanding.** Seven artefacts: fee-agreement template, material-release gate,
authorisation record, deadlines, A/B differences, and a packet validator with tests — **106 assertions, 106 passed**
(my run). **153 unfilled markers, and I verified no fabricated identity, fee or date anywhere.**

**The fee-ordering question is settled** (§4A.1 item 5, "agreed in writing before any role material is released"). The
text is ambiguous between "material to that person" and "material to anyone". The decisive ground for rejecting the
literal global reading is that it contradicts §19.3(3), which requires personnel "**before the respective stage**" —
expressly staged recruitment, with raters arriving long after the enumerators' packets. **Adopted rule:** synchronise
*within* a cohort — neither enumerator receives material until both have fee agreements (or recorded absences of a fee)
signed and hashed — and per-person *across* cohorts. Cheap, because both enumerators receive the same packet at the
same §5.5 step.

**Still time-critical:** §4A.1 item 6 refers to "any holder of **another** §4A.3 role" and "an unknown answer is not
'no'", so a declaration signed before an eighth role-holder existed cannot cover them. Enumerator B must enter the
**original** roster.

## 4. FOUR DECISION RESULTS

| | Verdict | Cost to dispose | State |
|---|---|---|---|
| **DR-7** §19.3(3) "seven" | **MINIMUM**, not a cap — eight satisfies it | one decision-log entry + one registration-narrative sentence; **no frozen byte, no registration field** | DECISION REQUIRED (recommendation clear) |
| **DR-8** item 6 between co-enumerators | **Strict reading: A and B must be mutually independent** — and the frozen declaration key `close_relationship_with_developer_operator_or_role_holder` already asks it, unqualified, so adopting it **adds no rule** | recorded interpretation before the roster is fixed | DECISION REQUIRED |
| **DR-9** enumerator counts | 7-item classification; **option (c)** recommended (scope + a batch size that is no function of 210/126/52/32) | paste-ready quota-free instruction text | DECISION REQUIRED — **before OSF registration**, since option (b) cannot be adopted after |
| **DR-10** `cmdScan` duplicate collapse | **Not evidence-bearing, but not cosmetic** | see below | DECISION REQUIRED |

**DR-9's two sharpest points:** "remaining count" is **forbidden under every option including the permissive one**,
because given a permitted own-count the remainder *is* the threshold minus a known quantity. And option (b)'s window
closes at **registration**, not at enumeration (§5.5 puts registration at step 2, enumeration at step 3) — so if the
submission goes out before the ruling, (b) is forfeited by default.

**DR-10 in full** (`orchestrator/DR10_FINDING.md`, written by me from the audit stream's surviving transcript): the
collapse at `cpg_u1_data.mjs:233` is reachable because line 230 uses `loadCsv`, not `loadFrame`. With a **divergent**
duplicate — same `candidate_id`, different company, domain and identifier — **it hides real contamination**: control
flags the row with 2 repository hits plus a registry match; the duplicate frame reports
`held_out_ineligible_by_scan=false`. Control flagged 6, duplicate frame 5. And `scan.frame_hash` still matches the
**full** frame, so the artefact attests to rows it never assessed. **But ten downstream commands refuse it** — `frame`,
`check-frame-sufficiency`, `pool-check`, `draw-development`, `draw-held-out`, `harness-pilot`, `harness-held-out`,
`authorize-execution`, `verify-commitment`, `commitment-payload` — **and both bypasses were attacked and closed**,
including reusing an old scan after de-duplicating (refused on `frame_hash` mismatch). Two residuals: `frame` reports
220 rows against 219 scan results and **no artefact states those side by side**; and safety depends on operator
ordering. **Recommendation: fix it, grouped with DR-1 so the aggregate moves once.**

## 5. PERSONNEL PREPARATION

All eight roles have packets. **PREPARATION; every person-specific field an unfilled marker; no identity, signature,
fee or date invented anywhere — I checked.**

| Cohort | Artefacts | Validator (my runs) |
|---|---|---|
| Enumerator A + B | 7 files | **106 passed, 0 failed** |
| Reference Author / Confirmer / Adjudicator | 10 files | **146 passed, 0 failed** |
| Rater 1 / Rater 2 / Rating Adjudicator | 8 files | **64 passed, 0 failed** |

Each suite ends by self-checking that the instrument tree is **byte-unchanged after the run**.

**Workload, re-derived and confirmed:** reference truth covers **both** stages (`cmdReconcile` reads both manifests), so
**90–330 records per recorder**, not 60–300. Rating is held-out only: **60–300 rows per rater**.

**An inconsistency to settle:** the two validators disagree on their environment contract — the rating one requires
`CPG_U1_TOOLING` and refuses without it; the reference one reads `CPG_U1_INSTRUMENT` and deliberately falls back to
inlined constants. Alias the variable or record the divergence in the release gate.

## 6. REGISTRATION PREPARATION

**My own verifier run**, stdout/stderr to files, exit from `$?`:

```
EXIT=4  — nine BLOCKED prerequisites, ZERO errors
custodian · accountable OSF identity · PID type · PID value · registration_id ·
registration_timestamp · outpoints · checkpoint · as_of
```

**Zero errors is the headline: every field an agent may legitimately fill is filled and valid.** Field counts
re-derived by me from `registrationTemplate()`: **20 top-level keys, 39 leaf paths, 12 `parameters.*`, 27
non-parameter**; a fresh template has 12 UNASSIGNED, the draft has 11, the difference being the provider hash. Eleven
leaves reconcile to nine reported lines because `outpoints` and `checkpoint` each cover two.

## 7. RANDOMNESS PREPARATION

**Preflight: `OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)`, exit 0** — run from a relocated copy
with `--protocol` passed explicitly, which is the documented way to avoid a spurious NOT READY. Adapter conformance
18/18. `check-funding-prerequisites` → `BLOCKED Bitcoin wallet-key custodian is UNASSIGNED`, exit 4.

**Event log verified by my own run: 17 passed, 0 failed.** Edited event → refused; edited *and re-hashed* → chain
break; deletion/reordering → sequence break. **But a truncated tail is ACCEPTED** — only a published head hash plus
event count detects it, and **nobody is currently assigned to publish that head.**

**Serial delay, my own run of the derivation: 5.167 h per stage, the drand Δ = 3 h rule binds rather than block
depth** (robust across a 300–1800 s block-rate sweep). **Total corrected to 59.667 h, not ~61.5 h**: mechanical
**11.667 h (19.6%)** plus an **ASSUMED** 48 h of registry latency (**80.4%**). Registry latency is not a protocol
constant and is not in the instrument — it dominates everything and is unmeasured.

## 8. TWO-ENUMERATOR PIPELINE

Confirmed workable with **zero tooling change**: each enumerator submits a CSV in the frozen 22-column format with
their own `enumerated_by`; the operator concatenates; **`frame` then `check-frame-sufficiency` must both exit 0**
before the development commitment. `frame_hash` is order-independent **provided `candidate_id` is unique** (stable
sort — I measured different hashes under reversal with duplicate ids), so disjoint id namespaces are an operational
obligation. Conflicts land in §5.1's tri-state as `unknown` → ineligible → excluded under an existing reason from the
closed 16-item list: **no new disposition, no third human.**

## 9. AUTOMATED PERSONNEL CONTROLS

**The gap is an asymmetry, not a missing capability — the wave's sharpest structural finding, and I verified both
halves.** `enumerated_by` appears in only three places across all 593 files (`schema.mjs:32` column name, `:124`
non-blank check, and the CSV template header) and **nothing cross-references the personnel register**. Yet the pattern
already exists in the same instrument: `assignment.mjs:10/19/34-35` binds rater labels to the register via
`checkPersonnelRegister`, and `cpg_u1_data.mjs:945` supplies `--personnel`. **`cmdFrame` simply has no equivalent.**

The instrument's own fixture at `selftest.mjs:2260` uses `enumerated_by: 'cpg-implementer-NOT-INDEPENDENT'` and `:2264`
asserts zero errors. **Nuance for the record:** that row *is* excluded, but on `A1_NOT_ESTABLISHED` and C1(2)/C1(5)
contamination grounds — so the fixture shows the **attribution field is unvalidated**, not that a contaminated row
slips through.

**No STOP condition fired.** All five capabilities were implemented outside the frozen tree. Making the frozen `frame`
refuse would insert after `cpg_u1_data.mjs:206` and `:210` and move the aggregate to `8d67ddd7…` in a scratch copy —
**named, priced, not taken.**

## 10. REGISTRATION VERIFIER RESULT

See §6. Eleven external leaves in five groups: **owner input** (accountable identity, PID type, PID value, custodian,
`as_of`) · **OSF-generated** (`registration_id`, `registration_timestamp`) · **Bitcoin activity** (two outpoints,
checkpoint height and hash) · **already computed** (26 leaves incl. the 12-leaf `parameters` block) · **independent
personnel** (zero registration fields — a §19.3 prerequisite only, but everything for the study).

**What no command can check**, and this belongs beside any readiness claim: whether a declaration is true; whether
`enumerated_by` names a registered person; whether the development registry is complete (§5.3 — "the seed's
completeness is not attested"); whether the identity, PID or custodian denote anything real; whether the checkpoint is a
real block; whether `as_of` was chosen before registration; **whether the §4A.3 assignment fingerprint was published
before the commitment broadcast** — the value is checkable, the timing is not; and whether the instrument being run is
the one described.

## 11. MAXIMUM PARALLELISM USED

Eight concurrent streams, then three relaunched. **Six of the original eight were killed mid-flight by a session rate
limit** — an environment limit, not a work failure. Rather than re-run everything I salvaged 39 files of partial work,
verified what was usable, and relaunched only the three genuine gaps. Two streams had in fact completed their
deliverables and died before reporting; they needed no relaunch.

Concurrency was bounded by useful work, not by agent count: consolidating the reference and rating gaps into one stream
avoided coordination overhead for two small complementary tasks, and I wrote the DR-10 finding myself from the killed
stream's surviving transcript rather than spending an agent on a write-up of work already done.

## 12. WORK COMPLETED

Four decision memos with paste-ready disposal text · 25 personnel artefacts across eight roles with three validators
(**106 + 146 + 64 assertions, all passing**) · registration readiness table, OSF metadata and operator sequence ·
randomness preflight state, DR-1 decision memo, custodian action sheet, and two runnable derivations · nine personnel-
automation tools with an audit and a manual-checks list · my own critical-path recomputation · a reconciliation log
recording every claim I verified, corrected or accepted as argument.

## 13. WORK STILL BLOCKED

Everything downstream of a human: all eight independent persons; the custodian; the OSF identity and PID; funding,
outpoints and checkpoint; `as_of`. Plus **DR-1**, whose cost turned out to be far larger than recorded (§17).

## 14. HUMAN ACTIONS REQUIRED

1. **Authorise Enumerator B into the original roster** — time-critical; the saving reverses if the declaration round
   closes first.
2. **Settle DR-1 and DR-10** (and DR-2) **in one sitting**, so the tooling aggregate moves at most once.
3. **Rule on DR-9 before the OSF submission**, not merely before enumeration.
4. **Record the DR-7 and DR-8 interpretations** — both cost no frozen byte.
5. Recruit the eight independent persons; name the custodian; supply the identity and PID.
6. **Assign someone to publish the event-log head hash** — nobody currently owns it.
7. Decide the `ROLE_DESCRIPTIONS.md` / `.gitignore` collision before any release package is assembled.

## 15. CRITICAL PATH

`orchestrator/CRITICAL_PATH.md` + `critical_path.mjs`. Only **enumeration** responds to headcount —
`personnel.mjs:26` permits `n > 1` for `enumerator` alone, and both reference recorders and both raters each do 100% of
their rows by design. Confirmed in the sweep: varying reference minutes-per-record from 15 to 40 changes the saving by
**0.00 weeks**, and productive-hours-per-day has **no effect** because it scales both designs equally.

## 16. VERIFIED CALENDAR SAVING

**Recomputed independently, not reused: net median 1.72 weeks** (chain 1.86, recruitment cost 0.14). Across 468 cells:
p10 **0.93**, p90 **4.05**, range 0.50–5.12, **zero negative cells**. My previously reported "+1.65 to +2.44" was right
in central tendency but **too narrow**; the honest statement is **1–2 weeks typically, plausibly 1 to 4**.

Enumeration is **58.8%** of the chain at the 20-company floor and **39.4%** at the 100-company cap, so the eighth person
matters most when the pilot goes well. **Zero negative cells only because the register is open** — that is a
precondition of the result, not a conclusion from it.

## 17. PROTOCOL IMPACT

**None. No amendment required and none proposed.** Every decision is disposable by recorded interpretation or by a
change outside the frozen tree.

**DR-1 is the exception in cost, not in kind, and it is now the most consequential open item.** `evidenceBundle.mjs:35`
rebuilds each beacon from exactly `{round, randomness, signature}`, so **relay identity is discarded — a ten-relay and a
one-relay bundle are byte-identical** — and `sampling.mjs:180` needs one beacon, while §19.3 asks for "≥ 2 relays".
Enforcing a floor does **not** merely "invert two selftest assertions", as the record said: it **stops the frozen
selftest dead** (284 passed / 1 failed with **737 assertions never run**; a narrower variant 661/3 with 358 never run),
against my verified clean baseline of **1022/0**. Anchors **389 → 391** confirmed. And **neither candidate aggregate is
registrable**, because neither carries the required test changes — **the registrable value is unknowable until that
rewrite is green**. The beacon-site list was also incomplete: **13 sites, not 12**. Adopting it after registration
**voids the study** (`tooling_aggregate_sha256` is registered, sits in the on-chain `PAYLOAD_KEYS` digest, and is
re-checked at `sampling.mjs:142` and by `TOOLING_MISMATCH`).

## 18. INTEGRITY / CONTAMINATION RESULT

Frozen identities unchanged after every stream (verified repeatedly). No protocol, instrument or production
modification; no credential accessed; no network call; no fabricated identity or external value; no registration; no
Bitcoin activity; no real frame; no enumeration; no U1 execution. Every fixture synthetic (`SYN-*`, `.example` per
RFC 2606). One environment hazard recorded: an agent from the previous wave ran `taskkill /F /IM node.exe` across all
node processes three times; **I verified the frozen material was unaffected** and warned the affected streams. A useful
discriminator emerged from it — on Windows a genuine crash and an external kill both surface as status 1, so **the
stack trace, not the exit code, separates them.**

**Five `.gitignore` patterns have now swallowed or would swallow a deliverable**: `*_CHECKLIST.md` (:50),
`*_READINESS*.md` (:51), `*_RUNBOOK*.md` (:58), `ROLE_*.md` (:77, twice — once prospectively for a **mandatory package
file**, which would make a validator refuse a package whose file is present on disk). One stream avoided the trap
pre-emptively for the first time. **Standing rule: `git check-ignore` every deliverable at creation.**

## 19. EXACT NEXT OPERATOR ACTION

**Authorise Enumerator B into the original roster today, and in the same sitting settle DR-1, DR-2 and DR-10 in
writing.** Those are the only items that can still move `tooling_aggregate_sha256`, and that window closes permanently
at registration — after the development commitment the value is inside an OP_RETURN and no lawful edit exists. Then
start recruiting all eight persons the same day: recruitment is the longest lead time and blocks no registration field.

**No U1 evidence exists. No independent validation exists.** Every duration in this report is an assumption with a
stated basis, not a measurement.

---

### Honest limits of my own verification

I re-ran and confirmed: the frozen selftest (1022/0), the mutation anchors (389/389), the registration verifier (exit 4,
nine blockers, zero errors), the registration field counts, the provider hash, all three personnel validators
(106/146/64), the event-log demo (17/0), the delay derivation, the eight-person register acceptance, the
unknown-key tolerance, the `enumerated_by` asymmetry, the `selftest.mjs:2260` fixture, and five `.gitignore` collisions.

**I did not independently confirm** the personnel-automation stream's **48/48 mutation** figure — my re-run was
truncated by my own command timeout after 3 verdicts, so that number stands as its report, not as my verification. I
also did not re-derive the DR-1 variant patches myself, the per-row time assumptions behind any hour figure, or the
§22 attack-matrix tallies inherited from earlier waves.

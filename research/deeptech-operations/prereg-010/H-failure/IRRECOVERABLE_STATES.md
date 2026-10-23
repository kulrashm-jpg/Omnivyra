# IRRECOVERABLE_STATES — DEEPTECH-PARALLEL-010 STREAM H

Which of the thirteen failure states cannot be undone at all, and exactly what the operator forfeits.
Sources and marking conventions as in `FAILURE_ROLLBACK_MATRIX.md`. **No new rule, disposition or VOID state is proposed.**
**Nothing here is evidence.**

## The four one-shot resources, and the three non-regenerable assets

| # | One-shot resource | Clause | Exhausted by |
|---|---|---|---|
| R1 | `O_dev`, the development commitment slot | §5.5.2 "each outpoint can be spent once"; §5.5.3 "Stage VOID (slot consumed; **no retry**)" | any spend at all, valid or not |
| R2 | `O_ho`, the held-out commitment slot | as R1 | as R1 |
| R3 | The single authorised held-out run | §6.5 "**One run**… It is not restarted, resumed or repeated" | starting it once; the harness refuses a restart at `lib/harness.mjs:178` and a post-completion run at `:177` |
| R4 | The authoritative registration for `CPG-U1-2026-01` | §5.5.1 "The **earliest** registration under the accountable identity with this `study_id` is authoritative"; a differing second registration → **study VOID** (`lib/registration.mjs:140-141`) | making the record public on OSF |

| # | Non-regenerable asset (not a slot) | Clause |
|---|---|---|
| A1 | The drand round `R_S` | §5.7.1 "no verifiable round 30 days after R's scheduled time → study VOID (**no substitute round**)" |
| A2 | The sealed reference truth | §9.6 "Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face" |
| A3 | The archived held-out responses | §6.2 "The held-out set is executed once"; §13.3 "A later **live** re-execution matching byte-for-byte — **No**"; §23 Archive row "Lost off-chain payloads or frames → claim lapses" |

---

## A. Irreversible: consumes a one-shot resource

### A1. Frame insufficient, discovered after the development commitment — **VERIFIED**
- **State:** `STAGE_VOID_FRAME_INSUFFICIENT` (§5.7.2, §5.10; `cpg_u1_data.mjs:445` exits `EXIT.VOID`).
- **Forfeits:** **R1** outright — §5.7.2 "the slot is consumed and there is no retry". **R4**, because §5.10 requires "a new registration citing this one". **R2 in practice** (PREPARED): §5.5.3 requires the held-out payload to bind `development_commitment_txid`, `development_payload_digest`, `development_manifest_sha256`, the pilot and the sizing, and §5.5.3 requires the held-out commitment to be after development finality (`lib/sampling.mjs:154-156`); with no valid development stage there is nothing lawful for `O_ho` to bind to.
- **Also forfeits:** every endpoint — §15.5(8) "the run is **not INCONCLUSIVE but VOID**, and no endpoint may be reported".
- **Costs beyond the slots:** the ≥ 210-row enumeration (§20.22) must be redone under a new registration, with new personnel declarations if roles changed.

### A2. Commitment failure — malformed, cross-spend, pre-checkpoint spend — **VERIFIED**
- **States:** `STAGE_VOID_MALFORMED_COMMITMENT`, `STUDY_VOID_SLOT_CROSS_SPEND`, `STUDY_VOID_PRE_REGISTRATION_SPEND` (§5.10; `lib/sampling.mjs:130`, `:131`, `:135-148`).
- **Forfeits:** the spent slot, and for a cross-spend **both R1 and R2 in one transaction** (§5.10 "A commitment spends both slots → Study VOID"). Plus R4 and every endpoint (§15.5(8)).
- **Note:** the tooling cannot prevent this. §5.5.2 "The tooling creates **no wallet, no key, no transaction**." Nothing in the candidate inspects a transaction before broadcast (see `EARLY_WARNING_SIGNALS.md` §5).
- **Adjacent, not irreversible:** a supplied payload that does not hash to the on-chain digest is an **abort**, not a VOID — §5.5.3 "**Abort verification** — supply the committed payload; never 'repaired'" (`lib/sampling.mjs:137-139`). Cost: time.

### A3. Abandonment — **VERIFIED**
- **State:** `STUDY_ABANDONED` (§5.10; `lib/sampling.mjs:125`, `:158`; `ABANDONMENT_SECONDS` at `:15`; §24 fixes both 180-day windows to chain MTP).
- **Forfeits:** R4 ("a restart needs a new registration citing this one") and the evidence claim ("Disclosed; **no evidence claim**"). A slot is forfeit only if it was spent late (`:158`).
- **Note:** §5.5.2 "**Loss of the key** means the stage cannot start → abandonment (§5.10)" — key loss is an abandonment, never a re-issue. §22 #12 classes a deliberate discard-and-restart as **DETECTABLE**, not preventable: "Public outpoints and recomputable draws; abandonment disclosed; restart needs new registration."

### A4. Randomness unavailable at the 30-day expiry — **VERIFIED**
- **State:** `STUDY_VOID_RANDOMNESS_UNAVAILABLE` (§5.7.1, §5.10; `lib/sampling.mjs:185-186`).
- **Forfeits:** **A1** — the round, with no substitute; the already-spent slot (R1 and/or R2); R4; every endpoint.
- **Reachable by two causes** — a genuinely missing round, or a relay-side absence (state 7a). Both land in the same VOID; see `EARLY_WARNING_SIGNALS.md` §7 for the difference in what warns you.

### A5. Post-finality reorganisation — **VERIFIED**
- **State:** `STUDY_VOID_POST_FINALITY_REORG` — "A previously FINAL record (txid, heights, block hashes, round) is contradicted by the chain → Study VOID; **no re-draw**" (§5.10; `lib/sampling.mjs:166-171`, `:175`).
- **Forfeits:** the slot(s), R4, every endpoint, and the draw itself ("no re-draw"). §20.16 "**Bitcoin finality is probabilistic**… after finality it voids the study." §23 Bitcoin row: "Can still deep reorganisation / Probabilistic finality." Nothing the operator does can prevent or repair it.

### A6. Invalid execution — preview, unauthorised, repeated, post-window — **VERIFIED**
- **States:** the four `STUDY_VOID_*` of §6.5 / §5.10 (`lib/execution.mjs:10-17`).
- **Forfeits:** **R3** — the single authorised run. **A2** — the sealed reference truth, which is spent on companies that can never be re-used: §6.4 "A company moves from development to held-out **never** within a protocol version." **A3** — the responses, since there is no second run. R4, and every endpoint: §6.5 "no endpoint is reported; **nothing is repaired or replaced**"; `analyze` returns `endpoints: null` (`lib/analysis.mjs:128`).
- **Special property:** it is the only irreversible state that the harness can refuse *for* you and still be reached outside the harness. §6.5 "This prevents previews **through the harness only**. **Nothing in this protocol can prove that an unlogged private query did not occur** in another environment." §20.20; §22 #32.
- **An interruption is not a repair.** `closeInterruptedRun` executes nothing and marks the unexecuted companies INVALID (`lib/harness.mjs:189-200`; §6.5 "a company without a response is INVALID (§15.2)"). The window then closes permanently (`lib/harness.mjs:177`).

### A7. Wrong tooling aggregate inside a broadcast commitment — **VERIFIED**
- **State:** `STAGE_VOID_MALFORMED_COMMITMENT` via the per-field check at `lib/sampling.mjs:145-147` → **Study VOID** (§5.5.3, §5.10).
- **Forfeits:** the slot, R4, every endpoint. A second registration carrying the corrected value is itself the VOID (§5.5.1 Authority; `lib/registration.mjs:140-141`; §22 #18).
- **Not irreversible while only the *running* tree is wrong:** `TOOLING_MISMATCH` fails closed and executes nothing (`lib/harness.mjs:44`); §18.5 halts; §5.10 Abort row says "retry with correct evidence". Restoring the registered tree restores the value, because the aggregate is a pure function of the tree (§24). Cost: time.

### A8. Registration metadata mismatch, once committed against — **VERIFIED**
- **State:** `STUDY_VOID_REGISTRATION` (§5.10; `lib/sampling.mjs:110-111`, `:178-180`) or the `checkAuthority` verdicts (`lib/registration.mjs:136-141`).
- **Forfeits:** **R4** absolutely — §5.5.1 "Only a study registered under the accountable identity may be reported as CPG U1 evidence", and the earliest record is the authoritative one. Both slots if spent. Every endpoint.
- **Withdrawal is not an escape hatch:** §5.5.1 "A withdrawal → **study VOID** (tombstone reported)" (`lib/registration.mjs:139`). §22 #21 "Registration edited or embargoed — PREVENTED (OSF immutability) / DETECTABLE (withdrawal)."
- **Residual, unfixable by design:** §20.13 "**Study-level grinding under other identities** can be neither prevented nor detected"; §22 #19 "Multiple registrations, different identities — **UNRESOLVED**".

---

## B. Irreversible, but consumes no one-shot resource — the forfeit is a *claim*

### B1. Enumerator becomes ineligible, after the development commitment — **VERIFIED**
- **Forfeits:** the frame-independence claim, permanently. §4A.1 "enumerator work: **the frame is not independent (§20.18)**", and §5.5 bars every repair: "Rows may never be added, removed, edited, re-identified or reclassified." §5.9 bars replacement.
- **Does NOT forfeit:** any slot, the run, or the endpoints. The study still reports (§4A.1 prescribes publication of the finding, not a VOID), and §20.18 already separates the two claims: "Cryptographic sampling integrity… is **not** independent candidate selection." §23 "**Two claims, never merged.**"
- **Cost class:** credibility of claim (2), not compute. Before the commitment the same fault costs only time — §5.7.2 "enumeration continues first".

### B2. Enumerator A/B duplicate, after the development commitment — **VERIFIED**
- **Forfeits:** as B1, plus the ability to correct the attribution at all: `enumerated_by` is inside `frame_hash` (`cpg_u1_data.mjs:217-223`), so a corrected frame has a different `frame_hash` and the held-out stage becomes `STAGE_VOID_BINDING_MISMATCH` (§5.5.3; `lib/sampling.mjs:151`). **PREPARED:** correcting it after the commitment converts a claim forfeit into an R2 forfeit.
- Before the commitment the `frame` command refuses and nothing is lost (`lib/enumeration.mjs:42`; `cpg_u1_data.mjs:222`). Cost: time.

### B3. Reference disagreement resolved as `REFERENCE-CONFLICT`, after `seal` — **VERIFIED**
- **Forfeits:** those observations, from **every** denominator, permanently — §9.5 "(excluded from every denominator, published)"; §15.2 "REFERENCE-CONFLICT — excluded, published". They still count in the §15.5(2) denominator (`lib/analysis.mjs:198`, `total` at `:163`), so enough conflicts force INCONCLUSIVE.
- **Forfeits also:** any later change of mind — §9.6 "Any post-execution change to reference truth yields a different seal hash… the results are invalid on their face"; §9.5 the adjudicator "**cannot supply a third value**"; §9.5 an `AGREED` record can never be overridden (`lib/reconcile.mjs:56`).
- **No slot consumed.** Before `seal` (§9.2.1 Timing) the adjudication is redoable: cost is time.

### B4. Rater disagreement driving α below the floor — **VERIFIED**
- **Forfeits:** the run-level conclusion. §12 "Krippendorff's α, nominal, **≥ 0.667**"; §15.5(3) → INCONCLUSIVE (`lib/analysis.mjs:94`, `:199`).
- **Unrepairable within the run**, because α is computed over the raters' **own** labels before adjudication (`lib/analysis.mjs:178-181`): the rating adjudicator can resolve the *labels* but cannot lift the *agreement statistic*. And there is no second execution to re-rate against a different output (§6.2). Independent re-rating is level **R5**, of which §14 says "**None has occurred.**"
- **No slot consumed** — but R3 is already spent by the time α is knowable, so the cost is the whole run's conclusion.
- **Adjacent ceiling, not a failure:** if raters are simply unavailable, §12 sets "every primary endpoint… **UNADJUDICATED**, the evidence rung cannot exceed **Rung 2**", and "The protocol is not weakened to accommodate unavailability."

### B5. Response-archive loss or mismatch for a held-out record — **VERIFIED**
- **Forfeits:** **A3** for that record. The observation becomes INVALID (§15.2 "No response / harness error → INVALID") and counts against §15.5(2). §23 Archive row: "**Lost off-chain payloads or frames → claim lapses.**"
- **Forfeits also:** the §13.3 replication claims for that record, and — if the replay harness did not exist before execution — replayability for the whole run: §13.3 "**requires the replay harness to exist before execution**"; §19.3 lists it as a named prerequisite. That precondition cannot be satisfied retroactively.
- **Never recoverable by re-running:** §6.2, §6.5, §13.3 "A later **live** re-execution matching byte-for-byte — **No**. A live re-run must not be described as a failed replication."
- **No slot consumed** beyond R3, which is already spent.

### B6. Candidate contamination discovered after registration — **VERIFIED, and NOT irreversible in any costly sense**
- **Forfeits: nothing.** §5.3 "The company is **never excluded, removed or replaced**… Its observations are flagged `CONTAMINATION-DISCLOSED`"; §15.1 "observation remains **VALID** in the primary analysis"; §5.3 "A pre-specified secondary analysis excluding flagged observations… **never changes the §10.5 outcome**."
- **Permanently fixed, but by design:** the eligibility determination, §5.3 "**No changes apply after registration.** Additions, deletions and edits of entries have no effect on this study."
- **PREPARED gap (see the matrix, state 3):** the candidate provides no field in which a late discovery can be carried into the results artifact — `checkDeclarations` takes exactly `schema, seal_hash, protocol_violations, identity_inadmissible` (`lib/analysis.mjs:59-60`), and `contamination_disclosed` reads the registered-registry basis (`:159`), which is structurally empty for held-out rows. So the §5.3 obligation is met by publication outside the tooling, not inside it. Reported, not amended.

---

## C. Costs time only — never irreversible

| State | Recovery and clause |
|---|---|
| Frame insufficient, **before** the commitment | §5.7.2 "enumeration continues first"; `check-frame-sufficiency` and `commitment-payload` both refuse (`cpg_u1_data.mjs:660`, `:370`). The cheapest reversible failure in the protocol. |
| Enumerator A/B duplicate, **before** the commitment | `lib/enumeration.mjs:42`; `cpg_u1_data.mjs:222` — nothing is written. |
| **drand relay unavailable, state 7b** (fewer than two relays attested a round) | An **abort**, never a VOID: `EvidenceError` at `lib/sampling.mjs:193-194`; refused at bundle build at `lib/evidenceBundle.mjs:180-183`. §5.10 Abort row: "Nothing decided or drawn; retry with correct evidence." The seed does not include the relay set (`lib/sampling.mjs:49-55`, `:198-201`), so nothing about the draw changes when the second relay arrives. |
| Header-archive mismatch or source disagreement | §5.10 Abort row; `lib/sampling.mjs:58-71`; `cpg_u1_data.mjs:346-356`. A merely short source only delays, because the agreed tip is the minimum (`lib/sampling.mjs:68-70`). |
| Payload ≠ on-chain digest | §5.5.3 "Abort verification — supply the committed payload; never 'repaired'". |
| Wrong tooling aggregate in the **running** tree | `TOOLING_MISMATCH` fails closed (`lib/harness.mjs:44`); §18.5; §24 makes the value a pure function of the tree. |
| Registration incomplete or UNASSIGNED, **before** the record is made public | §5.5.1 "the tooling refuses to proceed while either is UNASSIGNED (exit 4)"; §5.5.2 `check-funding-prerequisites` "BLOCKED until named"; `lib/harness.mjs:38-39`. |
| Reference disagreement, **before** `seal` | §9.5, §9.2.1 Timing; `lib/reconcile.mjs:58`. |
| Rater sheet refused, or a disagreement not yet adjudicated | `RATINGS_REFUSED` writes nothing (`lib/ratings.mjs:62`); `RATING_ADJUDICATION_MISSING` (`:136`) and `RATING_ADJUDICATION_REFUSED` (`:111`) block the analysis without consuming anything. |
| Any `WAITING_*` state | §5.10 "Wait" rows; `lib/sampling.mjs:125-126`, `:132`, `:161`, `:188`, and `WAITING_DEVELOPMENT_FINALITY` at `:119`. |
| Execution refused by the harness before it starts | `lib/harness.mjs:137`, `:174-181`; §6.5 — a refusal is logged, but R3 is untouched because no `RUN_STARTED` event is written (`lib/harness.mjs:74-78`, `:182`). |

---

## D. Ranking: what to protect, in order

**PREPARED**, from the clauses above; this is prioritisation, not a new rule.

1. **The single authorised run (R3)** — its loss takes A2 and A3 with it, and §6.5 detection is procedural only, so a mistake here is both maximally expensive and minimally preventable.
2. **The two commitment slots (R1, R2)** — five distinct states consume one (A1, A2, A4, A5, A7) and one state consumes both at once (cross-spend). Every one of them is a transaction the tooling does not build (§5.5.2).
3. **The registration (R4)** — every VOID above requires a new registration citing the old one, so R4 is forfeit by all of them, and §5.5.1 makes the earliest record authoritative so it can never be edited into correctness.
4. **The frame's independence** — cheap to protect before the commitment (§5.7.2), unrepairable after it (§5.5, §5.9), and it is half of the two claims §23 says are "never merged".

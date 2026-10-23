# FAILURE_ROLLBACK_MATRIX — DEEPTECH-PARALLEL-010 STREAM H

Thirteen failure states × six questions, from the frozen protocol and the candidate instrument only.
**No new scientific rule, disposition or VOID state is proposed anywhere in this file. Nothing here is evidence.**

## Sources (read-only)

| Source | Identity |
|---|---|
| Protocol | `C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified by `sha256sum`) |
| Candidate instrument | `C:/tmp/dt009-merge/tooling`, 594 files, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` — **recomputed and matched** per the §24 definition (`sha256` of `"<sha256>  <path>\n"` lines over every file, sorted by path). Read only; nothing was executed from the tree. |

Line citations of the form `lib/x.mjs:NN` are line numbers in the candidate tree above.
Every row is marked **VERIFIED** (the clause or code path was read) or **PREPARED** (synthesis over read clauses).

## One-shot resources referenced throughout

| Resource | Clause | Why one-shot |
|---|---|---|
| `O_dev` | §5.5.2, §5.5.3 | "each outpoint can be spent once"; a failing spend is "Stage VOID (slot consumed; no retry)" |
| `O_ho` | §5.5.2, §5.5.3 | as above |
| The single authorised held-out run | §6.5 | "One run… It is not restarted, resumed or repeated" |
| The authoritative registration | §5.5.1 | "The earliest registration under the accountable identity with this `study_id` is authoritative" |
| The drand round `R_S` | §5.7.1 | "no verifiable round 30 days after R's scheduled time → study VOID (**no substitute round**)" |
| The sealed reference truth | §9.6 | "Any post-execution change to reference truth yields a different seal hash… the results are invalid on their face" |
| The archived held-out responses | §6.2, §13.3 | "The held-out set is executed once"; a live re-run "must not be described as a failed replication" |

---

## 1. Enumerator becomes ineligible — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes.** §4A.1 states its own consequence and it is not a stop: "If a declaration is later found false, that person's work is non-independent, and the finding is published: … **enumerator work: the frame is not independent (§20.18)**." Ineligibility appears in no §5.10 state, no §15.5 condition and no §18 halt condition. |
| **Must it abort?** | **No.** §4A.1 closes with "This is a methodological rule; it is not a legal determination." The consequence is **frame-scoped**, not row-scoped: §4A.1 names the *frame*, not any row or observation. |
| **What artefact records the event?** | The restricted personnel register (§4A.1 "**Recorded per person**": declaration, fee-agreement hash, the developing organisation's written confirmation) and the published finding (§4A.1). `check-personnel` records only the register's *structure* — "It cannot verify that declarations are true" (§4A.3; `lib/personnel.mjs:91-93, 106-131`). |
| **What is invalidated?** | Only the **independence claim for the frame** (§20.18: "Cryptographic sampling integrity… is **not** independent candidate selection… the latter rests on enumerator independence only"; §23 Enumerators row: "Can still bias frame composition globally / Not cryptographic"). No row, observation, disposition or endpoint is invalidated. |
| **What may be regenerated?** | Before the development commitment: the register, the `enumerated_by` attribution and the frame itself — §5.7.2 "enumeration continues first". |
| **What cannot be regenerated?** | After the development commitment, the frame: §5.5 "Rows may never be added, removed, edited, re-identified or reclassified." §5.9 "A drawn company is **never replaced**." Therefore the *independence of the frame actually used* is permanently forfeit — §20.18 makes this non-cryptographic and unrepairable. |

## 2. Enumerator A/B duplicate — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes if caught at `frame`.** `lib/enumeration.mjs:42` — "ROLE COLLISION: one person occupies both enumerator slots — Enumerator A and Enumerator B must be different registered people (§4A.3)" — and `cpg_u1_data.mjs:222` fails the command (`ENUMERATION_ATTRIBUTION_REFUSED`), so nothing is drawn. The rule is §4A.3: "**Every independent role is held by a different person**… minimum 7 independent persons"; "Several enumerators are permitted; each holds no other role." |
| **Must it abort?** | **No.** The same person in one enumerator slot is not an error at all (`lib/personnel.mjs:116` exempts `enumerator` from the "exactly one person" rule); only a *repeated* `person_id` collides (`lib/personnel.mjs:124`). Post-commitment it degrades to state 1's frame-scoped consequence (§4A.1). |
| **What artefact records the event?** | The personnel register and the `frame` command's refusal. `enumerated_by` is a frame column hashed into `frame_hash` (`cpg_u1_data.mjs:217-223`), so the attribution is inside the frame's deterministic identity. |
| **What is invalidated?** | Nothing mechanically before the commitment (the command wrote nothing). After it: frame independence only (§20.18). **Distinct duplicate sense** — two enumerators enumerating the *same entity*: §5.7 "**Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical domains are refused", enforced at `lib/select.mjs:47-48` via `assertUnique`, reached from `lib/frame.mjs:41`; §15.2 "Malformed fixture → Refused at `frame`, **before** any draw". |
| **What may be regenerated?** | The register, the attribution column, the frame CSV and `frame_hash` — all of it, before the development commitment. |
| **What cannot be regenerated?** | After the commitment: the frame (§5.5). **PREPARED consequence:** because `frame_hash` binds `enumerated_by` (`cpg_u1_data.mjs:217-223`), correcting attribution after the development commitment necessarily changes `frame_hash`, and §5.5.3 then gives `STAGE_VOID_BINDING_MISMATCH` at the held-out stage (`lib/sampling.mjs:151`). Correction after commitment is therefore not merely barred, it is self-voiding. |

## 3. Candidate contamination discovered — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes, always.** §5.3 "Late-discovered contamination: a contamination discovered after registration is recorded (company, basis, date, discoverer) and published. The company is **never excluded, removed or replaced**, whether for later CPG performance, for any outcome, or at all (§5.9, §15.2)." §15.1: the flag `CONTAMINATION-DISCLOSED` — "observation remains **VALID** in the primary analysis". |
| **Must it abort?** | **No.** §5.3: "A pre-specified secondary analysis excluding flagged observations may be reported and **never changes the §10.5 outcome**." |
| **What artefact records the event?** | The §5.3 contamination record; the §15.3 pre-execution screening log (`held_out_ineligible_basis`, `exclusion_reason`, write-once and sealed); the results artifact's `contamination_disclosed` field (`lib/analysis.mjs:159`). |
| **What is invalidated?** | **Nothing.** §5.3 and §15.1 keep the observation VALID; §5.9 forbids replacement ("replacement after the draw lets the reference team reject hard-to-document companies"). |
| **What may be regenerated?** | The registry file may be edited, but to no effect: §5.3 "**No changes apply after registration.** Additions, deletions and edits of entries have no effect on this study." |
| **What cannot be regenerated?** | The eligibility determination. §5.3 "**Eligibility source:** held-out eligibility for **both** stages is determined solely by the registry whose SHA-256 is in the registration", enforced at `lib/sampling.mjs:148` (development) and `:153` (held-out `STAGE_VOID_BINDING_MISMATCH`). |
| **PREPARED gap** | The candidate carries no input for a §5.3 late-discovered contamination. `checkDeclarations` accepts **exactly** `schema, seal_hash, protocol_violations, identity_inadmissible` (`lib/analysis.mjs:59-60`), and `contamination_disclosed` is derived from the held-out manifest's `held_out_ineligible_basis` (`lib/analysis.mjs:159`) — which is the *registered-registry* basis. Since held-out-ineligible rows can never be drawn into held-out (§5.3 "it can only be drawn into development"; §5.8), that field is structurally empty for every held-out row, so `contamination_disclosed` is always `false` in a held-out analysis. Reported, not amended. |

## 4. Frame insufficient — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes, before the development commitment.** §5.7.2 "If unmet, **no development commitment may be made; enumeration continues first** (enforced: `check-frame-sufficiency`, `commitment-payload`)" — `cpg_u1_data.mjs:660` and `:370` (`FRAME_INSUFFICIENT: no development commitment may be made`). |
| **Must it abort?** | **Yes, if a commitment was already made to it.** §5.7.2 "A development commitment to an insufficient frame is **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry (enforced at `draw-development`)" — `cpg_u1_data.mjs:445` exits with `EXIT.VOID`. §5.10 gives the consequence: **Study VOID**. §15.5(8): "Any §5.10 VOID or ABANDONED state — the run is **not INCONCLUSIVE but VOID**, and no endpoint may be reported." |
| **What artefact records the event?** | Pre-commitment: the `check-frame-sufficiency` / `commitment-payload` refusal with the per-class shortfall (`lib/frame.mjs:41-49`, thresholds `E ≥ 126 / 52 / 32` from §5.7.2 and `FRAME_MINIMUM` at `lib/frame.mjs:31-34`). Post-commitment: the `draw-development` VOID exit and the §5.10 state, plus the on-chain commitment itself (§13.2A). |
| **What is invalidated?** | Pre-commitment: nothing. Post-commitment: the whole study (§5.10 → Study VOID; §18.5 halt: "any §5.10 VOID state"). |
| **What may be regenerated?** | Pre-commitment: the frame (further enumeration), the scan, the sufficiency check. §20.22 prices it: "**Frame enumeration is larger** (≥ 210 eligible admissible rows before the development commitment)." |
| **What cannot be regenerated?** | `O_dev` — §5.5.2 "each outpoint can be spent once"; §5.5.3 "Stage VOID (slot consumed; no retry) → study VOID". §5.10 `STUDY_ABANDONED`: "a restart needs a new registration citing this one." |

## 5. Commitment failure — **VERIFIED** (five distinct dispositions, one clause each)

| Sub-case | Disposition and citation |
|---|---|
| §5.5.3 rules 3–7 fail (OP_RETURN not `6a 27` + 39 bytes; wrong prefix/stage byte; digest ≠ payload; payload invalid or binding to another registration) | `STAGE_VOID_MALFORMED_COMMITMENT` → **Study VOID** (§5.5.3 table; §5.10). Code: `lib/sampling.mjs:135` (`decodeCommitment` throw), `:136` (stage byte vs spent outpoint), `:142` (`checkPayload`), `:143-148` (stage / outpoint / `registration_id` / `protocol_sha256` / `tooling_aggregate_sha256` / development `registry_sha256`) |
| One transaction spends both slots | `STUDY_VOID_SLOT_CROSS_SPEND` (§5.10; `lib/sampling.mjs:131`); §5.5.3 rule 1 "and not the other stage's outpoint — else **study VOID**" |
| Outpoint spent at or before the checkpoint | `STUDY_VOID_PRE_REGISTRATION_SPEND` (§5.10; §5.5.2; `lib/sampling.mjs:130`) |
| Unspent 180 days, or confirmed after its window | `STUDY_ABANDONED` (§5.10; `lib/sampling.mjs:125` and `:158`; `ABANDONMENT_SECONDS` at `:15`). "Disclosed; no evidence claim; a restart needs a new registration citing this one" |
| Supplied payload does not hash to the on-chain digest | **Abort, not VOID.** §5.5.3 "**Abort verification** — supply the committed payload; never 'repaired'"; `lib/sampling.mjs:137-139` throws `EvidenceError`, mapped by the harness to `EVIDENCE_INVALID` (`lib/harness.mjs:63`) |
| Valid commitment, < 6 confirmations | **Wait** (§5.5.3 table; §5.10 `WAITING_COMMITMENT_DEPTH`; `lib/sampling.mjs:132`) |

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | Only in the *Wait* and *Abort* rows. §5.10 Abort row: "Nothing decided or drawn; retry with correct evidence." |
| **Must it abort?** | In the four VOID/ABANDONED rows, yes — §18.5 halts on "any §5.10 VOID state". |
| **What artefact records the event?** | The sampling-evidence bundle (`cpg-u1-sampling-evidence/v1`, `lib/evidenceBundle.mjs:191-208`), the `verify-sampling` / `verify-commitment` state and exit code (`cpg_u1_data.mjs:413-421`), and the raw commitment transaction with its Merkle proof (§13.2A). |
| **What is invalidated?** | The stage, hence the study — every VOID row of §5.10 for a commitment reads "Study VOID". |
| **What may be regenerated?** | The evidence bundle only (Abort rows). The tooling "creates **no wallet, no key, no transaction**" (§5.5.2), so it can neither build nor repair a commitment. |
| **What cannot be regenerated?** | The outpoint (§5.5.2, §5.5.3). Cross-spend forfeits **both** slots in one transaction (§5.10). §5.5.2: "Loss of the key means the stage cannot start → abandonment (§5.10)." |

## 6. Randomness unavailable — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes for up to 30 days.** §5.7.1 Missing round: "Wait; **no verifiable round 30 days after R's scheduled time → study VOID** (no substitute round)." Code: `WAITING_DRAND_ROUND` at `lib/sampling.mjs:188`; the clock is `MISSING_ROUND_EXPIRY_SECONDS` compared against `tipMtp` at `:185`, and §24 fixes "30 days after R's scheduled time" as "Measured by MTP of the agreed tip" — never the operator's clock (§5.10 closing line). |
| **Must it abort?** | **Yes at expiry.** `STUDY_VOID_RANDOMNESS_UNAVAILABLE` (§5.10; `lib/sampling.mjs:186`). Also §5.10 Abort row: "Persistent randomness verification failure across ≥ 2 sources within 30 days → study VOID." |
| **What artefact records the event?** | The `verify-sampling` outcome, which carries the partial `record` alongside the VOID (`lib/sampling.mjs:186`, `:188` — both return `{ record }`), so the round number and its scheduled time are on the record; plus the bundle's `drand` section (§13.2A "drand chain info and rounds `R_dev`, `R_ho`"). |
| **What is invalidated?** | The stage → the study (§5.10). §23 drand row: "Threshold honesty, availability… 30-day VOID rule." |
| **What may be regenerated?** | The evidence bundle, and the beacon if it becomes verifiable before expiry (`lib/evidenceBundle.mjs:169-185`). |
| **What cannot be regenerated?** | The round. §5.7.1 "**no substitute round**"; §5.10 `STUDY_VOID_POST_FINALITY_REORG` sets the neighbouring precedent "Study VOID; **no re-draw**". The already-spent slot is likewise gone (§5.5.2). |

## 7. drand relay unavailable — **VERIFIED; TWO DISTINCT STATES**

These are **not the same state** and they do not share a disposition.

### 7a. The beacon for the required round is absent from the bundle (relay unreachable, round not carried)

| Question | Answer with citation |
|---|---|
| **Continue?** | **Yes, while waiting.** `lib/sampling.mjs:183-189`: with no beacon for `round`, the outcome is `WAITING_DRAND_ROUND` before expiry and `STUDY_VOID_RANDOMNESS_UNAVAILABLE` at/after it. The relay floor is deliberately *not* consulted: the comment at `lib/sampling.mjs:190-192` states "Checked **only once a beacon IS present**, so absence still yields `WAITING_DRAND_ROUND` and, after the 30-day expiry, `STUDY_VOID_RANDOMNESS_UNAVAILABLE`." |
| **Abort?** | At the 30-day MTP expiry, yes — this state *is* state 6 by another cause (§5.7.1, §5.10). |
| **Artefact** | `verify-sampling` state + `record` (`lib/sampling.mjs:188`). |
| **Invalidated** | At expiry: the stage → the study (§5.10). |
| **Regenerable** | The bundle, once ≥ 2 relays serve the round. |
| **Not regenerable** | The round (§5.7.1 "no substitute round"); the spent slot (§5.5.2). |

### 7b. Fewer than two relays attested a round the study must use

| Question | Answer with citation |
|---|---|
| **Continue?** | **Yes — fully recoverable.** The floor is `MIN_DRAND_RELAYS = 2` (`lib/sampling.mjs:18`), sourced to §19.3 "≥ 2 drand relays for verification" and §21 step 5 "Fetch drand rounds `R_dev`, `R_ho` from ≥ 2 relays". A present-but-under-attested beacon raises `EvidenceError` at `lib/sampling.mjs:193-194` — i.e. a §5.10 **Abort (`VERIFY_ABORT_*`)**: "Nothing decided or drawn; retry with correct evidence." The harness maps it to `EVIDENCE_INVALID` (`lib/harness.mjs:63`). At bundle-build time it is refused earlier still (`lib/evidenceBundle.mjs:180-183`; each beacon must name its relay, `:173`). |
| **Abort?** | It aborts *verification*, never the study. It is **not** a VOID state and appears in no §5.10 VOID row. |
| **Artefact** | The refusal text, which names the count and the relays (`lib/evidenceBundle.mjs:182`; `lib/sampling.mjs:194`), and — when FINAL — the sorted relay set returned with the outcome (`lib/sampling.mjs:88-89`, `:204`). |
| **Invalidated** | Nothing. The floor "is an attribution floor; it does not relax any signature check" (`lib/sampling.mjs:192`). |
| **Regenerable** | The bundle, by adding a second differently named relay's beacon for the **same** round. The round, the seed and the draw are unaffected: `deriveSeed` takes `drandRandomness` and never the relay set (`lib/sampling.mjs:49-55`, `:198-201`). Cost: time only. |
| **Not regenerable** | Nothing — unless 7b matures into 7a. |
| **PREPARED ordering consequence** | While a one-relay beacon for `round` *is* in the bundle, `evaluateStage` throws at `:194` and **never reaches** the 30-day expiry test at `:185`. The study therefore shows an *abort*, not `STUDY_VOID_RANDOMNESS_UNAVAILABLE`, for as long as that bundle is supplied. To observe the VOID the operator must rebuild the bundle without the under-attested beacon. Reported, not amended. |
| **Third, separate refusal** | Relays returning **different** values for the same round: "drand beacons disagree for round R — relays returned different values; **do not choose one**" (`lib/evidenceBundle.mjs:176`). Refused at bundle build; not a VOID. |

## 8. Reference disagreement — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes — it is a designed outcome, not a fall-through.** §9.5: "Different → **Must** be adjudicated: `AUTHOR` → `ADJUDICATED_AUTHOR`; `CONFIRMER` → `ADJUDICATED_CONFIRMER`; `REFERENCE-CONFLICT` → `REFERENCE_CONFLICT` (excluded from every denominator, published)." `lib/reconcile.mjs:58` refuses an unadjudicated difference outright; `:63-65` map the three decisions; `REFERENCE-CONFLICT` is a declared disposition in §15.1 and §15.2. |
| **Must it abort?** | **No** — but `reconcile` errors and `seal` cannot proceed: §9.5 "The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any reference file that is not byte-identical to the reconciliation of the blind records." |
| **What artefact records the event?** | The three blind-record files and the reconciled reference file, all bound into `seal_hash` (§9.6, §13.2); the reference-adjudicator packet (§9.2.1), built by `reference-adjudication-packet` and verified by rebuilding (`verify-adjudication-packet`); the per-row `resolution` and `ambiguity_flag` (`lib/reconcile.mjs:67-73`). Class-prediction mismatches are recorded separately and never fixed (§9.7; `lib/reconcile.mjs:81-88`). |
| **What is invalidated?** | Only the individual observation, and only on a `REFERENCE-CONFLICT` decision: "excluded from every denominator, published" (§9.5); "REFERENCE-CONFLICT — excluded, published" (§15.2). It still counts in the §15.5(2) denominator — `lib/analysis.mjs:198` computes `10 * valid.length < 9 * total`, with `total` the full observation count (`:163`). |
| **What may be regenerated?** | The adjudication, the packet and the reconciled file — but only before `seal`: §9.2.1 "**Timing:** adjudication occurs after both blind record sets are submitted and **before `seal`**." |
| **What cannot be regenerated?** | (i) An `AGREED` record: §9.5 "an adjudication **may not override it**" (`lib/reconcile.mjs:56`). (ii) A third value: §9.5 "the adjudicator… **cannot supply a third value**". (iii) Anything after sealing: §9.6 "Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face." |

## 9. Rater disagreement — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes.** §12 "**Rater disagreement** — Resolved by the **rating adjudicator** (§4A.3) using the blinded packet of §12.2"; decisions are "`LABEL_A`, `LABEL_B` or `REFERENCE-AMBIGUOUS`… mapped mechanically to the chosen label" (§12.2). |
| **Must it abort?** | **No, but the analysis is blocked until resolved.** §15.1's disposition list is closed — `VALID` · `INVALID` · `REFERENCE-CONFLICT` · `REFERENCE-AMBIGUOUS` · `REFERENCE-STALE` — and has **no state for "the raters disagreed"**; `finalRatings` throws `RATING_ADJUDICATION_MISSING: N disagreement(s) need the rating adjudicator's resolution` (`lib/ratings.mjs:136`). `resolveRatingAdjudication` refuses a missing decision (`lib/ratings.mjs:110`) and a resolution supplied where there was no disagreement (`:144`). |
| **What artefact records the event?** | The two `cpg-u1-rater-sheet/v1` sheets (`lib/ratings.mjs:63-70`), the §12.2 rating-adjudicator packet, the `cpg-u1-rating-resolution/v1` artifact (`lib/ratings.mjs:119-124`), and in the results artifact `rater_1_label` / `rater_2_label` per row, `rater_label_coincidence` and `alpha` (`lib/analysis.mjs:156-157`, `:181-182`). §12 "Missing ratings → `pending` — never imputed, never scored" (`lib/ratings.mjs:61`). |
| **What is invalidated?** | Per observation: only an adjudicated `REFERENCE-AMBIGUOUS`, which becomes disposition `REFERENCE-AMBIGUOUS` (`lib/analysis.mjs:151`), "excluded, published" (§15.2). Run-level: §12 "Krippendorff's α, nominal, **≥ 0.667**" and §15.5(3) "Nominal α < 0.667, fewer than 2 independent raters, or < 90% of observations completely rated" → INCONCLUSIVE (`lib/analysis.mjs:94`, `:199`). |
| **What may be regenerated?** | The adjudication, and a refused sheet: `ingest-ratings` throws `RATINGS_REFUSED` and writes nothing (`lib/ratings.mjs:62`). Independent re-rating is replication level **R5**, and §14 records "**None has occurred.**" |
| **What cannot be regenerated?** | α itself. It is computed over the raters' **own** labels, *before* adjudication (`lib/analysis.mjs:178-181`), so adjudication cannot lift a failing α, and §15.5(3) is therefore unrepairable within the run. The CPG output cannot be re-obtained (§6.2). §12 also fixes the ceiling when raters are simply unavailable: "every primary endpoint is labelled **UNADJUDICATED**, the evidence rung cannot exceed **Rung 2**, and no claim of independent validation may be made. The protocol is not weakened to accommodate unavailability." |

## 10. Invalid execution — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **No.** §6.5 Consequence: "A detected preview, unauthorised execution, repeated execution or post-window execution is a protocol violation (§18.3). **The study is VOID**, not flagged: the finding is published; no endpoint is reported; **nothing is repaired or replaced**; a restart requires a new registration citing this one." §15.5(8); §18.6. |
| **Must it abort?** | **Yes.** §18.3 "The run is **void, not repaired**"; §18.6 "a detected §6.5 violation". The four §5.10 states are `STUDY_VOID_PREVIEW` / `_UNAUTHORIZED_EXECUTION` / `_REPEATED_EXECUTION` / `_POST_WINDOW_EXECUTION` (`lib/execution.mjs:10-17`). |
| **What artefact records the event?** | §6.5 "Evidence retained (archive, §13.2A)": the execution authorisation, the `cpg-u1-execution-log/v1` log of every invocation, the recording-fetcher archive, the operator's signed no-preview declaration, stored-lookup exports, and the `audit-execution-log` output. The harness's hash-chained event log records every attempt, executed **or refused** (`lib/harness.mjs:1-3`, `:124`), including the case where a broken log means the refusal itself is unlogged (`:122-123`). `analyze` returns `outcome: 'VOID'`, `endpoints: null`, note "VOID: no endpoint may be reported (§15.5(8), §18)" (`lib/analysis.mjs:126-128`). |
| **What is invalidated?** | The entire study — no endpoint at all (§6.5, §15.5(8)). `analyze` short-circuits before computing any endpoint (`lib/analysis.mjs:128`) and refuses outright if the audit is neither CLEAN nor VOID (`:129`). |
| **What may be regenerated?** | **Nothing** (§6.5 "nothing is repaired or replaced"). A refusal *before* execution costs nothing: `WINDOW_NOT_OPEN` (`lib/harness.mjs:174-176`, typed `PREVIEW_ATTEMPT` when the request names an authorised held-out id, else `EXECUTION_REFUSED`), `WINDOW_CLOSED` (`:177`), `RESTART_REFUSED` (`:178`), `CANDIDATES_NOT_AUTHORIZED_SET` (`:179`), `NON_DEVELOPMENT_COMPANY` on a pilot (`:137`), `ARCHIVE_EXISTS` write-once (`:93`, `:138`, `:181`). |
| **What cannot be regenerated?** | (i) The single authorised run: §6.5 "**One run**… It is not restarted, resumed or repeated: a company without a response is INVALID (§15.2)"; an interrupted run may only be **closed**, with its unexecuted companies INVALID (`lib/harness.mjs:189-200`). (ii) The un-previewed state of a held-out company: §6.4 "A company moves from development to held-out **never** within a protocol version." (iii) Certainty of absence: §6.5 "**Nothing in this protocol can prove that an unlogged private query did not occur** in another environment"; §20.20; §22 #32 "DETECTABLE (procedural/audit only) → VOID if detected". |

## 11. Archive mismatch — **VERIFIED** (two distinct archives, two dispositions)

### 11a. Bitcoin header archive

| Question | Answer with citation |
|---|---|
| **Continue?** | **Yes.** §5.10 Abort row lists "header/Merkle/BLS failure, **source disagreement**… frame/scan/registry ≠ committed, sampling record ≠ chain" as `VERIFY_ABORT_*`: "Nothing decided or drawn; **retry with correct evidence**." Code: `loadChains` raises `EvidenceError` on a bad archive, on two identically named sources and on cross-check failure (`lib/sampling.mjs:58-71`); `cmdVerifyArchive` fails with "archive refused" (`cpg_u1_data.mjs:346-356`). A merely *short* source only delays: "Only blocks both sources agree on count" and the agreed tip is the minimum (`lib/sampling.mjs:68-70`), yielding a `WAITING_*` state. §5.7.1 Header sources sets the verification duties; §24 "'most-work chain' / '≥ 2 independent sources'" fixes the proxy. |
| **Abort?** | Verification only. Escalates to VOID in two named ways: "Persistent randomness verification failure across ≥ 2 sources within 30 days → study VOID" (§5.10 Abort row) and `STUDY_VOID_POST_FINALITY_REORG` — "A previously FINAL record (txid, heights, block hashes, round) is contradicted by the chain… Study VOID; **no re-draw**" (§5.10; `lib/sampling.mjs:166-171`, `:175`). |
| **Artefact** | `verify-archive` output; §13.2A "header ranges from a retarget boundary ≤ checkpoint to `H_rand_ho + 6` **from two sources**". |
| **Invalidated** | Nothing, until a post-finality contradiction (then the study). |
| **Regenerable** | The header archives — re-fetch from two differently named sources (`lib/evidenceBundle.mjs:193-195`). |
| **Not regenerable** | A record already FINAL, if the chain contradicts it (§5.10; §20.16 "after finality it voids the study"). |

### 11b. Response archive (§13.1)

| Question | Answer with citation |
|---|---|
| **Continue?** | **Not for the affected observation.** `verifyArchiveRecord` reports "record_sha256 does not recompute (record altered)" and the raw/canonical, exchange-text and http-body hash mismatches (`lib/archive.mjs:43-65`); the CLI fails `ARCHIVE_RECORD_INVALID` (`cpg_u1_data.mjs:917`); `pilotResultFromArchive` throws on any invalid record (`lib/archive.mjs:90-91`); `compareReplay` returns "replayed canonical response differs from the archive" (`:69-73`). The response cannot be re-obtained: §6.2 "The held-out set is executed once"; §13.3 "A later **live** re-execution matching byte-for-byte — **No**." |
| **Abort?** | Not the study as such. §15.2 "No response / harness error → **INVALID**" is the disposition for a lost observation; §15.5(2) then bites at "Fewer than 90% of held-out company × field observations VALID" (`lib/analysis.mjs:198`). |
| **Artefact** | `verify-archive-record`, `replay-archive`, `archive-merkle-root` (`lib/archive.mjs:115-119`, RFC 6962 tree); §13.1 "Per-document SHA-256 plus a Merkle root"; §13.2 publishes the archive Merkle root and the CPG response set. |
| **Invalidated** | The observation (§15.2) and the replication claims of §13.3 rows 1–2. §23 Archive row: "Preservation / Loss/tampering / **Lost off-chain payloads or frames → claim lapses**." |
| **Regenerable** | Only the Merkle root, from the intact records. |
| **Not regenerable** | The archived held-out responses (§6.2, §6.5, §13.3); the Wikidata HTTP exchange, which was never archived (§13.3 "only the adapter's output is archived, not its HTTP exchange"; §20.4); and replayability itself if the replay harness did not exist at execution time — §13.3 "**requires the replay harness to exist before execution**", §19.3 lists it among the prerequisites. |

## 12. Wrong tooling aggregate — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes while it is only the running tree that is wrong.** The harness fails closed with `TOOLING_MISMATCH` — "this tooling is not the registered tooling" (`lib/harness.mjs:44`) — and nothing executes. §18.5 halts on "a protocol or tooling hash ≠ registered"; §5.10 Abort row lists the same as `VERIFY_ABORT_*` with "retry with correct evidence". The value is a pure function of the tree (§24 "Tooling aggregate: sha256 of `"<sha256>  <path>\n"` lines over every file of the tooling tree (incl. vendored BLS and fixtures), sorted by path"), so restoring the registered tree restores the value. |
| **Must it abort?** | **Yes once a wrong value is inside a broadcast commitment.** `tooling_aggregate_sha256` is a `cpg-u1-commitment/v1` payload key (§5.5.3) and therefore inside `digest = sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload))`; it is re-checked against the registration at `lib/sampling.mjs:145-147` (the loop over `registration_id`, `protocol_sha256`, `tooling_aggregate_sha256`) → `STAGE_VOID_MALFORMED_COMMITMENT` → **Study VOID** (§5.5.3 table; §5.10). A second registration carrying a different value is a differing-sampling-fields duplicate → **study VOID** via `checkAuthority` (§5.5.1 Authority; `lib/registration.mjs:138`, `:140-141`; §22 #18 "Multiple registrations, same identity — DETECTABLE → VOID"). |
| **What artefact records the event?** | The registration record (§19.1 "Tooling aggregate SHA-256… computed by `registration-fields`"); the committed payload; `verify-protocol` / `verify-registration` output (§21 step 2); the harness refusal appended to the hash-chained event log (`lib/harness.mjs:124`). |
| **What is invalidated?** | Nothing if caught by `TOOLING_MISMATCH`; the stage → the study if committed (§5.10). |
| **What may be regenerated?** | The tooling tree and hence the aggregate — restore the registered tree byte-for-byte (§24). |
| **What cannot be regenerated?** | The slot and its digest (§5.5.2, §5.5.3), and the authoritative registration — §5.5.1 "The **earliest** registration under the accountable identity with this `study_id` is authoritative", so re-registering to correct the value is itself the VOID. |
| **Note on a cited line** | The stream brief cites `lib/sampling.mjs:142` for this re-check. Line 142 is the generic `committed payload invalid` outcome from `checkPayload`; the **per-field** comparison against the registration, including `tooling_aggregate_sha256`, is the loop at `:145-147`. Reported for precision; the conclusion is unchanged. |

## 13. Registration metadata mismatch — **VERIFIED**

| Question | Answer with citation |
|---|---|
| **Can the process continue?** | **Yes only before the record exists on OSF.** §5.5.1 Identity: the accountable identity and persistent identifier "are **UNASSIGNED** in this document and in the tooling template; the tooling refuses to proceed while either is UNASSIGNED (exit 4)"; the harness gives `REGISTRATION_INVALID` (`lib/harness.mjs:38-39`). §19.1 lists these, the custodian, the outpoints and the checkpoint as "UNASSIGNED — required at registration". §5.5.2: `check-funding-prerequisites` "is BLOCKED until named". |
| **Must it abort?** | **Yes once a commitment is broadcast against a mismatching record.** `STUDY_VOID_REGISTRATION` covers "Registration incomplete in a sampling field, differing duplicate, withdrawal, funding not P2WPKH or < 6 confirmations at the checkpoint; **or `registration_timestamp` ≥ scheduled time of `R_dev`**" (§5.10; `lib/sampling.mjs:110-111`, `:178-180`). `checkAuthority` adds: an earlier registration exists (`lib/registration.mjs:136`), "the registry copy of this registration differs from the supplied record in sampling fields" (`:138`), a withdrawal (`:139`, §5.5.1 "A withdrawal → **study VOID** (tombstone reported)"), a differing duplicate (`:140-141`). Manifest-level mismatches refuse earlier: `STUDY_MISMATCH` / `MANIFEST_BINDING_MISMATCH` (`lib/harness.mjs:48-49`, `:154-155`) and `buildAuthorization` throws (`lib/execution.mjs:48-49`). |
| **What artefact records the event?** | The registration record and the accountable identity's registration listing (§13.2A; §21 step 1 "list the accountable identity's registrations for `CPG-U1-2026-01` and export them as the identity-registration list"); `verify-registration` (with `--evidence` for funding against the checkpoint, §21 step 2); the `checkAuthority` verdict; the OSF-issued `registration_id` and `registration_timestamp`, which are "**never asserted by the operator**" (§5.5.1). |
| **What is invalidated?** | The study (§5.10). §15.5(8): VOID, not INCONCLUSIVE; no endpoint. |
| **What may be regenerated?** | Nothing that helps. §22 #21 "Registration edited or embargoed — PREVENTED (OSF immutability) / DETECTABLE (withdrawal)"; §5.5.1 "Identical duplicates are ignored" but a differing one voids. §5.10: "a restart needs a new registration **citing this one**." |
| **What cannot be regenerated?** | The authoritative registration (§5.5.1) and, once spent, the outpoints (§5.5.2). §5.5.1 Evidence rule: "**Only a study registered under the accountable identity may be reported as CPG U1 evidence.**" |

---

## Cross-cutting notes (PREPARED, from read clauses only)

1. **VOID is never INCONCLUSIVE.** §15.5(8) is explicit, and `lib/analysis.mjs:126-128` implements it by returning before any endpoint is computed. §15.5 conditions 1–7 are implemented as `cond` keys `1_…`–`7_…` (`lib/analysis.mjs:196-206`); condition 8 is the separate `voidBasis` branch.
2. **Exactly 90% passes.** §15.5(2) is computed as `10 * valid.length < 9 * total` (`lib/analysis.mjs:198`), so an exact nine-tenths does not trigger. §15.5(5) is `10 * sc > 6 * valid.length` (`:202`), so exactly 60% does not trigger either, matching §9.8 "exceeds 60%".
3. **A sixth disposition exists in code.** `PENDING` is assigned at `lib/analysis.mjs:150` when an item is not completely rated, and appears in the published `dispositions` tally at `:234`. §15.1's list does not contain it. Reported as a discrepancy between §15.1 and the candidate; **not amended, and no new disposition is proposed here**.
4. **Nine analysis decisions gate everything downstream.** `AD-1`…`AD-9` (`lib/analysis.mjs:22-32`); "While any decision is UNDECIDED the analysis is BLOCKED" (`:8`, `:49`). `AD-7` selects whether a declared protocol violation is `INCONCLUSIVE` or `VOID` (`:29`, `:127`) — so the disposition of state 10's *declared* (as opposed to log-detected) form is decision-dependent, and the decision is frozen inside the registered tooling aggregate (`:6-7`).

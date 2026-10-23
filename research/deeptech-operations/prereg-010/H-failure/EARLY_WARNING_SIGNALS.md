# EARLY_WARNING_SIGNALS — DEEPTECH-PARALLEL-010 STREAM H

For each of the thirteen failure states: the **cheapest check that detects it before it becomes irreversible**, and whether any
command in the candidate instrument already performs that check. Where nothing does, this file says so plainly and **proposes
nothing**. Sources and marking conventions as in `FAILURE_ROLLBACK_MATRIX.md`. **Nothing here is evidence.**

Legend for the "already checked?" column:
- **YES** — a named command performs exactly this check.
- **PARTIAL** — a command performs a weaker or adjacent check; the gap is stated.
- **NO** — nothing in the candidate performs it. Stated, not remedied.

---

## 1. Enumerator becomes ineligible

| | |
|---|---|
| **Point of no return** | The development commitment. After it, §5.5 forbids every edit and §4A.1 makes the frame non-independent (§20.18). |
| **Cheapest check** | Run `check-personnel` over the restricted register before the frame is committed, and `frame --personnel`, which resolves every row's `enumerated_by` against the register. |
| **Already checked?** | **PARTIAL — VERIFIED.** `checkPersonnelRegister` verifies structure only: roles filled, mutual exclusion, operator in no role, every §4A.1 declaration literally `"no"`, the fee-agreement hash well-formed or null, the organisation confirmation present (`lib/personnel.mjs:106-131`, keys at `:98-102`). `checkEnumerationAttribution` requires every row to name a registered eligible enumerator (`lib/enumeration.mjs:32`, `:45`). |
| **What no check can reach** | The **truth** of a declaration. §4A.3 "It cannot verify that declarations are true." §4A.1 "These are **procedural evidence, not proof**." §20.23 "**Personnel independence rests on declarations and organisational confirmation**… not on verifiable proof. The tooling checks the register's structure only." §23 Enumerators row: "Not cryptographic." **No check exists and none can.** |
| **Cheapest partial substitute already present** | The presence of `organisation_confirmation_sha256` (`lib/personnel.mjs:129`) — the developing organisation's own no-relationship confirmation, per §4A.1. Presence only, never content. |

## 2. Enumerator A/B duplicate

| | |
|---|---|
| **Point of no return** | The development commitment; thereafter a correction changes `frame_hash` and self-voids the held-out stage (§5.5.3; `lib/sampling.mjs:151`). |
| **Cheapest check** | `check-personnel` alone — it needs no frame, no scan and no chain evidence. |
| **Already checked?** | **YES — VERIFIED.** Two independent detections: `lib/personnel.mjs:124` ("ROLE COLLISION — `<id>` already holds `<role>`; all independent roles are mutually exclusive") and, specific to the two enumerator slots, `lib/enumeration.mjs:42` ("ROLE COLLISION: one person occupies both enumerator slots — Enumerator A and Enumerator B must be different registered people (§4A.3)"). `cpg_u1_data.mjs:222` fails the `frame` command on it. |
| **The other duplicate sense** | Two enumerators enumerating the same entity → `assertUnique` at `lib/select.mjs:47-48`, reached from `lib/frame.mjs:41`. §5.7 "**Uniqueness** [enforced]"; §15.2 "Refused at `frame`, **before** any draw". **YES.** |

## 3. Candidate contamination discovered

| | |
|---|---|
| **Point of no return** | Registration. §5.3 "For this study the registry is frozen at registration"; "**No changes apply after registration.**" |
| **Cheapest check before registration** | `scan` against the frozen resolver SHA in a clean clone, plus the six C1 attestation columns on every frame row. |
| **Already checked?** | **YES for the pre-registration window — VERIFIED.** `scan` refuses a repo whose HEAD ≠ `--expect-sha` and refuses a dirty tree (`cpg_u1_data.mjs:235-236`), covering C1(1) and C1(6) per §5.4; `frame` prints "held-out-ineligible by attestation (before scan/registry)" (`cpg_u1_data.mjs:215`); §5.3 "**For every contamination attestation, `unknown` is treated exactly like `yes`**" is enforced per §5.1's exhaustive 81-combination test. §5.4's scope is deliberately conservative: "a false positive only moves a company to development." |
| **After registration** | **NO check exists, and no artefact field exists.** §5.3 obliges recording "(company, basis, date, discoverer)" and flagging `CONTAMINATION-DISCLOSED`, but `checkDeclarations` accepts **exactly** `schema, seal_hash, protocol_violations, identity_inadmissible` (`lib/analysis.mjs:59-60`), and the results artifact's `contamination_disclosed` reads the held-out manifest's `held_out_ineligible_basis` (`lib/analysis.mjs:159`) — the *registered-registry* basis, which is structurally empty for every held-out row because ineligible rows can only be drawn into development (§5.3, §5.8). The §5.3 late-contamination obligation is therefore discharged by publication **outside** the tooling. Stated plainly; nothing proposed. |
| **Note** | This state is not irreversible in any costly sense (§5.3, §15.1), so the absence of a check costs disclosure completeness, not a resource. |

## 4. Frame insufficient

| | |
|---|---|
| **Point of no return** | The development commitment. §5.7.2 "A development commitment to an insufficient frame is **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry." |
| **Cheapest check** | `check-frame-sufficiency` on the frame and scan. It needs no chain evidence, no seed, no registration and no network. |
| **Already checked?** | **YES, twice, and it fails closed — VERIFIED.** §5.7.2 "(enforced: `check-frame-sufficiency`, `commitment-payload`)": `cpg_u1_data.mjs:660` (`FRAME_INSUFFICIENT`) and `cpg_u1_data.mjs:370` (`FRAME_INSUFFICIENT: no development commitment may be made`), computed by `frameSufficiency` against `FRAME_MINIMUM` = `2·Qmax_c + Dev_c` = 126/52/32 (`lib/frame.mjs:31-34`, `:41-49`). The minimum is **derived, not typed**: `enumeratePilotOutcomes` evaluates the frozen sizing rule on all 4⁶ = 4096 permitted pilot outcomes (`lib/frame.mjs:10-26`), which §5.7.2 step 9 and §24 both require. `draw-development` re-checks and exits VOID (`cpg_u1_data.mjs:445`). |
| **Assessment** | This is the best-guarded state in the protocol: the check is free, it runs before the only irreversible act, and the tool that performs the irreversible act refuses on its own. |

## 5. Commitment failure

| | |
|---|---|
| **Point of no return** | Broadcast. Every §5.5.3 failure of rules 3–7 is "Stage VOID (slot consumed; no retry)". |
| **Cheapest check** | Compare the intended transaction's `OP_RETURN` script, byte for byte, against §5.5.3 — exactly `6a 27` + 39 bytes = `"CPGU1"` ‖ `01` ‖ stage byte (`44`/`48`) ‖ the 32-byte digest — and against `payloadDigest(payload)` for the payload you intend to publish; and confirm the transaction spends only `O_S`, not the other slot. |
| **Already checked?** | **NO — VERIFIED.** Nothing in the candidate inspects a transaction before it is broadcast. §5.5.2 "The tooling creates **no wallet, no key, no transaction**." `verify-commitment` operates on an assembled evidence bundle, i.e. only after inclusion and confirmation (`cpg_u1_data.mjs:413-421`, via `evaluateFromArgs` → `evaluateStage`); `sampling-evidence-bundle` likewise requires the raw transaction and its Merkle proof (`lib/evidenceBundle.mjs:196-203`). The digest *is* computable in advance — `commitment-payload` produces the payload and `payloadDigest` the digest (`lib/commitment.mjs`, used at `lib/sampling.mjs:137`) — so the operator can derive the 39 bytes, but **no command validates the transaction that will carry them**, and no command can, because the tooling never sees it. Stated plainly; nothing proposed. |
| **Adjacent checks that do exist** | `check-funding-prerequisites` (§5.5.2, BLOCKED until the custodian is named); `verify-registration --evidence` (§21 step 2, funding P2WPKH and ≥ 6 confirmations at the checkpoint — the same conditions `lib/sampling.mjs:110-111` would later turn into `STUDY_VOID_REGISTRATION`); and, for held-out only, `commitment-payload` builds the binding so a wrong development txid/digest is caught before broadcast rather than after (§5.5.3 binding keys). |

## 6. Randomness unavailable

| | |
|---|---|
| **Point of no return** | `MTP(agreed tip) ≥ R's scheduled time + 30 days` (§5.7.1; §24 "Measured by MTP of the agreed tip"; `lib/sampling.mjs:185`). |
| **Cheapest check** | `verify-sampling --stage <S>` against a freshly fetched header pair. Its `WAITING_DRAND_ROUND` reason names the round and its scheduled time (`lib/sampling.mjs:188`), and the outcome carries the partial `record`. |
| **Already checked?** | **PARTIAL — VERIFIED.** The *state* is reported exactly, and the expiry test is implemented (`lib/sampling.mjs:185-186`). What is **not** reported is time remaining: nothing computes or warns on `record.drand_round_time + 30 days − tipMtp`. There is no countdown, no threshold warning, and no command whose purpose is to watch the clock. An operator who does not re-run `verify-sampling` against a moving tip receives no signal at all before the state flips from `WAITING_DRAND_ROUND` to `STUDY_VOID_RANDOMNESS_UNAVAILABLE`. **No such check exists**; stated plainly. |
| **Outsider dependency** | §20.17 "**Tooling cannot prove non-spend**, most-work status, source independence or **drand unavailability** from a bundle; outsiders confirm with a full node and ≥ 2 relays (§21)." The check is therefore inherently external. |

## 7. drand relay unavailable — the two states warn differently

### 7a. Beacon absent from the bundle (relay unreachable, round not carried)

| | |
|---|---|
| **Point of no return** | The same 30-day MTP expiry as state 6. |
| **Cheapest check** | `verify-sampling`, which returns `WAITING_DRAND_ROUND` naming the round (`lib/sampling.mjs:188`). |
| **Already checked?** | **PARTIAL.** The state is visible; the remaining time is not — identical gap to state 6. The relay floor is deliberately silent here: `lib/sampling.mjs:190-192` — "Checked **only once a beacon IS present**, so absence still yields `WAITING_DRAND_ROUND` and, after the 30-day expiry, `STUDY_VOID_RANDOMNESS_UNAVAILABLE`." So a relay outage never presents itself as a relay error; it presents as randomness unavailability. **This is the warning an operator must not misread.** |

### 7b. Fewer than two relays attested a round the study must use

| | |
|---|---|
| **Point of no return** | **None of its own.** It is an abort, not a VOID (§5.10 Abort row: "Nothing decided or drawn; retry with correct evidence"). It becomes irreversible only by converting into 7a. |
| **Cheapest check** | `sampling-evidence-bundle` — it refuses to assemble at all. |
| **Already checked?** | **YES, at two layers — VERIFIED.** At build: each beacon must name its relay (`lib/evidenceBundle.mjs:173`) and each round must carry ≥ `MIN_DRAND_RELAYS` = 2 differently named relays, with the names kept so the claim is auditable (`:180-183`, `MIN_DRAND_RELAYS` imported from `lib/sampling.mjs:18`). At verification: `EvidenceError` naming the count (`lib/sampling.mjs:193-194`), mapped by the harness to `EVIDENCE_INVALID` (`lib/harness.mjs:63`). Clauses: §19.3 "≥ 2 drand relays for verification"; §21 step 5. |
| **Third failure mode, also checked** | Relays disagreeing on the same round: "drand beacons disagree for round R — relays returned different values; **do not choose one**" (`lib/evidenceBundle.mjs:176`). **YES**, at build time. |
| **PREPARED warning about ordering** | While a one-relay beacon for the required round sits in the bundle, `evaluateStage` throws at `:194` and **never reaches** the expiry test at `:185`. The 30-day clock keeps running while the operator sees only an abort. To see whether the study has in fact gone `STUDY_VOID_RANDOMNESS_UNAVAILABLE`, the bundle must be rebuilt without the under-attested beacon. **No command warns about this interaction**; stated plainly. |

## 8. Reference disagreement

| | |
|---|---|
| **Point of no return** | `seal`. §9.2.1 "adjudication occurs after both blind record sets are submitted and **before `seal`**"; §9.6 any later change breaks the published seal hash. |
| **Cheapest check** | `reconcile` on the three blind-record files. It is offline, deterministic and free, and it enumerates every unadjudicated disagreement by key. |
| **Already checked?** | **YES, and it fails closed — VERIFIED.** `lib/reconcile.mjs:58` — "author and confirmer disagree (`<a>` vs `<c>`) — independent adjudication required". It also catches every adjacent role fault before the seal: adjudication supplied for an AGREED record (`:56`, §9.5 "an adjudication may not override it"), author = confirmer (`:52`), adjudicator equal to either (`:59-61`), a decision outside `ADJUDICATION_DECISIONS` (`:38`), an adjudication for a company or field not drawn (`:76-78`). §9.5 "The reconciled reference file is produced **only** by `reconcile`: `seal` refuses any reference file that is not byte-identical to the reconciliation of the blind records." |
| **Also checked** | The adjudicator's packet is rebuilt and compared: §9.2.1 "verified by rebuilding (`verify-adjudication-packet`); any added information, extra or agreeing item, reordering or reassignment is refused." |
| **What no check reaches** | Shared error or collusion among the reference team — §23 "Can still share errors; collude / Role assignment"; §9.7 mismatches with the class prediction are "recorded in the seal and published… never corrected by editing" (`lib/reconcile.mjs:81-88`). |

## 9. Rater disagreement

| | |
|---|---|
| **Point of no return** | For the *labels*, nothing — adjudication is the designed resolution (§12, §12.2). For **α**, the point of no return is the moment the two sheets are ingested, because α is computed on the raters' own pre-adjudication labels (`lib/analysis.mjs:178-181`) and §15.5(3) cannot be repaired afterwards. |
| **Cheapest check** | `ingest-ratings` per sheet (it refuses and writes nothing on any fault, `lib/ratings.mjs:62`), then `rating-adjudication-packet`, whose item count is the number of disagreements on completely rated items (`lib/ratings.mjs:8-10`, `buildRatingAdjudicationPacket`). |
| **Already checked?** | **PARTIAL — VERIFIED.** The *blocking* checks all exist and fail closed: `RATING_ADJUDICATION_MISSING` (`lib/ratings.mjs:136`), `RATING_ADJUDICATION_REFUSED` for a disagreement without a decision (`:110`), `RATING_RESOLUTION_REFUSED` for an altered or mis-bound resolution (`:138-142`) or a resolution where nobody disagreed (`:144`), and sheet-level refusals for missing, extra, duplicated or mis-attributed rows (`:55-61`), plus §10.1's mechanical branch (a fill label needs a value, an abstention label needs none, `:37-38`). |
| **Where no check exists** | **There is no way to see α before `analyze`.** No command computes `alphaNominal` standalone; `analyze` computes it (`lib/analysis.mjs:181`) and simultaneously produces the results artifact. The disagreement count from `rating-adjudication-packet` is a **proxy**, not the threshold test — §15.5(3) compares α exactly (`alphaBelow` at `lib/analysis.mjs:94`), and the relation between a disagreement count and α also depends on the marginal label distribution (`:89-91`). Stated plainly; nothing proposed. |
| **Second gap** | Nothing warns that `< 90% of observations completely rated` is approaching. §12 "≥ 90% of held-out observations must be completely rated, else INCONCLUSIVE"; computed only inside `analyze` (`lib/analysis.mjs:183`, `:199`). A sheet full of `pending` is accepted by `ingest-ratings` — §12 "Missing ratings → `pending` — never imputed, never scored" (`lib/ratings.mjs:61`, `:67`) — with no threshold signal. **No check exists.** |

## 10. Invalid execution

| | |
|---|---|
| **Point of no return** | The first invocation that touches a held-out company outside the authorised run, or the second `RUN_STARTED`. §6.5 "The study is VOID, not flagged." |
| **Cheapest check** | Route every execution through the U1 harness and let it refuse. Then `audit-execution-log` over the derived log before analysis. |
| **Already checked?** | **YES for anything through the harness — VERIFIED.** It "Fails closed: nothing is executed unless every technically checkable precondition holds, and every attempt — executed or refused — is appended to the hash-chained event log" (`lib/harness.mjs:1-3`). Pre-execution refusals: `WINDOW_NOT_OPEN`, typed `PREVIEW_ATTEMPT` when the request names an authorised held-out id (`:174-176`); `WINDOW_CLOSED` (`:177`); `RESTART_REFUSED` (`:178`); `CANDIDATES_NOT_AUTHORIZED_SET` (`:179`); `NON_DEVELOPMENT_COMPANY` for a pilot reaching outside development (`:137`); `ARCHIVE_EXISTS` write-once (`:93`, `:138`, `:181`); `AUTHORIZATION_MISSING` / `_ALTERED` / `_UNBUILDABLE` / `_MISMATCH` (`:161-168`). Post-hoc: `auditExecutionLog` yields the four `STUDY_VOID_*` states with a fixed priority (`lib/execution.mjs:101-154`, priority at `:152`), and `analyze` returns `outcome: VOID`, `endpoints: null` (`lib/analysis.mjs:126-128`). §6.5 "**Technical prevention actually available:** the registered tooling runs no CPG; the U1 harness must refuse held-out companies without a verified authorisation and must log every invocation." |
| **Where no check exists, and can never exist** | Outside the harness. §6.5 "This prevents previews **through the harness only**. **Nothing in this protocol can prove that an unlogged private query did not occur** in another environment. Protection against that is procedural (declaration, restricted access) and audit-based (exports, archives), and is declared in §20.20." §20.20 adds that "The execution-log audit examines **only the supplied log**, whose timestamps come from the operator's systems." §22 #32 classes it "**DETECTABLE (procedural/audit only)** → VOID if detected". Stated plainly; nothing proposed. |
| **Cheapest non-tooling signals the protocol names** | §6.5 Detection: "Comparison of recording-archive timestamps with the window. Review of stored-lookup exports. **Disclosure by any person.**" And §6.5 asks that the stored-lookup export be "made where possible by **someone other than the operator**". |

## 11. Archive mismatch

### 11a. Header archive

| | |
|---|---|
| **Point of no return** | None of its own — an abort. It becomes irreversible only as `STUDY_VOID_POST_FINALITY_REORG` (§5.10; `lib/sampling.mjs:166-171`). |
| **Cheapest check** | `verify-archive --archive --crosscheck` before anything is drawn. It needs only the two archives and the registered checkpoint (`cpg_u1_data.mjs:346-356`). |
| **Already checked?** | **YES — VERIFIED.** Full verification per §5.7.1 Header sources, plus the two-source requirements: differently named sources (`lib/evidenceBundle.mjs:195`; `lib/sampling.mjs:64-66`) and block-for-block agreement (`crosscheckArchives`, `lib/sampling.mjs:67`). Reorganisation before finality is caught by `--prior-final` (§22 #29; `lib/sampling.mjs:166-171`, `:175`). |
| **Gap** | §20.17 "**Tooling cannot prove non-spend**, most-work status, source independence… from a bundle" — `lib/sampling.mjs:126` says so in its own reason string: "non-spend is not provable from headers — confirm with a full node". §21 step 4 is the external check. **No command can close this**; stated plainly. |

### 11b. Response archive

| | |
|---|---|
| **Point of no return** | Loss or corruption of a held-out record, because §6.2 forbids a second run and §13.3 rules out a byte-identical live re-run. |
| **Cheapest check** | `verify-archive-record` per record immediately after the run, then `archive-merkle-root` over the set. |
| **Already checked?** | **YES for integrity — VERIFIED.** `verifyArchiveRecord` recomputes `record_sha256`, the raw/canonical relation, every exchange's `text_sha256` and every http event's `body_sha256`/`body_bytes` and base64 canonicality (`lib/archive.mjs:43-65`); the CLI fails `ARCHIVE_RECORD_INVALID` (`cpg_u1_data.mjs:917`); `pilotResultFromArchive` refuses any invalid or duplicated record (`lib/archive.mjs:90-94`); `replay-archive` compares the replayed canonical response (`lib/archive.mjs:69-73`). §13.1 "Per-document SHA-256 plus a Merkle root" is `archiveMerkleRoot` (`lib/archive.mjs:115-119`), and the harness computes it at run completion (`lib/harness.mjs:141`, `:184`). |
| **Where no check exists** | That the **replay harness existed before execution**. §13.3 makes it a precondition of the replayability claim — "requires the replay harness to exist before execution" — and §19.3 lists it among the named prerequisites, but nothing in the candidate records or verifies *when* it came to exist. The check cannot be performed after the fact at all. Stated plainly; nothing proposed. |
| **Second gap, by design** | Wikidata. §13.3 "**That Wikidata returned the recorded values** — **No**… only the adapter's output is archived, not its HTTP exchange"; §13.1 requires the harness to "run it cold, or record every cache hit as such"; §20.4. Nothing can verify the adapter's upstream. |

## 12. Wrong tooling aggregate

| | |
|---|---|
| **Point of no return** | Broadcast of a payload carrying the wrong value (`lib/sampling.mjs:145-147` → `STAGE_VOID_MALFORMED_COMMITMENT`). |
| **Cheapest check** | Recompute the aggregate per §24 — `sha256` of `"<sha256>  <path>\n"` lines over every file of the tooling tree, sorted by path — and diff it against `registration.tooling_aggregate_sha256`. One pass over 594 files; no network, no build, no test run. |
| **Already checked?** | **YES, at three points — VERIFIED.** `registration-fields` computes it (§19.1); `verify-registration` / `verify-protocol` compare protocol, tooling and registry hashes (§21 step 2; `cpg_u1_data.mjs:342`); and the harness fails closed with `TOOLING_MISMATCH` — "this tooling is not the registered tooling" (`lib/harness.mjs:44`) — alongside `PROTOCOL_MISMATCH` (`:43`) and `REGISTRY_MISMATCH` (`:45`), before any execution. §18.5 makes "a protocol or tooling hash ≠ registered" a halt condition; §5.10's Abort row makes it a `VERIFY_ABORT_*`. |
| **Confirmed in this stream** | The §24 recomputation over `C:/tmp/dt009-merge/tooling` (594 files) reproduces `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` exactly, so the check is both cheap and exact as specified. |
| **Note** | The aggregate covers the whole tree "(incl. vendored BLS and fixtures)" (§24), so `rules/analysis_decisions.json` — the `AD-1`…`AD-9` file — is frozen by it (`lib/analysis.mjs:6-7`). Editing a decision after registration is therefore the same failure as a wrong aggregate. |

## 13. Registration metadata mismatch

| | |
|---|---|
| **Point of no return** | Making the OSF record public (R4 is fixed from then: §5.5.1 earliest-is-authoritative, §22 #21 OSF immutability), and then the first commitment broadcast against it. |
| **Cheapest check** | `verify-registration` against the record, with `--evidence` to check the funding outputs against the registered checkpoint; and `checkAuthority` against the exported identity-registration listing. |
| **Already checked?** | **YES for everything chain- or listing-derived — VERIFIED.** `checkRegistration` (`lib/harness.mjs:38-39` → `REGISTRATION_INVALID`) covers completeness and the UNASSIGNED blockers (§5.5.1 Identity, "exit 4"); `checkAuthority` covers membership in the listing, a single identity, earliest-is-authoritative, registry-copy equality in sampling fields, withdrawal and differing duplicates (`lib/registration.mjs:127-143`); `evaluateStage` covers P2WPKH form and the ≥ 6-confirmations-at-checkpoint rule (`lib/sampling.mjs:110-111`), the pre-checkpoint spend (`:130`) and the grind-then-register bound (`:178-180`). Manifest-vs-registration drift is caught at `lib/harness.mjs:48-49`, `:154-155` and `lib/execution.mjs:48-49`. §5.5.2 blocks `check-funding-prerequisites` until the custodian is named. |
| **Where no check exists** | §21 step 7: "Confirm `registration_timestamp` precedes the development commitment block (**the tooling enforces only 'precedes `R_dev`'**)." §20.19 "The registration timestamp is off-chain. The tooling proves only that registration preceded the development drand round"; §24 says the same in the canonicalization row and notes the weaker bound "never voids an honest study; closes grind-then-register". This is an **outsider** comparison with no command behind it. Stated plainly; nothing proposed. |
| **Second, structural gap** | §20.13 / §22 #19: registrations under **other identities** can be neither prevented nor detected, so no check of any kind exists for study-level grinding. §5.5.1's Evidence rule is the only response: "Only a study registered under the accountable identity may be reported as CPG U1 evidence." |

---

## Summary: where nothing checks

**VERIFIED** unless marked. Seven distinct gaps, none of which this file proposes to close.

| # | Gap | Clause admitting it |
|---|---|---|
| G1 | The **truth** of any personnel declaration (states 1, 2, and the reference/rater analogues) | §4A.1 "procedural evidence, not proof"; §4A.3; §20.23; §23 |
| G2 | A **late-discovered contamination** has no input field and no carrier in the results artifact (state 3) | §5.3 requires the record and the flag; `lib/analysis.mjs:59-60`, `:159` provide neither — **PREPARED** |
| G3 | No command validates a **commitment transaction before broadcast** (state 5) | §5.5.2 "The tooling creates no wallet, no key, no transaction"; `verify-commitment` is post-inclusion (`cpg_u1_data.mjs:413-421`) |
| G4 | No command reports **time remaining** on the 30-day drand clock, and a one-relay beacon masks the expiry state (states 6, 7a, 7b) | `lib/sampling.mjs:185-194`; §20.17 |
| G5 | **α and the 90%-completely-rated fraction are invisible before `analyze`**, and α cannot be repaired once the sheets exist (state 9) | `lib/analysis.mjs:178-183`, `:199`; §15.5(3) |
| G6 | An **unlogged preview** cannot be detected or excluded (state 10) | §6.5 "Nothing in this protocol can prove that an unlogged private query did not occur"; §20.20; §22 #32 |
| G7 | Nothing verifies that the **replay harness existed before execution**, and it cannot be verified afterwards (state 11b) | §13.3 "requires the replay harness to exist before execution"; §19.3 |
| G8 | Nothing proves **non-spend**, most-work status or that `registration_timestamp` preceded the commitment **block** (states 11a, 13) | §20.17, §20.19; §21 steps 4 and 7; `lib/sampling.mjs:126` |

## Summary: the three states whose cheapest check is free, exact and already wired in

1. **Frame insufficient** — `check-frame-sufficiency`, refused again by `commitment-payload` and `draw-development` (§5.7.2).
2. **Wrong tooling aggregate** — recompute per §24 and diff; `TOOLING_MISMATCH` fails closed (`lib/harness.mjs:44`). Verified reproducible in this stream.
3. **Reference disagreement** — `reconcile` refuses every unadjudicated difference before `seal` (§9.5; `lib/reconcile.mjs:58`).

These three are the only irreversibility-adjacent states for which an offline, zero-cost, exact pre-check both exists and is enforced by the tool that performs the irreversible act.

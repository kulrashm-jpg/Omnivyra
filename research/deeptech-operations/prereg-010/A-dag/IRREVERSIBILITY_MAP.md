# IRREVERSIBILITY_MAP

DEEPTECH-PARALLEL-010 · STREAM A. Companion to `REGISTRATION_TO_EXECUTION_DAG.md`.

**NOT EVIDENCE.** Nothing here was performed. This is a reading of the frozen protocol
(`C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md`) and the candidate instrument
(`C:/tmp/dt009-merge/tooling`, `TOOL_VERSION = cpg-u1-data-tooling-6`). No registration, broadcast, seal,
publication or execution exists.

Status marks: **VERIFIED** = read in protocol or code with citation · **PREPARED** = synthesis ·
**EXTERNAL INPUT REQUIRED** = the act is outside both.

## 0. What "irreversible" means here, in three distinct senses

The protocol mixes three mechanisms and it matters which one holds each door shut:

| Mechanism | What it is | Can a mistake be corrected? |
|---|---|---|
| **Consensus** | Bitcoin: an outpoint can be spent once | **Never.** The slot is consumed even by a malformed spend |
| **Institutional** | OSF: public record, timestamp, tombstone | Not by the study. §20.14: "Registry trust is **institutional**… rests on OSF, not cryptography" |
| **Refusal** | The tooling declines to proceed on inconsistent inputs | The *inputs* can be corrected; the tooling's refusal is what makes the earlier commitment binding |

A door held only by *refusal* would be reversible by changing the tooling — except that the tooling's own
aggregate is inside the registration and inside both on-chain digests. That is why the first door is first.

## 1. THE THREE ONE-WAY DOORS

### DOOR 1 — the tooling aggregate at registration

**Locks:** the instrument. Every line of the tooling tree, vendored dependencies included, the pinned
`@noble/curves@1.9.7` + `@noble/hashes@1.8.0` BLS implementation, `rules/analysis_decisions.json` with its
nine AD values, `rules/development_only_registry.json`'s hash, `lib/frame.mjs`'s derived 126/52/32 minimum,
`lib/sizing.mjs`'s quota function, `lib/schema.mjs`'s column sets, and every refusal in every command.

**Closes at:** S03, the public OSF registration — and again, redundantly, at S07b and S13b, because the value
is inside both on-chain digests.

**Exact locking mechanism, in the order it bites:**

1. `tooling_aggregate_sha256` is written into the registration record by `registration-fields`
   (`cpg_u1_data.mjs:307`, from `toolingManifest(ROOT).aggregate`), and the aggregate is defined over
   **every file** of the tree, sorted by path, links refused (`lib/aggregate.mjs:8–24`). **VERIFIED**
2. It is a **`SAMPLING_FIELD`**: `lib/registration.mjs:119`
   `['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'network', 'outpoints', 'checkpoint', 'parameters']`,
   and `samplingView` (line 120) is what `checkAuthority` compares across the accountable identity's
   registrations. §5.5.1 "Authority": "A second registration with different sampling fields (protocol,
   **tooling**, registry, network, outpoints, checkpoint, parameters) → **study VOID**." **VERIFIED**
3. It is one of the eleven `PAYLOAD_KEYS` of `cpg-u1-commitment/v1` (`lib/commitment.mjs:11`), so it is inside
   `digest = sha256("cpg-u1-commitment-digest/v1|" + canonicalJson(payload))` (`lib/commitment.mjs:59`) —
   i.e. inside the 32 bytes written to the chain in the OP_RETURN. **VERIFIED**
4. **It is re-checked at chain verification.** `lib/sampling.mjs:145–147`:
   ```
   for (const k of ['registration_id', 'protocol_sha256', 'tooling_aggregate_sha256']) {
     if (p[k] !== reg[k]) return outcome(stage, STATE.VOID_MALFORMED, `committed payload ${k} differs from the registration`);
   }
   ```
   A committed payload whose tooling aggregate differs from the registered one is `STATE.VOID_MALFORMED` —
   §5.5.3's disposition for that state is "**Stage VOID** (slot consumed; no retry) → study VOID." **VERIFIED**
5. **It is re-checked again by the execution harness.** `lib/harness.mjs:44`:
   `verify(ctx.toolingAggregate === reg.tooling_aggregate_sha256, 'TOOLING_MISMATCH', 'this tooling is not the registered tooling')`.
   `ctx.toolingAggregate` is recomputed live from `ROOT` at every harness invocation
   (`cpg_u1_data.mjs:818`), so the running tooling must *be* the registered tooling — pilot and held-out alike
   (`commonVerification` is called by both `runPilot` and `runHeldOut`). **VERIFIED**
6. `lib/harness.mjs:49` and `:155` extend the same check to both manifests
   (`MANIFEST_BINDING_MISMATCH`), and `lib/execution.mjs:49` to the authorization. **VERIFIED**
7. Every sampling command funnels through `registered(o)`, which recomputes the aggregate and aborts with
   `VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate …) is not the registered tooling`
   (`cpg_u1_data.mjs:179–180`). **VERIFIED**
8. §18.5 makes it a **halt condition**: "a protocol or tooling hash ≠ registered". §5.10's
   `VERIFY_ABORT_*` row lists "protocol or tooling hash ≠ registered". **VERIFIED**

**Consequence, stated plainly:** a post-registration change to the tooling — a bug fix, a dependency bump, a
comment, a whitespace edit, a new file, a deleted file, a `.gitignore`d artefact that lands inside the tree —
produces a different aggregate. There is no repair path. Either (a) the study is re-registered, which §5.5.1
Authority makes **a second registration with different sampling fields → study VOID**; or (b) the tooling is
reverted byte-for-byte and the change is abandoned. **A post-registration change to the instrument is a
re-registration, and a re-registration is a VOID.** **PREPARED** (from 1–8, all VERIFIED).

**Practical corollary the briefing implies and I confirm:** the 594-file candidate at `638d68e6…` must be the
*final* instrument before S03 — including its nine AD values (C-2 in the DAG document) and including any fix
anyone still wants. Nothing about the instrument can be learned from the study and then fixed.

**What Door 1 does *not* lock:** the treatment. §7.1 "What the tree is not": the evaluation tree fixes the
resolver; "a change to them never changes the evaluated resolver identity", and the instrument's own files are
excluded from the resolver identity by definition (`verify-evaluation-tree` refuses a clone whose tracked files
include `research/cpg-u1`). The treatment is pinned separately by commit `f01a7eb4…`, tree `3b4811fc…`,
content aggregate `ffe4f603…` (11552 files). **VERIFIED** at §7.1.

### DOOR 2 — the frame at the development commitment

**Locks:** which companies can ever be in the study, and which of them are held-out-eligible.

**Closes at:** S07b, the broadcast of the development commitment. Not at S07 (the payload file), not at S04
(enumeration), not at S06 (the sufficiency check).

**Exact locking mechanism:**

1. `frame_hash = hashRecords(frame, 'candidate_id')` over the full `FRAME_COLUMNS` set, which **includes
   `enumerated_by`** — so the attribution is inside the frame's identity (`cpg_u1_data.mjs:220–222`).
   `scan_sha256` is `fileSha` of the scan report, which itself carries `frame_hash`, `repo_sha` and
   `registry_sha256` (`cpg_u1_data.mjs:293–298`). **VERIFIED**
2. Both are `PAYLOAD_KEYS` (`lib/commitment.mjs:11–12`), hence inside the digest, hence on-chain, hence fixed
   before the randomness block that will decide the draw exists. §5.5: "the frame hash is inside the on-chain
   digest (§5.5.3) **before the randomness block exists**". **VERIFIED**
3. §5.5 "Single frozen frame" [NORMATIVE; APPROVED CPG-043], three clauses:
   - *Complete before the development commitment* — F must exist and meet §5.7.2 first;
   - *One frame for both stages* — the held-out payload's `frame_hash` and `scan_sha256` must equal the
     development payload's, and `registry_sha256` must equal the registered value;
   - *No changes after the development commitment* — "Rows may never be added, removed, edited, re-identified
     or reclassified (enforced: **CLI refusal before the held-out commitment; VOID at chain verification**)."
   **VERIFIED**
4. **CLI refusal**, in `heldOutInputs` (`cpg_u1_data.mjs:544–551`), three distinct messages:
   - `FRAME_CHANGED: held-out frame_hash differs from the development frame_hash — the single frame is frozen before the development commitment (no additions after sizing)`
   - `REGISTRY_CHANGED: development-only registry differs from the registered registry used at the development stage — the registry is frozen at registration for both stages`
   - `SCAN_CHANGED: scan differs from the development-committed scan — eligibility is fixed before any CPG outcome`
   **VERIFIED**
5. **VOID at chain verification**, in `lib/sampling.mjs:152–154`: held-out `frame_hash`, `scan_sha256` or
   `registry_sha256` differing → `STATE.VOID_BINDING` (`STAGE_VOID_BINDING_MISMATCH`, §5.10 → study VOID).
   **VERIFIED**
6. **Append-only proof**: the held-out binding carries
   `append_only_proof = {development_frame_hash, held_out_frame_hash, development_row_hashes_sha256, proof}`
   with `proof = sha256("cpg-u1-append-only/v1|" + dev_frame + "|" + ho_frame + "|" + dev_rows)`, recomputed by
   `checkPayload` (`lib/commitment.mjs:48–51, 61`). §5.5: "with a single frame it certifies identity" — i.e.
   with one frame the proof is an *identity* proof, not merely an append proof. **VERIFIED**
7. **The insufficiency trap.** §5.7.2: "A development commitment to an insufficient frame is
   **STAGE_VOID_FRAME_INSUFFICIENT**: the slot is consumed and there is no retry (enforced at
   `draw-development`)". `cpg_u1_data.mjs:448–449` re-derives sufficiency at draw time and exits 6. So the
   frame is locked *whether or not it was big enough* — committing to a small frame does not leave the frame
   open, it destroys the stage. **VERIFIED**
8. **The one-way flip in §5.7.2's own escape clause.** "If unmet, **no development commitment may be made**;
   enumeration continues first." That clause is what makes S04–S06 freely reversible. It has no counterpart
   after S07b: §5.5 forbids additions, and `pool-check`'s own failure message says so —
   "HELD-OUT POOL BELOW MINIMUM — impossible for a frame that met the sufficiency rule; **the frame cannot be
   extended**" (`cpg_u1_data.mjs:518`). **VERIFIED**
9. **No replacement, ever.** §5.9: a drawn company is never replaced; identity-level inadmissibility found
   after the draw makes all of that company's observations INVALID and published, counting against the
   valid-observation floor (§15.5(2)). The remedy for a bad row is to lose it, not to swap it. **VERIFIED**

**Consequence:** after S07b there is exactly one frame for the whole study, its scan is fixed, its registry is
fixed, its enumerators are fixed inside the hash, and eligibility for both stages is determined. If the frame
turns out too small, the development slot is gone. If a row turns out wrong, its observations are lost.
**PREPARED** (from 1–9).

**Why it closes here and not at the held-out commitment:** because the sizing function is applied *after* the
development pilot, a frame extended between the stages could be extended with knowledge of the pilot yield and
therefore of the held-out quotas. §5.7.2's proof (steps 5–7) works only because eligibility is "identical at
both stages, because frame, scan and registry are frozen". §4A.2 closes the human side: "Enumerators never
receive pilot, sizing or quota information." **VERIFIED**

### DOOR 3 — the single authorised execution

**Locks:** the observation. Once the held-out set has been run, there is no second look at it within this
protocol version.

**Closes at:** S23, and specifically at the `RUN_STARTED` event, not at `RUN_COMPLETED`.

**Exact locking mechanism:**

1. §6.2: "**The held-out set is executed once.** No threshold, rule, label definition, rater instruction or
   line of CPG code may change after any held-out result is seen, except by a new protocol version as a new
   file." §6.4: a company moves from development to held-out **never** within a protocol version. **VERIFIED**
2. §6.5 "Window": **Opens** at the registry-issued timestamp of the published seal record, which must be later
   than the held-out drand round's scheduled time; **Closes** when the single authorised run completes; **One
   run** — "It is not restarted, resumed or repeated: a company without a response is INVALID (§15.2)."
   **VERIFIED**
3. **Window-open enforcement** at authorization build: `lib/execution.mjs:89` throws
   "seal published before the held-out draw could exist — seal record timestamp inconsistent" if
   `window_opens_at < held_out_draw_earliest`. `window_opens_at` *is* `sealPublication.registry_timestamp`
   (`lib/execution.mjs:79`) — an institutional value, not a chain value. **VERIFIED**
4. **Harness refusals**, `lib/harness.mjs:178–185`, in order:
   - `WINDOW_NOT_OPEN` — and it is classified `PREVIEW_ATTEMPT` rather than `EXECUTION_REFUSED` if any
     requested id is in the authorized held-out set (line 179);
   - `WINDOW_CLOSED` (`POST_WINDOW_EXECUTION`) — "the single authorized run has already completed or been
     closed — the window is closed";
   - `RESTART_REFUSED` (`REPEATED_EXECUTION`) — "an authorized run already started — **no restart, resumption
     or repetition**";
   - `CANDIDATES_NOT_AUTHORIZED_SET` — "the authorized run executes exactly the authorized held-out set, each
     once";
   - `ARCHIVE_EXISTS` — the archive directory is write-once, and each record is written with `flag: 'wx'`
     (`lib/harness.mjs:101`).
   **VERIFIED**
5. **`RUN_STARTED` is the latch.** `logState(events, authSha)` counts started and closed runs from the
   hash-chained event log, and the `state.started > 0` test precedes any execution. The log is opened and
   verified before anything happens; a broken log makes the harness refuse and report `logged: false`
   (`lib/harness.mjs:110–127`). **VERIFIED**
6. **An interruption does not reopen it.** `closeInterruptedRun` (`lib/harness.mjs:198–209`) appends
   `RUN_INTERRUPTED_CLOSED`, executes nothing, and lists the never-executed companies as
   `invalid_unexecuted` — INVALID per §15.2, counting against the 90% floor of §15.5(2). There is no resume
   path in the code. **VERIFIED**
7. **Authorization identity.** `runHeldOut` does not trust the supplied authorization: it recomputes
   `authorization_sha256` (`checkAuthorization`), then **rebuilds** the whole authorization from the sealed
   artefacts and requires canonical equality — `AUTHORIZATION_ALTERED`, `AUTHORIZATION_UNBUILDABLE`,
   `AUTHORIZATION_MISMATCH` (`lib/harness.mjs:165–173`). **VERIFIED**
8. **Preview is a study VOID, not a flag.** §6.5 "Consequence": a detected preview, unauthorised, repeated or
   post-window execution → "**The study is VOID**, not flagged: the finding is published; no endpoint is
   reported; **nothing is repaired or replaced**; a restart requires a new registration citing this one."
   `auditExecutionLog` emits `STUDY_VOID_PREVIEW` / `_UNAUTHORIZED_EXECUTION` / `_REPEATED_EXECUTION` /
   `_POST_WINDOW_EXECUTION` (`lib/execution.mjs:11–16`, 128–158) and the CLI exits 6. **VERIFIED**
9. **Preview extends backwards in time, not just forwards.** §6.5(a): for a company later drawn into held-out,
   a preview is any execution or reading of stored CPG output **at any time before the authorised run starts,
   or after it completes**. §6.5(b): for a development company, before the development drand round's scheduled
   time. §6.5(c): for **any other frame company**, before the held-out drand round's scheduled time. The audit
   implements all three, resolving companies by `candidate_id` or `canonical_domain`
   (`lib/execution.mjs:139–156`). So the door was already partly shut when the frame was completed: from that
   moment, touching any frame company is a violation until the corresponding round exists. **VERIFIED**

**Consequence:** the study has exactly one primary observation. Any second look, in any environment, through
any entry point, by study personnel or the developing organisation's staff or anyone at their direction, voids
it. **PREPARED** (from 1–9).

**The limit of Door 3, stated by the protocol itself and not softened here:** §6.5 "Technical prevention
actually available" — the registered tooling runs no CPG, and the harness must refuse held-out companies
without a verified authorisation and must log every invocation. "This prevents previews **through the harness
only**. **Nothing in this protocol can prove that an unlogged private query did not occur** in another
environment." §20.20 repeats it. The code repeats it (`lib/execution.mjs:1–4`; `cpg_u1_data.mjs:781`;
`lib/harness.mjs:1–3`). Door 3 is therefore **consensus-strength going forward** (the log latch and the
write-once archive) and **procedure-strength going backward** (the operator's signed no-preview declaration,
restricted access, stored-lookup exports made where possible by someone other than the operator).

## 2. Every other step that cannot be undone

| Step | What it locks | Locking mechanism | Status |
|---|---|---|---|
| **S02a** funding `O_dev`, `O_ho` | the two draw slots | Bitcoin: one spend per outpoint. Loss of the key → abandonment, not restart (§5.5.2). A spend **at or before the checkpoint** → `STUDY_VOID_PRE_REGISTRATION_SPEND` (`lib/sampling.mjs:130`) | VERIFIED |
| **S03** registration | protocol sha, tooling aggregate, registry sha, network, outpoints, checkpoint, pinned parameters, `as_of`, provider config, accountable identity | `SAMPLING_FIELDS` + `checkAuthority` (`lib/registration.mjs:119–132`); earliest registration wins; differing duplicate or **withdrawal** → study VOID; `registration_timestamp ≥ scheduled time of R_dev` → `STUDY_VOID_REGISTRATION` (§5.5.1, §5.10) | VERIFIED |
| **S03** the publicity of it | the registration cannot be un-published | Embargo/private "**Forbidden**". §20.14: immutability and tombstones rest on OSF, not cryptography | VERIFIED |
| **S05** scan → **after S07b** | held-out eligibility for both stages | `SCAN_CHANGED` (CLI) + `VOID_BINDING` (chain). §5.3 registry freeze likewise | VERIFIED |
| **S07b / S13b** the two broadcasts | the two seeds, and therefore the two samples | §5.5.3 rules 1–7; failing 3–7 consumes the slot; a cross-spend of both slots → `STUDY_VOID_SLOT_CROSS_SPEND` (`lib/sampling.mjs:131`) | VERIFIED |
| **S09 / S14** a `FINAL` record | the txid, heights, block hashes and round | `STUDY_VOID_POST_FINALITY_REORG` — "A previously FINAL record … is contradicted by the chain → Study VOID; **no re-draw**" (§5.10; `lib/sampling.mjs:167–170` via `priorFinal`) | VERIFIED |
| **the 30-day randomness expiry** | the stage | `STUDY_VOID_RANDOMNESS_UNAVAILABLE` — "no verifiable round 30 days after its scheduled time"; **no substitute round** (§5.7.1, §5.10) | VERIFIED |
| **the 180-day abandonment clocks** | the study | `STUDY_ABANDONED`: development unspent 180 days after `registration_timestamp`; held-out unspent 180 days after the scheduled time of `R_dev`; or a commitment confirmed after its window (`lib/sampling.mjs:123–124, 158`). "a restart needs a new registration citing this one" | VERIFIED |
| **S10** development draw | which 6/2/2 companies are development, forever | §6.4: a company moves from development to held-out **never** within a protocol version. `DEVELOPMENT_SURPLUS` rows "**never** enter held-out" (§5.8) | VERIFIED |
| **S10b** the pilot, once seen | nothing may be changed *because of* it | §5.6: "The pilot result informs size only. It may change no threshold, rule, label definition or line of code." §5.6: `y = 0` → HALT. §8.5: any fill in the instrument check **halts the programme** | VERIFIED |
| **S11** sizing | the held-out quotas | Pre-registered deterministic function, "fixed now and applied before the held-out draw"; `size` refuses a pilot not bound to this manifest, and the sizing sha is inside the held-out on-chain binding | VERIFIED |
| **S12** the published fingerprint | who rates in which order | §4A.3: published **before the held-out commitment is broadcast**. The nonce (`lib/assignment.mjs:30`) prevents post-hoc confirmation by guessing ids; `assignedPerson` refuses any assignment that does not hash to the published fingerprint (`lib/assignment.mjs:55–61`). The tooling explicitly **cannot** check *when* it was published (`lib/assignment.mjs:5–6`) — that is the publication record's timestamp | VERIFIED |
| **S17** blind reference decisions | the contested reference values | `RECORD_1`/`RECORD_2`/`REFERENCE-CONFLICT` only; the adjudicator "**cannot supply a third value**" (§9.5); `AGREED` "an adjudication may not override it"; `seal` refuses an `--adjudication` that is not the mechanical resolution of the blind decisions (`cpg_u1_data.mjs:601`) | VERIFIED |
| **S20** the seal | both manifests, both screening logs, sizing, the three blind-record files, the reconciled reference file | `seal_hash = sha256(canonicalJson(seal without seal_hash))`, recomputed and never trusted (`lib/execution.mjs:28–33`). §9.6: "Any post-execution change to reference truth yields a different seal hash, which does not match the published one, so the results are invalid on their face" | VERIFIED |
| **S20** operator separation | the operator cannot choose reference values | §9.6: "**The operator receives the seal hash only.**" The reference file stays with the reference team until execution and archiving complete. The CLI prints this instruction (`cpg_u1_data.mjs:652`) | VERIFIED |
| **S21** the published seal record | the moment the window opens | Institutional: a registry-issued timestamp. §15.5(6): a mismatch between the published seal hash and the seal used, **or execution beginning before the seal was published**, is run-level INCONCLUSIVE | VERIFIED |
| **S23** the archive | the observations | Per-record `flag: 'wx'`, write-once archive directory, RFC 6962 Merkle root, hash-chained event log with an `event_sha256` head that `analyze` requires to be present (`cpg_u1_data.mjs:1064`) | VERIFIED |
| **S24** the cited-URL sets | which URLs each rater sees | §12.3: "All qualifying URLs are included… No URL is selected, removed, reordered or filtered on the basis of value agreement, source authority, identity class, provider, rater result, or any expected or observed study outcome. **Post-hoc favourable selection is prohibited** and would be a protocol violation (§18.3)." `verify-rater-packet` requires byte identity, so a hand-edited set is refused | VERIFIED |
| **S25** the presentation orders | who sees what in which order | Derived from `ho_record_sha256`, "**Unknowable in advance**"; one-way hash of the published record; a distinct domain prefix; `RATER_ORDER_SUBSTITUTION` / `WRONG_SEAL` refusals (`cpg_u1_data.mjs:665–676`) | VERIFIED |
| **S31** the outcome | exactly one of INCONCLUSIVE / FALSIFIED / FAILURE / SUCCESS | §10.5 "exactly one"; INCONCLUSIVE checked first; a §5.10 VOID or ABANDONED state is "**not INCONCLUSIVE but VOID**, and no endpoint may be reported" (§15.5(8)). "FAILURE … **explicitly including a near miss**" | VERIFIED |
| **AD-1…AD-9** | nine methodological decisions | They live in `rules/analysis_decisions.json`, which is **inside the tooling aggregate**, so Door 1 locks them at S03. Changing one after registration is a re-registration → VOID | VERIFIED |

## 3. What remains reversible, and until when

Recording this matters as much as the doors: it is the window in which mistakes are still free.

| Reversible thing | Until |
|---|---|
| The tooling tree, every file, all nine AD values, the pinned BLS version | **S03** (registration) |
| The protocol document itself | **S03**; thereafter `verify-protocol` refuses a text lacking any `PROTOCOL_MARKERS` entry and `registered()` refuses a differing `protocol_sha256` |
| The development-only registry | **S03** (`registry_sha256` is a sampling field); `REGISTRY_CHANGED` after S07b |
| `as_of` and `provider_configuration_sha256` | **S03** — both are registration fields "computed / chosen before registration" (§19.1) |
| The frame: add, remove, edit, re-identify, reclassify rows | **S07b** (development broadcast) |
| The scan (re-run at the frozen SHA) | **S07b** |
| Enumeration continuing because sufficiency is unmet | **S07b** — §5.7.2 "enumeration continues first" applies **only before** the development commitment |
| The personnel register's structure | practically, until the respective stage (§19.3(3)); the `rater-1`/`rater-2`/`rating-adjudicator` labels freeze at **S12's publication** |
| Development execution: pilot, instrument check, harness debugging | **without limit** (§6.3), provided the development drand round's scheduled time has passed (§6.5(b)) |
| Reference records and the blind adjudication decisions | **S20** (the seal) |
| The choice of when to start the authorised run | **S23** — the operator chooses freely after the window opens; §6.5 argues the choice cannot use outcomes because no outcome is observable without a preview, while conceding (§20.21) that public source-availability information is observable |

## 4. The compound trap: three doors that share a key

This is the structural point the map exists to make.

`tooling_aggregate_sha256` sits inside **all three** doors:

- **Door 1** registers it (`lib/registration.mjs:39, 119`).
- **Door 2** commits it, twice, inside both digests (`lib/commitment.mjs:11`), and re-checks it at chain
  verification (`lib/sampling.mjs:145`).
- **Door 3** re-checks it live at every harness invocation (`lib/harness.mjs:44`), on both manifests
  (`:49, :155`), and inside the authorization (`lib/execution.mjs:65`).

So a single instrument edit made at any time after S03 does not merely invalidate one artefact — it makes the
harness refuse (`TOOLING_MISMATCH`), makes every sampling command abort
(`VERIFY_ABORT_HASH_MISMATCH`), makes both committed payloads inconsistent with the registration
(`STATE.VOID_MALFORMED` → stage VOID → study VOID), and triggers halt condition §18.5. There is no partial
recovery and no "the fix was behaviour-preserving" defence — §7.1 rejects exactly that defence for the
treatment ("whether or not it is believed to be behaviour-preserving"), and Door 1's mechanism is a hash, which
has no notion of behaviour at all.

**Therefore: the last moment at which the instrument can be corrected is before S03. Every later correction is
a new registration, and a new registration with different sampling fields is a study VOID.** **PREPARED**;
each constituent VERIFIED above.

## 5. Failure modes that consume a slot without producing anything

Worth listing separately, because each is an irreversible loss with no artefact to show for it.

| Failure | Result | Citation |
|---|---|---|
| Malformed OP_RETURN (script not exactly `6a 27` + 39 bytes, wrong prefix, wrong stage byte, more than one OP_RETURN) | `STAGE_VOID_MALFORMED_COMMITMENT` → study VOID. Slot consumed, no retry | §5.5.3 rules 3–5; `lib/sampling.mjs:135–137` |
| Digest ≠ published payload | **Abort verification**, not VOID — "supply the committed payload; never 'repaired'" | §5.5.3; `lib/sampling.mjs:138` |
| Development commitment naming an insufficient frame | `STAGE_VOID_FRAME_INSUFFICIENT`. Slot consumed | §5.7.2; `cpg_u1_data.mjs:448` |
| A commitment spending both slots | `STUDY_VOID_SLOT_CROSS_SPEND` | §5.10; `lib/sampling.mjs:131` |
| Held-out committed at or before development finality (`height ≤ H_rand_dev + 6`) | Held-out stage VOID | §5.5.3; `lib/sampling.mjs:156` |
| Held-out binding naming a different txid, digest, manifest, pilot, sizing or append-only proof | `STAGE_VOID_BINDING_MISMATCH` | §5.5.3; `cpg_u1_data.mjs:533–541` |
| `registration_timestamp` at or after the scheduled time of `R_dev` | `STUDY_VOID_REGISTRATION` | §5.5.1 Embargo row; §5.10 |
| Pilot yield `y = 0` | **HALT** — "EFR could never be assessed"; exit 3 | §5.6; §18.2 |
| Any fill in the §8.5 instrument check | **HALT** — the verified-only gate would be falsified | §8.5; §18.1 |
| Any production system touched | **HALT** | §18.4 |
| Persistent randomness verification failure across ≥ 2 sources within 30 days | study VOID | §5.10 `VERIFY_ABORT_*` row |

## 6. Not evidence

This document records no measurement, no execution, no registration and no publication. It is a reading. The
three doors described are, as of this writing, all **open**: nothing has been registered, no outpoint funded or
spent, no frame enumerated, no seal published, no run authorised or executed.

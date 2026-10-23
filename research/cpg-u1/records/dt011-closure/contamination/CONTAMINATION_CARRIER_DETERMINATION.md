# CONTAMINATION-CARRIER DETERMINATION — DEEPTECH-PARALLEL-011 (contamination-semantics stream)

**Verdict: OWNER DECISION REQUIRED**

**Exact required record (directive §6):**

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

---

## 0. Scope, inputs and what was not touched

| Item | Value |
|---|---|
| Frozen protocol | `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md` |
| Protocol SHA-256 (recomputed, read-only) | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **matches** the registered SHA |
| Candidate instrument | `C:/tmp/dt009-merge/tooling` (aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, **taken as given, not recomputed** — see below) |
| Protocol lines | 1098 |

Nothing under `C:/tmp/dt009-merge` was written, moved or executed. The protocol was read with `sed`/`grep` only. The tooling aggregate was **not** recomputed and no tooling command, selftest or mutation suite was run, because a 404-mutant certification suite is running against that tree and the firewall forbids CPU load there. The aggregate is therefore reported as supplied, not verified by this stream.

This is a **determination from the frozen protocol**. No protocol text was modified. No code was modified. No schema was proposed as settled. No new state was invented.

---

## 1. Q1 — Which artefact **must** carry a late contamination disclosure?

**Answer: the protocol names no carrier artefact. It specifies the *content* to be recorded and the *consequence*, and is silent on *where*.**

The single governing clause is §5.3 (`CPG_U1_PROTOCOL_004.md:248`), verbatim:

> - **Late-discovered contamination:** a contamination discovered after registration is recorded (company, basis, date, discoverer) and published. The company is **never excluded, removed or replaced**, whether for later CPG performance, for any outcome, or at all (§5.9, §15.2). Its observations are flagged `CONTAMINATION-DISCLOSED`. A pre-specified secondary analysis excluding flagged observations may be reported and **never changes the §10.5 outcome**.

It prescribes four data elements (`company, basis, date, discoverer`), the verb "recorded … and published", and an observation-level flag. It names **no artefact, no schema, no domain string, no file, and no tooling command**. This is the only occurrence of "late-discovered contamination" in the document (`grep -n -i "disclos"` returns lines 248, 425, 489, 836, 1021, 1058; only 248 concerns contamination).

Each candidate carrier, tested against the protocol:

| Candidate carrier | Protocol text | Can it carry a **late** disclosure? |
|---|---|---|
| **Frame row** (§5.1–§5.3 attestations) | §5.3:239 "For every contamination attestation, `unknown` is treated exactly like `yes`." Frame is frozen before the development commitment: §5.5:263 step 3 "enumerate the COMPLETE frame F → frame → scan → check-frame-sufficiency (§5.7.2) — **NO LATER ADDITIONS**" | **No.** A frame row edit changes `frame_hash`, which both commitment payloads bind |
| **Contamination scan** (§5.4) | §5.3:246 "**No changes apply after registration.** … the held-out stage verifies equality (enforced: CLI refusal before commitment; VOID at chain verification)" | **No.** Scan and registry are frozen; a changed scan is refused/VOID |
| **Screening log** (§15.3) | §15.3:857 lists `held_out_ineligible_basis` among the columns, then: "Written by the tool, **write-once, sealed**" | **No.** Write-once, sealed pre-execution, and it has **no `date` or `discoverer` column** — the §5.3 fields do not fit the row |
| **Evidence bundle / sampling archive** (§13.2A) | §13.2A:815 enumerates the bundle exhaustively (registration record, protocol and tooling files, frame, scan, registry, pilot, sizing, payloads, transactions, headers, drand rounds, manifests, screening logs, sampling records, execution authorisation, execution log, audit output, no-preview declaration, stored-lookup exports, reference and rating adjudication packets) | **No.** A contamination-disclosure record is **not in the list** |
| **Hashed-and-published set** (§13.2) | §13.2:811 enumerates it exhaustively (dataset seal, archive Merkle root, CPG response set, protocol, resolver SHA, provider configuration hash, development-only registry, rater instructions, rater order artifacts, assignment fingerprint, per-rater sheets, adjudication artifacts, exclusion table, results artifact) | **No.** A contamination-disclosure record is **not in the list** |
| **Analysis input (declarations artefact)** | Not mentioned in the protocol at all; it is a tooling construct for §15.2 identity inadmissibility and §15.5(7) protocol violations | **No** — see §5 below: the schema is closed to four keys |
| **Development-only registry** | §5.3:244 "[NORMATIVE, append-only, entries never removed]"; :245 "**For this study the registry is frozen at registration**"; :246 "Additions, deletions and edits of entries have no effect on this study" | **No.** Append-only *in general*, but explicitly inert for U1 |

So the disclosure has a mandated *content* and a mandated *publication*, and no mandated *container*. The nearest existing container (the screening log's `held_out_ineligible_basis`) is both sealed and structurally unable to hold two of the four mandated fields.

---

## 2. Q2 — Is contamination admissible as a post-hoc exclusion, or does §5.3 / §5.10 force a VOID?

**Answer: neither. Post-hoc exclusion is expressly *prohibited*, and VOID is expressly *not* the consequence. A late contamination disclosure is a published, non-excluding flag on an observation that remains VALID.**

Prohibition of exclusion — §5.3:248:

> The company is **never excluded, removed or replaced**, whether for later CPG performance, for any outcome, or at all (§5.9, §15.2).

Disposition as a flag, not an exclusion — §15.1:836:

> `VALID` · `INVALID` · `REFERENCE-CONFLICT` · plus the rating-time exclusions `REFERENCE-AMBIGUOUS` and `REFERENCE-STALE`; and the flag `CONTAMINATION-DISCLOSED` (**observation remains VALID in the primary analysis**; §5.3). `INCONCLUSIVE` is **run-level only**.

Note the grammar: `CONTAMINATION-DISCLOSED` is listed as *a flag*, set apart from the dispositions and from the "rating-time exclusions". It is not a disposition value.

Reinforced by §15.2:853:

> **No observation may be excluded because its result is unfavourable.** The exclusion table and both screening logs are published. Exclusion rules may not change after any held-out result is seen.

Outcome invariance — §5.3:248, second half:

> A pre-specified secondary analysis excluding flagged observations **may** be reported and **never changes the §10.5 outcome**.

"may" — the secondary analysis is permissive, not mandatory; and it is firewalled from the outcome. Consistent with §10.4's heading, `CPG_U1_PROTOCOL_004.md:693`: "### 10.4 Secondary (never an acceptance basis)".

VOID is excluded by enumeration. §5.10 (`:420–441`) is the complete table of sampling-event states. It contains no contamination state. The states it does contain for frozen-input violations are about *substitution of the scan/registry*, not about a newly discovered fact:

> | `STAGE_VOID_BINDING_MISMATCH` | Held-out ordering or binding fails, including a held-out frame, scan or registry differing from the development / registered one (§5.5.3) | Study VOID |

That is the crucial distinction: **editing the scan or registry to record the contamination is VOID; merely learning the fact is not.** §18's halt list (`:910–917`) likewise contains no contamination condition, and §15.5's INCONCLUSIVE conditions (`:859–869`) contain none.

**Consequence, stated as the protocol states it:** contamination discovered late is *disclosed and flagged*, and the study proceeds with its outcome unchanged.

---

## 3. Q3 — If it arrives after the seal, what is the defined path? Name the exact state, or say there is none.

**Answer: there is no state. There is a defined *disposition* (flag `CONTAMINATION-DISCLOSED`, observation stays VALID, company never excluded, §10.5 outcome unchanged) and there is no `STAGE_VOID_*` or `STUDY_VOID_*` value, no `VERIFY_ABORT_*` value, and no procedural step tied to the arrival.**

Exhaustively, the state vocabularies that could have held one and do not:

- §5.10:`420–441` — `NOT_STARTED`, `STUDY_ABANDONED`, `WAITING_COMMITMENT_DEPTH`, `WAITING_RANDOMNESS_DEPTH`, `WAITING_DRAND_ROUND`, `WAITING_DEVELOPMENT_FINALITY`, `STUDY_VOID_REGISTRATION`, `STUDY_VOID_PRE_REGISTRATION_SPEND`, `STAGE_VOID_MALFORMED_COMMITMENT`, `STUDY_VOID_SLOT_CROSS_SPEND`, `STAGE_VOID_BINDING_MISMATCH`, `STAGE_VOID_FRAME_INSUFFICIENT`, `STUDY_VOID_PREVIEW`, `STUDY_VOID_UNAUTHORIZED_EXECUTION`, `STUDY_VOID_REPEATED_EXECUTION`, `STUDY_VOID_POST_WINDOW_EXECUTION`, `STUDY_VOID_POST_FINALITY_REORG`, `STUDY_VOID_RANDOMNESS_UNAVAILABLE`, `FINAL`, `VERIFY_ABORT_*`. **None is contamination.**
- §15.1:836 dispositions — no contamination disposition; contamination is a *flag* alongside them.
- §15.5:`859–869` INCONCLUSIVE conditions 1–8 — none is contamination.
- §18:`910–917` halt conditions 1–6 — none is contamination.

Two points bound the "path" question tightly.

First, the post-seal freeze. §6:446:

> **The held-out set is executed once.** No threshold, rule, label definition, rater instruction or line of CPG code may change after any held-out result is seen, except by a new protocol version as a new file.

And §19.1:936 marks §5.3 among the clauses **closed** at registration:

> | Frame sufficiency rule, single frozen frame, registry freeze, execution window and no-preview rule, personnel independence and blinding, rater-order derivation | **closed** (CPG-043 approvals; §4A, §5.3, §5.5, §5.7.2, §6.5, §9.2.1, §12.1, §12.2) |

So the path cannot be created by amendment inside this study; only by a new protocol version as a new file.

Second, the *substantive* answer is complete. §5.3 tells the owner precisely what happens to the company (nothing), to the observations (flagged, still VALID), to the outcome (unchanged) and to the public (recorded and published). What is missing is only the *vehicle*: the artefact into which `company, basis, date, discoverer` is written, and whether that vehicle enters the seal, the sampling archive, the §13.2 hashed set, or a plain published addendum outside every hash.

---

## 4. Q4 — Is the disclosure reflected in any hash or seal, so an outsider could tell when it was known?

**Answer: an *early* contamination basis is bound twice over, in both the manifest and the screening log, and thus in the dataset seal and the results artifact. A *late* disclosure is bound nowhere. An outsider can therefore verify that a basis existed **before the draw**, and cannot learn anything about one discovered after.**

Early basis, doubly bound:

- Manifest entry — `cpg_u1_data.mjs:136`: `held_out_ineligible_basis: basis[c.candidate_id] ?? []` — written into each drawn entry at draw time.
- Screening log — `cpg_u1_data.mjs:140` (column list), `:155` (`held_out_ineligible_basis: (basis[r.candidate_id] ?? []).join(' ; ')`), written by `writeOnce` at `cpg_u1_data.mjs:466` (development) and `:561` (held-out). `writeOnce` is defined at `cpg_u1_data.mjs:81` and refuses to overwrite.
- Seal binds both — `cpg_u1_data.mjs:632–633`:
  - `development: { manifest_sha256: fileSha(devPath), screening_log_sha256: fileSha(join(devDir, 'screening_log.csv')), … }`
  - `held_out: { manifest_sha256: fileSha(hoPath), screening_log_sha256: fileSha(join(hoDir, 'screening_log.csv')), … }`
  - and the seal's own hash at `:641`: `seal.seal_hash = sha256(canonicalJson(seal));`
  - the seal's status string is explicit about its position in time — `cpg_u1_data.mjs:619`: `status: 'DATASET SEALED — NOT EXECUTED'`.
- The derived flag reaches the sealed results artifact — `lib/analysis.mjs:159` computes `contamination_disclosed` per row, `lib/analysis.mjs:247` emits `observations: rows.map(({ _o, ...r }) => r)` inside `return seal({ … })`, so the flag is inside `results_sha256`.

This matches the protocol's own published set, §13.2:811 — "Dataset seal (binding both manifests, both screening logs, …) · … · exclusion table · results artifact".

Late disclosure, bound nowhere:

- It is **not** in §13.2:811 (hashed and published) and **not** in §13.2A:815 (sampling archive). Both lists are closed enumerations.
- No tooling artefact carries a `date` or `discoverer` field for contamination: `grep -rn -i "late-discovered|late_discovered|discoverer|disclos"` over `C:/tmp/dt009-merge/tooling` (excluding `node_modules`) returns exactly **one** hit, `lib/analysis.mjs:159` — the derivative flag. There is no template, no rules file, no schema, no command.
- Consequence for the outsider: because the only hashed carrier is the pre-draw basis, and that basis is fixed by a frozen scan and a frozen registry, an outsider verifying the chain cannot distinguish "no contamination was ever discovered" from "contamination was discovered after the seal and disclosed in a document outside every hash". §5.3's "and published" is not tied to any timestamped or hashed vehicle. **Timing of knowledge is not attestable.**

---

## 5. The code-side gap — **CONFIRMED**

Both locations named in the brief are as described, and the conclusion drawn from them holds.

### 5.1 The declarations schema is closed to exactly four keys — confirmed

`lib/analysis.mjs:56–60`:

```js
/** Declarations the tooling cannot discover itself (§15.2 identity inadmissibility; §15.5(7) protocol violations). */
export function checkDeclarations(d, { sealHash, heldOutIds }) {
  const errors = [];
  const KEYS = ['schema', 'seal_hash', 'protocol_violations', 'identity_inadmissible'];
  if (!d || Object.keys(d).length !== KEYS.length || !KEYS.every((x) => Object.hasOwn(d, x))) return [`declarations keys must be exactly ${KEYS.join(',')}`];
```

The check is a two-sided exact-key test (length equality **and** universal presence), so an extra `contamination_disclosed` key is a hard refusal, not an ignored field. `cmdAnalyze` fails closed on it — `cpg_u1_data.mjs:1063`: `if (dErr.length) fail(\`DECLARATIONS_REFUSED: ${dErr.join('; ')}\`);`. Adding a field is an edit to `lib/analysis.mjs`, which moves the tooling aggregate, which is registered (§19.1:929 "Tooling aggregate SHA-256; development-only registry SHA-256 | computed by `registration-fields`"). **Aggregate-moving. Confirmed.**

### 5.2 Contamination reaches analysis only derivatively — confirmed

`lib/analysis.mjs:159`:

```js
contamination_disclosed: (heldOut.get(it.candidate_id)?.held_out_ineligible_basis ?? []).length > 0,
```

`heldOut` is built from the **held-out manifest**, whose `held_out_ineligible_basis` was written at the held-out draw (`cpg_u1_data.mjs:136`) from `contamination()`'s `basis` map, which is itself derived from the frozen scan and frozen registry (`cpg_u1_data.mjs:108–126`). The manifest is bound by the seal (`cpg_u1_data.mjs:633`), and `cmdAnalyze` refuses a manifest that is not the sealed one. So the flag's value is **fully determined before execution** and cannot be raised later. **Confirmed.**

### 5.3 The stronger finding: both existing late-arrival channels are protocol-forbidden for contamination

The tooling does have exactly two channels for facts discovered after the seal, and **each one, if used for contamination, produces a consequence §5.3 forbids**:

| Channel | Code | Consequence in code | Protocol verdict |
|---|---|---|---|
| `identity_inadmissible` | `lib/analysis.mjs:64–75` validation; `lib/analysis.mjs:146` `if (inadmissible.has(it.candidate_id)) { disposition = 'INVALID'; reason = 'IDENTITY_INADMISSIBLE_AFTER_DRAW'; }` | all of that company's observations become `INVALID` | **Forbidden.** §5.3:248 "never excluded, removed or replaced"; and §15.1:836 requires the observation to remain VALID. Also a category error: §5.9:418 is about "the identifier belongs to a different entity", not contamination |
| `protocol_violations` | `lib/analysis.mjs:63` validation; `lib/analysis.mjs:205` `'7_protocol_violation': { triggered: declarations.protocol_violations.length > 0, … }` → `lib/analysis.mjs:211` `if (inconclusive.length) outcome = 'INCONCLUSIVE';` | run becomes `INCONCLUSIVE` | **Forbidden.** §5.3:248 "**never changes the §10.5 outcome**". Also a category error: late contamination is lawful under §5.3, not a violation of it |

So the gap is not merely "no field exists". It is: **the two fields that do exist are both semantically wrong and both produce a protocol-prohibited result**, and the field that would be right does not exist and cannot be added without moving a registered aggregate. A late contamination fact has **no lawful carrier in the instrument as frozen**. Confirmed, precisely as the brief anticipated.

One consequence worth recording for the owner: because the flag is derived from a frozen basis, the flag in a real U1 results artifact will be **true only for companies already known contaminated at the draw** — and those are exactly the companies that §5.3 makes held-out-*ineligible*, i.e. companies drawn into **development**, not held-out. §5.8:414: "Ineligible admissible companies not drawn are `DEVELOPMENT_SURPLUS` and **never enter held-out**." Therefore, for held-out companies, `contamination_disclosed` is **structurally always `false`** in a well-formed run: the field can never be true for the observations it is defined over. The `CONTAMINATION-DISCLOSED` flag of §15.1 is, as implemented, unreachable. This is a second-order finding, not a defect claim, and it is part of what the owner's decision must settle.

---

## 6. Silence or prohibition — and how it was decided

**Determination: mixed, and the mixture is the whole point.**

| Question | Protocol posture | Basis |
|---|---|---|
| May a late-disclosed company be excluded, removed or replaced? | **PROHIBITED** | §5.3:248 "never excluded, removed or replaced … or at all"; §15.2:853 |
| May a late disclosure change the §10.5 outcome? | **PROHIBITED** | §5.3:248 "never changes the §10.5 outcome" |
| Does a late disclosure VOID the study? | **PROHIBITED** (by closed enumeration) | §5.10:420–441, §18:910–917, §15.5:859–869 contain no contamination state; §15.1:836 keeps the observation VALID |
| May the scan, registry or frame be edited to record it? | **PROHIBITED** | §5.3:246; §5.5:263 step 3 "NO LATER ADDITIONS"; `STAGE_VOID_BINDING_MISMATCH` at §5.10:433 |
| **Which artefact carries the record?** | **SILENT** | §5.3:248 says only "recorded … and published"; §13.2:811 and §13.2A:815 are closed lists and omit it; §15.3:857 has no `date`/`discoverer` column and is write-once and sealed |
| **Is the record inside any hash or seal?** | **SILENT** | Neither §13.2 nor §13.2A includes it; no tooling artefact exists for it |

Method used to separate the two. For each question I required a *positive textual commitment* to call it prohibited — either an explicit "never"/"must not", or membership in a **closed enumeration** from which the item is absent (§5.10's state table, §13.2's and §13.2A's lists, §15.1's dispositions, §15.5's conditions, §18's halts). Where the protocol used a closed list, absence is a prohibition, not a silence: the vocabularies are stated as exhaustive ("exactly one" at §10.5:706; "Sampling-event states … and VOID rules" as a complete table). Where the protocol used only an unbound verb — "recorded … and published", with no object, no list membership and no enforcement tag such as `[enforced]` or `[NORMATIVE]` attached to the carrier — I called it silence. §5.3:248 carries no `[enforced]` marker for the late-discovery bullet, unlike, for example, §5.3:239's attestation rule, which ends "[enforced]", or §5.1:200's "[enforced: `checkFrameRow`; …]".

So: **the *consequences* of late contamination are fully specified and partly prohibitive; the *carrier* is genuinely silent.** That silence is a methodological gap, and the directive's rule applies. It is not the "prohibition" case, because no clause forbids recording a late disclosure — §5.3 mandates it. It is not the "specified" case either, because the mandate names no vehicle and the two closed artefact lists omit one.

Consequence of the silence, stated plainly: today, an operator who learns of contamination after the seal must publish something, has no defined place to publish it, and has no way to make the publication verifiable in time. That is a disclosure obligation without a disclosure channel.

---

## 7. STOP — the required record

Per directive §6, and because the protocol does not specify **where** a late contamination disclosure must be recorded:

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

This stream has **not** chosen a carrier, has **not** proposed a schema change as settled, and has **not** invented a state. Nothing was changed anywhere.

---

## 8. Options for the owner (OPTIONS ONLY — not a recommendation)

These are laid out so the owner can decide. This stream takes no position among them and does not recommend any. Each is stated with what it costs and what it gives up.

**Option A — Declare the silence harmless and close it as a §20 limitation.**
Record that a late contamination disclosure is published as a free-standing addendum outside every hash, and that the timing of knowledge is not attestable. Consequence: no tooling change, no aggregate move, no protocol change; the study can register as frozen. Cost: an outsider can never distinguish "nothing was discovered" from "something was discovered and disclosed off-chain", so the §5.3 disclosure duty is unfalsifiable. Also leaves the §15.1 `CONTAMINATION-DISCLOSED` flag unreachable for held-out observations (§5.3 above). Risk: a reviewer may read an unenforceable disclosure duty as a validity threat rather than a limitation.

**Option B — Add a fifth declarations key for late contamination.**
A `contamination_disclosed` array of `{candidate_id, basis, discovered_at, discovered_by}` in the declarations artefact, validated like `identity_inadmissible` but with the §5.3 consequence (flag only; no disposition change; no outcome effect). Consequence: the disclosure lands inside `results_sha256` and is bound to the seal hash the declarations already name (`lib/analysis.mjs:62`), so timing becomes attestable to the analysis step. Cost: edits `lib/analysis.mjs:59` — **moves the tooling aggregate `638d68e6…`**, so it must be decided and implemented **before registration**, and must be re-certified (selftest and mutation suite) and the aggregate re-registered. Risk: if the protocol is not also amended to name the carrier, the tooling would enforce a rule the protocol does not state — the inverse of the present gap.

**Option C — Amend the protocol to name an existing carrier.**
State in §5.3 that the record is a `cpg-u1-contamination-disclosure/v1` artefact listed in §13.2 and §13.2A. Consequence: the carrier and its publication become protocol-mandated and archive-mandated. Cost: **a new protocol version as a new file** (§6:446 permits no other route) and a new protocol SHA, hence a new registration — the current SHA is registered. Risk: re-registration resets the freeze and the 180-day clocks of §5.10:425; also invalidates any work bound to `c50fc680…`.

**Option D — Route it through `protocol_violations` as-is.**
Consequence: zero code change, and the disclosure is inside the seal-bound declarations. Cost: triggers §15.5(7) via `lib/analysis.mjs:205` → `INCONCLUSIVE`, which §5.3:248 forbids ("never changes the §10.5 outcome"), and mislabels a lawful disclosure as a violation of the protocol. Risk: **produces a protocol-prohibited outcome.** Recorded for completeness because it is technically available today; it is not compliant.

**Option E — Route it through `identity_inadmissible` as-is.**
Consequence: zero code change. Cost: marks every one of that company's observations `INVALID` (`lib/analysis.mjs:146`), which §5.3:248 and §15.1:836 both forbid, and counts against the §15.5(2) valid-observation floor. Risk: **produces a protocol-prohibited exclusion**, i.e. exactly the outcome-dependent exclusion §5.3 exists to prevent. Recorded for completeness; it is not compliant.

**Option F — Defer, with the gap registered as an open decision item.**
Carry the gap as a named open item alongside the other undecided methodological items, and register only after it is resolved. Consequence: preserves both the frozen protocol SHA and the frozen aggregate; costs schedule, not integrity. Cost: registration cannot proceed until the owner decides. Risk: none to integrity; schedule only.

Option A is the only one that requires nothing; B and C are the only ones that make the disclosure verifiable; D and E are non-compliant and are listed so that the owner knows the instrument permits them today. **No option is recommended here.**

---

## 9. Consumers of `contamination()` — nine, and whether any accepts a late input

`cpg_u1_data.mjs:108` `function contamination(o, frame, checked, frameHash)`. It reads `--scan` and `--registry` and refuses both a frame mismatch (`:112`) and a registry mismatch (`:113`). Its consumers:

| # | Command / function | Site | Accepts a **late** contamination input? |
|--:|---|---|---|
| 1 | `frame` (`cmdFrame`) | `cpg_u1_data.mjs:205`, tallies at `:211` (`if (res.contamination.length) attestedIneligible++`) | **No.** Attestation columns of the frame only; the frame is frozen before the development commitment |
| 2 | `scan` (`cmdScan`) | `cpg_u1_data.mjs:228`, `:286` `held_out_ineligible_by_scan`, `:294` | **No.** Producer, and pinned to the frozen resolver SHA — `:235` `fail(\`repo HEAD ${head} != --expect-sha …(contamination is assessed at the FROZEN resolver SHA)\`)` |
| 3 | `commitment-payload` | direct call at `cpg_u1_data.mjs:367` (and `heldOutInputs` at `:375` for the held-out stage) | **No.** Pre-commitment; the payload digests the frozen scan |
| 4 | `draw-development` | `cpg_u1_data.mjs:437` | **No.** Writes `screening_log.csv` via `writeOnce` at `:466`; write-once |
| 5 | `check-frame-sufficiency` | `cpg_u1_data.mjs:657` | **No.** Pre-commitment sufficiency check (§5.7.2) |
| 6 | `pool-check` | `cpg_u1_data.mjs:511` → `heldOutInputs` → `:501` | **No.** `heldOutInputs` refuses a changed scan or registry: `:502` `REGISTRY_CHANGED`, `:503` `SCAN_CHANGED` ("eligibility is fixed before any CPG outcome") |
| 7 | `draw-held-out` | `cpg_u1_data.mjs:525` → `heldOutInputs` → `:501` | **No.** Same refusals, plus `:497` `FRAME_CHANGED`; writes `screening_log.csv` via `writeOnce` at `:561` |
| 8 | `seal` (`cmdSeal`) | `cpg_u1_data.mjs:616`; binds the basis-bearing artefacts at `:632–633`, hashes at `:641`, `writeOnce` at `:642` | **No.** Binds only what already exists; status at `:619` is `'DATASET SEALED — NOT EXECUTED'` |
| 9 | `analyze` (`cmdAnalyze`) → `analyze()` | `cpg_u1_data.mjs:1052`; flag derived at `lib/analysis.mjs:159` | **No.** Reads the sealed held-out manifest; refuses a substituted one; its only late-arrival input is the four-key declarations artefact (`lib/analysis.mjs:59`), which has no contamination field |

**Nine consumers. Not one accepts a late contamination input.** The count matches the prior wave's. Every path is gated by one of: the frozen `frame_hash`, the frozen scan SHA, the frozen registry SHA, `writeOnce` immutability, or the seal binding. `analyze` is the only command with any post-seal input channel at all, and its channel is the closed four-key schema.

---

## 10. Labels

| Item | Label |
|---|---|
| Q1 carrier artefact | **OWNER DECISION REQUIRED** |
| Q2 admissibility as post-hoc exclusion | **VERIFIED** — prohibited (§5.3:248, §15.1:836, §15.2:853) |
| Q3 defined path after the seal | **VERIFIED** — no state exists, and none is needed: the disposition is flag-only, and §5.10/§18/§15.5 exclude VOID by closed enumeration |
| Q3 carrier of that path's record | **OWNER DECISION REQUIRED** |
| Q4 reflected in a hash or seal | **VERIFIED** for a pre-draw basis (`cpg_u1_data.mjs:136`, `:155`, `:632–633`, `lib/analysis.mjs:159`); **OWNER DECISION REQUIRED** for a late disclosure — nothing carries it |
| Code-side gap | **VERIFIED — CONFIRMED** (`lib/analysis.mjs:59–60`, `lib/analysis.mjs:159`) |
| Nine consumers, late-input acceptance | **VERIFIED** — nine, none accepts a late input |
| Overall stream verdict | **OWNER DECISION REQUIRED** |

---

## 11. Provenance

- Base SHA (worktree `C:/tmp/dt4-brand`): `af2fb6e99ce461894bf16f18c2251f75088eba18`
- Changed path (one, added): `research/deeptech-operations/prereg-011/contamination/CONTAMINATION_CARRIER_DETERMINATION.md`
- No commit, no push, no PR, no merge. No registration, no Bitcoin, no network, no credentials, no real frame, no U1 execution.
- `C:/tmp/dt009-merge` was read only. The protocol was not modified; its SHA still recomputes to `c50fc680…`.
- **DISPOSABLE.**

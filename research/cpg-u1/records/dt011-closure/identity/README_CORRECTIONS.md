# README corrections — prepared patch, NOT APPLIED (directive §9)

**Target file:** `C:/tmp/dt009-merge/tooling/README.md` — 292 lines, sha256
`e70e57d5a211773d6952add18879adba44fae31e97c14c70deeb87eddd958691`.

**NOTHING IN THIS FILE HAS BEEN APPLIED.** No write was made under `C:/tmp/dt009-merge`. A 404-mutant
certification suite is running against that tree; `README.md` is one of its 594 files.

> ## Every correction here MOVES THE AGGREGATE.
> `README.md` is inside the tooling manifest (`lib/aggregate.mjs` walks the whole tree). Editing one byte
> of it changes `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`. **All README work
> belongs in the single final edit session, after which the aggregate is recomputed once and the 35
> registration documents are renumbered to that value.**

> ## Two hard constraints on any README edit
> 1. **Never state the aggregate in the README.** The README is inside the aggregate, so any aggregate
>    value it printed would be self-referentially false the moment it was written. File count and
>    programme provenance are safe; the hash is not. (R3 and R9 are written accordingly.)
> 2. **Do not rewrite history.** The v3/v4/v5/v5.1/v6 feature tables are a changelog of this package and
>    stay as they are. R5 adds a disambiguation line *next to* the heading; it does not renumber it.

---

## The five states, as this patch uses them

| State | Meaning in these corrections |
|---|---|
| **ENGINEERING REHEARSAL** | Everything run so far: `test/selftest.mjs`, `test/mutate.mjs`, `test/adapter_conformance.mjs`, the synthetic bundles and synthetic scans under `C:/tmp/dt004-operations/**/_rehearsal/`. Synthetic data, `synthetic-test` registrations, `SYNTHETIC` networks. **Never U1 evidence.** |
| **REGISTRATION-READY** | The current state of this tree: every control implemented and exercised; identities, outpoints and checkpoint `UNASSIGNED`; no registry record exists. |
| **REGISTERED** | A public, unembargoed OSF record exists with a registry-issued `registration_id` and `registration_timestamp`, binding `protocol_sha256`, `tooling_aggregate_sha256` and `registry_sha256`. **Not yet true.** |
| **EXECUTED** | The single authorized held-out run has completed inside its window. **Not yet true.** |
| **EVIDENCE** | Artefacts produced by an EXECUTED run under a REGISTERED record. **None exist.** |

---

## R1 — `README.md:116` · AD-1…AD-9 are DECIDED, not UNDECIDED · **HIGH — false statement**

Verified: `rules/analysis_decisions.json:4` reads `"status": "DECIDED — the values below are
owner-approved methodological decisions, recorded before registration…"`, and all nine `value` fields
carry a concrete option (lines 14, 24, 34, 44, 54, 64, 74, 84, 94: `EXCLUDE_INVALID_CONFLICT_AND_STALE`,
`INCONCLUSIVE`, `URL_WITHOUT_FRAGMENT`, `ENTRY_FOR_DECISIVE_IDENTIFIER`, `CALENDAR_MONTHS`,
`STATED_REFERENCE_VALUES_ONLY`, `VOID`, `INCONCLUSIVE`, `ANY_UNAVAILABLE_ENTRY`). The file's sha256 is
`a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be` — **identical in the 593-file
`f7699f05…` tree**, so the decisions predate this candidate and the README claim was already false there.
As written, the README tells a reader that `analyze` is permanently blocked (exit 4). It is not.

**BEFORE** (lines 113–118, verbatim):

```
**Methodological decisions (`rules/analysis_decisions.json`).** Protocol-004 leaves nine values undefined (α population and
undefined α; "same document" for SOURCE-COINCIDENT; which registry unavailability counts; 24-month arithmetic and scope of
REFERENCE-STALE; INCONCLUSIVE-vs-VOID for a declared protocol violation; undefined AR; basis of the abstention split). They are
listed there with their permitted options and all set `UNDECIDED`. The file is part of the tooling aggregate, so the values
chosen are frozen by registration; `analyze` refuses to run until every value is decided. A different decisions file
(`--decisions`) is accepted only with `--allow-synthetic` and this study's `synthetic-test` registration.
```

**AFTER:**

```
**Methodological decisions (`rules/analysis_decisions.json`).** Protocol-004 leaves nine values undefined (α population and
undefined α; "same document" for SOURCE-COINCIDENT; which registry unavailability counts; 24-month arithmetic and scope of
REFERENCE-STALE; INCONCLUSIVE-vs-VOID for a declared protocol violation; undefined AR; basis of the abstention split). They are
listed there with their permitted options, and **all nine (AD-1…AD-9) are now DECIDED**: the file's `status` records the
owner-approved values, chosen before registration. The file is part of the tooling aggregate, so those values are frozen by
registration; `analyze` refuses to run while any value is `UNDECIDED`, and with this file it does not refuse. A different
decisions file (`--decisions`) is accepted only with `--allow-synthetic` and this study's `synthetic-test` registration.
```

---

## R2 — `README.md:11` · the status line does not use the five named states · **HIGH — mis-states the stage**

The current line uses a private vocabulary. "IMPLEMENTED" does not distinguish REGISTRATION-READY from
REGISTERED, and it does not say that everything run against this tree so far is ENGINEERING REHEARSAL —
which is the one claim the registration package most needs to be unambiguous about.

**BEFORE** (line 11, verbatim):

```
Status: **IMPLEMENTED · NOT REGISTERED · NOT FUNDED · NOT EXECUTED · NOT EVIDENCE.**
```

**AFTER:**

```
Status: **REGISTRATION-READY.** Not REGISTERED · not funded · not EXECUTED · **no EVIDENCE exists.**

Every run of this tooling to date — the self-test, the mutation run, the adapter conformance run and every
synthetic bundle, scan, frame, packet or seal produced with `--allow-synthetic` or a `synthetic-test`
registration — is an **ENGINEERING REHEARSAL**. Rehearsal artefacts are synthetic by construction and are
**never U1 evidence**. The five states of this study are: ENGINEERING REHEARSAL (all work so far) →
REGISTRATION-READY (this tree) → REGISTERED (a public, unembargoed OSF record with a registry-issued
`registration_id`) → EXECUTED (the single authorized held-out run, inside its window) → EVIDENCE
(artefacts of an EXECUTED run under a REGISTERED record). Nothing has advanced past REGISTRATION-READY.
```

---

## R3 — `README.md:1` · "executable end to end" reads as "has been run" · **MEDIUM**

"executable end to end" is true of the code path and false of the study; a reader scanning the title of a
registration package takes it for the latter. The title is also the right place for the one canonical
label established in `TOOL_VERSION_CLOSURE.md` §2. **The aggregate is deliberately not stated here** (see
hard constraint 1).

**BEFORE** (line 1, verbatim):

```
# CPG U1 dataset tooling — v6 (`cpg-u1-data-tooling-6`: executable end to end, DEEPTECH-PARALLEL-002)
```

**AFTER:**

```
# CPG U1 dataset tooling — v6 (`cpg-u1-data-tooling-6`)

The canonical name of this instrument is **CPG-U1 dataset tooling v6 (`cpg-u1-data-tooling-6`)**; its
identity is the tooling aggregate over the 594 files of this tree, bound in the registration record as
`tooling_aggregate_sha256` (§19.1). Every stage is *exercisable* end to end — against synthetic fixtures
only; no stage has been executed for the study.
```

---

## R4 — `README.md:5–6` · the `governed_by` parenthetical is wrong for `rules/` and names the wrong protocol · **MEDIUM**

Verified: `rules/analysis_decisions.json:3` carries `"governed_by": "CPG_U1_PROTOCOL_004.md"`, so "`rules/`
carries a historical candidate-002 label" is false for that file. Only
`rules/development_only_registry.json:3` (`CPG_U1_PREREGISTRATION_CANDIDATE_002.md §5.3, §17`) and
`templates/rules.json:2` (`CPG_U1_PREREGISTRATION_CANDIDATE_002.md`) carry it. "unchanged by
protocol-003" is stale wording from the protocol-003 era; the governing document is protocol-004.

**BEFORE** (lines 3–6, verbatim):

```
Governed by **`CPG_U1_PROTOCOL_004.md`** (supersedes protocol-003). Where the tooling and the protocol disagree, the protocol
wins and the tooling is defective. Every constant in `lib/` and `rules/development_only_registry.json`
is protocol. (`rules/` and `templates/` carry a historical `governed_by: candidate-002` label; their
content is unchanged by protocol-003.)
```

**AFTER:**

```
Governed by **`CPG_U1_PROTOCOL_004.md`** (supersedes protocol-003). Where the tooling and the protocol disagree, the protocol
wins and the tooling is defective. Every constant in `lib/` and `rules/development_only_registry.json`
is protocol. (`rules/development_only_registry.json` and `templates/rules.json` carry a historical
`governed_by: candidate-002` label; their content is unchanged under protocol-004.
`rules/analysis_decisions.json` carries `governed_by: CPG_U1_PROTOCOL_004.md`.)
```

---

## R5 — `README.md:208` · the package's "v4" heading collides with the protocol's "tooling v4" · **MEDIUM — contradicts Protocol-004 on first reading**

`CPG_U1_PROTOCOL_004.md:18`, `:25`, `:953` and `:1098` say the protocol governs "tooling **v4**". This
README's "additions in v4" heading means *the fourth feature generation of this package* — a different
axis. Without one line of disambiguation a reader concludes either that the README contradicts the
protocol or that v5/v6 are ungoverned. The changelog headings themselves are history and stay unchanged.

**BEFORE** (line 208, verbatim):

```
## What the tooling enforces (additions in v4)
```

**AFTER:**

```
> **"v4" here is not the protocol's "tooling v4".** Protocol-004 (§1, §2, §1098) names its governed
> tooling *generation* "tooling v4 (CPG-043)". The headings below are *feature generations of this
> package*, whose current version is `cpg-u1-data-tooling-6`. Both denote this one instrument, which
> Protocol-004 identifies not by any version string but by `tooling_aggregate_sha256` — its
> governed-tooling row states that the aggregate "is bound in the registration record …, **not in this
> file**". The protocol is frozen at `protocol_sha256 c50fc680…` and must not be edited to reconcile the
> wording; the divergence is disclosed, here and in the registration package, and not fixed.

## What the tooling enforces (additions in v4)
```

---

## R6 — `verify-evaluation-tree` is implemented but absent from the whole README · **HIGH — a load-bearing control is invisible**

`verify-evaluation-tree` is in the dispatch table at `cpg_u1_data.mjs:1128`, implemented in
`lib/evaluationTree.mjs`, and its domain `cpg-u1-evaluation-tree/v1` (`lib/evaluationTree.mjs:16`) is a
`PROTOCOL_MARKER` (`cpg_u1_data.mjs:323`) — so `verify-protocol` *refuses a protocol that does not state
it*. It implements §7.1 / approved CPG-047: the refusals `CONTENT_MISMATCH` (`lib/evaluationTree.mjs:77`)
and `INSTRUMENT_IN_TREATMENT` (`:74`) are what stop a later mainline state silently becoming the
treatment. **The string `verify-evaluation-tree` occurs 0 times in README.md** — not in the pipeline, not
in the command list, not in any enforcement table. A reader of the registration package cannot find the
control that pins the evaluated resolver.

**BEFORE** (line 214, verbatim, inside the "additions in v4" table):

```
| Rater order and blind-position assignment derived from the sealed held-out record | 12.1 | `lib/raterOrder.mjs`, `rater-order`, `verify-rater-order` |
```

**AFTER** (insert one row immediately after it):

```
| Rater order and blind-position assignment derived from the sealed held-out record | 12.1 | `lib/raterOrder.mjs`, `rater-order`, `verify-rater-order` |
| (v5) Evaluation-tree identity: the evaluated resolver is pinned by commit, tree id and a content-manifest aggregate over `git ls-files`; a clone whose content aggregate differs is refused (`CONTENT_MISMATCH`), and a clone that contains the instrument is refused (`INSTRUMENT_IN_TREATMENT`) — later mainline states never become the treatment | 7.1 (CPG-047) | `lib/evaluationTree.mjs`, `verify-evaluation-tree` |
```

**AND** (add to the command block, after line 155 `verify-evaluation`):

```
node cpg_u1_data.mjs verify-evaluation-tree --clone <clean clone at the frozen resolver SHA> --declared <declared identity>
```

---

## R7 — `README.md:278` · unresolvable reference to `CPG041_VERIFICATION_REPORT.md` · **MEDIUM**

The vendored-dependency integrity claim delegates its evidence to a file that does not exist anywhere in
the candidate package: `C:/tmp/dt009-merge` contains only `CPG_U1_PROTOCOL_004.md` and `tooling/`. An
outsider handed the registration package cannot resolve the reference, so the claim is unverifiable as
written. The dependency bytes are, however, inside the tooling aggregate, which *is* registered — so the
claim should rest on that.

**BEFORE** (line 278, verbatim):

```
| Vendored dependency | `node_modules/@noble/curves` **1.9.7** and `node_modules/@noble/hashes` **1.8.0**, byte-identical to the npm tarballs (integrity recorded in CPG041_VERIFICATION_REPORT.md). No install step; nothing is fetched |
```

**AFTER:**

```
| Vendored dependency | `node_modules/@noble/curves` **1.9.7** and `node_modules/@noble/hashes` **1.8.0**, byte-identical to the npm tarballs. Their bytes are inside this tree, so they are pinned by the registered tooling aggregate; `lib/registration.mjs` `PARAMETERS.bls_implementation` states the pinned versions, and the per-file hashes are the manifest lines `node_modules/@noble/**` of the aggregate. (The original tarball-integrity comparison is recorded in `CPG041_VERIFICATION_REPORT.md`, which is a repository document and is **not** part of this package.) No install step; nothing is fetched |
```

---

## R8 — `README.md:191` · the DR-1 breaking change and the `/v1` freeze are undocumented · **MEDIUM**

Lines 92–95, 138–143 and 176–191 document the relay floor correctly (verified against
`lib/sampling.mjs:18` `MIN_DRAND_RELAYS = 2`, `:193–194`, and `lib/evidenceBundle.mjs:41`, `:50`). What is
missing is that DR-1 **broke the beacon input shape** relative to earlier tooling while
`cpg-u1-sampling-evidence/v1` was **deliberately not** advanced to `/v2`. Without that sentence a reader
holding a pre-DR-1 bundle cannot tell why it is refused, and the registration package cannot answer
"which evidence schema produced these artefacts?" from the README.

**Conditional on the owner taking Option A in `EVIDENCE_SCHEMA_CLOSURE.md` §4.** If Option B (bump to
`/v2`) is chosen instead, replace this correction with a mechanical `/v1` → `/v2` change at `README.md:92`,
`:176`, `:187` **plus** `lib/sampling.mjs:16` and `test/selftest.mjs:522`, `:1393`, `:1427`.

**BEFORE** (line 191, verbatim, the last line of the evidence-bundle section):

```
attribution does not enter the seed or the sampling record — the §5.7 derivation and `record_sha256` are unchanged.
```

**AFTER:**

```
attribution does not enter the seed or the sampling record — the §5.7 derivation and `record_sha256` are unchanged.

**Schema freeze (DR-1).** The relay requirement is a **breaking change to the beacon *input* shape**: a
beacon file without a `relay` name is refused (`lib/evidenceBundle.mjs`), and a carried round attested by
fewer than two differently named relays is refused (`lib/sampling.mjs`). The schema version was
**deliberately not** advanced to `/v2`: the bundle is a verification input, the sampling record and
`record_sha256` are byte-identical before and after the change, no registered study artefact carries this
schema string, and the wrong shape fails closed at runtime rather than needing a label. `cpg-u1-sampling-evidence/v1`
is therefore **frozen**; which `/v1` is meant is settled by the registered tooling aggregate, of which
exactly one exists for this study.
```

---

## R9 — provenance of *this* tree is not stated anywhere · **MEDIUM**

The README ties features to programme ids (DEEPTECH-PARALLEL-002 at line 89, CPG-044 at line 66) but never
says what distinguishes this tree from the 593-file predecessor whose aggregate `f7699f05…` is still cited
in 35 registration documents. That is the first question a reader holding both trees asks. Verified by
manifest diff: one file added (`lib/enumeration.mjs`) and six changed (`README.md`, `cpg_u1_data.mjs`,
`lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/mutate.mjs`, `test/selftest.mjs`). **State the file
count and the programme ids only — never the aggregate** (hard constraint 1).

**BEFORE** (line 280, verbatim, in the Reproducibility table):

```
| Aggregate | sha256 of `"<sha256>  <path>\n"` lines over every file of this tree, sorted by path |
```

**AFTER:**

```
| Aggregate | sha256 of `"<sha256>  <path>\n"` lines over every file of this tree, sorted by path — **594 files**, vendored dependencies included. The value is computed by `lib/aggregate.mjs` and recorded in the registration record, **not in this file**: this README is one of the 594 files, so it cannot state its own aggregate |
| This tree vs. the DEEPTECH-PARALLEL-002 v6 tree (593 files) | Adds `lib/enumeration.mjs` (§4A.2 enumeration attribution) and the DR-1 drand relay-attribution floor (`lib/sampling.mjs`, `lib/evidenceBundle.mjs`, `cpg_u1_data.mjs`, and their tests). `rules/analysis_decisions.json` is byte-identical in both trees. The `TOOL_VERSION` label is unchanged at `cpg-u1-data-tooling-6`; **the aggregate is not** — the aggregate, not the label, is the registered identity |
```

---

## Verified NOT defective — claims checked and found correct

Recorded so a later wave does not re-audit them.

| README | Claim | Verification |
|---|---|---|
| — | **No `f7699f05…` anywhere.** README states no aggregate at all | grep: 0 hits |
| — | **No "593 files" claim.** The README states no file count | grep: 0 hits. The 593-file identity defect is **not** in the README — it is in 35 files under `C:/tmp/dt004-operations` (see `TOOL_VERSION_CLOSURE.md` §5) |
| 57–58, 98–99 | B1/§9a ordering: reference adjudication *before* the seal, packet built from the drawn manifests and rebound by `seal` | consistent in both places; matches `lib/packets.mjs`, `cmdSeal` |
| 120–164 | every command in the block exists in `COMMANDS` (`cpg_u1_data.mjs:1114–1132`) | checked one by one; **no obsolete command**. The only gap is the reverse (R6) |
| 174 | "There is **no `--seed` argument**" | grep `--seed` in `cpg_u1_data.mjs`: 0 hits |
| 176–191, 92–95, 138–143 | evidence-bundle shape and the ≥ 2-relay rule | matches `lib/sampling.mjs:18`, `:193–194`; `lib/evidenceBundle.mjs:41–50`, `:74` |
| 264 | the ≥ 2-relay floor "applies to a round the bundle *carries*"; cannot compel a beacon (§20.17) | matches `lib/sampling.mjs:186–194` — the floor is checked only once a beacon is present, so absence still yields `WAITING_DRAND` then `VOID_RANDOMNESS` |
| 265 | the tooling cannot show that named relays are independent operators | matches `lib/evidenceBundle.mjs` — names are recorded, distinctness is checked, independence is not |
| 277, 288–291 | resolver clone `f01a7eb4199be4e04d4fee7fc0116303949dc553`; `selftest.mjs`, `mutate.mjs --jobs 4`, `adapter_conformance.mjs` | `test/selftest.mjs:50` `FROZEN_SHA`, `:57`; `test/adapter_conformance.mjs:22`; `test/mutate.mjs:14` (`--jobs`, default 4). All three files exist |
| 279 | fixtures and `test/fixtures/PROVENANCE.json` | present |
| 244–266 | the "cannot verify" section | no control is *implied but not implemented*; the section is an honest under-claim throughout |
| 30 | "The seed custodian role no longer exists" | true; a changelog statement against a superseded candidate. **No change proposed — historical documents stay historical** |

---

## Application order and aggregate impact

1. All nine corrections touch only `README.md`. **Every one moves the aggregate.** R8 additionally
   depends on the owner's Option A/B choice, and Option B would touch `lib/sampling.mjs` and
   `test/selftest.mjs` as well.
2. Apply them in a **single** edit session, after the running 404-mutant certification has completed.
3. Recompute the aggregate once (`lib/aggregate.mjs`, or an independent replication) and re-run
   certification against the new tree.
4. Only then renumber the 35 documents under `C:/tmp/dt004-operations` to the final aggregate and file
   count, and re-attest their "VERIFIED (recomputed…)" claims.
5. Register.

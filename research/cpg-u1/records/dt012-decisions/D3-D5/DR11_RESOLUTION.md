# DR-11 — resolution prepared for owner ruling

DEEPTECH-PARALLEL-012, stream D-3. **Analysis only. Nothing applied, no code written, no file under
`C:/tmp/dt009-merge` created or modified.** All measurements are read-only greps and `awk`/`sed` prints
against the candidate `C:/tmp/dt009-merge/tooling`, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files (verified: `find . -type f
| wc -l` = 594; 108 files outside `node_modules`). The protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` was read only.

The governing instruction was followed: the meaning of DR-11 was **not** inferred from its label. Every
occurrence of `DR-11` in the corpus was read, and the code it names was read in the candidate itself.

---

## 1. THE EXACT TEXT OF THE DECISION, AND WHERE IT IS

There are exactly **seven** occurrences of `DR-11` in the corpus outside wave 011's own files. The two
that constitute the decision are quoted verbatim.

### 1a. `C:/tmp/dt009-closure/orchestrator/RECONCILIATION_LOG.md:201-217` — the finding and the referral

> ### DR-11 — the same defect class, elsewhere, unfixed. CONFIRMED BY ME.
>
> `cpg_u1_data.mjs:113`:
>
> ```js
> const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
> ```
>
> Identical last-value-wins collapse, but over scan **results** rather than frame rows, inside
> `contamination()` — which nine consuming commands use. The stream reproduced a hand-edited artefact in
> which a flagged company reads back as `held_out_ineligible_by_scan=false, hits=0, registry=-`, and
> `check-frame-sufficiency` reported **sufficient, exit 0**, because `frame_hash` and `registry_sha256`
> are computed over the frame and the registry, **not** over `results`.
>
> **It correctly did not fix it**, for two reasons I accept: a guard there changes what nine consuming
> commands accept, which is the scope expansion requirement 8 forbids; and it requires a **hand-edited
> artefact**, since the fixed instrument can no longer emit one — a different threat model from the frame-
> authoring defect the owner ruled on. **This is a new owner decision (DR-11), closable in one line, and
> the window shuts at registration like the others.**

### 1b. `C:/tmp/dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md:204-206` — the same decision, as a human action

> **DR-11** — the same last-value-wins collapse at `cpg_u1_data.mjs:113`, `new Map(scan.results.map(...))`,
> inside `contamination()` which nine commands use; **VERIFIED to exist by me**; one line closes it; needs
> a hand-edited artefact, so a different threat model from DR-10.

### 1c. The remaining five occurrences (each read; none is a ruling)

| Location | Verbatim fragment | Form |
|---|---|---|
| `dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md:246` | "**Take the four aggregate-moving decisions now, in one sitting** (DR-11, …)" | recommendation |
| `dt010-rehearsal/DEEPTECH_PARALLEL_010_REPORT.md:255` | "**Five aggregate-moving decisions, all DECISION REQUIRED, all expiring at registration:** DR-11 (`contamination()`'s last-value-wins collapse)" | explicitly open |
| `dt010-rehearsal/DEEPTECH_PARALLEL_010_REPORT.md:272` | "**Authorise Enumerator B … and take all five aggregate-moving decisions in one sitting** — DR-11, …" | recommendation |
| `dt010-rehearsal/orchestrator/HUMAN_ACTIONS.md:23` | item 8, "**Rule on the four aggregate-moving decisions, in one sitting** \| DR-11 (… one line to close)" | outstanding action |
| `dt011-closure/orchestrator/DECISION_STATUS_DETERMINATION.md:23-40` | "## DR-11 — no ruling exists … **Verdict: DR-11 — OWNER DECISION REQUIRED.**" | status determination |

### 1d. No owner ruling exists — verified independently

I grepped `OWNER DECISION:` and `DECIDED:` across all ten search roots (`dt002`, `dt004-operations`,
`dt005-orchestration`, `dt006-human-min`, `dt007-eight-person`, `dt008-prereg`, `dt009-closure`,
`dt009-merge`, `dt010-rehearsal`, `dt011-closure`). The complete set of ruling lines in the corpus is:

```
dt009-closure/orchestrator/DECISION_RECORD.md:19    ## DR-1  — drand relay floor        · OWNER DECISION: ADOPT OPTION (B)
dt009-closure/orchestrator/DECISION_RECORD.md:40    ## DR-2  — §19.3 certenv wording    · OWNER DECISION: ADOPT OPTION (A)
dt009-closure/orchestrator/DECISION_RECORD.md:53    ## DR-10 — `cmdScan` duplicate collapse · OWNER DECISION: FIX BEFORE REGISTRATION
dt009-closure/G-registration/DECISION_DISCLOSURES.md:31   ## 1. DR-1 — drand relay floor · DECIDED: **ADOPT OPTION (B)**
dt009-closure/G-registration/DECISION_DISCLOSURES.md:137  ## 2. DR-2 — section 19.3 certenv wording · DECIDED: **ADOPT OPTION (A)**
dt009-closure/G-registration/DECISION_DISCLOSURES.md:243  ## 3. DR-10 — `cmdScan` duplicate collapse · DECIDED: **FIX BEFORE REGISTRATION**
```

**DR-11 appears in none of them.** `dt009-closure/orchestrator/DECISION_RECORD.md` contains no `DR-11`
entry at all. Confirmed: **DR-11 carries no owner ruling.**

*Search trap re-confirmed:* a loose grep for `DR-11` also matches `PMO-ADR-11` at
`dt002/docs/pmo/OMNIVYRA-PMO-002.md` lines 165, 171, 255, 260 — the unrelated Omnivyra PMO
architecture-decision namespace about splitting Zone A2. Four hits; none is about the enumeration
collapse. Every search in this document excluded `ADR`.

---

## 2. TWO CORRECTIONS TO THE RECORD, BOTH MEASURED

### 2a. The line number is `:114`, not `:113`, in the registered candidate

```
C:/tmp/dt009-merge/tooling/cpg_u1_data.mjs
112:   if (scan.frame_hash !== frameHash) fail('scan was produced for a different frame (frame_hash mismatch) — re-scan the exact frame');
113:   if (scan.registry_sha256 !== fileSha(registryPath)) fail('scan was produced with a different development-only registry — re-scan');
114:   const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
```

`:113` was the line in the pre-merge tree. In the candidate whose aggregate is `638d68e6…` the statement
is **`cpg_u1_data.mjs:114`**, inside `contamination()` which begins at `:108`. Any ruling that quotes a
line number should quote `:114`, or quote the statement text (which is unique in the tree).

### 2b. `contamination()` is consumed by **five** commands, not nine

`contamination()` has exactly **four call sites**, serving **five** CLI commands:

| Call site | Function | CLI command(s) |
|---|---|---|
| `cpg_u1_data.mjs:367` | `cmdCommitmentPayload` (development branch) | `commitment-payload --stage development` |
| `cpg_u1_data.mjs:437` | `cmdDrawDevelopment` | `draw-development` |
| `cpg_u1_data.mjs:501` | `heldOutInputs` (`:489`), called from `:375`, `:511`, `:525` | `commitment-payload --stage held-out`, `pool-check`, `draw-held-out` |
| `cpg_u1_data.mjs:657` | `cmdCheckFrameSufficiency` | `check-frame-sufficiency` |

Distinct commands: **`check-frame-sufficiency`, `commitment-payload` (both stages), `draw-development`,
`pool-check`, `draw-held-out` — five.**

**Where the "nine" actually comes from.** `loadFrame()` (`:94`) has seven call sites — `:206`, `:365`,
`:435`, `:490`, `:655`, `:762`, `:810` — and `:490` and `:810` each serve more than one command, giving
exactly nine commands: `frame`, `commitment-payload`, `draw-development`, `pool-check`, `draw-held-out`,
`check-frame-sufficiency`, `authorize-execution`, `harness-pilot`, `harness-held-out`. That is the **nine
commands that refuse a duplicate *frame*** via `loadFrame` + `refuseMalformed`, the figure
`RECONCILIATION_LOG.md` corrected from ten to nine in the adjacent section. It was then carried across to
`contamination()`, where it does not apply.

**This materially shrinks DR-11's blast radius** and therefore weakens the "scope expansion" objection in
§1a: a guard inside `contamination()` changes what **five** commands accept, not nine — and, as §4 shows,
it changes what none of them accept for any artefact the instrument can emit.

---

## 3. IS A DUPLICATE ALREADY CAUGHT ELSEWHERE? — **NO.** DECISIVE, AND CHECKED EXHAUSTIVELY

The directive requires this be settled before recommending a fix, because if a duplicate were caught
elsewhere DR-11 would be stale. Seven candidate catchers were checked by reading each one. **None catches
it.**

| # | Candidate catcher | What it actually checks | Catches a duplicate in `scan.results`? |
|---|---|---|---|
| 1 | `cpg_u1_data.mjs:119` `if (!s) fail(\`scan has no result for ${r.candidate_id}\`)` | one frame row has **no** matching result | **No** — a collapsed duplicate still yields a result, so `s` is truthy |
| 2 | `assertUnique` — `lib/select.mjs:44-51`, called at `lib/frame.mjs:42`, `lib/select.mjs:71`, `:92` | over the **admissible frame**; refuses a repeated `idKey(c)` (`identifier_scheme\|identifier_value`) and a repeated `canonical_domain` | **No** — wrong input (frame, not scan) and wrong key (it never looks at `candidate_id`) |
| 3 | frame-level duplicate check `cpg_u1_data.mjs:100` → `res.errors.push('duplicate candidate_id')` → `refuseMalformed` (`:128-131`) | duplicate `candidate_id` among **frame rows** | **No** — frame only |
| 4 | `hashRecords` (`lib/canonical.mjs:21`) | applied to `frame` (`:104`, `:290`), `frameRows` (`lib/execution.mjs:46`), reference rows (`:637`) | **No** — `hashRecords` is **never** applied to `scan.results`; the scan is bound only by `fileSha(scanPath)` |
| 5 | `cmdScan`'s own duplicate fence `cpg_u1_data.mjs:266-282` (the DR-10 fix) | duplicate `candidate_id` in the frame **at scan time**, before any artefact is written | **No** — it guards the *producer*, not a supplied scan |
| 6 | any count / length cross-check | grep for `results.length` returns only `cpg_u1_data.mjs:296` (a `console.log` inside `cmdScan`) and `lib/sizing.mjs:24-35` (`pilot.results`) | **No** — `scan.results.length` is never compared to `frame.length` anywhere |
| 7 | the `scan_sha256` equality gates — `cpg_u1_data.mjs:442`, `:503`, `:530`; `lib/harness.mjs:51`, `:157`; `lib/execution.mjs:51`; `lib/sampling.mjs:152` | the scan on disk is byte-identical to the **committed** scan | **No** — they detect *substitution after commitment*, not a duplicate *inside* the committed scan |

Additionally, `contamination()` in full (`:108-126`) validates the supplied scan on exactly two axes —
`scan.frame_hash !== frameHash` (`:112`) and `scan.registry_sha256 !== fileSha(registryPath)` (`:113`).
There is no shape validator, no schema field on the scan report at all (`cpg_u1_data.mjs:287-292` stamps
`tool`, `rules`, `repo_sha`, `frame_hash`, `registry_sha256`, `files_scanned`, `results` — no `schema`,
no version integer), and no test asserts anything about a duplicate `candidate_id` in a *supplied* scan
(`grep -n duplicate test/selftest.mjs` — 21 hits, all about frames, identifiers, domains, orders,
ratings, archives, packets and pilot results; none about `scan.results`).

**Verdict: DR-11 is live, not stale. The finding stands.**

### 3a. The hand-edit precondition is genuine — and no legacy scan can trigger it either

`cmdScan` builds `state = frame.map((r, i) => ({ r, record: i + 1, … }))` (`:246`) and emits
`results = [...state.values()].map(…)` (`:283`), one result per frame row, **after** refusing any frame
with a repeated `candidate_id` (`:266-282`). So a scan emitted by the registered instrument has unique
`candidate_id`s by construction. The *pre*-DR-10 producer keyed a `Map` on `candidate_id`, so its output
was unique by construction too (that was the DR-10 defect). **No tooling version, current or historical,
can emit a scan containing a duplicate `candidate_id`.** A duplicate can only arrive by hand-edit, by a
manual merge/concatenation of two scans, or from a third-party generator.

---

## 4. THE CONSEQUENCE, TRACED TO `file:line` — NOT ASSERTED

Suppose the supplied scan's `results` contains two entries for `SYN-0007`: first `A` with
`repository_hits: [1 hit]`, then `B` with `repository_hits: []`, `registry_matches: []`.

1. `cpg_u1_data.mjs:114` — `new Map(...)` keeps the **last** entry for a repeated key. `byId.get('SYN-0007')` returns **`B`**. `A` is discarded; no error, no warning, no log line.
2. `cpg_u1_data.mjs:119` — `if (!s) fail(...)` does not fire: `s === B`, truthy.
3. `cpg_u1_data.mjs:120-121` — `s.repository_hits.length` is `0`, `s.registry_matches` is `[]`, so **no CPG-C1(1) and no CPG-C1(6) basis line is pushed**.
4. `cpg_u1_data.mjs:123-124` — `b` stays empty (assuming no attestation contamination from `res.contamination`, `lib/schema.mjs:159-171`), so `basis['SYN-0007']` is **never set**.
5. `cpg_u1_data.mjs:125` — `ineligible: new Set(Object.keys(basis))` therefore **omits `SYN-0007`**.

From `c.ineligible` the consequence forks into three real effects:

| Route | `file:line` | Effect |
|---|---|---|
| **sufficiency** | `cpg_u1_data.mjs:658` → `sufficiencyOf` `:648-651` → `lib/frame.mjs:40-48`, where `have` counts `!ineligible.has(r.candidate_id)` | a contaminated company is **counted toward frame sufficiency**; `check-frame-sufficiency` prints "frame sufficient", exit 0 (`:661`) — the reproduction the record describes |
| **development draw** | `cpg_u1_data.mjs:448` → `lib/select.mjs:70-81`; ineligible companies are drawn *first* at `:77` | `SYN-0007` loses its priority ordering and may be drawn as if eligible |
| **held-out draw — the material one** | `cpg_u1_data.mjs:525` → `heldOutInputs:501` → `cmdDrawHeldOut` → `lib/select.mjs:92-100`, `const pool = admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))` (`:93`), drawn from at `:98` | **a CPG-C1-contaminated company enters the held-out pool and can be drawn into the held-out sample.** `pool-check` (`:512`) also reports the pool as sufficient |

The tampered state is then **written into the record as fact**:
`cpg_u1_data.mjs:462` `counts.held_out_ineligible: c.ineligible.size` is one too low; `:463` / `:559`
`entry(x, split, c.basis)` sets `held_out_ineligible_basis: []` (`:138`); `:466` writes
`screening_log.csv` from `screeningLog(checked, split, c.basis, …)` (`:143`) with an empty basis column;
and the manifest is then sealed and bound on-chain via `scan_sha256` in `PAYLOAD_KEYS`
(`lib/commitment.mjs:11-12`).

**The contamination consequence is the whole point:** CPG-C1 held-out ineligibility is the mechanism that
keeps the held-out sample free of companies the resolver has already seen. Bypassing it does not corrupt a
count — it invalidates the held-out claim, which is U1's primary claim. Note also that
`held_out_ineligible_by_scan` is **never read** by `contamination()` (it reads `repository_hits` and
`registry_matches` directly), consistent with `dt011-closure/orchestrator/CONTAMINATION_FLAG_DEAD.md`;
so the field the reproduction displays as `false` is cosmetic — the load-bearing fields are the two arrays.

### 4a. The inverse direction, for completeness

If the *last* duplicate carries hits and the first does not, the company is wrongly marked **ineligible**.
That direction is fail-safe for contamination but can push the frame below `FRAME_MINIMUM`
(`lib/frame.mjs:34-37`) and produce a spurious `FRAME_INSUFFICIENT` (`:660`) — an availability defect, not
an integrity one.

---

## 5. IS THE COLLAPSE SILENT, OR DOES A HASH EVENTUALLY CATCH IT? — **SILENT, IF THE EDIT PRECEDES THE COMMITMENT**

This is the pivotal timing question and the record does not state it.

- **Hand-edit BEFORE `commitment-payload --stage development`.** `contamination()` returns
  `scanSha: fileSha(scanPath)` (`:125`) — the hash of the **edited** file — and `cmdCommitmentPayload`
  stamps that value as `scan_sha256` (`:372`). The tampered scan **is** the committed scan. Every later
  gate (`:442`, `:503`, `:530`, `lib/harness.mjs:51`, `:157`, `lib/execution.mjs:51`,
  `lib/sampling.mjs:152`) compares against it and **passes**. No hash mismatch ever occurs. **Fully
  silent for the life of the study.**
- **Hand-edit AFTER the development commitment.** `scan_sha256` no longer matches and the run aborts
  loudly — `VERIFY_ABORT_HASH_MISMATCH` (`:442`, `:530`), `SCAN_CHANGED` (`:503`), `SCAN_MISMATCH`
  (`lib/harness.mjs:51`, `:157`). **Already closed by hashing; DR-11 adds nothing here.**

**So DR-11's entire exposure window is: after `scan` is produced, before the development commitment is
made.** Inside that window nothing detects it automatically.

One mitigating fact, and it matters for the recommendation: the tampered `scan.json` is itself hash-committed,
and it **still contains both duplicate entries**, including the one bearing the hits. A human auditor who
re-reads the committed scan can see the duplicate. The defect is therefore *silent to the instrument* but
*forensically preserved* — machine-undetectable, human-detectable after the fact.

### 5a. The honest limit of any fix here — the decisive framing

A duplicate-refusal guard is **not an adversarial control**, and the ruling should not be taken on the
belief that it is. An actor with write access to `scan.json` inside that window does not need a duplicate:
they can simply set `repository_hits: []` on the single existing entry. That produces the identical
outcome, leaves no duplicate, and **no guard contemplated under DR-11 would catch it** — the only thing
that would is an independent re-scan at the frozen resolver SHA, which is the pre-existing control
(`cpg_u1_data.mjs:234-236` pins HEAD to `--expect-sha` and refuses a dirty tree).

What a guard **does** buy, and it is real:

- it converts an **accidental** malformation — two scans concatenated, a partial manual merge, a
  third-party or re-keyed generator, a re-run appended rather than replaced — from a *silent wrong answer*
  into a *loud refusal*; and
- it removes the one place in the instrument where a supplied artefact is read into a `Map` keyed on an
  identifier **without** the uniqueness assertion that every comparable site has (`lib/select.mjs:44`,
  `cpg_u1_data.mjs:100`, `lib/raterOrder.mjs`, `lib/ratings.mjs`, `lib/evaluation.mjs`). That consistency
  is itself worth having in an instrument whose claim is fail-closed reading of every input.

DR-11 is therefore an **input-hygiene / fail-closed-consistency** decision, not a security fix. Ruling on
it with the right label is part of the ruling.

---

## 6. DOES CLOSING DR-11 MOVE THE INSTRUMENT AGGREGATE? — **YES**

`toolingManifest()` (`lib/aggregate.mjs:8-22`) walks the **entire** tree from `ROOT`, hashes every regular
file, sorts by path, and hashes the concatenated `sha256  path` lines. Verified: the walk includes `test/`
and `node_modules/` — `find . -type f | wc -l` = **594**, matching the registered file count, against 108
files outside `node_modules`. **Any byte change to any file in the tree changes the aggregate.**

Files a closure would touch, and therefore the files that move it:

| File | Why |
|---|---|
| `cpg_u1_data.mjs` | the guard itself, at/near `:114` inside `contamination()` |
| `test/selftest.mjs` | the guard is worthless unasserted; new cases for a duplicated result |
| `test/mutate.mjs` | the guard is worthless unkilled; new mutants in a DR-11 block mirroring `M420-M423` (`test/mutate.mjs:465-470`), which raises the anchor/mutant count from **404** |
| `README.md` *(only if the enforcement row is wanted)* | the separate README decision already before the owner |

**Answer: YES — `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs` (and optionally `README.md`).**
It must therefore be applied in the **single final edit session**, together with DR-12, `TOOL_VERSION`,
the README row and any `EVIDENCE_SCHEMA` README sentence, so the aggregate moves exactly once and the
~18-hour certification run is paid once. Deciding it alone, later, costs a whole extra run.

Deciding **not** to fix (option C below) moves nothing in-tree: the disclosure lives in the registration
package under `C:/tmp/dt004-operations/**`.

---

## 7. NINE-FIELD RETURN — DR-11

### DECISION
Whether to close the last-value-wins collapse at `cpg_u1_data.mjs:114`
(`const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));`) inside `contamination()`, which is
consumed by five CLI commands, before the instrument is registered — given that triggering it requires a
hand-edited or externally generated scan artefact, that no check anywhere in the instrument catches a
duplicate `candidate_id` in `scan.results`, and that the window closes permanently at registration.

### RECOMMENDED RULE
**ADOPT OPTION (A) — FIX BEFORE REGISTRATION, as a read-time well-formedness refusal, applied in the
single final edit session.** In `contamination()`, immediately before `:114`, refuse any supplied scan
whose `results` repeat a `candidate_id`, naming every repeated id and its occurrence count, and write no
artefact. Assert it in `test/selftest.mjs` and add mutants in a DR-11 block of `test/mutate.mjs` mirroring
the `M420-M423` pattern (guard negated; the `> 1` comparison weakened), so the guard is both asserted and
killed. Label the ruling **input hygiene and fail-closed consistency, not an adversarial control** (§5a).
Do **not** additionally refuse results *beyond* the frame's id set in the same change — that would alter
accepted-input semantics and is offered separately as option (B).

### ALTERNATIVES CONSIDERED
- **(A) Minimal duplicate refusal — recommended.** Refuses only artefacts the registered instrument
  **cannot emit** (§3a), so it expands no accepted-input semantics for any legitimate pipeline and does not
  engage the requirement-8 scope objection, which in any case rested on the miscounted "nine" (§2b).
- **(B) Strict set-equality:** assert `scan.results`' id set equals the frame's id set exactly. Strictly
  stronger — catches duplicates, extras and (redundantly with `:119`) omissions. Rejected as the primary
  recommendation because refusing *extra* results is a genuine, if small, change to what five commands
  accept, and requirement 8 bites there. Available as an add-on if the owner wants it.
- **(C) Leave open and disclose.** Aggregate unchanged; costs no certification run. Rejected: it leaves a
  machine-undetectable wrong answer reachable inside a real operational window (§5), and the window shuts
  permanently at registration — after which the only remedy is voiding the study.
- **(D) Bind `scan.results` with `hashRecords`** as a second witness beside `scan_sha256`. Rejected:
  `fileSha(scanPath)` already binds the whole file byte-for-byte; a record hash adds no detection of a
  pre-commitment edit and moves more of the tree.
- **(E) Re-scan-on-read** (have `contamination()` regenerate the scan). Rejected outright: it would make
  five read-only commands execute `git` against a clone, and it changes the instrument's architecture.

### SCIENTIFIC / INTEGRITY EFFECT
Closes the only path by which a CPG-C1-contaminated company can enter the **held-out pool** without any
automated refusal (`lib/select.mjs:93` → `:98`), and by which `check-frame-sufficiency` can report
sufficient over a contaminated frame. Under option (A) the effect is bounded and honest: it eliminates
**accidental** collapse (concatenated or manually merged scans, re-keyed third-party generators) and
aligns `contamination()` with every other identifier-keyed read in the instrument. It does **not** defend
against an actor with write access inside the pre-commitment window, who can zero `repository_hits`
without a duplicate (§5a); that risk remains covered only by the frozen-SHA re-scan control
(`cpg_u1_data.mjs:234-236`). The ruling should say so, so the registration package does not overclaim.

### REGISTRATION EFFECT
**Moves the instrument aggregate** off `638d68e6…` — `cpg_u1_data.mjs`, `test/selftest.mjs`,
`test/mutate.mjs`, and `README.md` if the enforcement row is included (§6). Nothing is registered yet, so
no registration is invalidated: `registration-fields` computes `toolingManifest(ROOT).aggregate` at run
time. Consequences: the ~35 registration documents that quote a superseded aggregate must be renumbered
once more, and this is the **last** window — after registration the aggregate is a registered sampling
field (`lib/registration.mjs:119`) and is inside the OP_RETURN digest (`lib/commitment.mjs:11-12`), so a
second value is study-void. Under option (C) the registration effect is a disclosure paragraph only.

### MUTATION EFFECT
The 404-mutant set (`test/mutate.mjs`, 404 mutant tuples counted in source) grows by the new DR-11
mutants — the DR-10 precedent added four (`M420-M423`), so expect **404 → ~406-408**, every one of which
must be KILLED, and `--anchors` must still find each anchor exactly once. **The full run must be re-run
over the final byte set regardless**, because the aggregate moves. Therefore: rule on DR-11 **in the same
sitting** as DR-12, `EVIDENCE_SCHEMA`, `TOOL_VERSION` and the README row, and apply all of them in one
edit session, so one ~18-hour run covers them all. Secondary observation, out of scope and recorded for a
later wave: the existing `if (!s) fail('scan has no result for …')` guard at `:119` has **no** mutant of
its own in `test/mutate.mjs`.

### PROTOCOL EFFECT
**None.** No protocol byte changes and no new protocol version is required. The guard enforces §5.3
held-out ineligibility (CPG-C1) more faithfully; it grants nothing and relaxes nothing. Neither
`contamination` nor the scan report is a `PROTOCOL_MARKER` (`cpg_u1_data.mjs:321-323` — the list is
`PROTOCOL_VERSION`, `STUDY_ID`, `D = 6`, `K = 12`, `180 days`, `Δ = 3 h`, `30 days`, `QUICKNET.hash`,
`bls-unchained-g1-rfc9380`, `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`,
`OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `cpg-u1-rater-order/v1`,
`cpg-u1-execution-authorization/v1`, `E ≥ 126 / 52 / 32`, `CITED_URL_RULE`, `EVALUATION_TREE_DOMAIN`), so
`verify-protocol` is unaffected. The protocol at
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` is untouched.

### OWNER APPROVAL REQUIRED?
**YES.** No `OWNER DECISION:` or `DECIDED:` line naming DR-11 exists anywhere in the corpus (§1d), and two
of its seven mentions state in terms that it *is* a new owner decision and that all five are DECISION
REQUIRED. This document is a recommendation and nothing more. **Nothing has been applied and no code has
been written.**

### EXACT WORDING TO RECORD
> **⚠ NOT A RULING — PROPOSED WORDING ONLY. No owner decision on DR-11 exists; see this file at "OWNER APPROVAL REQUIRED?" above. Do not cite this line as authority.**
>
> ## DR-11 — `contamination()` duplicate-result collapse · OWNER DECISION: ADOPT OPTION (A) — FIX BEFORE REGISTRATION
>
> `cpg_u1_data.mjs:114`, `const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));`, inside
> `contamination()` (`:108`), keeps only the LAST result for a repeated `candidate_id`. No check anywhere in
> the instrument catches it: `:119` catches only a MISSING result; `assertUnique` (`lib/select.mjs:44`) runs
> over the admissible frame and keys on `identifier_scheme|identifier_value` and `canonical_domain`, never
> on `scan.results`; `hashRecords` is never applied to `scan.results`; `scan.results.length` is never
> compared to `frame.length`; and the `scan_sha256` gates detect substitution AFTER the commitment, not a
> duplicate INSIDE the committed scan. The consequence, traced: the collapsed entry's empty
> `repository_hits` / `registry_matches` keep the company out of `basis` (`:120-124`) and out of
> `c.ineligible` (`:125`), so it is counted toward frame sufficiency (`lib/frame.mjs:40-48`) and enters the
> held-out pool (`lib/select.mjs:93` → `:98`), and the manifest and screening log then record it as
> eligible. If the edit precedes the development commitment the collapse is SILENT — `scan_sha256` is the
> hash of the edited file (`:125` → `:372`) — though the committed scan still contains both entries, so it
> remains human-detectable after the fact. Triggering it requires a hand-edited, manually merged or
> third-party scan: no tooling version, current or historical, can emit a duplicate `candidate_id`
> (`:246`, `:266-282`, `:283`).
>
> **Adopted:** in `contamination()`, before `:114`, refuse any supplied scan whose `results` repeat a
> `candidate_id`, naming each repeated id with its occurrence count, writing no artefact; assert it in
> `test/selftest.mjs`; add DR-11 mutants to `test/mutate.mjs` on the `M420-M423` pattern. Refusing results
> *beyond* the frame's id set is NOT adopted here.
>
> **Scope, recorded so the registration package does not overclaim:** this is an input-hygiene and
> fail-closed-consistency control, NOT an adversarial control. An actor able to edit `scan.json` before the
> development commitment can instead zero `repository_hits` on a single entry with no duplicate, which this
> guard does not catch; that risk is covered only by re-scanning at the frozen resolver SHA
> (`cpg_u1_data.mjs:234-236`).
>
> **Corrections to the DR-11 finding as recorded at `dt009-closure/orchestrator/RECONCILIATION_LOG.md:201`
> and `DEEPTECH_PARALLEL_009_REPORT.md:204`:** the statement is at `cpg_u1_data.mjs:114` in the candidate,
> not `:113`; and `contamination()` is consumed by FIVE commands (`check-frame-sufficiency`,
> `commitment-payload` both stages, `draw-development`, `pool-check`, `draw-held-out`) — the "nine" is the
> count of commands that refuse a duplicate FRAME via `loadFrame` + `refuseMalformed`, and does not apply
> here.
>
> **Aggregate:** MOVES — `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs` (+ `README.md` if the
> enforcement row is adopted). Apply in the SINGLE final edit session with DR-12, `EVIDENCE_SCHEMA`,
> `TOOL_VERSION` and the README row. Mutant count rises from 404; the full run must be re-run once over the
> final byte set and every mutant KILLED. **Protocol: no byte changed, no new version.**

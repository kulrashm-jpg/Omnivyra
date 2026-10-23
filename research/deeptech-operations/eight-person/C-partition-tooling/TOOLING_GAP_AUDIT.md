# TOOLING GAP AUDIT — two enumerators against the frozen CPG U1 instrument

**DEEPTECH-PARALLEL-007 · Agent C · PROPOSAL / AUDIT — advisory only.**
Nothing here is registered, decided or committed. **No frozen byte was changed.**
Worktree `C:/tmp/dt4-frame` at `af2fb6e99ce461894bf16f18c2251f75088eba18`; all writes confined to
`research/deeptech-operations/eight-person/C-partition-tooling/`.

## 0. Baseline, verified by me

| Artefact | Expected | Recomputed | Verdict |
|---|---|---|---|
| Tooling aggregate at `C:/tmp/dt002/research/cpg-u1/tooling` (`lib/aggregate.mjs` definition, 593 files incl. vendored deps) | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, `files 593` | **MATCH** |
| `CPG_U1_PROTOCOL_004.md` (both `C:/tmp/dt002/research/cpg-u1/` and `C:/tmp/dt4-frame/research/cpg-u1/`) | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | identical in both trees | **MATCH** |
| Scratch working copy used for all experiments | — | aggregate `f7699f05…5cc5dd` after copy | **byte-identical copy** |

`C:/tmp/dt002` and `research/cpg-u1/**` were read only. Every experiment ran against the scratch copy.

## 1. The four starting facts, each confirmed

| Claim | Status | Evidence |
|---|---|---|
| `FRAME_COLUMNS` has 22 columns ending `enumerated_by`, `enumerated_at`, `enumeration_source_url` | **CONFIRMED** | `lib/schema.mjs:12–35`; 22 entries; last three exactly those |
| `lib/schema.mjs:124` requires `enumerated_by` non-empty | **CONFIRMED, verbatim** | `if (!r.enumerated_by.trim()) errors.push('enumerated_by is required');` |
| `lib/personnel.mjs:26` permits `n > 1` for `enumerator` only | **CONFIRMED, verbatim** | `else if (role !== 'enumerator' && n > 1) errors.push(...)` — every other role is capped at one holder; `enumerator` is uncapped |
| Screening-log writer at `cpg_u1_data.mjs:140`/`:155` records `screened_by` | **CONFIRMED** | `:140` `LOG_COLUMNS` includes `screened_by`; `:155` writes `screened_by: screenedBy`, sourced from `need(o, 'screened-by')` at `:427` and `:522` |

**Protocol context that settles the question of intent.** §4A.3 states, in terms: *"enumerator (≥ 1)"* and
*"**Several enumerators are permitted**; each holds no other role."* Two enumerators are not a protocol
amendment — they are an option the frozen protocol already grants. §4A.2 adds the barrier this work must
respect: enumerators receive *"public sources; the frame template; §4A, §5.1–§5.4; the jurisdiction-family
list; the development-only registry"* and *"**never receive**: pilot results, sizing output, quotas or any
CPG output"*.

## 2. THE CAPABILITY TABLE

Read for this table: `lib/frame.mjs` (whole), `lib/schema.mjs` (whole; `checkFrameRow` in detail),
`lib/scan.mjs` (whole), `lib/personnel.mjs` (whole), `lib/eventlog.mjs` (whole), `lib/select.mjs`
(`assertUnique`, `idKey`), `lib/csv.mjs` (whole), `lib/canonical.mjs` (whole), `lib/aggregate.mjs` (whole),
and in `cpg_u1_data.mjs`: `loadCsv`/`loadFrame`/`rowHash`/`frameRowHashes` (`:76–:103`), `contamination`
(`:107–:125`), `refuseMalformed`, `entry`, `LOG_COLUMNS`/`screeningLog` (`:139–:159`), `cmdFrame` (`:204`),
`cmdScan` (`:220`), `cmdDrawDevelopment` (`:394`), `cmdCheckFrameSufficiency` (`:615`), `cmdCheckPersonnel`
(`:711`), `cmdAuthorizeExecution` (`:721`), and the `COMMANDS` dispatch table (`:1076`).

| # | Capability needed for two enumerators | Already present in the frozen instrument | Absent | Where it would have to go |
|---|---|---|---|---|
| C1 | Accept work from more than one person at all | **YES.** `lib/personnel.mjs:26` caps every role at one holder *except* `enumerator`. `check-personnel` passes a register with N enumerators. | — | — |
| C2 | Record, per row, **who** enumerated it | **YES.** `enumerated_by` is column 20 of `FRAME_COLUMNS`, required non-empty per row (`schema.mjs:124`), and is part of the row that `rowHash = sha256(canonicalJson(r))` covers. | — | — |
| C3 | `cmdFrame` accepts **several** CSVs | **NO — one CSV only.** `cmdFrame` → `loadFrame(o)` → `loadCsv(need(o, 'frame'), FRAME_COLUMNS)`: a single `--frame` path, no repeat flag, no glob, no directory, no second-file merge anywhere in the tree. | multi-file input | **Nowhere — not needed.** The operator concatenates outside the tooling (§4 proves this works). Adding a merge mode would be a frozen-byte change for no gain. |
| C4 | Column-set discipline on the merged file | **YES, and strict.** `loadCsv` refuses any missing *or extra* header column: `columns must match the template exactly`. | — | — |
| C5 | Frame identity independent of which enumerator's rows come first | **YES.** `frameHash = hashRecords(frame, 'candidate_id')` and `hashRecords` sorts by `candidate_id` before canonicalising. Proven experimentally: A+B and B+A give the identical `frame_hash`. | — | — |
| C6 | `enumerated_by` validated against the personnel register | **NO.** `enumerated_by` appears in exactly three places in the whole tree: `schema.mjs:32` (column list), `schema.mjs:124` (non-empty), `templates/candidate_frame.template.csv` (header). It is a free-text string. No command takes both `--frame` and `--personnel`: only `check-personnel` (`:712`) and `verify-rater-assignment` (`:945`) read `--personnel`, and neither reads a frame. | cross-check of `enumerated_by` ∈ register's enumerator `person_id`s | `lib/personnel.mjs` (a new exported `enumeratorIds(reg)`) + a new `--personnel` option on `cmdFrame`/`cmdCheckFrameSufficiency`. **Frozen-byte change — deferred.** A PROPOSAL substitute is the partition allocation + audit log, which bind `person_id` ↔ rows outside the frozen tree. |
| C7 | Any **per-enumerator counting** | **NO. None whatsoever.** No tally, no group-by, no histogram over `enumerated_by`. `cmdFrame` tallies only by exclusion reason; `frameSufficiency` tallies only by `expected_outcome_class`. | per-enumerator counts | `lib/frame.mjs` (a `byEnumerator` tally) or, better, kept **out** of the frozen tree: a count per enumerator is a fairness metric, not an admissibility rule, and the audit log already yields it (`per_enumerator` in `reconcileWithFrame`). |
| C8 | Any **partition** concept | **NO. Zero occurrences** of "partition" in any `.mjs` or `.md` under the tooling tree. There is no notion of an enumeration domain, a work allocation, a per-person scope or a candidate_id namespace. | the whole concept | New, **outside** the frozen tree: `partition/partition.mjs` in this directory. Nothing in the frozen instrument needs it, because the frozen instrument never asks who produced a row. |
| C9 | An **audit log of who enumerated what** | **NO.** `enumerated_by` is not propagated past `checkFrameRow`: `LOG_COLUMNS` (`:139–:141`) has **`screened_by`**, a single operator-supplied `--screened-by` string applied to every row, not `enumerated_by`; `entry()` (`:132–:136`) omits it; neither manifest carries it. **But** `frame_row_hashes` in the development manifest (`:421`) *is* `sha256(canonicalJson(row))` per `candidate_id`, and the row includes `enumerated_by` — so attribution is already **cryptographically bound and publicly verifiable**, just not human-readable. | an explicit append-only, hash-chained submission log | New, outside the frozen tree: `partition/auditlog.mjs` + `AUDIT_LOG_DESIGN.md`. It reuses the frozen chaining primitive and reconciles against the already-published `frame_row_hashes` — so it needs **no** new published artefact from the frozen tooling. |
| C10 | `check-frame-sufficiency` caring **who** produced a row | **NO — and that is correct, not a gap.** `cmdCheckFrameSufficiency` → `sufficiencyOf` → `frameSufficiency(admissible, ineligible)` counts on `expected_outcome_class` and `candidate_id` only. Provenance is irrelevant to sufficiency by design. | — | — |
| C11 | Duplicate `candidate_id` across enumerators | **YES, refused.** `loadFrame` (`:96–:102`) pushes `duplicate candidate_id` as a MALFORMED error → `cmdFrame` exits 1 and every draw command calls `refuseMalformed`. | — | — |
| C12 | **Same company under two different `candidate_id`s** | **YES, refused — at the sufficiency gate.** `frameSufficiency` calls `assertUnique(admissible)` (`lib/select.mjs:44`), which refuses a repeated `identifier_scheme:identifier_value` *or* a repeated `canonical_domain` among admissible rows, and `drawDevelopment`/`drawHeldOut` call it again. Since an admissible row can have neither `UNKNOWN` scheme nor `UNKNOWN` domain (A3/A2 would be `unknown` → excluded), this is a **complete** legal-entity duplicate detector for admissible rows. `cmdFrame` alone does **not** catch it (exit 0). | detection of the same company under **two different** valid identifiers (CIK vs LEI) or **two different** domains of one group | **Agent D owns this.** Not mine. |
| C13 | Independent application of §5.1 a1–a6 | **YES, fully.** `checkFrameRow` is a pure per-row function; see §5 below. | — | — |
| C14 | Independent application of C1(2)–C1(5) | **YES mechanically, NO epistemically.** See §5. | a written instruction telling both enumerators how to answer C1(2)–C1(5) | **The pre-registration text, not code.** |
| C15 | The contamination-scan invocation path over a merged frame | **YES, unchanged.** `cmdScan` takes the single merged `--frame`, is per-`candidate_id`, and never reads `enumerated_by`. `contamination()` binds `scan.frame_hash === frameHash` and `scan.registry_sha256 === sha256(registry)` — both survive concatenation because `frame_hash` is order-independent. Proven by running the real `scan` over the merged file. | — | — |
| C16 | A hash-chaining primitive for a new log | **YES, reusable design.** `lib/eventlog.mjs` gives `GENESIS`, `seq`, `prev_event_sha256`, `event_sha256 = sha256(canonicalJson(body without event_sha256))`, append-only JSONL, and the honest limit: *"A truncated TAIL or a substituted whole log is NOT detectable from the file alone: the head hash must be published (procedural)."* | admission of enumeration event types | `EVENT_LOG_SCHEMA` and `EVENT_TYPES` are frozen constants that `readEventLog` enforces, so the frozen *functions* cannot be called for a new schema without a frozen-byte change. See `AUDIT_LOG_DESIGN.md` §4 for the exact three-line diff. |
| C17 | §4A.2 barrier enforcement in tooling | **PARTIAL.** `checkPersonnelRegister` requires the declaration `ran_or_saw_cpg_output === 'no'` per person — a *declaration*, not a containment. No tool checks that an artefact handed to an enumerator is barrier-clean. | mechanical barrier on enumerator inputs | New, outside the frozen tree: the `barrierViolations` scan in `partition/partition.mjs`. |

### Two things the table should not be read as saying
- **`--allow-synthetic` is a test flag, not a production path.** Every run below used it because every row is
  synthetic. A real frame would omit it, and `checkFrameRow` would then *refuse* any `SYNTHETIC-` name or
  `.example` domain (`schema.mjs:101–103`).
- **`--screened-by` is the operator's name, not an enumerator's.** It is recorded once per draw and applies to
  the whole screening log. It is not, and must not be confused with, per-row enumerator attribution.

## 3. THE ANSWER TO THE OWNER'S KEY QUESTION

> **Can two enumerators work today with ZERO tooling change?**

## **YES.** The frozen instrument accepts a concatenated two-enumerator frame and runs the whole frame → scan → sufficiency chain on it without a single byte changed.

The eighth person needs **no code**. What it needs is **three lines of operator procedure** and **two lines
of pre-registration text** (§6).

### 3.1 How the test was built

Two synthetic CSVs in the frozen 22-column format, each with its own `enumerated_by`
(`enumerator-a` / `enumerator-b`), disjoint `candidate_id` namespaces (`SYN-A-*` / `SYN-B-*`) and disjoint
CIK ranges. Class counts chosen to land exactly on `FRAME_MINIMUM` (recomputed from the frozen
`lib/frame.mjs`: **126 fill-expected / 52 abstention-expected / 32 identity-hazard = 210 rows**), split
105/105. Generator: `scratchpad/zero-change/gen.mjs`. **No real company, no network, no real frame.**

Concatenation, as an operator would do it — one header, then both bodies:

```sh
{ cat frame_a.csv; tail -n +2 frame_b.csv; } > merged_ab.csv
```

The contamination scan ran against a **throwaway synthetic git repo** (3 files, one deliberately naming
`SYNTHETIC-A-Entity-7`) so the real `cmdScan` code path — `git rev-parse HEAD` vs `--expect-sha`,
clean-tree check, `git ls-files`, scope classification, token matching, registry matching — executed for
real. The frozen development-only registry was used unmodified.

### 3.2 Real command output and exit codes

```
$ node cpg_u1_data.mjs frame --frame merged_ab.csv --allow-synthetic
frame rows: 210  malformed: 0
  ADMISSIBLE                       210
  held-out-ineligible by attestation (before scan/registry): 0
frame_hash: f2ff1899d70e3c09377ca47d3f35632ea9b6dd9f7b037367d6a6e808b7d78316
exit=0

$ node cpg_u1_data.mjs frame --frame merged_ba.csv --allow-synthetic     # B's rows first
frame rows: 210  malformed: 0
  ADMISSIBLE                       210
  held-out-ineligible by attestation (before scan/registry): 0
frame_hash: f2ff1899d70e3c09377ca47d3f35632ea9b6dd9f7b037367d6a6e808b7d78316
exit=0
```

**The frame hash is identical for both concatenation orders.** The order in which the operator staples the
two enumerators' files together is not part of the frame's identity. That is what makes concatenation safe
rather than merely tolerated.

```
$ node cpg_u1_data.mjs scan --repo <synthetic repo> --expect-sha 4c6681eb363c50ee7ddb266dc16776dca6d40cf6 \
    --registry rules/development_only_registry.json --frame merged_ab.csv --out scan_ab.json
scanned TEST=2 CPG_IMPLEMENTATION=1 files at 4c6681eb363c50ee7ddb266dc16776dca6d40cf6
held-out-ineligible by scan/registry: 1 of 210
  SYN-A-0007: 1 repo hit(s), e.g. tests/hit.test.ts:1
scan_sha256: a23af4678cfedc09fb1d69739c498666b71e55a5cb03de147b00180f0796851f
exit=0

$ node cpg_u1_data.mjs check-frame-sufficiency --frame merged_ab.csv --allow-synthetic \
    --scan scan_clean.json --registry rules/development_only_registry.json
  fill-expected          eligible admissible 126  required 126
  abstention-expected    eligible admissible 52  required 52
  identity-hazard        eligible admissible 32  required 32
frame sufficient for every permitted pilot outcome; frame_hash f2ff1899d70e3c09377ca47d3f35632ea9b6dd9f7b037367d6a6e808b7d78316
exit=0
```

The whole chain is green on a two-enumerator frame. The scan is per-`candidate_id` and never reads
`enumerated_by`; sufficiency counts only classes.

### 3.3 The refusals that protect the operator (also real output)

These matter as much as the pass: a mistake in merging is caught loudly, not silently absorbed.

**Naive `cat a b` — B's header row survives as a data row:**
```
$ node cpg_u1_data.mjs frame --frame merged_naive.csv --allow-synthetic
  MALFORMED candidate_id: a1_operating_legal_entity must be exactly "yes", "no" or "unknown" (blank is not
  an answer); … expected_outcome_class must be one of fill-expected|abstention-expected|identity-hazard|
  unknown; enumerated_at must be YYYY-MM-DD; enumeration_source_url must be an https URL;
  QID "wikidata_qid" fails format/checksum validation
frame rows: 211  malformed: 1
exit=1
```
The duplicated header becomes a row whose `candidate_id` is literally `candidate_id`, and twelve separate
checks fire on it. **`cat a b` cannot silently corrupt a frame.**

**Both enumerators claim the same `candidate_id`:**
```
$ node cpg_u1_data.mjs frame --frame merged_dup_id.csv --allow-synthetic
  MALFORMED SYN-A-0001: duplicate candidate_id
frame rows: 211  malformed: 1
exit=1
```

**Both enumerators enumerate the same company under different `candidate_id`s:**
```
$ node cpg_u1_data.mjs frame --frame merged_dup_company.csv --allow-synthetic
frame rows: 211  malformed: 0
  ADMISSIBLE                       211
exit=0                                        # <-- `frame` alone does NOT catch it

$ node cpg_u1_data.mjs check-frame-sufficiency --frame merged_dup_company.csv --allow-synthetic \
    --scan scan_dup.json --registry rules/development_only_registry.json
ERROR: FRAME_INVALID: duplicate identifier CIK:100001 — one row per legal entity
exit=1                                        # <-- but the sufficiency gate DOES
```
This corrects the assumption that the frozen instrument has no duplicate detector. It has one:
`assertUnique` in `lib/select.mjs:44`, reached from `frameSufficiency` and from both draw commands. It keys
on `identifier_scheme:identifier_value` and on `canonical_domain`, and an admissible row can have `UNKNOWN`
for neither. **Agent D should start from `assertUnique` rather than build a detector.** The residual gap is
narrow and specific: one company under *two different valid identifiers* (CIK and LEI) or *two different
domains* of one group.

**Consequence for the owner:** `frame` alone is not the gate. The operational rule is
*`frame` then `check-frame-sufficiency`, and the merged frame is not accepted until the second exits 0.*

### 3.4 Sufficiency is not weakened, and not strengthened, by splitting the work

One candidate contaminated by the scan takes the frame below the floor and the instrument says so:
```
  fill-expected          eligible admissible 125  required 126
ERROR: FRAME_INSUFFICIENT: fill-expected eligible 125 < required 126
exit=1
```
`FRAME_MINIMUM` = **126 / 52 / 32** is a property of the protocol, not of the number of enumerators. Two
enumerators must still deliver 210 eligible admissible rows *between* them. Splitting the work halves each
person's load; it does not lower the bar.

## 4. WHAT THE OPERATOR MUST DO (the whole zero-change procedure)

1. Each enumerator returns one CSV whose header is byte-identical to
   `templates/candidate_frame.template.csv`, with its own `enumerated_by` on every row and `candidate_id`s
   inside its own allocated prefix.
2. The operator concatenates with **one** header: `{ cat a.csv; tail -n +2 b.csv; } > frame.csv`.
   (`cat a.csv b.csv` is caught, but do not rely on being caught.)
3. `frame` → `scan` → `check-frame-sufficiency`, all three exit 0, before the development commitment.

Nothing else. No new flag, no new command, no frozen-byte change.

## 5. ADMISSIBILITY RECORDING — CAN TWO ENUMERATORS AGREE WITHOUT A SHARED DECISION?

### 5.1 One correction to the task framing
The per-row validation of a1–a6 and C1(2)–C1(5) is **not** in `lib/frame.mjs`. `lib/frame.mjs` contains only
frame *sufficiency* (`enumeratePilotOutcomes`, `MAX_HELD_OUT_QUOTAS`, `FRAME_MINIMUM`, `frameSufficiency`).
The per-row rules are `checkFrameRow` in **`lib/schema.mjs:92–176`**.

### 5.2 How they are validated, exactly
- Every one of `a1_operating_legal_entity`, `a2_domain_controlled_https`, `a4_tie_independent_of_cpg`,
  `a6_reference_obtainable` and all four `c1_*` columns must be **exactly** `yes`, `no` or `unknown`; blank
  is MALFORMED (`must be exactly "yes", "no" or "unknown" (blank is not an answer)`).
- Tri-state mapping is one line: `tri = (v) => v === 'yes' ? 'pass' : v === 'no' ? 'fail' : 'unknown'`.
  **`unknown` is never a pass.**
- **A3 and A5 are computed, not attested**: A5 from `JURISDICTION_FAMILIES[jurisdiction_family]`, A3 from
  `validateIdentifier(scheme, value)` plus family/scheme compatibility. Two enumerators cannot disagree about
  them at all — they are checksum arithmetic.
- **A2 is partly computed**: `UNKNOWN` domain or a domain failing the `HOSTNAME` regex overrides the
  attestation.
- **A4 is gated on evidence**: `a4 === 'pass'` but a missing/non-https `identifier_domain_evidence_url` or a
  blank `identifier_domain_evidence_note` is downgraded to `fail`.
- Exclusion is the **first** non-pass of A1…A6 in fixed order, then `OUTCOME_CLASS_NOT_ESTABLISHED`.
- Contamination: `yes` **and** `unknown` both append to `contamination`, and every entry makes the company
  held-out-ineligible.

`checkFrameRow` is a **pure function of one row**. There is no cross-row state, no shared table, no
operator input, no clock, no network. **Two enumerators working on disjoint candidates cannot produce an
inconsistent frame for a1–a6, because nothing either of them writes can change how the other's rows are
judged.** Consistency of *judgement quality* is a personnel matter (§4A), not a tooling one.

### 5.3 The orchestrator's §5.3 finding — CONFIRMED, with one refinement
The quoted rule is verbatim protocol: *"**For every contamination attestation, `unknown` is treated exactly
like `yes`.** An unestablished contamination question makes a company ineligible [enforced]."* And it **is**
enforced — `checkFrameRow` appends `— NOT ESTABLISHED, treated as contaminated` for every `unknown`.

The inference follows and I confirm it: an independent enumerator, who by §4A.2(a)(b) has never implemented
CPG and never seen CPG output, has **no public source** from which to establish C1(2) (used in CPG
development), C1(3) (values derived from CPG output), C1(4) (prior CPG execution) or C1(5) (the
implementers' own or controlled entity). Answering honestly from public evidence alone, the answer is
`unknown` — which is ineligibility. **Every row would be held-out-ineligible and the held-out pool would be
empty.** So the answers must come from the one artefact §4A.2 does place in enumerators' hands: the
**development-only registry**. Its own `status` field says so explicitly: *"Before candidate enumeration, the
CPG implementer must attest that every company ever run through CPG (smoke, live, pilot, production) or used
in CPG development is listed."* Its entries cite exactly these bases — `CPG-C1(5) implementers' own company`,
`CPG-C1(2) used in CPG-035 smoke/development work`, `CPG-C1(4) CPG-012 live pass`.

**Refinement 1 — the registry is a disclosure, not a per-row instruction.** It tells an enumerator which
companies *are* contaminated. It does not, by itself, tell the enumerator what to write for a company that is
*not* in it. Writing `no` there is an inference from the operator's disclosure being complete — and §5.3 says
plainly *"The seed's completeness is **not attested** (§19.2, H2)."* So the `no` answers rest on an
unattested operator assertion. This is a property of the frozen design, identical for one enumerator and for
eight; two enumerators neither create nor worsen it.

**Refinement 2 — C1(6) makes it safe in practice.** A registry match makes a company held-out-ineligible via
C1(6) **regardless of what any attestation says** (`registryMatches` in `lib/scan.mjs`, merged in
`contamination()`), and C1(1) catches repository mentions independently. So an enumerator writing `no` for
C1(2)–C1(5) on a registry-listed company changes nothing: the scan excludes it anyway.

**Therefore:** two enumerators can produce a consistent frame **only if both are given the same written
instruction** for C1(2)–C1(5). That instruction is not a shared *decision* about any candidate — it is one
sentence of pre-registered procedure, identical for both, and it is needed for **one** enumerator just as
much. My recommended wording, for the owner to accept, reject or replace:

> For C1(2)–C1(5), answer `yes` if the company appears in the development-only registry supplied to you, and
> `no` otherwise. Do not answer `unknown`: the operator's registry is the complete disclosure of the
> implementers' CPG history for the purpose of these four questions, and its completeness is separately
> declared and unattested (§5.3, §19.2 H2).

**This is a pre-registration change, not a tooling change.** It does not alter my answer in §3: two
enumerators need no code. It does mean the §4A.2 packet handed to *each* enumerator must be identical, and
its hash published — which is what the `PARTITION_ASSIGNED` audit-log event and the allocation digest are
for.

## 6. WHAT I RECOMMEND THE OWNER DECIDE (not decided here)

| # | Question | My reading |
|---|---|---|
| Q1 | Adopt concatenation as the official two-enumerator path? | **Yes.** It works today, changes no frozen byte, and keeps the tooling aggregate intact for registration. |
| Q2 | Pre-register the C1(2)–C1(5) instruction (§5.3 above)? | **Required**, for any number of enumerators. Publish the exact wording and the hash of the packet each enumerator receives. |
| Q3 | Make `check-frame-sufficiency` (not `frame`) the acceptance gate? | **Yes** — `frame` alone admits a duplicated company; `assertUnique` behind sufficiency refuses it. |
| Q4 | Pre-register a partition rule and publish its digest? | **Recommended, optional.** It is what makes "disjoint" auditable rather than asserted. `partition/` is a candidate; it is a PROPOSAL. |
| Q5 | Publish an enumeration audit log? | **Recommended, optional.** `AUDIT_LOG_DESIGN.md`. It needs no new frozen artefact: it reconciles against the `frame_row_hashes` the development manifest already publishes. |
| Q6 | Ever bind `enumerated_by` to the personnel register in code? | **Not before registration.** It is a frozen-byte change and would move the tooling aggregate. The audit log gives the same assurance from outside. |
| Q7 | **Does a per-class target count reach an enumerator, or not?** | **Owner must decide; I have taken the strict side and the owner may overrule me.** See §8. |

## 8. A CONFLICT THE OWNER MUST RESOLVE — targets versus the §4A.2 barrier

`research/deeptech-operations/dataset/JURISDICTION_PARTITIONS.md` (pre-existing, from an earlier wave; I read
it and changed nothing) already partitions the **same** grid I chose — `(jurisdiction_family ×
expected_outcome_class)`, four families × three classes — and plans *"equal quarters per class, with margin"*.
Its conclusion is a **count**: *"Target ≈ 236 rows expected to be eligible admissible — 136 / 60 / 40, split
evenly across the four families (34 / 15 / 10 per family)"*, derived from the §5.7.2 floor 126/52/32, which
`lib/frame.mjs` computes from the frozen sizing rule over all 4 096 permitted pilot outcomes. That document is
aware of the barrier — it states *"enumerators never see pilot, sizing or quota information"* — and labels the
targets `HUMAN-REQUIRED INPUT`.

The two pieces of work are **complementary, not competing**: that document says *how many per cell*; my tool
says *which enumerator owns which cell*. The unresolved question is who may be told the counts.

**The tension, stated precisely.** §4A.2 lists what an enumerator receives: *"public sources; the frame
template; §4A, §5.1–§5.4; the jurisdiction-family list; the development-only registry"* — and *"never
receive: pilot results, sizing output, quotas"*. §5.6 (sizing) and §5.7.2 (sufficiency) are **not** on the
receive list. `126/52/32` is not a pilot result and is computable from the protocol alone with no execution —
but it is unambiguously an **output of the sizing rule**, and `136/60/40` is a quota in the ordinary sense of
the word.

**What my tool does, and why.** `partition/partition.mjs` takes the strict reading: the allocation it emits
carries **scope only and no count**, and its §4A.2 barrier *refuses* any input carrying `quota`, `target`,
`count`, `minimum`, `pilot`, `sizing` or a bare number. An allocation that told an enumerator "produce 34
fill-expected rows" would be refused by my own tool. I chose the strict side deliberately, because the
conservative failure mode (an enumerator who does not know the target and is told by the operator to keep
going) costs effort, while the permissive failure mode (an enumerator whose frame composition is a function of
a sizing-derived number) is exactly the §19.3 risk-31 attack the barrier exists to blunt.

**Three options, for the owner:**
1. **Strict.** Enumerators get scope only. The **operator** runs `check-frame-sufficiency` and says "keep
   going" or "stop". The enumerator never learns a number. Costs iteration; preserves the barrier absolutely.
   *This is what my tool implements.*
2. **Permissive.** Pre-register, before any enumeration, that the §5.7.2 floor and the planned margin are part
   of the enumerator packet, on the stated ground that they are protocol constants independent of any CPG
   execution. Cheapest operationally; must be pre-registered and published, never decided later.
3. **Split.** Enumerators get a *scope* allocation and an **over-provisioned round count** that is not the
   §5.7.2 floor (e.g. "enumerate in batches of 20 per cell until told to stop"), so no protocol-derived
   quantity crosses the barrier.

I have not chosen between them and this document does not decide. But **option 2 cannot be adopted after
enumeration begins**, and option 1 requires the operator to be available to iterate — so the choice is on the
critical path for registration, alongside the §5.3 instruction in §5.3 above.

## 7. Prohibitions honoured

No real company data. No network (the only `git` calls were against a throwaway synthetic local repo). No
real frame, no real enumeration, no protocol edit, no commit, no push, no PR, no registration, no U1
execution, no credentials, no fabricated identities (`ENUM-ALPHA`/`ENUM-BRAVO`/`enumerator-a`/`enumerator-b`
are role labels, not people). No write to `C:/tmp/dt002` or `research/cpg-u1/**`; no write to
`research/deeptech-operations/frame/`, `dataset/` or `human-min/D-frame/`.

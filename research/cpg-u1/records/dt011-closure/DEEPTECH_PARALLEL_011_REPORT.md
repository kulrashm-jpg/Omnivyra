# DEEPTECH-PARALLEL-011 — FINAL PRE-REGISTRATION IDENTITY CLOSURE

Labels used, and only these: **VERIFIED · FIXED · PREPARED · HISTORICAL · OWNER DECISION REQUIRED ·
BLOCKED · NOT EXECUTED.**

**The label FIXED appears nowhere in this report. Nothing was applied.** Six streams ran read-only or
in throwaway scratch copies. The candidate instrument is byte-for-byte unchanged and the 404-mutant
certification run was never disturbed.

**The candidate is NOT registration-ready.** §18 of the directive forbids concluding otherwise from
these preparations passing, and independently of that instruction, three new exit-0 or scope findings
below would make the claim false.

---

## 1. Firewall — VERIFIED

| | |
|---|---|
| candidate aggregate, measured at start and at end | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| files | 594 |
| protocol SHA, re-verified | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` |
| files under `C:/tmp/dt009-merge` modified today | **0** |
| mutation parent PID 4092 | alive throughout |

Recomputed with the instrument's **own** `lib/aggregate.mjs` `toolingManifest()`. Four streams
independently reproduced the value. A naive `xargs sha256sum | sha256sum` gives a different, wrong
answer and was not used.

**Elapsed run time, from process metadata only — no partial verdict inspected:** started
2026-09-24 20:10:18, so **~6 h at the time of measurement**, roughly one third of the ~18 h
expectation.

## 2. Why a mid-run edit would produce a run that completes and lies — VERIFIED

`test/mutate.mjs:506-510` does `cpSync(ROOT, work, …)` **inside `runMutant`, once per mutant**. Three
consequences:

1. the harness never writes into the candidate — each mutant gets a private `%TEMP%` copy;
2. it **re-reads the candidate for every remaining mutant**;
3. the anchor pre-flight at `:486`, which asserts each `from` string occurs exactly once, **already ran
   at start and does not run again**.

So an edit landing now yields **no crash and no error** — a run reporting `404/404 killed` over a tree
that never existed as one object. This is the same failure class as the 587-file `640510782a…` tree
that "runs fine and lies". The firewall is not caution; it is the difference between a certification
and something indistinguishable from one.

## 3. §16 stop conditions — both fired — OWNER DECISION REQUIRED

**STOP 1 — "DR-11 is not explicitly resolved."** Determined from the record, not the prompt, and the
determination is **discriminating**: DR-1, DR-2 and DR-10 each carry an explicit `OWNER DECISION:` /
`DECIDED:` line in two independent locations with an adopted option. DR-11 has **seven mentions and no
such line**; two of them say in terms that it *is* a new owner decision and that all five are DECISION
REQUIRED. `EVIDENCE_SCHEMA` was explicitly deferred, never resolved.

*Search trap recorded:* a loose grep for `DR-11` also matches four `PMO-ADR-11` hits in the unrelated
Omnivyra PMO namespace. They look like rulings and are not.

**STOP 2 — "current mutation worktree would be affected."** §3, §7, §9 and §11 all require edits to
files inside the running suite's tree.

## 4. The structural collision, and the clock on it — OWNER DECISION REQUIRED

Every one of the five decisions moves the aggregate; the suite is certifying `638d68e6…`. Two are
unresolved, so **any edit today guarantees at least one extra ~18 h cycle**.

| | Path A — finish first | Path B — decide first |
|---|---|---|
| current run | completes, certifies `638d68e6…` | ~6 h discarded |
| cycles needed | **two** (~12 h remaining + ~18 h ≈ 30 h) | **one** (~18 h) |
| risk | certifies a tree the decisions immediately supersede | the hours already spent are lost |

A third ordering — applying *some* decisions now — costs a **third** run and must be avoided. The
arithmetic currently favours **Path B** and decays hourly. That is the owner's call; the clock is the
finding.

## 5. R28 — a placeholder identity reaches exit 0 — OWNER DECISION REQUIRED · **NEW, HEADLINE**

`lib/registration.mjs:69-73`. `human()` has **exactly two** rejection paths: the literal `UNASSIGNED`
sentinel, and any string containing `SYNTHETIC`. There is no third, and **no identifier-shape
validation exists anywhere** (grep for `orcid|ror|isni|doi.org` ⇒ zero outside one fixture).

So `TBD`, `PLACEHOLDER`, `0000-0000-0000-0000` in the five identity leaves, on `bitcoin-mainnet`,
**without** `--allow-synthetic`, yields **exit 0 — "complete, public, unembargoed, authoritative."**

**This inverts the severity ordering the record has carried.** Wave 010 elevated DR-12 and did not
record R28:

| | DR-12 | R28 |
|---|---|---|
| effect | verifier **understates** missing prerequisites | verifier **affirms** a record naming no real party |
| worst exit | **4** (bounded — all ten fields ⇒ exit 1) | **0** |
| trigger | the sentinel written back with padding/wrong case — a typo | filling a placeholder, which is what placeholders are for |

**The DR-12 patch does not close R28 and was not meant to.** Its stream deliberately bounded itself to
values *invisible to a human reader* and declined to invent what a valid ORCID/ROR looks like; its own
tests assert that `"UN ASSIGNED"` remains **assigned**. Two independent defects, two independent
decisions, both aggregate-moving, both pre-registration-only. **No patch exists for R28.**

## 6. R15 — a wrong provider configuration hash also reaches exit 0 — OWNER DECISION REQUIRED · NEW

A plausible wrong 64-hex `provider_configuration_sha256` passes at **exit 0**. Unlike the tooling
aggregate, it is **never** compared by `verify-registration` in any state; binding is downstream only
(`lib/harness.mjs:54`, `lib/execution.mjs:69`, `lib/evaluation.mjs:130`).

**The pattern, now with four instances:** the verifier is good at detecting *absence* and poor at
detecting *wrongness* — a wrong aggregate and a wrong protocol SHA are masked while any blocker remains
(sound once blockers clear, which is the state a real registration is in); a wrong provider hash is
never compared; a placeholder identity is never recognised.

## 7. DR-12 — PREPARED, three files not one — VERIFIED correction

Wave 010 recorded the fix as *"one line … local to `lib/registration.mjs`."* **Refuted**, both legs
verified by me:

- `test/mutate.mjs:120` — **M77's anchor is the verbatim defective line.** Patching `registration.mjs`
  alone makes it occur zero times, so `mutate.mjs` exits 1 **before any mutant runs**.
- All six `UNASSIGNED` occurrences in `test/selftest.mjs` (`:420`, `:455`, `:1368`, `:1516`, `:1800`)
  use the **exact** sentinel. None is a whitespace or case variant. So the six proposed new mutants
  would all **SURVIVE** → 404/410, survivors being exactly what certification treats as failure.

**Required in the final session:** `lib/registration.mjs` + `test/mutate.mjs` (M77's anchor, plus
M431–M436; M430 is highest in use, retired gaps M23–M26, M225, M244, M280–M299 must not be reused) +
**`test/selftest.mjs` assertions**. Anchor count **404 → 410**, staling every artefact quoting 404.

Stream evidence: targeted tests 16/20 fail unpatched, **36/36 pass patched**; the probe returns from 8
blockers to 10, identical to the draft. Projected aggregate `e3109e66eb583b2724caab0ae6444f9b88796284876369be7787fdf4c3783aad` — **PROJECTED, NOT CERTIFIED**.

**Why M77 did not catch this — VERIFIED.** M77 is named "UNASSIGNED treated as assigned" and is killed
on every run. It proves the clause is *load-bearing*; it cannot prove the clause is *normalised*.
Mutation testing detects removal of asserted behaviour, never behaviour that was never asserted.
**Therefore the run in flight cannot find DR-12, and 404/404 must not be read as "the sentinel guard is
sound."**

*Application hazard, corrected:* the stream reported `core.autocrlf=true` in "system and repo". Measured:
system is `true` and `C:/virality` resolves `true`, but the `dt009-merge` tree's own `.git/config` is
**`false`**. Risk is real in a `C:/virality` worktree, absent in the candidate tree. Use
`-c core.autocrlf=false -c core.eol=lf` regardless.

## 8. The identity sweep — VERIFIED · 167 files, not 133

| Class | Meaning | Files |
|---|---|---|
| A | current executable / machine-read input | 14 |
| B | current test | 4 (5 pins) |
| C | current README / documentation | 64 |
| D | historical report | 80 |
| E | fixture intentionally testing the old identity | 0 standalone; 4 sites inside class-B files |
| F | external / snapshot | 5 |

**167 distinct logical files** (162 staging / 147 in-repo, 142 shared). My independent count corroborates:
**162 files** in the staging roots and **29 executables** — matching the stream exactly.

Prior figures are reconciled, not contradicted — and **two of them were mine and were wrong by two
orders of magnitude**: `HUMAN_ACTIONS.md:34` "roughly six registration documents" and
`OPERATOR_REGISTRATION_SEQUENCE.md:79` "five documents".

**The 587/`640510…` pair appears in 26 files, every one warning against it.** No file treats it as an
instrument to use.

## 9. The two pin lists — PREPARED, nothing applied

**LIST ONE — certification-path pins, for the single final edit session: 16 executables + 3 data
records = 19 files; only 14 need a text change.** Four `instrument.mjs` gateways, both packet
validators and their tests, `blind_record_precheck.mjs`, `bind.mjs`, the two registration JSONs,
`PENDING_PERSONNEL_REGISTER.json`. `test_rating_packet_validator.mjs` needs **no edit** — it
self-corrects and must simply be re-run. `ENUMERATOR_PACKET_VALIDATOR.mjs` is **not a pin at all**:
it performs no aggregate comparison, so rewriting its provenance note would claim a verification that
never happened — reframe as historical.

**LIST TWO — historical rehearsal pins, record as superseded, no edit: 14 executables.**

**Three of List Two are actively unsafe to "fix" — VERIFIED:** `test_derive_frame.mjs`'s `GOLD` holds
the aggregate beside `frame_hash`, `frame_csv_sha256` and `records_in: 246`, all from the old
instrument — changing one member yields an internally inconsistent golden set that **still passes**;
`demo_auditlog.mjs` writes the digest **into** a hash-chained log whose `event_sha256 fa6fb52c…` covers
it; `05_assemble_docs.mjs` states in its own text that the aggregate was not recomputed.

**These guards are working correctly.** Each fails closed against a tree it was never certified
against — that is their purpose, not a defect.

## 10. Sweep findings the earlier passes missed — VERIFIED

1. `test_rating_packet_validator.mjs` has **zero literal occurrences** — it inherits its pin by
   `import` at `:17`. A grep-only sweep misses it, and it is on the certification path.
2. **Two values per pin.** `RATING_PACKET_VALIDATOR.mjs:43` and `test_reference_packet_validator.mjs:56`
   pin `593` as a **file count**; updating only the digest leaves both refusing on `594 !== 593`.
3. `g_calendar.mjs:255-266` re-implements the aggregate recipe and hard-asserts `agg.n === 593` at `:273`.
4. **Four material-release gates are self-defeating as written** — each instructs the releaser to verify
   the tree hashes to `f7699f05…`, a check the frozen tree cannot pass.
5. **Neither instrument tree names its own identity — VERIFIED by me.** All three digests and their
   abbreviations return **zero hits** across `dt009-merge` and `dt002/research/cpg-u1`. Every pin lives
   **outside** the instrument. **Consequence: the whole 30-pin correction does not move the aggregate**
   and can be done independently of the final edit session — though only *after* the final aggregate is
   known, or the paperwork desyncs twice.

**My own addition, correcting the sweep:** the transposed abbreviation `f7699f05…5eb04e5cc5dd` (real
ending `…dbb04e5cc5dd`) is **not** confined to `blind_record_precheck.mjs:8`. It appears in **at least
12 files**, including seven `dt004-operations/people/` role packets — the documents humans read. A human
verifying against it would fail against **both** the old and the new tree.

## 11. VP-2 — ABSENT, not "operational" — VERIFIED

`frameSufficiency()` is `lib/frame.mjs:41-50` entire and reads only `expected_outcome_class` (`:45`).
The string `jurisdiction` does not occur in the file. All eight sub-checks:

| # | Sub-check | Verdict |
|---|---|---|
| 1 | implemented anywhere | **NO** — all 22 tree-wide hits are column declarations, per-row A3/A5 checks, recording fields, or the round-robin |
| 2 | enforced or warns | **NEITHER** — nothing emitted; a one-family frame gives byte-identical output to a four-family one |
| 3 | before the seal | **N/A — never runs**; the only usable slot (`cpg_u1_data.mjs:369`) is unoccupied |
| 4 | numeric minimum | **NONE**; `FAMILY_ORDER.length===4` is a loop domain, not a floor |
| 5 | traceable to Protocol-004 | **NO — operator-added.** `:379` requires round-robin + publication and says *"missing families are declared as a scope limitation"* — it **permits** missing families |
| 6 | testable | **NO** — `test/selftest.mjs:250` would pass with a gate deleted |
| 7 | VOID path | **NO STATE EXISTS** — though absence of a VOID state is not the defect; the missing thing is the refusal |
| 8 | recorded in the artefact | **YES (data), NO (tally)** — `jurisdiction_family` is FRAME_COLUMN 3, inside `frame_hash`, hence on-chain; no command ever computes a family tally |

**The record's "operational, no aggregate cost" is half right.** *No aggregate cost* — **VERIFIED**, but
only because nothing was written. *Operational* — **NOT SUPPORTED**: there is no procedure, no checklist
row, no attestation field. It records an intention.

**Separate live gap — OWNER DECISION REQUIRED:** §5.7.1 clause (b), *"The realised jurisdiction
composition is published"*, is `[NORMATIVE]` and **unimplemented**. Distinct from the nonexistent
minimum, and this one the protocol actually requires. Note that closing the *minimum* would
**contradict** clause (c), so it arguably needs a protocol amendment — moving `protocol_sha256`, also a
`SAMPLING_FIELDS` member. Publishing the tally is the smaller, protocol-*required* option.

**Bonus — VERIFIED:** zero of the 404 mutants mention `jurisdiction`, `FAMILY` or `orderedClass`. So the
round-robin — the one jurisdiction behaviour the protocol does require — **is not mutation-certified
either.** A suite cannot mutate code that does not exist.

## 12. `enumerated_by` — the check fails closed, the pipeline fails open — VERIFIED

**Writers:** the tooling never writes it. Declared `lib/schema.mjs:32` (FRAME_COLUMN 19 of 22), authored
by hand in the CSV template. An unverifiable human claim by construction.

**Validators — stronger than expected:** `lib/enumeration.mjs:45` does **exact roster membership**
against `registeredEnumerators`, not a shape regex. `PERSON = /^[A-Za-z0-9_-]{1,64}$/` is applied to the
register, never to `enumerated_by`. Coverage is good: 11 selftest cases including three positive
controls, CLI end-to-end, and mutants **M424–M430**.

**`personnel.mjs:32` masking — VERIFIED it cannot let a bad value through.** The `continue` masks five
later checks, but line 32 pushes its own error, propagated unconditionally at `lib/enumeration.mjs:35`,
and `cpg_u1_data.mjs:222` fails on any error. Six probe variants all refused. Residual: a register whose
enumerator is *both* non-independent *and* malformed reports only the id error, hiding the
disqualification — diagnostic loss, one-line fix, aggregate-moving.

**The real fail-open — OWNER DECISION REQUIRED.** `checkEnumerationAttribution` has **one** caller
(`cpg_u1_data.mjs:220`, in `cmdFrame`). `loadFrame` has **seven** callers; the other six never resolve
attribution. A blank value is refused everywhere, but a **fabricated/unregistered** one is refused only
if the operator chose to run `frame --personnel`. Structural cause: `cmdFrame` writes **no artefact**
(console-only, no `writeOnce`), so nothing downstream *could* require it. This deviates from the tree's
own pattern twice over — `scan` is mechanically bound, the rater assignment is mechanically bound. The
one link with no artefact is the one §20.18 names as the **sole** basis for frame independence. **No
mutant can detect this: a suite cannot test a call never written.**

**Hash participation vs `SAMPLING_FIELDS` — no contradiction, VERIFIED.** Both facts hold at two ordered,
disjoint layers. `SAMPLING_FIELDS` contains no personnel field **and no `frame_hash`** — it cannot, since
at registration the frame does not yet exist; the frame freezes one layer later at the commitment. A
roster change therefore does not alter `samplingView` (registration stays authoritative, no `study VOID`),
but **does** alter `frame_hash`, so post-commitment re-attribution is **refused** as `FRAME_CHANGED`.
**A refusal is not a void.** "No roster change can void a registration" is literally true.

**Joint-frame taint — VERIFIED, by two mechanisms:** register errors are global, so a §4A.1 violation by
*either* enumerator fails the whole command; and `frame_hash` is indivisible — no per-enumerator subset
hash exists, so excising B's rows breaks the commitment.

**Two residuals — OWNER DECISION REQUIRED:** (a) the free-re-attribution window silently expires at the
development commitment and **no document states the deadline** (documentation-only fix); (b) **the
registration commits to the roster in no way at all** — no register hash, count or fingerprint, unlike
the rater-assignment fingerprint which exists for exactly that purpose. Combined with the fail-open, an
outsider following §21 **cannot confirm the frame was attributed to registered independent enumerators**
— only that their copy hashes to the committed value. Under §20.18 this is the least externally
verifiable link in the chain.

## 13. Contamination carrier — a disclosure duty with no disclosure channel — OWNER DECISION REQUIRED

§5.3 (`CPG_U1_PROTOCOL_004.md:248`) mandates that a late-discovered contamination is *"recorded (company,
basis, date, discoverer) and published"* — four data elements, an unbound verb, **no object**: no
artefact, no schema, no command, and no `[enforced]` tag. Every candidate carrier is excluded by a
closed enumeration or a freeze: the frame row (§5.5 "NO LATER ADDITIONS"), scan and registry ("No changes
apply after registration"), the screening log (write-once, and it has **no `date` or `discoverer`
column** — two of the four mandated fields do not fit), §13.2 and §13.2A (both closed lists, both omit
it).

**Consequences are specified and partly prohibitive; the carrier is genuinely silent.** Exclusion is
PROHIBITED, outcome change PROHIBITED, VOID PROHIBITED by closed enumeration, editing scan/registry/frame
PROHIBITED. Carrier artefact and hash binding: **SILENT**. That distinction matters — silence is a gap
the owner must close; a prohibition would have been an answer.

### The flag is dead in three independent senses — VERIFIED BY ME, stronger than the stream claimed

1. **Always false.** Five links: `lib/select.mjs:93` filters `ineligible` out of the held-out pool →
   `:98` draws only from that pool → `cpg_u1_data.mjs:559` → `:138` sets
   `held_out_ineligible_basis: basis[id] ?? []` → `lib/analysis.mjs:114`, `:159` tests `.length > 0`.
   Since `c.ineligible` is *exactly* the set with a non-empty basis, every surviving entry has `[]`.
2. **Never read.** `grep contamination_disclosed` ⇒ **one** hit, the line that writes it.
3. **The protocol's named flag does not exist in the instrument.** `CONTAMINATION-DISCLOSED` — the literal
   §15.1 string — appears **nowhere** in the 594 files.

Both post-seal channels that *do* exist are non-compliant: `identity_inadmissible` → `INVALID`
(`lib/analysis.mjs:146`), forbidden by §5.3 and §15.1; `protocol_violations` → `INCONCLUSIVE` (`:205`,
`:211`), forbidden by §5.3's *"never changes the §10.5 outcome"*.

Recorded exactly as §6 requires:

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

Options were set out for the owner with costs; **the only one making the disclosure verifiable inside a
hash edits `lib/analysis.mjs:59` and is therefore pre-registration-only.**

## 14. `TOOL_VERSION` — documentary closure, no aggregate cost — VERIFIED

**One canonical label:** *CPG-U1 dataset tooling v6 (`cpg-u1-data-tooling-6`) — aggregate `638d68e6…`,
594 files.*

The four wordings are **three different axes**, not three values of one field: the protocol's "tooling
v4" is the CPG-043 governed *generation* (frozen); `cpg_u1_data.mjs:49` is the *package* identity; the
README's "v4/v5/v6" headings are README *feature generations*.

**Verified by me:** `TOOL_VERSION` is declared once at `cpg_u1_data.mjs:49`, used only as a `tool:` stamp
at five emit sites, and **absent from `PROTOCOL_MARKERS`** (`:321-323`). Nothing compares it, no test
asserts it, its stamps are never read back. Changing it would move the aggregate and **close no gap**.
Decisive: `CPG_U1_PROTOCOL_004.md:25` says the aggregate is bound in the registration record, *"not in
this file"* — the protocol deliberately declines to bind a version string, so the divergence is
**disclosable, not reconcilable**.

## 15. `EVIDENCE_SCHEMA` — freeze `/v1` recommended — OWNER DECISION REQUIRED

**27 schema strings in the candidate, all `/v1`, no `/v2` anywhere.** Decisive finding: **no registered
study artefact carries `EVIDENCE_SCHEMA` at all** — the sampling record (`lib/sampling.mjs:162-204`) has
no `schema` field and no relay data, `drandRelays` being returned *beside* it at `:204`, so
`record_sha256` is byte-identical before and after DR-1. And the breaking direction is already
**enforced, not labelled**: a pre-DR-1 bundle is refused loudly at `:193-194`, naming §19.3. A bump would
replace a fail-closed runtime refusal with a string comparison — cosmetic, which §8 forbids.

**Answer under Option A (freeze, recommended):** *"`cpg-u1-sampling-evidence/v1` as implemented by the
registered aggregate `638d68e6…` — the post-DR-1 shape where every beacon carries a sorted `relays` array
of ≥ 2 distinct names. The string alone does not separate this from the pre-DR-1 `/v1`; the registered
aggregate does, and exactly one aggregate is registered."* Option B (bump) is self-identifying from the
string but moves the aggregate and, if partial, breaks the self-test.

Contamination and frame attribution have **no schema of their own** — bound by `scan_sha256` and
`frame_hash` respectively.

## 16. README — nine corrections PREPARED, none applied

**Two HIGH defects verified by me:**

- **R1** — `README.md:116` claims the analysis decisions are *"all set `UNDECIDED`"*. `rules/analysis_decisions.json`
  reads `"status": "DECIDED — … owner-approved methodological decisions"` with **nine concrete values**.
  (`:110` is *descriptive* and correct; only `:116` is false.)
- **R6** — `verify-evaluation-tree` appears **0 times** in the README though it is a registered command
  (`cpg_u1_data.mjs:1128`) whose domain is a `PROTOCOL_MARKER`. The §7.1/CPG-047 control that stops a
  later mainline state becoming the treatment is **invisible to a package reader**.

R1 has a sharp implication: **the README is inside the aggregate and makes a false claim about another
file inside the same aggregate**, and the mutation suite cannot catch it because documentation is not
executable. **The certification now running will pass with the contradiction intact.**

**Verified NOT defective, so nobody re-audits:** the README states **no aggregate and no file count**
(zero `f7699f05` hits), so the "593-file identity in the README" concern is **unfounded** — that problem
lives in `dt004-operations`. No obsolete command; relay documentation matches `MIN_DRAND_RELAYS = 2`
exactly.

**Two hard constraints recorded:** the README must **never** state its own aggregate (it is inside it),
and the v3–v6 changelog headings stay — R5 annotates, it does not renumber history.

## 17. The registration readiness package — PREPARED · 12 of 16 items entirely real

**12 real and verified · 4 mixed · 0 entirely external.** Every machine-derivable value was **derived
here, not transcribed** — including the provider configuration hash
`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`, re-derived from the two named files
at `f01a7eb4`.

**Tooling identity is labelled CANDIDATE, CERTIFICATION PENDING.** Not final.

**The eleven external leaves, all carrying the literal sentinel. Nothing fabricated.** Five
owner-supplied (`accountable_identity.value`, `persistent_identifier.type`, `persistent_identifier.value`,
`bitcoin_key_custodian.value`, `as_of`) · two OSF-generated (`registration_id`,
`registration_timestamp`) · four Bitcoin-generated (two outpoints, checkpoint height and hash).

Leaves 1, 2, 3, 4 and 6 are **exactly** the five fields DR-12 can suppress and R28 can spoof.

**Exit codes — VERIFIED with two defects:** code **3 (`HALT`) is dead** — declared at `lib/registration.mjs:53`
and referenced nowhere; code **1 conflates "record refused" with "input unreadable"**, which will bite
anyone automating §21 step 2. Also: a record with **both** errors and blockers exits **1, not 4** — exit 4
means "blockers *and no errors*".

**Also found:** `verify-registration` never checks the **evaluation-tree identity** at all; it is only
transitively bound via `protocol_sha256`, and §21 does not tell an outsider to run `verify-evaluation-tree`
separately.

**Environment variables — checked, not assumed:** neither `CPG_U1_TOOLING` nor `CPG_U1_INSTRUMENT` occurs
in the candidate. `REFERENCE_PACKET_VALIDATOR.mjs` uses `CPG_U1_INSTRUMENT` **optionally** — unset, it runs
on inlined constants and cross-checks nothing.

## 18. What is still missing, and what must not be concluded

**BLOCKED on the run:** the 404-mutant certification is in flight. No registration may name `638d68e6…`
until it completes with zero survivors, timeouts and errors **and** two clean rebuilds agree. A run that
stops early is invalid, and partial verdicts were not inspected.

**OWNER DECISION REQUIRED — now seven, not five.** The original five (DR-11, `EVIDENCE_SCHEMA`,
`TOOL_VERSION`, README, DR-12) plus **R28** and **R15**, both new and neither closed by any patch prepared
here. Plus the contamination carrier, the §5.7.1 publication clause, the `enumerated_by` fail-open, and
K-1…K-4 (K-4 still blocks enumerator packet assembly).

**Still external and unmovable:** eleven registration leaves and eight independent people. Preparation is
no longer the constraint; people and decisions are.

**A preservation hazard, acted on.** All six streams' deliverables were **untracked and existed nowhere
else** — `research/deeptech-operations/` returns 0 from `git ls-files` in every worktree, and the
worktrees are disposable. **22 files have been collected to `C:/tmp/dt011-closure/`.** Separately,
`REGISTRATION_READINESS_PACKAGE.md` is **silently git-ignored** by `.gitignore:51 *_READINESS*.md` —
anyone committing this work would lose the central deliverable without warning. (`*_PACKAGE*.md` is not a
pattern; the brief's guess was wrong.) By contrast `research/cpg-u1/` **is** tracked — 588 files — which is
precisely why the 587-file `640510782a…` tree is the trap: it is the only instrument tree git hands you,
it is in every checkout, and nothing in the repo marks it as superseded.

### Three "greens that lie", all found in this one wave

1. the README passes certification while making a false claim about a file in its own aggregate;
2. M77 is killed on every run while the line it anchors carries a live bypass;
3. neither VP-2 nor the protocol-required round-robin is in the mutant population at all.

None is a defect *in* the certification. All three bound what it means. **The honest reading of a
forthcoming 404/404 result is: the executable behaviour that is asserted is asserted correctly. It is
not: the instrument is correct.**

**Nothing in this report makes the candidate registration-ready, and these preparations passing is not
evidence that it is.**

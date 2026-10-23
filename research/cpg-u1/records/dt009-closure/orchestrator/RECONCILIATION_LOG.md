# DEEPTECH-PARALLEL-009 — reconciliation log

VERIFIED = I reproduced it myself. CORRECTED = wrong or overstated. ACCEPTED-AS-ARGUMENT = not independently
re-derived. Nothing registered, committed, pushed, published or broadcast.

## Integrity gate — "before" snapshot, recorded before any edit

`orchestrator/BEFORE_manifest.txt` holds a **per-file** manifest of the frozen instrument (593 lines), computed with
the same recipe as the registered aggregate, so the after-comparison can be exact rather than aggregate-only.

```
files 593  aggregate f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd
```

Protocol `c50fc680…`, treatment `f01a7eb4…` (clean, tree `3b4811fc…`), registry `a1392952…` — all verified by me.

## Merge strategy — and the problem it solves

Three isolated trees avoid *simultaneous* edits but create a merge burden: all three streams were expected to touch
`test/selftest.mjs` and `test/mutate.mjs`, and two of them `cpg_u1_data.mjs`. **A file-copy merge would silently drop a
stream's work.** So `scratchpad/merge_candidate.sh` uses git as the merge engine — base commit = the untouched frozen
instrument, one branch per stream, merged in turn — so a conflict is **reported**, never resolved by overwriting.

Dry-run, real output:

```
base commit 6c1e9f26990bc35be798a82a067026a8f7505ef9
  dr1:  NO CHANGES — stream did not modify the tree
  dr10: tooling/cpg_u1_data.mjs tooling/test/mutate.mjs tooling/test/selftest.mjs
  attr: NO CHANGES — stream did not modify the tree
MERGED  dr10
RESULT: all streams merged cleanly.
```

It correctly distinguishes "no changes yet" from "merged", rather than reporting a vacuous success. `core.autocrlf` is
forced off in the harness, because CRLF corruption has produced a wrong aggregate in this programme before.

## DR-10 stream — tree state verified by me (its own report is still pending)

The stream stopped while waiting on its own background work, so I have **no verification results from it**. What I can
state is filesystem fact, from my own per-file diff:

```
files 593 (none added or removed)   aggregate c6869ff561a3a92271508391467e6fc95cedd67233bda85b5d72505c3d6c51de
changed: cpg_u1_data.mjs · test/mutate.mjs · test/selftest.mjs
development registry unchanged at a1392952…
```

A disciplined three-file change set with no collateral edits. **This is not a verification of the fix** — I have not
seen its selftest, anchors or regression results, and I will not claim them until it reports.

## Registration-package stream — VERIFIED

Preserved to `C:/tmp/dt009-closure/G-registration/` (5 files, hashes match its report).

**Confirmed by me, re-running its checks:**

| Claim | My check |
|---|---|
| The registration record contains **no personnel field at all** | `grep -inE "personnel\|enumerat\|rater" lib/registration.mjs` returns exactly one line — a prose comment about entries "enumerated from the registry". |
| `SAMPLING_FIELDS` has no personnel field, so **no roster change can void a registration** | `['protocol_sha256','tooling_aggregate_sha256','registry_sha256','network','outpoints','checkpoint','parameters']` |
| A provisional placeholder **fails closed, and louder than a blocker** | I set `tooling_aggregate_sha256` to `<<PROVISIONAL: …>>` in a scratch copy: **exit 1**, `ERROR   tooling_aggregate_sha256 must be 64 lowercase hex characters` — an ERROR, not merely a BLOCKED. The on-disk draft was not modified. |

**The sharp corollary I want on the record, which the stream identified:** the form check catches a *placeholder* but a
**plausible wrong 64-hex digest would pass silently**, because `verify-registration` has never compared the aggregate
against a registered value — `registered()` calls the blocker report first, so that comparison is unreachable while any
prerequisite is missing. **The aggregate is therefore the one registration field with no independent guard**, which is
exactly why two clean rebuilds are required before it is quoted anywhere.

**A measurement trap worth keeping:** an unanchored `grep -c 'BLOCKED '` returns 10 because the summary `fail()` line
contains the substring; anchored `^  BLOCKED ` returns the true 9.

### A consistency error it caught in the previous wave's work

DR-7's drafted disposal text contains an "Objects affected: NONE" clause that quotes `f7699f05…` as unchanged. **DR-1
and DR-10 now falsify that clause.** It must be published with the value omitted or updated. Neither document was
edited, so recorded hashes stay valid — the correction is carried in the errata discipline instead.

### ACCEPTED-AS-ARGUMENT

- Field counts re-derived independently and matching mine exactly: **20 top-level keys, 39 leaf paths, 12
  `parameters.*`, 27 non-parameter, 12 UNASSIGNED** in a fresh template, 11 unresolved in the draft, reported as 9
  blocker lines because `outpoints` and `checkpoint` each span two leaves. The grouping arithmetic closes: 15 + 1 + 5 +
  2 + 4 = 27.
- Enumerator B is represented in **three places, none of them the machine record**: the personnel register (a second
  `enumerator` assignment), §19.3(3)'s already-plural "enumerator(s)", and the OSF narrative. **Registration fields
  touched: zero.**
- DR-2 requires no code and changes no hashed object; the supporting note covers all six disclosure points.
- The one-way-window mechanics: `tooling_aggregate_sha256` is bound into the committed payload checked at
  `lib/sampling.mjs:142`, re-checked by `registered()` and by `lib/harness.mjs:44` (`TOOLING_MISMATCH`), and
  `checkAuthority` makes a second registration with different sampling fields a VOID.
- Six existing documents quote the superseded `f7699f05…` and were deliberately left unedited so their recorded hashes
  remain valid, with a correction table instead.

---

## Enumerator A/B personnel stream — VERIFIED, with one conflict that must reach the owner

Preserved to `C:/tmp/dt009-closure/F-enumerators/` (6 files).

### K-4 — A GENUINE CONFLICT between the directive's §4 rule and the frozen protocol. CONFIRMED BY ME.

The directive's knowledge-window exclusion list includes **"contamination findings"**. But:

```
protocol line 226:  ### 5.3 Held-out ineligibility (CPG-C1)     <- §5.3 IS the contamination section
§4A.2 "Enumerators receive only:"
  - public sources;
  - the frame template;
  - §4A, §5.1–§5.4;                                              <- §5.3 EXPRESSLY GRANTED
  - the jurisdiction-family list;
  - the development-only registry.                               <- ALSO EXPRESSLY GRANTED
```

So the exclusion, applied literally, withholds a section and an artefact that §4A.2 **grants** — and §5.3 is exactly
what makes C1(6) answerable at all. Worse, §5.3's own rule is that `unknown` is treated **exactly like** `yes`, so every
attestation the enumerator cannot answer becomes a held-out ineligibility. **Applied literally the exclusion makes
enumeration impossible and would look like diligence while doing it.**

The directive said: "If the exact frozen protocol wording is inconsistent with this rule, DO NOT silently amend it.
Flag the exact conflict for owner decision." **This is that case.** Nothing was amended. The recommended narrower
wording — exclude scan outputs, `scan_sha256`, C1(1)/C1(6) determinations, aggregate ineligible counts and
post-registration late-discovered contamination, but **not §5.3 itself and not the registry** — is a proposal for the
owner, not an adopted change.

Three further §4A.2 findings from the same analysis, which I accept as argument: **K-3** — "operational information
necessary to perform their assigned work" **is** broader than a closed "receive only" list, so it must be read as a
*ceiling* within the five granted items rather than a *grant*; the per-enumerator jurisdiction assignment and the
`candidate_id` prefix are strictly not on the list, and telling A its two families inherently discloses that someone
else holds the other two. **K-1** — "expected eligibility outcomes" collides with §5.2, whose definitions are headed
"the enumerator's **prediction**" and whose `expected_outcome_class` is a required frame column. **K-2** — "current
candidate quality" is resolvable by a per-row versus aggregate distinction, since sufficiency *is* the §5.7.2 threshold.

### VERIFIED by me — the PENDING register refuses, as it must

```
node cpg_u1_data.mjs check-personnel --personnel PENDING_PERSONNEL_REGISTER.json
EXIT=1   errors: 9   "personnel register refused (9 error(s))"
```

The placeholder convention cannot match the frozen `PERSON = /^[A-Za-z0-9_-]{1,64}$/`, so **no tool can read the file as
complete and no human can mistake a token for a name.** Exit 1 (`REFUSED`) rather than 4 (`BLOCKED`) because all seven
role names are present. This is the correct state for a register with no people in it.

### VERIFIED by me — two real instrument limitations

**1. A shared fee agreement passes.** I built a register with the **same** `study_fee_agreement_sha256` in both
enumerator assignments: **0 errors, 0 blockers.** `checkPersonnelRegister` never compares two fee hashes. So the
non-dependence condition is genuinely unmechanised, and only an operator's own hash comparison catches it. That
validates the stream's C-1b ground precisely: a shared instrument both creates economic dependence *and* puts the same
64-hex string in both assignments, disclosing the pairing on the face of the restricted register — with nobody deciding
to leak it.

**2. A malformed `person_id` masks every later check on that assignment.** `lib/personnel.mjs:32` ends with
`continue`, so the declaration, fee and organisation-confirmation checks are never reached for that row. **A register
can be far more incomplete than its error list shows** — which matters when reading a refusal as a to-do list.

### The non-dependence condition is genuinely new

§4A.1 items 1–4 all run *person → developing organisation*; item 6 is relational, not economic. **Two strangers, one
sub-contracting the other, pass §4A.1 and DR-8 entirely.** The directive's requirement that A and B not become
financially or contractually dependent is therefore not implied by anything already recorded, and none of it is
mechanically checkable — `lib/personnel.mjs`'s own header says "It cannot verify that declarations are true." The
conditions are recorded under an unknown root key the instrument ignores, so they cost **no aggregate change**.

### Still unassigned, and now raised by three independent streams

**Who reconciles a cross-partition entity duplicate** — the same legal entity entered with a different identifier *and*
a different domain passes `assertUnique` silently. Not an enumerator (would see the other partition), not the reference
adjudicator (§4A.3), and the operator is not independent (§22 row 31). Open since DR-8 OQ-5.

---

## DR-10 — FULLY VERIFIED BY MY OWN RUNS

| Claim | My own result |
|---|---|
| New aggregate | **`c6869ff561a3a92271508391467e6fc95cedd67233bda85b5d72505c3d6c51de`**, 593 files — computed with `toolingManifest()` before the stream reported |
| Changed paths | exactly 3: `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs` — per-file diff against the BEFORE manifest |
| Full selftest | **1035 passed, 0 failed, exit 0** (1022 baseline + 13 additions), ran to completion |
| Anchors | **394/394 occur exactly once** (389 + 5 new), exit 0 |
| Development registry | unchanged at `a1392952…` |
| Files added or removed | none — 593 before and after |

**The fix strategy is sound and the reasoning is the valuable part.** It chose *scan every occurrence, report each with
full attribution, then refuse*, and rejected the two obvious alternatives for stated reasons: retention would produce an
artefact every consumer rejects anyway **and** push the identical last-value-wins hazard downstream into
`contamination()`; refusing before the scan cannot satisfy requirement 3, because no matched identifier or contamination
reason exists until the scan has run. On a well-formed frame the artefact is **byte-identical** to the old instrument's,
which is the right proof that nothing was broadened.

### A layout gate that changes how I must run the merged candidate — VERIFIED

`test/selftest.mjs:1216` is `const realProtocol = join(HERE, '..', '..', 'CPG_U1_PROTOCOL_004.md');` and `:1217` gates
two assertions on `existsSync(realProtocol)`. So the count is **layout-sensitive**: in `dt002` the protocol sits beside
the tooling and my 1022 baseline included those two; an isolated tree without it silently yields **1020**.

**Consequence for me:** the merged candidate must be run with the protocol two levels above the tooling, or the run
silently loses two assertions and I would report a lower number as if complete. Recorded as a standing instruction.

### DR-11 — the same defect class, elsewhere, unfixed. CONFIRMED BY ME.

`cpg_u1_data.mjs:113`:

```js
const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
```

Identical last-value-wins collapse, but over scan **results** rather than frame rows, inside `contamination()` — which
nine consuming commands use. The stream reproduced a hand-edited artefact in which a flagged company reads back as
`held_out_ineligible_by_scan=false, hits=0, registry=-`, and `check-frame-sufficiency` reported **sufficient, exit 0**,
because `frame_hash` and `registry_sha256` are computed over the frame and the registry, **not** over `results`.

**It correctly did not fix it**, for two reasons I accept: a guard there changes what nine consuming commands accept,
which is the scope expansion requirement 8 forbids; and it requires a **hand-edited artefact**, since the fixed
instrument can no longer emit one — a different threat model from the frame-authoring defect the owner ruled on.
**This is a new owner decision (DR-11), closable in one line, and the window shuts at registration like the others.**

### An honest correction to my own brief

I asked for confirmation that **ten** commands refuse a duplicate frame. `verify-commitment` **never reads `--frame`** —
it goes `registered()` → `--evidence` — so it cannot be induced by a duplicate frame at all. The stream reported the
command as it actually behaves rather than claiming a refusal it does not make. **Nine refusals plus an upstream fence
at `commitment-payload`, not ten.** My earlier reports said ten; that is now corrected.

### Two deliberate omissions it flagged for my decision

`TOOL_VERSION` left at `cpg-u1-data-tooling-6`, and no README row added for the new enforcement. Both are one-line
changes that move the aggregate, and both are registration-time artefacts — so they belong in the merged candidate if
they are wanted at all, decided once rather than twice.

---

## DR-1 — FULLY VERIFIED BY MY OWN RUNS

| Claim | My own result |
|---|---|
| New aggregate | **`24b03c606b78e2a6867edf0294e7db420f6957556ae001ec8ccb1d8e48d7939c`**, 593 files |
| Changed paths | exactly **6**: `README.md`, `cpg_u1_data.mjs`, `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/mutate.mjs`, `test/selftest.mjs` |
| Full selftest | **1050 passed, 0 failed, exit 0**, and **zero occurrences of "skip" in the log** |
| Anchors | **392/392 occur exactly once** |
| Development registry | unchanged at `a1392952…` |
| Files added or removed | none — 593 before and after |

**The requirement-8 proof is the centrepiece, and it reproduces the defect before fixing it:**

```
OLD representation: one-relay 073aa5bb…  two-relay 073aa5bb…  identical: true    <- the defect
NEW representation: one-relay 62def2a4…  two-relay b999df9a…  identical: false
```

Two independent findings worth keeping: it located the **13th beacon site** (old line 1692) that the earlier audit
missed, and it hit the **same 1020-vs-1022 layout gate** DR-10 found. Two streams converging on that gate independently
is strong corroboration that the count is layout-sensitive.

It also justified **392 rather than the audited 391**: it added a third mutant (M418) covering the builder-side dedup
guard, without which requirement 3 would have a guard the mutation harness never disables. That is the right trade.

### Left for the owner, correctly

`EVIDENCE_SCHEMA` was **not** bumped `/v1` → `/v2`, although the builder's input shape is now a breaking change (every
beacon must carry `relay`). The brief said to infer nothing further, so it stopped — and bumping it later is another
aggregate-moving edit, so it belongs in the same sitting as everything else.

---

## MERGE — an integration defect caught by the merge step

The git-based harness merged **`cpg_u1_data.mjs` and `test/selftest.mjs` cleanly** (the streams touched different
regions) and reported a single textual conflict in `test/mutate.mjs`, where each stream appended to the same list.

**But the substantive problem is not textual — it is an ID collision.** Both streams independently claimed
**M416–M418** for entirely different mutants:

| ID | DR-1 | DR-10 |
|---|---|---|
| M416 | beacon accepted without a well-formed named relay | scan state keyed on `candidate_id` (historical collapse restored) |
| M417 | single-relay round accepted by the verifier | duplicate `candidate_id` in a scanned frame not refused |
| M418 | same relay counted twice towards the floor | a pair of occurrences not counted as a duplicate |

**Why this would have passed unnoticed:** anchors are the *code text*, not the IDs, so `392/392` and `394/394` are both
true in isolation and would remain true after a naive merge. What breaks is selection and reporting — `--only M416`
becomes ambiguous, and a mutation report would attribute results to the wrong guard. **Renumbering on merge is
mandatory, not cosmetic.**

This is the concrete justification for the isolated-tree + git-merge approach: a file-copy merge would have dropped one
stream's mutants entirely, and a careless textual resolution would have produced duplicate IDs that still pass every
existing check.

Expected merged anchor count: 389 baseline + 3 (DR-1) + 5 (DR-10) + the enumeration stream's additions.

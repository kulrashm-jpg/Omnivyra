# D-7 — README / current identity: every defect, with file:line

**CLASSIFICATION: PREPARATION / READ-ONLY.** Nothing was edited. **No write under
`C:/tmp/dt009-merge`.** Target inspected read-only: `C:/tmp/dt009-merge/tooling/README.md`.

> ## Every correction in this file MOVES THE AGGREGATE.
> `README.md` is one of the 594 files `lib/aggregate.mjs` walks. One byte changes the aggregate. All
> README work belongs in the **single final in-tree edit session**, after the live 404-mutant run has
> completed, after which the aggregate is recomputed **once** and the paperwork is renumbered to that
> value.

### Two hard constraints, carried forward

1. **The README must never state its own aggregate.** It is inside the aggregate, so any value it printed
   would be self-referentially false the moment it was written. File count and programme provenance are
   safe; the hash is not. Prepared wording therefore uses `<NEW_AGG>` / `<NEW_N>` or omits the hash.
2. **The v3–v6 changelog headings stay.** Annotate beside them; never renumber history.

---

## Defect 1 — `README.md:116` · "all set `UNDECIDED`" is FALSE · **HIGH**

Re-verified this wave, independently:

- `README.md:116` reads, verbatim: `listed there with their permitted options and all set `UNDECIDED`. The file is part of the tooling aggregate, so the values`
- `rules/analysis_decisions.json:4` reads `"status": "DECIDED — the values below are owner-approved methodological decisions, recorded before registration…"`
- all nine `"value"` fields carry a concrete option — lines `:14, :24, :34, :44, :54, :64, :74, :84, :94` = `EXCLUDE_INVALID_CONFLICT_AND_STALE`, `INCONCLUSIVE`, `URL_WITHOUT_FRAGMENT`, `ENTRY_FOR_DECISIVE_IDENTIFIER`, `CALENDAR_MONTHS`, `STATED_REFERENCE_VALUES_ONLY`, `VOID`, `INCONCLUSIVE`, `ANY_UNAVAILABLE_ENTRY`
- `grep -c UNDECIDED rules/analysis_decisions.json` = **1** — the single occurrence is inside the
  `status` sentence describing the refusal rule, not a decision value

**`README.md:110` is descriptive and CORRECT and must not be touched.** It reads
`§13 analyze … BLOCKED (exit 4) while any decision in rules/analysis_decisions.json is UNDECIDED` — a
statement of the rule, true independently of the current values. Only `:116`'s claim about the current
state of the file is false.

As written, `:116` tells a reader that `analyze` is permanently blocked at exit 4. It is not.

**Prepared change:** at `:116`, replace `and all set `UNDECIDED`` with
`, and **all nine (AD-1…AD-9) are DECIDED**: the file's `status` records the owner-approved values, chosen before registration`,
and in the following clause replace `refuses to run until every value is decided` with
`refuses to run while any value is `UNDECIDED`, and with this file it does not refuse`.

## Defect 2 — `verify-evaluation-tree` occurs **0 times** in the README · **HIGH**

Re-verified: `grep -c 'verify-evaluation-tree' README.md` = **0**. It is a registered command
(`cpg_u1_data.mjs:1128`, dispatch entry `'verify-evaluation-tree': cmdVerifyEvaluationTree`) whose domain
`cpg-u1-evaluation-tree/v1` is `PROTOCOL_MARKERS[19]` = `EVALUATION_TREE_DOMAIN` (`cpg_u1_data.mjs:323`),
so `verify-protocol` **refuses a protocol that does not state it**. Its refusals `CONTENT_MISMATCH` and
`INSTRUMENT_IN_TREATMENT` are what stop a later mainline state silently becoming the treatment.

A reader of the registration package therefore cannot find, anywhere in the README, the control that pins
the evaluated resolver. This is the one direction in which the README's command coverage fails: every
command the README lists exists, but a load-bearing command the tooling has is invisible.

**Prepared change:** add one enforcement-table row after `README.md:214`, and one command line after
`:155`, naming `verify-evaluation-tree`, `lib/evaluationTree.mjs`, §7.1 / CPG-047, and both refusal codes.

## Defect 3 — `README.md:1` · "executable end to end" reads as "has been run" · **MEDIUM**

`# CPG U1 dataset tooling — v6 (`cpg-u1-data-tooling-6`: executable end to end, DEEPTECH-PARALLEL-002)`.
True of the code path, false of the study; a reader scanning the title of a registration package takes it
for the latter. The title is also the natural home for the canonical label of `TOOL_VERSION_DECISION.md`
§3 — **without the aggregate** (constraint 1).

## Defect 4 — `README.md:11` · the status line does not use the five named states · **MEDIUM/HIGH**

`Status: **IMPLEMENTED · NOT REGISTERED · NOT FUNDED · NOT EXECUTED · NOT EVIDENCE.**` — "IMPLEMENTED"
does not distinguish REGISTRATION-READY from REGISTERED, and nothing says that every run against this
tree to date is an ENGINEERING REHEARSAL, which is the claim the registration package most needs
unambiguous.

## Defect 5 — `README.md:208` · the package's "v4" heading collides with the protocol's "tooling v4" · **MEDIUM**

`## What the tooling enforces (additions in v4)` — a *feature* generation of this package, colliding with
`CPG_U1_PROTOCOL_004.md:18, :25, :953, :1098` "tooling v4", the *governance* generation. Without one
disambiguating line a reader concludes either that the README contradicts the protocol or that v5/v6 are
ungoverned. **The heading itself stays** (constraint 2); the note goes immediately above it and quotes the
protocol's own "not in this file".

## Defect 6 — `README.md:5–6` · the `governed_by` parenthetical is wrong for `rules/` · **MEDIUM**

`(`rules/` and `templates/` carry a historical `governed_by: candidate-002` label; their content is
unchanged by protocol-003.)` — false for `rules/analysis_decisions.json:3`, which carries
`"governed_by": "CPG_U1_PROTOCOL_004.md"`. Only `rules/development_only_registry.json:3` and
`templates/rules.json:2` carry the candidate-002 label. "unchanged by protocol-003" is also stale
protocol-003-era wording; the governing document is protocol-004.

## Defect 7 — `README.md:278` · unresolvable reference to `CPG041_VERIFICATION_REPORT.md` · **MEDIUM**

The vendored-dependency integrity claim delegates its evidence to a file that exists nowhere in the
candidate package (`C:/tmp/dt009-merge` contains only `CPG_U1_PROTOCOL_004.md` and `tooling/`). An
outsider handed the package cannot resolve it, so the claim is unverifiable as written. The dependency
bytes *are* inside the aggregate, which is registered — the claim should rest on that, with the CPG-041
report named as a repository document explicitly outside the package.

## Defect 8 — `README.md:191` · the DR-1 breaking change and the `/v1` freeze are undocumented · **MEDIUM**

The relay floor itself is documented correctly (`:92–95`, `:138–143`, `:176–191`, matching
`lib/sampling.mjs` `MIN_DRAND_RELAYS = 2` and `lib/evidenceBundle.mjs`). What is missing is that DR-1
**broke the beacon input shape** while `cpg-u1-sampling-evidence/v1` was **deliberately not** advanced to
`/v2`. Without that sentence, a reader holding a pre-DR-1 bundle cannot tell why it is refused.
**Conditional on the owner's Option A/B choice on the evidence schema**; under Option B this becomes a
mechanical `/v1` → `/v2` change at `README.md:92, :176, :187` plus `lib/sampling.mjs` and
`test/selftest.mjs`.

## Defect 9 — provenance of *this* tree is stated nowhere · **MEDIUM**

The README ties features to programme ids (`:89` DEEPTECH-PARALLEL-002, `:66` CPG-044) but never says
what distinguishes this tree from the 593-file predecessor still cited in the registration paperwork —
the first question a reader holding both trees asks. Delta, verified by manifest comparison: one file
added (`lib/enumeration.mjs`, §4A.2 enumeration attribution) and six changed (`README.md`,
`cpg_u1_data.mjs`, `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/mutate.mjs`, `test/selftest.mjs`),
with `rules/analysis_decisions.json` byte-identical in both trees. **State the file count and the
programme ids only — never the aggregate.**

---

## Verified NOT defective — do not re-audit

| Claim | Verification this wave |
|---|---|
| The README states **no aggregate** | `grep -c 'f7699f05\|638d68e6\|640510'` over `README.md` → **0** |
| The README states **no file count** | `grep '593 file\|594 file\|587 file'` → **0** |
| **No identity self-reference anywhere in the candidate tree** | `grep -rIln` for all three digests and all three file-count phrases over all of `C:/tmp/dt009-merge` → **0 files** |
| Same for the superseded tree and the in-repo 587 tree | **0 files** each |
| `README.md:110` | descriptive statement of the exit-4 rule — **correct as written** |

**Consequence, and it is the load-bearing one:** because no instrument tree names any identity, the
167-file correction sweep touches **nothing inside the aggregate**. The sweep does **not** move the
aggregate. Only these nine README corrections do.

## Application order

1. Wait for the live 404-mutant certification run to complete. **Do not write into
   `C:/tmp/dt009-merge` before then.**
2. Apply all nine corrections in **one** edit session (Defect 8 after the owner's Option A/B choice).
3. Recompute the aggregate **once** and re-run certification against the new tree.
4. Only then renumber the correction manifest's CURRENT classes to the final `<NEW_AGG>` / `<NEW_N>` and
   re-attest every "VERIFIED (recomputed…)" claim against the new value. Old attestations must not be
   relabelled.
5. Register.

---

## NINE-FIELD RETURN — D-7

**DECISION.** Nine README defects are confirmed with `file:line`; the two HIGH ones are `README.md:116`
(claims the nine analysis decisions are "all set `UNDECIDED`" when `rules/analysis_decisions.json:4`
reads `status: "DECIDED …"` with nine concrete values at `:14, :24, :34, :44, :54, :64, :74, :84, :94`)
and the total absence of `verify-evaluation-tree` (0 occurrences, against `cpg_u1_data.mjs:1128` and
`PROTOCOL_MARKERS[19]`). `README.md:110` is descriptive, correct, and **not** to be touched. Separately,
**167 files** carry a stale/obsolete identity reference — **14 CURRENT EXECUTABLE, 4 CURRENT TEST (5
pins), 73 CURRENT DOC, 72 HISTORICAL, 0 standalone INTENTIONAL FIXTURE files (4 fixture sites), 4
UNKNOWN** — and **none of them lives inside any instrument tree**, so the sweep does not move the
aggregate. The nine README corrections do.

**RECOMMENDED RULE.** *Correct what is read as current; preserve what records the past; annotate the
boundary.* Concretely: current executables, current tests and current human-readable documentation are
corrected to the post-edit-session `<NEW_AGG>` / `<NEW_N>`; historical reports, transcripts, audit-log
chains and golden sets are left byte-identical; an intentional fixture may keep the old identity only
where its header names the tree, the file count and the reason. Two invariants: **the README never states
its own aggregate**, and **the v3–v6 changelog headings are annotated, never renumbered**. A typographic
error is not a historical fact — the 12 transposed abbreviations are corrected even in historical files,
to the historical digest, marked superseded.

**ALTERNATIVES CONSIDERED.** (1) Global search-and-replace of `f7699f05…` across all 167 files —
**rejected**: it would corrupt a hash-chained audit log (`demo_auditlog.mjs:19`), silently desynchronise a
golden set that still passes (`test_derive_frame.mjs:28`) and convert an honest "not recomputed here"
disclosure into a false verification claim (`05_assemble_docs.mjs:44`, `:328`). (2) "Zero mentions" as the
goal — **rejected**: it rewrites evidence. (3) Leave the README alone until after registration —
**rejected**: `:116` is a false statement inside the registered artefact, and `verify-evaluation-tree` is
a registered control a verifier cannot find. (4) State the aggregate in the README so it is
self-describing — **rejected as impossible**: the README is one of the 594 files. (5) Renumber the
changelog so "v4" means one thing — **rejected**: rewrites history; a note beside the heading achieves the
same. (6) Adopt the directive's "23 executables" and wave-011's classification as given — **rejected**:
both were re-measured; 23 is superseded by **29**, and four files were moved to UNKNOWN.

**SCIENTIFIC / INTEGRITY EFFECT.** Strongly positive. It removes a false statement about the analysis
decisions that tells a reader `analyze` is permanently blocked; it makes a load-bearing
anti-contamination control (`CONTENT_MISMATCH`, `INSTRUMENT_IN_TREATMENT`) visible; and it stops the
registration package instructing humans to verify the instrument against a digest that matches **no** tree
in existence. It does so without altering one byte of historical evidence, one golden value, or one
hash-chained log. The four UNKNOWN files are surfaced as an owner decision rather than resolved by fiat.

**REGISTRATION EFFECT.** Blocking, and the ordering is the substance of it.
`registration_record.DRAFT.json:6` and `registration_fields.TEMPLATE.json:6` carry the superseded
`tooling_aggregate_sha256` — the one field that cannot be repaired after registration — and four
`instrument.mjs` gateways plus `RATING_PACKET_VALIDATOR.mjs:43` (`REGISTERED_TOOLING_FILE_COUNT = 593`)
pin it in code. **Sequence: README session → one recomputation → renumber the 91 CURRENT files →
register.** Renumbering the paperwork before the README session desynchronises it a second time. Every
"VERIFIED (recomputed…)" claim must be **re-attested** against the new value, never relabelled.

**MUTATION EFFECT.** The corrections themselves add no mutant and kill none — none of the 167 files is
inside any instrument tree, and no test asserts `TOOL_VERSION`. But the **README corrections are in-tree**
and therefore move the aggregate, which **invalidates the current certification run as a certification of
the final tree**: the 404-mutant suite must be re-run once against the post-edit tree. This is why no
write may touch `C:/tmp/dt009-merge` until the live run has completed — a write now would both corrupt
that run and waste it.

**PROTOCOL EFFECT.** **NONE.** No protocol change is proposed. The README corrections bring the README
into agreement with a protocol that is already correct; `protocol_sha256 c50fc680…` is unchanged.

**OWNER APPROVAL REQUIRED?** **YES**, on four distinct points, and approval must not be inferred:
(1) authority to open the in-tree README edit session at all, since it moves the registered identity and
forces a re-run of certification; (2) the **Option A/B evidence-schema choice** on which Defect 8's
wording depends (freeze `cpg-u1-sampling-evidence/v1`, or bump to `/v2` and touch `lib/sampling.mjs` and
`test/selftest.mjs` as well); (3) the disposition of the **4 UNKNOWN** files — closed record or live
reproducibility path; (4) the proposed `.gitignore` negation in `GIT_TRACKING_HAZARD.md` §5.
**No owner approval exists for any of these as of this writing.**

**EXACT WORDING TO RECORD.**

> **D-7 — README / CURRENT IDENTITY: PREPARED, NOT APPLIED.** Nine README defects are recorded with
> `file:line`. Two are HIGH: `README.md:116` states that the nine methodological decisions are "all set
> `UNDECIDED`" while `rules/analysis_decisions.json:4` records `status: "DECIDED …"` and all nine values
> are concrete — the README tells a reader that `analyze` is permanently blocked, which is false; and the
> registered command `verify-evaluation-tree` (`cpg_u1_data.mjs:1128`), whose domain
> `cpg-u1-evaluation-tree/v1` is a `PROTOCOL_MARKER`, appears **0 times** in the README, so a verifier
> cannot find the control that pins the evaluated resolver. `README.md:110` is descriptive and correct.
> The README states no aggregate and no file count, and must continue to state no aggregate: it is one of
> the tree's own files. The v3–v6 changelog headings are annotated, never renumbered.
> **167 files** carry a stale or obsolete identity reference — 14 CURRENT EXECUTABLE, 4 CURRENT TEST
> (5 pins, one inherited by `import` with no literal), 73 CURRENT DOC, 72 HISTORICAL, 4 UNKNOWN, and 4
> intentional-fixture sites inside the current tests. **29 executables** carry a literal reference
> (27 `.mjs` + 2 `.sh`); the directive's figure of **23 is superseded** and must not be used for scoping.
> **12 files** — including all seven human role packets — carry the transposed abbreviation
> `f7699f05…5eb04e5cc5dd`, which matches **neither** tree, so a human verifying the instrument from any of
> them would fail against both. **Three files must not be "fixed":** `test_derive_frame.mjs` (the
> aggregate sits inside a `GOLD` object beside `frame_hash` and `records_in: 246` and is not asserted, so
> a partial edit yields an inconsistent golden set that still passes), `demo_auditlog.mjs` (the digest is
> written into a hash-chained log whose `event_sha256 fa6fb52c…` covers it), and `05_assemble_docs.mjs`
> (which states in its own text that the aggregate was not recomputed). **No stale reference lives inside
> any instrument tree** — the candidate (594 files), the superseded tree (593) and the in-repo tree (587)
> each contain zero occurrences of any of the three digests or file counts — so **the 167-file sweep does
> not move the aggregate; only the nine in-tree README corrections do.** All prepared edits use
> `<NEW_AGG>` and `<NEW_N>`; no provisional digest is pasted anywhere. Nothing has been edited, committed
> or applied, and no write was made under `C:/tmp/dt009-merge`.

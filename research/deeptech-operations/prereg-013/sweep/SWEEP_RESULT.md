# §9 — Stale-identity sweep: APPLIED outside the instrument trees, PREPARED in-tree

**Wave:** DEEPTECH-PARALLEL-013, identity-sweep stream. **Base SHA:** `af2fb6e99ce461894bf16f18c2251f75088eba18`.

> ## EVERY FILE THIS PASS TOUCHED NOW CARRIES PLACEHOLDERS AND IS NOT YET CONSISTENT.
> The final aggregate **does not exist**: DR-11 is unresolved (§5 stop fired) and R28/R15/DR-12 are being
> implemented in a new tree. Every applied and every prepared edit therefore writes `<NEW_AGG>` and
> `<NEW_N>`, never a digest. **No provisional value — not `638d68e6…`, not anything else — was written
> anywhere.** A later **substitution pass is required**, in the wave-012 order:
> **in-tree README edit session → one recomputation → substitute `<NEW_AGG>` / `<NEW_N>` → register.**
> Renumbering the paperwork before the README session would desynchronise it a second time. That was the
> single largest risk in this assignment and it is the reason nothing here carries a value.

## 0. Firewalls — confirmation

- **`C:/tmp/dt009-merge` (live 404-mutant run, PID 4092): NOT WRITTEN.** Read-only `grep`, `sed -n`,
  `find` and one `diff` only. The run was not restarted, inspected or interpreted. No mutation suite, no
  selftest, no aggregate recomputation, nothing CPU-heavy was run by this stream.
- **`C:/tmp/dt013-candidate` (another stream's exclusive tree): NOT WRITTEN.** Its `README.md` is still
  `sha256 e70e57d5a211773d6952add18879adba44fae31e97c14c70deeb87eddd958691`, the exact bytes the prepared
  patch was generated against.
- Measured proof: `grep -rIl 'NEW_AGG\|IDENTITY-SWEEP CORRECTION'` over both trees → **0 files**.
- Documentation is written **only** under `research/deeptech-operations/prereg-013/sweep/` in
  `C:/tmp/dt4-corp`. Corrections were applied in place to the `C:/tmp/dt00*` staging files (outside git).

## 1. Re-measured totals — the manifest verified, and one correction to it

`C:/tmp/dt012-decisions/D6-D7/_manifest.tsv` re-read **treating the first line as data** (it has no header):

| Class | Files | Manifest `occ` | Re-measured `occ` |
|---|---|---|---|
| CUR_DOC | **73** | 118 | **122** |
| HISTORICAL | **72** | 174 | 130 in staging **+ 44 in 5 worktree-only files = 174** |
| CUR_EXEC | **14** | 17 | **17** |
| CUR_TEST | **4** | 6 | **6** |
| UNKNOWN | **4** | 6 | **6** |
| **Total** | **167** | **321** | **325** |

- The class tally **73 / 72 / 14 / 4 / 4 = 167 is confirmed exactly.**
- **The occurrence total is 325, not 321.** The manifest undercounts three CUR_DOC files:
  `eight-person/A-protocol/SECTION_4A3_VERIFICATION.md` (1→**3**),
  `eight-person/C-partition-tooling/TOOLING_GAP_AUDIT.md` (2→**3**),
  `prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md` (4→**5**). Corpus membership is unaffected.
- **162 of the 167 have a `C:/tmp/dt00*` staging twin; 5 are worktree-only** and all 5 are HISTORICAL:
  `prereg-010/B-leaves/{OWNER_INPUT_SHEET,VERIFIER_MESSAGING_NOTES,VERIFIER_REHEARSAL}.md` (in
  `C:/tmp/dt4-uncert`) and `prereg-010/F-manifest/{ARTEFACT_MANIFEST,SUPERSEDED_VALUES}.md` (in
  `C:/tmp/dt4-corp`). Their 1+1+1+5+36 = **44** occurrences close the HISTORICAL arithmetic exactly
  (130 + 44 = 174). Being HISTORICAL they need no correction, so nothing is outstanding.
- Extension breakdown, measured: staging **123 md / 27 mjs / 5 json / 4 txt / 2 sh / 1 jsonl = 162**;
  plus the 5 worktree-only `.md` = **128 md** and **167** total. Matches the manifest.

## 2. THE EXECUTABLE COUNT IS **29**. The directive is right and 23 is superseded.

```
grep -rIl 'f7699f05' dt004-operations dt005-orchestration dt006-human-min dt007-eight-person \
     dt008-prereg dt009-closure dt010-rehearsal | grep -cE '\.(mjs|js|sh|ts|cjs|py|ps1)$'
→ 29
```

**29 = 27 `.mjs` + 2 `.sh`**, reproduced independently this wave and consistent with the extension
breakdown above. Split by class, enumerated and verified one by one:
**11 CUR_EXEC** · **4 CUR_TEST** · **10 HISTORICAL** · **4 UNKNOWN**. The remaining 3 CUR_EXEC entries are
`.json` machine-read inputs, which is why CUR_EXEC is 14 files but only 11 executables.

**A 30th executable inherits the pin with no literal hit:**
`prereg-008/E-rating/test/test_rating_packet_validator.mjs` has `grep -c 'f7699f05'` = **0** and takes the
pin through `import { REQUIRED_FILES, loadInstrument, validatePackage } from '../RATING_PACKET_VALIDATOR.mjs';`
at `:17`. It is correctly **not** in the 167 (a literal census) and is now clean because its validator is.

**23, "five", "eight" and "roughly six" are all wrong and none was used for scoping.**

## 3. What was corrected, by class

90 files corrected, 1 deliberately held. Per-file record with changed line numbers:
`CORRECTION_LOG.tsv`. Backups of all 91 pre-edit files were taken before any write.

| Class | Files corrected | Lines changed |
|---|---|---|
| CURRENT EXECUTABLE | **14 / 14** | 18 (+1 follow-up, see below) |
| CURRENT TEST | **4 / 4** | 8 |
| CURRENT DOCUMENTATION | **72 / 73** | 146 |
| **Total** | **90 / 91** | **173** |

Substitutions applied, per file, gated by class — **no global string replacement was run**:

1. the full 64-hex `f7699f05495f…dbb04e5cc5dd` → `<NEW_AGG>`;
2. every ellipsis abbreviation `f7699f05…<suffix>` / `f7699f05...<suffix>` → `<NEW_AGG>`, **which is how
   the transposed `…5eb04e5cc5dd` form is repaired in current files**;
3. the obsolete `593` file count → `<NEW_N>`, **only** on lines that also carry the aggregate or the word
   "file", so no unrelated number was rewritten.

Two deliberate mechanical choices, both to avoid collateral damage:

- **The correction banner is APPENDED at end of file, never inserted at the top.** Inserting would shift
  every line number and silently invalidate the hundreds of `file:line` citations in the wave-010/011/012
  audits. Nothing in any corrected file moved.
- **Placeholders are written as string literals in code** (`= '<NEW_AGG>';`, `= '<NEW_N>';`), so the files
  still parse. `'<NEW_N>'` is a string and never `===` a number, so every count check **fails closed**.
  Verified: `node --check` passes on all 15 corrected `.mjs` and on the 30th; all 3 `.json` still
  `JSON.parse`. **`.json` files received no banner** — comments are not legal JSON — and rely on
  `<NEW_AGG>` being self-evidently not a digest.
- One follow-up edit was needed by hand: `prereg-009/F-enumerators/PENDING_PERSONNEL_REGISTER.json:10`
  held `"instrument_file_count": 593` with no adjacent "file" word boundary, so the gate missed it. Now
  `"<NEW_N>"`; the file still parses.

**The state this leaves the executables in is fail-closed, and that is deliberate.** Every gateway now
refuses **every** tree, including the candidate, until the substitution pass runs. Fail-closed is the
correct posture for a pre-registration instrument gate; fail-open would not be.

## 4. What was deliberately NOT touched, and why

**HISTORICAL — 72 files, byte-identical, not rewritten.** Verified: `0` of the 71 staging-resident
HISTORICAL+UNKNOWN files bears `NEW_AGG`, `NEW_N` or a sweep banner.

The four judgements the directive named were each re-verified and each preserved:

| File | Why it must not be "fixed" — confirmed this wave |
|---|---|
| `human-min/D-frame/prototype/test_derive_frame.mjs` | `GOLD` at `:23–34` holds `instrument_aggregate` at `:28` beside `frame_hash`, `frame_csv_sha256`, `snapshot_sha256`, `predicates_sha256` and `records_in: 246`; the assertions at `:68–73` check all of those **except `instrument_aggregate`**. Editing `:28` alone yields a golden set whose aggregate no longer matches the frame it certifies — **and the suite still passes.** Silent, permanent, inside a golden record. Preserved intact. |
| `eight-person/C-partition-tooling/zero-change-evidence/demo_auditlog.mjs` | `:19` writes the digest **into** an append-only hash-chained log; the emitted `event_sha256 fa6fb52c…` in `enumeration_audit.jsonl` covers that payload and every later link chains from it. Changing the literal breaks the chain from event 1 — the exact property the zero-change evidence exists to demonstrate. Preserved. |
| `human-min/F-statistics/05_assemble_docs.mjs` | `:44` and `:328` state **in the file's own text** that the aggregate was taken from the assignment and "not recomputed here". Substituting a newer digest would convert an honest disclosure into a false verification claim. Preserved. |
| `prereg-008/D-reference/test/test_reference_packet_validator.mjs:57` | `STALE_AGGREGATE = '640510782a08…d8e45b613f'`, used at `:72` and in assertion **E3** at `:529`, with a header at `:34–37` naming both trees and both counts and self-reporting "vacuous here" when the stale tree is absent. The corpus's best-labelled fixture. **Preserved byte-identical** while `:34`, `:35` and `:56` around it were corrected. |

**The 587 / `640510…` trap is preservation, not correction.** 27 files name `640510…` and every one names
it in order to warn against it. The in-repo tree is *still* 587 files (`git ls-files research/cpg-u1` in
`C:/tmp/dt4-corp` = 588 = 587 tooling + protocol), so the trap value remains current and correct. Not one
`640510…` or `587` reference was altered anywhere.

**The wave-011 reversal the directive ordered was honoured — the hazard there is omission, not
substitution.** Both files quote the tool's *own* error message, so they move in lockstep with their
`instrument.mjs` or the negative controls fail:

- `dataset/tools/test_tools.mjs:100` (`'expected aggregate …'`) **and** `:112` (`'… VERIFIED'`) — both moved.
- `people/tools/test_tools.mjs:369` (`'not the registered …'`) **and** `:373`
  (`toolingManifest(TOOLING).aggregate === …`) — both moved.
- `reference/tools/test_tools.mjs:165` is comment-only and its assertion turns on the error code — moved
  anyway, safely.

`ENUMERATOR_PACKET_VALIDATOR.mjs` performs **no aggregate comparison at all** (its three hits at
`:24/:26/:27` are a "baseline this file was written against" comment). It is still corrected, because the
hard requirement is measured over the file, and the appended banner supplies the annotation D-7 asked for.

## 5. MEASURED PROOF: no current executable pins a stale identity

Measured over the **whole current-executable and current-test set** (the 14 CUR_EXEC files + the 4
CUR_TEST files + the 30th that inherits by import), **after** the pass, not asserted:

```
$ grep -lE 'f7699f05|5eb04e5cc5dd|\b593\b' <the 18 current code files>
(no output)
$ grep -nE 'cpg-u1-data-tooling-[0-5]\b|tooling v[0-5]\b' <same>
(no output)
$ grep -nE 'f7699f05|\b593\b' prereg-008/E-rating/test/test_rating_packet_validator.mjs   # the 30th
(no output)
```

**Zero files. Zero occurrences.** No current executable, current test or transitively-pinned test names
`f7699f05…`, the transposed `…5eb04e5cc5dd`, the obsolete 593-file identity, or an obsolete tooling
version. Separately verified as **intact**: the `640510…` / 587 trap warnings, which are still present in
16 of those files.

## 6. Does any stale reference live INSIDE an instrument tree? — **NO**

Re-measured this wave with `grep -rIlE 'f7699f05|638d68e6|640510|59[345] file|587 file|NEW_AGG'`:

| Tree | Files | Matching files |
|---|---|---|
| `C:/tmp/dt009-merge` (candidate package incl. protocol) | 594 in `tooling/` | **0** |
| `C:/tmp/dt002/research/cpg-u1/tooling` (superseded) | 593 | **0** |
| `C:/tmp/dt013-candidate` (the new tree; **595** files and growing) | 595 in `tooling/` | **0** |
| `C:/tmp/dt4-corp/research/cpg-u1` (tracked in-repo trap) | 588 tracked = 588 on disk | **0** |

**No instrument tree names its own identity or any other.** Every pin lives outside the aggregate.
**Therefore this 167-file sweep is aggregate-neutral: it moved nothing inside any tree.** Only the
prepared in-tree README corrections move the aggregate, which is why they are prepared and not applied.

## 7. The in-tree README — PREPARED ONLY

`README_PATCH.diff` in this directory. Applies with
`git -c core.autocrlf=false -c core.eol=lf apply` from `C:/tmp/dt013-candidate/tooling`, verified by
`git apply --check` against the live tree and by reproducing
`sha256 d3401cf8f7c983e77045786e91599fe83d5b0dcfd13ac3f4377523438335487f` in an isolated scratch repo.
**Not applied.** Covers all nine D-7 defects; the two HIGH ones re-verified independently:

- `:116` "all set `UNDECIDED`" is **false** — `rules/analysis_decisions.json:4` reads
  `"status": "DECIDED …"`, all nine values are concrete at `:14 :24 :34 :44 :54 :64 :74 :84 :94`, and
  `grep -c UNDECIDED` over that file = **1** (inside the `status` sentence). **`:110` is descriptive,
  correct, and was NOT touched** — confirmed byte-identical in the patched file.
- `verify-evaluation-tree` occurs **0** times in the README yet is a registered command
  (`cpg_u1_data.mjs:1159` in the candidate tree — the D-7 citation `:1128` is against `dt009-merge`; the
  entry has since moved), with domain `cpg-u1-evaluation-tree/v1` = `EVALUATION_TREE_DOMAIN`
  (`lib/evaluationTree.mjs:16`) inside `PROTOCOL_MARKERS`, and refusals `CONTENT_MISMATCH` /
  `INSTRUMENT_IN_TREATMENT` (`lib/evaluationTree.mjs:74, :78`). Now 2 occurrences.

Both hard constraints measured on the patched file: **no aggregate** (`grep -coE '[0-9a-f]{64}'` = 0, and
no file-count literal either) and **the v3–v6 headings all present and not renumbered** — the v4 note sits
*above* its heading. Two deviations from D-7's prepared wording, stated plainly:

1. the `verify-evaluation-tree` enforcement row is placed at the **end of the v6 table**, not after
   `:214`, because `:214` is inside the *v4* table and the control is a v6 addition;
2. D-7's suggested `tooling-manifest` CLI invocation was dropped — **there is no such dispatch key**; the
   patch names `toolingManifest()` in `lib/aggregate.mjs` instead.

The candidate tree is being edited concurrently (its `cpg_u1_data.mjs` moved by ~53 lines and the tree
grew 594 → 595 files during this wave), so the patch records its base hash and must be `--check`ed
immediately before use.

## 8. Placeholder status — restated, because it is the load-bearing caveat

Every one of the 90 corrected files, and the prepared README patch, carries `<NEW_AGG>` and/or `<NEW_N>`.
**None of them is internally consistent and none may be relied on for registration.** A substitution pass
is still required, and every "VERIFIED (recomputed…)" wording on a corrected line attested the superseded
tree: it is **void pending re-attestation by its original attester** and must not be relabelled. The
appended banner says exactly this in each corrected file.

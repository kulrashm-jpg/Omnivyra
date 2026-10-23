# merge/ — deterministic N-enumerator frame merger (PROPOSAL)

**Classification: PROPOSAL / PROTOTYPE. NOT REGISTERED. NOT PART OF THE FROZEN INSTRUMENT. NO PROTOCOL CHANGE.**
DEEPTECH-PARALLEL-007 · AGENT D · 2026-09-24

Design rationale lives in `../FRAME_IDENTITY_CONTRACT.md`, `../DUPLICATE_AND_RECONCILIATION_RULES.md`
and `../CONFLICT_HANDLING.md`. This file is the operating manual.

## Files

| Path | What it is |
|---|---|
| `merge_frame.mjs` | the merger: library + CLI, one file so that mutation testing covers it whole |
| `fixtures/gen.mjs` | deterministic generator for every fixture; run it to reproduce them byte-for-byte |
| `fixtures/*.csv`, `fixtures/*.json` | **synthetic only** — `SYNTHETIC-` names, `.example` domains (RFC 2606), checksum-valid but invented LEIs |
| `test/merge.test.mjs` | the **integration** suite (125 assertions): runs the real CLI and the FROZEN `cpg_u1_data.mjs` |
| `test/oracle.mjs` | the **mutation oracle**: the same decisions, in-process, in ~3 s |
| `test/mutate.mjs` | mutation harness — 70 mutants, one worker thread each, hard timeout |

## Usage

```
node merge_frame.mjs \
  --instrument <path to research/cpg-u1/tooling> \
  --out <new directory> \
  --submission enum1.csv --submission enum2.csv [--submission ...] \
  [--allocation allocation.json] \
  [--expect digests.json] \
  [--allow-synthetic] [--hazard-note-donor-carried]
```

- `--instrument` is **required**. The merger contains no copy of frozen logic: `parseCsv`, `toCsv`,
  `canonicalJson`, `hashRecords`, `FRAME_COLUMNS`, `checkFrameRow`, `EXCLUSION_REASONS` and
  `toolingManifest` are all imported from the frozen tree, and the tree's recomputed aggregate is
  written into the output manifest. If the instrument is not the registered one, the manifest says so.
- `--out` must **not** exist. Output is write-once, like every frozen output.
- `--allocation` is optional but recommended: it is how overlapping allocations are refused.
  AGENT C owns producing it; this tool only checks it.
- `--expect` is the enumerators' independently published submission digests. It is the **only** sound
  tamper detector — see "Limits" below.
- `--allow-synthetic` mirrors the frozen flag and is required for the synthetic fixtures.
- `--hazard-note-donor-carried` selects the permissive reading of rule R8. The default is conservative.

Outputs, all in `--out`:

| File | Contents |
|---|---|
| `frame.csv` | the merged frame, exactly the 22 frozen columns, rows in `candidate_id` order (the order the frozen hash sorts in) |
| `merge_transcript.json` | canonical JSON: submission digests, contraband scan, allocation check, every duplicate group with the axis that matched it, every field decision with its rule id and the values not written, every conflict, every withdrawal, the derived disposition of every merged row, the invariant counters, and `frame_hash` |
| `conflicts.csv` | one row per judgement conflict, with both enumerators' values verbatim |
| `merge_manifest.json` | merger + ruleset version, recomputed instrument aggregate, `frame_hash`, sha256 of each output |

Exit codes: `0` merged · `1` refused (nothing written) or an invariant violated · `2` usage.

## Guarantees, and the test that proves each

| Guarantee | Test |
|---|---|
| byte-reproducible regardless of input file order | `T1a`–`T1c`: all four outputs byte-identical under reversed argv |
| byte-reproducible regardless of locale, timezone and Unicode form | `T2a`–`T2h`: `tr_TR`/`C`/`de_DE`, three timezones, NFD input, BOM input |
| never silently drops or alters a row | `T3d`–`T3e` row conservation; `T4h` withdrawal recorded; every write carries a rule id |
| a duplicate cannot become two companies | `T3b`, `T3c`, `T3f`–`T3i` |
| a judgement conflict cannot become a resolved row | `T4a`–`T4i`, plus an internal invariant whose counter is asserted (`T3k`) |
| refuses overlapping allocations | `T10` |
| refuses CPG output / pilot results / sizing output / quotas | `T7` (content), `T12a`–`T12d` (no code path can reach them) |
| an id collision is detected | `T5` |
| a tampered submission is detected | `T6c`–`T6g` (digest check); `T6a`–`T6b` record the limit honestly |
| the FROZEN `frame` command accepts the output | `T16a`–`T16d` |
| the merged frame survives the frozen uniqueness and sufficiency gates | `T15a`–`T15d` |
| the ruleset covers all 22 columns and cannot silently fall behind | `T18`, plus a throw in `mergeGroup` |

## Limits, stated

1. **A checksum-invalid identifier is not tamper evidence.** The frozen `checkFrameRow` classes it as
   the *lawful* exclusion `A3_INVALID_IDENTIFIER`, not as a malformed row, so a flipped digit is
   indistinguishable from an honestly recorded unverifiable identifier. Tampering is detectable only
   by comparing submission bytes to a digest published independently by the enumerator (`--expect`).
   `T6a`/`T6b` assert this limitation rather than papering over it.
2. **The contraband scan has a soft tier.** `seed`, `quota`, `fills`, `sizing` and `pilot` are
   ordinary words that also name protocol machinery; they are reported, never grounds for refusal,
   because refusing them would make a legitimately named company un-enumerable. The hard tier
   (technical tokens, plus any 64-hex-digit string) refuses. A determined enumerator paraphrasing a
   quota in prose would defeat the scan; the scan is a safety net, not the barrier. The barrier is
   §4A.2 and the fact that quotas do not exist until after the pilot.
3. **Parent/subsidiary duplicates are not detected.** Ownership is not in the 22 columns and the tool
   makes no network calls. The protocol's instrument for contestable identity is the `identity-hazard`
   class with a mandatory note.
4. **The published exclusion reason names only the earliest failing criterion.** A group with three
   conflicts gets one reason in the §15.3 screening log. The full set is in `conflicts.csv` and the
   transcript, which therefore need to be sealed alongside the frame.
5. **`--allocation` key extraction is a stub interface.** `key_fields` names frame columns whose
   joined values form the allocation key. Whether that is the right key shape is AGENT C's call.

## Reproducing

```
node fixtures/gen.mjs <tooling>          # regenerate every fixture deterministically
node test/merge.test.mjs <tooling>       # 125 integration assertions, ~25 s
node test/oracle.mjs <tooling>           # the same decisions in-process, ~3 s
node test/mutate.mjs <tooling>           # 70 mutants; exits 1 if any survives, ~2 min
node test/mutate.mjs <tooling> --list    # what the 70 mutants are
```

**Why two suites.** The integration suite is the correctness proof: it spawns the real CLI and the
frozen `frame` command, which is the only way to show that the frozen instrument accepts the output.
That shape costs ~20 subprocesses per run, which is the wrong shape for running the same assertions 70
times. `test/oracle.mjs` makes the same decisions in-process against the merger's exported
`mergeAll`, `loadSubmission` and `main`, so a full mutation pass takes about two minutes instead of
about two hours. Each mutant runs in a worker thread with a hard timeout, because a mutated
comparison can turn the union-find loop into an infinite loop; a timeout counts as killed, since the
merger is specified as a pure, terminating function of its inputs.

Latest results: **integration 125/125 passed · oracle all checks passed · mutation 70 mutants,
70 killed, 0 survived.**

Nothing in this directory reads or writes `research/cpg-u1/**` or `C:/tmp/dt002`. The frozen tree is
opened read-only through `--instrument`; the test suite additionally *executes* the frozen
`cpg_u1_data.mjs frame` command against merged output, which writes nothing.

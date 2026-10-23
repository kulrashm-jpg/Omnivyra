# E-scan-sufficiency — AGENT E of DEEPTECH-PARALLEL-007

**Objective.** Verify that the CPG-U1 contamination scan (§5.3 C1(1)–C1(6), §5.4) and the frame
sufficiency check (§5.7.2) still work correctly, and still mean the same thing, when the frame is
produced by **two enumerators** rather than one. Methodology and verification only, with synthetic
fixtures. **No frozen byte was changed.**

## The three findings, in one line each

1. **The scan composes.** C1(1) and C1(6) are pure per-row functions; 218/218 per-candidate results
   were byte-identical between per-partition runs and the merged run. But the scan *artefact* is
   frame-bound, so the **binding** scan must be run once on the merged frame. →
   `SCAN_COMPOSITION_ANALYSIS.md`
2. **Sufficiency does not compose as a predicate, only as counts.** Both realistic jurisdiction
   partitions failed all three thresholds alone (68/29/18 and 58/24/16) while their union passed
   (126/53/34). Counts are exactly additive; per-partition sufficiency is meaningless. →
   `SUFFICIENCY_COMPOSITION.md`
3. **The §4A.2 barrier is not a blocker, and it pre-exists at one enumerator.** It forbids
   class-directed coordination, not coordination. "We need more abstention-expected rows in your
   partition" **is** a quota disclosure and is forbidden. The two-enumerator model adds exactly one
   new leak channel — an *asymmetric* continue-instruction reveals which partition is short — which
   symmetric asking closes. →
   `INFORMATION_BARRIER_ANALYSIS.md`

Plus, on the contamination claim: **two enumerators leave it unchanged.** The mechanical half
(C1(1), C1(6)) never consults an enumerator; the attested half (C1(2)–C1(5)) is close to vacuous at
any *n*, because §4A.2(b) requires an enumerator who cannot know the answers while §5.3 makes
`unknown` fatal. What does get worse is the worst case: §4A.1 makes either enumerator's false
declaration taint the **whole** frame. → `SCAN_COMPOSITION_ANALYSIS.md` §7

## Baseline, verified by this agent

| Artefact | Identity |
|---|---|
| Protocol-004 | `research/cpg-u1/CPG_U1_PROTOCOL_004.md` sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **matches** |
| Instrument | `C:/tmp/dt002/research/cpg-u1/tooling`, **593 files**, aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` — **matches**, recomputed with the instrument's own `lib/aggregate.mjs` |
| Worktree copy (NOT used) | `C:/tmp/dt5-u4/research/cpg-u1/tooling` is a **different, older tree**: 587 files, aggregate `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`, missing the six B1–B6 files |
| Frozen derived constants | 4096 pilot outcomes, 1 HALT, 0 refusals; `Qmax` 60/25/15; `FRAME_MINIMUM` 126/52/32, total 210 — reproduces §5.7.2 item 9 |

Every run used a **byte-identical scratch copy** of the 593-file tree. Nothing was written to
`C:/tmp/dt002` or to `research/cpg-u1/**`.

## Reproducing

```sh
# INSTRUMENT must be a byte-identical copy of C:/tmp/dt002/research/cpg-u1/tooling (593 files).
cp -r C:/tmp/dt002/research/cpg-u1/tooling <scratch>/tooling
rm -rf out && mkdir out
INSTRUMENT=<scratch>/tooling SYNTHREPO=<scratch>/synthrepo bash RUN.sh > out/TRANSCRIPT.txt 2>&1
```

`RUN.sh` is fully deterministic: the synthetic resolver tree is committed with fixed author and
committer dates, so its SHA is always `3cf5f4f67355484f7088a2ff2bf1e52886cd32cf`. Scan outputs are
write-once, so `out/` must be empty before a run.

## Contents

| File | Purpose |
|---|---|
| `SCAN_COMPOSITION_ANALYSIS.md` | deliverable 1 — scan characterisation, composition proof, defects, and §7 on the contamination claim |
| `SUFFICIENCY_COMPOSITION.md` | deliverable 2 — sufficiency composition with real command output |
| `INFORMATION_BARRIER_ANALYSIS.md` | deliverable 3 — the §4A.2 coordination problem and the verdict |
| `RUN.sh` | every check, in order |
| `make_fixtures.mjs` | builds ten synthetic frames using the instrument's own `FRAME_COLUMNS`/`toCsv` and checksum-valid synthetic CIK/SIREN/CNPJ/LEI |
| `make_repo_and_registry.mjs` | builds the synthetic resolver tree and the synthetic development-only registry |
| `compose_check.mjs` | byte-exact per-row scan composition comparison |
| `sufficiency_additivity.mjs` | calls the frozen `frameSufficiency` on partitions and unions |
| `dup_id_probe.mjs` | shows `scan` silently collapsing a duplicate `candidate_id` |
| `fixtures/` | ten synthetic frames + the synthetic registry |
| `out/TRANSCRIPT.txt` | the single source for every number quoted in the three documents |
| `out/scan_*.json` | the real scan reports |
| `SHA256SUMS` | hashes of everything in this directory |

## Synthetic-data guarantee

Every company name in every fixture begins `SYNTHETIC-CO-`; every domain ends `.example`; every
identifier is a checksum-valid synthetic value built by the same constructions the frozen self-test
uses. The registry used in the runs is `fixtures/SYNTHETIC_registry.json`, a two-entry synthetic
file — **not** the frozen `rules/development_only_registry.json`. The resolver tree is a four-file
synthetic repository. **No real company, no network, no real frame, no enumeration, no CPG
execution.**

## Open owner questions

OQ-1 … OQ-6 are listed in `INFORMATION_BARRIER_ANALYSIS.md` §8. The two that block the
eight-person model are **OQ-5** (who performs cross-partition entity reconciliation, since
`assertUnique` cannot catch the same entity recorded under a different identifier *and* a different
domain by two enumerators) and **OQ-6** (whether `cmdScan` should refuse duplicate `candidate_id`s —
which must be decided **before** registration, since §19.1 freezes the tooling aggregate there).

**DISPOSABLE.** Nothing here is committed, registered or executed. The scratch instrument copy and
the synthetic repository are throwaway.

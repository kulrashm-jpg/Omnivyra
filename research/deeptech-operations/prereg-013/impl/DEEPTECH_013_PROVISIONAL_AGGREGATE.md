# DEEPTECH-PARALLEL-013 — PROVISIONAL tooling aggregate

## PROVISIONAL — PENDING DR-11. THIS IS NOT A FINAL AGGREGATE.

DR-11 has no owner ruling (§5's stop condition fired), so this tree is incomplete by construction.
Mutant IDs **M468–M471** are reserved, empty, for the DR-11 one-line fix. When DR-11 is ruled on and
implemented, the aggregate below **will change** and must be re-derived. Nothing in this stream may be
registered, published or treated as final.

## Provisional aggregate

| item | value |
| --- | --- |
| **provisional aggregate** | `b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` |
| file count | **595** (was 594; `lib/identity.mjs` added) |
| derivation | `lib/aggregate.mjs` `toolingManifest()` — the CPG-037A / §19.1 / §24 definition |
| rebuilds | derived **twice**, clean, from the same tree |
| rebuilds agree | **YES** — byte-identical value both times |
| status | **PROVISIONAL — PENDING DR-11** |

The aggregate was never computed with `xargs sha256sum | sha256sum`; that construction yields a
different, wrong value.

## Predecessor tree, re-verified after all edits

| item | value |
| --- | --- |
| `C:/tmp/dt009-merge/tooling` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` over **594** files |

This is the value the source tree had before any work began, re-derived **after** every edit. It is
unchanged, which is positive evidence that **nothing was written under `C:/tmp/dt009-merge`** while
the 404-mutant run (PID 4092) was live.

## Changed paths — the complete set

Computed by diffing the two manifests path by path:

| change | path |
| --- | --- |
| ADDED | `lib/identity.mjs` |
| MODIFIED | `lib/registration.mjs` |
| MODIFIED | `lib/harness.mjs` |
| MODIFIED | `cpg_u1_data.mjs` |
| MODIFIED | `test/mutate.mjs` |
| MODIFIED | `test/selftest.mjs` |

Six paths. Nothing else in the 595-file tree differs.

**Not modified**, as directed: `CPG_U1_PROTOCOL_004.md` (the protocol), the treatment, the evaluation
tree, `rules/development_only_registry.json`.

## Verification results

| check | result |
| --- | --- |
| pre-edit aggregate of the copy | `638d68e6…` over 594 files — **matched** |
| `node test/mutate.mjs --anchors` (first run, post-edit) | `anchors: 440/441`, **exit 1** — M77's anchor was 0x, exactly as predicted |
| M77 anchor repaired (same `to`-string, same ID) | — |
| `node test/mutate.mjs --anchors` (final) | `anchors: 441/441 occur exactly once`, **exit 0** |
| `node test/selftest.mjs` (one full run) | **1147 passed, 0 failed, exit 0**, no section skipped |
| `verify-protocol` against the real protocol | exit 0; `PROTOCOL_MARKERS` satisfied, `'UNASSIGNED'` literal retained |
| aggregate rebuild ×2 | agree |
| raw control / zero-width bytes in changed sources | **none** (`grep -laP`) |

No diagnostic was appended to any verification command; each owned its own exit status.

## Rebuild input

The selftest requires `CPG_U1_RESOLVER_CLONE` — a clean clone at
`f01a7eb4199be4e04d4fee7fc0116303949dc553`.

A fresh detached worktree was created for this at `C:/tmp/dt013-resolver`: 11552 tracked files, clean,
`verifyEvaluationTree` → **ok, 0 refusals, 0 notes**, content manifest aggregate
`ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` — matching §7.1 exactly.

The pre-existing clone `C:/tmp/cpg041_resolver_jest` is at the same commit and clean, but carries a
**stray untracked `.env.test`**. The harness correctly refuses such a clone
(`RESOLVER_ENV_FILES`), which cascaded into 16 failures on the first selftest run. `.env.test` is
gitignored there and is **not** tracked at the pinned commit (only `.env.beta.example` and
`.env.cert.example` are, and both are excluded by the harness's `.example` filter). This is a property
of that clone, not of the tooling, and the fresh worktree does not have it.

## Independently re-derived provider configuration hash

`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`

Re-derived, not transcribed, three independent ways, all agreeing:

1. `git show f01a7eb4…:<path>` for each of the two §13.1 files out of `C:/virality`, hashed with the
   instrument's own `providerConfigurationSha()`;
2. `C:/tmp/cpg041_resolver_jest`;
3. `C:/tmp/dt013-resolver`.

The commit was obtained by parsing §7.1 out of the protocol (whose `protocol_sha256` is registered and
compared), not assumed.

## Disposable

Everything this stream created is disposable and outside any repository history:

- `C:/tmp/dt013-candidate/` — the candidate tree. Nothing was committed, pushed, merged or registered.
- `C:/tmp/dt013-resolver/` — the rebuild-input worktree. Remove with
  `git -C C:/virality worktree remove --force C:/tmp/dt013-resolver`. Keep it if the mutation run for
  this candidate is to be executed later; it is the required `CPG_U1_RESOLVER_CLONE`.
- These documents in `C:/tmp/dt4-reg` — uncommitted.

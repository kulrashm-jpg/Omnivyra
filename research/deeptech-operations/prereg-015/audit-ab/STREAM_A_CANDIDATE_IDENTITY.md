# CERT-015 STREAM A — CANDIDATE IDENTITY AUDIT (read-only)

Audited 2026-09-25 while the K=1 mutation certification was executing.
Nothing in this stream wrote, moved, deleted or executed anything inside
`C:/tmp/dt013-candidate/`, `C:/tmp/dt015-mutrun/`, `C:/tmp/dt013-resolver`,
`C:/tmp/dt015-adapter` or `C:/tmp/dt4-legal`. No selftest, no mutation suite,
no `--anchors`.

## A1 — frozen certification inputs, measured

| item | expected | measured | status |
|---|---|---|---|
| candidate aggregate | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | `7410ec6ca30de2761739c725bcc922fb0654c62405e18af32c5e95b89df752c6` | VERIFIED |
| file population | 595 | 595 | VERIFIED |
| protocol SHA | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | same, over `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md` | VERIFIED |
| treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | `git -C C:/tmp/dt013-resolver rev-parse HEAD` → same; adapter clone `C:/tmp/dt015-adapter` → same | VERIFIED |
| evaluation tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | `rev-parse HEAD^{tree}` → same | VERIFIED |
| treatment aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files) | same, 11552 files | VERIFIED |
| registry SHA | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | same, over `tooling/rules/development_only_registry.json` | VERIFIED |
| provider configuration | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | same, from both `dt013-resolver` and `dt015-adapter` | VERIFIED |

### Derivation methods (all the tree's own code)

- Candidate aggregate: `lib/aggregate.mjs` `toolingManifest()` of the candidate tree itself,
  invoked once against `C:/tmp/dt013-candidate/tooling`. `xargs sha256sum | sha256sum` was
  **not** used anywhere.
- Treatment aggregate: `lib/evaluationTree.mjs` `treeManifest()` (`git ls-files` + per-path
  sha256 + sorted manifest). `repoIdentity()` was deliberately **not** called, because it runs
  `git status --porcelain`, which can refresh the resolver clone's index — a write. `rev-parse`
  is read-only, so commit and tree ids were taken with `rev-parse` alone.
- Provider configuration: `lib/harness.mjs` `providerConfigurationSha(cloneDir)` (2 file reads).
- Registry and protocol: plain `sha256sum` of single files (the definitions are a single-file
  sha256, so this is the stated definition, not the forbidden two-stage pipe).
- `test/mutate.mjs` sha256 = `9c9bf533ed1721c027b0e768c9b25ede6037045547ffec0b88d6b3bab640fbc6`,
  byte-identical to `mutate_source.sha256` recorded in the frozen manifest. VERIFIED.

## A2 — worker clone aggregates (read-only)

| clone | aggregate | files | status |
|---|---|---|---|
| `C:/tmp/dt015-mutrun/w0/clone` | `7410ec6c…f752c6` | 595 | VERIFIED |
| `C:/tmp/dt015-mutrun/w1/clone` | `7410ec6c…f752c6` | 595 | VERIFIED |
| `C:/tmp/dt015-mutrun/w2/clone` | `7410ec6c…f752c6` | 595 | VERIFIED |
| `C:/tmp/dt015-mutrun/baseline/clone` | attested `7410ec6c…f752c6`, 595 (BASELINE_ATTESTATION.json) | 595 | OBSERVATION ONLY (not re-derived; attestation read only) |

All three worker clones are byte-identical in content to the candidate. Each mutant runs in a
`mkdtemp` copy under the worker's own TEMP, so the clones themselves stay unmutated — consistent
with what was measured.

## A3 — the authorised-change boundary

Claimed boundary: the candidate was produced from a 595-file predecessor with tooling aggregate
`b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` by one approved batch touching
exactly six files: `cpg_u1_data.mjs`, `lib/registration.mjs`, `lib/identity.mjs`, `README.md`,
`test/mutate.mjs`, `test/selftest.mjs`.

### Status: ATTESTED, NOT DIFFED

**No predecessor tree at `b9250356…` exists on disk.** Every tooling tree found was hashed with
`toolingManifest()`:

| tree | aggregate | files |
|---|---|---|
| `C:/tmp/dt009-merge/tooling` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` | 594 |
| `C:/tmp/dt002/research/cpg-u1/tooling` | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | 593 |

Both are earlier design states (`638d68e6…` is one of the two aggregates the manifest's own
`superseded_evidence_firewall` declares VOID). `dt013-final`, `dt014-final` and `dt015-final`
hold orchestration material, not tooling trees. So a byte-level diff against `b9250356…` is
**impossible with what is on disk**. Two independent indirect checks were run instead.

### Check 1 — anchor-stability probe against the predecessor's own manifest

The 441-entry manifest at `C:/tmp/dt014-final/phase4/FINAL_MUTATION_MANIFEST.json` binds
`candidate_aggregate = b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` — i.e.
it is the predecessor's own frozen record — and carries, per mutant, the sha256 of the exact
anchor text and replacement text as they appeared **in the predecessor**. Comparing those to the
458-entry manifest:

- 441 shared ids, spanning **30 distinct target files**.
- anchor or replacement sha256 changed for exactly **2** ids: `M444` (`lib/identity.mjs`) and
  `M457` (`lib/registration.mjs`).
- Both changed files are inside the authorised six. **No file outside the approved set shows a
  changed anchor.**

### Check 2 — mtime partition inside the candidate tree

| | |
|---|---|
| approved-set files present | 6 of 6 |
| newest non-approved file | `lib/harness.mjs`, 2026-09-24T23:24:27.931Z |
| oldest approved file | `cpg_u1_data.mjs`, 2026-09-25T04:13:16.048Z |
| non-approved files at or newer than the oldest approved file | **NONE** |

The six approved files are the six newest files in the tree, in a contiguous block
04:13:16Z–04:30:22Z, separated from every other file by ~4h49m. The partition is exactly the
approved set, with no leakage.

### What these checks prove

- The anchored source regions that 441 mutants target are **byte-identical** to the predecessor
  in 28 of 30 target files, and differ only in `lib/identity.mjs` and `lib/registration.mjs`.
  That is cryptographic evidence (sha256 of the anchor bytes), independent of any narrative.
- No file outside the approved six was modified in a way that moves any mutation anchor.
- Filesystem metadata is consistent with a single approved batch confined to the six files.

### What these checks CANNOT prove

- **They are not a diff.** Without the `b9250356…` tree, no statement of the form "these 589
  files are byte-identical" can be made. The boundary remains **attested**.
- The anchor probe covers only the specific anchored substrings in 30 files. It says nothing
  about the rest of those 30 files, and nothing at all about the other **565** files
  (`node_modules/`, `test/fixtures/`, `rules/`, `templates/`, `harness/`, remaining `lib/`).
  A change elsewhere in a covered file, or anywhere in an uncovered file, is invisible to it.
- mtimes are metadata. They are freely settable and survive no adversarial model; they
  corroborate, they do not attest.
- Both checks are **self-referential** in one respect: the predecessor's aggregate
  `b9250356…` is known to this audit only from records written by the same programme
  (the 441-entry manifest and the superseded-evidence firewall). Nothing here independently
  establishes that `b9250356…` was ever the state of a real tree.

The candidate's **own** identity is not attested but measured: `7410ec6c…f752c6` over 595 files,
and everything the live run consumes (three worker clones, the frozen manifest's bound aggregate,
the merge refusal record) carries that same value.

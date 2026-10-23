# DEEPTECH-PARALLEL-014 · PHASE 2 · TARGETED VERIFICATION

Smallest sufficient targeted verification for the six changed files, with real output and real exit codes
quoted, and a dependency-closure proof for every suite deliberately omitted.

No mutation suite was started. Nothing under `C:/tmp/dt013-candidate/` was written.
`grep` exit status is used nowhere as a test result; every command below owns its own exit status and no
diagnostic is appended to a verification command.

---

## A. Tests RUN

### A0. Aggregate and protocol re-derivation (own exit status)

```
$ node -e "import('./lib/aggregate.mjs').then(m => { const r = m.toolingManifest('.'); ... })"
files=595
aggregate=b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67

$ sha256sum CPG_U1_PROTOCOL_004.md
c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719 *CPG_U1_PROTOCOL_004.md
```

Both match the values supplied to this stream. Resolver clone: HEAD
`f01a7eb4199be4e04d4fee7fc0116303949dc553`, `git status --porcelain` produced 0 lines, `git ls-files` 11552.

### A1. `node test/mutate.mjs --anchors` — RUN

```
anchors: 441/441 occur exactly once
EXIT=0
```

This is the only permitted `mutate.mjs` invocation; it exits after anchor counting and runs no mutant
(`if (anchorsOnly || failedAnchors) process.exit(failedAnchors ? 1 : 0);`). It is the correct and sufficient
verification for `test/mutate.mjs` (class E), because the only thing that file can be wrong about is its
population: an anchor that matches zero or two places, a duplicate id, a lost retired gap, or an accidentally
populated reserved block. Independent parse of the file confirmed: 441 entries, ids M1–M467, 26 gaps exactly
`M23,M24,M25,M26,M225,M244,M280..M299`, no duplicate ids, 404 entries at id ≤ M430, **0 entries in
M468–M471**.

### A2. `node test/selftest.mjs` — RUN ONCE, in full

First attempt, with no clone in the environment, exited **2** on its own precondition and ran nothing:

```
SELFTEST_EXIT=2
SELFTEST PRECONDITION FAILED: CPG_U1_RESOLVER_CLONE is not set. Set it to a clean git clone of the
resolver repository at commit f01a7eb4199be4e04d4fee7fc0116303949dc553 (git is required).
```

Re-run with `CPG_U1_RESOLVER_CLONE=C:/tmp/dt013-resolver`:

```
rebuild input: CPG_U1_RESOLVER_CLONE=C:/tmp/dt013-resolver @ f01a7eb4199be4e04d4fee7fc0116303949dc553 (clean)
evaluation tree: declared commit f01a7eb4199be4e04d4fee7fc0116303949dc553, tree 3b4811fc88e9fbb64ee42c37c4aacca2e76c67af,
  aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5 (11552 files) — verified against C:/tmp/dt013-resolver
detector: scanned TEST=1797 CPG_IMPLEMENTATION=116 files at f01a7eb4199be4e04d4fee7fc0116303949dc553 |
  held-out-ineligible by scan/registry: 4 of 5 | ... | scan_sha256: 7e711d2b81e04d62278caa1a8c03f1e6e2a6c3c0692f87038d64a94a1b8efd50

selftest: 1147 passed, 0 failed
SELFTEST_EXIT=0
```

Result line parsed explicitly: **1147 passed, 0 failed**, exit **0**. This is the only oracle that can kill
any of M431–M467, so running it in full once is both necessary and sufficient for the four production
changes and for `test/selftest.mjs` itself.

### A3. `verify-protocol` — RUN

```
$ node cpg_u1_data.mjs verify-protocol --protocol <candidate protocol> --registration <synthetic reg>
protocol states every pinned parameter; protocol_sha256: c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
VERIFY_PROTOCOL_EXIT=0
```

### A4. `verify-evaluation-tree` — RUN

```
$ node cpg_u1_data.mjs verify-evaluation-tree --repo C:/tmp/dt013-resolver --protocol <candidate protocol>
declared (§7.1): commit f01a7eb4... tree 3b4811fc... aggregate ffe4f603... (11552 files)
clone:           commit f01a7eb4... tree 3b4811fc... aggregate ffe4f603... (11552 files)
evaluation tree verified: the clone IS the declared U1 treatment content (instrument excluded, content authoritative)
VERIFY_EVAL_TREE_EXIT=0
```

This matters for R15 specifically: `checkProviderConfiguration` derives its independent value through
`declaredIdentity(protocolText)` then `verifyEvaluationTree({repoDir, protocolText})`, so this run proves the
derivation chain's pin resolves against the real clone rather than only against the selftest's synthetic
stub repository.

### A5. Registration verifier (`verify-registration`) — RUN, four real cases

All inputs were SYNTHETIC records built in this stream's scratchpad from
`registrationTemplate()` with the real protocol sha, the real tooling aggregate and the real registry sha,
so `registered()` reaches its provider-configuration gate. The independently derived provider hash is
`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`.

| case | input | exit | verdict line |
|---|---|---|---|
| A | correct provider hash, real clone | **0** | `provider_configuration_sha256: ACCEPTABLE (PROVIDER_CONFIG_VERIFIED)` |
| B | **stale** well-formed hash, `--resolver-clone` given but the path does not exist | **0** | `provider_configuration_sha256: NOT_COMPARED (PROVIDER_CONFIG_NOT_COMPARED)` |
| C | **stale** well-formed hash, real clone | **1** | `ERROR: PROVIDER_CONFIG_REFUSED: registered provider_configuration_sha256 f2af85d7… is not the value derived from the §7.1 evaluation tree (c9a7e9aa…) — the registered configuration is wrong or stale` |
| D1 | `checkpoint.hash = "UNASSIGNED"` | **4** | `BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)` |
| D2 | `checkpoint.hash = " UNASSIGNED "` | **1** | `ERROR   checkpoint must be {height: integer, hash: 64 hex}` |

Case C confirms R15 blocks a stale value. Cases B, D1 and D2 are findings — see REGRESSION_FINDINGS.md
**F1** and **F3**.

This single command is sufficient coverage for the other five sampling commands as well, because
`registered(o)` is one shared function and the provider gate and `checkRegistration` call live inside it.
Its six call sites are `cpg_u1_data.mjs:388` (verify-registration), `415`, `451`, `487`, `577`, `1146`; only
line 388 additionally destructures `identity` and `provider`, and every `fail()` in the gate happens inside
`registered()` before any of those commands sees a return value.

### A6. Direct probes of the changed predicates — RUN

Four probe scripts, written to and run from this stream's scratchpad, importing the candidate modules
read-only over `file:///` URLs. Their full findings are in REGRESSION_FINDINGS.md.

| probe | what it establishes | exit |
|---|---|---|
| `p1_fields.mjs` | of the twelve registration fields the template leaves UNASSIGNED, exactly **ten** are DR-12 normalised and **two** (`checkpoint.height`, `checkpoint.hash`) are not | 0 |
| `p2_screens.mjs` | **17 of 32** legitimate-candidate values are refused by the new local screens | 0 |
| `p3_mk.mjs` + the case matrix in A5 | the R15 derivation and the `existsSync` downgrade | 0 |
| `p4_pipe.mjs` | the pre-R28 `registration_id` pipe guard suppresses the R28 classification of that leaf; `phase: 'funding'` returns no `identity` key | 0 |

---

## B. Tests OMITTED, each with its dependency-closure reason

### B1. The full mutation suite — 441 mutants

**Not a closure omission.** Explicitly prohibited by this phase's brief: the obsolete run (PID 4092) was
terminated and the final certification run is a later gated phase. Nothing here substitutes for it; the
anchor pass (A1) establishes only that the population is well-formed, never that any mutant is killed.
Consequence recorded as a risk: the kill status of M431–M467, and any deadness of M77 / M81, remains
**unverified by execution** in this phase. My analysis of it below is static.

### B2. `node test/adapter_conformance.mjs`

Two independent proofs, either sufficient.

**Closure proof — no path exists from any changed file to any assertion in this suite.**
`test/adapter_conformance.mjs` imports exactly `lib/archive.mjs`, `lib/cpgExecutor.mjs`,
`lib/raterPackets.mjs` and `harness/cpgAdapter.ts`. Their own local imports, by grep:

```
lib/archive.mjs      -> lib/canonical.mjs
lib/cpgExecutor.mjs  -> lib/canonical.mjs
lib/raterPackets.mjs -> lib/canonical.mjs, lib/schema.mjs, lib/raterOrder.mjs, lib/packets.mjs, lib/archive.mjs
lib/schema.mjs       -> lib/identifiers.mjs
lib/packets.mjs      -> lib/canonical.mjs, lib/schema.mjs, lib/raterOrder.mjs
lib/raterOrder.mjs   -> lib/canonical.mjs, lib/schema.mjs
lib/canonical.mjs    -> (no local imports)
harness/cpgAdapter.ts-> node builtins only
```

The transitive closure is `{archive, cpgExecutor, raterPackets, canonical, schema, raterOrder, packets,
identifiers}`. **None** of them imports `lib/identity.mjs`, `lib/registration.mjs` or `lib/harness.mjs`, and
`cpg_u1_data.mjs` is an entry point that nothing imports. There is therefore no path from any of the six
changed files into this suite. Confirming this from the other direction: no entry in M431–M467 carries
`kind === 'adapter'`, so `mutate.mjs` would never invoke the adapter suite for the new population either.

**Precondition proof — it could not have run here in any case.** The suite stops before its first assertion
unless `<CPG_U1_RESOLVER_CLONE>/node_modules/tsx/dist/cli.mjs` exists
(`if (!existsSync(...)) stop('resolver dependencies are not installed in CPG_U1_RESOLVER_CLONE')`, exit 2).
`C:/tmp/dt013-resolver` has **no `node_modules`** — verified. Supplying `CPG_U1_ADAPTER_CLONE` would mean
installing the resolver's dependencies, which requires network access (prohibited) and would leave the clone
dirty, breaking the `clean === true` invariant the harness enforces and the selftest asserts.

### B3. `node test/synthchain.mjs`

Not a suite. It is a fixture module — `export const SYNTHETIC_BITS`, header and transaction builders — with
no assertions of its own, imported by `test/selftest.mjs`. Its only local import is `lib/bitcoin.mjs`, which
is not a changed file and does not import any changed file. Running it standalone would produce no verdict,
and its content is already executed inside the selftest that passed.

### B4. `verify-sampling`, `draw-development`, `draw-held-out`, `commitment-payload`, `reconcile`, `seal`, `run-pilot`, `run-held-out`

Closure proof: every one of these enters through `registered(o)` (`cpg_u1_data.mjs:415, 451, 487, 577, 1146`
and the harness path), which is the *same* function `verify-registration` exercised in A5 — the changed code
in `cpg_u1_data.mjs` (attestation intake, `resolverCloneFor`, the provider gate) and the changed code in
`registration.mjs` (`assigned`, `human`) are all inside it and all fail before any command-specific logic
runs. Downstream of `registered()`, the sampling logic touches the changed set at exactly one point:
`lib/sampling.mjs` imports `registrationEpoch` from `registration.mjs`, whose body is not part of the change
(no new symbol appears in it; it is a one-line `Date.parse` wrapper) and which is covered by the selftest.
The harness execution guards are provably outside the change: `checkProviderConfiguration` is not called from
anywhere inside `harness.mjs`, so the R15 block cannot reach `commonVerification`, `runPilot` or
`runHeldOut`. Additionally, running these for real would need mainnet outpoints, drand rounds and a real
frame — all prohibited here.

### B5. `verify-evaluation`, `evaluation-items`, `archive-merkle-root`, `audit`, analysis commands

Closure proof: `lib/analysis.mjs` and `lib/evaluation.mjs` reach the changed set only through
`executionLogFromEvents` imported from `harness.mjs`. That export's body is not part of the change (the
change to `harness.mjs` is the new `assignedValue` import plus the R15 block: `PROVIDER_CONFIG_VERDICT`,
`checkProviderConfiguration`, `PROVIDER_HEX64`), and the selftest exercises it. No changed symbol is reachable
from these commands.

### B6. The `C:/virality` repository suites — Jest, `tsc`, ESLint, the governance gates

Closure proof: the candidate instrument is a standalone tree with its own vendored `node_modules`, written in
`.mjs`, and no repository source imports it. A scan of `backend`, `pages`, `lib` and `components` for
`cpg-u1/tooling` or `cpg_u1_data` returned no file. The repository's own committed copy at
`research/cpg-u1/tooling` is a **different and older** tree — 587 files, aggregate
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f` — and is not the candidate, so repository
gates cannot observe the candidate's six changes even in principle. Nothing in the candidate was published
into the repository by this stream.

### B7. `registration-fields`, `check-funding-prerequisites` as separate runs

`registration-fields` only writes the template, whose UNASSIGNED field set is asserted by the selftest
(template blocker list) and re-derived by probe `p1_fields.mjs`; running it would require `--out`, i.e. a
write, for no additional observation. `check-funding-prerequisites` calls
`checkRegistration(reg, { phase: 'funding' })`; probe `p4_pipe.mjs` invoked that phase directly and recorded
its return shape (`["errors","blockers"]`), and the selftest covers its CLI behaviour
(`CLI synthetic identities refused outside test mode`, expectCode 1). Both are covered without a further run.

---

## C. Dead-mutant analysis (static — the suite is prohibited in this phase)

A mutant goes dead when its `to` becomes semantically indistinguishable from the original for every input
the oracle supplies, or when a newly added earlier guard makes the mutated guard unreachable. Only guards in
the four changed production files can be affected, and only `registration.mjs`, `harness.mjs` and
`cpg_u1_data.mjs` contain pre-existing guards.

The anchor pass already excludes one whole failure mode: if a change had deleted or rewritten a line a
pre-existing mutant anchors on, that mutant's count would be 0 and the anchor line would not read 441/441.

**M81 — `else if (synthetic(v) && !allowSynthetic) errors.push` — ALIVE (the case the implementing stream
caught).** R28 inserted three earlier branches ahead of it. Its reachable set narrowed to
`{PLAUSIBLE, AUTHORITATIVE, SYNTHETIC with code SYNTHETIC_MARKER}`, and it survives only because the R28
branch deliberately carves out `c.code !== 'SYNTHETIC_MARKER'`. Its kill paths both use SYNTHETIC_MARKER
values, so both still reach it: `selftest.mjs:460`
(`chk(good, 'registered', false).errors.some((e) => e.includes('SYNTHETIC'))`, where every identity in
`good` is `SYNTHETIC-…`) and `selftest.mjs:1565` (CLI `check-funding-prerequisites`, expectCode 1). Verified
empirically in probe `p4_pipe.mjs`: `identity.registration_id` for `SYNTHETIC-REG-1` is
`SYNTHETIC_PLACEHOLDER/SYNTHETIC_MARKER`, i.e. the R28 branch does not fire and control does reach M81's
line. **Robustness note:** `selftest.mjs:460` is a substring test on the whole error list, close to the
"bare was-refused assertion" the file's own header says it avoids. Under M81 the only other error `good`
produces is `network must be mainnet`, which does not contain `SYNTHETIC`, so it is sound today — but it is
one added message away from becoming a false green.

**M77 — `const assigned = …` without the sentinel check — ALIVE.** Under M77 all of `UNASSIGNED`,
` UNASSIGNED `, `unassigned` read as assigned. For `registration_id` the mutant is masked (the following
`human()` call still classifies the value RESERVED and pushes the same blocker), but it is not masked for
`as_of`, `registration_timestamp`, the two outpoints or `provider_configuration_sha256`, where the value
falls through to a *format* error. `selftest.mjs` DR-12 g asserts both the exact `as_of` blocker text and the
absence of `as_of must be ISO-8601`, so M77 is observable. The pristine-template assertion at
`selftest.mjs:453–454` also observes it.

**M436 — `assigned` compares the sentinel untrimmed and case-sensitively — ALIVE and not equivalent to
M77.** `M77.to` deletes the sentinel test entirely; `M436.to` restores `v !== UNASSIGNED`. On `unassigned`
the two agree, on nothing else do they differ from the original in the same way, and both are killed by
DR-12 g/h/i, which use the padded and lowercase variants and pin the exact blocker strings.

**M77 and M436 sharing a `from` line — SAFE, and the M14/M15 precedent verified.** `mutate.mjs` counts
occurrences *per mutant, inside that mutant's own file*
(`readFileSync(join(ROOT, file)).split(from).length - 1`, required to be 1), and applies each mutant to its
own fresh `mkdtempSync` copy of the tree with a single `String.replace(from, to)`. Sharing a `from` between
two entries is therefore structurally invisible to the mechanism. The claimed precedent is real: M14 and M15
(`mutate.mjs:54–55`, file `SEL`) carry the byte-identical `from`
`admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id))` and
differ only in `to`. The 441/441 anchor pass covers both pairs.

**M191 — `verify(ctx.resolver?.providerConfigurationSha === reg.provider_configuration_sha256, …)` —
ALIVE and independent of R15.** It lives in `commonVerification`, which compares a hash the caller already
put on `ctx.resolver`; it never calls `checkProviderConfiguration`. Its kill path is `selftest.mjs:2049`
(`resolver: { …, providerConfigurationSha: H('x') }` → `PROVIDER_CONFIG_MISMATCH`), untouched by R15.

**M76, M78, M79, M80, M82, M83, M84, M85 (REG) and M180–M215, M248–M250 (HAR) — no path from the change.**
None sits in the `human()` chain, none depends on `assigned()`, and none is downstream of
`checkProviderConfiguration` (which has exactly one production call site, in `cpg_u1_data.mjs`). Their
reachability is unchanged.

**No newly dead pre-existing mutant was found.** What was found instead is the inverse defect: two guards
that the changes left *uncovered* rather than dead — see REGRESSION_FINDINGS.md **F1** (no mutant asserts
DR-12 normalisation of `checkpoint`) and **F3** (no mutant asserts `resolverCloneFor`'s `existsSync`
behaviour) — plus one pre-existing guard with neither a mutant nor an assertion, **F4**.

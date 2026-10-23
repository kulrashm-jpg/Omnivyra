# DEEPTECH-PARALLEL-014 · PHASE 2 · DEPENDENCY MAP

Candidate: `C:/tmp/dt013-candidate/tooling`

Tooling aggregate, re-derived by this stream with `lib/aggregate.mjs::toolingManifest`:
`b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67`, **595 files** — matches the value supplied.

Protocol: `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md`,
sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — matches.

Resolver clone (`CPG_U1_RESOLVER_CLONE`): `C:/tmp/dt013-resolver`, HEAD `f01a7eb4199be4e04d4fee7fc0116303949dc553`,
`git status --porcelain` = 0 lines, 11552 tracked files.

The candidate tree was **not modified**. Every command run against it was read-only; all generated files
went to this stream's scratchpad.

## Mutation population, verified rather than asserted

`node test/mutate.mjs --anchors` printed `anchors: 441/441 occur exactly once` and exited `0`.

Parsed directly out of `test/mutate.mjs`:

| quantity | value | check |
|---|---|---|
| entries | 441 | matches the anchor line |
| id range | M1 … M467 | |
| retired gaps (26) | M23–M26, M225, M244, M280–M299 | exactly as stated |
| duplicate ids | none | |
| pre-existing (id less than or equal to M430) | 404 | 430 − 26 = 404 |
| DR-12 M431–M436 | 6 present | |
| R28 M437–M459 | 23 present | |
| R15 M460–M467 | 8 present | |
| M468–M471 | **0 present** — reserved and empty for DR-11 | |

Per-file allocation of the 37 new entries (mutate.mjs file tag → ids):

- `IDN` = `lib/identity.mjs` — 23: M431–M435, M437–M454
- `REG` = `lib/registration.mjs` — 4: M436, M457, M458, M459
- `HAR` = `lib/harness.mjs` — 6: M460–M465
- `CLI` = `cpg_u1_data.mjs` — 4: M455, M456, M466, M467

23 + 4 + 6 + 4 = 37; 404 + 37 = 441.

## Import closure of the changed set (by grep, not assumption)

```
lib/identity.mjs     <- lib/registration.mjs, lib/harness.mjs, cpg_u1_data.mjs, test/selftest.mjs
lib/registration.mjs <- lib/harness.mjs, lib/sampling.mjs (registrationEpoch only), cpg_u1_data.mjs
lib/harness.mjs      <- lib/analysis.mjs (executionLogFromEvents only), lib/evaluation.mjs (same), cpg_u1_data.mjs
cpg_u1_data.mjs      <- nothing (entry point)
```

No other file in the tree imports any of the three changed libraries. Verified with a single ripgrep over
`*.mjs` / `*.ts` excluding `node_modules` for `from './identity.mjs'`, `from './registration.mjs'`,
`from './harness.mjs'`, `lib/identity.mjs`, `lib/registration.mjs`, `lib/harness.mjs`.

---

## 1. `lib/identity.mjs` — **ADDED** — class **A. DIRECTLY LOAD-BEARING**

| exported symbol | callers (grep-verified) | protocol rule | test suite | mutants implicated |
|---|---|---|---|---|
| `UNASSIGNED` | re-exported at `lib/registration.mjs:11`; used in the template and the `checkpoint` comparison | §5.5.1 | selftest DR-12 a–f | — |
| `trimmedFor` | `isReservedSentinel`, `isEmptyValue` (internal only) | DR-12 clause 1 | selftest DR-12 a | **M431** |
| `isReservedSentinel` | `lib/registration.mjs:62` (`assigned`), `screenIdentityValue` | DR-12 clause 2 | selftest DR-12 a/b/d/e; R28 §14-3/4/5 | **M432**, **M433** (positive control), **M439** |
| `isEmptyValue` | `assignedValue`, `screenIdentityValue` | DR-12 clause 3 | selftest DR-12 c; R28 §14-1/2 | **M434**, **M438** |
| `assignedValue` | `lib/harness.mjs:53` inside `checkProviderConfiguration` — **one caller only** | DR-12 | selftest DR-12 c/e/f; R15 §14-1/§14-1a | **M435** (positive control), **M464** |
| `hasInvisibleCharacter` | `screenIdentityValue` | §3 | selftest R28 §14-13 | **M440** |
| `isZeroPattern` | `screenIdentityValue` | §3 | selftest R28 §14-8 | **M448**, **M449** |
| `screenIdentityValue` | `classifyIdentityValue`, `attestationErrors` — **no external caller** | §3, second branch | selftest R28 §14-1…§14-15 | **M437**, **M441–M447**, **M454** |
| `attestationErrors` | `classifyIdentityValue` — **no external caller** | §3 / §5.5.1 | selftest R28 §14-11 and the attestation table | **M451**, **M453**, **M454** |
| `classifyIdentityValue` | `lib/registration.mjs:76` inside `human()` | §3 | selftest R28 matrix and reg-1…reg-4 | **M450**, **M452** |
| `isAuthoritative` | `test/selftest.mjs` only — no production caller | §3 | selftest R28 INVARIANT | — |
| `IDENTITY_CLASS` | `lib/registration.mjs:78–80`, `cpg_u1_data.mjs:380` | §3 | selftest R28 matrix; CLI-2/CLI-3 | **M437–M439**, **M450**, **M452**, **M458**, **M459** |
| `ATTESTATION_SCHEMA` | `test/selftest.mjs` only | §3 | selftest R28 §14-11 | — |

Mutation population affected: **M431–M435, M437–M454** (23 mutants).

## 2. `lib/registration.mjs` — MODIFIED — class **A. DIRECTLY LOAD-BEARING**

| changed element | exported symbol reached | callers | protocol rule | test suite | mutants |
|---|---|---|---|---|---|
| `const assigned` now delegates to `isReservedSentinel` (DR-12) | `checkRegistration` | `lib/harness.mjs:85` (`commonVerification`), `cpg_u1_data.mjs:198` (`registered`), `cpg_u1_data.mjs:346` (`check-funding-prerequisites`) | DR-12 / §5.5.1 | selftest DR-12 g/h/i/j | **M77** (pre-existing, shares the `from` line), **M436** |
| new `human()` helper calling `classifyIdentityValue`, populating a returned `identity` map | `checkRegistration` | as above | R28 / §3 | selftest reg-1…reg-4; CLI-2/CLI-3 | **M81** (pre-existing, final branch of the chain), **M457**, **M458**, **M459** |
| new `import` of `IDENTITY_CLASS`, `UNASSIGNED`, `classifyIdentityValue`, `isReservedSentinel` | — | — | — | — | — |

Unchanged exports — `REGISTRATION_SCHEMA`, `PROTOCOL_VERSION`, `REGISTRY`, `PARAMETERS`,
`registrationTemplate`, `registrationEpoch`, `checkAuthority` — carry pre-existing mutants
**M76, M78, M79, M80, M82, M83, M84, M85**. All remain anchored (441/441) and all remain reachable; see
TARGETED_VERIFICATION.md, "Dead-mutant analysis".

Mutation population affected: **M436, M457, M458, M459** new; **M77, M81** pre-existing and re-anchored on
changed lines.

## 3. `lib/harness.mjs` — MODIFIED — class **A. DIRECTLY LOAD-BEARING**

| changed element | exported symbol | callers | protocol rule | test suite | mutants |
|---|---|---|---|---|---|
| new `PROVIDER_CONFIG_VERDICT` | `PROVIDER_CONFIG_VERDICT` | `cpg_u1_data.mjs:37, 210, 211, 382` | R15 / §13.1, §19.1 | selftest R15 §14-1…§14-9, CLI-1…CLI-5 | **M465** |
| new `checkProviderConfiguration` | same name | `cpg_u1_data.mjs:209` — **the only production caller** | R15 / §13.1, §19.1 | selftest R15 matrix | **M460–M465** |
| new `import { assignedValue } from './identity.mjs'` | — | — | DR-12 | selftest R15 §14-1a | **M464** |

`providerConfigurationSha` is pre-existing and its body is unchanged; it gains one new caller inside
`checkProviderConfiguration`. Nothing in `commonVerification`, `runPilot`, `runHeldOut`,
`closeInterruptedRun`, `executionLogFromEvents` or `lookupInput` is reached by the new block:
`checkProviderConfiguration` is **not called from anywhere inside `harness.mjs`** (verified by grep — the
only call site in the tree outside the tests is `cpg_u1_data.mjs:209`). The R15 addition therefore has
**no path** into the execution guards carrying **M180–M215** and **M248–M250**.

Mutation population affected: **M460–M465**.

## 4. `cpg_u1_data.mjs` — MODIFIED — class **A. DIRECTLY LOAD-BEARING**

| changed element | protocol rule | test suite | mutants |
|---|---|---|---|
| `identityAttestations(o, reg)` — refuses an in-record `identity_attestations`, reads only `--identity-attestations` | R28 / §3 | selftest self-attestation case (`reg_selfatt.json`) | **M455** |
| `resolverCloneFor(o)` — `--resolver-clone` else `CPG_U1_RESOLVER_CLONE`, gated on `existsSync` | R15 / §13.1 | selftest R15 CLI-4, CLI-5 | *none* — see REGRESSION_FINDINGS.md **F3** |
| `registered(o)` provider gating — BLOCKED fails; NOT_COMPARED fails only with `--require-provider-config` | R15 | selftest R15 CLI-1…CLI-5 | **M466**, **M467** |
| `reportRegistrationStanding()` — exit-0 line rewritten to ESTABLISHED plus an explicit NOT ESTABLISHED list | R28 / §3, §20.13 | selftest R28 CLI-1, CLI-2, CLI-3 | **M456** |
| `import { IDENTITY_CLASS }` for the IDENTITY caveat text at line 380 | §3 | selftest CLI-3 | — |

Mutation population affected: **M455, M456, M466, M467**.

## 5. `test/mutate.mjs` — MODIFIED — class **E. GIT/METADATA ONLY** (population registry)

It adds the `IDN` file constant, the 37 entries M431–M467, and the reserved, empty M468–M471 block comment.
It is not production code and defines no behaviour under test, so the verification owed to it is population
bookkeeping — which is exactly what `--anchors` performs: 441/441 anchors occur exactly once, the 26 retired
gaps are intact, there are no duplicate ids, and M468–M471 are absent. No mutant can be written against
`mutate.mjs` itself.

## 6. `test/selftest.mjs` — MODIFIED — class **A. DIRECTLY LOAD-BEARING** (it *is* the oracle)

It adds `import * as ID from '../lib/identity.mjs'` and the DR-12 / R28 / R15 blocks at roughly lines
1315–1620. Every mutant in M431–M467 is killed, if at all, only by an assertion in this file — plus
`test/adapter_conformance.mjs` for entries whose `kind === 'adapter'`, of which there are **none** in the new
range. It therefore had to be executed in full, once, and was.

## Classification summary

| changed file | class | why |
|---|---|---|
| `lib/identity.mjs` (added) | **A** | new production module on the registration and provider-hash refusal paths |
| `lib/registration.mjs` | **A** | `assigned()` and `human()` change the blocker/error verdict of ten record fields |
| `lib/harness.mjs` | **A** | new R15 comparison gating every sampling command through `registered()` |
| `cpg_u1_data.mjs` | **A** | attestation intake, clone resolution, provider gating, exit-0 wording |
| `test/mutate.mjs` | **E** | population registry; anchor, gap and duplicate bookkeeping only |
| `test/selftest.mjs` | **A** | the oracle that kills M431–M467; must be executed, not inspected |

No changed file falls in class **B**, **C** or **D**.

The one class-**C** item found is *not* among the six changed files: `tooling/README.md` line 39 still
carries the exact wording R28 removed from the code (REGRESSION_FINDINGS.md **F2**). Because `README.md` is
inside the tooling aggregate, fixing it changes the aggregate, so it is reported rather than edited.

Transitive dependents — class **B** had they changed, and covered here by the one full selftest run:
`lib/sampling.mjs` (`registrationEpoch`), `lib/analysis.mjs` and `lib/evaluation.mjs`
(`executionLogFromEvents`). None of the three touches a changed symbol.

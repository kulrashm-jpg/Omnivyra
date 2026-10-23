# CPG-U1 adapter clone provisioning record (PREREG-015 / adapter stream)

Date: 2026-09-25
Status: PROVISIONED AND VERIFIED. No mutation run performed.

## Objective

Provision the separate adapter clone that `test/mutate.mjs` requires as a hard
precondition (`CPG_U1_ADAPTER_CLONE`). Without it the mutation run exits 2 before
the first mutant. This prerequisite is independent of every pending
methodological decision (AD-1..9, DR-1/DR-2, drand relay floor, §19.3 wording).

## Clone

| Item | Value |
| --- | --- |
| Location | `C:/tmp/dt015-adapter` |
| Created by | `git clone --local --no-checkout C:/virality C:/tmp/dt015-adapter` then `git checkout --detach f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| `git rev-parse HEAD` | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| `git rev-parse HEAD^{tree}` | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` |
| Tracked files | 11552 (identical to `dt013-resolver`) |
| `git status --porcelain` | empty (clean) |
| `node_modules` ignored | yes — `.gitignore:1:node_modules` |
| Non-example `.env*` files | none (only `.env.beta.example`, `.env.cert.example`) |

It is a real independent repository, not a worktree of `C:/virality/.git`. A
worktree was deliberately rejected: it would write worktree metadata into the
primary repository. `--local` hardlinks the object packs, so the 0.78 GB `.git`
is shared inodes with `C:/virality/.git` and costs no additional disk.

## Install

Command (the command the tooling README §Reproducibility prescribes):

```
cd C:/tmp/dt015-adapter && npm ci --ignore-scripts
```

Real output (tail):

```
added 1109 packages in 3m

312 packages are looking for funding
  run `npm fund` for details
```

Exit code 0. `package.json` and `package-lock.json` are byte-identical to
`dt013-resolver` (`sha256 33408d60…` / `e47b9805…`, lockfileVersion 3), so the
tree is the registry-resolved tree for this exact SHA. No `node_modules` was
copied, vendored, stubbed or hand-assembled. Installed `tsx 4.21.0` and
`undici 6.25.0` match the lockfile pins exactly.

Network access was used only for the npm registry fetch of these dependencies.

## Preconditions of `test/adapter_conformance.mjs`

Hard stops (`exit 2`), lines 16-23 of the candidate copy:

1. `CPG_U1_RESOLVER_CLONE` set and the path exists — MET.
2. `<clone>/node_modules/tsx/dist/cli.mjs` exists — MET.
3. `git -C <clone> rev-parse HEAD === f01a7eb4199be4e04d4fee7fc0116303949dc553` — MET.

Further requirements the body exercises (not `stop()` guarded; a miss is a
counted failure or a crash, not an exit 2):

4. `<clone>/node_modules/undici/index.js` importable — MET (the driver imports it
   directly to prove diagnostics-channel header capture).
5. `<clone>/backend/services/companyProfile/grounding/companyFactsLookup.ts` — MET.
6. `<clone>/backend/services/companyProfile/grounding/acquisition/safeEvidenceFetcher.ts`
   and `<clone>/backend/services/intelligence/adapters/wikidataAdapter.ts`
   (imported by `harness/cpgAdapter.ts` itself) — MET.
7. `tsx` must run TypeScript with `cwd` = clone, resolving the resolver's own
   `tsconfig.json` and transitive dependencies — MET (proved by the real run).
8. Loopback HTTP on an ephemeral `127.0.0.1` port must be permitted — MET.

Not required by conformance but required by the harness executor
(`lib/cpgExecutor.mjs` `realExecutor`): `<clone>/node_modules/undici/package.json`
— also present.

## Real conformance invocation

From the candidate, with `CPG_U1_RESOLVER_CLONE` pointed at the new clone:

```
cd C:/tmp/dt013-candidate/tooling
CPG_U1_RESOLVER_CLONE=C:/tmp/dt015-adapter node test/adapter_conformance.mjs
```

Actual result line and exit code:

```
adapter conformance: 18 passed, 0 failed
exit 0
```

Wall clock 33 s. No mutation suite was run. The five adapter mutants this
unblocks are M254-M258 (`harness/cpgAdapter.ts`), each re-run against this
harness with `CPG_U1_RESOLVER_CLONE` overridden to `CPG_U1_ADAPTER_CLONE`.

## Non-interference

| Artefact | Check | Result |
| --- | --- | --- |
| `C:/tmp/dt013-candidate/tooling` | `lib/aggregate.mjs` `toolingManifest()` re-derived after all work | 595 files, `b9250356d77fdcffae97e7c23520140f5ec6756d1d2c0f0f54ac2a8288e11a67` — unchanged |
| `C:/tmp/dt013-resolver` | `git rev-parse HEAD` | `f01a7eb4199be4e04d4fee7fc0116303949dc553` |
| `C:/tmp/dt013-resolver` | `git status --porcelain` | empty; no `node_modules` present |
| `C:/tmp/dt4-legal` | not touched | — |

`npm ci` ran only inside `C:/tmp/dt015-adapter`. The resolver clone's
cleanliness invariant (`RESOLVER_ENV_FILES`, `RESOLVER_MISMATCH`) is intact.

## Size and disk

| Item | Value |
| --- | --- |
| Clone total (logical) | 1.54 GB, 59915 files |
| `node_modules` | 0.66 GB, 48120 files |
| `.git` | 0.78 GB — hardlinked to `C:/virality/.git`, no additional disk |
| Net new disk | ~0.76 GB (well under the ~2.5 GB budgeted) |
| Disk after | 98.17 GB free, 79.4% used |
| Clone + checkout wall clock | 53 s (3 s clone, 50 s checkout) |
| `npm ci` wall clock | 179 s |

## Risks

1. The `.git` packs are hardlinks into `C:/virality/.git`. A `git gc`/repack in
   the primary repository unlinks its own name only; the inode survives through
   this clone's link, so the clone stays readable. It does mean the clone's
   object store cannot be assumed independent of the primary repository's
   filesystem.
2. The clone is DISPOSABLE but must be re-provisioned (another 3 min registry
   install) if deleted before the mutation run.
3. `npm ci --ignore-scripts` skips postinstall steps by design. The conformance
   run passing 18/18 is the evidence that no skipped script was needed.
4. Conformance passing does not certify the mutation suite; M254-M258 remain
   unexecuted by decision (no mutation run was authorised here).

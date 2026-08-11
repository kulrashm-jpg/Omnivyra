# TypeScript 7 Migration — Status, Hold Point & Resumption Criteria

**Status:** **SAFELY PAUSED** — hold point established Phase E3.
**Scope:** compiler/toolchain only. No runtime behaviour is governed by this document.

> **Read this before doing any TypeScript 7 work.** The application is already TS7-ready.
> The blocker is *external* toolchain support, not this repository. Attempting to "finish"
> the migration today will not produce a working toolchain — it will produce a broken one.
> Every unsafe shortcut that looks like it works is listed in §6, with the reason it fails.

---

## 1. Current compiler topology

This split is deliberate and **must be preserved** until §7 is satisfied.

```text
TypeScript 6.0.3            ← authoritative operational compiler
        │
        ├── ts-jest
        ├── typescript-eslint
        ├── ts-node
        ├── Next.js / existing tooling
        └── all authoritative production & CI checks

TypeScript 7.0.2            ← isolated advisory readiness gate ONLY
        │
        └── tools/ts7  (separate package tree + own lockfile)
```

| | |
|---|---|
| Authoritative compiler | **TypeScript 6.0.3** |
| TS7 advisory compiler | **7.0.2**, isolated in `tools/ts7/` |
| Advisory gate driver | `scripts/typecheck-ts7.js` (`npm run typecheck:ts7`) |
| CI | one `continue-on-error: true` step in `.github/workflows/typecheck-baseline.yml` |
| Readiness commit | `34db8791` |
| Certified production SHA | `281e0f3a` |

`tools/ts7` is a **separate package tree on purpose.** Installing `typescript@7` into the root —
including via an npm alias such as `typescript7@npm:typescript@7.0.2` — claims
`node_modules/.bin/tsc`. This was measured, not assumed: after the alias, bare `tsc` reports
**7.0.2**, silently swapping the compiler behind `typecheck:backend-tests`, the pre-commit worker
typecheck, and the CI worker gate. Do not "simplify" this into the root tree.

The gate is **fail-closed**: a missing or non-7.x compiler exits non-zero with install
instructions. It never falls back to TS6, because a silent fallback would report "TS7 ready"
while proving nothing. It never reads, writes, or ratchets any baseline file.

---

## 2. Completed phases

| Phase | Outcome |
|---|---|
| 0 | TS7 surface audit — compiler, configs, invocation graph inventoried |
| A + B | Dead tsconfig removal; TS7-reported logic defects fixed |
| C | `module: commonjs` + `moduleResolution: bundler` retained as the architectural decision (supported since TS 6.0, microsoft/TypeScript#62320) |
| D0 | Compiler upgrade **5.9.2 → 6.0.3** |
| D0.5 | Jest/ts-jest compatibility preparation |
| D1 | Worker module-resolution migration + certification |
| — | Release integration and production deployment |
| E | TS7 compatibility audit — blockers proven **external** |
| E2 | Isolated TS7 advisory readiness gate — **CERTIFIED** |
| E3 | This hold record |

**Current TS7 diagnostics — 0 across all five production projects:**

```text
tsconfig.json             0
tsconfig.backend.json     0
tsconfig.scripts.json     0
tsconfig.build.json       0
tsconfig.worker.json      0
```

`tsconfig.backend-tests.json` carries pre-existing debt governed **separately under TS6** by
`typecheck:certification` (`docs/TYPESCRIPT-VALIDATION-STRATEGY.md`). The TS7 gate reports it
**informationally only** and must never gate on it — doing so duplicates an existing gate and
invites someone to "fix" the number in the wrong place.

---

## 3. Current blocker

**TypeScript 7 is the native (Go) compiler and does not expose the JavaScript compiler API.**
It ships no `lib/typescript.js` and no `main` entry — only `getExePath.js`, `tsc.js`, and
`version.cjs`. Every tool that consumes `require('typescript')` therefore fails against it.

This is an ecosystem gap, not a repository defect. **No application source change can resolve it.**

### Verified consumer inventory

12 installed packages declare a `typescript` dependency, in five families. Do not assume
ts-jest and typescript-eslint are the only blockers:

| Consumer | Version | Peer range | Admits 7.x? | Uses JS API? | Verdict |
|---|---|---|---|---|---|
| `ts-jest` | 29.4.12 | `>=4.3 <7` | ❌ no | yes | **hard blocker** — fails loudly |
| `typescript-eslint` family (8 pkgs) | 8.59.2 | `>=4.8.4 <6.1.0` | ❌ no | yes | **hard blocker** — fails loudly |
| `ts-node` | 10.9.2 | `>=2.7` | ⚠️ **yes** | yes | **silent blocker** — see below |
| `ts-api-utils` | 2.5.0 | `>=4.8.4` | ⚠️ yes | yes | transitive (typescript-eslint) |
| `eslint-config-next` | 16.2.5 | `>=3.3.1` | ⚠️ yes | delegates | re-evaluate on resume |

**`ts-node` is the dangerous one.** Its peer range `>=2.7` *admits* TypeScript 7, so npm installs
it without any warning — but it calls `ts.createIncrementalProgram`, `ts.createLanguageService`,
`ts.createSourceFile`, and `ts.transpileModule`. It therefore fails at **runtime**, not at install.

Observed failure modes:

```text
ts-jest              → "The TypeScript compiler (version 7.0.2) does not expose the
                        JavaScript compiler API required by ts-jest."
@typescript-eslint   → TypeError: Cannot read properties of undefined (reading 'Cjs')
require('typescript')→ no createProgram
```

### Blast radius of `ts-node` (scoped, verified)

Production runtime is **not** exposed: both `Dockerfile.worker` and `Dockerfile.cron` build with
`npx tsc -p tsconfig.worker.json` and then run **compiled output** —
`node dist/backend/workers/main.js` and `node dist/backend/scheduler/cron.js`. Neither invokes
ts-node at runtime.

ts-node *is* load-bearing for local/ops workflows, which would break on a naive upgrade:
`start:workers`, `worker:bolt`, `start:cron` (`-r ts-node/register`), and the
`reconcile:*` script family.

`tsx` **4.21.0** is already installed and is esbuild-based (no `typescript` peer, no JS API
dependence). It is the most likely replacement path for ts-node when resuming — evaluate it,
do not assume it.

---

## 4. External dependencies required before resuming

All of the following must hold. Each is an **external publish event** we do not control.

**ts-jest** — a published version that explicitly supports TypeScript 7.x, no longer requires the
removed JS compiler API, has a peer range admitting 7.x, and passes Jest against this repository.
As of this hold point the latest is 29.4.12 (peer `<7`). Note: ts-jest's own suggested remedy
references `@typescript/native`, which is **not published**; `@typescript/native-preview` exists
(`7.0.0-dev.*`, bin `tsgo`) but is a preview, not a supported migration path.

**typescript-eslint** — a published version admitting 7.x that parses and type-checks through the
TS7 ecosystem and passes this repository's ESLint integration. Latest observed: 8.66.0
(peer `<6.1.0`).

**ts-node (or its replacement)** — either a TS7-capable ts-node, or a decided and validated
migration of the ts-node call sites to `tsx`. This will **not** announce itself via a peer
warning; it must be tested explicitly.

**Remaining consumers** — re-run the consumer inventory (§3) on resume. The set changes as
dependencies move. Do not trust this table without re-verifying it.

---

## 5. What should trigger resumption

Any one of these is a signal to re-check, not to migrate:

- ts-jest publishes a release whose peer range admits `7.x`
- typescript-eslint publishes a release whose peer range admits `7.x`
- `@typescript/native` reaches a published, non-preview release
- Node/Next.js toolchain guidance changes materially for the native compiler

Resumption requires the **full** §4 set, not a single signal. Until then the advisory gate keeps
the answer current automatically — there is nothing to re-investigate by hand.

---

## 6. Prohibited approaches

These are banned unless the ecosystem *officially* supports them. Each has been considered and
rejected on evidence; a future agent proposing one is repeating solved work.

```text
--legacy-peer-deps to force TS7 into the dependency topology
forced peer overrides / resolutions
fake TypeScript JS-API shims or a stub typescript.js
monkey-patching compiler APIs
package alias tricks that replace root tsc
silently invoking TS6 while reporting TS7
TS7 falling back to TS6 while reporting success
suppressing or filtering TS7 diagnostics
converting TS7 failures into success
modifying the TS6 baselines to absorb TS7 output
local unpublished compiler forks
```

**Note on `--legacy-peer-deps`:** it already appears in `Dockerfile.worker` and `Dockerfile.cron`
for **unrelated pre-existing reasons**. That is not licence to use it as a TS7 mechanism. Forcing
TS7 past a peer range does not give ts-jest or typescript-eslint a JavaScript compiler API — it
only converts a loud install failure into a silent runtime one.

The purpose of the advisory gate is to ensure a future agent cannot accidentally turn a
*TS7-ready application* into a *TS7-broken toolchain*.

---

## 7. Resumption validation sequence

Execute in order, in an isolated branch/worktree. Do not skip ahead.

**Step 1 — dependency compatibility.** Upgrade tooling in isolation. Verify npm resolution, peer
dependencies, compiler-API requirements, and lockfile churn.

**Step 2 — compiler identity.** Verify `tsc --version` and `require('typescript').version`, and
confirm every intended tool resolves the same supported TS7 ecosystem.

**Step 3 — existing gates.** Run `typecheck:ci`, `typecheck:certification`, worker typecheck,
Jest, ESLint. **Do not modify baselines to make failures disappear.**

**Step 4 — TS7 gate.** Run `npm run typecheck:ts7`. Expected: **0 TS7-new diagnostics**.

**Step 5 — worker.** Run `tsc -p tsconfig.worker.json --noEmit`, then the previously certified
worker validation: isolated build, alias rewrite, emit comparison, dynamic-import execution,
Docker build, `/health`, queue execution. Accept only behaviourally equivalent output, subject to
the already-characterised `ThreadSequencePreview.js` directive-order difference.

**Step 6 — regression.** Baseline the failing-suite **sets** before migrating; re-run the full
relevant suite after; compare **sets**. Never rely on aggregate test counts alone. Note that
`recommendationFallbackSignal.test.ts` is a known pre-existing latency flake (live SERP path at
the 30 s limit; which test fails alternates between runs) — it is a separate workstream and must
not be mistaken for a migration regression.

**Step 7 — security/policy.** Run `check:ssrf`, `check:authz`, `check:route-policy`,
`check:migrations`, `check:schema-drift`, `check:db-conventions`.

**Step 8 — production certification.** Only after every preceding gate passes: clean release
worktree, single release SHA, origin/main parity, Vercel SHA parity, Railway SHA parity,
production health, worker health, runtime smoke. **No deployment before certification.**

---

## 8. Production deployment criteria

A TS7 migration may reach production only when **all** hold:

- Every §7 step passes without baseline modification
- No prohibited approach from §6 was used anywhere in the change
- Worker emit is behaviourally equivalent, verified from a clean worktree
- Release SHA is identical across `origin/main`, Vercel, and Railway
- Production and worker health plus runtime smoke pass post-deploy
- Rollback SHA is recorded before the deploy

---

## 9. Conclusion

Omnivyra's application code is already TS7-ready. The authoritative compiler remains
TypeScript 6.0.3 because the surrounding toolchain does not yet provide a supported TS7
JavaScript-API-compatible migration path. The isolated TS7 advisory gate remains the
forward-compatibility mechanism until the external ecosystem blockers are resolved.

**Do not perform further TS7 migration work until §4 is satisfied.**

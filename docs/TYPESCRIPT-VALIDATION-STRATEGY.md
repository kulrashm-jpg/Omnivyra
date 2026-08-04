# Repository TypeScript Validation Strategy (Canonical)

**Status:** authoritative. Established by **PB-009 — Backend TypeScript Certification
Coverage**, extended by **PB-011 — Type Debt Attribution & Ratchet Enforcement** (PMO-002,
Program B). Tooling/configuration only — no runtime behaviour is governed by this document.

> **Read this before you claim "it type-checks."** A green `npm test` is **not** evidence
> that a TypeScript file compiles. See §2.

---

## 1. The projects and what each one covers

The repository has **four** TypeScript projects. Each is a `tsc -p <project> --noEmit`
check. There is no single project that covers everything, and running one does **not**
run the others.

| Project | Covers | Does **not** cover |
|---|---|---|
| `tsconfig.json` | Next.js app surface: `pages/**`, `components/**`, `lib/**`, root `*.ts(x)` | `backend/**`, `scripts/**`, **all test files** |
| `tsconfig.backend.json` | `backend/**/*.ts(x)` (**every** backend production module, including standalone/unconsumed ones), `lib/**`, `pages/api/**` | **all test files** |
| `tsconfig.scripts.json` | `scripts/**`, plus `backend/**` and `lib/**` | **all test files** |
| `tsconfig.backend-tests.json` **(PB-009)** | The **entire backend test surface**: `backend/tests/**/*.ts(x)` **and** co-located suites (`backend/**/__tests__/**`, `backend/**/*.test.ts(x)`, `backend/**/*.spec.ts(x)`) | app/`scripts` tests (see §5, residual gaps) |

Compiler options for all four come from the root `tsconfig.json` (`strict: false`,
`isolatedModules: true`, `skipLibCheck: true`). `tsconfig.backend-tests.json` inherits them
verbatim: the test surface is held to **exactly** the same bar as production code, neither
looser nor stricter.

### Standalone / unconsumed backend production modules

`tsconfig.backend.json` includes `backend/**/*.ts`, which is an **include glob, not an
import graph**. A backend module that nothing imports is therefore still type-checked. This
is verified mechanically, not assumed: `scripts/typecheck-certification.js` enumerates every
`backend/**` non-test `.ts(x)` file from disk and asserts it appears in `tsc --listFiles`
output (currently **2961/2961**).

The residual risk for standalone modules is therefore **procedural, not structural** — the
project must actually be *run*. `npm run typecheck` and `npm run typecheck:ci` both run it.

### Projects outside the typecheck gates

Three further `tsconfig` projects exist but are **not** part of `typecheck-all.js` / `typecheck:ci`:

| Project | Role | Consumer |
|---|---|---|
| `tsconfig.build.json` | **Production Next.js build** type-check (`allowJs:false`; excludes `backend`, `pages/api`, tests) | `next.config.js` `typescript.tsconfigPath` → `next build` (via `scripts/safe-build.js`). No `ignoreBuildErrors`. |
| `tsconfig.worker.json` | **Railway worker** compile (commonjs, **emits** `dist`) | `.github/workflows/typecheck-baseline.yml` (`tsc -p … --noEmit`) + worker build |
| `backend/tsconfig.json` | **Legacy** standalone strict (`strict:true`, emits `dist`) | **Unreferenced** by any `package.json`/`scripts/`/CI gate — see TECH-DEBT register **TD-004** |

**Production correctness** = `tsconfig.build.json` (frontend bundle) + `tsconfig.backend.json` (backend/API) + `tsconfig.worker.json` (worker). Never certify "clean" against a single project.

> **Companion guide.** For the **test-tier classification** (how to tell an infrastructure test
> failure from a code regression), the release-gate operational summary, and the per-branch
> certification checklist, see the companion:
> **`docs/pmo/RELEASE-ENGINEERING-001-typescript-and-test-contract.md`**. That document defers to
> **this** one for the tsconfig projects and baselines.

## 2. Jest does **not** type-check. "Tests green" ≠ "tests type-check."

Root `tsconfig.json` sets `"isolatedModules": true`, so **ts-jest runs transpile-only**.
Jest strips types and executes; it never asks the type-checker anything.

Demonstrated during PB-009: a test file containing
`const n: number = 'this is not a number';` **passed** under
`npx jest` (1 passed, 1 total) while `tsc -p tsconfig.backend-tests.json` reported
`error TS2322: Type 'string' is not assignable to type 'number'`.

Before PB-009 this combined with the exclusions in §1 to leave **`backend/tests/**`
type-checked by nothing at all** — 1,111 files, never validated. Real type errors shipped
with a fully green suite.

### Why type-checking was *not* enabled inside ts-jest

Turning off `isolatedModules` (or enabling ts-jest diagnostics) was explicitly rejected:

1. It converts **pre-existing type debt into test failures** — the 508 baseline errors of §3
   would break the suite immediately. That is a build regression, not a safety gain.
2. It type-checks on **every** test run, on every file, repeatedly — a large, permanent
   slowdown of the inner development loop.
3. It conflates two concerns. Jest is a **behaviour** runner; type safety is a **compile**
   concern and belongs in a `tsc` project that can be run, baselined, and gated
   independently.

**Doctrine: never enable type-checking inside the test runner. Add a `tsc` project.**

## 3. Baselines (non-regression, not zero)

This repository's established doctrine (`docs/ENGINEERING-GOVERNANCE.md` §4,
`Non-regression TypeScript baseline`) is that a surface sits at a **documented baseline of
pre-existing errors** and CI fails on any **increase**. PB-009 applies the same doctrine to
the newly covered test surface rather than pretending it is clean.

| Guard | Baseline file | Scope | Current |
|---|---|---|---|
| `npm run typecheck:ci` (pre-existing, **required** check) | `scripts/typecheck-baseline.json` | aggregate of `tsconfig.json` (0) + `tsconfig.backend.json` (0) + `tsconfig.scripts.json` (**0**) | **0 actual vs baseline 0 → PASS (3/3 projects clean)** |
| `npm run typecheck:certification` (PB-009, scalar) | `scripts/typecheck-certification-baseline.json` | `tsconfig.backend.json` = **1**, `tsconfig.backend-tests.json` = **443** (PB-011 lowered it 470→443) | at baseline |
| `npm run typecheck:certification` (PB-011, per-error identity) | `scripts/typecheck-certification-fingerprints.json` | every individual diagnostic on both projects: 1 + 443 fingerprints | at baseline |

> **Current-state note (TYPECHECK-CLEAN-001, 2026-08-05).** The `typecheck:ci` aggregate baseline is
> now **0** and all three of its projects are clean (`tsconfig.json` 0 / `tsconfig.backend.json` 0 /
> `tsconfig.scripts.json` 0). **Any future `error TS` on this surface is a true regression, not
> accepted debt.** The residual 47 (**TD-001**) were removed by fixing three root causes with no
> suppressions, no `any`, and no compiler-option changes: 9 scripts compiled as GLOBAL scripts
> (no top-level import/export) were declared modules with `export {};`, which cleared 17 direct
> collisions and 24 cascade errors; a falsy test on a boolean-discriminated union in
> `scripts/ops/railwayEnvAudit.ts` (which cannot narrow because the root tsconfig sets
> `strict: false`) moved to the canonical `'reason' in x` form; and `scripts/verify-materialization.ts`
> replaced a direct `CreatorTemplate → Record<string, unknown>` assertion with the canonical double
> assertion via `unknown` plus a `string[]` annotation. This does **not** touch the certification
> surface, which still carries **443** genuine `tsconfig.backend-tests.json` errors under its own
> governed re-baselining process.
>
> **Historical (DOC-HYGIENE-001, 2026-07-26).** The aggregate baseline was previously
> lowered **86 → 47** after TECH-DEBT-001 brought `tsconfig.json` (frontend) and
> `tsconfig.backend.json` (backend/API) to **0**. The certification baseline still records
> `tsconfig.backend.json` = 1 (the now-fixed `pages/api/company-profile/index.ts` error); actual is 0,
> so a re-lock to 0 is pending (**TD-006**). Historical run figures in older PMO records (`PB-012`,
> `PROGRAM-A-ENGINEERING-BASELINE`, `RELEASE-READINESS-001`) predate these reductions.

The two guards are deliberately **separate**. The PB-009 surface carries hundreds of
pre-existing errors; folding it into the aggregate would have required **raising** the
`typecheck:ci` baseline, which that file's own contract forbids. `typecheck:ci` and
`scripts/typecheck-all.js` are therefore left byte-for-byte unchanged.

A baseline may only ever be **lowered**, in a dedicated reviewed commit. Gaming a count with
blanket `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or by excluding the files
that fail is **out of contract**. The coverage assertion in §4 exists precisely so that
excluding a failing file **fails the check** instead of lowering the number.

### 3a. Why a count is not enough (PB-011)

A scalar total answers *how many* errors exist. It cannot answer *which*. That gap is
exploitable without any bad intent:

> Fix one baselined error and introduce a different one. The total is unchanged, the gate is
> green, and brand-new type debt is now permanently inside the baseline.

That is how PB-005/PB-008 landed 4 type errors in this surface with nobody attributed. PB-011
therefore gives every diagnostic a **stable identity**:

```
fingerprint = (repo-relative file path, TS error code, normalized message)   + count per bucket
```

- **Line and column are deliberately excluded.** They shift whenever anything above the error
  is edited. A line-keyed baseline would report a storm of false "new errors" on every commit
  and would be regenerated until it meant nothing.
- **Counts per bucket** preserve duplicates, so three identical errors in one file cannot
  quietly become four.
- **Net-new** = a fingerprint absent from the baseline, *or* present but exceeding its
  baselined count → **FAIL**, even when the scalar total is unchanged.
- **Reductions are never punished.** A fingerprint that disappears is debt paid; the run
  **PASSES** and prints a re-baseline instruction.
- **Existing debt is informational.** Everything in the baseline is grandfathered and never
  fails a build.

**Attribution.** Net-new errors are matched against the files this change touched
(`--base <ref>` / `TYPECHECK_ATTRIBUTION_BASE`, else `GITHUB_BASE_REF` in CI, else the working
tree vs `HEAD` including untracked files). A net-new error in a touched file is reported
`[ATTRIBUTED]`; one in an untouched file is reported `[UNATTRIBUTED]` as a cascade from an edit
elsewhere. **Attribution is evidence, never an escape hatch — an unattributed net-new error
still fails.**

**Re-baselining is a governance act, not a build step.** Both artifacts are regenerated only by
`npm run typecheck:certification:baseline`, which:

- **refuses to run under CI** (`CI` env set) — the ratchet can never absorb what a build
  produced;
- **refuses to raise** a scalar total — it ratchets down only;
- **refuses to absorb a net-new fingerprint** unless `--accept-new-debt` is passed explicitly,
  in which case every absorbed fingerprint is printed so it appears in the review record;
- writes **both** artifacts together. The guard cross-checks that
  `typecheck-certification-baseline.json`'s totals equal
  `typecheck-certification-fingerprints.json`'s enumerated totals and **fails if they
  disagree**, so a half-update cannot reopen the scalar hole.

The four PB-005/PB-008 errors are **grandfathered**: the count-only baseline recorded no
identity for them, so they cannot be retroactively attributed. Attribution starts here.

## 4. Which command to run for which change

| You changed… | Run |
|---|---|
| `pages/**`, `components/**`, `lib/**` | `npx tsc -p tsconfig.json --noEmit` |
| `backend/**` production code (incl. a module nothing imports yet) | `npx tsc -p tsconfig.backend.json --noEmit` |
| `scripts/**` | `npx tsc -p tsconfig.scripts.json --noEmit` |
| **any test file** (`backend/tests/**`, `*.test.ts(x)`, `*.spec.ts(x)`, `__tests__/**`) | `npm run typecheck:backend-tests` |
| anything, before pushing | `npm run typecheck:ci` **and** `npm run typecheck:certification` |

`npm run typecheck` runs the three pre-existing projects honestly (every project runs even if
an earlier one fails). `npm run typecheck:certification` additionally proves **coverage**:

- it enumerates backend production files and backend test files **from disk**;
- it asserts each appears in the corresponding `tsc --listFiles` program;
- it then compares per-project error counts to the committed baselines.

- it then compares every individual diagnostic against the committed **fingerprint** baseline
  and fails on any net-new identity, attributing it to the changed files where possible.

`npm run typecheck:certification:inventory` adds the grouped error breakdown (by TS code and
by file) used to produce §3's numbers.
`npm run typecheck:certification:baseline` re-baselines **both** artifacts — deliberately,
locally, and never in CI (see §3a).

## 5. Known residual gaps (documented, not hidden)

1. **Non-backend tests are still unchecked.** `tests/stability/**` (run by
   `jest.stability.config.js`) and any `*.test.ts(x)` outside `backend/**` remain excluded by
   every project. PB-009 scope was the backend surface; the same pattern extends to them.
2. **`strict: false` repo-wide, and strictness would RAISE the number.** The 470 baseline is
   what a *non-strict* check finds. PB-011 measured the test project again with
   `--strictNullChecks` (TypeScript 5.9.2, 2026-07-21): **total 470 → 595 (+125, +27%)**.
   TS2339 does fall **227 → 156** (−71, ≈15% of the backlog) because boolean-discriminated
   unions finally narrow — PB-010's underlying insight is real — but PB-010's figure of
   "117 false positives / 227 → 110" does **not** reproduce, and the relief is more than
   cancelled by codes that only exist or expand under strictness (TS2322 49 → 94,
   TS2345 33 → 89, TS2352 74 → 81, TS18048 26 → 40, plus new TS18047 23, TS2571 18,
   TS18049 18, TS2454 6, TS2783 4, TS18046 4, TS2698 2, TS2739 1).
   **`strictNullChecks` is a debt-*disclosure* lever, not a debt-*reduction* lever**: it
   reveals ~125 real null/undefined hazards the current configuration hides. Raising
   strictness is a separately budgeted remediation programme, not a shortcut to a lower
   number. PB-011 changed no strictness setting and no tsconfig.
3. **Cross-file global collisions — RESOLVED by PB-010.** Test files with no top-level
   `import`/`export` are global *scripts*, so `tsc` saw one shared global scope across the
   corpus and reported duplicate identifiers (TS2451 / TS2393) between unrelated suites. Jest
   isolates each file as a module, so these were never runtime defects. PB-010 added
   `export {}` to 9 such files, clearing 32 collisions plus 5 collateral errors and taking
   the baseline 508 → 470.
4. **The certification guard RUNS in CI (PB-012) but does not yet BLOCK a merge.**
   `.github/workflows/typecheck-certification.yml` runs `npm run typecheck:certification` on
   **every pull request**, on pushes to `main`, and on demand, under the job name
   **`Backend TypeScript certification`**. It fails the job on net-new type debt, a coverage
   regression, a parser-integrity failure, or a baseline/fingerprint inconsistency, and
   publishes the report to the job summary.
   **A workflow makes a check run; it cannot make it required.** Blocking a merge requires an
   owner to register the job name `Backend TypeScript certification` as a required status
   check on the `main` branch-protection rule. Until that admin action is performed a red run
   is **advisory** — a PR can still be merged over it. See
   `docs/pmo/PB-012-certification-pipeline-enforcement.md` §8 and
   `docs/ENGINEERING-GOVERNANCE.md` §4 promotion criteria. Do **not** rename that job:
   branch protection keys on the job name.

## 6. Files that implement this strategy

- `tsconfig.backend-tests.json` — the test-surface project.
- `scripts/typecheck-certification.js` — coverage assertion + scalar non-regression guard +
  per-error identity ratchet + attribution + the guarded re-baseline command.
- `scripts/lib/typecheckFingerprint.js` — pure fingerprinting, net-new diffing and attribution
  (PB-011). Every decision function is side-effect free and directly exercisable.
- `scripts/typecheck-certification-baseline.json` — the committed scalar baselines.
- `scripts/typecheck-certification-fingerprints.json` — the committed per-error identity
  baseline. Regenerate only with `npm run typecheck:certification:baseline`.
- `package.json` — `typecheck:backend-tests`, `typecheck:certification`,
  `typecheck:certification:inventory`, `typecheck:certification:baseline`.
- `.github/workflows/typecheck-certification.yml` **(PB-012)** — runs the guard on every pull
  request and on pushes to `main`, job name `Backend TypeScript certification`. Propagates the
  guard's exit code (`set -o pipefail` through `tee`; no `continue-on-error`, no `|| true` on
  the gate), publishes a job summary and uploads the report. Exports `CI=true`, so a
  re-baseline can never run there. **Advisory until registered in branch protection.**
- Pre-existing and **unmodified**: `scripts/typecheck-all.js`,
  `scripts/typecheck-baseline.js`, `scripts/typecheck-baseline.json`, `tsconfig.json`,
  `tsconfig.backend.json`, `tsconfig.scripts.json`, `jest.config.js`.

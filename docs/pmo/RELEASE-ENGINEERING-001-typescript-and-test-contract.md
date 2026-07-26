# RELEASE-ENGINEERING-001 — Release Gates & Test Classification (companion)

**Owner:** Repository Reliability · **Status:** **companion** to the canonical TypeScript guide · **Scope:** repository hygiene / developer experience only (no product behavior).

> **Canonical TypeScript reference.** The `tsconfig` projects, their scope, and every baseline are
> defined **once** in **`docs/TYPESCRIPT-VALIDATION-STRATEGY.md`** — do not restate them here. This
> companion covers what that guide does not: the **release-gate operational summary**, the
> **test-tier classification** (infrastructure failure vs code regression), and the **per-branch
> certification checklist**.

---

## 1. TypeScript projects (defined in the canonical guide)

The repository has seven `tsconfig` projects; their purpose, surface, and baselines live in the
canonical guide (`docs/TYPESCRIPT-VALIDATION-STRATEGY.md` §1 & §3). In one line:
**production correctness = `tsconfig.build.json` (frontend bundle) + `tsconfig.backend.json`
(backend/API) + `tsconfig.worker.json` (worker)**; `tsconfig.json` / `tsconfig.scripts.json` /
`tsconfig.backend-tests.json` are CI/dev gates; `backend/tsconfig.json` is legacy and unreferenced
(TECH-DEBT **TD-004**). Never certify "clean" against a single project.

---

## 2. Release Gates

| Gate | Command | What it enforces | Failure semantics |
|---|---|---|---|
| **Production build** | `npm run build` → `scripts/safe-build.js` → `next build --webpack` | Frontend bundle compiles & type-checks (`tsconfig.build.json`); no `ignoreBuildErrors` | Hard fail |
| **TS non-regression baseline** | `npm run typecheck:ci` → `scripts/typecheck-baseline.js` (runs `typecheck-all.js` over root+backend+scripts) | Total `error TS` count **never increases** above `scripts/typecheck-baseline.json` | `actual > baseline` → FAIL; `actual < baseline` → PASS + "lower the baseline"; blanket `any`/`@ts-ignore` to game the count is **out of contract** |
| **Backend TS certification** | `npm run typecheck:certification` → `scripts/typecheck-certification.js` | Per-error **fingerprints** + per-project scalar counts for `tsconfig.backend.json` / `tsconfig.backend-tests.json` (`scripts/typecheck-certification-{baseline,fingerprints}.json`) | New fingerprint or count increase → FAIL; debt reduction → informational (prints re-baseline command) |
| **Worker compile** | `tsc -p tsconfig.worker.json --noEmit` (in `typecheck-baseline.yml`) | Worker (commonjs) type-safety | Hard fail |
| Migration / SSRF / tenant-authz guards | `check:migrations`, `check:ssrf`, `check:authz` | Non-TS release safety | Hard fail |

**Rule for contributors:** never certify "clean" against a single tsconfig. Production readiness = **build gate (`tsconfig.build.json`) + backend certification (`tsconfig.backend.json`) + non-regression baseline + worker compile**, all green.

### Baselines & how to lower them
- `scripts/typecheck-baseline.json` — a single scalar (root+backend+scripts). Lower it in a **dedicated commit** when debt is genuinely fixed (the guard prints the exact number). Never raise it to absorb new errors.
- `scripts/typecheck-certification-baseline.json` — per-project (`tsconfig.backend.json`, `tsconfig.backend-tests.json`); update via `npm run typecheck:certification:baseline` (refuses to run under `CI` or to raise a total).

---

## 3. Test Classification & Infrastructure Dependencies

`npm test` = `jest backend/tests --runInBand --forceExit`. Suites fall into tiers by their runtime dependency. **A suite that fails because a dependency below is absent is an INFRASTRUCTURE failure, not a code regression.**

| Tier | Characteristics | Runs green in bare `npx jest`? | Examples |
|---|---|---|---|
| **Pure unit** | No I/O; pure functions / in-memory; supabase not touched or fully mocked | ✅ yes | competitor engine, candidate assembly, entity archetype, report intelligence, business classification, conversation orchestrator, knowledge graph, strategic-narrative compatibility |
| **Mocked-environment** | Mocks `db/supabaseClient` / `axios` at module top | ✅ yes (if the mock is complete) | `reportCompetitorIntelligenceService.test.ts` (mocks supabase + axios) |
| **Seeded-database / infrastructure** | Reaches a live/seeded Supabase (**`getAdminClient` → `backend/db/supabaseClient.ts`**, project `klkiseupptzbecbxwrky`), `ownedDbTable`/`writeOwner`, Redis, or external HTTP | ❌ **no** — needs the seeded **certenv** Supabase (`:54321`/`:54322`) or CI secrets | most `backend/tests/integration/**`; unit suites hitting the admin client (creator*, campaign/scheduling, payment webhooks, `companyContextFoundationFix`, recommendation engine/scheduler) |
| **External-dependency** | Calls real external APIs (SERP, provider LLMs, webhooks) | ❌ no | `external_api_*`, `community_ai_*` |

**Diagnosing a failure (decision rule):**
1. Grep the suite output for `getAdminClient`, `supabaseUrl: 'klkiseupptzbecbxwrky…'`, `… is not a function` (partial supabase mock), `ECONNREFUSED`, `@/config throws` → **Infrastructure**, not a regression.
2. If the failure is an **assertion/snapshot** mismatch in code the change **touched** → investigate as a possible regression.
3. Cross-check: does the branch diff touch the failing suite's source **or** shared infra (`backend/db/**`, `config/**`, `writeOwner`, jest setup)? If **no**, it cannot be a regression of that change.

**Known-parked infrastructure suites** (documented pre-existing red without the seeded env): `recommendationEngineCharacterization` (PRODUCT-RELEASE-001), db-replay CI (parked), secret-gated Auth Integrity (parked). See the TECH-DEBT register.

---

## 4. Certification Process (per branch, before merge)

1. **Build gate:** `npm run build` (or at minimum `tsc -p tsconfig.build.json --noEmit`) → clean.
2. **Backend/API:** `tsc -p tsconfig.backend.json --noEmit` → clean (or certification gate green).
3. **Non-regression:** `npm run typecheck:ci` → `actual ≤ baseline`.
4. **Tests:** run the suites your change touches (pure/mocked tiers) → green. Full-suite green requires the **seeded certenv Supabase** — a bare `npx jest` will show ~50 infrastructure-tier failures that are **not** regressions (verify via the decision rule in §3).
5. **Hygiene:** clean working tree, no conflict markers, intended commits only.
6. Record which tsconfig(s) and test tiers were exercised so reviewers can reproduce.

---

## 5. Change Log
- **DOC-HYGIENE-001 (2026-07-26):** established `docs/TYPESCRIPT-VALIDATION-STRATEGY.md` as the single **canonical** TypeScript/baseline reference; retired this document's duplicated tsconfig/baseline tables (now §1 pointer) and re-scoped it as the **companion** for release gates + test classification + certification process. TD-008 (Resolved).
- **RELEASE-ENGINEERING-001 (2026-07-26, TECH-DEBT-001):** created the release-gate / test-classification guide. Resolved the 5 legacy frontend type errors across 3 files (BoltCreatorViewMain / LeadsViewMain missing hook type-imports → cascaded `unknown` errors; companyProfileFormController `uiConfidenceScored` passthrough — a latent "Profile confidence" display bug). Root `tsconfig.json` and `tsconfig.backend.json` now both compile **clean (0)**. Non-regression baseline `typecheck-baseline.json` lowered **86 → 47** (the residual 47 is entirely `tsconfig.scripts.json` tooling debt — TD-001). Backend `index.ts` scrub-cast error was resolved earlier in BASELINE-HYGIENE-003 (re-baseline `tsconfig.backend.json`→0 pending — TD-006).

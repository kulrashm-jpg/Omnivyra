# RELEASE-FINAL-BLOCKER — Clean Release Artifact Certification

**Date:** 2026-08-05
**Branch:** `feat/sec001-auth-enforcement-phase1` @ `b69e2639` (local; origin still at `e02e2f23`)
**Method:** genuine clean checkout — `git worktree` at HEAD, real `npm install`, no working-tree assumptions

## VERDICT: ⛔ NO GO

One blocker qualifies. It is **not** the blocker this task was opened to close — that one is resolved — but a new one this release introduces, which the clean-room build surfaced.

---

## 1. Audit of `fefd369c` (Task 1)

`fefd369c feat(seo): OPT-006 marketing metadata and blog ISR` added `components/seo/MarketingPageMeta.tsx` and `backend/services/blog/publicBlogRead.ts` but did **not** add `lib/siteUrl.ts` or `public/logo.webp`.

**Status: already resolved.** A concurrent session committed both files while RELEASE-CERT-001 was being written. Verified: `git ls-files` now tracks `lib/siteUrl.ts` and `public/logo.webp`. HEAD advanced three times during this task (`729650e5` → `30eabb5d` → `b69e2639`).

Repository-wide integrity scan over **6,394 tracked build-graph files** (`pages/`, `components/`, `lib/`, `backend/` excl. tests), resolving every relative and `@/` import against the **tracked** set:

| Category | Result |
| --- | --- |
| Missing source files | **0** |
| Missing modules | **0** |
| Missing assets | **0** blocking (see below) |
| Missing static resources | **0** |
| Missing configuration | **0** |

Four apparent hits were verified individually and are all **docblock usage examples** (` * import { x } from '...'`), not real imports: `bullmqClient.ts`, `recommendationStressTests.ts`, `sendAuthError.ts` (×2).

Non-blocking asset findings, deliberately not "fixed":

* `/logo-white.png` — referenced by `components/growth/SharedPageCTA.tsx`, which is **imported by nothing** and guards the tag with `onError` that hides it. Dead code, self-healing. Removing the reference would be refactoring, which this task excludes.
* `/blog/rss.xml`, `/blog/sitemap.xml` — **rewrites** in `next.config.js` to `/api/blog/rss` and `/api/blog/sitemap`, not static files. False positives.
* `/sitemap.xml`, `/favicon.ico`, `/.well-known/omnivira.txt` — URLs fetched from **remote** customer sites by adapters, not local assets.

## 2. Resolution applied (Task 2)

One real instance of the defect class remained, and it was introduced by this session's own MEDIA-SEC-001 work: `backend/services/mediaAuthorization.ts` was **untracked** while three modified routes imported it.

Worse, HEAD still contained the **unauthenticated** media routes — certifying it as-is would have certified the exact vulnerability RELEASE-CERT-001 Blocker 2 identified.

**Category A — should have been committed.** Committed atomically as `b69e2639` (6 files, targeted pathspec, no other session's work swept in). Splitting the helper from its routes is precisely what leaves a broken import, so the unit is indivisible.

No reference was removed anywhere; no broken import or broken asset is left behind.

## 3. Fresh checkout validation (Task 3)

| Gate | Result |
| --- | --- |
| `npm install` | ✅ exit 0 |
| `npm run typecheck:ci` | ✅ **PASS — baseline 47 / actual 47**, no regression |
| `npx next build` — compile | ✅ **`Compiled successfully in 44.1min`** |
| `npx next build` — page data | ⛔ **FAILED** — `Failed to collect page data for /blog/[slug]` |
| `npm run lint` | ⚠️ 2 pre-existing errors (see §6) |

Notably the `components/creator/OutcomeGallery.tsx(50,85) TS17001` that has been the working tree's +1 all session is **not** in the committed artifact — it is an uncommitted edit. The artifact typechecks cleaner than the working tree.

### Two methodology corrections worth recording

1. **A discarded first build.** I initially junctioned `node_modules` from the main repo to skip install. It reported exit 0 but the log read `TurbopackInternalError: Symlink node_modules is invalid, it points out of the filesystem root`. That run proved nothing and was thrown away; the junction was removed and a real `npm install` performed.
2. **`next build` returns exit 0 on failure.** Every failing run here exited 0 while the log said `Build error occurred`. Any CI wired as `next build && deploy` would ship a failed build. **Read the log, not the exit code.**

An intermediate run also died in a Turbopack panic-handler (`Failed to open %TEMP%\next-panic-*.log`) with the disk at 96% / 10 GB free; retried with a dedicated temp dir and more headroom, which produced the clean compile above.

## 4. Repository integrity (Task 4)

| Check | Result |
| --- | --- |
| Broken imports | **NONE** |
| Broken asset references | none blocking (only the dead, self-healing `SharedPageCTA`) |
| Referenced untracked files | **NONE** — the last one was `mediaAuthorization.ts`, now committed |
| Missing modules | **NONE** — proven by `Compiled successfully`, which resolves the entire graph |
| Missing public assets | **NONE** blocking |

## 5. THE BLOCKER — new, unverified build-time environment dependency

The clean build compiled everything, then failed here:

```
✓ Compiled successfully in 44.1min
  Collecting page data using 3 workers ...
Error: SUPABASE_URL is missing in environment variables.
       Set SUPABASE_URL (not NEXT_PUBLIC_SUPABASE_URL) in your deployment env
> Build error occurred
Error: Failed to collect page data for /blog/[slug]
```

Mechanism — introduced by `fefd369c`:

```ts
export const getStaticPaths: GetStaticPaths = async () => {
  const { listRecentPublishedSlugs } = await import('.../blog/publicBlogRead');
  const slugs = await listRecentPublishedSlugs(50);      // ← queries Supabase DURING next build
  ...
};
```
`publicBlogRead` imports `backend/db/supabaseClient`, which **throws** when `SUPABASE_URL` is absent.

**Why this qualifies, and why it is not merely my sandbox's missing env:**

`pages/blog/[slug].tsx` and `pages/blog/index.tsx` are the **only** statically-generated pages at HEAD, and **neither used `getStaticProps`/`getStaticPaths` before `fefd369c`** (verified: 0 occurrences at `fefd369c~1`). Therefore **no previous successful Vercel deploy ever exercised a build-time database dependency.** The fact that past deploys succeeded is *no evidence* that `SUPABASE_URL` is configured, because until this release nothing needed it at build time.

Two new build-time couplings ship together here:

1. `SUPABASE_URL` must exist in the Vercel build environment — and it is **distinct from** `NEXT_PUBLIC_SUPABASE_URL`, which *is* set. The error text calls this out explicitly, which suggests it has bitten before.
2. The database must be **reachable from the Vercel build**. A DB blip during build now fails the deploy, where previously it could not.

| Criterion | Met |
| --- | --- |
| Reproducible | ✅ reproduced exactly, twice |
| Production-impacting | ✅ Vercel build fails ⇒ no deploy |
| Not already documented | ✅ RELEASE-CERT-001 listed `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `BRIDGE_COOKIE_SECRET` — not `SUPABASE_URL`, and not as a *build-time* requirement |
| Not a future enhancement | ✅ |

I could not verify Vercel's environment: the working tree is not linked to a Vercel project (`vercel env ls` → *"Your codebase isn't linked to a project"*, and `.vercel` was just added to `.gitignore`).

**Unblock — one check, then one re-run:**
1. Confirm `SUPABASE_URL` exists in the Vercel **Production** environment (per the standing note, `vercel env pull` shows empty values — verify via `vercel env ls`).
2. If absent, add it. If present, re-run `next build` to confirm page-data collection completes.

Optional hardening (a *future enhancement*, not a blocker): make `getStaticPaths` degrade to `paths: []` with `fallback: 'blocking'` when the DB is unavailable, so a build-time outage cannot fail a deploy. ISR would populate pages on first request.

## 6. Regression (Task 6)

| Gate | Result |
| --- | --- |
| Build | compile ✅ / page data ⛔ (§5) |
| Typecheck | ✅ 47/47 on clean checkout |
| Lint | ⚠️ `npm run lint` exits 1 — 2 errors in `backend/evaluation/canonicalGrounding/liveRunner.ts` |
| Release smoke (jest) | ✅ 1232 passed, 2 failed — both known pre-existing |
| MEDIA-SEC-001 suite | ✅ 25/25 post-commit |

The lint errors are **false positives**: the rule forbids inline `Authorization: Bearer` in *client* code and directs callers to `lib/apiFetch.ts`, but `liveRunner.ts` is a backend evaluation harness calling the **OpenAI** API with an OpenAI key. Pre-existing (`20b8244f`), not in the Next build graph, and **no CI workflow runs `npm run lint`** — the workflows are `typecheck-baseline`, `typecheck-certification`, and `website-intelligence-production-readiness`. Hygiene, not a gate.

## 7. Rollback

* **MEDIA-SEC-001 commit:** `git revert b69e2639`, or `git reset --hard 30eabb5d`. Local only — `origin` is still `e02e2f23`. Exactly 6 files; each route's guard is independent.
* **Reverting re-opens** the unauthenticated cross-tenant media API. The fix's failure mode is availability (a wrong guard 404s a legitimate user), never exposure.
* **The §5 blocker needs no code rollback** — it is an environment variable.
* No migrations, no schema, no flags, no client changes anywhere in this work.

## 8. Release artifact certification (Task 5)

| Requirement | Status |
| --- | --- |
| Clean checkout succeeds | ✅ install + typecheck + **full compile** |
| Vercel build succeeds | ⛔ **UNVERIFIED** — blocked on `SUPABASE_URL` (§5) |
| All static pages compile | ⚠️ compilation ✅; **page-data collection unproven** for the 2 ISR pages |
| All metadata resolves | ✅ `MarketingPageMeta` + `lib/siteUrl.ts` resolve; the original blocker is closed |

## FINAL RELEASE CERTIFICATION

# NO GO

The artifact is now **internally consistent** — it has no missing files, no broken imports, no referenced untracked files, and it compiles end to end from a clean checkout. The blocker this task was opened to close is genuinely closed.

It is held by one newly-surfaced item: this release makes `next build` depend on `SUPABASE_URL` and on database reachability for the first time, and that dependency is unverified in the deployment environment. It is an environment check, not a code change — likely minutes to clear, after which the artifact should certify GO.

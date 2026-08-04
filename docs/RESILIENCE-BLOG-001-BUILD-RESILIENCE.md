# RESILIENCE-BLOG-001 — Blog Build-Time Resilience

**Status:** implemented, uncommitted (local only)
**Date:** 2026-08-05
**Scope:** `pages/blog/[slug].tsx` → `getStaticPaths` failure path only

---

## 1. Verification that `paths: []` is safe (Task 1)

Three properties, each verified against the repository:

| # | Claim | Evidence |
| --- | --- | --- |
| 1 | Nothing else consumes the prebuilt list | `listRecentPublishedSlugs` has **exactly one** call site repo-wide: `pages/blog/[slug].tsx:224` |
| 2 | SEO coverage does not derive from prebuilt paths | `pages/api/blog/sitemap.ts` and `rss.ts` query `supabase` **themselves at request time**; `next.config.js` rewrites `/blog/sitemap.xml` → `/api/blog/sitemap` |
| 3 | An on-demand page is byte-identical to a prebuilt one | `getStaticProps` re-fetches by slug (`getPublishedBlogPost(slug)`) with no dependency on `getStaticPaths`; unknown slugs return `notFound: true, revalidate: 300` on both routes |

With `fallback: 'blocking'`, any slug not in `paths` is generated on first request and then cached — the same `getStaticProps` runs either way. The prebuild is therefore an **optimization**, not a correctness requirement.

No existing test asserts on the prebuilt path list.

## 2. Change (Task 2)

`pages/blog/[slug].tsx`, **34 insertions / 2 deletions**, all inside `getStaticPaths` plus its docblock.

```ts
let slugs: string[] = [];
try {
  const { listRecentPublishedSlugs } = await import('.../publicBlogRead');
  slugs = await listRecentPublishedSlugs(50);          // ← unchanged
} catch (error) {
  if (!prebuildFailureLogged) { prebuildFailureLogged = true; console.warn(...); }
  slugs = [];
}
return { paths: slugs.map((slug) => ({ params: { slug } })), fallback: 'blocking' };
```

The success path is byte-identical: same dynamic import, same `50`, same mapping, same `fallback`. `console.warn` is used rather than a logger import so nothing new enters the page's module graph — matching the existing `await import()` discipline in this file.

The `prebuildFailureLogged` module flag implements "log once": the function runs once per build, but dev re-invokes it.

## 3. What was deliberately NOT touched (Tasks 3, 4)

| Item | State |
| --- | --- |
| `pages/blog/index.tsx` | **untouched** — `git status` clean. Its build dependency is intentional and it cannot render without its rows |
| `backend/services/blog/publicBlogRead.ts` | **untouched** — still throws on DB error, by design |
| `fallback` | unchanged (`'blocking'`) |
| `getStaticProps` | unchanged — still propagates DB errors, so an ISR revalidation failure keeps serving the last good page |
| routing, SEO, metadata, canonical URLs, runtime rendering, blog content | unchanged |

Confirmed mechanically: the only `+` lines in the diff mentioning `getStaticProps`, `fallback`, `revalidate` or `notFound` are documentation; there are no `-` lines for any of them.

## 4. Behaviour comparison

| Scenario | Before | After |
| --- | --- | --- |
| DB reachable, posts exist | 50 slugs prebuilt, `fallback: 'blocking'` | **identical** |
| DB reachable, no posts | `paths: []`, build succeeds | **identical** (and no log — empty is not a failure) |
| DB unreachable during build | **this page fails**, deploy blocked | logs once, `paths: []`, **this page** succeeds; pages generated on first request via ISR |

> **Correction (certification pass).** An earlier version of this row said "build
> succeeds". That is wrong at the build level and contradicted §6. `pages/blog/index.tsx:205-209`
> calls `listPublishedBlogPosts` twice with no error handling, and that function
> throws on DB error (`publicBlogRead.ts:53-58`), so a database outage during
> `next build` **still fails the build** — now at `/blog` rather than
> `/blog/[slug]`. Leaving `index.tsx` untouched was an explicit instruction of
> the program, so this is a scope consequence, not a defect. The realized gain
> is narrower than "the build survives a DB outage": it covers only failures
> that affect the 50-row slug query without affecting the 1- and 4-row list
> queries (e.g. a size- or timeout-sensitive failure).
| First request for a non-prebuilt slug | `getStaticProps` runs, page cached | **identical** |
| Unknown / unpublished slug | real 404 + `revalidate: 300` | **identical** |
| ISR revalidation fails at runtime | error propagates, last good page still served | **identical** |

The only cell that changed is the one that previously failed the build.

## 5. Regression (Task 6)

Scoped to blog / SEO / routing / metadata / build, as instructed — no unrelated suites:

**26 suites, 247 tests, 0 failures.**

New characterization suite `backend/tests/unit/resilienceBlog001StaticPaths.test.ts` — **14 tests**:

* success path: exact slug→path mapping and order; still requests 50; no log; empty DB yields `paths: []` without logging
* failure path: resolves instead of throwing; `paths` empty; `fallback` still `'blocking'`; logs exactly once across repeated invocations; log suppressed on later failures while still failing open; non-`Error` rejections handled
* runtime unchanged: `getStaticProps` resolves by slug with `revalidate: 300`; unknown slug → `notFound`; blank slug short-circuits without querying; **DB errors still propagate** from `getStaticProps`

One test needed `jest.isolateModules` — the "log once" flag is module-level, so earlier failure cases in the file had already consumed the single permitted log. That is the behaviour under test, not a defect.

Typecheck gate: **PASS** (exit 0 — at baseline). ESLint on changed files: **exit 0**.

## 6. Risk assessment

| Risk | Assessment |
| --- | --- |
| A real outage is masked and ships silently | **Low, and bounded.** The build now succeeds with zero prebuilt pages, but every page is still produced by ISR on request. The failure is announced on stderr during the build. `pages/blog/index.tsx` still fails loudly, so a total DB outage at build time still blocks the deploy through that page |
| Cold-start latency on first request | Real but pre-existing: this is exactly what `fallback: 'blocking'` already did for any post outside the 50 most recent |
| SEO regression | None. Sitemap and RSS query the DB independently at request time; canonical/OG/JSON-LD live in `getStaticProps` output, which is unchanged |
| Swallowing a programming error, not just a DB blip | The `catch` is broad. Mitigated by the log and by `getStaticProps` remaining strict — a genuine code fault surfaces on the first page request rather than being hidden |

## 7. Rollback

Single file, no dependencies. `git checkout -- "pages/blog/[slug].tsx"` restores the previous fail-closed behaviour; delete `backend/tests/unit/resilienceBlog001StaticPaths.test.ts`. No migrations, schema, flags, config, or client changes. Reverting cannot affect runtime, because runtime was never changed.

## 8. Statement

> **No runtime behavior changed. Only the build-time optimization became fail-open.**

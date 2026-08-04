# RESILIENCE-BLOG-002 — Blog Index Build Resilience: Decision Record

**Date:** 2026-08-05
**Outcome:** no code change. `pages/blog/index.tsx` stays fail-fast.
**Decision:** KEEP FAIL-FAST → NO CHANGE RECOMMENDED

---

## 1. Root cause (Task 1, verified from source)

```
next build → Collecting page data → pages/blog/index.tsx
  getStaticProps                                        index.tsx:205
    await Promise.all([
      listPublishedBlogPosts({ featuredOnly: true, limit: 1 }),   index.tsx:208
      listPublishedBlogPosts({ limit: 4 }),                        index.tsx:209
    ])                                     ← NO try/catch anywhere
      listPublishedBlogPosts               publicBlogRead.ts:36
        supabase.from('public_blogs')      publicBlogRead.ts:40  (service-role client)
        if (error) throw                   publicBlogRead.ts:53-58
          supabase → backend/db/supabaseClient
            getSupabaseConfig() throws if SUPABASE_URL / SERVICE_ROLE_KEY absent   supabaseClient.ts:49,52
```

Two independent failure modes reach an unhandled rejection in `getStaticProps`: client construction (missing env) and query error (unreachable/failing database). Either fails `next build`.

**Confirmed:** a transient database failure still fails the build, at `/blog`.

## 2. Is the failure functionally necessary? (Task 2)

| Question | Answer | Source |
| --- | --- | --- |
| Does the index require data to render? | **No** | `{featured && …}` (line 257) and `{supporting.length > 0 && …}` (line 259) are both guarded |
| Could an empty page render safely? | **Yes** | Lines 268-274 contain a purpose-built empty state: *"No public intelligence notes are available yet."* |
| Would an empty page violate existing UX? | **No** | That empty state is designed UI, and it is **already reachable today**: an empty `public_blogs` table returns `[]` without throwing (`publicBlogRead.ts:59`), so the build already succeeds and renders it |
| Would SEO regress? | **No** | `pages/api/blog/sitemap.ts` emits `/blog` unconditionally and degrades to zero post URLs; sitemap and RSS query the DB themselves at request time |
| Would metadata regress? | **No** | `metaTitle`/`metaDesc` are hardcoded literals (lines 222-223); `MarketingPageMeta` derives canonical from `SITE_URL + path` only |
| Would structured data regress? | **No** | The index page emits **no** JSON-LD at all |
| Would the page become misleading? | **Yes — this is the real cost** | An error-induced empty render is *indistinguishable* from a genuinely empty journal. A visitor or crawler in that window is told there are no posts when there are |

So the failure is **not functionally necessary for rendering**. The objection is truthfulness, not capability.

## 3. Why no safe implementation exists (Tasks 3, 5)

**The blocking constraint: `getStaticProps` runs at BOTH build time and every ISR revalidation.** This is not an outside assumption — the repository states it at `publicBlogRead.ts:54-55`:

> *"Throw so an ISR revalidation failure keeps serving the last good page (and a build-time failure fails the build loudly instead of baking an empty journal)."*

A throw during revalidation makes Next.js keep serving the last good page. Catching it would return empty props and **replace a good cached page with an empty one** on any transient runtime blip. That is a runtime behavior change, which this program forbids.

This is precisely why RESILIENCE-BLOG-001 was safe and this is not: there the change was confined to `getStaticPaths`, which runs **only** at build time. `/blog` has no `getStaticPaths` to isolate — it is a static route whose only data hook is shared with runtime.

| Option | Runtime | SEO | Operational | Deployment | Changes product behavior? |
| --- | --- | --- | --- | --- | --- |
| **A.** Empty list + existing layout | **Breaks ISR guarantee** — a revalidation blip replaces the live page with the empty state | Empty `/blog` served ≤300s, self-healing | Silent degradation | Build survives | **Yes** |
| **B.** Maintenance/error state | Same ISR break, plus new UI | New state crawlers may index | — | Build survives | **Yes — redesign** |
| **C.** Skip prerender, rely on ISR | `/blog` is a static route with no `getStaticPaths`; "skipping" means converting to `getServerSideProps`, which removes ISR | Loses static caching | — | Build survives | **Yes — architecture change** |
| **D.** Return `notFound` | `/blog` becomes a 404 on a transient blip | **Severe** — 404 on the blog landing page | Worst option | Build survives | **Yes** |
| **E.** Keep fail-fast | Unchanged | Unchanged | Loud, immediate | Build fails on DB outage | **No** |

A build-phase guard (e.g. `NEXT_PHASE`) would in principle separate the two paths, but **no such mechanism exists anywhere in the repository** (verified: zero occurrences of `NEXT_PHASE` or `phase-production-build` in `pages/`, `components/`, `lib/`, `backend/`, `next.config.js`). Introducing one is an architecture change, and asserting its reliability inside the page-data worker without repository evidence would be speculation. Both are out of scope.

**Only option E preserves runtime behavior. Task 5's precondition is not met, so nothing was implemented.**

## 4. Product behavior assessment (Task 4)

**Fail-fast is intentional product behavior, not an implementation artifact.** `publicBlogRead.ts:53-58` documents both halves of the intent explicitly, and the throw is deliberate rather than an unhandled edge case.

Separately, an empty blog index **is** an accepted state: it has bespoke UI, it is already reachable with an empty table, the sitemap handles zero posts, and no test anywhere asserts the index contains posts. Those two facts are not in conflict — the product accepts *being* empty, but refuses to *claim* emptiness it cannot verify.

## 5. Consequence for RESILIENCE-BLOG-001

`/blog` and `/blog/[slug]` use the same client against the same table, so nearly any condition failing one fails the other. With the index still fail-fast, the practical build-resilience gain from BLOG-001 remains narrow: it covers only failures affecting the 50-row slug query but not the 1- and 4-row list queries. **A database outage during `next build` still fails the deploy.**

Closing that gap requires accepting a window in which `/blog` may state it has no posts when it does. That is a product decision, not an engineering one.

## 6. Regression (Task 6)

No files were changed by this program — verified: `git status` for `pages/blog/`, `backend/services/blog/`, and `pages/api/blog/` shows only `pages/blog/[slug].tsx`, which belongs to RESILIENCE-BLOG-001.

Affected suites re-run to confirm the baseline: **26 suites, 247 tests, 0 failures** (blog, SEO, routing, metadata, marketing, route-policy, sitemap, RSS, ISR).

Lint and typecheck were not re-run: with zero files changed, the tree is byte-identical to the state certified in RESILIENCE-BLOG-001 (ESLint exit 0, typecheck gate PASS at baseline).

## 7. Final recommendation

**NO CHANGE RECOMMENDED.** No implementation satisfies the constraints; hardening `/blog` necessarily degrades the ISR guarantee that a revalidation failure keeps serving the last good page.

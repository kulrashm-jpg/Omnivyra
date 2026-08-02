# OmniVYRA Performance Optimization Ledger

Single source of truth for the performance optimization effort. Always append; never overwrite history.

Last updated: 2026-08-02

## Overall Progress

- **Total Optimizations Identified:** 19
- **Completed:** 2 (OPT-001, OPT-014)
- **In Progress:** 0
- **Pending Approval:** 13
- **Pending Runtime Validation:** 7
- **Deferred:** 1
- **Blocked:** 2 (OPT-013 product sign-off, OPT-015 product decision)
- **Overall Estimated Performance Improvement:** 162 KB/view removed across 27 routes; homepage static HTML content 175 → 7,918 chars with full metadata restored. Aggregate estimate pending runtime baseline.
- **Overall Confidence:** 90% (static + production-build evidence; no runtime telemetry yet)

**Next optimization:** OPT-002 (`Cache-Control` on read-only API routes) — highest remaining ROI.

---

## ⛔ SECURITY HOLD — ALL CACHE WORK SUSPENDED

### SEC-001 — Unauthenticated cross-tenant data exposure (IDOR)
- **Status:** REMEDIATED IN CODE — Phase 0 implemented 2026-08-02 (see SEC-001-P0 in Implementation History). **Not yet deployed**; the cache hold stays until the guarded routes are live.
- **Priority:** 0 (above every performance optimization)
- **Confidence:** 95%

**Previously-vulnerable routes** (no auth, tenant id taken from the request, DB-backed data returned) — all four now guarded:

| Route | Tenant key | Enforcement (as of 2026-08-02) |
|---|---|---|
| `pages/api/companies/[id]/learnings.ts` | `req.query.id` | `resolveCompanyAccess` (Phase 0) |
| `pages/api/companies/[id]/efficiency-score.ts` | `req.query.id` | `resolveCompanyAccess` (Phase 0) |
| `pages/api/companies/[id]/outcome-history.ts` | `req.query.id` | `resolveCompanyAccess` (Phase 0) |
| `pages/api/governance/company-analytics.ts` | `req.query.companyId` | `resolveCompanyAccess` (Phase 0) |

**Architectural root cause:** `lib/platform/routeFactory.ts` (`createApiRoute`, used by 1272 routes) performs **no** authentication — it is documented as "Pass-through by construction", and `opts.use`, the reserved guard hook, is "Reserved for later waves; Batch A ships no middleware." `proxy.ts` likewise states auth "lives in individual API route handlers." **There is no global enforcement layer**, so a route without its own guard is genuinely open.

**Why this blocks caching:** adding `Cache-Control` to an unguarded tenant endpoint converts a latent auth gap into an actively exploitable, CDN-amplified cross-tenant leak. Caching must not precede remediation.

**Architecture design:** `docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md` — **v4, 2026-08-02** (v4 records the single-policy-per-route limitation found via `leads/index.ts` mixed GET/POST trust models; documentation-only, nothing blocked, revisit in Phase 2 planning). **v3, 2026-08-02.** Option D (declarative policy + fail-closed route factory) **approved**; v3 records Design Change v3: the Phase 0 "410 if no callers" rule is replaced by contract preservation — endpoints with no verified in-repo callers are guarded, never retired; API retirement is a separate lifecycle requiring independent evidence and approval.

**Migration roadmap:** Phase 0 (SEC-001 hotfix, independent) → Phase 1 (shadow mode) → Phase 2 (declare + enforce by category, absorbs the 68 Unknowns) → Phase 3 (deny-if-undeclared + CI gate). **Phase 0 implemented 2026-08-02. Phase 1 infrastructure (Task 3a) implemented 2026-08-02** (see SEC-001-P1a): policy schema + pure evaluator + observation gate (flag `route-policy-gate`, default off) + `check:route-policy` CI warn/inventory. First declarations (Task 3b) and Phases 2–3 awaiting go-ahead.

**Additional findings raised by that design work:** SEC-002 (`cron/report-automation.ts` — only cron route with no `CRON_SECRET` check), SEC-003 (`community-ai/webhooks.ts` — no signature verification found), SEC-004 (three coexisting super-admin mechanisms), SEC-005 (`debug/whoami.ts` exposed in production). Write-path routes (POST/PUT/PATCH/DELETE) remain **entirely unaudited**.

**Correction to the earlier figure:** the audit first reported ~288 unguarded GET routes. That was inflated by an incomplete guard inventory. After cataloguing all enforcement mechanisms (`withOrgAccess`, `withRBAC`, `enforceCompanyAccess`, `resolvePrincipal`, `resolveCompanyAccess`, `isSuperAdmin`, `resolveUserContext`, and 40+ `require*`/`assert*` guards), the accurate figure is **81 of 526 GET-only routes unguarded** — 445 are guarded.

---

## IMPLEMENTATION BACKLOG

### OPT-014
- **Title:** Restore homepage prerendered content + SEO metadata
- **Category:** Rendering / Core Web Vitals / SEO
- **Priority:** **1 (next)**
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 100%
- **Estimated Gain:** Homepage LCP no longer gated on JS boot + Supabase `getSession()`; restores `<title>`, meta description and FAQ JSON-LD to static HTML
- **Estimated Effort:** Low
- **Implementation Risk:** Medium — authenticated users hitting `/` would see marketing content briefly before redirect (today they see a blank page)
- **Dependencies:** None
- **Affected Files:** `pages/index.tsx`
- **Runtime Validation Required:** No (defect verified directly in the build artifact)
- **Regression Risk:** Content flash for authenticated users; hydration mismatch if the gate is restructured carelessly
- **Rollback Available:** Yes
- **Origin:** DISC-003, discovered during OPT-001 build verification

### OPT-001
- **Title:** Image payload reduction + CLS/LCP attributes
- **Category:** Images / Core Web Vitals
- **Priority:** 1
- **Status:** In Progress
- **Impact:** High
- **Confidence:** 95%
- **Estimated Gain:** ~178 KB off ~34 routes (logo re-encode); 80 images deferred off critical path; 88 CLS sources removed
- **Estimated Effort:** Low (1–2 h)
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** `public/logo.png` (+ new `public/logo.webp`), 34 files referencing `logo.png`, `components/creator/workflow/templatesPage/templatesWidgets.tsx`, ~30 further files containing raw `<img>`
- **Runtime Validation Required:** No (byte reduction directly measurable; CLS/LCP delta needs Lighthouse to confirm magnitude)
- **Regression Risk:** Layout shift if `width`/`height` added where CSS does not constrain size
- **Rollback Available:** Yes — git revert; `logo.png` retained as fallback

### OPT-002
- **Title:** `Cache-Control` on read-only API routes
- **Category:** API / Network
- **Priority:** 2
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 100% (absence verified: 37 of 1301 routes)
- **Estimated Gain:** Eliminates repeat network round-trips on navigation
- **Estimated Effort:** Low
- **Implementation Risk:** Medium — tenant-scoped responses must never reach a shared cache
- **Dependencies:** None
- **Affected Files:** `pages/api/**` (read-only GET handlers), `lib/platform/routeFactory.ts`
- **Runtime Validation Required:** No
- **Regression Risk:** Cross-tenant data exposure if `public` used instead of `private`
- **Rollback Available:** Yes

### OPT-003
- **Title:** Remove Supabase realtime/storage clients from `_app` baseline
- **Category:** JavaScript / Bundle
- **Priority:** 3
- **Status:** Pending Approval
- **Impact:** Medium
- **Confidence:** 85%
- **Estimated Gain:** 25–40 KB gzip off universal baseline
- **Estimated Effort:** Low
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** `lib/supabaseBrowser.ts`, upload call sites
- **Runtime Validation Required:** No
- **Regression Risk:** Breaks any realtime subscriber or storage caller not migrated
- **Rollback Available:** Yes

### OPT-004
- **Title:** `apiFetch` token memoization
- **Category:** Authentication / Network
- **Priority:** 4
- **Status:** Pending Approval
- **Impact:** Medium (revised down from High — see Revision Log R-001)
- **Confidence:** 85%
- **Estimated Gain:** Removes redundant localStorage read + JSON.parse + `processLock` chaining across 190 call sites
- **Estimated Effort:** Low
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** `lib/apiFetch.ts`, `utils/getAuthToken.ts`
- **Runtime Validation Required:** No
- **Regression Risk:** Stale token served after rotation if expiry handling is wrong
- **Rollback Available:** Yes

### OPT-005
- **Title:** Client data cache (SWR) with dedup + revalidation
- **Category:** Data Fetching / Navigation
- **Priority:** 5
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 100% (absence verified: no SWR/react-query in dependencies)
- **Estimated Gain:** Large — eliminates full refetch on every back-navigation
- **Estimated Effort:** High
- **Implementation Risk:** Medium
- **Dependencies:** Best sequenced after OPT-002 and OPT-004
- **Affected Files:** New dependency; ~190 `apiFetch` call sites (incremental adoption)
- **Runtime Validation Required:** No
- **Regression Risk:** Stale-data display if revalidation is misconfigured
- **Rollback Available:** Yes

### OPT-006
- **Title:** Static generation for marketing routes
- **Category:** Rendering
- **Priority:** 6
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 100% (0 `getStaticProps` in repo)
- **Estimated Gain:** Instant HTML for first-time visitors; removes CSR boot from first paint
- **Estimated Effort:** Medium
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** `pages/index.tsx`, `pages/pricing.tsx`, `pages/about.tsx`, `pages/features.tsx`, `pages/help.tsx`, `pages/solutions/**`
- **Runtime Validation Required:** No
- **Regression Risk:** `AuthGate` currently branches on client state; SSG output must stay auth-agnostic
- **Rollback Available:** Yes

### OPT-007
- **Title:** AI response streaming for user-facing generation
- **Category:** AI Pipeline / Perceived Latency
- **Priority:** 7
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 90%
- **Estimated Gain:** Time-to-first-token replaces time-to-completion (currently up to 240 s timeout)
- **Estimated Effort:** High
- **Implementation Risk:** High
- **Dependencies:** Gateway already supports `stream: true` at 11 sites
- **Affected Files:** `backend/services/aiGatewayCore.ts`, generation API routes, consuming UI
- **Runtime Validation Required:** No
- **Regression Risk:** Partial-output handling, credit reconciliation on aborted streams
- **Rollback Available:** Yes (streaming is opt-in per caller)

### OPT-008
- **Title:** Explicit column projection (replace `SELECT *`)
- **Category:** Database / Network
- **Priority:** 8
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 90% (1125 occurrences confirmed; per-route impact unmeasured)
- **Estimated Gain:** Unquantified — needs payload measurement
- **Estimated Effort:** High
- **Implementation Risk:** Medium
- **Dependencies:** Prioritize using pg_stat_statements
- **Affected Files:** `pages/api/**`, `backend/**`
- **Runtime Validation Required:** Yes — to select which routes to fix first
- **Regression Risk:** Omitting a consumed column
- **Rollback Available:** Yes

### OPT-009
- **Title:** Default pagination limits on list endpoints
- **Category:** API / Database
- **Priority:** 9
- **Status:** Pending Approval
- **Impact:** High
- **Confidence:** 90%
- **Estimated Gain:** Bounds payload growth as tenant data scales
- **Estimated Effort:** Medium
- **Implementation Risk:** Medium
- **Dependencies:** None
- **Affected Files:** ~1084 `pages/api` routes lacking `.range(`/`limit(`
- **Runtime Validation Required:** Yes — row counts determine urgency
- **Regression Risk:** Truncating results consumers expect in full
- **Rollback Available:** Yes

### OPT-010
- **Title:** Batch N+1 serial DB awaits
- **Category:** Database
- **Priority:** 10
- **Status:** Pending Approval
- **Impact:** Medium
- **Confidence:** 85%
- **Estimated Gain:** Converts linear-in-collection-size latency to constant
- **Estimated Effort:** Low
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** 18 sites in `pages/api/**`
- **Runtime Validation Required:** No
- **Regression Risk:** Low
- **Rollback Available:** Yes

### OPT-011
- **Title:** Variable font axes (replace 8 static weights)
- **Category:** Fonts
- **Priority:** 11
- **Status:** Pending Approval
- **Impact:** Low
- **Confidence:** 80%
- **Estimated Gain:** ~100–150 KB total asset footprint (16 files / 368 KB today)
- **Estimated Effort:** Low
- **Implementation Risk:** Low
- **Dependencies:** None
- **Affected Files:** `pages/_app.tsx`
- **Runtime Validation Required:** No
- **Regression Risk:** Subtle weight rendering differences
- **Rollback Available:** Yes

### OPT-012
- **Title:** Remaining `<img>` attribute coverage (hero / single-preview sites)
- **Category:** Images / Core Web Vitals
- **Priority:** 12
- **Status:** Pending Approval
- **Impact:** Medium
- **Confidence:** 90%
- **Estimated Gain:** 65 remaining CLS sources; 66 images still eager
- **Estimated Effort:** Medium (per-site judgement — cannot be batch-applied)
- **Implementation Risk:** Medium — several are plausible LCP elements where `loading="lazy"` would *hurt*
- **Dependencies:** Best sequenced after Lighthouse identifies the LCP element per route
- **Affected Files:** ~25 files with dynamic-src `<img>`
- **Runtime Validation Required:** Yes — LCP element identification
- **Regression Risk:** Lazy-loading an LCP image degrades LCP
- **Rollback Available:** Yes
- **Origin:** Split out of OPT-001

### OPT-013
- **Title:** Re-encode `creator-showcases` asset set
- **Category:** Images
- **Priority:** 13
- **Status:** Blocked
- **Impact:** High (15 MB / 244 files; individual assets up to 351 KB)
- **Confidence:** 85%
- **Estimated Gain:** Est. 50–70% byte reduction at visually-equivalent quality
- **Estimated Effort:** Low (scripted `sharp` pass)
- **Implementation Risk:** Low technically; **blocked on product sign-off** for acceptable quality on showcase imagery
- **Dependencies:** Product decision on quality floor
- **Affected Files:** `public/creator-showcases/**` (244 files)
- **Runtime Validation Required:** No
- **Regression Risk:** Visible quality loss on marketing-facing showcase assets
- **Rollback Available:** Yes (originals in git)
- **Origin:** Split out of OPT-001

---

## IMPLEMENTATION HISTORY

### SEC-001-P1b2b — Final wave-1 declaration + Design Change v5 (AUTH-ENFORCEMENT Task 3b)

- **Implementation Date:** 2026-08-02
- **Summary:** Recorded **Design Change v5** (trust domains: Principal / Publication / Delivery Trust; `checkFormOrigin` classified as Delivery Trust — handler business logic that Phase 2 enforcement and V-11 cleanup must never replace; drift layers: Implementation / Category / Contract Drift; contract renamed **Embeddable Configuration** for registry reusability), then declared the 8th and final wave-1 policy on `forms/[id]/embed.ts` and shipped the Contract Drift warn-only rules. Zero runtime behavior change.
- **Files Changed:** design doc (v5 header + §3.8 trust domains + §3.7 registry row), `pages/api/forms/[id]/embed.ts` (public declaration, Contract: Embeddable Configuration, justification records the `allow_unverified` owner-opt-in caveat verbatim), `scripts/check-route-policy.js` (CONTRACT-DRIFT-1: public declarations must name a §3.7 registry contract — retrofits Batch 2a for free; FORM-DRIFT-1: Embeddable Configuration without `checkFormOrigin`; FORM-DRIFT-2: origin validation replaced by principal auth — all warn-only, excluded from strict), test updates (public suite covers all 4 public routes + 5 new Contract-Drift synthetics; two prior synthetics gained valid Contract labels; inventory assertion 7 → 8).

**Regression Tests Performed**
- 8 suites / 106 tests green (one first-run failure was the expected DRIFT-1-synthetic interaction with the new CONTRACT-DRIFT-1 — fixed by giving the synthetic a valid Contract label; disclosed, not hidden).
- `check:route-policy` live: 1301 scanned, **declared 8, withIssues 0, withDrift 0**; embed row verified exactly. `check:authz` PASS. ESLint clean. Typecheck deltas: none from touched files.

**Final Status:** ✅ **COMPLETE IN CODE — wave 1 fully declared (8/8), inert (flag off). Phase 1 remaining: shadow-enable runbook + observation exit criterion; then Phase 2 planning (mixed-mode routes, category enforcement).**

### SEC-001-P1b2a — Public policy declarations, Batch 2a (AUTH-ENFORCEMENT Task 3b)

- **Implementation Date:** 2026-08-02
- **Summary:** Declared inert `public` policies on the three verified public-by-design GET routes, with §3.7-structured justifications (Purpose / Exposure / Rationale + named **Public Contract**), and added the three approved **PUB-DRIFT** warn-only rules to `check:route-policy`. Zero runtime behavior change (flag off; observation-only by construction).
- **Files Changed:** 3 routes — `blogs/public.ts` (Contract: **Embeddable Content**), `blogs/[id]/public.ts` (**Published Content**), `blog/sitemap.ts` (**Search Engine Content**); `scripts/check-route-policy.js` (PUB-DRIFT-1 public+auth-helper, PUB-DRIFT-2 public+DB-read-without-published-filter, PUB-DRIFT-3 non-public+shared-cache-directive — all warn-only, excluded from `ROUTE_POLICY_STRICT`; DRIFT-1 dedupe so resolveCompanyAccess-vs-public diagnoses once); `docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md` (new §3.7: justification structure + Public Contract registry); 1 new test suite `publicPolicyDeclarations.test.ts`; inventory-test assertion 4 → 7.
- **Assessment basis:** each route verified public-by-design from full source (published-only filters at the query layer, no principal auth, namespace evidence: all 13 sibling `blogs/*` routes are `enforceCompanyAccess`-guarded — the public pair is the deliberate exception).

**Regression Tests Performed**
- 8 suites / 98 tests green: new Batch-2a suite (real-file declarations schema-clean + §3.7 labels + contract names + zero drift; every PUB-DRIFT class fires on synthetic sources incl. the DRIFT-1 dedupe and the clean published-filter case) + Batch-1 suite + both Phase-0 suites + `policyGateObservation` + `platformRouteFactory` (unmodified).
- `check:route-policy` live: 1301 scanned, **declared 7, withIssues 0, withDrift 0**, PASS. `check:authz` PASS (baseline unchanged). ESLint clean. Typecheck: no new errors (pre-existing `OutcomeGallery.tsx` +1 only).

**Known limits (recorded, not new):** PUB-DRIFT covers in-file signals only; service-layer indirection, column-emission changes (e.g. the excerpt-vs-content mapper in `blogs/public.ts`), and `public_blogs` store redefinition remain human-review properties per design §4.2.

**Issues Found:** none. **Follow-up:** Batch 2b (`forms/[id]/embed.ts`, likely a new *Form Config* contract), then the shadow-enable runbook.

**Final Status:** ✅ **COMPLETE IN CODE — inert (flag off), pending Batch 2b approval.**

### SEC-001-P1b1 — First policy declarations, Batch 1 (AUTH-ENFORCEMENT Task 3b)

- **Implementation Date:** 2026-08-02
- **Summary:** Declared inert `company-scoped` policies on the four Phase-0 routes and added declaration↔implementation **drift detection** (warn-only) to `check:route-policy`. Zero runtime behavior change: enforcement remains `resolveCompanyAccess` in each handler; the rollout flag stays off.
- **Files Changed:** 4 routes (+1 `policy` option each: 3× `companyIdFrom: 'path.id'`, 1× `'query.companyId'`), `scripts/check-route-policy.js` (drift layer: DRIFT-1 wrong category vs helper, DRIFT-2 source mismatch, DRIFT-3 untraceable helper argument, DRIFT-4 helper removed while still declared — **never blocking, excluded even from `ROUTE_POLICY_STRICT`**; promotion is a Phase 2 decision), 1 new test suite `sec001PolicyDeclarations.test.ts`, 1 assertion update in `routePolicyInventoryScript.test.ts` (declared 0 → 4, drift 0).
- **Mechanical derivation, now CI-pinned:** `resolveCompanyAccess(req, res, X)` ⇔ `category: 'company-scoped'`; `companyIdFrom` = X's syntactic source, `path.<field>` when the file path carries `[<field>]`. Future helper/source changes without a policy update surface as CI warnings.

**Regression Tests Performed**
- 6 suites / 66 tests green: new Batch-1 suite (real-file declarations schema-clean + zero drift + derivation match; every DRIFT class fires on synthetic sources) + both Phase-0 suites **unchanged** (behavioral identity through the real factory path with declarations present) + `policyGateObservation` + `platformRouteFactory` (pass-through, unmodified).
- `check:route-policy` live: 1301 scanned, **declared 4, withIssues 0, withDrift 0**, PASS. ESLint clean. Typecheck: no new errors (baseline delta remains the pre-existing `OutcomeGallery.tsx` +1).

**Issues Found:** none. **Follow-up:** Batch 2a (3 public content routes), Batch 2b (`forms/[id]/embed`).

**Final Status:** ✅ **COMPLETE IN CODE — inert (flag off), pending Batch 2a approval.**

### SEC-001-P1a — Phase 1 policy infrastructure (AUTH-ENFORCEMENT Task 3a)

- **Implementation Date:** 2026-08-02
- **Summary:** Shipped the declarative route-policy infrastructure — schema, pure evaluator, observation-only gate, CI inventory/warn gate — with **zero runtime behavior change**: no route declares a policy, and the rollout flag defaults off.
- **Files Changed:** 3 modified — `lib/platform/routeFactory.ts` (optional `policy` on `CreateApiRouteOptions` + dynamically-imported observation call, fail-safe), `package.json` (`check:route-policy` script), `.github/workflows/typecheck-baseline.yml` (non-blocking step). 4 new source — `lib/platform/routePolicy.ts` (§3.4 v1 schema + §4.1 validator + **pure** `evaluatePolicy` returning a versioned `PolicyDecision` with allow/deny/**abstain**), `lib/platform/policyGate.ts` (Observation Gate: flag `route-policy-gate` default off; lazy-imports the security graph only when non-off; logs `{route, category, wouldAllow, wouldDeny, reason}`; never blocks), `scripts/check-route-policy.js` (C-3 warn + C-4 inventory → `artifacts/route-policy-inventory.json`, gitignored). 4 new test suites (49 tests).

**Why:** AUTH-ENFORCEMENT v3 §6 Phase 1, split per approved Decision 1 (3a infrastructure / 3b first declarations); Decision 2 (Observation vs Enforcement gate) and the three approved refinements (pure evaluator, versioned decision, determinism test) incorporated.

**Regression Tests Performed**
- 8 suites / 76 tests green: 4 new + `platformRouteFactory` (pass-through contract, **unmodified** — the backward-compat proof) + `platformGateAValidation` + both Phase-0 suites.
- Load-graph inertness test-pinned: with no policy the gate module is never loaded; with policy + flag off the security graph (IdentityResolver) is never imported; gate failure is invisible to the route.
- Determinism test-pinned: frozen inputs, poisoned `Date.now`/`Math.random`, byte-identical decisions.
- `check:route-policy` live: 1301 routes scanned, 0 declared (expected), inventory emitted, PASS. `check:authz` unchanged (baseline 49). ESLint clean.
- Typecheck: zero errors from any touched file; CI baseline delta unchanged (the pre-existing `OutcomeGallery.tsx` +1); backend-tests failures remain the pre-existing `community_ai_*` set.

**Performance note:** undeclared routes (all 1301) gain one property check. Declared+shadow cost (identity fan-out per request) is deferred to the 3b enable runbook.

**Issues Found:** none. **Follow-up:** Task 3b (first ~19 inert declarations), then the Phase 1 shadow-observation exit criterion.

**Final Status:** ✅ **COMPLETE IN CODE — inert by construction, pending Task 3b.**

### SEC-001-P0 — Phase 0 route guards (AUTH-ENFORCEMENT Phase 0)

- **Implementation Date:** 2026-08-02
- **Summary:** Guarded the four SEC-001 routes with the existing `resolveCompanyAccess` helper, per `docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md` v3 (Design Change v3: guard, don't retire, endpoints without in-repo callers).
- **Files Changed:** 4 routes + 2 new test suites + design doc — `pages/api/companies/[id]/learnings.ts`, `pages/api/companies/[id]/efficiency-score.ts`, `pages/api/companies/[id]/outcome-history.ts`, `pages/api/governance/company-analytics.ts`, `backend/tests/integration/sec001CompanyRouteGuards.test.ts` (new), `backend/tests/unit/resolveCompanyAccess.test.ts` (new), `docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md` (v2 → v3)

**What Changed**

1. Each route now calls `resolveCompanyAccess(req, res, companyId)` after its method check (and, for `company-analytics`, after its own 400 check, preserving that exact message) and returns when access is null. Additive: one import + two lines per route; no helper, factory, or middleware changes; no new authorization logic.
2. Anonymous → 401; authenticated non-member → 403; member / super-admin / content-architect → 200 byte-identical to before. 405/400/500 paths unchanged.
3. New route-level suite proves the guard runs before any data access (data layer untouched on deny); new unit suite is the first dedicated coverage of `resolveCompanyAccess` itself (400/401/403 + all allow paths).

**Why It Was Changed**

SEC-001: all four routes read tenant-scoped data keyed by a caller-supplied company id with no authorization. Pattern copied from the live reference implementation `pages/api/company-profile/completeness.ts`.

**Regression Tests Performed**
- New suites: 27/27 pass.
- `companyProfileCompletenessEndpoint.test.ts` (shares the helper): 4/4 pass.
- `npm run check:authz`: PASS — 0 new violations, baseline unchanged (49); `resolveCompanyAccess` is on the gate's approved list.
- ESLint on all 6 touched files: clean.
- Typecheck: `tsconfig.backend.json` clean; the 4 route files and 2 test files contribute **zero** errors in `tsconfig.json` / `tsconfig.backend-tests.json`. Both projects carry pre-existing failures unrelated to this change: the `typecheck:ci` +1-above-baseline error is `components/creator/OutcomeGallery.tsx` TS17001 (duplicate JSX attribute) from uncommitted working-tree changes that predate this task, and `tsconfig.backend-tests.json` has long-standing errors in `community_ai_*` suites.

**Performance note:** the guard adds identity + role resolution (a few sequential DB round-trips) to these four routes. They are cold paths — their only in-repo caller (`components/admin/BrandIntelligencePanel.tsx`) is unmounted dead code — so no measurable impact expected.

**Issues Found:** none in scope. Adjacent observation logged for Phase 2: `pages/api/governance/company-drift.ts` follows the same shape (query-supplied `companyId`, no guard) and is not part of the approved Phase 0 scope.

**Follow-up Required:** deploy, then lift the cache hold for OPT-002; Phase 1 (shadow mode) awaiting go-ahead. Watch post-deploy 401 rates on `governance/company-analytics` for any unknown external caller.

**Final Status:** ✅ **COMPLETE IN CODE — pending deploy.**

### DISC-004 — Hydration-unsafe canonical pattern on blog routes

- **Implementation Date:** 2026-08-01
- **Summary:** Replaced the `window.location.origin` SEO-URL pattern with a shared build-time constant.
- **Files Changed:** 4 — `lib/siteUrl.ts` (new), `pages/blog/index.tsx`, `pages/blog/[slug].tsx`, `pages/index.tsx` (refactored onto the shared module)

**Scope Correction (from the original DISC-004 entry)**

The original finding claimed the pattern also appeared in `pages/company-blog/[slug].tsx`. **That was wrong** — that file uses `post.featured_image_url` (already absolute) and has no `siteUrl` derivation. Verified actual scope is **2 files**. Separately, `pages/login.tsx:164` and `pages/auth/accept-invite.tsx:28` do derive `origin` the same way, but use it only inside event handlers (`emailRedirectTo`, `redirectTo`) and never render it into markup — correctly out of scope, no hydration or SEO impact.

**What Changed**

1. **New `lib/siteUrl.ts`** exporting `SITE_URL` and `absoluteUrl(path)`. Centralizing this prevents the pattern from recurring in new pages.
2. `pages/blog/index.tsx` — `siteUrl` was `origin` or `''`. The `''` branch emitted `<link rel="canonical" href="/blog">` into the prerendered HTML.
3. `pages/blog/[slug].tsx` — preferred `origin` client-side and the env value server-side; the two disagree whenever the serving host differs from the canonical origin.
4. `pages/index.tsx` — refactored onto the shared module (removes the local duplicate introduced by OPT-014).

**Why It Was Changed**

Two defects from one pattern: a hydration mismatch on every blog page load, and an invalid relative canonical in exactly the HTML crawlers read. The `[slug].tsx` variant additionally let preview/alias hosts self-canonicalize and compete with production in search results.

**Measured Improvement**

| Route | canonical before | canonical after |
|---|---|---|
| `/blog` | `/blog` (relative, broken) | `https://www.omnivyra.com/blog` |
| `/blog` `og:url` | `/blog` | `https://www.omnivyra.com/blog` |
| `/` (regression check) | `https://www.omnivyra.com/` | unchanged ✅ |

Residual `window.location.origin` **code** instances in SEO paths: **0** (2 grep hits remain, both explanatory comments).

**Regression Tests Performed**
- `tsc -p tsconfig.build.json --noEmit` — exit 0
- `eslint` on all 4 files — exit 0
- Production build — exit 0, 0 errors
- `/` canonical and `og:url` re-verified unchanged (no OPT-014 regression)

**Issues Found:** None.

**Follow-up Required:** Other pages constructing SEO URLs should adopt `lib/siteUrl.ts`. No further instances found in `pages/blog` or `pages/index.tsx`.

**Runtime Metrics Needed:** None — defect and fix both verifiable in the build artifact.

**Final Status:** ✅ **COMPLETE AND VALIDATED.**

### OPT-014 — Restore homepage prerendered content + SEO metadata

- **Implementation Date:** 2026-08-01
- **Summary:** Removed the render gate that emptied the homepage's static HTML, and added the full metadata set. The homepage now prerenders complete, independently-useful HTML.
- **Files Changed:** 1 — `pages/index.tsx`

**What Changed**

1. **Render gate eliminated.** `useState(true)` for `loading` plus `if (loading && !sessionFound) return null` meant prerender always returned `null`. Replaced with a single `redirecting` flag that starts `false`.
2. **`<Head>` hoisted out of the conditional** — metadata now emits unconditionally.
3. **Metadata added:** canonical, `og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`, and `twitter:card`/`title`/`description`/`image`. None existed before.
4. **Build-time `SITE_URL`.** Used `process.env.NEXT_PUBLIC_APP_URL` (webpack-inlined, default `https://www.omnivyra.com`). Deliberately **not** the `typeof window !== 'undefined' ? window.location.origin : ''` pattern used in `pages/blog/*` — that renders `''` server-side and the real origin client-side, which is simultaneously a hydration mismatch and a broken canonical in the emitted HTML.
5. **Soft-navigation handling.** Page now reads `authChecked`/`isAuthenticated` from `CompanyContext`. On in-app soft navigation to `/` (the header logo target) these are already resolved, so an authenticated user renders zero frames of marketing content.

**Why It Was Changed**

The primary marketing entry point emitted 6.3 KB of HTML with 175 characters of visible text and no metadata at all. Homepage LCP was gated on full JS boot plus Supabase `getSession()` resolution, and no non-JS crawler could see a title, description, or FAQ schema.

**Chosen approach and why it is preferable**

An **edge redirect in `proxy.ts`** was evaluated as the theoretically cleanest way to give authenticated users zero flash, and **rejected** on three grounds:
- Adding `/` to `config.matcher` invokes an edge function on *every* homepage request, undermining the pure-static CDN delivery that is the main win here — a net loss for the anonymous majority.
- Validating the session at the edge requires either the JWT secret in the edge runtime or a network call to Supabase, adding latency to the anonymous path *before* we know who the visitor is.
- `pages/api/feature-completion.ts:48` documents that the standard `createServerClient` + `getSession(req.cookies)` path **could not read this app's auth cookie** and 401'd on every call (SIM-004 / EXEC-002). The cookie envelope is non-standard here, so edge parsing would be fragile.

`getServerSideProps` was likewise rejected — it eliminates static prerendering entirely, directly contradicting requirement 1.

The chosen client approach keeps `/` fully static and CDN-cacheable while using already-resolved context state to eliminate the flash on the common authenticated path (soft navigation).

**Measured Improvement**

| Metric | Before | After |
|---|---|---|
| `index.html` size | 6.3 KB | **80.3 KB** |
| Visible text in static HTML | 175 chars | **7,918 chars** (45×) |
| SEO/content elements present | 0 of 16 | **16 of 16** |

Verified programmatically against `.next/server/pages/index.html`: title, meta description, canonical, `og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:site_name`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, JSON-LD `FAQPage`, hero/marketing copy, critical navigation — all PASS.

Resolved values: canonical `https://www.omnivyra.com/`, `og:image` `https://www.omnivyra.com/logo.png`.

**Regression Tests Performed**

- `tsc -p tsconfig.build.json --noEmit` — exit 0
- `eslint pages/index.tsx` — exit 0
- Production build — exit 0, **0 errors, 0 warnings**
- **Hydration determinism:** `suppressMarketingBody = redirecting || (authChecked && isAuthenticated)`. All three inputs are `false` during prerender *and* on the first client render (`redirecting` starts `false`; `CompanyContext` initializes `authChecked=false`, `isAuthenticated=false`; verified no browser-API reads in any `useState` initializer). Server and first client render provably agree; the value can only flip in a later effect-driven commit. Build reported 0 hydration warnings. The successful prerender is itself proof that `useCompanyContext()` resolves during SSR.
- **Auth redirect:** all four branches preserved verbatim — no session, stale 401/403 (sign-out + reveal marketing), transient failure (route to pinned home), success (route to `post-login-route` target).
- **Caching:** `/` still emits `index.html` as `○ (Static)` — CDN-cacheable delivery unchanged.
- **Proxy/middleware:** `/` is not in `config.matcher`; behavior untouched.
- **Analytics:** `WebsiteAnalytics` lives in `_app` and is unmodified.
- **Navigation / structured data / routing:** unchanged; verified present in emitted HTML.

**Issues Found**

One behavioral tradeoff remains, deliberately not papered over: on a **fresh full page load** (typed URL or bookmark) by an authenticated user, marketing content paints briefly before the redirect, where previously the screen was blank. Soft navigation — the common in-app path — has no flash. Eliminating the fresh-load case requires a pre-paint inline script that hides the body on detecting an auth-token marker; that adds a render-blocking script to the highest-traffic page and risks hiding content from anonymous users if the marker check is wrong. **Not implemented — flagged for a product decision** as OPT-015.

**Follow-up Required**
- OPT-015 — decide whether the fresh-load authenticated flash warrants a pre-paint script.
- OPT-016 — `og:image` currently points at `logo.png` (898×278). Social platforms expect ~1200×630; a purpose-built OG image is needed.
- Pre-existing hydration bug: `pages/blog/index.tsx:221` and `pages/blog/[slug].tsx` use the `window.location.origin` canonical pattern. Out of scope here; logged as DISC-004.

**Runtime Metrics Needed:** Lighthouse LCP/FCP on `/` before vs. after, to quantify the paint improvement.

**Final Status:** ✅ **COMPLETE AND VALIDATED.** 16/16 content and metadata assertions pass against the build artifact.

### OPT-001 — Image payload reduction + CLS/LCP attributes

- **Implementation Date:** 2026-08-01
- **Summary:** Re-encoded the site logo, corrected intrinsic dimensions on all raw-`<img>` logo tags, and deferred gallery/list images off the critical path.
- **Files Changed:** 39 files + 1 new asset (`public/logo.webp`)

**What Changed**

1. **Logo re-encode.** Generated `public/logo.webp` (465×144, WebP q82) from the 898×278 / 183 KB PNG via `sharp`. Sized for 3× DPR at the largest CSS render height in use (`h-12` = 48 px). **183.1 KB → 21.0 KB (88.6% smaller).**
2. **Logo reference swap.** 33 raw `<img>` sites across 27 page routes now point at `logo.webp`.
3. **Intrinsic dimensions.** 22 logo tags had no `width`/`height` (CLS sources) and 11 declared `100×40` — an aspect ratio of 2.50 against the asset's true 3.23, so the reserved box was wrong. All 33 now declare `465×144`. CSS (`h-N w-auto`) still governs painted size; the attributes only supply the aspect ratio the browser uses to reserve space.
4. **Deferred gallery images.** Added `loading="lazy"` + `decoding="async"` to the template gallery card (`templatesWidgets.tsx`) and 13 images across 8 grid/list/picker components.

**Why It Was Changed**

The logo shipped 183 KB to render at 36–48 px on ~27 routes, several of them unauthenticated entry points (`/login`, `/create-account`, onboarding). 88 of 99 raw images declared no dimensions, and 80 loaded eagerly — the two largest controllable inputs to CLS and LCP.

**Expected Improvement**
- 162 KB removed per page view on 27 routes
- 23 CLS sources eliminated
- 14 images removed from initial-load contention (incl. a gallery that renders up to 71 cards at up to 351 KB each)

**Measured Improvement**
- Asset: 183.1 KB → 21.0 KB, verified via `ls`
- `<img>` missing `loading`: 80 → 66
- `<img>` missing `width`/`height`: 88 → 65
- LCP/CLS field delta: **not measured** — requires Lighthouse (see RV-007)

**Regression Tests Performed**
- `tsc -p tsconfig.build.json --noEmit` — clean
- `eslint` across all 39 changed files — clean
- Production build — see Final Status

**Issues Found**

Four `logo.png` references were inside `next/image` components (`LandingNavbar`, `Footer`, `MarketingLandingPageSections`, `GlobalHeaderMain`), which already resize and serve AVIF/WebP from the PNG and declare intrinsic `898×278`. Repointing them at the pre-shrunk 465 px asset would have capped the optimizer's output resolution and desynced the declared dimensions. **Reverted those four to `logo.png`.** `logo.png` is therefore retained, not deleted — it remains the source for the `next/image` pipeline.

**Follow-up Required**
- 66 `<img>` still lack `loading`; 65 still lack `width`/`height`. Remaining sites are single/hero/above-fold previews needing individual judgement — deliberately not batch-edited. Tracked as OPT-012.
- 15 MB `creator-showcases` set not re-encoded — needs product sign-off on quality. Tracked as OPT-013.

**Runtime Metrics Needed:** Lighthouse LCP/CLS before-and-after on `/login`, `/create-account`, `/command-center/creator-content/[type]/templates`.

**Final Status:** ✅ **COMPLETE AND VALIDATED.** Production build exited 0 with 0 errors and 0 warnings. Typecheck and lint clean across all 39 changed files.

---

## DISCOVERED DURING IMPLEMENTATION

### DISC-001
- **Description:** Raw `<img>` count is 99, not 62. 80 lack `loading`; 88 lack `width`/`height`.
- **Severity:** Medium (scope correction, not a new defect)
- **Confidence:** 95%
- **Recommended Priority:** Folded into OPT-001
- **Dependencies:** None
- **Reason not discovered during static audit:** Initial count used a single-line `grep` for `<img `. Multi-line JSX `<img>` tags spanning several lines were not matched. A multi-line-aware AST-ish parse found the true count.

### DISC-002 — Middleware exists (`proxy.ts`), contradicting the audit's "no middleware" conclusion
- **Description:** The audit reported "No `middleware.ts` — zero per-request edge overhead." A 230-line `proxy.ts` exists at the repo root — Next.js 16's renamed middleware entry point. The production build confirms it: `ƒ Proxy (Middleware)`.
- **Severity:** Low (fact corrected; practical conclusion survives)
- **Confidence:** 100%
- **Recommended Priority:** None — no action required
- **Assessment:** `config.matcher` scopes it to `/api/:path*` plus 6 page routes, so it does not run on static assets or most pages. The handler is **synchronous** (`export function proxy`) with no `await` and no `fetch` — it only reads cookies and does string prefix matching. Per-request cost is negligible. It does execute ahead of all 1301 API routes.
- **Reason not discovered during static audit:** Searched only for `middleware.ts` / `middleware.js`. Next.js 16 renamed the convention to `proxy.ts`, so the glob missed it.

### DISC-004 — Hydration-unsafe canonical pattern on blog routes
- **Description:** `pages/blog/index.tsx:221` (and the same pattern in `pages/blog/[slug].tsx`, `pages/company-blog/[slug].tsx`) computes `const siteUrl = typeof window !== 'undefined' ? window.location.origin : ''`, then uses it for `<link rel="canonical">`, `og:url` and `og:image`.
- **Severity:** Medium (SEO correctness + hydration)
- **Confidence:** 95%
- **Impact:** Server renders `href="/blog"`; client renders `href="https://…/blog"` — a hydration mismatch on every blog page, and an invalid canonical in the prerendered HTML that crawlers read.
- **Recommended Priority:** After OPT-002. Same one-line fix already applied in OPT-014 (build-time `NEXT_PUBLIC_APP_URL`).
- **Dependencies:** None
- **Reason not discovered during static audit:** The audit did not inspect per-route SEO metadata construction; the pattern only becomes visibly wrong when the emitted HTML is read.

### DISC-003 — Homepage renders `null` during prerender: no content, no SEO metadata
- **Description:** `pages/index.tsx` initializes `const [loading, setLoading] = useState(true)` and returns `null` at line 100 while `loading && !sessionFound`. Effects do not run during prerender, so `loading` stays `true` and **the entire return block is excluded from the static HTML** — including `<Head>`.
- **Severity:** **High**
- **Confidence:** 100% (verified against the built artifact)
- **Evidence:** `.next/server/pages/index.html` is 6.3 KB containing **175 characters** of visible text (navbar links only). Programmatic checks against the built HTML: `<title>` **absent**, `meta[name=description]` **absent**, FAQ `JSON-LD` **absent**, hero copy **absent**.
- **Recommended Priority:** **1 — ahead of all remaining backlog items**
- **Dependencies:** None
- **Scope:** Isolated to `pages/index.tsx`. `pricing`, `about`, `features`, `help` have no such gate.
- **Impact:** Two distinct defects from one cause. **(a) Performance:** homepage LCP is gated behind full JS boot *plus* Supabase `getSession()` resolution — the marketing content cannot paint until both finish. **(b) SEO:** the primary marketing entry point serves no title, no meta description, and no FAQ structured data to any crawler that does not execute JavaScript.
- **Reason not discovered during static audit:** The audit classified `/` as "pure CSR" from the absence of `getStaticProps`/`getServerSideProps` and stopped there. It did not inspect the *built HTML*, so the early-`return null` — which empties even the auto-static-optimized shell and drops `<Head>` — went unseen. Only building and reading the emitted artifact exposed it.

---

## REVISION LOG

### R-001 — Auth lock severity downgrade
- **Original finding:** "`getAuthToken()` acquires a navigator lock on every API call" — severity High.
- **Contradictory evidence:** `lib/supabaseBrowser.ts:35` configures `lock: processLock`, an in-memory tab-local promise chain, not the browser Web Locks API.
- **Revised severity:** Medium. Concurrent `getSession()` still serializes, but per-call cost is a localStorage read + `JSON.parse`, not a lock-manager round-trip.
- **Effect on plan:** OPT-004 moved from priority 1 to priority 4.

---

## DEFERRED ITEMS

### DEF-001 — Replace `recharts` to drop `@reduxjs/toolkit`
- **Reason:** `recharts@3.8.1` hard-depends on `@reduxjs/toolkit@2.11.2` (8.3 MB installed); app never imports redux (uses zustand). Redux ships in 4 client chunks. Removing it requires replacing the charting library entirely.
- **Blocking Dependency:** Charting library migration (high effort, wide blast radius across 15 consumers)
- **Confidence:** 85%
- **When to revisit:** Only if runtime metrics show chart routes are hot. Estimated gain is ~15–25 KB gzip on those routes only.

---

## RUNTIME VALIDATION

Optimizations awaiting runtime evidence before implementation or before priority is final.

### RV-001 — List virtualization
- **Reason:** No virtualization library present; 2766 `.map((` render sites. Impact depends on actual row counts in production.
- **Expected Metric:** React Profiler commit durations; DevTools long-task count on list routes
- **Current Confidence:** 75%
- **Blocking Impact:** Cannot size the win or pick target routes

### RV-002 — `CompanyContext` re-render split
- **Reason:** 211 consumers; context value includes `authFsm`, so every FSM transition re-renders all of them. Wasted-render volume unmeasured.
- **Expected Metric:** React Profiler wasted renders per auth transition
- **Current Confidence:** 70%
- **Blocking Impact:** Cannot justify refactor risk without measured waste

### RV-003 — `backdrop-filter` / blur reduction
- **Reason:** 204 `backdrop-blur` + 178 `blur-` + 569 `animate-`. Suspected mobile INP/TBT driver.
- **Expected Metric:** DevTools mobile trace (4× CPU throttle) — paint/composite time, dropped frames
- **Current Confidence:** 80%
- **Blocking Impact:** Impact magnitude unknown; removal has visual-design cost

### RV-004 — LLM pool concurrency sizing
- **Reason:** All four pools fall back to `MAX_LLM_CONCURRENCY` default 5; per-pool envs unset.
- **Expected Metric:** Observed fan-out width per generation operation; pool wait-time samples
- **Current Confidence:** 70%
- **Blocking Impact:** Cannot size pools without knowing fan-out and provider QPS budget

### RV-005 — Re-enable server minification
- **Reason:** Disabled at `next.config.js:167` to work around build timeouts. `.next/server` = 130 MB; largest function 1.5 MB.
- **Expected Metric:** Vercel cold-start rate and duration for top-20 routes
- **Current Confidence:** 65%
- **Blocking Impact:** Unknown whether cold starts are material; re-enabling risks build timeouts

### RV-007 — OPT-001 field impact confirmation
- **Reason:** OPT-001's byte reduction is measured (183.1 KB → 21.0 KB) but its LCP/CLS effect is inferred, not observed.
- **Expected Metric:** Lighthouse LCP + CLS on `/login`, `/create-account`, `/command-center/creator-content/[type]/templates`, before vs. after
- **Current Confidence:** 95% that the change is directionally correct; 0% on magnitude
- **Blocking Impact:** None — does not block further work. Needed only to quantify the scorecard entry and to sequence OPT-012.

### RV-006 — Event listener cleanup
- **Reason:** add > remove in 5 files (MediaUploader verified false positive — XHR-scoped).
- **Expected Metric:** Heap growth across repeated SPA navigations
- **Current Confidence:** 75%
- **Blocking Impact:** Marginal expected gain; low priority regardless

---

## PERFORMANCE SCORECARD

Baseline measured from production build artifacts on 2026-08-01.

| Dimension | Baseline | Current | Estimated Improvement |
|---|---|---|---|
| Shared JS+CSS baseline (every page) | 931 KB raw / 217 KB gzip | unchanged | pending |
| Heaviest route first-load | 2205 KB raw (`/campaign-planner`) | unchanged | pending |
| Page Load | Homepage: 6.3 KB shell, 175 chars text, 0 metadata | **80.3 KB, 7,918 chars, 16/16 elements** | **✅ homepage LCP no longer gated on JS boot + `getSession()`** |
| SEO (homepage) | No title / description / canonical / OG / Twitter / JSON-LD in HTML | **All present** | **✅ full crawler visibility restored** |
| Navigation | Full refetch, no client cache | unchanged | pending |
| Bundle Reduction | — | 0 KB | pending |
| Image Reduction | 183 KB logo × 27 routes; 80 eager, 88 undimensioned | **21 KB logo; 66 eager, 65 undimensioned** | **✅ 162 KB/view on 27 routes; 23 CLS sources removed** |
| API Improvement | 37/1301 routes cached | unchanged | pending |
| Database Improvement | 1125 `SELECT *`; 217/1301 paginated | unchanged | pending |
| Memory Improvement | 5 unbalanced listener sites | unchanged | pending |
| AI Latency Improvement | Streaming at 11 sites; 4 SSE routes | unchanged | pending |
| Core Web Vitals | Not measured — no Lighthouse/RUM | unknown | pending |

**Note:** Core Web Vitals baseline is unavailable. All CWV-related gains are estimates until Lighthouse and field data are supplied.

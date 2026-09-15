# ROUTE-AUTH-001 — Unauthenticated tenant entry points (STEP 3AH-85)

**Base:** `main @ 88917d032fd3c28601f157488f04c558cea00567` · **Branch:** `fix/auth-unauthenticated-tenant-routes`
**Origin:** STEP 3AH-84 security audit, findings P1-1 (unauthenticated tenant-data routes), P1-2/P1-3 (OAuth tenant binding, WordPress registration), P1-4 (campaign ids not bound by `enforceCompanyAccess`), P1-5 (super-admin from `user_metadata`), P1-6 (unauthenticated paid-API spend), and the three fail-open worker triggers.

## 1. Why this happened

`createApiRoute` (`lib/platform/routeFactory.ts`) wraps 1,307 of 1,336 `pages/api` files in observability and request context — and performs **no** authentication. `proxy.ts` passes every `/api` request through ("API routes handle their own auth"). Authentication and tenant binding were therefore **opt-in per route**, and the only machine check (`scripts/check-tenant-authz.js`) fired only when a route read a `companyId`-style key **and** called `supabase.from()` in the route file. Routes keyed by `campaignId`, `[id]`, `noteId`, `user_id`, or that delegated to a service, were invisible to it.

A second, independent gap sat in the most-used guard: `enforceCompanyAccess({ companyId, campaignId })` proved membership in `companyId` but only checked that a `campaignId` was *present*, so a member of company A could authorise against A and act on company B's campaign.

## 2. What changed

### 2.1 Central enforcement
| Change | Effect |
|---|---|
| `backend/services/campaignOwnershipService.ts` (new) + `enforceCompanyAccess` | Every allow branch of `enforceCompanyAccess` now proves a supplied `campaignId` belongs to `companyId`: a `campaign_versions` row for (campaign, company) — read **with** the company predicate — or, for legacy campaigns, `campaigns.company_id`. A campaign owned by another company, or by nobody (including an orphan `campaign_versions` row: that column has no FK) → **404**; lookup failure → **503**; a campaign that does not exist yet → allowed (creation flows authorise the id they are about to create; it cannot belong to another tenant). This closes P1-4 for every caller at once: ~36 direct call sites plus `requireCompanyContext` and `withTenantGuard`, which forward `campaignId`. |
| `requireCampaignAccess` | Authenticates **before** resolving the campaign owner, so anonymous callers get the same 401 for real and unknown campaigns (the owner lookup used to run first — an existence oracle every caller had to neutralise by hand). |
| `scripts/check-route-auth.js` (new) + CI step "Route authentication gate" (blocking, `typecheck-baseline.yml`) | Default-deny rule for **every** `pages/api` route — see §2.2. No grandfathered baseline. |
| `scripts/route-auth-allowlist.json` (new, 172 reviewed entries) | The only way a route may skip a primitive, and every entry's mechanical evidence is re-verified on each run. |
| `scripts/security/route-auth-inventory.js` (new) | Regenerates the full inventory (authentication + caller trace) into `artifacts/`. |

### 2.2 The gate (`npm run check:route-auth`)
- **R1 authentication** — the route must *invoke* an approved primitive, **imported from the module that implements it** (provenance anchored at the repo root), directly or through a verified delegation chain (followed only into `backend/apiHandlers/**` and non-route helpers under `pages/api/**`, max depth 4, and only through functions whose bodies themselves invoke a primitive). A name in a comment/string, an unused import, a same-named local function, a primitive imported from the wrong module, or delegation into an arbitrary service does **not** count.
- **R2 tenant binding** — a route that takes an object/tenant id from the request (any query/body key `id`, `*Id`, `*_id`, or a dynamic `[segment]`) must invoke a tenant- or platform-level primitive, not merely establish identity.
- **R3 campaign binding** — a campaign-keyed route must bind the campaign (`requireCampaignAccess`, `requireCampaignTenantAccess`, or `enforceCompanyAccess`/`requireCompanyContext` called **with** the `campaignId`).
- **R4 fail-open secrets** — `if (secret) { reject on mismatch }` / `if (secret && hdr !== secret)` with nothing when the secret is unset is a violation wherever it appears.
- **Allowlist kinds** and the evidence each must still show: `machine-secret` (named env var referenced), `webhook-signature` / `machine-token` (named verifier invoked), `retired` (answers 410, never writes), `redirect-shim` (redirects, never touches the DB), `public`/`health` (may not write unless declared), `auth-flow`, `oauth-callback`, and the two **binding claims** `inline-binding` / `identity-scoped` — which still require R1 authentication and carry an `evidence` regex that must match the route's executable source, so deleting the binding code fails the gate.

Allowlist composition: 49 inline-binding, 16 identity-scoped, 32 public, 16 auth-flow, 11 health, 25 machine-secret, 7 machine-token, 4 webhook-signature, 7 retired, 5 redirect-shim.

### 2.3 Scanner robustness fixes found while building it
The comment/string stripper originally treated the quote inside a regex literal (`/Content for "([^"]+)"/`) as a string opener and blanked the rest of the file; regex literals are now recognised. Provenance regexes are anchored at the repo root (an unanchored `backend/services/…$` also matched `pages/backend/services/…`). Both are pinned by fixtures in `routeAuth001Scanner.test.ts`.

## 3. Phase 1 — entry-point inventory (main @ 88917d03, before this change)

1,336 files under `pages/api`: **1,322 route entry points** + 14 non-route helper modules. Classification (final gate + caller trace, measured against main):

| Class | Meaning | Count |
|---|---|---|
| A | Live + protected (authenticates and binds, or reviewed binding claim) | 1,117 (773 with in-repo callers, 344 with none) |
| B | Live + **unauthenticated** (no primitive; in-repo runtime caller exists) | **48** |
| B2 | Live, authenticated but **unbound** request ids (R2/R3) | **22** |
| C | Intentionally public / machine-authenticated (reviewed allowlist, non-binding kinds) | 97 |
| D | Dormant / unreferenced + unauthenticated or fail-open | **16** |
| D2 | Dormant / unreferenced + authenticated but unbound | **5** |
| E | Retired (answers 410 Gone, no side effects) | 7 |
| F | Ambiguous — unauthenticated, referenced only by tests/docs | **10** |

Routes requiring remediation: **101** (B 48 + B2 22 + D 16 + D2 5 + F 10), plus the central `enforceCompanyAccess` binding (P1-4) and 9 additional hardenings found during the work (8 OAuth callbacks that wrote `social_accounts` for a state-supplied company with no membership check, and the `campaigns/index` content-plan PUT/DELETE that accepted any row id).

"Caller" evidence is every `/api/...` literal in tracked files, matched against the route's URL pattern (static segments win, as in Next.js). Paths built at runtime from variables and callers outside this repository (third-party webhooks, the WordPress plugin build, operator curl) leave no trace — absence of a caller is evidence of dormancy, never proof of deadness.

## 4. Per-route record (every B–F route)

Columns: in-repo callers by bucket (`frontend`, `lib`, `backend`, `worker`, `api`, `scripts`, `tests`, `docs`, `other`; `~` = prefix/concatenation match); auth on main; request identifiers; data access in the route file on main (`reads`/`writes` = direct DB calls, `service` = through a service); gate rules violated on main; the primitive(s) the route invokes after this change; gate result after.

| # | Class | Route | Methods | In-repo callers (bucket:files) | Auth on main | Request ids | Data access (main) | Gate rules on main | Primitive(s) after fix | Gate after |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | B | `admin/engagement-signal-health.ts` | GET | docs:1 frontend:1 | none | — | reads | R1 | requireSuperAdminUser | PASS |
| 2 | B | `ai/campaign-learnings.ts` | GET/POST/PUT | docs:1 frontend:1 | none | campaignId | service | R1 | requireCampaignAccess+resolveUserContext | PASS |
| 3 | B | `ai/campaign-messages.ts` | GET/POST | frontend:1 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 4 | B | `ai/daily-amendment.ts` | POST | docs:1 frontend:3 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 5 | B | `ai/generate-comprehensive-plan.ts` | POST | docs:1 frontend:1 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 6 | B | `ai/gpt-chat.ts` | POST | docs:5 frontend:2 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 7 | B | `ai/topic-suggestions.ts` | GET/POST | frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 8 | B | `ai/weekly-amendment.ts` | POST | docs:2 frontend:1 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 9 | B | `analytics/posting.ts` | GET | docs:3 frontend:2 | none | — | reads | R1 | getSupabaseUserFromRequest | PASS |
| 10 | B | `analytics/tracking-assist.ts` | POST | frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 11 | B | `analyze/content.ts` | POST | frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 12 | B | `auth/facebook/index.ts` | GET | api:1 docs:2 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 13 | B | `auth/instagram.ts` | GET | api:3 docs:2 frontend:1 tests:1 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 14 | B | `auth/linkedin.ts` | GET | api:2 docs:5 scripts:1 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 15 | B | `auth/pinterest/index.ts` | GET | api:1 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 16 | B | `auth/tiktok/index.ts` | GET | api:1 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 17 | B | `auth/x.ts` | GET | api:1 | none | companyId, userId | service+writes | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 18 | B | `auth/youtube.ts` | GET | api:1 docs:2 | none | companyId, userId | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 19 | B | `campaigns/12week-plans.ts` | GET | docs:1 frontend:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 20 | B | `campaigns/autopilot-week.ts` | POST | frontend:2 | none | — | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 21 | B | `campaigns/campaign-summary.ts` | GET | docs:1 frontend:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 22 | B | `campaigns/memory.ts` | POST | frontend:1 | none | campaignId, companyId | service | R1 | enforceCompanyAccess | PASS |
| 23 | B | `campaigns/parse-saved-plan.ts` | POST | frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 24 | B | `campaigns/performance-data.ts` | GET | docs:2 frontend:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 25 | B | `campaigns/retrieve-plan.ts` | GET | docs:6 frontend:8 lib:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 26 | B | `campaigns/roi-report.ts` | POST | frontend:1 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 27 | B | `campaigns/stage-availability-batch.ts` | GET | frontend:2 | none | — | reads | R1 | requireCampaignAccess+resolveUserContext | PASS |
| 28 | B | `campaigns/update-edited-committed.ts` | POST | frontend:1 | none | campaignId | service | R1 | requireCampaignAccess | PASS |
| 29 | B | `campaigns/weekly-refinements.ts` | GET | frontend:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 30 | B | `companies/[id]/efficiency.ts` | GET/POST | frontend:1 | none | [id], id | service | R1 | enforceCompanyAccess | PASS |
| 31 | B | `content-adapter/config.ts` | GET/POST | docs:1 frontend:1 | none | user_id | reads+writes | R1 | getSupabaseUserFromRequest | PASS |
| 32 | B | `content/generation-status/[jobId].ts` | GET | backend:3 other:1 tests:1 | none | — | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 33 | B | `governance/campaign-analytics.ts` | GET | docs:2 frontend:3 lib:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 34 | B | `images/search.ts` | GET | lib:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 35 | B | `insight/content-ideas.ts` | POST | docs:1 frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 36 | B | `opportunity/build-campaign.ts` | POST | api:1 frontend:1 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 37 | B | `performance/campaign/[id].ts` | GET | frontend:1 tests:1 | none | [id], id | service | R1 | requireCampaignAccess | PASS |
| 38 | B | `strategy-templates/[id].ts` | DELETE/GET/PUT | frontend:1 | none | [id], id | service | ALLOWLIST+R1 | identity-scoped (getSupabaseUserFromRequest) | PASS |
| 39 | B | `strategy-templates/index.ts` | GET/POST | frontend:1 | none | company_id, user_id | service | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 40 | B | `super-admin/creator-operations.ts` | GET | frontend:1 tests:1 | none | company_id | reads | R1 | requireSuperAdminUser | PASS |
| 41 | B | `system/health/metrics.ts` | GET | frontend:1 | none | — | service | R1 | requireSuperAdminUser | PASS |
| 42 | B | `team/assignments.ts` | GET | docs:1 frontend:1 | none | campaign_id, user_id | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 43 | B | `templates/[id]/index.ts` | DELETE/GET/PUT | docs:3 frontend:2 | none | [id], id | service | ALLOWLIST+R1 | identity-scoped (getSupabaseUserFromRequest) | PASS |
| 44 | B | `templates/index.ts` | GET/POST | docs:5 frontend:2 | none | campaign_id, user_id | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 45 | B | `trending/current.ts` | GET | backend:3 frontend:1 tests:4 | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 46 | B | `voice/notes.ts` | DELETE/GET/POST | frontend:1 | none | campaignId, id, noteId | reads+writes | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 47 | B | `voice/notes/[noteId].ts` | DELETE | frontend:1 | none | [noteId], noteId | reads+writes | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 48 | B | `voice/transcribe.ts` | POST | docs:1 frontend:2 | none | — | reads | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 49 | B2 | `admin/autonomous/decisions.ts` | GET | frontend:1 | getSupabaseUserFromRequest | campaign_id, company_id | service | R2+R3 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 50 | B2 | `campaign-planner/refine-idea.ts` | POST | docs:2 frontend:1 | getSupabaseUserFromRequest | companyId | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 51 | B2 | `campaigns/ai/plan.ts` | POST | backend:3 docs:24 frontend:10 lib:1 tests:7 | getCompanyRoleIncludingInvited+getUserCompanyRole | campaignId, companyId | reads | R3 | getUserCompanyRole+requireCampaignAccess | PASS |
| 52 | B2 | `campaigns/commit-weekly-plan.ts` | POST | docs:2 frontend:1 | getSupabaseUserFromRequest | campaignId | reads+writes | R2+R3 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 53 | B2 | `campaigns/planner-finalize.ts` | POST | docs:12 frontend:3 tests:1 | getSupabaseUserFromRequest+requireTenantAccess | campaignId, companyId | reads+writes | R3 | enforceCompanyAccess+getSupabaseUserFromRequest+requireTenantAccess | PASS |
| 54 | B2 | `campaigns/validate-uniqueness.ts` | POST | frontend:1 | getSupabaseUserFromRequest | campaignId, companyId | service | R2+R3 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 55 | B2 | `campaigns/weekly-alignments.ts` | GET/POST/PUT | frontend:1 | getSupabaseUserFromRequest | campaignId, reviewerId | reads+writes | R2+R3 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 56 | B2 | `campaigns/weekly-refinement.ts` | GET/POST/PUT | docs:1 frontend:1 tests:1 | getSupabaseUserFromRequest | campaignId, refinementId, userId | reads+writes | R2+R3 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 57 | B2 | `command-center/creator-content/render-inline.ts` | POST | frontend:2 lib:1 other:1 scripts:2 tests:3 | getSupabaseUserFromRequest | campaign_id, company_id | service | R2+R3 | enforceCompanyAccess+getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 58 | B2 | `command-center/creator-content/render-job/[id].ts` | DELETE/GET | frontend:1 | getSupabaseUserFromRequest | [id], id | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 59 | B2 | `companies/[id]/intelligence.ts` | GET | frontend:2 | getSupabaseUserFromRequest | [id], id | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 60 | B2 | `creator-intelligence/campaign-variant-estimate.ts` | GET | frontend:1 | enforceCompanyAccess+resolveUserContext | campaign_id, company_id, creator_id | reads | R3 | enforceCompanyAccess+resolveUserContext | PASS |
| 61 | B2 | `creator-templates/campaign-design-system/[campaignId].ts` | DELETE/GET/POST/PUT | frontend:3 | enforceCompanyAccess+resolveUserContext | [campaignId], campaignId, collection_id | service | R3 | requireCampaignAccess+resolveUserContext | PASS |
| 62 | B2 | `creator-templates/design-evolution/[campaignId].ts` | GET | frontend:1 | enforceCompanyAccess+resolveUserContext | [campaignId], campaignId | service | R3 | requireCampaignAccess+resolveUserContext | PASS |
| 63 | B2 | `creator-templates/design-performance/[campaignId].ts` | GET | frontend:1 | enforceCompanyAccess+resolveUserContext | [campaignId], campaignId | service | R3 | requireCampaignAccess+resolveUserContext | PASS |
| 64 | B2 | `domain/track-event.ts` | POST | frontend:1 | resolveAuthenticatedUser | company_id | reads+writes | R2 | resolveAuthenticatedUser | PASS |
| 65 | B2 | `engagement/content-opportunities/lifecycle.ts` | PATCH | frontend:1 | enforceCompanyAccess+resolveUserContext | campaign_id, content_id, id, organization_id, user_id | service | R3 | enforceCompanyAccess | PASS |
| 66 | B2 | `recommendations/analytics.ts` | GET | docs:1 frontend:1 tests:1 | withRBAC | campaignId, companyId | service | R3 | enforceCompanyAccess+withRBAC | PASS |
| 67 | B2 | `schedule/posts/[id].ts` | DELETE/GET/POST/PUT | docs:2 frontend:4 | getSupabaseUserFromRequest | [id], id | reads | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 68 | B2 | `team/assign-week.ts` | PATCH/POST | docs:3 frontend:1 | getSupabaseUserFromRequest | assigned_by_user_id, assigned_to_user_id, campaign_id, user_id | service | R2+R3 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 69 | B2 | `threadRuntime/introspect.ts` | GET | backend:1 | getSupabaseUserFromRequest | companyId, runtimeSessionId, threadId | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 70 | B2 | `user/subscription.ts` | GET | docs:3 frontend:1 lib:1 tests:1 | getSupabaseUserFromRequest | company_id | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 71 | D | `ai/check-claude-config.ts` | GET | — | none | — | service | R1 | requireSuperAdminUser | PASS |
| 72 | D | `ai/check-gpt-config.ts` | GET | — | none | — | service | R1 | requireSuperAdminUser | PASS |
| 73 | D | `campaigns/campaign-summary-update.ts` | GET/PUT | — | none | campaignId | reads+writes | R1 | requireCampaignAccess | PASS |
| 74 | D | `campaigns/recommendations.ts` | POST | — | none | campaignId, companyId | service | R1 | enforceCompanyAccess | PASS |
| 75 | D | `campaigns/recommendations/optimize-week.ts` | POST | — | none | companyId | service | R1 | enforceCompanyAccess | PASS |
| 76 | D | `campaigns/update-platforms.ts` | PUT | — | none | dayPlanId | reads | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 77 | D | `credits/estimate.ts` | POST | — | none | — | service | R1 | getSupabaseUserFromRequest | PASS |
| 78 | D | `governance/summary.ts` | GET | — | none | companyId | service | R1 | enforceCompanyAccess | PASS |
| 79 | D | `performance/ingest.ts` | POST | — | none | contentAssetId | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 80 | D | `posts.js` | GET | — | none | — | reads | R1 | requireSuperAdminUser | PASS |
| 81 | D | `publishing/reconcile/run.ts` | POST | — | fail-open secret | company_id, website_id, worker_id | service | R4 | machine-secret (secret) | PASS |
| 82 | D | `publishing/worker/run.ts` | POST | — | fail-open secret | worker_id | service | R4 | machine-secret (secret) | PASS |
| 83 | D | `queue/stats.ts` | GET | — | none | — | service | R1 | requireSuperAdminUser | PASS |
| 84 | D | `system/diagnostics/engagement.ts` | GET | — | none | — | service | R1 | requireSuperAdminUser | PASS |
| 85 | D | `website-analytics/aggregate.ts` | POST | — | fail-open secret | website_id | service | R4 | machine-secret (secret) | PASS |
| 86 | D | `wordpress-plugin/register.ts` | POST | — | none | company_id, connection_id, plugin_site_id, website_id | service | R1 | enforceCompanyAccess+enforceRole | PASS |
| 87 | D2 | `campaigns/ai/plan-v2.ts` | POST | — | getUserCompanyRole | campaignId, companyId | reads+writes | R3 | requireCampaignAccess | PASS |
| 88 | D2 | `campaigns/save.ts` | POST | docs:3 | getSupabaseUserFromRequest | campaignId | reads+writes | R2+R3 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 89 | D2 | `threadRuntime/failures.ts` | GET | — | getSupabaseUserFromRequest | companyId, threadId | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 90 | D2 | `threadRuntime/replay.ts` | GET | — | getSupabaseUserFromRequest | canonicalThreadId, companyId, runtimeSessionId, threadId | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 91 | D2 | `threadRuntime/timeline.ts` | GET | — | getSupabaseUserFromRequest | companyId, runtimeSessionId, threadId | service | R2 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 92 | F | `analytics/platform/[platform].ts` | GET | docs:7 | none | user_id | service | R1 | getSupabaseUserFromRequest | PASS |
| 93 | F | `analytics/post/[postId].ts` | GET | docs:7 | none | [postId], postId | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 94 | F | `campaigns/conflicts.ts` | GET | docs:3 other:2 | none | exclude_campaign_id, user_id | service | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 95 | F | `campaigns/get-strategy.ts` | GET | docs:1 | none | campaignId | reads | R1 | requireCampaignAccess | PASS |
| 96 | F | `campaigns/metrics.ts` | GET/POST | docs:1 | none | campaignId | reads+writes | R1 | requireCampaignAccess | PASS |
| 97 | F | `campaigns/weekly-performance.ts` | GET/POST/PUT | docs:1 | none | campaignId, campaign_id, id | reads+writes | R1 | getSupabaseUserFromRequest+requireCampaignAccess | PASS |
| 98 | F | `performance/collect.ts` | POST | tests:1 | none | campaign_id, post_id, recommendation_id | service | R1 | requireCampaignAccess | PASS |
| 99 | F | `social/comments.ts` | POST | docs:3 | none | accountId, commentId, postId, scheduled_post_id | reads | R1 | enforceCompanyAccess+getSupabaseUserFromRequest | PASS |
| 100 | F | `templates/[id]/render.ts` | POST | docs:3 | none | [id], id | service | ALLOWLIST+R1 | identity-scoped (getSupabaseUserFromRequest) | PASS |
| 101 | F | `trends/drift-check.ts` | POST | docs:1 | none | companyId | service | R1 | enforceCompanyAccess | PASS |

## 5. Dormant security pattern inventory (Phase 2 / Phase 4)

The same anti-pattern (tenant/object ids trusted from the request with no authenticated identity, or identity without tenant binding) was found in **31 routes with no in-repo runtime caller**: D (16), D2 (5) and F (10) in §4. Disposition:

| Disposition | Count | Routes / rationale |
|---|---|---|
| SAFE TO DELETE → deleted | **0** | Not one route had positive evidence of being unsupported. The standing AUTH-ENFORCEMENT design rule (v3, user-approved) is "lack of in-repo call sites is insufficient evidence a contract is obsolete; guard, never retire", and several have plausible out-of-repo callers (worker triggers, WordPress plugin, operator tooling). Deletion candidates with the evidence gathered are listed below for a separate retirement decision. |
| MUST HARDEN BEFORE RETAINING → hardened | **31** | All 31, with the same primitives and tests as the live routes. |
| INTENTIONALLY RETAINED | 12 | 7 retired endpoints that already answer 410 (allowlist `retired`, re-verified: 410 and no writes) and 5 legacy redirect shims (allowlist `redirect-shim`, re-verified: redirect only, no DB). |
| AMBIGUOUS | 10 | Class F (referenced only by tests/docs) — hardened as if live. |

Deletion candidates (hardened, **not** deleted): `posts.js` (legacy JS, returned the latest 20 `post_events` of **all** tenants; no callers), `queue/stats.ts`, `system/diagnostics/engagement.ts`, `performance/ingest.ts`, `governance/summary.ts`, `credits/estimate.ts`, `ai/check-claude-config.ts`, `ai/check-gpt-config.ts`, `trends/drift-check.ts`, `campaigns/{campaign-summary-update,conflicts,get-strategy,metrics,recommendations,recommendations/optimize-week,update-platforms,weekly-performance,save,ai/plan-v2}.ts`, `threadRuntime/{failures,replay,timeline}.ts`, `publishing/{worker,reconcile}/run.ts`, `website-analytics/aggregate.ts`, `wordpress-plugin/register.ts` (the PHP plugin only calls `setup/connect`, `revoke`, `heartbeat`, `sync`, `token-rotate`), `ai/daily-amendment.ts` and `ai/weekly-amendment.ts` (their server-side relative `fetch('/api/ai/claude-chat')` throws, so they can only return 500).

Protection against a dormant route silently becoming an entry point again: it is a mounted `pages/api` file, so it is gated exactly like a live one — `routeAuth001Scanner.test.ts` pins that an unreferenced vulnerable route fixture fails R1.

## 6. Tests

- 15 new suites under `backend/tests/unit/routeAuth001*.test.ts` using the shared harness `backend/tests/helpers/routeAuthHarness.ts`: only the database and the identity provider are faked; `resolveUserContext`, `enforceCompanyAccess`, `TenantGuard.assertTenantAccess`, `requireCampaignAccess`, the campaign ownership binding and `rbacService` run for real. Per remediated route (where applicable): no auth → 401 with the sink never reached; other tenant → 403/404 with no write and no leak of the other tenant's canary; correct member → success; a client-supplied tenant id cannot override the bound tenant; object ids cannot cross tenants.
- `routeAuth001Scanner.test.ts`: fixtures for every shape the old detector missed (campaignId, `[id]`, `user_id`, delegated service calls, a dormant unreferenced route), the ways a textual scanner is fooled (comment, string, unused import, local look-alike, wrong-module import, regex literal), R4 fail-open vs fail-closed shapes, allowlist evidence re-verification, and a repository-wide assertion that every route passes.
- Existing suites updated because they exercised a route that now (correctly) requires a caller or a binding: `d4SearchVolumeAttribution`, `d5YouTubeFabricatedEvidence`, `d6RedditFallbackFabrication`, `unionMatrixSources` (`/api/trending/current` now authenticates), `opt010Wave1` (generation-status binds the job's company), `opt010Wave2` (weekly-refinement binds the campaign), `creatorOperationsWiring` (super-admin now via `requireSuperAdminUser`, never `user_metadata`), `facebookInstagramSyncVisibility` (callback membership check), `renderInlineFontInit` (render-inline binds company/campaign), `integration/performance_feedback` (collect/campaign bind the campaign).

## 7. Remaining risks (not closed by this change)

1. **Static gate limits.** R1–R3 are per file, not per HTTP method: a file whose GET authenticates but whose POST does not would pass R1 if any code path calls a primitive. R2/R3 and the per-route review mitigate it; per-method enforcement needs the Phase 2 route-policy gate (`docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md`).
2. **Binding claims are reviewed, not proven.** 65 `inline-binding`/`identity-scoped` entries rest on line-level review; their `evidence` regex anchors the binding code but cannot prove its semantics. Two routes classified BOUND carry notes: `campaigns/[id]/propose-frequency-rebalance.ts` issues a server-side fetch to the caller-supplied `Origin` header forwarding the caller's credentials (SSRF, separate finding), and `isSuperAdmin`/`isPlatformSuperAdmin` ignore `user_company_roles.status`.
3. **Existence oracles.** Foreign campaigns answer 403 on `requireCampaignAccess` routes vs 404 for unknown ones (pre-existing), and `enforceCompanyAccess` now answers 404 for a foreign campaign but allows an unknown id (required by creation flows). Both reveal only whether a UUID exists, to an authenticated caller.
4. **Operational.** The three worker triggers now fail closed and answer 503 in production until `PUBLISHING_WORKER_SECRET` / `ANALYTICS_WORKER_SECRET` are set (no in-repo callers). OAuth callbacks now require the Supabase session cookie on the provider redirect (top-level GET, SameSite=Lax) — run one live connect flow before deploy. Campaigns with no `campaign_versions` row now 404 on routes that previously had no authentication at all. `campaign_design_systems` rows planted before the fix may still be read at generation time by `loadCampaignTemplatePool` (a read-only data check is advisable).
5. **Out of scope (STEP 3AH-84, unchanged here):** extension/RPA signing-secret fallback chains (P1 latent), external-API catalog env-name exfiltration (P1 conditional), OAuth `returnTo` open redirect and unsigned community-AI state (P2), secrets in provider error logs (P2), fail-open rate limiting, BullMQ environment prefix, `health/config` verbosity, sessionless passkey credential-id disclosure.

## 8. Regenerating
```
npm run check:route-auth          # the CI gate
npm run security:route-inventory  # full inventory → artifacts/route-auth-inventory.json
```

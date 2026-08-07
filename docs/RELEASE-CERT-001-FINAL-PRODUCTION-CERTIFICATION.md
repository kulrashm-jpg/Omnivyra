# RELEASE-CERT-001 — Final Production Certification

**Date:** 2026-08-04
**Branch:** `feat/sec001-auth-enforcement-phase1` (local HEAD `2aa33f80`, origin `e02e2f23` — **diverged**)
**Scope:** independent certification. No implementation, no refactor, no redesign.

## VERDICT: ⛔ NO GO

Two blockers qualify under all four Task-7 criteria (reproducible, production-impacting, not already documented, not a future enhancement). Both are cheap to fix; neither is a design problem.

---

## Blocker 1 — the release does not build from a clean checkout (CRITICAL)

Local commit **`fefd369c feat(seo): OPT-006 marketing metadata and blog ISR`** is **incomplete**. It committed code that imports and references two files it never `git add`ed:

| Referenced by (committed) | Missing file | Effect |
| --- | --- | --- |
| `components/seo/MarketingPageMeta.tsx`, `pages/blog/[slug].tsx`, `backend/tests/unit/marketingPageMeta.test.ts` | **`lib/siteUrl.ts`** (untracked) | module resolution failure → **build fails** |
| `pages/about.tsx`, `pages/admin/blog/{index,new,content-editor}.tsx`, `pages/admin/blog/edit/[id].tsx` | **`public/logo.webp`** (untracked) | broken images on marketing + admin pages |

Evidence:

```
git show HEAD:lib/siteUrl.ts      → absent at HEAD
git check-ignore lib/siteUrl.ts   → not ignored (simply never added)
git show HEAD:components/seo/MarketingPageMeta.tsx | grep lib/siteUrl → present
```

**Blast radius is bounded and the news is good:** `origin/main` has neither the references nor the files, and the *pushed* branch does not have them either. The inconsistency exists only in **local unpushed commits**. So production today is unaffected — but pushing/deploying this branch as-is fails the Vercel build.

* Reproducible: clone at HEAD → `next build` cannot resolve `../../lib/siteUrl`.
* Fix: `git add lib/siteUrl.ts public/logo.webp` and amend/extend the commit. No code change.

---

## Blocker 2 — unauthenticated cross-tenant media API (CRITICAL, pre-existing)

Three routes perform **no authentication and no authorization whatsoever**:

| Route | Method | Exposure |
| --- | --- | --- |
| `pages/api/media/list.ts` | GET | reads media across **all tenants** |
| `pages/api/media/[id].ts` | GET, **DELETE** | reads *and deletes* any media by id |
| `pages/api/media/link.ts` | POST | attaches arbitrary media to arbitrary scheduled posts |

`pages/api/media/upload.ts` **is** guarded — the gap is not uniform, which is why it went unnoticed.

Mechanism:

```ts
// pages/api/media/list.ts — user_id is OPTIONAL and client-supplied
const { user_id } = req.query;
if (user_id && typeof user_id === 'string') options.userId = user_id;
const mediaFiles = await listMediaFiles(options);

// backend/services/mediaService.ts:365 — no tenant filter when userId is absent
let query = ownedDbTable('media_files').select('*');
if (options.userId) query = query.eq('user_id', options.userId);
```

`ownedDbTable` is the **service-role** client, so RLS does not mitigate this. Omitting `user_id` returns the 50 most recent media rows platform-wide, including `file_url`s; supplying an arbitrary `user_id` enumerates that user's media.

No mitigating layer exists: there is **no root `middleware.ts`**, and `createApiRoute` applies only an *observation-only* policy gate that requires an `opts.policy` these routes do not declare.

* Reproducible: `curl https://<host>/api/media/list` unauthenticated.
* **Pre-existing** — untouched by this release (last change: `20556103`, a perf commit). It is not a regression introduced here, but it is live in production now and blocks a clean certification.
* Not covered by any SEC-001A/B/C/D document.

---

## Task 1 — Repository-wide release audit

| Check | Finding | Class |
| --- | --- | --- |
| TODO in intelligence subsystems | **0** | — |
| FIXME / XXX | 4 + 2, **all inside a quality-gate detector regex** (`phase1QualityGates.ts`) | Intentional |
| TODO in files shipping in this tree | **1** — `pages/media-library.tsx:45` "Get from auth session" | Can wait |
| Debug logging | `META DEBUG` blocks in `auth/instagram/callback.ts` are gated behind `config.META_DEBUG`; other OAuth logs print `!!token` booleans, not secrets | Intentional |
| `console.log` in `pages/api` | 142 occurrences — hygiene only, no secret/token/PII printing found | Can wait |
| Test hooks in production modules | 6 `NODE_ENV === 'test'` early-returns; unreachable in production. `__resetTelemetryThrottleForTests` is exported from `leadIntelligenceTelemetry` | Intentional |
| Feature flags accidentally enabled | Default-ON flags (`WIKIDATA_ENABLED`, `DISTRIBUTED_POOL_ENABLED`, `STREAMING_DRAFT_ENABLED`, `REFINE_VARIANT_BILLING_ENABLED`) are long-standing product defaults, not leftovers. `LEGACY_BRIDGE_DRY_RUN` correctly defaults **off** | Intentional |
| Forgotten kill-switch | None | — |
| Temporary compatibility code | The SEC-001 bridge — deliberately retained, see below | Intentional |

The `media-library.tsx` TODO reads `process.env.DEFAULT_USER_ID` in a browser `useEffect`; Next.js only inlines `NEXT_PUBLIC_*` client-side, so it always resolves to `''`. No hardcoded identity leaks. The *real* exposure on that page is Blocker 2, server-side.

## Task 2 — Security certification

# FAIL

| Dimension | Result |
| --- | --- |
| Authorization | **FAIL** — 3 unauthenticated media routes (Blocker 2) |
| Tenant isolation | **FAIL** — same; service-role client, no tenant filter |
| Privilege escalation | PASS — bridge is HMAC-signed, hard-expiring, cannot satisfy step-up; canonical identity wins on conflict |
| Route policies | PASS WITH OPERATIONAL ACTIONS — policy gate is observation-only by design (Phase 1); it is not a control yet |
| Audit logging | PASS — every bridge decision, grant and rejection, is audited |
| Bridge retirement | PASS WITH OPERATIONAL ACTIONS — 0 bridge-only routes, one lifecycle evaluator; cutover prerequisites open (SEC-001D §9) |
| Capability routing | PASS — `IdentityResolver` tries canonical first, bridge is step 3 |
| Legacy paths | PASS — 0 raw cookie comparisons, signature-only helper deleted |
| Production secrets | PASS WITH OPERATIONAL ACTIONS — `BRIDGE_COOKIE_SECRET` unset locally (falls back to `SESSION_COOKIE_SECRET`); production env must be confirmed in Vercel/Railway, not from `.env.local` |

Authorization and tenant isolation are the two dimensions that cannot be waived, so the aggregate is **FAIL**.

## Task 3 — Deployment certification

| Item | State |
| --- | --- |
| Migrations | ✅ 369 files. `lead_intelligence_profiles` verified **PRESENT in production** — the INT prerequisite is already applied, contrary to the standing note that it was pending |
| Environment variables | ⚠️ verify in Vercel/Railway: `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `BRIDGE_COOKIE_SECRET`. `.env.local` is not evidence about production |
| Health endpoints | ✅ `health`, `health/live`, `health/readiness`, `health/metrics`, `health/internal`, `health/config`, `health/publish-loop` |
| Smoke scripts | ✅ `predeploy:check`, `smoke:intelligence` (script tracked; npm entry added in this tree) |
| Rollback | ✅ documented per program; branch-level `git checkout --` |
| Kill switch | ✅ `LEGACY_BRIDGE_DRY_RUN` (off by default), plus per-subsystem flags |
| Monitoring / telemetry | ✅ `plannerExporters/prometheusRegistry.ts`, `PROMETHEUS_EXPORTER_ENABLED`, `OBSERVABILITY_ENABLED` |
| Dashboards / alerts | ⚠️ not verifiable from the repository — external systems |
| Runbooks | ✅ INT-002 activation, billing activation, emergency billing, website-intelligence deployment |
| Schema drift | ✅ `check:schema-drift`, `check:schema-authority`, `check:frozen-schemas` |

**Deploy-discipline conflict:** the standing rule is "deploy only clean `origin/main` via predeploy-check". This candidate is a feature branch, 35 commits ahead of main, with 103 modified + 11 untracked files and unpushed local commits. It is not a deployable artifact in its current form.

## Task 4 — Production readiness audit

| Risk | Finding |
| --- | --- |
| Silent failure | Bridge audit writes are fire-and-forget with swallowed rejections — intentional (audit failure must not break auth), but audit loss is silent |
| Data corruption | None found in this release |
| **Tenant leak** | **YES — Blocker 2**, unauthenticated cross-tenant read/delete/write |
| Security regression | None introduced by SEC-001A–D; all four raise the floor |
| Performance regression | None found; OPT program committed and regression-covered |
| **Availability risk** | Bridge hard expiry `2026-08-05T00:00:00Z` (~hours away) against **undeployed** fixes; and only **1** DB-backed `SUPER_ADMIN` exists |
| Operational risk | `CONTENT_ARCHITECT` has **0** DB rows — the role exists only as a cookie-synthesized principal and retires with the bridge |
| **Rollback risk** | **YES** — the release candidate is an uncommitted working tree mixing several programs. There is no single revertible artifact, so rollback granularity is undefined |

## Task 5 — Cleanup inventory (only items that should actually be removed)

| Item | Action |
| --- | --- |
| `.claude/settings.json` modification | Exclude from the release commit — local agent permissions, not product code |
| `next-env.d.ts` modification | Exclude — auto-generated, differs between `next dev` and `next build` |
| SEC-001B/C/D ratchet suites | **Do not remove now.** They are active guards. Remove *with* the bridge (SEC-001D §10 step 8) — a ratchet that outlives its subject passes vacuously forever |
| `bridgeUsageMonitor`, bridge metrics | Keep until cutover — they are the instruments the cutover decision depends on |
| `isLegacyBridgeDryRun` export | Narrow to module-internal after tests stop importing it |

No dead code, duplicate implementations, unused migrations, orphan tests or orphan scripts were found that should be removed now.

## Task 6 — Release inventory

**Implemented**
SEC-001A (architect cookie hardening) · SEC-001B (raw-comparison elimination, 31 routes) · SEC-001C (lifecycle unification, single evaluator) · SEC-001D (cutover: 0 bridge-only routes) · INT-001/002/003 + hardening · OPT performance program · RELEASE-INT-001 · STABILIZE-INT-001

**Deferred**
Bridge code deletion (post-expiry) · route-policy gate enforcement (Phase 2) · `isLegacyBridgeDryRun` narrowing

**Operational actions**
1. `git add lib/siteUrl.ts public/logo.webp`; commit the working tree into a defined artifact — **Blocker 1**
2. Add authentication + tenant scoping to the 3 media routes — **Blocker 2**
3. Provision a second DB-backed `SUPER_ADMIN`
4. Confirm bridge/super-admin env vars in Vercel/Railway
5. Deploy SEC-001A–D **before** the bridge hard expiry
6. Re-run `LEGACY_BRIDGE_DRY_RUN=1` post-deploy for a full operator cycle

**Product decisions**
Fate of `CONTENT_ARCHITECT`: provision DB rows, or accept that the capability retires with the bridge

**Future enhancements**
Reduce `console.log` in `pages/api` (142) to structured logging · route-policy enforcement mode

## Task 7 — Go / No-Go

**NO GO.** Blocker qualification:

| Blocker | Reproducible | Production-impacting | Not already documented | Not a future enhancement | Qualifies |
| --- | --- | --- | --- | --- | --- |
| 1 — incomplete commit `fefd369c` | ✅ clean checkout fails to build | ✅ deploy fails | ✅ | ✅ | **YES** |
| 2 — unauthenticated media API | ✅ single unauthenticated `curl` | ✅ live cross-tenant read/delete/write | ✅ | ✅ | **YES** |

The bridge cutover items are **already documented** in SEC-001D §9, so they are operational actions, not qualifying blockers.

## Rollback verification

* **Blocker 1 fix** — additive (`git add`); revert by unstaging. Zero runtime risk.
* **Blocker 2 fix** — adding auth to 3 routes; revert per-route. Risk is *availability* (a wrong guard 403s legitimate users), not exposure.
* **SEC-001A–D** — `git checkout --` on the touched files; each two-arm gate is independent. No migrations, schema, or flags.
* **Undefined granularity today** — until the working tree is committed, there is no artifact to roll back *to*. Resolving Blocker 1 also resolves this.

## Final remaining risks

1. Release candidate is an uncommitted working tree, not an artifact (Blocker 1).
2. Live unauthenticated cross-tenant media API (Blocker 2).
3. Bridge hard expiry hours away with fixes undeployed.
4. Single DB-backed `SUPER_ADMIN`; zero `CONTENT_ARCHITECT` rows.
5. Bridge principals are anonymous — usage cannot be attributed to a person.
6. Deployment smoke unrun (requires a deployed environment).
7. Dashboards/alerts not verifiable from the repository.

## Verification performed

199 test suites — **2245 passed, 8 failed**; all 5 failing suites proven pre-existing and unrelated. Typecheck baseline `47 / 48`, sole excess the pre-existing `OutcomeGallery.tsx TS17001`. ESLint exit 0. Production schema probed read-only. Repository-wide greps for TODO/FIXME, debug logging, kill switches, default-on flags, test hooks, raw cookie authorization, duplicate HMAC and lifecycle implementations.

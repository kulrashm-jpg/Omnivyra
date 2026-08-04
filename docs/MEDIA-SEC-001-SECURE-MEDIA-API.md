# MEDIA-SEC-001 — Secure Media API Certification

**Status:** implemented, uncommitted (local only — no push / PR / merge / deploy)
**Date:** 2026-08-04
**Closes:** RELEASE-CERT-001 Blocker 2

---

## 1. Verification of the certification finding (Task 1)

All four claims are **CONFIRMED**, each with a mechanism, not an inference.

| Claim | Verdict | Proof |
| --- | --- | --- |
| `list` unauthenticated | **TRUE** | `pages/api/media/list.ts` contained no auth call of any kind; `user_id` was an *optional* query param |
| `delete` unauthenticated | **TRUE** | `pages/api/media/[id].ts` DELETE branch called `deleteMediaFile(id)` directly — no identity, no ownership |
| `link` unauthenticated | **TRUE** | `pages/api/media/link.ts` inserted into `scheduled_post_media` from raw body ids |
| service-role bypasses tenant isolation | **TRUE** | all four service functions use `ownedDbTable`, which builds its client from `SUPABASE_SERVICE_ROLE_KEY` → RLS does not apply |

The unscoped read is structural, not incidental:

```ts
// mediaService.listMediaFiles — the predicate is CONDITIONAL
let query = ownedDbTable('media_files').select('*');
if (options.userId) query = query.eq('user_id', options.userId);   // ← absent ⇒ no filter
```

Omitting `user_id` returned the most recent rows platform-wide; supplying an arbitrary one enumerated that user.

**No mitigating layer existed.** There is no root `middleware.ts`, and `createApiRoute` runs only an *observation-only* policy gate that requires an `opts.policy` these routes never declared. Wrapping a route in the factory confers no authorization.

### Why it went unnoticed
`pages/api/media/upload.ts` — the fourth sibling — **was** guarded with `getSupabaseUserFromRequest`. The family looked protected from a glance at any single guarded file.

## 2. Tenant model (the decision that shapes everything below)

Probed against production:

```
media_files columns:      id, user_id, file_name, ..., is_public, campaign_id
scheduled_posts columns:  id, user_id, campaign_id, ...
```

**Neither table has a `company_id`.** Both are USER-anchored, so the tenant boundary *is* row ownership. "Tenant membership" and "ownership" are the same predicate here; there is no company column to join through, and introducing one would be a redesign.

Consequence, stated explicitly: **a COMPANY_ADMIN is not granted access to another user's media.** That is not an oversight — every existing caller passes its own user id, so scoping to the authenticated user preserves current intended behaviour exactly. Company-level media sharing would be a *feature*, and this is a security fix.

## 3. Implementation (Task 2)

One minimal shared helper, `backend/services/mediaAuthorization.ts`, composing **only** canonical platform primitives — `getSupabaseUserFromRequest` (authentication) and `isPlatformSuperAdmin` (the DB-backed `user_company_roles.role='SUPER_ADMIN'` role). No second auth system, no new role, no new token.

| Export | Purpose |
| --- | --- |
| `requireMediaCaller(req, res)` | authenticate; 401 + `null` on failure |
| `ownsRow(caller, row)` | ownership predicate; **fails closed on a null owner** |
| `resolveListOwnerId(caller, requested)` | own id, unless platform admin targets another |
| `ownsMediaFile` / `ownsScheduledPost` | ownership lookups; **fail closed on read error** |

| Route | Authentication | Tenant / ownership | Least privilege |
| --- | --- | --- | --- |
| `GET /api/media/list` | required | `userId` derived from session, **never optional, never client-controlled** | own media only; platform admin may target an owner explicitly; `limit` bounded to 200 |
| `GET /api/media/[id]` | required | row fetched, then `ownsRow` | owner or platform admin |
| `DELETE /api/media/[id]` | required | same predicate, evaluated **before** any destructive call | owner or platform admin |
| `POST /api/media/link` | required | **both** ids must be owned | owner or platform admin |

Two deliberate design points:

* **404, not 403, on unauthorized.** A 403 confirms that a media id exists, turning the route into an existence oracle for id enumeration. "Not yours" and "not there" are indistinguishable — pinned by a test that asserts the two responses are byte-identical.
* **`link` checks both sides.** Owning one is not enough: owning the media but not the post publishes your asset from a stranger's account; owning the post but not the media pulls a stranger's asset into your publication.

**No client change was required.** `pages/media-library.tsx` and `components/MediaSelector.tsx` call these routes with plain same-origin `fetch`, which carries the Supabase session cookie — the same mechanism the already-guarded `upload.ts` relies on, proving cookie auth works for these callers.

## 4. Service usage (Task 3)

| Requirement | Result |
| --- | --- |
| No service-role access leaks | Service-role usage remains **inside** `mediaService`; it is never reachable without passing a route-level ownership gate |
| No cross-tenant reads | `listMediaFiles` is now **always** called with a session-derived `userId`; `getMediaFile` results are ownership-filtered before serialization |
| No cross-tenant deletes | `deleteMediaFile` is unreachable until `ownsRow` passes |
| No cross-tenant writes | `linkMediaToPost` is unreachable until **both** ownership lookups pass |

**Residual, disclosed:** the `mediaService` functions themselves still accept arbitrary ids and remain unscoped at the data layer. Enforcement is at the route boundary. This was deliberate — `mediaService.ts` is outside the declared scope ("everything else is read-only"), and the four functions have **exactly four callers**, all of them the now-guarded media routes (verified by repository grep). Pushing an `ownerUserId` predicate into the service would add defence in depth and is the recommended follow-up.

## 5. Regression (Task 4)

`backend/tests/unit/mediaSec001Authorization.test.ts` — **25 tests, all passing**, covering every caller class the task named:

| Caller | list | `[id]` GET | `[id]` DELETE | link |
| --- | --- | --- | --- | --- |
| anonymous | 401, service untouched | 401, nothing read | 401, nothing destroyed | 401, nothing linked |
| correct tenant | scoped to self | 200 | 200 + delete executed | 200, both sides owned |
| wrong tenant | client `user_id` cannot widen | 404 | 404 + delete **not** executed | 404 |
| company admin (non-platform) | own media only | 404 | 404 | 404 |
| super admin | may target another owner | 200 | 200 | may link across owners |

Plus: foreign id and non-existent id are indistinguishable; a NULL-owner row is not readable by an ordinary user; `limit` is bounded and never `NaN`; `link` rejects non-string ids before any lookup; `display_order` is coerced to a safe non-negative integer; owning only one side of a link fails.

Wider run — 127 suites across media, auth, security, tenant, rbac, identity, policy: **1588 passed, 4 failed**. All four are the known pre-existing suites (`omnivyra_learning_bridge`, `aiCacheTenantScopingContract`, `boltModeCapability`, `phase2RouteWiring.entryConsumption`), previously proven pre-existing by stashing every change. ESLint exit 0.

## 6. Repository sweep (Task 5)

Every media-touching API route now carries a guard:

```
GUARDED: pages/api/media/{list,[id],link,upload}.ts
GUARDED: pages/api/activity-workspace/[id]/{shared-media,upload-media,upload-media-direct,upload-media-finalize}.ts
GUARDED: pages/api/super-admin/linkedin-media-smoke-test.ts
GUARDED: pages/api/website-intelligence/remediation.ts
UNGUARDED: (none)
```

`mediaService` is imported by exactly four routes, all guarded. No media helper bypasses authorization.

**One finding outside scope, reported not fixed** — `pages/api/media/upload.ts` authenticates, but then accepts a client-supplied `user_id` and uses it whenever it is a valid UUID:

```ts
const userId = typeof providedUserId === 'string' && uuidPattern.test(providedUserId)
  ? providedUserId : user.id;
```

An authenticated user can therefore attribute an upload to **another** user. That is an ownership-integrity weakness, not an exposure (it writes, it does not read across tenants), and `upload.ts` is outside the declared scope. Recommended: ignore `user_id` unless the caller is a platform admin — the same `resolveListOwnerId` rule already used by `list`.

## 7. Rollback

Additive and self-contained; no migrations, no schema, no flags, no client changes.

* **Whole change:** `git checkout -- pages/api/media/ backend/services/mediaAuthorization.ts` (new file: delete it).
* **Per route:** each route's guard is independent; reverting one does not affect the others.
* **Risk direction:** a rollback re-opens unauthenticated cross-tenant access. The failure mode of the *fix* is availability (a wrong guard 403/404s a legitimate user), never exposure — the gates fail closed by construction.

## 8. Production verdict

**Blocker 2 of RELEASE-CERT-001 is CLOSED.**

Media API: authentication enforced on all four routes, ownership enforced on every read, delete and write, least privilege by default, no existence oracle, no client-controlled tenant predicate.

This does **not** by itself flip RELEASE-CERT-001 to GO. Blocker 1 (incomplete commit `fefd369c` — untracked `lib/siteUrl.ts` and `public/logo.webp` break a clean build) remains open and is unrelated to this program.

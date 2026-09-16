# SEC-91 W2-G — Wave-2 authorization residuals (STEP 3AH-91)

**Base:** integration head `a9719cc` (wave 1 + W2-A + W2-F merged). **Branch:** `sec/3ah91-w2g-authz-residual` (worktree `C:/tmp/sec91-w2g`). Code + test remediation only: no production access, no network to real services, no migrations, no env/secret changes. Files owned by the concurrent W2-E workstream were not edited (none of the fixes needed them).

Scope: the residuals W2-A left open (`docs/security/SEC91_W2A.md` §6, §7, §8). Rule applied to every role decision, as in W2-A: a role gate is added only where the repository already states the policy for the action.

## 1. Inventory

Line numbers are on base `a9719cc`.

| ID | Sev | Finding | Current status on base (evidence file:line) | Classification | Files | Fix | Tests |
|---|---|---|---|---|---|---|---|
| W2G-1 | P3 | Canonical content write routes open to read-only roles (VIEW_ONLY and the aliases VIEWER / CONTENT_ENGAGER) | Membership only (`enforceCompanyAccess`) then the write: `content/index.ts:22,26` (POST, incl. body `lifecycleStatus`); `content/[id].ts:23,37,55` (PATCH, DELETE = archive); `content/[id]/status.ts:22,26`; `content/[id]/approval.ts:26,43`; POST in `[id]/{assets,blocks,lineage,performance,prediction,quality,recommendations,variants}.ts`; `content/mark-used.ts:28,34` (updates `blogs`). Policy: VIEW_ONLY holds view capabilities only (`backend/security/capabilityRegistry.ts`), has no content work-area (`config/commandCenterCards.ts` ROLE_ACCESS_MAP: VIEW_ONLY = reports + engagement); content authoring set = `PERMISSIONS.CREATE_CAMPAIGN` (`backend/services/rbacService.ts:50-56`), the set W2A-1b used for `PUT /api/campaigns/:id` | FIX | `backend/services/content/contentWriteAuthz.ts` (new), `pages/api/content/index.ts`, `pages/api/content/[id].ts`, `pages/api/content/[id]/{approval,assets,blocks,lineage,performance,prediction,quality,recommendations,status,variants}.ts`, `pages/api/content/mark-used.ts` | write methods only: `enforceRole` with the CREATE_CAMPAIGN set, role read for the company the route already authorized; reads unchanged | `sec91W2GContentWriteRbac` (325) |
| W2G-1a | — | `content/[id]/revisions.ts` | GET only (`:25`), 405 otherwise | FALSE POSITIVE (no write) | — | — | read covered in `sec91W2GContentWriteRbac` |
| W2G-1b | — | `content/suggest.ts`, `content/quick-platform-adapt.ts` | Pure compute: AI suggestion (`suggest.ts:55`, no persistence in `contentSuggestionService`) / AI platform rewrite returned to the caller (`quick-platform-adapt.ts:370-513`, credit metering billed to the caller's own authorized company, no content row written) | FALSE POSITIVE (no persistent content write) — not gated | — | — | — |
| W2G-1c | — | `content/creator/generate.ts`, `content/platform-rules.ts`, `content/list.ts`, `content/generation-status/[jobId].ts` | 410 retired (`creator/generate.ts:10-16`); static GET reference data; GET-only list (`withRBAC(ALL_ROLES)`); GET job status | FALSE POSITIVE (no write) | — | — | — |
| W2G-1d | — | `content/approve.ts`, `reject.ts`, `regenerate.ts`, `generate-day.ts`, `generate-from-card.ts`, `improve-draft.ts` | Already role-gated: `withRBAC([SUPER_ADMIN, ADMIN, CONTENT_MANAGER])` (`approve.ts:28`, `reject.ts:28`), `withRBAC([..., CONTENT_CREATOR, CONTENT_MANAGER])` (`regenerate.ts:58`, `generate-day.ts:193`), `enforceRole([COMPANY_ADMIN])` (`generate-from-card.ts:95-97`), `enforceRole(authoring set)` (`improve-draft.ts:45-49`) | ALREADY FIXED (read-only roles already refused) — see N1 for a different gap in approve/reject | — | — | — |
| W2G-2 | P3 | `POST /api/campaigns/pending/:id/approve` creates + schedules a campaign after a membership check only | `campaigns/pending/[id]/approve.ts:48` (`requireCompanyAccess`), `:93` campaigns insert (`status: 'scheduled'`); the reject branch (`:55`) is the same handler. Policy: W2A-1d — `admin/autonomous.ts` POST (same autonomous surface, `components/admin/AutonomousControlPanel.tsx:4` "Allows company admins to … review pending campaigns"), CAMPAIGN_EXECUTE admin-only in `capabilityRegistry.ts` | FIX | `pages/api/campaigns/pending/[id]/approve.ts` | same inline check as `admin/autonomous.ts`: COMPANY_ADMIN (incl. legacy ADMIN) / SUPER_ADMIN row in the pending campaign's company, or platform super admin | `sec91W2GPendingCampaignApprove` (16) |
| W2G-3 | P3 | Orchestration synchronizer interpolates its argument into a PostgREST `.or()` | `orchestrationStateSynchronizer.ts:108` `.or(\`id.eq.${activityId},execution_id.eq.${activityId}\`)`; callers: `canonicalExecutionAdapter.ts:293,411` (keys already validated by `isSafeActivityKey` or taken from a stored row) — defence in depth | FIX | `backend/services/orchestration/synchronization/orchestrationStateSynchronizer.ts` | reuse `isSafeActivityKey`; unsafe key ⇒ `null`, no query, raw key not logged (adapter semantics: refuse before any query) | `sec91W2GSynchronizerActivityKey` (21) |
| W2G-4 | P3 | Invited COMPANY_ADMIN admitted into a suspended / inactive / deleted company | `userContextService.ts:295-309` invited fallback runs because `TenantGuard.ts:284,384` returns STALE_MEMBERSHIP before the org read; contradicts the helper's own doc `:147-148`. `campaignAccessService.ts:188` → `getUserCompanyRole` → `getUserRole` invited fallback (`rbacService.ts:197-213`), no org check (W2-A §8) | FIX | `backend/services/userContextService.ts`, `backend/services/campaignAccessService.ts`, `backend/services/companyOperationalState.ts` (new; the W2A-5a helper, moved and shared) | both fallbacks require `companies.status='active'`: missing / non-active ⇒ 403, lookup error ⇒ retryable 503; platform super admins keep their bypass and never depend on the company read. TenantGuard.ts unchanged | `sec91W2GInvitedAdminOrgStatus` (33, incl. 21-case parity matrix) |
| W2G-5 | P3 | `setPrincipal()` records the principal with `mergeRequestContext` (`enterWith`) — invisible to the caller when called inside an awaited guard; `policyGate` is such a caller | `lib/platform/requestContext.ts:115-120`; `lib/platform/policyGate.ts:58` inside `buildPrincipalView` (awaited from `observePolicy`, awaited by `routeFactory.ts:133` before `composed(req,res)` `:140`) | FIX | `lib/platform/requestContext.ts`, `lib/platform/policyGate.ts`, `backend/services/requestContext.ts` (source union) | `setPrincipal` first calls W2-A's `attributeAuthenticatedPrincipal` (live store, `ai-guard-principal` flag: default shadow = `authPrincipal` only), then the unchanged merge; policyGate forwards `activeOrgId` only when it is an ACTIVE membership | `sec91W2GPolicyGatePrincipal` (13) |
| W2A-2d | P3 | WordPress plugin registration nonce never expires | `wordpress_plugin_registrations` has no nonce-issued/expiry column (`auth_nonce_hash` only, `20260678…:196`); the row's `updated_at` is rewritten by verify, heartbeat and token rotation (`wordpressPluginService.ts:110,268,406`), so it cannot stand in for issuance time | MANUAL (needs a migration — out of scope for code-only remediation) | — | patch in §6.1 | — |
| W2A §6.5 | — | `contentRouteModel.ts` `persistMasterToDb` / `persistVariantsToDb` accept any activity id (no campaign threading) | Not reachable: the handler passes only `writeActivityId`, a row id it resolved and bound to the authorized company (W2F-1a), and the writer prefers the exact row-id match (`canonicalExecutionAdapter.ts:392`) | INTENTIONALLY ACCEPTED (see §6.2) | — | — | covered by W2-A's `sec91W2AActivityWorkspaceBinding` |
| W2A §7.4 | — | Content lifecycle transition matrix (who may approve / schedule / publish) | Unchanged: every CREATE_CAMPAIGN role may set any lifecycle status / advance approval | MANUAL (product owner decision; deliberately not implemented) | — | — | — |
| N1 | P2 (new, not in registry) | `POST /api/content/approve` / `reject`: `assetId` is not bound to the authorized company | `approve.ts:15-21`, `reject.ts:15-21` authorize body `companyId`, then `approveContentAsset({ assetId })` / `rejectContentAsset` (`contentAssetService.ts:102-138`) load the asset by id alone. The sibling `regenerate.ts:24-39` has exactly this IDOR guard; approve/reject do not | NOT FIXED — outside the registry; patch proposed in §6.3 | — | — | — |
| N2 | P3 (new, not in registry) | `/api/company/blogs` POST / DELETE are membership-only | `pages/api/company/blogs.ts:16` `enforceCompanyAccess`, writes at `:48`, `:111`; the sibling `pages/api/blogs/index.ts:27-29` POST is COMPANY_ADMIN-only | NOT FIXED — outside `pages/api/content/**`; same treatment as W2G-1 recommended | — | — | — |

## 2. Fixes — before / after

| Fix | Before | After | Tests | Mutation check (source reverted, tests kept) |
|---|---|---|---|---|
| W2G-1 content writes | VIEW_ONLY / VIEWER / CONTENT_ENGAGER member ⇒ create (incl. `lifecycleStatus: 'published'`), edit, archive, set status, advance approval, write variants / blocks / assets / lineage / performance / prediction / quality / recommendations, mark blogs used | 403 `FORBIDDEN_ROLE`, sink never called; COMPANY_ADMIN, CONTENT_CREATOR / REVIEWER / PUBLISHER, SUPER_ADMIN, legacy ADMIN / CONTENT_MANAGER, invited COMPANY_ADMIN, `content_architect` unchanged (allowed); admin of another company 403, anonymous 401 (unchanged); role taken from the authorized company (VIEW_ONLY in A + admin in B ⇒ 403 in A, 201 in B); all GETs still 200 for VIEW_ONLY | `sec91W2GContentWriteRbac` 325 | all 13 routes reverted ⇒ **63 fail**; only `[id]/status.ts` reverted ⇒ 3 fail; `VIEW_ONLY` added to the write set ⇒ 64 fail |
| W2G-2 pending approve | any member ⇒ proposal approved, `campaigns` row created `scheduled` | non-admin 403 `FORBIDDEN_ROLE`, pending stays `pending`, nothing inserted; admin / legacy ADMIN / SUPER_ADMIN row / platform super admin (non-member) 200; foreign admin 403; SPLIT principal: 403 in A, 200 in B | `sec91W2GPendingCampaignApprove` 16 | route reverted ⇒ **9 fail** |
| W2G-3 synchronizer | `"<uuid>,campaign_id.eq.<other>"` reached `.or()` | refused before any query (`null`), logged as `skipped:invalid_activity_id` without the raw key; safe keys produce the identical filter; decision identical to `isSafeActivityKey` | `sec91W2GSynchronizerActivityKey` 21 | synchronizer reverted ⇒ **15 fail**; raw key echoed into the log ⇒ 1 fail |
| W2G-4 invited admin | invited COMPANY_ADMIN of a suspended / inactive / deleted company ⇒ allowed by `enforceCompanyAccess` AND `requireCampaignAccess` | 403 `Access denied to company` on both; company lookup error ⇒ 503 `TENANT_LOOKUP_ERROR` retryable; invited admin of an active company still allowed; invited CONTENT_CREATOR still 403; non-member still 403 (no 503 oracle); platform super admin unaffected (suspended company and lookup error ⇒ still allowed); both guards agree on every state × principal | `sec91W2GInvitedAdminOrgStatus` 33 | both guards reverted ⇒ **7 fail**; only `userContextService.ts` ⇒ 7; only `campaignAccessService.ts` ⇒ 7 (parity rows catch either half) |
| W2G-5 setPrincipal | gate on (`route-policy-gate` shadow): handler saw no principal at all; `setPrincipal` in an awaited guard invisible to the caller | default `ai-guard-principal` shadow: handler sees `authPrincipal {userId, orgId, source:'policyGate'}`, context `userId` / `orgId` unchanged; enforce (or `_TENANTS` promotion): context `userId` filled, never `orgId`; kill ⇒ nothing; route-policy gate off ⇒ nothing (unchanged); unproven `activeOrgId` (invited / not a member) not recorded; synthetic principal never attributed; first user wins; same-frame `setPrincipal` merge semantics unchanged | `sec91W2GPolicyGatePrincipal` 13 | `requestContext.ts` + `policyGate.ts` reverted ⇒ **8 fail**; `policyGate.ts` only ⇒ 4 fail; attribution moved AFTER the merge ⇒ 8 fail |

### 2a. How `enforceRole` treats the special principals (W2G-1)

`enforceContentWriteRole` is `enforceRole({ companyId: <authorized company>, allowedRoles: CONTENT_WRITE_ROLES })` (`rbacService.ts:282-341`), called only after `enforceCompanyAccess` succeeded for the same company:
- **Platform super admins** (`isSuperAdmin` / `isPlatformSuperAdmin`, active SUPER_ADMIN row): bypass (`:314-324`) — unchanged access.
- **`content_architect`**: admitted when the allowed set contains COMPANY_ADMIN (`:309-311`); `CONTENT_WRITE_ROLES` does — unchanged access (tested with the synthetic principal). Note: `resolveUserContext` resolves identities through `getSupabaseUserFromRequest`, which never produces this id, so in practice the principal only exists where an upstream resolver supplies it.
- **Invited COMPANY_ADMIN / ADMIN / SUPER_ADMIN** (admitted by `enforceCompanyAccess` fallback (b)): `getUserRole`'s invited fallback (`:197-213`) returns the admin role — unchanged access. An invited non-admin was never admitted.
- **Legacy roles**: `normalizeRole` maps ADMIN → COMPANY_ADMIN, CONTENT_MANAGER / CONTENT_PLANNER → CONTENT_CREATOR (allowed), VIEWER / CONTENT_ENGAGER → VIEW_ONLY (refused).
- Unknown role or role lookup error ⇒ 403 (fail closed, as in W2-A).
- `CONTENT_WRITE_ROLES` is pinned equal to `PERMISSIONS.CREATE_CAMPAIGN` by a test, so the two cannot drift.

Not implemented (owner decision, W2A §7.4): the finer creator / reviewer / publisher lifecycle matrix. Any CREATE_CAMPAIGN role can still set any lifecycle status (incl. `approved` / `published`) and advance approvals.

## 3. UI-caller review per gated route

Only in-repo callers (components/, hooks/, pages/, lib/) were searched (`grep -rnE "api/content(/|['\"\`?])"`, `campaigns/pending`).

| Route | In-repo UI callers | Read-only-role flow? |
|---|---|---|
| `POST /api/content` | none | no |
| `PATCH /api/content/:id` | `hooks/useCanonicalContent.ts:297` (debounced autosave / save, fires only while the working copy is dirty, i.e. after a user edit) ← `components/content/ShortformResultPage.tsx:193` ← `pages/posts/result.tsx` (result page after generating a post — content work-area) | no: the content area is hidden from VIEW_ONLY (ROLE_ACCESS_MAP / `roleCanAccessArea(…,'blogs')` in nav); nothing is written without an edit |
| `DELETE /api/content/:id` | none | no |
| `POST /api/content/:id/status` | `components/MultiPlatformSchedulerController.tsx:222` (best-effort lifecycle advance after scheduling/publishing, errors swallowed) — Publish Center (`/multi-platform-scheduler`, content nav) | no; note the call sends **no companyId**, so it already answers 400 on base for every role (unchanged) |
| `POST /api/content/:id/variants` | `components/MultiPlatformSchedulerController.tsx:196` (best-effort, same page) | no; also sends no companyId ⇒ already 400 on base |
| `POST /api/content/:id/blocks`, `…/recommendations` | `hooks/useContentCollaboration.ts:271,289` — hook not mounted anywhere | no |
| `POST /api/content/:id/{approval,assets,lineage,performance,prediction,quality}` | none | no |
| `POST /api/content/mark-used` | `components/blog/blogsNewMain.tsx:632`, `pages/{articles,case-studies,guides,newsletters,stories,whitepapers}/new.tsx` "Mark as used" after the item was saved — content-creation pages (content area) | no; an explicit click, and a 403 is shown as a non-fatal error message |
| `POST /api/campaigns/pending/:id/approve` | `components/admin/AutonomousControlPanel.tsx:125` (documented "Allows company admins to …"; not mounted anywhere). Its `reject` URL has no route file | no |

## 4. Commands run and results

(worktree `C:/tmp/sec91-w2g`, hermetic env, `--cacheDirectory …/jc-w2g`, explicit paths only)

- **Reproduced on base first**: each new suite was run with the item's source files still at base: W2G-1 63 / 325 fail, W2G-2 9 / 16, W2G-3 15 / 21, W2G-4 7 / 33 (the parity rows pass on base because both guards were equally wrong), W2G-5 9 / 14 (one test later removed — it asserted that `setPrincipal` outside any scope creates no store, which `mergeRequestContext`'s unchanged semantics contradict).
- **New suites (5, all pass, 408 tests):** `sec91W2GContentWriteRbac` 325, `sec91W2GInvitedAdminOrgStatus` 33, `sec91W2GSynchronizerActivityKey` 21, `sec91W2GPendingCampaignApprove` 16, `sec91W2GPolicyGatePrincipal` 13.
- **Targeted unit regression** — every unit suite that references a changed module (`userContextService`, `enforceCompanyAccess`, `campaignAccessService`, `requireCampaignAccess`, `requestContext`, `policyGate`, `routeFactory`, `setPrincipal`, `services/orchestration`, `orchestration/synchronization`, `synchronizeByActivity`, `pages/api/content`, `campaigns/pending`) plus all `sec91W2A*`, `sec91A*`, `sec91W2G*`, `routeAuth001*`, `campaignResourceAuthzSec001*`, `superadminMembershipValidity001`: **171 suites, 3,941 tests, 3,925 pass, 16 fail in 6 suites**. All 6 fail identically with every W2-G source file swapped back to `a9719cc` (same 16 test names): `generateWeeklyStructureCharacterization`, `extensionDispatchLeaseRenewal` (suite error: missing file under a local OneDrive path), `aiRuntimeFinalValidation`, `phase1aDataSources`, `generateWorkspaceContentCharacterization`, `groupAIdempotencyAdoption` — all on W2-A's list of pre-existing base failures. **No delta.**
- **Integration** (41 suites under `backend/tests/integration` referencing a changed module; `SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`): 8 suites / 36 tests fail on the branch and the **same** 8 / 36 (identical test names) with base sources: `campaign_finalization_guard`, `community_ai_{core_apis,scheduling,webhooks}`, `company_context_contract`, `external_api_service`, `recommendation_engine`, `user_lifecycle_management`. **No delta.**
- **Gates (all exit 0):** `node scripts/check-route-auth.js` PASS · `node scripts/check-tenant-authz.js` PASS · `npm run -s check:ssrf` PASS · `node scripts/check-migration-quality.js` OK (64 new, 0 violations) · `node scripts/check-withrbac-binding.js` PASS (81 SAFE) · `node scripts/check-orgaccess-binding.js` PASS (19 SAFE) · `node scripts/check-secrets.js` PASS · `node scripts/check-constant-time-secrets.js` PASS · `npm run -s check:route-policy` PASS · `node scripts/security/run-gate-tests.js` (hermetic) 14 suites / 314 tests pass. `scripts/route-auth-allowlist.json` needed **no** change (the one touched route with an entry, `content/index.ts`, keeps its evidence string).
- **TypeScript:** `node scripts/typecheck-baseline.js` PASS (3/3 projects clean, baseline 0 / actual 0) · `node node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit --incremental false` exit 0 · `node scripts/typecheck-certification.js` PASS (backend 0/0; backend-tests 260/260 = baseline, 1829/1829 files covered, net-new 0 — the new test files and helper type-check).

## 5. Commits (branch `sec/3ah91-w2g-authz-residual`)

| SHA | Subject |
|---|---|
| 56cb053 | fix(content): canonical content write routes refuse read-only roles (SEC91-W2G-1) |
| 005c61f | fix(campaigns): approving an autonomous pending campaign needs a company admin (SEC91-W2G-2) |
| 491b4a7 | fix(orchestration): synchronizer refuses unsafe activity keys before its .or() filter (SEC91-W2G-3) |
| 0e2ea25 | fix(authz): invited-admin fallback honours company status in both tenant guards (SEC91-W2G-4) |
| 7a76579 | fix(platform): setPrincipal / route-policy gate principal reaches the handler, staged by ai-guard-principal (SEC91-W2G-5) |
| (this document) | docs(security): SEC-91 W2-G workstream report |

**Files changed.** Source: `backend/services/content/contentWriteAuthz.ts` (new), `backend/services/companyOperationalState.ts` (new), `backend/services/userContextService.ts`, `backend/services/campaignAccessService.ts`, `backend/services/requestContext.ts`, `backend/services/orchestration/synchronization/orchestrationStateSynchronizer.ts`, `lib/platform/requestContext.ts`, `lib/platform/policyGate.ts`, `pages/api/campaigns/pending/[id]/approve.ts`, `pages/api/content/index.ts`, `pages/api/content/[id].ts`, `pages/api/content/[id]/{approval,assets,blocks,lineage,performance,prediction,quality,recommendations,status,variants}.ts`, `pages/api/content/mark-used.ts`. Tests: `backend/tests/helpers/sec91W2GHarness.ts` (new; extends the W2-A principals with invited, legacy-alias, split-company and `content_architect` principals; the shared harnesses are untouched) and the 5 new suites. No existing test was modified. None of the W2-E-owned files was touched.

## 6. Proposals (not applied)

### 6.1 W2A-2d — nonce expiry (MANUAL, migration)
Unchanged from W2A §6.3: `ALTER TABLE public.wordpress_plugin_registrations ADD COLUMN IF NOT EXISTS auth_nonce_expires_at timestamptz NULL;` then `registerWordPressPlugin` sets `now() + 30 min` and `verifyWordPressPlugin` / `exchangeWordPressPluginToken` add `.gt('auth_nonce_expires_at', new Date().toISOString())` to their conditional updates. A code-only substitute is not safe: the only candidate timestamp, `updated_at`, is rewritten by verify, heartbeat and token rotation, so it does not record when the nonce was issued. Code must ship after the migration (a missing column would make the conditional update fail and block plugin setup).

### 6.2 W2A §6.5 — campaignId threading in `contentRouteModel.ts` (INTENTIONALLY ACCEPTED)
W2F-1a is closed at the handler: every one of the 13 `persistMasterToDb` / `persistVariantsToDb` calls receives `writeActivityId`, the row id the handler resolved with the writer's own lookup and bound to a campaign owned by the authorized company; the writer then prefers the exact row-id match. The only residual is a race in which the verified row is deleted between check and write AND another campaign's row carries that deleted row's uuid as its `execution_id` — not practically reachable. Threading `campaignId` would change the signature of `updateExecutionContentByActivity`, shared with the BOLT worker (`boltContentJobProcessor.ts:844`), and 13 call sites in a hot write path for no reachable benefit. Revisit only if a new caller passes unverified ids.

### 6.3 N1 — bind `assetId` to the company in `content/approve.ts` / `reject.ts`
Insert the guard `regenerate.ts:24-39` already uses, after the `assetId` presence check in both routes:
```ts
const asset = await getContentAssetById(String(assetId));
if (!asset) return res.status(404).json({ error: 'Content asset not found' });
const { data: campaignRow } = await supabase
  .from('campaign_versions').select('company_id')
  .eq('campaign_id', asset.campaign_id).limit(1).maybeSingle();
if (!campaignRow?.company_id || String(campaignRow.company_id) !== String(companyId)) {
  return res.status(403).json({ error: 'Access denied to asset' });
}
```
(imports: `getContentAssetById` from `backend/db/contentAssetStore`, `supabase` from `backend/db/supabaseClient`). Also consider taking `approver` from the principal instead of the body. Not applied: outside the W2-G registry.

### 6.4 N2 — `/api/company/blogs` writes
Gate POST / DELETE like W2G-1 (`enforceContentWriteRole`) or, to match `pages/api/blogs/index.ts`, COMPANY_ADMIN-only — a product call. The `blogsNewMain` / `*/new.tsx` save flows are content-area pages.

## 7. MANUAL OPERATION REQUIRED

- **W2A §7.4 content lifecycle matrix** — product owner decision (unchanged proposal in `SEC91_W2A.md` §7.4). Enforce it in `POST /api/content` (initial `lifecycleStatus`), `POST /api/content/:id/status` and `POST /api/content/:id/approval` together.
- **W2A-2d nonce expiry** — migration + code (§6.1).
- **W2G-5 rollout** — nothing new: the attribution added here is staged by the existing `ai-guard-principal` flag (default shadow) and only runs when `route-policy-gate` is non-off (default off). The W2A §7.1 operator procedure covers both.
- **Optional pre-deploy check for W2G-4 (read-only, operator):** `select ucr.user_id, ucr.company_id, c.status from user_company_roles ucr left join companies c on c.id = ucr.company_id where ucr.status = 'invited' and upper(ucr.role) in ('COMPANY_ADMIN','ADMIN','SUPER_ADMIN') and (c.id is null or c.status <> 'active');` — invited admins listed here lose access to those companies with this branch.

## 8. Remaining limitations

- W2G-1 adds one `resolveUserContext` + three role reads (`enforceRole`) per write request on these routes; reads are unaffected.
- The `content_architect` fallback of `enforceCompanyAccess` (and requireCampaignAccess's fast path for it) still does not read `companies.status`: it is documented as a platform-level role "like Super Admin", and super admins likewise bypass org state. Left as is.
- `POST /api/campaigns/pending/:id/approve` still answers 404 / 409 (pending id unknown / already reviewed) before the membership check — a status oracle for authenticated callers on random uuids; unchanged.
- The Publish Center's canonical-content calls (`MultiPlatformSchedulerController.tsx:160,196,222`) send no companyId and so are refused with 400 for every role, on base and on this branch; that functional gap is not an authorization issue and is not touched.
- All tests are hermetic (faked DB and identity provider, stubbed content services); nothing was verified against production.

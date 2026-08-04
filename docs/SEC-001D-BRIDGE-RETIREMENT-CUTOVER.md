# SEC-001D — Final Legacy Bridge Retirement & Production Cutover

**Status:** implemented, uncommitted (local only — no push / PR / merge / deploy)
**Date:** 2026-08-04
**Branch:** `feat/sec001-auth-enforcement-phase1`
**Chain:** Phase 2 (signed cookie) → SEC-001A (architect cookie) → SEC-001B (raw-comparison removal) → SEC-001C (lifecycle unification) → **SEC-001D (cutover)**

---

## 1. Final dependency inventory (Task 1)

The bridge is reachable by **three** paths, not one. SEC-001C counted only the first.

| Path | Entry | Routes | Classification |
| --- | --- | --- | --- |
| 1. Direct route gate | `superAdminSession.getLegacySuperAdminSession` | **53** | Bridge + canonical fallback (all 53, after Task 2) |
| 2. Capability gate | `requireCapability` → `IdentityResolver` → bridge principal | **125** | Bridge + canonical fallback **by construction** |
| 3. Content-architect | `isContentArchitectSession` / `resolveCompanyAccess` | **50** | Bridge + canonical fallback |

Path 2 is structurally safe: `IdentityResolver` tries Supabase auth, then the canonical session, and only reaches the bridge at **step 3**. A canonical session present alongside a bridge cookie logs `trust_authority_conflict_detected` and *canonical wins*. So no `requireCapability` route can be bridge-only.

| Class | Count | Notes |
| --- | --- | --- |
| Bridge + canonical fallback | 53 / 53 direct (plus all capability + architect routes) | ✅ |
| **Bridge only** | **0** | was 2 before Task 2 |
| Canonical only | remainder of the API surface | unaffected by retirement |
| Dead | 0 bridge-related | `hasValidLegacySuperAdminCookie` already deleted in SEC-001C |
| Test | 7 suites | see §8 |

## 2. Remaining fallback migrations (Task 2)

Two bridge-only routes migrated, using the canonical arm already adopted by ~50 sibling routes. **No new helper was created.**

| Route | Before | After |
| --- | --- | --- |
| `pages/api/super-admin/activity-control.ts` | `isSuperAdmin()` returned only the bridge verdict | bridge → else `getSupabaseUserFromRequest` + `isPlatformSuperAdmin` |
| `pages/api/operator/canonical-shadow.ts` | inline `if (!getLegacySuperAdminSession(req)) 403` | same two-arm gate, extracted to `isOperator()` |

Not a weakening: `isPlatformSuperAdmin` is a DB-backed role check (`user_company_roles.role='SUPER_ADMIN'`) requiring a real authenticated identity — strictly harder to satisfy than a cookie, and the migration target the bridge exists to be replaced by.

A source ratchet now proves the canonical arm sits **in the same gate** as the bridge call (brace-matched enclosing function), not merely somewhere in the file — an import elsewhere would not actually keep a route reachable.

## 3. Operator readiness (Task 3)

Read-only production query (SELECT only; nothing created, updated or deleted).

| Finding | Value |
| --- | --- |
| DB-backed `SUPER_ADMIN` rows | **1** — user `fa9c4540-310d-4510-bb85-381dd270fcd9`, status `active`, 1 company |
| DB-backed `CONTENT_ARCHITECT` rows | **0** |
| Bridge-attributed audit rows (30d) | **22**, all `bridge_authority_used`, capability `super_admin.legacy` |
| Distinct source IPs | **1** |
| Most recent bridge use | **2026-07-30T05:30:39Z** (5 days before cutover) |
| Role distribution | `COMPANY_ADMIN: 9`, `admin: 22`, `SUPER_ADMIN: 1` |

**Finding 1 — the canonical super-admin arm is provisioned, but by exactly one identity.** One active `SUPER_ADMIN` exists, so the fallback added in §2 is reachable today. It is a single point of failure: if that account is lost after retirement there is no bridge to fall back to.

**Finding 2 — `CONTENT_ARCHITECT` has NO canonical representation at all.** It is a valid `CanonicalRole` and ~10 routes branch on it, but **zero** rows carry it. Every content-architect principal in production is *synthesized from the cookie* (`{ userId: 'content_architect', role: 'CONTENT_ARCHITECT' }`) and never read from the database. When the bridge dies, no user can hold that role.
This does not take routes offline — those routes also accept `SUPER_ADMIN` / `COMPANY_ADMIN` — but the architect capability (cross-company content access) disappears entirely unless rows are provisioned.

**Finding 3 — bridge identities are anonymous, so "which operators use the bridge" is not answerable from data.** The bridge principal is a sentinel (`legacy:cookie-super-admin`) authenticated by a shared env username/password. Audit rows carry IP and capability, never a person. The 22 rows come from 1 IP, consistent with a single operator, but that cannot be confirmed from the data.

**Finding 4 — historical usage is undercounted.** Until SEC-001B/C, the 34 raw-comparison routes emitted **no** audit row. The 22 rows therefore describe only the capability path. This is why the dry-run must be re-run *after* deploying SEC-001C/D — see §9.

⚠ Environment note: `.env.local` (which points at production Supabase) has **no** `SUPER_ADMIN_USERNAME` and **no** `BRIDGE_COOKIE_SECRET`. `BRIDGE_COOKIE_SECRET` falls back to `SESSION_COOKIE_SECRET` (present, 64 chars) so cookies still mint. The real production runtime environment lives in Vercel/Railway, not this file, so this is **not** evidence about production — verify with `vercel env ls` before cutover.

## 4. Dry-run verification (Task 4)

Ran the full authorization surface with `LEGACY_BRIDGE_DRY_RUN=1`: **1341 passed, 4 failed**.

Three failures were the known pre-existing suites. The fourth, `resolveCompanyAccess`, failed *because dry-run correctly killed the content-architect cookie* — positive evidence that the architect consumer is **not invisible** to dry-run. That test now controls the flag explicitly and pins both directions, so a rehearsal run produces a clean signal rather than a spurious failure.

Pinned behaviour:

| Property | Route entry point | Capability entry point |
| --- | --- | --- |
| rejects under dry-run | ✅ | ✅ |
| emits `bridge_authority_rejected` | ✅ | ✅ |
| increments `rejectedDryRun` | ✅ | n/a (counters are route-path) |
| per-route attribution | ✅ (query string stripped) | n/a |
| forged cookie NOT counted as a dependency | ✅ signature evaluated first | ✅ |

That last row matters: dry-run answers "what real usage would removal break". Counting forgeries would inflate it.

## 5. Bridge removal simulation (Task 5)

Simulating `LEGACY_BRIDGE_HARD_EXPIRY_AT`, with cookies deliberately only 1 minute old so age cannot be the cause:

* route entry point grants nothing (`rejectedHardExpired` increments);
* capability entry point grants nothing;
* the shared evaluator returns `{ ok: false, reason: 'hard_expired' }` — one decision, both callers;
* **no cookie value of any shape** revives the bridge past the expiry.

Combined with the §1 inventory (zero bridge-only routes) this gives the cutover proof: *the bridge grants nothing* ∧ *no route depends solely on the bridge* ⇒ removal breaks no route.

**Remaining failures identified: none.**

## 6. Dead-code report (Task 6)

| Item | Verdict | Why |
| --- | --- | --- |
| `hasValidLegacySuperAdminCookie` | **Already removed** (SEC-001C) | zero callers |
| `legacyCookieSuperAdminBridge` | **Remove after expiry** | still the only lifecycle evaluator + principal synthesis; deleting now removes the enforcement everything depends on |
| `bridgeCookie` legacy exports | **Remove after expiry** | `mintSignedBridgeCookieValue` still used by both login routes; `parseSignedBridgeCookie` now has exactly ONE consumer (the evaluator) |
| `superAdminSession` bridge path | **Remove after expiry** | 53 routes call it; removal is a mechanical delete of the first arm of each two-arm gate |
| Legacy bridge metrics (`getBridgeBypassMetrics`) | **Keep until cutover, remove with the bridge** | it is the instrument the cutover decision depends on |
| `bridgeUsageMonitor` | **Keep until cutover** | the operator-facing report for step 2 of the retirement plan |
| Compatibility helpers (`isLegacyBridgeDryRun` export) | **Narrow now, remove after expiry** | exactly one consumer (the evaluator, same module) plus tests |

Nothing can be deleted *today* without breaking the cutover instrumentation itself. Everything becomes deletable the moment the expiry passes with a clean dry-run.

## 7. Security verification (Task 7)

Repository-wide sweep of `backend/ pages/ lib/ components/ scripts/` (production files, comments stripped):

| Must be zero | Result |
| --- | --- |
| Authorizes solely through the bridge | ✅ 0 routes (was 2) |
| Duplicates lifecycle evaluation | ✅ 1 definition, and the lifecycle owner now parses in exactly ONE place |
| Duplicates HMAC verification | ✅ bridge HMAC only in `bridgeCookie.ts` (other `createHmac` uses are unrelated secrets: payments, webhooks, sessions, invitations) |
| Implements bridge expiry independently | ✅ `LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime()` appears once |
| Implements dry-run independently | ✅ `isLegacyBridgeDryRun()` — one definition, one call |
| Contains raw bridge authorization | ✅ 0 for both cookies |

**Defect found and fixed during this sweep:** `resolveLegacyCookieSuperAdminPrincipal` still parsed the cookies itself and re-ran its own dry-run and hard-expiry arms — a second copy of the sequence living *inside the same module* as the SEC-001C evaluator. It now delegates.

That refactor had a trap worth recording: under dry-run the evaluator returns `{ok:false}`, so naively swapping the parse call would have made `hasBridgeCookie` false and returned at the guard **before** emitting the dry-run audit row — silently destroying the very observability the rehearsal depends on. A cookie denied by a *lifecycle* arm is therefore still treated as "presented".

## 8. Regression (Task 8)

199 suites across authorization, tenant isolation, route policy, policy inventory, INT, SEC, capture, admin and bridge: **2245 passed, 8 failed**.

All 5 failing suites are pre-existing and unrelated (`phase2RouteWiring.entryConsumption`, `aiCacheTenantScopingContract`, `boltModeCapability`, `omnivyra_learning_bridge`, `creatorLeadAttribution`) — four were proven so in SEC-001B by stashing every change and reproducing them, and `creatorLeadAttribution` is proven structurally: its test file and both subject services are byte-identical to HEAD and import nothing in the auth graph.

Typecheck baseline `47 / 48` — sole excess is the pre-existing `components/creator/OutcomeGallery.tsx(50,85) TS17001`; no SEC-001D file contributes an error. ESLint exit 0.

Deployment smoke was **not** run: it requires a deployed environment, and this work is uncommitted and undeployed by instruction.

## 9. Production cutover readiness (Task 9)

### Can the bridge be removed today?

**No — but the blocker is now operational, not architectural.** The code is ready; the environment is not.

Prerequisites, in order:

1. **Commit and deploy SEC-001A → SEC-001D.** None of it is deployed. Until it is, production still runs 34 routes on the raw `=== '1'` comparison and 2 routes bridge-only. *This is the largest single item.*
2. **Re-run the dry-run against deployed production** (`LEGACY_BRIDGE_DRY_RUN=1`) for a full operator cycle. The existing 22 audit rows predate full instrumentation (§3 Finding 4), so only a post-deploy observation is trustworthy.
3. **Provision a second DB-backed `SUPER_ADMIN`.** One active account is a single point of failure once the bridge is gone.
4. **Decide the fate of `CONTENT_ARCHITECT`** (§3 Finding 2): provision rows for the humans who need it, or accept that the capability retires with the bridge. This is a product decision, not an engineering one.
5. **Verify production env in Vercel/Railway** — `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `BRIDGE_COOKIE_SECRET` / `SESSION_COOKIE_SECRET`.

⚠ **`LEGACY_BRIDGE_HARD_EXPIRY_AT` is `2026-08-05T00:00:00Z` — about 24 hours away, and none of steps 1–5 are done.** If the date passes with the current *deployed* code, the 2 bridge-only routes go dark and every operator without a DB-backed role loses access. The code in this branch removes that risk, but only once deployed.

## 10. Bridge retirement plan (Task 10)

| # | Step | Verification |
| --- | --- | --- |
| 1 | Enable dry-run | `LEGACY_BRIDGE_DRY_RUN=1` in the deployed env (after step 0: deploy SEC-001A–D) |
| 2 | Verify zero remaining dependency | `reportBridgeUsage()` shows no `bridge_authority_rejected` with reason `LEGACY_BRIDGE_DRY_RUN` over a full operator cycle; `getBridgeBypassMetrics().rejectedDryRun === 0` |
| 3 | Provision missing DB-backed operators | ≥2 active `SUPER_ADMIN` rows; `CONTENT_ARCHITECT` rows per §9.4 |
| 4 | Remove the bridge | let `LEGACY_BRIDGE_HARD_EXPIRY_AT` pass (no code change needed — it is already enforced) |
| 5 | Remove bridge code | delete `legacyCookieSuperAdminBridge.ts`, `superAdminSession.ts`; drop the first arm of each two-arm gate (53 routes); drop the bridge arm from `IdentityResolver` step 3; delete `contentArchitectService` bridge path |
| 6 | Remove bridge metrics | `getBridgeBypassMetrics`, `resetBridgeBypassMetrics`, `bridgeUsageMonitor.ts`, the `via_legacy_bridge` audit column usage |
| 7 | Remove bridge documentation | this file, SEC-001B/C docs, and the `AUTH-*` doc references listed in the SEC-001B record |
| 8 | Final verification | the SEC-001B/C/D ratchets must be **deleted with the bridge**, not left passing vacuously; replace with a single assertion that no bridge symbol exists |

Step 8 is the one most often skipped: a ratchet that survives its subject silently passes forever.

## 11. Remaining risks

1. **Nothing is deployed.** All of SEC-001A–D is uncommitted on a branch alongside other agents' work. Every guarantee here is a property of the branch, not of production.
2. **Single DB-backed super admin** — one active account; no second operator can get in once the bridge is gone.
3. **`CONTENT_ARCHITECT` has no DB representation** — the role retires with the bridge unless provisioned.
4. **Bridge identities are anonymous** — post-mortem attribution of bridge use to a person is impossible; only IP and capability are recorded.
5. **Audit volume** — the canonical helper writes a row per bridge-cookie presentation. It returns early when no cookie is present, so `CRON_SECRET` traffic emits nothing. Fire-and-forget with a swallowed rejection, so audit failure cannot break authorization.
6. **Deployment smoke unrun** — requires a deployed environment.

## 12. Rollback

Local and additive; no migrations, no schema, no flags, no deploy.

* **Whole change:** `git checkout --` the touched files.
* **Per-route:** each two-arm gate is independent; reverting one route does not affect another.
* **Runtime, no code change:** unset `LEGACY_BRIDGE_DRY_RUN` to keep the bridge live. The hard expiry is deliberately **not** env-tunable — bumping it requires a code change and a stated reason, by design.
* **Reverting the §7 resolver refactor** restores the duplicated sequence; behaviour is identical, so this is safe but pointless.

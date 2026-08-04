# SEC-001C — Legacy Bridge Retirement & Authorization Unification

**Status:** implemented, uncommitted (local only — no push / PR / merge / deploy)
**Date:** 2026-08-04
**Branch:** `feat/sec001-auth-enforcement-phase1`
**Follows:** SEC-001 Phase 2 (signed cookie) → SEC-001A (architect cookie) → SEC-001B (raw-comparison removal)

---

## 1. Architecture — module ownership and the canonical entry point

| Module | Layer | Owns | Must NOT own |
| --- | --- | --- | --- |
| `backend/security/bridgeCookie.ts` | L0 — crypto leaf | Cookie FORMAT: mint, HMAC, parse, embedded age, Set-Cookie headers | Any lifecycle policy |
| `backend/security/legacyCookieSuperAdminBridge.ts` | L1 — lifecycle owner | `LEGACY_BRIDGE_HARD_EXPIRY_AT`, `LEGACY_BRIDGE_DRY_RUN`, **`evaluateBridgeCookieLifecycle`**, capability-path principal synthesis | Route-level concerns |
| `backend/services/superAdminSession.ts` | L2 — route entry point | **THE** route-facing bridge gate: verdict + per-route counters + audit | Its own copy of the sequence |
| `backend/security/IdentityResolver.ts` | L2′ — capability entry point | Principal resolution for `requireCapability` | Direct cookie parsing |

**Decision.** There is no single entry point for *both* paths, and forcing one would be wrong: the capability path must return an `AuthenticatedPrincipal`, the route path a lightweight session. Forcing a shared return type would push capability concepts into ~53 routes.

What must be single is the **decision**, not the shape. So SEC-001C establishes:

* one **lifecycle decision procedure** — `evaluateBridgeCookieLifecycle` (L1),
* one **route entry point** — `getLegacySuperAdminSession` (L2),
* one **capability entry point** — `resolveLegacyCookieSuperAdminPrincipal` (L1, used by IdentityResolver).

Both entry points now reach their verdict through the same L1 procedure. Two callers, one decision.

## 2. What was wrong

SEC-001B left **two** bridge entry points with different semantics:

| | `hasValidLegacySuperAdminCookie` (34 routes) | `getLegacySuperAdminSession` (22 routes) |
| --- | --- | --- |
| signature | ✓ | ✓ |
| embedded age | ✓ | ✓ |
| `LEGACY_BRIDGE_HARD_EXPIRY_AT` | ✗ | ✓ |
| `LEGACY_BRIDGE_DRY_RUN` | ✗ | ✓ |
| audit row | ✗ | ✓ |
| bypass counters | ✗ | ✓ |

The lifecycle-aware helper was already the established majority pattern. SEC-001B had moved routes onto the *weaker* of the two.

A **third** partial implementation also existed: `contentArchitectService` (SEC-001A) ran its own parse + dry-run + hard-expiry sequence — in the **opposite order** (dry-run before signature). The outcome agreed in every case, but the attribution did not: a forged cookie presented under `LEGACY_BRIDGE_DRY_RUN=1` was counted as a *dry-run rejection*. Dry-run exists to answer "what real usage would Wave-3 removal break", so counting forgeries in that number corrupts the signal it produces.

## 3. Changes

1. **All 34 call sites** migrated from `hasValidLegacySuperAdminCookie(req)` to `getLegacySuperAdminSession(req) !== null`. 53 bridge-gating routes now share one entry point.
2. **`hasValidLegacySuperAdminCookie` DELETED** — not deprecated. A tombstone docblock explains why it must not return.
3. **`evaluateBridgeCookieLifecycle` added** to the lifecycle owner; `superAdminSession` and `contentArchitectService` both route through it. Canonical order: **signature → dry-run → hard-expiry**.
4. **`bridgeUsageMonitor`** imports `LEGACY_BRIDGE_HARD_EXPIRY_AT` instead of hand-copying `'2026-08-05T00:00:00.000Z'`. The copy could not drift safely — it is the number operators use to judge migration urgency.
5. **`render-ops`** gained the canonical DB-backed arm (Task 5, below).
6. `pages/api/admin/consumption/llm.ts` takes its principal id from the session rather than re-hardcoding the sentinel.

## 4. Dependency report — there was never a cycle to break

SEC-001B reported an import cycle blocking the fix. That was accurate only for the *direction it assumed*: pushing lifecycle DOWN into `bridgeCookie` would indeed have created `bridgeCookie → legacyCookieSuperAdminBridge → bridgeCookie`.

Moving callers **UP** the DAG instead removes the problem without any inversion:

```
bridgeCookie (L0, crypto)          ← imports nothing but crypto + logger
      ↑
legacyCookieSuperAdminBridge (L1)  ← owns constants + evaluateBridgeCookieLifecycle
      ↑                    ↑
superAdminSession (L2)   IdentityResolver (L2′)
      ↑
   53 routes
```

Verified: every other apparent edge (`SecurityAuditService`, `capabilityRegistry`, `authMode`, `bridgeUsageMonitor` before this change) was a **comment reference**, not an import. No dependency inversion, no interface indirection, and no duplication was required. Pinned by the "parseSignedBridgeCookie is consumed ONLY by the lifecycle evaluator" test.

## 5. Render Ops analysis (Task 5)

**Why it would have gone dark.** `pages/api/internal/render-ops.ts` had exactly one authorization source:

```ts
function isSuperAdmin(req) { return <bridge cookie check>; }   // ...and nothing else
```

Every sibling `/api/super-admin/*` route pairs the bridge with a canonical arm (`getSupabaseUserFromRequest` + `isPlatformSuperAdmin`). This route never had one. The bridge is scheduled to die at `LEGACY_BRIDGE_HARD_EXPIRY_AT`, so on that date the route's only door closes and it returns 403 permanently — with no configuration or credential able to reopen it.

**The fix.** Add the same canonical arm the siblings use:

```ts
async function isSuperAdmin(req) {
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  return !error && !!user?.id && (await isPlatformSuperAdmin(user.id));
}
```

**Why this is correct and not a weakening.** `isPlatformSuperAdmin` is a DB-backed role check (`user_company_roles.role='SUPER_ADMIN'`) requiring a real authenticated Supabase identity. It is **strictly harder to satisfy than a cookie**, and it is the migration *target* the bridge exists to be replaced by — this route was simply never migrated. No new principal type, no env-var backdoor, no header trust, no unauthenticated path. The single-source condition was an availability defect, not a security property.

## 6. Dead-code report (Task 6)

| Symbol / module | Verdict | Reason |
| --- | --- | --- |
| `hasValidLegacySuperAdminCookie` | **REMOVED** | Zero callers after migration. Deleting it (vs. deprecating) makes the lifecycle-bypassing path unreachable rather than merely discouraged. |
| `bridgeCookie.ts` | **KEEP — narrow** | Still the only mint/parse implementation. Future surface should shrink to `mintSignedBridgeCookieValue`, `parseSignedBridgeCookie`, `buildBridge*CookieHeader`. |
| `legacyCookieSuperAdminBridge.ts` | **KEEP** | Owns the lifecycle constants, the shared evaluator, and capability-path principal synthesis. Deleting it now removes the enforcement everything else depends on. |
| `superAdminSession.ts` | **KEEP** | The canonical route entry point. |
| `isLegacyBridgeDryRun` (exported) | **Narrow to internal** | Now has exactly one consumer (the evaluator, same module). Keep exported only while tests reference it. |

**Minimum future surface** once the bridge is retired: delete `legacyCookieSuperAdminBridge.ts` and `superAdminSession.ts` outright; reduce `bridgeCookie.ts` to nothing, or keep it only if the signed-cookie format is reused for another purpose.

## 7. Security audit (Task 7)

Swept `backend/`, `pages/`, `lib/`, `components/`, `scripts/` (production files, comments stripped):

| Invariant | Result |
| --- | --- |
| No production path verifies bridge cookies independently | ✅ `parseSignedBridgeCookie` reachable only from `bridgeCookie.ts` (definition) and the L1 evaluator |
| No path ignores hard expiry | ✅ single evaluator; `LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime()` referenced in exactly one module |
| No path ignores dry-run | ✅ `isLegacyBridgeDryRun()` called in exactly one module |
| No duplicated HMAC verification | ✅ `createHmac` over the bridge cookie only in `bridgeCookie.ts` |
| No raw cookie comparison | ✅ zero, for both `super_admin_session` and `content_architect_session` |
| No local lifecycle implementation | ✅ one definition of `evaluateBridgeCookieLifecycle` |
| No duplicated expiry literal | ✅ one definition; no hand-copied date strings |

## 8. Lifecycle verification (Task 4)

`backend/tests/unit/sec001cBridgeUnification.test.ts` proves the claim in two halves, because neither alone is sufficient:

* **(A) Behaviour** — the canonical helper enforces all seven properties: signed accept, forged `1` reject, tampered-signature reject, embedded-age reject, hard-expiry reject, dry-run reject, audit on use *and* on every rejection mode, and per-route counters. The hard-expiry case is isolated: the same cookie at the same age is accepted before the date and rejected after, so age cannot be the cause.
* **(B) Topology** — every production bridge-authorization site routes through exactly that helper, and no alternative entry point exists to reach.

(A) ∧ (B) ⇒ the property holds for all 53 routes.

Test-design note: the suite drives a single `Date.now` spy from a mutable `nowMs`. Nested `jest.spyOn(Date,'now')` calls are unsafe here — an inner `mockRestore()` restores the *original* function and silently cancels the outer mock, letting the real clock leak into assertions.

## 9. Retirement readiness (Task 9)

**One additional migration phase is required — the bridge cannot yet be removed.**

The unification itself is complete, and dry-run now covers 100% of bridge consumers (previously 34 routes were invisible to it). But of the **53** bridge-gating routes, **2 have no canonical fallback** and would become permanently unreachable at the hard expiry:

| Route | Status |
| --- | --- |
| `pages/api/operator/canonical-shadow.ts` | **Pre-existing** — untouched by SEC-001A/B/C; sole gate has always been the bridge |
| `pages/api/super-admin/activity-control.ts` | Sole gate is the bridge (`isSuperAdmin` returns only the bridge verdict) |

Both need the identical two-line change applied to `render-ops` in §5. That is the whole of the remaining work; the other 51 routes already fall through to a canonical arm.

**Recommended sequence:**
1. Apply the canonical arm to those 2 routes.
2. Deploy, then run with `LEGACY_BRIDGE_DRY_RUN=1` and watch `bridge_authority_rejected` + `reportBridgeUsage()`. Because coverage is now complete, a clean dry-run is now *meaningful evidence*, which it was not before SEC-001C.
3. Provision DB-backed `SUPER_ADMIN` rows for every operator still relying on the cookie.
4. Only then let the hard expiry pass, or delete the bridge.

⚠ **The hard expiry is `2026-08-05T00:00:00Z` — approximately 24 hours from this work.** Steps 1–3 have not been done. If the date passes first, those 2 routes go dark and every operator who has not been provisioned a DB-backed role loses access to all 53.

## 10. Rollback

Entirely local and additive; no migrations, no schema, no flags, no deploy.

* **Whole change:** `git checkout --` the touched files (list in the report). Nothing else depends on the new symbol.
* **Runtime, without a code change:** the bridge lifecycle is already controllable — unset `LEGACY_BRIDGE_DRY_RUN` to keep the bridge live. Note the hard expiry is deliberately *not* env-tunable; bumping it requires a code change and a reason in the commit message, by design.
* **Partial:** the render-ops arm is independent of the unification and can be reverted alone.

## 11. Remaining risks

1. **The 2 fallback-less routes** (§9) — the only functional blocker to retirement, urgent given the expiry date.
2. **Audit volume** — the canonical helper writes an audit row per bridge-cookie presentation, where the removed helper wrote none. It returns early when no cookie is present, so cron traffic authenticating by `CRON_SECRET` emits nothing; volume scales with genuine operator activity only. Writes are fire-and-forget with a swallowed rejection, so an audit failure cannot break authorization.
3. **Attribution shift (intended)** — a forged cookie under dry-run is now attributed to `bad_signature`/`legacy_format` rather than `dry_run`. Dry-run counts drop and become trustworthy; do not read that drop as reduced bridge usage.
4. **Not deployed, not committed.** All of SEC-001A/B/C sits uncommitted on the branch alongside other agents' work.

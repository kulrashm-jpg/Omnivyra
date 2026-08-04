# SEC-001B — Final Legacy Super-Admin Cookie Elimination

**Status:** implemented, uncommitted (local only — no push / PR / merge / deploy)
**Date:** 2026-08-04
**Branch:** `feat/sec001-auth-enforcement-phase1`
**Depends on:** SEC-001 Phase 2 (signed bridge cookie), SEC-001A (content-architect cookie hardening)

---

## 1. The defect

Phase 1 of the super-admin bridge issued a static cookie, `super_admin_session=1`.
Phase 2 replaced **issuance** with an HMAC-signed, time-boxed value
(`backend/security/bridgeCookie.ts`) but left **consumption** alone: 31 production
routes still authorized with an inline

```ts
if (req.cookies?.super_admin_session === '1') { /* full super-admin */ }
```

After Phase 2 that comparison is:

* **false** for every legitimately issued cookie (real cookies are `<payload>.<sig>`), and
* **true** only for a value a client set by hand.

So the check authorized *precisely the forged case and no real operator*. Anyone able
to write a cookie on the browser origin (XSS in any dependency; MITM on non-HTTPS in
non-prod) obtained platform super-admin on those routes. Signature, server-enforced
max age, and the bridge audit trail were all bypassed, because the raw comparison
never called the verifier.

## 2. The fix

Every raw comparison was replaced with the canonical, signature-verifying helper.
No verification logic was duplicated and no HMAC is computed outside
`backend/security/bridgeCookie.ts`.

```ts
import { hasValidLegacySuperAdminCookie } from '@/backend/security/bridgeCookie';

if (hasValidLegacySuperAdminCookie(req)) { /* ... */ }
```

**31 routes migrated** (3 more were already migrated under SEC-001A, for 34 call sites):

| Group | Routes |
| --- | --- |
| `pages/api/cron/*` | anomaly-sweep, billing-idempotency-expire, billing-integrity-audit, billing-orphan-usage-scan, billing-reservation-reconcile, credit-expiry, credit-orphan-hold-reap, credit-reconciliation, integration-health-sweep, scheduler-lock-sweep, subscription-credit-expiry, subscription-monthly-allocation, subscription-status-expiry (13) |
| `pages/api/super-admin/*` | activity-control, activity-cost-breakdown-v2, analytics-summary, campaign-health, connection-health, savings-report, llm/models, llm/providers, plans/analytics, plans/get-organization-plan, plans/list (11) |
| `pages/api/admin/*` | consumption/apis, consumption/llm (2) |
| Other | analytics/connect/google/callback, internal/render-ops, organization/enforcement-state, organization/usage-summary, system/overview (5) |
| Already done (SEC-001A) | super-admin/credit-packages/index, super-admin/free-credits/activity, super-admin/free-credits/summary (3) |

Each route's authorization *shape* is unchanged — only the verification changed.
Routes that fell back to `getSupabaseUserFromRequest` + `isPlatformSuperAdmin`
still do; routes that returned a principal still return the same principal.

### Behaviour change (intended)

| Presented cookie | Before | After |
| --- | --- | --- |
| `super_admin_session=1` (forged) | **authorized** | rejected (`legacy_format`) |
| Signed value from `/api/super-admin/login` | rejected | **authorized** |
| Tampered payload or signature | rejected | rejected (`bad_signature`) |
| Signed with another secret | rejected | rejected (`bad_signature`) |
| Older than 24h server-side | rejected | rejected (`too_old`) |
| No signing secret configured | authorized if `=1` | rejected (fail-closed) |

## 3. Collateral defects found and fixed

1. **`legacyCookieSuperAdminBridge.ts`** — the dry-run audit line attributed the
   cookie with `superAdminCookie === '1'`, so after Phase 2 every *legitimate*
   signed super-admin session was logged as `content_architect_session`. Now
   attributed by parse result, matching the `bridgeParse.ok` logic used below it.
2. **Stale security documentation** that described a raw-cookie path the code no
   longer had — `backend/middleware/requireSuperAdmin.ts` (delegates to
   `requireSuperAdminUser`), `backend/services/superAdminGaAccess.ts` (delegates to
   `requireCapability`), `backend/security/capabilityRegistry.ts`, and
   `backend/services/superAdminSession.ts` (described the now-closed migration gap).
   Left uncorrected, these read as evidence that raw-cookie authorization is
   sanctioned.
3. **`scripts/verify-ga-fixes-handlers.ts`** asserted HTTP 200 while presenting a
   forged `=1` cookie — i.e. it pinned the vulnerable path as expected behaviour.
   It now mints a signed value, and its request mock populates the raw `cookie`
   header (resolvers read the header, not the parsed bag).
4. **`backend/tests/unit/renderOpsConsole.test.ts`** asserted the endpoint source
   *contains* `super_admin_session === '1'`. Inverted: it now requires the canonical
   helper and forbids the raw comparison.

## 4. Dead-code decision

Neither bridge module is dead; **both are retained**.

* **`backend/security/bridgeCookie.ts`** — actively the single source of truth for
  bridge-cookie mint/verify. 34 route call sites plus `contentArchitectService`,
  `legacyCookieSuperAdminBridge`, `superAdminSession`, and both login routes.
* **`backend/security/legacyCookieSuperAdminBridge.ts`** — still the only place that
  synthesizes the bridge *principal* for `requireCapability` / `IdentityResolver`,
  and it owns the two lifecycle controls (`LEGACY_BRIDGE_HARD_EXPIRY_AT`,
  `LEGACY_BRIDGE_DRY_RUN`).

Both remain deprecated and are scheduled to be deleted with the bridge itself.
Deleting either now would remove the verification the 34 migrated routes depend on.

## 5. Residual gap — CLOSED by SEC-001C

> **UPDATE (2026-08-04):** everything in this section has been resolved by
> SEC-001C. `hasValidLegacySuperAdminCookie` was **deleted**, all 34 call sites
> now use the lifecycle-aware `getLegacySuperAdminSession`, and the import-cycle
> reasoning below turned out to be avoidable — moving callers *up* the dependency
> graph removes the cycle without any inversion. `render-ops` gained a canonical
> fallback. See `docs/SEC-001C-BRIDGE-RETIREMENT-AND-UNIFICATION.md`.
> The original text is kept below as the record of why the gap was left open.

`hasValidLegacySuperAdminCookie` verifies **signature and age only**. It does not
consult `LEGACY_BRIDGE_HARD_EXPIRY_AT` or `LEGACY_BRIDGE_DRY_RUN`, because those
live in `legacyCookieSuperAdminBridge`, which imports `bridgeCookie` — wiring them
in directly would create an import cycle.

Consequence: the 34 migrated routes keep honouring the bridge past its designed
death date (**2026-08-05T00:00:00Z**, i.e. the day after this work), and a Wave-3
removal rehearsal via `LEGACY_BRIDGE_DRY_RUN=1` will not surface them.

The helper that honours all three controls (plus bypass counters and an audit row)
already exists: `superAdminSession.getLegacySuperAdminSession`. Migrating the 34
call sites onward to it closes the gap, but it **changes availability** for those
routes, so it is a deliberate deploy-gated decision rather than a side effect of a
signature fix. `pages/api/internal/render-ops.ts` needs attention first: it has no
canonical fallback, so it would become permanently unreachable.

## 6. Verification

* `backend/tests/unit/sec001bLegacyCookieElimination.test.ts` — 49 tests: the full
  accept/reject matrix, plus repo-wide **source ratchets** that fail if any
  production file reintroduces a literal cookie comparison, if any route reads the
  raw bridge-cookie name, or if any module other than `bridgeCookie.ts` HMACs it.
* Typecheck baseline gate: `baseline 47 / actual 48`; the sole excess is the
  pre-existing `components/creator/OutcomeGallery.tsx(50,85) TS17001`. No file
  changed by SEC-001B contributes an error.
* ESLint: exit 0 across all changed files.
* Regression: 118 auth/security/route suites — 1480 passed, 4 failed. All 4 failures
  were reproduced with every SEC-001A/SEC-001B change stashed, so they are
  pre-existing and unrelated (`phase2RouteWiring.entryConsumption`,
  `aiCacheTenantScopingContract`, `boltModeCapability`, `omnivyra_learning_bridge`).

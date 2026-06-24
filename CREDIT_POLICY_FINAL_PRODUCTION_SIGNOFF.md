# CREDIT_POLICY_FINAL_PRODUCTION_SIGNOFF.md

Production-readiness signoff audit. Audit only; evidence-based.

## SECTION 1 — Repository state
| # | Question | Answer |
|---|---|---|
| 1 | All credit-policy changes committed? | **NO** |
| 2 | Any modified files? | **YES — 16** |
| 3 | Any untracked files? | **YES — 41** |
| 4 | Clean working tree? | **NO** |
| Branch | | `feat/activation-outreach-governed` (not `main`) |

5. Uncommitted credit-policy files:
- **Modified (M):** `creditAdminGrantService.ts`, `creditAlertService.ts`, `creditExecutionService.ts`,
  `creditPriorityService.ts`, `earnCreditsService.ts`, `emailService.ts`, `initialFreeCreditService.ts`,
  `subscriptionAllocationService.ts`, `components/billing/TopUpPanel.tsx`, `components/billing/BillingCenter.tsx`,
  `components/layout/AppLayout.tsx`, `pages/api/credits/claim-action.ts`,
  `supabase/functions/send-transactional-email/index.ts`, `vercel.json`.
- **Untracked (??):** `subscriptionStateResolver.ts`, `billingSubscriptionService.ts`,
  `subscriptionCreditExpiryService.ts`, `creditConsumptionWarningService.ts`,
  `components/billing/CreditWarningBanner.tsx`, `pages/api/cron/{credit-expiry,subscription-status-expiry,
  subscription-credit-expiry,subscription-monthly-allocation}.ts`, `supabase/migrations/20260624200000_pricing_plan_provider_price.sql`,
  6 unit test files, + all `*REPORT/AUDIT/MAP.md`.

## SECTION 2 — Deployment state
Vercel deploys from committed `main`. All app code is uncommitted on a feature branch ⇒ **not in
prod**. Only DB (pooler) + Edge Function changes reached prod.

| Component | REPO_PRESENT | PROD_PRESENT | DRIFT |
|---|---|---|---|
| Signup 300/30 | YES | **YES (config in prod DB: credits=300, expiry_days=30)**; service code NO | YES (code) |
| Subscription expiry logic | YES | NO (code undeployed) | YES |
| Paid-credit lock | YES | NO | YES |
| Subscription state resolver | YES | NO | YES |
| Subscription lifecycle write path | YES | NO (edge calls it but caller app code undeployed) | YES |
| Plan mapping | YES (code) + DB col YES | DB col YES; resolver code NO | YES |
| Cron handlers | YES | NO (undeployed) | YES |
| Notification runtime | YES | NO (trigger undeployed) | YES |
| Credit alert email type | YES | **YES (Edge Function deployed)** | YES (source uncommitted) |

## SECTION 3 — Edge Function state
- `send-transactional-email` deployed? **DEPLOYED** (this session).
- `activation_outreach` present? **YES** (deployed; prior 200 test).
- `credit_alert` present? **YES** (test send returned `200 {ok:true}`).
- `KNOWN_TYPES` contains both? **YES** (repo working-tree; deployed from it).
- Latest deployed matches repository? **DRIFT** — deployed == working-tree, but working-tree is
  **uncommitted** (HEAD has neither type) ⇒ deployed-but-untracked.

## SECTION 4 — Cron state
| Job | handler exists | in vercel.json | deployed | active |
|---|---|---|---|---|
| credit-expiry | ✅ | ✅ | ❌ | ❌ |
| subscription-status-expiry | ✅ | ✅ | ❌ | ❌ |
| subscription-credit-expiry | ✅ | ✅ | ❌ | ❌ |
| subscription-monthly-allocation | ✅ | ✅ | ❌ | ❌ |

**FAIL** (registered in repo; not deployed → not active; Vercel registers crons only on deploy of committed main).

## SECTION 5 — Notification system
| | Item | Status |
|---|---|---|
| A | Runtime trigger wired (creditExecutionService) | repo YES / prod **FAIL** (undeployed) |
| B | creditAlertService persistence | repo YES / prod **FAIL** |
| C | CreditWarningBanner mounted | repo YES / prod **FAIL** |
| D | credit_alert email template deployed | **PASS** (Edge Function) |
| E | Edge function live | **PASS** (200) |
| F | Trigger active in production | **FAIL** (app code undeployed) |

## SECTION 6 — Subscription data readiness (exact counts)
| Metric | Count |
|---|---|
| billing_subscriptions rows | **0** |
| active subscriptions | 0 |
| expired subscriptions | 0 |
| canceled subscriptions | 0 |
| orgs affected by lock enforcement | **0** |

(Prod DB also confirms: signup config 300/30 present; `pricing_plans.provider_price_id` column present.)

## SECTION 7 — Requirement matrix
| Requirement | Status | Evidence |
|---|---|---|
| 300 signup / 30 days | **COMPLETE** | prod `free_credit_config`=300/30 (config-driven, live); code default also 300/30 (uncommitted) |
| Subscription credits expire | **PARTIAL** | code+tests in repo; undeployed; 0 subs → not provable in prod |
| Paid credits never expire | **COMPLETE** | pre-existing: `paid` excluded from expiry (DB-enforced), true in prod |
| Promo credits → paid | **PARTIAL** | `earnCreditsService`/`claim-action` changed in repo, **undeployed** (prod still grants incentive) |
| Admin credits → paid | **PARTIAL** | `creditAdminGrantService` changed in repo, undeployed |
| Paid locked without entitlement | **PARTIAL** | implemented+tested; undeployed; 0 subs |
| Renewal unlocks paid | **PARTIAL** | derived gate implemented; undeployed |
| 80% warning | **PARTIAL** | logic+persistence in repo; trigger undeployed |
| 90% warning | **PARTIAL** | same |
| 95% warning | **PARTIAL** | same |
| 85% forecast email | **PARTIAL** | email type LIVE (deployed, 200); trigger undeployed → won't fire |
| Monthly allocation | **PARTIAL** | handler+registered; undeployed |
| Subscription expiry sweep | **PARTIAL** | handler+registered; undeployed |
| Credit expiry sweep | **PARTIAL** | handler+registered; undeployed |

## SECTION 8 — Production drift audit
- **Repo-only (uncommitted, not in prod):** all 16 modified + 41 untracked files (services, cron
  handlers, components, vercel.json, migration, tests, reports) — see Section 1.
- **Production-only (applied to prod, source uncommitted):** `free_credit_config` 300/30 update;
  `pricing_plans.provider_price_id` column (migration file uncommitted); `customer_activation_*`
  tables (earlier phases); Edge Function `credit_alert`/`activation_outreach` template.
- **Deployed-but-untracked:** the Edge Function (`send-transactional-email`) — deployed from
  uncommitted source.
- **Missing deployments:** Vercel app deploy of ALL credit-policy app code (services, crons,
  notification trigger, banner) — none are on `main` or in prod.

## SECTION 9 — Freeze readiness
1. **PRODUCTION_READY?** **NO** — the implementation is uncommitted and undeployed; production does
   not run it (only DB config + the Edge Function are live).
2. **FROZEN?** **NO** — uncommitted working-tree state cannot be frozen.
3. **Single highest-priority blocker:** the entire credit-policy implementation is **uncommitted on
   a feature branch and not deployed** (Vercel deploys from `main`).

---

# FINAL OUTPUT

**PRODUCTION_READY = NO**
**FROZEN = NO**

**OPEN_BLOCKERS_COUNT = 5**

OPEN_BLOCKERS:
1. **All credit-policy code uncommitted** (16 modified + 41 untracked) on branch
   `feat/activation-outreach-governed`; not on `main`. → commit + merge to main.
2. **Not deployed to Vercel** — services, crons, notification trigger, banner absent from prod
   (Vercel deploys committed main only). → deploy after merge.
3. **Crons registered but inactive** — vercel.json entries take effect only on deploy. → deploy.
4. **Edge Function deployed from uncommitted source** (deployed-but-untracked drift) + DB changes
   (signup config, provider_price_id, activation tables) applied without committed migrations. →
   reconcile repo with prod.
5. **billing_subscriptions empty (0 rows)** — lock/expiry/allocation gates are behavior-neutral and
   **cannot be verified against real data** until real subscription webhooks populate the table.

Evidence: git status (Section 1), prod DB counts (Section 6), Edge Function 200 test (Section 3),
vercel.json + handler existence (Section 4).

Stop after report.

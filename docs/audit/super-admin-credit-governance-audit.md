# Super Admin Credit Governance Audit

**Date:** 2026-05-15
**Scope:** Manual credit loading, deduction, adjustment authority, audit trail, approval workflows, freeze/unfreeze, fraud correction, promotional credits, contract allocations
**Status:** AUDIT ONLY

---

## 1. Governance Overall Posture

| Area | Status |
|---|---|
| Authentication of super-admin role | **STRONG** — RBAC service + middleware enforced |
| Reason capture on grants | **STRONG** — enum + free-text both required |
| Idempotency on admin actions | **STRONG** — DB-level UNIQUE constraints |
| Audit trail | **STRONG** — multi-table redundancy |
| Rate limiting | **PARTIAL** — 3 grants/24h/org, bypassable |
| Approval chain | **MISSING** — single-actor only |
| Amount caps | **MISSING** — no upper bound on grants/adjusts |
| Org allowlist/scope | **MISSING** — any super-admin can grant to any org |
| Reversibility | **PARTIAL** — free/incentive only; paid clawback manual |
| Promo bucketing | **WEAK** — categories tracked, not promo cohorts |
| Contract allocations | **MISSING** — no enterprise contract primitive |

---

## 2. Admin Grant Flows

### 2.1 Modern flow: `POST /api/admin/credits/grant`

[pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts) → [backend/services/creditAdminGrantService.ts:78-168](../../backend/services/creditAdminGrantService.ts) → `createCredit(category='free')` → `apply_credit_reservation(phase='grant')`

**Required fields:**
- `organizationId` (UUID)
- `reason` (non-empty free-text)
- `reasonType` enum ∈ {`customer_support`, `goodwill`, `promotional`, `beta_feedback`, `compensation`, `correction`, `other`}
- `credits` (positive integer)

**Optional fields:**
- `expiryDays` (default 14, 0 = never expires)
- `allowOverLimit` (escalation bypass for 3/24h rate)
- `clientKey` (idempotency hint)
- `metadata` (JSONB)

**Authentication:** [pages/api/admin/credits/grant.ts](../../pages/api/admin/credits/grant.ts) lines 45-49 require `requireAuthenticatedInternalUser` + `isPlatformSuperAdmin(user.id)` OR `isSuperAdmin(user.id)` (otherwise 403 `SUPER_ADMIN_REQUIRED`)

**Rate limit:** `requireAdminRateLimit(req, res, 'rl:admin:credits_grant', 20, 60)` — 20 req/60s per actor

**Velocity guard:** [creditAdminGrantService.ts:101-117](../../backend/services/creditAdminGrantService.ts) enforces `ADMIN_GRANT_MAX_PER_DAY=3` per org per 24h, bypassable with `allowOverLimit=true`

**Idempotency:** Minute-bucket SHA256 of (actor + org + clientKey || minute_bucket); collapses concurrent retries

**Audit (dual-table):**

1. `super_admin_audit_logs` row with action `ADMIN_CREDITS_EXTEND_FREE`
2. `credit_admin_grants` row (UNIQUE on `idempotency_key`)
3. `credit_transactions` row via `apply_credit_reservation(phase='grant')`

### 2.2 Legacy flow: `POST /api/admin/credits` action=`grant`

[pages/api/admin/credits/index.ts:74-90](../../pages/api/admin/credits/index.ts) — calls `consumptionAnalyticsService.grantCredits` which creates `category='paid'` (simulated purchase).

**Differences from 2.1:**

- No reason-type enum (free-text `note` only)
- No default expiry (paid never expires)
- No velocity guard in service layer
- Action logged as `ADMIN_CREDITS_GRANT` (different action string)
- Category: `paid` (vs `free`)

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| GR-1 | MEDIUM | Two grant paths with different governance posture — inconsistent enforcement |
| GR-2 | HIGH | "Paid" grants from legacy endpoint bypass the 3/24h velocity guard |

**Remediation:** Consolidate to one service; the legacy endpoint should route through `creditAdminGrantService.grantAdminCreditExtension` with category override.

### 2.3 Adjust flow: `POST /api/admin/credits` action=`adjust`

[pages/api/admin/credits/index.ts:92-107](../../pages/api/admin/credits/index.ts)

**Required:** `credits` (signed integer), `note` (free-text)
**Audit:** `super_admin_audit_logs` action `ADMIN_CREDITS_ADJUST`

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| ADJ-1 | MEDIUM | No `adjustment_type` enum (e.g. `correction`/`refund`/`clawback`/`migration`) |
| ADJ-2 | MEDIUM | No upper-bound check on signed delta |
| ADJ-3 | LOW | Negative adjust bypasses HOLD/CONFIRM model (operates directly) |

### 2.4 Rate-set flow: `POST /api/admin/credits` action=`set_rate`

[pages/api/admin/credits/index.ts:109-125](../../pages/api/admin/credits/index.ts) — mutates `organization_credits.credit_rate_usd`

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| RATE-1 | MEDIUM | Rate change is point-in-time mutation; historical `usd_equivalent` reporting becomes inconsistent if rate changes retroactively re-interpret old transactions |
| RATE-2 | LOW | No reason / note field on rate change |

**Remediation:** Convert `credit_rate_usd` to a time-versioned table `organization_credit_rates(org_id, rate_usd, valid_from, valid_to)`; preserve `usd_equivalent` as a snapshot at transaction time.

---

## 3. Revocation Flow

### 3.1 `revokeCredit()` — [backend/services/creditRevoke.ts:72-151](../../backend/services/creditRevoke.ts)

**Scope (design-constrained):**

| Category | Revocable | Mechanism |
|---|---|---|
| Free | ✅ | `apply_credit_reservation(phase='expire')` |
| Incentive | ✅ | `apply_credit_reservation(phase='expire_incentive')` |
| Paid | ❌ | Not supported by RPC — manual ops + direct DB |

**Safety invariants:**
- ✅ Never negative — bounded by current balance
- ✅ Deterministic idempotency key
- ✅ Security event logged via `logSecurityEvent` with capability `billing.audit.view` and reason

**Idempotency:**
- If `originalGrantIdempotencyKey` provided: revoke key = `{grant_key}:revoke:{category}:{amount}`
- Otherwise: 60s time-bucket SHA256

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| REV-1 | HIGH | Paid revocation requires direct DB intervention — no atomic, audit-trailed flow |
| REV-2 | MEDIUM | `creditRevoke` does not write to `super_admin_audit_logs` (only `security_events`) — operations dashboard misses these actions |

---

## 4. Expiry Flow

### 4.1 `runExpiryCheck()` — [backend/services/creditExpiryService.ts:294-363](../../backend/services/creditExpiryService.ts)

Daily cron at `/api/cron/credit-expiry`.

**Pass 1 — Free credit expiry (always runs):**
- Scans `free_credit_profiles.credit_expiry_at < now()`
- Drains via `apply_credit_reservation(phase='expire')`
- One expiry per org per day (idempotency key = hash of org + date)

**Pass 2 — Incentive expiry (config-gated):**
- Only runs if `free_credit_config.category='incentive_expiry'` AND `is_active=true`
- Expires incentive credits older than `expiry_days` from grant date
- Via `apply_credit_reservation(phase='expire_incentive')`

**Category guard:**
- Paid: **NEVER** expired — RPC enforces this at DB layer (raises `EXPIRY_CATEGORY_GUARD`)
- Runtime guard reads `paid_balance` before/after expiry and throws if it changed

**Audit:** `credit_expiry_log` table records each expiry event ([creditExpiryService.ts:189-196](../../backend/services/creditExpiryService.ts))

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| EXP-1 | LOW | Expiry log is comprehensive but not surfaced in super-admin dashboard |
| EXP-2 | LOW | No advance notification to customer (e.g. "your free credits expire in 7 days") |

---

## 5. Organization Controls (Freeze / Block / High-Risk)

### 5.1 `POST /api/admin/org/[id]/control` — [pages/api/admin/org/[id]/control.ts](../../pages/api/admin/org/[id]/control.ts)

**Controls:**

| Field | Type | When required |
|---|---|---|
| `block` | bool | If true, `blocked_reason` required |
| `daily_credit_limit` | int \| null | Daily deduction cap; null = no limit |
| `high_risk` | bool | If true, `high_risk_reason` required |
| `notes` | string | Admin notes |

**Authentication:** Super-admin only

**Idempotency:** `{orgId}:{ISO_minute_bucket}`

**Audit:** `super_admin_audit_logs` action `ADMIN_ORG_CONTROL_UPDATE` with full control state in metadata

### 5.2 Enforcement at deduction time

[backend/services/creditGuardService.ts](../../backend/services/creditGuardService.ts) `preflightCheck(orgId, credits)` is invoked by `executeWithCredits` ([creditExecutionService.ts:602-619](../../backend/services/creditExecutionService.ts)):

- Returns `denied` if blocked
- Returns `denied` if high_risk + above threshold
- Returns `denied` if would exceed `daily_credit_limit`

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| CTRL-1 | LOW | Block reason / high-risk reason are free-text, not enum |
| CTRL-2 | MEDIUM | No "block expiry" — block must be manually lifted; risk of forgotten blocks |
| CTRL-3 | LOW | No customer-facing notification when blocked |

---

## 6. Reconciliation & Drift Detection

### 6.1 `GET /api/super-admin/credit-reconciliation` + cron

[pages/api/super-admin/credit-reconciliation.ts](../../pages/api/super-admin/credit-reconciliation.ts) + [pages/api/cron/credit-reconciliation.ts](../../pages/api/cron/credit-reconciliation.ts)

**Calculation** ([creditReconciliation.ts:103-201](../../backend/services/creditReconciliation.ts)):

For each org × category C:
```
observed_C_balance = organization_credits.{C}_balance
expected_C_balance = SUM(grants_C) - SUM(holds_C) + SUM(releases_C) - SUM(confirms_C) - SUM(expires_C)
expected_C_reserved = SUM(holds_C) - SUM(releases_C) - SUM(confirms_C)
delta_C = observed - expected   -- must be 0
```

**Outputs:** Per-org drift report + aggregate (orgsScanned / orgsInSync / orgsDrifted / drifted[])

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| REC-1 | MEDIUM | Daily cron — 24h drift window is too wide for paid-heavy orgs |
| REC-2 | MEDIUM | Drift alerts only; no auto-correction path |
| REC-3 | LOW | No SLO on "max acceptable drift count" |

**Remediation:** See [credit-financial-risk-audit.md §F](./credit-financial-risk-audit.md#f-ledger-inconsistencies).

---

## 7. Super-Admin Auth & RBAC

### 7.1 Role detection — [backend/services/rbacService.ts:249-267](../../backend/services/rbacService.ts)

```ts
async function isSuperAdmin(userId: string): Promise<boolean> {
  // SELECT id FROM user_company_roles WHERE user_id=? AND role='SUPER_ADMIN' LIMIT 1
}
async function isPlatformSuperAdmin(userId: string): Promise<boolean> {
  // identical to isSuperAdmin
}
```

### 7.2 Middleware — [backend/middleware/requireSuperAdmin.ts](../../backend/middleware/requireSuperAdmin.ts)

Two-tier fallback:

1. Legacy: `req.cookies.super_admin_session === '1'`
2. Modern: `getSupabaseUserFromRequest` + `isPlatformSuperAdmin`

### 7.3 Findings

| ID | Severity | Finding |
|---|---|---|
| RBAC-1 | MEDIUM | Legacy cookie path `super_admin_session=1` is a static-value cookie — should be deprecated / removed |
| RBAC-2 | LOW | `isSuperAdmin` and `isPlatformSuperAdmin` are duplicated functions; unify |
| RBAC-3 | MEDIUM | No MFA enforcement at super-admin operations — single password + session sufficient |
| RBAC-4 | LOW | Session lifetime for super-admin not separately bounded vs regular user |

---

## 8. Audit Trail Tables

### 8.1 `super_admin_audit_logs`

[supabase/migrations/20260420_hardening_auth_email_invites.sql](../../supabase/migrations/20260420_hardening_auth_email_invites.sql) + [20260420_lockdown_idempotency.sql]

```sql
CREATE TABLE super_admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX super_admin_audit_logs_actor_idx
  ON super_admin_audit_logs (actor_user_id, created_at DESC);
CREATE UNIQUE INDEX super_admin_audit_logs_idempotency_key_unique
  ON super_admin_audit_logs (idempotency_key) WHERE idempotency_key IS NOT NULL;
```

**Captured actions:**
- `ADMIN_CREDITS_EXTEND_FREE` — modern free grant
- `ADMIN_CREDITS_GRANT` — legacy paid grant
- `ADMIN_CREDITS_ADJUST` — signed adjust
- `ADMIN_CREDITS_SET_RATE` — USD rate change
- `ADMIN_ORG_CONTROL_UPDATE` — block / risk / daily limit

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| AUD-1 | HIGH | No DB-level immutability — UPDATE/DELETE allowed by service role |
| AUD-2 | MEDIUM | `metadata` JSONB is unstructured — no schema enforcement |
| AUD-3 | LOW | `target_id TEXT` is stringly-typed |
| AUD-4 | MEDIUM | `creditRevoke` writes to `security_events`, not here — split audit surface |

### 8.2 `credit_admin_grants`

[supabase/migrations/20260513_simplify_free_credit_model.sql:43-52](../../supabase/migrations/20260513_simplify_free_credit_model.sql) + [20260514_enhance_one_time_credits.sql]

```sql
CREATE TABLE credit_admin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL,
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  reason text NOT NULL,
  reason_type text NOT NULL DEFAULT 'other'
    CHECK (reason_type IN ('customer_support','goodwill','promotional','beta_feedback','compensation','correction','other')),
  expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Strengths:**
- ✅ Reason taxonomy enforced at DB
- ✅ Idempotency key UNIQUE NOT NULL
- ✅ Indexed by org, granter, time, reason_type

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| CAG-1 | HIGH | No DB-level immutability trigger |
| CAG-2 | LOW | `metadata` JSONB unstructured |

### 8.3 `credit_transactions` (ledger)

Already covered in [credit-system-discovery.md §2.2](./credit-system-discovery.md#22-append-only-ledger--credit_transactions).

### 8.4 `credit_expiry_log`

Per-expiry audit; covered in §4.

---

## 9. Promotional Credits & Bucketing

### 9.1 Current promotional model

| Source | Category | Source-of-truth |
|---|---|---|
| Initial signup credit | `free` | `free_credit_profiles` + `free_credit_claims(category='initial_free_credit')` |
| Domain-unique signup | `free` | UNIQUE index on `free_credit_claims(domain)` ([20260322_domain_credit_hardening.sql](../../supabase/migrations/20260322_domain_credit_hardening.sql)) |
| Admin extension | `free` | `credit_admin_grants(reason_type='promotional')` (or others) |
| Referral/incentive | `incentive` | Distinct category in `organization_credits.incentive_balance` |

### 9.2 Findings

| ID | Severity | Finding |
|---|---|---|
| PROMO-1 | MEDIUM | No promo *code* primitive — promos are operator-issued grants, not redeemable codes |
| PROMO-2 | MEDIUM | No bucketing by promotional cohort — when "Black Friday 2026 50% off" runs, the granted credits are indistinguishable from a customer-support grant |
| PROMO-3 | LOW | No grant attribution / source tracking beyond `reason_type` |

**Remediation:**

```sql
CREATE TABLE promo_campaigns (
  id uuid PRIMARY KEY,
  code text UNIQUE,                 -- nullable for non-code promos
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  credits_per_redemption integer,
  max_redemptions integer,
  current_redemptions integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE promo_redemptions (
  id uuid PRIMARY KEY,
  promo_campaign_id uuid NOT NULL REFERENCES promo_campaigns(id),
  organization_id uuid NOT NULL,
  redeemed_by uuid NOT NULL,
  credits_granted integer NOT NULL,
  credit_admin_grants_id uuid REFERENCES credit_admin_grants(id),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_campaign_id, organization_id)
);
```

Linking `credit_admin_grants.id` to `promo_redemptions.credit_admin_grants_id` preserves the existing ledger model without forking it.

---

## 10. Approval Chain — Currently Missing

### 10.1 Single-actor risk

Every super-admin financial action today is single-actor:
- Single super-admin can grant credits (subject only to 3/24h velocity guard)
- Can adjust by signed delta
- Can change credit rate
- Can block/unblock orgs

### 10.2 Findings

| ID | Severity | Finding |
|---|---|---|
| APPR-1 | HIGH | A compromised super-admin account = unlimited credit minting capability |
| APPR-2 | HIGH | No dual-control for above-threshold actions |
| APPR-3 | MEDIUM | No segregation of duties (same person can grant credits and modify rates) |
| APPR-4 | MEDIUM | No four-eyes principle for refunds |

### 10.3 Remediation

```sql
CREATE TABLE credit_action_approvals (
  id uuid PRIMARY KEY,
  action_type text NOT NULL,             -- 'grant'|'adjust'|'rate_change'|'refund'
  organization_id uuid NOT NULL,
  proposed_by uuid NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approval_threshold_met_at timestamptz, -- set when last required approval signed
  executed_at timestamptz,
  executed_idempotency_key text,         -- maps to ledger row once executed
  payload jsonb NOT NULL,                -- action-type-specific params
  status text NOT NULL,                  -- 'pending'|'approved'|'rejected'|'executed'|'expired'
  required_approvals int NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE credit_action_approval_signatures (
  id uuid PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES credit_action_approvals(id),
  approver_id uuid NOT NULL,
  decision text NOT NULL,                -- 'approve'|'reject'
  comment text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, approver_id)
);

CREATE TABLE credit_action_approval_thresholds (
  action_type text NOT NULL,
  amount_threshold_credits int,          -- null = always require
  required_approvals int NOT NULL,
  PRIMARY KEY (action_type, amount_threshold_credits)
);
```

Flow:
1. Super-admin proposes action → `credit_action_approvals` row inserted as `pending`
2. Other super-admin(s) sign via `credit_action_approval_signatures`
3. When required count reached, action is auto-executed by a cron worker that calls the appropriate service function
4. Approval rows are immutable (trigger)

---

## 11. Freeze / Unfreeze & Fraud Correction

### 11.1 Block/freeze: covered in §5

### 11.2 Reverse transaction (fraud correction)

**Current state:** No atomic "reverse a specific transaction" API. Operator must:
1. Calculate the offset (mirror the original delta with opposite sign)
2. Use `POST /api/admin/credits` action=`adjust` to apply
3. Manually link in `note`

**Findings:**

| ID | Severity | Finding |
|---|---|---|
| FRAUD-1 | HIGH | No "reverse transaction X" primitive — manual offset is error-prone |
| FRAUD-2 | MEDIUM | No `reversed_transaction_id` foreign key on reversal rows |

**Remediation:** Add `apply_credit_reversal(p_org_id, p_original_txn_id, p_actor, p_reason, p_idem_key)` RPC that:
1. Locks original row
2. Inserts a mirror-delta ledger row with `parent_transaction_id = original.id` and `transaction_type='reversal'`
3. Marks original row's `metadata.reversed_at` (this would require relaxing the immutability rule for this field only)

---

## 12. Contract-Based Allocations

### 12.1 Current state: **MISSING**

No enterprise-contract primitive. Contracts are tracked only in the operations team's external CRM (out of scope).

### 12.2 Findings

| ID | Severity | Finding |
|---|---|---|
| CON-1 | HIGH | No DB record of contract → credit grants are not linked to legal contract |
| CON-2 | HIGH | Annual prepaid contracts cannot be modeled (no "credit will be delivered monthly over 12 months" workflow) |
| CON-3 | MEDIUM | No multi-currency contract support |

Covered also in [payment-readiness-audit.md §9](./payment-readiness-audit.md#9-enterprise-contracts).

---

## 13. Governance Strengths Summary

| Strength | Evidence |
|---|---|
| Atomic mutation only via RPC | `apply_credit_reservation` is the single legal path; service code goes through it |
| Idempotency at DB layer | `idempotency_key UNIQUE` on `credit_transactions`, `credit_admin_grants` |
| Category guards | Paid credits cannot be expired (DB raises `EXPIRY_CATEGORY_GUARD`) |
| Reconciliation drift detection | Per-org reconciliation report (daily + manual) |
| Reason capture | Mandatory `reason` + `reasonType` enum on grants |
| Velocity guards | 3 grants per org per 24h, bypass requires explicit `allowOverLimit` flag |
| Reserved-balance tracking | `reserved_*` columns isolate in-flight from settled balance |

---

## 14. Top Governance Gaps to Close

1. **GOV-1 (HIGH):** Add approval chain ([§10](#10-approval-chain--currently-missing))
2. **GOV-2 (HIGH):** Add hard amount cap + escalation requirement
3. **GOV-3 (HIGH):** Make audit tables immutable at DB layer
4. **GOV-4 (HIGH):** Add atomic paid-credit refund/reversal RPC
5. **GOV-5 (MEDIUM):** Add MFA enforcement for super-admin operations
6. **GOV-6 (MEDIUM):** Add promo cohort model
7. **GOV-7 (MEDIUM):** Consolidate the legacy + modern grant flows
8. **GOV-8 (MEDIUM):** Time-version `credit_rate_usd` per-org
9. **GOV-9 (MEDIUM):** Add enterprise contract primitive
10. **GOV-10 (LOW):** Surface `credit_expiry_log` + `monetization_operational_events` in super-admin UI

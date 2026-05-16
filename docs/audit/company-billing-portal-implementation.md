# Company Billing Portal + Super Admin Financial Oversight — Implementation Report

**Date:** 2026-05-16
**Scope:** Two financial-visibility layers over the existing immutable billing infrastructure
**Status:** Implementation complete; billing engine unchanged.

---

## 1. Files created

### APIs — Super Admin Oversight
| Path | Purpose |
|---|---|
| [pages/api/super-admin/financial-overview.ts](../../pages/api/super-admin/financial-overview.ts) | Global aggregate + per-company financial summary table with filters |
| [pages/api/super-admin/global-ledger.ts](../../pages/api/super-admin/global-ledger.ts) | Cross-company ledger, filterable, paginated, correlation-traceable |

### APIs — Company Billing Portal (org-isolated)
| Path | Purpose |
|---|---|
| [pages/api/company/billing/summary.ts](../../pages/api/company/billing/summary.ts) | Composite wallet + forecast + invoice + contract + subscription + flags + top-modules + recent events |
| [pages/api/company/billing/ledger.ts](../../pages/api/company/billing/ledger.ts) | Org-pinned ledger with phase/date filters |
| [pages/api/company/billing/export.ts](../../pages/api/company/billing/export.ts) | Manifest-wrapped usage / reservation-lifecycle export (company allowlist) |

### UI
| Path | Purpose |
|---|---|
| [pages/company/billing/index.tsx](../../pages/company/billing/index.tsx) | Company Billing Portal page (wallet, forecast, plan/contract, top modules, ledger, recent events, CSV export) |
| [components/super-admin/tabs/CreditsBillingTab.tsx](../../components/super-admin/tabs/CreditsBillingTab.tsx) | Added `GlobalFinancialOverviewPanel` (aggregate cards + filterable company table + "Open" drill-in) |

### Tests
| Path | Cases |
|---|---|
| [backend/tests/unit/companyBillingPortal.test.ts](../../backend/tests/unit/companyBillingPortal.test.ts) | 8 — isolation, cross-org denial, query-pinning, export allowlist |
| [backend/tests/unit/superAdminFinancialOverview.test.ts](../../backend/tests/unit/superAdminFinancialOverview.test.ts) | 4 — RBAC, aggregation, filter narrowing, immutable tagging |

**Total new tests: 12. All passing.**

---

## 2. Views / screens added

### Super Admin (Credits & Billing tab)
- **Global Financial Overview**: aggregate cards (companies, total available cr + USD, reserved, frozen/locked/anomaly counts) + filterable company table (All / Frozen / Locked / Low balance / Anomaly / High burn) with per-row Open → drills into the existing wallet/ledger/approval console.
- Pre-existing per-company panels (Wallet, Credit Actions, Approval Queue, Ledger Explorer, Financial Timeline, Risk, Idempotency Recovery, Billing Flags) remain.

### Company Billing Portal (`/company/billing`)
1. Wallet (available / free / paid / promotional / reserved / lifetime / last activity)
2. Forecast (daily burn, days remaining, projected month-end credits, projected invoice)
3. Plan & Contract (contract number, terms, allotment, end date, subscription status + renewal)
4. Top Consuming Modules (period, grouped by reference_type)
5. Ledger (50 rows, phase pills, before/after balance, immutable badge) + Export usage CSV
6. Recent Billing Events timeline

---

## 3. APIs added (summary)

| Endpoint | Method | Auth | Scope |
|---|---|---|---|
| `/api/super-admin/financial-overview` | GET | FINANCE_AUDITOR+ | Global (cross-org by design) |
| `/api/super-admin/global-ledger` | GET | FINANCE_AUDITOR+ | Global |
| `/api/company/billing/summary` | GET | `assertOrgAccess` (org-scoped) | Single org |
| `/api/company/billing/ledger` | GET | `assertOrgAccess` | Single org |
| `/api/company/billing/export` | POST | `assertOrgAccess` + rate-limit + idempotency | Single org |

All read-only except export (which only reads + writes an immutable manifest, never mutates financial state).

---

## 4. RBAC enforcement

| Role | Capability | Mechanism |
|---|---|---|
| SUPER_ADMIN / platform | Global visibility, all actions | `isFinanceAuditor` returns true for super-admins; `assertOrgAccess` bypasses for platform-super-admin |
| FINANCE_ADMIN | Org financial management (grant/revoke/freeze — existing endpoints) | `isFinanceAdmin` |
| FINANCE_AUDITOR | Read-only global + per-company oversight | `isFinanceAuditor` gate on overview/global-ledger |
| COMPANY_ADMIN | Own-org billing visibility + export | `assertOrgAccess(req,res,companyId)` — verifies membership, writes 401/403/404 + audit on mismatch |
| STANDARD USERS | No billing access | Portal page gates on role; server `assertOrgAccess` also rejects non-members |

---

## 5. Company isolation guarantees

The single most important property. Enforced by **defense in depth**:

1. **Server guard**: every `/api/company/billing/*` endpoint calls `assertOrgAccess(req, res, companyId)` *before any data fetch*. On rejection it writes the standard 401/403/404 + audit row and returns null; the handler returns immediately. Tested: "does NOT proceed when assertOrgAccess denies", "cross-org request blocked".
2. **Query pinning**: every Supabase query in the company endpoints is hard-pinned `.eq('organization_id', companyId)` where `companyId` is the *access-validated* value — the client cannot widen scope. Tested: "query is hard-pinned to organization_id = validated companyId" asserts every `organization_id` filter equals the validated org.
3. **Export pinning**: the export service receives `organizationId: companyId` (validated). Tested: "organizationId passed to the export service must be the validated org".
4. **UI**: the portal only ever sends the CompanyContext-selected org; standard users get a "Billing access required" wall (server still independently enforces).

There is **no code path** by which a company user reads another org's billing data.

---

## 6. Financial visibility capabilities

| Capability | Source service (unchanged) |
|---|---|
| Wallet snapshot | `getBillingWalletSnapshot` |
| Portfolio aggregate | `getPortfolioWalletAggregate` |
| Burn forecast / anomaly | `forecastUsage` / `detectBurnRateAnomaly` |
| Invoice projection | `projectInvoice` |
| Contract context | `resolveActiveContract` |
| Subscription projection | `projectOrgSubscriptions` |
| Feature flags | `evaluateAllBillingFlags` |
| Financial controls | `checkFinancialControls` |
| Ledger | `credit_transactions` (immutable; rows tagged `immutable: true`) |

No new financial computation was introduced — the visibility layers only compose existing immutable services.

---

## 7. Analytics added

Company portal: daily burn rate, days-remaining-in-period, projected month-end credits, projected invoice USD, top-10 consuming modules (period rollup by reference_type), recent-events timeline.

Super-admin overview: portfolio totals, frozen/locked/anomaly counts, top-by-consumption, per-company available/reserved/purchased/consumed/USD with burn-anomaly + contract surfacing.

---

## 8. Export integrations

Company export reuses the Phase 3 immutable manifest pipeline ([auditManifestService](../../backend/services/billing/exports/auditManifestService.ts)):
- SHA-256 content checksum
- Audit-logged (manifest row is immutable at DB layer)
- Correlation-traceable
- Company allowlist: `company_usage`, `reservation_lifecycle` only (ledger/anomaly/approval exports remain super-admin-only via the existing `/api/super-admin/billing-exports/generate`)
- `withIdempotency` + rate-limited

---

## 9. Test results

```
PASS backend/tests/unit/companyBillingPortal.test.ts          8 passed
   ✓ summary 400 on missing companyId
   ✓ summary does NOT proceed when assertOrgAccess denies
   ✓ summary pins queries to validated companyId
   ✓ ledger cross-org blocked (no rows leaked)
   ✓ ledger hard-pinned to organization_id
   ✓ export rejects non-allowlisted export type
   ✓ export cross-org blocked before export runs
   ✓ export company_usage succeeds + manifest for own org

PASS backend/tests/unit/superAdminFinancialOverview.test.ts   4 passed
   ✓ overview 403 without FINANCE_AUDITOR
   ✓ overview aggregate + rows + frozen filter narrows
   ✓ global-ledger 403 without FINANCE_AUDITOR
   ✓ global-ledger rows tagged immutable, cross-company

Tests: 12 passed
```

Existing Phase 1→idempotency suites remain green; no service contracts changed.

---

## 10. Remaining operational TODOs

| Item | Notes |
|---|---|
| Nav entry for `/company/billing` | The page exists; wiring it into the company app sidebar is a front-end nav change (out of scope here). |
| Invoice PDF download | Portal shows projected invoice USD; PDF generation is Sprint 6 (depends on the deferred tax engine). |
| Subscription self-service | Portal displays subscription status read-only; plan changes are Sprint 5. |
| Server-side pagination UI in portal ledger | API supports `limit/offset`; portal currently shows the first 50. "Load more" control is a follow-up. |
| Super-admin overview N+1 | `financial-overview` does per-org enrichment in a loop (≤500 orgs). Acceptable at current scale; batch via SQL CTE when org count grows (same note as scale-validation §7). |
| Anomaly deep-dive from overview | Overview surfaces the anomaly flag; clicking through to the per-org Risk panel is via the existing "Open" drill-in. |

---

## 11. Invariants preserved

| Mandate | Status |
|---|---|
| Immutable financial history only | ✅ — all reads; export writes only an immutable manifest |
| No direct DB mutations | ✅ — visibility layer is read-only |
| No cross-org leakage | ✅ — `assertOrgAccess` + query pinning, tested |
| Strongly typed | ✅ |
| Audit-safe exports | ✅ — manifest + checksum + audit row |
| No TODO placeholders | ✅ |
| Rollback-safe only | ✅ — no state changes |
| Preserve billing architecture | ✅ — zero changes to ledger/orchestrator/RPCs |
```

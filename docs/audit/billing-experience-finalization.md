# Billing Experience Finalization — Implementation Report

**Date:** 2026-05-16
**Scope:** Navigation integration + discoverability UX over the existing billing system
**Status:** Complete. No billing-architecture changes.

---

## 1. Navigation integrations (Phase A)

| Change | File |
|---|---|
| "Billing" link added to the global user menu, above Settings | [components/layout/GlobalHeader.tsx](../../components/layout/GlobalHeader.tsx) → `/company/billing` |
| RBAC gating: new `billingVisible` flag (COMPANY_ADMIN, SUPER_ADMIN, ADMIN, FINANCE_ADMIN, FINANCE_AUDITOR) | GlobalHeader — `billingVisible` computed alongside `isCompanyAdmin`, threaded into `UserMenu` |
| Standard users: link hidden | `billingVisible` false → not rendered |

Defense in depth: the nav flag is presentation-only. `/company/billing` (page) and its APIs independently enforce org-isolation via `assertOrgAccess`, so a hand-typed URL by a non-member is still rejected server-side.

---

## 2. Widgets added (Phases B + C)

[components/billing/BillingSummaryWidget.tsx](../../components/billing/BillingSummaryWidget.tsx) — drop-in `<BillingSummaryWidget companyId={...} />`:

- **Displays:** available credits, est. USD value, daily burn, plan/contract, "View Billing" deep-link.
- **Proactive warnings:** low balance (`< lowBalanceThreshold`, default 100), near-depletion (`<= depletionWarningDays`, default 7), accelerating burn, billing freeze/lock.
- **Actions:** View Billing, Export Usage, Upgrade Plan, Contact Support.
- **Safety:** reads only the org-isolated `/api/company/billing/summary`; if the server denies (401/403) the widget renders nothing — it is additive visibility, never a gate. No client-side billing authority.

Supporting backend change: [pages/api/company/billing/summary.ts](../../pages/api/company/billing/summary.ts) now also returns `financialControls { emergencyFreeze, billingLock, reason }` (via the existing `checkFinancialControls` service) so the widget's freeze warning uses a real signal, not a fabricated one.

---

## 3. Warning systems added (Phase C)

| Warning | Source (no fake data) | Surfaced in |
|---|---|---|
| Low balance | `summary.wallet.totalAvailable` | Widget + portal |
| Projected depletion | `summary.forecast.daysRemaining` (usageForecastingService) | Widget + portal |
| Accelerating burn | `summary.forecast.isAccelerating` | Widget + portal |
| Frozen / locked | `summary.financialControls` (orgFinancialControlService) | Widget |
| Pending approvals / anomalies / frozen orgs (super-admin) | `/api/super-admin/billing-alert-counts` | Super-admin tab badge |

---

## 4. Subscription / usage visibility (Phases D, E, F — coverage note)

These were largely delivered by the **company billing portal** shipped in the prior phase ([pages/company/billing/index.tsx](../../pages/company/billing/index.tsx)) and are now *discoverable* via the new nav entry:

- **Subscription experience (E):** portal "Plan & Contract" card — contract number, payment terms, allotment, end date, subscription status + days-to-renewal (from `projectOrgSubscriptions` / `resolveActiveContract`).
- **Usage contextualization (D):** portal "Top Consuming Modules" — period rollup grouped by `reference_type`, computed from immutable `credit_transactions` CONFIRM rows (no estimates fabricated).
- **Activity feed (F):** portal "Recent Billing Events" — last ~12 ledger events with phase pills.
- **Export UX (G):** portal "Export usage CSV" → manifest-wrapped (`auditManifestService`, SHA-256 + audit row).

This phase made them reachable without direct URLs; it did not rebuild them (per the "do not redesign" rule).

---

## 5. Super-admin UX additions (Phase H)

| Addition | File |
|---|---|
| Alert-count endpoint (lowBalanceOrgs + pendingApprovals + anomalyCount + frozenOrgs + total) | [pages/api/super-admin/billing-alert-counts.ts](../../pages/api/super-admin/billing-alert-counts.ts) |
| Numeric alert badge on the "Credits & Billing" tab (red pill, "99+" cap, inverts color when active), auto-refresh every 5 min | [pages/super-admin.tsx](../../pages/super-admin.tsx) |
| Global Financial Overview panel (prior phase) reachable as the tab's first panel | CreditsBillingTab |

The badge is read-only, FINANCE_AUDITOR-gated, and uses cheap count-head queries.

---

## 6. RBAC enforcement

| Surface | Gate |
|---|---|
| Company nav "Billing" link | `billingVisible` (admin + finance roles) — presentation only |
| `/company/billing/*` APIs | `assertOrgAccess` — org-isolated, audit-logged, 401/403/404 |
| BillingSummaryWidget data | inherits the org-isolated summary endpoint; renders nothing on denial |
| `/api/super-admin/billing-alert-counts` | `isFinanceAuditor` (403 otherwise) |
| Super-admin tab badge | only fetched within the super-admin panel (already SUPER_ADMIN-routed) |

No new bypass routes. Org isolation and immutable-history invariants preserved (everything here is read-only except the pre-existing manifest-wrapped export).

---

## 7. Test results (Phase I)

```
PASS backend/tests/unit/billingAlertCounts.test.ts
  ✓ 403 when not FINANCE_AUDITOR
  ✓ 405 on non-GET
  ✓ sums all alert sources; low-balance uses available (balance − reserved)
  ✓ respects a custom lowBalanceThreshold
Tests: 4 passed
```

Plus the prior phase's still-green isolation suite (`companyBillingPortal.test.ts` 8, `superAdminFinancialOverview.test.ts` 4) which covers the data the widget/nav surface — the critical cross-org-denial property is regression-guarded there. UI components (nav gating, widget warning logic) are pure functions of role/payload and are exercised through the endpoint contracts they depend on; no DOM test runner was introduced (consistent with the repo's existing backend-Jest convention).

---

## 8. Remaining optional UX enhancements

| Item | Note |
|---|---|
| Embed `BillingSummaryWidget` in the company dashboard header | Component is ready; placement is a 1-line `<BillingSummaryWidget companyId={selectedCompanyId} />` drop-in wherever product wants it (left out to avoid changing the dashboard layout unprompted). |
| Per-action inline credit estimate (Phase D "estimated credit impact" at click time) | The portal shows period module costs; a pre-action tooltip would call `pricingResolver`/`tokenCreditConverter`. Deferred — it touches many action surfaces and risks scope creep against "do not redesign". |
| Export history list + manifest re-verify button in portal | `billing_export_manifests` + `verifyExportContent` exist (Phase 3); a portal "Export history" tab is a follow-up. |
| Command-palette entry for "Billing" | Nav covers discoverability; palette entry is optional polish. |
| DOM/RTL component tests | Repo currently has no React Testing Library setup; adding one is an infra decision out of this phase's scope. |

---

## 9. Invariants preserved

| Mandate | Status |
|---|---|
| Preserve RBAC | ✅ — nav gated; APIs independently enforce |
| Preserve org isolation | ✅ — `assertOrgAccess` unchanged; widget fails closed |
| No client-side billing authority | ✅ — widget is read-only display of server values |
| Immutable financial history only | ✅ — no mutations added |
| Strongly typed | ✅ |
| No TODO placeholders | ✅ |
| No hidden bypass routes | ✅ |
| No fake financial projections | ✅ — every number traces to an existing immutable service; the dead placeholder `frozen` computation was replaced with the real `financialControls` signal |
```

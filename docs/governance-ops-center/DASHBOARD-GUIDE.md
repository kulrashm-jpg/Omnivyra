# Dashboard Guide

`dashboard.html` is a self-contained, theme-aware, read-only page. A KPI tile row sits above ten tabbed views.

## KPI tiles

Verification status, drift status, runtime version, constitution version, release digest, manifest digest, runtime count, alert count. Status tiles use a reserved status palette with an **icon + label** (never color alone): ✓ good, ⚠ warning/serious, ✕ critical.

## Views

| Tab | Shows |
|---|---|
| Runtime Status | versions, release/baseline IDs, release + manifest digests, verification + drift status |
| Verification | latest / baseline / dependency / release / integrity verification with digests |
| Drift | drift status, count, per-severity items (or "no drift") |
| Inventory | runtime module catalog (id/module/responsibility/digest) + dependency integrity |
| Registries | registry catalog (registry/runtime/module) — filter/search/pagination/export |
| Ledgers | materialized immutable ledgers, per-ledger record explorer |
| Provenance | execution / supervision / closure / verification lineage |
| Delivery | delivery-assurance records (release id/digest/version/result/authorization/timestamp) |
| Metrics | inventory size, dependency graph size, registry/ledger counts, ledger growth |
| Alerts | failed verification / drift / release mismatch — read-only |

## Navigation & theme

Click a tab to switch views. The **◐ theme** button toggles light/dark (the page also follows the OS `prefers-color-scheme`). All tables scroll horizontally within their panel; the page never scrolls sideways.

## Read-only

There are no action buttons that mutate state — only filter, search, paginate, and **export JSON** (client-side download of the current view). The dashboard cannot run the runtime, edit a ledger, or change a registry.

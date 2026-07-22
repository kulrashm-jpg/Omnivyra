# Governance Operations Center — Release R3C

Read-only operational observability for the frozen **Governance Runtime v1.0.0** (`GOV-EXEC-RELEASE-v1.0.0-4903e8fb`). Administrators and operators inspect, monitor, and diagnose the runtime **without modifying it**. The Operations Center consumes **published outputs only** (release manifests, verification reports, delivery-assurance records, and materialized immutable `*.jsonl` ledgers) and **executes no governance runtime**.

## What it is

- `scripts/governance-baseline/ops-center.mjs` — a read-only aggregator that builds one operations-center data model and renders a **self-contained, theme-aware HTML dashboard**.
- Outputs (gitignored, regenerated): `docs/governance-ops-center/dashboard.html` (open in a browser) + `ops-center.json` (the model).
- Run: `npm run governance:ops-center` (or `node scripts/governance-baseline/ops-center.mjs`).

## Guides

| Guide | Covers |
|---|---|
| [OPERATIONS-CENTER-GUIDE.md](OPERATIONS-CENTER-GUIDE.md) | purpose, data sources, read-only guarantees, security |
| [DASHBOARD-GUIDE.md](DASHBOARD-GUIDE.md) | the ten views, KPI tiles, navigation, theme |
| [REGISTRY-EXPLORER-GUIDE.md](REGISTRY-EXPLORER-GUIDE.md) | registry catalog, filter/search/pagination/export |
| [LEDGER-EXPLORER-GUIDE.md](LEDGER-EXPLORER-GUIDE.md) | immutable ledgers, chronological navigation |
| [PROVENANCE-GUIDE.md](PROVENANCE-GUIDE.md) | execution/supervision/closure/verification lineage |
| [VERIFICATION-GUIDE.md](VERIFICATION-GUIDE.md) | verification center + drift center reading |
| [OPERATIONAL-METRICS-GUIDE.md](OPERATIONAL-METRICS-GUIDE.md) | metrics + alerts interpretation |

## Guarantees

Fully **read-only**: no runtime execution from the UI, no ledger editing, no registry editing, no runtime/constitutional modification. The dashboard is a static self-contained page (no external resources); refreshing the snapshot re-reads published outputs only.

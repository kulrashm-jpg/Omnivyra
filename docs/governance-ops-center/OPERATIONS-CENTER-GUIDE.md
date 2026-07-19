# Operations Center Guide

The Governance Operations Center gives operators production visibility into the frozen Governance Runtime v1.0.0 while guaranteeing immutability.

## Purpose

Inspect runtime health, verification status, inventory, dependency integrity, registries, ledgers, provenance, delivery assurance, metrics, and alerts — all derived from **published outputs**, never by running the governance runtime.

## Data sources (published outputs only)

| Source | Provides |
|---|---|
| `docs/governance-runtime-v1.0.0/VERSION.json` | versions, release/baseline IDs, release digest |
| `docs/governance-runtime-v1.0.0/MANIFEST.json` | per-runtime catalog, registries, ledgers, digests |
| `docs/governance-runtime-v1.0.0/DEPENDENCY-GRAPH.json` | nodes/edges/cycles, order |
| `scripts/governance-baseline/baseline.lock.json` | inventory counts, runtime/constitution digests, behavioral |
| `scripts/governance-baseline/reports/*.json` | verification, integrity, drift, inventory, protection, delivery-assurance |
| `.governance-*/*.jsonl` (if materialized) | immutable ledgers/registries/provenance |

## Read-only guarantees

- No governance runtime is executed by the dashboard or aggregator.
- No ledger or registry is edited; ledgers are read-only `*.jsonl`.
- No runtime or constitutional artifact is modified — verified: the runtime stays byte-for-byte unchanged (WP-02 `005975e3`; `governance:verify-baseline` → VERIFIED).

## Security

- **Read-only access** — the dashboard displays data; it has no write path.
- **Role-based visibility** — deploy behind the existing admin console auth; the model is data-only and safe to scope by role (e.g., operator vs. governance maintainer).
- **Immutable evidence** — all inputs are append-only ledgers or content-hashed manifests.
- **No coupling** — the ops-center never imports or influences the application runtime.

## Usage

`npm run governance:ops-center` regenerates `dashboard.html` + `ops-center.json` from current published outputs; open the HTML in any browser (no server, no external resources).

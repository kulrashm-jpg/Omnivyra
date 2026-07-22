# Operational Metrics Guide

The Metrics and Alerts views present quantitative operational state — metrics only, read-only acknowledgement for alerts.

## Metrics

| Metric | Source |
|---|---|
| runtime inventory size | 25 runtime modules |
| shared libraries | 2 |
| dependency graph size | nodes/edges (25/15) |
| registry catalog count | registries declared in the manifest |
| materialized ledgers | count of present `.governance-*` ledgers |
| total ledger records | sum of records across materialized ledgers (ledger growth) |
| constitution documents | 91 |
| release artifacts | current release-doc count |

Verification duration and frequency are read from CI run history (GitHub Actions) when the ops-center is fed CI artifacts; in the local snapshot they are derived from report presence.

## Alerts

Surfaced conditions: **failed-verification** (critical), **drift-detected** (serious), **release-mismatch** (critical), and digest/integrity failures. Each carries a severity (icon + label) and a read-only acknowledgement flag. There are **no remediation controls** — alerts route operators to the incident-response procedure (R3B Governance Operations Guide).

## Guarantees

Metrics and alerts are derived entirely from published outputs. Acknowledgement is display-state only and never modifies the runtime, ledgers, or constitution.

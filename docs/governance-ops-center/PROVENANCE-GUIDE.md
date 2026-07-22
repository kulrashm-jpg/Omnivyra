# Provenance Guide

Visualizes the immutable provenance chains recorded across the execution lifecycle. Each stage records the prior stage's identity + verification digest, forming an unbroken chain.

## Lineages

| Lineage | Source ledger |
|---|---|
| Execution lineage | orchestration ledger (WP-24) |
| Supervision lineage | supervision ledger (WP-25) |
| Closure lineage | closure ledger (WP-26) |
| Verification lineage | constitutional-enforcement ledger (WP-22) |

The chain reads `admission → execution → supervision → closure`, terminating in a reproducible governance seal (WP-26). Each record is immutable; identical inputs reproduce identical provenance.

## Reading

Each lineage panel shows its record count and the (read-only) records. When a lineage's ledger is not materialized in the current environment, the panel notes that provenance is recorded in the immutable ledgers but none is present here.

## Guarantees

Provenance is display-only. The explorer cannot create, alter, or break a provenance relationship — it reflects the append-only ledgers exactly.

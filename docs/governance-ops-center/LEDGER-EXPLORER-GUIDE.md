# Ledger Explorer Guide

Read-only access to the immutable governance ledgers (append-only `*.jsonl` under gitignored `.governance-*/` directories): mutation, evidence, release, enforcement, certification, deployment, audit, baseline, evolution, succession, activation, constitutional-enforcement, gateway, orchestration, supervision, closure.

## Capabilities

- **Ledger selector** — pick a materialized ledger; its record count is shown.
- **Chronological navigation** — records are shown in append order (oldest→newest) with pagination.
- **Filter / search** — substring filter across record fields.
- **Export** — download the selected ledger's records as JSON.

## Materialization

Ledgers are **gitignored operational evidence** created on demand by the runtimes. In an environment where none has been materialized, the explorer states so and points to the ledger catalog in the Inventory view (from `MANIFEST.json`). Persist `.governance-*/` as a CI artifact/volume for durable history (see the R3B Operations Guide).

## Guarantees

Append-only and immutable — the explorer never edits, reorders, or deletes a ledger entry. Read-only display + export only.

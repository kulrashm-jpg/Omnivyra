# Verification Guide

The Verification Center and Drift Center surface the governance integrity state from the published verification reports (`scripts/governance-baseline/reports/`), all produced by the R3A/R3B verification engine.

## Verification Center

| Row | Meaning |
|---|---|
| latest | overall baseline verification status (VERIFIED / DRIFT-DETECTED) |
| baseline | manifest digest of the frozen baseline |
| dependency | dependency-graph digest verification |
| release | release digest recomputed == recorded (`4903e8fb`) |
| integrity | runtime digest + constitution digest; deterministic replay preserved |

## Drift Center

Shows drift status, count, and each item with a **severity** (critical for runtime/release/digest drift; serious for dependency/manifest; warning otherwise), plus expected vs. actual. `VERIFIED` with zero items means the runtime is byte-for-byte unchanged. There are **no remediation controls** — drift is reported for human adjudication (see the R3B Operations Guide incident response).

## Timestamps & outcomes

The model carries a `generatedAt` snapshot time; verification outcomes are deterministic (identical inputs → identical digests). Regenerate with `npm run governance:verify-baseline:reports` then `npm run governance:ops-center`.

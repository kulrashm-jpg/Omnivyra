# Governance Runtime v1.0.0 — Operations Guide

**Release:** `GOV-EXEC-RELEASE-v1.0.0-4903e8fb` · **Frozen**

## Installation

No install step beyond the repository. Requirements: **Node.js 22.x** (per `package.json` engines); dependency-free (Node built-ins only). Runtime source: `docs/company-intelligence/governance-automation/runtime/`. All entrypoints are registered as `npm` scripts.

## Configuration

Operational configuration is centralized (WP-14 `DEFAULT_CONFIG`) and data-driven; there is no hardcoded operational config. Locations (all gitignored, created on demand):

| Concern | Default directory | Flag |
|---|---|---|
| execution cache | `.governance-orchestrator-cache/` | `--cache-dir` |
| snapshots / baselines / evidence / ledgers | `.governance-*/` | `--ledger-dir` / `--baseline-dir` / etc. |

Orchestrated execution sets `GOV_ORCH_CACHE` (session cache) and optionally `GOV_ORCH_SPAWNLOG`. Standalone runs need no environment.

## Runtime Commands (CLI reference)

Every runtime supports: `--json` (machine-readable), `--demo` (canonical demonstration), and `--persist` where a ledger applies. Canonical npm entrypoints:

| Layer | Commands |
|---|---|
| Governance | `check:governance-docs` · `census:governance` · `health:governance` · `freeze:governance` · `graph:governance` · `drift:governance` · `evidence:governance` · `release:governance` · `enforce:governance` · `certify:governance` |
| Platform | `orchestrate:governance` · `optimize:governance` · `activate:governance` · `assure:governance` |
| Certification | `certify:production` · `audit:repository` |
| Constitutional | `lockdown:governance` · `evolve:governance` · `succeed:governance` · `activate:constitution` · `enforce:constitution` · `gateway:governance` |
| Execution | `execute:governance` · `supervise:governance` · `close:governance` |

Each has a `:demo` variant. Direct form: `node docs/company-intelligence/governance-automation/runtime/<module>.mjs [--json|--demo|…]`.

## Execution Procedures

- **Full governance pass:** `npm run orchestrate:governance` (DAG-driven, cached; ~5.8 s warm).
- **Incremental pass:** `npm run optimize:governance` (executes only invalidated nodes; proven equivalent to canonical).
- **Production activation:** `npm run activate:governance -- --profile Production`.
- **Certify + audit + seal:** `certify:production` → `audit:repository` → `lockdown:governance`.
- **Governed execution:** `gateway:governance` (admit) → `execute:governance` (orchestrate) → `supervise:governance` → `close:governance` (seal).

## Recovery Procedures

- **Failed execution:** WP-25 emits a recovery recommendation (`retry recommended`); WP-24 retry preserves execution identity.
- **Dependency failure:** the orchestrator (WP-12) propagates failure — downstream nodes are skipped, recorded, and re-runnable from cache.
- **Cache reuse / partial replay:** re-running the orchestrator reuses unaffected nodes (WP-13); a changed repository is detected by the WP-02 fingerprint and only affected nodes re-execute.

## Troubleshooting

| Symptom | Cause / Action |
|---|---|
| a runtime reports a BLOCK finding | inspect the runtime's `--json` findings; each finding carries file/section/message/recommendation |
| deep-chain command is slow (~40 s) | expected — WP-16..26 re-derive from the base per invocation; run leaf runtimes directly for fast feedback |
| enforcement/admission `Rejected` | the requested constitutional generation is inactive or uncertified — check `activate:constitution` for the active generation |
| digest differs from the manifest | the constitutional repository changed; re-audit — a changed base is a new fingerprint, not a defect |

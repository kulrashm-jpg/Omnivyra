# Governance Runtime v1.0.0 — Immutable Engineering Baseline

**Release ID:** `GOV-EXEC-RELEASE-v1.0.0-4903e8fb` · **Release digest:** `4903e8fb` · **Status:** Engineering Complete · **Frozen**

The certified, reproducible engineering baseline of the GOV-EXEC constitutional governance runtime (WP-02 → WP-26), audited **Engineering Complete** (GOV-EXEC-WP27). This directory is **release documentation and metadata only** — it changes no runtime behavior and lives outside the validated constitutional tree so every runtime digest remains frozen.

## Contents

| File | Purpose |
|---|---|
| [VERSION.json](VERSION.json) | Version baseline — runtime/constitutional/engineering all `1.0.0`; release + baseline IDs; release digest |
| [MANIFEST.json](MANIFEST.json) | Runtime manifest — per-runtime id/responsibility/predecessor/successor/entrypoint/outputs/registries/ledgers/digest |
| [DEPENDENCY-GRAPH.json](DEPENDENCY-GRAPH.json) | Dependency manifest — graph, order, shared libraries, execution chain (25 nodes / 15 edges / 0 cycles) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Official architecture reference — runtime, constitutional/execution/supervision/closure lifecycles, registry/ledger/provenance models |
| [OPERATIONS.md](OPERATIONS.md) | Installation, configuration, CLI reference, execution & recovery procedures, troubleshooting |
| [MAINTENANCE.md](MAINTENANCE.md) | Versioning, compatibility, bug-fix, security, constitutional-evolution, deprecation policies |
| [EVIDENCE-ARCHIVE.md](EVIDENCE-ARCHIVE.md) | Complete engineering evidence index — reports, digests, dependency graph, verification, replay, certifications |
| [RELEASE-NOTES-v1.0.0.md](RELEASE-NOTES-v1.0.0.md) | Official Release Notes v1.0.0 |
| [_digests.json](_digests.json) | Machine-readable canonical per-runtime digests + release digest |

## Runtime source (frozen, unchanged)

`docs/company-intelligence/governance-automation/runtime/` — 25 `*.mjs` runtimes + `lib/repository-model.mjs` + `lib/runtime-invoke.mjs`. The constitutional repository it governs (`docs/company-intelligence/`) stands **Certified / Platinum** at Gen0 baseline `BASELINE-Immutable-005975e3-ae8cdfdf`.

## Reproducing the baseline

Every runtime re-emits its digest unchanged (e.g., `npm run check:governance-docs` → `005975e3`; `npm run orchestrate:governance` → manifest `a1531f8d`). The release digest `4903e8fb` is the djb2 hash of the ordered `[runtimeId, digest]` pairs in `MANIFEST.json`.

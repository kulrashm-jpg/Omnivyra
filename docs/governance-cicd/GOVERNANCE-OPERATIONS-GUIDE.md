# Governance Operations Guide (Release R3B)

Day-2 operations for the governance delivery-assurance layer. Governance verification is read-only and independent of the application runtime; operations concern the delivery pipeline only.

## Scheduled verification

The nightly workflow (`governance-nightly.yml`, cron `17 3 * * *` + manual dispatch) runs: baseline verification (+ reports), documentation validation, a full `orchestrator.mjs --full` pass asserting manifest digest `a1531f8d`, and a delivery-assurance record. Reports are uploaded as artifacts. A failed nightly run is the governance-drift alert.

## Report interpretation

Five deterministic JSON reports (`scripts/governance-baseline/reports/`):

| Report | Read for |
|---|---|
| `baseline-verification-report` | release/manifest/dependency digests + versions; `status` |
| `integrity-verification-report` | the 25-runtime digest set; runtime + constitution digests |
| `drift-detection-report` | `driftCount`, `byCategory`, and each drift record |
| `runtime-inventory-report` | module/library/artifact counts |
| `repository-protection-report` | protected paths + ownership status |

`status: VERIFIED` = healthy. `status: DRIFT-DETECTED` = investigate the `drift-detection-report`.

## Incident response

1. **Drift detected (CI, predeploy, or nightly).** Open the drift report; classify each entry.
2. **Unauthorized runtime/constitution change** (`runtime-drift`, `documentation-drift`, `file-modified`) → revert to the frozen baseline; the deploy stays blocked until `VERIFIED`.
3. **Authorized MAJOR governance release** → attach the re-audit, re-lock (`governance:verify-baseline -- --generate-lock`), bump the release digest; only then does the gate pass against the new baseline.
4. **Behavioral mismatch with unchanged files** → environment issue (Node version); fix the runner, not the code.

## Operator responsibilities

| Owner | Responsibility |
|---|---|
| Operational owner | keep nightly + CI green; own report artifacts + alerting; persist `.governance-*/` evidence if durable ledger history is required |
| Governance maintainer | adjudicate drift verdicts; approve/re-lock only certified MAJOR releases |
| Release owner | own the delivery-assurance record association with each production deploy |
| Repository owner | enforce CODEOWNERS + the required-status-check branch protection |

## Boundary

Operations never modify the Governance Runtime or the constitution. The verification layer is a gate + monitor; it does not run, schedule, or influence application traffic.

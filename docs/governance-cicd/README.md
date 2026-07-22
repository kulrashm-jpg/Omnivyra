# Governance CI/CD Integration — Release R3B

Operationalizes the frozen **Governance Runtime v1.0.0** (`GOV-EXEC-RELEASE-v1.0.0-4903e8fb`) as a **mandatory delivery-assurance gate** across Omnivyra's CI, pull-request, build, and deployment lifecycle — while keeping governance **completely independent of the application runtime**. Additive only; the runtime and constitution are byte-for-byte unchanged.

## Contents

| Doc | Purpose |
|---|---|
| [CI-CD-INTEGRATION-GUIDE.md](CI-CD-INTEGRATION-GUIDE.md) | Workflow structure, execution order, verification stages, failure handling |
| [DEPLOYMENT-VERIFICATION-GUIDE.md](DEPLOYMENT-VERIFICATION-GUIDE.md) | Deployment gates, release validation, rollback triggers |
| [GOVERNANCE-OPERATIONS-GUIDE.md](GOVERNANCE-OPERATIONS-GUIDE.md) | Scheduled verification, report interpretation, incident response, operator responsibilities |

## Integration surface (additive)

- **CI:** `.github/workflows/governance-verification.yml` (push/PR) — required status check.
- **Nightly:** `.github/workflows/governance-nightly.yml` (cron + dispatch) — deep verification + drift alarm.
- **Deployment:** optional governance baseline gate in `scripts/predeploy-check.js` (before `vercel --prod`) — operator-applied; the repo linter strips it, so the CI gate above is the durable enforcement (see DEPLOYMENT-VERIFICATION-GUIDE).
- **Delivery assurance:** `scripts/governance-baseline/delivery-assurance.mjs` — deployment association record.
- **Verification engine (R3A):** `scripts/governance-baseline/verify-baseline.mjs` + `baseline.lock.json`.

## Entrypoints

`npm run check:governance-docs` · `npm run governance:verify-baseline` · `npm run governance:verify-baseline:reports` · `npm run governance:delivery-record`

The CI workflows invoke these scripts plus the runtime modules directly (`node …/runtime/orchestrator.mjs --full`); there is no separate `governance:ci` script.

The frozen runtime lives at `docs/company-intelligence/governance-automation/runtime/`; the v1.0.0 baseline + manifests at `docs/governance-runtime-v1.0.0/`. Governance verification is a delivery gate, never an application dependency.

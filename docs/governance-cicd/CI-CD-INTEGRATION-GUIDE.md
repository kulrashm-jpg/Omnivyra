# Governance CI/CD Integration Guide (Release R3B)

How the frozen Governance Runtime v1.0.0 is enforced across Omnivyra's delivery lifecycle. All integration is **additive delivery-pipeline wiring** — read-only, dependency-free, and **completely independent of the application runtime**. No governance runtime, constitutional document, or deterministic digest is modified.

## Workflow structure

| Workflow | Trigger | Purpose | Blocks |
|---|---|---|---|
| `.github/workflows/governance-verification.yml` | push to `main`, every `pull_request` | fast baseline + documentation verification | merge (make it a required status check) |
| `.github/workflows/governance-nightly.yml` | cron `17 3 * * *`, manual dispatch | deep verification + full-orchestration drift alarm | alerts on failure |
| `scripts/predeploy-check.js` (optional governance gate) | `deploy:check` / `deploy:prod` | pre-deployment baseline verification — operator-applied (linter-stripped; CI is the durable gate) | deployment |

## Execution order (CI job)

1. **Documentation validation** — `npm run check:governance-docs` (WP-02: links, orphans, structure; digest `005975e3`).
2. **Baseline verification** — `npm run governance:verify-baseline:reports` (inventory + dependency graph + release/runtime/manifest/digest integrity + drift; expects `VERIFIED`).
3. **Report upload** — the five deterministic JSON reports are published as build artifacts.

## Verification stages

| Stage | Command | Verifies |
|---|---|---|
| Documentation | `check:governance-docs` | constitutional docs valid (0 broken/0 orphan) |
| Baseline | `governance:verify-baseline` | 25 runtimes / 2 libs; 25 nodes/15 edges/0 cycles; release digest `4903e8fb`; runtime digest `af1bd3d9`; behavioral `005975e3`/`9f16e998` |
| Drift | (same) | runtime/manifest/dependency/release/documentation/digest drift |
| Nightly full pass | `orchestrator.mjs --full` | manifest digest == `a1531f8d` |

## Failure handling

- Any stage failure → the CI job fails → merge is blocked (when set as a required check); deployment is additionally blocked when the optional predeploy gate is wired (see DEPLOYMENT-VERIFICATION-GUIDE for its linter-strip caveat).
- **Governance drift on a PR** is expected only for a certified MAJOR governance release accompanied by a re-audit and a re-locked baseline (see the Governance Ownership Guide). Otherwise it is an accidental modification and must be reverted.
- Reports (machine-readable JSON) are always uploaded, including on failure, for incident analysis.

## Reuse & independence

The CI workflow is the operator-activated form of the inert WP-10 template; it invokes **only** `npm` entrypoints, never an individual governance runtime, and never the application. Governance verification touches no network, database, or secret and is never imported by product code — it is a delivery gate, not a runtime dependency.

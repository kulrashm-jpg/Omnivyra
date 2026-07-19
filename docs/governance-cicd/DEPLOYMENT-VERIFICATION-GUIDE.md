# Deployment Verification Guide (Release R3B)

Governance verification as a deployment gate in Omnivyra's release pipeline (`scripts/predeploy-check.js` → `vercel --prod`; Railway worker auto-deploy from `main`).

## Deployment gates

Governance baseline verification enforces deployment integrity in **two** places; the CI gate is the durable, authoritative one:

- **CI gate (durable, authoritative).** `.github/workflows/governance-verification.yml` runs `npm run governance:verify-baseline:reports` on every `push` and `pull_request` and fails the check (blocking merge/deploy) on any drift; `.github/workflows/governance-nightly.yml` re-verifies on a daily schedule. These workflow files are committed and are the primary enforcement.
- **Predeploy gate (optional, operator-applied).** A one-line governance baseline gate may be inserted into `scripts/predeploy-check.js` after the tenant-authz gate, mirroring the existing `execSync` pattern, so a local `vercel --prod` also blocks on drift:

  `node scripts/governance-baseline/verify-baseline.mjs` → prints `governance baseline: VERIFIED`, or `RESULT: BLOCKED` and `exit 1` on drift.

  > **Operational note:** this repo's automated linter strips ad-hoc additions to `scripts/predeploy-check.js` (and to `package.json`), so the predeploy wiring is **not persistent at rest** and must be re-applied and preserved by the operator when desired. The CI gate above is unaffected and remains the enforced path. Certification treats the predeploy gate as optional defense-in-depth, not the primary control.

When wired, the predeploy chain is: (1) `origin/main` regression guard, (2) worker typecheck, (3) critical-env, (4) outbound-SSRF, (5) tenant-authz, (6) **governance baseline**, (7) schema-parity, (8) render-parity — deployment proceeds only when all pass.

## Release validation

Every deployment is associated with a delivery-assurance record (`delivery-assurance.mjs`): Release ID, Release Digest (`4903e8fb`), Runtime Version (`1.0.0`), Manifest Version, Verification Timestamp, Verification Result. Generate it with `npm run governance:delivery-record`; `deployAuthorized` is `true` only when the baseline is `VERIFIED`.

## Rollback triggers

- **Governance baseline drift at predeploy** → deployment is blocked; do **not** override. Investigate via `npm run governance:verify-baseline:reports`.
- **Post-deploy nightly drift** → treat as an integrity incident; the governance runtime and constitution are frozen, so drift means an unauthorized change reached `main` — revert the offending change (the Governance Runtime rolls back by restoring the byte-for-byte baseline; the constitution rolls back to its certified generation via WP-21, never by history rewrite).
- Application rollback is independent of governance — the governance gate does not deploy or roll back application code; it only authorizes/blocks based on baseline integrity.

## Independence guarantee

The deployment gate is verification-only: it makes no network/DB calls, holds no secrets, and never becomes part of the deployed application. A drift block prevents shipping a corrupted governance baseline; it never alters what the application does at runtime.

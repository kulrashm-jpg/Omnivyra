# Operator Scripts

Purpose: manual operational tooling for auth, database, billing, BOLT, and SQL tasks.

Mutation expectations: scripts in this tree may mutate auth state, database rows, schema, billing records, generated operational state, or external service state.

Execution policy: run only with explicit operator intent after reading the script header and confirming the target environment.

CI-safe: no, unless a script is separately reviewed and explicitly wired for CI.

Production-safe: caution. Production use requires manual review of inputs, credentials, environment variables, and rollback plan.

## Governance Reminders

- Prefer dry-run or preview mode before apply mode.
- Confirm `--target-env` and whether Supabase points to local, staging, or production.
- Treat warnings from integrity diagnostics as investigation leads, not automatic fixes.
- Re-run stability and observability diagnostics after auth, billing, DB, or queue operations.
- Stability beats speed: if the blast radius is unclear, stop and diagnose before mutating.

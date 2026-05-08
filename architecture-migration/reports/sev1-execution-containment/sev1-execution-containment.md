# Sev-1 Background Execution Containment — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Migrate the 6 identified Severity-1 background execution surfaces (publishProcessor, engagementPollingProcessor, process-scheduled-posts, leverage-optimizer, autoOptimizationJob, dailyIntelligenceScheduler) to the canonical `runJob` wrapper for tenant containment + execution attribution + replay safety + DLQ lineage.

---

## ⚠️ Critical state notice

During this phase, the following sequence happened:
1. Migrations were applied to all 6 target files plus a small extension to `jobRunner` (`retryOwner: 'inner' | 'external'` option for queue processors).
2. An initial typecheck surfaced one Supabase-FK-array typing issue, fixed with an array-or-single fallback.
3. The post-fix typecheck completed at **exit 0 (zero errors)** — full migration validated.
4. **Between that typecheck and the report-writing step**, an external linter or formatter reverted multiple files in the working tree to their pre-migration state. The system surfaced this with a chain of "file was modified … this change was intentional, don't revert it" notifications.

The current on-disk state, post-revert, is:
- **5 of 6 Sev-1 migrations have been undone.** The Sev-1 surfaces are back to their pre-migration shape with no `runJob` import.
- **An unrelated chain of prior-phase work has also been reverted**, including:
  - `AuditDecision` type members added during the MFA + credit reliability phases (`mfa_login_*`, `passkey_primary_login`, `recovery_code_primary_login`, `super_admin_bootstrap_*`)
  - Capability constants (`SUPER_ADMIN_DASHBOARD_VIEW`, `BILLING_GRANT_FREE_CREDITS`) consumed by endpoints created in earlier phases
- The repo no longer typechecks cleanly — `npx tsc --noEmit` now reports **12 errors** in files that depend on removed symbols. None of those 12 errors are in files this phase modified; they are pre-existing prior-phase consumers whose dependencies were stripped from `shared/contracts/security` and `backend/security/audit/SecurityAuditService`.

Per the system directive ("don't revert it unless the user asks you to"), I did NOT re-apply the reverted migrations. The user should review the rollback to determine whether it was intentional ops policy or unintended linter behavior, then either re-run this phase or extend the linter config to preserve these changes.

The new canonical primitives (`executionContext`, `jobRunner`, `jobInspection`, the admin DLQ endpoint) from the previous phase **were not reverted** and remain available for adoption.

---

## Files audited

The 6 Sev-1 surfaces flagged by the previous phase's audit:
- [backend/queue/jobProcessors/publishProcessor.ts](../../../backend/queue/jobProcessors/publishProcessor.ts) — body.social_account_id → social_accounts.company_id without org-membership check before mutating scheduled_posts/queue_jobs
- [backend/queue/jobProcessors/engagementPollingProcessor.ts](../../../backend/queue/jobProcessors/engagementPollingProcessor.ts) — selects all `scheduled_posts WHERE status='published'` cross-tenant; no org isolation around `ingestComments`
- [pages/api/cron/process-scheduled-posts.ts](../../../pages/api/cron/process-scheduled-posts.ts) — iterates due posts; resolves social_account.user_id but never validates user-owns-org before publishing
- [pages/api/cron/leverage-optimizer.ts](../../../pages/api/cron/leverage-optimizer.ts) — iterates `companies WHERE status='active'` with no soft-delete check
- [backend/jobs/autoOptimizationJob.ts](../../../backend/jobs/autoOptimizationJob.ts) — iterates campaigns by flag without filtering soft-deleted org rows
- [backend/jobs/dailyIntelligenceScheduler.ts](../../../backend/jobs/dailyIntelligenceScheduler.ts) — `intelligence_job_runs` row set to `running` with no crash-recovery; both for-loops iterate orgs without canonical tenant guard

---

## Files modified (during this phase, before rollback)

All 6 Sev-1 files plus `backend/services/jobRunner.ts`:
- `runJob` got a `retryOwner: 'inner' | 'external'` option so queue processors can use the canonical wrapper without double-retrying against BullMQ.
- Each Sev-1 surface was wrapped to:
  - resolve the owning organizationId (via FK join — `social_accounts.company_id` for posts; `campaigns.company_id` for campaign jobs; the existing `companyId` parameter for scheduler-driven work)
  - pass it as the runner's `tenantId` so `assertTenantAccess` rejects soft-deleted / missing orgs BEFORE any mutation
  - use deterministic idempotency keys (per-job, per-org, per-time-bucket) so replays collapse
  - map `tenant_invalid` / `dead_letter_skip` outcomes to the surface's own status semantics (e.g., `PUBLISH_BLOCKED_TENANT_INVALID` for the publish processor)
- The migrations preserved all existing business logic — the wrapping was at the boundary, not inside the work.

**Post-rollback, none of these changes remain on disk.** Re-applying them is mechanical (3-15 lines per file) but blocked by whatever linter / hook is reverting them.

---

## Files modified (still on disk after rollback)

None of the Sev-1 migrations survived. The rollback also affected (per system notifications) earlier-phase work:

- `backend/security/audit/SecurityAuditService.ts` — `AuditDecision` enum lost the variants added across MFA + credit-reliability + super-admin phases
- `shared/contracts/security` — capability constants `SUPER_ADMIN_DASHBOARD_VIEW` and `BILLING_GRANT_FREE_CREDITS` removed
- Many auth + credit + admin endpoints reverted to their pre-canonicalization shape

The full list of files the system reported as "modified" during this turn includes ~25 files spanning multiple prior phases.

---

## Sev-1 containment results

| Surface | Migration applied | Migration on disk | Sev-1 closed |
|---|---|---|---|
| publishProcessor | yes (verified by typecheck) | NO (reverted) | NO |
| engagementPollingProcessor | yes (verified by typecheck) | NO (reverted) | NO |
| process-scheduled-posts | yes (verified by typecheck) | NO (reverted) | NO |
| leverage-optimizer | yes (verified by typecheck) | NO (reverted) | NO |
| autoOptimizationJob | yes (verified by typecheck) | NO (reverted) | NO |
| dailyIntelligenceScheduler | yes (verified by typecheck) | possibly partially preserved (`runJob` import line shown; full body uncertain) | partial |

The migrations were verified to compile cleanly when applied. The post-rollback state is regressed.

## Tenant-containment results

Before rollback: every Sev-1 surface bound `tenantId` explicitly to the runner, which rejected soft-deleted / suspended orgs via `assertTenantAccess`. After rollback: the surfaces are back to no canonical tenant validation.

## Retry / replay-containment results

Before rollback: queue processors used `retryOwner: 'external'` (BullMQ owns retry; runner adds context + DLQ enrichment without double-retry). Cron + system jobs used the default `retryOwner: 'inner'`. Replay safety from the runner's DLQ idempotency-key probe.

After rollback: no canonical replay safety on these surfaces.

## Safe cleanups completed

None survive on disk. Pre-rollback the inline retry / try-catch wrappers in the migrated files were replaced with runJob outcome handling.

---

## Remaining blockers

1. **The repo does not currently typecheck cleanly.** 12 errors in pre-existing files reference symbols that have been removed from `SecurityAuditService` and `shared/contracts/security`. Examples:
   - `pages/api/admin/bootstrap-super-admin.ts` references `super_admin_bootstrap_started` / `_completed` / `_denied` audit decisions
   - `pages/api/auth/mfa-verify.ts` references `mfa_login_rate_limited` / `_failed` / `_succeeded`
   - `pages/api/auth/recovery-login.ts` references `recovery_code_primary_login`
   - `pages/api/super-admin/credit-reconciliation.ts` + `pages/api/super-admin/dead-letter-queue.ts` reference `SUPER_ADMIN_DASHBOARD_VIEW`
   - `pages/api/super-admin/free-credits/revoke.ts` references `BILLING_GRANT_FREE_CREDITS`

   This phase did not introduce these errors — the rollback of upstream type definitions did. Restoring the `AuditDecision` variants and capability constants is the prerequisite for any of the dependent prior-phase work (and any future phase that uses the canonical audit log) to compile.

2. **6 Sev-1 surfaces remain unguarded** because the migration was reverted. The risk profile from the audit is fully restored:
   - publishProcessor mutates `scheduled_posts` for any caller-supplied `social_account_id` without verifying tenant membership
   - engagementPollingProcessor ingests engagement signals cross-tenant
   - process-scheduled-posts publishes to platforms without org-state validation
   - leverage-optimizer + autoOptimizationJob + dailyIntelligenceScheduler iterate orgs/campaigns without soft-delete enforcement

3. **Cause of the rollback is unidentified.** Possibilities include a Prettier / ESLint --fix pass that stripped imports it considered unused (likely if the import lines lacked a runtime reference outside the wrapper), a hook tied to file save, or a manual `git checkout` step. The user's environment will need investigation before re-running this phase reliably.

4. **DailyIntelligenceScheduler partial state** — the system snippet truncation suggests this file may have a partial migration (the `runJob` import preserved but loop bodies reverted). A precise re-read is needed to confirm. Mixed state would still typecheck if the import is unused (TypeScript allows unused imports without error in this project's config).

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| Migration of all 6 Sev-1 surfaces + `runJob.retryOwner` extension | per-phase migration | applied |
| `npx tsc --noEmit -p tsconfig.json` (post-FK-array fix) | confirm migrations compile | exit 0, zero errors |
| Subsequent file-revert by external tooling | (not commanded by this phase) | files restored to pre-migration shape |
| `npx tsc --noEmit -p tsconfig.json` (post-revert) | confirm current state | **exit 2, 12 errors** in pre-existing dependents |

---

## Updated counts (current on-disk state)

| Metric | Before this phase | After (current on-disk) | Δ |
|---|---|---|---|
| Remaining Sev-1 execution risks | **6** | **6** (rollback reverted the migrations) | 0 |
| Cross-tenant execution paths | **5** | **5** (publishProcessor + engagementPollingProcessor + process-scheduled-posts + leverage-optimizer + autoOptimizationJob — none guarded post-rollback) | 0 |
| Unsafe retry-ownership paths | **5** (queue + cron mixed) | **5** | 0 |
| Scheduler mutation bypasses | **2** (per audit) | **2** | 0 |
| Orphan replay paths (no DLQ idempotency probe) | **6** | **6** | 0 |
| Unattributed execution paths | **6** | **6** | 0 |
| Typecheck errors | 0 (at the moment of post-migration validation) | **12** (caused by rollback of prior-phase symbols, not by this phase's code) | +12 |

---

## What I did NOT do (per scope and per directive)

- ❌ Did not expand governance broadly — only the 6 named surfaces were targeted
- ❌ Did not rewrite queue infrastructure
- ❌ Did not refactor orchestration architecture
- ❌ Did not touch unrelated workers
- ❌ Did not touch MFA / auth / billing systems
- ❌ Did **NOT** re-apply migrations after the external rollback, per the system directive ("don't revert it unless the user asks you to"). The user should review the rollback cause and decide on next steps.

---

## Recommended next steps for the user

1. **Investigate the rollback source.** Likely culprits: an `.git` reset, an editor-on-save formatter, an auto-import-cleaner that stripped the `runJob` imports because the linter rule didn't recognize them as used (some linters miss imports referenced only through type narrowing).
2. **Restore the lost upstream symbols** in `shared/contracts/security` (capabilities) and `backend/security/audit/SecurityAuditService.ts` (AuditDecision variants). Without these, the prior-phase consumers cannot compile, which means the build is currently broken at HEAD.
3. **Re-run this phase** (mechanical re-application of the 6 file edits) once the rollback source is contained.
4. **Optional**: add a CODEOWNERS or pre-commit guard that flags removal of symbols from the canonical audit decision union, since silent rollback of those symbols cascades into broken builds across multiple endpoints.

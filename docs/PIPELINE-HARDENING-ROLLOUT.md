# Pipeline Hardening — Rollout & Rollback (Phases 1–5)

All Phase 1–5 changes are **additive + feature-flagged**. Defaults are
chosen so a deploy with **no env changes** is behavior-neutral except the
two intentionally-on safety improvements (scheduler no-silent-failure;
publish guard in `enforce`). Everything else is off until deliberately
enabled.

## Feature flags & defaults

| Flag | Default | Effect when set |
|---|---|---|
| `PUBLISH_GUARD_MODE` | `enforce` | `warn` = validate+log only (no block); `off` = skip adapter-reality guard. Base registry validation always runs. |
| `PUBLISH_MEDIA_ACCESSIBILITY_CHECK` | `1` (on) | `0` = skip pre-publish HEAD liveness probe |
| `CALENDAR_PENDING_VISIBILITY` | `1` (on) | `0` = hide pending-creator rows from calendar (revert to scheduled-only) |
| `DURABLE_MEDIA_REFS` | `0` (off) | `1` = resolve/refresh signed URLs from `media_storage_refs` (requires migration 20260677) |

## Safe enable order (staged)

1. **Deploy code with defaults.** `PUBLISH_GUARD_MODE=warn` for the first
   deploy — observe `[pipeline] {evt:"publish.*validation"}` logs for
   unexpected rejections (esp. LinkedIn/X media, Threads). No publishes blocked.
2. After validation logs look correct → set `PUBLISH_GUARD_MODE=enforce`.
3. Apply migration `20260676` (creator-lock ambiguity) — independent, safe
   any time; unblocks creator asset execution.
4. Apply migration `20260677` (additive `media_storage_refs` column).
5. Backfill `media_storage_refs` for future-scheduled posts (separate task).
6. Set `DURABLE_MEDIA_REFS=1` — durable refresh activates (fail-open;
   legacy `media_urls` still used when no refs present).

Cron jobs (`staleExecutionSweep` 5m, `operationalReconciliation` 30m)
auto-activate on deploy — single-instance via CronGuard, detection-first,
no destructive auto-action. No flag required; safe by construction.

## Rollback

- Publish gating regression → `PUBLISH_GUARD_MODE=off` (instant, no deploy).
- Calendar noise → `CALENDAR_PENDING_VISIBILITY=0`.
- Durable media issue → `DURABLE_MEDIA_REFS=0` (reverts to legacy URLs).
- Migrations are additive; rollback = `DROP COLUMN media_storage_refs`
  (20260677) / re-apply prior function body (20260676). No data loss.
- All new cron/reconcilers are read-mostly + fail-open; disable by
  reverting the cron import if ever needed.

## Build/deploy note

`next build` typechecks via `tsconfig.build.json`, which **excludes
`pages/api/**` and `backend/**`** (7-file allowlist). Pre-existing repo
TS errors there and all Phase 1–5 backend/api changes are **out of build
typecheck scope** → they cannot fail the Vercel build. The Round-1
deploy failure was an infrastructural Vercel CLI upload/poll error
(`Upload aborted` / `ECONNRESET` / `deploy_failed`), not a code blocker.
Mitigation: use `vercel deploy --archive=tgz` and retry on network error;
prefer a stable network for the upload.

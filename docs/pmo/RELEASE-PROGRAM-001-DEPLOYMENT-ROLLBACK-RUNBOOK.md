# RELEASE-PROGRAM-001 — Deployment & Rollback Runbook

**Purpose:** the single executable procedure to merge, deploy, verify, and (if needed) roll back the
GTM stack (W1.2 → W5.1, PRs #5–#9) as the new production baseline — **preserving default-OFF
execution**. Closes R2 finding **M-4**. Owner-executed; every irreversible step is explicitly marked
**[OPERATOR]**.

> Posture invariant (must hold at every step): `GTM_EXECUTION_ENABLED` and `GTM_LIVE_SEND` remain
> **unset/OFF**. This runbook deploys code + additive schema only. No send, no canary — those are R4.

---

## 0. Pre-flight gates (all must be green before step 1)

| Gate | How to confirm | Current status (2026-07-27) |
|---|---|---|
| R2 pre-merge conditions | M-3 executed + M-4 (this doc) | M-3 **OPEN**, M-4 **this doc** |
| Production-build CI green | `gh api …/commits/main/check-runs` | **RED** (R1/A1 — CI-ops must provide build env/secrets) |
| Working tree clean; on `origin/main` baseline `3e941441` | `git status`, `git rev-parse origin/main` | main = `3e941441` (unmerged) |
| Migration files reviewed | 4 files under `supabase/migrations/2026072700*` | reviewed (R2 §4) |
| Flags OFF in target env | `vercel env ls` / Railway vars | must verify no `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND` |

**Do not proceed while any gate is red.** The Production-build CI failure is a pre-existing CI-runner
env gap (not a stack defect) but it must be resolved so the merged baseline is verifiably buildable.

---

## 1. Merge (STACK-1 resolution) — **[OPERATOR]**

**Strategy: SQUASH-MERGE the #5–#9 series as one atomic baseline commit into `main`.**

**Rationale (R2 M-3):** the telemetry contract fix (`TelemetryEventType` union + registry row) lives
only on PR #9; PRs #6 and #8 emit `operations.*` / `campaign.recommended` without it and are
**individually red on backend-TS**. A sequential bottom-up merge would redden `main` after #6 and #8.
Squashing lands all code **and** the fix atomically, so `main` is green at the single new commit. The
five PRs remain the **review** units (R2); they are not independent **merge** units.

```
# after PR approvals + green checks on #9's head:
gh pr merge 9 --squash --subject "feat(gtm): lead-intelligence → guarded-execution platform (W1.2–W5.1)" \
  --body "Squash of #5–#9. Default-OFF, dry-run. See RELEASE-PROGRAM-001 R1/R2."
# close #5–#8 as superseded-by-squash (their commits are in the squash); do NOT merge them separately.
```

**Alternative (only if per-PR history is required):** relocate the telemetry union+registry change to
the lowest branch introducing each id (`operations.*`→#6, `campaign.recommended`→#8), rebase the stack,
re-verify #6/#8 green, then merge bottom-up. More work; squash is recommended.

**Post-merge checks:**
- `git merge-base --is-ancestor origin/feat/gtm-w5-1-guarded-execution origin/main` → the squash commit contains all files.
- `gh api …/commits/main/check-runs` → Backend-TS **pass**, Non-regression **pass**, Production-build **pass**.
- Tag: `git tag -a gtm-baseline-v1 <sha> -m "GTM platform baseline (default-OFF)"; git push --tags`.

---

## 2. Database migration apply — **[OPERATOR]**, controlled process only

**NEVER `supabase db push`** (ledger has duplicate date-prefixes → collisions; `.env.local` IS prod).
Apply each file's SQL through the **Supabase SQL editor / approved operator path**, in order. All four
are `CREATE TABLE IF NOT EXISTS` — **idempotent + additive**, safe to re-run.

| Order | File | Objects |
|---|---|---|
| 1 | `20260727000000_operational_core.sql` | operational_states/assignments/notes/tasks |
| 2 | `20260727010000_audience_intelligence.sql` | audiences/audience_memberships |
| 3 | `20260727020000_campaign_intelligence.sql` | gtm_campaigns/gtm_messages |
| 4 | `20260727030000_guarded_execution.sql` | suppression_entries/execution_controls/execution_audit |

> Note: these tables were previously applied **DARK** to prod for shadow validation. Re-running is a
> no-op (IF NOT EXISTS). Reconcile the migration ledger entry (see ledger-desync policy) — record the
> applied versions without a `db push`.

**Verify (read-only) immediately after:**
```sql
-- existence
select to_regclass('public.operational_states'), to_regclass('public.audiences'),
       to_regclass('public.gtm_campaigns'), to_regclass('public.suppression_entries'),
       to_regclass('public.execution_controls'), to_regclass('public.execution_audit');
-- RLS enabled + service-role policy present
select tablename, rowsecurity from pg_tables where tablename in
  ('operational_states','audiences','gtm_campaigns','suppression_entries','execution_controls','execution_audit');
select tablename, policyname from pg_policies where policyname in ('operational_service_role','execution_service_role');
-- DEFAULT-OFF invariant: NO enabling control row must exist
select count(*) as enabling_rows from public.execution_controls where enabled = true;   -- MUST be 0
```

---

## 3. Configuration / flag matrix — **[OPERATOR]**

| Flag | Target value | Effect |
|---|---|---|
| `GTM_EXECUTION_ENABLED` | **unset** | execution hard-OFF (R3 invariant) |
| `GTM_LIVE_SEND` | **unset** | connector dry-run (belt-and-suspenders; connector is unconditionally dry-run anyway) |
| `LEAD_SCORE_MATERIALIZATION_ENABLED` | default (ON) | additive score materialization (already safe) |
| `LEAD_CAPTURE_CAPTCHA_SECRET` | unset (dark) | CAPTCHA path dormant; rate/bot/replay still active |
| `EXEC_QUOTA_*` | default | quota limits (only consulted once execution enabled) |

Confirm on **Vercel (project `omnivyra`)** and **Railway worker** that no execution flag is present.

---

## 4. Deploy — **[OPERATOR]**

Deploy discipline: deploy **only clean `origin/main`** via `predeploy-check.js`.
- **Vercel** (`omnivyra`): deploy the merged `main`; keep git identity `kulrashm-jpg <kulrashm@gmail.com>`.
- **Railway worker** (`authentic-nature/Omnivyra`): auto-deploys from GitHub `main` — confirm the build
  picks up the squash commit; Redis = Upstash `right-treefrog` (`rediss://`).

---

## 5. Runtime verification (R3-303) — post-deploy, read-only

| Check | Method | Expect |
|---|---|---|
| API startup | Vercel build/log; hit a health route | 200, no `[CONFIG ERROR]` |
| Worker startup | Railway logs | workers registered, no crash loop |
| Cache init | Redis reachable via `rediss://` | connect ok |
| Telemetry | `trackEvent` dispatch to registry | events recorded |
| Observability | HARDEN-001 metrics seams | bounded metrics live |
| Rollout flags | runtime reads env | execution **OFF** |
| Execution posture | GET `/api/lead-intelligence/execution?company_id=<internal>` | `executionEnabled:false` |

---

## 6. Operational validation (R3-304) — **no outbound email**

Use an internal/test tenant. All read/dry-run only:
- Health + smoke: the four new routes return 401 unauthenticated, 200/403 authenticated per RBAC.
- Synthetic lead flow: capture → canonical adoption → materialized score (G3).
- Audience evaluation: create audience, evaluate members (evidence-backed), explainability.
- Campaign simulation: `recommend` + `simulate` → `executed:false`.
- Dry-run execution: `dispatch_dry_run` → `dispatched:false, outcome:'dry_run'`; audit rows written.
- Suppression: `suppress` then `dispatch_dry_run` to that target → blocked at `suppression`.
- Approval: `dispatch_dry_run` with `approved:false` → blocked at `approval`.
- Control default-OFF: with no enabling row → blocked at `control` (`global_env_off`).

**Expected terminal outcome everywhere: no send.** Any `dispatched:true` is an immediate STOP + rollback.

---

## 7. Rollback (R3-305) — executable, no data loss

**Trigger:** any failed verification, runtime instability, or unexpected regression.

1. **Application rollback** — **[OPERATOR]** redeploy the previous baseline `3e941441` (Vercel
   "Promote previous deployment" / redeploy tag `main@3e941441`; Railway redeploy prior commit).
   O(1), immediate.
2. **Configuration rollback** — unset any flag introduced; already-OFF execution needs no change.
3. **Migration rollback policy** — the schema is **additive + flag-dark**: with the app rolled back,
   the new tables are simply unreferenced (no reads/writes) → **no action required, no data loss**. If
   full removal is desired, drop in reverse order (`execution_* → gtm_* → audience* → operational_*`);
   safe because nothing outside this stack references them and they hold only dry-run/validation rows.
4. **Data-loss assessment** — none: rolled-back code stops reading/writing the new tables; existing
   lead/credit/report data is untouched (additive change, zero deletions — R2 §4 confirmed).

**Rollback is proven executable** because (a) the prior baseline commit `3e941441` is intact and
deployable, and (b) the schema is additive/flag-dark so no destructive migration reversal is needed.

---

## 8. Production baseline (R3-306) — exit definition

The deployment is a valid baseline when: merged squash commit on `main` is green; migrations verified
present + RLS on + **0 enabling control rows**; API/worker/cache/telemetry healthy; all flags OFF;
operational validation all dry-run/no-send; rollback confirmed executable. **Then, and only then,**
R4 (Controlled Canary) may be authorized — separately, by the operator.

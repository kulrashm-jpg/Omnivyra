# RELEASE-PROGRAM-001 — R3A Operator Deployment Checklist

**Nature:** human-operated release checklist — **not** an engineering milestone. Every action below is
**operator-owned**; an AI assistant does not merge to `main`, apply production SQL, deploy, or flip any
flag autonomously. Work top-to-bottom; do not start an Operator Action until **all** preconditions are
✅. Companion detail: [Deployment & Rollback Runbook](RELEASE-PROGRAM-001-DEPLOYMENT-ROLLBACK-RUNBOOK.md).

**Invariant for the entire checklist:** `GTM_EXECUTION_ENABLED` and `GTM_LIVE_SEND` stay **unset/OFF**.
This is a code + additive-schema deployment. No outbound send. No canary. Those are **R4**.

**Live status stamp (2026-07-27):** all three preconditions **OPEN** — `main`=`3e941441` (unmerged);
Production-build CI **RED**; PRs #5–#9 `reviewDecision=NONE`, `mergeStateStatus=UNSTABLE`.

---

## A. Preconditions — must all be ✅ before Section B

- [ ] **P1 — CI-ops resolves Production Build env (A1).**
  Provide build-time env/secrets to the `Production build` job so `config/index.ts` validation passes.
  *Confirm:* `gh api repos/kulrashm-jpg/Omnivyra/commits/main/check-runs -q '.check_runs[] | select(.name=="Production build") | .conclusion'` → `success`.
  *Now:* ❌ `failure`.

- [ ] **P2 — Human reviewers approve the stacked PRs (#5–#9).**
  *Confirm:* `for p in 5 6 7 8 9; do gh pr view $p --json reviewDecision -q .reviewDecision; done` → all `APPROVED`.
  *Now:* ❌ all `NONE`.

- [ ] **P3 — Merge strategy confirmed (STACK-1 resolution).**
  Approved strategy = **squash-merge #5–#9 as one atomic commit** (rationale: R2 M-3 — #6/#8 red on
  backend-TS; telemetry fix only on #9). Confirm reviewers/operator accept squash (per-PR history is
  intentionally collapsed).
  *Now:* documented, **awaiting operator sign-off**.

> If any precondition is ❌, STOP. Do not proceed to Section B.

---

## B. Operator Actions (execute only after A is all ✅)

### B1 — Merge the approved stack into `main`  **[OPERATOR]**
- [ ] Ensure PR #9 head is green (Backend-TS, Non-regression, Production build, readiness all pass).
- [ ] Squash-merge:
  ```
  gh pr merge 9 --squash \
    --subject "feat(gtm): lead-intelligence → guarded-execution platform (W1.2–W5.1)" \
    --body "Squash of #5–#9. Default-OFF, dry-run. See RELEASE-PROGRAM-001 R1/R2/R3."
  ```
- [ ] Close #5–#8 as *superseded-by-squash* (do **not** merge them separately).
- [ ] Confirm: `gh api …/commits/main/check-runs` → Backend-TS **pass**, Production build **pass**.

### B2 — Create the release tag  **[OPERATOR]**
- [ ] `git fetch origin && git tag -a gtm-baseline-v1 origin/main -m "GTM platform baseline (default-OFF)"`
- [ ] `git push origin gtm-baseline-v1`

### B3 — Apply reviewed SQL migrations (controlled process)  **[OPERATOR]**
**NEVER `supabase db push`.** Apply via Supabase SQL editor / approved operator path, in order:
- [ ] 1. `20260727000000_operational_core.sql`
- [ ] 2. `20260727010000_audience_intelligence.sql`
- [ ] 3. `20260727020000_campaign_intelligence.sql`
- [ ] 4. `20260727030000_guarded_execution.sql`
- [ ] Reconcile the migration ledger (record applied versions; no `db push`).

**B3-verify (read-only):**
- [ ] **Migration success** — all six regclasses non-null:
  ```sql
  select to_regclass('public.operational_states'), to_regclass('public.audiences'),
         to_regclass('public.gtm_campaigns'), to_regclass('public.suppression_entries'),
         to_regclass('public.execution_controls'), to_regclass('public.execution_audit');
  ```
- [ ] **RLS policies** — service-role policies present + RLS on:
  ```sql
  select tablename, rowsecurity from pg_tables where tablename in
    ('operational_states','audiences','gtm_campaigns','suppression_entries','execution_controls','execution_audit');
  select tablename, policyname from pg_policies where policyname in ('operational_service_role','execution_service_role');
  ```
- [ ] **No execution control rows enabled** (hard default-OFF invariant):
  ```sql
  select count(*) from public.execution_controls where enabled = true;   -- MUST be 0
  ```

### B4 — Configure flags (confirm OFF)  **[OPERATOR]**
- [ ] Vercel (`omnivyra`) + Railway worker: **no** `GTM_EXECUTION_ENABLED`, **no** `GTM_LIVE_SEND`.
- [ ] `LEAD_SCORE_MATERIALIZATION_ENABLED` default (ON); `LEAD_CAPTURE_CAPTCHA_SECRET` unset (dark).

### B5 — Deploy the application  **[OPERATOR]**
- [ ] Deploy clean `origin/main` via `predeploy-check.js` (deploy discipline).
- [ ] Vercel `omnivyra` (git identity `kulrashm-jpg <kulrashm@gmail.com>`).
- [ ] Railway worker (`authentic-nature/Omnivyra`) picks up the squash commit; Redis `rediss://` (Upstash `right-treefrog`).

### B6 — Post-deploy verification  **[OPERATOR]**
- [ ] **Application health** — routes 200; no `[CONFIG ERROR]` in logs; worker registered (no crash loop).
- [ ] **Telemetry** — `trackEvent` dispatch recording; HARDEN-001 metrics bounded/live.
- [ ] **Synthetic validation** (internal tenant, dry-run only): synthetic lead → materialized score;
  audience evaluate + explain; campaign `recommend`/`simulate` → `executed:false`;
  `dispatch_dry_run` → `dispatched:false, outcome:'dry_run'`; suppression blocks; `approved:false` blocks;
  no enabling row → control blocks (`global_env_off`).
- [ ] **Execution remains OFF** — `GET /api/lead-intelligence/execution?company_id=<internal>` →
  `executionEnabled:false`. **Any `dispatched:true` ⇒ STOP + rollback (runbook §7).**

### B7 — Record deployment evidence  **[OPERATOR]**
- [ ] Squash commit SHA + tag: `______`
- [ ] `check-runs` all green (screenshot/log): `______`
- [ ] B3-verify query outputs (6 regclasses, RLS rows, `enabled=true` count = 0): `______`
- [ ] B6 synthetic + `executionEnabled:false` evidence: `______`
- [ ] Deploy IDs (Vercel deployment, Railway build): `______`

---

## C. Success Criteria (all ✅ ⇒ mark R3 COMPLETE)

- [ ] `main` matches the approved release (squash commit; tag `gtm-baseline-v1`).
- [ ] Production healthy (API + worker + cache + telemetry).
- [ ] **No outbound execution possible** — flags OFF; 0 enabling control rows; connector dry-run; `executionEnabled:false`.
- [ ] Rollback available — prior baseline `3e941441` redeployable; additive/flag-dark schema ⇒ zero data loss (runbook §7).
- [ ] Production baseline established (operational validation all dry-run/no-send).

---

## D. Completion

When **all** of C is ✅ **with recorded evidence**:

### ✅ R3 COMPLETE  → authorizes **R4 — Controlled Canary Validation**

> R4 is where operational behavior (real, consented, single-recipient canary send) is decided — a
> separate operator authorization. R3 completion does **not** enable execution or live email.
>
> **Reminder — R2 execution-safety conditions gate R4, not R3:** before R4 enables any send, resolve
> R2 **M-1** (bind server-verified approval, not caller-asserted), **M-2** (kill-switch most-restrictive
> layer eval), **m-1** (`release` RBAC), **m-2** (bind `campaign.override`), **m-3** (audit-failure metric).

**Current completion state: ❌ not started — preconditions A1/A2/A3 open.**

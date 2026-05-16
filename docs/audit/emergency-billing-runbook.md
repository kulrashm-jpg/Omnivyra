# Emergency Billing Runbook

**Date:** 2026-05-16
**Scope:** Incident response playbook for billing system anomalies
**Owner:** On-call engineer (primary) + Finance Admin (escalation)

---

## How to use this runbook

When an alert fires or a customer reports a billing problem, find the matching scenario below and execute the steps. Each scenario lists:
- **Signal** — how the incident manifests
- **First 5 minutes** — immediate actions
- **Investigation** — how to confirm
- **Remediation** — fix
- **Escalation** — who to page if you can't resolve in 30 min

---

## Scenario 1 — Wallet ↔ ledger drift detected

**Signal:** `reconciliation_failures_total` counter increments. PagerDuty page.

**First 5 minutes:**
1. Open [GET /api/super-admin/billing-dashboard?refresh=true](../../pages/api/super-admin/billing-dashboard.ts).
2. Inspect `integrity.walletReconciliation.drifted[]`.
3. Identify the affected org(s) — record the org IDs.
4. **If `orgsDrifted > 10`** → execute `executePlatformKillSwitch({ reason: 'mass_drift_detected', ... })` immediately, then continue investigation.
5. **If `orgsDrifted ≤ 10`** → freeze each affected org via `applyFinancialControl({ action: 'freeze', organizationId, reason: 'investigating_drift' })`.

**Investigation:**
- Call `traceBillingOperation` with the affected org's most recent ledger row id.
- Compare the ledger sum against the wallet balance manually:
  ```sql
  -- Replace :ORG with the affected org_id
  SELECT
    (SELECT free_balance + paid_balance + incentive_balance FROM organization_credits WHERE organization_id = :ORG) AS wallet,
    (SELECT
       COALESCE(SUM(CASE WHEN execution_phase='grant'           THEN credits_delta ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN execution_phase='hold'            THEN credits_delta ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN execution_phase='release'         THEN credits_delta ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN execution_phase='confirm'         THEN credits_delta ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN execution_phase IN ('expire','expire_incentive') THEN credits_delta ELSE 0 END), 0)
     FROM credit_transactions WHERE organization_id = :ORG) AS expected;
  ```
- Look for `LEDGER_IMMUTABLE` exceptions in Postgres logs for the affected org.

**Remediation:**
- If the drift is bounded and explainable: insert a compensating ledger entry via an approved `apply_credit_reservation` call with `transaction_type='adjustment'` and a clear `note`.
- Document the entry in the org's [billing forensics timeline](../../pages/api/super-admin/billing-forensics/timeline.ts).

**Escalation (if not resolved in 30 min):**
- Page Finance Admin + Eng Lead.
- Freeze remains in place until resolution.

---

## Scenario 2 — Mass duplicate-block alerts

**Signal:** `queue_replay_blocked_total` and `duplicate_prevention_hits_total` spike. PagerDuty page if > 1000/min.

**First 5 minutes:**
1. This is OFTEN a healthy signal — the system is blocking real replays from a misbehaving queue.
2. Check Bull MQ dashboard for retry storms.
3. Sample 5 recent rows from `job_execution_registry` for the affected queue:
   ```sql
   SELECT job_id, queue_name, retry_count, first_seen_at, last_seen_at, status
   FROM job_execution_registry
   WHERE queue_name = '<queue>' AND last_seen_at > now() - interval '15 min'
   ORDER BY retry_count DESC LIMIT 5;
   ```
4. **If `retry_count > 10` with sane `first_seen_at`** → real bug in Bull state, possibly a worker crash loop. Investigate worker logs.

**Investigation:**
- Check worker pool health: are workers crashing?
- Check Redis (Bull's storage): are jobs being re-enqueued unexpectedly?
- Check for app-side retry loops in the queue's executor.

**Remediation:**
- If worker is crash-looping: stop the worker, fix the underlying error, restart.
- If a job is poisoned: mark its registry row with `status='duplicate_blocked'` manually so it stops retrying.

**Escalation:** page Eng Lead if worker crash-loop continues > 15 min.

---

## Scenario 3 — Approval pipeline stuck (multiple pending > 24h)

**Signal:** dashboard shows `v_approval_health.oldest_pending_age_s > 86400`. Slack notification, not page.

**First 5 minutes:**
1. Pull pending approvals:
   ```sql
   SELECT id, organization_id, action_type, proposed_by, proposed_at,
          required_approvals, approvals_received
   FROM credit_action_approvals
   WHERE status = 'pending' AND proposed_at < now() - interval '24h';
   ```
2. Categorize: are these waiting on a specific approver?
3. Contact relevant approvers via Slack.

**Remediation:**
- Force-expire stale approvals: `expirePendingApprovals()` is the daily cron; you can manually invoke.
- For high-priority approvals: directly notify a different FINANCE_APPROVER.
- Proposer can cancel via `POST /api/admin/credits/approvals/cancel`.

**Escalation:** if a payment-blocking approval is stuck → page Finance Admin.

---

## Scenario 4 — Untracked AI calls spike (enforcement mode)

**Signal:** `untracked_ai_call_blocked_total` increments with severity=`critical`. PagerDuty page when threshold > 100/min.

**First 5 minutes:**
1. Identify the operation: dashboard `aiBilling.countersFromMemory`.
2. **Quick fix:** add the operation to `credit_untracked_actions` as a temporary entry:
   ```sql
   INSERT INTO credit_untracked_actions (action_key, reason, approved_by, expires_at, metadata)
   VALUES ('<operation-name>', 'Emergency exemption — pending review', '<your-uuid>', now() + interval '24 hours',
     jsonb_build_object('category', 'internal_tool', 'owner_user_id', '<your-uuid>', 'emergency', true));
   ```
3. Alert fires for emergency entries — Finance Admin reviews next business day.

**Investigation:**
- Why was this operation not registered? Likely a new code path that didn't hit the CI guard.
- Run the CI guard to confirm: `npx tsx scripts/audit/no-direct-credit-deductions.ts` — should fail STRICT mode.

**Remediation:**
- If legitimate non-billable → add to `STATIC_NON_BILLABLE_AI_SCOPE_RULES` in code.
- If billable → migrate the call site to `runBilledAiCompletion`.

**Escalation:** page Eng Lead if > 1000/min sustained.

---

## Scenario 5 — Customer reports unexpected charge

**Signal:** support ticket. NOT an automated alert.

**First 5 minutes:**
1. Pull customer's ledger for the past 7 days:
   ```sql
   SELECT created_at, execution_phase, credits_delta, reference_type, note, idempotency_key
   FROM credit_transactions
   WHERE organization_id = '<customer-org>'
     AND created_at > now() - interval '7 days'
     AND execution_phase = 'confirm'
   ORDER BY created_at DESC;
   ```
2. Use [billing-forensics/trace](../../pages/api/super-admin/billing-forensics/trace.ts) for any disputed entry — get the full lineage.

**Investigation:**
- Verify the action that triggered the charge (`reference_type` + `reference_id`).
- Check `admin_financial_audit_events` for relevant audits.
- Cross-reference against customer's `usage_events` if applicable.

**Remediation:**
- If charge is legitimate: explain to customer with the trace.
- If charge is in error: propose a compensating adjustment via the approval flow. For amounts ≤ threshold, single super-admin can grant; above threshold → 2-of-2 approval.

**Escalation:** customer threatens chargeback → escalate to Finance Admin within 1 hour.

---

## Scenario 6 — Reservation orphans climb

**Signal:** `reservation_expiry_total` counter incrementing without proportional reaper releases. Slack notification.

**First 5 minutes:**
1. Run reaper manually:
   ```sh
   curl -X POST "$BASE/api/cron/credit-orphan-hold-reap" -H "Authorization: Bearer $CRON_SECRET"
   ```
2. If reaper completes successfully → orphans are reaped; alert subsides.
3. If reaper fails → investigate reaper logs.

**Investigation:**
- Check `idx_credit_tx_parent_phase` index health.
- Confirm `apply_credit_reservation` RPC accepts `phase='release'` with correct args.
- Verify no app code is creating HOLDs without proper sibling CONFIRM/RELEASE.

**Remediation:**
- If a specific worker is the source: investigate that worker's error handling.
- If a code regression: roll back the offending deploy.

**Escalation:** if orphans grow > 100 in 1 hour → page Eng Lead.

---

## Scenario 7 — Self-sign attempt detected

**Signal:** `approval_self_signature_blocks` increments. Slack alert.

**First 5 minutes:**
1. Identify the actor:
   ```sql
   SELECT actor_user_id, action_type, created_at, metadata
   FROM super_admin_audit_logs
   WHERE action = 'ADMIN_CREDITS_APPROVAL_SIGN' AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC;
   ```
2. Look for the failure with `code: 'SELF_SIGN_BLOCKED'` in logs.

**Investigation:**
- This is a governance event, not a system failure.
- The DB function correctly blocked the self-sign.
- Determine: was this an accidental click, or an attempted policy violation?

**Remediation:**
- If accidental: notify the actor that their approval cannot be self-signed; another approver must sign.
- If intentional: escalate to security per the org's insider-threat policy.

**Escalation:** repeated self-sign attempts by the same actor → page Security Lead.

---

## Scenario 8 — Payment fulfillment stuck

**Signal:** `monetization_operational_events` shows events stuck in `recorded` for > 30 min. Slack alert.

**First 5 minutes:**
1. Identify stuck events:
   ```sql
   SELECT pe.provider_event_id, pe.event_type, pe.received_at, st.processing_status, st.error_message
   FROM payment_provider_events pe
   JOIN payment_provider_event_state st ON st.provider_event_pk = pe.id
   WHERE st.processing_status IN ('recorded', 'requeued')
     AND st.updated_at < now() - interval '30 min'
   ORDER BY pe.received_at;
   ```
2. For each stuck event, manually advance:
   ```sql
   SELECT advance_payment_provider_event_state('<event-id>', 'processed', NULL);
   ```

**Investigation:**
- Check Razorpay (or future Stripe) API health.
- Check signature verification logs for that event.

**Remediation:**
- Manually advance state.
- If a webhook handler bug → patch + redeploy.

**Escalation:** if customer paid but no credit granted → Finance Admin within 1 hour.

---

## Scenario 9 — Mass billing system failure (worst case)

**Signal:** multiple PagerDuty pages fire simultaneously. Customer reports widespread.

**First 5 minutes:**
1. **Execute platform kill switch:**
   ```sh
   # Disables ALL billing flags
   curl -X POST "$BASE/api/super-admin/billing/kill-switch" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"reason": "<incident description>", "actorUserId": "<your-uuid>"}'
   ```
   This calls `executePlatformKillSwitch` which disables every billing flag platform-wide.
2. Unset `BILLING_REQUIRE_AI_HANDLE` env (if set) and restart workers.
3. Page Eng Lead + Finance Admin + Security Lead simultaneously.
4. Open #incident-billing in Slack.

**Investigation:**
- Determine scope: how many orgs affected, what behavior is wrong.
- Pull recent deploys + flag changes from `super_admin_audit_logs` for the last 24 hours.

**Remediation:**
- The kill switch puts the system in shadow mode — no enforcement, no novel charging. Wallet state is preserved.
- Roll back the most recent code or flag change.
- Resume normal rollout once root cause is fixed.

**Escalation:** treat as a sev-1 production incident.

---

## Escalation Ownership

| Role | When to page | Contact |
|---|---|---|
| On-call Engineer (primary) | Any alert fires | PagerDuty primary |
| Engineering Lead | Crash loops, deploys, code regressions | PagerDuty + Slack DM |
| Finance Admin | Drift, customer billing complaints, refunds | Slack DM (business hours) / PagerDuty (after hours) |
| Customer Success Lead | Multiple customer tickets | Slack #customer-success |
| Security Lead | Self-sign attempts, suspicious admin actions | PagerDuty security rotation |
| DBA | Postgres-level issues, lock contention | PagerDuty DB rotation |

---

## Post-incident review

Every billing incident requires a post-mortem within 48 hours:

| Section | Details |
|---|---|
| Timeline | When did the signal fire? What was done at each minute? |
| Root cause | Code regression? Config drift? External dependency? |
| Customer impact | How many customers, how much money, what was visible? |
| Remediation | What did we do? Did it work? |
| Prevention | What guardrail would have caught this earlier? |
| Action items | Ticket each prevention item; assign owner |

Templates: see `docs/audit/incident-template.md` (operator-owned).

---

## Monitoring cadence reference (post-GA)

| Cadence | Action |
|---|---|
| Continuously | Anomaly alerts → PagerDuty / Slack routing |
| Every 15 min | Reservation reconciliation cron |
| Hourly | Orphan-hold reaper, orphan-usage scan |
| Daily | Integrity audit, expiry, drift reconciliation |
| Weekly | Customer Success reviews ticket trend |
| Monthly | Finance reviews approval velocity + adjustment volume |
| Quarterly | Non-billable registry review (expire stale entries) |
| Annually | Approval threshold ladder review |

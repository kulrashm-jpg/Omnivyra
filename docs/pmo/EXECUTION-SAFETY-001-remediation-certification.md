# EXECUTION-SAFETY-001 — ES-001

## R2/R4 Critical Safety Remediation & Production-Authorization Recovery

**Roles:** Principal Security Architect · Staff Backend Engineer · AI Safety Architect · Platform
Governance Lead · Independent Production Safety Authority.
**Type:** Production-safety remediation — eliminate the five verified execution-safety defects. No
features, no rollout change, **no execution enabled**, no deploy.
**Question:** Are the five R2/R4 execution-safety findings demonstrably eliminated, with permanent
regression protection, zero drift, and default-OFF preserved?

---

## 0. Certification Decision

# ✅ SAFETY REMEDIATION CERTIFIED

All five findings are eliminated with reuse-first, additive, flag-dark changes; a permanent regression
suite guards each; backend-TS certification is green (net-new 0); the execution path remains
structurally default-OFF and dry-run. **No execution was enabled, no live email, no deploy, no flag
flip.**

| Finding | Before | After | Guarded by |
|---|---|---|---|
| **M-1** approval caller-asserted | `approved: b.approved === true` from body | **server-owned** — bridge reads `execution_approvals`; client input ignored | 7 approval tests |
| **M-2** kill-switch fail-open | `.find` company-blind, first-match | **most-restrictive**, company-isolated, emergency-stop unmaskable | 10 control tests |
| **m-1** `release` no RBAC | any member un-suppresses | capability-gated + tenant-scoped + audited | RBAC tests |
| **m-2** `campaign.override` unbound | no role holds it | `operator` role holds it; centralized resolution | RBAC tests |
| **m-3** audit swallows errors | silent loss | retried + DB error metric + alertable telemetry, correlation id preserved | 2 audit tests |

**Regression suite: 23 new assertions (executionSafety.test.ts) + 6 existing = 29/29 green.**
**Backend-TS certification: PASS (net-new 0).** Other lead-intelligence suites: 18/18 green.

---

## 1. ES-101 — Approval Authority Certification — ✅

**Trust boundary eliminated.** Approval no longer originates from the client anywhere:
- New authoritative store `execution_approvals` (migration `20260727040000`, additive/idempotent/RLS
  service-role) — the ONE approval source, keyed `(company_id, campaign_id, version)`.
- `executionApprovalService` with a **pure decision core** `evaluateApproval(row, ctx)`:
  authorizes **only** when the row is present, company-matched, campaign-matched, **version-bound**,
  `active`, non-revoked, and non-expired (TTL). Any miss → **fail closed**.
- `executionBridge.dispatchGuarded` **removed the `approved` request field** and now calls
  `getApprovalDecision(companyId, campaignId, version)`; version = the dispatched message id.
- API: approval enters state **only** via the new `approve` / `revoke_approval` actions, both requiring
  `campaign.approve`; `dispatch_dry_run` no longer accepts `approved`.

Requirements met: client-supplied approval ignored ✓ · persisted approval required ✓ · approver identity
recorded (`approved_by`, gated by `campaign.approve`) ✓ · bound to campaign/version ✓ · timestamp
validated (`approval_timestamp_invalid`) ✓ · revocation respected (`approval_revoked`) ✓ · missing →
fail closed ✓.

## 2. ES-102 — Execution Control Certification — ✅

**Kill-switch re-architected** to a pure, deterministic, most-restrictive evaluation
`evaluateControls(rows, ctx)`:
- **Company isolation** via `controlApplies()` — tenant rows must be owned by this company; campaign /
  connector rows must match id AND be owned by this company OR `__global__`; other companies' rows are
  ignored.
- **Emergency stop is never maskable** — ANY applicable row with `emergency_stop` disables, evaluated
  before any enable check.
- **Most-restrictive wins** — after the global-enabled gate, ANY applicable `enabled=false` layer
  disables.
- **Deterministic precedence:** env-off → emergency-stop → global-enabled → any-disabled → enabled.

The R2 M-2 fail-open (a `__global__`-enabled connector row masking a tenant connector `emergency_stop`)
is closed and **explicitly regression-tested** ("CROSS-COMPANY MASKING PROHIBITED").

## 3. ES-103 — Release RBAC Certification — ✅

`release` (un-suppress) now: requires `campaign.override` (fail-closed 403 + denial telemetry),
runs after `enforceCompanyAccess` (tenant ownership), and records an `execution_audit` row
(`stage:suppression, decision:cancelled, reason:suppression_released`). Adding suppression stays open
(safe direction); removing it is protected.

## 4. ES-104 — Override Authorization Certification — ✅

- `campaign.override` is now **bound centrally** to a dedicated `operator` role in `ROLE_CAPABILITIES`
  (no implicit override).
- **Authorization is centralized** in `resolveExecutionCapabilities(user)` — capabilities are derived
  **server-side** from the platform user context (admin → operator+approver), never read from the
  client. Conservative + default-deny: **no role is granted `campaign.execute`** by this mapping — the
  executor grant remains an explicit operator decision (M5-D), so the default-OFF posture is never
  widened implicitly.
- `set_control` / `kill_switch` require `campaign.override`, **audit** every action, and every denial
  emits `execution.authorization.denied` telemetry.

## 5. ES-105 — Audit Reliability Certification — ✅

`recordExecutionAudit` no longer swallows failures. `persistAudit` **retries once**; on failure it emits
a HARDEN-001 DB error metric (`recordDb({table:'execution_audit', error:true})`) **and** an alertable
`execution.audit.write_failed` telemetry event **with the correlation id preserved**. Audit loss can
never be silent. Verified by tests (success emits stage event only; failure retries + surfaces metric +
event with correlation id).

## 6. ES-106 — Safety Regression Test Report — ✅ 29/29

`backend/tests/unit/executionSafety.test.ts` (new) + `executionGuards.test.ts` (existing):
- **Approval (7):** valid; forged/absent; revoked (×2); expired; cross-tenant; campaign/version
  mismatch; invalid timestamp.
- **Kill-switch (10):** env-off; no-global; global-on; tenant/connector/campaign/global stop;
  cross-company masking prohibited; other-company isolation; most-restrictive disabled layer.
- **RBAC (4):** admin→operator+approver (not execute); member escalation blocked; unauth→auditor;
  operator holds override.
- **Audit (2):** success path; failure observability (retry + metric + telemetry + correlation id).

## 7. ES-107 — Architecture Validation Report — ✅ zero drift

- **Reuse:** `ownedDbTable` (write seam), `trackEvent` (telemetry), `recordDb` (HARDEN-001 metrics),
  the existing capability model — all reused; no new platform.
- **No duplication:** ONE approval authority (`executionApprovalService`), ONE control evaluator, ONE
  suppression platform, ONE bridge/dispatch path, ONE capability map. Approval and control logic each
  live in exactly one pure function.
- **No new dispatch path / queue / scorer / telemetry registry.** New telemetry ids
  (`execution.authorization.denied`, `execution.audit.write_failed`) are covered by the existing
  `execution.${string}` template — no type or registry change.
- **API surface:** additive actions (`approve`, `revoke_approval`) + tightened authorization on existing
  ones; the only removal is the *client `approved` trust* (a safety requirement). No response contract
  broken.
- **Backend-TS certification: PASS**, net-new 0.

---

## 8. Outstanding / follow-up (non-blocking)

- **Executor binding (M5-D):** by design no role is auto-granted `campaign.execute`; the API dispatch
  path is default-denied until an operator explicitly binds an executor. Intentional and safe.
- **Migration apply:** `20260727040000_execution_approvals.sql` is additive/idempotent; apply through
  the controlled process at R3 (never `db push`).
- These fixes land on the W5.1 branch (top of the stack); the R3 squash carries them into the baseline.

---

## 9. Certification Statement

The five R2/R4 execution-safety findings are eliminated: approval is now server-owned and
version-bound (client input ignored, fail-closed), the kill-switch evaluates the most-restrictive layer
with company isolation and an unmaskable emergency stop, suppression release and campaign override are
capability-gated and audited with denial telemetry, and audit loss is retried and surfaced via metrics
and alertable telemetry. The changes reuse the existing architecture with zero drift, add permanent
regression protection (29/29), pass backend-TS certification (net-new 0), and keep execution
**structurally default-OFF and dry-run**.

**Decision: ✅ SAFETY REMEDIATION CERTIFIED.** This does **not** authorize deployment or live execution
— it restores the engineering baseline so operators may resume the release process (return to R3A once
operator prerequisites are met; then R4). No merge, no deploy, no flag flip, no send.

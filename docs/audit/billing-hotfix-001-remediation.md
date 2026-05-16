# Billing HOTFIX-001 Remediation Report

**Date:** 2026-05-16 · **Target:** production Supabase `klkiseupptzbecbxwrky`
**Scope:** runtime defect fix + financial-action UX/API stabilization.
No architecture redesign.

---

## 1. Root cause summary

Every admin grant/revoke failed with:

```
42P10: there is no unique or exclusion constraint matching the
       ON CONFLICT specification
```

`creditApprovalService.proposeApproval()` upserts the proposal with
`ON CONFLICT (client_request_id)` (no predicate). Migration `20260663`
created `idx_caa_client_request_unique` as a **partial** unique index
(`WHERE client_request_id IS NOT NULL`). PostgreSQL cannot use a partial
index as the arbiter for a bare `ON CONFLICT (client_request_id)` →
42P10 → the proposal fails before any write. The console's "Submitting…"
showed the raw error with no terminal state.

## 2. Hotfix applied

`docs/audit/billing-hotfix-001-caa-client-request-index.sql`, applied to
production after a 0-duplicate safety check:

- `PRE`: `… (client_request_id) WHERE (client_request_id IS NOT NULL)` (partial)
- `POST`: `… (client_request_id)` (non-partial unique)

NULLs remain distinct in a unique index, so unlimited
null-`client_request_id` rows are still allowed — semantically identical
to the old partial index for this use case, but now a valid
`ON CONFLICT (client_request_id)` arbiter. No data modified, no table
recreated, replay/idempotency guarantees preserved. Source migration
`20260663` corrected for future environments.

## 3. Constraint verification

- Pre-apply: 0 duplicate non-null `client_request_id` groups (safe to
  build a non-partial unique index).
- Post-apply: `pg_indexes` confirms the index is non-partial unique.
- Behavioural proof (transactional dry-run, rolled back): before =
  42P10; after = upsert succeeds and is idempotent (2 upserts → 1 row);
  multiple null-`client_request_id` inserts still allowed.

## 4. Approval-flow validation

`scripts/audit/validate-billing-live.ts` (production-safe — all RPC/
trigger/guard exercises run in one transaction that ROLLS BACK):

**26/26 checks PASS**, including the new regression check
`proposeApproval ON CONFLICT(client_request_id) upsert works` (the exact
gap that escaped earlier validation — now permanently covered).

Validated: threshold routing (`admin_grant` 100→1 auto-approve;
≥5000→2 ⇒ pending; `admin_refund` 0→2 SoD), signature progression
pending→approved, rejection path, self-sign block, signature
immutability, approval-frozen-after-execute, job-registry replay +
monotonic guard, billing_operations no-delete, export-manifest
immutability, FX identity/null. The authenticated HTTP/UI leg
(grant <5000 auto-applies; ≥5000 → 202 pending; sign endpoint; revoke)
remains operator-driven (no auth session in-harness) — DB-layer logic is
proven.

## 5. UX states added (Phase C/F)

`CreditActionsPanel` now renders one explicit **terminal** state per
action with `role="status"`/`aria-live`:

- **success** — "Credits granted/revoked successfully", "Billing
  frozen/unfrozen successfully" (+ server `message`).
- **info** — "Awaiting approval signatures" (approvalId + required
  signatures) on 202.
- **failure** — actionable title (e.g. "Grant failed — approval
  constraint error"), `actionableMessage`, retry guidance (retryable vs
  needs-remediation), `correlationId` + `errorCode` (monospace),
  Dismiss control.

## 6. Loading-state fixes (Phase D)

`submit()` wraps the request in an `AbortController` with a 30 s
timeout. The spinner now exits on **success, failure, timeout, or
abort** (`clearTimeout` + `setSubmitting(false)` in `finally`). A timed-
out action reaches an explicit "Request timed out" terminal state
advising the operator to check the Ledger/Approval queue before
retrying. No infinite "Submitting…", no unresolved promise, no silent
failure.

## 7. API normalization changes (Phase E)

New `backend/services/billing/billingApiResponse.ts` — `billingOk` /
`billingFail` / `classifyBillingError`. Wired into
`/api/admin/credits/{grant,revoke,freeze,unfreeze}` terminal responses.

- **Additive**: legacy keys (`ok`, `error`, `code`, prior data fields)
  preserved → zero consumer breakage.
- **Success** adds: `success`, `status`, `message`, `operationId`,
  `correlationId`.
- **Failure** adds: `success:false`, `errorCode`, `retryable`,
  `actionableMessage`, `correlationId`, `status:'failed'`.
- `classifyBillingError` maps 42P10 → `APPROVAL_CONSTRAINT`
  (non-retryable, hotfix-001 actionable), schema-cache →
  `SCHEMA_NOT_READY`, in-progress idempotency → `REPLAY_BLOCKED`,
  ledger → retryable, etc.

## 8. Test results

- `backend/tests/unit/billingApiResponse.test.ts` — **13/13** (classify
  matrix, correlationId presence, legacy preservation, 42P10 →
  APPROVAL_CONSTRAINT, override precedence).
- `backend/tests/unit/billingSchemaVerification.test.ts` — 22/22.
- `scripts/audit/validate-billing-live.ts` — **26/26** (incl. the new
  ON CONFLICT(client_request_id) regression check).
- Combined unit run: **35/35 pass**.

## 9. Known pre-existing (out of scope)

`tsc --noEmit` reports type-narrowing errors on **pre-existing,
unmodified** property accesses in `grant.ts`/`revoke.ts`
(`proposal.message`, `revokeResult.reason` — discriminated-union
narrowing the repo already did not satisfy; identical access pre/post
this change). New code (`billingApiResponse.ts`, `CreditActionsPanel`)
is type-clean. These were not introduced here and refactoring unrelated
handler typing is out of this hotfix's scope; flagged for a separate
typing pass. The repo-wide migration-ledger desync remains separately
tracked and does not affect billing.

## 10. Final operational status

| Criterion | Status |
|---|---|
| `validate-billing-live.ts` → 26/26 | ✅ |
| Grant flow works end-to-end (DB layer) | ✅ (hotfix applied; HTTP/UI = operator smoke) |
| Approval flow works end-to-end (DB layer) | ✅ |
| No infinite "Submitting…" | ✅ (AbortController + finally) |
| All billing actions show terminal states | ✅ (success/info/failure) |
| All financial ops expose correlation IDs | ✅ (success + failure responses + UI) |

**Status: HOTFIX-001 CLOSED.** Billing grant/revoke/approval is
functional on production. Recommended operator confirmation: in the
console, grant <5000 (auto-applies), grant ≥5000 (→ "Awaiting approval
signatures"), sign with a second super-admin, revoke — each must show a
terminal state and a correlationId, with no infinite spinner.
Certification verdict moves from "HOLD for grant/revoke" to
**READY FOR LIMITED GA** (full GA after that in-app smoke).

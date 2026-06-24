# CREDIT_CONSUMPTION_FLOW_MAP.md

Every credit deduction path, the balance/ordering logic, and where the consumption-order policy
lands. Audit only; evidence with file references.

## Deduction flow map

| Path | File | Function | Route / trigger |
|---|---|---|---|
| HTTP routes (Phase 2, ~20) | `backend/services/billing/phase2RouteWiring.ts` | `wirePhase2Route()` | e.g. `/api/recommendations/generate`, `/api/admin/blog/generate`, `/api/bolt/campaign-chat`, `/api/planner/skeleton-command`, … |
| Direct HTTP | `pages/api/planner/generate-workspace-content.ts` | `executeWithCredits()` | endpoint |
| Direct HTTP | `pages/api/activity-workspace/content.ts` | `executeWithCredits()` | endpoint |
| Queue processors (4) | `backend/queue/jobProcessors/{boltContentJob,campaignPlanning,contentGeneration,creatorContent}Processor.ts` | `executeWithEntryConsumption()` | job entry |
| Core (fixed-fee) | `backend/services/creditExecutionService.ts` | `executeWithCredits()` | HOLD→EXECUTE→CONFIRM/RELEASE |
| Core (token-metered, dark) | `creditExecutionService.ts` | `executeWithEntryConsumption()` | entry-consume + exposure-hold |
| Reservation (long work) | `creditExecutionService.ts` | `reserveCreditsForWork` / `confirmCreditReservation` / `releaseCreditReservation` / `confirmCreditReservationToActual` | handle-based |
| DB authority (RPC) | `backend/repositories/creditExecutionRepository.ts` | `callCreditReservation` / `callCreditPartialConfirm` | RPC `apply_credit_reservation` / `apply_credit_partial_confirm` (`supabase/migrations/20260323_remove_balance_credits.sql`) |

All paths converge on the **single authority** `creditExecutionService` → RPC. No bypasses.

## Balance calculation
- `backend/services/creditPriorityService.ts`
  - `getWalletSnapshot(orgId)` — reads `organization_credits` (`*_balance`, `reserved_*`).
  - `computeAvailable(wallet)` — `available[cat] = max(0, balance[cat] − reserved[cat])`.
  - `getTotalAvailable(orgId)` — `free + incentive + paid`.
- Checked pre-HOLD by `creditExecutionService.resolveDeduction()` (calls `getTotalAvailable`).

## Consumption ordering (the policy-relevant part)
- `creditPriorityService.computeSplit()` is **hardcoded**: **free → incentive → paid**.
- Subscription credits = `free`; top-up credits = `paid`. Therefore:
  - **Subscription credits are consumed FIRST.**
  - **Top-up credits are consumed LAST.**
  - (`incentive` — promo grants — sits between; it is not part of the stated policy but does not violate "subscription before top-up".)
- **Deterministic:** pure category-bucket arithmetic; same wallet + amount ⇒ same split. No time/UUID/source tiebreak. `scaleSplitToActual()` (token settle) is also pure math.
- **Idempotent:** unique index on `credit_transactions.idempotency_key` (`20260321_credit_ledger_hardening.sql`).

## Answers
- **Where is balance calculated?** `creditPriorityService.getWalletSnapshot`/`computeAvailable`/`getTotalAvailable`.
- **Where is deduction performed?** `creditExecutionService.executeWithCredits`/`executeWithEntryConsumption` → `creditExecutionRepository.callCreditReservation` → RPC `apply_credit_reservation`.
- **Does deduction prioritize subscription vs top-up?** **YES** — by category bucket order free→incentive→paid (subscription=free first, top-up=paid last). There is **no per-purchase/FIFO-by-date** ordering; the category bucket is the ordering unit.
- **Deterministic?** **YES.**

## Policy alignment
**Policy item 3 (subscription first, top-up second) is ALREADY ENFORCED** by `computeSplit`'s
free→incentive→paid order. No change required for ordering. The remaining policy items
(top-up locking, subscription-credit expiry) are about *availability*, not ordering — see the
gap analysis.

Audit only.

# Implementation Report: Opportunity Radar → Campaign Planner Gap Fixes

## Overview

Resolves the missing links identified in the verification audit so the Opportunity → Planner feedback loop functions correctly.

---

## PART 1 — StrategyAssistantPanel Props Fix

**File:** `components/planner/StrategyAssistantPanel.tsx`

**Change:** Added `campaignId` and `onOpportunityApplied` to the destructured props.

**Result:** "Apply to Campaign" button appears when `campaignId` is passed; applying an opportunity triggers the callback.

---

## PART 2 — Opportunity Radar API Filter

**Files:**
- `pages/api/engagement/opportunity-radar.ts` — reads `opportunity_type` query param, passes to service
- `backend/services/opportunityRadarService.ts` — added `opportunityType` option; filters by `opportunity_type` when provided

**Usage:** `GET /api/engagement/opportunity-radar?organization_id=X&opportunity_type=buyer_intent`

---

## PART 3 — Mount StrategyAssistantPanel in Campaign Planner

**Files:**
- `pages/campaign-planner.tsx` — Added StrategyAssistantPanel to calendar step with two-column layout; passes `companyId`, `campaignId`, `onOpportunityApplied`, `onGeneratePlan`
- `components/planner/CalendarPlannerStep.tsx` — Added `refreshTrigger` prop; refetches plan when it changes

**Flow:** When user applies an opportunity, `onOpportunityApplied` increments `planRefreshTrigger`, causing CalendarPlannerStep to refetch the plan from `retrieve-plan` API.

---

## PART 4 — Observability Error Tracking

**Files:**
- `database/opportunity_engine_errors.sql` — New table: `id`, `organization_id`, `error_message`, `stack_trace`, `occurred_at`
- `backend/jobs/engagementOpportunityScanner.ts` — Added `persistScannerError()`; persists errors on signals fetch failure, detection engine failure, and insert failures (except 23505 duplicates)

---

## PART 5 — Health Endpoint Update

**File:** `pages/api/admin/opportunity-engine-health.ts`

**Change:** `processing_errors` now returns errors from `opportunity_engine_errors` table (last hour, limit 50), formatted as `"timestamp: message"`.

---

## Database Migration

Run `database/opportunity_engine_errors.sql` in Supabase SQL Editor.

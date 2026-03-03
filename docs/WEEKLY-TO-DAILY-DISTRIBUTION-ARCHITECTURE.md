# Weekly → Daily Architecture & Distribution Design

**Status:** Architecture only. No schema changes. No implementation.

This document defines a **safe** architecture for Weekly → Daily distribution that works with the current workspace resolver and dual data sources (blueprint execution items + `daily_content_plans`).

---

## 1️⃣ Proposed Unified Execution Model (Adapter Only)

**Purpose:** A single in-memory / adapter interface so that calendar, activity workspace, and distribution logic all work against one shape. **No DB or blueprint schema changes.**

### Interface: `UnifiedExecutionUnit`

```ts
/**
 * Adapter-only type. Used when:
 * - Loading daily plan for calendar
 * - Feeding distribution engine input/output
 * - Resolving activity workspace payload (via existing resolver + this shape for display)
 * Not persisted as-is; mapped from blueprint items or daily_content_plans.
 */
interface UnifiedExecutionUnit {
  /** Stable ID. Workspace resolve uses campaignId + execution_id. Must not change after first assign. */
  execution_id: string;
  campaign_id: string;
  week_number: number;
  /** Day of week (e.g. "Monday"). Required for calendar grouping and distribution output. */
  day?: string;

  /** Display and workspace title. */
  title: string;
  description?: string;

  platform: string;
  content_type?: string;

  /** Ownership / interaction hint (AI_AUTOMATED | CREATOR_REQUIRED | CONDITIONAL_AI). */
  execution_mode?: string;
  /** One-line creator brief when execution_mode is creator-heavy. */
  creator_instruction?: Record<string, unknown>;

  /** Week-level passthrough for UI/reasoning (e.g. "STAGGERED", "ALL_AT_ONCE"). */
  distribution_strategy?: string;

  /** Where this unit came from: blueprint path vs legacy daily row. */
  source_type: "BLUEPRINT_EXECUTION" | "DAILY_PLAN_ROW";

  // Optional but needed for calendar/workspace
  scheduled_time?: string;
  topic?: string;
  /** When source is DAILY_PLAN_ROW, link back to daily_content_plans.id for save/move. */
  daily_plan_id?: string;
  /** Preserve for workspace and content pipeline. */
  master_content_id?: string;
  writer_content_brief?: Record<string, unknown>;
  intent?: Record<string, unknown>;
}
```

**Fields used by:**

| Consumer              | Fields used                                                                 |
|---------------------------------------------------------------------------------------|
| Daily calendar render | execution_id, week_number, day, title, platform, content_type, execution_mode, scheduled_time |
| Activity workspace   | execution_id, campaign_id, title, description, platform, content_type, execution_mode, creator_instruction, writer_content_brief, intent, master_content_id |
| Distribution logic   | execution_id, week_number, day (output), platform, content_type, distribution_strategy (input), source_type |

---

## 2️⃣ Mapping Rules (Blueprint ↔ Daily)

### A. Blueprint execution item → `UnifiedExecutionUnit`

**Sources:** `week.daily_execution_items` or `week.execution_items` or `week.resolved_postings` (current code uses `daily_execution_items` built from `resolved_postings`).

| UnifiedExecutionUnit field | Source | Rule |
|----------------------------|--------|------|
| execution_id               | item.execution_id ?? item.id | Required. Never invent; use as-is. |
| campaign_id                 | From context (campaign) | Passed when building adapter. |
| week_number                | week.week_number ?? week.week | From parent week. |
| day                        | item.day | Use if present; otherwise leave undefined (distribution will assign). |
| title                      | item.writer_content_brief?.topicTitle ?? item.topic ?? item.title | First non-empty. |
| description                | item.writer_content_brief?.writingIntent ?? item.description | Optional. |
| platform                   | item.platform | Normalize to lowercase. |
| content_type               | item.content_type | Normalize to lowercase. |
| execution_mode             | item.execution_mode | Pass through (source of truth from enrichment). |
| creator_instruction       | item.creator_instruction | Pass through object. |
| distribution_strategy     | week.distribution_strategy | From parent week. |
| source_type                | — | Always `"BLUEPRINT_EXECUTION"`. |
| scheduled_time             | item.scheduled_time | Optional. |
| topic                      | item.topic ?? item.title | Optional. |
| master_content_id          | item.master_content_id | Optional. |
| writer_content_brief      | item.writer_content_brief | Optional. |
| intent                     | item.intent | Optional. |
| daily_plan_id              | — | Omit (not from daily_content_plans). |

**Rule:** If `execution_id` is missing on the item, do **not** fabricate one in the adapter for blueprint-sourced items; the pipeline that produces blueprint items must assign stable IDs (current pattern: `wk${week}-exec-${postingOrder}`). Adapter only passes through.

### B. `daily_content_plans` row → `UnifiedExecutionUnit`

**Source:** One row from `daily_content_plans` (or the shape returned by `GET /api/campaigns/daily-plans` after transform).

| UnifiedExecutionUnit field | Source | Rule |
|----------------------------|--------|------|
| execution_id               | plan.id (UUID) or plan.dailyObject?.execution_id | Prefer existing execution_id if stored (e.g. in content/dailyObject); else use plan.id so workspace can resolve by id. |
| campaign_id                | plan.campaign_id | From row. |
| week_number                | plan.week_number ?? plan.week_number | From row. |
| day                        | plan.dayOfWeek ?? plan.day_of_week | Required for calendar. |
| title                      | plan.title ?? plan.topic ?? plan.dailyObject?.topicTitle | First non-empty. |
| description                | plan.description ?? plan.dailyObject?.writingIntent | Optional. |
| platform                   | plan.platform | Normalize to lowercase. |
| content_type               | plan.contentType ?? plan.content_type ?? plan.dailyObject?.contentType | Normalize. |
| execution_mode             | plan.execution_mode ?? plan.dailyObject?.execution_mode | Optional. |
| creator_instruction        | plan.creator_card ?? plan.dailyObject?.creator_instruction | Optional. |
| distribution_strategy      | plan.distribution_strategy | From API (joined from week). |
| source_type                | — | Always `"DAILY_PLAN_ROW"`. |
| scheduled_time             | plan.scheduledTime ?? plan.scheduled_time | Optional. |
| topic                      | plan.topic ?? plan.dailyObject?.topicTitle | Optional. |
| daily_plan_id              | plan.id | Set so move/save can update this row. |
| master_content_id          | plan.master_content_id ?? plan.dailyObject?.master_content_id | Optional. |
| writer_content_brief      | From plan.dailyObject or build from plan fields | Optional. |
| intent                     | From plan.dailyObject | Optional. |

**Rule:** For legacy rows, `execution_id` used for workspace resolve **must** be the same value the activity-workspace resolve endpoint can find. Today resolve looks **only** in blueprint. So for DAILY_PLAN_ROW to open workspace without blueprint, either: (1) resolve is extended to look up by campaignId + daily_plan_id when source is DAILY_PLAN_ROW, or (2) when we write back from distribution we persist an execution_id into the row (or content JSON) and ensure blueprint or a secondary lookup can resolve it. **Design decision:** Prefer (2): when distribution writes to `daily_content_plans`, it writes a stable `execution_id` (see ID policy below) into the row/content so resolve can be extended once to fall back to daily_content_plans by execution_id. Adapter for legacy rows uses that stored execution_id when present.

---

## 3️⃣ Distribution Engine Placement (Decision + Reason)

**Choice: (C) Runtime adapter when loading daily plan**, with an optional future step to **(D) precompute and persist** for performance.

### Primary: (C) Runtime adapter when loading daily plan

- **Where:** In the code path that serves “daily plan” to the calendar and daily-plan page (e.g. after fetching blueprint weeks or daily_content_plans, before returning to client).
- **What it does:** (1) Build `UnifiedExecutionUnit[]` from blueprint and/or daily_content_plans using the mapping rules above. (2) If week has `distribution_strategy` and units lack `day`, run distribution to **assign** `day` (and optionally `scheduled_time`). (3) Return units (or a view grouped by week/day) to the client. **No persistence** in this phase; distribution is “view-time” so blueprint and DB remain unchanged.

**Why this first:**

| Criterion            | Rationale |
|----------------------|------------|
| **Stability**        | No change to blueprint or daily_content_plans until we explicitly add a “save distribution” step. Existing behavior (no distribution, or day already on items) is unchanged. |
| **Idempotency**      | Same input (same blueprint + same strategy) → same day assignment. No DB writes, so no duplicate rows or overwrites. |
| **Workspace**         | execution_id comes from blueprint or from existing row; we do not invent new IDs at this stage, so existing deep links and resolve keep working. |
| **Performance**       | Acceptable for “load plan” latency; if needed later, we can add (D) and cache results. |

### Future: (D) Precomputed transformation saved to DB

- After (C) is proven, we can add an explicit “Apply distribution” action that (1) runs the same distribution logic, (2) writes results into `daily_content_plans` (or back into blueprint) with stable execution_ids, and (3) marks week as “distribution applied.” Then calendar can read from DB instead of recomputing. **Not part of the initial design;** (C) alone is enough to introduce the adapter and distribution behavior without touching persistence.

**Why not (A) or (B) first:**

- **(A) During blueprint generation:** Would require changing AI/orchestrator pipeline and all callers; riskier and broader. Distribution is a “view” of the same weekly data, so it fits better as a downstream step.
- **(B) During weekly enrichment:** Enrichment already produces `resolved_postings` / `daily_execution_items`; adding distribution there would mix “what to post” with “which day to show it on” and could force execution_id changes if we reorder. Keeping distribution as a separate, optional layer avoids that.

---

## 4️⃣ Execution ID Policy

**Principles:**

1. **One execution_id per logical content slot** (one topic + one platform + one content type in a given week).
2. **Stable across re-runs:** Re-running distribution (same week, same strategy) must not change execution_id; only `day` (and optionally time) may change.
3. **Workspace compatibility:** Resolve uses `campaignId + execution_id`; IDs must be unique per campaign and stable after first assignment.

### Recommended policy

- **Blueprint-sourced items:** Keep existing IDs. Current pattern `wk${weekNo}-exec-${postingOrder}` is already stable per week. **Do not reassign** when distributing; only assign or update `day`.
- **New units created by distribution** (e.g. one weekly topic expanded to multiple platforms):  
  `execution_id = \`wk${week_number}-${topicSlotIndex}-${platform}\``  
  - `topicSlotIndex`: index of the topic/slot in the week (0-based).  
  - `platform`: normalized platform string.  
  - Ensures one ID per (week, slot, platform). Same topic on two platforms → two IDs; re-run → same IDs.
- **Legacy daily_content_plans:** Use `plan.id` (UUID) as execution_id when no execution_id is stored. When we persist from distribution, write back `execution_id` into the row (or content JSON) using the same formula so future loads and resolve see a stable ID.
- **Rearranging days:** Distribution only assigns/updates `day` (and optionally `scheduled_time`). **execution_id never changes** when we move an unit from Monday to Wednesday. So workspace links remain valid.
- **Re-run:** Distribution logic must be deterministic: same `execution_items` + same `distribution_strategy` + same `platform_allocation` → same `day` assignment. IDs are unchanged; only day/time may change. If we later add “save to DB,” we upsert by execution_id to avoid duplicates.

### Edge cases

- **One topic → multiple platforms:** Each (topic slot, platform) gets its own execution_id (e.g. `wk1-0-linkedin`, `wk1-0-instagram`). No sharing of ID across platforms.
- **Prevent breaking links:** Never delete or reuse execution_ids. New slots get new IDs; existing slots keep their ID when day changes.

---

## 5️⃣ Data Ownership Decision

**Choice: (A) Blueprint execution items remain source of truth**, with a clear path to sync to daily_content_plans when we want persistence.

**Meaning:**

- **Read path:** Calendar and daily-plan page prefer blueprint (retrieve-plan / getUnifiedCampaignBlueprint). If blueprint has `daily_execution_items` (or equivalent), use those to build `UnifiedExecutionUnit[]` and apply distribution in memory. Fall back to `daily_content_plans` only when blueprint has no execution items (current behavior).
- **Write path (today):** User edits (e.g. drag-drop day) can continue to hit existing endpoints (e.g. save-week-daily-plan) that write to `daily_content_plans`. Those rows are “derived” from the blueprint view; the blueprint itself is not rewritten by the calendar.
- **Write path (future):** An explicit “Save distribution” could write back to blueprint (e.g. set `day` on each execution item) or to `daily_content_plans` with execution_id and week/day. Either way, **blueprint is still the authority for what exists** (topics, platforms, execution_mode); day/time can live in blueprint or in daily_content_plans as a cached distribution result.

**Tradeoffs:**

| Option | Pros | Cons |
|--------|------|------|
| **(A) Blueprint = truth** | Single source for “what to post”; no split between weekly and daily truth; workspace resolve already blueprint-first. | Day assignment must either live in blueprint (so we’d add/persist `day` on items) or be recomputed at read time (C). |
| (B) daily_content_plans = truth | Fits legacy and DB-centric reporting. | Two sources of truth (weekly vs daily); sync and overwrite risks; workspace today is blueprint-first. |
| (C) Adapter only | No persistence complexity. | Day assignment not persisted; every load recomputes (acceptable for phase 1). |

**Conclusion:** Keep blueprint as source of truth for **content and identity**; treat **day/time** as either (1) stored on blueprint items, or (2) computed at read time by the adapter and later optionally persisted to daily_content_plans for speed. This keeps workspace and weekly cards correct and avoids overwriting user data until we define explicit “save distribution” behavior.

---

## 6️⃣ Compatibility Matrix

| Feature                 | Impacted? | Safe? | Needs Adapter? |
|-------------------------|-----------|--------|----------------|
| campaign-calendar       | Yes       | Yes    | Yes. Calendar consumes UnifiedExecutionUnit[] (or equivalent). Build from blueprint or daily_content_plans via adapter; apply distribution when loading. No schema change. |
| activity-workspace      | No (phase 1) | Yes | No. Resolve still uses campaignId + execution_id and blueprint (and optionally daily_content_plans by execution_id). Adapter does not change IDs. |
| weekly cards            | No        | Yes    | No. Weekly data unchanged. Optional: show distribution_strategy on card. |
| daily plans (page/API)  | Yes       | Yes    | Yes. Daily plan API or the code that feeds the daily-plan page returns a view derived from UnifiedExecutionUnit[] (from blueprint or daily_content_plans + distribution). Existing daily-plans API can stay; add an internal layer that runs adapter + distribution before response. |
| get-weekly-plans        | No        | Yes    | No. Response unchanged. distribution_strategy already exposed. |
| retrieve-plan           | No        | Yes    | No. Weeks and daily_execution_items unchanged. |
| commit-daily-plan       | No (phase 1) | Yes | No. When we add “save distribution,” we may write execution_id and day to daily_content_plans; then commit-daily-plan continues to work with those rows. |

---

## 7️⃣ Risk Mitigation Strategy

| Risk | Mitigation |
|------|------------|
| **execution_id drift** | (1) Never change execution_id when assigning day. (2) New IDs follow the deterministic formula. (3) Resolve and adapter use same source for ID (blueprint item or stored on row). (4) No “regenerate ID” on re-run. |
| **Duplicate daily rows** | (1) Phase 1: no new writes from distribution; no new rows. (2) Future “save distribution”: upsert by (campaign_id, week_number, execution_id) or by execution_id if unique; delete only rows that no longer exist in the distributed set. (3) Prefer “replace week’s daily rows” in one transaction to avoid partial duplicates. |
| **User edits in daily_content_plans** | (1) Distribution runs at read time (C) does not overwrite DB. (2) When adding persist step: only write rows for weeks “distribution applied”; do not overwrite weeks the user has manually edited unless we add an explicit “Re-apply distribution” with confirmation. (3) Optional: store a `distribution_applied_at` or version on week so we can skip overwriting user-edited weeks. |
| **Blueprint vs legacy fallback** | (1) Single adapter interface; both sources map to UnifiedExecutionUnit. (2) Read order: blueprint first, then fallback to daily_content_plans. (3) Same distribution logic for both; only source_type differs. (4) Resolve: first lookup in blueprint by execution_id; if not found and execution_id looks like a UUID, optionally lookup in daily_content_plans by id. |
| **Future repurposing** | (1) UnifiedExecutionUnit stays one platform per unit. (2) Repurposing can be modeled later as a group_id or parent_execution_id linking multiple units (same content, multiple platforms). (3) ID policy already supports one ID per (week, slot, platform); repurposing would add more units with same topic but different platform. No change to this design. |

---

## 8️⃣ Distribution Strategy Rules (Design Only)

**Input (per week):**

- `platform_allocation`: `Record<string, number>` (e.g. linkedin: 3, instagram: 2).
- `frequency_per_platform`: optional; if missing, use platform_allocation as counts.
- `execution_items`: array of units with at least execution_id, platform, content_type; may have topic/title. Already in UnifiedExecutionUnit shape or mappable.
- `distribution_strategy`: string (e.g. `"STAGGERED"`, `"ALL_AT_ONCE"`, `"INTELLIGENT"` or null).

**Output:**

- Same array of execution units with **day** (and optionally **scheduled_time**) assigned. execution_id unchanged.

### STAGGERED

- **Goal:** Spread units across the week; avoid same-day overload.
- **Rule:** Sort units (e.g. by platform, then topic index). Assign days in round-robin or by spreading evenly (e.g. dayIndex = i % 7). Optionally cap per day from platform_allocation so no day has too many posts.
- **Output:** Each unit gets a `day` (e.g. "Monday" … "Sunday"); optional `scheduled_time` per day slot.

### ALL_AT_ONCE

- **Goal:** Same topic across platforms on the same day.
- **Rule:** Group units by topic/slot (e.g. by topicTitle or topicSlotIndex). Assign the same day to all units in the same group (e.g. first group → Monday, second → Tuesday, etc., or spread groups across week).
- **Output:** Each unit gets a `day`; units in the same topic group share that day.

### INTELLIGENT (future)

- **Goal:** Optimize for engagement, capacity, or other signals.
- **Rule:** Adapter-ready: accept same input; use optional hints (e.g. best_day per platform, capacity per day). Algorithm TBD; output shape same (units with day assigned).

### Default

- If `distribution_strategy` is missing or unknown: treat as **STAGGERED** (current structuredPlanScheduler-like behavior) so existing behavior is preserved.

---

## 9️⃣ Recommended Next Implementation Step

1. **Introduce the adapter (read-only)**  
   - Add `UnifiedExecutionUnit` type and two mappers: `blueprintItemToUnifiedExecutionUnit`, `dailyPlanRowToUnifiedExecutionUnit`.  
   - Use them in one place only: the code path that builds the daily plan for the **campaign-daily-plan page** or the **daily-plans API** response.  
   - Output remains the same shape the front end expects (e.g. flat list with week_number, day, execution_id, etc.); internally it’s built via UnifiedExecutionUnit.  
   - No distribution logic yet; day comes from blueprint item or daily_content_plans row as today.  
   - Validates mapping rules and compatibility with calendar and workspace.

2. **Add distribution (in-memory only)**  
   - Implement STAGGERED (and optionally ALL_AT_ONCE) in a pure function: input = week + UnifiedExecutionUnit[] + distribution_strategy, output = same units with `day` (and optional `scheduled_time`) set.  
   - Call it from the same code path when building daily view: if week has execution units without `day` and week has `distribution_strategy`, run distribution and use the result for the response.  
   - Still no DB or blueprint writes.  
   - Verifies ID policy (no new IDs for existing items; new IDs only if we ever create new units in this step).

3. **Optional: Extend activity-workspace resolve**  
   - If we want legacy daily_content_plans rows (with no blueprint) to open workspace: when resolve does not find execution_id in blueprint, try lookup by campaign_id + execution_id in daily_content_plans (e.g. by id or by content->execution_id). Return same payload shape.  
   - Keeps workspace working for both blueprint and legacy.

4. **Later: Persist distribution (optional)**  
   - Add “Save distribution” or “Apply to week” that writes day (and execution_id when missing) to daily_content_plans or back to blueprint, with the risk mitigations above (no overwriting user-edited weeks without confirmation, upsert by execution_id to avoid duplicates).

---

**Document version:** 1.0  
**No schema or existing behavior changed; design only.**

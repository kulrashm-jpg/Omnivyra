# Campaign Calendar Redesign Architecture Proposal

**Date:** 2025-03-12  
**Baseline:** [CAMPAIGN-CALENDAR-SYSTEM-AUDIT-REPORT.md](./CAMPAIGN-CALENDAR-SYSTEM-AUDIT-REPORT.md)  
**Goal:** Scalable architecture for AI-driven calendar creation, recurrence rules, and simplified CMO campaign planning.

---

## 1. CURRENT_STATE

### 1.1 Architecture Summary (from codebase)

| Component | Implementation |
|-----------|----------------|
| **Calendar data source** | Blueprint JSON (`twelve_week_plan.blueprint.weeks[]`) |
| **Activity storage** | `daily_execution_items[]` inside each week (JSONB); no first-class activity table |
| **Fallback** | `daily_content_plans` rows when blueprint has no `daily_execution_items` |
| **Recurrence** | None. Each activity is one-off per week/day. `recurring_posts` exists but is separate. |
| **Workspace identity** | `activity-workspace-${campaignId}-${execution_id}`; sessionStorage key |
| **Activity resolution** | `/api/activity-workspace/resolve` finds item in blueprint by `execution_id` |

### 1.2 Data flow (current)

```
retrieve-plan API
  → twelve_week_plan.blueprint.weeks[].daily_execution_items
  → (or) daily-plans API → daily_content_plans rows
  → Frontend maps to CalendarActivity[]
  → Groups by date, stage; renders tiles
```

### 1.3 Key codebase references

- `pages/campaign-calendar/[id].tsx`: Lines 207–327 — fetches retrieve-plan, fallback to daily-plans
- `backend/services/campaignBlueprintService.ts`: `getUnifiedCampaignBlueprint` — resolves blueprint from twelve_week_plan
- `pages/api/campaigns/generate-weekly-structure.ts`: `generateWeeklyStructure` — builds daily items, inserts into `daily_content_plans`
- `backend/services/campaignAiOrchestrator.ts`: Builds `daily_execution_items` from `resolved_postings`
- `plannerSessionStore.ts`: `posting_frequency: Record<string, number>` — per-platform frequency; no recurrence model

---

## 2. CORE_PROBLEMS

### 2.1 Architectural weaknesses

| Problem | Evidence | Impact |
|---------|----------|--------|
| **Blueprint JSON stores activities** | `twelve_week_plan.blueprint.weeks[].daily_execution_items` (JSONB) | No SQL queries on activities; no indexing by date/platform/status; full blueprint load per campaign |
| **No first-class activity table** | `campaign_activities` does not exist; `daily_content_plans` is content-focused, not activity-first | Cannot efficiently list activities by campaign, date range, or platform; no single canonical row per activity |
| **Two sources of truth** | Blueprint `daily_execution_items` vs `daily_content_plans` | Divergence when daily plan UI saves; resolve API reads blueprint; calendar may show different data |
| **No recurrence model** | Each activity is one-off; no `campaign_activity_rules` | CMO cannot say "LinkedIn post every Wednesday"; must regenerate manually per week |
| **Weak indexing** | No index on blueprint JSONB `execution_id`; `daily_content_plans` has campaign_week, date, execution_id | Resolve walks weeks in memory; calendar cannot filter by date range at DB level |
| **Limited querying** | All activities loaded per campaign; no pagination | Large campaigns (e.g. 12 weeks × 5 posts) = heavy payload; no "activities this month" query |

### 2.2 Why this limits AI calendar automation

- **No declarative rules:** AI can generate a 12-week plan once, but cannot persist "3 posts per week on LinkedIn" as a rule that drives future weeks or campaign extensions. Automation requires re-running AI each time.
- **No incremental generation:** Cannot "add video every Friday" without regenerating the full blueprint or manually editing JSON.
- **Natural language commands impossible:** Commands like "Create LinkedIn post every Wednesday" have no target table or rule engine.
- **Blueprint is write-heavy:** AI output is written as a large JSON blob; partial updates (add one activity) require read-modify-write of the whole blueprint.
- **Execution drift:** Blueprint and `daily_content_plans` can diverge; AI has no single source to learn from or update.

---

## 3. NEW_DATA_MODEL

### 3.1 campaign_activity_rules (proposed) — create first

Declarative recurrence rules; engine generates `campaign_activities` from them.

```sql
CREATE TABLE campaign_activity_rules (
  rule_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform          VARCHAR(50) NOT NULL,
  content_type      VARCHAR(50) NOT NULL,
  frequency_type    VARCHAR(50) NOT NULL,
  day_of_week       VARCHAR(20),
  week_offset       INTEGER DEFAULT 0,
  interval          INTEGER DEFAULT 1,
  posts_per_week    INTEGER,
  start_date        DATE NOT NULL,
  end_date          DATE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_frequency_type CHECK (frequency_type IN (
    'weekly_day',      -- every Wednesday
    'weekly_alternate',-- alternate Friday
    'posts_per_week',  -- 3 posts per week
    'content_rotation' -- video every week, post other days
  ))
);

CREATE INDEX idx_campaign_activity_rules_campaign
  ON campaign_activity_rules(campaign_id);
CREATE INDEX idx_campaign_activity_rules_dates
  ON campaign_activity_rules(campaign_id, start_date, end_date);
```

**frequency_type semantics:**
- `weekly_day`: Fixed day (e.g. every Wednesday); `day_of_week` required
- `weekly_alternate`: Every Nth week on a day; `day_of_week` + `interval` (e.g. every 2nd Friday)
- `posts_per_week`: N posts spread across week; `posts_per_week` required; day chosen by engine
- `content_rotation`: Content type per week slot; `content_type` + `week_offset` (e.g. video every week 1, carousel week 2)

---

### 3.2 campaign_activities (proposed)

First-class activity table; single row per calendar activity. References `campaign_activity_rules` for traceability.

```sql
CREATE TABLE campaign_activities (
  activity_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  week_number       INTEGER NOT NULL,
  day_of_week       VARCHAR(20) NOT NULL,
  scheduled_date    DATE NOT NULL,
  scheduled_time    TIME,
  platform          VARCHAR(50) NOT NULL,
  content_type      VARCHAR(50) NOT NULL,
  topic             TEXT,
  title             VARCHAR(500),
  theme             VARCHAR(255),
  stage             VARCHAR(50),
  execution_mode    VARCHAR(50) DEFAULT 'AI_AUTOMATED',
  status            VARCHAR(50) DEFAULT 'planned',
  workspace_id      TEXT,
  execution_id      TEXT,
  source            VARCHAR(50) DEFAULT 'rule',
  rule_id           UUID REFERENCES campaign_activity_rules(rule_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_status CHECK (status IN ('planned', 'content-created', 'media-ready', 'scheduled', 'published', 'failed', 'cancelled')),
  CONSTRAINT chk_execution_mode CHECK (execution_mode IN ('AI_AUTOMATED', 'CREATOR_REQUIRED', 'CONDITIONAL_AI'))
);

CREATE INDEX idx_campaign_activities_campaign
  ON campaign_activities(campaign_id);
CREATE INDEX idx_campaign_activities_campaign_date
  ON campaign_activities(campaign_id, scheduled_date);
CREATE INDEX idx_campaign_activities_execution_id
  ON campaign_activities(campaign_id, execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX idx_campaign_activities_workspace
  ON campaign_activities(workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX idx_campaign_activities_rule
  ON campaign_activities(rule_id) WHERE rule_id IS NOT NULL;

COMMENT ON TABLE campaign_activities IS 'First-class calendar activities; generated from rules or AI pipeline.';
```

**Field purposes:**
- `execution_id`: Stable ID for workspace and blueprint compatibility; maps to `activity-workspace-${campaignId}-${execution_id}`
- `workspace_id`: Optional; when present, overrides sessionStorage key for workspace resolution
- `source`: `rule` | `ai` | `manual` | `blueprint_migration`
- `rule_id`: Optional; links to generating rule for traceability

---

## 4. RECURRENCE_ENGINE

### 4.1 Rule-to-Activity generation

```
Input: campaign_activity_rules + campaign (start_date, end_date/duration_weeks)
Output: campaign_activities rows
```

**Algorithm (per rule):**
1. Compute date range: `[rule.start_date, rule.end_date ?? campaign.end_date]`
2. For each week in range:
   - **weekly_day:** If `day_of_week` matches weekday of week start + offset → emit one activity
   - **weekly_alternate:** If `(week_number - 1) % interval === week_offset` → emit on `day_of_week`
   - **posts_per_week:** Spread N activities across 7 days (use existing `spreadEvenlyAcrossDays` logic)
   - **content_rotation:** Emit one activity per week at derived day; `content_type` from rule
3. Assign `execution_id`: `rule-${rule_id}-w${week}-d${dayIndex}` or UUID per activity
4. Insert into `campaign_activities`

### 4.2 Example mappings

| Natural language | Rule |
|------------------|------|
| "Create LinkedIn post every Wednesday" | `frequency_type: weekly_day`, `day_of_week: Wednesday`, `platform: linkedin`, `content_type: post` |
| "Add video every Friday" | `frequency_type: weekly_day`, `day_of_week: Friday`, `content_type: video` |
| "3 posts per week" | `frequency_type: posts_per_week`, `posts_per_week: 3` |
| "Video every week, carousel on alternate weeks" | Two rules: `content_rotation` with `week_offset: 0` (video), `week_offset: 1` (carousel, `interval: 2`) |

### 4.3 Activity generator service (proposed)

```
RuleEngine.generateActivities(campaignId, ruleIds?, dateRange?)
  → Load rules for campaign (or by ids)
  → For each rule: expand to (scheduled_date, scheduled_time, platform, content_type, topic, theme)
  → Deduplicate by (campaign_id, scheduled_date, platform, content_type) if needed
  → Upsert campaign_activities (insert new, skip existing by execution_id)
  → Return { inserted, skipped }
```

---

## 5. AI_CALENDAR_PIPELINE

### 5.1 Pipeline architecture

```
Campaign Goals + Target Audience + Weekly Themes + Platforms + Frequency
        │
        ▼
┌─────────────────────┐
│ AI Campaign Planner │  (existing: campaignAiOrchestrator, ai/plan)
│ - Duration weeks    │
│ - Platform mix       │
│ - Content mix        │
│ - Weekly themes      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Recurrence Extractor│  (NEW: parses AI output into rules)
│ - weekly_day rules  │
│ - posts_per_week    │
│ - content_rotation  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ campaign_activity_  │
│ rules (insert)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Activity Generator  │  (uses RuleEngine.generateActivities)
│ → campaign_         │
│   activities rows   │
└─────────────────────┘
```

### 5.2 Integration with existing AI

- **campaignAiOrchestrator** already produces `execution_items`, `resolved_postings`, `daily_execution_items` with platform, content_type, topic, day.
- **New step:** After blueprint commit, run `RecurrenceExtractor.fromBlueprint(blueprint)` → extract rules where patterns exist (e.g. "LinkedIn post every Wednesday" inferred from weekly recurrence).
- **Fallback:** When no clear pattern, insert one rule per unique (platform, content_type, day) with `frequency_type: weekly_day` for that week range.
- **planner-finalize / generate-weekly-structure:** Optionally call `ActivityGenerator.run(campaignId)` after generating `daily_content_plans` to backfill `campaign_activities`.

---

## 6. NEW_DATA_FLOW

### 6.1 Redesigned flow

```
Campaign (with start_date, duration_weeks)
    │
    ├─► campaign_activity_rules (from AI or CMO commands)
    │
    ▼
Activity Generator (RuleEngine.generateActivities)
    │
    ▼
campaign_activities
    │
    ▼
Calendar UI: SELECT * FROM campaign_activities WHERE campaign_id = ? ORDER BY scheduled_date, scheduled_time
```

### 6.2 Replacing blueprint JSON for calendar

- **Current:** Calendar reads `retrieve-plan` → `committedPlan.weeks[].daily_execution_items` (JSONB)
- **Proposed:** Calendar reads `GET /api/campaigns/activities?campaignId=...` → `campaign_activities` rows
- **Blueprint remains:** For planner, AI chat, and versioning. Blueprint becomes **planning source**; `campaign_activities` becomes **calendar source**.
- **Sync:** When blueprint is committed or AI generates plan, `RecurrenceExtractor` + `ActivityGenerator` populate `campaign_activities`. Edits in activity workspace can write back to `campaign_activities`; blueprint is not updated for calendar display.

---

## 7. MIGRATION_PLAN

### 7.1 Principles

1. Keep blueprint as source for **existing campaigns**.
2. New campaigns can opt into `campaign_activities`-first flow.
3. Backward compatibility: calendar continues to support blueprint + daily_content_plans until migration complete.

### 7.2 Steps

| Step | Action |
|------|--------|
| 1 | Create `campaign_activity_rules` and `campaign_activities` tables (no FKs to rules initially if rule_id nullable) |
| 2 | Add `calendar_source` to `campaigns`: `blueprint` \| `activities` (default `blueprint`) |
| 3 | Implement `blueprintToActivities(campaignId)`: read blueprint via `getUnifiedCampaignBlueprint`, map each `daily_execution_items` to `campaign_activities` row; set `source = 'blueprint_migration'`, preserve `execution_id` |
| 4 | Implement `activitiesToRules(campaignId)`: analyze existing `campaign_activities` and infer rules where possible; insert into `campaign_activity_rules` |
| 5 | New API `GET /api/campaigns/activities?campaignId=` returns `campaign_activities` for campaign |
| 6 | Calendar page: if `campaign.calendar_source === 'activities'`, call activities API; else use retrieve-plan + daily-plans (current behavior) |
| 7 | Migration job: For each campaign with blueprint and no `campaign_activities`, run `blueprintToActivities`; set `calendar_source = 'activities'` when done |
| 8 | Planner finalize / generate-weekly-structure: After insert into `daily_content_plans`, optionally run `blueprintToActivities` for the campaign to keep `campaign_activities` in sync |
| 9 | Activity workspace resolve: Extend to check `campaign_activities` when `execution_id` not found in blueprint (for migrated campaigns) |

### 7.3 Backward compatibility

- `calendar_source = 'blueprint'`: No change to current behavior.
- Workspace key `activity-workspace-${campaignId}-${execution_id}` unchanged; resolve API can fetch from `campaign_activities` when blueprint miss.
- `daily_content_plans` remains for content detail; `campaign_activities` is calendar/identity layer. Optional: add `activity_id` FK on `daily_content_plans` → `campaign_activities` for future linking.

---

## 8. FRONTEND_SIMPLIFICATION

### 8.1 Current vs proposed

| Current | Proposed |
|--------|----------|
| Fetch retrieve-plan, then possibly daily-plans | Fetch `GET /api/campaigns/activities?campaignId=` |
| Parse `weeks[].daily_execution_items` | Consume activity rows directly |
| Map to CalendarActivity with fallback date logic | Map DB row → CalendarActivity (1:1) |
| Build stage from content_type/stage/raw_item | Use `stage` column; fallback to derive |

### 8.2 Calendar load (proposed)

```typescript
// pages/campaign-calendar/[id].tsx (simplified)
const { data } = await fetch(`/api/campaigns/activities?campaignId=${campaignId}&start=${start}&end=${end}`);
const activities = data.activities; // campaign_activities rows
// Group by scheduled_date, then by stage; render tiles
```

**Benefits:**
- Single API call.
- Pagination by date range: `?start=2025-03-01&end=2025-03-31`.
- No blueprint parsing.
- Workspace resolution: `execution_id` from row; resolve API can read from `campaign_activities` when needed.

### 8.3 Backward path

When `calendar_source === 'blueprint'`, keep existing retrieve-plan + daily-plans flow. No change to components until migration.

---

## 9. AI_COMMAND_INTERFACE

### 9.1 Natural language commands

| Command | Parsed intent | Rule created |
|---------|---------------|--------------|
| "Create LinkedIn post every Wednesday" | platform: linkedin, content_type: post, frequency: weekly_day, day: Wednesday | Insert `campaign_activity_rules` row |
| "Add video every Friday" | content_type: video, frequency: weekly_day, day: Friday | Insert rule; run ActivityGenerator |
| "Generate 3 posts per week" | frequency: posts_per_week, posts_per_week: 3 | Insert rule; run ActivityGenerator |
| "Carousel every other week on Monday" | content_type: carousel, frequency: weekly_alternate, day: Monday, interval: 2 | Insert rule |

### 9.2 Command processing flow

```
User input (chat or command bar)
    │
    ▼
NL Parser / Intent Extractor (LLM or rule-based)
    │
    ▼
{ platform?, content_type?, frequency_type, day_of_week?, posts_per_week?, ... }
    │
    ▼
Create campaign_activity_rules row
    │
    ▼
ActivityGenerator.run(campaignId, [newRuleId])
    │
    ▼
Return summary: "Added 12 activities (Wednesdays through campaign end)"
```

### 9.3 Integration points

- **CampaignAIChat:** Add command handler for calendar commands; call new `POST /api/campaigns/activity-rules` with parsed intent.
- **Campaign details / calendar:** "Add recurring activity" button → modal with platform, content type, frequency, day → creates rule + generates activities.
- **Existing `posting_frequency`:** Strategy context already has `posting_frequency: Record<string, number>`. Map to `posts_per_week` rules when creating campaign.

---

## 10. SCALABILITY_IMPACT

| Dimension | Current | Proposed |
|-----------|---------|----------|
| **Calendar load** | Full blueprint + possibly daily-plans | Single query `campaign_activities` with date range |
| **Indexing** | No index on JSONB activity fields | B-tree indexes on campaign_id, scheduled_date, execution_id |
| **Pagination** | None | `LIMIT/OFFSET` or cursor by `scheduled_date` |
| **Activity resolution** | Walk blueprint weeks in memory | Index lookup on (campaign_id, execution_id) |
| **Recurrence** | Manual regeneration | Rule engine; add rule → regenerate slice of activities |
| **AI automation** | Full plan regeneration | Incremental: add rule → generate N new rows |
| **Two sources** | Blueprint vs daily_content_plans | Blueprint = planning; campaign_activities = calendar truth |

### 10.1 Large campaign behavior

- **Current:** 12 weeks × 5 posts = 60 items in blueprint JSON; full load.
- **Proposed:** 60 rows in `campaign_activities`; query with `WHERE campaign_id = ? AND scheduled_date BETWEEN ? AND ?`; index supports efficient range scan.
- **Future:** Materialized view or summary table for "activities this month" dashboards without hitting activity table directly.

---

## APPENDIX: Files to add/modify

| File | Action |
|------|--------|
| `database/campaign_activities.sql` | Create (new) |
| `database/campaign_activity_rules.sql` | Create (new) |
| `backend/services/activityRuleEngine.ts` | Create (new): rule expansion, generateActivities |
| `backend/services/recurrenceExtractor.ts` | Create (new): blueprint → rules |
| `pages/api/campaigns/activities.ts` | Create (new): GET activities by campaign + date range |
| `pages/api/campaigns/activity-rules.ts` | Create (new): POST create rule, run generator |
| `pages/campaign-calendar/[id].tsx` | Modify: branch on calendar_source; use activities API when set |
| `pages/api/activity-workspace/resolve.ts` | Modify: fallback to campaign_activities when blueprint miss |
| `campaigns` table | Migrate: add `calendar_source` column |

---

*End of architecture proposal*

# Campaign Opportunity Engine

Converts **strategic themes** into **campaign opportunities** for Campaign Builder, Content Planning, and Marketing Teams. Uses the same intelligence pipeline (signals → clusters → signal_intelligence → strategic_themes) and does not modify previous systems.

**Intelligence preserved:** Each opportunity inherits `momentum_score` and `keywords` from its strategic theme (which already reflects signal momentum, trend direction, and entities from the pipeline), so Campaign Builder and content planning can rank and filter by momentum and keywords.

---

## 1. Table: campaign_opportunities

**File:** `database/campaign_opportunities.sql`

| Column                 | Type        | Description                              |
|------------------------|-------------|------------------------------------------|
| id                     | UUID (PK)   | Default gen_random_uuid()                |
| theme_id               | UUID (FK)   | References strategic_themes(id)           |
| cluster_id             | UUID (FK)   | References signal_clusters(cluster_id)    |
| opportunity_title      | TEXT        | Short actionable title                   |
| opportunity_description | TEXT      | Longer description                       |
| opportunity_type       | TEXT        | content_marketing \| thought_leadership \| product_positioning \| industry_education |
| momentum_score         | NUMERIC     | From strategic theme                     |
| keywords               | JSONB       | From strategic theme                     |
| created_at             | TIMESTAMPTZ | Default now()                            |

**Duplicate prevention:** `UNIQUE(theme_id, opportunity_type)` — at most one opportunity per (theme, type).

**Constraint:** `opportunity_type` must be one of the four allowed values.

---

## 2. Service

**File:** `backend/services/campaignOpportunityEngine.ts`

**Main function:** `generateCampaignOpportunities()`

**Steps:**

1. Load all `strategic_themes` (ordered by momentum_score desc).
2. Load `theme_id`s that already have rows in `campaign_opportunities`.
3. For each theme not yet converted, generate **4 opportunities** (one per type).
4. Insert into `campaign_opportunities`. On unique violation `(theme_id, opportunity_type)`, skip and count as skipped.

---

## 3. Rule-based generation

Topic is derived from `theme_title` by stripping the `"The Rise of "` prefix (e.g. *"The Rise of AI Productivity Automation"* → *"AI Productivity Automation"*).

| Type                  | Title template                                                                 | Description (summary) |
|-----------------------|---------------------------------------------------------------------------------|------------------------|
| content_marketing      | Create blog posts explaining how {topic} improves productivity.                | Educational content that explains how {topic} improves productivity for teams. |
| thought_leadership    | Publish executive insights on the future of {topic}-driven productivity.        | Executive-level thought leadership on {topic} and its impact on productivity. |
| product_positioning   | Position your product as a productivity enabler through {topic}.                | Position your product as enabling productivity gains via {topic}. |
| industry_education    | Develop educational resources about {topic} trends.                             | Educational resources that help audiences understand {topic} trends and adoption. |

---

## 4. Scheduler

- **schedulerService.runCampaignOpportunityEngine()** — calls `generateCampaignOpportunities()`, returns `{ themes_processed, opportunities_created, opportunities_skipped }`.
- **Cron:** runs every **hour** (`CAMPAIGN_OPPORTUNITY_INTERVAL_MS`), after the strategic theme engine.

---

## 5. Observability

| Event                          | Payload (example) |
|--------------------------------|-------------------|
| opportunity_generation_started | `{}`              |
| opportunity_created            | `theme_id`, `opportunity_type`, `title` (first 80 chars) |
| opportunity_generation_completed | `themes_processed`, `opportunities_created`, `opportunities_skipped`, `duration_ms` |

**Example log:**

```json
{
  "event": "opportunity_created",
  "theme_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "opportunity_type": "content_marketing",
  "title": "Create blog posts explaining how AI Productivity Automation improves productivity."
}
```

---

## 6. Example output

**Strategic theme:**

- theme_title: *"The Rise of AI Productivity Automation"*
- topic used in templates: *"AI Productivity Automation"*

**Campaign opportunities (4 rows):**

| opportunity_type     | opportunity_title                                                                 | opportunity_description |
|----------------------|------------------------------------------------------------------------------------|--------------------------|
| content_marketing    | Create blog posts explaining how AI Productivity Automation improves productivity. | Educational content that explains how AI Productivity Automation improves productivity for teams. |
| thought_leadership    | Publish executive insights on the future of AI Productivity Automation-driven productivity. | Executive-level thought leadership on AI Productivity Automation and its impact on productivity. |
| product_positioning   | Position your product as a productivity enabler through AI Productivity Automation. | Position your product as enabling productivity gains via AI Productivity Automation. |
| industry_education   | Develop educational resources about AI Productivity Automation trends.             | Educational resources that help audiences understand AI Productivity Automation trends and adoption. |

Each row also stores `theme_id`, `cluster_id`, `momentum_score`, and `keywords` from the strategic theme, so Campaign Builder and content planning can filter and rank by momentum and keywords.

# Strategic Theme Generation Engine

Converts **signal_intelligence** records into **Strategic Theme Cards** for Campaign Builder, Marketing Strategy Planning, and Content Planning. Does not modify the intelligence pipeline.

---

## 1. Table: strategic_themes

**File:** `database/strategic_themes.sql`

| Column             | Type      | Description                    |
|--------------------|-----------|--------------------------------|
| id                 | UUID (PK) | Default gen_random_uuid()      |
| cluster_id         | UUID (FK) | References signal_clusters(cluster_id), **UNIQUE** |
| intelligence_id    | UUID (FK) | References signal_intelligence(id) |
| theme_title        | TEXT      | Marketing title                |
| theme_description  | TEXT      | Marketing description          |
| momentum_score     | NUMERIC   | From intelligence              |
| trend_direction    | TEXT      | From intelligence              |
| companies          | JSONB     | From intelligence              |
| keywords           | JSONB     | From intelligence              |
| influencers        | JSONB     | From intelligence              |
| created_at         | TIMESTAMPTZ | Default now()                |

**Duplicate prevention:** `UNIQUE(cluster_id)` — at most one theme per cluster.

---

## 2. Service

**File:** `backend/services/strategicThemeEngine.ts`

**Main function:** `generateStrategicThemes()`

**Steps:**

1. Load `signal_intelligence` where **momentum_score >= 0.6** and **trend_direction = 'UP'**.
2. Load existing `strategic_themes` and collect `cluster_id`s — skip any cluster that already has a theme.
3. For each eligible row, generate `theme_title` and `theme_description` via template (no LLM).
4. Insert into `strategic_themes` (one row per cluster; unique on `cluster_id`).

---

## 3. Theme generation logic

**Eligibility:** Only intelligence records with:

- `momentum_score >= 0.6`
- `trend_direction = 'UP'`

**Template-based generation:**

- **theme_title:** `"The Rise of " + TitleCase(topic)`  
  Example: `"AI productivity automation"` → `"The Rise of Ai Productivity Automation"` (or keep “AI” as-is for acronyms; current implementation title-cases each word).
- **theme_description:** `"Organizations are rapidly adopting " + topic + " to improve productivity and streamline workflows."`  
  Example: `"Organizations are rapidly adopting AI productivity automation to improve productivity and streamline workflows."`

**Example (from spec):**

| Topic                     | theme_title                                      | theme_description |
|---------------------------|--------------------------------------------------|-------------------|
| AI productivity automation | The Rise of AI Productivity Automation          | Organizations are rapidly adopting AI productivity automation to improve productivity and streamline workflows. |

---

## 4. Scheduler

**Every hour:**

- `schedulerService.runStrategicThemeEngine()` calls `generateStrategicThemes()`.
- Wired in `cron.ts` via `STRATEGIC_THEME_INTERVAL_MS = 60 * 60 * 1000`.

---

## 5. Observability

**theme_generation_started**
```json
{"event":"theme_generation_started"}
```

**theme_created**
```json
{
  "event": "theme_created",
  "cluster_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "theme_title": "The Rise of AI-Powered Productivity Automation",
  "momentum_score": 0.82
}
```

**theme_generation_completed**
```json
{
  "event": "theme_generation_completed",
  "duration_ms": 120,
  "intelligence_eligible": 5,
  "themes_created": 2,
  "themes_skipped": 3
}
```

---

## 6. Example theme output (record)

Example row in `strategic_themes`:

```json
{
  "id": "uuid",
  "cluster_id": "cluster-uuid",
  "intelligence_id": "intelligence-uuid",
  "theme_title": "The Rise of AI Productivity Automation",
  "theme_description": "Organizations are rapidly adopting AI productivity automation to improve productivity and streamline workflows.",
  "momentum_score": 0.82,
  "trend_direction": "UP",
  "companies": ["Acme Corp", "TechCo"],
  "keywords": ["AI", "productivity", "automation"],
  "influencers": [],
  "created_at": "2025-03-04T15:00:00Z"
}
```

Downstream: Campaign Builder, Marketing Strategy Planning, and Content Planning can query `strategic_themes` by momentum, keywords, or recency.

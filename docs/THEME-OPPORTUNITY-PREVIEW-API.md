# Theme Opportunity Preview API

Allows the frontend to preview a **strategic theme** and related **campaign opportunities** plus **trend intelligence** before launching a campaign. Used for the **Strategy Theme Card with action buttons**. Does not modify the intelligence pipeline or campaign creation APIs.

---

## 1. API Endpoint

**GET** `/api/intelligence/theme-preview?theme_id=...`

**Query:**

| Parameter  | Required | Description                    |
|-----------|----------|--------------------------------|
| theme_id  | Yes      | UUID of a row in strategic_themes |

**Responses:**

- **200** — Preview payload (see Response structure).
- **400** — Missing or invalid `theme_id`.
- **404** — Theme not found.
- **405** — Method not allowed (non-GET).
- **500** — Server error.

---

## 2. Response Structure

```json
{
  "theme": {
    "id": "uuid",
    "title": "string",
    "description": "string",
    "momentum_score": number | null,
    "trend_direction": string | null,
    "keywords": [],
    "companies": [],
    "influencers": []
  },
  "intelligence": {
    "topic": "string",
    "signal_count": number,
    "first_detected_at": "ISO8601 | null",
    "last_detected_at": "ISO8601 | null"
  },
  "opportunities": [
    {
      "id": "uuid",
      "opportunity_title": "string",
      "opportunity_description": "string",
      "opportunity_type": "string",
      "momentum_score": number | null
    }
  ]
}
```

---

## 3. Service

**File:** `backend/services/themePreviewService.ts`

**Function:** `getThemePreview(themeId: string): Promise<ThemePreviewResult | null>`

**Steps:**

1. Load **strategic theme** by `id` (theme_id).
2. Load **signal intelligence** by `intelligence_id` from the theme row.
3. Load **campaign opportunities** by `theme_id`.
4. Return combined object; `null` if theme not found.

---

## 4. SQL Queries Used

**1. Strategic theme (by id)**

```sql
SELECT id, intelligence_id, theme_title, theme_description,
       momentum_score, trend_direction, keywords, companies, influencers
FROM strategic_themes
WHERE id = $1;
```

**2. Signal intelligence (by intelligence_id from theme)**

```sql
SELECT id, topic, signal_count, first_detected_at, last_detected_at
FROM signal_intelligence
WHERE id = $1;
```

**3. Campaign opportunities (by theme_id)**

```sql
SELECT id, opportunity_title, opportunity_description, opportunity_type, momentum_score
FROM campaign_opportunities
WHERE theme_id = $1
ORDER BY opportunity_type;
```

(Implementation uses Supabase client: `eq('id', ...)`, `eq('theme_id', ...)`, `order('opportunity_type')`.)

---

## 5. Data Sources

| Source                 | Table                  | Key / join                          |
|------------------------|------------------------|-------------------------------------|
| Theme                  | strategic_themes       | id = theme_id                       |
| Trend intelligence     | signal_intelligence    | id = theme.intelligence_id          |
| Related opportunities  | campaign_opportunities | theme_id = theme_id                 |

---

## 6. Observability

**Event:** `theme_preview_requested`

**Example log:**

```json
{
  "event": "theme_preview_requested",
  "theme_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "opportunities_count": 4
}
```

---

## 7. Example API Response

**Request:**

```http
GET /api/intelligence/theme-preview?theme_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response (200):**

```json
{
  "theme": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "title": "The Rise of AI Productivity Automation",
    "description": "Organizations are rapidly adopting AI productivity automation to improve productivity and streamline workflows.",
    "momentum_score": 0.82,
    "trend_direction": "UP",
    "keywords": ["AI", "productivity", "automation"],
    "companies": ["Acme Corp", "TechCo"],
    "influencers": []
  },
  "intelligence": {
    "topic": "AI productivity automation",
    "signal_count": 47,
    "first_detected_at": "2025-02-28T10:00:00.000Z",
    "last_detected_at": "2025-03-04T14:30:00.000Z"
  },
  "opportunities": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-222222222222",
      "opportunity_title": "Create blog posts explaining how AI Productivity Automation improves productivity.",
      "opportunity_description": "Educational content that explains how AI Productivity Automation improves productivity for teams.",
      "opportunity_type": "content_marketing",
      "momentum_score": 0.82
    },
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-333333333333",
      "opportunity_title": "Publish executive insights on the future of AI Productivity Automation-driven productivity.",
      "opportunity_description": "Executive-level thought leadership on AI Productivity Automation and its impact on productivity.",
      "opportunity_type": "thought_leadership",
      "momentum_score": 0.82
    },
    {
      "id": "d4e5f6a7-b8c9-0123-def0-444444444444",
      "opportunity_title": "Position your product as a productivity enabler through AI Productivity Automation.",
      "opportunity_description": "Position your product as enabling productivity gains via AI Productivity Automation.",
      "opportunity_type": "product_positioning",
      "momentum_score": 0.82
    },
    {
      "id": "e5f6a7b8-c9d0-1234-ef01-555555555555",
      "opportunity_title": "Develop educational resources about AI Productivity Automation trends.",
      "opportunity_description": "Educational resources that help audiences understand AI Productivity Automation trends and adoption.",
      "opportunity_type": "industry_education",
      "momentum_score": 0.82
    }
  ]
}
```

# Company Trend Relevance Engine

Filters **Strategic Themes** so each company sees only themes relevant to its industry, keywords, and competitors. This layer sits **between** signal_intelligence / strategic_themes and the UI. It does not modify the intelligence pipeline.

---

## 1. Objective

Score how relevant a theme is for a specific company.

**Example:** Theme *AI Productivity Automation*

- **Relevant for:** SaaS, Developer Tools, Enterprise Software  
- **Not relevant for:** Food Delivery, Fashion Retail  

---

## 2. Table: theme_company_relevance

**File:** `database/theme_company_relevance.sql`

| Column           | Type        | Description                          |
|------------------|-------------|--------------------------------------|
| id               | UUID (PK)   | Default gen_random_uuid()            |
| company_id       | UUID (FK)   | References companies(id)             |
| theme_id         | UUID (FK)   | References strategic_themes(id)      |
| relevance_score  | NUMERIC     | 0–1 composite score                  |
| matched_keywords | JSONB       | Keywords that matched                |
| matched_companies| JSONB       | Companies (competitors) that matched |
| created_at       | TIMESTAMPTZ | Default now()                        |

**Constraint:** `UNIQUE(company_id, theme_id)` — one relevance row per company–theme pair.

---

## 3. Data Sources

**Company context**

- **companies** — `industry`
- **company_profiles** — `industry`, `industry_list`, `competitors`, `competitors_list`, `content_themes`, `content_themes_list` (used as company “keywords” for matching)

**Theme context**

- **strategic_themes** — `keywords`, `companies`
- **signal_intelligence** — `topic` (via theme’s `intelligence_id`)

---

## 4. Relevance Scoring

**Formula (all components 0–1):**

```text
relevance_score =
  (keyword_match_score * 0.5) +
  (competitor_match_score * 0.3) +
  (industry_match_score * 0.2)
```

**Component definitions**

| Component              | Logic |
|------------------------|--------|
| **keyword_match_score**| Intersection of **theme.keywords** (from strategic_themes) and **company keywords** (content_themes_list / content_themes). Score = \|intersection\| / max(\|theme_keywords\|, 1). |
| **competitor_match_score** | Intersection of **theme.companies** and **company competitors** (competitors_list / competitors). Score = \|intersection\| / max(\|theme_companies\|, 1). |
| **industry_match_score**   | 1 if **theme topic** (from signal_intelligence) contains any **company industry term** (industry + industry_list); else 0. |

All matching is case-insensitive; terms are normalized (trim, lowercase, split on comma/semicolon where applicable).

---

## 5. Service

**File:** `backend/services/companyTrendRelevanceEngine.ts`

**Main function:** `computeThemeRelevanceForCompany(companyId)`

**Steps:**

1. Load company context (companies + company_profiles).
2. Load strategic themes with topic (strategic_themes + signal_intelligence).
3. For each theme: compute keyword, competitor, and industry scores; compute `relevance_score`; build `matched_keywords` and `matched_companies`.
4. Upsert into `theme_company_relevance` (on conflict `company_id`, `theme_id`).

**Theme filtering (for UI):** `getThemesForCompany(companyId, minScore = 0.4)`  
Returns themes for the company with `relevance_score >= minScore`, ordered by `relevance_score` DESC (implemented as: read from `theme_company_relevance`, then load `strategic_themes` by `theme_id`).

Equivalent SQL for the filtering pattern:

```sql
SELECT strategic_themes.*
FROM theme_company_relevance
JOIN strategic_themes ON strategic_themes.id = theme_company_relevance.theme_id
WHERE theme_company_relevance.company_id = $1
  AND theme_company_relevance.relevance_score >= 0.4
ORDER BY theme_company_relevance.relevance_score DESC;
```

---

## 6. Scheduler

- **schedulerService.runCompanyTrendRelevance()** — loads all active companies, runs `computeThemeRelevanceForCompany(companyId)` for each, returns `{ companies_processed, total_themes_scored, errors }`.
- **Cron:** runs every **6 hours** (`COMPANY_TREND_RELEVANCE_INTERVAL_MS`).

---

## 7. Observability

**Event:** `theme_relevance_calculated`

**Example log:**

```json
{
  "event": "theme_relevance_calculated",
  "company_id": "...",
  "theme_id": "...",
  "relevance_score": 0.76
}
```

---

## 8. Example Relevance Calculation

**Company:** SaaS (industry: "SaaS, Enterprise Software"); content_themes_list: ["productivity", "automation"]; competitors_list: ["Acme Corp"].

**Theme:** *AI Productivity Automation*  
- theme keywords: `["AI", "productivity", "automation"]`  
- theme companies: `["Acme Corp", "TechCo"]`  
- topic: `"AI productivity automation"`

**Scores:**

- **keyword_match_score:** intersection(theme keywords, company content_themes) = {"productivity", "automation"} → 2/3 ≈ **0.67**
- **competitor_match_score:** intersection(theme companies, company competitors) = {"Acme Corp"} → 1/2 = **0.5**
- **industry_match_score:** topic contains "productivity" / "automation" (not industry); industry "saas" not in topic → **0** (or 1 if we treated industry_list as containing "SaaS" and topic contained "software" — per spec we use industry terms only; "SaaS" not in "AI productivity automation" → 0)

**relevance_score** = 0.5×0.67 + 0.3×0.5 + 0.2×0 = 0.335 + 0.15 + 0 = **0.485**

**Stored row:** `matched_keywords: ["productivity", "automation"]`, `matched_companies: ["Acme Corp"]`.

If the same company had industry "SaaS, Productivity Tools", then "productivity" could be an industry term and topic contains it → industry_match_score = 1 → relevance_score = 0.5×0.67 + 0.3×0.5 + 0.2×1 = **0.685**.

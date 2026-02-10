# Company Profile Implementation – Full Audit Report

**Date:** 2025-02-10  
**Scope:** Backend and data flow only; no code changes.

---

## 1. Backend Components

### 1.1 Database Tables

| Table | Purpose |
|-------|--------|
| **company_profiles** | Canonical company intelligence; one row per `company_id`. |
| **company_profile_refinements** | Audit log of each refinement: before/after profile, source URLs, extraction output, changed fields, missing-field questions. |

**Related tables (reference company_id only):**

- `recommendation_jobs` (company_id)
- `recommendation_audit_logs` (company_id, company_profile_used JSONB)
- `recommendation_snapshots` (company_id)
- `user_company_roles`, `campaign_*`, `platform_execution_plans`, `trend_snapshots`, etc.

### 1.2 API Routes

| Route | Method | Purpose |
|-------|--------|--------|
| **/api/company-profile** | GET | Load profile by `companyId`; optional `mode=list` for companies list. Creates empty profile if missing. |
| **/api/company-profile** | POST | Create or update profile (save). Uses `saveProfile()`; auth via `resolveCompanyAccess`. |
| **/api/company-profile/refine** | POST | Load or create profile, optionally merge request body, then run AI refinement and persist. Returns refined profile + refinement details. |
| **/api/company-profile/refinements** | GET | Last 5 refinement records for `companyId` (audit history). |

**Other routes that read profile (no write):**

- `/api/recommendations/generate`, `/api/recommendations/refresh`, `/api/recommendations/detected-opportunities`
- `/api/recommendations/[id]/preview-strategy`, `/api/recommendations/[id]/create-campaign`
- `/api/campaigns/*` (optimize-week, business-report, platform-plan, scheduler-payload, health-report, etc.)
- `/api/trends/drift-check`, `/api/content/generate-day`, `/api/learning/insights`
- `/api/super-admin/companies` (uses `saveProfile` for super-admin flows)
- `/api/community-ai/utils`, `export`

### 1.3 Services

| Service | Role |
|---------|------|
| **companyProfileService** | Single backend module for profile: types, normalize/validate, save/get, crawl, AI extraction, merge, refinement audit. |
| **recommendationEngine** | Consumes `CompanyProfile` and `normalizeCompanyProfile()` for scoring (categories, geo_focus, target_audience, brand_type). |
| **recommendationEngineService** | Uses profile for geography/industry hints and target_audience_list. |
| **recommendationConsolidator / recommendationExecutionService** | Use `use_company_profile` and company_id from jobs. |
| **externalApiService**, **trendAlignmentService**, **campaignHealthService**, **platformIntelligenceService**, **campaignAuditService**, etc. | Read profile for industry, geography, target_audience (lists or scalars). |

### 1.4 AI Extraction / Refinement Pipeline

- **OpenAI only:** `OPENAI_API_KEY`; model from `OPENAI_MODEL` (default `gpt-4o-mini`).
- **Steps:** Build source list (website + social URLs) → crawl website (fetch HTML, extract links + social links) → fetch summaries for each URL (native `fetch`, no third-party crawl API) → optional `cleanEvidenceWithAi` (clean UI/nav artifacts) → single extraction prompt → parse extraction → merge into working profile → compute confidence → persist and write refinement audit.

---

## 2. Schema and Fields

### 2.1 Current Schema (company_profiles)

```
company_profiles
├── id                  UUID PK, default gen_random_uuid()
├── company_id          TEXT NOT NULL, UNIQUE
├── name                TEXT
├── industry            TEXT
├── category            TEXT
├── website_url         TEXT
├── products_services   TEXT
├── target_audience     TEXT
├── geography           TEXT
├── brand_voice         TEXT
├── goals               TEXT
├── competitors         TEXT
├── unique_value        TEXT
├── content_themes      TEXT
├── confidence_score    INTEGER DEFAULT 0
├── source              TEXT DEFAULT 'user' CHECK (source IN ('user', 'ai_refined'))
├── last_refined_at     TIMESTAMPTZ
├── created_at          TIMESTAMPTZ DEFAULT NOW()
├── updated_at          TIMESTAMPTZ DEFAULT NOW()
├── linkedin_url        TEXT
├── facebook_url        TEXT
├── instagram_url       TEXT
├── x_url               TEXT
├── youtube_url         TEXT
├── tiktok_url          TEXT
├── reddit_url          TEXT
├── blog_url            TEXT
├── other_social_links  JSONB
├── industry_list       JSONB
├── category_list       JSONB
├── geography_list      JSONB
├── competitors_list    JSONB
├── content_themes_list JSONB
├── products_services_list JSONB
├── target_audience_list JSONB
├── goals_list          JSONB
├── brand_voice_list    JSONB
├── social_profiles     JSONB   -- [{ platform, url, source?, confidence? }]
├── field_confidence    JSONB   -- per-field High/Medium/Low
├── overall_confidence  INTEGER DEFAULT 0
└── source_urls         JSONB   -- URLs used in refinement
```

### 2.2 company_profile_refinements

```
company_profile_refinements
├── id                      UUID PK
├── company_id               TEXT NOT NULL
├── before_profile           JSONB NOT NULL
├── after_profile            JSONB NOT NULL
├── source_urls              JSONB
├── source_summaries         JSONB
├── changed_fields           JSONB
├── extraction_output        JSONB
├── missing_fields_questions JSONB
├── overall_confidence       INTEGER DEFAULT 0
└── created_at               TIMESTAMPTZ DEFAULT NOW()
```

### 2.3 User-Entered vs AI-Extracted

- **User-entered:** All fields can be set by the form (POST /api/company-profile) or by the refine request body that is merged before refinement. The form sends: name, industry, category, website_url, scalar and list variants of products_services, target_audience, geography, brand_voice, goals, competitors, unique_value, content_themes, and social URLs (linkedin_url, facebook_url, … plus other_social_links and social_profiles built from scalars).
- **AI-extracted (during refine):** Same logical fields are extracted from website + social evidence: company_name, industry_list, category_list, website_url, social_profiles (per platform), geography_list, products_services, target_audience, brand_voice, goals, competitors_list, unique_value_proposition, content_themes_list. Extraction uses `source`: "website" | "social" | "inferred" | "missing" and `confidence`: "High" | "Medium" | "Low".
- **System-set:** `source` ('user' | 'ai_refined'), `last_refined_at`, `updated_at`, `created_at`, `confidence_score`, `overall_confidence`, `field_confidence`, `source_urls`. Discovered social URLs (from website crawl) are merged in during refinement and can fill in linkedin_url, etc., if not already set.

### 2.4 Merge / Overwrite During Refinement

- **Scalar fields (e.g. name, website_url, unique_value):** `updateScalarField`. Replaced by AI value only when **incoming confidence is strictly higher** than current (`shouldReplaceValue`). Otherwise current (e.g. user) value is kept. Generic values ("technology", "global", "other") are not used to overwrite when source is inferred.
- **Array fields (industry_list, category_list, geography_list, competitors_list, content_themes_list, products_services_list, target_audience_list, goals_list, brand_voice_list):** `updateArrayField`. **Merge** (dedupe, preserve casing): current list + incoming list. Generic values are filtered out for non-website/social/user sources. Confidence for the field is the higher of current vs incoming.
- **Social profiles:** `buildSocialProfileList` merges current and extracted; deduped by normalized URL; higher-confidence URL wins. Refined row then keeps `linkedin_url` … `blog_url` and `other_social_links` from the **working profile** (after merge of discovered links), and `social_profiles` from the merged list.
- **After merge:** Full refined payload is built (scalar + list + social_profiles, field_confidence, overall_confidence, source_urls); then **upserted** so the row is fully replaced by this merged result. `source` is set to `'ai_refined'`.

So: **user data can be overwritten** when AI has higher confidence (scalars) or merged (lists). There is no “lock” or “user-only” flag per field.

### 2.5 Confidence Scoring

- **Per-field:** Stored in `field_confidence` (High/Medium/Low). Comes from extraction and merge: when merging, the higher confidence (by rank High > Medium > Low) is kept.
- **Overall:** `computeConfidenceScore(extraction)` = round((count of non-missing extracted fields) / 12 * 100). Twelve fields: company_name, industry, category, website_url, geography, products_services, target_audience, brand_voice, goals, competitors, unique_value_proposition, content_themes. Social_profiles are not in this numerator.
- **confidence_score:** Max of previous value and extraction-based score; also updated on refined payload.
- **overall_confidence:** Max of previous and extraction-based score.

---

## 3. Data Flow

### 3.1 Profile Form → Save → Enrichment → AI Extraction → Merge → Persist

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. PROFILE FORM (pages/company-profile.tsx)                                  │
│    User edits: name, industry, category, website_url, products_services,     │
│    target_audience, geography, brand_voice, goals, competitors,             │
│    unique_value, content_themes, social URLs (linkedin, facebook, …).        │
│    Builds lists from comma-separated and buildSocialProfilesFromScalars().   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌──────────────────────────────┐         ┌──────────────────────────────────────┐
│ 2a. SAVE (user clicks Save)   │         │ 2b. REFINE (user clicks Refine)       │
│ POST /api/company-profile     │         │ POST /api/company-profile/refine     │
│ Body: full draft + lists      │         │ Body: full draft (same as save)       │
│ → saveProfile(payload)        │         │ → getProfile() or saveProfile(seed)  │
│ Upsert: input ?? existing     │         │ → optional saveProfile(profile+body) │
│ for scalars; merge lists      │         │ → refineProfileWithAIWithDetails()   │
│ source = 'user'                │         │                                      │
└──────────────────────────────┘         └──────────────────────────────────────┘
                                                          │
                                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. ENRICHMENT (inside runProfileRefinement)                                  │
│    - buildSourceList(profile): website_url + linkedin_url … + other_social   │
│      + social_profiles. Dedupe, skip placeholders and static assets.         │
│    - If website_url present: crawlWebsiteSources(website_url):                │
│      • fetch(website_url) → HTML                                             │
│      • extractLinksFromHtml (same-domain only), scoreUrl (about/team/…)      │
│      • up to MAX_CRAWL_PAGES (12) internal links                             │
│      • extractSocialLinksFromHtml → linkedin, facebook, instagram, x,       │
│        youtube, tiktok, reddit (no blog from crawl)                           │
│      • mergeDiscoveredSocialProfiles: fill *_url if missing, append to       │
│        social_profiles / other_social_links                                   │
│    - For each URL in deduped source list: fetchUrlSummary(url)                │
│      • fetch(url), 5s timeout → text                                         │
│      • extractEvidenceFromHtml: title, meta description, og:description,    │
│        highlights (sentences with keywords about/mission/services/…)          │
│      • summary = title + meta + og + highlights, max 2000 chars               │
│    No external crawl or social APIs; only HTTP fetch to public URLs.          │
└──────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. AI CLEAN (optional) + EXTRACTION                                          │
│    - cleanEvidenceWithAi: OpenAI JSON, remove nav/footer/UI text, keep       │
│      business evidence.                                                      │
│    - buildExtractionPrompt(cleanedEvidence, currentProfile): one prompt      │
│      asking for company_name, industry_list, category_list, geography_list,  │
│      products_services, target_audience, brand_voice, goals, competitors_list,│
│      unique_value_proposition, content_themes_list, website_url,             │
│      social_profiles { linkedin, facebook, instagram, x, youtube, tiktok,     │
│      reddit, blog } with values, source, confidence.                          │
│    - OpenAI chat.completions.create (gpt-4o-mini, temperature 0, json_object) │
│    - buildExtractionWithDefaults(parsed) + computeMissingFields               │
│    - generateMissingFieldQuestions(client, extraction) for UI                │
└──────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. MERGE                                                                     │
│    For each field: existing (working profile) + extraction (value, source,   │
│    confidence). updateArrayField / updateScalarField / buildSocialProfileList│
│    → refined object (scalars + *_list + social_profiles, field_confidence,  │
│    overall_confidence, source_urls).                                         │
└──────────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 6. PERSIST                                                                   │
│    refinedPayload = refined + workingProfile social URLs (linkedin_url …),   │
│    source = 'ai_refined', last_refined_at = now, updated_at = now.          │
│    supabase.from('company_profiles').upsert(refinedPayload, company_id).    │
│    storeRefinementAudit(before, after, source_urls, extraction, changed_     │
│    fields, missing_fields_questions).                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 GET Profile and Auto-Refine

- **GET /api/company-profile?companyId=…** (no mode): `getProfile(companyId, { autoRefine: false })` in handler, so **no** auto-refine on read.
- **getProfile(companyId, { autoRefine: true })** (used elsewhere): if `shouldRefineProfile(last_refined_at)` (no refine in last 7 days), calls `refineProfileWithAI(profile, { force: true })` and returns the refined profile. So any caller using `getProfile` with default options can trigger a refine and overwrite.

---

## 4. External Sources – What Is Fetched

### 4.1 Website

- **How:** Native `fetch(website_url)` (and same-domain links), 8s timeout for root, 5s per page for summary.
- **What is fetched:**
  - **Root page:** Full HTML → extract same-domain links (href/data-href from anchors), score by keywords (about, company, team, mission, services, solutions, products, blog, etc.), keep up to 12 pages.
  - **Each URL (root + scored links):** Full HTML → `extractEvidenceFromHtml`: `<title>`, `<meta name="description">`, `<meta property="og:description">`, and “highlights” (sentences 40+ chars containing about/mission/services/solutions/products/industry/audience/company/we help/who we are). Script/style/nav/header/footer/aside stripped.
- **Output:** List of `{ label, url, summary }` where summary = title + meta + og + highlights (max 2000 chars). No external API; no headless browser.

### 4.2 Social Links

- **How:** Same `fetchUrlSummary(url)` for each social URL in the source list (from profile or discovered from website HTML).
- **What is fetched:** Same as website: title, meta description, og:description, highlights from HTML. No platform APIs (no LinkedIn/Facebook/Instagram Graph, etc.).
- **Discovery:** From website HTML, `extractSocialLinksFromHtml` finds anchors whose href (or data-href) points to linkedin.com, facebook.com, instagram.com, x.com/twitter.com, youtube.com/youtu.be, tiktok.com, reddit.com. Filtered by `isLikelyCompanySocialLink` (e.g. /company/ for LinkedIn, /pages/ for Facebook, /channel/ or /@ for YouTube). Scored by brand tokens from domain; best URL per platform kept.

### 4.3 APIs Used

- **OpenAI:** For cleaning evidence (`cleanEvidenceWithAi`) and for extraction (single structured JSON). Model from `OPENAI_MODEL` (default `gpt-4o-mini`).
- **Supabase:** All persistence (company_profiles, company_profile_refinements).
- **No other external APIs** for crawl or social metadata (no Firecrawl, Apify, or platform APIs).

---

## 5. Gaps and Risks

### 5.1 Fields Referenced But Not in Schema

- **avg_deal_size:** Referenced in `/api/recommendations/group-preview.ts` prompt (“Revenue uses company_profile.avg_deal_size if present; otherwise conservative industry benchmarks”). Not stored in `company_profiles` and not extracted. **Gap:** Revenue/ROI logic cannot use deal size.

### 5.2 Recommendation Generation – Required vs Present

- **Used by recommendation engine / normalization:**  
  `normalizeCompanyProfile` uses: industry, category, content_themes (→ categories); geography (→ geo_focus); target_audience (→ parsed audience: age_range, gender, personas); industry/category/brand_voice/goals (→ brand_type).  
  All of these exist and are filled from profile (user or AI).
- **Validation:** `validateCompanyProfile` requires: industry_list or industry, target_audience_list or target_audience, content_themes_list or content_themes, goals_list or goals, and at least one non-placeholder social profile. These align with what the form and refinement can set.

### 5.3 Redundant or Overly Generic

- **Dual storage (scalar + list):** Every such field exists as both a TEXT scalar (e.g. industry, geography) and a JSONB list (industry_list, geography_list). Logic and UI often prefer lists; scalars are derived (e.g. join with ", "). Redundancy is intentional for compatibility but can drift if one is updated without the other (refinement keeps both in sync; saveProfile merges lists and takes input for scalars).
- **Generic values:** "technology", "global", "other" are filtered out when source is inferred, but can still appear from website/social/user. No stronger “quality” or “specificity” signal.

### 5.4 User-Entered Data Overwritten

- **Refinement merge:** If AI returns a value with **higher** confidence than the current one, scalar fields (name, website_url, unique_value) are replaced. So a user-entered value with no stored confidence (or Low) can be overwritten by AI (Medium/High). Array fields are merged, not replaced, but AI can still add terms the user did not intend.
- **source always set to ai_refined:** After refinement, the row is fully replaced and `source` becomes `'ai_refined'`. There is no way to see “last edited by user” vs “last refined by AI” except via refinement audit (before/after).
- **Social URLs:** Discovered links fill in empty *_url slots and are merged into social_profiles. User-set URLs are not overwritten by discovery; but if extraction returns a different URL with higher confidence, it could win in buildSocialProfileList. Refined payload then keeps workingProfile’s linkedin_url etc.; the merged social_profiles array is the one that might differ from user if extraction adds/changes URLs.
- **getProfile(..., { autoRefine: true }):** Any caller that uses default autoRefine can trigger a refine (if >7 days since last_refined_at), which will merge and overwrite. Most API routes use getProfile with explicit `autoRefine: false` or no options; recommendation and campaign code paths should be checked to ensure they do not trigger unintended refinement.

### 5.5 Other Gaps

- **No rate limiting** on refine: repeated refine calls can hit OpenAI and many URLs; no backoff or per-company limit.
- **Crawl depth:** Only one level (root + same-domain links). No recursive or sitemap-based crawl.
- **Social content:** Only page HTML (title/meta/highlights), not platform-specific APIs (followers, bio, posts). So “social” evidence is limited to what’s in the page source.
- **Blog:** Blog URL can be in profile and in extraction, but blog is not discovered from website crawl (only linkedin, facebook, instagram, x, youtube, tiktok, reddit).

---

## 6. Diagrams

### 6.1 Current Schema (Conceptual)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ company_profiles                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ id (PK) │ company_id (UNIQUE) │ name │ industry │ category │ website_url│
│ products_services │ target_audience │ geography │ brand_voice │ goals     │
│ competitors │ unique_value │ content_themes │ confidence_score         │
│ source (user|ai_refined) │ last_refined_at │ created_at │ updated_at   │
│ linkedin_url │ facebook_url │ instagram_url │ x_url │ youtube_url       │
│ tiktok_url │ reddit_url │ blog_url │ other_social_links (JSONB)         │
│ industry_list │ category_list │ geography_list │ competitors_list       │
│ content_themes_list │ products_services_list │ target_audience_list      │
│ goals_list │ brand_voice_list (JSONB)                                    │
│ social_profiles (JSONB) │ field_confidence (JSONB) │ overall_confidence│
│ source_urls (JSONB)                                                      │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ company_id
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ company_profile_refinements (audit)                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ id (PK) │ company_id │ before_profile │ after_profile │ source_urls     │
│ source_summaries │ changed_fields │ extraction_output                    │
│ missing_fields_questions │ overall_confidence │ created_at               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Data Flow (Simplified)

```
  [User Form] ──► POST /api/company-profile ──► saveProfile() ──► DB (source=user)
       │
       └────► POST /api/company-profile/refine
                    │
                    ├─► getProfile / saveProfile(merge body)
                    ├─► crawlWebsiteSources(website_url) ──► fetch HTML, links, social
                    ├─► fetchUrlSummary(each URL) ──► title, meta, highlights
                    ├─► cleanEvidenceWithAi (OpenAI)
                    ├─► buildExtractionPrompt + OpenAI ──► extraction
                    ├─► merge (confidence-based) ──► refined
                    └─► upsert(refined) + storeRefinementAudit
```

---

## 7. Improvement Opportunities

1. **Add avg_deal_size:** Add optional numeric or text field to `company_profiles` and to the form/extraction if revenue/ROI from group-preview should use it.
2. **Protect user-edited fields:** Optional per-field or global “lock” (e.g. do not overwrite user High or user-edited-after-refine) or store `last_edited_by_user_at` and prefer user value when confidence is equal.
3. **Clarify source semantics:** Persist or derive “last change origin” (user vs AI) per field or at least for key fields, for UX and support.
4. **Rate limit refine:** Per company or per user limit and/or backoff to avoid cost and abuse.
5. **Keep scalar/list in sync:** Centralize writes so scalar is always derived from list (or vice versa) in one place to avoid drift.
6. **Optional platform APIs:** For richer social evidence, consider official or partner APIs (LinkedIn, Meta, etc.) with clear consent and compliance.
7. **Crawl options:** Optional sitemap or depth limit for larger sites; keep current default for speed and cost.
8. **Discovery of blog URL:** Include blog in `extractSocialLinksFromHtml` or a separate pass (e.g. /blog, /news, /articles) so blog can be discovered from website.
9. **Audit usage of getProfile(..., { autoRefine: true }):** Ensure no critical path triggers refine unintentionally; document when auto-refine is desired.
10. **Confidence for user input:** When saving from form, set or infer field_confidence for user-supplied fields so merge logic can prefer user over low-confidence AI in edge cases.

---

*End of report. No code was modified.*

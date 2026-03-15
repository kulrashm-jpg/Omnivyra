# Daily Execution Planner UI Update — Implementation Report

**Date:** March 13, 2025  
**Scope:** UI labels and activity card rendering only. No changes to scheduling, campaign logic, planner navigation, or APIs.

---

## Files Modified

| File | Changes |
|------|---------|
| `pages/campaign-details/[id].tsx` | Button labels and tooltips (lines ~2909–2931) |
| `components/planner/PlanningCanvas.tsx` | Header, day selector, activity cards, day cells |

---

## Components Updated

| Component | Location | Description |
|-----------|----------|-------------|
| Campaign Details Weekly Content | `pages/campaign-details/[id].tsx` | Two buttons for daily execution access |
| PlanningCanvas | `components/planner/PlanningCanvas.tsx` | Day view header, activity cards (campaign/week/day), day selector, day cells |

---

## Button Labels Changed

| Before | After | Tooltip |
|--------|-------|---------|
| View Plan & Work on Daily | **Open Daily Execution (Manual)** | Open existing daily plan and manage activities. |
| Generate Daily Plans & Open Planner | **Generate Daily Execution Plan (AI)** | AI generates daily activities from the weekly campaign plan and opens the planner. |

**Logic preserved:** Manual button only opens planner if daily plans exist; AI button generates daily activities then opens planner.

---

## Activity Card Rendering Changes

### Removed

- **AI / CREATOR badges** — No longer shown on activity cards
- **Platform/content combined text** — e.g. `linkedin/post` removed
- **"×N platforms"** — Replaced with `(index/total)` repurpose indicator

### New Standard Format

Each activity card now displays:

1. **Platform icon** (top-left) — Uses `PlatformIcon` from `@/components/ui/PlatformIcon`
2. **Content type** — Short label (Post, Carousel, Reel, Short Video, Article, Video, Thread) via `getContentTypeLabel` from `contentTypeIcons`
3. **Topic** — From `activity.title`, wraps when long
4. **Repurpose indicator** — `(1/3)` when activity is part of a repurpose chain; omitted otherwise

### Where Activity Cards Updated

| View | Location | Before | After |
|------|----------|--------|-------|
| Campaign (expanded week) | Phase → Week → Day chips | AI badge + `platform/content_type: title` | Platform icon + content type + topic + `(index/total)` |
| Week | Day cell activity chips | AI badge + `platform/content_type` + title + `×N platforms` | Platform icon + content type + topic + `(index/total)` |
| Day (selected day) | Main activity cards | AI badge + `platform/content_type` + title + `×N platforms` | Platform icon + content type + topic + `(index/total)` |
| Day (day selector grid) | Mini chips in each day cell | AI badge + `platform/content_type` | Platform icon + content type + `(index/total)` |

---

## Header Update

**Before:** `MONDAY MAR 13 — WEEK 1: AWARENESS` (single line, uppercase)

**After:**
```
Day: Monday • Mar 13
Week: Week 1 — Awareness
```

---

## Day Selector Label

**Before:** `Week 1: Awareness — click a day to select`  
**After:** `Select a day below to manage activities`

---

## Day Activity Indicator (Step 10)

Days with activities now show a count badge:

**Format:** `Mo 13 [2]` — day abbreviation, day of month, count of activities

Previously: `Mo` and full ISO date on separate lines.  
Now: Single line with optional `[N]` when `N > 0`.

---

## Platform Icons

Platform mapping uses existing `PlatformIcon`:

- linkedin → LinkedIn
- facebook → Facebook
- instagram → Instagram
- youtube → YouTube
- twitter/x → X
- tiktok → TikTok
- pinterest → Pinterest

---

## Content Type Labels

Uses existing `getContentTypeLabel` from `contentTypeIcons`:

- post → Post
- carousel → Carousel
- reel → Reel
- short → Short Video
- article → Article
- video → Video
- thread → Thread

---

## Not Modified (per spec)

- Daily plan generation logic
- Campaign scheduling
- Repurpose pipeline
- Calendar event system
- API endpoints
- `WeeklyActivityBoard` / `WeeklyActivityCard` (uses its own format; no changes made)
- `campaign-daily-plan/[id].tsx` page header (uses different structure)

---

## Verification

- No new linter errors in modified files
- Run `npm run build` to confirm build succeeds
- Manual test: open campaign details → Weekly Content → use both daily execution buttons
- Manual test: open planner → switch to Day view → confirm header, activity cards, day selector label, and day cell indicators

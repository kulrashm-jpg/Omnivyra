# Recommendations Page — UI Visual Audit

**Scope:** `pages/recommendations.tsx`, `components/recommendations/tabs/*`, and components rendered by those tabs.  
**Focus:** Only what is rendered visually in the browser. No backend, business logic, or generators.

---

## SECTION 1 — GLOBAL UI (VISIBLE ON ALL TABS)

These elements appear in the **Opportunities** block regardless of which tab is selected.

| Element | Type | Label / Content | Position |
|--------|------|----------------|-----------|
| Page layout | Wrapper | — | Full viewport: `min-h-screen bg-gray-50 p-6` |
| Header | Nav/header | (App header) | Top of page |
| Opportunities card | Card | — | First card in `max-w-5xl mx-auto` |
| Section title | Heading (h2) | **Opportunities** | Top of card, left |
| Tab row | Flex row | — | Below title, full width; `border-b border-gray-200 pb-3 mb-3` |
| Tab: Trend Campaigns | Button | **Trend Campaigns** | Tab row, left |
| Tab: Active Leads | Button | **Active Leads** | Tab row |
| Tab: Market Pulse | Button | **Market Pulse** | Tab row |
| Tab: Seasonal & Regional | Button | **Seasonal & Regional** | Tab row |
| Tab: Influencers | Button | **Influencers** | Tab row |
| Tab: Daily Focus | Button | **Daily Focus** | Tab row |
| Tab content area | Container | — | Below tab row; `min-h-[120px]`; one tab’s content only |

**Notes:**

- There is **no Company selector or Region selector inside the Opportunities card**. Company selection lives in the **Recommendations** section below (label “Company”, dropdown). The Opportunities block uses the same page-level company context but does not render its own controls.
- Tab buttons: active = `bg-indigo-600 text-white`; inactive = `bg-gray-100 text-gray-700`.

---

## SECTION 2 — TAB-SPECIFIC UI ELEMENTS

### Trend Campaigns

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row (description + “X / 10 Active”); grid of **TrendCard**s; each card: topic cluster (title), “Expected reach:”, “Suggested formats:”. |
| **Layout** | **Grid** — `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`. |
| **Unique buttons** | **Promote to Campaign** (primary), **Save as Possibility**, **Dismiss**. |
| **Unique labels/text** | Header: “Strategic topic clusters. Promote to create a DRAFT campaign or save as a possibility.” Right: “{activeCount} / 10 Active”. Card: “Expected reach:”, “Suggested formats:”. |
| **Unique filters** | None. |
| **Unique badges** | None. |
| **Unique empty-state text** | “No trend campaign opportunities.” |
| **Unique interactive components** | Cards with three action buttons; no modals. |
| **Modals** | None. |
| **Loading/error** | “Loading trend campaigns…” / “Select a company to view trend campaigns.” / Red error text. |

---

### Active Leads

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row; **table** with columns: Platform, Public snippet, Problem domain, ICP match, Urgency, Actions; one row per lead. |
| **Layout** | **Table** — `overflow-x-auto` + `w-full text-left border-collapse`; header row with uppercase gray labels. |
| **Unique buttons** | **Create Outreach Plan**, **Promote to Campaign**, **Dismiss** (per row). |
| **Unique labels/text** | Header: “Lead-based opportunities. Create an outreach plan or promote to campaign.” Right: “{activeCount} / 10 Active”. Column headers: Platform, Public snippet, Problem domain, ICP match, Urgency, Actions. |
| **Unique filters** | None. |
| **Unique badges** | None. |
| **Unique empty-state text** | “No active leads.” |
| **Unique interactive components** | Table rows; “Create Outreach Plan” shows `window.alert` (not a modal component). |
| **Modals** | None (alert only). |
| **Loading/error** | “Loading active leads…” / “Select a company to view active leads.” / Red error text. |

---

### Market Pulse

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row; **ranked list** — each row: circular **index badge** (1, 2, 3…), topic title, “Spike:” + spike reason, “Shelf life:” + value; action buttons. |
| **Layout** | **List** — `space-y-0 rounded-lg border border-gray-200 overflow-hidden`; each row is a horizontal flex with index badge left, content center, buttons right. |
| **Unique buttons** | **Generate Quick Content Draft**, **Promote to Campaign**, **Archive**. |
| **Unique labels/text** | Header: “Ranked market pulse with spike indicators. Generate a quick draft or promote to campaign.” Right: “{activeCount} / 10 Active”. Row: “Spike:” (amber), “Shelf life:”. |
| **Unique filters** | None. |
| **Unique badges** | **Index badge** — circular, amber (`bg-amber-100 text-amber-800`), number (1-based). |
| **Unique empty-state text** | “No market pulse opportunities.” |
| **Unique interactive components** | Ranked rows with spike/shelf-life copy; “Generate Quick Content Draft” triggers alert. |
| **Modals** | None. |
| **Loading/error** | “Loading market pulse…” / “Select a company to view market pulse.” / Red error text. |

---

### Seasonal & Regional

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row; **grid of event cards**; each card: event name, “Date: … • Region: …”, “Suggested angle:”, optional “Suggested offer:” (indigo); **date input** when scheduling. |
| **Layout** | **Grid** — `grid grid-cols-1 md:grid-cols-2 gap-4`; card = `border border-gray-200 rounded-lg p-4 bg-white shadow-sm`. |
| **Unique buttons** | **Schedule Campaign for Event** (or inline **Schedule** + **Cancel** when date picker open), **Create Campaign Now**, **Dismiss**. |
| **Unique labels/text** | Header: “Upcoming events (next 30/60/90 days). Schedule a campaign for an event or create one now.” Right: “{activeCount} / 10 Active”. Card: “Date:”, “Region:”, “Suggested angle:”, “Suggested offer:”. |
| **Unique filters** | None. |
| **Unique badges** | None. |
| **Unique empty-state text** | “No seasonal events.” |
| **Unique interactive components** | **Date input** (`type="date"`) shown inline when “Schedule Campaign for Event” is used and event has no date; Schedule/Cancel buttons. |
| **Modals** | None. |
| **Loading/error** | “Loading seasonal & regional opportunities…” / “Select a company to view seasonal opportunities.” / Red error text. |

---

### Influencers

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row; **grouped by platform**: each group has an **h4** (platform name) and a **grid of influencer cards**; each card: name, “Platform:”, “Audience overlap:”, “Engagement rate:”. |
| **Layout** | **Grouped grid** — `space-y-6` for groups; each group: `h4` + `grid grid-cols-1 md:grid-cols-2 gap-3`. |
| **Unique buttons** | **Create Collaboration Plan**, **Promote to Campaign**, **Dismiss**. |
| **Unique labels/text** | Header: “Influencer opportunities grouped by platform. Create a collaboration plan or promote to campaign.” Right: “{activeCount} / 10 Active”. Card: “Platform:”, “Audience overlap:”, “Engagement rate:”. |
| **Unique filters** | None. |
| **Unique badges** | None. |
| **Unique empty-state text** | “No influencer opportunities.” |
| **Unique interactive components** | Platform headings + cards; “Create Collaboration Plan” triggers alert. |
| **Modals** | None. |
| **Loading/error** | “Loading influencer opportunities…” / “Select a company to view influencer opportunities.” / Red error text. |

---

### Daily Focus

| Item | Details |
|------|--------|
| **Unique visible elements** | Header row; **compact list** (max 10 items); each row: headline, “Why today:”, optional “Expected impact:” (indigo); **Act Now** (amber button). |
| **Layout** | **List** — same as Market Pulse: `space-y-0 rounded-lg border border-gray-200 overflow-hidden`; horizontal flex per row, no index badge. |
| **Unique buttons** | **Act Now** (amber), **Promote to Campaign**, **Mark Reviewed**. |
| **Unique labels/text** | Header: “Compact list (max 10). Act now routes by payload or creates a campaign.” Right: “{activeCount} / 10 Active”. Row: “Why today:”, “Expected impact:”. Footer when >10 items: “Showing first 10 of {n}.” |
| **Unique filters** | None. |
| **Unique badges** | None. |
| **Unique empty-state text** | “No daily focus items.” |
| **Unique interactive components** | “Act Now” can open generator modal (see below) or switch tab; “Mark Reviewed” vs “Dismiss” elsewhere. |
| **Modals** | **Quick content generator** — opened from Daily Focus “Act Now” when payload says OPEN_GENERATOR. Page-level: title “Quick content generator”, “Generator: {target}”, “Integrate your existing quick-content generator here.”, Close button. |
| **Loading/error** | “Loading daily focus…” / “Select a company to view daily focus.” / Red error text. |

---

## SECTION 3 — VISUAL SIMILARITY ANALYSIS

| Tab | % visually identical to others | Reused sections | Duplicated sections | Identical wrappers |
|-----|--------------------------------|-----------------|---------------------|--------------------|
| **Trend Campaigns** | ~50% | Header row (description + “X / 10 Active”); card style (border, rounded, shadow); primary/secondary button styling | Same header pattern as all tabs; same “Promote to Campaign” + “Dismiss” pattern | Outer `<div>`, header flex row |
| **Active Leads** | ~55% | Same header row; same primary “Promote” + “Dismiss” style | Header; button styles | Outer `<div>`, header flex row |
| **Market Pulse** | ~55% | Same header row; list container (border, rounded); same “Promote” + secondary action | Header; list wrapper similar to Daily Focus | Outer `<div>`, header flex row |
| **Seasonal & Regional** | ~50% | Same header row; card grid like Trend/Influencers; same “Promote”/“Dismiss” style | Header; card + button pattern | Outer `<div>`, header flex row |
| **Influencers** | ~55% | Same header row; card grid; same three-button pattern | Header; card layout; button set | Outer `<div>`, header flex row; platform groups are unique |
| **Daily Focus** | ~55% | Same header row; list container like Market Pulse; same “Promote” style | Header; list wrapper; footer “Showing first 10…” is unique | Outer `<div>`, header flex row |

**Shared across all tabs:**

- **Header row:** Left = one paragraph of description text; right = “{activeCount} / 10 Active” (same class and position).
- **Loading/error/no-company:** Same pattern (gray or red message, no structure change).
- **Empty state:** Same pattern (single line of gray text, e.g. “No …”).
- **Action pattern:** At least one primary (indigo) action and one secondary (border) action per item; “Promote to Campaign” and “Dismiss” (or “Archive”/“Mark Reviewed”) repeated across tabs.

**What differs:**

- **Layout:** Grid (Trend, Seasonal, Influencers) vs table (Leads) vs list (Pulse, Daily Focus). Influencers add platform groups (h4 + grid).
- **Item content:** Fields and labels (topic vs snippet/urgency vs spike/shelf life vs event/date/region vs influencer metrics vs why today/impact).
- **Primary secondary action:** Save as Possibility, Create Outreach Plan, Generate Quick Content Draft, Schedule/Create Campaign Now, Create Collaboration Plan, Act Now / Mark Reviewed.
- **One inline control:** Seasonal has date input + Schedule/Cancel.
- **One badge:** Market Pulse has the numeric index circle.
- **One modal:** Daily Focus can open the page-level “Quick content generator” modal.

---

## SECTION 4 — SUMMARY

1. **Are the tabs visually distinct?**  
   **Partly.** They share the same **header strip** (description + “X / 10 Active”) and a common **action pattern** (Promote + one or two secondary actions). Layout and content differ: **table** (Leads), **ranked list with index** (Pulse), **event cards with date** (Seasonal), **grouped cards** (Influencers), **compact list** (Daily Focus), **topic cards** (Trend).

2. **Are they mostly identical with minor inner differences?**  
   **No.** The **outer shell** (header + empty/loading/error) is the same, but the **content area** is clearly different: table vs list vs grids, and different labels/buttons per tab. So they are not “mostly identical”; they are **same chrome, different content and layout**.

3. **Which elements make them look the same?**  
   - Same **header row** (description left, “X / 10 Active” right).  
   - Same **button styling** (indigo primary, gray border secondary).  
   - Same **empty/loading/error** treatment (single line of text).  
   - Repeated **“Promote to Campaign”** and **“Dismiss”** (or Archive/Reviewed) across tabs.

4. **Which elements are genuinely different?**  
   - **Layout:** Table (Leads) vs list (Pulse, Daily Focus) vs grid (Trend, Seasonal, Influencers); Influencers add platform groups.  
   - **Item content and labels:** e.g. Expected reach, Suggested formats vs Platform, Snippet, ICP match, Urgency vs Spike, Shelf life vs Date, Region, Suggested angle/offer vs Audience overlap, Engagement rate vs Why today, Expected impact.  
   - **Actions:** Save as Possibility, Create Outreach Plan, Generate Quick Content Draft, Schedule/Create Campaign Now, Create Collaboration Plan, Act Now, Mark Reviewed.  
   - **Index badge** (Pulse only).  
   - **Date input** (Seasonal only).  
   - **Quick content generator modal** (triggered from Daily Focus only).

---

*End of UI Visual Audit*

# Stage 1B — Creator Card Object Implementation Summary

**Status:** Implemented (additive only; no planning logic changed.)

---

## 1. Where It Is Built

**File:** `pages/api/campaigns/generate-weekly-structure.ts`

**Function:** `buildCreatorCard(week, item, enrichedItem)`

**When:** After `enrichDailyItemWithPlatformRequirements(validated.dailyItem)` and after optional `master_content_id` is set, and before assertions and `rowsWithContent.push`.

**Code location (conceptual):**
```ts
const enriched = await enrichDailyItemWithPlatformRequirements(validated.dailyItem as any);
if ((item as any).masterContentId != null) {
  (enriched as any).master_content_id = (item as any).masterContentId;
}
const creator_card = buildCreatorCard(weekBlueprint as any, item, enriched);
if (Object.keys(creator_card).length > 0) {
  (enriched as any).creator_card = creator_card;
}
// ... assertions, then row.content = JSON.stringify(enriched)
```

**Paths:** Both **deterministic** (execution_items) and **AI** (generateAIDailyDistribution) flows go through the same loop over `finalItems` and build one creator card per (item × platform) row. In the auto-optimize distribution path, `creator_card` is preserved from the original `entry.contentObj` onto the reassigned enriched object so optimized rows still have it.

---

## 2. Data Sources

| Creator card field | Source (priority order) |
|--------------------|--------------------------|
| **theme** | `week.phase_label` → `week.primary_objective` → `weeklyContextCapsule.campaignTheme` → `week.theme` |
| **objective** | `item.dailyObjective` → `enrichedItem.objective` → `intent.objective` |
| **target_audience** | `item.whoAreWeWritingFor` → `enrichedItem.target_audience` → `intent.target_audience` → `capsule.audienceProfile` |
| **summary** | `item.briefSummary` → `intent.brief_summary` → `item.writingIntent` |
| **keywords** | Derived from `item.topicTitle` (split, sanitize, max 12) |
| **hashtags** | `enrichedItem.hashtags` → `week.week_extras.hashtag_suggestions` (max 20) |
| **intent** | Object built from `intent` / `item.writerBrief`: objective, target_audience, brief_summary, cta_type, strategic_role, pain_point, outcome_promise, narrative_style |
| **platform_notes** | `enrichedItem.validation_notes` (array) or stringified `enrichedItem.format_requirements` |
| **instructions_for_creator** | Concatenation of: "Objective: …", "Summary: …", "Target audience: …", "Desired action: …", "Tone: …" (only non-empty parts) |

Missing or empty sources produce empty string, empty array, or omitted key so the card degrades gracefully.

---

## 3. Storage

**Location:** `daily_content_plans.content.creator_card`

- `content` is a JSON string; the parsed object may include `creator_card`.
- Optional: only set when `buildCreatorCard` returns at least one key; older rows without `creator_card` remain valid.

---

## 4. Example creator_card JSON

```json
{
  "theme": "Awareness",
  "objective": "Problem awareness",
  "target_audience": "Marketing leads",
  "summary": "Address \"Pain-awareness signal\" within the \"Awareness\" narrative for Marketing leads.",
  "keywords": ["Pain-awareness", "signal", "friction", "costing", "momentum"],
  "hashtags": ["#marketing", "#awareness", "#week1"],
  "intent": {
    "objective": "Problem awareness",
    "target_audience": "Marketing leads",
    "brief_summary": "Address \"Pain-awareness signal\" within the \"Awareness\" narrative for Marketing leads.",
    "cta_type": "Soft CTA",
    "strategic_role": "Audience Expansion",
    "pain_point": "Unclear next steps and priorities",
    "outcome_promise": "Reader understands Pain-awareness signal: friction is costing momentum and why it matters.",
    "narrative_style": "clear, practical, outcome-driven"
  },
  "platform_notes": ["Format: long-form social post; max 800 words; highest limit: linkedin"],
  "instructions_for_creator": "Objective: Problem awareness\nSummary: Address \"Pain-awareness signal\" within the \"Awareness\" narrative for Marketing leads.\nTarget audience: Marketing leads\nDesired action: Soft CTA\nTone: clear, practical, outcome-driven"
}
```

Minimal example (degraded when little context exists):

```json
{
  "theme": "Week 1 focus",
  "objective": "Learn more",
  "target_audience": "General Audience",
  "summary": "Daily topic summary",
  "instructions_for_creator": "Objective: Learn more\nTarget audience: General Audience\nDesired action: Learn more"
}
```

---

## 5. How the API Returns It

### daily-plans.ts

- **V2 (isV2):** Response object includes `creator_card` when `daily.creator_card` exists and is an object:  
  `...(daily.creator_card != null && typeof daily.creator_card === 'object' ? { creator_card: daily.creator_card } : {})`
- **Legacy:** Response includes `creator_card` when parsed `plan.content` has `creator_card` and it is an object:  
  `...(legacyParsed?.creator_card != null && typeof legacyParsed.creator_card === 'object' ? { creator_card: legacyParsed.creator_card } : {})`

So each plan in the array may have a top-level `creator_card` when present in stored content.

### activity-workspace/resolve.ts

- Payload includes `creator_card` when present on the resolved item (raw or dailyExecutionItem):  
  `creator_card = (raw as any)?.creator_card ?? (dailyExecutionItem as any)?.creator_card`  
  and then spread into `dailyExecutionItem` and into the top-level payload when `creator_card != null && typeof creator_card === 'object'`.

Note: Resolve builds the activity from blueprint `execution_items` / `daily_execution_items`, which do not currently store `creator_card`. So resolve will return `creator_card` only when the backend later attaches it to those items or when the client merges in data from daily-plans. The implementation is additive and safe.

---

## 6. Validation

| Check | Result |
|------|--------|
| Creator card appears for **deterministic path** | Yes: same loop over `finalItems` builds creator_card for every row; items from execution_items have full intent and week context. |
| Creator card appears for **AI path** | Yes: same loop; items from AI slots have topicTitle, dailyObjective, whoAreWeWritingFor, briefSummary, etc., so buildCreatorCard still fills theme, objective, target_audience, summary, instructions_for_creator. |
| Missing fields degrade gracefully | Yes: each field uses fallbacks and returns empty string/array or omits the key; no required fields; `Object.keys(creator_card).length > 0` before attaching so we do not attach an empty object. |

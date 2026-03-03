# Weekly → Daily → Activity: Information Loss / Replacement Analysis

**Goal:** Ensure weekly intelligence flows through unchanged. Identify where weekly fields exist but daily/activity replaces them with defaults or drops them.

**No redesign. For each case: (1) weekly source field, (2) where it is dropped or overwritten, (3) minimal place to preserve it.**

---

## 1. Content guidance (format, word target, platform)

| Item | Detail |
|------|--------|
| **Weekly source** | `CampaignBlueprintWeek.topics[]` → `WeeklyTopicWritingBrief.contentTypeGuidance` (`primaryFormat`, `maxWordTarget`, `platformWithHighestLimit`). Also `week.topics[].contentTypeGuidance` from orchestrator. |
| **Where lost** | `pages/api/campaigns/generate-weekly-structure.ts`: in the **execution_items** path we call `deriveContentGuidance(null)` (lines 701, 724). `briefByKey` is built from `weekBlueprint.topics` (lines 500–505) and keyed by `normalizeTopicKey(title)`. We have `topicTitle` and `topicKey` (lines 683–685) but never look up `briefByKey.get(topicKey)` and pass it to `deriveContentGuidance`. So we always get the default: `{ primaryFormat: 'long-form social post', maxWordTarget: 800, platformWithHighestLimit: 'linkedin' }`. |
| **Minimal fix** | In the execution_items block, after `const topicKey = normalizeTopicKey(topicTitle)`: `const briefForSlot = briefByKey.get(topicKey) ?? undefined;` and use `deriveContentGuidance(briefForSlot)` instead of `deriveContentGuidance(null)`. Same change for both the staggered and non-staggered item builds (two call sites). |

**AI path:** We intentionally call `deriveContentGuidance(null)` (line 631) because there is no per-slot brief; fixing the execution_items path does not change the AI path.

---

## 2. Narrative style / tone

| Item | Detail |
|------|--------|
| **Weekly source** | Slot `intent.writing_angle` (from orchestrator). Also `week.weeklyContextCapsule.toneGuidance` and `week.topics[].narrativeStyle` (in briefByKey). |
| **Where lost** | `generate-weekly-structure.ts` (lines 723, 772): we set `narrativeStyle: writingAngle || 'clear, practical, outcome-driven'`. When `slot.intent.writing_angle` is missing we **replace** with the hardcoded default. We never fall back to `briefByKey.get(topicKey)?.narrativeStyle` or `weekBlueprint.weeklyContextCapsule?.toneGuidance`. |
| **Minimal fix** | When building the item, after `writingAngle`:  
  `const narrativeFallback = (briefByKey.get(topicKey) as any)?.narrativeStyle ?? (weekBlueprint as any)?.weeklyContextCapsule?.toneGuidance ?? 'clear, practical, outcome-driven';`  
  Then use `narrativeStyle: writingAngle || narrativeFallback` (instead of the literal default). |

---

## 3. Pain point / outcome (whatProblemAreWeAddressing, whatShouldReaderLearn)

| Item | Detail |
|------|--------|
| **Weekly source** | Slot `intent.pain_point` and `intent.outcome_promise` (set by orchestrator in topic_slots intent). |
| **Where lost** | `generate-weekly-structure.ts` (lines 719–721, 769–771): we set `whatProblemAreWeAddressing: ''` and `whatShouldReaderLearn: ''` for every item. We never read `execIntent.pain_point` or `execIntent.outcome_promise`. The row then gets `summary: item.whatProblemAreWeAddressing`, `intro_objective: item.whatShouldReaderLearn` (lines 971–972), so the stored content has empty values. |
| **Minimal fix** | When building the item, set:  
  `whatProblemAreWeAddressing: (typeof execIntent.pain_point === 'string' && execIntent.pain_point.trim()) ? execIntent.pain_point : '',`  
  `whatShouldReaderLearn: (typeof execIntent.outcome_promise === 'string' && execIntent.outcome_promise.trim()) ? execIntent.outcome_promise : '',`  
  (and keep the existing intent assertions as-is; these fields are optional for the strict checks that exist). Apply in both staggered and non-staggered branches. |

---

## 4. ai_generated flag

| Item | Detail |
|------|--------|
| **Weekly source** | No weekly field: “AI-generated” is a characteristic of how the **daily** row was produced (AI path vs execution_items path). Execution_items path = from blueprint (not AI distribution). |
| **Where lost** | (a) **generate-weekly-structure.ts** (line 980): we always set `ai_generated: true` when building the row. So even for the execution_items path (fully from blueprint) we overwrite with `true`.  
  (b) **daily-plans API** (`pages/api/campaigns/daily-plans.ts`): the transformed plan object (both V2 and legacy branches) does **not** include `ai_generated` from the DB row. So consumers (e.g. calendar) never receive it.  
  (c) **Campaign calendar** (`pages/campaign-calendar/[id].tsx`): when building `CalendarActivity` from daily-plans (lines 269–298), we never set any `ai_generated` on the activity; even if the API returned it, we don’t map it onto the type or `raw_item`. |
| **Minimal fix** | (a) In generate-weekly-structure when building `row`, set `ai_generated: useExecutionItems ? false : true` (or a variable set to `false` in the execution_items branch and `true` in the AI branch).  
  (b) In daily-plans.ts, in both return shapes (V2 and legacy), add `...(plan.ai_generated !== undefined ? { ai_generated: plan.ai_generated } : {})` so the plan row’s `ai_generated` is returned.  
  (c) When mapping daily-plans to CalendarActivity, set e.g. `raw_item: { ...raw, ai_generated: plan.ai_generated }` so the value is available where cards are rendered (if we later use it for display). |

---

## 5. Execution ownership (owner / responsibility)

| Item | Detail |
|------|--------|
| **Weekly source** | Not present. There is no `execution_owner`, `owner_id`, or `assignee` on `CampaignBlueprintWeek`, execution_items, or topic_slots in the current schema. |
| **Where lost** | N/A — never set. generate-weekly-structure does not read or write owner; daily-plans and calendar do not expose it. |
| **Minimal fix** | No “preserve” fix until weekly/slot data exists. Safest insertion: (1) add optional `execution_owner` (or `owner_id`) on the slot or execution item when the orchestrator or weekly enrichment provides it; (2) in generate-weekly-structure when building enriched/row, pass through `(slot as any).execution_owner` or `(execIntent as any).execution_owner` into the content JSON and, if desired, a DB column; (3) in daily-plans response and calendar mapping, include it so cards can use it. |

---

## 6. KPI target (weekly_kpi_focus)

| Item | Detail |
|------|--------|
| **Weekly source** | `CampaignBlueprintWeek.weekly_kpi_focus`. |
| **Where lost** | Not lost. We set `kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth')` (lines 726, 775). The default `'Reach growth'` is only used when the week has no `weekly_kpi_focus`. |
| **Minimal fix** | None for preservation. Optional: ensure blueprint/commit always sets `weekly_kpi_focus` so the default is rarely needed. |

---

## 7. Distribution strategy

| Item | Detail |
|------|--------|
| **Weekly source** | `(weekBlueprint as any).distribution_strategy` (not on canonical type; may be in week_extras or set by orchestrator). |
| **Where lost** | When missing, we use request body `distribution_mode` (generate-weekly-structure lines 479–488). So weekly value is not overwritten when present; it’s only “replaced” by request when absent. |
| **Minimal fix** | To preserve weekly as single source of truth: when building/committing the blueprint, always set `distribution_strategy` on the week (e.g. from planningIntelligenceService or user choice at commit). Then daily generation can treat request as override-only or ignore it when blueprint has it. No change required in generate-weekly-structure for “preserve” — only ensure weekly is populated. |

---

## 8. Creator card / week context (theme, objective, tone)

| Item | Detail |
|------|--------|
| **Weekly source** | `buildCreatorCard(weekBlueprint, item, enriched)` (generate-weekly-structure) already receives the week and item and attaches `creator_card` to enriched (lines 938–941). So theme, objective, etc. from the week are passed into the creator card. |
| **Where lost** | Creator card is preserved in enriched content and in daily-plans (we pass `creator_card` in the V2/legacy response when present). So this is not a loss. |
| **Minimal fix** | None. |

---

## 9. master_content_id

| Item | Detail |
|------|--------|
| **Weekly source** | Slot `master_content_id` (orchestrator / execution_items). |
| **Where lost** | Not lost. We copy `(enriched as any).master_content_id = (item as any).masterContentId` (lines 935–936) and daily-plans returns `master_content_id` when present (lines 119, 154–155). |
| **Minimal fix** | None. |

---

## Summary table

| # | Weekly source | Where dropped/overwritten | Minimal fix |
|---|----------------|----------------------------|-------------|
| 1 | topics[].contentTypeGuidance | generate-weekly-structure: deriveContentGuidance(null) in execution_items path | Use briefByKey.get(topicKey) and pass to deriveContentGuidance(briefForSlot) |
| 2 | intent.writing_angle; capsule.toneGuidance; brief.narrativeStyle | generate-weekly-structure: narrativeStyle = writingAngle \|\| hardcoded default | Fallback to brief.narrativeStyle or weekBlueprint.weeklyContextCapsule.toneGuidance when writingAngle is null |
| 3 | intent.pain_point, intent.outcome_promise | generate-weekly-structure: whatProblemAreWeAddressing/whatShouldReaderLearn set to '' | Set from execIntent.pain_point and execIntent.outcome_promise when building item |
| 4 | (concept: AI vs blueprint) ai_generated on row | (a) generate-weekly-structure always sets ai_generated: true (b) daily-plans API omits it (c) calendar doesn’t map it | (a) Set ai_generated: false for execution_items path (b) Include plan.ai_generated in daily-plans response (c) Put ai_generated on raw_item when mapping to CalendarActivity |
| 5 | execution_owner | Not in schema; never set | Add to slot/intent when available; pass through to content and API response |
| 6 | weekly_kpi_focus | Only default when missing | Ensure blueprint sets it; no code change for “preserve” |
| 7 | distribution_strategy | Replaced by request when not on blueprint | Populate on week at commit so request is override-only |
| 8 | creator_card / week context | Preserved | — |
| 9 | master_content_id | Preserved | — |

---

**End of analysis.**

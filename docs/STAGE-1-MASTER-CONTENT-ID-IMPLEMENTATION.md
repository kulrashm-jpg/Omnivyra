# Stage 1 — Master Content ID Implementation Summary

**Status:** Implemented (additive only; no breaking changes.)

---

## 1. Files Changed

| File | Change |
|------|--------|
| `backend/services/campaignAiOrchestrator.ts` | Assign `master_content_id` when building topic_slots in deterministic merge; add `master_content_id` to resolved_postings and DailyExecutionItem; pass through in normalizeResolvedPostingToDailyItem / normalizeToDailyExecutionItem. |
| `backend/services/deterministicWeeklySkeleton.ts` | Added optional `master_content_id?: string` to topic_slots element type. |
| `backend/types/CampaignBlueprint.ts` | Comment update for execution_items (topic_slots may have optional master_content_id). |
| `pages/api/campaigns/generate-weekly-structure.ts` | Added `masterContentId` to DailyPlanItem; propagate from slot when building from execution_items; set `content.master_content_id` on enriched before persist; AI path: synthetic id per slot. |
| `pages/api/campaigns/daily-plans.ts` | Return `master_content_id` in response when present (V2 and legacy). |
| `pages/api/activity-workspace/resolve.ts` | Include `master_content_id` in payload and dailyExecutionItem when present. |

---

## 2. Exact Places Where IDs Are Generated

### Deterministic path (blueprint)

- **File:** `backend/services/campaignAiOrchestrator.ts`
- **Location:** Inside `runWithContext`, when `hasDeterministicPlanSkeleton && Array.isArray(structured?.weeks)`, in the block that maps `structured.weeks` and builds `execution_items` from `baseExecutionItems`.
- **Code:** For each week, `execution_items = baseExecutionItems.map((it, execIdx) => { ... topic_slots: slotTopics.map((topic, slotIndex) => { ... const master_content_id = \`${campaignIdForMasterContent}_w${weekOrdinal}_${contentTypeForId}_${execIdx}_${slotIndex}\`; return { topic, progression_step, global_progression_index, intent, master_content_id }; }); });`
- **Format:** `${campaignId}_w${weekNumber}_${contentType}_${executionIndex}_${slotIndex}`  
  - `contentTypeForId` = `String(it?.content_type ?? 'post').toLowerCase().replace(/\s+/g, '_')`  
  - `campaignIdForMasterContent` = `String(input.campaignId ?? '').trim() || 'campaign'`

### Resolved postings / daily_execution_items

- **File:** `backend/services/campaignAiOrchestrator.ts`
- **Location:** `attachResolvedPostingsToWeeks`: when building each resolved posting from slot, `master_content_id` is copied from `(slot as any)?.master_content_id` into the posting object. `normalizeResolvedPostingToDailyItem` then passes `posting.master_content_id` into `normalizeToDailyExecutionItem`, so it appears on each `daily_execution_item`.

### Daily expansion (execution_items path)

- **File:** `pages/api/campaigns/generate-weekly-structure.ts`
- **Location:** When building `DailyPlanItem` from `exec.topic_slots[k]`: `slotMasterContentId = (slot as any)?.master_content_id`; added to item as `masterContentId`. Not generated here—propagated from blueprint.

### AI-only path (synthetic IDs)

- **File:** `pages/api/campaigns/generate-weekly-structure.ts`
- **Location:** In the branch where `!useExecutionItems`, loop over `aiSlots`: `for (let slotIndex = 0; slotIndex < aiSlots.length; slotIndex += 1)`; for each item, `syntheticMasterContentId = \`${campaignId}_w${weekNumber}_ai_${slotIndex}\``; set `item.masterContentId = syntheticMasterContentId`.
- **Format:** `${campaignId}_w${weekNumber}_ai_${slotIndex}`  
  Same slot index = same logical piece; if one piece were later represented on multiple platforms, they would share the same slotIndex (current AI path returns one platform per slot).

### Stored in daily_content_plans

- **File:** `pages/api/campaigns/generate-weekly-structure.ts`
- **Location:** After `enrichDailyItemWithPlatformRequirements(validated.dailyItem)`, `if ((item as any).masterContentId != null) (enriched as any).master_content_id = (item as any).masterContentId`. The `enriched` object is then `JSON.stringify(enriched)` into `row.content`, so `master_content_id` lives in `daily_content_plans.content` (JSON).

---

## 3. Example Blueprint Snippet (Before vs After)

### Before (topic_slot without master_content_id)

```json
{
  "topic_slots": [
    {
      "topic": "Pain-awareness signal: friction is costing momentum",
      "progression_step": 1,
      "global_progression_index": 1,
      "intent": {
        "objective": "Problem awareness",
        "cta_type": "Soft CTA",
        "target_audience": "Marketing leads",
        "brief_summary": "Address \"...\" within the \"Awareness\" narrative.",
        "strategic_role": "Audience Expansion",
        "pain_point": "Unclear next steps",
        "outcome_promise": "Reader understands ...",
        "audience_stage": "problem_aware",
        "recommendation_alignment": { "source_type": "primary_topic", "source_value": "...", "alignment_reason": "..." }
      }
    }
  ]
}
```

### After (same slot with master_content_id)

```json
{
  "topic_slots": [
    {
      "topic": "Pain-awareness signal: friction is costing momentum",
      "progression_step": 1,
      "global_progression_index": 1,
      "intent": { ... },
      "master_content_id": "550e8400-e29b-41d4-a716-446655440000_w1_post_0_0"
    }
  ]
}
```

(Real value would use the actual `campaignId`; `_w1_post_0_0` = week 1, content_type post, execIdx 0, slotIndex 0.)

---

## 4. Example daily_content_plans Row With master_content_id

Table schema unchanged. Only the `content` column (JSON) gains an optional key.

**Row (conceptual):**

| Column | Value |
|--------|--------|
| id | uuid |
| campaign_id | campaign-uuid |
| week_number | 1 |
| day_of_week | Wednesday |
| date | 2025-03-05 |
| platform | linkedin |
| content_type | post |
| title | Pain-awareness signal: friction is costing momentum |
| content | *(JSON string below)* |
| ... | ... |

**content (JSON, excerpt with master_content_id):**

```json
{
  "dayIndex": 3,
  "weekNumber": 1,
  "topicTitle": "Pain-awareness signal: friction is costing momentum",
  "platform": "linkedin",
  "contentType": "post",
  "objective": "Problem awareness",
  "target_audience": "Marketing leads",
  "intent": { ... },
  "writer_content_brief": { ... },
  "master_content_id": "550e8400-e29b-41d4-a716-446655440000_w1_post_0_0"
}
```

Same `master_content_id` appears in every row that represents the same logical piece (e.g. same slot posted to linkedin and facebook), so “one content, N platforms” can be grouped by `master_content_id`.

---

## Validation Checklist

1. **Same content shared across platforms has same master_content_id**  
   Yes: deterministic path—one topic_slot has one `master_content_id`; generate-weekly-structure creates one row per platform for that slot and copies the same `master_content_id` into each row’s `content`. AI path—one slot index = one id; if one piece were distributed to multiple platforms, they would use the same slot index and thus same id.

2. **Old campaigns still work**  
   Yes: `master_content_id` is optional everywhere; missing id is not required; no existing fields removed.

3. **No existing fields removed**  
   Yes: only additive fields and optional types.

4. **No runtime errors when ID missing**  
   Yes: all reads use optional chaining or `!= null` checks; IDs are only set when present; legacy and AI paths without execution_items still run (AI path now always sets synthetic id).

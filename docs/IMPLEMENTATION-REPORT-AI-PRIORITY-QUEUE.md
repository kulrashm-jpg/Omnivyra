# IMPLEMENTATION REPORT — AI PRIORITY QUEUE

## 1. Files Modified

- **Created:** `backend/services/engagementPriorityService.ts`
- **Created:** `backend/services/aiActivityQueueService.ts`
- **Created:** `pages/api/community-ai/activity-queue.ts`

## 2. Priority Scoring Logic

- **Deterministic, runtime-only.** Uses only existing fields on the action and optional related comment text.
- **Base by action_type:** reply +40, follow +25, share +20, like +10, schedule +5.
- **Text signals** (from `suggested_text` or attached comment text): contains `?` → +20; contains any of “problem”, “bad”, “issue”, “not working” → +25; length > 120 chars → +15.
- **Cap:** total score clamped to 0–100.
- **Labels:** HIGH ≥ 70, MEDIUM 40–69, LOW < 40.
- **Reasoning:** Array of short strings describing each applied rule (e.g. `"reply: +40"`, `"contains question: +20"`).

## 3. Queue Data Flow

```text
GET /api/community-ai/activity-queue?tenant_id=...&organization_id=...
  → requireTenantScope + enforceActionRole(VIEW_ACTIONS)
  → getAiActivityQueue({ tenant_id, organization_id, status: 'pending' })
       → select community_ai_actions where tenant_id, organization_id, status = 'pending'
       → batch load related scheduled_posts (platform_post_id in target_ids)
       → batch load related post_comments (platform_comment_id in target_ids)
       → attach related_scheduled_post / related_comment per action
       → build commentTextByActionId for scoring
       → decorateActionsWithPriority(actions, { commentTextByActionId })
       → sort by priority_score DESC, created_at DESC
  → { success: true, queue: [...] }
```

## 4. Runtime vs Persistent Data

- **Persistent:** Only existing tables are read (`community_ai_actions`, `scheduled_posts`, `post_comments`). No new columns or tables.
- **Runtime:** `priority_score`, `priority_label`, and `priority_reasoning` are computed in memory by `scoreActionPriority` / `decorateActionsWithPriority` and added to each action in the response. They are not stored; every request recalculates from the same rules.
- **Related data:** `related_scheduled_post` and `related_comment` are resolved per request from existing FKs/keys (e.g. `platform_post_id`, `platform_comment_id`); they are not new relations in the schema.

## 5. Safety Guarantees

- **No action execution:** Queue is read-only; no calls to the action executor.
- **No auto-approvals:** No status or approval changes.
- **No schema changes:** No migrations, new tables, or new columns.
- **No background jobs:** All work is request-scoped.
- **No AI/OmniVyra calls:** Scoring is rule-based only.
- **Scoped access:** Tenant/org from query params and VIEW_ACTIONS role check, same as other Community AI read endpoints.

## 6. Verification Notes

- **Pending actions with priority:** Queue returns only `status = 'pending'` actions, each with `priority_score`, `priority_label`, and `priority_reasoning`.
- **HIGH/MEDIUM/LOW:** Labels follow the 70 / 40 thresholds from the scoring rules.
- **Sorting:** Response order is by `priority_score` descending, then `created_at` descending.
- **Existing Community AI flows:** No changes to actions API, execute, approve, or playbooks; only a new read-only queue endpoint and two new services used by it.

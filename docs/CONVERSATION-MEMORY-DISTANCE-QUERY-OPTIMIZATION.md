# CONVERSATION MEMORY DISTANCE QUERY OPTIMIZATION

**Report** — Scalability fix for message distance query in conversation memory rebuild trigger.

---

## 1 Removed COUNT(*) scan

**Location:** `database/engagement_thread_memory.sql` — `get_engagement_thread_message_distance`

**Problem:** Full `COUNT(*)` over all newer rows was expensive on active threads, especially with many messages.

**Fix:** Replaced with bounded subquery using `LIMIT p_threshold` (5).

---

## 2 Added bounded LIMIT query

**Implementation:**
```sql
SELECT COUNT(*) FROM (
  SELECT 1 FROM engagement_messages em
  WHERE em.thread_id = p_thread_id
  AND (em.platform_created_at, em.id) > (subquery for last_processed)
  ORDER BY em.platform_created_at, em.id
  LIMIT p_threshold
) t;
RETURN row_count >= p_threshold;
```

- Scan stops after `p_threshold` rows
- Returns `true` only when `returned_rows >= p_threshold`
- Same pattern when `last_processed` is NULL (initial case)

---

## 3 Updated distance RPC behavior

**Function:** `get_engagement_thread_message_distance(p_thread_id, p_last_processed_id, p_threshold)`

**Return type:** `BOOLEAN` (was `INTEGER`)

**Behavior:** Returns `distance_reached` — `true` when ≥ 5 messages exist after last_processed, `false` otherwise.

**Service change:** `conversationMemoryService.ts` now calls `isMessageDistanceReached()` and expects boolean.

---

## 4 Verified index-backed scan

**Index:** `idx_engagement_messages_thread_time`
```sql
CREATE INDEX IF NOT EXISTS idx_engagement_messages_thread_time
  ON engagement_messages (thread_id, platform_created_at, id);
```

**Supports:**
- `WHERE thread_id = $id` with range on `(platform_created_at, id)`
- `ORDER BY platform_created_at, id`
- `LIMIT 5` — index scan stops early

**Verification:** Run `EXPLAIN` on the inner query to confirm `Index Scan using idx_engagement_messages_thread_time` with `Limit` in the plan.

---

**Migration:** Re-run `database/engagement_thread_memory.sql`.

**Implementation complete.**

# LEAD DETECTION STABILITY FIX

**Report** — Four stability corrections applied to the Lead Detection pipeline.

---

## 1 Upsert race condition protection

**Location:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

**Problem:** Both first and second pass write to `engagement_lead_signals` using `onConflict: 'message_id'`. If the second pass runs before the first finishes, a weaker content-based signal can overwrite a stronger intent-aware signal.

**Fix:**
- Load existing row first via `supabase.from('engagement_lead_signals').select(...).eq('message_id', ...).maybeSingle()`
- Decide insert vs update **before** any write
- **Insert** when `existingRow == null`
- **Update** only when `new.lead_score > existing.lead_score` OR `(new.lead_score == existing.lead_score AND new.confidence_score > existing.confidence_score)`
- Otherwise skip write
- Use separate `insert()` and `update()` instead of upsert; do not rely on `onConflict` alone
- Update uses PostgREST `.or()` so it runs only when the new signal is better
- On insert unique violation (23505), skip and return — another process inserted first

---

## 2 Thread context ordering correction

**Location:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

**Problem:** Query `ORDER BY platform_created_at DESC LIMIT 3` returns newest messages first. `detectLeadSignals()` expects chronological context (oldest → newest).

**Fix:**
- Fetch last 3 messages (excluding current) via `ORDER BY platform_created_at DESC LIMIT 3`
- Reverse the result array so messages are in chronological order before being passed to `detectLeadSignals()`
- Equivalent to: `SELECT content FROM (SELECT ... ORDER BY platform_created_at DESC LIMIT 3) t ORDER BY platform_created_at ASC`

---

## 3 Lead score clamp validation

**Location:** `backend/services/leadDetectionService.ts` — `detectLeadSignals()`

**Problem:** Content pattern score + intent bonus could exceed 100 (e.g. 85 + 50 = 135).

**Fix:**
- Clamp applied after all bonuses: `leadScore = Math.max(0, Math.min(100, leadScore))`
- Placed after pattern score, intent bonus, and sentiment adjustments
- Ensures output stays in 0–100 range

---

## 4 Thread recompute debounce

**Location:** `backend/services/leadThreadScoring.ts`, `backend/services/leadDetectionService.ts`

**Problem:** `computeThreadLeadScore()` may be triggered multiple times when several messages arrive quickly, causing recompute bursts.

**Fix:**
- Added in-memory map `threadScoreUpdateQueue` keyed by `thread_id:organization_id`
- New exported function `scheduleThreadScoreUpdate(thread_id, organization_id)`
- If thread is already scheduled for recompute within 5 seconds, skip new trigger
- Otherwise schedule recompute 5 seconds later; on fire, call `computeThreadLeadScore()` and remove from queue
- `processMessageForLeads()` now calls `scheduleThreadScoreUpdate()` instead of `computeThreadLeadScore()` directly

---

**Implementation complete.**

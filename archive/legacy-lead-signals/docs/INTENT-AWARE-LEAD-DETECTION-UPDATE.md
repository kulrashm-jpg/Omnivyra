# INTENT-AWARE LEAD DETECTION UPDATE

**Second-pass lead detection after message intelligence analysis**

---

## 1 Updated analyzeMessage Integration

**File:** `backend/services/engagementConversationIntelligenceService.ts`

After `analyzeMessage()` successfully stores results in `engagement_message_intelligence`:

- **Trigger:** `processMessageForLeads()` invoked asynchronously (fire-and-forget)
- **Condition:** Runs only when `organizationId` is present
- **Input passed:**
  - `message_id`
  - `organization_id` (from thread)
  - `thread_id`
  - `author_id`
  - `content`
  - `intent` (from analysis result)
  - `sentiment` (from analysis result)
  - `thread_context: null`

**Flow:**
1. Message intelligence upsert to `engagement_message_intelligence` completes
2. `void import('./leadDetectionService').then(...).catch(...)` — non-blocking
3. `updateThreadIntelligence()` runs (unchanged)
4. Errors in lead detection are logged and do not affect analysis

---

## 2 Enhanced Lead Scoring Logic

**File:** `backend/services/leadDetectionService.ts`

### Intent-aware bonuses

| Intent              | Bonus |
|---------------------|-------|
| product_inquiry     | +40   |
| price_inquiry       | +50   |
| lead_interest / lead| +60   |

Fuzzy matching: `intent.includes('product')` → +40; `intent.includes('price')` → +50; `intent === 'lead'` → +60.

### Sentiment adjustments

| Sentiment | Adjustment |
|-----------|------------|
| positive  | lead_score +10 |
| negative  | lead_score -10 |

### Scoring flow

1. **Base score:** Pattern match from content (e.g. "pricing" → 85) or 0 if no match
2. **Intent bonus:** Added when classification is product/price/lead-related
3. **Sentiment:** +10 or -10 applied to total
4. **Intent-only signals:** If no pattern match but intent bonus > 0, a signal is still created (e.g. intent `lead` with score 60)
5. **Clamp:** Final `lead_score` clamped to 0–100

### Confidence

- 0.9 when intent indicates product, price, or lead
- 0.8 when intent indicates question or inquiry
- +0.1 when sentiment is positive

---

## 3 Upsert Behavior Verification

**File:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

### Conflict handling

- **Conflict key:** `onConflict: 'message_id'`

### “Better signal” rules

Upsert only when:

1. No existing row for the message, or
2. New `lead_score` > existing `lead_score`, or
3. Same `lead_score` and new `confidence_score` > existing `confidence_score`

If the new signal is not better, the function returns without updating the table.

---

## 4 Thread Scoring Impact

**File:** `backend/services/leadThreadScoring.ts` — unchanged

`computeThreadLeadScoresBatch()` reads from `engagement_lead_signals` and uses `lead_score` and `confidence_score`. Second-pass updates improve:

- **Per-message scores:** Intent and sentiment bonuses increase lead_score when classification supports it
- **Thread aggregate:** Higher message scores raise `thread_lead_score`
- **No regressions:** “Better signal” logic avoids overwriting stronger first-pass signals with weaker second-pass results

---

**Implementation complete.** Content-based detection during ingestion remains. Intent-aware second pass runs after `analyzeMessage()`.

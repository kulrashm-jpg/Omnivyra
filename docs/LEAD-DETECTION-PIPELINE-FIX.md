# LEAD DETECTION PIPELINE FIX

**Corrections applied from audit**

---

## 1 Duplicate Execution Guard

**Location:** `leadDetectionService.processMessageForLeads()` and `engagementConversationIntelligenceService.analyzeMessage()`

**Implementation:**
- Inside `processMessageForLeads()`: `if (input.intent == null && input.sentiment == null) { return { detected: false }; }`
- At call site in `analyzeMessage()`: only invoke when `result.intent != null || result.sentiment != null`

**Effect:** The second pass (from analyzeMessage) runs only when classification data exists. The first pass (from sync) passes nulls and returns immediately, avoiding double execution.

---

## 2 Thread Context Support

**Location:** `leadDetectionService.processMessageForLeads()`

**Implementation:**
- When `thread_context` is not provided, load last 3 messages from `engagement_messages` for the thread
- Query: `SELECT content FROM engagement_messages WHERE thread_id = $thread_id ORDER BY platform_created_at DESC LIMIT 3`
- Join message contents and pass to `detectLeadSignals()` as `thread_context`

---

## 3 Intent Normalization

**Location:** `leadDetectionService.ts`

**Implementation:**
- Explicit intent map: `product_inquiry`, `price_inquiry`, `lead_interest`, `demo_request`, `trial_request`
- `normalizeIntent()` maps raw classification to canonical intents; unrecognized intents return null
- `getIntentBonus()` uses only normalized intents; no loose `includes()` checks
- Confidence uses `VALID_LEAD_INTENTS.has(normalizedIntent)` for explicit matches

---

## 4 Confidence Score Clamp

**Location:** `leadDetectionService.detectLeadSignals()`

**Implementation:**
- `confidence = Math.max(0, Math.min(1, confidence));`
- Applied after sentiment bonus so final `confidence_score` stays in [0, 1]

---

## 5 Thread Score Recompute Trigger

**Location:** `leadDetectionService.processMessageForLeads()`

**Implementation:**
- After successful upsert to `engagement_lead_signals`, fire-and-forget: `computeThreadLeadScore(thread_id, organization_id)`
- Runs asynchronously; errors are logged and do not affect the main flow

---

**Implementation complete.**

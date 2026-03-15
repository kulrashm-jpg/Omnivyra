# LEAD DETECTION EXECUTION LOGIC CORRECTION

**Corrections applied**

---

## 1 Restored First-Pass Detection

**Location:** `leadDetectionService.processMessageForLeads()`

**Fix:**
- Replaced intent/sentiment guard with content-based guard
- Guard: `if (input.content == null || String(input.content).trim().length === 0) { return { detected: false }; }`
- Content-based detection runs when intent and sentiment are null (first pass from sync)
- Second pass (intent-aware) continues to update the signal via upsert when it yields a better result

---

## 2 Correct Thread Context Query

**Location:** `leadDetectionService.processMessageForLeads()`

**Fix:**
- Exclude current message from thread context: `.neq('id', input.message_id)`
- Query: `SELECT content FROM engagement_messages WHERE thread_id = $thread_id AND id != $message_id ORDER BY platform_created_at DESC LIMIT 3`

---

## 3 Intent Null Guard

**Location:** `leadDetectionService.detectLeadSignals()`

**Fix:**
- Added explicit guard: `let intentBonus = 0; if (normalizedIntent) { intentBonus = getIntentBonus(normalizedIntent); }`
- Avoids scoring with null when `normalizeIntent()` returns null for unrecognized intents

---

## 4 Thread Recompute Optimization

**Location:** `leadDetectionService.processMessageForLeads()`

**Fix:**
- Run `computeThreadLeadScore()` only when:
  - New signal inserted (`!existingRow`), or
  - `lead_score` increased (`signal.lead_score > existingScore`)
- Do not run when only confidence is updated with the same score (avoids duplicate recompute on second pass)

---

**Implementation complete.**

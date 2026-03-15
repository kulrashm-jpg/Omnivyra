# ENGAGEMENT UI RESPONSE ENGINE INTEGRATION

**Wiring Engagement Command Center to Omnivyra Response Engine**

---

## 1 API Replacement

| Before | After |
|--------|-------|
| `GET /api/engagement/suggestions?message_id=&organization_id=` | `POST /api/response/generate` |

**Request body:**
```json
{
  "organization_id": "uuid",
  "message_id": "uuid",
  "execute": false
}
```

**Response (suggestion):**
```json
{
  "ok": true,
  "suggested_text": "...",
  "executed": false,
  "requires_human_review": false,
  "reason": null
}
```

**Response (execution):**
```json
{
  "ok": true,
  "suggested_text": "...",
  "executed": true
}
```

---

## 2 AISuggestionPanel Changes

**File:** `components/engagement/AISuggestionPanel.tsx`

| Change | Details |
|--------|---------|
| API call | `POST /api/response/generate` with `{ organization_id, message_id, execute }` |
| Suggestion display | Single suggestion shown as "Primary AI suggestion" |
| Regenerate | Button calls `POST /api/response/generate` again (execute: false) |
| Props | Added `onExecuted?: () => void` for refresh callback after successful execution |
| Legacy removed | No usage of `GET /api/engagement/suggestions` |

---

## 3 Reply Execution Integration

| Action | Flow |
|--------|------|
| **Send AI Reply** button | Calls `POST /api/response/generate` with `execute: true` |
| On `executed: true` | Invokes `onExecuted()` → parent closes reply panel and refreshes thread messages |
| Button visibility | Hidden when `requires_human_review` is true |
| Loading state | Button shows "Sending…" while `executing` |

**ConversationView wiring:** `onExecuted` callback clears `replyingTo`, `replyText`, `showSuggestions`, and calls `onRefresh()`.

---

## 4 Human Review Handling

| Condition | UI behavior |
|-----------|-------------|
| `requires_human_review: true` and no suggestion | Amber alert: "This message requires human review." |
| `requires_human_review: true` and has suggestion | Amber alert: "This message requires human review. Use the suggestion below and send manually." |
| **Send AI Reply** button | Disabled / hidden when `requires_human_review` is true |
| User can still | Click suggestion to insert into ReplyComposer; send manually via Send button |

---

## 5 Legacy Endpoint Removal

| Item | Status |
|------|--------|
| `GET /api/engagement/suggestions` in AISuggestionPanel | Removed ✓ |
| `GET /api/engagement/suggestions` backend | **Not deleted** (per requirements) |
| engagementAiAssistantService | Still exists; no longer used by Engagement UI |

---

**Integration complete.** Engagement Command Center AI suggestion panel now uses the Omnivyra Response Engine.

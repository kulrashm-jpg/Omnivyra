# CONVERSATION MEMORY IMPLEMENTATION

**Report** — Conversation memory layer for engagement thread context in AI reply generation.

---

## 1 Database schema

**Location:** `database/engagement_thread_memory.sql`

**Table:** `engagement_thread_memory`

| Column | Type | Description |
|--------|------|-------------|
| thread_id | UUID PRIMARY KEY | References engagement_threads(id) ON DELETE CASCADE |
| organization_id | UUID | From engagement_threads |
| conversation_summary | TEXT | LLM-generated summary |
| last_message_id | UUID | References engagement_messages(id) ON DELETE SET NULL |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes:**
- `idx_engagement_thread_memory_thread_id` on (thread_id)
- `idx_engagement_thread_memory_organization_id` on (organization_id)

**Migration order:** Run after `engagement_unified_model.sql`

---

## 2 Memory update trigger

**Location:** `backend/services/engagementNormalizationService.ts`

**Implementation:** After successful message insert in `insertMessage()`, fire-and-forget call to `updateThreadMemory(thread_id)`.

```typescript
void import('./conversationMemoryService')
  .then(({ updateThreadMemory }) => updateThreadMemory(thread_id))
  .catch((err) => console.warn('[engagementNormalization] updateThreadMemory async error', err?.message));
```

Execution is asynchronous; does not block the insert path.

---

## 3 Conversation memory service

**Location:** `backend/services/conversationMemoryService.ts`

**Functions:**
- `updateThreadMemory(thread_id)` — Fetches last 10 messages, generates summary via LLM, upserts `engagement_thread_memory`
- `getThreadMemory(thread_id)` — Returns `conversation_summary` for response generation

**Steps in updateThreadMemory:**
1. Fetch last 10 messages from `engagement_messages` (ORDER BY platform_created_at DESC LIMIT 10, reversed for chronological order)
2. Generate summarized memory via LLM
3. Upsert by thread_id into `engagement_thread_memory`

---

## 4 LLM summarization logic

**Prompt structure:**
- System: "Summarize the conversation context in 3-5 sentences capturing topic, intent, and prior answers. Be concise. Output only the summary, no preamble."
- User: Conversation messages (up to 500 chars each) + same instruction

**Storage:** Result stored in `conversation_summary` column.

**Memory size control:** If conversation exceeds 50+ messages, only the last 10 messages are used for summary refresh (always uses last 10).

---

## 5 Response engine integration

**Location:** `backend/services/responseGenerationService.ts`

**Flow:**
1. Before generating reply, load memory: `getThreadMemory(thread_id)` when `thread_id` is provided
2. Include in user prompt: `Conversation context: {conversation_summary}` when summary exists

**Thread ID propagation:**
- `pages/api/response/generate.ts` — Passes `thread_id` from `engagement_messages.thread_id` to `orchestrateResponse`
- `responseOrchestrator.ts` — Passes `thread_id` to `generateResponse`
- `responseGenerationService.ts` — Uses `thread_id` to load memory and inject into prompt

---

**Dependencies:** OpenAI via `aiGateway.runCompletionWithOperation`, operation name `conversationMemorySummary`.

**Implementation complete.**

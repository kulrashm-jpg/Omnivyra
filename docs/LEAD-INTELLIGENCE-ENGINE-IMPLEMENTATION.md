# LEAD INTELLIGENCE ENGINE IMPLEMENTATION

**Lead detection layer for Omnivyra engagement conversations**

---

## 1 Database Schema

**Table:** `engagement_lead_signals`

| Column | Type |
|--------|------|
| id | UUID PK |
| organization_id | UUID FK → companies(id) |
| message_id | UUID FK → engagement_messages(id) |
| thread_id | UUID FK → engagement_threads(id) |
| author_id | UUID FK → engagement_authors(id), nullable |
| lead_intent | TEXT |
| lead_score | INTEGER (default 0) |
| confidence_score | NUMERIC, nullable |
| detected_at | TIMESTAMPTZ |

**Indexes:**
- `idx_engagement_lead_signals_thread` on (thread_id)
- `idx_engagement_lead_signals_organization` on (organization_id)
- `idx_engagement_lead_signals_lead_score` on (lead_score DESC)
- `idx_engagement_lead_signals_message` UNIQUE on (message_id)

**File:** `database/engagement_lead_signals.sql`

---

## 2 Lead Detection Service

**File:** `backend/services/leadDetectionService.ts`

### detectLeadSignals(message)

**Input:**
- content
- intent
- sentiment
- thread_context

**Lead patterns detected:**
- exploring solutions, exploring options
- looking for tools/solutions/options/alternatives/software
- interested in, interest in
- pricing, pricing model, how much, costs
- demo, schedule a demo, book a demo
- how can we use, how do we use, how to use
- trial, free trial, try it/your
- reach out, contact, get in touch, connect
- implement, implementation, roll out, deploy
- compare, comparison, vs, versus

**Output:** `{ lead_intent, lead_score, confidence_score }` or null

### processMessageForLeads(input)

Upserts result to `engagement_lead_signals` when a lead is detected.

---

## 3 Thread Lead Scoring

**File:** `backend/services/leadThreadScoring.ts`

### computeThreadLeadScore(threadId, organizationId)
### computeThreadLeadScoresBatch(threadIds, organizationId)

**Calculates:**
- `thread_lead_score` — weighted average of message lead scores, plus bonus for questions and conversation depth
- `lead_detected` — true if any signals exist
- `signal_count`, `top_lead_intent`

**Factors:**
- Lead signals from `engagement_lead_signals`
- Question intent from `engagement_message_intelligence.question_detected`
- Conversation depth (message count)

---

## 4 Engagement Inbox Integration

### GET /api/engagement/inbox

**Added fields:**
- `lead_detected` — from lead signals or thread intelligence
- `lead_score` — from `computeThreadLeadScoresBatch`

### ThreadList component

**Badge:** "Potential Lead" shown when `lead_detected` or `lead_score > 0`.

**File:** `components/engagement/ThreadList.tsx`

---

## 5 Response Engine Integration

### POST /api/response/generate

When `engagement_lead_signals` has a row for the message:

- **Intent override:** Pass `intent: 'lead_interest'` to `orchestrateResponse` instead of message intelligence intent.
- Response engine matches `intent_type = 'lead_interest'` rule.
- **Template:** Use `lead_invitation_template` (e.g. "Happy to share insights — feel free to DM us or connect.").

**Setup:** Create a `response_rule` with `intent_type = 'lead_interest'` and `template_id` pointing to a template containing the lead-invitation text.

---

## 6 Lead Dashboard

**Page:** `/engagement/leads`  
**File:** `pages/engagement/leads.tsx`

**Features:**
- Threads with leads (score, signal count, link to inbox)
- Individual lead signals (author, intent, preview, thread link)
- "Run Lead Detection" button — calls `POST /api/engagement/detect-leads` for all threads
- "Refresh" to reload data
- Link back to Engagement Inbox

**API:** `GET /api/engagement/leads?organization_id=` — returns `leads` and `threads`.

**API:** `POST /api/engagement/detect-leads` — runs lead detection. Body: `{ organization_id, thread_id? }`. If `thread_id` omitted, processes last 50 threads.

---

**Implementation complete.** No changes to engagement ingestion or response engine core logic.

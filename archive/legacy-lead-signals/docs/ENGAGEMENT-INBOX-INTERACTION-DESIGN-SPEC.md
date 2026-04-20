# Engagement Inbox Interaction Design Specification

**Version:** 1.0  
**Status:** Design Specification  
**Scope:** Omnivyra Community Engagement System — Inbox UI and AI-Assisted Response Workflow

---

## 1. Inbox Navigation Model

### User Flow Sequence

1. **Entry:** User opens Engagement Command Center (page route: `/engagement` or equivalent)
2. **Inbox Access:** User selects "Inbox" or "Today's Conversations"
3. **Platform Selection:** System presents platform tabs in the upper section
4. **Thread Selection:** User selects a platform tab; lower section displays threads requiring action
5. **Thread Detail:** User opens a thread to view conversation history and take actions

### Navigation Hierarchy

```
Engagement Command Center
└── Inbox / Today's Conversations
    └── Platform Tab (LinkedIn | X | Instagram | Facebook | YouTube | Reddit)
        └── Thread List (actionable threads)
            └── Thread View (conversation + actions)
```

### Routing Model

- `GET /engagement` — Engagement Command Center root
- Optional: `GET /engagement?tab=inbox` or `GET /engagement/inbox` for direct inbox
- State: selected platform, selected thread ID (query or local state)

---

## 2. Platform Activity Indicators

### Supported Platforms

| Platform | Tab Label | Slug |
|----------|-----------|------|
| LinkedIn | LinkedIn | linkedin |
| X (Twitter) | X | twitter |
| Instagram | Instagram | instagram |
| Facebook | Facebook | facebook |
| YouTube | YouTube | youtube |
| Reddit | Reddit | reddit |

### Per-Tab Indicators

| Indicator | Description | Data Source |
|-----------|-------------|-------------|
| **Activity Indicator** | Badge showing recent activity (e.g., last 24h thread count) | `engagement_threads` / `engagement_messages` count by platform |
| **Unread Message Count** | Number of messages not yet seen/acted on | `engagement_threads.unread_count` or derived from thread_memory |
| **Priority Highlighting** | Color treatment for tabs with high-priority threads | Aggregate `priority_score` or lead signals for platform |

### Priority Color Scheme

- **High:** Red / orange accent
- **Medium:** Amber / yellow accent
- **Low:** Default / no accent

### Data Requirements

- Per-platform: `thread_count`, `unread_count`, `max_priority_tier`
- Refresh: on tab select, on interval (e.g., 60s), on manual refresh

---

## 3. Thread View Structure

### Thread List Item (per thread)

| Field | Description | Source |
|-------|-------------|--------|
| Author | Display name or username | `engagement_authors` / thread metadata |
| Message Text | Snippet of latest or root message | `engagement_messages.content` |
| Platform Icon | Platform identifier | `platform` |
| Priority Score | Numeric or tier (high/medium/low) | `engagement_threads.priority_score` |
| Lead Signal Indicator | Boolean / badge | `engagement_lead_signals` or thread metadata |
| Opportunity Indicator | Boolean / badge | `engagement_opportunities` (unresolved, same thread) |

### Thread Detail View (when opened)

**Layout:**

1. **Header:** Author, platform, thread metadata, action buttons
2. **Conversation History:** Chronological messages (root + replies)
3. **Action Bar:** Reply, Like, Save response pattern, Mark resolved, Ignore thread

### Actions Available

| Action | Behavior | Backend |
|--------|----------|---------|
| **Reply** | Opens reply composer; sends via existing reply API | `POST /api/engagement/reply` |
| **Like** | Records like for selected message | `POST /api/engagement/like` |
| **Save Response Pattern** | Opens pattern capture flow; stores structure | `response_pattern_service` |
| **Mark Resolved** | Marks opportunity/thread resolved | `POST /api/engagement/opportunity/resolve` or equivalent |
| **Ignore Thread** | Marks thread as ignored; removes from actionable list | New or extended API |

---

## 4. AI Reply Suggestion Model

### Requirements

- **Minimum 3 suggestions** per thread
- Each suggestion: `text`, optional `explanation_tag`, "Use Reply" button

### Suggestion Structure

```
{
  id: string;
  text: string;
  explanation_tag?: string;  // e.g., " empathetic", " solution-focused"
  tone?: string;
}
```

### Display

- List or card layout with 3+ suggestions
- "Use Reply" copies text into composer and optionally sends
- Suggestions sourced from: `aiReplySuggestionService` → `responseGenerationService` / `responseOrchestrator`

### Data Flow

1. User selects thread or message to reply to
2. Client calls `GET /api/engagement/suggestions?message_id=...` or equivalent
3. Backend uses conversation memory, reply intelligence, opportunities, policy
4. Returns 3+ suggestions
5. User clicks "Use Reply" → text inserted or sent via reply API

---

## 5. Response Pattern System

### Concept

- **Do NOT store exact reply text as a fixed template**
- Store **response_pattern_structure** — a semantic outline the AI uses to generate replies

### Example Structure

```
Greeting
Acknowledgement
Helpful information
Optional CTA
```

### Structure Format

- Ordered list of semantic blocks
- Each block: `{ type: string; label: string; required?: boolean }`
- Example types: `greeting`, `acknowledgement`, `helpful_info`, `cta`, `sign_off`

### Save Flow

1. User composes or uses a suggestion
2. User clicks "Save Response Pattern"
3. UI prompts: name, category, optional block labels
4. System infers structure from text (or user defines blocks)
5. `responsePatternService.createPattern()` stores structure only

### Usage

- AI generates replies by filling structure with context
- Existing `response_reply_intelligence` / template system extended or aligned

---

## 6. Auto Reply Eligibility Rules

### Conditions (all required)

| Rule | Description | Implementation |
|------|-------------|----------------|
| **Template Exists** | At least one response pattern/template for the category | `response_patterns` or equivalent |
| **Response Category Confidence > Threshold** | Intent/category classification confidence above configurable threshold (e.g., 0.85) | `engagement_message_intelligence` / classification |
| **User Enabled Auto Reply** | Org or user setting allows auto replies | `organization_settings` / `user_preferences` |

### Enforcement

- `autoReplyService.isEligible(thread_id, message_id)` evaluates all rules
- Before any auto send: re-check eligibility
- Log and audit auto-reply decisions

### Edge Cases

- Negative sentiment → require human review
- Lead threads → optional stricter rules
- Competitor mentions → block or flag

---

## 7. UI Component Map

### Components

| Component | Responsibility | Props / State |
|-----------|----------------|---------------|
| **InboxDashboard** | Top-level layout; coordinates tabs and thread list | `organizationId`, `platform`, `threadId` |
| **PlatformTabs** | Renders platform tabs with activity, unread, priority | `platforms`, `counts`, `onSelect` |
| **ThreadList** | Scrollable list of actionable threads | `threads`, `platform`, `onSelect`, `leadSignals`, `opportunities` |
| **ThreadView** | Conversation history + action bar | `thread`, `messages`, `onReply`, `onLike`, etc. |
| **AIReplyPanel** | AI suggestions with "Use Reply" | `messageId`, `suggestions`, `onUseSuggestion` |
| **ResponsePatternManager** | Save pattern flow; list/edit patterns | `onSave`, `patterns` |

### Composition

```
InboxDashboard
├── PlatformTabs
├── ThreadList (when platform selected)
│   └── ThreadListItem (per thread)
└── ThreadView (when thread selected)
    ├── ConversationHistory
    ├── ActionBar (Reply, Like, Save pattern, Mark resolved, Ignore)
    └── AIReplyPanel
```

---

## 8. Backend Service Map

### Services

| Service | Responsibility | Key Methods |
|---------|----------------|-------------|
| **engagementInboxService** | Inbox data: threads, counts, platform stats | `getInboxItems()`, `getThreadsByPlatform()`, `getPlatformCounts()` |
| **aiReplySuggestionService** | Generate 3+ AI suggestions per message | `getSuggestions(messageId, organizationId)` |
| **responsePatternService** | CRUD for response patterns (structure only) | `createPattern()`, `listPatterns()`, `getPatternForCategory()` |
| **autoReplyService** | Eligibility checks; execute auto reply | `isEligible()`, `attemptAutoReply()` |

### API Endpoints (to implement or extend)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/engagement/inbox` | GET | Inbox items (existing) |
| `/api/engagement/suggestions` | GET | AI suggestions (existing) |
| `/api/engagement/patterns` | GET, POST | List/create response patterns |
| `/api/engagement/opportunity/resolve` | POST | Mark resolved (existing) |
| `/api/engagement/thread/ignore` | POST | Ignore thread (new) |

---

## 9. Data Model Requirements

### Table: `response_patterns` (if missing)

```sql
CREATE TABLE IF NOT EXISTS response_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pattern_structure JSONB NOT NULL,           -- ordered blocks
  pattern_category TEXT NOT NULL,            -- e.g., 'question_request', 'recommendation_request'
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_response_patterns_org_category
  ON response_patterns (organization_id, pattern_category);
```

### `pattern_structure` Schema (JSONB)

```json
{
  "blocks": [
    { "type": "greeting", "label": "Greeting", "required": true },
    { "type": "acknowledgement", "label": "Acknowledgement", "required": true },
    { "type": "helpful_info", "label": "Helpful information", "required": true },
    { "type": "cta", "label": "Optional CTA", "required": false }
  ]
}
```

### Existing Tables Referenced

- `engagement_threads` — threads, priority_score, unread_count
- `engagement_messages` — messages, content
- `engagement_authors` — author info
- `engagement_lead_signals` — lead indicators
- `engagement_opportunities` — opportunity indicators, resolved
- `response_reply_intelligence` — reply patterns (alignment with new `response_patterns` if needed)
- `engagement_thread_memory` — conversation context for AI

---

## Appendix: Priority and Indicator Derivation

| Metric | Source |
|--------|--------|
| Unread count | `engagement_threads.unread_count` or computed from last read timestamp |
| Lead signal | `engagement_lead_signals` join on thread_id |
| Opportunity | `engagement_opportunities` where source_thread_id = thread_id and resolved = false |
| Priority tier | Map `priority_score` to high/medium/low thresholds |

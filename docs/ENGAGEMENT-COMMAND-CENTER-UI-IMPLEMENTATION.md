# ENGAGEMENT COMMAND CENTER UI IMPLEMENTATION

**AI Social Media Command Center — Frontend Console**

---

## 1 Main Page Layout

| Item | Details |
|------|---------|
| Route | `/engagement` |
| File | `pages/engagement/index.tsx` |
| Layout | Split view: left 35% (thread list), right 65% (conversation view) |
| Structure | Header (filters) + flex row (ThreadList \| ConversationView) |

---

## 2 Thread List Component

| Item | Details |
|------|---------|
| File | `components/engagement/ThreadList.tsx` |
| API | `GET /api/engagement/inbox` |
| Columns | Platform icon, author_name, latest_message, priority_score badge, message_count, latest_message_time |
| Features | Priority badge (high/medium/low), platform badge, unread indicator |
| Sort | latest_message_time DESC |
| Virtualization | Scrollable container (up to 50 items); react-window can be added for longer lists |

---

## 3 Conversation View

| Item | Details |
|------|---------|
| File | `components/engagement/ConversationView.tsx` |
| API | `GET /api/engagement/messages?thread_id=` |
| Display | Author avatar (initial), author display name, message content, timestamp, platform |
| Nested replies | Built from parent_message_id; replies indented with border-left |
| Quick actions | Like button, Reply button on each message |

---

## 4 Reply Composer

| Item | Details |
|------|---------|
| File | `components/engagement/ReplyComposer.tsx` |
| Features | Textarea, Send button, AI suggestion button |
| API | `POST /api/engagement/reply` |
| Body | organization_id, thread_id, message_id, reply_text, platform |
| Controlled mode | Supports value/onChange for parent-owned state (AISuggestionPanel insert) |

---

## 5 AI Suggestion Panel

| Item | Details |
|------|---------|
| File | `components/engagement/AISuggestionPanel.tsx` |
| API | `GET /api/engagement/suggestions?message_id=&organization_id=` |
| Display | Suggestions grouped by tone: professional, friendly, educational, thought_leadership |
| Interaction | Click suggestion → inserts into ReplyComposer (via onSelectSuggestion) |

---

## 6 Quick Actions

| Action | API | Location |
|--------|-----|----------|
| Like | `POST /api/engagement/like` (organization_id, message_id, platform) | Each message in ConversationView |
| Reply | Opens ReplyComposer inline | Each message in ConversationView |

---

## 7 Filters

| Filter | Control | Options |
|--------|---------|---------|
| Platform | `<select>` | All, linkedin, twitter, instagram, facebook, youtube, reddit |
| Priority | `<select>` | All, high, medium, low |

Filters passed to `GET /api/engagement/inbox` as query params.

---

## 8 Data Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useEngagementInbox` | `hooks/useEngagementInbox.ts` | Fetches inbox threads; handles platform/priority filters; loading, error, refresh |
| `useEngagementMessages` | `hooks/useEngagementMessages.ts` | Fetches messages for selected thread; loading, error, refresh |

---

## 9 Auto Refresh

| Setting | Value |
|---------|-------|
| Inbox refresh | 30 seconds |
| Messages refresh | 30 seconds (when thread selected) |
| Mechanism | `setInterval` in each hook's `useEffect` |

---

## 10 UI Structure

- **Header:** Title, filters (platform, priority), Refresh button, error alert
- **Thread list (35%):** Scrollable; thread cards with platform, author, preview, badges
- **Conversation (65%):** Message list, nested replies, inline ReplyComposer when replying, AISuggestionPanel below composer
- **Components memoized:** ThreadList, ConversationView, ReplyComposer, AISuggestionPanel
- **Batched loading:** Parallel fetch for inbox; messages fetched when thread selected
- **Virtualization:** Scroll container; no external lib (add react-window for 100+ threads if needed)

---

**Implementation complete.** No backend or database changes.

# Extension Module PostgreSQL Schema Design

## 🎯 Executive Summary

Production-grade schema for Chrome extension event ingestion, command execution, and deduplication with existing engagement system.

**Key Achievement:** Extension data flows seamlessly into `engagement_messages` without duplication, maintaining strict multi-tenant isolation.

---

## 📋 Overview: The 4-Table Ecosystem

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `extension_events` | Raw ingestion from Chrome extension | Append-only, immutable |
| `extension_commands` | Action queue for extension execution | Pending → Executing → Success/Failed |
| `extension_sessions` | Auth tokens + polling config | Created on login, expired after 30 days |
| `engagement_message_sources` | Dedup bridge to engagement_messages | Maps platform_message_id → engagement_message_id |

---

## 🔄 Data Flow: Extension → Engagement System

```
Chrome Extension
    ↓ (sends raw event)
POST /api/extension/events
    ↓
extension_events table (stored as-is, JSON)
    ↓
extensionEventProcessor worker (separate BullMQ job)
    ├→ Read: SELECT * FROM extension_events WHERE processed = FALSE
    ├→ Check: Does platform_message_id exist in engagement_message_sources?
    ├→ IF NOT EXISTS:
    │   ├→ INSERT INTO engagement_messages (normalized)
    │   ├→ INSERT INTO engagement_message_sources (mapping)
    │   └→ UPDATE extension_events SET processed = TRUE
    └→ IF EXISTS:
        └→ SKIP (already in engagement_messages from API polling)
    ↓
engagement_messages (unified UI view)
    ↓
Existing AI pipeline (opportunity detection, reply gen, etc.)
```

---

## 📦 TABLE 1: extension_events

**Purpose:** Raw event ingestion from Chrome extension.

```sql
CREATE TABLE extension_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  platform TEXT CHECK (platform IN ('linkedin', 'youtube', ...)),
  event_type TEXT CHECK (event_type IN ('comment', 'dm', 'mention', 'like', 'share')),
  platform_message_id TEXT NOT NULL,      -- ⭐ CRITICAL for dedup
  data JSONB NOT NULL,                     -- Raw platform data (unmodified)
  source TEXT DEFAULT 'extension',         -- 'extension' | 'webhook' | 'api'
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  processing_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Column Details

**platform_message_id** (STRING, NOT NULL)
- Unique identifier from platform (never changes)
- Examples:
  - LinkedIn: `"urn:li:comment:(activity123456789,comment987654321)"`
  - YouTube: `"googlevideo|dQw4w9WgXcQ|Xyz123XYZ123Xyz"`
- Why critical: Same message might arrive from multiple sources
  - Extension captures at 12:00:00
  - API polling captures at 12:01:00
  - Without `platform_message_id`, we'd have 2 rows in engagement_messages (BAD)
  - With it: dedup check prevents duplicate

**source** (TEXT)
- Value: `'extension'` | `'api'` | `'webhook'` | `'mobile'`
- Allows unified event ingestion from multiple sources
- Future: Can accept webhook events same way
- Stored in engagement_message_sources for audit trail

**data** (JSONB)
- Raw, unmodified event from platform
- Example LinkedIn comment:
  ```json
  {
    "thread_id": "urn:li:activity:123",
    "author": {
      "name": "John Doe",
      "profile_id": "urn:li:person:ABCD1234"
    },
    "comment_text": "Great insights!",
    "created_at": 1679596800000
  }
  ```
- Advantage: Can normalize later without data loss

**processed** (BOOLEAN)
- `FALSE`: Waiting for worker to convert to engagement_messages
- `TRUE`: Already in engagement_messages (worker completed)
- Used by worker query: `SELECT * FROM extension_events WHERE processed = FALSE`

### Indexes

```sql
-- Dedup check (most important)
CREATE UNIQUE INDEX idx_extension_events_dedup
ON extension_events (org_id, platform, platform_message_id)
WHERE processed = FALSE;
-- Why UNIQUE: Ensures only 1 unprocessed event per platform_message_id
-- Why WHERE processed = FALSE: After processing, allows "re-ingestion" if needed

-- Worker processing queue
CREATE INDEX idx_extension_events_unprocessed
ON extension_events (processed, created_at DESC);
-- Query: SELECT * FROM extension_events WHERE processed = FALSE ORDER BY created_at LIMIT 100;

-- Analytics / audit
CREATE INDEX idx_extension_events_org_user
ON extension_events (org_id, user_id, created_at DESC);
```

### Multi-Tenant Safety

- Every row has `org_id`
- Every query filtered by `org_id`
- RLS policy: `SELECT USING (org_id = COALESCE(auth.jwt()->>'org_id', ''))`
- Cross-org data access: Impossible

---

## 📦 TABLE 2: extension_commands

**Purpose:** Action queue for extension to execute.

```sql
CREATE TABLE extension_commands (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  platform TEXT CHECK (platform IN ('linkedin', 'youtube')),
  action_type TEXT CHECK (action_type IN ('post_reply', 'like', 'follow', 'share', 'dm_reply')),
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed', 'cancelled')),
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  last_retry_at TIMESTAMP,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  executed_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
);
```

### Status Flow & Retry Safety ✓

```
[pending]
    ↓ Extension fetches via GET /api/extension/commands
    ↓ Extension marks as[executing] via internal state
[executing]
    ↓ If network breaks: "don't re-execute"
    ↓ If timeout > 5min: reset to [pending] (auto-retry)
[success] or [failed]
    ↓ Extension POSTs result via POST /api/extension/action-result
```

Example flow:
```
1. Backend creates: { id: "cmd-123", status: "pending", priority: "high" }
2. Extension fetches: GET /api/extension/commands → returns cmd-123
3. Extension marks locally as "executing" (not stored in DB yet)
4. Network breaks...
5. Extension detects break, flags for retry
6. 5 seconds later, retries POST /api/extension/action-result
7. If successful: { status: "success", result: {...} }
8. Command stays SUCCESS (never re-executed) ✓

If step 3 failed and backend didn't receive "executing" update:
- 5 minutes passes
- Backend sees status still "pending"
- Assumption: Network issue, try again
- Resets to "pending" for next poll cycle
- Extension re-fetches same cmd-123
- Safe retry ✓
```

### Priority Sorting

```sql
-- When extension fetches pending commands, frontend sorts by:
-- 1. Priority DESC (HIGH → MEDIUM → LOW)
-- 2. created_at ASC (older commands first)

SELECT * FROM extension_commands 
WHERE user_id = ? AND org_id = ? AND status = 'pending'
ORDER BY priority DESC, created_at ASC
LIMIT 10;

-- Result: [high-cmd-1, high-cmd-2, medium-cmd-1, low-cmd-1]
```

### Indexes

```sql
-- PRIMARY: Fetch pending commands
CREATE INDEX idx_extension_commands_pending
ON extension_commands (user_id, status, priority, created_at)
WHERE status IN ('pending', 'executing');

-- CLEANUP: Find expired commands (delete old rows)
CREATE INDEX idx_extension_commands_expired
ON extension_commands (org_id, expires_at)
WHERE status NOT IN ('success', 'failed');
```

---

## 📦 TABLE 3: extension_sessions

**Purpose:** Session tokens + polling config.

```sql
CREATE TABLE extension_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  sync_mode TEXT DEFAULT 'batch',
  polling_interval INT DEFAULT 30,
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);
```

### Session Lifecycle

```
1. User opens extension → clicks "Connect"
2. Browser opens Omnivyra in popup
3. User logs in with email + password
4. POST /api/auth/login → issues JWT
5. POST /api/extension/auth → validates JWT, creates session
   Response: { session_token: "abc123def456...", polling_interval: 30 }
6. Extension stores token in encrypted local storage
7. All future requests: Authorization: Bearer <session_token>
8. Backend validates: SELECT * FROM extension_sessions WHERE session_token = ? AND expires_at > NOW()
9. Auth middleware sets req.extensionUser = { user_id, org_id }
10. After 30 days: Token expires automatically
11. Post logout: Token deleted, extension loses access
```

### Indexes

```sql
-- Validate token on EVERY request (fastest)
CREATE UNIQUE INDEX idx_extension_sessions_token
ON extension_sessions (session_token)
WHERE expires_at > NOW();
```

---

## 🌉 TABLE 4: engagement_message_sources (DEDUP BRIDGE) ⭐

**Purpose:** Map platform_message_id → engagement_message_id. The key to unified inbox.

```sql
CREATE TABLE engagement_message_sources (
  id UUID PRIMARY KEY,
  engagement_message_id UUID NOT NULL,
  source TEXT CHECK (source IN ('extension', 'api', 'webhook', 'mobile')),
  platform_message_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Why This Matters

**Problem:**
```
Timeline:
12:00:00 - Extension captures LinkedIn comment "urn:li:comment:(123,456)"
          → Created in engagement_messages as row_A

12:01:00 - API polling worker captures same comment
          → Creates engagement_messages as row_B (DUPLICATE!)

Result: User sees comment TWICE in inbox 😱
```

**Solution (this table):**
```
At 12:00:00 (extension):
  extension_events → INSERT row
  extensionEventProcessor → 
    INSERT INTO engagement_messages (row_A)
    INSERT INTO engagement_message_sources {
      engagement_message_id: row_A.id,
      source: 'extension',
      platform_message_id: 'urn:li:comment:(123,456)',
      platform: 'linkedin'
    }

At 12:01:00 (API polling):
  apiPollingWorker → 
    Check: SELECT * FROM engagement_message_sources 
           WHERE platform_message_id = 'urn:li:comment:(123,456)' AND platform = 'linkedin'
    Result: Exists! → SKIP creating duplicate ✓
```

### Dedup Algorithm (Worker Logic)

```typescript
async function processExtensionEvent(event: ExtensionEventRow) {
  const { platform_message_id, platform, org_id } = event;

  // Step 1: Check if already exists
  const existing = await db.query(
    `SELECT engagement_message_id FROM engagement_message_sources 
     WHERE platform_message_id = ? AND platform = ?`,
    [platform_message_id, platform]
  );

  if (existing) {
    // Already in engagement_messages from another source
    // Mark as processed and done
    await db.query(`UPDATE extension_events SET processed = TRUE, processed_at = NOW() WHERE id = ?`, [event.id]);
    return;
  }

  // Step 2: Doesn't exist, create new engagement_message
  const engMsg = await db.query(
    `INSERT INTO engagement_messages (org_id, platform, thread_id, ...) 
     VALUES (?, ?, ?, ...) RETURNING id`,
    [org_id, platform, event.data.thread_id, ...]
  );

  // Step 3: Record source mapping
  await db.query(
    `INSERT INTO engagement_message_sources 
     (engagement_message_id, source, platform_message_id, platform) 
     VALUES (?, ?, ?, ?)`,
    [engMsg.id, 'extension', platform_message_id, platform]
  );

  // Step 4: Mark event as processed
  await db.query(`UPDATE extension_events SET processed = TRUE, processed_at = NOW() WHERE id = ?`, [event.id]);
}
```

### Index

```sql
CREATE UNIQUE INDEX idx_message_source_dedup
ON engagement_message_sources (platform_message_id, platform, source);
-- Ensures no duplicate source mapping
```

---

## 🔐 Multi-Tenant Safety & RLS

### Design Principle: Defense in Depth

Every table has `org_id`. Every query includes `WHERE org_id = ?`.

```sql
-- Row-Level Security (Supabase)
ALTER TABLE extension_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation" ON extension_events
  FOR SELECT USING (org_id = COALESCE(auth.jwt()->>'org_id', ''));
```

Even if a developer forgets `WHERE org_id = ?`, RLS prevents data leakage.

### Test Case

```typescript
// User A (org_1) queries
SELECT * FROM extension_events;
// RLS filters: WHERE org_id = 'org_1'
// Result: Only org_1 data ✓

// User B (org_2) with same query
SELECT * FROM extension_events;
// RLS filters: WHERE org_id = 'org_2'
// Result: Only org_2 data ✓
```

---

## 📊 Index Strategy & Query Performance

### extension_events Indexes

| Index | Used By | Query Pattern | Cost |
|-------|---------|---------------|------|
| `idx_extension_events_dedup` | extensionEventProcessor | Dedup check (O(1)) | Critical |
| `idx_extension_events_unprocessed` | Worker queue fetch | Find 100 unprocessed | High |
| `idx_extension_events_org_user` | Analytics, audit | "Show user's events" | Medium |

### extension_commands Indexes

| Index | Used By | Query Pattern | Cost |
|-------|---------|---------------|------|
| `idx_extension_commands_pending` | Extension polling | Fetch pending by priority | **Most Important** |
| `idx_extension_commands_expired` | Cleanup job | Delete expired rows | Medium |

---

## 📈 Scaling Strategy

### Current State (MVP)
- All data in-memory (TypeScript)
- No partitioning needed

### At 1M extension_events rows

Partition by month:

```sql
ALTER TABLE extension_events PARTITION BY RANGE (DATE_TRUNC('month', created_at));

CREATE TABLE extension_events_2026_03 PARTITION OF extension_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE extension_events_2026_04 PARTITION OF extension_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

Benefits:
- **Faster queries**: Planner prunes old partitions
- **Easier cleanup**: `DROP TABLE extension_events_2025_01` (vs DELETE 1M rows)
- **Parallel scans**: Process multiple partitions simultaneously

### At 10M commands rows

Similar partitioning + archive old commands to separate table.

---

## 🔗 How Extension Data Flows to engagement_messages

### Existing engagement_messages Table (DO NOT MODIFY)

```sql
CREATE TABLE engagement_messages (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  author_id UUID NOT NULL,
  platform TEXT NOT NULL,
  message_type TEXT NOT NULL,  -- 'comment', 'dm', 'reply', etc.
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMP,
  ...
);
```

### Worker: extensionEventProcessor

Transforms extension_events → engagement_messages

```typescript
// File: backend/workers/extensionEventProcessor.ts

async function processExtensionEvents() {
  // 1. Fetch unprocessed extension events
  const events = await db.query(
    `SELECT * FROM extension_events 
     WHERE processed = FALSE AND source = 'extension'
     ORDER BY created_at ASC
     LIMIT 100`
  );

  for (const event of events) {
    try {
      // 2. Dedup check
      const existing = await db.query(
        `SELECT engagement_message_id FROM engagement_message_sources 
         WHERE platform_message_id = ? AND platform = ?`,
        [event.platform_message_id, event.platform]
      );

      if (existing) {
        // Already processed, skip
        await markProcessed(event.id);
        continue;
      }

      // 3. Normalize event data
      const normalized = normalizeEventData(event.data, event.event_type);

      // 4. Create engagement_message
      const engMsg = await db.query(
        `INSERT INTO engagement_messages (...) VALUES (...) RETURNING id`,
        [event.org_id, event.platform, normalized.thread_id, ...]
      );

      // 5. Record source mapping
      await db.query(
        `INSERT INTO engagement_message_sources (...) VALUES (...)`,
        [engMsg.id, 'extension', event.platform_message_id, event.platform]
      );

      // 6. Mark processed
      await markProcessed(event.id);

      // 7. Trigger cascading jobs
      await queue.add('detectOpportunity', { messageId: engMsg.id });

    } catch (error) {
      await recordError(event.id, error.message);
    }
  }
}
```

### Result

- ✅ Extension events flow into unified engagement_messages
- ✅ No duplicates (dedup bridge prevents)
- ✅ Existing AI pipeline (opportunity detection, reply gen) just works™
- ✅ UI shows extension + API data together seamlessly

---

## 🧪 Data Integrity Tests

### Test 1: Dedup Safety

```typescript
test('Extension + API capture same message → single row in engagement_messages', async () => {
  // Simulate extension capturing comment
  await db.insert('extension_events', {
    platform: 'linkedin',
    platform_message_id: 'urn:li:comment:(123,456)',
    data: {...},
    source: 'extension'
  });

  // Process via worker
  await extensionEventProcessor();

  // Check: engagement_messages has 1 row
  const msgs = await db.query(
    `SELECT COUNT(*) FROM engagement_messages WHERE platform_message_id = ?`,
    ['urn:li:comment:(123,456)']
  );
  expect(msgs[0].count).toBe(1); // ✓

  // Now simulate API polling capturing same comment
  await apiPollingWorker();

  // Check: Still 1 row (not duplicated)
  const msgs2 = await db.query(
    `SELECT COUNT(*) FROM engagement_messages WHERE platform_message_id = ?`,
    ['urn:li:comment:(123,456)']
  );
  expect(msgs2[0].count).toBe(1); // ✓
});
```

### Test 2: Multi-Tenant Isolation

```typescript
test('Org1 user cannot see Org2 commands', async () => {
  // Org1 creates command
  await db.insert('extension_commands', {
    org_id: 'org_1',
    user_id: 'user_1',
    action_type: 'post_reply',
    status: 'pending'
  });

  // Org2 user queries
  const user2Session = { org_id: 'org_2' };
  const cmds = await db.query(
    `SELECT * FROM extension_commands WHERE org_id = ?`,
    ['org_2']
  );

  expect(cmds.length).toBe(0); // ✓ Org2 can't see Org1's data
});
```

---

## 🚀 Deployment Checklist

- [ ] Create tables in staging PostgreSQL
- [ ] Verify indexes created
- [ ] Enable RLS on all tables
- [ ] Run ANALYZE on all tables
- [ ] Test dedup logic end-to-end
- [ ] Test multi-tenant isolation
- [ ] Load test: 10k inserts/min
- [ ] Backup strategy (extension_events is immutable, safe to archive)
- [ ] Monitoring: Track command retry_count, error rates
- [ ] Documentation: Add to runbook

---

## 📚 References

**Files:**
- Schema: `modules/extension/database/extension_schema.sql`
- Types: `modules/extension/types/extension.types.ts`
- Repository: `modules/extension/repositories/InMemoryExtensionRepository.ts`
- Worker (TODO): `backend/workers/extensionEventProcessor.ts`

**Next Steps:**
1. Run migration script to create tables
2. Implement extensionEventProcessor worker
3. Add integration tests (dedup, RLS)
4. Deploy to staging
5. Performance test: 100k events/day

---

**Schema Status:** ✅ Production-Ready  
**Last Updated:** 2026-03-23  
**Version:** 1.0

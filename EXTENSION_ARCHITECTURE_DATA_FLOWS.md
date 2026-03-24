# Chrome Extension Architecture - Visual Data Flows

## FLOW 1: Extension Event Ingestion
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CHROME EXTENSION (Browser)                             │
│                                                                               │
│  User scrolls LinkedIn feed → Sees new comment:                             │
│  "Great product! When will you launch in EU?"                               │
│                                                                               │
│  Extension DOM parser detects:                                              │
│    - Post ID: "post-xyz"                                                    │
│    - Author: "Jane Smith" (@jane-smith)                                    │
│    - Comment content: "Great product..."                                   │
│    - Author profile URL: linkedin.com/in/jane-smith                        │
│                                                                               │
│  Extension builds event payload:                                            │
│  {                                                                           │
│    "event_type": "comment_posted",                                         │
│    "platform": "linkedin",                                                 │
│    "extension_user_id": "jane-smith",                                     │
│    "platform_entity_id": "post-xyz",                                      │
│    "payload": {                                                            │
│      "comment_id": "comment-abc123",                                      │
│      "comment_text": "Great product! When will you...",                  │
│      "author_username": "jane-smith",                                    │
│      "author_display_name": "Jane Smith",                                │
│      "author_profile_url": "linkedin.com/in/jane-smith",                │
│      "timestamp": "2026-03-23T14:32:10Z"                                │
│    }                                                                       │
│  }                                                                           │
│                                                                               │
│  Sign with HMAC-SHA256:                                                     │
│  signature = HMAC_SHA256(payload, webhook_secret)                           │
│                                                                               │
│  POST to backend with signature header                                      │
└──────────────────┬──────────────────────────────────────────────────────────┘
                   │
                   │ HTTPS POST /api/extension/events
                   │ Headers:
                   │   X-Extension-ID: ext-org-123
                   │   X-Timestamp: 1234567890
                   │   X-Signature: hmac-sha256=a1b2c3d4
                   │   Content-Type: application/json
                   ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND API SERVER                                  │
│                                                                               │
│  1. extensionWebhookHandler.ts                                              │
│     - Parse request                                                         │
│     - Verify signature using webhook_secret from extension_configs         │
│     - Check timestamp (reject if > 5 minutes old)                         │
│     - Check organization quota/rate limit                                  │
│                                                                              │
│  2. Create row in extension_events:                                        │
│     {                                                                       │
│       id: UUID(),                                                         │
│       organization_id: org-uuid,                                         │
│       extension_config_id: ext-config-uuid,                             │
│       platform: 'linkedin',                                             │
│       event_type: 'comment_posted',                                    │
│       extension_user_id: 'jane-smith',                                │
│       platform_entity_id: 'post-xyz',                                 │
│       event_payload: { full payload },                                │
│       signature_verified: true,                                       │
│       processing_status: 'pending',                                   │
│       created_at: NOW()                                              │
│     }                                                                   │
│                                                                         │
│  3. Enqueue job in BullMQ:                                             │
│     - Queue name: 'extension-event-processing'                         │
│     - Job data: { extension_event_id: UUID }                          │
│                                                                         │
│  4. Return HTTP 202 Accepted:                                          │
│     {                                                                   │
│       "ok": true,                                                     │
│       "event_id": "ext-evt-uuid",                                    │
│       "normalized_to": null                                          │
│     }                                                                   │
└────────┬──────────────────────────────────────────────────────────────────┘
         │
         │ (Async) Worker Processes
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                   extensionEventProcessor Worker                             │
│                                                                               │
│  1. Fetch extension_event (processing_status='pending')                      │
│                                                                               │
│  2. Call engagementNormalizationService.normalizeLinkedInComment()           │
│     - Parse extension_user_id "jane-smith" → create/update engagement_authors│
│     - Parse platform_entity_id "post-xyz" → engagement_threads              │
│     - Create engagement_messages row:                                        │
│       {                                                                       │
│         id: UUID(),                                                         │
│         thread_id: thread-uuid,                                            │
│         author_id: author-jane-smith-uuid,                                │
│         platform: 'linkedin',                                             │
│         platform_message_id: 'comment-abc123',                           │
│         message_type: 'comment',                                         │
│         content: 'Great product! When will you...',                      │
│         source_origin: 'extension',                                      │
│         extension_event_id: ext-evt-uuid,                               │
│         extension_config_id: ext-config-uuid,                           │
│         created_at: NOW()                                              │
│       }                                                                   │
│                                                                              │
│  3. Check for deduplication:                                               │
│     - Query: SELECT id FROM engagement_messages                           │
│              WHERE platform_message_id = 'comment-abc123'               │
│                AND thread_id = thread-uuid                             │
│     - If FOUND (API already polled it):                                 │
│       * Update existing row (upsert metadata)                          │
│       * Record source in engagement_message_sources                    │
│     - If NOT FOUND:                                                    │
│       * Insert new row                                                │
│       * Record source in engagement_message_sources                   │
│                                                                              │
│  4. Update extension_event:                                               │
│     - Set processing_status = 'normalized'                             │
│     - Set normalized_to = engagement_message_id (or null if failed)    │
│     - Set processed_at = NOW()                                        │
│                                                                             │
│  5. Trigger cascade:                                                      │
│     - If message created, trigger engagement_message insert trigger     │
│     - Compute engagement_message_intelligence                          │
│     - Enqueue opportunity detection job                                │
└────────┬──────────────────────────────────────────────────────────────────┘
         │
         │ (Cascade) Existing workflows
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│            Existing: engagementOpportunityDetectionWorker                    │
│            + communityAiActionExecutor                                       │
│                                                                               │
│  1. Analyze message for opportunities:                                       │
│     - Is this a lead mention? ("When will you launch in EU?" = YES)        │
│     - Sentiment: POSITIVE                                                  │
│     - Should we reply? YES (opportunity detected)                          │
│                                                                               │
│  2. Create engagement_opportunities row:                                     │
│     {                                                                        │
│       id: UUID(),                                                          │
│       organization_id: org-uuid,                                          │
│       source_thread_id: thread-uuid,                                      │
│       source_message_id: msg-uuid,                                        │
│       opportunity_type: 'lead',                                           │
│       detected_at: NOW(),                                                │
│       resolved: false                                                    │
│     }                                                                      │
│                                                                             │
│  3. If auto-reply enabled:                                                │
│     - Call replyGenerationService:                                       │
│       * Prompt: "User asked about EU launch. Reply professionally"      │
│       * Generate: "Thanks for your interest! We're working on EU..."   │
│     - Create community_ai_actions row:                                  │
│       {                                                                   │
│         id: UUID(),                                                     │
│         organization_id: org-uuid,                                     │
│         platform: 'linkedin',                                          │
│         action_type: 'reply',                                          │
│         target_id: 'comment-abc123',                                  │
│         suggested_text: "Thanks for your interest! We're...",         │
│         status: 'pending',                                            │
│         execution_mode: 'extension',  [NEW]                          │
│         created_at: NOW()                                            │
│       }                                                                  │
│                                                                          │
│  4. Notify frontend:                                                   │
│     - Websocket or next poll: "New opportunity detected"            │
│     - Toast: "Jane Smith asked about EU - Reply suggested"         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## FLOW 2: Backend Command Execution

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            OMNIVYRA UI (Web)                                 │
│                                                                                │
│  User sees inbox:                                                            │
│  [New comment] Jane Smith: "Great product! When will you launch in EU?"     │
│  [AI SUGGESTED] "Thanks for your interest! We're..."                        │
│                                                                               │
│  User clicks: [✓ Send Reply] button                                         │
│                                                                               │
│  Frontend calls:                                                            │
│  POST /api/engagement/reply {                                              │
│    "organization_id": "org-uuid",                                         │
│    "thread_id": "thread-uuid",                                            │
│    "message_id": "msg-uuid",                                              │
│    "reply_text": "Thanks for your interest! We're...",                   │
│    "platform": "linkedin",                                                │
│    "ai_generated": true                                                   │
│  }                                                                          │
└────────┬─────────────────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                      /api/engagement/reply Handler                            │
│                                                                               │
│  1. Validate user credentials (JWT)                                          │
│  2. Check organization_id matches user's company                             │
│  3. Check RBAC: user has 'community_ai:execute_commands'?                    │
│  4. Fetch engagement_messages to verify it exists                            │
│  5. Fetch community_ai_actions for this message (if exists)                  │
│  6. Credit pre-check:                                                        │
│     - Cost = 1 credit (ai_reply)                                           │
│     - hasEnoughCredits(org-uuid, 1) → true/false                          │
│     - If false: return 402 (Payment Required)                              │
│  7. Check platform connector availability                                   │
│  8. If message from extension (source_origin='extension'):                  │
│     - Create extension_commands row:                                        │
│       {                                                                      │
│         id: UUID(),                                                        │
│         organization_id: org-uuid,                                        │
│         extension_config_id: ext-config-uuid,                            │
│         command_type: 'reply',                                           │
│         platform: 'linkedin',                                            │
│         target_id: 'comment-abc123',                                    │
│         command_payload: {                                              │
│           reply_text: "Thanks for your interest! We're...",           │
│           context: { ... }                                            │
│         },                                                              │
│         queued_at: NOW(),                                             │
│         execution_status: 'pending'                                   │
│       }                                                                 │
│     - Deduct credits now (or when command executed)                   │
│     - Return 201 with command_id                                      │
│                                                                         │
│  9. If message from API (source_origin='api'):                         │
│     - Route to existing communityAiActionExecutor                      │
│     - (No change to existing flow)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
         │
         │ (For extension commands only)
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CHROME EXTENSION POLLING                              │
│                                                                                │
│  Extension polls every 5 seconds:                                            │
│  GET /api/extension/sync?organization_id=org-uuid&since=2026-03-23T14:30   │
│                                                                               │
│  Backend returns:                                                            │
│  {                                                                           │
│    "pending_commands": [                                                   │
│      {                                                                      │
│        "id": "cmd-uuid",                                                  │
│        "command_type": "reply",                                           │
│        "platform": "linkedin",                                            │
│        "target_id": "comment-abc123",                                    │
│        "command_payload": {                                              │
│          "reply_text": "Thanks for your interest! We're launching..."   │
│        }                                                                   │
│      }                                                                     │
│    ],                                                                      │
│    "recent_events": []                                                   │
│  }                                                                         │
│                                                                             │
│  Extension receives command and:                                          │
│  1. Finds the comment on page (DOM query)                                │
│  2. Injects reply text into LinkedIn reply box                           │
│  3. Simulates user clicking "Post" button                                │
│  4. Monitors for success (LinkedIn post animation)                       │
│  5. POST to /api/extension/command-result:                              │
│     {                                                                     │
│       "command_id": "cmd-uuid",                                         │
│       "status": "executed",                                             │
│       "platform_response": {                                            │
│         "status_code": 200,                                            │
│         "comment_id": "comment-def456"                                 │
│       }                                                                  │
│     }                                                                    │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                /api/extension/command-result Handler                         │
│                                                                               │
│  1. Fetch extension_commands by command_id                                   │
│  2. Validate organization_id matches (security)                              │
│  3. Update extension_commands:                                               │
│     - Set execution_status = 'executed' (or 'failed')                       │
│     - Set platform_response = { ... }                                       │
│     - Set executed_at = NOW()                                              │
│  4. Update community_ai_actions:                                            │
│     - Create row (linking to extension_commands)                           │
│     - Set status = 'executed'                                             │
│  5. Log performance metrics:                                                │
│     - Time from command queued → executed                                  │
│     - Store in extension_telemetry                                         │
│  6. Increment usage meter:                                                  │
│     - Feature: 'community_ai'                                             │
│     - Action: 'extension_reply'                                           │
│     - Credits: 1                                                          │
│  7. If platform_response indicates success:                                │
│     - Mark opportunity as 'resolved_action = replied'                    │
│     - Update response_performance_metrics (for learning)                 │
│  8. Return HTTP 200                                                        │
└────────┬────────────────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│                  User sees reply posted on LinkedIn!                         │
│                                                                               │
│  Timeline:                                                                  │
│  - 0ms: User clicks "Send" in Omnivyra UI                                 │
│  - 50ms: Backend queues extension_commands                                │
│  - 50-5000ms: Extension polls (waits up to 5 seconds)                    │
│  - 5000ms: Extension finds command via /api/extension/sync                │
│  - 5200ms: Extension injects reply into LinkedIn                         │
│  - 5300ms: LinkedIn validates & posts reply                              │
│  - 5400ms: Extension reports success to backend                          │
│                                                                             │
│  Total E2E: ~5.4 seconds (acceptable for real-time workflow)             │
│                                                                             │
│  Next time user refreshes engagement inbox:                              │
│  - New message appears: "Your Reply (via Omnivyra): Thanks for..."      │
│  - Fully tracked in engagement_messages with source_origin='api'        │
│    (API polling fetches it on next cycle)                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## FLOW 3: Deduplication Scenario

```
Time: 14:32:10 UTC (Wednesday)

Scenario: Comment posted on LinkedIn; both Extension and API polling detect it

                       Comment Created on LinkedIn
                       |
        ┌──────────────┼──────────────┐
        │              │              │
        ↓              ↓              ↓
    Browser UI    Extension     Cron Job
                                (polls every 60s)
   (User sees     (Detects DOM
    via LinkedIn)  change)
                    │
                    │ 14:32:11 - Extension sends event
                    │ POST /api/extension/events
                    ↓
    ┌───────────────────────────────────────────────┐
    │     Backend: Create extension_events row      │
    │                                               │
    │     INSERT INTO extension_events (            │
    │       organization_id,                       │
    │       platform_message_id: 'comment-abc123', │
    │       ...                                    │
    │     )                                        │
    │     → event_id: ext-evt-123                │
    └───────────────────────────────────────────────┘
                    │
                    │ (Within 100ms) extensionEventProcessor
                    ↓
    ┌───────────────────────────────────────────────┐
    │ Normalize to engagement_messages              │
    │                                               │
    │ INSERT INTO engagement_messages (             │
    │   platform_message_id: 'comment-abc123',     │
    │   thread_id: thread-xyz,                     │
    │   source_origin: 'extension',                │
    │   ...                                        │
    │ )                                            │
    │ → msg_id: msg-ext-001 ✓                    │
    │                                               │
    │ INSERT INTO engagement_message_sources (      │
    │   engagement_message_id: msg-ext-001,       │
    │   extension_event_id: ext-evt-123,          │
    │   source_precedence: 1  [extension = highest]│
    │ )                                            │
    └───────────────────────────────────────────────┘
                    │
                    ├─→ Inbox shows comment ✓
                    │   Source indicator: "via Extension"
                    │
                    │ (Meanwhile, 30 seconds later)
                    │
      14:32:40    ├─────────────────────────┐
      Cron fires  │                         │
      (polls)     │     ↓ engagementPollingProcessor
                  │     (ingestComments for recent posts)
                  │                         │
                  │     ┌───────────────────┴────────────────┐
                  │     │ Fetch comments from LinkedIn API   │
                  │     │ Returns: [comment-abc123, ...]     │
                  │     │                                     │
                  │     │ Normalize to IngestCommentRow[]    │
                  │     │ platform_comment_id: 'comment-abc' │
                  │     ↓
    ┌─────────────────────────────────────────────────────┐
    │  Try to INSERT into engagement_messages             │
    │  (but unique constraint exists!)                    │
    │                                                     │
    │  UNIQUE INDEX:                                      │
    │  (thread_id, platform_message_id)                  │
    │                                                     │
    │  Query finds: msg-ext-001 already exists!         │
    │  → CONFLICT on (thread-xyz, comment-abc123)      │
    │  → Execute ON CONFLICT UPDATE:                    │
    │     - like_count: 3 (API response)               │
    │     - reply_count: 0                             │
    │     - platform_created_at: 2026-03-23T14:32:10  │
    │     - updated_at: NOW()                          │
    └─────────────────────────────────────────────────────┘
                  │
                  │ INSERT INTO engagement_message_sources (
                  │   engagement_message_id: msg-ext-001,
                  │   api_source_id: 'api-poll-003',
                  │   extension_event_id: ext-evt-123,
                  │   source_precedence: 1  [extension still wins]
                  │ )
                  │ (Or UPDATE if row exists)
                  │
                  ↓
    ┌──────────────────────────────────────────────────────┐
    │ Final State                                          │
    │                                                      │
    │ engagement_messages: 1 row (msg-ext-001)           │
    │   - content: "Great product! When will..."        │
    │   - source_origin: 'extension'                    │
    │   - like_count: 3 (updated by API)              │
    │   - platform_created_at: 14:32:10 (extension)  │
    │                                                  │
    │ engagement_message_sources: 1 row                │
    │   - extension_event_id: ext-evt-123            │
    │   - api_source_id: api-poll-003                │
    │   - source_precedence: 1 (extension wins)      │
    │                                                  │
    │ ✓ NO duplicates                                │
    │ ✓ Data merged correctly                        │
    │ ✓ Single source of truth                       │
    │ ✓ Can audit multi-source detection             │
    └──────────────────────────────────────────────────────┘
```

---

## FLOW 4: Platform-Specific Data Model

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    engagement_messages (Core)                               │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ id: UUID                                                             │ │
│  │ thread_id: UUID                                                      │ │
│  │ author_id: UUID                                                      │ │
│  │ platform: 'linkedin' | 'youtube' | 'twitter' | 'facebook'          │ │
│  │ platform_message_id: TEXT (unique per platform)                    │ │
│  │ message_type: 'comment' | 'reply' | 'dm' | 'mention' | 'like'    │ │
│  │ content: TEXT                                                        │ │
│  │ raw_payload: JSONB (raw platform API response)                     │ │
│  │ source_origin: 'api' | 'extension' | 'webhook'                    │ │
│  │ like_count, reply_count, sentiment_score                           │ │
│  │ created_at, platform_created_at, updated_at                        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
│                                    │ (foreign key via raw_payload parse)   │
│                                    ↓                                        │
│  ┌─────────────────────────────┬──────────────┬─────────────────────────┐ │
│  │ LinkedIn-specific context   │ YouTube-spec │ Twitter-specific        │ │
│  │ ─────────────────────────   │ ─────────────│ ───────────────────     │ │
│  │ linked_article_id           │ video_id     │ tweet_id               │ │
│  │ article_title               │ video_title  │ is_retweet             │ │
│  │ is_verified_commenter       │ channel_id   │ quote_text             │ │
│  │ creator_profile_url         │ reply_count  │ possibly_sensitive     │ │
│  │ post_impression_count       │ likes_on_com │ author_followers       │ │
│  └─────────────────────────────┴──────────────┴─────────────────────────┘ │
│                                                                              │
│  Option A (Early): Store all in raw_payload, query with JSONB operators   │
│  Option B (Later): Create platform-specific context tables (shown above)   │
└────────────────────────────────────────────────────────────────────────────┘

Schema Evolution Path:

Week 1-2: Everything in raw_payload
  - Minimal schema changes
  - Query with: raw_payload->>'video_id'

Week 3-4: Add LinkedIn context table
  CREATE TABLE engagement_linkedin_context (
    message_id UUID PRIMARY KEY REFERENCES engagement_messages(id),
    linked_article_id TEXT,
    ...
  )
  - Separate concerns
  - Better indexing
  - Validated schema

Week 5-6: Add YouTube context table, etc.

Result: Strong typing per-platform while maintaining flexibility
```

---

## FLOW 5: Credit & Usage Metering

```
Organization: Acme Corp
Start-of-day balance: 500 credits

14:30 - User replies to 3 comments via UI
  → 3 × 1 credit = -3 credits
  → Balance: 497

14:32 - Extension detects 10 new comments
  → Queued for auto-reply rules? No
  → No credit impact (ingestion is free)

14:35 - User bulk-replies to 5 comments with AI suggestions
  → First suggestion: replyGenerationService → 2 credits
  → Bulk reply execution: 5 × 1 credit = -5 credits
  → Total: -7 credits
  → Balance: 490

14:40 - Lead detected in comment (auto-notification)
  → Lead detection: -15 credits (charged at detection, not per-message)
  → Balance: 475

15:00 - User enables auto-reply playbook
  → No immediate charge
  → When reply executes: -1 credit per reply

Usage log (audit trail):

  timestamp | feature_area | action | credits_consumed | metadata
  ──────────┼──────────────┼────────┼──────────────────┼────────────────────────
  14:30:05  | community_ai | reply            1  | message_id=msg-001
  14:30:15  | community_ai | reply            1  | message_id=msg-002
  14:30:25  | community_ai | reply            1  | message_id=msg-003
  14:32:10  | engagement   | comment_ingest   0  | thread_id=th-001 [extension]
  14:35:10  | community_ai | reply_suggestion 2  | message_id=msg-004
  14:35:20  | community_ai | reply            1  | message_id=msg-005
  14:35:30  | community_ai | reply            1  | message_id=msg-006
  14:35:40  | community_ai | reply            1  | message_id=msg-007
  14:35:50  | community_ai | reply            1  | message_id=msg-008
  14:35:60  | community_ai | reply            1  | message_id=msg-009
  14:40:05  | engagement   | lead_detection  15  | thread_id=th-002, score=87
  15:00:30  | community_ai | reply            1  | playbook_auto_reply, msg-010

  Total credits consumed: 35
  REMAINING BALANCE: 465 (started at 500)

Credit Enforcement:

  Before executing action:
  ├─ Check hasEnoughCredits(org_id, cost)
  ├─ If insufficient:
  │  └─ Return 402 Payment Required
  │     { error: "Insufficient credits", required: 2, available: 1 }
  │
  └─ If OK:
     ├─ Execute action
     ├─ Log usage event
     ├─ Deduct credits (atomically)
     └─ Update organization_credits.balance_credits

  Failed actions:
  - If action fails AFTER credits deducted, refund immediately
  - Example: Reply generated but LinkedIn API rejects due to rate limit
    → Refund 1 credit
    → Log as "refunded_action_failed"
```

---

## Summary: Architecture Layers with Extension

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 5: User Interfaces                                            │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Web UI (Omnivyra)               Chrome Extension               │ │
│ │ - Inbox view                     - LinkedIn content injection  │ │
│ │ - Reply drafting                 - Real-time notifications     │ │
│ │ - Opportunity radar              - Command execution           │ │
│ └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 4: API Gateway                                                │
│ ┌─────────────────────────┬──────────────────────────────────────┐ │
│ │ REST API Routes         │ Extension-specific routes            │ │
│ │ - /api/engagement/*     │ - /api/extension/events             │ │
│ │ - /api/campaigns/*      │ - /api/extension/commands           │ │
│ │ - /api/recommendations │ - /api/extension/command-result     │ │
│ │ - /api/voice/*          │ - /api/extension/sync               │ │
│ │                         │ - /api/extension/auth               │ │
│ └─────────────────────────┴──────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3: Service Orchestration                                      │
│ ┌─────────────────────┬────────────────┬──────────────────────────┐ │
│ │ Extension Services  │ Engagement     │ Intelligence             │ │
│ │ ─────────────────── │ ──────────────  │ ─────────────────        │ │
│ │ - Event service     │ - Inbox        │ - Lead scoring          │ │
│ │ - Command service   │ - Message      │ - Opportunity detection │ │
│ │ - Session service   │ - Reply gen    │ - Signal clustering     │ │
│ │ - Analytics service │ - Normalizr    │ - Analytics             │ │
│ │ - Signature service │ - Thread       │ - Pattern detection     │ │
│ └─────────────────────┴────────────────┴──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2: Background Processing & Queues                             │
│ ┌─────────────────────┬────────────────────────────────────────────┐ │
│ │ BullMQ Workers      │ Cron Schedulers                            │ │
│ │ ─────────────────── │ ──────────────────                         │ │
│ │ - Extension event   │ - Engagement polling (60s)                 │ │
│ │ - Extension cmdExec │ - Lead thread recompute                   │ │
│ │ - Extension dedup   │ - Opportunity detection                   │ │
│ │ - Opp detection     │ - Intelligence analysis                   │ │
│ │ - Lead thread       │ - Performance calculation                 │ │
│ └─────────────────────┴────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 1: Data Layer                                                 │
│ ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐ │
│ │ Engage   │ Ext      │ Author   │ Intell   │ Opp      │ Credit   │ │
│ │ ─────    │ ──────   │ ───────  │ ────────  │ ──────   │ ────     │ │
│ │ threads  │ events   │ authors  │ signals  │ tunties  │ config   │ │
│ │ messages │ commands │ sources  │ scores   │ resolved │ meters   │ │
│ │ class    │ results  │ context  │ alerts   │ learning │ ledger   │ │
│ └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘ │
│                                                                      │
│ Supabase PostgreSQL (RLS, Triggers, Custom Types, Partitioning)    │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 0: External Services                                         │
│ ┌──────────┬──────────┬──────────┬──────────┬──────────┐           │
│ │ LinkedIn │ YouTube  │ Twitter  │ Facebook │ OpenAI   │           │
│ │ API      │ API      │ API      │ API      │ (GPT-4)  │           │
│ └──────────┴──────────┴──────────┴──────────┴──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```
